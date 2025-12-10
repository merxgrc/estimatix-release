'use client'

import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { Project } from "@/types/db"
import type { Selection } from "@/types/db"
import { supabase } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth-context"
import { Plus, Save, Link2, AlertTriangle, Loader2 } from "lucide-react"
import { toast } from 'sonner'
import { COST_CATEGORIES } from '@/lib/constants'

interface LineItem {
  id: string
  description: string | null
  room_name: string | null
  cost_code: string | null
  selection_id: string | null
}

interface SelectionsTabProps {
  project: Project
  activeEstimateId: string | null
}

export function SelectionsTab({ project, activeEstimateId }: SelectionsTabProps) {
  const { user } = useAuth()
  const [selections, setSelections] = useState<Selection[]>([])
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [linkingSelectionId, setLinkingSelectionId] = useState<string | null>(null)

  // Local state for editing
  const [editState, setEditState] = useState<Record<string, Partial<Selection>>>({})

  // Load selections and line items
  useEffect(() => {
    if (!activeEstimateId || !user) {
      setIsLoading(false)
      return
    }

    const loadData = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Load selections for this estimate
        const { data: selectionsData, error: selectionsError } = await supabase
          .from('selections')
          .select('*')
          .eq('estimate_id', activeEstimateId)
          .order('created_at', { ascending: true })

        if (selectionsError) {
          throw new Error(`Failed to load selections: ${selectionsError.message}`)
        }

        // Load line items for this estimate
        const { data: lineItemsData, error: lineItemsError } = await supabase
          .from('estimate_line_items')
          .select('id, description, room_name, cost_code, selection_id')
          .eq('estimate_id', activeEstimateId)

        if (lineItemsError) {
          throw new Error(`Failed to load line items: ${lineItemsError.message}`)
        }

        setSelections(selectionsData || [])
        setLineItems(lineItemsData || [])
      } catch (err) {
        console.error('Error loading selections:', err)
        setError(err instanceof Error ? err.message : 'Failed to load selections')
        toast.error('Failed to load selections')
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [activeEstimateId, user])

  const handleEdit = (selection: Selection) => {
    setEditingId(selection.id)
    setEditState({
      [selection.id]: {
        title: selection.title,
        description: selection.description || null,
        cost_code: selection.cost_code || null,
        room: selection.room || null,
        category: selection.category || null,
        allowance: selection.allowance || null,
        subcontractor: selection.subcontractor || null,
      }
    })
  }

  const handleFieldChange = (selectionId: string, field: keyof Selection, value: any) => {
    setEditState(prev => ({
      ...prev,
      [selectionId]: {
        ...prev[selectionId],
        [field]: value === '' ? null : value
      }
    }))
  }

  const handleSave = async (selection: Selection) => {
    if (!user) return

    const edits = editState[selection.id]
    if (!edits) return

    setSavingId(selection.id)
    try {
      // Update selection in database
      const { error: updateError } = await supabase
        .from('selections')
        .update(edits)
        .eq('id', selection.id)

      if (updateError) {
        throw new Error(`Failed to update selection: ${updateError.message}`)
      }

      // Update local state
      setSelections(prev => prev.map(s => 
        s.id === selection.id ? { ...s, ...edits } : s
      ))

      // Clear edit state
      setEditingId(null)
      setEditState(prev => {
        const next = { ...prev }
        delete next[selection.id]
        return next
      })

      toast.success('Selection updated')

      // Trigger sync to line items
      await handleSync(selection.id)
    } catch (err) {
      console.error('Error saving selection:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to save selection')
    } finally {
      setSavingId(null)
    }
  }

  const handleSync = async (selectionId: string) => {
    if (!user) return

    setSyncingId(selectionId)
    try {
      const response = await fetch('/api/selections/sync-line-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ selectionId }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to sync line items')
      }

      toast.success('Line items synced')
    } catch (err) {
      console.error('Error syncing line items:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to sync line items')
    } finally {
      setSyncingId(null)
    }
  }

  const handleCreateSelection = async () => {
    if (!activeEstimateId || !user) return

    try {
      const { data: newSelection, error: insertError } = await supabase
        .from('selections')
        .insert({
          estimate_id: activeEstimateId,
          title: 'New Selection',
          source: 'manual',
        })
        .select()
        .single()

      if (insertError) {
        throw new Error(`Failed to create selection: ${insertError.message}`)
      }

      setSelections(prev => [...prev, newSelection])
      setEditingId(newSelection.id)
      setEditState({
        [newSelection.id]: {
          title: newSelection.title,
          description: null,
          cost_code: null,
          room: null,
          category: null,
          allowance: null,
          subcontractor: null,
        }
      })

      toast.success('Selection created')
    } catch (err) {
      console.error('Error creating selection:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to create selection')
    }
  }

  const handleLinkToLineItem = async (selectionId: string, lineItemId: string) => {
    if (!user) return

    try {
      // Update line item to reference this selection
      const { error: updateError } = await supabase
        .from('estimate_line_items')
        .update({ selection_id: selectionId })
        .eq('id', lineItemId)

      if (updateError) {
        throw new Error(`Failed to link line item: ${updateError.message}`)
      }

      // Check if selection has allowance and set is_allowance flag
      const selection = selections.find(s => s.id === selectionId)
      if (selection && selection.allowance !== null) {
        const { error: allowanceError } = await supabase
          .from('estimate_line_items')
          .update({ is_allowance: true })
          .eq('id', lineItemId)

        if (allowanceError) {
          console.warn('Failed to set is_allowance flag:', allowanceError)
        }
      }

      // Refresh line items
      const { data: updatedLineItems, error: refreshError } = await supabase
        .from('estimate_line_items')
        .select('id, description, room_name, cost_code, selection_id')
        .eq('estimate_id', activeEstimateId)

      if (!refreshError && updatedLineItems) {
        setLineItems(updatedLineItems)
      }

      setLinkingSelectionId(null)
      toast.success('Line item linked')

      // Trigger sync
      await handleSync(selectionId)
    } catch (err) {
      console.error('Error linking line item:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to link line item')
      setLinkingSelectionId(null)
    }
  }

  const getSourceBadgeVariant = (source: string | null) => {
    switch (source) {
      case 'manual': return 'default'
      case 'voice': return 'secondary'
      case 'ai_text': return 'outline'
      case 'file': return 'outline'
      default: return 'default'
    }
  }

  const getLinkedItemsCount = (selectionId: string) => {
    return lineItems.filter(item => item.selection_id === selectionId).length
  }

  const getAvailableLineItems = (selectionId: string) => {
    // Return line items that don't have a selection_id or have this selection_id
    return lineItems.filter(item => 
      !item.selection_id || item.selection_id === selectionId
    )
  }

  if (!activeEstimateId) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Please create an estimate first before managing selections.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Loading selections...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Selections & Allowances</h2>
          <p className="text-sm text-muted-foreground">
            Manage product selections and allowances for this estimate
          </p>
        </div>
        <Button onClick={handleCreateSelection}>
          <Plus className="mr-2 h-4 w-4" />
          Add Selection
        </Button>
      </div>

      {selections.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">No selections yet</p>
              <Button onClick={handleCreateSelection} variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Create First Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cost Code</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Allowance</TableHead>
                  <TableHead>Subcontractor</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Linked Items</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selections.map((selection) => {
                  const isEditing = editingId === selection.id
                  const isSaving = savingId === selection.id
                  const isSyncing = syncingId === selection.id
                  const isLinking = linkingSelectionId === selection.id
                  const edits = editState[selection.id] || {}
                  const linkedCount = getLinkedItemsCount(selection.id)

                  return (
                    <TableRow key={selection.id}>
                      <TableCell>
                        {isEditing ? (
                          <Select
                            value={edits.cost_code || ''}
                            onValueChange={(value) => handleFieldChange(selection.id, 'cost_code', value)}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue placeholder="Code" />
                            </SelectTrigger>
                            <SelectContent>
                              {COST_CATEGORIES.map(cat => (
                                <SelectItem key={cat.code} value={cat.code}>
                                  {cat.code}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          selection.cost_code || '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={edits.room || ''}
                            onChange={(e) => handleFieldChange(selection.id, 'room', e.target.value)}
                            className="w-32"
                            placeholder="Room"
                          />
                        ) : (
                          selection.room || '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={edits.category || ''}
                            onChange={(e) => handleFieldChange(selection.id, 'category', e.target.value)}
                            className="w-40"
                            placeholder="Category"
                          />
                        ) : (
                          selection.category || '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="space-y-1">
                            <Input
                              value={edits.title || ''}
                              onChange={(e) => handleFieldChange(selection.id, 'title', e.target.value)}
                              className="w-48"
                              placeholder="Title"
                            />
                            <Input
                              value={edits.description || ''}
                              onChange={(e) => handleFieldChange(selection.id, 'description', e.target.value)}
                              className="w-48 text-xs"
                              placeholder="Description (optional)"
                            />
                          </div>
                        ) : (
                          <div>
                            <div className="font-medium">{selection.title}</div>
                            {selection.description && (
                              <div className="text-xs text-muted-foreground mt-1">
                                {selection.description.substring(0, 50)}
                                {selection.description.length > 50 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={edits.allowance || ''}
                            onChange={(e) => handleFieldChange(selection.id, 'allowance', e.target.value ? parseFloat(e.target.value) : null)}
                            className="w-32"
                            placeholder="0.00"
                          />
                        ) : (
                          selection.allowance ? `$${selection.allowance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={edits.subcontractor || ''}
                            onChange={(e) => handleFieldChange(selection.id, 'subcontractor', e.target.value)}
                            className="w-40"
                            placeholder="Subcontractor"
                          />
                        ) : (
                          selection.subcontractor || '-'
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getSourceBadgeVariant(selection.source)}>
                          {selection.source || 'manual'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (isLinking) {
                              setLinkingSelectionId(null)
                            } else {
                              setLinkingSelectionId(selection.id)
                            }
                          }}
                        >
                          {linkedCount} {linkedCount === 1 ? 'item' : 'items'}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {isEditing ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleSave(selection)}
                                disabled={isSaving}
                              >
                                {isSaving ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Save className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingId(null)
                                  setEditState(prev => {
                                    const next = { ...prev }
                                    delete next[selection.id]
                                    return next
                                  })
                                }}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEdit(selection)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSync(selection.id)}
                                disabled={isSyncing}
                                title="Sync linked line items with this selection"
                              >
                                {isSyncing ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  'Sync'
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Link to Line Item Modal/Dropdown */}
      {linkingSelectionId && (
        <Card>
          <CardHeader>
            <CardTitle>Link to Line Item</CardTitle>
            <CardDescription>
              Select a line item to link to this selection
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {getAvailableLineItems(linkingSelectionId).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2 border rounded hover:bg-muted cursor-pointer"
                  onClick={() => handleLinkToLineItem(linkingSelectionId, item.id)}
                >
                  <div className="flex-1">
                    <div className="font-medium">{item.description || 'Untitled'}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.room_name || 'No room'} • {item.cost_code || 'No code'}
                    </div>
                  </div>
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                </div>
              ))}
              {getAvailableLineItems(linkingSelectionId).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No available line items to link
                </p>
              )}
            </div>
            <div className="mt-4">
              <Button
                variant="outline"
                onClick={() => setLinkingSelectionId(null)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

