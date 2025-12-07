import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, requireAuth } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { task_library_id, custom_unit_cost, notes } = body

    if (!task_library_id) {
      return NextResponse.json(
        { error: 'Missing task_library_id parameter' },
        { status: 400 }
      )
    }

    if (custom_unit_cost === undefined || custom_unit_cost === null) {
      return NextResponse.json(
        { error: 'Missing custom_unit_cost parameter' },
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

    // Check if override already exists
    const { data: existing, error: checkError } = await supabase
      .from('user_cost_library')
      .select('id')
      .eq('user_id', user.id)
      .eq('task_library_id', task_library_id)
      .maybeSingle()

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking for existing override:', checkError)
      return NextResponse.json(
        { error: `Failed to check for existing override: ${checkError.message}` },
        { status: 500 }
      )
    }

    // Upsert the override
    const { data, error: upsertError } = await supabase
      .from('user_cost_library')
      .upsert({
        user_id: user.id,
        task_library_id: task_library_id,
        custom_unit_cost: custom_unit_cost,
        notes: notes || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,task_library_id'
      })
      .select()
      .single()

    if (upsertError) {
      console.error('Error saving user override:', upsertError)
      return NextResponse.json(
        { error: `Failed to save override: ${upsertError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      id: data.id,
      message: 'User override saved successfully'
    })

  } catch (error) {
    console.error('Save user override error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}





