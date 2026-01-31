import { createServerClient } from './supabase/server'
import type { Project } from '@/types/db'

export interface ProjectMetadataPatch {
  title?: string
  owner_name?: string | null
  client_name?: string | null
  project_address?: string | null
  project_type?: string | null
  year_built?: number | null
  home_size_sqft?: number | null
  lot_size_sqft?: number | null
  bedrooms?: number | null
  bathrooms?: number | null
  job_start_target?: string | null // ISO date string
  job_deadline?: string | null     // ISO date string
  missing_data_count?: number | null
}

/**
 * Update project metadata - single source of truth for project updates
 * This is used by both Summary tab edits and Walk-n-Talk flow
 */
export async function updateProjectMetadata(
  projectId: string,
  patch: ProjectMetadataPatch
): Promise<Project> {
  const supabase = await createServerClient()

  // Prepare update object with last_summary_update timestamp
  const updateData: any = {
    ...patch,
    last_summary_update: new Date().toISOString()
  }

  // Remove undefined values
  Object.keys(updateData).forEach(key => {
    if (updateData[key] === undefined) {
      delete updateData[key]
    }
  })

  const { data, error } = await supabase
    .from('projects')
    .update(updateData)
    .eq('id', projectId)
    .select('*')
    .single()

  if (error) {
    console.error('Failed to update project metadata', error)
    throw error
  }

  return data
}


