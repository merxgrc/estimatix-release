'use client'

/**
 * Estimate vs Actual Summary
 * 
 * Displays a comparison of estimated vs actual costs after job completion.
 * Shows:
 * - Summary metrics (total estimate, total actual, variance)
 * - Per-line-item breakdown (if available)
 * - Visual indicators for over/under budget items
 */

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Loader2, TrendingUp, TrendingDown, Minus, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { getProjectActuals } from '@/actions/job-actuals'
import { supabase } from '@/lib/supabase/client'
import type { ProjectActuals, LineItemActuals } from '@/types/db'

interface EstimateVsActualSummaryProps {
  projectId: string
  estimateId: string
}

interface EstimateLineItem {
  id: string
  description: string | null
  room_name: string | null
  category: string | null
  quantity: number | null
  unit: string | null
  direct_cost: number | null
}

interface LineItemComparison {
  lineItem: EstimateLineItem
  actual: LineItemActuals | null
  variance: number | null
  variancePercent: number | null
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

export function EstimateVsActualSummary({ projectId, estimateId }: EstimateVsActualSummaryProps) {
  const [loading, setLoading] = useState(true)
  const [actuals, setActuals] = useState<ProjectActuals | null>(null)
  const [lineItemActuals, setLineItemActuals] = useState<LineItemActuals[]>([])
  const [lineItems, setLineItems] = useState<EstimateLineItem[]>([])
  const [estimatedTotal, setEstimatedTotal] = useState<number | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      // Fetch project actuals
      const actualsResult = await getProjectActuals(projectId)
      if (!actualsResult.success) {
        setError(actualsResult.error || 'Failed to load actuals')
        return
      }
      
      setActuals(actualsResult.actuals || null)
      setLineItemActuals(actualsResult.lineItemActuals || [])
      
      // Fetch estimate total
      const { data: estimate } = await supabase
        .from('estimates')
        .select('total')
        .eq('id', estimateId)
        .single()
      
      setEstimatedTotal(estimate?.total ?? null)
      
      // Fetch line items
      const { data: items } = await supabase
        .from('estimate_line_items')
        .select('id, description, room_name, category, quantity, unit, direct_cost')
        .eq('estimate_id', estimateId)
        .order('room_name', { ascending: true })
        .order('category', { ascending: true })
      
      setLineItems(items || [])
    } catch (err) {
      setError('Failed to load comparison data')
      console.error('Error fetching estimate vs actual data:', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, estimateId])
  
  useEffect(() => {
    fetchData()
  }, [fetchData])
  
  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading comparison...</span>
        </CardContent>
      </Card>
    )
  }
  
  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-red-500">
          <AlertCircle className="h-5 w-5 mr-2" />
          <span>{error}</span>
        </CardContent>
      </Card>
    )
  }
  
  if (!actuals) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No actuals recorded yet</p>
        </CardContent>
      </Card>
    )
  }
  
  // Calculate variance
  const totalActual = actuals.total_actual_cost || 0
  const totalEstimate = estimatedTotal || 0
  const variance = totalActual - totalEstimate
  const variancePercent = totalEstimate > 0 ? (variance / totalEstimate) * 100 : 0
  const isOverBudget = variance > 0
  const isUnderBudget = variance < 0
  const isOnBudget = variance === 0
  
  // Calculate accuracy score (100% = perfect, lower = worse)
  const accuracyScore = totalEstimate > 0 
    ? Math.max(0, 100 - Math.abs(variancePercent))
    : 100
  
  // Build line item comparisons
  const lineItemComparisons: LineItemComparison[] = lineItems.map(item => {
    const actual = lineItemActuals.find(a => a.line_item_id === item.id) || null
    const estimatedCost = item.direct_cost || 0
    const actualCost = actual?.actual_direct_cost || 0
    
    return {
      lineItem: item,
      actual,
      variance: actual ? actualCost - estimatedCost : null,
      variancePercent: actual && estimatedCost > 0 
        ? ((actualCost - estimatedCost) / estimatedCost) * 100 
        : null
    }
  })
  
  // Count items over/under
  const itemsOverBudget = lineItemComparisons.filter(c => c.variance != null && c.variance > 0).length
  const itemsUnderBudget = lineItemComparisons.filter(c => c.variance != null && c.variance < 0).length
  const itemsOnBudget = lineItemComparisons.filter(c => c.variance != null && c.variance === 0).length
  
  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Project Complete
          </CardTitle>
          <CardDescription>
            Closed on {actuals.closed_at ? new Date(actuals.closed_at).toLocaleDateString() : 'N/A'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Big Numbers */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Estimated</p>
              <p className="text-2xl font-bold">{formatCurrency(totalEstimate)}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Actual</p>
              <p className="text-2xl font-bold">{formatCurrency(totalActual)}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Variance</p>
              <p className={`text-2xl font-bold ${isOverBudget ? 'text-red-600' : isUnderBudget ? 'text-green-600' : 'text-muted-foreground'}`}>
                {isOverBudget ? '+' : ''}{formatCurrency(variance)}
              </p>
            </div>
          </div>
          
          {/* Variance Badge */}
          <div className="flex items-center justify-center gap-2">
            {isOverBudget && (
              <>
                <TrendingUp className="h-5 w-5 text-red-500" />
                <Badge variant="destructive" className="text-sm">
                  Over budget by {variancePercent.toFixed(1)}%
                </Badge>
              </>
            )}
            {isUnderBudget && (
              <>
                <TrendingDown className="h-5 w-5 text-green-500" />
                <Badge className="bg-green-100 text-green-800 border-green-200 text-sm">
                  Under budget by {Math.abs(variancePercent).toFixed(1)}%
                </Badge>
              </>
            )}
            {isOnBudget && (
              <>
                <Minus className="h-5 w-5 text-muted-foreground" />
                <Badge variant="secondary" className="text-sm">
                  On budget
                </Badge>
              </>
            )}
          </div>
          
          {/* Accuracy Score */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Estimation Accuracy</span>
              <span className="font-medium">{accuracyScore.toFixed(1)}%</span>
            </div>
            <Progress 
              value={accuracyScore} 
              className={`h-2 ${accuracyScore >= 90 ? '[&>div]:bg-green-500' : accuracyScore >= 70 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-red-500'}`}
            />
            <p className="text-xs text-muted-foreground text-center">
              {accuracyScore >= 90 
                ? 'Excellent estimation accuracy!' 
                : accuracyScore >= 70 
                  ? 'Good estimation accuracy' 
                  : 'Room for improvement in estimation'}
            </p>
          </div>
          
          {/* Cost Breakdown if available */}
          {(actuals.total_actual_labor_cost || actuals.total_actual_material_cost || actuals.actual_labor_hours) && (
            <div className="border-t pt-4 mt-4">
              <p className="text-sm font-medium mb-3">Cost Breakdown</p>
              <div className="grid grid-cols-3 gap-4 text-sm">
                {actuals.total_actual_labor_cost != null && (
                  <div>
                    <p className="text-muted-foreground">Labor Cost</p>
                    <p className="font-medium">{formatCurrency(actuals.total_actual_labor_cost)}</p>
                  </div>
                )}
                {actuals.total_actual_material_cost != null && (
                  <div>
                    <p className="text-muted-foreground">Material Cost</p>
                    <p className="font-medium">{formatCurrency(actuals.total_actual_material_cost)}</p>
                  </div>
                )}
                {actuals.actual_labor_hours != null && (
                  <div>
                    <p className="text-muted-foreground">Labor Hours</p>
                    <p className="font-medium">{actuals.actual_labor_hours.toFixed(1)} hrs</p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Notes */}
          {actuals.notes && (
            <div className="border-t pt-4 mt-4">
              <p className="text-sm font-medium mb-2">Notes</p>
              <p className="text-sm text-muted-foreground">{actuals.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Line Item Details (Collapsible) */}
      {lineItemActuals.length > 0 && (
        <Card>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              {showDetails ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="font-medium">Line Item Details</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {itemsOverBudget > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {itemsOverBudget} over
                </Badge>
              )}
              {itemsUnderBudget > 0 && (
                <Badge className="bg-green-100 text-green-800 text-xs">
                  {itemsUnderBudget} under
                </Badge>
              )}
              {itemsOnBudget > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {itemsOnBudget} on budget
                </Badge>
              )}
            </div>
          </button>
          
          {showDetails && (
            <CardContent className="pt-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Item</TableHead>
                    <TableHead className="text-right w-[120px]">Estimated</TableHead>
                    <TableHead className="text-right w-[120px]">Actual</TableHead>
                    <TableHead className="text-right w-[120px]">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItemComparisons
                    .filter(c => c.actual != null)
                    .map(({ lineItem, actual, variance: itemVariance, variancePercent: itemVariancePercent }) => (
                      <TableRow key={lineItem.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm truncate max-w-[200px]" title={lineItem.description || ''}>
                              {lineItem.description || 'Untitled item'}
                            </span>
                            {(lineItem.room_name || lineItem.category) && (
                              <span className="text-xs text-muted-foreground">
                                {[lineItem.category, lineItem.room_name].filter(Boolean).join(' • ')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrencyPrecise(lineItem.direct_cost)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrencyPrecise(actual?.actual_direct_cost)}
                        </TableCell>
                        <TableCell className="text-right">
                          {itemVariance != null && (
                            <div className={`flex items-center justify-end gap-1 ${
                              itemVariance > 0 ? 'text-red-600' : 
                              itemVariance < 0 ? 'text-green-600' : 
                              'text-muted-foreground'
                            }`}>
                              {itemVariance > 0 && <TrendingUp className="h-3 w-3" />}
                              {itemVariance < 0 && <TrendingDown className="h-3 w-3" />}
                              <span className="tabular-nums text-sm">
                                {itemVariance > 0 ? '+' : ''}{formatCurrencyPrecise(itemVariance)}
                              </span>
                              {itemVariancePercent != null && (
                                <span className="text-xs">
                                  ({itemVariancePercent > 0 ? '+' : ''}{itemVariancePercent.toFixed(0)}%)
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
