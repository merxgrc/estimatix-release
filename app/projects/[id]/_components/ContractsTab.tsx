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
import { FileText, Play, Plus } from "lucide-react"
import { CreateContractDrawer } from '@/components/contracts/CreateContractDrawer'

interface Contract {
  id: string
  total_price: number
  down_payment: number
  status: string
  created_at: string
  proposal_id: string | null
}

export function ContractsTab({ project }: { project: Project }) {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)

  useEffect(() => {
    fetchContracts()
  }, [project.id])

  const fetchContracts = async () => {
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setContracts(data || [])
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
      <div className="flex justify-between items-center">
        <CardHeader className="p-0"><CardTitle>Contracts</CardTitle></CardHeader>
        <Button onClick={() => setCreateDrawerOpen(true)}><Plus className="mr-2 h-4 w-4" />New Contract</Button>
      </div>

      {contracts.length === 0 ? (
        <Card><CardContent className="py-12 text-center">No contracts yet</CardContent></Card>
      ) : (
        <Card>
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
                  <TableCell>{new Date(contract.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>${new Intl.NumberFormat().format(contract.total_price || 0)}</TableCell>
                  <TableCell><Badge>{contract.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleViewPdf(contract.id)}>
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


