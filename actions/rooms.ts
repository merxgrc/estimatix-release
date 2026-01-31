'use server'

import { createServerClient, requireAuth } from '@/lib/supabase/server'
import { formatCostCode } from '@/lib/constants'
import type { Room } from '@/types/db'

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
 * Create or update a room
 */
export async function upsertRoom(input: {
  projectId: string
  id?: string
  name: string
  type?: string | null
  area?: number | null
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

    const roomData = {
      project_id: input.projectId,
      name: input.name.trim(),
      type: input.type?.trim() || null,
      area_sqft: input.area || null,
      notes: input.notes?.trim() || null,
      source: 'manual' as const,
    }

    if (input.id) {
      // Update existing room
      const { data: room, error: updateError } = await supabase
        .from('rooms')
        .update(roomData)
        .eq('id', input.id)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating room:', updateError)
        return { success: false, error: 'Failed to update room' }
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
        return { success: false, error: 'Failed to create room' }
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

/**
 * Toggle room scope (is_active)
 */
export async function toggleRoomScope(
  roomId: string,
  isActive: boolean
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

    // Update room is_active status
    const { error: updateError } = await supabase
      .from('rooms')
      .update({ is_active: isActive })
      .eq('id', roomId)

    if (updateError) {
      console.error('Error toggling room scope:', updateError)
      return { success: false, error: 'Failed to update room scope' }
    }

    return { success: true }
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

    // Delete room (line items will have room_id set to NULL due to ON DELETE SET NULL)
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
