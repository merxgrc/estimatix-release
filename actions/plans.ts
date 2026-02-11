'use server'

/**
 * Server actions for blueprint/plan parsing results
 * 
 * Phase 1 Requirements:
 * - NO PRICING: direct_cost, client_price must be NULL
 * - REVIEW step required before applying
 * - "Remove room" = exclude from scope (is_active = false), not delete
 */

import { createServerClient, requireAuth } from '@/lib/supabase/server'

// =============================================================================
// Types
// =============================================================================

export interface ParsedRoomInput {
  name: string
  type: string | null
  area_sqft: number | null
  dimensions: string | null
  notes: string | null
  included: boolean // User can exclude during review
}

export interface LineItemScaffoldInput {
  description: string
  category: string
  cost_code: string | null
  room_name: string
  quantity: number | null
  unit: string | null
  notes: string | null
  included: boolean // User can exclude during review
}

export interface ApplyParsedResultsInput {
  projectId: string
  estimateId: string
  planParseId?: string // Link to plan_parses record
  rooms: ParsedRoomInput[]
  lineItems: LineItemScaffoldInput[]
}

export interface ApplyParsedResultsOutput {
  success: boolean
  error?: string
  createdRooms: number
  createdLineItems: number
  excludedRooms: number
}

// =============================================================================
// Apply Parsed Results
// =============================================================================

export async function applyParsedResults(
  input: ApplyParsedResultsInput
): Promise<ApplyParsedResultsOutput> {
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
      return { success: false, error: 'Project not found', createdRooms: 0, createdLineItems: 0, excludedRooms: 0 }
    }

    if (project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized', createdRooms: 0, createdLineItems: 0, excludedRooms: 0 }
    }

    // Verify estimate exists and belongs to project
    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .select('id, project_id, status')
      .eq('id', input.estimateId)
      .eq('project_id', input.projectId)
      .single()

    if (estimateError || !estimate) {
      return { success: false, error: 'Estimate not found', createdRooms: 0, createdLineItems: 0, excludedRooms: 0 }
    }

    // Check estimate is in draft status
    if (estimate.status !== 'draft') {
      return { 
        success: false, 
        error: 'Estimate is locked. Can only add items to draft estimates.',
        createdRooms: 0, 
        createdLineItems: 0, 
        excludedRooms: 0 
      }
    }

    // Get existing room names for deduplication
    const { data: existingRooms } = await supabase
      .from('rooms')
      .select('id, name')
      .eq('project_id', input.projectId)

    const existingRoomNames = new Map(
      (existingRooms || []).map(r => [r.name.toLowerCase().trim(), r.id])
    )

    let createdRooms = 0
    let excludedRooms = 0
    const roomNameToId = new Map<string, string>()

    // Create rooms (only included ones as new, excluded ones are marked as excluded)
    for (const room of input.rooms) {
      const normalizedName = room.name.toLowerCase().trim()
      
      // Check if room already exists
      if (existingRoomNames.has(normalizedName)) {
        const existingId = existingRoomNames.get(normalizedName)!
        roomNameToId.set(room.name, existingId)
        
        // Update is_active status if room is being excluded
        if (!room.included) {
          await supabase
            .from('rooms')
            .update({ is_active: false })
            .eq('id', existingId)
          excludedRooms++
        }
        continue
      }

      // Create new room
      const { data: newRoom, error: roomError } = await supabase
        .from('rooms')
        .insert({
          project_id: input.projectId,
          name: room.name.trim(),
          type: room.type?.trim() || null,
          area_sqft: room.area_sqft || null,
          notes: room.notes ? `${room.notes}${room.dimensions ? ` | Dimensions: ${room.dimensions}` : ''}` : (room.dimensions || null),
          source: 'blueprint',
          is_active: room.included // Set is_active based on user's review choice
        })
        .select('id')
        .single()

      if (roomError) {
        console.error('Error creating room:', roomError)
        continue
      }

      roomNameToId.set(room.name, newRoom.id)
      
      if (room.included) {
        createdRooms++
      } else {
        excludedRooms++
      }
    }

    // Create line items (only included ones)
    let createdLineItems = 0
    const includedLineItems = input.lineItems.filter(li => li.included)

    if (includedLineItems.length > 0) {
      // Batch insert line items
      const lineItemsToInsert = includedLineItems.map(li => {
        // Find room ID by name
        const roomId = roomNameToId.get(li.room_name) || null

        return {
          estimate_id: input.estimateId,
          project_id: input.projectId,
          room_id: roomId,
          room_name: li.room_name,
          description: li.notes
            ? `${li.description} — ${li.notes}`
            : li.description,
          category: li.category || 'Other',
          cost_code: li.cost_code || '999',
          quantity: li.quantity || 1,
          unit: li.unit || 'EA',
          // Phase 1: NO PRICING - all pricing fields are NULL
          labor_cost: null,
          material_cost: null,
          direct_cost: null,
          margin_percent: null,
          client_price: null,
          pricing_source: null,
          price_source: null,
          task_library_id: null,
          is_allowance: false,
          is_active: true
        }
      })

      const { data: insertedItems, error: insertError } = await supabase
        .from('estimate_line_items')
        .insert(lineItemsToInsert)
        .select('id')

      if (insertError) {
        console.error('Error creating line items:', insertError)
        return {
          success: false,
          error: `Created ${createdRooms} rooms but failed to create line items: ${insertError.message}`,
          createdRooms,
          createdLineItems: 0,
          excludedRooms
        }
      }

      createdLineItems = insertedItems?.length || 0
    }

    // Update plan_parses record to mark as applied
    if (input.planParseId) {
      await supabase
        .from('plan_parses')
        .update({
          status: 'applied',
          applied_at: new Date().toISOString(),
          applied_rooms_count: createdRooms,
          applied_line_items_count: createdLineItems,
          excluded_rooms_count: excludedRooms,
        })
        .eq('id', input.planParseId)
    }

    return {
      success: true,
      createdRooms,
      createdLineItems,
      excludedRooms
    }

  } catch (error) {
    console.error('Error applying parsed results:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      createdRooms: 0,
      createdLineItems: 0,
      excludedRooms: 0
    }
  }
}
