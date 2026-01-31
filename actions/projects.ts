'use server'

import { createServerClient, requireAuth } from '@/lib/supabase/server'
import { COST_CATEGORIES } from '@/lib/constants'
import type { Project } from '@/types/db'

/**
 * Close a job and capture actual costs
 * 
 * @param projectId - The project to close
 * @param actualsMap - Map of cost_code -> actual total cost for that trade
 * @returns Success/error result
 */
export async function closeJob(
  projectId: string,
  actualsMap: Record<string, number> // cost_code -> actual total cost
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id, status')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if (project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // Get all line items for this project
    const { data: lineItems, error: itemsError } = await supabase
      .from('estimate_line_items')
      .select('id, cost_code, direct_cost, quantity, task_library_id, description, unit')
      .eq('project_id', projectId)
      .eq('is_active', true)

    if (itemsError) {
      console.error('Error fetching line items:', itemsError)
      return { success: false, error: 'Failed to fetch line items' }
    }

    if (!lineItems || lineItems.length === 0) {
      return { success: false, error: 'No line items found for this project' }
    }

    // Group line items by cost_code
    const itemsByCostCode: Record<string, typeof lineItems> = {}
    for (const item of lineItems) {
      const code = item.cost_code || '999' // Use '999' for unclassified
      if (!itemsByCostCode[code]) {
        itemsByCostCode[code] = []
      }
      itemsByCostCode[code].push(item)
    }

    // Calculate estimated totals per cost_code
    const estimatedTotals: Record<string, number> = {}
    for (const [code, items] of Object.entries(itemsByCostCode)) {
      estimatedTotals[code] = items.reduce((sum, item) => {
        return sum + (Number(item.direct_cost) || 0)
      }, 0)
    }

    // Process each cost_code with actuals
    const costLibraryInserts: Array<{
      user_id: string
      task_library_id: string | null
      unit_cost: number
      is_actual: boolean
      source: 'actual'
      cost_code: string | null
      description: string | null
    }> = []

    for (const [costCode, actualTotal] of Object.entries(actualsMap)) {
      const items = itemsByCostCode[costCode] || []
      if (items.length === 0) continue

      const estimatedTotal = estimatedTotals[costCode] || 0
      if (estimatedTotal === 0) continue

      // Calculate variance factor (e.g., if actual is 10% more, factor = 1.1)
      const varianceFactor = actualTotal / estimatedTotal

      // Distribute variance proportionally to each line item
      for (const item of items) {
        const estimatedItemCost = Number(item.direct_cost) || 0
        const quantity = Number(item.quantity) || 1
        
        // Calculate new unit cost with variance applied
        const adjustedItemTotal = estimatedItemCost * varianceFactor
        const adjustedUnitCost = adjustedItemTotal / quantity

        // Only save if we have a task_library_id (for learning)
        if (item.task_library_id) {
          costLibraryInserts.push({
            user_id: user.id,
            task_library_id: item.task_library_id,
            unit_cost: adjustedUnitCost,
            is_actual: true,
            source: 'actual',
            cost_code: item.cost_code,
            description: item.description || null
          })
        } else if (item.cost_code) {
          // Save with cost_code even if no task_library_id (for future matching)
          costLibraryInserts.push({
            user_id: user.id,
            task_library_id: null,
            unit_cost: adjustedUnitCost,
            is_actual: true,
            source: 'actual',
            cost_code: item.cost_code,
            description: item.description || null
          })
        }
      }
    }

    // Insert all actual costs into user_cost_library
    if (costLibraryInserts.length > 0) {
      const { error: insertError } = await supabase
        .from('user_cost_library')
        .insert(costLibraryInserts)

      if (insertError) {
        console.error('Error inserting actual costs:', insertError)
        return { success: false, error: 'Failed to save actual costs' }
      }
    }

    // Update project status to 'completed'
    const { error: updateError } = await supabase
      .from('projects')
      .update({ status: 'completed' })
      .eq('id', projectId)

    if (updateError) {
      console.error('Error updating project status:', updateError)
      return { success: false, error: 'Failed to update project status' }
    }

    return { success: true }
  } catch (error) {
    console.error('Error closing job:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get project with line items grouped by cost code for closing
 */
export async function getProjectForClosing(
  projectId: string
): Promise<{
  success: boolean
  data?: {
    project: Project
    trades: Array<{
      cost_code: string
      trade_name: string
      estimated_total: number
      item_count: number
      items: Array<{
        id: string
        description: string
        quantity: number
        unit: string
        direct_cost: number
      }>
    }>
  }
  error?: string
}> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Get project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    if (project.user_id !== user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    // Get line items
    const { data: lineItems, error: itemsError } = await supabase
      .from('estimate_line_items')
      .select('id, cost_code, description, quantity, unit, direct_cost')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('cost_code', { ascending: true })

    if (itemsError) {
      return { success: false, error: 'Failed to fetch line items' }
    }

    // Group by cost_code
    const tradesMap: Record<string, {
      cost_code: string
      items: Array<{
        id: string
        description: string
        quantity: number
        unit: string
        direct_cost: number
      }>
    }> = {}

    for (const item of lineItems || []) {
      const code = item.cost_code || '999'
      const tradeName = getTradeNameFromCostCode(code)

      if (!tradesMap[code]) {
        tradesMap[code] = {
          cost_code: code,
          items: []
        }
      }

      tradesMap[code].items.push({
        id: item.id,
        description: item.description || '',
        quantity: Number(item.quantity) || 1,
        unit: item.unit || 'EA',
        direct_cost: Number(item.direct_cost) || 0
      })
    }

    // Convert to array and calculate totals
    const trades = Object.values(tradesMap).map(trade => {
      const estimated_total = trade.items.reduce(
        (sum, item) => sum + item.direct_cost,
        0
      )

      return {
        cost_code: trade.cost_code,
        trade_name: getTradeNameFromCostCode(trade.cost_code),
        estimated_total,
        item_count: trade.items.length,
        items: trade.items
      }
    })

    // Sort by estimated_total descending
    trades.sort((a, b) => b.estimated_total - a.estimated_total)

    return {
      success: true,
      data: {
        project: project as Project,
        trades
      }
    }
  } catch (error) {
    console.error('Error getting project for closing:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Helper: Get trade name from cost code
 */
function getTradeNameFromCostCode(costCode: string): string {
  // Look up in COST_CATEGORIES
  const costCodeEntry = COST_CATEGORIES.find(cc => cc.code === costCode)
  if (costCodeEntry) {
    return costCodeEntry.label
  }

  // Fallback for common codes
  if (costCode === '999') {
    return 'Other/Unclassified'
  }

  return `Trade ${costCode}`
}




