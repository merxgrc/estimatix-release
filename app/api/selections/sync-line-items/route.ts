import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/server'
import { syncLineItemFromSelection } from '@/lib/selections'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user || !user.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const { selectionId } = body

    if (!selectionId || typeof selectionId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid selectionId' },
        { status: 400 }
      )
    }

    // Sync line items from selection
    await syncLineItemFromSelection(selectionId, user.id)

    return NextResponse.json({
      success: true,
      selectionId
    })

  } catch (error) {
    console.error('Sync line items error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}




