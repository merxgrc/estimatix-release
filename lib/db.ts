import { createServerClient, createServiceRoleClient } from './supabase/server'
import type { 
  Project, 
  ProjectInsert, 
  ProjectUpdate,
  ProjectWithUploadsAndEstimates
} from '@/types/db'

// Server-side database operations (for API routes and server components)
export const serverDb = {
  // Projects
  async getProjects(): Promise<Project[]> {
    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async getProject(id: string): Promise<Project | null> {
    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }
    return data
  },

  async createProject(project: ProjectInsert): Promise<Project> {
    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('projects')
      .insert(project)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async updateProject(id: string, updates: ProjectUpdate): Promise<Project> {
    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async deleteProject(id: string): Promise<void> {
    const supabase = await createServerClient()
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  },

  // Admin operations (using service role)
  async getProjectWithUploadsAndEstimates(id: string): Promise<ProjectWithUploadsAndEstimates | null> {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        uploads (*),
        estimates (*)
      `)
      .eq('id', id)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }
    return data
  }
}
