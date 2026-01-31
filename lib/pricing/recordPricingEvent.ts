/**
 * recordPricingEvent - Server helper to record pricing feedback events
 * 
 * Records when users accept, edit, or reject suggested prices.
 * Used for analytics and improving pricing accuracy.
 */

import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import type { PricingSource, PricingUserAction, PricingEventInsert } from '@/types/db'

/**
 * Input schema for pricing event
 * 
 * user_action semantics:
 * - 'entered': Manual entry with no suggestion (Phase 1 default)
 * - 'accepted': Used a pricing suggestion as-is
 * - 'edited': Modified a pricing suggestion
 * - 'rejected': Explicitly rejected a suggestion
 */
export const PricingEventInputSchema = z.object({
  userId: z.string().uuid(),
  projectId: z.string().uuid().optional().nullable(),
  estimateId: z.string().uuid().optional().nullable(),
  lineItemId: z.string().uuid().optional().nullable(),
  region: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  source: z.enum(['manual', 'user_library', 'task_library', 'ai']),
  matchedTaskId: z.string().uuid().optional().nullable(),
  matchConfidence: z.number().min(0).max(100).optional().nullable(),
  suggestedUnitCost: z.number().optional().nullable(),
  finalUnitCost: z.number(),
  userAction: z.enum(['entered', 'accepted', 'edited', 'rejected']),
  meta: z.record(z.unknown()).optional().default({})
})

export type PricingEventInput = z.infer<typeof PricingEventInputSchema>

/**
 * Result type for recordPricingEvent
 */
export type RecordPricingEventResult = 
  | { ok: true; eventId: string }
  | { ok: false; error: string }

/**
 * Record a pricing event to the database
 * 
 * @param input - Validated pricing event data
 * @returns Result with ok status and eventId or error message
 */
export async function recordPricingEvent(
  input: PricingEventInput
): Promise<RecordPricingEventResult> {
  try {
    // Validate input
    const validated = PricingEventInputSchema.safeParse(input)
    if (!validated.success) {
      return { 
        ok: false, 
        error: `Validation error: ${validated.error.errors.map(e => e.message).join(', ')}` 
      }
    }

    const data = validated.data
    const supabase = await createServerClient()

    // Build insert data
    const insertData: PricingEventInsert = {
      user_id: data.userId,
      project_id: data.projectId ?? null,
      estimate_id: data.estimateId ?? null,
      line_item_id: data.lineItemId ?? null,
      region: data.region ?? null,
      unit: data.unit ?? null,
      quantity: data.quantity ?? null,
      source: data.source as PricingSource,
      matched_task_id: data.matchedTaskId ?? null,
      match_confidence: data.matchConfidence ?? null,
      suggested_unit_cost: data.suggestedUnitCost ?? null,
      final_unit_cost: data.finalUnitCost,
      user_action: data.userAction as PricingUserAction,
      meta: data.meta ?? {}
    }

    // Insert event
    const { data: event, error } = await supabase
      .from('pricing_events')
      .insert(insertData)
      .select('id')
      .single()

    if (error) {
      console.error('Error recording pricing event:', error)
      return { ok: false, error: 'Failed to record pricing event' }
    }

    return { ok: true, eventId: event.id }
  } catch (err) {
    console.error('Unexpected error in recordPricingEvent:', err)
    return { ok: false, error: 'Unexpected error recording pricing event' }
  }
}
