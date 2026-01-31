'use server'

/**
 * Job Actuals Management
 * 
 * Per PRODUCT_CONTEXT.md Phase 1.5:
 * - Actuals are stored SEPARATELY from estimates (never overwrite)
 * - Actuals can ONLY be entered when estimate.status = 'contract_signed'
 * - Once project is completed, actuals become read-only
 * 
 * This data will later feed:
 * - Estimation accuracy tracking
 * - Pricing intelligence (comparing estimates vs actuals)
 * - Variance analysis
 */

import { createServerClient, requireAuth } from '@/lib/supabase/server'
import { markCompleted } from '@/actions/estimate-lifecycle'
import type { 
  ProjectActuals, 
  ProjectActualsInsert, 
  ProjectActualsUpdate,
  LineItemActuals,
  LineItemActualsInsert,
  LineItemActualsUpdate,
  EstimateStatus
} from '@/types/db'

// =============================================================================
// Types
// =============================================================================

export interface CloseOutProjectInput {
  projectId: string
  estimateId: string
  totalActualCost: number
  actualLaborHours?: number | null
  totalActualLaborCost?: number | null
  totalActualMaterialCost?: number | null
  notes?: string | null
  lineItemActuals?: LineItemActualInput[]
}

export interface LineItemActualInput {
  lineItemId: string
  actualUnitCost?: number | null
  actualQuantity?: number | null
  actualLaborHours?: number | null
  notes?: string | null
}

export interface CloseOutResult {
  success: boolean
  error?: string
  projectActuals?: ProjectActuals
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Check if actuals can be entered for this project
 * Actuals can ONLY be entered when estimate.status = 'contract_signed'
 */
async function canEnterActuals(
  projectId: string, 
  estimateId: string
): Promise<{ canCloseOut: boolean; reason?: string; estimatedTotal?: number }> {
  const supabase = await createServerClient()
  
  // Get estimate status
  const { data: estimate, error } = await supabase
    .from('estimates')
    .select('id, status, total')
    .eq('id', estimateId)
    .eq('project_id', projectId)
    .single()
  
  if (error || !estimate) {
    return { canCloseOut: false, reason: 'Estimate not found' }
  }
  
  const status = estimate.status as EstimateStatus
  
  if (status === 'draft') {
    return { canCloseOut: false, reason: 'Cannot enter actuals: Estimate is still in draft. Finalize bid first.' }
  }
  
  if (status === 'bid_final') {
    return { canCloseOut: false, reason: 'Cannot enter actuals: Contract not signed yet.' }
  }
  
  if (status === 'completed') {
    return { canCloseOut: false, reason: 'Project already completed. Actuals are now read-only.' }
  }
  
  // status === 'contract_signed' - can enter actuals
  return { canCloseOut: true, estimatedTotal: estimate.total }
}

/**
 * Verify project ownership
 */
async function verifyProjectOwnership(projectId: string, userId: string): Promise<boolean> {
  const supabase = await createServerClient()
  
  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .single()
  
  return project?.user_id === userId
}

// =============================================================================
// Public API: Actuals Management
// =============================================================================

/**
 * Close out a project with actual costs
 * 
 * This:
 * 1. Validates that actuals can be entered (estimate.status = 'contract_signed')
 * 2. Creates/updates project_actuals record
 * 3. Optionally creates line_item_actuals records
 * 4. Transitions estimate to 'completed' status
 * 5. Makes actuals read-only
 */
export async function closeOutProject(input: CloseOutProjectInput): Promise<CloseOutResult> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()
    
    // Verify ownership
    const isOwner = await verifyProjectOwnership(input.projectId, user.id)
    if (!isOwner) {
      return { success: false, error: 'Unauthorized: You do not own this project' }
    }
    
    // Check if actuals can be entered
    const { canCloseOut, reason, estimatedTotal } = await canEnterActuals(input.projectId, input.estimateId)
    if (!canCloseOut) {
      return { success: false, error: reason }
    }
    
    // Calculate variance
    const varianceAmount = estimatedTotal != null 
      ? input.totalActualCost - estimatedTotal 
      : null
    const variancePercent = estimatedTotal != null && estimatedTotal > 0
      ? ((input.totalActualCost - estimatedTotal) / estimatedTotal) * 100
      : null
    
    // Create or update project_actuals
    const projectActualsData: ProjectActualsInsert = {
      project_id: input.projectId,
      estimate_id: input.estimateId,
      total_actual_cost: input.totalActualCost,
      total_actual_labor_cost: input.totalActualLaborCost,
      total_actual_material_cost: input.totalActualMaterialCost,
      actual_labor_hours: input.actualLaborHours,
      variance_amount: varianceAmount,
      variance_percent: variancePercent,
      notes: input.notes,
      closed_at: new Date().toISOString()
    }
    
    const { data: projectActuals, error: actualsError } = await supabase
      .from('project_actuals')
      .upsert(projectActualsData, {
        onConflict: 'project_id'
      })
      .select()
      .single()
    
    if (actualsError) {
      console.error('Error creating project actuals:', actualsError)
      return { success: false, error: 'Failed to save project actuals' }
    }
    
    // Create line item actuals if provided
    if (input.lineItemActuals && input.lineItemActuals.length > 0) {
      // First, get the original line items to calculate variance
      const { data: originalLineItems } = await supabase
        .from('estimate_line_items')
        .select('id, direct_cost, quantity')
        .eq('estimate_id', input.estimateId)
      
      const originalLineItemMap = new Map(
        (originalLineItems || []).map(item => [item.id, item])
      )
      
      const lineItemActualsData: LineItemActualsInsert[] = input.lineItemActuals.map(lia => {
        const original = originalLineItemMap.get(lia.lineItemId)
        const actualDirectCost = (lia.actualUnitCost || 0) * (lia.actualQuantity || 1)
        const originalDirectCost = original?.direct_cost || 0
        
        const liVarianceAmount = actualDirectCost - originalDirectCost
        const liVariancePercent = originalDirectCost > 0
          ? ((actualDirectCost - originalDirectCost) / originalDirectCost) * 100
          : null
        
        return {
          project_actuals_id: projectActuals.id,
          line_item_id: lia.lineItemId,
          actual_unit_cost: lia.actualUnitCost,
          actual_quantity: lia.actualQuantity,
          actual_direct_cost: actualDirectCost,
          actual_labor_hours: lia.actualLaborHours,
          variance_amount: liVarianceAmount,
          variance_percent: liVariancePercent,
          notes: lia.notes
        }
      })
      
      const { error: lineItemsError } = await supabase
        .from('line_item_actuals')
        .upsert(lineItemActualsData, {
          onConflict: 'line_item_id'
        })
      
      if (lineItemsError) {
        console.error('Error creating line item actuals:', lineItemsError)
        // Don't fail the whole operation, just log the error
      }
    }
    
    // Transition estimate to 'completed' status
    // This makes actuals read-only
    const transitionResult = await markCompleted(input.estimateId)
    if (!transitionResult.success) {
      console.error('Error transitioning estimate to completed:', transitionResult.error)
      // Don't fail - actuals are saved, status transition is secondary
    }
    
    return {
      success: true,
      projectActuals: projectActuals as ProjectActuals
    }
  } catch (error) {
    console.error('Error in closeOutProject:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to close out project'
    }
  }
}

/**
 * Get project actuals (if they exist)
 */
export async function getProjectActuals(projectId: string): Promise<{
  success: boolean
  actuals?: ProjectActuals | null
  lineItemActuals?: LineItemActuals[]
  error?: string
}> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()
    
    // Verify ownership
    const isOwner = await verifyProjectOwnership(projectId, user.id)
    if (!isOwner) {
      return { success: false, error: 'Unauthorized' }
    }
    
    // Get project actuals
    const { data: actuals, error: actualsError } = await supabase
      .from('project_actuals')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle()
    
    if (actualsError) {
      return { success: false, error: 'Failed to fetch project actuals' }
    }
    
    if (!actuals) {
      return { success: true, actuals: null, lineItemActuals: [] }
    }
    
    // Get line item actuals
    const { data: lineItemActuals } = await supabase
      .from('line_item_actuals')
      .select('*')
      .eq('project_actuals_id', actuals.id)
    
    return {
      success: true,
      actuals: actuals as ProjectActuals,
      lineItemActuals: (lineItemActuals || []) as LineItemActuals[]
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get actuals'
    }
  }
}

/**
 * Check if project can be closed out
 */
export async function canCloseOutProject(projectId: string, estimateId: string): Promise<{
  canCloseOut: boolean
  reason?: string
  estimatedTotal?: number
}> {
  try {
    await requireAuth()
    return await canEnterActuals(projectId, estimateId)
  } catch (error) {
    return {
      canCloseOut: false,
      reason: error instanceof Error ? error.message : 'Authentication required'
    }
  }
}

/**
 * Update project actuals (only if not completed)
 */
export async function updateProjectActuals(
  projectId: string,
  updates: ProjectActualsUpdate
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()
    
    // Verify ownership
    const isOwner = await verifyProjectOwnership(projectId, user.id)
    if (!isOwner) {
      return { success: false, error: 'Unauthorized' }
    }
    
    // Check if project is completed (actuals are read-only)
    const { data: actuals } = await supabase
      .from('project_actuals')
      .select('id, estimate_id')
      .eq('project_id', projectId)
      .single()
    
    if (!actuals) {
      return { success: false, error: 'No actuals found for this project' }
    }
    
    // Check estimate status
    const { data: estimate } = await supabase
      .from('estimates')
      .select('status')
      .eq('id', actuals.estimate_id)
      .single()
    
    if (estimate?.status === 'completed') {
      return { success: false, error: 'Project is completed. Actuals are read-only.' }
    }
    
    // Update actuals
    const { error: updateError } = await supabase
      .from('project_actuals')
      .update(updates)
      .eq('project_id', projectId)
    
    if (updateError) {
      return { success: false, error: 'Failed to update actuals' }
    }
    
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update actuals'
    }
  }
}
