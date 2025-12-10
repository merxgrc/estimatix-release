'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Save, AlertTriangle, Plus, Trash2, FileText, Download, BookOpen, Wrench, Edit, RotateCcw, ChevronRight, ChevronDown, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { SmartRoomInput } from './SmartRoomInput'
import { cn } from '@/lib/utils'
import { COST_CATEGORIES, getCostCode, formatCostCode } from '@/lib/constants'
import type { LineItem, EstimateData } from '@/types/estimate'
import { mergeEstimateItems, type EstimateItem } from '@/lib/estimate-utils'
import { toast } from 'sonner'

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

// Types LineItem and EstimateData are imported from @/types/estimate

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
  const [isGeneratingSpecSheet, setIsGeneratingSpecSheet] = useState(false)
  const [specSheetUrl, setSpecSheetUrl] = useState<string | null>(null)
  const [blockedActionMessage, setBlockedActionMessage] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [costCodes, setCostCodes] = useState<Array<{ code: string; label: string }>>([])
  const [isLoadingCostCodes, setIsLoadingCostCodes] = useState(true)
  const { user } = useAuth()
  const saveTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const itemsRef = useRef<LineItem[]>([])
  // Track original AI values for reset functionality
  const originalValuesRef = useRef<Map<string, Partial<LineItem>>>(new Map())
  
  const toggleRow = (itemId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  // Load cost codes from task_library on mount
  useEffect(() => {
    const loadCostCodes = async () => {
      setIsLoadingCostCodes(true)
      try {
        const { data, error } = await supabase
          .from('task_library')
          .select('cost_code, description, notes')
          .not('cost_code', 'is', null)
          .order('cost_code', { ascending: true })

        if (error) {
          console.error('Error loading cost codes:', error)
          // Fallback to hardcoded list if database query fails
          setCostCodes(COST_CATEGORIES)
          setIsLoadingCostCodes(false)
          return
        }

        if (data && data.length > 0) {
          // Format cost codes to match COST_CATEGORIES structure: { code, label }
          const formattedCodes = data.map((item) => ({
            code: item.cost_code!,
            label: `${item.cost_code} - ${item.description}`
          }))
          setCostCodes(formattedCodes)
        } else {
          // Fallback to hardcoded list if no data
          setCostCodes(COST_CATEGORIES)
        }
      } catch (err) {
        console.error('Error in loadCostCodes:', err)
        // Fallback to hardcoded list on error
        setCostCodes(COST_CATEGORIES)
      } finally {
        setIsLoadingCostCodes(false)
      }
    }

    loadCostCodes()
  }, [])

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
            // Fallback to initialData if database load fails - preserve room_name and cost_code
            if (initialData?.items) {
              setItems(initialData.items.map((item, idx) => ({
                id: `temp-${idx}`,
                room_name: item.room_name || 'General',
                description: item.description || '',
                category: item.category || 'Other',
                cost_code: item.cost_code || null, // Preserve cost_code from initialData, don't force 999
                quantity: item.quantity ?? 1,
                unit: item.unit || 'EA',
                labor_cost: item.labor_cost || 0,
                margin_percent: item.margin_percent || 0,
                client_price: item.client_price || 0
              })))
            }
            return
          }

          if (data && data.length > 0) {
            // Load from database - preserve room_name from database
            const loadedItems = data.map(item => {
              const isAllowance = item.is_allowance || (item.description || '').toUpperCase().startsWith('ALLOWANCE:')
              // For allowances, ensure client_price equals direct_cost
              let clientPrice = item.client_price || 0
              const directCost = item.direct_cost || 0
              if (isAllowance && directCost > 0 && clientPrice === 0) {
                clientPrice = directCost
              }
              
              return {
                id: item.id,
                room_name: item.room_name || '', // Preserve room_name from database
                description: item.description || '',
                category: item.category || costCodes.find(c => c.code === item.cost_code)?.label || 'Other',
                cost_code: item.cost_code || null, // Preserve cost_code from database, don't force 999
                quantity: item.quantity || 1,
                unit: item.unit || 'EA',
                labor_cost: item.labor_cost || 0,
                material_cost: item.material_cost || 0,
                overhead_cost: item.overhead_cost || 0,
                direct_cost: directCost,
                margin_percent: isAllowance ? 0 : (item.margin_percent || 30), // Allowances have 0% margin
                client_price: clientPrice,
                pricing_source: item.pricing_source || null,
                confidence: item.confidence ?? null,
                is_allowance: isAllowance
              }
            })
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
            // Fallback to initialData - preserve room_name and cost_code from initialData
            setItems(initialData.items.map((item, idx) => ({
              id: `temp-${idx}`,
              room_name: item.room_name || 'General', // Preserve room_name from initialData
              description: item.description || '',
              category: item.category || 'Other',
              cost_code: item.cost_code || null, // Preserve cost_code from initialData, don't force 999
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
      
      // Check if item is an allowance (from is_allowance field or description starts with "ALLOWANCE:")
      const isAllowance = updates.is_allowance !== undefined 
        ? updates.is_allowance 
        : (item.is_allowance || (item.description || '').toUpperCase().startsWith('ALLOWANCE:'))
      
      // Update is_allowance field
      if (isAllowance !== undefined) {
        item.is_allowance = isAllowance
      }
      
      // For allowances: ensure margin is 0 and client_price = direct_cost
      if (isAllowance) {
        item.margin_percent = 0
        
        // Calculate direct_cost if needed
        const directCost = updates.direct_cost !== undefined 
          ? updates.direct_cost 
          : (item.direct_cost || (item.labor_cost || 0) + (item.material_cost || 0) + (item.overhead_cost || 0))
        
        item.direct_cost = directCost
        item.client_price = directCost // Allowances: client_price = direct_cost (no markup)
      } else {
        // Auto-calculate client_price if labor_cost, margin_percent, quantity, or unit changed
        // But only if client_price wasn't manually edited and item is not manually overridden
        if ((updates.labor_cost !== undefined || updates.margin_percent !== undefined || 
            updates.quantity !== undefined || updates.unit !== undefined || 
            updates.direct_cost !== undefined || updates.material_cost !== undefined ||
            updates.overhead_cost !== undefined) &&
            updates.client_price === undefined && item.pricing_source !== 'manual') {
          // Calculate direct_cost if it's not provided
          const directCost = updates.direct_cost !== undefined 
            ? updates.direct_cost 
            : (item.direct_cost || (
                (updates.labor_cost !== undefined ? updates.labor_cost : item.labor_cost || 0) +
                (updates.material_cost !== undefined ? updates.material_cost : item.material_cost || 0) +
                (updates.overhead_cost !== undefined ? updates.overhead_cost : item.overhead_cost || 0)
              ))
          
          const marginPercent = updates.margin_percent !== undefined ? updates.margin_percent : item.margin_percent || 30
          
          // Calculate: client_price = direct_cost * (1 + margin/100)
          // Handle edge case where margin is 0 or NaN
          if (marginPercent > 0 && !isNaN(marginPercent)) {
            item.client_price = Number(directCost) * (1 + Number(marginPercent) / 100)
          } else {
            item.client_price = Number(directCost) // No markup
          }
          
          // Update direct_cost if calculated
          if (updates.direct_cost === undefined && !item.direct_cost) {
            item.direct_cost = directCost
          }
        }
      }
      
      // Final validation: ensure client_price is not NaN or 0 when we have valid costs
      const finalDirectCost = item.direct_cost || (item.labor_cost || 0) + (item.material_cost || 0) + (item.overhead_cost || 0)
      if ((isNaN(item.client_price) || item.client_price === 0) && finalDirectCost > 0 && !isAllowance) {
        const margin = item.margin_percent || 30
        item.client_price = finalDirectCost * (1 + margin / 100)
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

  const removeItem = async (index: number) => {
    const item = items[index]
    if (item.id && !item.id.startsWith('temp-')) {
      // Delete from database
      try {
        const { error } = await supabase
          .from('estimate_line_items')
          .delete()
          .eq('id', item.id)
        
        if (error) {
          console.error('Error deleting line item:', error)
          setError(`Failed to delete item: ${error.message}`)
          return
        }
      } catch (err) {
        console.error('Error in removeItem:', err)
        setError('Failed to delete item')
        return
      }
    }
    // Remove from state
    setItems(prevItems => prevItems.filter((_, i) => i !== index))
  }

  const grandTotal = items.reduce((sum, item) => sum + (item.client_price || 0), 0)

  // Get title from description (first 50 chars or first sentence)
  const getTitle = (description: string): string => {
    if (!description) return 'Untitled Item'
    const firstSentence = description.split(/[.!?]/)[0].trim()
    if (firstSentence.length > 0 && firstSentence.length <= 50) {
      return firstSentence
    }
    return description.substring(0, 50).trim() + (description.length > 50 ? '...' : '')
  }

  // Auto-expanding textarea for description
  const DescriptionTextarea = ({
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

    useEffect(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
      }
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      onChange(newValue)
      // Auto-expand
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
      }
    }

    return (
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onBlur={onBlur}
        placeholder={placeholder}
        className="min-h-[80px] text-sm resize-none"
      />
    )
  }

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

  // Smart save handler that merges duplicate items before saving
  const handleSmartSave = async () => {
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

    // Convert LineItem[] to EstimateItem[] for merging
    const itemsToMerge: EstimateItem[] = items.map(item => ({
      cost_code: item.cost_code,
      description: item.description,
      quantity: item.quantity,
      unit_cost: item.direct_cost && item.quantity ? item.direct_cost / item.quantity : item.direct_cost || null,
      unit: item.unit || null,
      category: item.category || null,
      notes: item.notes || null,
      room_name: item.room_name || null,
      direct_cost: item.direct_cost || null,
      labor_cost: item.labor_cost || null,
      material_cost: item.material_cost || null,
      margin_percent: item.margin_percent || null,
      client_price: item.client_price || null,
      pricing_source: item.pricing_source || null,
      confidence: item.confidence || null
    }))

    // Store original length and IDs
    const originalLength = itemsToMerge.length
    const originalItemsMap = new Map(items.map(item => [item.id || '', item]))

    // Merge items
    const mergedItems = mergeEstimateItems(itemsToMerge)
    const mergedLength = mergedItems.length

    // Check if any items were merged
    const itemsWereMerged = mergedLength < originalLength
    const mergedCount = originalLength - mergedLength

    // Convert merged EstimateItem[] back to LineItem[] format
    // We need to preserve IDs where possible - keep the first ID for items that were merged
    // Since merge key is now based on cost_code + description + unit_cost, find exact match
    const mergedLineItems: LineItem[] = mergedItems.map((mergedItem) => {
      // Find the first original item that matches this merged item exactly
      // Since items only merge if they're truly identical (cost_code + description + unit_cost),
      // we can find any matching original and use its ID
      const normalizeDesc = (desc: string) => (desc || '').trim().toLowerCase()
      const normalizeCost = (cost: number | null | undefined) => {
        if (cost === null || cost === undefined || isNaN(cost)) return null
        return Math.round(cost * 100) / 100
      }
      
      // Calculate unit_cost for comparison
      const mergedUnitCost = mergedItem.unit_cost || 
        (mergedItem.direct_cost && mergedItem.quantity 
          ? mergedItem.direct_cost / mergedItem.quantity 
          : null)
      const mergedUnitCostNorm = normalizeCost(mergedUnitCost)
      
      const originalItem = items.find(item => {
        // Match cost_code
        const costCodeMatch = (item.cost_code || null) === (mergedItem.cost_code || null)
        if (!costCodeMatch) return false
        
        // Match description (normalized)
        const itemDescNorm = normalizeDesc(item.description || '')
        const mergedDescNorm = normalizeDesc(mergedItem.description || '')
        if (itemDescNorm !== mergedDescNorm) return false
        
        // Match unit_cost (normalized)
        const itemUnitCost = item.direct_cost && item.quantity 
          ? item.direct_cost / item.quantity 
          : (item.labor_cost || 0) + (item.material_cost || 0)
        const itemUnitCostNorm = normalizeCost(itemUnitCost)
        
        return itemUnitCostNorm === mergedUnitCostNorm
      })
      
      const preservedId = originalItem?.id

      return {
        id: preservedId,
        room_name: mergedItem.room_name || '',
        description: mergedItem.description || '',
        category: mergedItem.category || 'Other',
        cost_code: mergedItem.cost_code,
        quantity: mergedItem.quantity || 1,
        unit: mergedItem.unit || 'EA',
        labor_cost: mergedItem.labor_cost || 0,
        material_cost: mergedItem.material_cost || 0,
        overhead_cost: mergedItem.overhead_cost || 0, // Now tracked in EstimateItem merge logic
        direct_cost: mergedItem.direct_cost || (mergedItem.unit_cost && mergedItem.quantity ? mergedItem.unit_cost * mergedItem.quantity : 0),
        margin_percent: mergedItem.margin_percent || 30,
        client_price: mergedItem.client_price || 0,
        pricing_source: (mergedItem.pricing_source as 'task_library' | 'user_library' | 'manual' | null) || null,
        confidence: mergedItem.confidence || null,
        notes: mergedItem.notes
      }
    })

    // Overhead_cost is now merged in mergeEstimateItems function based on the refined merge key
    // So we don't need to recalculate it here - it's already in mergedItems
    // Just ensure it's transferred to the LineItem format
    mergedLineItems.forEach((mergedItem, index) => {
      const mergedEstimateItem = mergedItems[index]
      if (mergedEstimateItem.overhead_cost !== null && mergedEstimateItem.overhead_cost !== undefined) {
        mergedItem.overhead_cost = mergedEstimateItem.overhead_cost
      }
    })

    // Show toast notification if items were merged
    if (itemsWereMerged && mergedCount > 0) {
      toast.success(
        `Optimized estimate: Merged ${mergedCount} identical item${mergedCount > 1 ? 's' : ''} (same description and price).`,
        {
          duration: 4000
        }
      )
    }

    // Update state with merged items and proceed with save
    setItems(mergedLineItems)
    
    // Save using the merged items directly (bypassing async state update)
    await saveEstimate(mergedLineItems)
  }

  const saveEstimate = async (itemsToSave?: LineItem[]) => {
    // Use provided items or fall back to state
    const itemsToProcess = itemsToSave || items
    const hasItems = itemsToProcess.length > 0

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

      // Calculate grand total from items to process
      const totalToSave = itemsToProcess.reduce((sum, item) => sum + (item.client_price || 0), 0)

      // Ensure we have an estimate record first
      if (!currentEstimateId) {
        const estimateData: any = {
          project_id: projectId,
          json_data: {
            items: itemsToProcess,
            assumptions: initialData?.assumptions || [],
            missing_info: missingInfo
          },
          total: totalToSave,
          ai_summary: `Estimate with ${itemsToProcess.length} line items`
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
              items: itemsToProcess,
              assumptions: initialData?.assumptions || [],
              missing_info: missingInfo
            },
            total: totalToSave,
            ai_summary: `Updated estimate with ${itemsToProcess.length} line items`
          })
          .eq('id', currentEstimateId)

        if (updateError) {
          throw new Error(`Failed to update estimate: ${updateError.message}`)
        }
      }

      // Upsert line items into estimate_line_items table
      const lineItemsToSave = itemsToProcess.map(item => {
        const categoryInfo = costCodes.find(c => c.code === item.cost_code) || (costCodes.length > 0 ? costCodes[costCodes.length - 1] : { label: 'Other', code: '999' })
        
        // Build the base item data
        // Preserve cost_code if provided, otherwise use null (don't force 999)
        const itemData: any = {
          estimate_id: currentEstimateId,
          project_id: projectId,
          room_name: item.room_name || null,
          description: item.description || null,
          category: categoryInfo.label,
          cost_code: item.cost_code || null, // Don't force 999 - preserve null if not set
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
        
        // Only include id if it exists and is a valid UUID (not temp-*)
        if (item.id && typeof item.id === 'string' && !item.id.startsWith('temp-') && item.id.length > 0) {
          itemData.id = item.id
        }
        
        return itemData
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

      // Validate that all items have required fields before saving
      // Only require: description, quantity, unit (cost_code is optional but recommended)
      const invalidItems = lineItemsToSave.filter(item => {
        return !item.description || !item.description.trim() || !item.quantity || !item.unit
      })
      
      if (invalidItems.length > 0) {
        throw new Error(
          `Please fill in description, quantity, and unit for all items before saving. ` +
          `${invalidItems.length} item(s) are missing required information.`
        )
      }

      // Warn about missing cost_code but don't block saving
      const itemsWithoutCostCode = lineItemsToSave.filter(item => !item.cost_code || item.cost_code === '999')
      if (itemsWithoutCostCode.length > 0) {
        console.warn(`${itemsWithoutCostCode.length} item(s) are missing a cost code. Defaulting to '999 - Other'.`)
      }

      const { error: upsertError } = await supabase
        .from('estimate_line_items')
        .insert(lineItemsToSave)
        .select()

      if (upsertError) {
        // Provide more helpful error messages
        if (upsertError.message.includes('null value in column "id"')) {
          throw new Error(
            'Failed to save: New items must have a description and cost code. ' +
            'Please ensure all items are filled out completely before saving.'
          )
        }
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
          category: item.category || costCodes.find(c => c.code === item.cost_code)?.label || 'Other',
          cost_code: item.cost_code || null, // Preserve cost_code from database, don't force 999
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
        })))
      }

      setSaveSuccess(true)
      if (currentEstimateId) {
        onSave?.(currentEstimateId, totalToSave)
      }

      // If we saved merged items, ensure state is updated
      if (itemsToSave) {
        setItems(itemsToSave)
      }

    } catch (err) {
      console.error('Save estimate error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save estimate')
    } finally {
      setIsSaving(false)
    }
  }

  const generateSpecSheet = async () => {
    const hasItems = items.length > 0

    if (!hasItems) {
      setBlockedActionMessage('Create an estimate first by using the record feature or by adding line items manually.')
      setTimeout(() => setBlockedActionMessage(null), 5000)
      return
    }

    // Check if there are unsaved items (items without IDs or with temp- IDs)
    const unsavedItems = items.filter(item => !item.id || item.id.startsWith('temp-'))
    if (unsavedItems.length > 0) {
      setBlockedActionMessage(
        `Please save your estimate first (${unsavedItems.length} unsaved item(s)). ` +
        'Click "Save Estimate" to save all items before generating the spec sheet.'
      )
      setTimeout(() => setBlockedActionMessage(null), 5000)
      return
    }

    // Check if items have required fields (description, quantity, unit)
    // cost_code is optional but recommended
    const incompleteItems = items.filter(item => 
      !item.description || !item.description.trim() || !item.quantity || !item.unit
    )
    if (incompleteItems.length > 0) {
      setBlockedActionMessage(
        `Please complete all items before generating the spec sheet. ` +
        `${incompleteItems.length} item(s) are missing description, quantity, or unit.`
      )
      setTimeout(() => setBlockedActionMessage(null), 5000)
      return
    }

    const currentEstimateId = estimateId
    if (!currentEstimateId) {
      setBlockedActionMessage('Please save the estimate first before generating a spec sheet.')
      setTimeout(() => setBlockedActionMessage(null), 5000)
      return
    }

    setIsGeneratingSpecSheet(true)
    setError(null)
    setSpecSheetUrl(null)

    try {
      const response = await fetch(`/api/spec-sheets/${currentEstimateId}/pdf`, {
        method: 'GET',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to generate spec sheet: ${response.status}`)
      }

      const data = await response.json()
      setSpecSheetUrl(data.url)
    } catch (err) {
      console.error('Generate spec sheet error:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate spec sheet')
    } finally {
      setIsGeneratingSpecSheet(false)
    }
  }

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
                onClick={generateSpecSheet} 
                disabled={isGeneratingSpecSheet}
                variant="outline"
                size="sm"
              >
                {isGeneratingSpecSheet ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileText className="mr-2 h-4 w-4" />
                    Generate Spec Sheet
                  </>
                )}
              </Button>
              <Button 
                onClick={handleSmartSave} 
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
                ✓ Estimate saved successfully! Your items are now saved and will appear in the spec sheet when you generate it.
              </AlertDescription>
            </Alert>
          )}

          {specSheetUrl && (
            <Alert className="mb-4 border-blue-200 bg-blue-50">
              <AlertDescription className="text-blue-800 flex items-center justify-between">
                <span>✓ Spec sheet generated successfully!</span>
                <Button
                  onClick={() => window.open(specSheetUrl, '_blank')}
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
              <p className="mb-2">No items yet. Click "Add Item" to get started.</p>
              <p className="text-sm">After adding items, fill in the description and select a cost code, then click "Save Estimate" to save them.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 py-1 px-2"></TableHead>
                    <TableHead className="py-1 px-2">Title</TableHead>
                    <TableHead className="py-1 px-2">Room</TableHead>
                    <TableHead className="py-1 px-2">Cost Code</TableHead>
                    <TableHead className="py-1 px-2">Qty / Unit</TableHead>
                    <TableHead className="text-right py-1 px-2">Direct Cost</TableHead>
                    <TableHead className="text-right py-1 px-2">Margin %</TableHead>
                    <TableHead className="text-right py-1 px-2">Client Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => {
                    const itemId = item.id || `temp-${index}`
                    const isExpanded = expandedRows.has(itemId)
                    const costInfo = COST_CATEGORIES.find(c => c.code === item.cost_code)
                    const costCodeLabel = costInfo?.label || (item.cost_code || 'Unassigned')
                    const isAIGenerated = item.pricing_source === 'task_library' || item.pricing_source === 'user_library'
                    const isManualOverride = item.pricing_source === 'manual' || (!item.pricing_source && item.labor_cost !== 0)
                    
                    return (
                      <React.Fragment key={itemId}>
                        {/* Primary Row - Always Visible */}
                        <TableRow className="hover:bg-muted/30">
                          <TableCell className="py-1 px-2 w-8">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="h-6 w-6 p-0"
                              onClick={() => toggleRow(itemId)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="py-1 px-2 max-w-[200px]">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate" title={item.description}>
                                {getTitle(item.description)}
                              </span>
                              {isAIGenerated && (
                                <Badge variant="outline" className="h-5 px-1.5 text-xs">
                                  <Sparkles className="h-3 w-3 mr-1" />
                                  AI
                                </Badge>
                              )}
                              {isManualOverride && !isAIGenerated && (
                                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                                  <Edit className="h-3 w-3 mr-1" />
                                  Manual
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-1 px-2">
                            <SmartRoomInput
                              value={item.room_name || ''}
                              onChange={(value) => updateItem(index, { room_name: value })}
                              onBlur={() => {
                                if (item.id) {
                                  saveLineItem(item.id, items[index])
                                }
                              }}
                              placeholder="Room"
                              options={ROOM_OPTIONS}
                              className="min-w-[100px]"
                            />
                          </TableCell>
                          <TableCell className="py-1 px-2">
                            <Select
                              value={item.cost_code || undefined}
                              onValueChange={(value) => {
                                const selected = costCodes.find(c => c.code === value)
                                updateItem(index, {
                                  cost_code: selected?.code || null,
                                  category: selected?.label || 'Other'
                                })
                              }}
                              disabled={isLoadingCostCodes}
                            >
                              <SelectTrigger className="h-7 text-xs w-[100px]">
                                <SelectValue placeholder={isLoadingCostCodes ? "Loading..." : "Code"} />
                              </SelectTrigger>
                              <SelectContent>
                                {isLoadingCostCodes ? (
                                  <SelectItem value="loading" disabled>Loading cost codes...</SelectItem>
                                ) : (
                                  costCodes.map(({ label, code }) => (
                                    <SelectItem key={code} value={code}>{label}</SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="py-1 px-2">
                            <div className="flex items-center gap-1 min-w-[90px]">
                              <Input
                                type="number"
                                value={item.quantity || 1}
                                onChange={(e) => {
                                  const qty = Number(e.target.value) || 1
                                  updateItem(index, { quantity: qty })
                                }}
                                onBlur={() => {
                                  const currentItem = itemsRef.current[index]
                                  if (currentItem?.id) {
                                    saveLineItem(currentItem.id, currentItem)
                                  }
                                }}
                                className="h-7 w-12 text-xs text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                min="0"
                                step="0.01"
                              />
                              <Select
                                value={item.unit || 'EA'}
                                onValueChange={(value) => updateItem(index, { unit: value })}
                              >
                                <SelectTrigger className="h-7 text-xs w-[60px]">
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
                          <TableCell className="text-right py-1 px-2">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-xs text-muted-foreground">$</span>
                              <Input
                                type="number"
                                value={item.direct_cost || 0}
                                onChange={(e) => {
                                  const value = validateNumeric(e.target.value)
                                  updateItem(index, { direct_cost: value })
                                }}
                                onBlur={() => {
                                  const currentItem = itemsRef.current[index]
                                  if (currentItem?.id) {
                                    saveLineItem(currentItem.id, currentItem)
                                  }
                                }}
                                className="h-7 w-24 text-xs text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                min="0"
                                step="0.01"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right py-1 px-2">
                            <div className="flex items-center justify-end gap-1">
                              {/* Check if item is an allowance */}
                              {(() => {
                                const isAllowance = item.is_allowance || (item.description || '').toUpperCase().startsWith('ALLOWANCE:')
                                const marginValue = isAllowance ? 0 : (item.margin_percent || 30)
                                
                                return (
                                  <>
                                    <Input
                                      type="number"
                                      value={marginValue}
                                      min={0}
                                      max={60}
                                      disabled={isAllowance}
                                      onChange={(e) => {
                                        if (!isAllowance) {
                                          const margin = Number(e.target.value) || 0
                                          updateItem(index, { margin_percent: margin })
                                        }
                                      }}
                                      onBlur={() => {
                                        if (!isAllowance) {
                                          const currentItem = itemsRef.current[index]
                                          if (currentItem?.id) {
                                            if (currentItem.pricing_source !== 'manual') {
                                              recalculateMargin(currentItem.id, currentItem.margin_percent || 30)
                                            } else {
                                              saveLineItem(currentItem.id, currentItem)
                                            }
                                          }
                                        }
                                      }}
                                      className={cn(
                                        "h-7 w-14 text-xs text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                        isAllowance && "bg-muted cursor-not-allowed opacity-70"
                                      )}
                                    />
                                    <span className="text-xs text-muted-foreground">%</span>
                                  </>
                                )
                              })()}
                            </div>
                          </TableCell>
                          <TableCell className="text-right py-1 px-2">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-xs text-muted-foreground font-semibold text-green-700">$</span>
                              <Input
                                type="number"
                                value={item.client_price || 0}
                                onChange={(e) => {
                                  const value = validateNumeric(e.target.value)
                                  updateItem(index, { client_price: value })
                                }}
                                onBlur={() => {
                                  const currentItem = itemsRef.current[index]
                                  if (currentItem?.id) {
                                    saveLineItem(currentItem.id, currentItem)
                                  }
                                }}
                                className="h-7 w-28 text-xs text-right font-semibold text-green-700 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                min="0"
                                step="0.01"
                              />
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Expanded Row - Details */}
                        {isExpanded && (
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={8} className="py-2 px-2">
                              <div className="space-y-3">
                                {/* Full Description */}
                                <div>
                                  <Label className="text-xs text-muted-foreground mb-1 block">Description</Label>
                                  <DescriptionTextarea
                                    value={item.description}
                                    onChange={(value) => {
                                      updateItem(index, { description: value }, false)
                                    }}
                                    onBlur={() => {
                                      const currentItem = itemsRef.current[index]
                                      if (currentItem?.id) {
                                        saveLineItem(currentItem.id, currentItem)
                                      }
                                    }}
                                    placeholder="Full item description..."
                                  />
                                </div>

                                {/* Cost Breakdown */}
                                <div className="grid grid-cols-4 gap-4">
                                  <div>
                                    <Label className="text-xs text-muted-foreground mb-1 block">Labor Cost</Label>
                                    <Input
                                      type="number"
                                      value={item.labor_cost || 0}
                                      onChange={(e) => {
                                        const value = validateNumeric(e.target.value)
                                        updateItem(index, { labor_cost: value })
                                      }}
                                      onBlur={() => {
                                        const currentItem = itemsRef.current[index]
                                        if (currentItem?.id) {
                                          saveLineItem(currentItem.id, currentItem)
                                        }
                                      }}
                                      className="h-8 text-sm text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      min="0"
                                      step="0.01"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground mb-1 block">Material Cost</Label>
                                    <Input
                                      type="number"
                                      value={item.material_cost || 0}
                                      onChange={(e) => {
                                        const value = validateNumeric(e.target.value)
                                        updateItem(index, { material_cost: value })
                                      }}
                                      onBlur={() => {
                                        const currentItem = itemsRef.current[index]
                                        if (currentItem?.id) {
                                          saveLineItem(currentItem.id, currentItem)
                                        }
                                      }}
                                      className="h-8 text-sm text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      min="0"
                                      step="0.01"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground mb-1 block">Overhead</Label>
                                    <Input
                                      type="number"
                                      value={item.overhead_cost || 0}
                                      onChange={(e) => {
                                        const value = validateNumeric(e.target.value)
                                        updateItem(index, { overhead_cost: value })
                                      }}
                                      onBlur={() => {
                                        const currentItem = itemsRef.current[index]
                                        if (currentItem?.id) {
                                          saveLineItem(currentItem.id, currentItem)
                                        }
                                      }}
                                      className="h-8 text-sm text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      min="0"
                                      step="0.01"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground mb-1 block">Direct Cost</Label>
                                    <Input
                                      type="number"
                                      value={item.direct_cost || 0}
                                      readOnly
                                      className="h-8 text-sm text-right tabular-nums bg-muted"
                                      disabled
                                    />
                                  </div>
                                </div>

                                {/* Source & Confidence Badges - "Zebel-Style" */}
                                <div className="flex items-center gap-3">
                                  {item.pricing_source && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground">Source:</span>
                                      {item.pricing_source === 'task_library' && (
                                        <Badge variant="outline" className="h-5 text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300">
                                          <BookOpen className="h-3 w-3 mr-1" />
                                          System
                                        </Badge>
                                      )}
                                      {item.pricing_source === 'user_library' && (
                                        <Badge variant="outline" className="h-5 text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-300">
                                          <Wrench className="h-3 w-3 mr-1" />
                                          History
                                        </Badge>
                                      )}
                                      {item.pricing_source === 'manual' && (
                                        <Badge variant="outline" className="h-5 text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border-yellow-300">
                                          <Edit className="h-3 w-3 mr-1" />
                                          Manual
                                        </Badge>
                                      )}
                                      {item.pricing_source === 'ai' && (
                                        <Badge variant="outline" className="h-5 text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-300">
                                          <Sparkles className="h-3 w-3 mr-1" />
                                          AI
                                        </Badge>
                                      )}
                                    </div>
                                  )}
                                  {item.confidence !== null && item.confidence !== undefined && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground">Confidence:</span>
                                      <Badge
                                        variant={item.confidence >= 80 ? "default" : item.confidence >= 50 ? "outline" : "secondary"}
                                        className={cn(
                                          "h-5 text-xs tabular-nums",
                                          item.confidence >= 80 && "bg-green-600",
                                          item.confidence >= 50 && item.confidence < 80 && "bg-yellow-500",
                                          item.confidence < 50 && "bg-red-500"
                                        )}
                                      >
                                        {item.confidence}%
                                      </Badge>
                                    </div>
                                  )}
                                  {originalValuesRef.current.has(itemId) && item.pricing_source === 'manual' && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-xs"
                                      onClick={() => item.id && resetToAI(item.id, index)}
                                      title="Reset to AI pricing"
                                    >
                                      <RotateCcw className="h-3 w-3 mr-1" />
                                      Reset to AI
                                    </Button>
                                  )}
                                  <Button
                                    onClick={() => removeItem(index)}
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                                  >
                                    <Trash2 className="h-3 w-3 mr-1" />
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
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
