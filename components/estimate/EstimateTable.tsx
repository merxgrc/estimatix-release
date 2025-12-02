'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Save, AlertTriangle, Plus, Trash2, FileText, Download, BookOpen, Wrench, Edit, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { SmartRoomInput } from './SmartRoomInput'

// Cost code categories with display format "201 - Demo"
const COST_CATEGORIES = [
  { label: "201 - Demo", code: "201" },
  { label: "305 - Framing", code: "305" },
  { label: "404 - Plumbing", code: "404" },
  { label: "405 - Electrical", code: "405" },
  { label: "402 - HVAC", code: "402" },
  { label: "520 - Windows", code: "520" },
  { label: "530 - Doors", code: "530" },
  { label: "640 - Cabinets", code: "640" },
  { label: "641 - Countertops", code: "641" },
  { label: "950 - Tile", code: "950" },
  { label: "960 - Flooring", code: "960" },
  { label: "990 - Paint", code: "990" },
  { label: "999 - Other", code: "999" }
]

// Unit options
const UNIT_OPTIONS = ['EA', 'SF', 'LF', 'SQ', 'ROOM']

// Room options
const ROOM_OPTIONS = [
  "Primary Bedroom", "Primary Bath",
  "Bedroom 1", "Bath 1",
  "Bedroom 2", "Bath 2",
  "Bedroom 3", "Bath 3",
  "Guest Bedroom", "Guest Bath",
  "Powder", "Kitchen", "Pantry",
  "Living/Family", "Dining",
  "Mudroom", "Pool Bath",
  "Bar", "Garage"
]

interface LineItem {
  id?: string
  room_name: string
  description: string
  category: string
  cost_code: string
  quantity: number
  unit: string
  labor_cost: number
  material_cost?: number
  overhead_cost?: number
  direct_cost?: number
  margin_percent: number
  client_price: number
  pricing_source?: 'task_library' | 'user_library' | 'manual' | null
  confidence?: number | null
}

interface EstimateData {
  items: LineItem[]
  assumptions?: string[]
  missing_info?: string[]
}

interface EstimateTableProps {
  projectId?: string | null
  estimateId?: string | null
  initialData?: EstimateData
  onSave?: (estimateId: string, total: number) => void
  projectMetadata?: {
    projectName: string
    clientName: string
    clientAddress: string
    projectDescription: string
  }
}

export function EstimateTable({ projectId, estimateId, initialData, onSave, projectMetadata }: EstimateTableProps) {
  const [items, setItems] = useState<LineItem[]>([])
  const [missingInfo, setMissingInfo] = useState<string[]>(initialData?.missing_info || [])
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false)
  const [proposalUrl, setProposalUrl] = useState<string | null>(null)
  const [blockedActionMessage, setBlockedActionMessage] = useState<string | null>(null)
  const { user } = useAuth()
  const saveTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const itemsRef = useRef<LineItem[]>([])
  // Track original AI values for reset functionality
  const originalValuesRef = useRef<Map<string, Partial<LineItem>>>(new Map())

  // Load line items from database on mount
  useEffect(() => {
    const loadLineItems = async () => {
      if (estimateId && projectId) {
        try {
          const { data, error } = await supabase
            .from('estimate_line_items')
            .select('*')
            .eq('estimate_id', estimateId)
            .order('created_at', { ascending: true })

          if (error) {
            console.error('Error loading line items:', error)
            // Fallback to initialData if database load fails - preserve room_name
            if (initialData?.items) {
              setItems(initialData.items.map((item, idx) => ({
                id: `temp-${idx}`,
                room_name: (item as any).room_name || '', // Preserve room_name from initialData
                description: item.description || '',
                category: item.category || 'Other (999)',
                cost_code: '999',
                labor_cost: (item as any).labor_cost || 0,
                margin_percent: (item as any).margin_percent || 30,
                client_price: (item as any).client_price || 0
              })))
            }
            return
          }

          if (data && data.length > 0) {
            // Load from database - preserve room_name from database
            const loadedItems = data.map(item => ({
              id: item.id,
              room_name: item.room_name || '', // Preserve room_name from database
              description: item.description || '',
              category: item.category || COST_CATEGORIES.find(c => c.code === item.cost_code)?.label || 'Other (999)',
              cost_code: item.cost_code || '999',
              quantity: item.quantity || 1,
              unit: item.unit || 'EA',
              labor_cost: item.labor_cost || 0,
              material_cost: item.material_cost || 0,
              overhead_cost: item.overhead_cost || 0,
              direct_cost: item.direct_cost || 0,
              margin_percent: item.margin_percent || 30,
              client_price: item.client_price || 0,
              pricing_source: item.pricing_source || null,
              confidence: item.confidence ?? null
            }))
            setItems(loadedItems)
            
            // Store original values for reset functionality (only if from AI pricing)
            loadedItems.forEach(item => {
              if (item.id && (item.pricing_source === 'task_library' || item.pricing_source === 'user_library')) {
                originalValuesRef.current.set(item.id, {
                  labor_cost: item.labor_cost,
                  material_cost: item.material_cost,
                  overhead_cost: item.overhead_cost,
                  direct_cost: item.direct_cost,
                  margin_percent: item.margin_percent,
                  client_price: item.client_price,
                  pricing_source: item.pricing_source
                } as Partial<LineItem>)
              }
            })
          } else if (initialData?.items) {
            // Fallback to initialData - preserve room_name from initialData
            setItems(initialData.items.map((item, idx) => ({
              id: `temp-${idx}`,
              room_name: (item as any).room_name || '', // Preserve room_name from initialData
              description: item.description || '',
              category: item.category || 'Other (999)',
              cost_code: '999',
              quantity: (item as any).quantity || 1,
              unit: (item as any).unit || 'EA',
              labor_cost: (item as any).labor_cost || 0,
              material_cost: (item as any).material_cost || 0,
              overhead_cost: (item as any).overhead_cost || 0,
              direct_cost: (item as any).direct_cost || 0,
              margin_percent: (item as any).margin_percent || 30,
              client_price: (item as any).client_price || 0,
              pricing_source: (item as any).pricing_source || null,
              confidence: (item as any).confidence ?? null
            })))
          }
        } catch (err) {
          console.error('Error in loadLineItems:', err)
        }
      } else if (initialData?.items) {
        // Use initialData if no estimateId - preserve room_name from initialData
        setItems(initialData.items.map((item, idx) => ({
          id: `temp-${idx}`,
          room_name: (item as any).room_name || '', // Preserve room_name from initialData
          description: item.description || '',
          category: item.category || 'Other (999)',
          cost_code: '999',
          quantity: (item as any).quantity || 1,
          unit: (item as any).unit || 'EA',
          labor_cost: (item as any).labor_cost || 0,
          material_cost: (item as any).material_cost || 0,
          overhead_cost: (item as any).overhead_cost || 0,
          direct_cost: (item as any).direct_cost || 0,
          margin_percent: (item as any).margin_percent || 30,
          client_price: (item as any).client_price || 0,
          pricing_source: (item as any).pricing_source || null,
          confidence: (item as any).confidence ?? null
        })))
      }
    }

    loadLineItems()
  }, [estimateId, projectId, initialData])

  // Update items when initialData changes
  useEffect(() => {
    if (initialData) {
      setMissingInfo(initialData.missing_info || [])
    }
  }, [initialData])

  // Keep itemsRef in sync with items state
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Save individual line item to database (debounced)
  const saveLineItem = async (itemId: string | undefined, item: LineItem) => {
    if (!itemId || !estimateId || !projectId) return

    // Clear existing timeout for this item
    const existingTimeout = saveTimeoutRef.current.get(itemId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Set new timeout for debounced save
    const timeout = setTimeout(async () => {
      try {
        const updateData: any = {
          room_name: item.room_name || null,
          description: item.description || null,
          category: item.category || null,
          cost_code: item.cost_code || null,
          quantity: item.quantity || 1,
          unit: item.unit || 'EA',
          labor_cost: item.labor_cost || 0,
          material_cost: item.material_cost || 0,
          overhead_cost: item.overhead_cost || 0,
          direct_cost: item.direct_cost || 0,
          margin_percent: item.margin_percent || 30,
          client_price: item.client_price || 0,
          pricing_source: item.pricing_source || null, // Preserve existing source (manual if user edited, otherwise original)
          confidence: item.confidence ?? null
        }

        const { error } = await supabase
          .from('estimate_line_items')
          .update(updateData)
          .eq('id', itemId)

        if (error) {
          console.error(`Error saving line item ${itemId}:`, error)
        }
      } catch (err) {
        console.error(`Error in saveLineItem for ${itemId}:`, err)
      } finally {
        saveTimeoutRef.current.delete(itemId)
      }
    }, 1000) // 1 second debounce

    saveTimeoutRef.current.set(itemId, timeout)
  }

  // Recalculate pricing when margin changes
  const recalculateMargin = async (itemId: string, margin: number) => {
    if (!itemId) return

    try {
      const response = await fetch(`/api/pricing/recalculate/${itemId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ margin }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('Error recalculating margin:', errorData)
        return
      }

      const result = await response.json()

      // Update the item in state with new values
      setItems(prevItems => {
        const newItems = [...prevItems]
        const index = newItems.findIndex(item => item.id === itemId)
        if (index !== -1) {
          newItems[index] = {
            ...newItems[index],
            margin_percent: result.margin_percent,
            overhead_cost: result.overhead_cost,
            direct_cost: result.direct_cost,
            client_price: result.client_price
          }
        }
        return newItems
      })
    } catch (err) {
      console.error('Error in recalculateMargin:', err)
    }
  }

  // Validate numeric input (0-1M)
  const validateNumeric = (value: string): number => {
    const num = parseFloat(value) || 0
    if (num < 0) return 0
    if (num > 1000000) return 1000000
    return num
  }

  // Reset cost fields to original AI values
  const resetToAI = (itemId: string, globalIndex: number) => {
    const original = originalValuesRef.current.get(itemId)
    if (!original) return

    setItems(prevItems => {
      const newItems = [...prevItems]
      const item = { ...newItems[globalIndex] }
      
      // Restore original values
      if (original.labor_cost !== undefined) item.labor_cost = original.labor_cost as number
      if (original.material_cost !== undefined) item.material_cost = original.material_cost as number
      if (original.overhead_cost !== undefined) item.overhead_cost = original.overhead_cost as number
      if (original.direct_cost !== undefined) item.direct_cost = original.direct_cost as number
      if (original.margin_percent !== undefined) item.margin_percent = original.margin_percent as number
      if (original.client_price !== undefined) item.client_price = original.client_price as number
      
      // Restore pricing_source if it was from AI
      if (original.pricing_source) {
        item.pricing_source = original.pricing_source as 'task_library' | 'user_library' | 'manual'
      }
      
      newItems[globalIndex] = item
      itemsRef.current = newItems
      
      // Save immediately
      if (item.id) {
        saveLineItem(item.id, item)
      }
      
      return newItems
    })
  }

  // Auto-calculate client_price when labor_cost, margin_percent, quantity, or unit changes
  const updateItem = (index: number, updates: Partial<LineItem>, immediateSave = false) => {
    setItems(prevItems => {
      const newItems = [...prevItems]
      const item = { ...newItems[index] }
      
      // Apply updates
      Object.assign(item, updates)
      
      // Mark as manual if user edits cost fields
      if (updates.labor_cost !== undefined || updates.material_cost !== undefined || 
          updates.overhead_cost !== undefined || updates.direct_cost !== undefined || 
          updates.client_price !== undefined) {
        item.pricing_source = 'manual'
      }
      
      // Auto-calculate client_price if labor_cost, margin_percent, quantity, or unit changed
      // But only if client_price wasn't manually edited and item is not manually overridden
      if ((updates.labor_cost !== undefined || updates.margin_percent !== undefined || 
          updates.quantity !== undefined || updates.unit !== undefined) &&
          updates.client_price === undefined && item.pricing_source !== 'manual') {
        const laborCost = updates.labor_cost !== undefined ? updates.labor_cost : item.labor_cost
        const marginPercent = updates.margin_percent !== undefined ? updates.margin_percent : item.margin_percent
        const quantity = updates.quantity !== undefined ? updates.quantity : (item.quantity || 1)
        
        // Calculate: client_price = (labor_cost * quantity) * (1 + margin/100)
        item.client_price = Number(laborCost) * Number(quantity) * (1 + Number(marginPercent) / 100)
      }
      
      newItems[index] = item
      
      // Update ref with latest items
      itemsRef.current = newItems
      
      // Trigger save (debounced unless immediate)
      if (item.id) {
        if (immediateSave) {
          // Clear existing timeout and save immediately
          const existingTimeout = saveTimeoutRef.current.get(item.id)
          if (existingTimeout) {
            clearTimeout(existingTimeout)
            saveTimeoutRef.current.delete(item.id)
          }
          saveLineItem(item.id, item)
        } else {
          saveLineItem(item.id, item)
        }
      }
      
      return newItems
    })
  }

  const addItem = () => {
    setItems(prevItems => [
      ...prevItems,
      {
        room_name: '',
        description: '',
        category: '999 - Other',
        cost_code: '999',
        quantity: 1,
        unit: 'EA',
        labor_cost: 0,
        material_cost: 0,
        overhead_cost: 0,
        direct_cost: 0,
        margin_percent: 30,
        client_price: 0,
        pricing_source: 'manual' as const,
        confidence: null
      }
    ])
  }

  const removeItem = (index: number) => {
    setItems(prevItems => prevItems.filter((_, i) => i !== index))
  }

  const grandTotal = items.reduce((sum, item) => sum + (item.client_price || 0), 0)

  // Auto-expanding textarea component
  const AutoExpandingTextarea = ({ 
    value, 
    onChange, 
    onBlur,
    placeholder 
  }: { 
    value: string
    onChange: (value: string) => void
    onBlur?: () => void
    placeholder?: string 
  }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    // Use internal state to prevent re-render issues on every keystroke
    const [internalValue, setInternalValue] = useState(value)
    const isFocusedRef = useRef(false)

    // Sync internal value when prop value changes (but only if textarea is not focused)
    useEffect(() => {
      if (!isFocusedRef.current && value !== internalValue) {
        setInternalValue(value)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setInternalValue(newValue)
      // Auto-expand height
      const textarea = e.currentTarget
      textarea.style.height = 'auto'
      textarea.style.height = textarea.scrollHeight + 'px'
    }

    const handleFocus = () => {
      isFocusedRef.current = true
    }

    const handleBlur = () => {
      isFocusedRef.current = false
      // Only update parent state on blur
      if (internalValue !== value) {
        onChange(internalValue)
      }
      onBlur?.()
    }

    // Auto-expand on mount and when value changes externally
    useEffect(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
      }
    }, [internalValue])

    return (
      <textarea
        ref={textareaRef}
        value={internalValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded resize-none overflow-hidden min-h-[120px]"
        rows={3}
      />
    )
  }

  const saveEstimate = async () => {
    const hasItems = items.length > 0

    if (!hasItems) {
      setBlockedActionMessage('Create an estimate first by using the record feature or by adding line items manually.')
      setTimeout(() => setBlockedActionMessage(null), 5000)
      return
    }

    if (!user) {
      setError('User not authenticated')
      return
    }

    if (!projectId) {
      setError('Project ID is required')
      return
    }

    setIsSaving(true)
    setError(null)
    setSaveSuccess(false)

    try {
      let currentEstimateId = estimateId

      // Ensure we have an estimate record first
      if (!currentEstimateId) {
        const estimateData: any = {
          project_id: projectId,
          json_data: {
            items: items,
            assumptions: initialData?.assumptions || [],
            missing_info: missingInfo
          },
          total: grandTotal,
          ai_summary: `Estimate with ${items.length} line items`
        }

        const { data: newEstimate, error: insertError } = await supabase
          .from('estimates')
          .insert(estimateData)
          .select()
          .single()

        if (insertError) {
          throw new Error(`Failed to create estimate: ${insertError.message}`)
        }

        currentEstimateId = newEstimate.id
      } else {
        // Update existing estimate
        const { error: updateError } = await supabase
          .from('estimates')
          .update({
            json_data: {
              items: items,
              assumptions: initialData?.assumptions || [],
              missing_info: missingInfo
            },
            total: grandTotal,
            ai_summary: `Updated estimate with ${items.length} line items`
          })
          .eq('id', currentEstimateId)

        if (updateError) {
          throw new Error(`Failed to update estimate: ${updateError.message}`)
        }
      }

      // Upsert line items into estimate_line_items table
      const lineItemsToSave = items.map(item => {
        const categoryInfo = COST_CATEGORIES.find(c => c.code === item.cost_code) || COST_CATEGORIES[COST_CATEGORIES.length - 1]
        
        return {
          ...(item.id && !item.id.startsWith('temp-') ? { id: item.id } : {}),
          estimate_id: currentEstimateId,
          project_id: projectId,
          room_name: item.room_name || null,
          description: item.description || null,
          category: categoryInfo.label,
          cost_code: item.cost_code,
          quantity: item.quantity || 1,
          unit: item.unit || 'EA',
          labor_cost: item.labor_cost || 0,
          material_cost: item.material_cost || 0,
          overhead_cost: item.overhead_cost || 0,
          direct_cost: item.direct_cost || 0,
          margin_percent: item.margin_percent || 30,
          client_price: item.client_price || 0,
          pricing_source: item.pricing_source || null,
          confidence: item.confidence ?? null
        }
      })

      // Delete existing line items for this estimate, then insert new ones
      // (Simpler than trying to match which ones to update/delete)
      const { error: deleteError } = await supabase
        .from('estimate_line_items')
        .delete()
        .eq('estimate_id', currentEstimateId)

      if (deleteError) {
        console.warn('Error deleting old line items:', deleteError)
        // Continue anyway - upsert will handle duplicates
      }

      const { error: upsertError } = await supabase
        .from('estimate_line_items')
        .insert(lineItemsToSave)
        .select()

      if (upsertError) {
        throw new Error(`Failed to save line items: ${upsertError.message}`)
      }

      // Reload items with their IDs from database
      const { data: savedItems } = await supabase
        .from('estimate_line_items')
        .select('*')
        .eq('estimate_id', currentEstimateId)
        .order('created_at', { ascending: true })

      if (savedItems) {
        setItems(savedItems.map(item => ({
          id: item.id,
          room_name: item.room_name || '',
          description: item.description || '',
          category: item.category || COST_CATEGORIES.find(c => c.code === item.cost_code)?.label || 'Other (999)',
          cost_code: item.cost_code || '999',
          labor_cost: item.labor_cost || 0,
          margin_percent: item.margin_percent || 30,
          client_price: item.client_price || 0
        })))
      }

      setSaveSuccess(true)
      onSave?.(currentEstimateId, grandTotal)

    } catch (err) {
      console.error('Save estimate error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save estimate')
    } finally {
      setIsSaving(false)
    }
  }

  const generateProposal = async () => {
    const hasItems = items.length > 0

    if (!hasItems) {
      setBlockedActionMessage('Create an estimate first by using the record feature or by adding line items manually.')
      setTimeout(() => setBlockedActionMessage(null), 5000)
      return
    }

    const currentEstimateId = estimateId
    if (!currentEstimateId) {
      setBlockedActionMessage('Please save the estimate first before generating a proposal.')
      setTimeout(() => setBlockedActionMessage(null), 5000)
      return
    }

    setIsGeneratingProposal(true)
    setError(null)
    setProposalUrl(null)

    try {
      const response = await fetch(`/api/proposals/${currentEstimateId}/pdf`, {
        method: 'GET',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to generate proposal: ${response.status}`)
      }

      const data = await response.json()
      setProposalUrl(data.url)
    } catch (err) {
      console.error('Generate proposal error:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate proposal')
    } finally {
      setIsGeneratingProposal(false)
    }
  }

  // Group items by cost_code (trade) then by room_name for display
  const groupedItems = items.reduce((acc, item, index) => {
    const costCode = item.cost_code || '999'
    const roomName = item.room_name || 'General'
    
    if (!acc[costCode]) {
      acc[costCode] = {}
    }
    if (!acc[costCode][roomName]) {
      acc[costCode][roomName] = []
    }
    
    // Preserve original index for updateItem calls
    acc[costCode][roomName].push({ ...item, _originalIndex: index })
    return acc
  }, {} as Record<string, Record<string, Array<LineItem & { _originalIndex: number }>>>)

  // Get sorted cost codes for display
  const sortedCostCodes = Object.keys(groupedItems).sort((a, b) => {
    const aInfo = COST_CATEGORIES.find(c => c.code === a)
    const bInfo = COST_CATEGORIES.find(c => c.code === b)
    return (aInfo?.label || a).localeCompare(bInfo?.label || b)
  })

  const hasItems = items.length > 0

  return (
    <div className="space-y-6">
      {/* Blocked Action Message */}
      {blockedActionMessage && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            {blockedActionMessage}
          </AlertDescription>
        </Alert>
      )}

      {/* Missing Info Banner */}
      {missingInfo.length > 0 && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            <strong>Missing Information:</strong> {missingInfo.join(', ')}
          </AlertDescription>
        </Alert>
      )}

      {/* Estimate Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Project Estimate</CardTitle>
              <CardDescription>
                {items.length} line items • Total: ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={addItem} variant="outline" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
              <Button 
                onClick={generateProposal} 
                disabled={isGeneratingProposal}
                variant="outline"
                size="sm"
              >
                {isGeneratingProposal ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileText className="mr-2 h-4 w-4" />
                    Generate Proposal
                  </>
                )}
              </Button>
              <Button 
                onClick={saveEstimate} 
                disabled={isSaving}
                className="bg-green-600 hover:bg-green-700"
              >
                {isSaving ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Estimate
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert className="mb-4 border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">{error}</AlertDescription>
            </Alert>
          )}

          {saveSuccess && (
            <Alert className="mb-4 border-green-200 bg-green-50">
              <AlertDescription className="text-green-800">
                ✓ Estimate saved successfully!
              </AlertDescription>
            </Alert>
          )}

          {proposalUrl && (
            <Alert className="mb-4 border-blue-200 bg-blue-50">
              <AlertDescription className="text-blue-800 flex items-center justify-between">
                <span>✓ Proposal generated successfully!</span>
                <Button
                  onClick={() => window.open(proposalUrl, '_blank')}
                  variant="outline"
                  size="sm"
                  className="ml-4"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No items yet. Click "Add Item" to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room</TableHead>
                    <TableHead>Cost Code</TableHead>
                    <TableHead>Qty / Unit</TableHead>
                    <TableHead className="text-right">Labor</TableHead>
                    <TableHead className="text-right">Materials</TableHead>
                    <TableHead className="text-right">OH</TableHead>
                    <TableHead className="text-right">Direct</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                    <TableHead className="text-right">Client Price</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Conf.</TableHead>
                    <TableHead className="w-12">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCostCodes.map((costCode) => {
                    const costInfo = COST_CATEGORIES.find(c => c.code === costCode)
                    const tradeLabel = costInfo?.label || `Other (${costCode})`
                    // Extract just the trade name (remove "201 - " prefix)
                    const tradeName = tradeLabel.includes(' - ') 
                      ? tradeLabel.split(' - ')[1] 
                      : tradeLabel.replace(`(${costCode})`, '').trim()
                    const rooms = Object.keys(groupedItems[costCode]).sort()
                    
                    return (
                      <React.Fragment key={costCode}>
                        {/* Trade Header Row */}
                        <TableRow className="bg-muted/50">
                          <TableCell colSpan={12} className="font-bold text-base py-3">
                            {tradeName}
                          </TableCell>
                        </TableRow>
                        
                        {rooms.map((roomName) => {
                          const roomItems = groupedItems[costCode][roomName]
                          
                          return (
                            <React.Fragment key={`${costCode}-${roomName}`}>
                              {/* Room Subheader Row */}
                              {roomName && roomName !== 'General' && (
                                <TableRow className="bg-muted/30">
                                  <TableCell colSpan={12} className="font-semibold text-sm py-2 pl-8">
                                    {roomName}
                                  </TableCell>
                                </TableRow>
                              )}
                              
                              {/* Items for this room */}
                              {roomItems.map((item, roomItemIndex) => {
                                const globalIndex = item._originalIndex
                                
                                return (
                                  <React.Fragment key={item.id || `${costCode}-${roomName}-${roomItemIndex}`}>
                                    {/* Main row: Room, Cost Code, Qty/Unit, Pricing Grid, Source, Conf, Actions */}
                                    <TableRow>
                                      <TableCell className="align-top">
                                        <div className="min-w-[150px]">
                                          <SmartRoomInput
                                            value={item.room_name || ''}
                                            onChange={(value) => updateItem(globalIndex, { room_name: value })}
                                            onBlur={() => {
                                              if (item.id) {
                                                saveLineItem(item.id, items[globalIndex])
                                              }
                                            }}
                                            placeholder="Select or type room name"
                                            options={ROOM_OPTIONS}
                                          />
                                        </div>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <Select
                                          value={item.cost_code}
                                          onValueChange={(value) => {
                                            const selected = COST_CATEGORIES.find(c => c.code === value)
                                            updateItem(globalIndex, {
                                              cost_code: selected?.code || '999',
                                              category: selected?.label || '999 - Other'
                                            })
                                          }}
                                        >
                                          <SelectTrigger className="w-[150px]">
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {COST_CATEGORIES.map(({ label, code }) => (
                                              <SelectItem key={code} value={code}>{label}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <div className="flex items-center gap-2 min-w-[120px]">
                                          <Input
                                            type="number"
                                            value={item.quantity || 1}
                                            onChange={(e) => {
                                              const qty = Number(e.target.value) || 1
                                              updateItem(globalIndex, { quantity: qty })
                                            }}
                                            onBlur={() => {
                                              const currentItem = itemsRef.current[globalIndex]
                                              if (currentItem?.id) {
                                                updateItem(globalIndex, {}, true)
                                              }
                                            }}
                                            className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            min="0"
                                            step="0.01"
                                            placeholder="1"
                                          />
                                          <Select
                                            value={item.unit || 'EA'}
                                            onValueChange={(value) => {
                                              updateItem(globalIndex, { unit: value })
                                            }}
                                          >
                                            <SelectTrigger className="w-[80px]">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {UNIT_OPTIONS.map(unit => (
                                                <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <div className="flex items-center gap-1 min-w-[90px]">
                                          <span className="text-sm text-muted-foreground">$</span>
                                          <Input
                                            type="number"
                                            value={item.labor_cost || 0}
                                            onChange={(e) => {
                                              const value = validateNumeric(e.target.value)
                                              updateItem(globalIndex, { labor_cost: value })
                                            }}
                                            onBlur={() => {
                                              const currentItem = itemsRef.current[globalIndex]
                                              if (currentItem?.id) {
                                                saveLineItem(currentItem.id, currentItem)
                                              }
                                            }}
                                            className="w-20 h-8 text-sm text-right pr-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            min="0"
                                            max="1000000"
                                            step="0.01"
                                          />
                                        </div>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <div className="flex items-center gap-1 min-w-[90px]">
                                          <span className="text-sm text-muted-foreground">$</span>
                                          <Input
                                            type="number"
                                            value={item.material_cost || 0}
                                            onChange={(e) => {
                                              const value = validateNumeric(e.target.value)
                                              updateItem(globalIndex, { material_cost: value })
                                            }}
                                            onBlur={() => {
                                              const currentItem = itemsRef.current[globalIndex]
                                              if (currentItem?.id) {
                                                saveLineItem(currentItem.id, currentItem)
                                              }
                                            }}
                                            className="w-20 h-8 text-sm text-right pr-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            min="0"
                                            max="1000000"
                                            step="0.01"
                                          />
                                        </div>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <div className="flex items-center gap-1 min-w-[80px]">
                                          <span className="text-sm text-muted-foreground">$</span>
                                          <Input
                                            type="number"
                                            value={item.overhead_cost || 0}
                                            onChange={(e) => {
                                              const value = validateNumeric(e.target.value)
                                              updateItem(globalIndex, { overhead_cost: value })
                                            }}
                                            onBlur={() => {
                                              const currentItem = itemsRef.current[globalIndex]
                                              if (currentItem?.id) {
                                                saveLineItem(currentItem.id, currentItem)
                                              }
                                            }}
                                            className="w-20 h-8 text-sm text-right pr-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            min="0"
                                            max="1000000"
                                            step="0.01"
                                          />
                                        </div>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <div className="flex items-center gap-1 min-w-[90px]">
                                          <span className="text-sm text-muted-foreground">$</span>
                                          <Input
                                            type="number"
                                            value={item.direct_cost || 0}
                                            onChange={(e) => {
                                              const value = validateNumeric(e.target.value)
                                              updateItem(globalIndex, { direct_cost: value })
                                            }}
                                            onBlur={() => {
                                              const currentItem = itemsRef.current[globalIndex]
                                              if (currentItem?.id) {
                                                saveLineItem(currentItem.id, currentItem)
                                              }
                                            }}
                                            className="w-20 h-8 text-sm text-right pr-2 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            min="0"
                                            max="1000000"
                                            step="0.01"
                                          />
                                        </div>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <div className="flex items-center gap-1 min-w-[90px]">
                                          <Input
                                            type="number"
                                            value={item.margin_percent || 30}
                                            min={0}
                                            max={60}
                                            className="w-16 h-8 text-sm px-2 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            onChange={(e) => {
                                              const margin = Number(e.target.value) || 0
                                              updateItem(globalIndex, { margin_percent: margin })
                                            }}
                                            onBlur={() => {
                                              const currentItem = itemsRef.current[globalIndex]
                                              if (currentItem?.id) {
                                                // Only recalculate if not manually overridden
                                                if (currentItem.pricing_source !== 'manual') {
                                                  recalculateMargin(currentItem.id, currentItem.margin_percent || 30)
                                                } else {
                                                  saveLineItem(currentItem.id, currentItem)
                                                }
                                              }
                                            }}
                                          />
                                          <span className="text-xs text-muted-foreground">%</span>
                                        </div>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <div className="flex items-center gap-1 min-w-[100px]">
                                          <span className="text-sm text-muted-foreground font-semibold text-green-700">$</span>
                                          <Input
                                            type="number"
                                            value={item.client_price || 0}
                                            onChange={(e) => {
                                              const value = validateNumeric(e.target.value)
                                              updateItem(globalIndex, { client_price: value })
                                            }}
                                            onBlur={() => {
                                              const currentItem = itemsRef.current[globalIndex]
                                              if (currentItem?.id) {
                                                saveLineItem(currentItem.id, currentItem)
                                              }
                                            }}
                                            className="w-24 h-8 text-sm text-right pr-2 font-semibold text-green-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            min="0"
                                            max="1000000"
                                            step="0.01"
                                          />
                                        </div>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <div className="flex items-center gap-1 min-w-[90px]">
                                          {item.pricing_source === 'task_library' && (
                                            <span 
                                              className="flex items-center gap-1 text-xs text-blue-600"
                                              title="System price from task library"
                                            >
                                              <BookOpen className="h-3 w-3" />
                                              System
                                            </span>
                                          )}
                                          {item.pricing_source === 'user_library' && (
                                            <span 
                                              className="flex items-center gap-1 text-xs text-green-600"
                                              title="Your custom price override"
                                            >
                                              <Wrench className="h-3 w-3" />
                                              My Price
                                            </span>
                                          )}
                                          {(item.pricing_source === 'manual' || !item.pricing_source) && (
                                            <span 
                                              className="flex items-center gap-1 text-xs text-gray-500"
                                              title="Manual entry"
                                            >
                                              <Edit className="h-3 w-3" />
                                              Manual
                                            </span>
                                          )}
                                        </div>
                                      </TableCell>
                                      <TableCell className="align-top">
                                        {item.confidence !== null && item.confidence !== undefined ? (
                                          <div className="flex items-center gap-1 min-w-[60px]">
                                            {item.confidence >= 80 ? (
                                              <span 
                                                className="flex items-center gap-1 text-xs text-green-600"
                                                title={`Match confidence: ${item.confidence}%`}
                                              >
                                                <span className="text-green-500">●</span>
                                                {item.confidence}%
                                              </span>
                                            ) : item.confidence >= 50 ? (
                                              <span 
                                                className="flex items-center gap-1 text-xs text-yellow-600"
                                                title={`Match confidence: ${item.confidence}%`}
                                              >
                                                <span className="text-yellow-500">●</span>
                                                {item.confidence}%
                                              </span>
                                            ) : (
                                              <span 
                                                className="flex items-center gap-1 text-xs text-red-600"
                                                title={`Match confidence: ${item.confidence}%`}
                                              >
                                                <span className="text-red-500">●</span>
                                                {item.confidence}%
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <span className="text-xs text-gray-400">—</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="align-top">
                                        <div className="flex items-center gap-1">
                                          {originalValuesRef.current.has(item.id || '') && item.pricing_source === 'manual' && (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-7 px-2 text-xs"
                                              onClick={() => item.id && resetToAI(item.id, globalIndex)}
                                              title="Reset all cost fields to AI pricing"
                                            >
                                              <RotateCcw className="h-3 w-3 mr-1" />
                                              Reset
                                            </Button>
                                          )}
                                          <Button
                                            onClick={() => removeItem(globalIndex)}
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                    
                                    {/* Description row - half width, 3x height */}
                                    <TableRow>
                                      <TableCell colSpan={6} className="pt-0 pb-3">
                                        <AutoExpandingTextarea
                                          value={item.description}
                                          onChange={(value) => {
                                            // Update state immediately for controlled component
                                            updateItem(globalIndex, { description: value }, false)
                                          }}
                                          onBlur={() => {
                                            // Save to Supabase on blur
                                            const currentItem = itemsRef.current[globalIndex]
                                            if (currentItem?.id) {
                                              saveLineItem(currentItem.id, currentItem)
                                            }
                                          }}
                                          placeholder="Item description"
                                        />
                                      </TableCell>
                                    </TableRow>
                                  </React.Fragment>
                                )
                              })}
                            </React.Fragment>
                          )
                        })}
                      </React.Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Grand Total */}
          {items.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <div className="flex justify-end">
                <div className="text-right">
                  <div className="text-2xl font-bold">
                    Total: ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {items.length} line items
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
