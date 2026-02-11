/**
 * POST/GET /api/pricing/task-library/search
 * 
 * PHASE 1: DISABLED
 * Per PHASE_1_RELEASE_CHECKLIST.md - task library search for pricing is disabled in Phase 1.
 * This route is kept to avoid merge conflicts but returns 501 Not Implemented.
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  // Phase 1: Task library search is disabled - no pricing suggestions.
  return NextResponse.json(
    { 
      error: 'Disabled in Phase 1. Task library search is not available.',
      phase: 1
    },
    { status: 501 }
  )
}

export async function GET(request: NextRequest) {
  // Phase 1: Task library search is disabled - no pricing suggestions.
  return NextResponse.json(
    { 
      error: 'Disabled in Phase 1. Task library search is not available.',
      phase: 1
    },
    { status: 501 }
  )
}

