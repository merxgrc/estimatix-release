'use server'

/**
 * Server actions for estimate line item CRUD with server-side total computation.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CALC RULES (source of truth — client mirrors these for optimistic updates):
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *   direct_cost = labor_cost + material_cost + overhead_cost
 *
 *     → If the user explicitly provides direct_cost we trust it.
 *     → Otherwise we derive it from the three sub-costs.
 *
 *   client_price = direct_cost × (1 + margin_percent / 100)
 *
 *     → For allowances: client_price = direct_cost (margin forced to 0).
 *     → If client_price is explicitly provided we trust it (manual override).
 *
 *   total_cost (DB trigger) = (labor_cost + material_cost) × (1 + margin_percent / 100)
 *     → The DB trigger also auto-computes this on INSERT/UPDATE of cost fields.
 *     → We still compute and store client_price ourselves because total_cost
 *       doesn't include overhead_cost, while our business rule does.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * GRAND TOTAL SYNC
 * ═══════════════════════════════════════════════════════════════════════════════
 *   After every line item save we SUM(client_price) across all active,
 *   in-scope items and write the result to estimates.total.
 *   This keeps the estimate-level total always consistent.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createServerClient, requireAuth } from '@/lib/supabase/server'
import { z } from 'zod'

// ─── Zod schemas ────────────────────────────────────────────────────────────

const numericField = z.number().min(-1_000_000).max(100_000_000).nullable().optional()

/**
 * Patch schema: every field is optional — only send what changed.
 * Server validates and re-derives totals from the full stored row + patch.
 */
const UpdateLineItemPatchSchema = z.object({
  description: z.string().max(2000).optional(),
  room_name: z.string().max(255).nullable().optional(),
  room_id: z.string().uuid().nullable().optional(),
  category: z.string().max(255).optional(),
  cost_code: z.string().max(20).nullable().optional(),
  quantity: z.number().min(0).max(10_000_000).nullable().optional(),
  unit: z.string().max(20).optional(),
  labor_cost: numericField,
  material_cost: numericField,
  overhead_cost: numericField,
  direct_cost: numericField,
  margin_percent: z.number().min(0).max(500).optional(),
  client_price: numericField,
  pricing_source: z.enum(['task_library', 'user_library', 'manual', 'ai', 'history', 'seed']).nullable().optional(),
  calc_source: z.enum(['manual', 'room_dimensions']).optional(),
  is_allowance: z.boolean().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

export type UpdateLineItemPatch = {
  description?: string
  room_name?: string | null
  room_id?: string | null
  category?: string
  cost_code?: string | null
  quantity?: number | null
  unit?: string
  labor_cost?: number | null
  material_cost?: number | null
  overhead_cost?: number | null
  direct_cost?: number | null
  margin_percent?: number
  client_price?: number | null
  pricing_source?: 'task_library' | 'user_library' | 'manual' | 'ai' | 'history' | 'seed' | null
  calc_source?: 'manual' | 'room_dimensions'
  is_allowance?: boolean | null
  notes?: string | null
}

// ─── Result type ─────────────────────────────────────────────────────────────

export interface UpdateLineItemResult {
  success: boolean
  /** Server-computed fields returned for client reconciliation */
  item?: {
    id: string
    direct_cost: number | null
    client_price: number | null
    margin_percent: number
    quantity: number | null
    labor_cost: number | null
    material_cost: number | null
    overhead_cost: number | null
    calc_source: 'manual' | 'room_dimensions'
  }
  /** Updated grand total for the whole estimate */
  grandTotal?: number
  error?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Deterministic server-side computation of derived cost fields.
 *
 * Given the full field set (existing row merged with patch), produces
 * the canonical direct_cost and client_price values.
 */
function computeTotals(fields: {
  labor_cost: number | null
  material_cost: number | null
  overhead_cost: number | null
  direct_cost: number | null
  margin_percent: number
  client_price: number | null
  quantity: number | null
  is_allowance: boolean
  /** Did the caller explicitly pass direct_cost in the patch? */
  directCostExplicit: boolean
  /** Did the caller explicitly pass client_price in the patch? */
  clientPriceExplicit: boolean
}): { direct_cost: number | null; client_price: number | null } {
  const labor = fields.labor_cost ?? 0
  const material = fields.material_cost ?? 0
  const overhead = fields.overhead_cost ?? 0

  // 1. Compute direct_cost
  let directCost: number | null
  if (fields.directCostExplicit) {
    directCost = fields.direct_cost // trust explicit
  } else if (labor !== 0 || material !== 0 || overhead !== 0) {
    directCost = round2(labor + material + overhead)
  } else {
    directCost = fields.direct_cost // keep whatever was stored
  }

  // 2. Compute client_price
  let clientPrice: number | null
  if (fields.is_allowance) {
    // Allowances: no markup
    clientPrice = directCost
  } else if (fields.clientPriceExplicit) {
    clientPrice = fields.client_price // trust explicit
  } else if (directCost !== null && directCost !== 0) {
    const margin = fields.margin_percent ?? 0
    clientPrice = round2(directCost * (1 + margin / 100))
  } else {
    clientPrice = fields.client_price // keep stored
  }

  return { direct_cost: directCost, client_price: clientPrice }
}

// ─── Main server action ──────────────────────────────────────────────────────

/**
 * updateLineItem — Validates a partial patch, merges with existing row,
 * recomputes server-side totals, saves to DB, refreshes estimate.total.
 *
 * Returns the computed fields so the client can reconcile.
 */
export async function updateLineItem(
  lineItemId: string,
  rawPatch: UpdateLineItemPatch,
): Promise<UpdateLineItemResult> {
  // 1. Validate
  const parsed = UpdateLineItemPatchSchema.safeParse(rawPatch)
  if (!parsed.success) {
    const msg = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
    return { success: false, error: `Validation failed: ${msg}` }
  }
  const patch = parsed.data

  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // 2. Fetch the existing row
    const { data: existing, error: fetchErr } = await supabase
      .from('estimate_line_items')
      .select('*, estimates!inner(id, status, project_id)')
      .eq('id', lineItemId)
      .single()

    if (fetchErr || !existing) {
      return { success: false, error: 'Line item not found' }
    }

    // 3. Authorization: ensure user owns the project
    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', existing.project_id)
      .single()

    if (!project || project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // 4. Lock check: only drafts are editable
    const estimate = (existing as any).estimates as { id: string; status: string; project_id: string }
    if (estimate.status !== 'draft') {
      return { success: false, error: `Estimate is locked (status=${estimate.status}). Only drafts can be edited.` }
    }

    // 5. Merge existing + patch
    const merged = {
      description: patch.description ?? existing.description,
      room_name: patch.room_name !== undefined ? patch.room_name : existing.room_name,
      room_id: patch.room_id !== undefined ? patch.room_id : existing.room_id,
      category: patch.category ?? existing.category,
      cost_code: patch.cost_code !== undefined ? patch.cost_code : existing.cost_code,
      quantity: patch.quantity !== undefined ? patch.quantity : existing.quantity,
      unit: patch.unit ?? existing.unit,
      labor_cost: patch.labor_cost !== undefined ? patch.labor_cost : existing.labor_cost,
      material_cost: patch.material_cost !== undefined ? patch.material_cost : existing.material_cost,
      overhead_cost: patch.overhead_cost !== undefined ? patch.overhead_cost : existing.overhead_cost,
      direct_cost: patch.direct_cost !== undefined ? patch.direct_cost : existing.direct_cost,
      margin_percent: patch.margin_percent ?? existing.margin_percent ?? 30,
      client_price: patch.client_price !== undefined ? patch.client_price : existing.client_price,
      pricing_source: patch.pricing_source !== undefined ? patch.pricing_source : existing.pricing_source,
      calc_source: patch.calc_source ?? existing.calc_source ?? 'manual',
      is_allowance: patch.is_allowance !== undefined ? patch.is_allowance : existing.is_allowance,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
    }

    // 6. Server-side total computation
    const isAllowance = merged.is_allowance || (merged.description ?? '').toUpperCase().startsWith('ALLOWANCE:')
    const { direct_cost, client_price } = computeTotals({
      labor_cost: merged.labor_cost,
      material_cost: merged.material_cost,
      overhead_cost: merged.overhead_cost,
      direct_cost: merged.direct_cost,
      margin_percent: isAllowance ? 0 : merged.margin_percent,
      client_price: merged.client_price,
      quantity: merged.quantity,
      is_allowance: isAllowance,
      directCostExplicit: patch.direct_cost !== undefined,
      clientPriceExplicit: patch.client_price !== undefined,
    })

    // 7. Build update payload
    const updatePayload: Record<string, unknown> = {
      description: merged.description,
      room_name: merged.room_name,
      room_id: merged.room_id,
      category: merged.category,
      cost_code: merged.cost_code,
      quantity: merged.quantity,
      unit: merged.unit,
      labor_cost: merged.labor_cost,
      material_cost: merged.material_cost,
      overhead_cost: merged.overhead_cost,
      direct_cost,
      margin_percent: isAllowance ? 0 : merged.margin_percent,
      client_price,
      pricing_source: merged.pricing_source,
      // calc_source excluded — column does not exist in DB yet
      is_allowance: isAllowance,
    }

    // 8. Write to DB
    const { error: updateErr } = await supabase
      .from('estimate_line_items')
      .update(updatePayload)
      .eq('id', lineItemId)

    if (updateErr) {
      console.error('[updateLineItem] DB update error:', updateErr)
      return { success: false, error: `Failed to save: ${updateErr.message}` }
    }

    // 9. Refresh estimate.total = SUM(client_price) of all active in-scope items
    const grandTotal = await refreshEstimateTotal(supabase, existing.estimate_id, existing.project_id)

    // 10. Return computed fields for client reconciliation
    return {
      success: true,
      item: {
        id: lineItemId,
        direct_cost,
        client_price,
        margin_percent: isAllowance ? 0 : merged.margin_percent,
        quantity: merged.quantity,
        labor_cost: merged.labor_cost,
        material_cost: merged.material_cost,
        overhead_cost: merged.overhead_cost,
        calc_source: merged.calc_source as 'manual' | 'room_dimensions',
      },
      grandTotal,
    }
  } catch (err) {
    console.error('[updateLineItem] unexpected error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recompute estimates.total from the sum of client_price for all active
 * in-scope line items. Returns the new total.
 */
async function refreshEstimateTotal(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  estimateId: string,
  projectId: string,
): Promise<number> {
  // Fetch all active line items and rooms for scope filtering
  // Use resilient queries that fall back if columns are missing from schema cache
  let lineItems: any[] | null = null
  let rooms: any[] | null = null

  // Try fetching line items with is_active filter; fall back to all items
  const liResult = await supabase
    .from('estimate_line_items')
    .select('client_price, room_id, is_active')
    .eq('estimate_id', estimateId)
    .neq('is_active', false)
  if (liResult.error && liResult.error.message.includes('schema cache')) {
    const fallback = await supabase
      .from('estimate_line_items')
      .select('client_price, room_id')
      .eq('estimate_id', estimateId)
    lineItems = fallback.data
  } else {
    lineItems = liResult.data
  }

  // Try fetching rooms with is_in_scope; fall back to just id (treat all as in-scope)
  const roomsResult = await supabase
    .from('rooms')
    .select('id, is_in_scope')
    .eq('project_id', projectId)
  if (roomsResult.error && roomsResult.error.message.includes('schema cache')) {
    const fallback = await supabase
      .from('rooms')
      .select('id')
      .eq('project_id', projectId)
    rooms = fallback.data?.map(r => ({ ...r, is_in_scope: true })) ?? null
  } else {
    rooms = roomsResult.data
  }

  const scopeMap = new Map<string, boolean>()
  if (rooms) {
    for (const r of rooms) {
      scopeMap.set(r.id, r.is_in_scope ?? true)
    }
  }

  let total = 0
  if (lineItems) {
    for (const li of lineItems) {
      // Skip items from out-of-scope rooms
      if (li.room_id && scopeMap.get(li.room_id) === false) continue
      total += Number(li.client_price ?? 0)
    }
  }

  total = round2(total)

  // Write to estimates table
  await supabase
    .from('estimates')
    .update({ total })
    .eq('id', estimateId)

  return total
}
