'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Save, AlertTriangle, Plus, Trash2, FileText, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'

// Cost code categories
const COST_CATEGORIES = [
  { label: "Demo (201)", code: "201" },
  { label: "Framing (305)", code: "305" },
  { label: "Plumbing (404)", code: "404" },
  { label: "Electrical (405)", code: "405" },
  { label: "HVAC (402)", code: "402" },
  { label: "Windows (520)", code: "520" },
  { label: "Doors (530)", code: "530" },
  { label: "Cabinets (640)", code: "640" },
  { label: "Countertops (641)", code: "641" },
  { label: "Tile (950)", code: "950" },
  { label: "Flooring (960)", code: "960" },
  { label: "Paint (990)", code: "990" },
  { label: "Other (999)", code: "999" }
]

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
  labor_cost: number
  margin_percent: number
  client_price: number
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
            // Fallback to initialData if database load fails
            if (initialData?.items) {
              setItems(initialData.items.map((item, idx) => ({
                id: `temp-${idx}`,
                room_name: '',
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
            // Load from database
            setItems(data.map(item => ({
              id: item.id,
              room_name: item.room_name || '',
              description: item.description || '',
              category: item.category || COST_CATEGORIES.find(c => c.code === item.cost_code)?.label || 'Other (999)',
              cost_code: item.cost_code || '999',
              labor_cost: item.labor_cost || 0,
              margin_percent: item.margin_percent || 30,
              client_price: item.client_price || 0
            })))
          } else if (initialData?.items) {
            // Fallback to initialData
            setItems(initialData.items.map((item, idx) => ({
              id: `temp-${idx}`,
              room_name: '',
              description: item.description || '',
              category: item.category || 'Other (999)',
              cost_code: '999',
              labor_cost: (item as any).labor_cost || 0,
              margin_percent: (item as any).margin_percent || 30,
              client_price: (item as any).client_price || 0
            })))
          }
        } catch (err) {
          console.error('Error in loadLineItems:', err)
        }
      } else if (initialData?.items) {
        // Use initialData if no estimateId
        setItems(initialData.items.map((item, idx) => ({
          id: `temp-${idx}`,
          room_name: '',
          description: item.description || '',
          category: item.category || 'Other (999)',
          cost_code: '999',
          labor_cost: (item as any).labor_cost || 0,
          margin_percent: (item as any).margin_percent || 30,
          client_price: (item as any).client_price || 0
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

  // Auto-calculate client_price when labor_cost or margin_percent changes
  const updateItem = (index: number, updates: Partial<LineItem>) => {
    setItems(prevItems => {
      const newItems = [...prevItems]
      const item = { ...newItems[index] }
      
      // Apply updates
      Object.assign(item, updates)
      
      // Auto-calculate client_price if labor_cost or margin_percent changed
      if (updates.labor_cost !== undefined || updates.margin_percent !== undefined) {
        const laborCost = updates.labor_cost !== undefined ? updates.labor_cost : item.labor_cost
        const marginPercent = updates.margin_percent !== undefined ? updates.margin_percent : item.margin_percent
        item.client_price = Number(laborCost) * (1 + Number(marginPercent) / 100)
      }
      
      newItems[index] = item
      return newItems
    })
  }

  const addItem = () => {
    setItems(prevItems => [
      ...prevItems,
      {
        room_name: '',
        description: '',
        category: 'Other (999)',
        cost_code: '999',
        labor_cost: 0,
        margin_percent: 30,
        client_price: 0
      }
    ])
  }

  const removeItem = (index: number) => {
    setItems(prevItems => prevItems.filter((_, i) => i !== index))
  }

  const grandTotal = items.reduce((sum, item) => sum + (item.client_price || 0), 0)

  // Auto-expanding textarea component
  const AutoExpandingTextarea = ({ value, onChange, placeholder }: { value: string, onChange: (value: string) => void, placeholder?: string }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget
      textarea.style.height = 'auto'
      textarea.style.height = textarea.scrollHeight + 'px'
      onChange(textarea.value)
    }

    useEffect(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
      }
    }, [value])

    return (
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={handleInput}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded resize-none overflow-hidden min-h-[40px]"
        rows={1}
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
          labor_cost: item.labor_cost || 0,
          margin_percent: item.margin_percent || 30,
          client_price: item.client_price || 0
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
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Labor Cost</TableHead>
                    <TableHead>Margin %</TableHead>
                    <TableHead>Client Price</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCostCodes.map((costCode) => {
                    const costInfo = COST_CATEGORIES.find(c => c.code === costCode)
                    const tradeLabel = costInfo?.label || `Other (${costCode})`
                    const rooms = Object.keys(groupedItems[costCode]).sort()
                    
                    return (
                      <React.Fragment key={costCode}>
                        {/* Trade Header Row */}
                        <TableRow className="bg-muted/50">
                          <TableCell colSpan={7} className="font-bold text-base py-3">
                            {costCode} {tradeLabel.replace(`(${costCode})`, '').trim()}
                          </TableCell>
                        </TableRow>
                        
                        {rooms.map((roomName) => {
                          const roomItems = groupedItems[costCode][roomName]
                          
                          return (
                            <React.Fragment key={`${costCode}-${roomName}`}>
                              {/* Room Subheader Row */}
                              {roomName && roomName !== 'General' && (
                                <TableRow className="bg-muted/30">
                                  <TableCell colSpan={7} className="font-semibold text-sm py-2 pl-8">
                                    {roomName}
                                  </TableCell>
                                </TableRow>
                              )}
                              
                              {/* Items for this room */}
                              {roomItems.map((item, roomItemIndex) => {
                                const globalIndex = item._originalIndex
                                const isCustomRoom = item.room_name && !ROOM_OPTIONS.includes(item.room_name)
                                
                                return (
                                  <TableRow key={item.id || `${costCode}-${roomName}-${roomItemIndex}`}>
                                    <TableCell>
                                      <div className="flex flex-col gap-1 min-w-[150px]">
                                        <Select
                                          value={isCustomRoom ? '__custom__' : (item.room_name || '__custom__')}
                                          onValueChange={(value) => {
                                            if (value === '__custom__') {
                                              updateItem(globalIndex, { room_name: '' })
                                            } else {
                                              updateItem(globalIndex, { room_name: value })
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Select room" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__custom__">Other / Custom</SelectItem>
                                            {ROOM_OPTIONS.map(room => (
                                              <SelectItem key={room} value={room}>{room}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        {(!item.room_name || (item.room_name && !ROOM_OPTIONS.includes(item.room_name))) && (
                                          <Input
                                            className="w-full"
                                            placeholder="Enter room name"
                                            value={item.room_name || ''}
                                            onChange={(e) => updateItem(globalIndex, { room_name: e.target.value })}
                                          />
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <AutoExpandingTextarea
                                        value={item.description}
                                        onChange={(value) => updateItem(globalIndex, { description: value })}
                                        placeholder="Item description"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Select
                                        value={item.cost_code}
                                        onValueChange={(value) => {
                                          const selected = COST_CATEGORIES.find(c => c.code === value)
                                          updateItem(globalIndex, {
                                            cost_code: selected?.code || '999',
                                            category: selected?.label || 'Other (999)'
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
                                    <TableCell>
                                      <Input
                                        type="number"
                                        value={item.labor_cost || ''}
                                        onChange={(e) => {
                                          const labor = Number(e.target.value) || 0
                                          updateItem(globalIndex, { labor_cost: labor })
                                        }}
                                        className="w-24"
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2 min-w-[120px]">
                                        <input
                                          type="range"
                                          min={0}
                                          max={60}
                                          value={item.margin_percent || 30}
                                          onChange={(e) => {
                                            const margin = Number(e.target.value)
                                            updateItem(globalIndex, { margin_percent: margin })
                                          }}
                                          className="flex-1"
                                        />
                                        <Input
                                          type="number"
                                          value={item.margin_percent || 30}
                                          min={0}
                                          max={60}
                                          className="w-16 border px-2 py-1 rounded"
                                          onChange={(e) => {
                                            const margin = Number(e.target.value) || 0
                                            updateItem(globalIndex, { margin_percent: margin })
                                          }}
                                        />
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="font-medium min-w-[100px]">
                                        ${(item.client_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <Button
                                        onClick={() => removeItem(globalIndex)}
                                        variant="ghost"
                                        size="sm"
                                        className="text-red-600 hover:text-red-700"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
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
