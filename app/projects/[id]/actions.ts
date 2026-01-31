'use server'

import { updateProjectMetadata } from '@/lib/projects'
import { requireAuth } from '@/lib/supabase/server'
import type { ProjectMetadataPatch } from '@/lib/projects'

/**
 * Server action to update project metadata
 * This is called from client components like SummaryTab
 */
export async function updateProjectMetadataAction(
  projectId: string,
  patch: ProjectMetadataPatch
) {
  // Ensure user is authenticated
  await requireAuth()

  // Validate patch - ensure it's an object with allowed keys
  const allowedKeys = [
    'title',
    'owner_name',
    'client_name',
    'project_address',
    'project_type',
    'year_built',
    'home_size_sqft',
    'lot_size_sqft',
    'bedrooms',
    'bathrooms',
    'job_start_target',
    'job_deadline',
    'missing_data_count'
  ]

  const validatedPatch: ProjectMetadataPatch = {}
  for (const key of allowedKeys) {
    if (key in patch) {
      const value = patch[key as keyof ProjectMetadataPatch]
      if (value !== undefined) {
        validatedPatch[key as keyof ProjectMetadataPatch] = value as any
      }
    }
  }

  return await updateProjectMetadata(projectId, validatedPatch)
}

