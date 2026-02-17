/**
 * Area-to-Line-Item Mapping for Room-Dimension-Based Quantity Calculation
 *
 * This module defines the mapping between line item characteristics
 * (cost_code, category, description, unit) and which room area field
 * should be used to auto-compute the line item's quantity.
 *
 * Used by:
 * - actions/rooms.ts → updateRoomDimensions() for recalculating on dim change
 * - actions/plans.ts → applyParsedResults() for initial quantity derivation
 * - components/estimate/EstimateTable.tsx → re-derive toggle
 *
 * Area fields on rooms table:
 *   floor_area_sqft   = length_ft * width_ft
 *   ceiling_area_sqft = length_ft * width_ft (same as floor for standard rooms)
 *   wall_area_sqft    = 2 * (length_ft + width_ft) * ceiling_height_ft
 */

// =============================================================================
// Types
// =============================================================================

export type RoomAreaField = 'floor_area_sqft' | 'wall_area_sqft' | 'ceiling_area_sqft'

export type CalcSource = 'manual' | 'room_dimensions'

/** Minimal line item shape needed for area resolution */
export interface AreaResolvableItem {
  cost_code: string | null
  unit: string | null
  description: string | null
  category: string | null
}

// =============================================================================
// Area-Based Unit Detection
// =============================================================================

/** Units considered "area-based" for auto-quantity derivation */
const AREA_UNITS = ['sqft', 'sf', 'sq ft', 'square feet']

/**
 * Check if a unit string represents a square-footage unit.
 */
export function isAreaUnit(unit: string | null | undefined): boolean {
  if (!unit) return false
  return AREA_UNITS.includes(unit.toLowerCase().trim())
}

// =============================================================================
// Cost Code → Area Field Mapping
// =============================================================================

/**
 * Well-known cost codes that map to specific area fields.
 * Key: cost code, Value: area field.
 */
const COST_CODE_AREA_MAP: Record<string, RoomAreaField> = {
  // Paint (wall area by default)
  '723': 'wall_area_sqft',
  // Flooring
  '733': 'floor_area_sqft',
  '734': 'floor_area_sqft',
  '737': 'floor_area_sqft',
  // Tile (floor by default, wall overridden by description)
  '728': 'floor_area_sqft',
}

/**
 * Category keyword → area field mapping (fallback when cost code is unrecognized).
 */
const CATEGORY_AREA_MAP: Array<{ keyword: string; areaField: RoomAreaField }> = [
  { keyword: 'paint', areaField: 'wall_area_sqft' },
  { keyword: 'floor', areaField: 'floor_area_sqft' },
  { keyword: 'tile', areaField: 'floor_area_sqft' },
  { keyword: 'carpet', areaField: 'floor_area_sqft' },
]

/**
 * Description keyword overrides — applied AFTER cost code/category mapping.
 * Allows "Paint Ceiling" to use ceiling_area even when cost code maps to walls.
 */
const DESCRIPTION_OVERRIDES: Array<{
  match: (desc: string) => boolean
  areaField: RoomAreaField
}> = [
  // Ceiling-specific items
  {
    match: (d) => d.includes('ceiling') && !d.includes('wall'),
    areaField: 'ceiling_area_sqft',
  },
  // Wall-specific tile/backsplash
  {
    match: (d) => d.includes('wall') || d.includes('backsplash'),
    areaField: 'wall_area_sqft',
  },
  // Drywall ceiling
  {
    match: (d) => (d.includes('drywall') || d.includes('sheetrock')) && d.includes('ceiling'),
    areaField: 'ceiling_area_sqft',
  },
  // Drywall walls
  {
    match: (d) => d.includes('drywall') || d.includes('sheetrock'),
    areaField: 'wall_area_sqft',
  },
]

// =============================================================================
// Public API
// =============================================================================

/**
 * Determine which room area field to use for a line item's quantity
 * based on its cost_code, unit, and description.
 *
 * Returns the area field name from the rooms table, or null if
 * we cannot determine a mapping (quantity stays unchanged).
 *
 * Resolution order:
 * 1. Check unit is area-based (SQFT/SF) — if not, return null
 * 2. Check cost_code against known mapping
 * 3. Check description for overrides (ceiling, wall, etc.)
 * 4. Check category keywords
 * 5. Fallback: floor_area_sqft for any remaining area-based items
 */
export function resolveAreaFieldForLineItem(
  item: AreaResolvableItem
): RoomAreaField | null {
  const code = item.cost_code || ''
  const unit = (item.unit || '').toUpperCase()
  const desc = (item.description || '').toLowerCase()
  const cat = (item.category || '').toLowerCase()

  // Only area-based units get auto-quantity
  if (!isAreaUnit(unit)) return null

  // Step 1: Check cost code mapping
  let baseField = COST_CODE_AREA_MAP[code] || null

  // Step 2: If no cost code match, check category keywords
  if (!baseField) {
    for (const mapping of CATEGORY_AREA_MAP) {
      if (cat.includes(mapping.keyword)) {
        baseField = mapping.areaField
        break
      }
    }
  }

  // Step 3: Apply description overrides
  for (const override of DESCRIPTION_OVERRIDES) {
    if (override.match(desc)) {
      return override.areaField
    }
  }

  // Step 4: Return base field or fallback
  return baseField || 'floor_area_sqft'
}

/**
 * Check if a line item should use room-dimension-based quantity.
 * Returns true if the item has an area-based unit AND can be mapped to an area field.
 */
export function isAreaBasedItem(item: AreaResolvableItem): boolean {
  return resolveAreaFieldForLineItem(item) !== null
}

/**
 * Get the computed area value from a room object for a given area field.
 */
export function getRoomAreaValue(
  room: {
    floor_area_sqft?: number | null
    wall_area_sqft?: number | null
    ceiling_area_sqft?: number | null
  },
  areaField: RoomAreaField
): number | null {
  const value = room[areaField]
  return value !== null && value !== undefined ? Number(value) : null
}

/**
 * Human-readable label for area fields.
 */
export function getAreaFieldLabel(field: RoomAreaField): string {
  switch (field) {
    case 'floor_area_sqft':
      return 'Floor Area'
    case 'wall_area_sqft':
      return 'Wall Area'
    case 'ceiling_area_sqft':
      return 'Ceiling Area'
  }
}
