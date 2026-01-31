'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, DollarSign, AlertCircle } from 'lucide-react'
import { closeJob, getProjectForClosing } from '@/actions/projects'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import Confetti from 'react-confetti'

interface CloseJobModalProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface Trade {
  cost_code: string
  trade_name: string
  estimated_total: number
  item_count: number
  items: Array<{
    id: string
    description: string
    quantity: number
    unit: string
    direct_cost: number
  }>
}

export function CloseJobModal({ projectId, open, onOpenChange, onSuccess }: CloseJobModalProps) {
  const [trades, setTrades] = useState<Trade[]>([])
  const [actuals, setActuals] = useState<Record<string, string>>({}) // cost_code -> actual cost string
  const [expandedTrades, setExpandedTrades] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (open && projectId) {
      loadProjectData()
      // Set window size for confetti
      setWindowSize({ width: window.innerWidth, height: window.innerHeight })
    } else {
      // Reset state when modal closes
      setTrades([])
      setActuals({})
      setExpandedTrades(new Set())
      setShowConfetti(false)
    }
  }, [open, projectId])

  // Update window size on resize
  useEffect(() => {
    if (!open) return

    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight })
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [open])

  const loadProjectData = async () => {
    setIsLoading(true)
    try {
      const result = await getProjectForClosing(projectId)
      if (result.success && result.data) {
        setTrades(result.data.trades)
        // Initialize actuals with estimated totals (user can edit)
        const initialActuals: Record<string, string> = {}
        for (const trade of result.data.trades) {
          initialActuals[trade.cost_code] = trade.estimated_total.toFixed(2)
        }
        setActuals(initialActuals)
      } else {
        toast.error(result.error || 'Failed to load project data')
      }
    } catch (error) {
      console.error('Error loading project data:', error)
      toast.error('Failed to load project data')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleTrade = (costCode: string) => {
    setExpandedTrades(prev => {
      const next = new Set(prev)
      if (next.has(costCode)) {
        next.delete(costCode)
      } else {
        next.add(costCode)
      }
      return next
    })
  }

  const handleActualChange = (costCode: string, value: string) => {
    // Allow only numbers and decimal point
    const numericValue = value.replace(/[^0-9.]/g, '')
    setActuals(prev => ({
      ...prev,
      [costCode]: numericValue
    }))
  }

  const calculateVariance = (estimated: number, actual: number): { percent: number; amount: number } => {
    if (estimated === 0) return { percent: 0, amount: 0 }
    const amount = actual - estimated
    const percent = (amount / estimated) * 100
    return { percent, amount }
  }

  const handleSubmit = async () => {
    // Validate that all trades have actual costs
    const missingActuals: string[] = []
    for (const trade of trades) {
      const actualValue = actuals[trade.cost_code]
      if (!actualValue || actualValue.trim() === '' || parseFloat(actualValue) < 0) {
        missingActuals.push(trade.trade_name)
      }
    }

    if (missingActuals.length > 0) {
      toast.error(`Please enter actual costs for: ${missingActuals.join(', ')}`)
      return
    }

    setIsSubmitting(true)
    try {
      // Convert string values to numbers
      const actualsMap: Record<string, number> = {}
      for (const [code, value] of Object.entries(actuals)) {
        actualsMap[code] = parseFloat(value) || 0
      }

      const result = await closeJob(projectId, actualsMap)
      
      if (result.success) {
        // Show confetti
        setShowConfetti(true)
        
        // Show success toast
        toast.success('Project Closed! Your future pricing is now smarter.', {
          duration: 5000
        })
        
        // Hide confetti after 3 seconds
        setTimeout(() => {
          setShowConfetti(false)
        }, 3000)
        
        // Close modal after a short delay
        setTimeout(() => {
          onOpenChange(false)
          if (onSuccess) {
            onSuccess()
          }
        }, 1500)
      } else {
        toast.error(result.error || 'Failed to close job')
      }
    } catch (error) {
      console.error('Error closing job:', error)
      toast.error('Failed to close job')
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
  }

  return (
    <>
      {showConfetti && (
        <Confetti
          width={windowSize.width}
          height={windowSize.height}
          recycle={false}
          numberOfPieces={200}
          gravity={0.3}
        />
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Close Job - Enter Actual Costs</DialogTitle>
          <DialogDescription>
            Enter the actual costs for each trade. The system will learn from these values to improve future estimates.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading project data...</div>
        ) : trades.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">No line items found for this project.</div>
        ) : (
          <div className="space-y-4">
            {trades.map((trade) => {
              const actualValue = parseFloat(actuals[trade.cost_code] || '0')
              const variance = calculateVariance(trade.estimated_total, actualValue)
              const isExpanded = expandedTrades.has(trade.cost_code)

              return (
                <Card key={trade.cost_code}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleTrade(trade.cost_code)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                        <div>
                          <CardTitle className="text-lg">{trade.trade_name}</CardTitle>
                          <CardDescription>
                            Code {trade.cost_code} • {trade.item_count} item{trade.item_count !== 1 ? 's' : ''}
                          </CardDescription>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-sm">
                        Est: {formatCurrency(trade.estimated_total)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor={`actual-${trade.cost_code}`}>
                          Actual Total Cost
                        </Label>
                        <div className="relative mt-1">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id={`actual-${trade.cost_code}`}
                            type="text"
                            value={actuals[trade.cost_code] || ''}
                            onChange={(e) => handleActualChange(trade.cost_code, e.target.value)}
                            className="pl-9"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                      <div className="flex items-end">
                        <div className="w-full">
                          <Label className="text-muted-foreground">Variance</Label>
                          <div className={cn(
                            "mt-1 text-lg font-semibold",
                            variance.percent > 0 ? "text-destructive" : 
                            variance.percent < 0 ? "text-green-600" : 
                            "text-muted-foreground"
                          )}>
                            {variance.percent > 0 ? '+' : ''}{variance.percent.toFixed(1)}% 
                            {' '}({variance.amount >= 0 ? '+' : ''}{formatCurrency(variance.amount)})
                          </div>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t">
                        <h4 className="text-sm font-medium mb-2">Line Items ({trade.items.length})</h4>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {trade.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between text-sm p-2 rounded-md bg-muted/50"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{item.description}</p>
                                <p className="text-xs text-muted-foreground">
                                  {item.quantity} {item.unit} × {formatCurrency(item.direct_cost / item.quantity)} = {formatCurrency(item.direct_cost)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}

            <div className="flex items-center gap-2 pt-4 border-t">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Actual costs will be saved to your cost library and used to improve future estimates.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Closing Job...
                  </>
                ) : (
                  'Mark Complete'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  )
}

