/**
 * Unified type definitions for estimate data structures
 * This is the single source of truth for EstimateData and LineItem types
 */

export interface LineItem {
  id?: string
  room_name: string
  room_id?: string | null // FK to rooms table
  description: string
  category: string
  cost_code: string | null // Allow null - don't force 999
  quantity: number | null
  unit: string
  labor_cost: number | null  // null = unpriced
  material_cost?: number | null  // null = unpriced
  overhead_cost?: number | null  // null = unpriced
  direct_cost?: number | null  // null = unpriced (different from 0 which means "free")
  margin_percent: number
  client_price: number | null  // null = unpriced
  pricing_source?: 'task_library' | 'user_library' | 'manual' | 'ai' | 'history' | 'seed' | null
  price_source?: 'manual' | 'history' | 'seed' | 'ai' | 'task_library' | 'user_library' | null
  task_library_id?: string | null
  confidence?: number | null
  notes?: string
  is_allowance?: boolean | null // Flag to indicate if this is an allowance item
  // Quantity source tracking
  calc_source?: 'manual' | 'room_dimensions'  // How quantity was determined
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

/**
 * AIAction - Structured output from AI assistant actions
 * Used by Estimatix Copilot to define what actions the AI has taken
 */
export type AIAction =
  | {
      type: 'add_line_item'
      data: {
        description: string
        category?: string
        cost_code?: string
        room?: string
        quantity?: number
        unit?: string
        notes?: string
        estimate_id?: string
      }
    }
  | {
      type: 'update_line_item'
      data: {
        line_item_id: string
        description?: string
        category?: string
        cost_code?: string
        room?: string
        quantity?: number
        unit?: string
        labor_cost?: number
        material_cost?: number
        margin_percent?: number
        client_price?: number
        notes?: string
      }
    }
  | {
      type: 'delete_line_item'
      data: {
        line_item_id: string
      }
    }
  | {
      type: 'update_project'
      data: {
        project_id: string
        title?: string
        client_name?: string
        project_address?: string
        notes?: string
        project_type?: string
        year_built?: number
        home_size_sqft?: number
        bedrooms?: number
        bathrooms?: number
        job_start_target?: string
        job_deadline?: string
      }
    }
  | {
      type: 'create_selection'
      data: {
        estimate_id: string
        title: string
        description?: string
        allowance?: number
        subcontractor?: string
        cost_code?: string
        room?: string
      }
    }
  | {
      type: 'update_selection'
      data: {
        selection_id: string
        title?: string
        description?: string
        allowance?: number
        subcontractor?: string
      }
    }
  | {
      type: 'apply_pricing'
      data: {
        estimate_id: string
        line_item_ids?: string[] // If empty, applies to all unpriced items
      }
    }
  | {
      type: 'generate_spec_sheet'
      data: {
        estimate_id: string
      }
    }
  | {
      type: 'summary'
      data: {
        summary: string
        related_entities?: {
          line_items?: string[]
          selections?: string[]
        }
      }
    }
  | {
      type: 'error'
      data: {
        message: string
        code?: string
      }
    }



