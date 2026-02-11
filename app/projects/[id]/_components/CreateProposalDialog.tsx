'use client'

import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { supabase } from "@/lib/supabase/client"
import { createProposalFromEstimate } from '@/actions/proposals'
import { Loader2, AlertCircle, DollarSign } from "lucide-react"
import { toast } from 'sonner'
import { recordPricingCommit, type LineItemForCommit } from '@/hooks/usePricingFeedback'
import { useAuth } from "@/lib/auth-context"

interface CreateProposalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  estimateId: string
  onProposalCreated: () => void
}

const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0)

export function CreateProposalDialog({
  open,
  onOpenChange,
  projectId,
  estimateId,
  onProposalCreated
}: CreateProposalDialogProps) {
  const { user } = useAuth()
  const [title, setTitle] = useState('Construction Proposal')
  // Pre-filled template for Basis of Proposal
  const [basisOfProposal, setBasisOfProposal] = useState(
    'This proposal is based on the first submittal plans Dated [DATE] from [ARCHITECT] and interior specifications received from [NAME] on [DATE] and includes some owner revisions after the initial proposal meeting on [DATE].'
  )
  const [inclusions, setInclusions] = useState('')
  const [exclusions, setExclusions] = useState('')
  const [discussions, setDiscussions] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalPrice, setTotalPrice] = useState<number | null>(null)
  const [totalAllowances, setTotalAllowances] = useState<number | null>(null)
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)
  const [userRegion, setUserRegion] = useState<string | null>(null)
  
  // Fetch user's region for pricing events
  useEffect(() => {
    const fetchUserRegion = async () => {
      if (!user?.id) return
      
      const { data } = await supabase
        .from('user_profile_settings')
        .select('region')
        .eq('user_id', user.id)
        .maybeSingle()
      
      setUserRegion(data?.region || null)
    }
    
    fetchUserRegion()
  }, [user?.id])

  // Load estimate summary when dialog opens or estimate changes
  // Only include items from ACTIVE/INCLUDED rooms (is_active = true)
  useEffect(() => {
    const loadEstimateSummary = async () => {
      if (!open || !estimateId) {
        setIsLoadingSummary(true)
        return
      }

      try {
        setIsLoadingSummary(true)
        
        // Fetch all line items for the estimate with room info
        // Join with rooms to filter out excluded rooms (is_active = false)
        const { data: lineItems, error: fetchError } = await supabase
          .from('estimate_line_items')
          .select(`
            client_price, 
            is_allowance, 
            direct_cost, 
            description,
            room_id,
            rooms!estimate_line_items_room_id_fkey (
              id,
              is_active
            )
          `)
          .eq('estimate_id', estimateId)

        if (fetchError) {
          console.error('Error loading estimate summary:', fetchError)
          return
        }

        if (!lineItems) {
          return
        }

        // Calculate total price (sum of all client_price from ACTIVE rooms only)
        let total = 0
        let allowances = 0

        for (const item of lineItems as any[]) {
          // Filter out items from excluded (inactive) rooms
          // Items without a room (room_id = null) are included by default
          const room = item.rooms as { id: string; is_active: boolean } | null
          if (room && room.is_active === false) {
            continue // Skip excluded room items
          }
          
          const price = item.client_price || 0
          total += Number(price) || 0

          // Check if item is an allowance
          const isAllowance = item.is_allowance === true || 
                             (item.description && item.description.toUpperCase().trim().startsWith('ALLOWANCE:'))
          
          if (isAllowance) {
            allowances += Number(price) || 0
          }
        }

        setTotalPrice(total)
        setTotalAllowances(allowances)
      } catch (err) {
        console.error('Error calculating estimate summary:', err)
      } finally {
        setIsLoadingSummary(false)
      }
    }

    loadEstimateSummary()
  }, [open, estimateId])

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setTitle('Construction Proposal')
      setBasisOfProposal(
        'This proposal is based on the first submittal plans Dated [DATE] from [ARCHITECT] and interior specifications received from [NAME] on [DATE] and includes some owner revisions after the initial proposal meeting on [DATE].'
      )
      setInclusions('')
      setExclusions('')
      setDiscussions('')
      setError(null)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      // Parse inclusions and exclusions (split by newlines, filter empty)
      const inclusionsArray = inclusions
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
      
      const exclusionsArray = exclusions
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)

      const formData = {
        title: title.trim() || 'Construction Proposal',
        basis_of_estimate: basisOfProposal.trim(),
        inclusions: inclusionsArray,
        exclusions: exclusionsArray,
        notes: discussions.trim() // Store discussions in notes field for now
      }

      const result = await createProposalFromEstimate(projectId, estimateId, formData)

      if (!result.success) {
        throw new Error(result.error || 'Failed to create proposal')
      }

      // =========================================================================
      // PHASE 1 DATA DISCIPLINE: PRICING TRUTH RULES
      // =========================================================================
      // Per PRODUCT_CONTEXT.md:
      // - pricing_events can be logged at proposal creation (weaker signal)
      // - user_cost_library should ONLY be seeded from TRUTH states:
      //   * bid_final: contractor committed to these prices
      //   * contract_signed: client accepted these prices
      // - Draft proposals are NOT truth — contractor is still experimenting
      //
      // Why this matters:
      // - Draft prices are exploratory, not decisions
      // - Seeding library from drafts would capture noise, not signal
      // - Future suggestions must be based on committed prices only
      // =========================================================================
      
      try {
        // First, check estimate status to determine if we should seed library
        const { data: estimate } = await supabase
          .from('estimates')
          .select('status')
          .eq('id', estimateId)
          .single()
        
        const estimateStatus = estimate?.status
        const isTruthState = estimateStatus === 'bid_final' || estimateStatus === 'contract_signed'
        
        // Fetch line items for pricing event logging
        const { data: lineItems } = await supabase
          .from('estimate_line_items')
          .select('id, description, cost_code, unit, quantity, direct_cost, pricing_source, task_library_id, confidence')
          .eq('estimate_id', estimateId)
        
        if (lineItems && lineItems.length > 0) {
          const lineItemsForCommit: LineItemForCommit[] = lineItems.map(item => ({
            id: item.id,
            description: item.description || '',
            costCode: item.cost_code,
            unit: item.unit,
            quantity: item.quantity,
            directCost: item.direct_cost,
            pricingSource: item.pricing_source as any,
            matchedTaskId: item.task_library_id,
            matchConfidence: item.confidence
          }))
          
          // Fire-and-forget: don't block proposal creation
          // Include region for consistent pricing capture
          recordPricingCommit(lineItemsForCommit, {
            projectId,
            estimateId,
            region: userRegion, // User's region from profile settings
            stage: 'proposal_created',
            // CRITICAL: Only save to library if estimate is in a truth state
            // Draft proposals should NOT seed user_cost_library
            saveToLibrary: isTruthState
          }).catch(err => console.warn('Failed to record pricing commit:', err))
          
          if (!isTruthState) {
            console.log(`[CreateProposal] Estimate ${estimateId} is in '${estimateStatus}' state — pricing_events logged but user_cost_library NOT seeded`)
          }
        }
      } catch (pricingError) {
        // Don't fail proposal creation if pricing logging fails
        console.warn('Failed to record pricing events:', pricingError)
      }

      toast.success('Proposal created successfully!')
      onProposalCreated()
      onOpenChange(false)
    } catch (err) {
      console.error('Error creating proposal:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to create proposal'
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Proposal</DialogTitle>
          <DialogDescription>
            Create a proposal from the current estimate. You can customize the details below.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Summary Section */}
          <div className="border rounded-lg p-4 bg-muted/50 space-y-2">
            <h3 className="font-semibold text-sm">Proposal Summary</h3>
            {isLoadingSummary ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Calculating totals...</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Contract Price:</span>
                  <div className="font-semibold text-lg text-green-700">
                    {formatCurrency(totalPrice)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Allowances:</span>
                  <div className="font-semibold text-lg">
                    {formatCurrency(totalAllowances)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Proposal Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Construction Proposal"
              disabled={isSubmitting}
            />
          </div>

          {/* Basis of Proposal */}
          <div className="space-y-2">
            <Label htmlFor="basis">Basis of Proposal</Label>
            <Textarea
              id="basis"
              value={basisOfProposal}
              onChange={(e) => setBasisOfProposal(e.target.value)}
              placeholder="This proposal is based on the first submittal plans Dated [DATE] from [ARCHITECT] and interior specifications received from [NAME] on [DATE] and includes some owner revisions after the initial proposal meeting on [DATE]."
              rows={4}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Pre-filled template. Replace bracketed placeholders with actual dates and names, or rewrite entirely.
            </p>
          </div>

          {/* Exclusions */}
          <div className="space-y-2">
            <Label htmlFor="exclusions">Exclusions</Label>
            <Textarea
              id="exclusions"
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              placeholder="Light Fixtures, Microwave, Wallpaper..."
              rows={4}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Enter one item per line. These will be formatted as a bullet list in the proposal.
            </p>
          </div>

          {/* Discussions / Notes */}
          <div className="space-y-2">
            <Label htmlFor="discussions">Discussions / Notes</Label>
            <Textarea
              id="discussions"
              value={discussions}
              onChange={(e) => setDiscussions(e.target.value)}
              placeholder="Additional Scope in development..."
              rows={4}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Additional notes, discussions, or items to address.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || isLoadingSummary}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <DollarSign className="mr-2 h-4 w-4" />
                  Create Proposal
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

