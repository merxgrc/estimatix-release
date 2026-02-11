'use client'

/**
 * BlueprintReviewDrawer
 * 
 * UI component for reviewing parsed blueprint/plan results before applying.
 * 
 * Phase 1 Requirements:
 * - User MUST review detected rooms before applying
 * - User can edit room names, toggle inclusion, merge duplicates
 * - NO PRICING displayed or applied
 * - "Remove room" = exclude from scope (is_active = false)
 * 
 * Features:
 * - Checkbox selection (default checked)
 * - Rename room (inline edit)
 * - Merge duplicates (select two rooms -> merge)
 * - Warnings/missing info/assumptions visible
 * - Line items grouped by room (read-only)
 * - Re-run parse option
 * - Apply to estimate (APPEND mode)
 */

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Loader2,
  Check,
  AlertTriangle,
  Info,
  Home,
  FileText,
  Lightbulb,
  Edit2,
  ChevronDown,
  ChevronRight,
  Merge,
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { applyParsedResults, type ParsedRoomInput, type LineItemScaffoldInput } from '@/actions/plans'

// =============================================================================
// Types
// =============================================================================

interface ParsedRoom {
  id?: string
  name: string
  type: string | null
  area_sqft: number | null
  dimensions: string | null
  notes: string | null
  confidence: number
}

interface LineItemScaffold {
  id?: string
  description: string
  category: string
  cost_code: string | null
  room_name: string
  quantity: number | null
  unit: string | null
  notes: string | null
}

interface ParseResult {
  success: boolean
  planParseId?: string
  rooms: ParsedRoom[]
  lineItemScaffold: LineItemScaffold[]
  assumptions: string[]
  warnings: string[]
  missingInfo?: string[] // Added missing info
  pageClassifications: Array<{
    pageNumber: number
    type: string
    confidence: number
    reason?: string
  }>
  totalPages: number
  relevantPages: number[]
  processingTimeMs: number
}

interface BlueprintReviewDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  parseResult: ParseResult | null
  projectId: string
  estimateId: string
  onApplyComplete: () => void
  onReparse?: () => void // Callback to trigger re-parse
  isReparsing?: boolean // Loading state for re-parse
}

// Room state type
interface RoomState extends ParsedRoom {
  included: boolean
  editing: boolean
  selected: boolean // For merge selection
  originalIndex: number
}

// Line item state type
interface LineItemState extends LineItemScaffold {
  included: boolean
  originalIndex: number
}

// =============================================================================
// Helper Component: Collapsible Room Line Items Group
// =============================================================================

function RoomLineItemsGroup({
  roomName,
  items,
  onToggleItem,
  isRoomIncluded,
}: {
  roomName: string
  items: LineItemState[]
  onToggleItem: (index: number) => void
  isRoomIncluded: boolean
}) {
  const [isOpen, setIsOpen] = useState(true)
  const includedCount = items.filter(i => i.included).length

  return (
    <div className={`border rounded-lg ${!isRoomIncluded ? 'opacity-50' : ''}`}>
      <button
        type="button"
        className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium hover:bg-muted/50 rounded-t-lg"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="flex items-center gap-2">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Home className="h-4 w-4" />
          {roomName}
          {!isRoomIncluded && <span className="text-xs text-muted-foreground">(excluded)</span>}
        </span>
        <Badge variant="secondary" className="text-xs">
          {includedCount}/{items.length}
        </Badge>
      </button>
      {isOpen && (
        <div className="px-3 pb-3 space-y-1">
          {items.map((item) => (
            <div
              key={item.originalIndex}
              className={`flex items-center gap-2 py-1.5 px-2 rounded text-sm ${
                item.included && isRoomIncluded ? '' : 'opacity-50'
              }`}
            >
              <Checkbox
                checked={item.included && isRoomIncluded}
                onCheckedChange={() => onToggleItem(item.originalIndex)}
                disabled={!isRoomIncluded}
              />
              <span className="flex-1 truncate">{item.description}</span>
              {item.quantity && item.unit && (
                <span className="text-xs text-muted-foreground">
                  {item.quantity} {item.unit}
                </span>
              )}
              {item.cost_code && (
                <Badge variant="outline" className="text-xs">
                  {item.cost_code}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Helper Component: Room Card
// =============================================================================

function RoomCard({
  room,
  index,
  onToggle,
  onRename,
  onToggleEdit,
  onToggleSelect,
  isMergeMode,
}: {
  room: RoomState
  index: number
  onToggle: () => void
  onRename: (name: string) => void
  onToggleEdit: () => void
  onToggleSelect: () => void
  isMergeMode: boolean
}) {
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        room.included ? 'bg-background' : 'bg-muted/50 opacity-60'
      } ${room.selected && isMergeMode ? 'ring-2 ring-primary' : ''}`}
    >
      {isMergeMode ? (
        <Checkbox
          checked={room.selected}
          onCheckedChange={onToggleSelect}
          className="mt-1"
        />
      ) : (
        <Checkbox
          checked={room.included}
          onCheckedChange={onToggle}
          className="mt-1"
        />
      )}
      <div className="flex-1 min-w-0">
        {room.editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={room.name}
              onChange={(e) => onRename(e.target.value)}
              className="h-8"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') onToggleEdit()
                if (e.key === 'Escape') onToggleEdit()
              }}
              onBlur={onToggleEdit}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleEdit}
            >
              <Check className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium">{room.name}</span>
            {!isMergeMode && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onToggleEdit}
              >
                <Edit2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2 mt-1">
          {room.type && (
            <Badge variant="secondary" className="text-xs">
              {room.type}
            </Badge>
          )}
          {room.area_sqft && (
            <Badge variant="outline" className="text-xs">
              {room.area_sqft} sq ft
            </Badge>
          )}
          {room.dimensions && (
            <Badge variant="outline" className="text-xs">
              {room.dimensions}
            </Badge>
          )}
          {room.confidence < 70 && (
            <Badge variant="destructive" className="text-xs">
              Low confidence ({room.confidence}%)
            </Badge>
          )}
        </div>
        {room.notes && (
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {room.notes}
          </p>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function BlueprintReviewDrawer({
  open,
  onOpenChange,
  parseResult,
  projectId,
  estimateId,
  onApplyComplete,
  onReparse,
  isReparsing = false,
}: BlueprintReviewDrawerProps) {
  const [isApplying, setIsApplying] = useState(false)
  const [activeTab, setActiveTab] = useState('rooms')
  const [isMergeMode, setIsMergeMode] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  
  // Room state
  const [rooms, setRooms] = useState<RoomState[]>([])
  
  // Line item state
  const [lineItems, setLineItems] = useState<LineItemState[]>([])

  // Initialize state from parseResult
  const initializeState = useCallback(() => {
    if (parseResult) {
      setRooms(
        (parseResult.rooms || []).map((r, i) => ({
          ...r,
          included: true,
          editing: false,
          selected: false,
          originalIndex: i,
        }))
      )
      setLineItems(
        (parseResult.lineItemScaffold || []).map((li, i) => ({
          ...li,
          included: true,
          originalIndex: i,
        }))
      )
    }
    setIsMergeMode(false)
    setApplyError(null)
  }, [parseResult])

  // Reset state when parseResult changes or dialog opens
  useEffect(() => {
    if (open && parseResult) {
      initializeState()
    }
  }, [open, parseResult, initializeState])

  // Toggle room inclusion
  const toggleRoom = (index: number) => {
    setRooms(prev => prev.map((r, i) => 
      i === index ? { ...r, included: !r.included } : r
    ))
  }

  // Update room name
  const updateRoomName = (index: number, name: string) => {
    setRooms(prev => prev.map((r, i) => 
      i === index ? { ...r, name } : r
    ))
    // Also update line items that reference this room
    const oldName = rooms[index]?.name
    if (oldName && oldName !== name) {
      setLineItems(prev => prev.map(li => 
        li.room_name === oldName ? { ...li, room_name: name } : li
      ))
    }
  }

  // Toggle room editing mode
  const toggleRoomEditing = (index: number) => {
    setRooms(prev => prev.map((r, i) => 
      i === index ? { ...r, editing: !r.editing } : r
    ))
  }

  // Toggle room selection for merge
  const toggleRoomSelect = (index: number) => {
    setRooms(prev => prev.map((r, i) => 
      i === index ? { ...r, selected: !r.selected } : r
    ))
  }

  // Toggle line item inclusion
  const toggleLineItem = (index: number) => {
    setLineItems(prev => prev.map((li) => 
      li.originalIndex === index ? { ...li, included: !li.included } : li
    ))
  }

  // Select/deselect all rooms
  const selectAllRooms = (selected: boolean) => {
    setRooms(prev => prev.map(r => ({ ...r, included: selected })))
  }

  // Select/deselect all line items
  const selectAllLineItems = (selected: boolean) => {
    setLineItems(prev => prev.map(li => ({ ...li, included: selected })))
  }

  // Get selected rooms for merge
  const selectedRooms = rooms.filter(r => r.selected)

  // Merge selected rooms
  const mergeSelectedRooms = () => {
    if (selectedRooms.length < 2) {
      toast.error('Select at least 2 rooms to merge')
      return
    }

    // Use the first selected room as the target
    const targetRoom = selectedRooms[0]
    const roomsToMerge = selectedRooms.slice(1)
    const mergedNames = roomsToMerge.map(r => r.name)

    // Combine data from merged rooms
    const combinedArea = selectedRooms.reduce((sum, r) => sum + (r.area_sqft || 0), 0)
    const combinedNotes = selectedRooms
      .filter(r => r.notes)
      .map(r => r.notes)
      .join('; ')

    // Update rooms - keep target, remove others
    setRooms(prev => {
      const newRooms = prev.filter(r => !roomsToMerge.some(m => m.originalIndex === r.originalIndex))
      return newRooms.map(r => {
        if (r.originalIndex === targetRoom.originalIndex) {
          return {
            ...r,
            area_sqft: combinedArea > 0 ? combinedArea : r.area_sqft,
            notes: combinedNotes || r.notes,
            selected: false,
          }
        }
        return { ...r, selected: false }
      })
    })

    // Update line items - reassign merged room names to target
    setLineItems(prev => prev.map(li => {
      if (mergedNames.includes(li.room_name)) {
        return { ...li, room_name: targetRoom.name }
      }
      return li
    }))

    setIsMergeMode(false)
    toast.success(`Merged ${selectedRooms.length} rooms into "${targetRoom.name}"`)
  }

  // Cancel merge mode
  const cancelMergeMode = () => {
    setRooms(prev => prev.map(r => ({ ...r, selected: false })))
    setIsMergeMode(false)
  }

  // Apply results
  const handleApply = async () => {
    const includedRooms = rooms.filter(r => r.included)
    
    if (includedRooms.length === 0) {
      toast.error('Please select at least one room to include')
      return
    }

    setIsApplying(true)
    setApplyError(null)
    
    try {
      const roomInputs: ParsedRoomInput[] = rooms.map(r => ({
        name: r.name,
        type: r.type,
        area_sqft: r.area_sqft,
        dimensions: r.dimensions,
        notes: r.notes,
        included: r.included
      }))

      // Only include line items for included rooms
      const lineItemInputs: LineItemScaffoldInput[] = lineItems.map(li => ({
        description: li.description,
        category: li.category,
        cost_code: li.cost_code,
        room_name: li.room_name,
        quantity: li.quantity,
        unit: li.unit,
        notes: li.notes,
        included: li.included && rooms.find(r => r.name === li.room_name)?.included === true
      }))

      const result = await applyParsedResults({
        projectId,
        estimateId,
        planParseId: parseResult?.planParseId,
        rooms: roomInputs,
        lineItems: lineItemInputs
      })

      if (result.success) {
        toast.success(
          `Added ${result.createdRooms} rooms and ${result.createdLineItems} line items` +
          (result.excludedRooms > 0 ? ` (${result.excludedRooms} excluded from scope)` : ''),
          {
            description: 'Enter costs manually in the estimate table.',
            duration: 5000,
          }
        )
        onApplyComplete()
        onOpenChange(false)
      } else {
        setApplyError(result.error || 'Failed to apply results')
        toast.error(result.error || 'Failed to apply results')
      }
    } catch (error) {
      console.error('Error applying results:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to apply results'
      setApplyError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsApplying(false)
    }
  }

  // Computed values
  const includedRoomsCount = rooms.filter(r => r.included).length
  const includedLineItemsCount = lineItems.filter(li => {
    const room = rooms.find(r => r.name === li.room_name)
    return li.included && room?.included
  }).length
  const warnings = parseResult?.warnings || []
  const assumptions = parseResult?.assumptions || []
  const missingInfo = (parseResult as ParseResult & { missingInfo?: string[] })?.missingInfo || []
  const hasIssues = warnings.length > 0 || missingInfo.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Review Detected Items
            {parseResult?.success === false && (
              <Badge variant="destructive" className="ml-2">Partial Results</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Review and edit the rooms and line items detected from your plans.
            Uncheck items to exclude them from your estimate.
          </DialogDescription>
        </DialogHeader>

        {!parseResult ? (
          <div className="flex flex-col items-center justify-center h-48 gap-4">
            <AlertCircle className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">No results to display</p>
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden mt-2 gap-4">
            {/* Error State */}
            {applyError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{applyError}</AlertDescription>
              </Alert>
            )}

            {/* Warnings, Missing Info & Assumptions */}
            {hasIssues && (
              <div className="space-y-2">
                {warnings.map((warning, i) => (
                  <Alert key={`warn-${i}`} variant="destructive" className="py-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-sm">{warning}</AlertDescription>
                  </Alert>
                ))}
                {missingInfo.length > 0 && (
                  <Alert className="py-2 border-orange-500/50 bg-orange-500/5">
                    <Info className="h-4 w-4 text-orange-500" />
                    <AlertDescription className="text-sm">
                      <strong className="text-orange-600">Missing info:</strong>{' '}
                      {missingInfo.join('; ')}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
            
            {assumptions.length > 0 && (
              <Alert className="py-2">
                <Lightbulb className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>Assumptions:</strong> {assumptions.join('; ')}
                </AlertDescription>
              </Alert>
            )}

            {/* Stats Bar */}
            <div className="flex items-center justify-between text-sm">
              <div className="flex gap-4 text-muted-foreground">
                <span>{parseResult.totalPages} pages scanned</span>
                <span>•</span>
                <span>{parseResult.relevantPages?.length || 0} pages analyzed</span>
                <span>•</span>
                <span>{(parseResult.processingTimeMs / 1000).toFixed(1)}s</span>
              </div>
              {onReparse && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onReparse}
                  disabled={isReparsing || isApplying}
                >
                  {isReparsing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Re-parse
                </Button>
              )}
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="grid grid-cols-2">
                <TabsTrigger value="rooms" className="flex items-center gap-1">
                  <Home className="h-4 w-4" />
                  Rooms ({includedRoomsCount}/{rooms.length})
                </TabsTrigger>
                <TabsTrigger value="items" className="flex items-center gap-1">
                  <FileText className="h-4 w-4" />
                  Line Items ({includedLineItemsCount}/{lineItems.length})
                </TabsTrigger>
              </TabsList>

              {/* Rooms Tab */}
              <TabsContent value="rooms" className="flex-1 overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-xs text-muted-foreground">
                    {isMergeMode 
                      ? `Select rooms to merge (${selectedRooms.length} selected)`
                      : 'Select rooms to include in estimate'
                    }
                  </Label>
                  <div className="flex gap-2">
                    {isMergeMode ? (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={mergeSelectedRooms}
                          disabled={selectedRooms.length < 2}
                        >
                          <Merge className="mr-1 h-3 w-3" />
                          Merge ({selectedRooms.length})
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={cancelMergeMode}
                        >
                          <X className="mr-1 h-3 w-3" />
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsMergeMode(true)}
                          disabled={rooms.length < 2}
                        >
                          <Merge className="mr-1 h-3 w-3" />
                          Merge Duplicates
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => selectAllRooms(true)}
                        >
                          Select All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => selectAllRooms(false)}
                        >
                          Deselect All
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="space-y-2 pr-2">
                    {rooms.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Home className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No rooms detected</p>
                        <p className="text-xs mt-1">Try uploading a clearer floor plan</p>
                      </div>
                    ) : (
                      rooms.map((room, index) => (
                        <RoomCard
                          key={room.originalIndex}
                          room={room}
                          index={index}
                          onToggle={() => toggleRoom(index)}
                          onRename={(name) => updateRoomName(index, name)}
                          onToggleEdit={() => toggleRoomEditing(index)}
                          onToggleSelect={() => toggleRoomSelect(index)}
                          isMergeMode={isMergeMode}
                        />
                      ))
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Line Items Tab */}
              <TabsContent value="items" className="flex-1 overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-2">
                  <Label className="text-xs text-muted-foreground">
                    Suggested line items (no pricing) - grouped by room
                  </Label>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => selectAllLineItems(true)}
                    >
                      Select All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => selectAllLineItems(false)}
                    >
                      Deselect All
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="space-y-2 pr-2">
                    {lineItems.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No line items suggested</p>
                        <p className="text-xs mt-1">Add line items manually after creating rooms</p>
                      </div>
                    ) : (
                      // Group line items by room
                      Object.entries(
                        lineItems.reduce((acc, li) => {
                          const roomName = li.room_name || 'General'
                          if (!acc[roomName]) acc[roomName] = []
                          acc[roomName].push(li)
                          return acc
                        }, {} as Record<string, LineItemState[]>)
                      ).map(([roomName, items]) => {
                        const room = rooms.find(r => r.name === roomName)
                        return (
                          <RoomLineItemsGroup
                            key={roomName}
                            roomName={roomName}
                            items={items}
                            onToggleItem={toggleLineItem}
                            isRoomIncluded={room?.included ?? true}
                          />
                        )
                      })
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {/* Phase 1 Notice */}
            <Alert className="bg-primary/5 border-primary/20">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <AlertDescription className="text-xs">
                <strong>Phase 1:</strong> Line items are created without pricing. 
                Enter costs manually in the estimate table after applying.
                <br />
                <strong>APPEND mode:</strong> New rooms will be added alongside existing rooms.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter className="mt-4 gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isApplying}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={isApplying || includedRoomsCount === 0 || isMergeMode}
          >
            {isApplying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Apply {includedRoomsCount} Room{includedRoomsCount !== 1 ? 's' : ''}
                {includedLineItemsCount > 0 && ` & ${includedLineItemsCount} Item${includedLineItemsCount !== 1 ? 's' : ''}`}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
