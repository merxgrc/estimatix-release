'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { supabase } from "@/lib/supabase/client"
import { toast } from 'sonner'
import type { Project, EstimateStatus } from "@/types/db"
import { ListChecks, FileText, Plus, Play, Download, CheckCircle2 } from "lucide-react"
import { CreateInvoiceDrawer } from '@/components/invoices/CreateInvoiceDrawer'
import { CloseOutProjectDialog } from '@/components/projects/CloseOutProjectDialog'
import { EstimateVsActualSummary } from '@/components/projects/EstimateVsActualSummary'
import { startJobFromEstimate } from '@/actions/start-job'

interface ProjectTask {
  id: string
  description: string
  status: 'pending' | 'scheduled' | 'completed'
  price: number
  billed_amount: number
  completion_date: string | null
  room_name: string | null
  category: string | null
  original_line_item_id: string | null
}

interface Invoice {
  id: string
  invoice_number: string
  status: string
  total_amount: number
  issued_date: string
  due_date: string | null
}

export function ManageTab({ project }: { project: Project }) {
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false)
  const [closeOutOpen, setCloseOutOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('scope')
  const [startingJob, setStartingJob] = useState(false)
  const [estimateId, setEstimateId] = useState<string | null>(null)
  const [estimateStatus, setEstimateStatus] = useState<EstimateStatus | null>(null)

  // Fetch project tasks from Supabase
  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('project_tasks')
        .select(`
          *,
          estimate_line_items!project_tasks_original_line_item_id_fkey(
            room_name,
            category
          )
        `)
        .eq('project_id', project.id)
        .order('created_at', { ascending: true })

      if (error) throw error

      // Enrich tasks with room_name and category from linked estimate_line_items
      const enrichedTasks = (data || []).map((task: any) => ({
        id: task.id,
        description: task.description,
        status: task.status as 'pending' | 'scheduled' | 'completed',
        price: Number(task.price) || 0,
        billed_amount: Number(task.billed_amount) || 0,
        completion_date: task.completion_date,
        room_name: task.estimate_line_items?.room_name || null,
        category: task.estimate_line_items?.category || null,
        original_line_item_id: task.original_line_item_id
      }))

      setTasks(enrichedTasks)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching tasks:', error)
      toast.error('Failed to load tasks')
      setLoading(false)
    }
  }, [project.id])

  // Fetch invoices from Supabase
  const fetchInvoices = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setInvoices(data || [])
    } catch (error) {
      console.error('Error fetching invoices:', error)
      toast.error('Failed to load invoices')
    }
  }, [project.id])

  // Fetch estimate info for close out
  const fetchEstimate = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('estimates')
        .select('id, status')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!error && data) {
        setEstimateId(data.id)
        setEstimateStatus(data.status as EstimateStatus)
      }
    } catch (error) {
      console.error('Error fetching estimate:', error)
    }
  }, [project.id])

  // Fetch data on mount and when project.id changes
  useEffect(() => {
    if (project.id) {
      fetchTasks()
      fetchInvoices()
      fetchEstimate()
    }
  }, [project.id, fetchTasks, fetchInvoices, fetchEstimate])

  const handleStartJob = async () => {
    try {
      setStartingJob(true)
      const result = await startJobFromEstimate(project.id)
      
      if (result.success) {
        if (result.tasksCreated && result.tasksCreated > 0) {
          toast.success(result.message || `Successfully created ${result.tasksCreated} task${result.tasksCreated !== 1 ? 's' : ''}`)
        } else {
          toast.info(result.message || 'Job tasks already exist')
        }
        // Refresh tasks
        await fetchTasks()
      } else {
        toast.error(result.error || 'Failed to start job')
      }
    } catch (error) {
      console.error('Error starting job:', error)
      toast.error('Failed to start job')
    } finally {
      setStartingJob(false)
    }
  }

  const updateTaskStatus = async (taskId: string, status: 'pending' | 'scheduled' | 'completed') => {
    try {
      const updateData: { status: string; completion_date?: string | null } = { status }
      
      // If marking as completed, set completion_date to now
      // If changing from completed to another status, clear completion_date
      if (status === 'completed') {
        updateData.completion_date = new Date().toISOString()
      } else {
        // Clear completion_date if not completed
        updateData.completion_date = null
      }

      const { error } = await supabase
        .from('project_tasks')
        .update(updateData)
        .eq('id', taskId)

      if (error) throw error
      
      toast.success('Task status updated')
      fetchTasks()
    } catch (error) {
      console.error('Error updating task status:', error)
      toast.error('Failed to update task status')
    }
  }

  const completedTasks = tasks.filter(t => t.status === 'completed').length
  const totalTasks = tasks.length
  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0

  // Group tasks by Category/Room
  // Format: "Category - Room" or "Room" if no category, or "General" if neither
  const groupedTasks = tasks.reduce((acc, task) => {
    const category = task.category || 'Other'
    const room = task.room_name || 'General'
    
    // Create a readable group key
    let groupKey: string
    if (category && category !== 'Other' && room && room !== 'General') {
      groupKey = `${category} - ${room}`
    } else if (category && category !== 'Other') {
      groupKey = category
    } else if (room && room !== 'General') {
      groupKey = room
    } else {
      groupKey = 'General'
    }
    
    if (!acc[groupKey]) acc[groupKey] = []
    acc[groupKey].push(task)
    return acc
  }, {} as Record<string, ProjectTask[]>)

  // Sort groups alphabetically
  const sortedGroups = Object.entries(groupedTasks).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="scope">Scope Tracker</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="scope" className="space-y-4">
          {/* Estimate vs Actual Summary - Show when project is completed */}
          {estimateStatus === 'completed' && estimateId && (
            <EstimateVsActualSummary 
              projectId={project.id} 
              estimateId={estimateId} 
            />
          )}
          
          {loading ? (
            <Card><CardContent className="py-12 text-center">Loading...</CardContent></Card>
          ) : totalTasks === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <ListChecks className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No tasks yet</h3>
              <p className="text-muted-foreground mb-6">Start a job to create tasks from your estimate.</p>
              <Button 
                onClick={handleStartJob} 
                disabled={startingJob}
                size="lg"
                className="gap-2"
              >
                <Play className="h-5 w-5" />
                {startingJob ? 'Starting Job...' : 'Start Job'}
              </Button>
            </CardContent></Card>
          ) : (
            <>
              {/* Progress Bar */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Project Progress</CardTitle>
                  {/* Close Out Button - Show when estimate is contract_signed */}
                  {estimateStatus === 'contract_signed' && estimateId && (
                    <Button 
                      onClick={() => setCloseOutOpen(true)}
                      variant="outline"
                      className="gap-2"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Close Out Project
                    </Button>
                  )}
                  {estimateStatus === 'completed' && (
                    <Badge variant="secondary" className="bg-green-100 text-green-800">
                      Project Completed
                    </Badge>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm font-medium">
                      <span>{completedTasks} of {totalTasks} tasks completed</span>
                      <span className="tabular-nums">{Math.round(progress)}% of Project Completed</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                </CardContent>
              </Card>

              {/* Grouped Tasks by Category/Room */}
              {sortedGroups.map(([group, groupTasks]) => (
                <Card key={group}>
                  <CardHeader>
                    <CardTitle className="text-lg">{group}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50%]">Description</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="w-[180px]">Status</TableHead>
                      </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groupTasks.map((task) => (
                          <TableRow key={task.id}>
                            <TableCell>{task.description}</TableCell>
                            <TableCell className="tabular-nums">
                              ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(task.price || 0)}
                            </TableCell>
                            <TableCell>
                              <Select 
                                value={task.status} 
                                onValueChange={(value: 'pending' | 'scheduled' | 'completed') => updateTaskStatus(task.id, value)}
                              >
                                <SelectTrigger className="w-40">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="pending">Pending</SelectItem>
                                  <SelectItem value="scheduled">Scheduled</SelectItem>
                                  <SelectItem value="completed">Completed</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-semibold">Project Invoices</h2>
            <Button onClick={() => setCreateInvoiceOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create New Invoice
            </Button>
          </div>

          {invoices.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No invoices yet</h3>
              <p className="text-muted-foreground">Create your first invoice to start billing.</p>
            </CardContent></Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date Issued</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => {
                    // Determine badge variant based on status
                    const getStatusVariant = (status: string) => {
                      switch (status.toLowerCase()) {
                        case 'paid':
                          return 'default' // Green (primary)
                        case 'sent':
                          return 'secondary' // Blue
                        case 'draft':
                          return 'outline' // Gray
                        case 'overdue':
                          return 'destructive' // Red
                        default:
                          return 'outline'
                      }
                    }

                    // Get status color class for custom styling
                    const getStatusColor = (status: string) => {
                      switch (status.toLowerCase()) {
                        case 'paid':
                          return 'bg-primary/20 text-primary border-primary/30'
                        case 'sent':
                          return 'bg-primary/10 text-primary border-primary/20'
                        case 'draft':
                          return 'bg-muted text-muted-foreground border-border'
                        case 'overdue':
                          return 'bg-destructive/10 text-destructive border-destructive/30'
                        default:
                          return 'bg-muted text-muted-foreground border-border'
                      }
                    }

                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                        <TableCell>{new Date(invoice.issued_date).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(invoice.total_amount || 0)}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={getStatusVariant(invoice.status) as any}
                            className={getStatusColor(invoice.status)}
                          >
                            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={async () => {
                              try {
                                const response = await fetch(`/api/invoices/${invoice.id}/pdf`)
                                if (!response.ok) throw new Error('Failed to generate PDF')
                                const blob = await response.blob()
                                const url = window.URL.createObjectURL(blob)
                                const a = document.createElement('a')
                                a.href = url
                                a.download = `${invoice.invoice_number}.pdf`
                                document.body.appendChild(a)
                                a.click()
                                document.body.removeChild(a)
                                window.URL.revokeObjectURL(url)
                                toast.success('PDF downloaded')
                              } catch (err) {
                                toast.error('Failed to download PDF')
                              }
                            }}
                            title="Download PDF"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          <CreateInvoiceDrawer
            open={createInvoiceOpen}
            onOpenChange={setCreateInvoiceOpen}
            projectId={project.id}
            tasks={tasks}
            onSuccess={() => {
              fetchInvoices()
              fetchTasks()
              setCreateInvoiceOpen(false)
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Close Out Project Dialog */}
      {estimateId && (
        <CloseOutProjectDialog
          open={closeOutOpen}
          onOpenChange={setCloseOutOpen}
          projectId={project.id}
          estimateId={estimateId}
          projectName={project.title}
          onSuccess={() => {
            fetchEstimate()
            toast.success('Project closed out successfully!')
          }}
        />
      )}
    </div>
  )
}


