/**
 * POST /api/plans/parse
 * 
 * Phase 1 Blueprint/Plan Parsing Pipeline (Scalable 2-Pass Approach)
 * 
 * ARCHITECTURE:
 * - PASS 1: Document Map / Page Classification
 *   - Extract text from PDF pages
 *   - Sample pages for large documents (40+ pages)
 *   - Classify each page: floor_plan, schedule, notes, elevation, etc.
 *   - Identify pages_of_interest for deep parsing
 * 
 * - PASS 2: Deep Parse (only relevant pages)
 *   - Extract rooms and spaces
 *   - Generate line item scaffolds
 *   - NO PRICING - all pricing fields are null
 * 
 * RESILIENCE:
 * - Never throws at module load
 * - Returns safe fallback with "General / Scope Notes" room on failure
 * - Graceful degradation if AI fails
 * 
 * PERFORMANCE:
 * - Deep parse runs on small subset of pages (max 10)
 * - Text extraction is fast; vision used only for images
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, requireAuth, createServiceRoleClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import type { 
  PlanParseResult, 
  PagesOfInterest, 
  ParsedRoom as TypedParsedRoom, 
  ParsedLineItem as TypedParsedLineItem 
} from '@/types/db'

// Import plan parsing utilities
import {
  ParseRequestSchema,
  createFallbackResponse,
  type ExtractedRoom,
  type LineItemScaffold,
  type SheetParseResult,
  type PageClassification as SchemaPageClassification,
} from '@/lib/plans/schemas'

import {
  extractPdfPagesWithText,
  samplePagesForClassification,
  preparePagesForClassification,
  renderPdfPagesToImages,
  selectPagesForVisionAnalysis,
  detectPdfType,
  getPdfPageCount,
} from '@/lib/plans/pdf-utils'

import {
  classifyPagesWithAI,
  selectPagesForDeepParse,
  enrichClassificationsWithLevel,
  groupPagesByLevel,
  extractRoomsPerSheet,
  extractRoomsFromPagesWithAI,
  generateLineItemScaffoldWithAI,
  analyzeImageForRoomsWithAI,
  analyzeBase64ImagesForRooms,
} from '@/lib/plans/ai-classifier'

export const runtime = 'nodejs'
export const maxDuration = 120 // Allow up to 2 minutes for large documents

// =============================================================================
// Main Handler
// =============================================================================

export async function POST(req: NextRequest) {
  const startTime = Date.now()
  let planParseId: string | null = null
  let supabase: Awaited<ReturnType<typeof createServerClient>> | null = null
  
  try {
    // Auth check - returns safe error, doesn't throw
    let user
    try {
      user = await requireAuth()
    } catch {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    
    if (!user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Validate request
    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        createFallbackResponse('Invalid JSON in request body'),
        { status: 400 }
      )
    }
    
    console.log('[Plans Parse] Request body:', JSON.stringify(body, null, 2))
    
    const validation = ParseRequestSchema.safeParse(body)
    
    if (!validation.success) {
      console.error('[Plans Parse] Validation failed:', validation.error.errors)
      return NextResponse.json(
        createFallbackResponse(`Invalid request: ${validation.error.errors[0]?.message || 'Unknown error'}`),
        { status: 400 }
      )
    }

    const { projectId, estimateId, fileUrls: rawFileUrls, uploadId, uploadIds, resolveFromProject } = validation.data
    console.log('[Plans Parse] Validated:', { projectId, estimateId, rawFileUrls, uploadId, uploadIds, resolveFromProject })

    // Verify project ownership
    try {
      supabase = await createServerClient()
    } catch (error) {
      console.error('[Plans Parse] Supabase client error:', error)
      return NextResponse.json(
        createFallbackResponse('Database connection failed'),
        { status: 503 }
      )
    }
    
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .single()

    if (projectError || !project || project.user_id !== user.id) {
      return NextResponse.json(
        createFallbackResponse('Project not found or unauthorized'),
        { status: 403 }
      )
    }

    // Resolve file URLs: if client sent placeholder, look up from upload records
    let fileUrls = rawFileUrls.filter(u => u !== '__resolve_from_uploads__')
    
    // Resolve file URLs from upload IDs if provided
    if (fileUrls.length === 0 && uploadIds && uploadIds.length > 0) {
      console.log('[Plans Parse] Resolving file URLs from uploadIds:', uploadIds)
      const serviceClient = createServiceRoleClient()
      const { data: uploads, error: uploadsError } = await serviceClient
        .from('uploads')
        .select('id, file_url')
        .in('id', uploadIds)
        .eq('project_id', projectId)

      console.log('[Plans Parse] Upload records from DB:', JSON.stringify(uploads), 'error:', uploadsError?.message)

      if (uploads && uploads.length > 0) {
        fileUrls = uploads
          .map((u: { file_url: string }) => {
            const match = u.file_url?.match(/uploads\/(.+)$/)
            return match ? match[1] : ''
          })
          .filter((url: string) => url !== '')
      }
    }

    // Last resort: resolve from ALL blueprint uploads for this project
    if (fileUrls.length === 0 && resolveFromProject) {
      console.log('[Plans Parse] Resolving file URLs from project blueprint uploads')
      const serviceClient = createServiceRoleClient()
      const { data: uploads, error: uploadsError } = await serviceClient
        .from('uploads')
        .select('id, file_url, kind')
        .eq('project_id', projectId)
        .in('kind', ['blueprint', 'plan'])
        .order('created_at', { ascending: false })
        .limit(5)

      console.log('[Plans Parse] Project blueprint uploads:', JSON.stringify(uploads), 'error:', uploadsError?.message)

      if (uploads && uploads.length > 0) {
        fileUrls = uploads
          .map((u: { file_url: string }) => {
            const match = u.file_url?.match(/uploads\/(.+)$/)
            return match ? match[1] : ''
          })
          .filter((url: string) => url !== '')
      }
    }
    
    console.log('[Plans Parse] Final fileUrls:', fileUrls)

    if (fileUrls.length === 0) {
      return NextResponse.json(
        createFallbackResponse('No valid file URLs found. Please re-upload the file.'),
        { status: 400 }
      )
    }

    // Check OpenAI key
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return NextResponse.json(
        createFallbackResponse('AI service unavailable. OpenAI API key not configured.'),
        { status: 503 }
      )
    }

    // Reuse existing plan_parses record (created at upload) or create a new one
    try {
      // First check if there's an existing 'uploaded' row for this upload
      if (uploadId) {
        const { data: existing } = await supabase
          .from('plan_parses')
          .select('id')
          .eq('upload_id', uploadId)
          .eq('status', 'uploaded')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (existing) {
          planParseId = existing.id
          // Transition to processing
          await supabase
            .from('plan_parses')
            .update({
              status: 'processing',
              estimate_id: estimateId || null,
              file_urls: fileUrls,
              started_at: new Date().toISOString(),
            })
            .eq('id', planParseId)
        }
      }

      // If no existing row was found, create a new one
      if (!planParseId) {
        const { data: planParse, error: createError } = await supabase
          .from('plan_parses')
          .insert({
            project_id: projectId,
            estimate_id: estimateId || null,
            upload_id: uploadId || null,
            file_urls: fileUrls,
            status: 'processing',
            started_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (!createError && planParse) {
          planParseId = planParse.id
        }
      }
    } catch (error) {
      console.warn('[Plans Parse] Failed to create/reuse plan_parses record:', error)
      // Continue without tracking
    }

    // Initialize result accumulators
    const allRooms: ExtractedRoom[] = []
    const allLineItems: LineItemScaffold[] = []
    const allSheets: SheetParseResult[] = []
    const allAssumptions: string[] = []
    const allWarnings: string[] = []
    const allMissingInfo: string[] = []
    const allClassifications: SchemaPageClassification[] = []
    const allRelevantPages: number[] = []
    let totalPages = 0

    const serviceSupabase = createServiceRoleClient()

    // Process each file
    for (const storagePath of fileUrls) {
      const extension = storagePath.split('.').pop()?.toLowerCase()
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension || '')
      const isPdf = extension === 'pdf'

      if (isImage) {
        // Direct image analysis with vision
        try {
          const { data: { publicUrl } } = serviceSupabase.storage
            .from('uploads')
            .getPublicUrl(storagePath)

          const imageResult = await analyzeImageForRoomsWithAI(publicUrl, openaiApiKey)
          
          allRooms.push(...imageResult.rooms)
          allAssumptions.push(...imageResult.assumptions)
          allWarnings.push(...imageResult.warnings)
          allMissingInfo.push(...imageResult.missingInfo)
          totalPages += 1
        } catch (error) {
          console.error('[Plans Parse] Image analysis error:', error)
          allWarnings.push(`Failed to analyze image: ${storagePath.split('/').pop()}`)
        }
        
      } else if (isPdf) {
        // PDF processing with 2-pass approach
        try {
          // Download PDF
          console.log(`[Plans Parse] Downloading: uploads/${storagePath}`)
          const { data: fileData, error: downloadError } = await serviceSupabase.storage
            .from('uploads')
            .download(storagePath)

          if (downloadError || !fileData) {
            console.error('[Plans Parse] Download failed:', downloadError?.message || 'No data returned')
            allWarnings.push(`Failed to download file: ${storagePath.split('/').pop()}`)
            continue
          }

          const buffer = Buffer.from(await fileData.arrayBuffer())
          console.log(`[Plans Parse] Downloaded ${Math.round(buffer.length / 1024)}KB PDF`)
          
          // =====================================================
          // PASS 1: Document Map / Page Classification
          // =====================================================
          
          const extractionResult = await extractPdfPagesWithText(buffer)
          
          if (extractionResult.error) {
            allWarnings.push(extractionResult.error)
          }
          
          totalPages += extractionResult.totalPages
          
          // Detect PDF type: vector / scanned / mixed
          const fileBuffer = buffer
          const pdfType = detectPdfType(extractionResult, fileBuffer.length)
          console.log(`[Plans Parse] PDF type: ${pdfType.type} (text ratio ${(pdfType.textRatio * 100).toFixed(0)}%, ${pdfType.totalPages} pages, ${Math.round(fileBuffer.length / 1024)}KB)`)
          
          // Check if PDF is scanned (minimal text)
          const isScanned = pdfType.type === 'scanned'
          
          if (isScanned) {
            // Scanned PDFs need vision analysis - render pages to images
            allWarnings.push(`PDF detected as ${pdfType.type} (${pdfType.pagesWithText}/${pdfType.totalPages} pages with text). Using vision analysis.`)
            
            try {
              // When text extraction totally failed (0 pages), probe the PDF
              // for its real page count so we can still select pages for vision
              let effectiveTotalPages = extractionResult.totalPages
              if (effectiveTotalPages === 0) {
                const probed = await getPdfPageCount(buffer)
                if (probed > 0) {
                  effectiveTotalPages = probed
                  totalPages = Math.max(totalPages, effectiveTotalPages)
                  console.log(`[Plans Parse] Probed PDF: ${effectiveTotalPages} actual pages`)
                } else {
                  // Fallback: assume at least 3 pages and let renderPdfPagesToImages
                  // handle out-of-range gracefully
                  effectiveTotalPages = 3
                  console.warn('[Plans Parse] Could not probe page count, assuming 3 pages')
                }
              }

              // Select pages likely to contain floor plans (typically pages 2-4)
              const pagesToRender = selectPagesForVisionAnalysis(effectiveTotalPages, 3)
              console.log(`[Plans Parse] Rendering pages ${pagesToRender.join(', ')} for vision analysis`)
              
              // Render pages to images
              const renderedPages = await renderPdfPagesToImages(buffer, pagesToRender, 1.5)
              
              if (renderedPages.length > 0) {
                console.log(`[Plans Parse] Successfully rendered ${renderedPages.length} pages, sending to vision AI`)
                
                // Analyze with vision AI
                const visionResult = await analyzeBase64ImagesForRooms(renderedPages, openaiApiKey)
                
                if (visionResult.rooms.length > 0) {
                  allRooms.push(...visionResult.rooms)
                  allAssumptions.push(...visionResult.assumptions)
                  allWarnings.push(...visionResult.warnings)
                  allMissingInfo.push(...visionResult.missingInfo)
                  allAssumptions.push(`Analyzed ${renderedPages.length} rendered page(s) using vision AI`)
                  continue // Skip text-based processing - vision succeeded
                } else {
                  allWarnings.push('Vision analysis did not detect rooms from rendered pages.')
                  allMissingInfo.push('Floor plan pages may be cover sheets, notes, or unclear images')
                }
              } else {
                // FALLBACK: use the Supabase public URL directly with vision AI
                console.log('[Plans Parse] Local rendering failed, trying direct URL vision analysis')
                try {
                  const { data: { publicUrl } } = serviceSupabase.storage
                    .from('uploads')
                    .getPublicUrl(storagePath)
                  
                  if (publicUrl) {
                    console.log(`[Plans Parse] Using public URL for vision: ${publicUrl.substring(0, 80)}...`)
                    const imageResult = await analyzeImageForRoomsWithAI(publicUrl, openaiApiKey)
                    if (imageResult.rooms.length > 0) {
                      allRooms.push(...imageResult.rooms)
                      allAssumptions.push(...imageResult.assumptions)
                      allWarnings.push(...imageResult.warnings)
                      allMissingInfo.push(...imageResult.missingInfo)
                      allAssumptions.push('Analyzed document via public URL using vision AI')
                      continue
                    }
                  }
                } catch (urlVisionErr) {
                  console.warn('[Plans Parse] URL-based vision also failed:', urlVisionErr)
                }
                allWarnings.push('Could not render PDF pages to images for vision analysis.')
              }
            } catch (visionError) {
              console.warn('[Plans Parse] Vision analysis failed for scanned PDF:', visionError)
              allWarnings.push('Vision analysis unavailable for scanned PDF.')
            }
            
            // Continue with text-based fallback (may still find some text)
          }
          
          // Sample pages for classification (for large documents)
          const sampledPages = samplePagesForClassification(extractionResult.pages, 20)
          const pagesForClassification = preparePagesForClassification(sampledPages)
          
          // Classify pages
          const classificationResult = await classifyPagesWithAI({
            pages: pagesForClassification,
            apiKey: openaiApiKey,
          })
          
          // Convert to schema format and store
          const classifications: SchemaPageClassification[] = classificationResult.pages.map(c => ({
            pageNumber: c.pageNumber,
            type: c.type,
            confidence: c.confidence,
            hasRoomLabels: c.hasRoomLabels,
            reason: c.reason,
          }))
          
          allClassifications.push(...classifications)
          
          // =====================================================
          // NEW: Enrich classifications with level detection
          // =====================================================
          const enriched = enrichClassificationsWithLevel(
            classificationResult.pages,
            extractionResult.pages.map(p => ({
              pageNumber: p.pageNumber,
              text: p.text,
            }))
          )
          
          // Group pages by level for per-sheet extraction
          const sheetInfos = groupPagesByLevel(enriched)
          const relevantPageNumbers = sheetInfos.map(s => s.pageNumber)
          allRelevantPages.push(...relevantPageNumbers)
          
          // ─── Phase 1 Structured Logging: Sheet → Level mapping ───
          console.log(`[Plans Parse] ═══ SHEET CLASSIFICATION SUMMARY ═══`)
          console.log(`[Plans Parse] Detected ${sheetInfos.length} relevant sheet(s):`)
          for (const s of sheetInfos) {
            console.log(`[Plans Parse]   Sheet p${s.pageNumber}: "${s.sheetTitle}" → ${s.detectedLevel} (${s.classification}, confidence: ${s.confidence})`)
          }
          
          // =====================================================
          // PASS 2: Per-Sheet Room Extraction (deterministic)
          // =====================================================
          
          if (sheetInfos.length > 0) {
            const perSheetResult = await extractRoomsPerSheet({
              sheets: sheetInfos,
              pages: extractionResult.pages.map(p => ({
                pageNumber: p.pageNumber,
                text: p.text,
              })),
              apiKey: openaiApiKey,
            })
            
            allRooms.push(...perSheetResult.rooms)
            allAssumptions.push(...perSheetResult.assumptions)
            allWarnings.push(...perSheetResult.warnings)
            allMissingInfo.push(...perSheetResult.missingInfo)
            
            // ─── Phase 1 Structured Logging: Per-sheet room counts ───
            console.log(`[Plans Parse] ═══ ROOM EXTRACTION RESULTS ═══`)
            for (const sr of perSheetResult.sheetResults) {
              const roomTypes = sr.rooms.reduce((acc, r) => {
                const type = r.type || 'other'
                acc[type] = (acc[type] || 0) + 1
                return acc
              }, {} as Record<string, number>)
              console.log(`[Plans Parse]   Sheet p${sr.sheet.pageNumber} "${sr.sheet.sheetTitle}" (${sr.sheet.detectedLevel}): ` +
                `${sr.rooms.length} rooms → ${Object.entries(roomTypes).map(([t, c]) => `${c} ${t}`).join(', ')}`)
              for (const room of sr.rooms) {
                console.log(`[Plans Parse]     • "${room.name}" (${room.type || 'other'}) ` +
                  `dims=${room.dimensions || 'n/a'} area=${room.area_sqft || 'n/a'}sqft`)
              }
            }
            console.log(`[Plans Parse]   Total rooms (before dedup): ${perSheetResult.rooms.length}`)

            // Build sheet parse results for structured output
            for (const sr of perSheetResult.sheetResults) {
              allSheets.push({
                sheet_id: sr.sheet.pageNumber,
                sheet_title: sr.sheet.sheetTitle,
                detected_level: sr.sheet.detectedLevel,
                classification: sr.sheet.classification,
                confidence: sr.sheet.confidence,
                rooms: sr.rooms,
              })
            }
          } else {
            // Fallback: use legacy extraction on first 5 pages
            const fallbackPages = extractionResult.pages.slice(0, 5)
            const fallbackTexts = fallbackPages.map(p => p.text).filter(t => t.length > 0)
            
            if (fallbackTexts.length > 0) {
              allWarnings.push('No floor plan pages detected. Parsing first pages as fallback.')
              
              const roomsResult = await extractRoomsFromPagesWithAI({
                pageTexts: fallbackTexts,
                pageNumbers: fallbackPages.map(p => p.pageNumber),
                apiKey: openaiApiKey,
              })
              
              allRooms.push(...roomsResult.rooms)
              allAssumptions.push(...roomsResult.assumptions)
              allWarnings.push(...roomsResult.warnings)
              allMissingInfo.push(...roomsResult.missingInfo)
            }
          }

          // For mixed PDFs: if text-based extraction found no rooms, try
          // vision on the image-only pages (the ones without text)
          if (pdfType.type === 'mixed' && allRooms.length === 0 && pdfType.pagesWithoutText > 0) {
            try {
              const imageOnlyPages = extractionResult.pages
                .filter(p => !p.hasText)
                .map(p => p.pageNumber)
                .slice(0, 6) // Cap at 6 pages for cost control
              
              if (imageOnlyPages.length > 0) {
                allWarnings.push(`Mixed PDF: text extraction found no rooms. Trying vision on ${imageOnlyPages.length} image-only page(s).`)
                const rendered = await renderPdfPagesToImages(buffer, imageOnlyPages, 1.5)
                
                if (rendered.length > 0) {
                  const visionResult = await analyzeBase64ImagesForRooms(rendered, openaiApiKey)
                  allRooms.push(...visionResult.rooms)
                  allAssumptions.push(...visionResult.assumptions)
                  allWarnings.push(...visionResult.warnings)
                  allMissingInfo.push(...visionResult.missingInfo)
                }
              }
            } catch (mixedVisionErr) {
              console.warn('[Plans Parse] Mixed PDF vision fallback failed:', mixedVisionErr)
            }
          }
        } catch (error) {
          console.error('[Plans Parse] PDF processing error:', error)
          allWarnings.push(`PDF processing error: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      } else {
        allWarnings.push(`Unsupported file type: ${extension}`)
      }
    }

    // Deduplicate rooms by level + name (case-insensitive)
    // Rooms already have deterministic names from postProcessRooms, so
    // "Bathroom 1 – Level 2" and "Bathroom 2 – Level 2" are distinct.
    const seenKeys = new Set<string>()
    const uniqueRooms = allRooms.filter(room => {
      const key = `${(room.level || 'Level 1').toLowerCase()}::${room.name.toLowerCase().trim()}`
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })

    // ─── Phase 1 Structured Logging: Final room summary ───
    const roomsByLevel: Record<string, string[]> = {}
    for (const room of uniqueRooms) {
      const level = room.level || 'Level 1'
      if (!roomsByLevel[level]) roomsByLevel[level] = []
      roomsByLevel[level].push(room.name)
    }
    console.log(`[Plans Parse] ═══ FINAL ROOM SUMMARY (after dedup) ═══`)
    console.log(`[Plans Parse]   Total unique rooms: ${uniqueRooms.length}`)
    for (const [level, names] of Object.entries(roomsByLevel)) {
      console.log(`[Plans Parse]   ${level}: ${names.length} rooms → ${names.join(', ')}`)
    }
    const bathroomCount = uniqueRooms.filter(r => r.type === 'bathroom').length
    const bedroomCount = uniqueRooms.filter(r => r.type === 'bedroom').length
    if (bathroomCount > 0) console.log(`[Plans Parse]   Bathrooms: ${bathroomCount}`)
    if (bedroomCount > 0) console.log(`[Plans Parse]   Bedrooms: ${bedroomCount}`)

    // Generate line item scaffold for detected rooms
    let lineItems: LineItemScaffold[] = []
    if (uniqueRooms.length > 0) {
      try {
        lineItems = await generateLineItemScaffoldWithAI({
          rooms: uniqueRooms,
          apiKey: openaiApiKey,
        })
      } catch (error) {
        console.warn('[Plans Parse] Line item generation failed:', error)
        allWarnings.push('Line item scaffold generation failed. Add line items manually.')
      }
    }

    // Handle case where no rooms were found
    if (uniqueRooms.length === 0) {
      // Return fallback response with General room
      const processingTimeMs = Date.now() - startTime
      const fallbackResponse = createFallbackResponse(
        'No rooms were detected from the uploaded documents. This may be due to image-only PDFs, unclear layouts, or documents without room information.',
        totalPages,
        planParseId
      )
      
      // Add context
      fallbackResponse.assumptions = [
        ...allAssumptions,
        'Created fallback "General / Scope Notes" room for manual entry',
      ]
      fallbackResponse.warnings = [...allWarnings, ...fallbackResponse.warnings]
      fallbackResponse.pageClassifications = allClassifications
      fallbackResponse.totalPages = totalPages
      fallbackResponse.relevantPages = allRelevantPages
      fallbackResponse.processingTimeMs = processingTimeMs

      // Update plan_parses record
      if (planParseId && supabase) {
        await supabase
          .from('plan_parses')
          .update({
            status: 'parsed',
            parse_result_json: {
              rooms: fallbackResponse.rooms,
              lineItemScaffold: fallbackResponse.lineItemScaffold,
              assumptions: fallbackResponse.assumptions,
              warnings: fallbackResponse.warnings,
            } as unknown as Record<string, unknown>,
            pages_of_interest: {
              classifications: allClassifications,
              relevantPages: allRelevantPages,
              totalPages,
            } as unknown as Record<string, unknown>,
            source_file_pages: totalPages,
            processing_time_ms: processingTimeMs,
            parsed_at: new Date().toISOString(),
          })
          .eq('id', planParseId)
      }

      return NextResponse.json(fallbackResponse)
    }

    // Success path - transform to typed response
    const processingTimeMs = Date.now() - startTime

    const typedRooms: TypedParsedRoom[] = uniqueRooms.map(r => ({
      id: randomUUID(),
      name: r.name,
      level: r.level ?? 'Level 1', // Default until parser detects levels
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

    const typedLineItems: TypedParsedLineItem[] = lineItems.map(li => ({
      id: randomUUID(),
      description: li.description,
      category: li.category,
      cost_code: li.cost_code || null,
      room_name: li.room_name,
      quantity: li.quantity,
      unit: li.unit,
      notes: li.notes,
      // Phase 1: NO PRICING
      direct_cost: null,
      client_price: null,
    }))

    // Build typed parse result for storage
    const parseResultJson: PlanParseResult = {
      rooms: typedRooms,
      lineItemScaffold: typedLineItems,
      assumptions: allAssumptions,
      warnings: allWarnings,
      metadata: {
        model: 'gpt-4o',
        totalPages,
        relevantPages: allRelevantPages,
        processingTimeMs,
      }
    }

    const pagesOfInterest: PagesOfInterest = {
      classifications: allClassifications.map(c => ({
        pageNumber: c.pageNumber,
        classification: c.type,
        hasRoomLabels: c.hasRoomLabels,
        confidence: c.confidence,
      })),
      relevantPages: allRelevantPages,
      totalPages,
    }

    // Update plan_parses record with results
    if (planParseId && supabase) {
      await supabase
        .from('plan_parses')
        .update({
          status: 'parsed',
          parse_result_json: parseResultJson as unknown as Record<string, unknown>,
          pages_of_interest: pagesOfInterest as unknown as Record<string, unknown>,
          source_file_pages: totalPages,
          processing_time_ms: processingTimeMs,
          parsed_at: new Date().toISOString(),
        })
        .eq('id', planParseId)
    }

    return NextResponse.json({
      success: true,
      planParseId,
      rooms: typedRooms,
      lineItemScaffold: typedLineItems,
      sheets: allSheets.length > 0 ? allSheets : undefined,
      assumptions: allAssumptions,
      warnings: allWarnings,
      pageClassifications: allClassifications,
      totalPages,
      relevantPages: allRelevantPages,
      processingTimeMs,
    })

  } catch (error) {
    console.error('[Plans Parse] Unexpected error:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to parse plans'
    const processingTimeMs = Date.now() - startTime
    
    // Update plan_parses record with failure
    if (planParseId && supabase) {
      try {
        await supabase
          .from('plan_parses')
          .update({
            status: 'failed',
            error_message: errorMessage,
            error_code: 'PARSE_ERROR',
            parsed_at: new Date().toISOString(),
            processing_time_ms: processingTimeMs,
          })
          .eq('id', planParseId)
      } catch {
        // Ignore DB update error
      }
    }
    
    // Return safe fallback response
    const fallbackResponse = createFallbackResponse(errorMessage, 0, planParseId)
    fallbackResponse.processingTimeMs = processingTimeMs
    
    return NextResponse.json(fallbackResponse, { status: 500 })
  }
}
