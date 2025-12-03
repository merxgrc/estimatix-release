/**
 * Allowance Rules Configuration
 * 
 * Defines which cost codes should display "Allowance: $X" in generated spec sheets.
 * Based on the example spec sheet patterns where certain sections show allowances
 * while others (like Demo, Rough Carpentry, Drywall, Paint) do not.
 */

export type CostCodeId = string; // e.g. "116", "201", "520", etc.

/**
 * Set of cost codes that should display allowances in spec sheets.
 * Based on the example spec sheet patterns:
 * - 116 Building Permits/Fees
 * - 406 Prefab Fireplaces
 * - 407 Low Voltage
 * - 500 Masonry
 * - 520 Windows
 * - 521 Entry Door
 * - 707/710 Finish Lumber / Door & Trim
 * - 716 Cabinetry Contract
 * - 721 Solid Surface Countertops
 * - 728 Tile
 * - 734 Wood Flooring
 * - 738 Shower Enclosures / Mirrors / Misc Glass
 * - 739 Plumbing Fixtures / Bath Accessories
 * - 741 Appliances
 * - 745 Wood Stairs & Rails
 * - 810 Finish Hardware
 */
export const ALLOWANCE_COST_CODES = new Set<CostCodeId>([
  "116",  // Building Permits/Fees
  "406",  // Prefab Fireplaces
  "407",  // Low Voltage
  "500",  // Masonry
  "520",  // Windows
  "521",  // Entry Door
  "707",  // Finish Lumber
  "710",  // Door & Trim
  "716",  // Cabinetry Contract
  "721",  // Solid Surface Countertops
  "728",  // Tile
  "734",  // Wood Flooring
  "738",  // Shower Enclosures / Mirrors / Misc Glass
  "739",  // Plumbing Fixtures / Bath Accessories
  "741",  // Appliances
  "745",  // Wood Stairs & Rails
  "810",  // Finish Hardware
]);

/**
 * Check if a cost code should display an allowance in spec sheets.
 * 
 * @param costCode - The cost code to check (e.g. "520", "201")
 * @returns true if this cost code should show an allowance, false otherwise
 */
export function isAllowanceCostCode(costCode: string | undefined | null): boolean {
  if (!costCode) return false;
  return ALLOWANCE_COST_CODES.has(costCode);
}

/**
 * Map category names to cost codes.
 * Used when cost code is not explicitly provided but category is known.
 * 
 * @param category - Category name (e.g. "Windows", "Tile", "Cabinetry")
 * @returns The corresponding cost code or undefined if not found
 */
export function costCodeFromCategory(category: string): string | undefined {
  const categoryMap: Record<string, string> = {
    // Windows
    "Windows": "520",
    "Window": "520",
    
    // Doors
    "Doors": "521",
    "Door": "521",
    "Entry Door": "521",
    
    // Cabinetry
    "Cabinets": "716",
    "Cabinetry": "716",
    "Cabinet": "716",
    
    // Tile
    "Tile": "728",
    
    // Flooring
    "Flooring": "734",
    "Wood Flooring": "734",
    
    // Plumbing
    "Plumbing": "739",
    "Plumbing Fixtures": "739",
    
    // Appliances
    "Appliances": "741",
    "Appliance": "741",
    
    // Countertops
    "Countertops": "721",
    "Countertop": "721",
    "Solid Surface Countertops": "721",
    
    // Building Permits
    "Building Permits": "116",
    "Permits": "116",
    "Fees": "116",
    
    // Masonry
    "Masonry": "500",
    
    // Fireplaces
    "Fireplaces": "406",
    "Fireplace": "406",
    
    // Low Voltage
    "Low Voltage": "407",
    
    // Finish Lumber / Trim
    "Finish Lumber": "707",
    "Door & Trim": "710",
    "Trim": "710",
    
    // Shower Enclosures
    "Shower Enclosures": "738",
    "Mirrors": "738",
    "Misc Glass": "738",
    
    // Stairs & Rails
    "Wood Stairs": "745",
    "Stairs & Rails": "745",
    
    // Finish Hardware
    "Finish Hardware": "810",
    "Hardware": "810",
  };
  
  return categoryMap[category] || undefined;
}

/**
 * Get the cost code for an item, checking multiple sources.
 * 
 * @param item - Item object that may have cost_code or category
 * @returns The cost code if found, undefined otherwise
 */
export function getCostCodeForItem(item: any): string | undefined {
  // First check if cost_code is explicitly provided
  if (item?.cost_code) {
    return item.cost_code;
  }
  
  // Fall back to category mapping
  if (item?.category) {
    return costCodeFromCategory(item.category);
  }
  
  return undefined;
}


