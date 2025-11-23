import { supabase } from './supabase/client'
import type { 
  Project, 
  ProjectInsert, 
  ProjectUpdate,
  Upload,
  UploadInsert,
  UploadUpdate,
  Estimate,
  EstimateInsert,
  EstimateUpdate,
  ProjectWithUploads,
  ProjectWithEstimates,
  ProjectWithUploadsAndEstimates
} from '@/types/db'

// Client-side database operations (use in 'use client' components)
export const db = {
  // Projects
  async getProjects(): Promise<Project[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async getProject(id: string): Promise<Project | null> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') return null // No rows found
      throw error
    }
    return data
  },

  async createProject(project: ProjectInsert): Promise<Project> {
    const { data, error } = await supabase
      .from('projects')
      .insert(project)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async updateProject(id: string, updates: ProjectUpdate): Promise<Project> {
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
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  },

  // Projects with relationships
  async getProjectWithUploads(id: string): Promise<ProjectWithUploads | null> {
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        uploads (*)
      `)
      .eq('id', id)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }
    return data
  },

  async getProjectWithEstimates(id: string): Promise<ProjectWithEstimates | null> {
    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        estimates (*)
      `)
      .eq('id', id)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }
    return data
  },

  async getProjectWithUploadsAndEstimates(id: string): Promise<ProjectWithUploadsAndEstimates | null> {
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
  },

  // Uploads
  async getUploads(projectId: string): Promise<Upload[]> {
    const { data, error } = await supabase
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async createUpload(upload: UploadInsert): Promise<Upload> {
    const { data, error } = await supabase
      .from('uploads')
      .insert(upload)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async deleteUpload(id: string): Promise<void> {
    const { error } = await supabase
      .from('uploads')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  },

  // Estimates
  async getEstimates(projectId: string): Promise<Estimate[]> {
    const { data, error } = await supabase
      .from('estimates')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data || []
  },

  async createEstimate(estimate: EstimateInsert): Promise<Estimate> {
    const { data, error } = await supabase
      .from('estimates')
      .insert(estimate)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async updateEstimate(id: string, updates: EstimateUpdate): Promise<Estimate> {
    const { data, error } = await supabase
      .from('estimates')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  async deleteEstimate(id: string): Promise<void> {
    const { error } = await supabase
      .from('estimates')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  }
}

