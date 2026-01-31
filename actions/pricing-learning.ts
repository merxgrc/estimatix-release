'use server'

import { createServerClient, requireAuth } from '@/lib/supabase/server'

/**
 * Learn from an estimate and update the user's pricing library
 * This function analyzes line items from a saved estimate and updates the user_library
 * with learned prices, using weighted averages to smooth out outliers.
 * 
 * @param estimateId - The ID of the estimate to learn from
 * @returns Summary object with counts of items processed, learned, and updated
 */
export async function learnFromEstimate(estimateId: string) {
  try {
    // Ensure user is authenticated
    const user = await requireAuth()
    if (!user || !user.id) {
      throw new Error('Authentication required')
    }

    const supabase = await createServerClient()

    // Fetch all line items for the estimate
    const { data: lineItems, error: fetchError } = await supabase
      .from('estimate_line_items')
      .select('*')
      .eq('estimate_id', estimateId)

    if (fetchError) {
      throw new Error(`Failed to fetch line items: ${fetchError.message}`)
    }

    if (!lineItems || lineItems.length === 0) {
      return {
        success: true,
        totalItems: 0,
        learned: 0,
        updated: 0,
        skipped: 0,
        message: 'No line items found in this estimate'
      }
    }

    // Filter out invalid items:
    // 1. Items that are allowances (is_allowance = true)
    // 2. Items with $0 cost (direct_cost = 0 or null, and no unit_cost)
    // 3. Items without a cost_code (needed for matching)
    const validItems = lineItems.filter(item => {
      // Skip allowances
      if (item.is_allowance === true) {
        return false
      }

      // Skip items without cost_code
      if (!item.cost_code) {
        return false
      }

      // Calculate unit cost if needed
      const unitCost = item.unit_cost || (item.direct_cost && item.quantity 
        ? item.direct_cost / item.quantity 
        : null)

      // Skip items with $0 cost
      if (!unitCost || unitCost <= 0) {
        return false
      }

      return true
    })

    if (validItems.length === 0) {
      return {
        success: true,
        totalItems: lineItems.length,
        learned: 0,
        updated: 0,
        skipped: lineItems.length,
        message: 'No valid items to learn from (all were allowances, had no cost_code, or had $0 cost)'
      }
    }

    let learnedCount = 0
    let updatedCount = 0
    const errors: string[] = []

    // Process each valid item
    for (const item of validItems) {
      try {
        // Calculate unit cost (prefer unit_cost, fallback to direct_cost / quantity)
        const unitCost = item.unit_cost || (item.direct_cost && item.quantity 
          ? Number((item.direct_cost / item.quantity).toFixed(2))
          : 0)

        if (!unitCost || unitCost <= 0) {
          continue // Skip if still 0
        }

        // Check if entry already exists in user_library
        const { data: existingEntry, error: checkError } = await supabase
          .from('user_library')
          .select('*')
          .eq('user_id', user.id)
          .eq('cost_code', item.cost_code)
          .maybeSingle()

        if (checkError && checkError.code !== 'PGRST116') {
          // PGRST116 is "not found" which is fine, other errors are real problems
          errors.push(`Error checking entry for cost_code ${item.cost_code}: ${checkError.message}`)
          continue
        }

        if (existingEntry) {
          // Entry exists - update with weighted average
          const oldPrice = Number(existingEntry.unit_cost)
          const oldTimesUsed = existingEntry.times_used || 1
          const newPrice = unitCost

          // Weighted average formula: ((old_price * old_times_used) + new_price) / (old_times_used + 1)
          const weightedAverage = Number(
            ((oldPrice * oldTimesUsed + newPrice) / (oldTimesUsed + 1)).toFixed(2)
          )

          // Update the entry
          const { error: updateError } = await supabase
            .from('user_library')
            .update({
              unit_cost: weightedAverage,
              times_used: oldTimesUsed + 1,
              last_used_at: new Date().toISOString(),
              description: item.description || existingEntry.description, // Update description if provided
              unit: item.unit || existingEntry.unit // Update unit if provided
            })
            .eq('id', existingEntry.id)

          if (updateError) {
            errors.push(`Error updating entry for cost_code ${item.cost_code}: ${updateError.message}`)
          } else {
            updatedCount++
          }
        } else {
          // New entry - insert
          const { error: insertError } = await supabase
            .from('user_library')
            .insert({
              user_id: user.id,
              cost_code: item.cost_code,
              description: item.description || null,
              unit_cost: unitCost,
              unit: item.unit || null,
              times_used: 1,
              last_used_at: new Date().toISOString()
            })

          if (insertError) {
            errors.push(`Error creating entry for cost_code ${item.cost_code}: ${insertError.message}`)
          } else {
            learnedCount++
          }
        }
      } catch (itemError) {
        errors.push(`Error processing item ${item.id}: ${itemError instanceof Error ? itemError.message : 'Unknown error'}`)
      }
    }

    // Return summary
    return {
      success: errors.length === 0,
      totalItems: lineItems.length,
      learned: learnedCount,
      updated: updatedCount,
      skipped: lineItems.length - validItems.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Processed ${validItems.length} items: ${learnedCount} learned, ${updatedCount} updated, ${lineItems.length - validItems.length} skipped`
    }
  } catch (error) {
    console.error('Error in learnFromEstimate:', error)
    return {
      success: false,
      totalItems: 0,
      learned: 0,
      updated: 0,
      skipped: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      message: 'Failed to learn from estimate'
    }
  }
}

