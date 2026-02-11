/**
 * POST /api/pricing/embed-all-tasks
 * 
 * PHASE 1: DISABLED
 * Per PHASE_1_RELEASE_CHECKLIST.md - semantic pricing search is disabled in Phase 1.
 * This route is kept to avoid merge conflicts but returns 501 Not Implemented.
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  // Phase 1: Embedding generation is disabled - no semantic pricing in Phase 1.
  return NextResponse.json(
    { 
      error: 'Disabled in Phase 1. Semantic pricing search is not available.',
      phase: 1
    },
    { status: 501 }
  )
}









