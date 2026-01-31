'use client'

/**
 * Close Out Project Dialog
 * 
 * Minimal UI for recording actual costs after job completion.
 * Per PRODUCT_CONTEXT.md Phase 1.5:
 * - Actuals are stored SEPARATELY from estimates (never overwrite)
 * - Actuals can ONLY be entered when estimate.status = 'contract_signed'
 * - Once completed, actuals become read-only
 */

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, AlertCircle, CheckCircle, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { closeOutProject, canCloseOutProject, type CloseOutProjectInput, type LineItemActualInput } from '@/actions/job-actuals'
import { supabase } from '@/lib/supabase/client'

interface CloseOutProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  estimateId: string
  projectName: string
  onSuccess: () => void
}

interface EstimateLineItem {
  id: string
  description: string | null
  room_name: string | null
  category: string | null
  quantity: number | null
  unit: string | null
  direct_cost: number | null
  client_price: number | null
}

interface LineItemActualState {
  actualUnitCost: string
  actualQuantity: string
  actualLaborHours: string
  notes: string
  hasChanges: boolean
}

const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0)

const formatCurrencyPrecise = (value: number | null | undefined) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)

export function CloseOutProjectDialog({
  open,
  onOpenChange,
  projectId,
  estimateId,
  projectName,
  onSuccess
}: CloseOutProjectDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(true)
  const [canCloseOut, setCanCloseOut] = useState(false)
  const [eligibilityError, setEligibilityError] = useState<string | null>(null)
  const [estimatedTotal, setEstimatedTotal] = useState<number | null>(null)
  
  // Line items state
  const [lineItems, setLineItems] = useState<EstimateLineItem[]>([])
  const [lineItemActuals, setLineItemActuals] = useState<Record<string, LineItemActualState>>({})
  const [showLineItems, setShowLineItems] = useState(false)
  
  // Form state
  const [totalActualCost, setTotalActualCost] = useState('')
  const [actualLaborHours, setActualLaborHours] = useState('')
  const [totalActualLaborCost, setTotalActualLaborCost] = useState('')
  const [totalActualMaterialCost, setTotalActualMaterialCost] = useState('')
  const [notes, setNotes] = useState('')
  
  // Fetch line items for the estimate
  const fetchLineItems = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('estimate_line_items')
        .select('id, description, room_name, category, quantity, unit, direct_cost, client_price')
        .eq('estimate_id', estimateId)
        .order('room_name', { ascending: true })
        .order('category', { ascending: true })
      
      if (error) {
        console.error('Error fetching line items:', error)
        return
      }
      
      setLineItems(data || [])
      
      // Initialize actuals state for each line item
      const actualsState: Record<string, LineItemActualState> = {}
      for (const item of (data || [])) {
        actualsState[item.id] = {
          actualUnitCost: '',
          actualQuantity: item.quantity?.toString() || '',
          actualLaborHours: '',
          notes: '',
          hasChanges: false
        }
      }
      setLineItemActuals(actualsState)
    } catch (error) {
      console.error('Error fetching line items:', error)
    }
  }, [estimateId])
  
  // Check eligibility when dialog opens
  useEffect(() => {
    if (open) {
      checkEligibility()
      fetchLineItems()
    }
  }, [open, projectId, estimateId, fetchLineItems])
  
  const checkEligibility = async () => {
    setIsCheckingEligibility(true)
    setEligibilityError(null)
    
    try {
      const result = await canCloseOutProject(projectId, estimateId)
      setCanCloseOut(result.canCloseOut)
      setEstimatedTotal(result.estimatedTotal || null)
      
      if (!result.canCloseOut) {
        setEligibilityError(result.reason || 'Cannot close out this project')
      }
    } catch (error) {
      setEligibilityError('Failed to check eligibility')
      setCanCloseOut(false)
    } finally {
      setIsCheckingEligibility(false)
    }
  }
  
  const updateLineItemActual = (lineItemId: string, field: keyof LineItemActualState, value: string) => {
    setLineItemActuals(prev => ({
      ...prev,
      [lineItemId]: {
        ...prev[lineItemId],
        [field]: value,
        hasChanges: true
      }
    }))
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const actualCost = parseFloat(totalActualCost)
    if (isNaN(actualCost) || actualCost <= 0) {
      toast.error('Please enter a valid total actual cost')
      return
    }
    
    setIsLoading(true)
    
    try {
      // Prepare line item actuals (only those with changes)
      const lineItemActualsInput: LineItemActualInput[] = []
      for (const [lineItemId, state] of Object.entries(lineItemActuals)) {
        if (state.hasChanges && state.actualUnitCost) {
          lineItemActualsInput.push({
            lineItemId,
            actualUnitCost: state.actualUnitCost ? parseFloat(state.actualUnitCost) : null,
            actualQuantity: state.actualQuantity ? parseFloat(state.actualQuantity) : null,
            actualLaborHours: state.actualLaborHours ? parseFloat(state.actualLaborHours) : null,
            notes: state.notes || null
          })
        }
      }
      
      const input: CloseOutProjectInput = {
        projectId,
        estimateId,
        totalActualCost: actualCost,
        actualLaborHours: actualLaborHours ? parseFloat(actualLaborHours) : null,
        totalActualLaborCost: totalActualLaborCost ? parseFloat(totalActualLaborCost) : null,
        totalActualMaterialCost: totalActualMaterialCost ? parseFloat(totalActualMaterialCost) : null,
        notes: notes || null,
        lineItemActuals: lineItemActualsInput.length > 0 ? lineItemActualsInput : undefined
      }
      
      const result = await closeOutProject(input)
      
      if (!result.success) {
        toast.error(result.error || 'Failed to close out project')
        return
      }
      
      toast.success('Project closed out successfully!')
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      toast.error('An error occurred while closing out the project')
    } finally {
      setIsLoading(false)
    }
  }
  
  // Calculate variance for display
  const actualCostNum = parseFloat(totalActualCost) || 0
  const variance = estimatedTotal != null && actualCostNum > 0
    ? actualCostNum - estimatedTotal
    : null
  const variancePercent = estimatedTotal != null && estimatedTotal > 0 && actualCostNum > 0
    ? ((actualCostNum - estimatedTotal) / estimatedTotal) * 100
    : null
  
  const getVarianceIcon = () => {
    if (variance === null) return <Minus className="h-4 w-4" />
    if (variance > 0) return <TrendingUp className="h-4 w-4 text-red-500" />
    if (variance < 0) return <TrendingDown className="h-4 w-4 text-green-500" />
    return <Minus className="h-4 w-4 text-muted-foreground" />
  }
  
  const getVarianceColor = () => {
    if (variance === null) return 'text-muted-foreground'
    if (variance > 0) return 'text-red-600'
    if (variance < 0) return 'text-green-600'
    return 'text-muted-foreground'
  }
  
  // Count line items with actuals entered
  const lineItemsWithActuals = Object.values(lineItemActuals).filter(
    state => state.hasChanges && state.actualUnitCost
  ).length
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Close Out Project</DialogTitle>
          <DialogDescription>
            Record actual costs for "{projectName}". This data will be stored separately from your estimate.
          </DialogDescription>
        </DialogHeader>
        
        {isCheckingEligibility ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Checking eligibility...</span>
          </div>
        ) : eligibilityError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{eligibilityError}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Estimate Summary */}
            {estimatedTotal != null && (
              <Card className="bg-muted/50">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-medium">Original Estimate</CardTitle>
                </CardHeader>
                <CardContent className="py-2">
                  <div className="text-2xl font-bold">{formatCurrency(estimatedTotal)}</div>
                </CardContent>
              </Card>
            )}
            
            {/* Actual Total Cost (Required) */}
            <div className="space-y-2">
              <Label htmlFor="totalActualCost" className="text-base font-medium">
                Total Actual Cost <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="totalActualCost"
                  type="number"
                  value={totalActualCost}
                  onChange={(e) => setTotalActualCost(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 text-lg"
                  min="0"
                  step="0.01"
                  required
                />
              </div>
              
              {/* Variance Display */}
              {variance !== null && (
                <div className={`flex items-center gap-2 mt-2 text-sm ${getVarianceColor()}`}>
                  {getVarianceIcon()}
                  <span>
                    {variance > 0 ? 'Over' : variance < 0 ? 'Under' : 'On'} budget by{' '}
                    {formatCurrency(Math.abs(variance))}
                    {variancePercent !== null && ` (${variancePercent > 0 ? '+' : ''}${variancePercent.toFixed(1)}%)`}
                  </span>
                </div>
              )}
            </div>
            
            {/* Optional Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="totalActualLaborCost">Labor Cost</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="totalActualLaborCost"
                    type="number"
                    value={totalActualLaborCost}
                    onChange={(e) => setTotalActualLaborCost(e.target.value)}
                    placeholder="0.00"
                    className="pl-7"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="totalActualMaterialCost">Material Cost</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="totalActualMaterialCost"
                    type="number"
                    value={totalActualMaterialCost}
                    onChange={(e) => setTotalActualMaterialCost(e.target.value)}
                    placeholder="0.00"
                    className="pl-7"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="actualLaborHours">Total Labor Hours</Label>
              <Input
                id="actualLaborHours"
                type="number"
                value={actualLaborHours}
                onChange={(e) => setActualLaborHours(e.target.value)}
                placeholder="0"
                min="0"
                step="0.5"
              />
            </div>
            
            {/* Per-Line-Item Actuals (Collapsible) */}
            {lineItems.length > 0 && (
              <div className="border rounded-lg">
                <button
                  type="button"
                  onClick={() => setShowLineItems(!showLineItems)}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {showLineItems ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <span className="font-medium">Per-Item Actuals (Optional)</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {lineItemsWithActuals > 0 
                      ? `${lineItemsWithActuals} of ${lineItems.length} items entered`
                      : `${lineItems.length} items`}
                  </span>
                </button>
                
                {showLineItems && (
                  <div className="border-t p-4 overflow-x-auto">
                    <p className="text-sm text-muted-foreground mb-4">
                      Enter actual costs for individual line items. Leave blank to skip.
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[200px]">Item</TableHead>
                          <TableHead className="text-right w-[100px]">Est. Cost</TableHead>
                          <TableHead className="w-[120px]">Actual $/Unit</TableHead>
                          <TableHead className="w-[100px]">Actual Qty</TableHead>
                          <TableHead className="w-[100px]">Hours</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lineItems.map((item) => {
                          const state = lineItemActuals[item.id] || {
                            actualUnitCost: '',
                            actualQuantity: '',
                            actualLaborHours: '',
                            notes: '',
                            hasChanges: false
                          }
                          
                          // Calculate estimated unit cost
                          const estimatedUnitCost = item.quantity && item.quantity > 0 && item.direct_cost != null
                            ? item.direct_cost / item.quantity
                            : null
                          
                          return (
                            <TableRow key={item.id}>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium text-sm truncate max-w-[200px]" title={item.description || ''}>
                                    {item.description || 'Untitled item'}
                                  </span>
                                  {(item.room_name || item.category) && (
                                    <span className="text-xs text-muted-foreground">
                                      {[item.category, item.room_name].filter(Boolean).join(' • ')}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                {item.direct_cost != null ? formatCurrencyPrecise(item.direct_cost) : '—'}
                                {estimatedUnitCost != null && (
                                  <div className="text-xs text-muted-foreground">
                                    ({formatCurrencyPrecise(estimatedUnitCost)}/{item.unit || 'ea'})
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={state.actualUnitCost}
                                  onChange={(e) => updateLineItemActual(item.id, 'actualUnitCost', e.target.value)}
                                  placeholder={estimatedUnitCost != null ? estimatedUnitCost.toFixed(2) : '0.00'}
                                  className="h-8 text-sm"
                                  min="0"
                                  step="0.01"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={state.actualQuantity}
                                  onChange={(e) => updateLineItemActual(item.id, 'actualQuantity', e.target.value)}
                                  placeholder={item.quantity?.toString() || '1'}
                                  className="h-8 text-sm"
                                  min="0"
                                  step="0.01"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={state.actualLaborHours}
                                  onChange={(e) => updateLineItemActual(item.id, 'actualLaborHours', e.target.value)}
                                  placeholder="0"
                                  className="h-8 text-sm"
                                  min="0"
                                  step="0.5"
                                />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about the actual costs..."
                rows={3}
              />
            </div>
            
            {/* Info Box */}
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Actual costs are stored separately and will never overwrite your estimate.
                This data helps improve future estimation accuracy.
              </AlertDescription>
            </Alert>
            
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Closing Out...
                  </>
                ) : (
                  'Close Out Project'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
