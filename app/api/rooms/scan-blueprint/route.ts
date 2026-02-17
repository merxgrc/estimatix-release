import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/server'
import { z } from 'zod'
import { detectLevelFromText, postProcessRooms } from '@/lib/plans/room-processor'
import { ExtractedRoomSchema, type ExtractedRoom } from '@/lib/plans/schemas'

export const runtime = 'nodejs'

const ScanBlueprintRequestSchema = z.object({
  projectId: z.string(),
  blueprintText: z.string().min(1, 'Blueprint text is required'),
})

/**
 * Extract rooms from blueprint text using GPT-4o-mini.
 * Now level-aware: detects building level and produces deterministic names.
 */
async function extractRoomsFromBlueprint(
  blueprintText: string,
  apiKey: string
): Promise<ExtractedRoom[]> {
  // Detect level from the text
  const detectedLevel = detectLevelFromText('', blueprintText)

  const systemPrompt = `You are an AI assistant that extracts room information from construction blueprints and architectural documents.

Your task is to identify ALL rooms/spaces mentioned in the blueprint text and extract:
1. Room name EXACTLY as labeled (expand abbreviations: MBR→Master Bedroom, BA→Bathroom, BR→Bedroom, KIT→Kitchen)
2. Room type: bedroom, bathroom, kitchen, living, dining, garage, closet, utility, laundry, hallway, foyer, office, basement, attic, deck, patio, porch, mudroom, pantry, storage, mechanical, other
3. Level: Building level detected from context. Use: "Level 1", "Level 2", "Basement", "Garage", "Attic". Default "${detectedLevel}".
4. Area in square feet if mentioned (number or null)
5. Dimensions if mentioned (e.g. "12'-0\\" x 14'-6\\"" or null)

Return ONLY a valid JSON object:
{
  "rooms": [
    {
      "name": "Room Name",
      "level": "Level 1",
      "type": "bedroom",
      "area_sqft": 250,
      "dimensions": "12' x 20'"
    }
  ]
}

CRITICAL RULES:
- Report EVERY distinct room. If text shows 3 bathrooms, return 3 separate entries.
- Do NOT merge rooms with the same type.
- Use clear, standard names (expand abbreviations).
- If area is mentioned, include as number.
- Return empty array if no rooms found.
- Do NOT include any pricing information.`

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
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `OpenAI API error: ${response.status} ${(errorData as { error?: { message?: string } }).error?.message || response.statusText}`
    )
  }

  const result = await response.json()
  const content = result.choices[0]?.message?.content

  if (!content) {
    throw new Error('No content returned from OpenAI')
  }

  // Parse JSON response
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content)
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const jsonString = jsonMatch[1] || jsonMatch[0]
      parsed = JSON.parse(jsonString.trim())
    } else {
      throw new Error('Invalid JSON response from AI')
    }
  }

  // Handle both { rooms: [...] } and direct array responses
  const rawRooms = (parsed as { rooms?: unknown[] }).rooms || (Array.isArray(parsed) ? parsed : [])

  // Validate with Zod
  const validatedRooms: ExtractedRoom[] = (rawRooms as Record<string, unknown>[])
    .map(r => {
      const validated = ExtractedRoomSchema.safeParse({
        name: r.name || 'Unnamed Room',
        level: r.level || detectedLevel,
        type: r.type || null,
        area_sqft: typeof r.area_sqft === 'number' ? r.area_sqft : null,
        dimensions: r.dimensions || null,
        confidence: 70,
      })
      return validated.success ? validated.data : null
    })
    .filter(Boolean) as ExtractedRoom[]

  // Group by level and apply deterministic naming
  const roomsByLevel = new Map<string, ExtractedRoom[]>()
  for (const room of validatedRooms) {
    const level = room.level || detectedLevel
    const existing = roomsByLevel.get(level) || []
    existing.push(room)
    roomsByLevel.set(level, existing)
  }

  const processedRooms: ExtractedRoom[] = []
  for (const [level, rooms] of roomsByLevel) {
    processedRooms.push(...postProcessRooms(rooms, level))
  }

  return processedRooms
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

    // Extract rooms from blueprint text (now with level detection + deterministic naming)
    const extractedRooms = await extractRoomsFromBlueprint(blueprintText, openaiApiKey)

    if (extractedRooms.length === 0) {
      return NextResponse.json({
        success: true,
        rooms: [],
        message: 'No rooms found in blueprint text',
      })
    }

    // Bulk insert rooms (with deduplication against existing)
    const existingRooms = await supabase
      .from('rooms')
      .select('name')
      .eq('project_id', projectId)

    const existingNames = new Set(
      (existingRooms.data || []).map((r: { name: string }) => r.name.toLowerCase().trim())
    )

    const roomsToInsert = extractedRooms
      .filter((room) => {
        const normalizedName = room.name.toLowerCase().trim()
        return !existingNames.has(normalizedName)
      })
      .map((room) => ({
        project_id: projectId,
        name: room.name.trim(),
        level: room.level || 'Level 1',
        type: room.type || null,
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
      .select('id, name, level, type, area_sqft')

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

