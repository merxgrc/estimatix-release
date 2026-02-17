'use client'

import { useEffect, useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { supabase } from "@/lib/supabase/client"
import { toast } from 'sonner'
import { startJobFromContract } from '@/actions/start-job'
import type { Project } from "@/types/db"
import { FileText, Play, Plus, RefreshCcw, Loader2 } from "lucide-react"
import { CreateContractDrawer } from '@/components/contracts/CreateContractDrawer'
import { regenerateContractTotal } from '@/actions/contracts'

interface Contract {
  id: string
  total_price: number
  down_payment: number
  status: string
  created_at: string
  proposal_id: string | null
  is_stale?: boolean // True if estimate changed after contract creation
}

export function ContractsTab({ project }: { project: Project }) {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)

  useEffect(() => {
    fetchContracts()
  }, [project.id])

  const fetchContracts = async () => {
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, proposals(estimate_id)')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })

      if (error) throw error

      // Check staleness for each contract
      const contractsWithStaleness = await Promise.all(
        (data || []).map(async (contract: any) => {
          const estimateId = contract.proposals?.estimate_id
          if (!estimateId) {
            return { ...contract, proposals: undefined, is_stale: false }
          }

          // Get the most recent update to line items or rooms
          const [lineItemsResult, roomsResult] = await Promise.all([
            supabase
              .from('estimate_line_items')
              .select('updated_at')
              .eq('estimate_id', estimateId)
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

          const contractCreatedAt = new Date(contract.created_at).getTime()
          const lineItemUpdatedAt = lineItemsResult.data?.updated_at 
            ? new Date(lineItemsResult.data.updated_at).getTime() 
            : 0
          const roomUpdatedAt = roomsResult.data?.updated_at
            ? new Date(roomsResult.data.updated_at).getTime()
            : 0

          const latestUpdate = Math.max(lineItemUpdatedAt, roomUpdatedAt)
          const is_stale = latestUpdate > contractCreatedAt

          return { ...contract, proposals: undefined, is_stale }
        })
      )

      setContracts(contractsWithStaleness)
    } catch (error) {
      console.error('Error fetching contracts:', error)
      toast.error('Failed to load contracts')
    } finally {
      setLoading(false)
    }
  }

  const handleViewPdf = async (contractId: string) => {
    try {
      toast.loading('Generating PDF...', { id: 'view-pdf' })
      const response = await fetch(`/api/contracts/${contractId}/pdf`)
      if (!response.ok) throw new Error('Failed to generate PDF')
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `contract.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      toast.success('PDF generated successfully', { id: 'view-pdf' })
    } catch (err) {
      toast.error('Failed to generate PDF', { id: 'view-pdf' })
    }
  }

  const handleRegenerate = async (contractId: string) => {
    try {
      setRegeneratingId(contractId)
      const result = await regenerateContractTotal(contractId)
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to regenerate')
      }

      // Update local state with new total and clear stale flag
      setContracts(prev =>
        prev.map(c =>
          c.id === contractId
            ? { ...c, total_price: result.newTotal ?? c.total_price, is_stale: false }
            : c
        )
      )

      const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(result.newTotal || 0)
      toast.success(`Total updated to ${formatted}`)
    } catch (err) {
      console.error('Error regenerating contract:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate total')
    } finally {
      setRegeneratingId(null)
    }
  }

  const handleStartJob = async (contractId: string) => {
    const result = await startJobFromContract(contractId)
    if (result.success) {
      toast.success('Job started successfully')
      fetchContracts()
    } else {
      toast.error(result.error || 'Failed to start job')
    }
  }

  if (loading) {
    return <Card><CardContent className="py-12 text-center">Loading...</CardContent></Card>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <CardHeader className="p-0"><CardTitle>Contracts</CardTitle></CardHeader>
        <Button onClick={() => setCreateDrawerOpen(true)} className="w-full sm:w-auto min-h-[44px] sm:min-h-0">
          <Plus className="mr-2 h-4 w-4" />New Contract
        </Button>
      </div>

      {contracts.length === 0 ? (
        <Card><CardContent className="py-12 text-center">No contracts yet</CardContent></Card>
      ) : (
        <>
          {/* Desktop Table */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Total Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {new Date(contract.created_at).toLocaleDateString()}
                        {contract.is_stale && (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                            <RefreshCcw className="mr-1 h-3 w-3" />
                            Out of date
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>${new Intl.NumberFormat().format(contract.total_price || 0)}</TableCell>
                    <TableCell><Badge>{contract.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {contract.is_stale && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRegenerate(contract.id)}
                            disabled={regeneratingId === contract.id}
                            className="text-amber-700 border-amber-300 hover:bg-amber-50"
                          >
                            {regeneratingId === contract.id ? (
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
                          onClick={() => handleViewPdf(contract.id)}
                          title={contract.is_stale ? "PDF will reflect current estimate (rooms/line items may have changed)" : undefined}
                        >
                          <FileText className="mr-2 h-4 w-4" />View PDF
                        </Button>
                        {contract.status === 'signed' && (
                          <Button variant="outline" size="sm" onClick={() => handleStartJob(contract.id)}>
                            <Play className="mr-2 h-4 w-4" />Start Job
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile Card List */}
          <div className="space-y-3 md:hidden">
            {contracts.map((contract) => (
              <Card key={contract.id} className="p-4">
                <div className="space-y-3">
                  {/* Header: date + status */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {new Date(contract.created_at).toLocaleDateString()}
                    </span>
                    <Badge>{contract.status}</Badge>
                  </div>

                  {/* Price + stale */}
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold">
                      ${new Intl.NumberFormat().format(contract.total_price || 0)}
                    </span>
                    {contract.is_stale && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                        <RefreshCcw className="mr-1 h-3 w-3" />
                        Out of date
                      </Badge>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    {contract.is_stale && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRegenerate(contract.id)}
                        disabled={regeneratingId === contract.id}
                        className="text-amber-700 border-amber-300 hover:bg-amber-50 min-h-[44px] flex-1"
                      >
                        {regeneratingId === contract.id ? (
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
                      onClick={() => handleViewPdf(contract.id)}
                      className="min-h-[44px] flex-1"
                    >
                      <FileText className="mr-2 h-4 w-4" />View PDF
                    </Button>
                    {contract.status === 'signed' && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => handleStartJob(contract.id)}
                        className="min-h-[44px] flex-1"
                      >
                        <Play className="mr-2 h-4 w-4" />Start Job
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <CreateContractDrawer
        open={createDrawerOpen}
        onOpenChange={setCreateDrawerOpen}
        projectId={project.id}
        onSuccess={() => {
          fetchContracts()
          setCreateDrawerOpen(false)
        }}
      />
    </div>
  )
}


