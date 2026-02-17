'use server'

import { createServerClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/server'

export interface PaymentMilestone {
  milestone: string
  amount: number
}

export interface LegalClauses {
  warranty?: string
  termination?: string
  right_to_cancel?: string
}

export interface CreateContractData {
  startDate: string
  completionDate: string
  totalPrice: number
  downPayment: number
  paymentSchedule: PaymentMilestone[]
  legalText: LegalClauses
}

export async function createContractFromProposal(
  projectId: string,
  proposalId: string | null,
  data: CreateContractData
) {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // Validate input
    if (data.downPayment > data.totalPrice) {
      return {
        success: false,
        error: 'Down payment cannot exceed total price'
      }
    }

    // Check if user profile exists before setting created_by
    let createdBy: string | null = null
    try {
      const { data: userProfile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()
      
      if (!profileError && userProfile && userProfile.id) {
        createdBy = user.id
      }
    } catch (profileCheckError) {
      console.warn('Error checking user profile:', profileCheckError)
      createdBy = null
    }

    // Create contract
    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .insert({
        project_id: projectId,
        proposal_id: proposalId,
        total_price: data.totalPrice,
        down_payment: data.downPayment,
        start_date: data.startDate || null,
        completion_date: data.completionDate || null,
        payment_schedule: data.paymentSchedule,
        legal_text: data.legalText,
        status: 'draft',
        created_by: createdBy
      })
      .select()
      .single()

    if (contractError) {
      throw new Error(`Failed to create contract: ${contractError.message}`)
    }

    return {
      success: true,
      contractId: contract.id
    }
  } catch (error) {
    console.error('Error creating contract:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create contract'
    }
  }
}

/**
 * Recalculate and update a contract's total_price from current estimate line items.
 * Follows the chain: contract -> proposal -> estimate -> line items (filtered by room is_in_scope).
 */
export async function regenerateContractTotal(
  contractId: string
): Promise<{ success: boolean; newTotal?: number; error?: string }> {
  try {
    const user = await requireAuth()
    if (!user || !user.id) {
      throw new Error('Authentication required')
    }

    const supabase = await createServerClient()

    // Fetch contract with proposal relationship
    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select('id, project_id, proposal_id, proposals(estimate_id)')
      .eq('id', contractId)
      .maybeSingle()

    if (contractError || !contract) {
      throw new Error('Contract not found')
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', contract.project_id)
      .single()

    if (projectError || !project || project.user_id !== user.id) {
      throw new Error('Unauthorized')
    }

    const proposal = contract.proposals as any
    const estimateId = proposal?.estimate_id
    if (!estimateId) {
      throw new Error('Contract has no linked estimate')
    }

    // Fetch line items with room exclusion filter
    const { data: lineItems, error: lineItemsError } = await supabase
      .from('estimate_line_items')
      .select(`
        client_price,
        room_id,
        rooms!estimate_line_items_room_id_fkey (
          id,
          is_in_scope
        )
      `)
      .eq('estimate_id', estimateId)

    if (lineItemsError) {
      throw new Error(`Failed to fetch line items: ${lineItemsError.message}`)
    }

    // Calculate new total (only in-scope rooms)
    let newTotal = 0
    for (const item of (lineItems || []) as any[]) {
      const room = item.rooms as { id: string; is_in_scope: boolean } | null
      if (room && room.is_in_scope === false) continue
      newTotal += Number(item.client_price) || 0
    }

    // Update contract total_price
    const { error: updateError } = await supabase
      .from('contracts')
      .update({ total_price: newTotal })
      .eq('id', contractId)

    if (updateError) {
      throw new Error(`Failed to update contract: ${updateError.message}`)
    }

    return { success: true, newTotal }
  } catch (error) {
    console.error('Error regenerating contract total:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}


