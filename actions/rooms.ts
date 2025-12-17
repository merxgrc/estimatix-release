'use server'

import { createServerClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/server'
import type { Room, RoomInsert, RoomUpdate } from '@/types/db'

/**
 * Room data with aggregated statistics from line items
 */
export interface RoomWithStats extends Room {
  line_item_count: number
  direct_total: number
  client_total: number
  trade_breakdown: Record<string, number> // e.g., { "Electrical": 500, "Plumbing": 1200 }
}

/**
 * Data structure for upserting a room
 */
export interface UpsertRoomData {
  projectId: string
  id?: string
  name: string
  type?: string | null
  area?: number | null
  notes?: string | null
}

/**
 * Fetch all rooms for a project with aggregated statistics from line items
 * 
 * Calculates:
 * - line_item_count: Count of active items
 * - direct_total: Sum of direct_cost (or unit_cost * quantity) for active items
 * - client_total: Sum of client_price for active items
 * - trade_breakdown: JSON object grouping costs by cost_code/trade
 */
export async function getProjectRooms(
  projectId: string
): Promise<{ success: boolean; rooms?: RoomWithStats[]; error?: string }> {
  try {
    const user = await requireAuth()
    if (!user || !user.id) {
      return { success: false, error: 'Authentication required' }
    }

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
      return { success: false, error: 'Unauthorized: Project does not belong to user' }
    }

    // Fetch all rooms for the project
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('*')
      .eq('project_id', projectId)
      .order('name', { ascending: true })

    if (roomsError) {
      return { success: false, error: `Failed to fetch rooms: ${roomsError.message}` }
    }

    if (!rooms || rooms.length === 0) {
      return { success: true, rooms: [] }
    }

    // Fetch all active line items for this project
    const { data: lineItems, error: lineItemsError } = await supabase
      .from('estimate_line_items')
      .select('room_id, direct_cost, unit_cost, quantity, client_price, cost_code, is_active')
      .eq('project_id', projectId)
      .eq('is_active', true) // Only count active items

    if (lineItemsError) {
      console.error('Error fetching line items:', lineItemsError)
      // Continue with empty line items rather than failing
    }

    // Calculate statistics for each room
    const roomsWithStats: RoomWithStats[] = rooms.map(room => {
      // Filter line items for this room (only active ones)
      const roomLineItems = (lineItems || []).filter(
        item => item.room_id === room.id && item.is_active === true
      )

      // Calculate line_item_count
      const line_item_count = roomLineItems.length

      // Calculate direct_total
      // Use direct_cost if available, otherwise fall back to unit_cost * quantity
      const direct_total = roomLineItems.reduce((sum, item) => {
        if (item.direct_cost !== null && item.direct_cost !== undefined) {
          return sum + Number(item.direct_cost)
        } else if (
          item.unit_cost !== null &&
          item.unit_cost !== undefined &&
          item.quantity !== null &&
          item.quantity !== undefined
        ) {
          return sum + Number(item.unit_cost) * Number(item.quantity)
        }
        return sum
      }, 0)

      // Calculate client_total
      const client_total = roomLineItems.reduce((sum, item) => {
        if (item.client_price !== null && item.client_price !== undefined) {
          return sum + Number(item.client_price)
        }
        return sum
      }, 0)

      // Calculate trade_breakdown
      // Group by cost_code and sum client_price (or direct_cost if client_price unavailable)
      const tradeBreakdown: Record<string, number> = {}
      
      // Map of cost codes to trade names (you may want to expand this)
      const tradeNames: Record<string, string> = {
        '201': 'Demo',
        '305': 'Framing',
        '404': 'Plumbing',
        '405': 'Electrical',
        '402': 'HVAC',
        '520': 'Windows',
        '530': 'Doors',
        '640': 'Cabinetry',
        '641': 'Countertops',
        '960': 'Flooring',
        '950': 'Tile',
        '990': 'Paint',
        '999': 'Other',
      }

      roomLineItems.forEach(item => {
        const costCode = item.cost_code || '999'
        const tradeName = tradeNames[costCode] || `Code ${costCode}`
        
        const amount = item.client_price !== null && item.client_price !== undefined
          ? Number(item.client_price)
          : (item.direct_cost !== null && item.direct_cost !== undefined
            ? Number(item.direct_cost)
            : 0)

        if (amount > 0) {
          tradeBreakdown[tradeName] = (tradeBreakdown[tradeName] || 0) + amount
        }
      })

      return {
        ...room,
        line_item_count,
        direct_total: Math.round(direct_total * 100) / 100, // Round to 2 decimal places
        client_total: Math.round(client_total * 100) / 100,
        trade_breakdown: tradeBreakdown,
      }
    })

    return { success: true, rooms: roomsWithStats }
  } catch (error) {
    console.error('Error in getProjectRooms:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch rooms'
    }
  }
}

/**
 * Create or update a room
 * 
 * @param data - Room data including projectId, optional id, name, type, area, notes
 * @returns The created/updated room
 */
export async function upsertRoom(
  data: UpsertRoomData
): Promise<{ success: boolean; room?: Room; error?: string }> {
  try {
    const user = await requireAuth()
    if (!user || !user.id) {
      return { success: false, error: 'Authentication required' }
    }

    const supabase = await createServerClient()

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', data.projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if (project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized: Project does not belong to user' }
    }

    // Validate required fields
    if (!data.name || data.name.trim().length === 0) {
      return { success: false, error: 'Room name is required' }
    }

    if (data.id) {
      // Update existing room
      // First verify the room belongs to this project
      const { data: existingRoom, error: existingError } = await supabase
        .from('rooms')
        .select('id, project_id')
        .eq('id', data.id)
        .single()

      if (existingError || !existingRoom) {
        return { success: false, error: 'Room not found' }
      }

      if (existingRoom.project_id !== data.projectId) {
        return { success: false, error: 'Room does not belong to the specified project' }
      }

      const updateData: RoomUpdate = {
        name: data.name.trim(),
        type: data.type || null,
        area_sqft: data.area || null,
        notes: data.notes || null,
      }

      const { data: updatedRoom, error: updateError } = await supabase
        .from('rooms')
        .update(updateData)
        .eq('id', data.id)
        .select()
        .single()

      if (updateError) {
        return { success: false, error: `Failed to update room: ${updateError.message}` }
      }

      return { success: true, room: updatedRoom }
    } else {
      // Create new room
      const insertData: RoomInsert = {
        project_id: data.projectId,
        name: data.name.trim(),
        type: data.type || null,
        area_sqft: data.area || null,
        source: 'manual',
        is_active: true,
        notes: data.notes || null,
      }

      const { data: newRoom, error: insertError } = await supabase
        .from('rooms')
        .insert(insertData)
        .select()
        .single()

      if (insertError) {
        return { success: false, error: `Failed to create room: ${insertError.message}` }
      }

      return { success: true, room: newRoom }
    }
  } catch (error) {
    console.error('Error in upsertRoom:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upsert room'
    }
  }
}

/**
 * Toggle room active status and cascade to linked line items
 * 
 * When a room is hidden (is_active = false), all linked line items are also hidden.
 * This allows hiding a room and removing its cost from totals without deleting data.
 * 
 * @param roomId - The room ID to toggle
 * @param isActive - The new active status
 */
export async function toggleRoomScope(
  roomId: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (!user || !user.id) {
      return { success: false, error: 'Authentication required' }
    }

    const supabase = await createServerClient()

    // Fetch room and verify ownership
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
      return { success: false, error: 'Unauthorized: Project does not belong to user' }
    }

    // Update room is_active status
    const { error: updateRoomError } = await supabase
      .from('rooms')
      .update({ is_active: isActive })
      .eq('id', roomId)

    if (updateRoomError) {
      return { success: false, error: `Failed to update room: ${updateRoomError.message}` }
    }

    // Cascade: Update all linked line items' is_active status
    const { error: updateItemsError } = await supabase
      .from('estimate_line_items')
      .update({ is_active: isActive })
      .eq('room_id', roomId)

    if (updateItemsError) {
      console.error('Error updating line items:', updateItemsError)
      // Room was updated, but line items failed - log but don't fail
      // The room status change is more important
      return {
        success: true,
        error: `Room updated but failed to update some line items: ${updateItemsError.message}`
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Error in toggleRoomScope:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to toggle room scope'
    }
  }
}

/**
 * Delete a room
 * 
 * Note: Database cascade should handle line items (room_id will be set to NULL),
 * but this function verifies ownership before deletion.
 * 
 * @param roomId - The room ID to delete
 */
export async function deleteRoom(
  roomId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (!user || !user.id) {
      return { success: false, error: 'Authentication required' }
    }

    const supabase = await createServerClient()

    // Fetch room and verify ownership
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
      return { success: false, error: 'Unauthorized: Project does not belong to user' }
    }

    // Delete the room
    // Note: The migration sets room_id FK with ON DELETE SET NULL,
    // so line items will have room_id set to NULL, not deleted
    const { error: deleteError } = await supabase
      .from('rooms')
      .delete()
      .eq('id', roomId)

    if (deleteError) {
      return { success: false, error: `Failed to delete room: ${deleteError.message}` }
    }

    return { success: true }
  } catch (error) {
    console.error('Error in deleteRoom:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete room'
    }
  }
}
