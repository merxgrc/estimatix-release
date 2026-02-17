'use client'

import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { supabase } from "@/lib/supabase/client"
import { Plus, FileText, CheckCircle2, AlertCircle, Eye, RefreshCcw, Loader2 } from "lucide-react"
import { toast } from 'sonner'
import type { Project } from "@/types/db"
import { CreateProposalDialog } from './CreateProposalDialog'
import { regenerateProposalTotal } from '@/actions/proposals'

interface Proposal {
  id: string
  project_id: string
  estimate_id: string | null
  version: number
  title: string
  total_price: number | null
  status: 'draft' | 'sent' | 'approved' | 'rejected'
  approved_at: string | null
  created_at: string
  created_by: string | null
  is_stale?: boolean // Added for tracking if estimate changed after proposal creation
}

interface ProposalsTabProps {
  project: Project
  activeEstimateId: string | null
}

const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0)

const formatDate = (dateString: string | null) => {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

const StatusBadge = ({ status }: { status: Proposal['status'] }) => {
  const variants: Record<Proposal['status'], { label: string; className: string }> = {
    draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
    sent: { label: 'Sent', className: 'bg-primary/10 text-primary' },
    approved: { label: 'Approved', className: 'bg-green-100 text-green-800' },
    rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800' },
  }
  
  const { label, className } = variants[status]
  
  return (
    <Badge className={className}>
      {label}
    </Badge>
  )
}

export function ProposalsTab({ project, activeEstimateId }: ProposalsTabProps) {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)

  // Load proposals when project changes
  useEffect(() => {
    const loadProposals = async () => {
      if (!project?.id) {
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        const { data, error: fetchError } = await supabase
          .from('proposals')
          .select('*')
          .eq('project_id', project.id)
          .order('created_at', { ascending: false })

        if (fetchError) {
          throw new Error(`Failed to load proposals: ${fetchError.message}`)
        }

        // Check staleness for each proposal
        // A proposal is "stale" if line items or rooms were modified after proposal creation
        const proposalsWithStaleness = await Promise.all(
          (data || []).map(async (proposal) => {
            if (!proposal.estimate_id) {
              return { ...proposal, is_stale: false }
            }

            // Get the most recent update to line items or rooms
            const [lineItemsResult, roomsResult] = await Promise.all([
              supabase
                .from('estimate_line_items')
                .select('updated_at')
                .eq('estimate_id', proposal.estimate_id)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
              supabase
                .from('rooms')
                .select('updated_at')
                .eq('project_id', project.id)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            ])

            const proposalCreatedAt = new Date(proposal.created_at).getTime()
            const lineItemUpdatedAt = lineItemsResult.data?.updated_at 
              ? new Date(lineItemsResult.data.updated_at).getTime() 
              : 0
            const roomUpdatedAt = roomsResult.data?.updated_at
              ? new Date(roomsResult.data.updated_at).getTime()
              : 0

            const latestUpdate = Math.max(lineItemUpdatedAt, roomUpdatedAt)
            const is_stale = latestUpdate > proposalCreatedAt

            return { ...proposal, is_stale }
          })
        )

        setProposals(proposalsWithStaleness)
      } catch (err) {
        console.error('Error loading proposals:', err)
        setError(err instanceof Error ? err.message : 'Failed to load proposals')
      } finally {
        setIsLoading(false)
      }
    }

    loadProposals()
  }, [project?.id])

  const handleRegenerate = async (proposalId: string) => {
    try {
      setRegeneratingId(proposalId)
      const result = await regenerateProposalTotal(proposalId)
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to regenerate')
      }

      // Update local state with new total and clear stale flag
      setProposals(prev =>
        prev.map(p =>
          p.id === proposalId
            ? { ...p, total_price: result.newTotal ?? p.total_price, is_stale: false }
            : p
        )
      )

      toast.success(`Total updated to ${formatCurrency(result.newTotal)}`)
    } catch (err) {
      console.error('Error regenerating proposal:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate total')
    } finally {
      setRegeneratingId(null)
    }
  }

  const handleMarkApproved = async (proposalId: string) => {
    try {
      setApprovingId(proposalId)

      const { error: updateError } = await supabase
        .from('proposals')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString()
        })
        .eq('id', proposalId)

      if (updateError) {
        throw new Error(`Failed to mark proposal as approved: ${updateError.message}`)
      }

      // Create audit event
      const { error: eventError } = await supabase
        .from('proposal_events')
        .insert({
          proposal_id: proposalId,
          event_type: 'approved',
          metadata: {
            approved_at: new Date().toISOString()
          }
        })

      if (eventError) {
        console.warn('Failed to create proposal event:', eventError)
      }

      // Update local state
      setProposals(prev =>
        prev.map(p =>
          p.id === proposalId
            ? { ...p, status: 'approved', approved_at: new Date().toISOString() }
            : p
        )
      )

      toast.success('Proposal marked as approved')
    } catch (err) {
      console.error('Error approving proposal:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to approve proposal')
    } finally {
      setApprovingId(null)
    }
  }

  const handleViewPdf = async (proposalId: string) => {
    try {
      toast.loading('Generating PDF...', { id: 'view-pdf' })
      
      // Fetch PDF from API
      const response = await fetch(`/api/proposals/${proposalId}/pdf`)
      
      // Check content type first before reading body
      const contentType = response.headers.get('content-type') || ''
      
      if (!response.ok) {
        // For error responses, try to parse as JSON if it's JSON
        let errorMessage = `Failed to generate PDF: ${response.status} ${response.statusText}`
        
        if (contentType.includes('application/json')) {
          try {
            // Clone the response to read it without consuming the original
            const errorResponse = response.clone()
            const errorData = await errorResponse.json()
            errorMessage = errorData.error || errorData.message || errorData.details || errorMessage
          } catch (parseError) {
            console.error('Error parsing JSON error response:', parseError)
            // Use default error message
          }
        } else if (contentType.includes('text/')) {
          try {
            const errorResponse = response.clone()
            const text = await errorResponse.text()
            if (text) {
              // Try to parse as JSON if it looks like JSON
              try {
                const errorData = JSON.parse(text)
                errorMessage = errorData.error || errorData.message || errorData.details || errorMessage
              } catch {
                errorMessage = text.substring(0, 200)
              }
            }
          } catch (textError) {
            console.error('Error reading error text:', textError)
          }
        }
        
        throw new Error(errorMessage)
      }

      // For successful responses, verify it's a PDF
      if (!contentType.includes('application/pdf')) {
        // If not a PDF, try to read as error message
        try {
          const errorResponse = response.clone()
          const text = await errorResponse.text()
          let errorMessage = 'Server returned non-PDF response'
          try {
            const errorData = JSON.parse(text)
            errorMessage = errorData.error || errorData.message || errorData.details || errorMessage
          } catch {
            errorMessage = text.substring(0, 200)
          }
          throw new Error(errorMessage)
        } catch (readError) {
          throw new Error('Server returned non-PDF response')
        }
      }

      // Get the PDF blob (only read body once)
      const blob = await response.blob()

      // Basic verification - check blob type
      if (blob.type && !blob.type.includes('pdf') && !blob.type.includes('octet-stream')) {
        // If blob type suggests it's not a PDF, try to read as error
        try {
          const text = await blob.text()
          let errorMessage = 'Invalid PDF response'
          try {
            const errorData = JSON.parse(text)
            errorMessage = errorData.error || errorData.message || errorData.details || errorMessage
          } catch {
            errorMessage = text.substring(0, 200)
          }
          throw new Error(errorMessage)
        } catch (blobError) {
          throw new Error('Invalid PDF response received')
        }
      }

      // Create download link and trigger download
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `Proposal-${proposalId}.pdf`
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/)
        if (filenameMatch) {
          filename = filenameMatch[1]
        }
      }
      
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      toast.success('PDF downloaded successfully!', { id: 'view-pdf' })
    } catch (err) {
      console.error('Error viewing PDF:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate PDF'
      toast.error(errorMessage, { id: 'view-pdf' })
    }
  }

  const handleProposalCreated = () => {
    // Reload proposals after creation
    const loadProposals = async () => {
      const { data } = await supabase
        .from('proposals')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })

      if (data) {
        setProposals(data)
      }
    }
    loadProposals()
  }

  if (!activeEstimateId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <p>Please select an estimate from the Estimate tab to create a proposal.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold">Proposals</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage construction proposals from your estimates
          </p>
        </div>
        <Button
          onClick={() => setIsDialogOpen(true)}
          disabled={isCreating || !activeEstimateId}
          className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Proposal
        </Button>
      </div>

      {/* Error State */}
      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-muted-foreground">Loading proposals...</p>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && proposals.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No proposals yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first proposal from the current estimate
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Proposal
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Proposals Table / Cards */}
      {!isLoading && proposals.length > 0 && (
        <>
          {/* Desktop Table */}
          <Card className="hidden md:block">
            <CardHeader>
              <CardTitle>All Proposals</CardTitle>
              <CardDescription>
                {proposals.length} proposal{proposals.length !== 1 ? 's' : ''} for this project
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">Total Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.map((proposal) => (
                    <TableRow key={proposal.id}>
                      <TableCell className="font-medium">
                        {formatDate(proposal.created_at)}
                      </TableCell>
                      <TableCell>v{proposal.version}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {proposal.title}
                          {proposal.is_stale && (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                              <RefreshCcw className="mr-1 h-3 w-3" />
                              Out of date
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(proposal.total_price)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={proposal.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {proposal.is_stale && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRegenerate(proposal.id)}
                              disabled={regeneratingId === proposal.id}
                              className="text-amber-700 border-amber-300 hover:bg-amber-50"
                            >
                              {regeneratingId === proposal.id ? (
                                <>
                                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                  Updating...
                                </>
                              ) : (
                                <>
                                  <RefreshCcw className="mr-1 h-4 w-4" />
                                  Update Total
                                </>
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewPdf(proposal.id)}
                            title={proposal.is_stale ? "PDF will reflect current estimate (rooms/line items may have changed)" : undefined}
                          >
                            <Eye className="mr-1 h-4 w-4" />
                            View PDF
                          </Button>
                          {proposal.status === 'draft' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleMarkApproved(proposal.id)}
                              disabled={approvingId === proposal.id}
                            >
                              {approvingId === proposal.id ? (
                                <>
                                  <div className="mr-1 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                  Approving...
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="mr-1 h-4 w-4" />
                                  Mark Approved
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile Card List */}
          <div className="space-y-3 md:hidden">
            <p className="text-sm text-muted-foreground">
              {proposals.length} proposal{proposals.length !== 1 ? 's' : ''} for this project
            </p>
            {proposals.map((proposal) => (
              <Card key={proposal.id} className="p-4">
                <div className="space-y-3">
                  {/* Header row: title + status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{proposal.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        v{proposal.version} &middot; {formatDate(proposal.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={proposal.status} />
                  </div>

                  {/* Price + stale indicator */}
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold">{formatCurrency(proposal.total_price)}</span>
                    {proposal.is_stale && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                        <RefreshCcw className="mr-1 h-3 w-3" />
                        Out of date
                      </Badge>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    {proposal.is_stale && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRegenerate(proposal.id)}
                        disabled={regeneratingId === proposal.id}
                        className="text-amber-700 border-amber-300 hover:bg-amber-50 min-h-[44px] flex-1"
                      >
                        {regeneratingId === proposal.id ? (
                          <>
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            Updating...
                          </>
                        ) : (
                          <>
                            <RefreshCcw className="mr-1 h-4 w-4" />
                            Update Total
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewPdf(proposal.id)}
                      className="min-h-[44px] flex-1"
                    >
                      <Eye className="mr-1 h-4 w-4" />
                      View PDF
                    </Button>
                    {proposal.status === 'draft' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleMarkApproved(proposal.id)}
                        disabled={approvingId === proposal.id}
                        className="min-h-[44px] flex-1"
                      >
                        {approvingId === proposal.id ? (
                          <>
                            <div className="mr-1 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Approving...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="mr-1 h-4 w-4" />
                            Approve
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Create Proposal Dialog */}
      <CreateProposalDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        projectId={project.id}
        estimateId={activeEstimateId}
        onProposalCreated={handleProposalCreated}
      />
    </div>
  )
}

