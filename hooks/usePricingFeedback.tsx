/**
 * usePricingFeedback - Client-side utilities for pricing feedback system
 * 
 * =============================================================================
 * COMMIT MOMENTS ONLY - NO DRAFT LOGGING
 * =============================================================================
 * 
 * Per PRODUCT_CONTEXT.md Phase 1:
 * - Log pricing_events ONLY at commit moments:
 *   * bid_final: User finalized their bid
 *   * contract_signed: Contract generated and accepted
 * 
 * - Save to user_cost_library ONLY at these commit moments (silently)
 * - NO pricing events during draft editing (blur, keystroke, intermediate saves)
 * - NO aggressive popups or toasts for saving prices
 * - Pricing suggestions are feature-flagged OFF
 * 
 * =============================================================================
 * WHY DRAFTS ARE EXCLUDED
 * =============================================================================
 * 
 * Draft edits are exploratory - contractors experiment with prices before
 * committing. Logging every edit would:
 * 1. Capture noise instead of signal
 * 2. Teach the system to suggest rejected prices
 * 3. Make contractors feel surveilled while thinking
 * 
 * Only committed prices (bid_final, contract_signed) represent truth.
 * 
 * =============================================================================
 * 
 * This module provides:
 * - recordPricingEvent: Fire-and-forget event logging (used internally)
 * - recordPricingCommit: Called at commit moments to log events + save to library
 */

import type { PricingSource, PricingUserAction } from '@/types/db'

/**
 * Make task key from components (client-side version)
 */
export function makeTaskKeyClient(params: {
  costCode?: string | null
  description: string
  unit?: string | null
}): string {
  const { costCode, description, unit } = params
  
  const normalize = (str: string | null | undefined): string => {
    if (!str) return ''
    return str.toLowerCase().trim().replace(/\s+/g, ' ')
  }
  
  const normalizedCostCode = normalize(costCode) || ''
  const normalizedDescription = normalize(description)
  const normalizedUnit = normalize(unit) || ''
  
  if (!normalizedDescription) {
    throw new Error('makeTaskKey: description is required')
  }
  
  return `${normalizedCostCode}|${normalizedDescription}|${normalizedUnit}`
}

export interface PricingEventData {
  projectId?: string | null
  estimateId?: string | null
  lineItemId?: string | null
  region?: string | null
  unit?: string | null
  quantity?: number | null
  source: PricingSource
  matchedTaskId?: string | null
  matchConfidence?: number | null
  suggestedUnitCost?: number | null
  finalUnitCost: number
  userAction: PricingUserAction
  meta?: Record<string, unknown>
}

export interface SaveToLibraryData {
  region?: string | null
  taskKey: string
  unit?: string | null
  unitCost: number
  notes?: string | null
}

/**
 * Record a pricing event (fire-and-forget)
 * Called at commit moments to capture pricing behavior for analytics
 */
export async function recordPricingEvent(data: PricingEventData): Promise<boolean> {
  try {
    const response = await fetch('/api/pricing/record-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    return response.ok
  } catch (error) {
    console.error('Error recording pricing event:', error)
    return false
  }
}

/**
 * Save price to user library (silent, for future use)
 * Called at commit moments (Finalize Bid, Generate Contract, Mark Accepted)
 */
export async function saveToUserLibrary(data: SaveToLibraryData): Promise<boolean> {
  try {
    const response = await fetch('/api/pricing/save-to-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    return response.ok
  } catch (error) {
    console.error('Error saving to library:', error)
    return false
  }
}

export interface LineItemForCommit {
  id?: string
  description: string
  costCode?: string | null
  unit?: string | null
  quantity?: number
  directCost?: number
  unitCost?: number
  pricingSource?: PricingSource | null
  matchedTaskId?: string | null
  matchConfidence?: number | null
}

export interface CommitOptions {
  projectId: string
  estimateId: string
  region?: string | null
  /**
   * The commit stage that triggered this pricing capture.
   * ONLY these stages should trigger pricing events:
   * - 'bid_final': User finalized their bid (first truth moment)
   * - 'contract_signed': Contract accepted (strongest truth signal)
   * - 'proposal_created': Proposal generated (weaker signal, optional)
   * - 'completed': Job finished (no pricing events, just for completeness)
   */
  stage: 'proposal_created' | 'bid_final' | 'contract_signed' | 'completed'
  /**
   * Whether to save prices to user_cost_library.
   * Should be TRUE for bid_final and contract_signed (truth states).
   */
  saveToLibrary?: boolean
}

/**
 * Record pricing commit for multiple line items
 * 
 * =============================================================================
 * CALLED ONLY AT COMMIT MOMENTS - NEVER DURING DRAFT EDITING
 * =============================================================================
 * 
 * Valid commit moments:
 * - bid_final: Finalize Bid button clicked → log events + save to library
 * - contract_signed: Contract generated/signed → log events + save to library
 * - proposal_created: Proposal generated → log events (weaker signal)
 * 
 * NOT called during:
 * - Typing in price fields
 * - Blur events on inputs
 * - Intermediate auto-saves
 * - Any draft-state editing
 * 
 * Per PRODUCT_CONTEXT.md Phase 1: No UI, no toasts - just silent data capture.
 */
export async function recordPricingCommit(
  lineItems: LineItemForCommit[],
  options: CommitOptions
): Promise<{ eventsRecorded: number; libraryEntriesSaved: number }> {
  const { projectId, estimateId, region, stage, saveToLibrary = false } = options
  
  let eventsRecorded = 0
  let libraryEntriesSaved = 0
  
  for (const item of lineItems) {
    if (!item.description || !item.directCost) continue
    
    const quantity = item.quantity ?? 1
    const unitCost = item.unitCost ?? (item.directCost / quantity)
    
    // =============================================================================
    // USER ACTION SEMANTICS
    // =============================================================================
    // In Phase 1, there are no pricing suggestions. All prices are manually
    // entered by the contractor. Therefore:
    //   - user_action = 'entered' (manual entry, no suggestion)
    //   - suggestedUnitCost = null
    //
    // In Phase 2+, when suggestions are enabled:
    //   - user_action = 'accepted' if final == suggested
    //   - user_action = 'edited' if final != suggested
    //   - user_action = 'rejected' if user explicitly rejected suggestion
    // =============================================================================
    
    // Determine user action based on whether there was a suggestion
    // Phase 1: No suggestions → 'entered'
    // Phase 2+: Compare suggested vs final to determine action
    const suggestedUnitCost: number | null = null // Phase 1: No suggestions
    let userAction: 'entered' | 'accepted' | 'edited' | 'rejected' = 'entered'
    
    if (suggestedUnitCost !== null) {
      // Phase 2+ logic (not active in Phase 1)
      userAction = Math.abs(unitCost - suggestedUnitCost) < 0.01 ? 'accepted' : 'edited'
    }
    
    // Record pricing event
    const eventResult = await recordPricingEvent({
      projectId,
      estimateId,
      lineItemId: item.id,
      region,
      unit: item.unit,
      quantity,
      source: item.pricingSource || 'manual',
      matchedTaskId: item.matchedTaskId,
      matchConfidence: item.matchConfidence,
      suggestedUnitCost,
      finalUnitCost: unitCost,
      userAction,
      meta: {
        costCode: item.costCode,
        description: item.description,
        stage
      }
    })
    
    if (eventResult) {
      eventsRecorded++
    }
    
    // Optionally save to user library (silent, for future use)
    if (saveToLibrary && unitCost > 0) {
      try {
        const taskKey = makeTaskKeyClient({
          costCode: item.costCode,
          description: item.description,
          unit: item.unit
        })
        
        const libraryResult = await saveToUserLibrary({
          region,
          taskKey,
          unit: item.unit,
          unitCost,
          notes: `Captured at ${stage}`
        })
        
        if (libraryResult) {
          libraryEntriesSaved++
        }
      } catch (error) {
        // Ignore task key errors for individual items
        console.warn(`Failed to save library entry for "${item.description}":`, error)
      }
    }
  }
  
  return { eventsRecorded, libraryEntriesSaved }
}
