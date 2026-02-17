'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
// Alert unused here - scope status shown via Switch + Badge inline
import type { Project, Room } from "@/types/db"
import { getProjectRooms, upsertRoom, toggleRoomScope, deleteRoom, updateRoomDimensions, type RoomWithStats } from "@/actions/rooms"
import { RoomDimensionsEditor } from "@/components/rooms/RoomDimensionsEditor"
import { Plus, Trash2, ExternalLink, Loader2 } from "lucide-react"
import { toast } from 'sonner'

interface RoomsTabProps {
  project: Project
}

export function RoomsTab({ project }: RoomsTabProps) {
  const router = useRouter()
  const [rooms, setRooms] = useState<RoomWithStats[]>([])
  const [selectedRoom, setSelectedRoom] = useState<RoomWithStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isToggling, setIsToggling] = useState<string | null>(null)
  
  // Form state for add/edit room
  const [formData, setFormData] = useState({
    id: undefined as string | undefined,
    name: '',
    level: '',          // Empty = user must select; maps to NULL in DB
    type: '',
    area: '',
    length_ft: '',
    width_ft: '',
    ceiling_height_ft: '8',
    notes: '',
  })

  // Fetch rooms on mount
  useEffect(() => {
    fetchRooms()
  }, [project.id])

  // Listen for rooms-updated event (e.g. after blueprint parsing)
  useEffect(() => {
    const handleRoomsUpdated = () => {
      console.log('[RoomsTab] Received rooms-updated event, refetching rooms...')
      fetchRooms()
    }
    window.addEventListener('rooms-updated', handleRoomsUpdated)
    return () => window.removeEventListener('rooms-updated', handleRoomsUpdated)
  }, [project.id])

  const fetchRooms = async () => {
    try {
      setIsLoading(true)
      const result = await getProjectRooms(project.id)
      if (result.success && result.rooms) {
        setRooms(result.rooms)
        // If selected room exists, update it
        if (selectedRoom) {
          const updated = result.rooms.find(r => r.id === selectedRoom.id)
          if (updated) {
            setSelectedRoom(updated)
          } else {
            setSelectedRoom(null)
          }
        }
      } else {
        toast.error(result.error || 'Failed to load rooms')
      }
    } catch (error) {
      console.error('Error fetching rooms:', error)
      toast.error('Failed to load rooms')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddRoom = () => {
    setFormData({
      id: undefined,
      name: '',
      level: '',           // Empty = user must select
      type: '',
      area: '',
      length_ft: '',
      width_ft: '',
      ceiling_height_ft: '8',
      notes: '',
    })
    setIsDialogOpen(true)
  }

  const handleEditRoom = (room: RoomWithStats) => {
    setFormData({
      id: room.id,
      name: room.name,
      level: room.level || '',
      type: room.type || '',
      area: room.area_sqft?.toString() || '',
      length_ft: room.length_ft?.toString() || '',
      width_ft: room.width_ft?.toString() || '',
      ceiling_height_ft: room.ceiling_height_ft?.toString() || '8',
      notes: room.notes || '',
    })
    setIsDialogOpen(true)
  }

  const handleSaveRoom = async () => {
    if (!formData.name.trim()) {
      toast.error('Room name is required')
      return
    }

    try {
      const result = await upsertRoom({
        projectId: project.id,
        id: formData.id,
        name: formData.name.trim(),
        level: formData.level.trim() || undefined, // Let server default for new rooms; preserve existing for edits
        type: formData.type.trim() || null,
        area: formData.area ? parseFloat(formData.area) : null,
        length_ft: formData.length_ft ? parseFloat(formData.length_ft) : null,
        width_ft: formData.width_ft ? parseFloat(formData.width_ft) : null,
        ceiling_height_ft: formData.ceiling_height_ft ? parseFloat(formData.ceiling_height_ft) : null,
        notes: formData.notes.trim() || null,
      })

      if (result.success && result.room) {
        toast.success(formData.id ? 'Room updated successfully' : 'Room created successfully')
        setIsDialogOpen(false)
        await fetchRooms()
        // Select the newly created/updated room
        if (result.room) {
          const updatedRooms = await getProjectRooms(project.id)
          if (updatedRooms.success && updatedRooms.rooms) {
            const updated = updatedRooms.rooms.find(r => r.id === result.room!.id)
            if (updated) setSelectedRoom(updated)
          }
        }
      } else {
        toast.error(result.error || 'Failed to save room')
      }
    } catch (error) {
      console.error('Error saving room:', error)
      toast.error('Failed to save room')
    }
  }

  const handleToggleScope = async (roomId: string, currentStatus: boolean) => {
    try {
      setIsToggling(roomId)
      // Optimistic update — toggle both is_in_scope and is_active
      const newStatus = !currentStatus
      setRooms(prev => prev.map(r => 
        r.id === roomId ? { ...r, is_in_scope: newStatus, is_active: newStatus } : r
      ))
      if (selectedRoom?.id === roomId) {
        setSelectedRoom(prev => prev ? { ...prev, is_in_scope: newStatus, is_active: newStatus } : null)
      }

      const result = await toggleRoomScope(roomId, newStatus)
      
      if (!result.success) {
        // Revert optimistic update on error
        await fetchRooms()
        toast.error(result.error || 'Failed to toggle room scope')
      } else {
        const action = newStatus ? 'included in' : 'excluded from'
        toast.success(`Room ${action} scope`)
        // Refresh to get updated stats (room totals may change in display)
        await fetchRooms()
        // Notify EstimateTable to re-fetch (scope map + grand total changed)
        window.dispatchEvent(new CustomEvent('estimate-updated'))
      }
    } catch (error) {
      console.error('Error toggling scope:', error)
      await fetchRooms() // Revert on error
      toast.error('Failed to toggle room scope')
    } finally {
      setIsToggling(null)
    }
  }

  const handleDeleteRoom = async () => {
    if (!selectedRoom) return

    try {
      setIsDeleting(true)
      const result = await deleteRoom(selectedRoom.id)
      
      if (result.success) {
        toast.success('Room deleted successfully')
        setSelectedRoom(null)
        await fetchRooms()
      } else {
        toast.error(result.error || 'Failed to delete room')
      }
    } catch (error) {
      console.error('Error deleting room:', error)
      toast.error('Failed to delete room')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDimensionSave = async (dimensions: {
    length_ft: number | null
    width_ft: number | null
    ceiling_height_ft: number | null
  }) => {
    if (!selectedRoom) return { success: false, error: 'No room selected' }

    const result = await updateRoomDimensions({
      roomId: selectedRoom.id,
      ...dimensions,
    })

    if (result.success && result.room) {
      // Optimistically update the selected room and room list
      const updatedRoom = { ...selectedRoom, ...result.room }
      setSelectedRoom(updatedRoom)
      setRooms(prev =>
        prev.map(r => (r.id === updatedRoom.id ? { ...r, ...result.room! } : r))
      )

      if (result.affectedLineItems && result.affectedLineItems > 0) {
        toast.success(
          `Dimensions saved · ${result.affectedLineItems} line item${result.affectedLineItems > 1 ? 's' : ''} updated`
        )
      }

      // Re-fetch to get accurate stats (line item totals may have changed)
      await fetchRooms()
    } else {
      toast.error(result.error || 'Failed to save dimensions')
    }

    return result
  }

  const handleViewInEstimate = () => {
    if (!selectedRoom) return
    // Navigate to estimate tab with roomId query param
    router.push(`/projects/${project.id}?tab=estimate&roomId=${selectedRoom.id}`)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <div className="flex flex-col md:flex-row h-full gap-4">
      {/* Left Pane: Room List */}
      <div className="w-full md:w-1/2 space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Rooms</CardTitle>
                <CardDescription>
                  Manage rooms and view cost breakdowns
                </CardDescription>
              </div>
              <Button onClick={handleAddRoom} size="sm" className="min-h-[44px] md:min-h-0">
                <Plus className="mr-2 h-4 w-4" />
                Add Room
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : rooms.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <p>No rooms yet. Click &quot;Add Room&quot; to get started.</p>
              </div>
            ) : (
              <>
                {/* Mobile: Card view */}
                <div className="md:hidden space-y-2">
                  {rooms.map((room) => {
                    const inScope = room.is_in_scope !== false
                    return (
                      <div
                        key={room.id}
                        className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                          selectedRoom?.id === room.id ? 'bg-muted border-primary/30' : 'hover:bg-muted/50'
                        } ${!inScope ? 'opacity-50' : ''}`}
                        onClick={() => setSelectedRoom(room)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate">{room.name}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {room.level || 'Unknown level'}
                              {room.floor_area_sqft ? ` • ${Number(room.floor_area_sqft).toLocaleString()} sq ft` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="text-right">
                              <div className="text-sm font-medium">{formatCurrency(room.client_total)}</div>
                            </div>
                            <Switch
                              checked={inScope}
                              disabled={isToggling === room.id}
                              onCheckedChange={(e) => {
                                e // prevent card click
                                handleToggleScope(room.id, room.is_in_scope ?? true)
                              }}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Toggle ${room.name} scope`}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Desktop: Table view */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Level</TableHead>
                        <TableHead>Floor Area</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Scope</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rooms.map((room) => {
                        const inScope = room.is_in_scope !== false
                        return (
                          <TableRow
                            key={room.id}
                            className={`cursor-pointer ${
                              selectedRoom?.id === room.id ? 'bg-muted' : ''
                            } ${!inScope ? 'opacity-50' : ''}`}
                            onClick={() => setSelectedRoom(room)}
                          >
                            <TableCell className="font-medium">{room.name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{room.level || 'Unknown'}</TableCell>
                            <TableCell>
                              {room.floor_area_sqft
                                ? `${Number(room.floor_area_sqft).toLocaleString()} sq ft`
                                : room.area_sqft
                                  ? `${Number(room.area_sqft).toLocaleString()} sq ft`
                                  : '—'}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(room.client_total)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={inScope}
                                  disabled={isToggling === room.id}
                                  onCheckedChange={() =>
                                    handleToggleScope(room.id, room.is_in_scope ?? true)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Toggle ${room.name} scope`}
                                />
                                <span className={`text-xs ${inScope ? 'text-foreground' : 'text-muted-foreground'}`}>
                                  {inScope ? 'In Scope' : 'Excluded'}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right Pane: Room Detail */}
      <div className="w-full md:w-1/2">
        {selectedRoom ? (
          <div className="space-y-4">
            {/* Room Details Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{selectedRoom.name}</CardTitle>
                    <CardDescription>
                      {selectedRoom.level && `${selectedRoom.level} • `}
                      {selectedRoom.type && `${selectedRoom.type} • `}
                      {selectedRoom.line_item_count} line items
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditRoom(selectedRoom)}
                  >
                    Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Room Info */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Level</Label>
                    <p className="text-sm font-medium">
                      {selectedRoom.level || 'Unknown level'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Type</Label>
                    <p className="text-sm font-medium">
                      {selectedRoom.type || 'Not specified'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Scope</Label>
                    <Badge variant={selectedRoom.is_in_scope !== false ? 'default' : 'secondary'} className="mt-0.5">
                      {selectedRoom.is_in_scope !== false ? 'In Scope' : 'Excluded'}
                    </Badge>
                  </div>
                </div>

                {/* Dimensions Editor (inline, auto-save) */}
                <div className="border-t pt-4">
                  <RoomDimensionsEditor
                    room={selectedRoom}
                    onSave={handleDimensionSave}
                    disabled={selectedRoom.is_in_scope === false}
                  />
                </div>

                {selectedRoom.notes && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <p className="text-sm">{selectedRoom.notes}</p>
                  </div>
                )}

                {/* Cost Summary */}
                <div>
                  <Label className="text-sm font-semibold mb-3 block">
                    Cost Summary
                  </Label>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-3 bg-muted rounded-md">
                      <span className="text-sm font-medium">Direct Cost</span>
                      <span className="text-sm font-semibold">
                        {formatCurrency(selectedRoom.direct_total)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-muted rounded-md">
                      <span className="text-sm font-medium">Client Price</span>
                      <span className="text-sm font-semibold text-primary">
                        {formatCurrency(selectedRoom.client_total)}
                      </span>
                    </div>
                  </div>

                  {/* Trade Breakdown */}
                  {Object.keys(selectedRoom.trade_breakdown).length > 0 && (
                    <div className="mt-4">
                      <Label className="text-xs text-muted-foreground mb-2 block">
                        Breakdown by Trade
                      </Label>
                      <div className="space-y-1">
                        {Object.entries(selectedRoom.trade_breakdown)
                          .sort(([, a], [, b]) => b - a)
                          .map(([trade, amount]) => (
                            <div
                              key={trade}
                              className="flex justify-between items-center py-1.5 px-2 rounded hover:bg-muted/50"
                            >
                              <span className="text-xs">{trade}</span>
                              <span className="text-xs font-medium">
                                {formatCurrency(amount)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="toggle-scope" className="text-sm">
                        {selectedRoom.is_in_scope !== false ? 'In Scope' : 'Excluded from Scope'}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {selectedRoom.is_in_scope !== false
                          ? 'Room costs are included in all totals'
                          : 'Room costs are excluded from all totals'}
                      </p>
                    </div>
                    <Switch
                      id="toggle-scope"
                      checked={selectedRoom.is_in_scope !== false}
                      disabled={isToggling === selectedRoom.id}
                      onCheckedChange={() =>
                        handleToggleScope(selectedRoom.id, selectedRoom.is_in_scope ?? true)
                      }
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={handleViewInEstimate}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View in Estimate
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteRoom}
                      disabled={isDeleting}
                    >
                      {isDeleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center text-muted-foreground">
                <p className="text-sm">Select a room to view details</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add/Edit Room Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {formData.id ? 'Edit Room' : 'Add Room'}
            </DialogTitle>
            <DialogDescription>
              {formData.id
                ? 'Update room information'
                : 'Create a new room for this project'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Room Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="e.g., Master Bedroom"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="level">Level</Label>
                <select
                  id="level"
                  value={formData.level}
                  onChange={(e) =>
                    setFormData({ ...formData, level: e.target.value })
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">— Select level —</option>
                  <option value="Level 1">Level 1</option>
                  <option value="Level 2">Level 2</option>
                  <option value="Level 3">Level 3</option>
                  <option value="Basement">Basement</option>
                  <option value="Garage">Garage</option>
                  <option value="Attic">Attic</option>
                  <option value="Roof">Roof</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Input
                id="type"
                value={formData.type}
                onChange={(e) =>
                  setFormData({ ...formData, type: e.target.value })
                }
                placeholder="e.g., Bedroom, Kitchen, Bathroom"
              />
            </div>

            {/* Dimensions */}
            <div>
              <Label className="text-sm font-semibold mb-2 block">Dimensions (ft)</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="length_ft" className="text-xs text-muted-foreground">Length</Label>
                  <Input
                    id="length_ft"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.length_ft}
                    onChange={(e) =>
                      setFormData({ ...formData, length_ft: e.target.value })
                    }
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="width_ft" className="text-xs text-muted-foreground">Width</Label>
                  <Input
                    id="width_ft"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.width_ft}
                    onChange={(e) =>
                      setFormData({ ...formData, width_ft: e.target.value })
                    }
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ceiling_height_ft" className="text-xs text-muted-foreground">Ceiling Ht.</Label>
                  <Input
                    id="ceiling_height_ft"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.ceiling_height_ft}
                    onChange={(e) =>
                      setFormData({ ...formData, ceiling_height_ft: e.target.value })
                    }
                    placeholder="8"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                placeholder="Additional notes about this room..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              className="min-h-[44px] md:min-h-0"
            >
              Cancel
            </Button>
            <Button onClick={handleSaveRoom} className="min-h-[44px] md:min-h-0">
              {formData.id ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
