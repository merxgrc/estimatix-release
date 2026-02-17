'use server'

import { createServerClient, requireAuth } from '@/lib/supabase/server'

/**
 * Get completed projects with estimated vs actual costs
 */
export async function getEstimationAccuracy() {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Get completed projects
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('id, title, created_at')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(5)

    if (projectsError) {
      console.error('Error fetching completed projects:', projectsError)
      return { success: false, error: 'Failed to fetch projects' }
    }

    if (!projects || projects.length === 0) {
      return { success: true, data: [] }
    }

    // For each project, calculate estimated vs actual
    // Filters out line items from rooms that are excluded from scope
    const accuracyData = await Promise.all(
      projects.map(async (project) => {
        // Fetch line items WITH room scope join to filter excluded rooms
        const { data: lineItems, error: itemsError } = await supabase
          .from('estimate_line_items')
          .select(`
            direct_cost, client_price, room_id,
            rooms!estimate_line_items_room_id_fkey (
              id,
              is_in_scope
            )
          `)
          .eq('project_id', project.id)
          .eq('is_active', true)

        if (itemsError) {
          console.error(`Error fetching line items for project ${project.id}:`, itemsError)
          return null
        }

        // Only include items from in-scope rooms (or items without a room)
        let estimatedTotal = 0
        let actualTotal = 0

        for (const item of (lineItems || []) as any[]) {
          const room = item.rooms as { id: string; is_in_scope: boolean } | null
          if (room && room.is_in_scope === false) continue // Skip excluded rooms

          estimatedTotal += Number(item.client_price) || 0
          actualTotal += Number(item.direct_cost) || 0
        }

        return {
          project_id: project.id,
          project_title: project.title,
          estimated_total: estimatedTotal,
          actual_total: actualTotal,
          variance_percent: estimatedTotal > 0 
            ? ((actualTotal - estimatedTotal) / estimatedTotal) * 100 
            : 0,
          created_at: project.created_at
        }
      })
    )

    const validData = accuracyData.filter(item => item !== null)

    return { success: true, data: validData }
  } catch (error) {
    console.error('Error getting estimation accuracy:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}




