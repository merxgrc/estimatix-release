/**
 * Utility functions for processing and merging estimate line items
 */

/**
 * EstimateItem interface matching frontend state structure
 * Used for post-processing and merging duplicate items before database insertion
 */
export interface EstimateItem {
  cost_code: string | null
  description: string
  quantity: number
  unit_cost?: number | null
  unit?: string | null
  category?: string | null
  notes?: string | null
  // Optional fields that may be present
  room_name?: string | null
  direct_cost?: number | null
  labor_cost?: number | null
  material_cost?: number | null
  margin_percent?: number | null
  client_price?: number | null
  pricing_source?: string | null
  confidence?: number | null
  overhead_cost?: number | null
}

/**
 * Merges estimate items that are truly identical (same cost_code, description, and unit_cost).
 * 
 * This function ensures deterministic duplicate detection and quantity aggregation
 * before saving items to the database. Items are ONLY merged if they have:
 * - Same cost_code
 * - Same description (normalized: trimmed and lowercased)
 * - Same unit_cost (within a small tolerance for floating point)
 * 
 * This prevents distinct tasks from being merged incorrectly. For example:
 * - "Demo Shower" (cost_code: 201, unit_cost: 500) and "Remove Vanity" (cost_code: 201, unit_cost: 150)
 *   will NOT merge, even though they share the same cost_code.
 * 
 * When items ARE merged:
 * - Quantities are summed
 * - Unit cost from the first occurrence is preserved
 * - Total cost is recalculated (quantity * unit_cost)
 * 
 * This post-processing step provides more reliable and consistent results than
 * relying solely on AI prompt instructions, which can be inconsistent.
 * 
 * @param items - Array of estimate items to merge
 * @returns Deduplicated array sorted by cost_code
 * 
 * @example
 * ```typescript
 * // These WILL merge (identical cost_code, description, and unit_cost):
 * const items1 = [
 *   { cost_code: '404', description: 'Install plumbing', quantity: 2, unit_cost: 500 },
 *   { cost_code: '404', description: 'Install plumbing', quantity: 3, unit_cost: 500 }
 * ]
 * const merged1 = mergeEstimateItems(items1)
 * // Returns: [{ cost_code: '404', description: 'Install plumbing', quantity: 5, unit_cost: 500 }]
 * 
 * // These will NOT merge (different descriptions, even with same cost_code):
 * const items2 = [
 *   { cost_code: '201', description: 'Demo shower', quantity: 1, unit_cost: 500 },
 *   { cost_code: '201', description: 'Remove vanity', quantity: 1, unit_cost: 150 }
 * ]
 * const merged2 = mergeEstimateItems(items2)
 * // Returns both items separately
 * ```
 */
export function mergeEstimateItems(items: EstimateItem[]): EstimateItem[] {
  // Helper function to normalize description for comparison
  function normalizeDescription(desc: string | null | undefined): string {
    if (!desc) return ''
    return desc.trim().toLowerCase()
  }
  
  // Helper function to normalize unit_cost for comparison (round to 2 decimals)
  function normalizeUnitCost(cost: number | null | undefined): number | null {
    if (cost === null || cost === undefined || isNaN(cost)) return null
    return Math.round(cost * 100) / 100 // Round to 2 decimal places
  }
  
  // Generate a unique key combining cost_code, normalized description, and normalized unit_cost
  function getMergeKey(item: EstimateItem): string {
    const costCode = item.cost_code || 'NULL'
    const normalizedDesc = normalizeDescription(item.description)
    const normalizedUnitCost = normalizeUnitCost(item.unit_cost)
    // Use unit_cost or "NO_COST" if null/undefined
    const costKey = normalizedUnitCost !== null ? normalizedUnitCost.toString() : 'NO_COST'
    return `${costCode}::${normalizedDesc}::${costKey}`
  }
  
  // Use a Map to track items by unique merge key
  const mergedMap = new Map<string, EstimateItem>()

  for (const item of items) {
    const mergeKey = getMergeKey(item)
    
    if (mergedMap.has(mergeKey)) {
      // Item with identical cost_code, description, and unit_cost already exists - merge it
      const existing = mergedMap.get(mergeKey)!
      
      // Sum quantities
      existing.quantity = (existing.quantity || 0) + (item.quantity || 0)
      
      // Keep unit_cost from first occurrence (as specified)
      // If first item doesn't have unit_cost but new one does, use the new one
      if (existing.unit_cost === null || existing.unit_cost === undefined) {
        existing.unit_cost = item.unit_cost
      }
      
      // Recalculate total_cost (direct_cost) based on merged quantity
      if (existing.unit_cost !== null && existing.unit_cost !== undefined) {
        existing.direct_cost = existing.quantity * existing.unit_cost
      } else if (item.unit_cost !== null && item.unit_cost !== undefined) {
        existing.direct_cost = existing.quantity * item.unit_cost
        existing.unit_cost = item.unit_cost
      }
      
      // Preserve the more detailed description (longer one, or existing if equal)
      if (item.description && item.description.length > (existing.description?.length || 0)) {
        existing.description = item.description
      }
      
      // Merge other fields (take first non-null value)
      if (!existing.category && item.category) {
        existing.category = item.category
      }
      if (!existing.unit && item.unit) {
        existing.unit = item.unit
      }
      if (!existing.notes && item.notes) {
        existing.notes = item.notes
      }
      if (!existing.room_name && item.room_name) {
        existing.room_name = item.room_name
      }
      
      // For numeric fields, sum them if both exist
      if (existing.labor_cost !== null && item.labor_cost !== null) {
        existing.labor_cost = (existing.labor_cost || 0) + (item.labor_cost || 0)
      } else if (!existing.labor_cost && item.labor_cost) {
        existing.labor_cost = item.labor_cost
      }
      
      if (existing.material_cost !== null && item.material_cost !== null) {
        existing.material_cost = (existing.material_cost || 0) + (item.material_cost || 0)
      } else if (!existing.material_cost && item.material_cost) {
        existing.material_cost = item.material_cost
      }
      
      // Keep the highest confidence score
      if (item.confidence !== null && item.confidence !== undefined) {
        if (!existing.confidence || item.confidence > existing.confidence) {
          existing.confidence = item.confidence
        }
      }
      
      // Merge overhead_cost
      if (item.overhead_cost !== null && item.overhead_cost !== undefined) {
        existing.overhead_cost = (existing.overhead_cost || 0) + item.overhead_cost
      }
    } else {
      // First occurrence of this exact combination (cost_code + description + unit_cost) - add it to the map
      const mergedItem: EstimateItem = {
        ...item,
        // Calculate direct_cost if unit_cost is available
        direct_cost: item.unit_cost !== null && item.unit_cost !== undefined
          ? (item.quantity || 1) * item.unit_cost
          : item.direct_cost || null
      }
      mergedMap.set(mergeKey, mergedItem)
    }
  }

  // Convert map to array and sort by cost_code
  const mergedArray = Array.from(mergedMap.values())
  
  // Sort by cost_code (nulls go to end)
  mergedArray.sort((a, b) => {
    if (a.cost_code === null && b.cost_code === null) return 0
    if (a.cost_code === null) return 1
    if (b.cost_code === null) return -1
    return a.cost_code.localeCompare(b.cost_code)
  })

  return mergedArray
}

