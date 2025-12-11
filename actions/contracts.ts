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


