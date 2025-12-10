'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
// Using div with overflow for scrolling since ScrollArea may not exist
import { Mic, Send, Loader2, Eye, Edit, Undo2, CheckCircle2 } from 'lucide-react'
import { Recorder } from '@/components/voice/Recorder'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase/client'
import type { EstimateData } from '@/types/estimate'

interface ChatMessage {
  id: string
  type: 'user' | 'system'
  content: string
  timestamp: Date
  lineItemId?: string // For system messages about line items
}

interface EstimateChatProps {
  projectId: string
  estimateId: string | null
  onEstimateUpdate?: (estimateId: string, data: EstimateData) => void
  onLineItemClick?: (lineItemId: string) => void
}

export function EstimateChat({ projectId, estimateId, onEstimateUpdate, onLineItemClick }: EstimateChatProps) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [transcriptFromRecording, setTranscriptFromRecording] = useState<string | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  // Focus input when transcript from recording is set
  useEffect(() => {
    if (transcriptFromRecording && inputRef.current) {
      setInputText(transcriptFromRecording)
      inputRef.current.focus()
      setTranscriptFromRecording(null)
    }
  }, [transcriptFromRecording])

  const handleRecordingComplete = useCallback((audioBlob: Blob, transcript: string) => {
    if (transcript && transcript.trim().length > 0) {
      setTranscriptFromRecording(transcript)
      setIsRecording(false)
    }
  }, [])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    
    if (!inputText.trim() || isSubmitting) return
    if (!user || !user.id) {
      alert('You must be logged in to submit messages')
      return
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: inputText.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    const messageToSend = inputText.trim()
    setInputText('')
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/ai/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: projectId,
          transcript: messageToSend,
          estimateId: estimateId // Pass existing estimate ID to modify it
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Parse failed: ${response.status}`)
      }

      const result = await response.json()
      
      // Transform API response to match unified EstimateData type
      const transformedData: EstimateData = {
        items: (result.data.items || []).map((item: any) => ({
          room_name: item.room_name || 'General',
          description: item.description || '',
          category: item.category || 'Other',
          cost_code: item.cost_code || null,
          quantity: item.quantity ?? 1,
          unit: item.unit || 'EA',
          labor_cost: item.labor_cost ?? 0,
          margin_percent: item.margin_percent ?? 0,
          client_price: item.client_price ?? 0,
          notes: item.notes || undefined
        })),
        assumptions: result.data.assumptions || [],
        missing_info: result.data.missing_info || []
      }

      // Get the newly added/updated line items
      // Load line items from database to see what was added
      const finalEstimateId = result.estimateId || estimateId
      if (!finalEstimateId) {
        throw new Error('No estimate ID returned from API')
      }
      
      const { data: lineItems } = await supabase
        .from('estimate_line_items')
        .select('id, description, client_price, is_allowance, allowance_amount')
        .eq('estimate_id', finalEstimateId)
        .order('created_at', { ascending: false })
        .limit(10) // Get recent items

      // Create system confirmation message
      const addedItems = lineItems?.slice(0, 3) || [] // Show up to 3 most recent items
      const systemMessage: ChatMessage = {
        id: `system-${Date.now()}`,
        type: 'system',
        content: addedItems.length > 0
          ? `Added ${addedItems.length} line item${addedItems.length > 1 ? 's' : ''}: ${addedItems.map(item => {
              const price = item.is_allowance && item.allowance_amount
                ? `$${item.allowance_amount.toLocaleString()} Allowance`
                : item.client_price
                ? `$${item.client_price.toLocaleString()}`
                : ''
              return `${item.description}${price ? ` - ${price}` : ''}`
            }).join(', ')}`
          : 'Estimate updated successfully',
        timestamp: new Date(),
        lineItemId: addedItems[0]?.id
      }

      setMessages(prev => [...prev, systemMessage])

      // Notify parent component of update
      if (onEstimateUpdate && finalEstimateId) {
        onEstimateUpdate(finalEstimateId, transformedData)
      }

    } catch (error) {
      console.error('Error submitting message:', error)
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        type: 'system',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to process message'}`,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUndoLastChange = async () => {
    if (!estimateId) {
      alert('No estimate available to undo changes')
      return
    }

    // Find the last system message with a lineItemId
    const lastSystemMessage = [...messages].reverse().find(msg => msg.type === 'system' && msg.lineItemId)
    
    if (!lastSystemMessage?.lineItemId) {
      alert('No recent changes to undo')
      return
    }

    try {
      // Delete the last added line item
      const { error } = await supabase
        .from('estimate_line_items')
        .delete()
        .eq('id', lastSystemMessage.lineItemId)

      if (error) throw error

      // Remove the system message and user message that led to it
      setMessages(prev => {
        const lastSystemIndex = prev.findIndex(msg => msg.id === lastSystemMessage.id)
        if (lastSystemIndex > 0) {
          // Remove system message and the user message before it
          return prev.slice(0, lastSystemIndex - 1)
        }
        return prev.filter(msg => msg.id !== lastSystemMessage.id)
      })

      // Add undo confirmation
      const undoMessage: ChatMessage = {
        id: `undo-${Date.now()}`,
        type: 'system',
        content: 'Last change undone',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, undoMessage])

      // Notify parent to refresh estimate data
      if (onEstimateUpdate && estimateId) {
        // Reload estimate data
        const { data: lineItems } = await supabase
          .from('estimate_line_items')
          .select('*')
          .eq('estimate_id', estimateId)
          .order('created_at', { ascending: true })

        if (lineItems) {
          const estimateData: EstimateData = {
            items: lineItems.map(item => ({
              id: item.id,
              room_name: item.room_name || 'General',
              description: item.description || '',
              category: item.category || 'Other',
              cost_code: item.cost_code || null,
              quantity: item.quantity ?? 1,
              unit: item.unit || 'EA',
              labor_cost: item.labor_cost || 0,
              margin_percent: item.margin_percent || 0,
              client_price: item.client_price || 0
            })),
            assumptions: [],
            missing_info: []
          }
          onEstimateUpdate(estimateId, estimateData)
        }
      }

    } catch (error) {
      console.error('Error undoing change:', error)
      alert('Failed to undo change')
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4" ref={scrollAreaRef}>
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              <p className="text-sm">Start a conversation to add or modify line items</p>
              <p className="text-xs mt-2">Type a description or use the microphone to record</p>
            </div>
          )}
          
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <Card className={`max-w-[80%] ${message.type === 'user' ? 'bg-primary text-primary-foreground' : ''}`}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    {message.type === 'system' && (
                      <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      <p className="text-xs opacity-70 mt-1">{formatTime(message.timestamp)}</p>
                    </div>
                  </div>
                  
                  {message.type === 'system' && message.lineItemId && (
                    <div className="flex gap-2 mt-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onLineItemClick?.(message.lineItemId!)}
                        className="h-7 text-xs"
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        View Line Item
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          // TODO: Implement edit functionality
                          alert('Edit functionality coming soon')
                        }}
                        className="h-7 text-xs"
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ))}
          
          {isSubmitting && (
            <div className="flex justify-start">
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <p className="text-sm text-muted-foreground">Processing...</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Recording Interface (shown when recording) */}
      {isRecording && (
        <div className="border-t p-4 bg-muted/50">
          <Recorder
            projectId={projectId}
            onRecordingComplete={(audioBlob, transcript) => {
              handleRecordingComplete(audioBlob, transcript)
              setIsRecording(false)
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsRecording(false)}
            className="mt-2"
          >
            Cancel Recording
          </Button>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t p-4 bg-background">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Describe what to add or modify..."
            disabled={isSubmitting || isRecording}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setIsRecording(!isRecording)}
            disabled={isSubmitting}
            className={isRecording ? 'bg-destructive text-destructive-foreground' : ''}
          >
            <Mic className="h-4 w-4" />
          </Button>
          <Button
            type="submit"
            disabled={!inputText.trim() || isSubmitting || isRecording}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
        
        {/* Action Buttons */}
        {messages.length > 0 && (
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleUndoLastChange}
              disabled={!estimateId || isSubmitting}
              className="text-xs"
            >
              <Undo2 className="h-3 w-3 mr-1" />
              Undo Last Change
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

