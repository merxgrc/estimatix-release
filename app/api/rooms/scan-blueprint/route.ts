import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const ScanBlueprintRequestSchema = z.object({
  projectId: z.string(),
  blueprintText: z.string().min(1, 'Blueprint text is required'),
})

const RoomSchema = z.object({
  name: z.string(),
  type: z.string().nullable().optional(),
  area_sqft: z.number().nullable().optional(),
})

const ExtractRoomsResponseSchema = z.object({
  rooms: z.array(RoomSchema),
})

/**
 * Extract rooms from blueprint text using GPT-4o-mini
 */
async function extractRoomsFromBlueprint(
  blueprintText: string,
  apiKey: string
): Promise<Array<{ name: string; type?: string | null; area_sqft?: number | null }>> {
  const systemPrompt = `You are an AI assistant that extracts room information from construction blueprints and architectural documents.

Your task is to identify all rooms/spaces mentioned in the blueprint text and extract:
1. Room name (e.g., "Master Bedroom", "Kitchen", "Primary Bath")
2. Room type (e.g., "bedroom", "kitchen", "bathroom", "living room", etc.) - optional
3. Area in square feet if mentioned - optional

Return ONLY a valid JSON object with this structure:
{
  "rooms": [
    {
      "name": "Room Name",
      "type": "room type" or null,
      "area_sqft": number or null
    }
  ]
}

Rules:
- Extract only distinct rooms (don't duplicate)
- Use clear, standard room names (e.g., "Master Bedroom" not "MBR", "Kitchen" not "Kit")
- If area is mentioned in the text, include it as a number
- If type is unclear, set it to null
- Return empty array if no rooms found
- Do NOT include any other text, only the JSON object`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Extract all rooms from this blueprint text:\n\n${blueprintText}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `OpenAI API error: ${response.status} ${errorData.error?.message || response.statusText}`
    )
  }

  const result = await response.json()
  const content = result.choices[0]?.message?.content

  if (!content) {
    throw new Error('No content returned from OpenAI')
  }

  // Parse JSON response
  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch (parseError) {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const jsonString = jsonMatch[1] || jsonMatch[0]
      parsed = JSON.parse(jsonString.trim())
    } else {
      throw new Error('Invalid JSON response from AI')
    }
  }

  // Handle both { rooms: [...] } and direct array responses
  const rooms = parsed.rooms || (Array.isArray(parsed) ? parsed : [])
  
  // Validate and return
  const validated = ExtractRoomsResponseSchema.parse({ rooms })
  return validated.rooms
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user || !user.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await req.json()
    const validation = ScanBlueprintRequestSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { projectId, blueprintText } = validation.data

    // Verify project ownership
    const supabase = await createServerClient()
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (project.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized: Project does not belong to user' },
        { status: 403 }
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

    // Extract rooms from blueprint text
    const extractedRooms = await extractRoomsFromBlueprint(blueprintText, openaiApiKey)

    if (extractedRooms.length === 0) {
      return NextResponse.json({
        success: true,
        rooms: [],
        message: 'No rooms found in blueprint text',
      })
    }

    // Bulk insert rooms (with deduplication)
    const existingRooms = await supabase
      .from('rooms')
      .select('name')
      .eq('project_id', projectId)

    const existingNames = new Set(
      (existingRooms.data || []).map((r: any) => r.name.toLowerCase().trim())
    )

    const roomsToInsert = extractedRooms
      .filter((room) => {
        const normalizedName = room.name.toLowerCase().trim()
        return !existingNames.has(normalizedName)
      })
      .map((room) => ({
        project_id: projectId,
        name: room.name.trim(),
        type: room.type?.trim() || null,
        area_sqft: room.area_sqft || null,
        source: 'blueprint',
        is_active: true,
      }))

    if (roomsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        rooms: [],
        message: 'All rooms already exist',
      })
    }

    const { data: insertedRooms, error: insertError } = await supabase
      .from('rooms')
      .insert(roomsToInsert)
      .select('id, name, type, area_sqft')

    if (insertError) {
      console.error('Error inserting rooms:', insertError)
      return NextResponse.json(
        { error: `Failed to insert rooms: ${insertError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      rooms: insertedRooms || [],
      message: `Created ${insertedRooms?.length || 0} new rooms from blueprint`,
    })
  } catch (error) {
    console.error('Blueprint scan error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to scan blueprint',
      },
      { status: 500 }
    )
  }
}

