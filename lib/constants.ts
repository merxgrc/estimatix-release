/**
 * Industry-standard cost codes for construction estimates
 * Based on standard construction cost coding systems
 */

export interface CostCode {
  code: string
  label: string
  category: string
}

export const COST_CODES: CostCode[] = [
  // 100 - PRE-CONSTRUCTION
  { code: '111', label: 'Plans & Design Costs', category: '100 - PRE-CONSTRUCTION' },
  { code: '112', label: 'Engineering Fees', category: '100 - PRE-CONSTRUCTION' },
  { code: '116', label: 'Building Permits/Fees', category: '100 - PRE-CONSTRUCTION' },
  { code: '117', label: 'Arborist Fee', category: '100 - PRE-CONSTRUCTION' },
  { code: '125', label: 'Temporary Toilet Facilities', category: '100 - PRE-CONSTRUCTION' },
  { code: '126', label: 'Equipment Rental', category: '100 - PRE-CONSTRUCTION' },
  { code: '127', label: 'Material Protection', category: '100 - PRE-CONSTRUCTION' },
  { code: '129', label: 'Job Supervision', category: '100 - PRE-CONSTRUCTION' },
  { code: '131', label: 'Trash Removal / Lot Clean-up', category: '100 - PRE-CONSTRUCTION' },
  { code: '132', label: 'Job Superintendent', category: '100 - PRE-CONSTRUCTION' },
  { code: '134', label: 'Liability Insurance Impact', category: '100 - PRE-CONSTRUCTION' },
  { code: '135', label: 'Warranty', category: '100 - PRE-CONSTRUCTION' },
  { code: '138', label: 'In- house Carpentry/ Labor', category: '100 - PRE-CONSTRUCTION' },
  { code: '141', label: 'Temporary Fencing', category: '100 - PRE-CONSTRUCTION' },

  // 200 - EXCAVATION & FOUNDATION
  { code: '201', label: 'Site Clearing / Demo', category: '200 - EXCAVATION & FOUNDATION' },
  { code: '203', label: 'Erosion Control', category: '200 - EXCAVATION & FOUNDATION' },
  { code: '204', label: 'Excavating & Grading', category: '200 - EXCAVATION & FOUNDATION' },
  { code: '209', label: 'Lead-Asbestos Abatement', category: '200 - EXCAVATION & FOUNDATION' },
  { code: '210', label: 'Soil Treatment / Pest Control', category: '200 - EXCAVATION & FOUNDATION' },
  { code: '212', label: 'Concrete Foundation', category: '200 - EXCAVATION & FOUNDATION' },
  { code: '215', label: 'Foundation Waterproofing', category: '200 - EXCAVATION & FOUNDATION' },
  { code: '219', label: 'Rock Walls', category: '200 - EXCAVATION & FOUNDATION' },

  // 300 - ROUGH CARPENTRY
  { code: '301', label: 'Structural Steel', category: '300 - ROUGH CARPENTRY' },
  { code: '305', label: 'Rough Carpentry', category: '300 - ROUGH CARPENTRY' },
  { code: '307', label: 'Rough Lumber', category: '300 - ROUGH CARPENTRY' },
  { code: '308', label: 'Special Registers', category: '300 - ROUGH CARPENTRY' },
  { code: '310', label: 'Truss / Joist', category: '300 - ROUGH CARPENTRY' },

  // 400 - MEP ROUGH-INS
  { code: '402', label: 'HVAC', category: '400 - MEP ROUGH-INS' },
  { code: '403', label: 'Sheet Metal', category: '400 - MEP ROUGH-INS' },
  { code: '404', label: 'Plumbing', category: '400 - MEP ROUGH-INS' },
  { code: '404B', label: 'Hot Mop', category: '400 - MEP ROUGH-INS' },
  { code: '405', label: 'Electrical', category: '400 - MEP ROUGH-INS' },
  { code: '406', label: 'Prefab Fireplaces', category: '400 - MEP ROUGH-INS' },
  { code: '407', label: 'Low Voltage', category: '400 - MEP ROUGH-INS' },
  { code: '416', label: 'Automatic Shades', category: '400 - MEP ROUGH-INS' },
  { code: '418', label: 'Fire Sprinkler Systems', category: '400 - MEP ROUGH-INS' },
  { code: '421', label: 'Septic System', category: '400 - MEP ROUGH-INS' },

  // 500 - EXTERIOR VENEERS/SPEC TIES
  { code: '500', label: 'Masonry', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '503', label: 'Precast', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '504', label: 'Roofing', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '505', label: 'Cornices & Fascia', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '510', label: 'Garage Doors', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '511', label: 'Skylights / Roof Windows', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '512', label: 'Solar', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '513', label: 'Wood Siding & Trim', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '516', label: 'Stucco', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '518', label: 'Shutters', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '519', label: 'Wrought Iron', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '520', label: 'Windows', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '520.001', label: 'Window Install', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '521', label: 'Entry Door', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '522', label: 'Exterior Doors', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '550', label: 'Residential Elevator', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '552', label: 'Wheelchair Lifts', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '556', label: 'Wood Patios/Decks', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '557', label: 'Wine Room', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '560', label: 'Outdoor BBQ', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '561', label: 'Gazebos / Trellis', category: '500 - EXTERIOR VENEERS/SPEC TIES' },
  { code: '563', label: 'Deck / Water Proof Coatings', category: '500 - EXTERIOR VENEERS/SPEC TIES' },

  // 600 - INSULATION/DRYWALL
  { code: '600', label: 'Insulation', category: '600 - INSULATION/DRYWALL' },
  { code: '602', label: 'Drywall', category: '600 - INSULATION/DRYWALL' },

  // 700 - INTERIOR FINISHES
  { code: '706', label: 'Finish Carpentry', category: '700 - INTERIOR FINISHES' },
  { code: '706.2', label: 'Master Closet', category: '700 - INTERIOR FINISHES' },
  { code: '707', label: 'Finish Lumber', category: '700 - INTERIOR FINISHES' },
  { code: '710', label: 'Doors', category: '700 - INTERIOR FINISHES' },
  { code: '715', label: 'Fireplace Mantle / Trim', category: '700 - INTERIOR FINISHES' },
  { code: '716', label: 'Cabinetry Contract', category: '700 - INTERIOR FINISHES' },
  { code: '719', label: 'Custom Hood', category: '700 - INTERIOR FINISHES' },
  { code: '721', label: 'Solid Surface Countertops', category: '700 - INTERIOR FINISHES' },
  { code: '723', label: 'Paint', category: '700 - INTERIOR FINISHES' },
  { code: '726', label: 'Faux Finishes', category: '700 - INTERIOR FINISHES' },
  { code: '728', label: 'Tile', category: '700 - INTERIOR FINISHES' },
  { code: '733', label: 'Vinyl Floor', category: '700 - INTERIOR FINISHES' },
  { code: '734', label: 'Wood Floor', category: '700 - INTERIOR FINISHES' },
  { code: '737', label: 'Carpet', category: '700 - INTERIOR FINISHES' },
  { code: '738', label: 'Shower Encl/Mirrors/Misc Glass', category: '700 - INTERIOR FINISHES' },
  { code: '739', label: 'Plumbing Fixtures / Bath Acces', category: '700 - INTERIOR FINISHES' },
  { code: '740', label: 'Lighting Fixtures', category: '700 - INTERIOR FINISHES' },
  { code: '741', label: 'Appliances', category: '700 - INTERIOR FINISHES' },
  { code: '742', label: 'Appliance Installation', category: '700 - INTERIOR FINISHES' },
  { code: '743', label: 'Steel / Metal Stairs', category: '700 - INTERIOR FINISHES' },
  { code: '745', label: 'Wood Stairs & Rails', category: '700 - INTERIOR FINISHES' },

  // 800 - COMPLETION & FINAL IMPROVEMENT
  { code: '800', label: 'Concrete Flatwork', category: '800 - COMPLETION & FINAL IMPROVEMENT' },
  { code: '803', label: 'Special Concrete Finishes', category: '800 - COMPLETION & FINAL IMPROVEMENT' },
  { code: '804', label: 'Fencing', category: '800 - COMPLETION & FINAL IMPROVEMENT' },
  { code: '805', label: 'Landscape', category: '800 - COMPLETION & FINAL IMPROVEMENT' },
  { code: '808', label: 'Landscape Lighting', category: '800 - COMPLETION & FINAL IMPROVEMENT' },
  { code: '809', label: 'Pool / Spa Construction', category: '800 - COMPLETION & FINAL IMPROVEMENT' },
  { code: '810', label: 'Finish Hardware', category: '800 - COMPLETION & FINAL IMPROVEMENT' },
  { code: '813', label: 'Decorating', category: '800 - COMPLETION & FINAL IMPROVEMENT' },
  { code: '816', label: 'Asphalt Paving', category: '800 - COMPLETION & FINAL IMPROVEMENT' },
  { code: '817', label: 'Final Cleaning', category: '800 - COMPLETION & FINAL IMPROVEMENT' },

  // Legacy/Other
  { code: '999', label: 'Other', category: '999 - OTHER' }
]

/**
 * Get a cost code by code string
 */
export function getCostCode(code: string): CostCode | undefined {
  return COST_CODES.find(cc => cc.code === code)
}

/**
 * Get all cost codes for a specific category
 */
export function getCostCodesByCategory(category: string): CostCode[] {
  return COST_CODES.filter(cc => cc.category === category)
}

/**
 * Get all unique categories
 */
export function getCostCodeCategories(): string[] {
  return Array.from(new Set(COST_CODES.map(cc => cc.category))).sort()
}

/**
 * Format cost code for display: "Code - Label"
 */
export function formatCostCode(code: string): string {
  const costCode = getCostCode(code)
  if (!costCode) return code
  return `${costCode.code} - ${costCode.label}`
}

/**
 * Legacy format for backward compatibility: returns array with { label, code }
 * where label is in format "Code - Label"
 */
export const COST_CATEGORIES = COST_CODES.map(cc => ({
  label: `${cc.code} - ${cc.label}`,
  code: cc.code
}))

