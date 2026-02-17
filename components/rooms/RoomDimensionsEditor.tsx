'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Ruler, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Room } from '@/types/db'

// =============================================================================
// Types
// =============================================================================

interface RoomDimensionsEditorProps {
  room: Room
  onSave: (dimensions: {
    length_ft: number | null
    width_ft: number | null
    ceiling_height_ft: number | null
  }) => Promise<{ success: boolean; room?: Room; affectedLineItems?: number; error?: string }>
  disabled?: boolean
}

type DimensionField = 'length_ft' | 'width_ft' | 'ceiling_height_ft'

interface DimensionState {
  length_ft: string
  width_ft: string
  ceiling_height_ft: string
}

// =============================================================================
// Helpers
// =============================================================================

/** Format a number | null for display as a string in the input */
function dimToString(val: number | null | undefined): string {
  if (val === null || val === undefined) return ''
  return String(val)
}

/** Parse a string to number | null. Returns null for empty/invalid. */
function parseDim(val: string): number | null {
  const trimmed = val.trim()
  if (trimmed === '') return null
  const n = parseFloat(trimmed)
  if (isNaN(n) || n <= 0) return null
  return Math.round(n * 100) / 100 // Round to 2 decimals
}

/** Format area for display */
function formatArea(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  return `${val.toLocaleString('en-US', { maximumFractionDigits: 1 })} sq ft`
}

// =============================================================================
// Component
// =============================================================================

/**
 * Inline editor for room dimensions (length, width, ceiling height).
 * Auto-saves on blur or after 500ms debounce while typing.
 * Shows derived areas (floor, wall, ceiling) read-only.
 */
export function RoomDimensionsEditor({ room, onSave, disabled = false }: RoomDimensionsEditorProps) {
  const [dims, setDims] = useState<DimensionState>({
    length_ft: dimToString(room.length_ft),
    width_ft: dimToString(room.width_ft),
    ceiling_height_ft: dimToString(room.ceiling_height_ft),
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [lastAffectedCount, setLastAffectedCount] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestDimsRef = useRef(dims)

  // Sync local state when the room prop changes (e.g. after server response)
  useEffect(() => {
    setDims({
      length_ft: dimToString(room.length_ft),
      width_ft: dimToString(room.width_ft),
      ceiling_height_ft: dimToString(room.ceiling_height_ft),
    })
  }, [room.id, room.length_ft, room.width_ft, room.ceiling_height_ft])

  // Keep latestDimsRef in sync
  useEffect(() => {
    latestDimsRef.current = dims
  }, [dims])

  // Clear debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const doSave = useCallback(async (dimsToSave: DimensionState) => {
    if (disabled) return

    const length = parseDim(dimsToSave.length_ft)
    const width = parseDim(dimsToSave.width_ft)
    const ceiling = parseDim(dimsToSave.ceiling_height_ft)

    // Skip save if nothing actually changed from the room's current values
    const roomLength = room.length_ft !== null && room.length_ft !== undefined ? Number(room.length_ft) : null
    const roomWidth = room.width_ft !== null && room.width_ft !== undefined ? Number(room.width_ft) : null
    const roomCeiling = room.ceiling_height_ft !== null && room.ceiling_height_ft !== undefined ? Number(room.ceiling_height_ft) : null

    if (length === roomLength && width === roomWidth && ceiling === roomCeiling) {
      return // No change
    }

    setIsSaving(true)
    setSaveStatus('idle')

    try {
      const result = await onSave({
        length_ft: length,
        width_ft: width,
        ceiling_height_ft: ceiling,
      })

      if (result.success) {
        setSaveStatus('saved')
        setLastAffectedCount(result.affectedLineItems ?? null)
        // Auto-clear "saved" indicator after 2s
        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        setSaveStatus('error')
        console.error('Save failed:', result.error)
      }
    } catch (err) {
      setSaveStatus('error')
      console.error('Save error:', err)
    } finally {
      setIsSaving(false)
    }
  }, [disabled, onSave, room.length_ft, room.width_ft, room.ceiling_height_ft])

  const handleChange = useCallback((field: DimensionField, value: string) => {
    // Allow only digits, one decimal point, and empty
    const sanitized = value.replace(/[^0-9.]/g, '')
    // Prevent multiple decimal points
    const parts = sanitized.split('.')
    const clean = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : sanitized

    setDims(prev => {
      const next = { ...prev, [field]: clean }

      // Debounce auto-save (500ms)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        doSave(next)
      }, 500)

      return next
    })
  }, [doSave])

  const handleBlur = useCallback(() => {
    // Save immediately on blur (cancel any pending debounce)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    doSave(latestDimsRef.current)
  }, [doSave])

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="space-y-4">
      {/* Dimension Inputs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Ruler className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-semibold">Dimensions (ft)</Label>
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3 w-3" />
              Saved{lastAffectedCount && lastAffectedCount > 0 ? ` · ${lastAffectedCount} item${lastAffectedCount > 1 ? 's' : ''} updated` : ''}
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" />
              Save failed
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`dim-length-${room.id}`} className="text-xs text-muted-foreground">
              Length
            </Label>
            <Input
              id={`dim-length-${room.id}`}
              type="text"
              inputMode="decimal"
              value={dims.length_ft}
              onChange={(e) => handleChange('length_ft', e.target.value)}
              onBlur={handleBlur}
              placeholder="0"
              disabled={disabled || isSaving}
              className={cn('h-9 text-sm', disabled && 'opacity-50')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`dim-width-${room.id}`} className="text-xs text-muted-foreground">
              Width
            </Label>
            <Input
              id={`dim-width-${room.id}`}
              type="text"
              inputMode="decimal"
              value={dims.width_ft}
              onChange={(e) => handleChange('width_ft', e.target.value)}
              onBlur={handleBlur}
              placeholder="0"
              disabled={disabled || isSaving}
              className={cn('h-9 text-sm', disabled && 'opacity-50')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`dim-ceiling-${room.id}`} className="text-xs text-muted-foreground">
              Ceiling Ht.
            </Label>
            <Input
              id={`dim-ceiling-${room.id}`}
              type="text"
              inputMode="decimal"
              value={dims.ceiling_height_ft}
              onChange={(e) => handleChange('ceiling_height_ft', e.target.value)}
              onBlur={handleBlur}
              placeholder="8"
              disabled={disabled || isSaving}
              className={cn('h-9 text-sm', disabled && 'opacity-50')}
            />
          </div>
        </div>
      </div>

      {/* Derived Areas (read-only) */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">Computed Areas</Label>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Floor</p>
            <p className="text-sm font-medium">{formatArea(room.floor_area_sqft)}</p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Walls</p>
            <p className="text-sm font-medium">{formatArea(room.wall_area_sqft)}</p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Ceiling</p>
            <p className="text-sm font-medium">{formatArea(room.ceiling_area_sqft)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
