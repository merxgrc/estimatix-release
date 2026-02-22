/**
 * POST /api/plans/vision-fallback
 *
 * Client-side fallback for when server-side PDF rendering fails.
 * Accepts base64 page images rendered by PDF.js in the browser,
 * runs OpenAI vision analysis, and returns extracted rooms.
 *
 * Request body:
 * {
 *   projectId: string,
 *   estimateId?: string,
 *   pages: [{ pageNumber: number, base64: string }]  // max 5 pages
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/server'
import { analyzeBase64ImagesForRooms } from '@/lib/plans/ai-classifier'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { ParsedRoom as TypedParsedRoom } from '@/types/db'

export const runtime = 'nodejs'
export const maxDuration = 60

const RequestSchema = z.object({
  projectId: z.string().uuid(),
  estimateId: z.string().uuid().optional(),
  pages: z.array(z.object({
    pageNumber: z.number().int().positive(),
    base64: z.string().min(100), // at least a tiny image
  })).min(1).max(5),
})

export async function POST(req: NextRequest) {
  try {
    let user
    try {
      user = await requireAuth()
    } catch {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (!user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await req.json()
    const validation = RequestSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.errors[0]?.message || 'Invalid request' }, { status: 400 })
    }

    const { pages } = validation.data

    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return NextResponse.json({ error: 'AI service unavailable' }, { status: 503 })
    }

    console.log(`[Vision Fallback] Analyzing ${pages.length} client-rendered pages`)
    const visionResult = await analyzeBase64ImagesForRooms(pages, openaiApiKey)

    const typedRooms: TypedParsedRoom[] = visionResult.rooms.map(r => ({
      id: randomUUID(),
      name: r.name,
      level: r.level ?? 'Level 1',
      type: r.type,
      area_sqft: r.area_sqft,
      length_ft: r.length_ft ?? null,
      width_ft: r.width_ft ?? null,
      ceiling_height_ft: r.ceiling_height_ft ?? null,
      dimensions: r.dimensions,
      notes: r.notes,
      confidence: r.confidence,
      is_included: true,
    }))

    return NextResponse.json({
      success: true,
      rooms: typedRooms,
      assumptions: visionResult.assumptions,
      warnings: visionResult.warnings,
      missingInfo: visionResult.missingInfo,
    })
  } catch (error) {
    console.error('[Vision Fallback] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Vision analysis failed' },
      { status: 500 }
    )
  }
}
