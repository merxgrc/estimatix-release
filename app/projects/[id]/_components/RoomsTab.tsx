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
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { Project } from "@/types/db"
import { getProjectRooms, upsertRoom, toggleRoomScope, deleteRoom, type RoomWithStats } from "@/actions/rooms"
import { Plus, Eye, EyeOff, Trash2, ExternalLink, DollarSign, Loader2, AlertCircle } from "lucide-react"
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
    type: '',
    area: '',
    notes: '',
  })

  // Fetch rooms on mount
  useEffect(() => {
    fetchRooms()
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
      type: '',
      area: '',
      notes: '',
    })
    setIsDialogOpen(true)
  }

  const handleEditRoom = (room: RoomWithStats) => {
    setFormData({
      id: room.id,
      name: room.name,
      type: room.type || '',
      area: room.area_sqft?.toString() || '',
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
        type: formData.type.trim() || null,
        area: formData.area ? parseFloat(formData.area) : null,
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
      // Optimistic update
      const newStatus = !currentStatus
      setRooms(prev => prev.map(r => 
        r.id === roomId ? { ...r, is_active: newStatus } : r
      ))
      if (selectedRoom?.id === roomId) {
        setSelectedRoom(prev => prev ? { ...prev, is_active: newStatus } : null)
      }

      const result = await toggleRoomScope(roomId, newStatus)
      
      if (!result.success) {
        // Revert optimistic update on error
        await fetchRooms()
        toast.error(result.error || 'Failed to toggle room scope')
      } else {
        toast.success(newStatus ? 'Room scope shown' : 'Room scope hidden')
        // Refresh to get updated stats
        await fetchRooms()
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
    <div className="flex h-full gap-4">
      {/* Left Pane: Room List */}
      <div className="w-1/2 space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Rooms</CardTitle>
                <CardDescription>
                  Manage rooms and view cost breakdowns
                </CardDescription>
              </div>
              <Button onClick={handleAddRoom} size="sm">
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
                <p>No rooms yet. Click "Add Room" to get started.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rooms.map((room) => (
                    <TableRow
                      key={room.id}
                      className={`cursor-pointer ${
                        selectedRoom?.id === room.id ? 'bg-muted' : ''
                      }`}
                      onClick={() => setSelectedRoom(room)}
                    >
                      <TableCell className="font-medium">{room.name}</TableCell>
                      <TableCell>{room.type || '—'}</TableCell>
                      <TableCell>
                        {room.area_sqft ? `${room.area_sqft} sq ft` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(room.client_total)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={room.is_active ? 'default' : 'secondary'}
                        >
                          {room.is_active ? (
                            <>
                              <Eye className="mr-1 h-3 w-3" />
                              Active
                            </>
                          ) : (
                            <>
                              <EyeOff className="mr-1 h-3 w-3" />
                              Hidden
                            </>
                          )}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right Pane: Room Detail */}
      <div className="w-1/2">
        {selectedRoom ? (
          <div className="space-y-4">
            {/* Room Details Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{selectedRoom.name}</CardTitle>
                    <CardDescription>
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Type</Label>
                    <p className="text-sm font-medium">
                      {selectedRoom.type || 'Not specified'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Area</Label>
                    <p className="text-sm font-medium">
                      {selectedRoom.area_sqft
                        ? `${selectedRoom.area_sqft} sq ft`
                        : 'Not specified'}
                    </p>
                  </div>
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
                        Hide Scope
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Hide this room and remove its cost from totals
                      </p>
                    </div>
                    <Switch
                      id="toggle-scope"
                      checked={!selectedRoom.is_active}
                      disabled={isToggling === selectedRoom.id}
                      onCheckedChange={() =>
                        handleToggleScope(selectedRoom.id, selectedRoom.is_active ?? true)
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
        <DialogContent className="sm:max-w-[500px]">
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
            <div className="space-y-2">
              <Label htmlFor="area">Area (sq ft)</Label>
              <Input
                id="area"
                type="number"
                value={formData.area}
                onChange={(e) =>
                  setFormData({ ...formData, area: e.target.value })
                }
                placeholder="e.g., 250"
              />
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
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveRoom}>
              {formData.id ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
