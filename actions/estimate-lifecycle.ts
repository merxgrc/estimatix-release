'use server'

/**
 * Estimate Lifecycle Management
 * 
 * =============================================================================
 * COMMIT MOMENTS: WHY THEY MATTER
 * =============================================================================
 * 
 * Per PRODUCT_CONTEXT.md, pricing data has different levels of reliability:
 * 
 * - DRAFT: User is still thinking, editing, experimenting. Prices change
 *   frequently and don't represent final decisions. Logging draft edits
 *   would capture noise, not signal.
 * 
 * - BID_FINAL: User has committed to these prices for a real bid. This is
 *   the first moment of "truth" - the contractor is willing to stake their
 *   reputation on these numbers.
 * 
 * - CONTRACT_SIGNED: Client accepted the bid and signed a contract. This is
 *   the strongest signal - both parties agreed these prices are fair.
 * 
 * - COMPLETED: Job is done, actuals are collected. Now we can compare
 *   estimates vs reality.
 * 
 * =============================================================================
 * WHY DRAFTS ARE EXCLUDED FROM PRICING EVENTS
 * =============================================================================
 * 
 * 1. NOISE REDUCTION: A contractor might type "$500", then "$5000", then
 *    "$4500" while thinking. Only the final committed price matters.
 * 
 * 2. DATA QUALITY: Learning from draft prices would teach the system to
 *    suggest prices that contractors consider and reject.
 * 
 * 3. USER TRUST: Contractors need to feel safe experimenting without
 *    worrying that every keystroke is being tracked for pricing.
 * 
 * =============================================================================
 * PRICING TRUTH IS CAPTURED ONLY AT:
 * - bid_final: User finalized bid → log pricing_events, save to user_cost_library
 * - contract_signed: Contract accepted → log pricing_events, confirm pricing locked
 * =============================================================================
 * 
 * Allowed transitions:
 * - draft → bid_final
 * - bid_final → contract_signed  
 * - contract_signed → completed
 */

import { createServerClient, requireAuth } from '@/lib/supabase/server'
import { 
  EstimateStatus, 
  isValidEstimateTransition,
  isPricingTruthState 
} from '@/types/db'
import { recordPricingCommit, type LineItemForCommit } from '@/hooks/usePricingFeedback'

// =============================================================================
// Types
// =============================================================================

export interface EstimateTransitionResult {
  success: boolean
  error?: string
  estimate?: {
    id: string
    status: EstimateStatus
    status_changed_at: string | null
  }
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Get estimate with ownership verification
 */
async function getEstimateWithAuth(estimateId: string) {
  const user = await requireAuth()
  const supabase = await createServerClient()
  
  const { data: estimate, error } = await supabase
    .from('estimates')
    .select(`
      id, 
      project_id, 
      status, 
      status_changed_at,
      projects!inner(user_id)
    `)
    .eq('id', estimateId)
    .single()
  
  if (error || !estimate) {
    throw new Error('Estimate not found')
  }
  
  // Verify ownership
  if ((estimate.projects as any).user_id !== user.id) {
    throw new Error('Unauthorized: You do not own this estimate')
  }
  
  return { estimate, user, supabase }
}

/**
 * Get user's default region from user_profile_settings
 * 
 * Region precedence (Phase 1):
 * 1. user_profile_settings.region (user's configured region)
 * 2. null (if not configured)
 * 
 * Future: Could add project-level region override
 */
async function getUserRegion(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string
): Promise<string | null> {
  const { data: settings } = await supabase
    .from('user_profile_settings')
    .select('region')
    .eq('user_id', userId)
    .maybeSingle()
  
  return settings?.region || null
}

/**
 * Validate that all line items have pricing
 * Returns null if valid, or error message if invalid
 */
async function validateAllItemsPriced(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  estimateId: string
): Promise<string | null> {
  const { data: lineItems, error } = await supabase
    .from('estimate_line_items')
    .select('id, description, direct_cost')
    .eq('estimate_id', estimateId)
  
  if (error) {
    return 'Failed to load line items for validation'
  }
  
  if (!lineItems || lineItems.length === 0) {
    return 'Cannot finalize: Estimate has no line items'
  }
  
  // Find unpriced items (null or <= 0)
  // Note: 0 could be valid for free items, but <= 0 catches accidental zeros
  // If a user truly wants $0, they can still finalize (we check for null specifically)
  const unpricedItems = lineItems.filter(item => 
    item.direct_cost === null || item.direct_cost === undefined
  )
  
  if (unpricedItems.length > 0) {
    // Get first few descriptions for helpful error message
    const exampleDescriptions = unpricedItems
      .slice(0, 3)
      .map(item => item.description || 'Untitled item')
      .join(', ')
    
    const moreText = unpricedItems.length > 3 
      ? ` and ${unpricedItems.length - 3} more`
      : ''
    
    return `Cannot finalize: ${unpricedItems.length} line item${unpricedItems.length !== 1 ? 's are' : ' is'} missing pricing (${exampleDescriptions}${moreText}). Please enter prices for all items.`
  }
  
  return null // All items are priced
}

/**
 * Transition estimate to new status with validation
 */
async function transitionEstimate(
  estimateId: string, 
  targetStatus: EstimateStatus,
  captureCommitStage?: 'proposal_created' | 'bid_final' | 'contract_signed' | 'completed'
): Promise<EstimateTransitionResult> {
  try {
    const { estimate, supabase } = await getEstimateWithAuth(estimateId)
    const currentStatus = estimate.status as EstimateStatus
    
    // Validate transition
    if (!isValidEstimateTransition(currentStatus, targetStatus)) {
      return {
        success: false,
        error: `Invalid transition: ${currentStatus} → ${targetStatus}. Allowed: ${currentStatus} → ${
          currentStatus === 'draft' ? 'bid_final' :
          currentStatus === 'bid_final' ? 'contract_signed' :
          currentStatus === 'contract_signed' ? 'completed' : 'none'
        }`
      }
    }
    
    // Perform the transition
    // Note: The database trigger will also validate and update status_changed_at
    const { data: updated, error: updateError } = await supabase
      .from('estimates')
      .update({ status: targetStatus })
      .eq('id', estimateId)
      .select('id, status, status_changed_at')
      .single()
    
    if (updateError) {
      // Check if it's a transition validation error from the trigger
      if (updateError.message?.includes('Invalid estimate status transition')) {
        return {
          success: false,
          error: updateError.message
        }
      }
      throw updateError
    }
    
    // If transitioning to a pricing truth state, capture pricing events
    // This logs the pricing data for learning (per PRODUCT_CONTEXT.md)
    if (isPricingTruthState(targetStatus) && captureCommitStage) {
      try {
        // Get user's region for consistent event/library capture
        const { user } = await getEstimateWithAuth(estimateId)
        const userRegion = await getUserRegion(supabase, user.id)
        
        const { data: lineItems } = await supabase
          .from('estimate_line_items')
          .select('id, description, cost_code, unit, quantity, direct_cost, pricing_source, task_library_id, confidence')
          .eq('estimate_id', estimateId)
        
        if (lineItems && lineItems.length > 0) {
          const lineItemsForCommit: LineItemForCommit[] = lineItems.map(item => ({
            id: item.id,
            description: item.description || '',
            costCode: item.cost_code,
            unit: item.unit,
            quantity: item.quantity,
            directCost: item.direct_cost,
            pricingSource: item.pricing_source as any,
            matchedTaskId: item.task_library_id,
            matchConfidence: item.confidence
          }))
          
          // Fire-and-forget: don't block the transition
          // Include region for consistent pricing capture
          recordPricingCommit(lineItemsForCommit, {
            projectId: estimate.project_id,
            estimateId,
            region: userRegion, // User's default region from profile settings
            stage: captureCommitStage,
            saveToLibrary: true // Save prices to user library at commit
          }).catch(err => console.warn('Failed to record pricing commit:', err))
        }
      } catch (pricingError) {
        // Don't fail the transition if pricing logging fails
        console.warn('Failed to record pricing events at transition:', pricingError)
      }
    }
    
    return {
      success: true,
      estimate: updated as {
        id: string
        status: EstimateStatus
        status_changed_at: string | null
      }
    }
  } catch (error) {
    console.error('Error transitioning estimate:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to transition estimate'
    }
  }
}

// =============================================================================
// Public API: State Transition Functions
// =============================================================================

/**
 * Finalize Bid - transitions estimate from draft → bid_final
 * 
 * THIS IS A COMMIT MOMENT. When called:
 * 1. Validates all line items have pricing (blocks if any are unpriced)
 * 2. Estimate status changes to 'bid_final'
 * 3. pricing_events are logged with stage='bid_final' for ALL line items
 * 4. Prices are saved to user_cost_library for future reference
 * 5. Pricing is now considered "truth" for learning purposes
 * 
 * Call this when the user confirms their bid is ready to send.
 * After this point, the contractor is committed to these prices.
 */
export async function finalizeBid(estimateId: string): Promise<EstimateTransitionResult> {
  try {
    // Validate all items are priced before allowing transition
    const { supabase } = await getEstimateWithAuth(estimateId)
    const validationError = await validateAllItemsPriced(supabase, estimateId)
    
    if (validationError) {
      return {
        success: false,
        error: validationError
      }
    }
    
    // Stage 'bid_final' triggers:
    // - pricing_events logging (captures what contractor committed to)
    // - user_cost_library save (builds contractor's pricing history)
    return transitionEstimate(estimateId, 'bid_final', 'bid_final')
  } catch (error) {
    console.error('Error in finalizeBid:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to finalize bid'
    }
  }
}

/**
 * Mark Contract Signed - transitions estimate from bid_final → contract_signed
 * 
 * THIS IS A COMMIT MOMENT. When called:
 * 1. Validates all line items have pricing (blocks if any are unpriced)
 * 2. Estimate status changes to 'contract_signed'
 * 3. pricing_events are logged with stage='contract_signed' for ALL line items
 * 4. Prices are saved to user_cost_library (strongest signal - client agreed)
 * 5. Pricing is now locked and considered final truth
 * 
 * Call this when a contract is generated and accepted by the client.
 * This is the strongest pricing signal - both parties agreed.
 */
export async function markContractSigned(estimateId: string): Promise<EstimateTransitionResult> {
  try {
    // Validate all items are priced before allowing transition
    const { supabase } = await getEstimateWithAuth(estimateId)
    const validationError = await validateAllItemsPriced(supabase, estimateId)
    
    if (validationError) {
      return {
        success: false,
        error: validationError
      }
    }
    
    // Stage 'contract_signed' triggers:
    // - pricing_events logging (captures what both parties agreed to)
    // - user_cost_library save (highest confidence pricing data)
    return transitionEstimate(estimateId, 'contract_signed', 'contract_signed')
  } catch (error) {
    console.error('Error in markContractSigned:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to mark contract signed'
    }
  }
}

/**
 * Mark Completed - transitions estimate from contract_signed → completed
 * 
 * This is a terminal state. When called:
 * 1. Estimate status changes to 'completed'
 * 2. Actuals can no longer be edited (read-only)
 * 3. No additional pricing events logged (actuals are separate)
 * 
 * Call this when the project is finished and actuals have been collected.
 */
export async function markCompleted(estimateId: string): Promise<EstimateTransitionResult> {
  // No pricing events at completion - actuals are tracked separately
  // in project_actuals and line_item_actuals tables
  return transitionEstimate(estimateId, 'completed', 'completed')
}

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get current estimate status
 */
export async function getEstimateStatus(estimateId: string): Promise<{
  success: boolean
  status?: EstimateStatus
  status_changed_at?: string | null
  error?: string
}> {
  try {
    const { estimate } = await getEstimateWithAuth(estimateId)
    return {
      success: true,
      status: estimate.status as EstimateStatus,
      status_changed_at: estimate.status_changed_at
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get estimate status'
    }
  }
}

/**
 * Check if estimate is editable (in draft state)
 */
export async function isEstimateEditable(estimateId: string): Promise<boolean> {
  try {
    const { estimate } = await getEstimateWithAuth(estimateId)
    return estimate.status === 'draft'
  } catch {
    return false
  }
}

/**
 * Check if estimate pricing is truth (bid_final or contract_signed)
 */
export async function isEstimatePricingTruth(estimateId: string): Promise<boolean> {
  try {
    const { estimate } = await getEstimateWithAuth(estimateId)
    return isPricingTruthState(estimate.status as EstimateStatus)
  } catch {
    return false
  }
}
