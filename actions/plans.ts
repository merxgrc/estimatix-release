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
import { resolveAreaFieldForLineItem, getRoomAreaValue, isAreaUnit } from '@/lib/area-mapping'

// =============================================================================
// Types
// =============================================================================

export interface ParsedRoomInput {
  name: string
  level: string | null   // "Level 1", "Level 2", "Basement", etc. NULL = unknown
  type: string | null
  area_sqft: number | null
  length_ft?: number | null
  width_ft?: number | null
  ceiling_height_ft?: number | null
  dimensions: string | null
  notes: string | null
  included: boolean // User can exclude during review
  sheet_label?: string | null  // e.g. "A1.2 - SECOND FLOOR PLAN"
  level_source?: string | null // 'parsed' | 'manual' | 'backfilled'
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

    // ─── Phase 1 Logging: Rooms ───
    const roomsByLevel = new Map<string, string[]>()
    for (const room of input.rooms) {
      const level = room.level || 'Unknown'
      const existing = roomsByLevel.get(level) || []
      existing.push(room.name)
      roomsByLevel.set(level, existing)
    }
    for (const [level, names] of roomsByLevel) {
      console.log(`[ApplyParsed] Level "${level}" → ${names.length} rooms: ${names.join(', ')}`)
    }
    console.log(`[ApplyParsed] Total rooms in input: ${input.rooms.length}, ` +
      `included: ${input.rooms.filter(r => r.included).length}, ` +
      `excluded: ${input.rooms.filter(r => !r.included).length}`)

    // Create rooms (only included ones as new, excluded ones are marked as excluded)
    for (const room of input.rooms) {
      const normalizedName = room.name.toLowerCase().trim()
      
      // Check if room already exists
      if (existingRoomNames.has(normalizedName)) {
        const existingId = existingRoomNames.get(normalizedName)!
        roomNameToId.set(room.name, existingId)
        
        // Update scope status if room is being excluded
        if (!room.included) {
          await supabase
            .from('rooms')
            .update({ is_in_scope: false, is_active: false })
            .eq('id', existingId)
          excludedRooms++
        }
        continue
      }

      // Create new room with level and dimensions
      // Build the insert payload — include Phase 1 columns (dimensions, is_in_scope)
      // but fall back gracefully if migration 033 hasn't been applied yet.
      const roomInsertBase: Record<string, unknown> = {
        project_id: input.projectId,
        name: room.name.trim(),
        type: room.type?.trim() || null,
        area_sqft: room.area_sqft || null,
        notes: room.notes ? `${room.notes}${room.dimensions ? ` | Dimensions: ${room.dimensions}` : ''}` : (room.dimensions || null),
        source: 'blueprint',
        is_active: room.included,
      }

      // Phase 1 columns (may not exist if migration 033 hasn't been run)
      const roomInsertFull: Record<string, unknown> = {
        ...roomInsertBase,
        level: room.level || null,            // NULL = unknown level, never default to "Level 1"
        level_source: room.level ? 'parsed' : null,
        sheet_label: room.sheet_label || null,
        length_ft: room.length_ft || null,
        width_ft: room.width_ft || null,
        ceiling_height_ft: room.ceiling_height_ft || null,
        is_in_scope: room.included,
      }

      let newRoom: { id: string } | null = null
      let roomError: any = null

      // Try full insert first (with Phase 1 columns)
      const fullResult = await supabase
        .from('rooms')
        .insert(roomInsertFull)
        .select('id')
        .single()

      if (fullResult.error?.message?.includes('column') && fullResult.error?.message?.includes('schema cache')) {
        // Phase 1 columns don't exist yet — fall back to base columns only
        console.warn(`[ApplyParsed] Phase 1 columns missing, falling back to base insert for room "${room.name}"`)
        const baseResult = await supabase
          .from('rooms')
          .insert(roomInsertBase)
          .select('id')
          .single()
        newRoom = baseResult.data
        roomError = baseResult.error
      } else {
        newRoom = fullResult.data
        roomError = fullResult.error
      }

      if (roomError || !newRoom) {
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

    console.log(`[ApplyParsed] Rooms created: ${createdRooms}, excluded: ${excludedRooms}, ` +
      `skipped (existing): ${input.rooms.length - createdRooms - excludedRooms}`)

    // Create line items (only included ones)
    let createdLineItems = 0
    const includedLineItems = input.lineItems.filter(li => li.included)

    if (includedLineItems.length > 0) {
      // Build room name → level lookup from input rooms
      const roomNameToLevel = new Map<string, string | null>(
        input.rooms.map(r => [r.name, r.level || null])
      )

      // Fetch rooms with their computed areas for area-based quantity derivation
      const roomIds = Array.from(new Set(
        includedLineItems
          .map(li => roomNameToId.get(li.room_name))
          .filter((id): id is string => !!id)
      ))

      let roomAreaMap = new Map<string, {
        floor_area_sqft: number | null
        wall_area_sqft: number | null
        ceiling_area_sqft: number | null
      }>()

      if (roomIds.length > 0) {
        try {
          const { data: roomsWithAreas } = await supabase
            .from('rooms')
            .select('id, floor_area_sqft, wall_area_sqft, ceiling_area_sqft')
            .in('id', roomIds)

          if (roomsWithAreas) {
            for (const r of roomsWithAreas) {
              roomAreaMap.set(r.id, {
                floor_area_sqft: r.floor_area_sqft,
                wall_area_sqft: r.wall_area_sqft,
                ceiling_area_sqft: r.ceiling_area_sqft,
              })
            }
          }
        } catch {
          // Phase 1 area columns may not exist yet — area-based quantity derivation will be skipped
          console.warn('[ApplyParsed] Could not fetch room areas (migration 033 may not be applied)')
        }
      }

      // Batch insert line items with level denormalized from room
      // Auto-detect area-based items and set calc_source='room_dimensions'
      const lineItemsToInsert = includedLineItems.map(li => {
        // Find room ID by name
        const roomId = roomNameToId.get(li.room_name) || null
        const level = roomNameToLevel.get(li.room_name) || null

        const description = li.notes
          ? `${li.description} — ${li.notes}`
          : li.description

        const unit = li.unit || 'EA'

        // Determine if this is an area-based item that should auto-derive quantity
        const areaField = resolveAreaFieldForLineItem({
          cost_code: li.cost_code,
          unit,
          description,
          category: li.category,
        })

        let calcSource: 'manual' | 'room_dimensions' = 'manual'
        let quantity = li.quantity || 1

        // If area-based AND we have a room with area data, derive the quantity
        if (areaField && roomId) {
          const roomAreas = roomAreaMap.get(roomId)
          if (roomAreas) {
            const derivedQty = getRoomAreaValue(roomAreas, areaField)
            if (derivedQty !== null) {
              quantity = derivedQty
              calcSource = 'room_dimensions'
            }
          }
        }

        return {
          estimate_id: input.estimateId,
          project_id: input.projectId,
          room_id: roomId,
          room_name: li.room_name,
          level,
          description,
          category: li.category || 'Other',
          cost_code: li.cost_code || '999',
          quantity,
          unit: isAreaUnit(unit) ? 'SQFT' : unit, // Normalize area units to SQFT
          calc_source: calcSource,
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

      // ─── Phase 1 Logging: Line Items ───
      const autoCalcCount = lineItemsToInsert.filter(li => li.calc_source === 'room_dimensions').length
      const manualCount = lineItemsToInsert.filter(li => li.calc_source === 'manual').length
      console.log(`[ApplyParsed] Line items to insert: ${lineItemsToInsert.length} ` +
        `(${autoCalcCount} area-based auto-calc, ${manualCount} manual)`)
      for (const li of lineItemsToInsert.filter(l => l.calc_source === 'room_dimensions')) {
        console.log(`[ApplyParsed]   Auto-calc: "${li.description}" → room "${li.room_name}" → qty=${li.quantity} ${li.unit}`)
      }

      // Try full insert first (with Phase 1 columns: level, calc_source)
      let insertedItems: { id: string }[] | null = null
      let insertError: any = null

      const fullInsertResult = await supabase
        .from('estimate_line_items')
        .insert(lineItemsToInsert)
        .select('id')

      if (fullInsertResult.error?.message?.includes('column') && fullInsertResult.error?.message?.includes('schema cache')) {
        // Phase 1 columns don't exist — strip them and retry
        console.warn('[ApplyParsed] Phase 1 line item columns missing, falling back to base insert')
        const baseLineItems = lineItemsToInsert.map(({ level: _l, calc_source: _c, ...rest }) => rest)
        const baseResult = await supabase
          .from('estimate_line_items')
          .insert(baseLineItems)
          .select('id')
        insertedItems = baseResult.data
        insertError = baseResult.error
      } else {
        insertedItems = fullInsertResult.data
        insertError = fullInsertResult.error
      }

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

    console.log(`[ApplyParsed] ✅ Complete: ${createdRooms} rooms, ${createdLineItems} line items, ${excludedRooms} excluded`)

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
