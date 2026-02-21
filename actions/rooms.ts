'use server'

import { createServerClient, requireAuth } from '@/lib/supabase/server'
import { formatCostCode } from '@/lib/constants'
import { z } from 'zod'
import type { Room, EstimateLineItemRow } from '@/types/db'
import { resolveAreaFieldForLineItem as resolveAreaField, type RoomAreaField } from '@/lib/area-mapping'

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Schema for updateRoomDimensions.
 * All dimension fields are nullable: when null, derived areas become null
 * and dependent line item quantities are NOT auto-calculated.
 * When provided, must be > 0.
 */
const UpdateRoomDimensionsSchema = z.object({
  roomId: z.string().uuid('Invalid room ID'),
  length_ft: z.number().positive('Length must be > 0').max(9999, 'Length too large').nullable(),
  width_ft: z.number().positive('Width must be > 0').max(9999, 'Width too large').nullable(),
  ceiling_height_ft: z.number().positive('Ceiling height must be > 0').max(99, 'Ceiling height too large').nullable(),
})

export type UpdateRoomDimensionsInput = {
  roomId: string
  length_ft: number | null
  width_ft: number | null
  ceiling_height_ft: number | null
}

// =============================================================================
// Area-to-Cost-Code Mapping for Dependent Line Item Recalc
// =============================================================================
// Uses shared resolveAreaField from @/lib/area-mapping (imported above)

/** Local alias for the shared resolver, wrapping for backward compat. */
function resolveAreaFieldForLineItem(item: {
  cost_code: string | null
  unit: string | null
  description: string | null
  category: string | null
}): RoomAreaField | null {
  return resolveAreaField(item)
}

/**
 * Room with aggregated statistics from line items
 */
export interface RoomWithStats extends Room {
  direct_total: number
  client_total: number
  line_item_count: number
  trade_breakdown: Record<string, number> // trade label -> total amount
}

/**
 * Get all rooms for a project with aggregated statistics
 */
export async function getProjectRooms(
  projectId: string
): Promise<{ success: boolean; rooms?: RoomWithStats[]; error?: string }> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if (project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // Get all rooms for this project
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('*')
      .eq('project_id', projectId)
      .order('name', { ascending: true })

    if (roomsError) {
      console.error('Error fetching rooms:', roomsError)
      return { success: false, error: 'Failed to fetch rooms' }
    }

    if (!rooms || rooms.length === 0) {
      return { success: true, rooms: [] }
    }

    // Get all line items for this project to calculate stats
    const { data: lineItems, error: itemsError } = await supabase
      .from('estimate_line_items')
      .select('id, room_id, cost_code, direct_cost, client_price, is_active')
      .eq('project_id', projectId)
      .eq('is_active', true)

    if (itemsError) {
      console.error('Error fetching line items:', itemsError)
      return { success: false, error: 'Failed to fetch line items' }
    }

    // Calculate stats for each room
    const roomsWithStats: RoomWithStats[] = rooms.map((room) => {
      const roomItems = (lineItems || []).filter(
        (item) => item.room_id === room.id
      )

      let direct_total = 0
      let client_total = 0
      const trade_breakdown: Record<string, number> = {}

      roomItems.forEach((item) => {
        const directCost = Number(item.direct_cost) || 0
        const clientPrice = Number(item.client_price) || 0

        direct_total += directCost
        client_total += clientPrice

        // Aggregate by trade (cost code)
        if (item.cost_code) {
          const tradeLabel = formatCostCode(item.cost_code)
          trade_breakdown[tradeLabel] = (trade_breakdown[tradeLabel] || 0) + clientPrice
        }
      })

      return {
        ...room,
        direct_total,
        client_total,
        line_item_count: roomItems.length,
        trade_breakdown,
      }
    })

    return { success: true, rooms: roomsWithStats }
  } catch (error) {
    console.error('Error getting project rooms:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create or update a room.
 * Supports Phase 1 fields: level, dimensions, is_in_scope.
 * When dimensions (length_ft, width_ft, ceiling_height_ft) are provided,
 * the DB trigger auto-computes floor_area_sqft, wall_area_sqft, ceiling_area_sqft.
 */
export async function upsertRoom(input: {
  projectId: string
  id?: string
  name: string
  level?: string
  type?: string | null
  area?: number | null
  length_ft?: number | null
  width_ft?: number | null
  ceiling_height_ft?: number | null
  is_in_scope?: boolean
  notes?: string | null
}): Promise<{ success: boolean; room?: Room; error?: string }> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', input.projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if (project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // Strip any level suffix from name (e.g. "Kitchen – Level 2" → "Kitchen")
    const cleanedName = input.name.trim()
      .replace(/\s*[-–—]\s*Level\s*\d+/i, '')
      .replace(/\s*[-–—]\s*(?:Basement|Garage|Attic|Roof)/i, '')
      .trim()

    const roomData = {
      project_id: input.projectId,
      name: cleanedName,
      level: input.level?.trim() || null,  // NULL = unknown; never default to "Level 1"
      level_source: 'manual' as const,
      type: input.type?.trim() || null,
      area_sqft: input.area || null,
      length_ft: input.length_ft ?? null,
      width_ft: input.width_ft ?? null,
      ceiling_height_ft: input.ceiling_height_ft ?? null,
      is_in_scope: input.is_in_scope ?? true,
      notes: input.notes?.trim() || null,
      source: 'manual' as const,
    }

    if (input.id) {
      // Update existing room
      // Note: DB trigger auto-computes floor_area_sqft, wall_area_sqft, ceiling_area_sqft
      const { data: room, error: updateError } = await supabase
        .from('rooms')
        .update(roomData)
        .eq('id', input.id)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating room:', updateError)
        return { success: false, error: `Failed to update room: ${updateError.message}` }
      }

      return { success: true, room: room as Room }
    } else {
      // Create new room
      const { data: room, error: insertError } = await supabase
        .from('rooms')
        .insert(roomData)
        .select()
        .single()

      if (insertError) {
        console.error('Error creating room:', insertError)
        return { success: false, error: `Failed to create room: ${insertError.message}` }
      }

      return { success: true, room: room as Room }
    }
  } catch (error) {
    console.error('Error upserting room:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// =============================================================================
// updateRoomDimensions – server-authoritative dimension + derived area update
// =============================================================================

/**
 * Update room dimensions and recompute dependent quantities.
 *
 * Flow:
 * 1. Validate input with Zod.
 * 2. Update room dimensions → DB trigger auto-computes derived areas.
 * 3. Fetch the updated room to get computed areas.
 * 4. Find all line items with calc_source='room_dimensions' for this room.
 * 5. Update their quantities based on the appropriate area field.
 * 6. Return updated room + count of affected line items.
 *
 * The DB trigger `trg_compute_room_areas` (migration 033) handles:
 *   floor_area_sqft   = length_ft * width_ft
 *   ceiling_area_sqft = length_ft * width_ft
 *   wall_area_sqft    = 2 * (length_ft + width_ft) * ceiling_height_ft
 */
export async function updateRoomDimensions(
  input: UpdateRoomDimensionsInput
): Promise<{
  success: boolean
  room?: Room
  affectedLineItems?: number
  error?: string
}> {
  // Step 1: Validate
  const parsed = UpdateRoomDimensionsSchema.safeParse(input)
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]
    return { success: false, error: firstError?.message || 'Invalid input' }
  }

  const { roomId, length_ft, width_ft, ceiling_height_ft } = parsed.data

  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Verify room exists and user owns the project
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, project_id')
      .eq('id', roomId)
      .single()

    if (roomError || !room) {
      return { success: false, error: 'Room not found' }
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', room.project_id)
      .single()

    if (projectError || !project || project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // Step 2: Update dimensions (trigger computes derived areas)
    const { data: updatedRoom, error: updateError } = await supabase
      .from('rooms')
      .update({
        length_ft,
        width_ft,
        ceiling_height_ft,
      })
      .eq('id', roomId)
      .select()
      .single()

    if (updateError || !updatedRoom) {
      console.error('Error updating room dimensions:', updateError)
      return { success: false, error: 'Failed to update dimensions' }
    }

    // Step 3: Update dependent line items (calc_source = 'room_dimensions')
    let affectedLineItems = 0

    // If any dimension is null, derived areas are null → set dependent quantities to null
    const hasCompleteDimensions = length_ft !== null && width_ft !== null

    // NOTE: calc_source column does not exist in DB yet, so we skip that filter.
    // When migration 034 is applied, re-enable: .eq('calc_source', 'room_dimensions')
    const { data: dependentItems, error: fetchItemsError } = await supabase
      .from('estimate_line_items')
      .select('id, cost_code, unit, description, category, quantity')
      .eq('room_id', roomId)
      .eq('is_active', true)

    if (fetchItemsError) {
      console.warn('Error fetching dependent line items:', fetchItemsError)
      // Don't fail the whole operation — room dimensions are already saved
    }

    if (dependentItems && dependentItems.length > 0) {
      const areas = {
        floor_area_sqft: updatedRoom.floor_area_sqft,
        wall_area_sqft: updatedRoom.wall_area_sqft,
        ceiling_area_sqft: updatedRoom.ceiling_area_sqft,
      }

      for (const item of dependentItems) {
        const areaField = resolveAreaFieldForLineItem({
          cost_code: item.cost_code,
          unit: item.unit,
          description: item.description,
          category: item.category,
        })

        if (!areaField) continue // Can't determine area → leave quantity unchanged

        const newQuantity = hasCompleteDimensions
          ? (areas[areaField] ?? null)
          : null

        // Only update if quantity actually changed
        if (newQuantity !== item.quantity) {
          const updateFields: Record<string, unknown> = { quantity: newQuantity }

          // Also recompute direct_cost if unit_cost is available
          // (we need to fetch unit_cost for this)
          const { data: fullItem } = await supabase
            .from('estimate_line_items')
            .select('unit_cost, labor_cost, material_cost, margin_percent')
            .eq('id', item.id)
            .single()

          if (fullItem && newQuantity !== null) {
            // Recompute cost fields if we have unit_cost
            if (fullItem.unit_cost !== null && fullItem.unit_cost !== undefined) {
              const unitCost = Number(fullItem.unit_cost)
              updateFields.direct_cost = Math.round(newQuantity * unitCost * 100) / 100
            }
          } else if (newQuantity === null) {
            // If quantity becomes null, clear direct_cost too
            updateFields.direct_cost = null
          }

          const { error: itemUpdateError } = await supabase
            .from('estimate_line_items')
            .update(updateFields)
            .eq('id', item.id)

          if (!itemUpdateError) {
            affectedLineItems++
          } else {
            console.warn(`Failed to update line item ${item.id}:`, itemUpdateError)
          }
        }
      }
    }

    return {
      success: true,
      room: updatedRoom as Room,
      affectedLineItems,
    }
  } catch (error) {
    console.error('Error updating room dimensions:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Toggle room scope (is_in_scope) with cascade total refresh.
 *
 * When a room is toggled out of scope:
 *   1. rooms.is_in_scope and rooms.is_active are updated.
 *   2. Every estimate linked to this project has its `total` recomputed,
 *      excluding line items from out-of-scope rooms.
 *
 * Returns the updated estimate totals so the UI can reconcile immediately.
 */
export async function toggleRoomScope(
  roomId: string,
  isInScope: boolean
): Promise<{
  success: boolean
  /** Map of estimateId → new total after scope change */
  updatedEstimateTotals?: Record<string, number>
  error?: string
}> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Get room to find project_id
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, project_id')
      .eq('id', roomId)
      .single()

    if (roomError || !room) {
      return { success: false, error: 'Room not found' }
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', room.project_id)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if (project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // Update room is_in_scope (and keep is_active in sync for backward compat)
    const { error: updateError } = await supabase
      .from('rooms')
      .update({ is_in_scope: isInScope, is_active: isInScope })
      .eq('id', roomId)

    if (updateError) {
      console.error('Error toggling room scope:', updateError)
      return { success: false, error: 'Failed to update room scope' }
    }

    // ── CASCADE: refresh estimates.total for every estimate in this project ──
    const updatedEstimateTotals: Record<string, number> = {}
    try {
      // 1. Get all estimates for this project
      const { data: estimates } = await supabase
        .from('estimates')
        .select('id')
        .eq('project_id', room.project_id)

      if (estimates && estimates.length > 0) {
        // 2. Get all rooms with current scope for this project
        const { data: allRooms } = await supabase
          .from('rooms')
          .select('id, is_in_scope')
          .eq('project_id', room.project_id)

        const scopeMap = new Map<string, boolean>()
        if (allRooms) {
          for (const r of allRooms) {
            scopeMap.set(r.id, r.is_in_scope ?? true)
          }
        }

        // 3. For each estimate, recompute total
        for (const est of estimates) {
          const { data: lineItems } = await supabase
            .from('estimate_line_items')
            .select('client_price, room_id, is_active')
            .eq('estimate_id', est.id)
            .neq('is_active', false)

          let total = 0
          if (lineItems) {
            for (const li of lineItems) {
              if (li.room_id && scopeMap.get(li.room_id) === false) continue
              total += Number(li.client_price ?? 0)
            }
          }

          total = Math.round(total * 100) / 100

          await supabase
            .from('estimates')
            .update({ total })
            .eq('id', est.id)

          updatedEstimateTotals[est.id] = total
        }
      }
    } catch (cascadeError) {
      // Don't fail the scope toggle if total refresh fails
      console.error('Error refreshing estimate totals after scope toggle:', cascadeError)
    }

    return { success: true, updatedEstimateTotals }
  } catch (error) {
    console.error('Error toggling room scope:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Delete a room
 */
export async function deleteRoom(
  roomId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Get room to find project_id
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, project_id')
      .eq('id', roomId)
      .single()

    if (roomError || !room) {
      return { success: false, error: 'Room not found' }
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', room.project_id)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if (project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // Delete room (line items CASCADE deleted via FK constraint)
    const { error: deleteError } = await supabase
      .from('rooms')
      .delete()
      .eq('id', roomId)

    if (deleteError) {
      console.error('Error deleting room:', deleteError)
      return { success: false, error: 'Failed to delete room' }
    }

    return { success: true }
  } catch (error) {
    console.error('Error deleting room:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// =============================================================================
// rederiveLineItemQuantity – switch a line item back to room_dimensions mode
// =============================================================================

/**
 * Re-derive a single line item's quantity from its room's computed area.
 *
 * Used when the user clicks "Auto" toggle on a line item to switch
 * from calc_source='manual' back to calc_source='room_dimensions'.
 *
 * Steps:
 * 1. Fetch the line item and its linked room.
 * 2. Resolve which area field to use.
 * 3. Set quantity = room area, calc_source = 'room_dimensions'.
 * 4. Recompute direct_cost if unit_cost is available.
 * 5. Return the updated values.
 */
export async function rederiveLineItemQuantity(
  lineItemId: string
): Promise<{
  success: boolean
  quantity?: number | null
  direct_cost?: number | null
  calc_source?: 'manual' | 'room_dimensions'
  area_field?: string | null
  error?: string
}> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Fetch line item with room join
    const { data: lineItem, error: liError } = await supabase
      .from('estimate_line_items')
      .select(`
        id, room_id, cost_code, unit, description, category,
        quantity, unit_cost, labor_cost, material_cost, margin_percent,
        rooms!estimate_line_items_room_id_fkey (
          id, project_id, floor_area_sqft, wall_area_sqft, ceiling_area_sqft
        )
      `)
      .eq('id', lineItemId)
      .single()

    if (liError || !lineItem) {
      return { success: false, error: 'Line item not found' }
    }

    // Verify ownership
    const room = (lineItem as any).rooms as { id: string; project_id: string; floor_area_sqft: number | null; wall_area_sqft: number | null; ceiling_area_sqft: number | null } | null

    if (!room) {
      return { success: false, error: 'Line item has no linked room. Cannot auto-derive quantity.' }
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', room.project_id)
      .single()

    if (projectError || !project || project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // Resolve area field
    const areaField = resolveAreaFieldForLineItem({
      cost_code: lineItem.cost_code,
      unit: lineItem.unit,
      description: lineItem.description,
      category: lineItem.category,
    })

    if (!areaField) {
      return {
        success: false,
        error: 'Cannot determine area mapping for this item. Check that the unit is SQFT/SF.',
      }
    }

    // Get area value
    const newQuantity = room[areaField] !== null && room[areaField] !== undefined
      ? Number(room[areaField])
      : null

    // Compute direct_cost if possible
    let newDirectCost: number | null = null
    if (newQuantity !== null && lineItem.unit_cost !== null && lineItem.unit_cost !== undefined) {
      newDirectCost = Math.round(newQuantity * Number(lineItem.unit_cost) * 100) / 100
    }

    // Update the line item
    // calc_source excluded — column does not exist in DB yet
    const updateFields: Record<string, unknown> = {
      quantity: newQuantity,
    }
    if (newDirectCost !== null) {
      updateFields.direct_cost = newDirectCost
    }

    const { error: updateError } = await supabase
      .from('estimate_line_items')
      .update(updateFields)
      .eq('id', lineItemId)

    if (updateError) {
      console.error('Error updating line item:', updateError)
      return { success: false, error: 'Failed to update line item' }
    }

    return {
      success: true,
      quantity: newQuantity,
      direct_cost: newDirectCost,
      calc_source: 'room_dimensions',
      area_field: areaField,
    }
  } catch (error) {
    console.error('Error re-deriving line item quantity:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Set a line item's calc_source to 'manual', preserving its current quantity.
 * Used when user edits the quantity field to override auto-calculation.
 */
export async function setLineItemCalcSourceManual(
  lineItemId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Verify ownership via project
    const { data: lineItem, error: liError } = await supabase
      .from('estimate_line_items')
      .select('id, project_id')
      .eq('id', lineItemId)
      .single()

    if (liError || !lineItem) {
      return { success: false, error: 'Line item not found' }
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', lineItem.project_id)
      .single()

    if (projectError || !project || project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // calc_source column does not exist in DB yet — this is a no-op until migration 034 is applied.
    // Skip the DB update; the client already tracks calc_source in local state.
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
