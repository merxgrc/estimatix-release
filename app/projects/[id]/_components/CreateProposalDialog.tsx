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

  // Load estimate summary when dialog opens or estimate changes
  useEffect(() => {
    const loadEstimateSummary = async () => {
      if (!open || !estimateId) {
        setIsLoadingSummary(true)
        return
      }

      try {
        setIsLoadingSummary(true)
        
        // Fetch all line items for the estimate
        const { data: lineItems, error: fetchError } = await supabase
          .from('estimate_line_items')
          .select('client_price, is_allowance, direct_cost, description')
          .eq('estimate_id', estimateId)

        if (fetchError) {
          console.error('Error loading estimate summary:', fetchError)
          return
        }

        if (!lineItems) {
          return
        }

        // Calculate total price (sum of all client_price)
        let total = 0
        let allowances = 0

        for (const item of lineItems) {
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

