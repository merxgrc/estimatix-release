/**
 * upsertUserCostLibrary - Server helper to save/update user pricing library
 * 
 * Upserts a price entry on (user_id, region, task_key).
 * Increments usage_count and updates last_used_at on conflict.
 */

import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import type { UserCostLibraryEntry } from '@/types/db'

/**
 * Input schema for user cost library upsert
 */
export const UserCostLibraryInputSchema = z.object({
  userId: z.string().uuid(),
  region: z.string().optional().nullable(),
  taskKey: z.string().min(1, 'taskKey is required'),
  unit: z.string().optional().nullable(),
  unitCost: z.number().min(0, 'unitCost must be non-negative'),
  notes: z.string().optional().nullable()
})

export type UserCostLibraryInput = z.infer<typeof UserCostLibraryInputSchema>

/**
 * Result type for upsertUserCostLibrary
 */
export type UpsertUserCostLibraryResult = 
  | { ok: true; row: Partial<UserCostLibraryEntry> }
  | { ok: false; error: string }

/**
 * Upsert a user cost library entry
 * 
 * - On insert: creates new entry with usage_count=1, last_used_at=now
 * - On conflict: updates unit_cost, increments usage_count, sets last_used_at=now
 * 
 * @param input - Validated user cost library data
 * @returns Result with ok status and row data or error message
 */
export async function upsertUserCostLibrary(
  input: UserCostLibraryInput
): Promise<UpsertUserCostLibraryResult> {
  try {
    // Validate input
    const validated = UserCostLibraryInputSchema.safeParse(input)
    if (!validated.success) {
      return { 
        ok: false, 
        error: `Validation error: ${validated.error.errors.map(e => e.message).join(', ')}` 
      }
    }

    const data = validated.data
    const supabase = await createServerClient()
    const now = new Date().toISOString()

    // Normalize region for lookup (NULL treated as empty string in unique index)
    const regionValue = data.region?.trim() || null

    // Check if entry exists
    let query = supabase
      .from('user_cost_library')
      .select('id, usage_count')
      .eq('user_id', data.userId)
      .eq('task_key', data.taskKey)

    // Handle NULL region properly
    if (regionValue) {
      query = query.eq('region', regionValue)
    } else {
      query = query.is('region', null)
    }

    const { data: existing, error: selectError } = await query.maybeSingle()

    if (selectError && selectError.code !== 'PGRST116') {
      console.error('Error checking existing entry:', selectError)
      return { ok: false, error: 'Failed to check existing entry' }
    }

    if (existing) {
      // Update existing entry
      const { data: updated, error: updateError } = await supabase
        .from('user_cost_library')
        .update({
          unit_cost: data.unitCost,
          unit: data.unit ?? null,
          usage_count: (existing.usage_count || 0) + 1,
          last_used_at: now,
          updated_at: now,
          notes: data.notes ?? null
        })
        .eq('id', existing.id)
        .select('id, task_key, unit_cost, unit, usage_count, last_used_at')
        .single()

      if (updateError) {
        console.error('Error updating user cost library:', updateError)
        return { ok: false, error: 'Failed to update user cost library' }
      }

      return { ok: true, row: updated }
    } else {
      // Insert new entry
      const { data: inserted, error: insertError } = await supabase
        .from('user_cost_library')
        .insert({
          user_id: data.userId,
          region: regionValue,
          task_key: data.taskKey,
          unit_cost: data.unitCost,
          unit: data.unit ?? null,
          usage_count: 1,
          last_used_at: now,
          notes: data.notes ?? null,
          source: 'manual' // Required field from existing schema
        })
        .select('id, task_key, unit_cost, unit, usage_count, last_used_at')
        .single()

      if (insertError) {
        console.error('Error inserting user cost library:', insertError)
        return { ok: false, error: 'Failed to save to user cost library' }
      }

      return { ok: true, row: inserted }
    }
  } catch (err) {
    console.error('Unexpected error in upsertUserCostLibrary:', err)
    return { ok: false, error: 'Unexpected error saving to user cost library' }
  }
}

/**
 * Look up a user's price from their cost library by task key
 * 
 * @param userId - User ID
 * @param taskKey - Normalized task key
 * @param region - Optional region filter
 * @returns The user's saved unit cost, or null if not found
 */
export async function lookupUserCostLibrary(
  userId: string,
  taskKey: string,
  region?: string | null
): Promise<{ unitCost: number; unit: string | null } | null> {
  try {
    const supabase = await createServerClient()
    
    let query = supabase
      .from('user_cost_library')
      .select('unit_cost, unit')
      .eq('user_id', userId)
      .eq('task_key', taskKey)

    // Handle NULL region properly
    if (region) {
      query = query.eq('region', region)
    } else {
      query = query.is('region', null)
    }

    const { data, error } = await query.maybeSingle()

    if (error && error.code !== 'PGRST116') {
      console.error('Error looking up user cost library:', error)
      return null
    }

    if (!data) return null

    return {
      unitCost: Number(data.unit_cost),
      unit: data.unit
    }
  } catch (err) {
    console.error('Unexpected error in lookupUserCostLibrary:', err)
    return null
  }
}
