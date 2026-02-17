/**
 * POST /api/plans/test-parse
 *
 * Test harness for the blueprint parsing pipeline.
 * Accepts a PDF upload via multipart/form-data and returns structured
 * parse output WITHOUT writing to the database.
 *
 * Use this endpoint to verify:
 * - Level detection per sheet
 * - Room counts match the plan
 * - Deterministic naming (e.g. "Bathroom 1 – Level 2")
 * - Dimension parsing
 *
 * Request: multipart/form-data with field "file" (PDF or image)
 * Response: JSON with sheets[], rooms[], pageClassifications[]
 *
 * IMPORTANT: This endpoint is for development/testing only.
 * It requires authentication but does NOT write to DB.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/server'

import {
  extractPdfPagesWithText,
  samplePagesForClassification,
  preparePagesForClassification,
  detectPdfType,
  renderPdfPagesToImages,
  selectPagesForVisionAnalysis,
  getPdfPageCount,
} from '@/lib/plans/pdf-utils'

import {
  classifyPagesWithAI,
  enrichClassificationsWithLevel,
  groupPagesByLevel,
  extractRoomsPerSheet,
  extractRoomsFromPagesWithAI,
  analyzeBase64ImagesForRooms,
} from '@/lib/plans/ai-classifier'

import type { ExtractedRoom } from '@/lib/plans/schemas'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const startTime = Date.now()

  try {
    // Auth check
    let user
    try {
      user = await requireAuth()
    } catch {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (!user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Check OpenAI key
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 })
    }

    // Parse multipart form data
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided. Send multipart/form-data with field "file".' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)
    const isPdf = extension === 'pdf'

    if (!isImage && !isPdf) {
      return NextResponse.json({ error: `Unsupported file type: ${extension}` }, { status: 400 })
    }

    console.log(`[Test Parse] Processing ${file.name} (${Math.round(buffer.length / 1024)}KB, ${extension})`)

    // =========================================================================
    // Image path
    // =========================================================================
    if (isImage) {
      // For images, we can't use vision with a local buffer easily,
      // so just report that the test harness is for PDFs
      return NextResponse.json({
        error: 'Test harness currently supports PDF files only. For images, use the main /api/plans/parse endpoint.',
      }, { status: 400 })
    }

    // =========================================================================
    // PDF path
    // =========================================================================

    // Step 1: Extract text
    const extractionResult = await extractPdfPagesWithText(buffer)
    const pdfType = detectPdfType(extractionResult, buffer.length)

    console.log(`[Test Parse] PDF type: ${pdfType.type}, ${extractionResult.totalPages} pages, ` +
      `${extractionResult.pages.filter(p => p.hasText).length} with text`)

    // Step 2: Handle scanned PDFs via vision
    if (pdfType.type === 'scanned') {
      let effectiveTotalPages = extractionResult.totalPages
      if (effectiveTotalPages === 0) {
        effectiveTotalPages = await getPdfPageCount(buffer) || 3
      }

      const pagesToRender = selectPagesForVisionAnalysis(effectiveTotalPages, 5)
      const renderedPages = await renderPdfPagesToImages(buffer, pagesToRender, 1.5)

      if (renderedPages.length > 0) {
        const visionResult = await analyzeBase64ImagesForRooms(renderedPages, openaiApiKey)
        return NextResponse.json({
          success: true,
          method: 'vision',
          pdfType: pdfType.type,
          totalPages: effectiveTotalPages,
          renderedPages: renderedPages.length,
          rooms: visionResult.rooms,
          roomCount: visionResult.rooms.length,
          roomsByLevel: groupRoomsByLevel(visionResult.rooms),
          assumptions: visionResult.assumptions,
          warnings: visionResult.warnings,
          processingTimeMs: Date.now() - startTime,
        })
      }

      return NextResponse.json({
        success: false,
        method: 'vision',
        pdfType: pdfType.type,
        totalPages: effectiveTotalPages,
        error: 'Could not render pages for vision analysis',
        processingTimeMs: Date.now() - startTime,
      })
    }

    // Step 3: Pass 1 — Classify pages
    const sampledPages = samplePagesForClassification(extractionResult.pages, 20)
    const pagesForClassification = preparePagesForClassification(sampledPages)
    const classificationResult = await classifyPagesWithAI({
      pages: pagesForClassification,
      apiKey: openaiApiKey,
    })

    // Step 4: Enrich with level detection
    const enriched = enrichClassificationsWithLevel(
      classificationResult.pages,
      extractionResult.pages.map(p => ({ pageNumber: p.pageNumber, text: p.text }))
    )

    const sheetInfos = groupPagesByLevel(enriched)

    // ─── Phase 1 Structured Logging: Sheet → Level mapping ───
    console.log(`[Test Parse] ═══ SHEET CLASSIFICATION SUMMARY ═══`)
    console.log(`[Test Parse] Detected ${sheetInfos.length} relevant sheet(s):`)
    for (const s of sheetInfos) {
      console.log(`[Test Parse]   Sheet p${s.pageNumber}: "${s.sheetTitle}" → ${s.detectedLevel} (${s.classification}, confidence: ${s.confidence})`)
    }

    // Step 5: Pass 2 — Per-sheet room extraction
    let rooms: ExtractedRoom[] = []
    let sheetResults: Array<{
      sheet_id: number
      sheet_title: string
      detected_level: string
      classification: string
      room_count: number
      rooms: ExtractedRoom[]
    }> = []
    let method = 'per-sheet'

    if (sheetInfos.length > 0) {
      const perSheetResult = await extractRoomsPerSheet({
        sheets: sheetInfos,
        pages: extractionResult.pages.map(p => ({ pageNumber: p.pageNumber, text: p.text })),
        apiKey: openaiApiKey,
      })

      rooms = perSheetResult.rooms

      // ─── Phase 1 Structured Logging: Per-sheet room counts ───
      console.log(`[Test Parse] ═══ ROOM EXTRACTION RESULTS ═══`)
      for (const sr of perSheetResult.sheetResults) {
        console.log(`[Test Parse]   Sheet p${sr.sheet.pageNumber} "${sr.sheet.sheetTitle}" (${sr.sheet.detectedLevel}): ${sr.rooms.length} rooms`)
        for (const room of sr.rooms) {
          console.log(`[Test Parse]     • "${room.name}" (${room.type || 'other'}) dims=${room.dimensions || 'n/a'}`)
        }
      }
      console.log(`[Test Parse]   Total rooms: ${rooms.length}`)

      sheetResults = perSheetResult.sheetResults.map(sr => ({
        sheet_id: sr.sheet.pageNumber,
        sheet_title: sr.sheet.sheetTitle,
        detected_level: sr.sheet.detectedLevel,
        classification: sr.sheet.classification,
        room_count: sr.rooms.length,
        rooms: sr.rooms,
      }))
    } else {
      // Fallback to legacy extraction
      method = 'legacy-fallback'
      const fallbackPages = extractionResult.pages.slice(0, 5)
      const fallbackTexts = fallbackPages.map(p => p.text).filter(t => t.length > 0)

      if (fallbackTexts.length > 0) {
        const result = await extractRoomsFromPagesWithAI({
          pageTexts: fallbackTexts,
          pageNumbers: fallbackPages.map(p => p.pageNumber),
          apiKey: openaiApiKey,
        })
        rooms = result.rooms
      }
    }

    // Build response
    return NextResponse.json({
      success: true,
      method,
      pdfType: pdfType.type,
      totalPages: extractionResult.totalPages,
      pagesWithText: extractionResult.pages.filter(p => p.hasText).length,

      // Sheet-level detail
      sheets: sheetResults,
      sheetsDetected: sheetResults.length,

      // All rooms (deduplicated)
      rooms,
      roomCount: rooms.length,
      roomsByLevel: groupRoomsByLevel(rooms),
      roomsByType: groupRoomsByType(rooms),

      // Page classifications with level info
      pageClassifications: enriched.map(c => ({
        pageNumber: c.pageNumber,
        type: c.type,
        confidence: c.confidence,
        hasRoomLabels: c.hasRoomLabels,
        detectedLevel: c.detectedLevel,
        sheetTitle: c.sheetTitle,
        reason: c.reason,
      })),

      processingTimeMs: Date.now() - startTime,
    })

  } catch (error) {
    console.error('[Test Parse] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      processingTimeMs: Date.now() - startTime,
    }, { status: 500 })
  }
}

// Helper: group rooms by level for summary
function groupRoomsByLevel(rooms: ExtractedRoom[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const room of rooms) {
    const level = room.level || 'Level 1'
    result[level] = (result[level] || 0) + 1
  }
  return result
}

// Helper: group rooms by type for summary
function groupRoomsByType(rooms: ExtractedRoom[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const room of rooms) {
    const type = room.type || 'other'
    result[type] = (result[type] || 0) + 1
  }
  return result
}
