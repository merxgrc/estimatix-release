/**
 * Pricing Service
 * Applies pricing to line items from various sources (manual, user library, task library, etc.)
 * Uses waterfall pattern: Manual -> User Library -> Task Library -> AI
 * Uses pgvector semantic search for task library matching
 */

import type { LineItem } from '@/types/estimate'
import { matchTask } from '@/lib/pricing/match-task'
import { getProfileByUserId } from '@/lib/profile'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Apply pricing to a line item
 * 
 * Waterfall Priority:
 * 1. Manual pricing (user-provided) - return immediately
 * 2. User Library lookup (user's historical pricing by cost_code) - NEW
 * 3. Task Library lookup (pgvector semantic search)
 * 4. Leave as AI-generated (no pricing found)
 * 
 * @param item - Line item (may have partial data including unitCost/direct_cost from AI)
 * @param userId - Required for user library lookup, optional for region-specific pricing
 * @returns Updated LineItem with pricing applied
 */
export async function applyPricing(
  item: Partial<LineItem> & {
    description: string
    unitCost?: number
    pricing_source?: 'task_library' | 'user_library' | 'manual' | 'ai' | null
    is_allowance?: boolean
  },
  userId?: string
): Promise<LineItem> {
  // CRITICAL: Skip allowance items entirely - do not apply pricing to them
  // Check for is_allowance flag OR description starting with "ALLOWANCE:"
  const isAllowance = item.is_allowance === true || 
                     (item.description && item.description.toUpperCase().trim().startsWith('ALLOWANCE:'))
  
  if (isAllowance) {
    // Return item as-is without applying any pricing logic
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
      margin_percent: item.margin_percent ?? 0, // Allowances have 0% margin
      client_price: item.client_price ?? item.direct_cost ?? 0,
      pricing_source: item.pricing_source || 'manual',
      confidence: item.confidence ?? null,
      notes: item.notes,
      is_allowance: true
    }
  }

  // Default values for required fields
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

  // 1. Check for explicit manual pricing first
  // If user provided a price (via AI extraction), use it and return
  // IMPORTANT: Do NOT overwrite manual pricing - user explicitly provided this price
  if (
    item.pricing_source === 'manual' && 
    (item.unitCost !== undefined && item.unitCost !== null && item.unitCost > 0)
  ) {
    const quantity = item.quantity ?? 1
    const totalCost = item.unitCost * quantity
    
    return {
      ...defaultItem,
      direct_cost: totalCost,
      pricing_source: 'manual',
      // Preserve the user-provided unit
      unit: item.unit || defaultItem.unit
    }
  }
  
  // Also check if direct_cost is already set from manual pricing (backward compatibility)
  if (
    item.pricing_source === 'manual' &&
    item.direct_cost !== undefined &&
    item.direct_cost !== null &&
    item.direct_cost > 0
  ) {
    return {
      ...defaultItem,
      direct_cost: item.direct_cost,
      pricing_source: 'manual'
    }
  }

  // 2. User Library lookup (FIRST PRIORITY for non-manual pricing)
  // Check user's historical pricing by cost_code
  // Only if no manual pricing, user_id provided, and cost_code exists
  if (
    (!item.pricing_source || item.pricing_source === 'ai') &&
    (!item.unitCost || item.unitCost === 0) &&
    userId &&
    item.cost_code
  ) {
    try {
      const supabase = await createServerClient()
      
      // Query user_library for matching cost_code
      const { data: userLibraryEntry, error: userLibError } = await supabase
        .from('user_library')
        .select('unit_cost, unit, description, times_used')
        .eq('user_id', userId)
        .eq('cost_code', item.cost_code)
        .maybeSingle()

      if (userLibError && userLibError.code !== 'PGRST116') {
        // PGRST116 is "not found" which is fine, other errors should be logged
        console.warn(`Error querying user_library for cost_code ${item.cost_code}:`, userLibError)
      }

      // If found, use the user's historical pricing
      if (userLibraryEntry && userLibraryEntry.unit_cost) {
        const quantity = item.quantity ?? 1
        const unitCost = Number(userLibraryEntry.unit_cost)
        const totalCost = unitCost * quantity

        // Update last_used_at in the background (fire and forget)
        supabase
          .from('user_library')
          .update({ 
            last_used_at: new Date().toISOString(),
            times_used: (userLibraryEntry.times_used || 1) + 1
          })
          .eq('user_id', userId)
          .eq('cost_code', item.cost_code)
          .then(() => {}) // Ignore result

        return {
          ...defaultItem,
          direct_cost: totalCost,
          unit: item.unit || userLibraryEntry.unit || defaultItem.unit,
          pricing_source: 'user_library',
          // Use description from user library if available, otherwise keep item description
          description: userLibraryEntry.description || item.description,
          cost_code: item.cost_code,
          // No confidence score for user library (it's user's own data, assume 100%)
          confidence: 100
        }
      }
    } catch (error) {
      console.error(`Error querying user_library for "${item.description}":`, error)
      // Fall through to task library lookup
    }
  }

  // 3. Task library lookup using pgvector semantic search (SECOND PRIORITY)
  // Only if no manual pricing, no user library match, and pricing_source is 'ai' or missing
  if (
    (!item.pricing_source || item.pricing_source === 'ai') &&
    (!item.unitCost || item.unitCost === 0)
  ) {
    try {
      // Get user region if available (for region-specific pricing)
      let region: string | null = null
      if (userId) {
        try {
          const profile = await getProfileByUserId(userId)
          region = (profile as any)?.region || null
        } catch (profileError) {
          console.warn('Failed to get user profile for region:', profileError)
        }
      }

      // Use semantic search to find matching task
      const matchResult = await matchTask({
        description: item.description,
        cost_code: item.cost_code || null,
        region: region || null
      })

      // If we found a high-confidence match (>= 70%), use library pricing
      if (matchResult && matchResult.confidence >= 70) {
        const task = matchResult.task
        const quantity = item.quantity ?? 1
        
        // Calculate costs from task library data
        let laborCost: number | null = null
        let materialCost: number | null = null
        let directCost: number | null = null

        // Calculate labor cost from labor hours if available
        if (task.labor_hours_per_unit !== null && task.labor_hours_per_unit !== undefined) {
          // Assume $50/hour labor rate (this could be configurable per user)
          const laborRatePerHour = 50
          laborCost = task.labor_hours_per_unit * laborRatePerHour * quantity
        }

        // Calculate material cost
        if (task.material_cost_per_unit !== null && task.material_cost_per_unit !== undefined) {
          materialCost = task.material_cost_per_unit * quantity
        }

        // Use unit_cost_mid as direct cost if available
        if (task.unit_cost_mid !== null && task.unit_cost_mid !== undefined) {
          const unitCostTotal = task.unit_cost_mid * quantity
          if (!laborCost && !materialCost) {
            directCost = unitCostTotal
          } else {
            directCost = (laborCost || 0) + (materialCost || 0)
          }
        } else if (laborCost || materialCost) {
          directCost = (laborCost || 0) + (materialCost || 0)
        }

        return {
          ...defaultItem,
          direct_cost: directCost || 0,
          labor_cost: laborCost || 0,
          material_cost: materialCost || 0,
          unit: item.unit || task.unit || defaultItem.unit,
          pricing_source: 'task_library',
          confidence: matchResult.confidence,
          cost_code: item.cost_code || task.cost_code || defaultItem.cost_code
        }
      }
    } catch (error) {
      console.error(`Error matching pricing for "${item.description}":`, error)
      // Fall through to AI-generated pricing on error
    }
  }

  // 4. No pricing found - return as AI-generated (THIRD PRIORITY / FALLBACK)
  return {
    ...defaultItem,
    pricing_source: item.pricing_source || 'ai',
    direct_cost: item.direct_cost ?? 0
  }
}

/**
 * Apply pricing to multiple line items
 */
export async function applyPricingToItems(
  items: Array<Partial<LineItem> & {
    description: string
    unitCost?: number
    pricing_source?: 'task_library' | 'user_library' | 'manual' | 'ai' | null
  }>,
  userId?: string
): Promise<LineItem[]> {
  return Promise.all(items.map(item => applyPricing(item, userId)))
}

