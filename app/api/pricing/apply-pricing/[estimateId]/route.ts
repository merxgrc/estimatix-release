/**
 * POST /api/pricing/apply-pricing/[estimateId]
 * 
 * PHASE 1: DISABLED
 * Per PHASE_1_RELEASE_CHECKLIST.md - pricing is manual only in Phase 1.
 * This route is kept to avoid merge conflicts but returns 501 Not Implemented.
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ estimateId: string }> }
) {
  // Phase 1: Auto-pricing is disabled. Users enter prices manually.
  return NextResponse.json(
    { 
      error: 'Disabled in Phase 1. Pricing is manual only - enter prices directly in the estimate table.',
      phase: 1
    },
    { status: 501 }
  )
}
