import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

// Use service role for admin operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { taskId } = body

    if (!taskId) {
      return NextResponse.json(
        { error: 'Missing taskId parameter' },
        { status: 400 }
      )
    }

    // Fetch task description
    const { data: task, error: fetchError } = await supabase
      .from('task_library')
      .select('id, description')
      .eq('id', taskId)
      .single()

    if (fetchError || !task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }

    if (!task.description) {
      return NextResponse.json(
        { error: 'Task has no description' },
        { status: 400 }
      )
    }

    // Check for OpenAI API key
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      )
    }

    // Generate embedding using OpenAI
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-large',
        input: task.description,
      }),
    })

    if (!embeddingResponse.ok) {
      const errorData = await embeddingResponse.json().catch(() => ({}))
      throw new Error(`OpenAI API error: ${errorData.error?.message || embeddingResponse.statusText}`)
    }

    const embeddingData = await embeddingResponse.json()
    const embedding = embeddingData.data[0]?.embedding

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response from OpenAI')
    }

    // Save embedding to database
    const { error: updateError } = await supabase
      .from('task_library')
      .update({ embedding })
      .eq('id', taskId)

    if (updateError) {
      console.error('Error saving embedding:', updateError)
      return NextResponse.json(
        { error: `Failed to save embedding: ${updateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      taskId,
      status: 'ok'
    })

  } catch (error) {
    console.error('Embed task error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}







