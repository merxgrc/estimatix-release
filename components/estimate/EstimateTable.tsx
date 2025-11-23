'use client'

import { useState, useEffect } from 'react'
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

interface LineItem {
  category: 'Windows' | 'Doors' | 'Cabinets' | 'Flooring' | 'Plumbing' | 'Electrical' | 'Other'
  description: string
  quantity: number
  dimensions?: {
    unit: 'in' | 'ft' | 'cm' | 'm'
    width: number
    height: number
    depth?: number
  } | null
  unit_cost?: number
  total?: number
  notes?: string
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
  const [items, setItems] = useState<LineItem[]>(initialData?.items || [])
  const [missingInfo, setMissingInfo] = useState<string[]>(initialData?.missing_info || [])
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false)
  const [proposalUrl, setProposalUrl] = useState<string | null>(null)
  const [blockedActionMessage, setBlockedActionMessage] = useState<string | null>(null)
  const { user } = useAuth()

  // Update items and missingInfo when initialData changes
  useEffect(() => {
    if (initialData) {
      setItems(initialData.items || [])
      setMissingInfo(initialData.missing_info || [])
    } else {
      setItems([])
      setMissingInfo([])
    }
  }, [initialData])

  // Auto-compute totals when items change
  useEffect(() => {
    setItems(prevItems => 
      prevItems.map(item => ({
        ...item,
        total: item.unit_cost && item.quantity ? item.unit_cost * item.quantity : undefined
      }))
    )
  }, [])

  const updateItem = (index: number, field: keyof LineItem, value: any) => {
    setItems(prevItems => {
      const newItems = [...prevItems]
      const item = { ...newItems[index] }
      
      if (field === 'unit_cost' || field === 'quantity') {
        (item as any)[field] = value
        // Auto-compute total
        if (item.unit_cost && item.quantity) {
          item.total = item.unit_cost * item.quantity
        } else {
          item.total = undefined
        }
      } else {
        (item as any)[field] = value
      }
      
      newItems[index] = item
      return newItems
    })
  }

  const addItem = () => {
    setItems(prevItems => [
      ...prevItems,
      {
        category: 'Other',
        description: '',
        quantity: 1,
        dimensions: null,
        unit_cost: undefined,
        total: undefined,
        notes: ''
      }
    ])
  }

  const removeItem = (index: number) => {
    setItems(prevItems => prevItems.filter((_, i) => i !== index))
  }

  const grandTotal = items.reduce((sum, item) => sum + (item.total || 0), 0)

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

    setIsSaving(true)
    setError(null)

    try {
      const estimateData: EstimateData = {
        items,
        assumptions: initialData?.assumptions || [],
        missing_info: missingInfo
      }

      // If we have an existing estimate ID, update it directly
      if (estimateId) {
        const { data, error: updateError } = await supabase
          .from('estimates')
          .update({
            json_data: estimateData,
            total: grandTotal,
            ai_summary: `Updated estimate with ${items.length} line items`
          })
          .eq('id', estimateId)
          .select()
          .single()

        if (updateError) {
          throw new Error(`Failed to update estimate: ${updateError.message}`)
        }

        setSaveSuccess(true)
        onSave?.(data.id, grandTotal)
        return
      }

      // If we have initialData and a valid projectId, try to find existing estimate
      if (initialData && projectId && projectId !== 'null') {
        const { data: existingEstimate, error: fetchError } = await supabase
          .from('estimates')
          .select('id')
          .eq('project_id', projectId)
          .single()

        if (fetchError && fetchError.code !== 'PGRST116') {
          throw new Error(`Failed to fetch existing estimate: ${fetchError.message}`)
        }

        if (existingEstimate) {
          // Update existing estimate
          const { data, error: updateError } = await supabase
            .from('estimates')
            .update({
              json_data: estimateData,
              total: grandTotal,
              ai_summary: `Updated estimate with ${items.length} line items`
            })
            .eq('id', existingEstimate.id)
            .select()
            .single()

          if (updateError) {
            throw new Error(`Failed to update estimate: ${updateError.message}`)
          }

          setSaveSuccess(true)
          onSave?.(data.id, grandTotal)
          return
        }
      }

      // Create new estimate (only set project_id if it's valid)
      const insertData: any = {
        json_data: estimateData,
        total: grandTotal,
        ai_summary: `Created estimate with ${items.length} line items`
      }

      // Only add project_id if it's a valid UUID (not null, undefined, or "null")
      if (projectId && projectId !== 'null' && projectId !== 'undefined') {
        insertData.project_id = projectId
      }

      const { data, error: insertError } = await supabase
        .from('estimates')
        .insert(insertData)
        .select()
        .single()

      if (insertError) {
        throw new Error(`Failed to create estimate: ${insertError.message}`)
      }

      setSaveSuccess(true)
      onSave?.(data.id, grandTotal)

    } catch (err) {
      console.error('Save estimate error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save estimate')
    } finally {
      setIsSaving(false)
    }
  }

  const formatDimensions = (dimensions: LineItem['dimensions']) => {
    if (!dimensions) return ''
    const { width, height, depth, unit } = dimensions
    return depth 
      ? `${width}×${height}×${depth} ${unit}`
      : `${width}×${height} ${unit}`
  }

  const generateProposal = async () => {
    const hasItems = items.length > 0

    if (!hasItems) {
      setBlockedActionMessage('Create an estimate first by using the record feature or by adding line items manually.')
      setTimeout(() => setBlockedActionMessage(null), 5000)
      return
    }

    if (!estimateId) {
      setBlockedActionMessage('Please save the estimate first before generating a proposal.')
      setTimeout(() => setBlockedActionMessage(null), 5000)
      return
    }

    setIsGeneratingProposal(true)
    setError(null)
    setProposalUrl(null)

    try {
      const response = await fetch(`/api/proposals/${estimateId}/pdf`, {
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
                {items.length} line items • Total: ${grandTotal.toLocaleString()}
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
                    <TableHead>Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Dimensions</TableHead>
                    <TableHead>Unit Cost</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="space-y-1">
                          <Input
                            value={item.description}
                            onChange={(e) => updateItem(index, 'description', e.target.value)}
                            placeholder="Item description"
                            className="min-w-[200px]"
                          />
                          {item.notes && (
                            <Input
                              value={item.notes}
                              onChange={(e) => updateItem(index, 'notes', e.target.value)}
                              placeholder="Notes"
                              className="text-xs"
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.category}
                          onValueChange={(value) => updateItem(index, 'category', value)}
                        >
                          <SelectTrigger className="w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Windows">Windows</SelectItem>
                            <SelectItem value="Doors">Doors</SelectItem>
                            <SelectItem value="Cabinets">Cabinets</SelectItem>
                            <SelectItem value="Flooring">Flooring</SelectItem>
                            <SelectItem value="Plumbing">Plumbing</SelectItem>
                            <SelectItem value="Electrical">Electrical</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                          className="w-20"
                          min="0"
                          step="0.1"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {item.dimensions ? (
                            <div className="text-sm">
                              {formatDimensions(item.dimensions)}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">No dimensions</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={item.unit_cost || ''}
                          onChange={(e) => updateItem(index, 'unit_cost', Number(e.target.value) || undefined)}
                          placeholder="0.00"
                          className="w-24"
                          min="0"
                          step="0.01"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {item.total ? `$${item.total.toLocaleString()}` : '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          onClick={() => removeItem(index)}
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
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
                    Total: ${grandTotal.toLocaleString()}
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
