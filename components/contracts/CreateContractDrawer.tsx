'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createContractFromProposal } from '@/actions/contracts'
import { supabase } from "@/lib/supabase/client"
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CalendarIcon, ChevronDown, ChevronRight, Plus, Trash2, DollarSign } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface CreateContractDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  proposalId?: string | null
  onSuccess: () => void
}

interface PaymentMilestone {
  milestone: string
  amount: number
}

export function CreateContractDrawer({ open, onOpenChange, projectId, proposalId: providedProposalId, onSuccess }: CreateContractDrawerProps) {
  const [startDate, setStartDate] = useState<Date>()
  const [completionDate, setCompletionDate] = useState<Date>()
  const [totalPrice, setTotalPrice] = useState(0)
  const [downPayment, setDownPayment] = useState(0)
  const [paymentSchedule, setPaymentSchedule] = useState<PaymentMilestone[]>([
    { milestone: '50% Rough', amount: 0 },
    { milestone: '50% Finish', amount: 0 }
  ])
  const [legalText, setLegalText] = useState({
    warranty: 'All work performed under this contract is warranted against defects in materials and workmanship for a period of one (1) year from the date of substantial completion. This warranty covers repair or replacement of defective materials or workmanship at no additional cost to the Owner.',
    termination: 'Either party may terminate this contract by providing thirty (30) days written notice to the other party. Upon termination, the Contractor shall be paid for all work completed and materials delivered to the job site as of the termination date.',
    right_to_cancel: 'You, the Buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this contract. See the attached notice of cancellation form for an explanation of this right.'
  })
  const [expandedClauses, setExpandedClauses] = useState<Record<string, boolean>>({
    warranty: false,
    termination: false,
    right_to_cancel: false
  })
  const [loading, setLoading] = useState(false)
  const [proposalId, setProposalId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      fetchProposal()
    }
  }, [open, projectId])

  const fetchProposal = async () => {
    try {
      let data
      if (providedProposalId) {
        const result = await supabase
          .from('proposals')
          .select('id, total_price')
          .eq('id', providedProposalId)
          .maybeSingle()
        data = result.data
      } else {
        const result = await supabase
          .from('proposals')
          .select('id, total_price')
          .eq('project_id', projectId)
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        data = result.data
      }

      if (data) {
        setProposalId(data.id)
        const price = data.total_price || 0
        setTotalPrice(price)
        setDownPayment(0)
        // Calculate default payment schedule based on remaining balance after down payment
        const remainingAfterDown = price
        setPaymentSchedule([
          { milestone: '50% Rough', amount: remainingAfterDown * 0.5 },
          { milestone: '50% Finish', amount: remainingAfterDown * 0.5 }
        ])
      }
    } catch (error) {
      console.error('Error fetching proposal:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await createContractFromProposal(projectId, proposalId, {
        startDate: startDate ? format(startDate, 'yyyy-MM-dd') : '',
        completionDate: completionDate ? format(completionDate, 'yyyy-MM-dd') : '',
        totalPrice,
        downPayment,
        paymentSchedule,
        legalText
      })
      if (!result.success) throw new Error(result.error)
      toast.success('Contract created successfully!')
      onSuccess()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create contract')
    } finally {
      setLoading(false)
    }
  }

  const remainingBalance = totalPrice - downPayment

  // Calculate payment schedule total
  const paymentScheduleTotal = paymentSchedule.reduce((sum, item) => sum + (item.amount || 0), 0)
  const paymentScheduleBalance = remainingBalance - paymentScheduleTotal

  // Add payment milestone
  const addPaymentMilestone = () => {
    setPaymentSchedule([...paymentSchedule, { milestone: '', amount: 0 }])
  }

  // Remove payment milestone
  const removePaymentMilestone = (index: number) => {
    if (paymentSchedule.length > 1) {
      setPaymentSchedule(paymentSchedule.filter((_, i) => i !== index))
    } else {
      toast.error('At least one payment milestone is required')
    }
  }

  // Update payment milestone
  const updatePaymentMilestone = (index: number, field: 'milestone' | 'amount', value: string | number) => {
    const newSchedule = [...paymentSchedule]
    newSchedule[index] = { ...newSchedule[index], [field]: value }
    setPaymentSchedule(newSchedule)
  }

  // Toggle clause expansion
  const toggleClause = (clause: string) => {
    setExpandedClauses(prev => ({ ...prev, [clause]: !prev[clause] }))
  }

  // Update legal text
  const updateLegalText = (clause: string, value: string) => {
    setLegalText(prev => ({ ...prev, [clause]: value }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Contract</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Project Dates Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Project Dates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="start-date">Approximate Start Date</Label>
                  <Popover modal>
                    <PopoverTrigger asChild>
                      <Button
                        id="start-date"
                        variant="outline"
                        className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={startDate} onSelect={setStartDate} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label htmlFor="completion-date">Completion Date</Label>
                  <Popover modal>
                    <PopoverTrigger asChild>
                      <Button
                        id="completion-date"
                        variant="outline"
                        className={cn("w-full justify-start text-left font-normal", !completionDate && "text-muted-foreground")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {completionDate ? format(completionDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={completionDate} onSelect={setCompletionDate} />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Financials Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Financials</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="total-price">Total Price</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="total-price"
                    type="number"
                    step="0.01"
                    value={totalPrice}
                    onChange={(e) => setTotalPrice(Number(e.target.value))}
                    className="pl-9"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="down-payment">Down Payment Amount</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="down-payment"
                    type="number"
                    step="0.01"
                    value={downPayment}
                    onChange={(e) => setDownPayment(Number(e.target.value))}
                    className="pl-9"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="bg-muted p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Remaining Balance:</span>
                  <span className="text-lg font-bold tabular-nums">
                    ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(remainingBalance)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Payment Schedule Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payment Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {paymentSchedule.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Input
                        value={item.milestone}
                        onChange={(e) => updatePaymentMilestone(idx, 'milestone', e.target.value)}
                        placeholder="e.g., 50% Rough, Upon Delivery of Cabinets"
                        className="text-sm"
                      />
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="number"
                          step="0.01"
                          value={item.amount}
                          onChange={(e) => updatePaymentMilestone(idx, 'amount', Number(e.target.value))}
                          placeholder="0.00"
                          className="pl-9 text-sm tabular-nums"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removePaymentMilestone(idx)}
                      className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={paymentSchedule.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPaymentMilestone}
                className="w-full"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Payment Milestone
              </Button>
              {paymentScheduleBalance !== 0 && (
                <div className={cn(
                  "p-3 rounded-lg text-sm",
                  Math.abs(paymentScheduleBalance) < 0.01
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : paymentScheduleBalance > 0
                    ? "bg-yellow-50 text-yellow-700 border border-yellow-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                )}>
                  {Math.abs(paymentScheduleBalance) < 0.01
                    ? "✓ Payment schedule balances correctly"
                    : paymentScheduleBalance > 0
                    ? `⚠ Remaining balance: $${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paymentScheduleBalance)} not allocated`
                    : `⚠ Payment schedule exceeds remaining balance by $${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(paymentScheduleBalance))}`
                  }
                </div>
              )}
            </CardContent>
          </Card>

          {/* Legal Clauses Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Legal Clauses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Warranty Clause */}
              <div className="border rounded-lg">
                <button
                  type="button"
                  onClick={() => toggleClause('warranty')}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <span className="font-medium">Warranty</span>
                  {expandedClauses.warranty ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                {expandedClauses.warranty && (
                  <div className="p-4 pt-0 border-t">
                    <Textarea
                      value={legalText.warranty}
                      onChange={(e) => updateLegalText('warranty', e.target.value)}
                      placeholder="Enter warranty terms..."
                      className="min-h-[100px] text-sm"
                    />
                  </div>
                )}
              </div>

              {/* Termination Clause */}
              <div className="border rounded-lg">
                <button
                  type="button"
                  onClick={() => toggleClause('termination')}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <span className="font-medium">Termination</span>
                  {expandedClauses.termination ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                {expandedClauses.termination && (
                  <div className="p-4 pt-0 border-t">
                    <Textarea
                      value={legalText.termination}
                      onChange={(e) => updateLegalText('termination', e.target.value)}
                      placeholder="Enter termination terms..."
                      className="min-h-[100px] text-sm"
                    />
                  </div>
                )}
              </div>

              {/* Right to Cancel Clause */}
              <div className="border rounded-lg">
                <button
                  type="button"
                  onClick={() => toggleClause('right_to_cancel')}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <span className="font-medium">Right to Cancel</span>
                  {expandedClauses.right_to_cancel ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                {expandedClauses.right_to_cancel && (
                  <div className="p-4 pt-0 border-t">
                    <Textarea
                      value={legalText.right_to_cancel}
                      onChange={(e) => updateLegalText('right_to_cancel', e.target.value)}
                      placeholder="Enter right to cancel terms..."
                      className="min-h-[100px] text-sm"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Contract'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

