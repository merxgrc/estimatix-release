/**
 * Unified type definitions for estimate data structures
 * This is the single source of truth for EstimateData and LineItem types
 */

export interface LineItem {
  id?: string
  room_name: string
  description: string
  category: string
  cost_code: string
  quantity: number
  unit: string
  labor_cost: number
  material_cost?: number
  overhead_cost?: number
  direct_cost?: number
  margin_percent: number
  client_price: number
  pricing_source?: 'task_library' | 'user_library' | 'manual' | null
  confidence?: number | null
  notes?: string
  // Optional fields for dimensions (legacy support)
  dimensions?: {
    unit: 'in' | 'ft' | 'cm' | 'm'
    width: number
    height: number
    depth?: number
  } | null
}

export interface EstimateData {
  items: LineItem[]
  assumptions?: string[]
  missing_info?: string[]
}

