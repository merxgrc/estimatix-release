import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, requireAuth } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const DEFAULT_LABOR_RATE = 85
const OVERHEAD_PERCENT = 0.10 // 10% overhead

export async function POST(
  request: NextRequest,
  { params }: { params: { lineItemId: string } }
) {
  try {
    const { lineItemId } = params
    const body = await request.json()
    const { margin } = body

    if (!lineItemId) {
      return NextResponse.json(
        { error: 'Missing lineItemId parameter' },
        { status: 400 }
      )
    }

    if (margin === undefined || margin === null) {
      return NextResponse.json(
        { error: 'Missing margin parameter' },
        { status: 400 }
      )
    }

    // Get authenticated user
    const user = await requireAuth()
    if (!user || !user.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const supabase = await createServerClient()

    // Load the line item with estimate and project info
    const { data: lineItem, error: lineItemError } = await supabase
      .from('estimate_line_items')
      .select('*, estimates!inner(project_id, projects!inner(user_id))')
      .eq('id', lineItemId)
      .single()

    if (lineItemError || !lineItem) {
      return NextResponse.json(
        { error: 'Line item not found' },
        { status: 404 }
      )
    }

    // Verify ownership (access through project)
    const estimate = (lineItem as any).estimates
    if (!estimate) {
      return NextResponse.json(
        { error: 'Estimate not found' },
        { status: 404 }
      )
    }

    const project = estimate.projects
    if (!project || project.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Recalculate pricing based on existing cost breakdown
    const labor_cost = lineItem.labor_cost || 0
    const material_cost = lineItem.material_cost || 0
    const overhead_cost = lineItem.overhead_cost || ((labor_cost + material_cost) * OVERHEAD_PERCENT)
    const direct_cost = labor_cost + material_cost + overhead_cost
    const client_price = direct_cost * (1 + margin / 100)

    // Update the line item
    const { error: updateError } = await supabase
      .from('estimate_line_items')
      .update({
        margin_percent: margin,
        overhead_cost: Math.round(overhead_cost * 100) / 100,
        direct_cost: Math.round(direct_cost * 100) / 100,
        client_price: Math.round(client_price * 100) / 100
      })
      .eq('id', lineItemId)

    if (updateError) {
      console.error('Error updating line item:', updateError)
      return NextResponse.json(
        { error: `Failed to update line item: ${updateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      lineItemId,
      labor_cost: Math.round(labor_cost * 100) / 100,
      material_cost: Math.round(material_cost * 100) / 100,
      overhead_cost: Math.round(overhead_cost * 100) / 100,
      direct_cost: Math.round(direct_cost * 100) / 100,
      margin_percent: margin,
      client_price: Math.round(client_price * 100) / 100
    })

  } catch (error) {
    console.error('Recalculate pricing error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

