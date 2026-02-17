export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// =============================================================================
// Estimate Lifecycle Status (defined early for use in Database interface)
// =============================================================================

/**
 * Estimate lifecycle states.
 * 
 * Transitions (ONLY these are allowed):
 * - draft → bid_final
 * - bid_final → contract_signed
 * - contract_signed → completed
 * 
 * PRICING TRUTH is captured at:
 * - bid_final: User has finalized their bid pricing
 * - contract_signed: Contract generated and accepted
 * 
 * draft prices are NOT treated as truth (still being edited).
 * completed stage is for capturing actuals post-job.
 */
export type EstimateStatus = 'draft' | 'bid_final' | 'contract_signed' | 'completed'

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string
          user_id: string
          title: string
          client_name: string | null
          owner_name: string | null
          project_address: string | null
          notes: string | null
          project_type: string | null
          year_built: number | null
          home_size_sqft: number | null
          lot_size_sqft: number | null
          bedrooms: number | null
          bathrooms: number | null
          job_start_target: string | null
          job_deadline: string | null
          missing_data_count: number | null
          last_summary_update: string | null
          status: 'draft' | 'active' | 'completed' | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          client_name?: string | null
          owner_name?: string | null
          project_address?: string | null
          notes?: string | null
          project_type?: string | null
          year_built?: number | null
          home_size_sqft?: number | null
          lot_size_sqft?: number | null
          bedrooms?: number | null
          bathrooms?: number | null
          job_start_target?: string | null
          job_deadline?: string | null
          missing_data_count?: number | null
          last_summary_update?: string | null
          status?: 'draft' | 'active' | 'completed' | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          client_name?: string | null
          owner_name?: string | null
          project_address?: string | null
          notes?: string | null
          project_type?: string | null
          year_built?: number | null
          home_size_sqft?: number | null
          lot_size_sqft?: number | null
          bedrooms?: number | null
          bathrooms?: number | null
          job_start_target?: string | null
          job_deadline?: string | null
          missing_data_count?: number | null
          last_summary_update?: string | null
          status?: 'draft' | 'active' | 'completed' | null
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          full_name: string | null
          company_name: string | null
          phone: string | null
          role: string | null
          region_factor: number | null
          quality_tier: 'budget' | 'standard' | 'premium' | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          company_name?: string | null
          phone?: string | null
          role?: string | null
          region_factor?: number | null
          quality_tier?: 'budget' | 'standard' | 'premium' | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          company_name?: string | null
          phone?: string | null
          role?: string | null
          region_factor?: number | null
          quality_tier?: 'budget' | 'standard' | 'premium' | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      estimate_line_items: {
        Row: {
          id: string
          estimate_id: string
          project_id: string
          room_name: string | null
          room_id: string | null
          level: string | null
          scope: string | null
          scope_group: string | null
          description: string | null
          quantity: number | null
          unit: string | null
          unit_cost: number | null
          total: number | null
          total_cost: number | null
          cost_code: string | null
          category: string | null
          labor_cost: number | null
          material_cost: number | null
          overhead_cost: number | null
          direct_cost: number | null
          margin_percent: number | null
          client_price: number | null
          calc_source: 'manual' | 'room_dimensions'
          selection_id: string | null
          task_library_id: string | null
          pricing_source: string | null
          price_source: 'manual' | 'history' | 'seed' | 'ai' | 'task_library' | 'user_library' | null
          matched_via: string | null
          is_allowance: boolean | null
          is_active: boolean | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          estimate_id: string
          project_id: string
          room_name?: string | null
          room_id?: string | null
          level?: string | null
          scope?: string | null
          scope_group?: string | null
          description?: string | null
          quantity?: number | null
          unit?: string | null
          unit_cost?: number | null
          total?: number | null
          total_cost?: number | null
          cost_code?: string | null
          category?: string | null
          labor_cost?: number | null
          material_cost?: number | null
          overhead_cost?: number | null
          direct_cost?: number | null
          margin_percent?: number | null
          client_price?: number | null
          calc_source?: 'manual' | 'room_dimensions'
          selection_id?: string | null
          task_library_id?: string | null
          pricing_source?: string | null
          price_source?: 'manual' | 'history' | 'seed' | 'ai' | 'task_library' | 'user_library' | null
          matched_via?: string | null
          is_allowance?: boolean | null
          is_active?: boolean | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          estimate_id?: string
          project_id?: string
          room_name?: string | null
          room_id?: string | null
          level?: string | null
          scope?: string | null
          scope_group?: string | null
          description?: string | null
          quantity?: number | null
          unit?: string | null
          unit_cost?: number | null
          total?: number | null
          total_cost?: number | null
          cost_code?: string | null
          category?: string | null
          labor_cost?: number | null
          material_cost?: number | null
          overhead_cost?: number | null
          direct_cost?: number | null
          margin_percent?: number | null
          client_price?: number | null
          calc_source?: 'manual' | 'room_dimensions'
          selection_id?: string | null
          task_library_id?: string | null
          pricing_source?: string | null
          price_source?: 'manual' | 'history' | 'seed' | 'ai' | 'task_library' | 'user_library' | null
          matched_via?: string | null
          is_allowance?: boolean | null
          is_active?: boolean | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_line_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_selection_id_fkey"
            columns: ["selection_id"]
            isOneToOne: false
            referencedRelation: "selections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_task_library_id_fkey"
            columns: ["task_library_id"]
            isOneToOne: false
            referencedRelation: "task_library"
            referencedColumns: ["id"]
          }
        ]
      }
      rooms: {
        Row: {
          id: string
          estimate_id: string           // Original FK to estimates
          user_id: string
          project_id: string            // Added by migration 033, backfilled from estimates
          name: string
          level: string | null          // NULL = unknown level
          type: string | null
          status: string                // Original enum column
          area_sqft: number | null
          length_ft: number | null
          width_ft: number | null
          ceiling_height_ft: number | null
          floor_area_sqft: number | null
          wall_area_sqft: number | null
          ceiling_area_sqft: number | null
          is_in_scope: boolean
          source: string | null
          is_active: boolean | null
          notes: string | null
          sheet_label: string | null    // Blueprint sheet this room was detected on
          level_source: string | null   // 'parsed' | 'manual' | 'backfilled'
          sort_order: number
          removed_at: string | null
          removed_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          estimate_id?: string
          user_id?: string
          project_id: string
          name: string
          level?: string | null
          type?: string | null
          status?: string
          area_sqft?: number | null
          length_ft?: number | null
          width_ft?: number | null
          ceiling_height_ft?: number | null
          floor_area_sqft?: number | null
          wall_area_sqft?: number | null
          ceiling_area_sqft?: number | null
          is_in_scope?: boolean
          source?: string | null
          is_active?: boolean | null
          notes?: string | null
          sheet_label?: string | null
          level_source?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          name?: string
          level?: string | null
          type?: string | null
          area_sqft?: number | null
          length_ft?: number | null
          width_ft?: number | null
          ceiling_height_ft?: number | null
          floor_area_sqft?: number | null
          wall_area_sqft?: number | null
          ceiling_area_sqft?: number | null
          is_in_scope?: boolean
          source?: string | null
          is_active?: boolean | null
          notes?: string | null
          sheet_label?: string | null
          level_source?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      selections: {
        Row: {
          id: string
          estimate_id: string
          cost_code: string | null
          room: string | null
          category: string | null
          title: string
          description: string | null
          allowance: number | null
          suggested_allowance: number | null
          subcontractor: string | null
          source: 'manual' | 'voice' | 'ai_text' | 'file' | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          estimate_id: string
          cost_code?: string | null
          room?: string | null
          category?: string | null
          title: string
          description?: string | null
          allowance?: number | null
          suggested_allowance?: number | null
          subcontractor?: string | null
          source?: 'manual' | 'voice' | 'ai_text' | 'file' | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          estimate_id?: string
          cost_code?: string | null
          room?: string | null
          category?: string | null
          title?: string
          description?: string | null
          allowance?: number | null
          suggested_allowance?: number | null
          subcontractor?: string | null
          source?: 'manual' | 'voice' | 'ai_text' | 'file' | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "selections_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          }
        ]
      }
      uploads: {
        Row: {
          id: string
          project_id: string
          file_url: string
          kind: 'photo' | 'blueprint' | 'audio'
          original_filename: string | null
          file_type: 'pdf' | 'image' | 'audio' | 'video' | 'other' | null
          tag: 'blueprint' | 'spec' | 'photo' | 'other' | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          file_url: string
          kind: 'photo' | 'blueprint' | 'audio'
          original_filename?: string | null
          file_type?: 'pdf' | 'image' | 'audio' | 'video' | 'other' | null
          tag?: 'blueprint' | 'spec' | 'photo' | 'other' | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          file_url?: string
          kind?: 'photo' | 'blueprint' | 'audio'
          original_filename?: string | null
          file_type?: 'pdf' | 'image' | 'audio' | 'video' | 'other' | null
          tag?: 'blueprint' | 'spec' | 'photo' | 'other' | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      plan_parses: {
        Row: {
          id: string
          project_id: string
          estimate_id: string | null
          upload_id: string | null
          file_urls: Json // string[]
          status: 'uploaded' | 'processing' | 'parsed' | 'failed' | 'applied'
          parse_result_json: Json | null
          pages_of_interest: Json | null
          source_file_pages: number | null
          processing_time_ms: number | null
          error_message: string | null
          error_code: string | null
          created_at: string
          started_at: string | null
          parsed_at: string | null
          applied_at: string | null
          applied_rooms_count: number | null
          applied_line_items_count: number | null
          excluded_rooms_count: number | null
        }
        Insert: {
          id?: string
          project_id: string
          estimate_id?: string | null
          upload_id?: string | null
          file_urls?: Json
          status?: 'uploaded' | 'processing' | 'parsed' | 'failed' | 'applied'
          parse_result_json?: Json | null
          pages_of_interest?: Json | null
          source_file_pages?: number | null
          processing_time_ms?: number | null
          error_message?: string | null
          error_code?: string | null
          created_at?: string
          started_at?: string | null
          parsed_at?: string | null
          applied_at?: string | null
          applied_rooms_count?: number | null
          applied_line_items_count?: number | null
          excluded_rooms_count?: number | null
        }
        Update: {
          id?: string
          project_id?: string
          estimate_id?: string | null
          upload_id?: string | null
          file_urls?: Json
          status?: 'uploaded' | 'processing' | 'parsed' | 'failed' | 'applied'
          parse_result_json?: Json | null
          pages_of_interest?: Json | null
          source_file_pages?: number | null
          processing_time_ms?: number | null
          error_message?: string | null
          error_code?: string | null
          created_at?: string
          started_at?: string | null
          parsed_at?: string | null
          applied_at?: string | null
          applied_rooms_count?: number | null
          applied_line_items_count?: number | null
          excluded_rooms_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_parses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_parses_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_parses_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          }
        ]
      }
      estimates: {
        Row: {
          id: string
          project_id: string
          json_data: Json
          ai_summary: string | null
          total: number | null
          /**
           * Estimate lifecycle state.
           * PRICING TRUTH is captured at 'bid_final' and 'contract_signed' ONLY.
           * 'draft' prices are working values, not truth.
           */
          status: EstimateStatus
          status_changed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          json_data: Json
          ai_summary?: string | null
          total?: number | null
          status?: EstimateStatus
          status_changed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          json_data?: Json
          ai_summary?: string | null
          total?: number | null
          status?: EstimateStatus
          status_changed_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      chat_messages: {
        Row: {
          id: string
          project_id: string
          role: 'user' | 'assistant' | 'system'
          content: string
          related_action: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          role: 'user' | 'assistant' | 'system'
          content: string
          related_action?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          role?: 'user' | 'assistant' | 'system'
          content?: string
          related_action?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      user_cost_library: {
        Row: {
          id: string
          user_id: string
          task_library_id: string | null
          unit_cost: number
          is_actual: boolean | null
          source: 'estimate' | 'actual' | 'copilot' | 'manual'
          cost_code: string | null
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          task_library_id?: string | null
          unit_cost: number
          is_actual?: boolean | null
          source: 'estimate' | 'actual' | 'copilot' | 'manual'
          cost_code?: string | null
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          task_library_id?: string | null
          unit_cost?: number
          is_actual?: boolean | null
          source?: 'estimate' | 'actual' | 'copilot' | 'manual'
          cost_code?: string | null
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_cost_library_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_cost_library_task_library_id_fkey"
            columns: ["task_library_id"]
            isOneToOne: false
            referencedRelation: "task_library"
            referencedColumns: ["id"]
          }
        ]
      }
      user_margin_rules: {
        Row: {
          id: string
          user_id: string
          scope: string
          margin_percent: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          scope: string
          margin_percent: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          scope?: string
          margin_percent?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_margin_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience types for easier usage
export type Project = Database['public']['Tables']['projects']['Row']
export type ProjectInsert = Database['public']['Tables']['projects']['Insert']
export type ProjectUpdate = Database['public']['Tables']['projects']['Update']

export type Upload = Database['public']['Tables']['uploads']['Row']
export type UploadInsert = Database['public']['Tables']['uploads']['Insert']
export type UploadUpdate = Database['public']['Tables']['uploads']['Update']

export type PlanParse = Database['public']['Tables']['plan_parses']['Row']
export type PlanParseInsert = Database['public']['Tables']['plan_parses']['Insert']
export type PlanParseUpdate = Database['public']['Tables']['plan_parses']['Update']

/**
 * Plan parse lifecycle status
 * - uploaded:   File uploaded, not yet parsed
 * - processing: Parse job started, AI analyzing
 * - parsed:     Parse completed successfully, awaiting user review
 * - failed:     Parse failed with error
 * - applied:    User reviewed and applied results to estimate/rooms
 */
export type PlanParseStatus = PlanParse['status']

export type Estimate = Database['public']['Tables']['estimates']['Row']
export type EstimateInsert = Database['public']['Tables']['estimates']['Insert']
export type EstimateUpdate = Database['public']['Tables']['estimates']['Update']

export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

// Base types from Supabase Database schema (for database operations)
export type EstimateLineItemRow = Database['public']['Tables']['estimate_line_items']['Row']
export type EstimateLineItemInsert = Database['public']['Tables']['estimate_line_items']['Insert']
export type EstimateLineItemUpdate = Database['public']['Tables']['estimate_line_items']['Update']

export type Selection = Database['public']['Tables']['selections']['Row']
export type SelectionInsert = Database['public']['Tables']['selections']['Insert']
export type SelectionUpdate = Database['public']['Tables']['selections']['Update']

export type ChatMessage = Database['public']['Tables']['chat_messages']['Row']
export type ChatMessageInsert = Database['public']['Tables']['chat_messages']['Insert']
export type ChatMessageUpdate = Database['public']['Tables']['chat_messages']['Update']

export type Room = Database['public']['Tables']['rooms']['Row']
export type RoomInsert = Database['public']['Tables']['rooms']['Insert']
export type RoomUpdate = Database['public']['Tables']['rooms']['Update']

// Extended EstimateLineItem interface supporting new pricing model
export interface EstimateLineItem {
  id?: string
  estimate_id?: string

  description: string
  category?: string
  cost_code?: string
  room?: string // Legacy: kept for backward compatibility
  room_id?: string | null // New: FK to rooms table
  room_name?: string | null // Legacy: kept for backward compatibility
  level?: string | null // Building level (denormalized from rooms.level)
  scope_group?: string | null // Optional grouping: "Painting", "Framing", etc.

  quantity?: number
  unit?: string

  // Cost breakdown fields
  labor_cost?: number
  material_cost?: number
  overhead_cost?: number
  direct_cost?: number
  margin_percent?: number
  client_price?: number
  total_cost?: number // Auto-computed: (labor + material) * (1 + margin/100)

  // Unit-level pricing (for reference)
  unit_labor_cost?: number
  unit_material_cost?: number
  unit_total_cost?: number
  total_direct_cost?: number

  // Pricing metadata
  pricing_source?: 'task_library' | 'user_library' | 'manual'
  confidence?: number
  matched_via?: 'semantic' | 'fuzzy' | 'cost_code_only'

  // Quantity source tracking
  calc_source?: 'manual' | 'room_dimensions'

  // Selections + allowances
  selection_id?: string | null
  is_allowance?: boolean
  is_active?: boolean | null

  notes?: string
}

// Backward compatibility: export the database row type with the old name
export type EstimateLineItemBase = EstimateLineItemRow

// Upload kind type
export type UploadKind = 'photo' | 'blueprint' | 'audio'

// Extended types with relationships
export type ProjectWithUploads = Project & {
  uploads: Upload[]
}

export type ProjectWithEstimates = Project & {
  estimates: Estimate[]
}

export type ProjectWithUploadsAndEstimates = Project & {
  uploads: Upload[]
  estimates: Estimate[]
}

// =============================================================================
// Estimate Lifecycle Helpers
// =============================================================================

/**
 * Valid state transitions for estimates
 */
export const ESTIMATE_STATUS_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ['bid_final'],
  bid_final: ['contract_signed'],
  contract_signed: ['completed'],
  completed: [] // Terminal state
}

/**
 * States where pricing is considered "truth" for learning
 */
export const PRICING_TRUTH_STATES: EstimateStatus[] = ['bid_final', 'contract_signed']

/**
 * Check if a status transition is valid
 */
export function isValidEstimateTransition(from: EstimateStatus, to: EstimateStatus): boolean {
  return ESTIMATE_STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Check if pricing at this state should be treated as truth
 */
export function isPricingTruthState(status: EstimateStatus): boolean {
  return PRICING_TRUTH_STATES.includes(status)
}

// =============================================================================
// Pricing Feedback System Types (Milestone A)
// =============================================================================

/**
 * Source of pricing in the waterfall
 */
export type PricingSource = 'manual' | 'user_library' | 'task_library' | 'ai'

/**
 * User action on pricing
 * 
 * - 'entered': Manual entry with no suggestion (Phase 1 baseline)
 * - 'accepted': Used a suggestion as-is
 * - 'edited': Modified a suggestion
 * - 'rejected': Explicitly rejected a suggestion
 */
export type PricingUserAction = 'entered' | 'accepted' | 'edited' | 'rejected'

/**
 * Pricing event record - captures pricing feedback for analytics
 */
export interface PricingEvent {
  id: string
  created_at: string
  user_id: string
  project_id: string | null
  estimate_id: string | null
  line_item_id: string | null
  region: string | null
  unit: string | null
  quantity: number | null
  source: PricingSource
  matched_task_id: string | null
  match_confidence: number | null
  suggested_unit_cost: number | null
  final_unit_cost: number
  user_action: PricingUserAction
  meta: Record<string, unknown>
}

export interface PricingEventInsert {
  id?: string
  created_at?: string
  user_id: string
  project_id?: string | null
  estimate_id?: string | null
  line_item_id?: string | null
  region?: string | null
  unit?: string | null
  quantity?: number | null
  source: PricingSource
  matched_task_id?: string | null
  match_confidence?: number | null
  suggested_unit_cost?: number | null
  final_unit_cost: number
  user_action: PricingUserAction
  meta?: Record<string, unknown>
}

/**
 * User cost library entry - user-saved pricing by task key
 */
export interface UserCostLibraryEntry {
  id: string
  created_at: string
  updated_at: string
  user_id: string
  task_key: string | null
  region: string | null
  unit_cost: number
  unit: string | null
  usage_count: number
  last_used_at: string | null
  notes: string | null
  // Legacy fields for backward compatibility
  task_library_id: string | null
  is_actual: boolean | null
  source: string | null
  cost_code: string | null
  description: string | null
}

export interface UserCostLibraryInsert {
  id?: string
  created_at?: string
  updated_at?: string
  user_id: string
  task_key?: string | null
  region?: string | null
  unit_cost: number
  unit?: string | null
  usage_count?: number
  last_used_at?: string | null
  notes?: string | null
  task_library_id?: string | null
  is_actual?: boolean | null
  source?: string | null
  cost_code?: string | null
  description?: string | null
}

export interface UserCostLibraryUpdate {
  id?: string
  updated_at?: string
  task_key?: string | null
  region?: string | null
  unit_cost?: number
  unit?: string | null
  usage_count?: number
  last_used_at?: string | null
  notes?: string | null
}

/**
 * Structured pricing decision result from the pricing engine
 */
export interface PricingDecision {
  unitCost: number
  source: PricingSource
  matchedTaskId?: string | null
  matchConfidence?: number | null
  suggestedUnitCost?: number | null
  taskKey?: string | null
}

// =============================================================================
// Job Actuals Types (Phase 1.5)
// =============================================================================

/**
 * Project-level actuals record.
 * Stores actual costs after job completion.
 * 
 * IMPORTANT: Actuals are stored SEPARATELY from estimates (never overwrite).
 * This data will later feed:
 * - Estimation accuracy tracking
 * - Pricing intelligence
 * - Variance analysis
 */
export interface ProjectActuals {
  id: string
  project_id: string
  estimate_id: string | null
  total_actual_cost: number | null
  total_actual_labor_cost: number | null
  total_actual_material_cost: number | null
  actual_labor_hours: number | null
  variance_amount: number | null
  variance_percent: number | null
  notes: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

export interface ProjectActualsInsert {
  id?: string
  project_id: string
  estimate_id?: string | null
  total_actual_cost?: number | null
  total_actual_labor_cost?: number | null
  total_actual_material_cost?: number | null
  actual_labor_hours?: number | null
  variance_amount?: number | null
  variance_percent?: number | null
  notes?: string | null
  closed_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface ProjectActualsUpdate {
  total_actual_cost?: number | null
  total_actual_labor_cost?: number | null
  total_actual_material_cost?: number | null
  actual_labor_hours?: number | null
  variance_amount?: number | null
  variance_percent?: number | null
  notes?: string | null
  closed_at?: string | null
  updated_at?: string
}

/**
 * Line item-level actuals record.
 * Stores per-line-item actual costs for detailed tracking.
 */
export interface LineItemActuals {
  id: string
  project_actuals_id: string
  line_item_id: string
  actual_unit_cost: number | null
  actual_quantity: number | null
  actual_direct_cost: number | null
  actual_labor_cost: number | null
  actual_material_cost: number | null
  actual_labor_hours: number | null
  variance_amount: number | null
  variance_percent: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface LineItemActualsInsert {
  id?: string
  project_actuals_id: string
  line_item_id: string
  actual_unit_cost?: number | null
  actual_quantity?: number | null
  actual_direct_cost?: number | null
  actual_labor_cost?: number | null
  actual_material_cost?: number | null
  actual_labor_hours?: number | null
  variance_amount?: number | null
  variance_percent?: number | null
  notes?: string | null
  created_at?: string
  updated_at?: string
}

export interface LineItemActualsUpdate {
  actual_unit_cost?: number | null
  actual_quantity?: number | null
  actual_direct_cost?: number | null
  actual_labor_cost?: number | null
  actual_material_cost?: number | null
  actual_labor_hours?: number | null
  variance_amount?: number | null
  variance_percent?: number | null
  notes?: string | null
  updated_at?: string
}

// =============================================================================
// Plan Parsing Types (Phase 1)
// =============================================================================

/**
 * Page classification result from the 2-pass parsing pipeline.
 * Pass 1 classifies pages to identify relevant ones for deep parsing.
 */
export type PageClassificationType = 
  | 'cover'
  | 'index'
  | 'floor_plan'
  | 'room_schedule'
  | 'finish_schedule'
  | 'notes'
  | 'specs'
  | 'elevation'
  | 'section'
  | 'detail'
  | 'electrical'
  | 'plumbing'
  | 'mechanical'
  | 'site_plan'
  | 'irrelevant'
  | 'other'
  // Legacy aliases (for backward compatibility)
  | 'schedule'
  | 'spec'

export interface PageClassification {
  pageNumber: number
  classification: PageClassificationType
  hasRoomLabels: boolean
  confidence: number
}

/**
 * Room extracted from a blueprint/plan document.
 * Used in parse_result_json.rooms
 */
export interface ParsedRoom {
  id: string // Client-generated UUID for UI tracking
  name: string
  level: string // Building level: "Level 1", "Level 2", "Basement", etc.
  type?: string | null
  area_sqft?: number | null
  length_ft?: number | null
  width_ft?: number | null
  ceiling_height_ft?: number | null
  dimensions?: string | null
  notes?: string | null
  confidence?: number
  is_included: boolean // User can toggle during review
}

/**
 * Line item scaffold generated from blueprint parsing.
 * NO PRICING - all cost fields are null until user enters them.
 * Used in parse_result_json.lineItemScaffold
 */
export interface ParsedLineItem {
  id: string // Client-generated UUID for UI tracking
  description: string
  category: string
  cost_code?: string | null
  room_name: string
  quantity?: number | null
  unit?: string | null
  notes?: string | null
  // Phase 1: These are always null - no pricing suggestions
  direct_cost: null
  client_price: null
}

/**
 * Full parse result stored in plan_parses.parse_result_json
 */
export interface PlanParseResult {
  rooms: ParsedRoom[]
  lineItemScaffold: ParsedLineItem[]
  assumptions: string[]
  warnings: string[]
  metadata?: {
    model?: string
    totalPages?: number
    relevantPages?: number[]
    processingTimeMs?: number
  }
}

/**
 * Pages of interest stored in plan_parses.pages_of_interest
 */
export interface PagesOfInterest {
  classifications: PageClassification[]
  relevantPages: number[]
  totalPages: number
}

/**
 * Extended PlanParse with typed JSON fields
 */
export interface PlanParseWithTypedResult extends Omit<PlanParse, 'parse_result_json' | 'pages_of_interest'> {
  parse_result_json: PlanParseResult | null
  pages_of_interest: PagesOfInterest | null
}
