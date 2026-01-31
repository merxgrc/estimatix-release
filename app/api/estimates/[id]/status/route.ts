/**
 * API Route: Estimate Status Transitions
 * 
 * POST /api/estimates/:id/status
 * 
 * Transitions estimate to a new lifecycle state.
 * 
 * Per PRODUCT_CONTEXT.md:
 * - Allowed transitions ONLY:
 *   - draft → bid_final
 *   - bid_final → contract_signed
 *   - contract_signed → completed
 * - PRICING TRUTH is captured at bid_final and contract_signed
 * - Illegal transitions return 400 Bad Request
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { 
  finalizeBid, 
  markContractSigned, 
  markCompleted,
  getEstimateStatus 
} from '@/actions/estimate-lifecycle'
import { EstimateStatus } from '@/types/db'

export const runtime = 'nodejs'

// Request schema
const TransitionRequestSchema = z.object({
  action: z.enum(['finalize_bid', 'mark_contract_signed', 'mark_completed'])
})

// GET: Get current estimate status
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: estimateId } = await params
    
    if (!estimateId) {
      return NextResponse.json(
        { error: 'Estimate ID is required' },
        { status: 400 }
      )
    }
    
    const result = await getEstimateStatus(estimateId)
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error?.includes('Unauthorized') ? 403 : 404 }
      )
    }
    
    return NextResponse.json({
      status: result.status,
      status_changed_at: result.status_changed_at
    })
  } catch (error) {
    console.error('GET /api/estimates/[id]/status error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST: Transition estimate status
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: estimateId } = await params
    
    if (!estimateId) {
      return NextResponse.json(
        { error: 'Estimate ID is required' },
        { status: 400 }
      )
    }
    
    // Parse and validate request body
    const body = await req.json()
    const validation = TransitionRequestSchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json(
        { 
          error: 'Invalid request',
          details: validation.error.errors,
          hint: 'action must be one of: finalize_bid, mark_contract_signed, mark_completed'
        },
        { status: 400 }
      )
    }
    
    const { action } = validation.data
    
    // Execute the appropriate transition
    let result
    switch (action) {
      case 'finalize_bid':
        result = await finalizeBid(estimateId)
        break
      case 'mark_contract_signed':
        result = await markContractSigned(estimateId)
        break
      case 'mark_completed':
        result = await markCompleted(estimateId)
        break
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
    
    if (!result.success) {
      // Determine appropriate status code
      const statusCode = result.error?.includes('Unauthorized') ? 403 :
                        result.error?.includes('Invalid transition') ? 400 :
                        result.error?.includes('not found') ? 404 : 500
      
      return NextResponse.json(
        { error: result.error },
        { status: statusCode }
      )
    }
    
    return NextResponse.json({
      success: true,
      estimate: result.estimate
    })
  } catch (error) {
    console.error('POST /api/estimates/[id]/status error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
