/**
 * POST /api/pricing/record-event
 * 
 * Records pricing feedback events.
 * Requires authentication - user_id is derived from session (not accepted from client).
 * 
 * userAction semantics:
 * - 'entered': Manual entry with no suggestion (Phase 1 default)
 * - 'accepted': Used a pricing suggestion as-is
 * - 'edited': Modified a pricing suggestion
 * - 'rejected': Explicitly rejected a suggestion
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { recordPricingEvent } from '@/lib/pricing/recordPricingEvent'

export const runtime = 'nodejs'

/**
 * Request body schema - user_id is NOT accepted from client
 */
const RequestBodySchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  estimateId: z.string().uuid().optional().nullable(),
  lineItemId: z.string().uuid().optional().nullable(),
  region: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  source: z.enum(['manual', 'user_library', 'task_library', 'ai']),
  matchedTaskId: z.string().uuid().optional().nullable(),
  matchConfidence: z.number().min(0).max(100).optional().nullable(),
  suggestedUnitCost: z.number().optional().nullable(),
  finalUnitCost: z.number(),
  userAction: z.enum(['entered', 'accepted', 'edited', 'rejected']),
  meta: z.record(z.unknown()).optional()
})

export async function POST(request: NextRequest) {
  try {
    // Require authentication - derive user_id from session
    const user = await requireAuth()
    if (!user || !user.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validation = RequestBodySchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { 
          error: 'Validation error', 
          details: validation.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        { status: 400 }
      )
    }

    const data = validation.data

    // Record the pricing event (user_id from session, not from request)
    const result = await recordPricingEvent({
      userId: user.id, // From session, not client
      projectId: data.projectId,
      estimateId: data.estimateId,
      lineItemId: data.lineItemId,
      region: data.region,
      unit: data.unit,
      quantity: data.quantity,
      source: data.source,
      matchedTaskId: data.matchedTaskId,
      matchConfidence: data.matchConfidence,
      suggestedUnitCost: data.suggestedUnitCost,
      finalUnitCost: data.finalUnitCost,
      userAction: data.userAction,
      meta: data.meta ?? {}
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      eventId: result.eventId
    })

  } catch (error) {
    console.error('Error in /api/pricing/record-event:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
