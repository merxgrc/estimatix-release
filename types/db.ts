export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

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
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          company_name?: string | null
          phone?: string | null
          role?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          company_name?: string | null
          phone?: string | null
          role?: string | null
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
          scope: string | null
          description: string | null
          quantity: number | null
          unit: string | null
          unit_cost: number | null
          total: number | null
          cost_code: string | null
          category: string | null
          labor_cost: number | null
          material_cost: number | null
          overhead_cost: number | null
          direct_cost: number | null
          margin_percent: number | null
          client_price: number | null
          selection_id: string | null
          task_library_id: string | null
          pricing_source: string | null
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
          scope?: string | null
          description?: string | null
          quantity?: number | null
          unit?: string | null
          unit_cost?: number | null
          total?: number | null
          cost_code?: string | null
          category?: string | null
          labor_cost?: number | null
          material_cost?: number | null
          overhead_cost?: number | null
          direct_cost?: number | null
          margin_percent?: number | null
          client_price?: number | null
          selection_id?: string | null
          task_library_id?: string | null
          pricing_source?: string | null
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
          scope?: string | null
          description?: string | null
          quantity?: number | null
          unit?: string | null
          unit_cost?: number | null
          total?: number | null
          cost_code?: string | null
          category?: string | null
          labor_cost?: number | null
          material_cost?: number | null
          overhead_cost?: number | null
          direct_cost?: number | null
          margin_percent?: number | null
          client_price?: number | null
          selection_id?: string | null
          task_library_id?: string | null
          pricing_source?: string | null
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
          project_id: string
          name: string
          type: string | null
          area_sqft: number | null
          source: string | null
          is_active: boolean | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          name: string
          type?: string | null
          area_sqft?: number | null
          source?: string | null
          is_active?: boolean | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          name?: string
          type?: string | null
          area_sqft?: number | null
          source?: string | null
          is_active?: boolean | null
          notes?: string | null
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
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          file_url: string
          kind: 'photo' | 'blueprint' | 'audio'
          original_filename?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          file_url?: string
          kind?: 'photo' | 'blueprint' | 'audio'
          original_filename?: string | null
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
      estimates: {
        Row: {
          id: string
          project_id: string
          json_data: Json
          ai_summary: string | null
          total: number | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          json_data: Json
          ai_summary?: string | null
          total?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          json_data?: Json
          ai_summary?: string | null
          total?: number | null
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

  quantity?: number
  unit?: string

  // Cost breakdown fields
  labor_cost?: number
  material_cost?: number
  overhead_cost?: number
  direct_cost?: number
  margin_percent?: number
  client_price?: number

  // Unit-level pricing (for reference)
  unit_labor_cost?: number
  unit_material_cost?: number
  unit_total_cost?: number
  total_direct_cost?: number

  // Pricing metadata
  pricing_source?: 'task_library' | 'user_library' | 'manual'
  confidence?: number
  matched_via?: 'semantic' | 'fuzzy' | 'cost_code_only'

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
