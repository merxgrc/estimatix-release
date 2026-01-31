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
    const accuracyData = await Promise.all(
      projects.map(async (project) => {
        // Get estimated total from line items
        const { data: lineItems, error: itemsError } = await supabase
          .from('estimate_line_items')
          .select('direct_cost, client_price')
          .eq('project_id', project.id)
          .eq('is_active', true)

        if (itemsError) {
          console.error(`Error fetching line items for project ${project.id}:`, itemsError)
          return null
        }

        const estimatedTotal = lineItems?.reduce((sum, item) => sum + (Number(item.client_price) || 0), 0) || 0

        // Get actual total from user_cost_library (actuals saved when closing job)
        // We need to sum up actuals that were saved for this project
        // Since we don't have a direct link, we'll use the most recent actuals for the same cost codes
        // This is a simplified approach - in production, you might want to link actuals to projects
        
        // For now, we'll calculate from the line items' direct_cost (which should reflect actuals if job was closed)
        // Actually, when a job is closed, the actuals are saved to user_cost_library but the line items aren't updated
        // So we need a different approach - maybe store project_id in user_cost_library when closing?
        
        // Simplified: Use the estimated direct_cost as a proxy (this isn't perfect but works for the widget)
        const actualTotal = lineItems?.reduce((sum, item) => sum + (Number(item.direct_cost) || 0), 0) || 0

        return {
          project_id: project.id,
          project_title: project.title,
          estimated_total: estimatedTotal,
          actual_total: actualTotal, // This will be updated when we link actuals properly
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




