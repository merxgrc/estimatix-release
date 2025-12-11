'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createInvoice } from '@/actions/invoices'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { CalendarIcon, DollarSign, Percent } from "lucide-react"

interface ProjectTask {
  id: string
  description: string
  status: string
  price: number
  billed_amount: number
  room_name?: string | null
  category?: string | null
}

interface CreateInvoiceDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  tasks: ProjectTask[]
  onSuccess: () => void
}

export function CreateInvoiceDrawer({ open, onOpenChange, projectId, tasks, onSuccess }: CreateInvoiceDrawerProps) {
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())
  const [billingMode, setBillingMode] = useState<'full' | 'percentage'>('full')
  const [percentage, setPercentage] = useState(50)
  const [issuedDate, setIssuedDate] = useState<Date>(new Date())
  const [dueDate, setDueDate] = useState<Date>()
  const [loading, setLoading] = useState(false)

  // Filter to only show completed tasks that have remaining balance
  const availableTasks = tasks.filter(t => {
    const remaining = (t.price || 0) - (t.billed_amount || 0)
    return t.status === 'completed' && remaining > 0
  })

  // Group tasks by category/room for easier selection
  const groupedTasks = availableTasks.reduce((acc, task) => {
    const category = task.category || 'Other'
    const room = task.room_name || 'General'
    const groupKey = category !== 'Other' && room !== 'General' 
      ? `${category} - ${room}`
      : category !== 'Other'
      ? category
      : room !== 'General'
      ? room
      : 'General'
    
    if (!acc[groupKey]) acc[groupKey] = []
    acc[groupKey].push(task)
    return acc
  }, {} as Record<string, ProjectTask[]>)

  const sortedGroups = Object.entries(groupedTasks).sort(([a], [b]) => a.localeCompare(b))

  // Calculate remaining balance for a task
  const getRemainingBalance = (task: ProjectTask): number => {
    return (task.price || 0) - (task.billed_amount || 0)
  }

  // Calculate invoice total based on selected tasks and billing mode
  const calculateTotal = () => {
    if (selectedTasks.size === 0) return 0

    if (billingMode === 'full') {
      // Option A: Bill 100% of selected completed tasks
      return Array.from(selectedTasks).reduce((sum, taskId) => {
        const task = availableTasks.find(t => t.id === taskId)
        if (!task) return sum
        return sum + getRemainingBalance(task)
      }, 0)
    } else {
      // Option B: Percentage Billing (e.g., Bill 50% of the Cabinetry package)
      return Array.from(selectedTasks).reduce((sum, taskId) => {
        const task = availableTasks.find(t => t.id === taskId)
        if (!task) return sum
        const remaining = getRemainingBalance(task)
        return sum + (remaining * (percentage / 100))
      }, 0)
    }
  }

  // Calculate what will be billed for a specific task
  const getTaskBillingAmount = (task: ProjectTask): number => {
    if (!selectedTasks.has(task.id)) return 0
    const remaining = getRemainingBalance(task)
    return billingMode === 'full' ? remaining : remaining * (percentage / 100)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedTasks.size === 0) {
      toast.error('Please select at least one task to bill')
      return
    }

    // Validate percentage if in percentage mode
    if (billingMode === 'percentage' && (percentage <= 0 || percentage > 100)) {
      toast.error('Percentage must be between 1 and 100')
      return
    }

    setLoading(true)
    try {
      // Build invoice items from selected tasks
      const items = Array.from(selectedTasks)
        .map(taskId => {
          const task = availableTasks.find(t => t.id === taskId)
          if (!task) return null
          
          const remaining = getRemainingBalance(task)
          const amount = billingMode === 'full' 
            ? remaining 
            : remaining * (percentage / 100)
          
          // Round to 2 decimal places
          const roundedAmount = Math.round(amount * 100) / 100
          
          return {
            taskId: task.id,
            amount: roundedAmount,
            description: task.description
          }
        })
        .filter((item): item is { taskId: string; amount: number; description: string } => item !== null)

      if (items.length === 0) {
        throw new Error('No valid items to invoice')
      }

      // Create invoice and invoice_items records
      const result = await createInvoice(projectId, {
        issuedDate: format(issuedDate, 'yyyy-MM-dd'),
        dueDate: dueDate ? format(dueDate, 'yyyy-MM-dd') : undefined,
        items
      })

      if (!result.success) throw new Error(result.error)
      
      toast.success(`Invoice ${result.invoiceNumber} created successfully!`)
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error creating invoice:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create invoice')
    } finally {
      setLoading(false)
    }
  }

  // Reset form when drawer closes
  useEffect(() => {
    if (!open) {
      setSelectedTasks(new Set())
      setBillingMode('full')
      setPercentage(50)
      setIssuedDate(new Date())
      setDueDate(undefined)
    }
  }, [open])

  const invoiceTotal = calculateTotal()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Invoice</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Selection Mode: Select scopes from project_tasks */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Select Tasks to Bill</CardTitle>
            </CardHeader>
            <CardContent>
              {availableTasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No completed tasks with remaining balance available to invoice.</p>
                  <p className="text-sm mt-2">Complete tasks first, then create invoices.</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[400px] overflow-y-auto">
                  {sortedGroups.map(([groupName, groupTasks]) => (
                    <div key={groupName} className="space-y-2">
                      <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                        {groupName}
                      </h4>
                      <div className="space-y-2 pl-2">
                        {groupTasks.map((task) => {
                          const remaining = getRemainingBalance(task)
                          const billingAmount = getTaskBillingAmount(task)
                          const isSelected = selectedTasks.has(task.id)
                          
                          return (
                            <div
                              key={task.id}
                              className={cn(
                                "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                                isSelected ? "bg-primary/5 border-primary" : "bg-muted/30 border-border hover:bg-muted/50"
                              )}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  const newSelected = new Set(selectedTasks)
                                  if (checked) {
                                    newSelected.add(task.id)
                                  } else {
                                    newSelected.delete(task.id)
                                  }
                                  setSelectedTasks(newSelected)
                                }}
                                className="mt-1"
                              />
                              <div className="flex-1 min-w-0">
                                <Label className="font-medium cursor-pointer" htmlFor={`task-${task.id}`}>
                                  {task.description}
                                </Label>
                                <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                                  <span>Remaining: <span className="tabular-nums font-medium">${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(remaining)}</span></span>
                                  {isSelected && billingAmount > 0 && (
                                    <span className="text-primary font-semibold">
                                      Will bill: <span className="tabular-nums">${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(billingAmount)}</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Billing Mode Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Billing Mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup 
                value={billingMode} 
                onValueChange={(value: 'full' | 'percentage') => setBillingMode(value)}
              >
                <div className="flex items-start space-x-3 p-4 rounded-lg border">
                  <RadioGroupItem value="full" id="full" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="full" className="font-medium cursor-pointer">
                      Option A: Bill 100% of selected completed tasks
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Invoice the full remaining balance for each selected task.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3 p-4 rounded-lg border">
                  <RadioGroupItem value="percentage" id="percentage" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="percentage" className="font-medium cursor-pointer">
                      Option B: Percentage Billing
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Bill a percentage of the remaining balance (e.g., 50% of the Cabinetry package).
                    </p>
                    {billingMode === 'percentage' && (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="relative flex-1 max-w-[200px]">
                          <Input
                            type="number"
                            value={percentage}
                            onChange={(e) => {
                              const value = Number(e.target.value)
                              if (value >= 0 && value <= 100) {
                                setPercentage(value)
                              }
                            }}
                            min={0}
                            max={100}
                            step={1}
                            className="pr-8 tabular-nums"
                            placeholder="50"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          of remaining balance
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Invoice Dates */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Invoice Dates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="issued-date">Issued Date</Label>
                  <Popover modal>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        id="issued-date"
                        variant="outline"
                        className={cn("w-full justify-start text-left font-normal mt-2")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(issuedDate, "PPP")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar 
                        mode="single" 
                        selected={issuedDate} 
                        onSelect={(date) => {
                          if (date) {
                            setIssuedDate(date)
                          }
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label htmlFor="due-date">Due Date</Label>
                  <Popover modal>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        id="due-date"
                        variant="outline"
                        className={cn("w-full justify-start text-left font-normal mt-2", !dueDate && "text-muted-foreground")}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dueDate ? format(dueDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar 
                        mode="single" 
                        selected={dueDate} 
                        onSelect={setDueDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Invoice Summary */}
          <Card className="bg-muted/50">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-muted-foreground">Invoice Total</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedTasks.size} task{selectedTasks.size !== 1 ? 's' : ''} selected
                    {billingMode === 'percentage' && ` • ${percentage}% billing`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold tabular-nums">
                    ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(invoiceTotal)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>Create Invoice</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}


