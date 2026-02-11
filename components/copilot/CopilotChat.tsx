'use client'

import { useState, useRef, useEffect, useOptimistic, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Mic, Paperclip, Send, Loader2, X, FileImage, FileText, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { toast } from 'sonner'
import { useVoiceChat } from '@/hooks/use-voice-chat'
import * as tus from 'tus-js-client'
import type { ChatMessage } from '@/types/db'

interface CopilotChatProps {
  projectId: string
  onSendMessage?: (content: string, fileUrls?: string[]) => Promise<{ response_text: string; actions?: any[] } | undefined>
  onVoiceRecord?: () => void
  onFileAttach?: () => void
  className?: string
}

interface AttachedFile {
  id: string
  name: string
  type: 'image' | 'pdf'
  url: string
  storagePath: string
}

interface OptimisticMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
  isOptimistic: boolean
  optimisticId?: string // Track the optimistic ID separately for deduplication
}

export function CopilotChat({
  projectId,
  onSendMessage,
  onVoiceRecord,
  onFileAttach,
  className
}: CopilotChatProps) {
  const [inputValue, setInputValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isPending, startTransition] = useTransition()
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { user } = useAuth()
  const router = useRouter()

  // Voice chat hook (simple dictation)
  const {
    isRecording,
    isTranscribing,
    transcript,
    error: voiceError,
    startRecording,
    stopRecording,
    resetTranscript,
  } = useVoiceChat()

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const scrollHeight = textareaRef.current.scrollHeight
      textareaRef.current.style.height = `${Math.min(scrollHeight, 200)}px`
    }
  }, [inputValue])

  // Optimistic updates for immediate UI feedback
  // Deduplicate messages: remove optimistic messages when real ones arrive with same content/timestamp
  // Filter out optimistic messages that have matching real messages
  const deduplicatedMessages: OptimisticMessage[] = messages
    .filter(msg => {
      // Keep all real messages (not temp IDs)
      if (!msg.id.startsWith('temp-')) return true
      
      // For optimistic messages, check if a real one exists with same content/time
      const hasRealMatch = messages.some(realMsg =>
        !realMsg.id.startsWith('temp-') &&
        realMsg.content === msg.content &&
        realMsg.role === msg.role &&
        Math.abs(
          new Date(realMsg.created_at).getTime() - 
          new Date(msg.created_at).getTime()
        ) < 10000 // 10 second window
      )
      return !hasRealMatch
    })
    .map(m => ({
      ...m,
      isOptimistic: m.id.startsWith('temp-')
    }))

  const [optimisticMessages, addOptimisticMessage] = useOptimistic(
    deduplicatedMessages,
    (state: OptimisticMessage[], newMessage: OptimisticMessage) => {
      // Filter out any existing optimistic messages with the same content/timestamp to prevent duplicates
      const filtered = state.filter(msg => 
        !(msg.isOptimistic && 
          msg.content === newMessage.content &&
          msg.role === newMessage.role &&
          Math.abs(new Date(msg.created_at).getTime() - new Date(newMessage.created_at).getTime()) < 5000)
      )
      return [...filtered, { ...newMessage, isOptimistic: true }]
    }
  )

  // Sync messages from database and remove optimistic duplicates
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const { data, error } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true })

        if (error) {
          console.error('Error loading messages:', error)
          return
        }

        if (data) {
          setMessages(prev => {
            // Merge real messages with existing optimistic ones
            // Remove optimistic messages that match real ones (same content, similar time)
            const realMessages = data.map(msg => ({
              ...msg,
              isOptimistic: false
            }))

            // Keep optimistic messages that don't have matching real messages yet
            const optimisticMessagesToKeep = prev
              .filter(msg => msg.id.startsWith('temp-'))
              .filter(optimisticMsg => {
                // Check if there's a real message with same content and similar timestamp
                const hasMatch = realMessages.some(realMsg =>
                  realMsg.content === optimisticMsg.content &&
                  realMsg.role === optimisticMsg.role &&
                  Math.abs(
                    new Date(realMsg.created_at).getTime() - 
                    new Date(optimisticMsg.created_at).getTime()
                  ) < 10000 // 10 second window
                )
                return !hasMatch
              })

            // Combine and deduplicate by content + timestamp
            const allMessages = [...realMessages, ...optimisticMessagesToKeep]
            const deduplicated = allMessages.filter((msg, index, self) => {
              return index === self.findIndex(m =>
                m.content === msg.content &&
                m.role === msg.role &&
                Math.abs(
                  new Date(m.created_at).getTime() - 
                  new Date(msg.created_at).getTime()
                ) < 1000 &&
                // Prefer real messages over optimistic ones
                (!msg.id.startsWith('temp-') || m.id.startsWith('temp-'))
              )
            })

            return deduplicated.sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
          })
        }
      } catch (err) {
        console.error('Error in loadMessages:', err)
      }
    }

    loadMessages()

    // Set up real-time subscription for new messages
    const channel = supabase
      .channel(`chat_messages:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          const newMessage = payload.new as ChatMessage
          setMessages(prev => {
            // Remove matching optimistic message if exists
            const filtered = prev.filter(msg =>
              !(msg.id.startsWith('temp-') &&
                msg.content === newMessage.content &&
                msg.role === newMessage.role &&
                Math.abs(
                  new Date(msg.created_at).getTime() - 
                  new Date(newMessage.created_at).getTime()
                ) < 10000)
            )
            return [...filtered, newMessage].sort((a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId])

  // Auto-scroll to bottom when optimistic messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [optimisticMessages])

  // Append transcript to input when it becomes available
  useEffect(() => {
    // Only run if we actually have text to append
    if (transcript && transcript.trim()) {
      console.log('[CopilotChat] Appending transcript:', transcript)
      
      setInputValue((prev) => {
        // Careful not to double-add if it's already there (optional check)
        const cleanPrev = prev.trim()
        const newValue = cleanPrev ? `${cleanPrev} ${transcript}` : transcript
        console.log('[CopilotChat] Input updated:', { prev: cleanPrev, newValue })
        return newValue
      })

      // Focus textarea so user can review/edit before sending
      if (textareaRef.current) {
        textareaRef.current.focus()
      }

      // CRITICAL: Clear the transcript immediately to prevent the infinite loop
      resetTranscript()
    }
  }, [transcript, resetTranscript])

  // Debug: Log state changes
  useEffect(() => {
    console.log('[CopilotChat] Voice state changed:', { isRecording, isTranscribing, hasTranscript: !!transcript, transcriptLength: transcript.length })
  }, [isRecording, isTranscribing, transcript])

  // Show error toast if transcription fails
  useEffect(() => {
    if (voiceError) {
      toast.error('Voice recording error', {
        description: voiceError,
      })
    }
  }, [voiceError])

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0 || !user) return

    setIsUploadingFile(true)
    try {
      const newFiles: AttachedFile[] = []

      for (const file of Array.from(files)) {
        // Validate file type
        const isImage = file.type.startsWith('image/')
        const isPDF = file.type === 'application/pdf'
        
        if (!isImage && !isPDF) {
          alert(`Unsupported file type: ${file.type}. Please upload images (PNG, JPG, etc.) or PDF files.`)
          continue
        }

        // Validate file size (max 100MB - Supabase bucket limit set in migration 032)
        const MAX_FILE_SIZE_MB = 100
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          toast.error(`File too large`, {
            description: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB. Max is ${MAX_FILE_SIZE_MB}MB. Compress with SmallPDF.com or split into smaller files.`,
            duration: 8000,
          })
          continue
        }

        // Create unique file path
        const timestamp = Date.now()
        const fileExt = file.name.split('.').pop() || 'bin'
        const fileName = `${user.id}/copilot/${projectId}/${timestamp}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
        
        // For large files (>6MB), use TUS resumable upload
        const LARGE_FILE_THRESHOLD = 6 * 1024 * 1024
        let uploadSuccess = false
        
        if (file.size > LARGE_FILE_THRESHOLD) {
          // Use TUS resumable upload for large files
          console.log(`[Upload] Large file detected (${(file.size / 1024 / 1024).toFixed(1)}MB), using TUS resumable upload`)
          
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
          const { data: { session } } = await supabase.auth.getSession()
          const accessToken = session?.access_token
          
          if (!accessToken) {
            alert('Authentication required for upload')
            continue
          }
          
          toast.info('Uploading large file...', { 
            description: 'This may take a moment.',
            duration: 10000,
          })

          try {
            await new Promise<void>((resolve, reject) => {
              const upload = new tus.Upload(file, {
                endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
                retryDelays: [0, 1000, 3000, 5000],
                headers: {
                  authorization: `Bearer ${accessToken}`,
                  'x-upsert': 'false',
                },
                uploadDataDuringCreation: true,
                removeFingerprintOnSuccess: true,
                metadata: {
                  bucketName: 'uploads',
                  objectName: fileName,
                  contentType: file.type,
                  cacheControl: '3600',
                },
                chunkSize: 6 * 1024 * 1024, // 6MB chunks
                onError: (error) => {
                  console.error('[TUS Upload] Error:', error)
                  reject(new Error(`Upload failed: ${error.message}`))
                },
                onProgress: (bytesUploaded, bytesTotal) => {
                  const percentage = Math.round((bytesUploaded / bytesTotal) * 100)
                  console.log(`[TUS Upload] Progress: ${percentage}%`)
                },
                onSuccess: () => {
                  console.log('[TUS Upload] Success!')
                  resolve()
                },
              })

              upload.findPreviousUploads().then((previousUploads) => {
                if (previousUploads.length > 0) {
                  console.log('[TUS Upload] Resuming previous upload...')
                  upload.resumeFromPreviousUpload(previousUploads[0])
                }
                upload.start()
              })
            })
            
            uploadSuccess = true
          } catch (tusError) {
            console.error('TUS upload error:', tusError)
            alert(`Failed to upload ${file.name}: ${tusError instanceof Error ? tusError.message : 'Unknown error'}`)
            continue
          }
        } else {
          // Standard upload for smaller files
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(fileName, file, {
              contentType: file.type,
              upsert: false
            })

          if (uploadError) {
            console.error('Upload error:', uploadError)
            alert(`Failed to upload ${file.name}: ${uploadError.message}`)
            continue
          }
          
          uploadSuccess = true
        }
        
        if (!uploadSuccess) continue

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('uploads')
          .getPublicUrl(fileName)

        newFiles.push({
          id: `file-${timestamp}-${file.name}`,
          name: file.name,
          type: isImage ? 'image' : 'pdf',
          url: publicUrl,
          storagePath: fileName
        })
      }

      setAttachedFiles(prev => [...prev, ...newFiles])

      // Immediately surface the upload in the chat UI so users see it without reload
      if (newFiles.length > 0) {
        const now = new Date().toISOString()
        const fileNames = newFiles.map(f => f.name).join(', ')
        const uploadMessage: ChatMessage = {
          id: `upload-${Date.now()}`,
          project_id: projectId,
          role: 'system',
          content: `Attached file${newFiles.length > 1 ? 's' : ''}: ${fileNames}`,
          related_action: null,
          created_at: now
        }
        setMessages(prev => [...prev, uploadMessage])
      }
    } catch (error) {
      console.error('File upload error:', error)
      alert('Failed to upload files. Please try again.')
    } finally {
      setIsUploadingFile(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleRemoveFile = (fileId: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const handleSend = async () => {
    const content = inputValue.trim()
    const hasFiles = attachedFiles.length > 0
    
    if ((!content && !hasFiles) || isSubmitting || isPending) return

    // Get file URLs
    const fileUrls = attachedFiles.map(f => f.storagePath)

    // Clear input and files first
    const messageContent = content || (hasFiles ? `[${attachedFiles.length} file(s) attached]` : '')
    setInputValue('')
    setAttachedFiles([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    // Create optimistic message with UUID to prevent collisions
    const optimisticId = crypto.randomUUID()
    const optimisticMsg: OptimisticMessage = {
      id: `temp-${optimisticId}`,
      role: 'user',
      content: messageContent,
      created_at: new Date().toISOString(),
      isOptimistic: true,
      optimisticId: optimisticId // Store separately for deduplication
    }
    
    // Add optimistic message within a transition (required by React 19)
    startTransition(() => {
      addOptimisticMessage(optimisticMsg)
    })

    // Also update the actual messages state for consistency
    // Use the optimistic ID to track this message for deduplication
    const newMessage: ChatMessage = {
      id: optimisticMsg.id,
      project_id: projectId,
      role: 'user',
      content: messageContent,
      related_action: null,
      created_at: optimisticMsg.created_at
    }
    
    setMessages(prev => {
      // Remove any duplicate optimistic messages before adding new one
      const filtered = prev.filter(m => 
        !(m.content === messageContent && 
          Math.abs(new Date(m.created_at).getTime() - new Date(newMessage.created_at).getTime()) < 5000 &&
          m.id.startsWith('temp-'))
      )
      return [...filtered, newMessage]
    })

    // Send message
    setIsSubmitting(true)
    try {
      if (onSendMessage) {
        const result = await onSendMessage(messageContent, fileUrls.length > 0 ? fileUrls : undefined)
        
        // IMMEDIATE UI UPDATE: Add assistant's response to messages immediately
        if (result && typeof result === 'object' && 'response_text' in result) {
          const responseData = result as { response_text: string; actions?: any[] }
          console.log('[CopilotChat] Adding assistant response immediately:', responseData.response_text)
          const assistantMessage: ChatMessage = {
            id: `temp-assistant-${Date.now()}`,
            project_id: projectId,
            role: 'assistant',
            content: responseData.response_text,
            related_action: responseData.actions ? JSON.stringify(responseData.actions) : null,
            created_at: new Date().toISOString()
          }
          
          setMessages(prev => {
            // Remove any duplicate optimistic assistant messages
            const filtered = prev.filter(m => 
              !(m.role === 'assistant' && 
                m.id.startsWith('temp-assistant-') &&
                Math.abs(new Date(m.created_at).getTime() - new Date(assistantMessage.created_at).getTime()) < 5000)
            )
            return [...filtered, assistantMessage]
          })

          // Refresh server components to update Estimates tab and other dashboard data
          startTransition(() => {
            router.refresh()
          })

          // Dispatch global event to trigger client-side data refresh
          // Add a small delay to ensure database transaction has committed
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('estimate-updated'))
            console.log('[CopilotChat] Dispatched estimate-updated event')
          }, 500)
        }
        
        // After successful send, the parent should update messages via props
        // The optimistic message will be replaced with the real one when messages update
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      // Remove the optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id))
      
      // Show user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message'
      const errorCode = (error as any)?.code
      
      // Handle specific error codes
      if (errorCode === 'SCANNED_PDF') {
        toast.error('Scanned PDF Detected', {
          description: 'This PDF appears to be a scanned image. Please paste the text manually or use an OCR tool.',
          duration: 8000,
        })
      } else if (errorCode === 'FILE_TOO_LARGE') {
        toast.error('File Too Large', {
          description: 'The file exceeds the 100MB limit. Please use a smaller file.',
        })
      } else if (errorCode === 'DOWNLOAD_ERROR' || errorCode === 'PARSE_ERROR') {
        toast.error('File Processing Error', {
          description: errorMessage,
        })
      } else {
        toast.error('Failed to send message', {
          description: errorMessage,
        })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={cn('flex flex-col h-full bg-white border-l border-border', className)}>
      {/* Header */}
      <div className="border-b border-border px-4 py-3 bg-background">
        <h2 className="text-lg font-semibold">Estimatix Copilot</h2>
        <p className="text-sm text-muted-foreground">AI-powered assistant for your project</p>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {optimisticMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <div className="mb-4 p-4 rounded-full bg-secondary/50">
              <Mic className="h-8 w-8" />
            </div>
            <p className="text-sm font-medium mb-1">Start a conversation</p>
            <p className="text-xs">Ask questions, add line items, or update your project</p>
          </div>
        ) : (
          <>
            {optimisticMessages.map((message, index) => {
              // Filter out duplicate optimistic messages
              // Check if there's a real message (non-optimistic) with same content and role
              const hasRealMessageMatch = optimisticMessages.some(msg =>
                !msg.isOptimistic &&
                msg.id !== message.id &&
                msg.content === message.content &&
                msg.role === message.role &&
                Math.abs(new Date(msg.created_at).getTime() - new Date(message.created_at).getTime()) < 10000
              )
              
              // Also check for duplicate optimistic messages in the same array
              const isDuplicateOptimistic = message.isOptimistic && optimisticMessages
                .slice(0, index)
                .some(prevMsg => 
                  prevMsg.isOptimistic &&
                  prevMsg.content === message.content &&
                  prevMsg.role === message.role &&
                  Math.abs(new Date(prevMsg.created_at).getTime() - new Date(message.created_at).getTime()) < 1000
                )
              
              // Don't render if it's an optimistic message that has a real match OR is a duplicate
              if (message.isOptimistic && (hasRealMessageMatch || isDuplicateOptimistic)) {
                return null
              }

              // Generate truly unique key using crypto.randomUUID if available, or fallback
              const uniqueKey = message.isOptimistic 
                ? `${message.id}-${message.optimisticId || crypto.randomUUID?.() || Date.now()}-${index}`
                : message.id

              return (
              <div
                key={uniqueKey}
                className={cn(
                  'flex',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-4 py-2',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : message.role === 'system'
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-secondary text-secondary-foreground',
                    message.isOptimistic && 'opacity-70'
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                  <p className="text-xs mt-1 opacity-70">
                    {new Date(message.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>
              )
            })}
            {isSubmitting && optimisticMessages[optimisticMessages.length - 1]?.role === 'user' && (
              <div className="flex justify-start">
                <div className="bg-secondary text-secondary-foreground rounded-lg px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-border p-4 bg-background">
        {/* Attached Files */}
        {attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachedFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-md text-sm"
              >
                {file.type === 'image' ? (
                  <FileImage className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="max-w-[150px] truncate">{file.name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleRemoveFile(file.id)}
                  className="h-5 w-5 p-0"
                  disabled={isSubmitting}
                >
                  <X className="h-3 w-3" />
                  <span className="sr-only">Remove file</span>
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question or describe work to add..."
              className="min-h-[44px] max-h-[200px] resize-none pr-12"
              disabled={isSubmitting || isUploadingFile}
            />
            <div className="absolute bottom-2 right-2 flex gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 w-8"
                disabled={isSubmitting || isUploadingFile}
              >
                {isUploadingFile ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
                <span className="sr-only">Attach file</span>
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={async (e) => {
              e.preventDefault()
              e.stopPropagation()
              
              console.log('[CopilotChat] Mic button clicked', { isRecording, isTranscribing })
              
              try {
                if (isRecording) {
                  console.log('[CopilotChat] Calling stopRecording...')
                  await stopRecording()
                  console.log('[CopilotChat] stopRecording completed')
                } else {
                  console.log('[CopilotChat] Calling startRecording...')
                  await startRecording()
                  console.log('[CopilotChat] startRecording completed, isRecording should be true')
                }
              } catch (error) {
                console.error('[CopilotChat] Recording error:', error)
                toast.error('Failed to start recording. Please check your microphone permissions.')
              }
            }}
            className={cn(
              'h-11 w-11 shrink-0',
              isRecording && 'bg-destructive text-destructive-foreground animate-pulse',
              isTranscribing && 'opacity-50'
            )}
            disabled={isSubmitting || isUploadingFile || isTranscribing}
          >
            {/* Always render the same button structure, just change icon/style */}
            {isTranscribing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isRecording ? (
              <Square className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
            <span className="sr-only">
              {isTranscribing ? 'Transcribing...' : isRecording ? 'Stop recording' : 'Voice input'}
            </span>
          </Button>
          <Button
            onClick={handleSend}
            disabled={(!inputValue.trim() && attachedFiles.length === 0) || isSubmitting || isPending || isUploadingFile}
            className="h-11 px-4 shrink-0"
            size="default"
          >
            {(isSubmitting || isPending) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="sr-only">Send</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line. Attach images or PDFs to analyze.
        </p>
      </div>
    </div>
  )
}

