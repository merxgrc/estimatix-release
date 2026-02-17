'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Save, AlertTriangle, Plus, Trash2, FileText, Download, BookOpen, Wrench, Edit, RotateCcw, ChevronRight, ChevronDown, Sparkles, History, Database, User, Info as InfoIcon, Ruler, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { SmartRoomInput } from './SmartRoomInput'
import { cn } from '@/lib/utils'
import { COST_CATEGORIES, getCostCode, formatCostCode } from '@/lib/constants'
import type { LineItem, EstimateData } from '@/types/estimate'
import type { EstimateStatus } from '@/types/db'
import { mergeEstimateItems, type EstimateItem } from '@/lib/estimate-utils'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'
import { rederiveLineItemQuantity, setLineItemCalcSourceManual } from '@/actions/rooms'
import { updateLineItem as serverUpdateLineItem, type UpdateLineItemPatch } from '@/actions/estimate-line-items'
import { isAreaBasedItem, getAreaFieldLabel, resolveAreaFieldForLineItem } from '@/lib/area-mapping'

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
  
  // =============================================================================
  // Room scope map: roomId → is_in_scope (for filtering excluded rooms from totals)
  // =============================================================================
  const [roomScopeMap, setRoomScopeMap] = useState<Map<string, boolean>>(new Map())

  // =============================================================================
  // EDIT LOCK: Estimates are locked when status != 'draft'
  // =============================================================================
  const [estimateStatus, setEstimateStatus] = useState<EstimateStatus>('draft')
  const isLocked = estimateStatus !== 'draft'
  
  // Fetch estimate status to determine if editing is allowed
  useEffect(() => {
    const fetchEstimateStatus = async () => {
      if (!estimateId) {
        setEstimateStatus('draft')
        return
      }
      
      try {
        const { data, error } = await supabase
          .from('estimates')
          .select('status')
          .eq('id', estimateId)
          .single()
        
        if (!error && data?.status) {
          setEstimateStatus(data.status as EstimateStatus)
        }
      } catch (err) {
        console.error('Error fetching estimate status:', err)
      }
    }
    
    fetchEstimateStatus()
  }, [estimateId])
  
  // Helper to get lock message based on status
  const getLockMessage = (status: EstimateStatus): string => {
    switch (status) {
      case 'bid_final':
        return 'This estimate is locked (Bid Finalized). Create a new estimate to make changes.'
      case 'contract_signed':
        return 'This estimate is locked (Contract Signed). Pricing cannot be modified.'
      case 'completed':
        return 'This project is completed. The estimate is read-only.'
      default:
        return 'This estimate is locked and cannot be edited.'
    }
  }
  
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

  // Extract loadLineItems to a reusable function
  const loadLineItems = useCallback(async () => {
    if (estimateId && projectId) {
      try {
        // Also fetch room scope data for this project
        const { data: roomsData } = await supabase
          .from('rooms')
          .select('id, is_in_scope')
          .eq('project_id', projectId)

        if (roomsData) {
          const scopeMap = new Map<string, boolean>()
          for (const r of roomsData) {
            scopeMap.set(r.id, r.is_in_scope ?? true)
          }
          setRoomScopeMap(scopeMap)
        }

        const { data, error } = await supabase
          .from('estimate_line_items')
          .select('*, price_source')
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
              room_id: item.room_id || null,
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
              price_source: (item as any).price_source || item.pricing_source || null,
              confidence: item.confidence ?? null,
              is_allowance: isAllowance,
              calc_source: (item.calc_source as 'manual' | 'room_dimensions') || 'manual',
            }
          })
          setItems(loadedItems)
          console.log('[EstimateTable] Loaded', loadedItems.length, 'line items from database')
          
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
            // Preserve null for unpriced items (null ≠ 0)
            labor_cost: (item as any).labor_cost ?? null,
            material_cost: (item as any).material_cost ?? null,
            overhead_cost: (item as any).overhead_cost ?? null,
            direct_cost: (item as any).direct_cost ?? null,
            margin_percent: (item as any).margin_percent || 30,
            client_price: (item as any).client_price ?? null,
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
        // Preserve null for unpriced items (null ≠ 0)
        labor_cost: (item as any).labor_cost ?? null,
        material_cost: (item as any).material_cost ?? null,
        overhead_cost: (item as any).overhead_cost ?? null,
        direct_cost: (item as any).direct_cost ?? null,
        margin_percent: (item as any).margin_percent || 30,
        client_price: (item as any).client_price ?? null,
        pricing_source: (item as any).pricing_source || null,
        confidence: (item as any).confidence ?? null
      })))
    }
  }, [estimateId, projectId, initialData, costCodes])

  // Load line items from database on mount and when dependencies change
  useEffect(() => {
    loadLineItems()
  }, [loadLineItems])

  // Listen for estimate-updated event to refetch line items
  useEffect(() => {
    const handleEstimateUpdate = () => {
      console.log('[EstimateTable] Received estimate-updated event, refetching line items...')
      // Add a small delay to ensure database transaction has committed
      setTimeout(() => {
        loadLineItems()
      }, 300)
    }

    window.addEventListener('estimate-updated', handleEstimateUpdate)
    return () => {
      window.removeEventListener('estimate-updated', handleEstimateUpdate)
    }
  }, [loadLineItems])

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

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE (debounced, via server action with Zod validation + server-side calc)
  // ═══════════════════════════════════════════════════════════════════════════
  // The server action:
  //   1. Validates the patch with Zod
  //   2. Merges with the stored row
  //   3. Recomputes direct_cost + client_price server-side
  //   4. Writes to DB
  //   5. Refreshes estimates.total (SUM of all in-scope items)
  //   6. Returns computed fields for client reconciliation
  //
  // The client:
  //   - Optimistically updates state immediately (in updateItem)
  //   - Debounces the server call (800ms)
  //   - On server response, reconciles any discrepancies (server wins)
  // ═══════════════════════════════════════════════════════════════════════════

  const saveLineItem = async (itemId: string | undefined, item: LineItem) => {
    if (!itemId || itemId.startsWith('temp-') || !estimateId || !projectId) return

    // EDIT LOCK: Block saves when estimate is not in draft status
    if (isLocked) {
      console.warn(`saveLineItem blocked: estimate is locked (status=${estimateStatus})`)
      return
    }

    // Clear existing timeout for this item
    const existingTimeout = saveTimeoutRef.current.get(itemId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Set new timeout for debounced save (800ms — fast enough to feel instant,
    // slow enough to batch rapid keystrokes)
    const timeout = setTimeout(async () => {
      try {
        const patch: UpdateLineItemPatch = {
          room_name: item.room_name || null,
          room_id: item.room_id || null,
          description: item.description || undefined,
          category: item.category || undefined,
          cost_code: item.cost_code || null,
          quantity: item.quantity ?? null,
          unit: item.unit || undefined,
          labor_cost: item.labor_cost ?? null,
          material_cost: item.material_cost ?? null,
          overhead_cost: item.overhead_cost ?? null,
          direct_cost: item.direct_cost ?? null,
          margin_percent: item.margin_percent || 30,
          client_price: item.client_price ?? null,
          pricing_source: (item.pricing_source as UpdateLineItemPatch['pricing_source']) || null,
          calc_source: item.calc_source || 'manual',
          is_allowance: item.is_allowance ?? null,
        }

        const result = await serverUpdateLineItem(itemId, patch)

        if (!result.success) {
          console.error(`[saveLineItem] Server error for ${itemId}:`, result.error)
          toast.error(result.error || 'Failed to save item')
          return
        }

        // ── Reconcile: server-computed fields win ──
        if (result.item) {
          setItems(prev => {
            const idx = prev.findIndex(i => i.id === itemId)
            if (idx === -1) return prev
            const next = [...prev]
            const current = next[idx]
            // Only reconcile if the item hasn't been edited again since this save fired
            // (check by comparing values that the server computed)
            next[idx] = {
              ...current,
              direct_cost: result.item!.direct_cost,
              client_price: result.item!.client_price,
              margin_percent: result.item!.margin_percent,
              calc_source: result.item!.calc_source,
            }
            return next
          })
        }
      } catch (err) {
        console.error(`Error in saveLineItem for ${itemId}:`, err)
      } finally {
        saveTimeoutRef.current.delete(itemId)
      }
    }, 800) // 800ms debounce

    saveTimeoutRef.current.set(itemId, timeout)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENT-SIDE TOTAL COMPUTATION (mirrors server formula for optimistic UI)
  // ═══════════════════════════════════════════════════════════════════════════
  //   direct_cost = labor_cost + material_cost + overhead_cost
  //   client_price = direct_cost × (1 + margin_percent / 100)
  //   For allowances: client_price = direct_cost, margin = 0
  // ═══════════════════════════════════════════════════════════════════════════
  const computeClientTotals = useCallback((item: LineItem, opts?: {
    directCostExplicit?: boolean
    clientPriceExplicit?: boolean
  }): { direct_cost: number | null; client_price: number | null } => {
    const labor = item.labor_cost ?? 0
    const material = item.material_cost ?? 0
    const overhead = item.overhead_cost ?? 0
    const isAllowance = item.is_allowance || (item.description || '').toUpperCase().startsWith('ALLOWANCE:')

    // 1. direct_cost
    let directCost: number | null
    if (opts?.directCostExplicit) {
      directCost = item.direct_cost ?? null
    } else if (labor !== 0 || material !== 0 || overhead !== 0) {
      directCost = Math.round((labor + material + overhead) * 100) / 100
    } else {
      directCost = item.direct_cost ?? null
    }

    // 2. client_price
    let clientPrice: number | null
    if (isAllowance) {
      clientPrice = directCost
    } else if (opts?.clientPriceExplicit) {
      clientPrice = item.client_price ?? null
    } else if (directCost !== null && directCost !== 0) {
      const margin = item.margin_percent ?? 0
      clientPrice = Math.round(directCost * (1 + margin / 100) * 100) / 100
    } else {
      clientPrice = item.client_price ?? null
    }

    return { direct_cost: directCost, client_price: clientPrice }
  }, [])

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

  // Toggle calc_source between 'manual' and 'room_dimensions'
  const toggleCalcSource = async (index: number) => {
    const item = items[index]
    if (!item.id || item.id.startsWith('temp-')) {
      toast.error('Save the item first before toggling auto-calculation.')
      return
    }

    const currentSource = item.calc_source || 'manual'

    if (currentSource === 'manual') {
      // Switch to room_dimensions → re-derive quantity from room area
      toast.loading('Re-deriving quantity from room dimensions...', { id: 'calc-toggle' })
      const result = await rederiveLineItemQuantity(item.id)
      toast.dismiss('calc-toggle')

      if (result.success) {
        setItems(prev => {
          const next = [...prev]
          next[index] = {
            ...next[index],
            quantity: result.quantity ?? next[index].quantity,
            direct_cost: result.direct_cost ?? next[index].direct_cost,
            calc_source: 'room_dimensions',
          }
          return next
        })
        const areaLabel = result.area_field ? getAreaFieldLabel(result.area_field as any) : 'Room Area'
        toast.success(`Quantity auto-set from ${areaLabel}: ${result.quantity?.toLocaleString() ?? '—'} SQFT`)
      } else {
        toast.error(result.error || 'Failed to re-derive quantity')
      }
    } else {
      // Switch to manual → keep current quantity, stop auto-updating
      const result = await setLineItemCalcSourceManual(item.id)
      if (result.success) {
        setItems(prev => {
          const next = [...prev]
          next[index] = { ...next[index], calc_source: 'manual' }
          return next
        })
        toast.success('Quantity is now manual. Edit freely.')
      } else {
        toast.error(result.error || 'Failed to switch to manual')
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // updateItem — Optimistic client update + debounced server save
  //
  // 1. Merges `updates` into the item at `index`
  // 2. Re-derives direct_cost & client_price using the SAME formula as server
  // 3. Updates state immediately (optimistic) → totals recompute via React
  // 4. Queues a debounced server save that reconciles on response
  // ═══════════════════════════════════════════════════════════════════════════
  const updateItem = (index: number, updates: Partial<LineItem>, immediateSave = false) => {
    setItems(prevItems => {
      const newItems = [...prevItems]
      const item = { ...newItems[index] }

      // Apply updates
      Object.assign(item, updates)

      // If user edits quantity, switch calc_source to 'manual'
      if (updates.quantity !== undefined && item.calc_source === 'room_dimensions') {
        item.calc_source = 'manual'
      }

      // Mark as manual if user edits cost fields
      if (updates.labor_cost !== undefined || updates.material_cost !== undefined ||
          updates.overhead_cost !== undefined || updates.direct_cost !== undefined ||
          updates.client_price !== undefined) {
        item.pricing_source = 'manual'
      }

      // Allowance check
      const isAllowance = updates.is_allowance !== undefined
        ? updates.is_allowance
        : (item.is_allowance || (item.description || '').toUpperCase().startsWith('ALLOWANCE:'))
      item.is_allowance = isAllowance ?? false
      if (isAllowance) item.margin_percent = 0

      // Recompute direct_cost + client_price (matches server formula)
      const isCostFieldEdit = (
        updates.labor_cost !== undefined || updates.material_cost !== undefined ||
        updates.overhead_cost !== undefined || updates.direct_cost !== undefined ||
        updates.margin_percent !== undefined || updates.quantity !== undefined ||
        updates.is_allowance !== undefined
      )
      const isClientPriceEdit = updates.client_price !== undefined

      if (isCostFieldEdit || isClientPriceEdit) {
        const { direct_cost, client_price } = computeClientTotals(item, {
          directCostExplicit: updates.direct_cost !== undefined,
          clientPriceExplicit: updates.client_price !== undefined,
        })
        item.direct_cost = direct_cost
        // Only overwrite client_price if user didn't explicitly set it
        if (!isClientPriceEdit) {
          item.client_price = client_price
        } else {
          item.client_price = updates.client_price ?? client_price
        }
      }

      newItems[index] = item

      // Update ref with latest items
      itemsRef.current = newItems

      // Trigger save (debounced unless immediate)
      if (item.id) {
        if (immediateSave) {
          const existingTimeout = saveTimeoutRef.current.get(item.id)
          if (existingTimeout) {
            clearTimeout(existingTimeout)
            saveTimeoutRef.current.delete(item.id)
          }
        }
        saveLineItem(item.id, item)
      }

      return newItems
    })
  }

  const addItem = () => {
    // =============================================================================
    // EDIT LOCK: Block adding items when estimate is not in draft status
    // =============================================================================
    if (isLocked) {
      console.warn(`addItem blocked: estimate is locked (status=${estimateStatus})`)
      toast.error(getLockMessage(estimateStatus))
      return
    }

    setItems(prevItems => [
      ...prevItems,
      {
        room_name: '',
        description: '',
        category: '999 - Other',
        cost_code: '999',
        quantity: 1,
        unit: 'EA',
        // =============================================================================
        // UNPRICED ITEMS: Use null (not 0) to indicate "no price set"
        // =============================================================================
        // null = user has not entered a price yet
        // 0 = user explicitly set the price to $0 (e.g., free item, owner-provided)
        // =============================================================================
        labor_cost: null,
        material_cost: null,
        overhead_cost: null,
        direct_cost: null,
        margin_percent: 30,
        client_price: null,
        pricing_source: null, // No pricing source until priced
        confidence: null
      }
    ])
  }

  const removeItem = async (index: number) => {
    // =============================================================================
    // EDIT LOCK: Block deletes when estimate is not in draft status
    // =============================================================================
    if (isLocked) {
      console.warn(`removeItem blocked: estimate is locked (status=${estimateStatus})`)
      toast.error(getLockMessage(estimateStatus))
      return
    }

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

  // =============================================================================
  // TOTALS: Treat null as 0 for summation, but track unpriced items separately
  // Filter out items from rooms that are excluded from scope (is_in_scope = false)
  // =============================================================================
  const isItemInScope = useCallback((item: LineItem): boolean => {
    if (!item.room_id) return true // No room → always in scope
    return roomScopeMap.get(item.room_id) !== false
  }, [roomScopeMap])

  const grandTotal = items.reduce((sum, item) => {
    if (!isItemInScope(item)) return sum
    return sum + (item.client_price ?? 0)
  }, 0)
  const unpricedItemCount = items.filter(item => isItemInScope(item) && (item.direct_cost === null || item.direct_cost === undefined)).length
  const excludedItemCount = items.filter(item => !isItemInScope(item)).length

  // ═══════════════════════════════════════════════════════════════════════════
  // ROOM SUBTOTALS — client-derived from line item client_price values.
  // Recomputes on every items state change (React memoization-friendly).
  // key = room_name (lowercase), value = { total, count, room_name }
  // ═══════════════════════════════════════════════════════════════════════════
  const roomTotals = React.useMemo(() => {
    const map = new Map<string, { total: number; count: number; room_name: string }>()
    for (const item of items) {
      if (!isItemInScope(item)) continue
      const key = (item.room_name || 'Unassigned').toLowerCase()
      const existing = map.get(key) || { total: 0, count: 0, room_name: item.room_name || 'Unassigned' }
      existing.total += (item.client_price ?? 0)
      existing.count += 1
      map.set(key, existing)
    }
    return map
  }, [items, isItemInScope])

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
    placeholder,
    disabled
  }: {
    value: string
    onChange: (value: string) => void
    onBlur?: () => void
    placeholder?: string
    disabled?: boolean
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
        disabled={disabled}
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
        // Preserve null for unpriced items
        labor_cost: mergedItem.labor_cost ?? null,
        material_cost: mergedItem.material_cost ?? null,
        overhead_cost: mergedItem.overhead_cost ?? null,
        direct_cost: mergedItem.direct_cost ?? (mergedItem.unit_cost && mergedItem.quantity ? mergedItem.unit_cost * mergedItem.quantity : null),
        margin_percent: mergedItem.margin_percent || 30,
        client_price: mergedItem.client_price ?? null,
        pricing_source: (mergedItem.pricing_source as 'task_library' | 'user_library' | 'manual' | null) || null,
        confidence: mergedItem.confidence || null,
        notes: mergedItem.notes ?? undefined
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
          room_id: item.room_id || null,
          description: item.description || null,
          category: categoryInfo.label,
          cost_code: item.cost_code || null, // Don't force 999 - preserve null if not set
          quantity: item.quantity || 1,
          unit: item.unit || 'EA',
          // Preserve null for unpriced items (null ≠ 0)
          labor_cost: item.labor_cost ?? null,
          material_cost: item.material_cost ?? null,
          overhead_cost: item.overhead_cost ?? null,
          direct_cost: item.direct_cost ?? null,
          margin_percent: item.margin_percent || 30,
          client_price: item.client_price ?? null,
          pricing_source: item.pricing_source || null,
          calc_source: item.calc_source || 'manual',
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
          // Preserve null for unpriced items (null ≠ 0)
          labor_cost: item.labor_cost ?? null,
          material_cost: item.material_cost ?? null,
          overhead_cost: item.overhead_cost ?? null,
          direct_cost: item.direct_cost ?? null,
          margin_percent: item.margin_percent || 30,
          client_price: item.client_price ?? null,
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
      {/* Edit Lock Banner - shows when estimate is not in draft status */}
      {isLocked && (
        <Alert className="border-primary/30 bg-primary/5">
          <Lock className="h-4 w-4 text-primary" />
          <AlertDescription className="text-primary">
            {getLockMessage(estimateStatus)}
          </AlertDescription>
        </Alert>
      )}

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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle>Project Estimate</CardTitle>
              <CardDescription className="flex items-center gap-2 flex-wrap">
                <span>{items.length} line items • Total: ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                {unpricedItemCount > 0 && (
                  <span className="text-amber-600 font-medium">
                    • {unpricedItemCount} unpriced
                  </span>
                )}
                {excludedItemCount > 0 && (
                  <span className="text-orange-600 font-medium">
                    • {excludedItemCount} excluded
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={addItem} variant="outline" size="sm" disabled={isLocked} className="min-h-[44px] md:min-h-0">
                <Plus className="mr-1 md:mr-2 h-4 w-4" />
                Add Item
              </Button>
              <Button 
                onClick={generateSpecSheet} 
                disabled={isGeneratingSpecSheet}
                variant="outline"
                size="sm"
                className="min-h-[44px] md:min-h-0"
              >
                {isGeneratingSpecSheet ? (
                  <>
                    <div className="mr-1 md:mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="hidden sm:inline">Generating...</span>
                    <span className="sm:hidden">Gen...</span>
                  </>
                ) : (
                  <>
                    <FileText className="mr-1 md:mr-2 h-4 w-4" />
                    <span className="hidden sm:inline">Generate Spec Sheet</span>
                    <span className="sm:hidden">Spec Sheet</span>
                  </>
                )}
              </Button>
              <Button 
                onClick={handleSmartSave} 
                disabled={isSaving}
                className="bg-green-600 hover:bg-green-700 min-h-[44px] md:min-h-0"
              >
                {isSaving ? (
                  <>
                    <div className="mr-1 md:mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-1 md:mr-2 h-4 w-4" />
                    Save
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
            <Alert className="mb-4 border-primary/30 bg-primary/5">
              <AlertDescription className="text-primary flex items-center justify-between">
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
              <p className="mb-2">No items yet. Click &quot;Add Item&quot; to get started.</p>
              <p className="text-sm">After adding items, fill in the description and select a cost code, then click &quot;Save Estimate&quot; to save them.</p>
            </div>
          ) : (
            <>
            {/* ====== MOBILE CARD VIEW (< md) ====== */}
            <div className="md:hidden space-y-3">
              {items.map((item, index) => {
                const itemId = item.id || `temp-${index}`
                const isExpanded = expandedRows.has(itemId)
                const costInfo = COST_CATEGORIES.find(c => c.code === item.cost_code)
                const costCodeLabel = costInfo?.label || (item.cost_code || 'Unassigned')
                const isAIGenerated = item.pricing_source === 'task_library' || item.pricing_source === 'user_library'
                const itemInScope = isItemInScope(item)

                return (
                  <div key={`mobile-${itemId}`} className={cn("border rounded-lg p-3 space-y-3 bg-card", !itemInScope && "opacity-50 border-dashed")}>
                    {/* Card Header: title + expand toggle */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium truncate">{getTitle(item.description)}</span>
                          {isAIGenerated && (
                            <Badge variant="outline" className="h-5 px-1.5 text-xs shrink-0">
                              <Sparkles className="h-3 w-3 mr-1" />AI
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{item.room_name || 'No room'}</span>
                          <span>•</span>
                          <span>{costCodeLabel}</span>
                          {!itemInScope && (
                            <>
                              <span>•</span>
                              <Badge variant="outline" className="h-4 px-1 text-[10px] text-orange-600 border-orange-300 bg-orange-50">Excluded</Badge>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={cn("text-sm font-semibold", itemInScope ? "text-green-700" : "text-muted-foreground line-through")}>
                          ${(item.client_price ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>

                    {/* Editable fields in a compact grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Label className="text-xs text-muted-foreground">Qty</Label>
                          {/* Calc source badge on mobile */}
                          {item.room_id && isAreaBasedItem({
                            cost_code: item.cost_code,
                            unit: item.unit,
                            description: item.description,
                            category: item.category,
                          }) && (
                            <button
                              type="button"
                              onClick={() => !isLocked && toggleCalcSource(index)}
                              className={cn(
                                "flex items-center gap-0.5 h-5 px-1.5 rounded text-[10px] border cursor-pointer",
                                item.calc_source === 'room_dimensions'
                                  ? "bg-blue-50 text-blue-700 border-blue-200"
                                  : "bg-gray-50 text-gray-500 border-gray-200"
                              )}
                              disabled={isLocked}
                            >
                              {item.calc_source === 'room_dimensions' ? (
                                <><Ruler className="h-2.5 w-2.5" />Auto</>
                              ) : (
                                <><Pencil className="h-2.5 w-2.5" />Manual</>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            value={item.quantity || 1}
                            onChange={(e) => updateItem(index, { quantity: Number(e.target.value) || 1 })}
                            onBlur={() => {
                              const currentItem = itemsRef.current[index]
                              if (currentItem?.id) saveLineItem(currentItem.id, currentItem)
                            }}
                            className="h-10 text-sm text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            min="0" step="0.01" disabled={isLocked}
                          />
                          <Select value={item.unit || 'EA'} onValueChange={(value) => updateItem(index, { unit: value })} disabled={isLocked}>
                            <SelectTrigger className="h-10 text-xs w-[65px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {UNIT_OPTIONS.map(unit => (<SelectItem key={unit} value={unit}>{unit}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Direct Cost</Label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">$</span>
                          <Input
                            type="number"
                            value={item.direct_cost ?? ''}
                            placeholder="0.00"
                            onChange={(e) => {
                              const rawValue = e.target.value
                              const value = rawValue === '' ? null : validateNumeric(rawValue)
                              updateItem(index, { direct_cost: value })
                            }}
                            onBlur={() => {
                              const currentItem = itemsRef.current[index]
                              if (currentItem?.id) saveLineItem(currentItem.id, currentItem)
                            }}
                            className="h-10 text-sm text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            min="0" step="0.01" disabled={isLocked}
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Margin %</Label>
                        {(() => {
                          const isAllowance = item.is_allowance || (item.description || '').toUpperCase().startsWith('ALLOWANCE:')
                          const marginValue = isAllowance ? 0 : (item.margin_percent || 30)
                          return (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                value={marginValue}
                                min={0} max={60}
                                disabled={isAllowance || isLocked}
                                onChange={(e) => {
                                  if (!isAllowance) updateItem(index, { margin_percent: Number(e.target.value) || 0 })
                                }}
                                onBlur={() => {
                                  if (!isAllowance) {
                                    const currentItem = itemsRef.current[index]
                                    if (currentItem?.id) saveLineItem(currentItem.id, currentItem)
                                  }
                                }}
                                className="h-10 text-sm text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <span className="text-xs text-muted-foreground">%</span>
                            </div>
                          )
                        })()}
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Client Price</Label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-green-700 font-semibold">$</span>
                          <Input
                            type="number"
                            value={item.client_price ?? ''}
                            placeholder="—"
                            onChange={(e) => {
                              const rawValue = e.target.value
                              const value = rawValue === '' ? null : validateNumeric(rawValue)
                              updateItem(index, { client_price: value })
                            }}
                            onBlur={() => {
                              const currentItem = itemsRef.current[index]
                              if (currentItem?.id) saveLineItem(currentItem.id, currentItem)
                            }}
                            className={cn(
                              "h-10 text-sm text-right font-semibold tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                              item.client_price != null ? "text-green-700" : "text-muted-foreground"
                            )}
                            min="0" step="0.01" disabled={isLocked}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Expandable details */}
                    <button
                      type="button"
                      onClick={() => toggleRow(itemId)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full min-h-[36px]"
                    >
                      {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {isExpanded ? 'Hide Details' : 'Show Details'}
                    </button>

                    {isExpanded && (
                      <div className="space-y-3 pt-2 border-t">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Description</Label>
                          <DescriptionTextarea
                            value={item.description}
                            onChange={(value) => updateItem(index, { description: value }, false)}
                            onBlur={() => {
                              const currentItem = itemsRef.current[index]
                              if (currentItem?.id) saveLineItem(currentItem.id, currentItem)
                            }}
                            placeholder="Full item description..."
                            disabled={isLocked}
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Room</Label>
                          <SmartRoomInput
                            value={item.room_name || ''}
                            onChange={(value) => updateItem(index, { room_name: value })}
                            onBlur={() => {
                              if (item.id) saveLineItem(item.id, items[index])
                            }}
                            placeholder="Room"
                            options={ROOM_OPTIONS}
                            disabled={isLocked}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Labor</Label>
                            <Input
                              type="number"
                              value={item.labor_cost ?? ''}
                              placeholder="—"
                              onChange={(e) => {
                                const value = e.target.value === '' ? null : validateNumeric(e.target.value)
                                updateItem(index, { labor_cost: value })
                              }}
                              onBlur={() => {
                                const currentItem = itemsRef.current[index]
                                if (currentItem?.id) saveLineItem(currentItem.id, currentItem)
                              }}
                              className="h-10 text-sm text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              min="0" step="0.01" disabled={isLocked}
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Material</Label>
                            <Input
                              type="number"
                              value={item.material_cost ?? ''}
                              placeholder="—"
                              onChange={(e) => {
                                const value = e.target.value === '' ? null : validateNumeric(e.target.value)
                                updateItem(index, { material_cost: value })
                              }}
                              onBlur={() => {
                                const currentItem = itemsRef.current[index]
                                if (currentItem?.id) saveLineItem(currentItem.id, currentItem)
                              }}
                              className="h-10 text-sm text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              min="0" step="0.01" disabled={isLocked}
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Overhead</Label>
                            <Input
                              type="number"
                              value={item.overhead_cost ?? ''}
                              placeholder="—"
                              onChange={(e) => {
                                const value = e.target.value === '' ? null : validateNumeric(e.target.value)
                                updateItem(index, { overhead_cost: value })
                              }}
                              onBlur={() => {
                                const currentItem = itemsRef.current[index]
                                if (currentItem?.id) saveLineItem(currentItem.id, currentItem)
                              }}
                              className="h-10 text-sm text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              min="0" step="0.01" disabled={isLocked}
                            />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <Button
                            onClick={() => removeItem(index)}
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 min-h-[44px]"
                            disabled={isLocked}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* ====== DESKTOP TABLE VIEW (>= md) ====== */}
            <div className="hidden md:block overflow-x-auto">
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
                    const desktopItemInScope = isItemInScope(item)
                    
                    return (
                      <React.Fragment key={itemId}>
                        {/* Primary Row - Always Visible */}
                        <TableRow className={cn("hover:bg-muted/30", !desktopItemInScope && "opacity-50")}>
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
                              <span className={cn("text-sm font-medium truncate", !desktopItemInScope && "line-through")} title={item.description}>
                                {getTitle(item.description)}
                              </span>
                              {!desktopItemInScope && (
                                <Badge variant="outline" className="h-5 px-1 text-[10px] text-orange-600 border-orange-300 bg-orange-50 shrink-0">
                                  Excluded
                                </Badge>
                              )}
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
                              disabled={isLocked}
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
                              disabled={isLoadingCostCodes || isLocked}
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
                            <div className="flex items-center gap-1 min-w-[110px]">
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
                                className="h-7 w-14 text-xs text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                min="0"
                                step="0.01"
                                disabled={isLocked}
                              />
                              <Select
                                value={item.unit || 'EA'}
                                onValueChange={(value) => updateItem(index, { unit: value })}
                                disabled={isLocked}
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
                              {/* Calc source badge + toggle */}
                              {item.room_id && isAreaBasedItem({
                                cost_code: item.cost_code,
                                unit: item.unit,
                                description: item.description,
                                category: item.category,
                              }) && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => !isLocked && toggleCalcSource(index)}
                                        className={cn(
                                          "flex items-center gap-0.5 h-5 px-1 rounded text-[10px] border cursor-pointer transition-colors",
                                          item.calc_source === 'room_dimensions'
                                            ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                                            : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                                        )}
                                        disabled={isLocked}
                                      >
                                        {item.calc_source === 'room_dimensions' ? (
                                          <><Ruler className="h-2.5 w-2.5" />Auto</>
                                        ) : (
                                          <><Pencil className="h-2.5 w-2.5" />Man</>
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[200px]">
                                      {item.calc_source === 'room_dimensions' ? (
                                        <p className="text-xs">
                                          Qty auto-derived from room {(() => {
                                            const field = resolveAreaFieldForLineItem({ cost_code: item.cost_code, unit: item.unit, description: item.description, category: item.category })
                                            return field ? getAreaFieldLabel(field).toLowerCase() : 'area'
                                          })()}.
                                          Click to switch to manual.
                                        </p>
                                      ) : (
                                        <p className="text-xs">
                                          Qty is manually set.
                                          Click to auto-derive from room dimensions.
                                        </p>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right py-1 px-2">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-xs text-muted-foreground">$</span>
                              <Input
                                type="number"
                                value={item.direct_cost ?? ''}
                                placeholder="Enter price"
                                onChange={(e) => {
                                  // Parse value: empty string → null, otherwise number
                                  const rawValue = e.target.value
                                  const value = rawValue === '' ? null : validateNumeric(rawValue)
                                  updateItem(index, { direct_cost: value })
                                }}
                                onBlur={() => {
                                  const currentItem = itemsRef.current[index]
                                  if (currentItem?.id) {
                                    saveLineItem(currentItem.id, currentItem)
                                    // =================================================================
                                    // NO PRICING EVENTS HERE - DRAFTS ARE EXCLUDED
                                    // =================================================================
                                    // Per PRODUCT_CONTEXT.md:
                                    // - pricing_events are logged ONLY at commit moments:
                                    //   * finalizeBid() → stage='bid_final'
                                    //   * markContractSigned() → stage='contract_signed'
                                    // - Draft edits (blur, keystroke) are NOT logged because:
                                    //   1. Contractors experiment with prices before committing
                                    //   2. Logging drafts would capture noise, not signal
                                    //   3. Only committed prices represent "truth"
                                    // =================================================================
                                  }
                                }}
                                className="h-7 w-24 text-xs text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                min="0"
                                step="0.01"
                                disabled={isLocked}
                              />
                              {/* Pricing Badge */}
                              {(() => {
                                const priceSource = (item as any).price_source || item.pricing_source || null
                                if (!priceSource) return null

                                let icon: React.ReactNode
                                let color: string
                                let tooltip: string

                                if (priceSource === 'history' || priceSource === 'actual') {
                                  icon = <History className="h-3 w-3" />
                                  color = 'text-green-600 bg-green-50 border-green-200'
                                  tooltip = 'Price based on your actual costs from completed jobs'
                                } else if (priceSource === 'seed' || priceSource === 'task_library') {
                                  icon = <Database className="h-3 w-3" />
                                  color = 'text-primary bg-primary/5 border-primary/20'
                                  tooltip = 'Estimatix market rate (based on your quality tier)'
                                } else if (priceSource === 'manual' || priceSource === 'manual_override') {
                                  icon = <User className="h-3 w-3" />
                                  color = 'text-yellow-600 bg-yellow-50 border-yellow-200'
                                  tooltip = 'Manually set price'
                                } else {
                                  icon = <InfoIcon className="h-3 w-3" />
                                  color = 'text-gray-600 bg-gray-50 border-gray-200'
                                  tooltip = `Price source: ${priceSource}`
                                }

                                return (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className={cn("ml-1 p-0.5 rounded border cursor-help", color)}>
                                          {icon}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="text-xs">{tooltip}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )
                              })()}
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
                                      disabled={isAllowance || isLocked}
                                      onChange={(e) => {
                                        if (!isAllowance) {
                                          const margin = Number(e.target.value) || 0
                                          updateItem(index, { margin_percent: margin })
                                        }
                                      }}
                                      onBlur={() => {
                                        if (!isAllowance) {
                                          const currentItem = itemsRef.current[index]
                                          if (currentItem?.id) saveLineItem(currentItem.id, currentItem)
                                        }
                                      }}
                                      className={cn(
                                        "h-7 w-14 text-xs text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                        (isAllowance || isLocked) && "bg-muted cursor-not-allowed opacity-70"
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
                                value={item.client_price ?? ''}
                                placeholder="—"
                                onChange={(e) => {
                                  const rawValue = e.target.value
                                  const value = rawValue === '' ? null : validateNumeric(rawValue)
                                  updateItem(index, { client_price: value })
                                }}
                                onBlur={() => {
                                  const currentItem = itemsRef.current[index]
                                  if (currentItem?.id) {
                                    saveLineItem(currentItem.id, currentItem)
                                  }
                                }}
                                className={cn(
                                  "h-7 w-28 text-xs text-right font-semibold tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                  item.client_price != null ? "text-green-700" : "text-muted-foreground"
                                )}
                                min="0"
                                step="0.01"
                                disabled={isLocked}
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
                                    disabled={isLocked}
                                  />
                                </div>

                                {/* Cost Breakdown */}
                                <div className="grid grid-cols-4 gap-4">
                                  <div>
                                    <Label className="text-xs text-muted-foreground mb-1 block">Labor Cost</Label>
                                    <Input
                                      type="number"
                                      value={item.labor_cost ?? ''}
                                      placeholder="—"
                                      onChange={(e) => {
                                        const rawValue = e.target.value
                                        const value = rawValue === '' ? null : validateNumeric(rawValue)
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
                                      disabled={isLocked}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground mb-1 block">Material Cost</Label>
                                    <Input
                                      type="number"
                                      value={item.material_cost ?? ''}
                                      placeholder="—"
                                      onChange={(e) => {
                                        const rawValue = e.target.value
                                        const value = rawValue === '' ? null : validateNumeric(rawValue)
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
                                      disabled={isLocked}
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground mb-1 block">Overhead</Label>
                                    <Input
                                      type="number"
                                      value={item.overhead_cost ?? ''}
                                      placeholder="—"
                                      onChange={(e) => {
                                        const rawValue = e.target.value
                                        const value = rawValue === '' ? null : validateNumeric(rawValue)
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
                                      disabled={isLocked}
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
                                        <Badge variant="outline" className="h-5 text-xs bg-primary/10 text-primary hover:bg-primary/20 border-primary/30">
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
                                  {originalValuesRef.current.has(itemId) && item.pricing_source === 'manual' && !isLocked && (
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
                                    disabled={isLocked}
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
            </>
          )}

          {/* Room Subtotals + Grand Total */}
          {items.length > 0 && (
            <div className="mt-6 pt-4 border-t space-y-4">
              {/* Room Subtotals */}
              {roomTotals.size > 1 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Room Totals</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
                    {Array.from(roomTotals.entries())
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([key, { total, count, room_name }]) => (
                        <div key={key} className="flex items-center justify-between text-sm py-0.5">
                          <span className="text-muted-foreground truncate mr-2">
                            {room_name} <span className="text-xs">({count})</span>
                          </span>
                          <span className="font-medium tabular-nums whitespace-nowrap">
                            ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Grand Total */}
              <div className="flex justify-end pt-2 border-t">
                <div className="text-right">
                  <div className="text-xl md:text-2xl font-bold">
                    Total: ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {items.length} line items
                    {excludedItemCount > 0 && (
                      <span className="text-orange-600"> ({excludedItemCount} excluded from scope)</span>
                    )}
                  </div>
                  {unpricedItemCount > 0 && (
                    <div className="text-sm text-amber-600 font-medium mt-1">
                      ⚠ {unpricedItemCount} item{unpricedItemCount !== 1 ? 's' : ''} missing pricing
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mobile Sticky Total Bar */}
      {items.length > 0 && (
        <div className="md:hidden sticky-bottom-bar flex items-center justify-between rounded-lg shadow-lg">
          <div>
            <div className="text-xs text-muted-foreground">
              {items.length} items
              {excludedItemCount > 0 && <span className="text-orange-600"> · {excludedItemCount} excl.</span>}
            </div>
            {unpricedItemCount > 0 && (
              <div className="text-xs text-amber-600">{unpricedItemCount} unpriced</div>
            )}
          </div>
          <div className="text-lg font-bold text-green-700">
            ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      )}
    </div>
  )
}
