/**
 * Pricing Service - Learning Pricing Engine
 * Applies pricing to line items using waterfall pattern with learning from historical data
 * 
 * Waterfall Priority (Milestone A):
 * 1. Manual pricing (user-provided) - return immediately
 * 2. User Library (lookup by task_key in user_cost_library) - FEATURE-FLAGGED OFF
 * 3. Task Library (semantic search with region_factor and quality_tier multipliers) - FEATURE-FLAGGED OFF
 * 4. AI-generated (no pricing found)
 * 
 * PHASE 1 (per PRODUCT_CONTEXT.md):
 * - Pricing suggestions are OFF by default
 * - Unit costs start blank unless manually entered
 * - We capture data but do NOT influence bids yet
 * 
 * Margin Application:
 * - Fetch user_margin_rules for trade-specific or 'all' scope
 * - Apply margin to calculate client_price
 */

// FEATURE FLAGS - Per PRODUCT_CONTEXT.md Phase 1
// These are OFF to ensure we don't auto-fill prices
const ENABLE_USER_LIBRARY_SUGGESTIONS = false
const ENABLE_TASK_LIBRARY_SUGGESTIONS = false

import type { LineItem } from '@/types/estimate'
import type { PricingDecision, PricingSource } from '@/types/db'
import { matchTask } from '@/lib/pricing/match-task'
import { makeTaskKey } from '@/lib/pricing/makeTaskKey'
import { lookupUserCostLibrary } from '@/lib/pricing/upsertUserCostLibrary'
import { getProfileByUserId } from '@/lib/profile'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Extended LineItem with pricing decision metadata
 */
export interface LineItemWithPricingDecision extends LineItem {
  pricingDecision?: PricingDecision
}

/**
 * Get user's margin rule for a specific trade/cost_code
 */
async function getUserMarginRule(
  userId: string,
  costCode: string | null,
  supabase: any
): Promise<number> {
  try {
    // First, try to find a trade-specific rule (e.g., 'trade:404')
    if (costCode) {
      const { data: tradeRule } = await supabase
        .from('user_margin_rules')
        .select('margin_percent')
        .eq('user_id', userId)
        .eq('scope', `trade:${costCode}`)
        .maybeSingle()

      if (tradeRule) {
        return Number(tradeRule.margin_percent)
      }
    }

    // Fall back to 'all' rule
    const { data: allRule } = await supabase
      .from('user_margin_rules')
      .select('margin_percent')
      .eq('user_id', userId)
      .eq('scope', 'all')
      .maybeSingle()

    if (allRule) {
      return Number(allRule.margin_percent)
    }
  } catch (error) {
    console.warn('Error fetching margin rule:', error)
  }

  // Default margin if no rule found
  return 30
}

/**
 * Get quality tier multiplier
 */
function getQualityTierMultiplier(qualityTier: string | null | undefined): number {
  switch (qualityTier) {
    case 'budget':
      return 0.9
    case 'premium':
      return 1.2
    case 'standard':
    default:
      return 1.0
  }
}

/**
 * Apply pricing to a line item
 * 
 * @param item - Line item (may have partial data including unitCost/direct_cost from AI)
 * @param userId - Required for history lookup and margin rules
 * @returns Updated LineItem with pricing applied
 */
export async function applyPricing(
  item: Partial<LineItem> & {
    description: string
    unitCost?: number
    pricing_source?: 'task_library' | 'user_library' | 'manual' | 'ai' | 'history' | 'seed' | null
    task_library_id?: string | null
    is_allowance?: boolean | null
  },
  userId?: string
): Promise<LineItem> {
  // CRITICAL: Skip allowance items entirely - do not apply pricing to them
  const isAllowance = item.is_allowance === true || 
                     (item.description && item.description.toUpperCase().trim().startsWith('ALLOWANCE:'))
  
  if (isAllowance) {
    return {
      id: item.id,
      room_name: item.room_name || 'General',
      description: item.description,
      category: item.category || 'Other',
      cost_code: item.cost_code || null,
      quantity: item.quantity ?? 1,
      unit: item.unit || 'EA',
      labor_cost: item.labor_cost ?? 0,
      material_cost: item.material_cost ?? 0,
      overhead_cost: item.overhead_cost ?? 0,
      direct_cost: item.direct_cost ?? 0,
      margin_percent: 0, // Allowances have 0% margin
      client_price: item.client_price ?? item.direct_cost ?? 0,
      pricing_source: item.pricing_source || 'manual',
      confidence: item.confidence ?? null,
      notes: item.notes,
      is_allowance: true
    }
  }

  const defaultItem: LineItem = {
    id: item.id,
    room_name: item.room_name || 'General',
    description: item.description,
    category: item.category || 'Other',
    cost_code: item.cost_code || null,
    quantity: item.quantity ?? 1,
    unit: item.unit || 'EA',
    labor_cost: item.labor_cost ?? 0,
    material_cost: item.material_cost ?? 0,
    overhead_cost: item.overhead_cost ?? 0,
    direct_cost: item.direct_cost ?? 0,
    margin_percent: item.margin_percent ?? 30,
    client_price: item.client_price ?? 0,
    pricing_source: item.pricing_source || null,
    confidence: item.confidence ?? null,
    notes: item.notes
  }

  const supabase = await createServerClient()
  const quantity = item.quantity ?? 1

  // PRIORITY 1: Manual Pricing
  if (
    item.pricing_source === 'manual' && 
    (item.unitCost !== undefined && item.unitCost !== null && item.unitCost > 0)
  ) {
    const totalCost = item.unitCost * quantity
    const marginPercent = userId ? await getUserMarginRule(userId, item.cost_code || null, supabase) : 30
    const clientPrice = totalCost * (1 + marginPercent / 100)
    
    // Build task key for reference
    let taskKey: string | undefined
    try {
      taskKey = makeTaskKey({
        costCode: item.cost_code,
        description: item.description,
        unit: item.unit
      })
    } catch {
      // Ignore task key errors
    }

    const pricingDecision: PricingDecision = {
      unitCost: item.unitCost,
      source: 'manual',
      taskKey
    }

    return {
      ...defaultItem,
      direct_cost: totalCost,
      margin_percent: marginPercent,
      client_price: clientPrice,
      pricing_source: 'manual',
      price_source: 'manual',
      unit: item.unit || defaultItem.unit,
      pricingDecision
    } as LineItemWithPricingDecision
  }

  // Also check if direct_cost is already set from manual pricing
  if (
    item.pricing_source === 'manual' &&
    item.direct_cost !== undefined &&
    item.direct_cost !== null &&
    item.direct_cost > 0
  ) {
    const marginPercent = userId ? await getUserMarginRule(userId, item.cost_code || null, supabase) : 30
    const clientPrice = item.direct_cost * (1 + marginPercent / 100)
    
    // Build task key for reference
    let taskKey: string | undefined
    try {
      taskKey = makeTaskKey({
        costCode: item.cost_code,
        description: item.description,
        unit: item.unit
      })
    } catch {
      // Ignore task key errors
    }

    const pricingDecision: PricingDecision = {
      unitCost: item.direct_cost / quantity,
      source: 'manual',
      taskKey
    }

    return {
      ...defaultItem,
      direct_cost: item.direct_cost,
      margin_percent: marginPercent,
      client_price: clientPrice,
      pricing_source: 'manual',
      pricingDecision
    } as LineItemWithPricingDecision
  }

  // PRIORITY 2: User Library (lookup by task_key)
  // FEATURE-FLAGGED OFF per PRODUCT_CONTEXT.md Phase 1
  if (ENABLE_USER_LIBRARY_SUGGESTIONS && userId && item.description) {
    try {
      const taskKey = makeTaskKey({
        costCode: item.cost_code,
        description: item.description,
        unit: item.unit
      })

      // Get user profile for region
      let region: string | null = null
      try {
        const profile = await getProfileByUserId(userId)
        region = (profile as any)?.region || null
      } catch {
        // Ignore profile errors
      }

      const userLibraryEntry = await lookupUserCostLibrary(userId, taskKey, region)
      
      if (userLibraryEntry) {
        const totalCost = userLibraryEntry.unitCost * quantity
        const marginPercent = await getUserMarginRule(userId, item.cost_code || null, supabase)
        const clientPrice = totalCost * (1 + marginPercent / 100)

        const pricingDecision: PricingDecision = {
          unitCost: userLibraryEntry.unitCost,
          source: 'user_library',
          taskKey
        }

        return {
          ...defaultItem,
          direct_cost: totalCost,
          margin_percent: marginPercent,
          client_price: clientPrice,
          pricing_source: 'user_library',
          price_source: 'user_library',
          unit: userLibraryEntry.unit || item.unit || defaultItem.unit,
          pricingDecision
        } as LineItemWithPricingDecision
      }
    } catch (error) {
      console.warn(`Error fetching user library pricing for "${item.description}":`, error)
      // Fall through to task library
    }
  }

  // PRIORITY 3: Task Library (semantic search with region_factor and quality_tier multipliers)
  // FEATURE-FLAGGED OFF per PRODUCT_CONTEXT.md Phase 1
  if (ENABLE_TASK_LIBRARY_SUGGESTIONS && (!item.pricing_source || item.pricing_source === 'ai' || item.pricing_source === 'seed' || item.pricing_source === 'task_library')) {
    try {
      // Get user profile for region_factor and quality_tier
      let regionFactor = 1.0
      let qualityTier = 'standard'
      
      if (userId) {
        try {
          const profile = await getProfileByUserId(userId)
          regionFactor = Number((profile as any)?.region_factor) || 1.0
          qualityTier = (profile as any)?.quality_tier || 'standard'
        } catch (profileError) {
          console.warn('Failed to get user profile:', profileError)
        }
      }

      // Use semantic search to find matching task
      const matchResult = await matchTask({
        description: item.description,
        cost_code: item.cost_code || null,
        region: null // Region is now handled via region_factor multiplier
      })

      if (matchResult && matchResult.confidence >= 70) {
        const task = matchResult.task
        const qualityMultiplier = getQualityTierMultiplier(qualityTier)
        
        // Calculate costs from task library data with multipliers
        let laborCost: number | null = null
        let materialCost: number | null = null
        let directCost: number | null = null
        let suggestedUnitCost: number | null = null

        // Calculate labor cost from labor hours if available
        if (task.labor_hours_per_unit !== null && task.labor_hours_per_unit !== undefined) {
          const laborRatePerHour = 50 // Could be configurable per user
          laborCost = task.labor_hours_per_unit * laborRatePerHour * quantity * regionFactor * qualityMultiplier
        }

        // Calculate material cost
        if (task.material_cost_per_unit !== null && task.material_cost_per_unit !== undefined) {
          materialCost = task.material_cost_per_unit * quantity * regionFactor * qualityMultiplier
        }

        // Use unit_cost_mid as direct cost if available
        if (task.unit_cost_mid !== null && task.unit_cost_mid !== undefined) {
          suggestedUnitCost = task.unit_cost_mid * regionFactor * qualityMultiplier
          const unitCostTotal = suggestedUnitCost * quantity
          if (!laborCost && !materialCost) {
            directCost = unitCostTotal
          } else {
            directCost = (laborCost || 0) + (materialCost || 0)
          }
        } else if (laborCost || materialCost) {
          directCost = (laborCost || 0) + (materialCost || 0)
          suggestedUnitCost = directCost / quantity
        }

        if (directCost && directCost > 0) {
          const marginPercent = userId ? await getUserMarginRule(userId, item.cost_code || null, supabase) : 30
          const clientPrice = directCost * (1 + marginPercent / 100)

          // Build task key for reference
          let taskKey: string | undefined
          try {
            taskKey = makeTaskKey({
              costCode: item.cost_code || task.cost_code,
              description: item.description,
              unit: item.unit || task.unit
            })
          } catch {
            // Ignore task key errors
          }

          const pricingDecision: PricingDecision = {
            unitCost: suggestedUnitCost || (directCost / quantity),
            source: 'task_library',
            matchedTaskId: task.id,
            matchConfidence: matchResult.confidence,
            suggestedUnitCost: suggestedUnitCost,
            taskKey
          }

          return {
            ...defaultItem,
            direct_cost: directCost,
            labor_cost: laborCost || 0,
            material_cost: materialCost || 0,
            margin_percent: marginPercent,
            client_price: clientPrice,
            unit: item.unit || task.unit || defaultItem.unit,
            pricing_source: 'task_library',
            confidence: matchResult.confidence,
            cost_code: item.cost_code || task.cost_code || defaultItem.cost_code,
            task_library_id: task.id,
            pricingDecision
          } as LineItemWithPricingDecision
        }
      }
    } catch (error) {
      console.error(`Error matching pricing for "${item.description}":`, error)
      // Fall through to AI-generated pricing
    }
  }

  // PRIORITY 4: No pricing found - return as AI-generated (FALLBACK)
  const marginPercent = userId ? await getUserMarginRule(userId, item.cost_code || null, supabase) : 30
  const clientPrice = (item.direct_cost || 0) * (1 + marginPercent / 100)

  // Build task key for reference
  let taskKey: string | undefined
  try {
    taskKey = makeTaskKey({
      costCode: item.cost_code,
      description: item.description,
      unit: item.unit
    })
  } catch {
    // Ignore task key errors
  }

  const pricingDecision: PricingDecision = {
    unitCost: item.direct_cost ? (item.direct_cost / quantity) : 0,
    source: 'ai',
    taskKey
  }

  return {
    ...defaultItem,
    margin_percent: marginPercent,
    client_price: clientPrice,
    pricing_source: 'ai',
    price_source: 'ai',
    direct_cost: item.direct_cost ?? 0,
    pricingDecision
  } as LineItemWithPricingDecision
}

/**
 * Apply pricing to multiple line items
 */
export async function applyPricingToItems(
  items: Array<Partial<LineItem> & {
    description: string
    unitCost?: number
    pricing_source?: 'task_library' | 'user_library' | 'manual' | 'ai' | null
    is_allowance?: boolean | null
  }>,
  userId?: string
): Promise<LineItem[]> {
  // Normalize is_allowance to boolean | undefined to satisfy applyPricing
  const normalizedItems = items.map(item => ({
    ...item,
    is_allowance: item.is_allowance === null ? undefined : item.is_allowance
  }))

  return Promise.all(normalizedItems.map(item => applyPricing(item, userId)))
}
