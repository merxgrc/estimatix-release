/**
 * POST /api/pricing/save-to-library
 * 
 * Saves a price to the user's pricing library.
 * Requires authentication - user_id is derived from session (not accepted from client).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { upsertUserCostLibrary } from '@/lib/pricing/upsertUserCostLibrary'

export const runtime = 'nodejs'

/**
 * Request body schema - user_id is NOT accepted from client
 */
const RequestBodySchema = z.object({
  region: z.string().optional().nullable(),
  taskKey: z.string().min(1, 'taskKey is required'),
  unit: z.string().optional().nullable(),
  unitCost: z.number().min(0, 'unitCost must be non-negative'),
  notes: z.string().optional().nullable()
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

    // Upsert the user cost library entry (user_id from session, not from request)
    const result = await upsertUserCostLibrary({
      userId: user.id, // From session, not client
      region: data.region,
      taskKey: data.taskKey,
      unit: data.unit,
      unitCost: data.unitCost,
      notes: data.notes
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      entry: result.row
    })

  } catch (error) {
    console.error('Error in /api/pricing/save-to-library:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
