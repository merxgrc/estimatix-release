/**
 * POST /api/pricing/user-library
 * 
 * PHASE 1: DISABLED
 * Per PHASE_1_RELEASE_CHECKLIST.md - user pricing library management via UI is disabled in Phase 1.
 * This route is kept to avoid merge conflicts but returns 501 Not Implemented.
 * 
 * Note: /api/pricing/save-to-library is DIFFERENT and remains enabled for commit-moment data capture.
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  // Phase 1: User library override via UI is disabled.
  return NextResponse.json(
    { 
      error: 'Disabled in Phase 1. User pricing library management is not available.',
      phase: 1
    },
    { status: 501 }
  )
}









