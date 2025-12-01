'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import type { Project, Estimate } from "@/types/db"
import { supabase } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth-context"
import { Sparkles, AlertTriangle, CheckCircle2, Circle, Save, DollarSign } from "lucide-react"
import { toast } from 'sonner'

// Cost code categories for display
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

interface LineItem {
  id: string
  estimate_id: string
  project_id: string
  room_name: string | null
  description: string | null
  cost_code: string | null
  category: string | null
  quantity: number | null
  unit: string | null
  labor_cost: number | null
  material_cost: number | null
  overhead_cost: number | null
  direct_cost: number | null
  unit_labor_cost: number | null
  unit_material_cost: number | null
  unit_total_cost: number | null
  total_direct_cost: number | null
  pricing_source: 'task_library' | 'user_library' | 'manual' | null
  confidence: number | null
  margin_percent: number | null
  client_price: number | null
  task_library_id?: string | null
  matched_via?: 'semantic' | 'fuzzy' | 'cost_code_only' | null
}

interface PricingTabProps {
  project: Project
  estimates: Estimate[]
  activeEstimateId: string | null
}

// Group by scope (category) then room
function groupByScopeThenRoom(items: LineItem[]) {
  const byScope: Record<string, Record<string, LineItem[]>> = {}
  
  items.forEach(item => {
    const scope = item.category || item.cost_code || "Other"
    const room = item.room_name || "General"
    
    if (!byScope[scope]) {
      byScope[scope] = {}
    }
    if (!byScope[scope][room]) {
      byScope[scope][room] = []
    }
    byScope[scope][room].push(item)
  })
  
  return byScope
}

// Confidence badge component
function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-gray-400">—</span>
  }
  
  const color = value > 90 ? "text-green-600" :
                value > 60 ? "text-yellow-600" :
                "text-red-600"
  
  return (
    <span className={`text-xs font-medium ${color}`}>
      {value}%
    </span>
  )
}

export function PricingTab({ project, estimates, activeEstimateId }: PricingTabProps) {
  const router = useRouter()
  const { user } = useAuth()
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isApplyingPricing, setIsApplyingPricing] = useState(false)
  const [applySuccess, setApplySuccess] = useState(false)
  const [updatingMargins, setUpdatingMargins] = useState<Set<string>>(new Set())
  const [savingOverrides, setSavingOverrides] = useState<Set<string>>(new Set())

  // Load line items when estimate changes
  useEffect(() => {
    const loadLineItems = async () => {
      if (!activeEstimateId) {
        setLineItems([])
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        const { data, error: fetchError } = await supabase
          .from('estimate_line_items')
          .select('*')
          .eq('estimate_id', activeEstimateId)
          .order('created_at', { ascending: true })

        if (fetchError) {
          throw new Error(`Failed to load line items: ${fetchError.message}`)
        }

        setLineItems(data || [])
      } catch (err) {
        console.error('Error loading line items:', err)
        setError(err instanceof Error ? err.message : 'Failed to load line items')
      } finally {
        setIsLoading(false)
      }
    }

    loadLineItems()
  }, [activeEstimateId])

  // Handle Apply Pricing button
  const handleApplyPricing = async () => {
    if (!activeEstimateId) {
      setError('No estimate selected')
      return
    }

    try {
      setIsApplyingPricing(true)
      setError(null)
      setApplySuccess(false)

      const response = await fetch(`/api/pricing/apply-pricing/${activeEstimateId}`, {
        method: 'POST'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to apply pricing: ${response.status}`)
      }

      const result = await response.json()
      setApplySuccess(true)
      toast.success(`Pricing applied! ${result.updated || 0} items updated.`)

      // Reload line items to show updated pricing
      const { data, error: fetchError } = await supabase
        .from('estimate_line_items')
        .select('*')
        .eq('estimate_id', activeEstimateId)
        .order('created_at', { ascending: true })

      if (!fetchError && data) {
        setLineItems(data)
      }

      // Clear success message after 3 seconds
      setTimeout(() => setApplySuccess(false), 3000)
    } catch (err) {
      console.error('Error applying pricing:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to apply pricing'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsApplyingPricing(false)
    }
  }

  // Update margin and recalculate pricing
  const updateMargin = async (itemId: string, margin: number) => {
    if (!itemId) return

    setUpdatingMargins(prev => new Set(prev).add(itemId))

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
        throw new Error(errorData.error || `Failed to update margin: ${response.status}`)
      }

      const result = await response.json()

      // Update the item in state
      setLineItems(prevItems =>
        prevItems.map(item =>
          item.id === itemId
            ? {
                ...item,
                margin_percent: result.margin_percent,
                overhead_cost: result.overhead_cost,
                direct_cost: result.direct_cost,
                client_price: result.client_price
              }
            : item
        )
      )

      toast.success('Margin updated')
    } catch (err) {
      console.error('Error updating margin:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to update margin')
    } finally {
      setUpdatingMargins(prev => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }
  }

  // Save as standard (user override)
  const saveAsStandard = async (item: LineItem) => {
    if (!user || !item.task_library_id) {
      toast.error('Cannot save: Missing task library reference')
      return
    }

    setSavingOverrides(prev => new Set(prev).add(item.id))

    try {
      // Calculate unit cost from direct cost
      const quantity = item.quantity || 1
      const unitCost = item.direct_cost ? item.direct_cost / quantity : 0

      const response = await fetch('/api/pricing/user-library', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task_library_id: item.task_library_id,
          custom_unit_cost: unitCost,
          notes: `User override for: ${item.description || 'Line item'}`
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to save override: ${response.status}`)
      }

      // Update the item to mark it as user_library
      const { error: updateError } = await supabase
        .from('estimate_line_items')
        .update({ pricing_source: 'user_library' })
        .eq('id', item.id)

      if (updateError) {
        console.error('Error updating pricing source:', updateError)
      }

      // Update local state
      setLineItems(prevItems =>
        prevItems.map(prevItem =>
          prevItem.id === item.id
            ? { ...prevItem, pricing_source: 'user_library' }
            : prevItem
        )
      )

      toast.success('Saved as standard pricing')
    } catch (err) {
      console.error('Error saving override:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to save override')
    } finally {
      setSavingOverrides(prev => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  // Group items by scope then room
  const grouped = groupByScopeThenRoom(lineItems)

  // Get scope label
  const getScopeLabel = (scope: string) => {
    const category = COST_CATEGORIES.find(c => c.code === scope || c.label === scope)
    return category?.label || scope
  }

  // Calculate totals
  const totals = lineItems.reduce(
    (acc, item) => {
      acc.directCost += item.direct_cost || 0
      acc.clientPrice += item.client_price || 0
      return acc
    },
    { directCost: 0, clientPrice: 0 }
  )
  const totalMargin = totals.clientPrice - totals.directCost

  const activeEstimate = activeEstimateId ? estimates.find(e => e.id === activeEstimateId) : null

  if (!activeEstimate) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <p>Please select an estimate from the Estimate tab to view pricing.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Action Buttons */}
      <div className="flex gap-4">
        <Button
          onClick={handleApplyPricing}
          disabled={isApplyingPricing || !activeEstimateId}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isApplyingPricing ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Applying Pricing...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Apply Pricing
            </>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={() => router.refresh()}
        >
          <DollarSign className="mr-2 h-4 w-4" />
          Review Overrides
        </Button>
      </div>

      {/* Success/Error Messages */}
      {applySuccess && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Pricing applied successfully! {lineItems.length} line items updated.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-muted-foreground">Loading pricing data...</p>
          </CardContent>
        </Card>
      )}

      {/* No Line Items */}
      {!isLoading && lineItems.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>No line items found. Create line items in the Estimate tab first.</p>
          </CardContent>
        </Card>
      )}

      {/* Grouped Line Items Display */}
      {!isLoading && lineItems.length > 0 && (
        <div className="space-y-8">
          {Object.entries(grouped).map(([scope, rooms]) => {
            const scopeLabel = getScopeLabel(scope)

            return (
              <Card key={scope}>
                <CardHeader>
                  <CardTitle className="text-xl">{scopeLabel}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {Object.entries(rooms).map(([room, items]) => (
                      <div key={room} className="space-y-3">
                        {/* Room Header */}
                        {room !== 'General' && (
                          <h4 className="font-semibold text-lg text-primary border-b pb-2">
                            {room}
                          </h4>
                        )}

                        {/* Line Items for this room */}
                        <div className="space-y-4">
                          {items.map((item) => {
                            const quantity = item.quantity || 1
                            const unit = item.unit || 'EA'
                            const unitCost = item.unit_total_cost || (item.direct_cost ? item.direct_cost / quantity : 0)
                            const isUpdating = updatingMargins.has(item.id)
                            const isSaving = savingOverrides.has(item.id)

                            return (
                              <div
                                key={item.id}
                                className="border rounded-lg p-4 space-y-3 bg-card"
                              >
                                {/* Description */}
                                <div className="font-medium text-base">
                                  • {item.description || 'No description'}
                                </div>

                                {/* Pricing Grid */}
                                <div className="space-y-3">
                                  {/* First Row: Qty, Unit Cost, Labor, Material, OH, Direct */}
                                  <div className="grid grid-cols-6 gap-4 items-center">
                                    <div>
                                      <div className="text-xs text-muted-foreground">Qty × Unit</div>
                                      <div className="font-medium">
                                        {quantity} {unit}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-xs text-muted-foreground">Unit Cost</div>
                                      <div className="font-medium">
                                        ${unitCost.toFixed(2)}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-xs text-muted-foreground">Labor</div>
                                      <div className="font-medium text-sm">
                                        ${(item.labor_cost || 0).toFixed(2)}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-xs text-muted-foreground">Material</div>
                                      <div className="font-medium text-sm">
                                        ${(item.material_cost || 0).toFixed(2)}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-xs text-muted-foreground">OH</div>
                                      <div className="font-medium text-sm">
                                        ${(item.overhead_cost || 0).toFixed(2)}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-xs text-muted-foreground">Direct Cost</div>
                                      <div className="font-medium">
                                        ${(item.direct_cost || 0).toFixed(2)}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Second Row: Margin, Client Price, Confidence */}
                                  <div className="grid grid-cols-3 gap-4 items-center border-t pt-2">
                                    <div>
                                      <div className="text-xs text-muted-foreground mb-1">Margin %</div>
                                      <Input
                                        type="number"
                                        value={item.margin_percent || 20}
                                        min={0}
                                        max={100}
                                        step={0.1}
                                        onChange={(e) => {
                                          const margin = Number(e.target.value) || 0
                                          updateMargin(item.id, margin)
                                        }}
                                        disabled={isUpdating}
                                        className="w-20 h-8 text-sm"
                                      />
                                    </div>

                                    <div>
                                      <div className="text-xs text-muted-foreground">Client Price</div>
                                      <div className="font-bold text-lg text-green-700">
                                        ${(item.client_price || 0).toFixed(2)}
                                      </div>
                                    </div>

                                    <div>
                                      <div className="text-xs text-muted-foreground">Match Confidence</div>
                                      <div className="flex items-center gap-1">
                                        <ConfidenceBadge value={item.confidence} />
                                        {item.confidence !== null && item.confidence !== undefined && (item as any).matched_via && (
                                          <span className="text-xs text-muted-foreground">
                                            ({(item as any).matched_via})
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Actions Row */}
                                <div className="flex items-center justify-between pt-2">
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    {item.pricing_source === 'user_library' && (
                                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                        Custom
                                      </span>
                                    )}
                                    {item.pricing_source === 'task_library' && (
                                      <span className="flex items-center gap-1">
                                        <Sparkles className="h-3 w-3" />
                                        System
                                      </span>
                                    )}
                                    {item.pricing_source === 'manual' && (
                                      <span className="flex items-center gap-1">
                                        <Circle className="h-3 w-3" />
                                        Manual
                                      </span>
                                    )}
                                  </div>

                                  {/* Save as Standard Button */}
                                  {item.pricing_source !== 'user_library' && item.task_library_id && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => saveAsStandard(item)}
                                      disabled={isSaving}
                                      className="text-xs"
                                    >
                                      {isSaving ? (
                                        <>
                                          <div className="mr-1 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                          Saving...
                                        </>
                                      ) : (
                                        <>
                                          <Save className="mr-1 h-3 w-3" />
                                          Save as Standard
                                        </>
                                      )}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Totals Area */}
      {!isLoading && lineItems.length > 0 && (
        <Card className="bg-muted/50">
          <CardContent className="py-6">
            <div className="flex justify-end">
              <div className="space-y-2 text-right">
                <div className="flex items-center justify-between gap-8">
                  <span className="text-muted-foreground">Total Direct Cost:</span>
                  <span className="font-semibold text-lg">
                    ${totals.directCost.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-8">
                  <span className="text-muted-foreground">Total Margin:</span>
                  <span className="font-semibold text-lg">
                    ${totalMargin.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-8 border-t pt-2">
                  <span className="text-muted-foreground font-semibold">Total Client Price:</span>
                  <span className="font-bold text-2xl text-green-700">
                    ${totals.clientPrice.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
