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

const BATCH_SIZE = 10
const DELAY_BETWEEN_BATCHES = 1000 // 1 second delay to avoid rate limits

export async function POST(request: NextRequest) {
  try {
    // Check for OpenAI API key
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      )
    }

    // Fetch all tasks without embeddings
    const { data: tasks, error: fetchError } = await supabase
      .from('task_library')
      .select('id, description')
      .is('embedding', null)
      .not('description', 'is', null)

    if (fetchError) {
      return NextResponse.json(
        { error: `Failed to fetch tasks: ${fetchError.message}` },
        { status: 500 }
      )
    }

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({
        updated: 0,
        message: 'No tasks need embeddings'
      })
    }

    let updatedCount = 0
    const errors: string[] = []

    // Process in batches
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE)

      // Process batch in parallel
      await Promise.all(
        batch.map(async (task) => {
          try {
            if (!task.description) {
              return
            }

            // Generate embedding
            const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'text-embedding-3-small',
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

            // Save embedding
            const { error: updateError } = await supabase
              .from('task_library')
              .update({ embedding })
              .eq('id', task.id)

            if (updateError) {
              throw new Error(`Failed to save: ${updateError.message}`)
            }

            updatedCount++
          } catch (error) {
            const errorMsg = `Task ${task.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
            errors.push(errorMsg)
            console.error(errorMsg)
          }
        })
      )

      // Delay between batches to avoid rate limits
      if (i + BATCH_SIZE < tasks.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES))
      }
    }

    return NextResponse.json({
      updated: updatedCount,
      total: tasks.length,
      errors: errors.length > 0 ? errors : undefined
    })

  } catch (error) {
    console.error('Embed all tasks error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}




