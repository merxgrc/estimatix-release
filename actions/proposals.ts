'use server'

import { createServerClient, requireAuth } from '@/lib/supabase/server'

/**
 * Form data structure for proposal creation
 */
export interface ProposalFormData {
  basis_of_estimate?: string
  inclusions?: string[]
  exclusions?: string[]
  notes?: string
  title?: string
}

/**
 * Allowance item structure for proposal body_json
 */
interface AllowanceItem {
  description: string
  cost_code: string | null
  amount: number
}

/**
 * Proposal body JSON structure
 */
interface ProposalBodyJson {
  allowances: AllowanceItem[]
  inclusions: string[]
  exclusions: string[]
  basis_of_estimate: string
  notes: string
}

/**
 * Create a proposal from an estimate
 * 
 * This function:
 * 1. Fetches all estimate line items
 * 2. Calculates total price and extracts allowance items
 * 3. Constructs the proposal body_json
 * 4. Creates the proposal with incremented version number
 * 5. Creates an audit event
 * 
 * @param projectId - The project ID this proposal belongs to
 * @param estimateId - The estimate ID to create the proposal from
 * @param formData - Form data containing basis_of_estimate, inclusions, exclusions, notes, title
 * @returns The newly created proposal ID
 */
export async function createProposalFromEstimate(
  projectId: string,
  estimateId: string,
  formData: ProposalFormData
): Promise<{ success: boolean; proposalId?: string; error?: string }> {
  try {
    // Ensure user is authenticated
    const user = await requireAuth()
    if (!user || !user.id) {
      throw new Error('Authentication required')
    }

    const supabase = await createServerClient()

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      throw new Error('Project not found')
    }

    if (project.user_id !== user.id) {
      throw new Error('Unauthorized: Project does not belong to user')
    }

    // Verify estimate belongs to project
    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .select('id, project_id')
      .eq('id', estimateId)
      .single()

    if (estimateError || !estimate) {
      throw new Error('Estimate not found')
    }

    if (estimate.project_id !== projectId) {
      throw new Error('Estimate does not belong to the specified project')
    }

    // 1. Fetch all estimate_line_items for the given estimateId
    const { data: lineItems, error: lineItemsError } = await supabase
      .from('estimate_line_items')
      .select('*')
      .eq('estimate_id', estimateId)

    if (lineItemsError) {
      throw new Error(`Failed to fetch line items: ${lineItemsError.message}`)
    }

    if (!lineItems || lineItems.length === 0) {
      throw new Error('Cannot create proposal: Estimate has no line items')
    }

    // 2. Calculate totals and extract allowance items
    let totalPrice = 0
    const allowanceItems: AllowanceItem[] = []

    for (const item of lineItems) {
      // Sum all client_price values
      if (item.client_price !== null && item.client_price !== undefined) {
        totalPrice += Number(item.client_price) || 0
      }

      // Filter and map allowance items
      const isAllowance = item.is_allowance === true || 
                         (item.description && item.description.toUpperCase().trim().startsWith('ALLOWANCE:'))
      
      if (isAllowance) {
        allowanceItems.push({
          description: item.description || '',
          cost_code: item.cost_code || null,
          amount: item.client_price || item.direct_cost || 0
        })
      }
    }

    // 3. Construct body_json object
    const bodyJson: ProposalBodyJson = {
      allowances: allowanceItems,
      inclusions: formData.inclusions || [],
      exclusions: formData.exclusions || [],
      basis_of_estimate: formData.basis_of_estimate || '',
      notes: formData.notes || ''
    }

    // 4. Calculate version number - query existing proposals for this project
    const { data: existingProposals, error: versionError } = await supabase
      .from('proposals')
      .select('version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)

    if (versionError && versionError.code !== 'PGRST116') {
      // PGRST116 is "not found" which is fine, other errors should be logged
      console.warn('Error querying existing proposals for version:', versionError)
    }

    // Increment version number (start at 1 if no proposals exist)
    const nextVersion = existingProposals && existingProposals.length > 0
      ? (existingProposals[0].version || 0) + 1
      : 1

    // 5. Check if user profile exists before setting created_by
    let createdBy: string | null = null
    try {
      const { data: userProfile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()
      
      // Only set created_by if profile exists and no error occurred
      if (!profileError && userProfile && userProfile.id) {
        createdBy = user.id
      }
    } catch (profileCheckError) {
      // If profile check fails, just log and continue with null
      console.warn('Error checking user profile:', profileCheckError)
      createdBy = null
    }

    // 6. Insert new proposal
    const { data: newProposal, error: insertError } = await supabase
      .from('proposals')
      .insert({
        project_id: projectId,
        estimate_id: estimateId,
        version: nextVersion,
        title: formData.title || 'Construction Proposal',
        total_price: totalPrice,
        body_json: bodyJson as any, // Cast to any since Supabase expects JSONB
        status: 'draft',
        created_by: createdBy // Will be null if profile doesn't exist
      })
      .select('id')
      .single()

    if (insertError) {
      throw new Error(`Failed to create proposal: ${insertError.message}`)
    }

    if (!newProposal || !newProposal.id) {
      throw new Error('Failed to create proposal: No ID returned')
    }

    // 7. Insert audit event (only set created_by if profile exists)
    const { error: eventError } = await supabase
      .from('proposal_events')
      .insert({
        proposal_id: newProposal.id,
        event_type: 'created',
        metadata: {
          estimate_id: estimateId,
          total_price: totalPrice,
          line_items_count: lineItems.length,
          allowance_items_count: allowanceItems.length
        },
        created_by: createdBy // Will be null if profile doesn't exist
      })

    if (eventError) {
      // Log error but don't fail the whole operation - audit is important but not critical
      console.error('Failed to create proposal event:', eventError)
    }

    return {
      success: true,
      proposalId: newProposal.id
    }

  } catch (error) {
    console.error('Error creating proposal from estimate:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'An unknown error occurred'
    }
  }
}

