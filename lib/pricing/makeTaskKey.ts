/**
 * makeTaskKey - Creates a deterministic normalized key for task lookup
 * 
 * Format: `${costCode||''}|${normalizedDescription}|${normalizedUnit||''}`
 * 
 * Example: costCode="4510", description="Install vapor barrier", unit="SF" 
 *       => "4510|install vapor barrier|sf"
 */

export interface TaskKeyParams {
  costCode?: string | null
  description: string
  unit?: string | null
}

/**
 * Normalize a string: lowercase, trim, collapse whitespace
 */
function normalize(str: string | null | undefined): string {
  if (!str) return ''
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ') // collapse multiple spaces to single space
}

/**
 * Create a deterministic task key from cost code, description, and unit
 * 
 * @param params - Object containing costCode, description, and unit
 * @returns Normalized task key string
 */
export function makeTaskKey(params: TaskKeyParams): string {
  const { costCode, description, unit } = params
  
  const normalizedCostCode = normalize(costCode) || ''
  const normalizedDescription = normalize(description)
  const normalizedUnit = normalize(unit) || ''
  
  // Validate that description is not empty
  if (!normalizedDescription) {
    throw new Error('makeTaskKey: description is required')
  }
  
  return `${normalizedCostCode}|${normalizedDescription}|${normalizedUnit}`
}

/**
 * Parse a task key back into its components
 * 
 * @param taskKey - The task key string to parse
 * @returns Object with costCode, description, and unit (or null if invalid)
 */
export function parseTaskKey(taskKey: string): TaskKeyParams | null {
  if (!taskKey || typeof taskKey !== 'string') return null
  
  const parts = taskKey.split('|')
  if (parts.length !== 3) return null
  
  return {
    costCode: parts[0] || null,
    description: parts[1],
    unit: parts[2] || null
  }
}
