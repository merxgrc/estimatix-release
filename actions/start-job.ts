'use server'

import { createServerClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/server'

/**
 * Start Job Action
 * 
 * Trigger: When a Contract is marked "Signed" (or manually clicked "Start Job")
 * 
 * Logic:
 * 1. Fetch all estimate_line_items from the approved estimate
 * 2. Bulk insert them into project_tasks
 * 3. This effectively "snapshots" the job scope so we can track progress
 *    without worrying about the estimate changing later
 */
export async function startJobFromContract(contractId: string) {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // 1. Fetch contract with linked proposal and estimate
    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select(`
        *,
        proposals (
          *,
          estimates (*)
        )
      `)
      .eq('id', contractId)
      .maybeSingle()

    if (contractError) {
      throw new Error(`Failed to fetch contract: ${contractError.message}`)
    }

    if (!contract) {
      throw new Error('Contract not found')
    }

    // Verify user owns the project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', contract.project_id)
      .maybeSingle()

    if (projectError || !project) {
      throw new Error('Project not found')
    }

    if (project.user_id !== user.id) {
      throw new Error('Unauthorized: You do not own this project')
    }

    // 2. Get the linked proposal (optional but recommended)
    const proposal = contract.proposals as any
    let estimateId: string | null = null

    if (proposal) {
      // Verify proposal is approved
      if (proposal.status !== 'approved') {
        throw new Error('Contract must be linked to an approved proposal')
      }

      const estimate = proposal.estimates as any
      if (estimate && estimate.id) {
        estimateId = estimate.id
      }
    }

    // If no proposal, try to get estimate directly from contract's project
    // Look for the most recent approved estimate
    if (!estimateId) {
      // Try to find an approved proposal first
      const { data: approvedProposal } = await supabase
        .from('proposals')
        .select('estimate_id')
        .eq('project_id', contract.project_id)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (approvedProposal && approvedProposal.estimate_id) {
        estimateId = approvedProposal.estimate_id
      } else {
        // Fallback: get the most recent estimate for the project
        const { data: recentEstimate } = await supabase
          .from('estimates')
          .select('id')
          .eq('project_id', contract.project_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (recentEstimate) {
          estimateId = recentEstimate.id
        }
      }
    }

    if (!estimateId) {
      throw new Error('No approved estimate found. Please ensure the contract is linked to an approved proposal with an estimate.')
    }

    // 3. Check if tasks already exist for this contract/project (idempotency)
    const { data: existingTasks, error: existingTasksError } = await supabase
      .from('project_tasks')
      .select('id')
      .eq('project_id', contract.project_id)
      .limit(1)

    if (existingTasksError) {
      throw new Error(`Failed to check existing tasks: ${existingTasksError.message}`)
    }

    if (existingTasks && existingTasks.length > 0) {
      // Tasks already exist - return success but indicate they were already created
      return {
        success: true,
        tasksCreated: 0,
        message: 'Job tasks already exist for this project'
      }
    }

    // 4. Fetch all estimate_line_items from the approved estimate
    // Join with rooms to filter out excluded rooms (is_in_scope = false)
    const { data: lineItems, error: lineItemsError } = await supabase
      .from('estimate_line_items')
      .select(`
        *,
        rooms!estimate_line_items_room_id_fkey (
          id,
          is_in_scope
        )
      `)
      .eq('estimate_id', estimateId)
      .order('created_at', { ascending: true })

    if (lineItemsError) {
      throw new Error(`Failed to fetch line items: ${lineItemsError.message}`)
    }

    if (!lineItems || lineItems.length === 0) {
      throw new Error('No line items found for this estimate. Cannot start job without scope items.')
    }

    // 5. Filter out empty descriptions AND excluded rooms, then prepare tasks for bulk insert
    // Items without room_id (room_id = null) are included by default
    const tasksToInsert = lineItems
      .filter(item => {
        // Filter out empty descriptions
        if (!item.description || item.description.trim().length === 0) {
          return false
        }
        // Include items without a room (General items)
        const room = item.rooms as { id: string; is_in_scope: boolean } | null
        if (!room) {
          return true // No room assigned = included by default
        }
        // Only include items from in-scope rooms
        return room.is_in_scope !== false
      })
      .map(item => ({
        project_id: contract.project_id,
        original_line_item_id: item.id,
        description: item.description?.trim() || '',
        status: 'pending' as const,
        price: Number(item.client_price) || 0,
        billed_amount: 0
      }))

    if (tasksToInsert.length === 0) {
      throw new Error('No valid line items with descriptions found. Cannot create tasks.')
    }

    // 6. Bulk insert into project_tasks (snapshot the job scope)
    const { error: insertError } = await supabase
      .from('project_tasks')
      .insert(tasksToInsert)

    if (insertError) {
      throw new Error(`Failed to create tasks: ${insertError.message}`)
    }

    // 7. Update contract status to 'signed' if it was 'sent' or 'draft'
    // (This allows manual "Start Job" to also mark contract as signed)
    if (contract.status === 'sent' || contract.status === 'draft') {
      const { error: updateError } = await supabase
        .from('contracts')
        .update({ status: 'signed' })
        .eq('id', contractId)

      if (updateError) {
        console.warn('Failed to update contract status:', updateError)
        // Don't fail the whole operation - tasks were created successfully
      }
    }

    return {
      success: true,
      tasksCreated: tasksToInsert.length,
      message: `Successfully created ${tasksToInsert.length} task${tasksToInsert.length !== 1 ? 's' : ''} from estimate`
    }
  } catch (error) {
    console.error('Error starting job:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start job'
    }
  }
}

/**
 * Start Job from Estimate Action
 * 
 * Trigger: Manual "Start Job" button click from ManageTab
 * 
 * Logic:
 * 1. Find the most recent estimate for the project
 * 2. Fetch all estimate_line_items from that estimate
 * 3. Bulk insert them into project_tasks
 * 4. This effectively "snapshots" the job scope
 */
export async function startJobFromEstimate(projectId: string) {
  try {
    const user = await requireAuth()
    const supabase = await createServerClient()

    // 1. Verify user owns the project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle()

    if (projectError || !project) {
      throw new Error('Project not found')
    }

    if (project.user_id !== user.id) {
      throw new Error('Unauthorized: You do not own this project')
    }

    // 2. Check if tasks already exist for this project (idempotency)
    const { data: existingTasks, error: existingTasksError } = await supabase
      .from('project_tasks')
      .select('id')
      .eq('project_id', projectId)
      .limit(1)

    if (existingTasksError) {
      throw new Error(`Failed to check existing tasks: ${existingTasksError.message}`)
    }

    if (existingTasks && existingTasks.length > 0) {
      // Tasks already exist - return success but indicate they were already created
      return {
        success: true,
        tasksCreated: 0,
        message: 'Job tasks already exist for this project'
      }
    }

    // 3. Find the most recent estimate for the project
    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (estimateError) {
      throw new Error(`Failed to fetch estimate: ${estimateError.message}`)
    }

    if (!estimate) {
      throw new Error('No estimate found for this project. Please create an estimate first.')
    }

    // 4. Fetch all estimate_line_items from the estimate
    // Join with rooms to filter out excluded rooms (is_in_scope = false)
    const { data: lineItems, error: lineItemsError } = await supabase
      .from('estimate_line_items')
      .select(`
        *,
        rooms!estimate_line_items_room_id_fkey (
          id,
          is_in_scope
        )
      `)
      .eq('estimate_id', estimate.id)
      .order('created_at', { ascending: true })

    if (lineItemsError) {
      throw new Error(`Failed to fetch line items: ${lineItemsError.message}`)
    }

    if (!lineItems || lineItems.length === 0) {
      throw new Error('No line items found for this estimate. Cannot start job without scope items.')
    }

    // 5. Filter out empty descriptions AND excluded rooms, then prepare tasks for bulk insert
    // Items without room_id (room_id = null) are included by default
    const tasksToInsert = lineItems
      .filter(item => {
        // Filter out empty descriptions
        if (!item.description || item.description.trim().length === 0) {
          return false
        }
        // Include items without a room (General items)
        const room = item.rooms as { id: string; is_in_scope: boolean } | null
        if (!room) {
          return true // No room assigned = included by default
        }
        // Only include items from in-scope rooms
        return room.is_in_scope !== false
      })
      .map(item => ({
        project_id: projectId,
        original_line_item_id: item.id,
        description: item.description?.trim() || '',
        status: 'pending' as const,
        price: Number(item.client_price) || 0,
        billed_amount: 0
      }))

    if (tasksToInsert.length === 0) {
      throw new Error('No valid line items with descriptions found. Cannot create tasks.')
    }

    // 6. Bulk insert into project_tasks (snapshot the job scope)
    const { error: insertError } = await supabase
      .from('project_tasks')
      .insert(tasksToInsert)

    if (insertError) {
      throw new Error(`Failed to create tasks: ${insertError.message}`)
    }

    return {
      success: true,
      tasksCreated: tasksToInsert.length,
      message: `Successfully created ${tasksToInsert.length} task${tasksToInsert.length !== 1 ? 's' : ''} from estimate`
    }
  } catch (error) {
    console.error('Error starting job from estimate:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start job'
    }
  }
}


