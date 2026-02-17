import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import PDFParser from 'pdf2json'
import { createServerClient, createServiceRoleClient, requireAuth } from '@/lib/supabase/server'
// Phase 1: Pricing imports removed per PHASE_1_RELEASE_CHECKLIST.md
// - matchTask, applyPricing removed - copilot must NOT enrich actions with pricing
// - fuzzyScore kept for room name matching only
import { fuzzyScore } from '@/lib/pricing/fuzzy'
import { isAreaBasedItem } from '@/lib/area-mapping'

export const runtime = 'nodejs' // Disable Edge runtime for OpenAI API compatibility

/**
 * =============================================================================
 * PHASE 1 COPILOT - STRUCTURED ACTIONS ONLY, NO PRICING
 * =============================================================================
 * 
 * This copilot is restricted to Phase 1 scope per PHASE_1_RELEASE_CHECKLIST.md:
 * - Allowed actions: add_room, add_line_item, update_line_item, hide_room, info
 * - Pricing fields are IGNORED and stored as NULL (direct_cost, client_price, etc.)
 * - Chat must NEVER suggest or auto-fill prices
 * - No pricing suggestions, no market data, no historical pricing
 * 
 * EXAMPLE PROMPTS AND EXPECTED ACTIONS:
 * 
 * 1. "Add a master bedroom with 7 windows"
 *    Expected actions:
 *    - { type: "add_room", data: { name: "Master Bedroom" } }
 *    - { type: "add_line_item", data: { description: "Windows", quantity: 7, unit: "EA", room: "Master Bedroom" } }
 * 
 * 2. "We're not doing the kitchen anymore"
 *    Expected actions:
 *    - { type: "hide_room", data: { room_name: "Kitchen" } }
 * 
 * 3. "Add demolition of existing flooring, 500 square feet"
 *    Expected actions:
 *    - { type: "add_line_item", data: { description: "Demolition of existing flooring", quantity: 500, unit: "SF", room: "General" } }
 * 
 * 4. "Change the windows from 7 to 10"
 *    Expected actions:
 *    - { type: "update_line_item", data: { line_item_id: "...", quantity: 10 } }
 * 
 * 5. "Create rooms for Kitchen, Primary Bath, and Living Room"
 *    Expected actions:
 *    - { type: "add_room", data: { name: "Kitchen" } }
 *    - { type: "add_room", data: { name: "Primary Bath" } }
 *    - { type: "add_room", data: { name: "Living Room" } }
 * 
 * =============================================================================
 */

/**
 * Custom error class for PDF processing errors
 * Used to provide specific error codes and status codes for frontend handling
 */
class PDFProcessingError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message)
    this.name = 'PDFProcessingError'
  }
}

// Helper: parse PDF with pdf-parse and fallback to pdf2json
async function parsePdfWithFallback(buffer: Buffer, storagePath: string): Promise<{ text: string; numpages: number }> {
  // Primary: pdf-parse
  try {
    const pdfParseModule = await import('pdf-parse')
    const pdfParse = (pdfParseModule as any).default || pdfParseModule
    const pdfData = await pdfParse(buffer)
    return {
      text: pdfData.text || '',
      numpages: pdfData.numpages || 0,
    }
  } catch (primaryErr) {
    console.warn(`[PDF Warning] pdf-parse failed for ${storagePath}, switching to pdf2json fallback`, primaryErr)

    // Fallback: pdf2json (event-based)
    try {
      const parser = new PDFParser(undefined, true) // true = raw text mode
      const text = await new Promise<string>((resolve, reject) => {
        parser.on('pdfParser_dataError', (errData: any) => reject(errData?.parserError || errData))
        parser.on('pdfParser_dataReady', (pdfData: any) => {
          try {
            const rawText = typeof parser.getRawTextContent === 'function'
              ? parser.getRawTextContent()
              : ''
            resolve(rawText || '')
          } catch (e) {
            reject(e)
          }
        })
        parser.parseBuffer(buffer)
      })

      // Attempt to read page count from pdf2json structure
      let pageCount = 0
      try {
        const pdfData = (parser as any).pdfDocument
        pageCount = pdfData?.formImage?.Pages?.length ?? 0
      } catch {
        pageCount = 0
      }

      return { text, numpages: pageCount }
    } catch (fallbackErr) {
      console.error(`[PDF Error] pdf2json fallback failed for ${storagePath}:`, fallbackErr)
      throw new PDFProcessingError(
        'PDF file is corrupted or incompatible.',
        'PARSE_ERROR',
        422,
        {
          storagePath,
          errorMessage: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
          parser: 'pdf2json',
        }
      )
    }
  }
}

// Zod schema for the Copilot request
const CopilotRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string()
  })),
  projectId: z.string(),
  currentLineItems: z.array(z.object({
    id: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    cost_code: z.string().optional().nullable(),
    room_name: z.string().optional().nullable(),
    quantity: z.number().optional().nullable(),
    unit: z.string().optional().nullable()
  })).optional().default([]),
  recentActions: z.array(z.object({
    type: z.string(),
    success: z.boolean(),
    id: z.string().optional(),
    description: z.string().optional(),
    created_items: z.array(z.object({
      id: z.string(),
      description: z.string()
    })).optional()
  })).optional().default([]), // Recently executed actions from previous turns
  audio: z.any().optional(), // File or undefined
  fileUrls: z.array(z.string()).optional().default([]) // Storage paths for files
})

// Zod schema for the AI response
// Phase 1: Restricted to structural actions only - no pricing actions
const CopilotResponseSchema = z.object({
  response_text: z.string(),
  actions: z.array(z.object({
    // Phase 1 allowed actions only:
    // - add_line_item: Create line items (description, quantity, unit, room - NO PRICING)
    // - update_line_item: Update quantity, room, description (NO PRICING)
    // - add_room: Create new rooms
    // - hide_room: Toggle room inclusion (is_active = false)
    // - info: Informational responses
    // Removed from Phase 1: delete_line_item, set_margin_rule, update_task_price, review_pricing
    type: z.enum(['add_line_item', 'update_line_item', 'add_room', 'hide_room', 'info']),
    data: z.record(z.any())
  }))
})

type CopilotResponse = z.infer<typeof CopilotResponseSchema>

export async function POST(req: NextRequest) {
  try {
    // Get authenticated user
    const user = await requireAuth()
    if (!user || !user.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Parse request body - handle both JSON and FormData
    let body: any
    const contentType = req.headers.get('content-type') || ''
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const audioFile = formData.get('audio') as File | null
      const messagesJson = formData.get('messages') as string
      const projectId = formData.get('projectId') as string
      const currentLineItemsJson = formData.get('currentLineItems') as string
      const recentActionsJson = formData.get('recentActions') as string
      const fileUrlsJson = formData.get('fileUrls') as string
      
      body = {
        messages: messagesJson ? JSON.parse(messagesJson) : [],
        projectId,
        currentLineItems: currentLineItemsJson ? JSON.parse(currentLineItemsJson) : [],
        recentActions: recentActionsJson ? JSON.parse(recentActionsJson) : [],
        audio: audioFile || undefined,
        fileUrls: fileUrlsJson ? JSON.parse(fileUrlsJson) : []
      }
    } else {
      body = await req.json()
    }
    
    const validation = CopilotRequestSchema.safeParse(body)
    
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { messages, projectId, currentLineItems = [], audio, fileUrls = [], recentActions = [] } = validation.data

    // Verify project ownership
    const supabase = await createServerClient()
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, title')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    // If audio is provided, transcribe it first
    let userMessage = messages[messages.length - 1]?.content || ''
    if (audio) {
      try {
        const transcript = await transcribeAudio(audio)
        userMessage = transcript
        // Replace the last message content with the transcript
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content: transcript
        }
      } catch (error) {
        console.error('Transcription error:', error)
        return NextResponse.json(
          { error: 'Failed to transcribe audio' },
          { status: 500 }
        )
      }
    }

    // Process attached files (images and PDFs)
    let fileContext = ''
    let imageUrls: string[] = []
    if (fileUrls.length > 0) {
      try {
        fileContext = await processFiles(supabase, fileUrls)
        imageUrls = await getImageUrls(supabase, fileUrls)
      } catch (error) {
        console.error('[Copilot] File processing error:', error)
        
        // Handle PDFProcessingError with specific status codes and error codes
        if (error instanceof PDFProcessingError) {
          // Ensure details are serializable (remove any non-serializable objects)
          let serializableDetails: any = undefined
          if (error.details && typeof error.details === 'object') {
            try {
              // Use JSON serialization to ensure only plain objects are included
              const serialized = JSON.stringify(error.details, (key, value) => {
                // Filter out functions, undefined, and other non-serializable values
                if (typeof value === 'function' || value === undefined) {
                  return null
                }
                // Convert Error objects to plain objects
                if (value instanceof Error) {
                  return {
                    name: value.name,
                    message: value.message,
                  }
                }
                // Skip circular references
                if (typeof value === 'object' && value !== null) {
                  try {
                    JSON.stringify(value)
                  } catch {
                    return null
                  }
                }
                return value
              })
              serializableDetails = JSON.parse(serialized)
            } catch (serializeError) {
              console.error('[Copilot] Failed to serialize error details:', serializeError)
              // If serialization fails, just include a simple message
              serializableDetails = { 
                message: 'Error details could not be serialized',
                originalMessage: error.message
              }
            }
          }
          
          return NextResponse.json(
            {
              error: error.message,
              code: error.code,
              ...(serializableDetails !== undefined && { details: serializableDetails }),
            },
            { status: error.statusCode }
          )
        }
        
        // Generic error handling
        return NextResponse.json(
          { error: `Failed to process files: ${error instanceof Error ? error.message : 'Unknown error'}` },
          { status: 500 }
        )
      }
    }

    // Get or create estimate for this project
    let estimateId: string
    const { data: existingEstimate } = await supabase
      .from('estimates')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingEstimate) {
      estimateId = existingEstimate.id
    } else {
      // Create a new estimate — only required columns
      const { data: newEstimate, error: createError } = await supabase
        .from('estimates')
        .insert({
          project_id: projectId,
          user_id: user.id,
          title: 'Estimate',
          status: 'draft',
        })
        .select('id')
        .single()

      if (createError || !newEstimate) {
        console.error('[Copilot] Failed to create estimate:', createError)
        return NextResponse.json(
          { error: `Failed to create estimate: ${createError?.message || 'unknown'}` },
          { status: 500 }
        )
      }
      estimateId = newEstimate.id
      console.log('[Copilot] Created new estimate:', estimateId)
    }

    // Fetch existing rooms for the project
    // Gracefully handle missing columns (project_id, is_active) if migration 033 not run
    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('id, name, type, is_active')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('name', { ascending: true })
    
    if (roomsError) {
      console.warn('[Copilot] Could not fetch rooms (migration may not be applied):', roomsError.message)
    }

    // Build system prompt for the AI
    // Note: recentActions will be populated from previous turns by the frontend
    const systemPrompt = buildSystemPrompt(currentLineItems, project, fileContext, rooms || [], recentActions)

    // Enhance user message with file context if present
    const enhancedMessages = [...messages]
    if (fileContext) {
      // Add file context to the last user message
      enhancedMessages[enhancedMessages.length - 1] = {
        ...enhancedMessages[enhancedMessages.length - 1],
        content: `${enhancedMessages[enhancedMessages.length - 1].content}\n\n[File Content]\n${fileContext}`
      }
    }

    // Call OpenAI
    // Phase 1: Return 503 if OpenAI key missing (graceful degradation)
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'AI service temporarily unavailable. OpenAI API key not configured.' },
        { status: 503 }
      )
    }

    const aiResponse = await callCopilotAI(
      systemPrompt,
      enhancedMessages,
      openaiApiKey,
      imageUrls
    )

    // Phase 1: NO pricing enrichment - copilot must NOT enrich actions with pricing
    // All pricing fields will be stored as NULL - users enter prices manually in the UI
    // The aiResponse.actions are used directly without any pricing lookup

    // Execute actions (NO pricing - all pricing fields stored as NULL)
    let executedActions: Array<{ type: string; success: boolean; id?: string; error?: string }> = []
    let actionExecutionError: string | null = null
    try {
      executedActions = await executeActions(
        aiResponse.actions, // Use actions directly - NO enrichment
        estimateId,
        projectId,
        user.id,
        supabase
      )
      console.log('[Copilot] Action results:', JSON.stringify(executedActions))
    } catch (actionError) {
      const errMsg = actionError instanceof Error ? actionError.message : String(actionError)
      console.error('[Copilot] Error executing actions:', errMsg, actionError)
      actionExecutionError = errMsg
      // Still continue — save conversation and return the error info
      executedActions = aiResponse.actions.map((a: any) => ({
        type: a.type,
        success: false,
        error: errMsg
      }))
    }

    // Save user message to chat_messages
    try {
      await supabase.from('chat_messages').insert({
        project_id: projectId,
        role: 'user',
        content: userMessage,
        related_action: null
      })
    } catch (msgError) {
      console.error('Error saving user message:', msgError)
      // Continue even if message save fails
    }

    // Save assistant response to chat_messages
    try {
      const relatedActionJson = JSON.stringify({
        actions: executedActions,
        response_text: aiResponse.response_text
      })
      await supabase.from('chat_messages').insert({
        project_id: projectId,
        role: 'assistant',
        content: aiResponse.response_text,
        related_action: relatedActionJson
      })
    } catch (msgError) {
      console.error('Error saving assistant message:', msgError)
      // Continue even if message save fails
    }

    // Phase 1: Return actions without any pricing enrichment
    // The UI can use executedActions to verify what was successfully executed
    return NextResponse.json({
      response_text: aiResponse.response_text,
      actions: aiResponse.actions, // Actions WITHOUT pricing - all pricing fields are NULL
      executedActions: executedActions, // Results of action execution (success/error per action)
      ...(actionExecutionError ? { actionError: actionExecutionError } : {})
    })

  } catch (error) {
    console.error('Copilot API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    const errorStack = error instanceof Error ? error.stack : undefined
    
    // Log full error details for debugging
    console.error('Error details:', {
      message: errorMessage,
      stack: errorStack,
      error
    })
    
    return NextResponse.json(
      { 
        error: errorMessage,
        // Include stack in development only
        ...(process.env.NODE_ENV === 'development' && errorStack ? { stack: errorStack } : {})
      },
      { status: 500 }
    )
  }
}

/**
 * Resolve room_name to room_id
 * Fuzzy matches room names case-insensitively
 * Auto-creates room if not found (with source='ai_chat')
 */
async function resolveRoomName(
  roomName: string | null | undefined,
  projectId: string,
  supabase: any
): Promise<string | null> {
  if (!roomName || roomName.trim().length === 0 || roomName.toLowerCase() === 'general') {
    return null
  }

  const normalizedName = roomName.trim()

  // Fetch all rooms for this project
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('id, name')
    .eq('project_id', projectId)
    .eq('is_active', true)

  if (error) {
    console.error('Error fetching rooms:', error)
    return null
  }

  if (!rooms || rooms.length === 0) {
    // No rooms exist, create this one
    return await createRoom(normalizedName, projectId, supabase)
  }

  // Fuzzy match against existing rooms
  let bestMatch: { id: string; score: number } | null = null
  const threshold = 0.7 // 70% similarity threshold

  for (const room of rooms) {
    const score = fuzzyScore(normalizedName.toLowerCase(), room.name.toLowerCase())
    if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { id: room.id, score }
    }
  }

  if (bestMatch) {
    return bestMatch.id
  }

  // No match found, create new room
  return await createRoom(normalizedName, projectId, supabase)
}

/**
 * Create a new room with source='ai_chat'
 */
async function createRoom(
  name: string,
  projectId: string,
  supabase: any,
  level?: string | null
): Promise<string | null> {
  try {
    const { data: newRoom, error } = await supabase
      .from('rooms')
      .insert({
        project_id: projectId,
        name: name.trim(),
        level: level || null,        // NULL = unknown level
        level_source: level ? 'manual' : null,
        source: 'ai_chat',
        is_active: true,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error creating room:', error)
      return null
    }

    return newRoom.id
  } catch (error) {
    console.error('Error creating room:', error)
    return null
  }
}

/**
 * Phase 1: Pricing functions removed per PHASE_1_RELEASE_CHECKLIST.md
 * 
 * REMOVED FUNCTIONS:
 * - validateAndNormalizeCostCode() - was used for pricing lookup
 * - enrichActionsWithPricing() - was used to add pricing from task library
 * 
 * Phase 1 requires manual pricing only. Users enter direct_cost in the UI.
 * Copilot creates line items with NULL pricing fields.
 */

/**
 * Transcribe audio using OpenAI Whisper
 */
async function transcribeAudio(audioFile: File): Promise<string> {
  const openaiApiKey = process.env.OPENAI_API_KEY
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const arrayBuffer = await audioFile.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  
  const formData = new FormData()
  formData.append('file', new Blob([buffer], { type: audioFile.type }), audioFile.name)
  formData.append('model', 'whisper-1')
  formData.append('language', 'en')
  formData.append('response_format', 'json')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(`OpenAI transcription error: ${response.status} ${errorData.error?.message || response.statusText}`)
  }

  const result = await response.json()
  return result.text || ''
}

/**
 * Process files (images and PDFs) and return context string
 * 
 * Throws PDFProcessingError for PDF-specific issues that should be handled by the caller
 */
async function processFiles(supabase: any, fileUrls: string[]): Promise<string> {
  // Use service role for storage downloads to avoid RLS issues
  const storageClient = createServiceRoleClient()
  const contexts: string[] = []

  for (const storagePath of fileUrls) {
    try {
      // Download file from Supabase Storage using service role (bypass RLS)
      console.log(`[PDF Success] Downloading file: ${storagePath}`)
      let fileData: Blob | null = null
      try {
        const { data, error: downloadError } = await storageClient.storage
          .from('uploads')
          .download(storagePath)

        if (downloadError || !data) {
          console.error(`[PDF Error] Download failed for ${storagePath}:`, downloadError)
          throw new PDFProcessingError(
            'Could not retrieve file.',
            'FILE_NOT_FOUND',
            404,
            {
              storagePath,
              errorMessage: downloadError?.message,
              errorCode:
                (downloadError as any)?.statusCode ??
                (downloadError as any)?.code ??
                undefined,
            }
          )
        }

        fileData = data
        console.log(`[PDF Success] Downloaded file: ${storagePath}`)
      } catch (downloadErr) {
        if (downloadErr instanceof PDFProcessingError) {
          throw downloadErr
        }
        console.error(`[PDF Error] Download exception for ${storagePath}:`, downloadErr)
        throw new PDFProcessingError(
          'Could not retrieve file.',
          'FILE_NOT_FOUND',
          404,
          { storagePath }
        )
      }

      console.log(`[PDF Success] File size: ${fileData.size} bytes`)

      // Get file extension to determine type
      const extension = storagePath.split('.').pop()?.toLowerCase()
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension || '')
      const isPDF = extension === 'pdf'

      if (isImage) {
        contexts.push(`[Image: ${storagePath.split('/').pop()}]`)
      } else if (isPDF) {
        console.log(`[PDF Success] Parsing PDF: ${storagePath}`)
        try {
          const arrayBuffer = await fileData.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          console.log(`[PDF Success] PDF buffer created: ${buffer.length} bytes`)

          // Size guard - 100MB limit for large blueprints/plans
          const MAX_FILE_SIZE = 100 * 1024 * 1024
          if (buffer.length > MAX_FILE_SIZE) {
            const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
            console.warn(`[PDF Warning] File too large (${fileSizeMB}MB) for ${storagePath}`)
            throw new PDFProcessingError(
              'PDF exceeds 100MB size limit.',
              'FILE_TOO_LARGE',
              413,
              { storagePath, fileSizeMB: Number(fileSizeMB) }
            )
          }

          // Warn for large files that may take longer to process
          if (buffer.length > 50 * 1024 * 1024) {
            const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
            console.log(`[PDF Info] Processing large file (${fileSizeMB}MB): ${storagePath}`)
          }

          // Parse guard
        // Primary: pdf-parse. On failure, fall back to pdfjs-dist page-by-page extraction.
        let pdfData: any
        try {
          console.log(`[PDF Success] pdf-parse imported, parsing buffer...`)
          const pdfParseModule = await import('pdf-parse')
          const pdfParse = (pdfParseModule as any).default || pdfParseModule
          pdfData = await pdfParse(buffer)
        } catch (primaryErr) {
          console.warn(`[PDF Warning] pdf-parse failed for ${storagePath}, switching to pdf2json fallback...`, primaryErr)

          try {
            const parser = new PDFParser(undefined, true) // true = raw text mode
            const text = await new Promise<string>((resolve, reject) => {
              parser.on('pdfParser_dataError', (errData: any) => reject(errData?.parserError || errData))
              parser.on('pdfParser_dataReady', () => {
                try {
                  const rawText = typeof parser.getRawTextContent === 'function'
                    ? parser.getRawTextContent()
                    : ''
                  resolve(rawText || '')
                } catch (e) {
                  reject(e)
                }
              })
              parser.parseBuffer(buffer)
            })

            // Attempt to read page count
            let pageCount = 0
            try {
              const pdfDataInternal = (parser as any).pdfDocument
              pageCount = pdfDataInternal?.formImage?.Pages?.length ?? 0
            } catch {
              pageCount = 0
            }

            pdfData = {
              text,
              numpages: pageCount,
            }
          } catch (fallbackErr) {
            console.error(`[PDF Error] pdf2json fallback failed for ${storagePath}:`, fallbackErr)
            throw new PDFProcessingError(
              'PDF file is corrupted or incompatible.',
              'PARSE_ERROR',
              422,
              {
                storagePath,
                errorMessage: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
                parser: 'pdf2json',
              }
            )
          }
        }

        console.log(`[PDF Success] PDF parsed; pages=${pdfData.numpages}, textLen=${pdfData.text?.length || 0}`)

        const extractedText = pdfData.text || ''
        const trimmedText = extractedText.trim()

          if (!trimmedText) {
            console.warn(`[PDF Warning] Scanned/empty PDF detected for ${storagePath}`)
            throw new PDFProcessingError(
              'This looks like an image-only PDF. Please paste the text manually.',
              'SCANNED_PDF',
              422,
              {
                textLength: extractedText.length,
                trimmedLength: trimmedText.length,
                pageCount: pdfData.numpages,
                storagePath,
              }
            )
          }

          const first100Chars = extractedText.substring(0, 100)
          console.log(`[PDF Success] First 100 characters: ${first100Chars}`)
          console.log(`[PDF Success] Non-whitespace text length: ${trimmedText.length}`)

          contexts.push(`[PDF: ${storagePath.split('/').pop()}]\n${extractedText}`)
        } catch (pdfError) {
          if (pdfError instanceof PDFProcessingError) {
            throw pdfError
          }

          console.error(`[PDF Error] Unexpected parse failure for ${storagePath}:`, pdfError)
          throw new PDFProcessingError(
            'PDF file is corrupted or incompatible.',
            'PARSE_ERROR',
            422,
            {
              storagePath,
              errorMessage: pdfError instanceof Error ? pdfError.message : String(pdfError),
            }
          )
        }
      } else {
        contexts.push(`[Unsupported file type: ${storagePath.split('.').pop()}]`)
      }
    } catch (error) {
      // Re-throw PDFProcessingError so caller can handle it
      if (error instanceof PDFProcessingError) {
        throw error
      }
      
      // Log and continue for other errors
      console.error(`[File Processing] Unexpected error processing ${storagePath}:`, error)
      contexts.push(`[Error processing file: ${storagePath}]`)
    }
  }

  return contexts.join('\n\n---\n\n')
}

/**
 * Get public URLs for image files
 */
async function getImageUrls(supabase: any, fileUrls: string[]): Promise<string[]> {
  const imageUrls: string[] = []

  for (const storagePath of fileUrls) {
    const extension = storagePath.split('.').pop()?.toLowerCase()
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension || '')
    
    if (isImage) {
      const { data: { publicUrl } } = supabase.storage
        .from('uploads')
        .getPublicUrl(storagePath)
      imageUrls.push(publicUrl)
    }
  }

  return imageUrls
}

/**
 * Build system prompt for the Copilot AI
 * 
 * PHASE 1: Structured actions only - NO pricing suggestions
 * Per PHASE_1_RELEASE_CHECKLIST.md, copilot must NEVER suggest or auto-fill prices
 */
function buildSystemPrompt(
  currentLineItems: any[],
  project: { title: string },
  fileContext?: string,
  existingRooms: Array<{ id: string; name: string; type: string | null; is_active: boolean }> = [],
  recentActions: Array<{ type: string; success: boolean; id?: string; description?: string; created_items?: Array<{ id: string; description: string }> }> = []
): string {
  const lineItemsSummary = currentLineItems.length > 0
    ? currentLineItems.map(item => 
        `- ${item.description || 'Untitled'} (${item.cost_code || 'N/A'}, ${item.room_name || 'General'})`
      ).join('\n')
    : 'No line items yet.'

  const roomsSummary = existingRooms.length > 0
    ? existingRooms.map(room => 
        `- ${room.name}${room.type ? ` (${room.type})` : ''}`
      ).join('\n')
    : 'No rooms defined yet.'

  const fileContextSection = fileContext 
    ? `\n\nATTACHED FILES CONTEXT:
${fileContext}`
    : ''

  const roomsSection = `\n\nEXISTING ROOMS IN THIS PROJECT:
${roomsSummary}
When adding line items, use these room names exactly as shown. If a user mentions a room that doesn't exist, create it first with add_room action.`

  // Build recent actions context
  const recentActionsSection = recentActions.length > 0
    ? `\n\nRECENTLY EXECUTED ACTIONS (from previous turns - use these IDs for corrections):
${recentActions
  .filter(action => action.success && (action.id || action.created_items))
  .map(action => {
    if (action.type === 'add_line_item' && action.created_items && action.created_items.length > 0) {
      return action.created_items.map(item => 
        `- Created: "${item.description}" (ID: ${item.id})`
      ).join('\n')
    } else if (action.id && action.description) {
      return `- ${action.type}: "${action.description}" (ID: ${action.id})`
    } else if (action.id) {
      return `- ${action.type} (ID: ${action.id})`
    }
    return null
  })
  .filter(Boolean)
  .join('\n')}
IMPORTANT: If the user says "Actually, put that in the Kitchen" or "Move that to [Room]", use the IDs above with update_line_item.`
    : ''

  return `**YOU ARE AN AGENT, NOT A CHATBOT.** Your primary goal is to EXECUTE ACTIONS.
If the user asks for a change, you MUST call the relevant tool (e.g., \`add_line_item\`, \`update_line_item\`).
DO NOT just describe what you will do. CALL THE TOOL.
If you are correcting a previous mistake (e.g. changing room), you MUST find the items you just created and use \`update_line_item\`.

You are Estimatix Copilot, an AI assistant for construction project estimating.

PROJECT CONTEXT:
Project: ${project.title}

CURRENT LINE ITEMS:
${lineItemsSummary}${roomsSection}${recentActionsSection}${fileContextSection}

YOUR ROLE:
You help contractors manage their project estimates by:
1. Answering questions about the project and estimate
2. Adding new line items when requested (including from images and PDFs)
3. Updating existing line items (description, quantity, unit, room)
4. Managing rooms - creating rooms, organizing items into rooms, and excluding rooms from scope
5. Providing helpful information and suggestions
6. Analyzing images to identify construction work items, materials, and scope
7. Extracting line items from PDF documents (blueprints, specs, quotes, etc.)

**PHASE 1 PRICING RULES - CRITICAL:**
- You must NEVER suggest, guess, or auto-fill prices
- You must NEVER include unitCost, direct_cost, client_price, margin_percent, or any pricing fields
- All pricing is entered MANUALLY by the user in the estimate table UI
- If a user asks about pricing, respond with: "In Phase 1, all pricing is entered manually in the estimate table. I can help you add line items and organize them into rooms."
- If a user provides a price, acknowledge it but DO NOT include it in the action data

ROOM MANAGEMENT (CRITICAL):
- ALWAYS group line items into rooms whenever possible. Rooms help organize estimates by location.
- When a user mentions a new room (e.g., "Add a master bath", "We're doing the kitchen", "Master bedroom needs..."), you should:
  1. First call add_room action to create the room
  2. Then add line items to that room using room_name in add_line_item
- When a user says they're not doing a room anymore (e.g., "We aren't doing the kitchen anymore", "Skip the master bath"), use hide_room action
- When adding line items, always specify a room_name. Use specific room names like "Kitchen", "Master Bedroom", "Primary Bath", etc.
- If room is unclear, use "General" as fallback
- The system will automatically match room names to existing rooms (fuzzy matching) or create new ones if needed

CRITICAL RULES - FOLLOW STRICTLY:

1. DETAIL PRESERVATION:
   - DO NOT summarize, shorten, or abbreviate descriptions
   - ALWAYS preserve brand names exactly as provided (e.g., "Town & Country TC42", "Pacific Hearth & Home")
   - ALWAYS preserve model numbers, part numbers, and specifications exactly
   - ALWAYS preserve subcontractor names exactly as mentioned
   - ALWAYS preserve specific material types and finishes exactly
   - Include all relevant details in the description field
   
   STRICT DESCRIPTION ACCURACY:
   - DO NOT infer or add specific material grades, quality levels, or upgrade options
   - DO NOT add descriptive adjectives like "energy-efficient", "luxury", "custom", "premium", "high-end", or "upgraded" unless the user specifically mentioned them
   - Capture EXACTLY what the user said, not what you think they might want
   - Examples:
     * User says "replace 7 windows" → Description: "Window replacement", NOT "Replace 7 windows with energy-efficient models"
     * User says "install cabinets" → Description: "Install cabinets", NOT "Install custom luxury cabinets"
     * User says "paint the room" → Description: "Paint room", NOT "Apply premium paint finish"

2. LINE-ITEM GRANULARITY:
   - SPLIT DISTINCT TASKS INTO SEPARATE LINE ITEMS
   - If the user describes multiple distinct physical tasks, you MUST create separate line items for each task
   - Examples of distinct tasks that MUST be split:
     - "Demo shower and remove vanity" → Create TWO items: (1) "Demolition of shower" (2) "Remove vanity unit"
     - "Remove tile and patch drywall" → Create TWO items: (1) "Remove tile" (2) "Patch drywall"
     - "Install cabinets and countertops" → Create TWO items: (1) "Install cabinets" (2) "Install countertops"
   - DO NOT bundle distinct tasks into one description

3. TASK DECOMPOSITION (COMPOUND ACTION DETECTION):
   - When users use words like "Replace," "Relocate," "Swap," or "Remove and Install," break these into separate line items
   - "Replace [Item]" ALWAYS means TWO separate tasks:
     * Task 1: "Demolition and disposal of existing [Item]" (code: "201" or "999")
     * Task 2: "Install new [Item]" (use trade-specific code)
   - Example: User says "Replace 7 windows"
     * GOOD: Two items - "Demolition of 7 existing windows" and "Install 7 new windows"

4. COST CODE GUIDELINES:
   - Use integer cost codes from the list (e.g., "520", "406", "715")
   - DO NOT invent new cost codes or add decimals
   - If no specific code matches, use "999" (Other)

COST CODES (Industry Standard):
100 - PRE-CONSTRUCTION: 111 (Plans & Design), 112 (Engineering), 116 (Permits), 125 (Toilets), 126 (Equipment), 129 (Supervision), 131 (Trash Removal), 132 (Superintendent), 141 (Fencing)
200 - EXCAVATION & FOUNDATION: 201 (Site Clearing/Demo), 203 (Erosion Control), 204 (Excavating), 209 (Lead-Asbestos Abatement), 210 (Soil Treatment), 212 (Concrete Foundation), 215 (Waterproofing), 219 (Rock Walls)
300 - ROUGH CARPENTRY: 301 (Structural Steel), 305 (Rough Carpentry), 307 (Rough Lumber), 308 (Registers), 310 (Truss/Joist)
400 - MEP ROUGH-INS: 402 (HVAC), 403 (Sheet Metal), 404 (Plumbing), 404B (Hot Mop), 405 (Electrical), 406 (Fireplaces), 407 (Low Voltage), 416 (Shades), 418 (Sprinklers), 421 (Septic)
500 - EXTERIOR: 500 (Masonry), 503 (Precast), 504 (Roofing), 505 (Cornices), 510 (Garage Doors), 511 (Skylights), 512 (Solar), 513 (Wood Siding), 516 (Stucco), 518 (Shutters), 519 (Wrought Iron), 520 (Windows), 521 (Entry Door), 522 (Exterior Doors), 550 (Elevator), 556 (Decks), 560 (BBQ)
600 - INSULATION/DRYWALL: 600 (Insulation), 602 (Drywall)
700 - INTERIOR FINISHES: 706 (Finish Carpentry), 710 (Doors), 715 (Fireplace Trim), 716 (Cabinetry), 721 (Countertops), 723 (Paint), 728 (Tile), 733 (Vinyl Floor), 734 (Wood Floor), 737 (Carpet), 738 (Shower/Mirrors), 739 (Plumbing Fixtures), 740 (Lighting), 741 (Appliances), 745 (Stairs)
800 - COMPLETION: 800 (Concrete Flatwork), 804 (Fencing), 805 (Landscape), 808 (Landscape Lighting), 809 (Pool/Spa), 810 (Hardware), 813 (Decorating), 816 (Paving), 817 (Cleaning)
999: Other (use when no specific code applies)

RESPONSE FORMAT:
You MUST return valid JSON with this structure:
{
  "response_text": "Your natural language response to the user",
  "actions": [
    {
      "type": "add_line_item" | "update_line_item" | "add_room" | "hide_room" | "info",
      "data": { ...action-specific data... }
    }
  ]
}

RESPONSE TEXT GUIDELINES:
1. Briefly confirm what you added/changed
2. Be specific about quantities, items, and locations
3. Ask clarifying questions if needed (e.g., room location)
4. NEVER mention or suggest prices

ACTION TYPES (Phase 1):

1. "add_line_item":
   {
     "type": "add_line_item",
     "data": {
       "description": "Clear, detailed description preserving ALL specifics",
       "category": "Short category name (e.g., 'Plumbing', 'Electrical', 'Windows')",
       "cost_code": "Integer cost code from the list (e.g., '520', '406')",
       "room": "Room name (e.g., 'Kitchen', 'Master Bedroom') or 'General'",
       "room_name": "Same as room field (for compatibility)",
       "quantity": number (optional),
       "unit": "EA" | "SF" | "LF" | "SQ" | "ROOM" (optional),
       "notes": "Optional notes"
     }
   }
   NOTE: DO NOT include any pricing fields (unitCost, pricing_source, margin_percent, etc.)

2. "update_line_item":
   {
     "type": "update_line_item",
     "data": {
       "line_item_id": "UUID of existing line item (REQUIRED)",
       "description": "Updated description" (optional),
       "category": "Updated category" (optional),
       "cost_code": "Updated cost code" (optional),
       "room": "Updated room name" (optional),
       "room_name": "Updated room name" (optional),
       "quantity": number (optional),
       "unit": "Updated unit" (optional),
       "notes": "Updated notes" (optional)
     }
   }
   Use this to change room, quantity, or description of existing items.

3. "add_room":
   {
     "type": "add_room",
     "data": {
       "name": "Room name (e.g., 'Master Bedroom', 'Kitchen', 'Primary Bath')",
       "type": "Optional room type (e.g., 'bedroom', 'kitchen', 'bathroom')",
       "area_sqft": number (optional - square footage if mentioned),
       "notes": "Optional notes about the room"
     }
   }
   Use when the user mentions creating a new room or working on a room that doesn't exist.

4. "hide_room":
   {
     "type": "hide_room",
     "data": {
       "room_name": "Name of the room to exclude from scope"
     }
   }
   Use when the user says they're not doing a room anymore or want to exclude it.
   This excludes the room and all its line items from totals and documents.

5. "info":
   {
     "type": "info",
     "data": {
       "message": "Information message for the user"
     }
   }
   Use for general questions or when no action is needed.

ADDITIONAL RULES:
- Only create actions when the user explicitly requests changes OR when analyzing files
- For general questions, use "info" action type
- Always provide a helpful response_text even when performing actions
- PRESERVE ALL DETAILS: Never shorten or summarize descriptions
- When analyzing images/PDFs: Extract items, quantities, and assign to rooms - but NEVER suggest prices

Return ONLY valid JSON, no markdown or additional text.`
}

/**
 * Call OpenAI API with conversation context
 */
async function callCopilotAI(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  imageUrls: string[] = []
): Promise<CopilotResponse> {
  const maxRetries = 3
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add delay between retries
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }

      // Build messages with image support if needed
      const messagePayload = [
        {
          role: 'system',
          content: systemPrompt
        },
        ...messages.map((msg, index) => {
          // If this is the last user message and we have images, include them
          const isLastUserMessage = msg.role === 'user' && index === messages.length - 1
          if (isLastUserMessage && imageUrls.length > 0) {
            return {
              role: msg.role,
              content: [
                { type: 'text', text: msg.content },
                ...imageUrls.map(url => ({
                  type: 'image_url' as const,
                  image_url: { url }
                }))
              ]
            }
          }
          return {
            role: msg.role,
            content: msg.content
          }
        })
      ]

      // Use GPT-4o for vision, otherwise use gpt-4o-mini
      const model = imageUrls.length > 0 ? 'gpt-4o' : 'gpt-4o-mini'

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: messagePayload,
          temperature: 0.7,
          max_tokens: 2000,
          response_format: { type: 'json_object' }
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const status = response.status
        const isRetryable = status === 502 || status === 503 || status === 504 || status === 429
        
        if (isRetryable && attempt < maxRetries - 1) {
          lastError = new Error(`OpenAI API error: ${status} ${errorData.error?.message || response.statusText}`)
          continue
        }
        
        throw new Error(`OpenAI API error: ${status} ${errorData.error?.message || response.statusText}`)
      }

      const result = await response.json()
      const content = result.choices[0]?.message?.content

      if (!content) {
        throw new Error('No content returned from OpenAI')
      }

      // Try to parse JSON, handling cases where it might be wrapped in markdown code blocks
      let parsed: any
      try {
        // First, try parsing directly
        parsed = JSON.parse(content)
      } catch (parseError) {
        // If that fails, try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || 
                         content.match(/\{[\s\S]*\}/)
        
        if (jsonMatch) {
          try {
            const jsonString = jsonMatch[1] || jsonMatch[0]
            parsed = JSON.parse(jsonString.trim())
          } catch (extractError) {
            console.error('Failed to parse OpenAI response:', content)
            throw new Error(`Invalid JSON response from AI. Raw content: ${content.substring(0, 200)}...`)
          }
        } else {
          console.error('Failed to parse OpenAI response:', content)
          throw new Error(`Invalid JSON response from AI. Raw content: ${content.substring(0, 200)}...`)
        }
      }

      const validated = CopilotResponseSchema.parse(parsed)

      return validated

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      if (attempt === maxRetries - 1) {
        throw lastError
      }
    }
  }

  throw lastError || new Error('Failed to call OpenAI API')
}

/**
 * Execute actions against the database
 */
async function executeActions(
  actions: Array<{ type: string; data: any }>,
  estimateId: string,
  projectId: string,
  userId: string,
  supabase: any
): Promise<Array<{ type: string; success: boolean; id?: string; error?: string; description?: string; created_items?: Array<{ id: string; description: string }> }>> {
  const results = []

  for (const action of actions) {
    try {
      // Debug logging
      console.log('[Copilot] Executing action:', action.type)
      console.log('[Copilot] Action data:', JSON.stringify(action.data, null, 2))
      switch (action.type) {
        case 'add_line_item': {
          // Phase 1: Create line items with NULL pricing fields
          // Users will enter direct_cost manually in the UI
          const { data } = action
          
          // Resolve room_name to room_id
          const roomName = data.room_name || data.room || 'General'
          const roomId = await resolveRoomName(roomName, projectId, supabase)

          // Phase 1: NO pricing - all pricing fields stored as NULL
          // Users enter prices manually in the estimate table UI

          // Determine if this is an area-based item for auto-quantity
          const areaBasedCheck = isAreaBasedItem({
            cost_code: data.cost_code || null,
            unit: data.unit || null,
            description: data.description || null,
            category: data.category || null,
          })

          const insertData: any = {
            estimate_id: estimateId,
            project_id: projectId,
            description: data.description || '',
            category: data.category || 'Other',
            cost_code: data.cost_code || null, // Accept cost_code from AI but don't validate against pricing library
            room_name: roomName, // Keep room_name for backward compatibility
            room_id: roomId, // Use resolved room_id
            quantity: areaBasedCheck ? null : (data.quantity || 1),
            unit: areaBasedCheck ? 'SQFT' : (data.unit || null),
            calc_source: areaBasedCheck ? 'room_dimensions' : 'manual',
            // Phase 1: ALL pricing fields are NULL - manual entry only
            labor_cost: null,
            material_cost: null,
            direct_cost: null,
            margin_percent: null,
            client_price: null,
            is_allowance: false,
            pricing_source: null, // No pricing source - manual entry
            price_source: null,
            task_library_id: null, // No pricing library lookup
            is_active: true
          }
          
          const { data: newItem, error } = await supabase
            .from('estimate_line_items')
            .insert(insertData)
            .select('id, description')
            .single()

          if (error) throw error
          
          // Return the created item with ID and description so AI can reference it
          results.push({ 
            type: 'add_line_item', 
            success: true, 
            id: newItem.id,
            description: newItem.description || insertData.description,
            created_items: [{ id: newItem.id, description: newItem.description || insertData.description }]
          })
          break
        }

        case 'update_line_item': {
          // Phase 1: Update line item - only non-pricing fields (description, quantity, unit, room)
          // Pricing updates are done manually by users in the UI
          const { data } = action
          if (!data.line_item_id) {
            results.push({ type: 'update_line_item', success: false, error: 'Missing line_item_id' })
            break
          }

          const updateData: any = {}
          if (data.description !== undefined) updateData.description = data.description
          if (data.category !== undefined) updateData.category = data.category
          if (data.cost_code !== undefined) {
            // Phase 1: Accept cost_code without validation
            updateData.cost_code = data.cost_code
          }
          
          let updatedRoomName: string | null = null
          if (data.room !== undefined || data.room_name !== undefined) {
            const roomName = data.room_name || data.room
            updatedRoomName = roomName
            updateData.room_name = roomName
            // Resolve room_name to room_id (this will create the room if it doesn't exist)
            const roomId = await resolveRoomName(roomName, projectId, supabase)
            if (roomId) {
              updateData.room_id = roomId
            }
          }
          
          if (data.quantity !== undefined) updateData.quantity = data.quantity
          if (data.unit !== undefined) updateData.unit = data.unit
          if (data.notes !== undefined) updateData.notes = data.notes
          // Phase 1: NO pricing fields updated via copilot - users enter manually

          // RLS will automatically verify ownership
          const { error } = await supabase
            .from('estimate_line_items')
            .update(updateData)
            .eq('id', data.line_item_id)

          if (error) {
            if (error.code === 'PGRST116') {
              results.push({ type: 'update_line_item', success: false, error: 'Line item not found' })
            } else {
              throw error
            }
          } else {
            // Return success message with room name if room was updated
            const successMessage = updatedRoomName 
              ? `Moved item to ${updatedRoomName}.`
              : 'Item updated successfully.'
            results.push({ 
              type: 'update_line_item', 
              success: true, 
              id: data.line_item_id,
              message: successMessage
            })
          }
          break
        }

        // Phase 1: delete_line_item removed - users delete via UI only

        case 'add_room': {
          const { data } = action
          if (!data.name || !data.name.trim()) {
            results.push({ type: 'add_room', success: false, error: 'Missing room name' })
            break
          }

          const roomId = await createRoom(data.name.trim(), projectId, supabase, data.level || null)
          
          if (!roomId) {
            results.push({ type: 'add_room', success: false, error: 'Failed to create room' })
            break
          }

          // Update room with optional fields if provided
          const updateData: any = {}
          if (data.type) updateData.type = data.type.trim()
          if (data.area_sqft !== undefined && data.area_sqft !== null) {
            updateData.area_sqft = typeof data.area_sqft === 'number' ? data.area_sqft : parseFloat(data.area_sqft)
          }
          if (data.notes) updateData.notes = data.notes.trim()

          if (Object.keys(updateData).length > 0) {
            await supabase
              .from('rooms')
              .update(updateData)
              .eq('id', roomId)
          }

          results.push({ type: 'add_room', success: true, id: roomId })
          break
        }

        case 'hide_room': {
          const { data } = action
          if (!data.room_name || !data.room_name.trim()) {
            results.push({ type: 'hide_room', success: false, error: 'Missing room_name' })
            break
          }

          // Find room by name (fuzzy match)
          const { data: rooms, error: fetchError } = await supabase
            .from('rooms')
            .select('id, name')
            .eq('project_id', projectId)
            .eq('is_active', true)

          if (fetchError || !rooms || rooms.length === 0) {
            results.push({ type: 'hide_room', success: false, error: 'Room not found' })
            break
          }

          // Fuzzy match room name
          const roomName = data.room_name.trim()
          let matchedRoom: { id: string; score: number } | null = null
          const threshold = 0.7

          for (const room of rooms) {
            const score = fuzzyScore(roomName.toLowerCase(), room.name.toLowerCase())
            if (score >= threshold && (!matchedRoom || score > matchedRoom.score)) {
              matchedRoom = { id: room.id, score }
            }
          }

          if (!matchedRoom) {
            results.push({ type: 'hide_room', success: false, error: `Room "${roomName}" not found` })
            break
          }

          // Exclude room from scope (set is_in_scope = false, is_active = false for backward compat)
          // Line items remain in DB but are excluded from all total computations
          const { error: updateError } = await supabase
            .from('rooms')
            .update({ is_in_scope: false, is_active: false })
            .eq('id', matchedRoom.id)

          if (updateError) {
            results.push({ type: 'hide_room', success: false, error: `Failed to hide room: ${updateError.message}` })
            break
          }

          results.push({ type: 'hide_room', success: true, id: matchedRoom.id })
          break
        }

        case 'info': {
          // Info actions don't modify the database
          results.push({ type: 'info', success: true })
          break
        }

        // Phase 1: Pricing actions removed per PHASE_1_RELEASE_CHECKLIST.md
        // - set_margin_rule: removed - users set margins manually in UI
        // - update_task_price: removed - users update prices manually in UI
        // - review_pricing: removed - no pricing review in Phase 1

        default: {
          results.push({ type: action.type, success: false, error: `Unknown action type: ${action.type}` })
        }
      }
    } catch (error) {
      console.error(`Error executing action ${action.type}:`, error)
      results.push({
        type: action.type,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  return results
}

