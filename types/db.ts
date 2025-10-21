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
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          client_name?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          client_name?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      uploads: {
        Row: {
          id: string
          project_id: string
          file_url: string
          kind: 'photo' | 'blueprint' | 'audio'
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          file_url: string
          kind: 'photo' | 'blueprint' | 'audio'
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          file_url?: string
          kind?: 'photo' | 'blueprint' | 'audio'
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
