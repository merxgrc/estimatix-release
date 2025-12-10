'use client'

import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { supabase } from "@/lib/supabase/client"
import { Plus, FileText, CheckCircle2, AlertCircle, Eye } from "lucide-react"
import { toast } from 'sonner'
import type { Project } from "@/types/db"
import { CreateProposalDialog } from './CreateProposalDialog'

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
    draft: { label: 'Draft', className: 'bg-gray-100 text-gray-800' },
    sent: { label: 'Sent', className: 'bg-blue-100 text-blue-800' },
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

        setProposals(data || [])
      } catch (err) {
        console.error('Error loading proposals:', err)
        setError(err instanceof Error ? err.message : 'Failed to load proposals')
      } finally {
        setIsLoading(false)
      }
    }

    loadProposals()
  }, [project?.id])

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Proposals</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage construction proposals from your estimates
          </p>
        </div>
        <Button
          onClick={() => setIsDialogOpen(true)}
          disabled={isCreating || !activeEstimateId}
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

      {/* Proposals Table */}
      {!isLoading && proposals.length > 0 && (
        <Card>
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
                    <TableCell>{proposal.title}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(proposal.total_price)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={proposal.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewPdf(proposal.id)}
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

