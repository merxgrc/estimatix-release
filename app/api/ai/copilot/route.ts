import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import PDFParser from 'pdf2json'
import { createServerClient, createServiceRoleClient, requireAuth } from '@/lib/supabase/server'
import { getProfileByUserId } from '@/lib/profile'
import { matchTask } from '@/lib/pricing/match-task'
import { applyPricing } from '@/services/pricingService'
import { fuzzyScore } from '@/lib/pricing/fuzzy'
import type { AIAction } from '@/types/estimate'

export const runtime = 'nodejs' // Disable Edge runtime for OpenAI API compatibility

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
      const parser = new PDFParser(undefined, 1) // 1 = raw text mode
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
  audio: z.any().optional(), // File or undefined
  fileUrls: z.array(z.string()).optional().default([]) // Storage paths for files
})

// Zod schema for the AI response
const CopilotResponseSchema = z.object({
  response_text: z.string(),
  actions: z.array(z.object({
    type: z.enum(['add_line_item', 'update_line_item', 'delete_line_item', 'add_room', 'hide_room', 'info']),
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
      const fileUrlsJson = formData.get('fileUrls') as string
      
      body = {
        messages: messagesJson ? JSON.parse(messagesJson) : [],
        projectId,
        currentLineItems: currentLineItemsJson ? JSON.parse(currentLineItemsJson) : [],
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

    const { messages, projectId, currentLineItems = [], audio, fileUrls = [] } = validation.data

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
      // Create a new estimate
      const { data: newEstimate, error: createError } = await supabase
        .from('estimates')
        .insert({
          project_id: projectId,
          json_data: { line_items: [], spec_sections: [] }
        })
        .select('id')
        .single()

      if (createError || !newEstimate) {
        return NextResponse.json(
          { error: 'Failed to create estimate' },
          { status: 500 }
        )
      }
      estimateId = newEstimate.id
    }

    // Fetch existing rooms for the project
    const { data: rooms } = await supabase
      .from('rooms')
      .select('id, name, type, is_active')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('name', { ascending: true })

    // Build system prompt for the AI
    const systemPrompt = buildSystemPrompt(currentLineItems, project, fileContext, rooms || [])

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
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      )
    }

    const aiResponse = await callCopilotAI(
      systemPrompt,
      enhancedMessages,
      openaiApiKey,
      imageUrls
    )

    // Apply pricing engine to add_line_item actions
    const enrichedActions = await enrichActionsWithPricing(
      aiResponse.actions,
      user.id,
      supabase
    )

    // Execute actions (using enriched actions with pricing)
    let executedActions: Array<{ type: string; success: boolean; id?: string; error?: string }> = []
    try {
      executedActions = await executeActions(
        enrichedActions,
        estimateId,
        projectId,
        user.id,
        supabase
      )
    } catch (actionError) {
      console.error('Error executing actions:', actionError)
      // Continue even if action execution fails - we still want to save the conversation
      executedActions = []
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

    // Return both the AI's original actions (with pricing enrichment) and execution results
    // The UI can use executedActions to verify what was successfully executed
    return NextResponse.json({
      response_text: aiResponse.response_text,
      actions: enrichedActions, // Actions enriched with pricing from task library
      executedActions: executedActions // Results of action execution (success/error per action)
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
  supabase: any
): Promise<string | null> {
  try {
    const { data: newRoom, error } = await supabase
      .from('rooms')
      .insert({
        project_id: projectId,
        name: name.trim(),
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
 * Enrich add_line_item actions with pricing from the task library
 */
async function enrichActionsWithPricing(
  actions: Array<{ type: string; data: any }>,
  userId: string,
  supabase: any
): Promise<Array<{ type: string; data: any }>> {
  const enrichedActions = []

  // Get user profile for region information (if available)
  // Note: region may not be in profile yet, so we'll use null if not available
  let region: string | null = null
  try {
    const profile = await getProfileByUserId(userId)
    // Check if profile has region field (may need to be added to schema in future)
    region = (profile as any)?.region || null
  } catch (error) {
    console.warn('Failed to get user profile for region, continuing without region filter:', error)
  }

  for (const action of actions) {
    if (action.type === 'add_line_item') {
      const { data } = action
      
      // SKIP pricing enrichment if user already provided manual pricing
      // If pricing_source is 'manual', user explicitly provided the price - don't override it
      if (data.pricing_source === 'manual' && data.unitCost !== undefined && data.unitCost !== null) {
        enrichedActions.push(action)
        continue
      }
      
      // Only enrich if we have a description
      if (data.description) {
        try {
          // Attempt to match with pricing engine
          const matchResult = await matchTask({
            description: data.description,
            cost_code: data.cost_code || null,
            region: region || null
          })

          // If we found a high-confidence match (>= 70%), use library pricing
          if (matchResult && matchResult.confidence >= 70) {
            const task = matchResult.task
            
            // Override unit if task library provides one and we don't have one
            if (!data.unit && task.unit) {
              data.unit = task.unit
            }

            // Add pricing data from task library
            // Use unit_cost_mid as the default, or calculate from labor + material
            if (task.unit_cost_mid !== null) {
              // Store in a way that executeActions can use
              data.unit_cost_mid = task.unit_cost_mid
            }
            
            // Calculate labor and material costs if available
            if (task.labor_hours_per_unit !== null || task.material_cost_per_unit !== null) {
              data.labor_hours_per_unit = task.labor_hours_per_unit
              data.material_cost_per_unit = task.material_cost_per_unit
            }

            // Set pricing source to indicate this came from task library
            data.pricing_source = 'task_library'
            data.confidence = matchResult.confidence
            data.task_library_id = task.id
            
            console.log(`Matched "${data.description}" to task library with ${matchResult.confidence}% confidence`)
          } else {
            // No high-confidence match found, mark as AI-generated
            data.pricing_source = 'ai'
            if (matchResult) {
              console.log(`Low confidence match (${matchResult.confidence}%) for "${data.description}", leaving as AI-generated`)
            }
          }
        } catch (error) {
          console.error(`Error matching pricing for "${data.description}":`, error)
          // On error, leave as AI-generated
          data.pricing_source = 'ai'
        }
      } else {
        // No description, mark as AI
        data.pricing_source = 'ai'
      }
    }
    
    enrichedActions.push(action)
  }

  return enrichedActions
}

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

          // Size guard
          const MAX_FILE_SIZE = 10 * 1024 * 1024
          if (buffer.length > MAX_FILE_SIZE) {
            const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
            console.warn(`[PDF Warning] File too large (${fileSizeMB}MB) for ${storagePath}`)
            throw new PDFProcessingError(
              'PDF exceeds 10MB size limit.',
              'FILE_TOO_LARGE',
              413,
              { storagePath, fileSizeMB: Number(fileSizeMB) }
            )
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
            const parser = new PDFParser(undefined, 1) // 1 = raw text mode
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
 */
function buildSystemPrompt(
  currentLineItems: any[],
  project: { title: string },
  fileContext?: string,
  existingRooms: Array<{ id: string; name: string; type: string | null; is_active: boolean }> = []
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

  return `You are Estimatix Copilot, an AI assistant for construction project estimating.

PROJECT CONTEXT:
Project: ${project.title}

CURRENT LINE ITEMS:
${lineItemsSummary}${roomsSection}${fileContextSection}

YOUR ROLE:
You help contractors manage their project estimates by:
1. Answering questions about the project and estimate
2. Adding new line items when requested (including from images and PDFs)
3. Updating existing line items
4. Deleting line items when requested
5. Managing rooms - creating rooms, organizing items into rooms, and hiding rooms
6. Providing helpful information and suggestions
7. Analyzing images to identify construction work items, materials, and scope
8. Extracting line items from PDF documents (blueprints, specs, quotes, etc.)

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
   - DO NOT infer or add specific material grades, quality levels, or upgrade options to the description field unless the user explicitly requested them
   - DO NOT add descriptive adjectives like "energy-efficient", "luxury", "custom", "premium", "high-end", or "upgraded" unless the user specifically mentioned them
   - Capture EXACTLY what the user said, not what you think they might want
   - Examples:
     * User says "replace 7 windows" → Description: "Replace 7 windows" or "Window replacement", NOT "Replace 7 windows with energy-efficient models"
     * User says "install cabinets" → Description: "Install cabinets", NOT "Install custom luxury cabinets"
     * User says "paint the room" → Description: "Paint room", NOT "Apply premium paint finish"
   - If you think an upgrade would be beneficial, suggest it in your response_text, NOT in the line item description

2. LINE-ITEM GRANULARITY (CRITICAL FOR SPEC SHEETS):
   - SPLIT DISTINCT TASKS INTO SEPARATE LINE ITEMS:
     * If the user describes multiple distinct physical tasks, you MUST create separate line items for each task
     * Distinct tasks are different types of work that could logically be priced or executed separately
     * Examples of distinct tasks that MUST be split:
       - "Demo shower and remove vanity" → Create TWO items: (1) "Demolition of shower" (2) "Remove vanity unit"
       - "Remove tile and patch drywall" → Create TWO items: (1) "Remove tile" (2) "Patch drywall"
       - "Install cabinets and countertops" → Create TWO items: (1) "Install cabinets" (2) "Install countertops"
       - "Paint walls and install trim" → Create TWO items: (1) "Paint walls" (2) "Install trim"
     * DO NOT bundle distinct tasks into one description unless they are inextricably linked parts of a single kit or unit
     * Exception: If tasks are part of a single pre-assembled unit (e.g., "fireplace unit includes chase, flashing, and finish kit"), they can be bundled
   
   - ALLOWANCE EXCEPTION:
     * If the item is an Allowance (like "Cabinetry Package", "Fireplace Allowance", or "Fixture Allowance"), it IS acceptable to bundle related items into one description
     * Allowances are priced as lump sums, so bundling related components is appropriate
     * Example (ALLOWED): "ALLOWANCE: Cabinetry Package - Includes cabinets, knobs, pulls, soft-close hinges, and crown molding" (single line item)
     * Example (STILL NEEDS SPLITTING): "Install cabinets and paint walls" → Even if one is an allowance, these are distinct tasks and should be separate items
   
   - PRICING CONSEQUENCE:
     * Creating separate items is CRITICAL because users need to see individual prices for each sub-task on the final Spec Sheet
     * Each line item will display its own price next to its description in the Spec Sheet
     * Bundling multiple tasks into one item prevents users from seeing the breakdown and individual pricing
   
   - EXAMPLES:
     * BAD (DO NOT DO): 1 Item - "Demo shower, remove vanity, and patch drywall." ($900 total)
     * GOOD (DO THIS INSTEAD):
       - Item 1: "Demolition of master shower" ($600)
       - Item 2: "Remove vanity unit" ($150)
       - Item 3: "Patch drywall at plumbing penetrations" ($150)
     
     * BAD (DO NOT DO): 1 Item - "Install windows and doors" ($5,000 total)
     * GOOD (DO THIS INSTEAD):
       - Item 1: "Install windows" ($3,500)
       - Item 2: "Install doors" ($1,500)
     
     * GOOD (ALLOWED FOR ALLOWANCES): 1 Item - "ALLOWANCE: Fireplace Package - Town & Country TC42 gas fireplace, chimney chase top flashing, and all finish kits" ($18,000)
   
   - WHEN IN DOUBT: Split into separate items. It's better to have granular items that can be merged later than to have bundled items that are hard to separate.

3. EXPLICIT PRICING HANDLING:
   - If the user mentions a specific price, cost, or allowance amount (e.g., "$18,000", "Cost is $500", "Allowance is $2,500"):
     * Set "unitCost" to that EXACT amount (as a number, no currency symbols)
     * Set "pricing_source" to "manual" (NOT "ai")
     * DO NOT attempt to look up a library price - use the user's price
     * If quantity is specified, divide the total cost by quantity to get unit cost
   - Examples:
     * "Allowance is $18,000" → unitCost: 18000, pricing_source: "manual"
     * "Cost is $500" → unitCost: 500, pricing_source: "manual"
     * "Total $2,400 for 3 units" → unitCost: 800, pricing_source: "manual", quantity: 3

4. ALLOWANCE HANDLING:
   - If the user uses the word "Allowance" or "allowance" (e.g., for a fireplace, fixtures, finishes):
     * Set "is_allowance" to true in the action data
     * Set "margin_percent" to 0 (unless the user explicitly specifies a different margin)
     * Ensure "client_price" equals "direct_cost" (no markup applied to allowances)
     * Ensure the description includes "ALLOWANCE:" at the beginning OR clearly indicates it's an allowance
     * Use cost code 999 (Other/Allowance) unless a more specific allowance code applies
     * Include the allowance amount in unitCost if specified
     * Set "pricing_source" to "manual" since allowances are user-specified
     * DO NOT apply standard markup to allowances automatically - they are fixed-price items
   - Example: "Allowance is $18,000" → 
     * description: "ALLOWANCE: [detailed description]"
     * cost_code: "999"
     * unitCost: 18000
     * pricing_source: "manual"
     * is_allowance: true
     * margin_percent: 0
     * client_price: should equal direct_cost (no markup)

5. COST CODE MATCHING:
   - Use the MOST SPECIFIC cost code available that matches the work
   - Do NOT use generic codes (like "400" or "500") when a specific code exists
   - Examples:
     * "Prefab Fireplace" → Use "406" (Prefab Fireplaces), NOT "400" (MEP ROUGH-INS)
     * "Fireplace Mantle" → Use "715" (Fireplace Mantle / Trim), NOT "700" (INTERIOR FINISHES)
     * "Window Install" → Use "520.001" (Window Install), NOT just "520" (Windows)
   - Review all cost codes above to find the best match before defaulting to a general code
   
   COST CODE AWARENESS:
   - Always identify which specific cost code you selected for each line item in your internal reasoning
   - If you are unsure between multiple cost codes, or if the user's request doesn't clearly match a specific code, mention this in your response_text
   - In your response_text, you can say something like: "I used cost code 520 (Windows) for this. If this is a specialized window type, please let me know and I can update it."
   - When uncertain, ask the user for clarification rather than guessing

COST CODES (Industry Standard):
Use the appropriate cost code from the following list:

100 - PRE-CONSTRUCTION: 111 (Plans & Design), 112 (Engineering), 116 (Permits), 125 (Toilets), 126 (Equipment), 129 (Supervision), 131 (Trash Removal), 132 (Superintendent), 141 (Fencing)

200 - EXCAVATION & FOUNDATION: 201 (Site Clearing/Demo), 203 (Erosion Control), 204 (Excavating), 209 (Lead-Asbestos Abatement), 210 (Soil Treatment), 212 (Concrete Foundation), 215 (Waterproofing), 219 (Rock Walls)

300 - ROUGH CARPENTRY: 301 (Structural Steel), 305 (Rough Carpentry), 307 (Rough Lumber), 308 (Registers), 310 (Truss/Joist)

400 - MEP ROUGH-INS: 402 (HVAC), 403 (Sheet Metal), 404 (Plumbing), 404B (Hot Mop), 405 (Electrical), 406 (Fireplaces), 407 (Low Voltage), 416 (Shades), 418 (Sprinklers), 421 (Septic)

500 - EXTERIOR: 500 (Masonry), 503 (Precast), 504 (Roofing), 505 (Cornices), 510 (Garage Doors), 511 (Skylights), 512 (Solar), 513 (Wood Siding), 516 (Stucco), 518 (Shutters), 519 (Wrought Iron), 520 (Windows), 521 (Entry Door), 522 (Exterior Doors), 550 (Elevator), 556 (Decks), 560 (BBQ)

600 - INSULATION/DRYWALL: 600 (Insulation), 602 (Drywall)

700 - INTERIOR FINISHES: 706 (Finish Carpentry), 710 (Doors), 715 (Fireplace Trim), 716 (Cabinetry), 721 (Countertops), 723 (Paint), 728 (Tile), 733 (Vinyl Floor), 734 (Wood Floor), 737 (Carpet), 738 (Shower/Mirrors), 739 (Plumbing Fixtures), 740 (Lighting), 741 (Appliances), 745 (Stairs)

800 - COMPLETION: 800 (Concrete Flatwork), 804 (Fencing), 805 (Landscape), 808 (Landscape Lighting), 809 (Pool/Spa), 810 (Hardware), 813 (Decorating), 816 (Paving), 817 (Cleaning)

999: Other/Allowance (use only when no specific code applies)

RESPONSE FORMAT:
You MUST return valid JSON with this structure:
{
  "response_text": "Your natural language response to the user",
  "actions": [
    {
      "type": "add_line_item" | "update_line_item" | "delete_line_item" | "add_room" | "hide_room" | "info",
      "data": { ...action-specific data... }
    }
  ]
}

THE "ASSISTANT" RESPONSE PROTOCOL (response_text format):
Your response_text (the chat message back to the user) MUST follow this format:

1. CONFIRMATION:
   - Start by briefly and clearly confirming exactly what you added/changed
   - Be specific about quantities, items, and locations
   - For allowances, explicitly state the allowance amount and that it's set as an allowance
   - Examples:
     * "Added 7 standard windows to the Master Bedroom."
     * "Added Allowance for Fireplace: $18,000 (set as allowance with 0% margin)."
     * "Updated the fireplace description to include the Town & Country TC42 model."
     * "Removed the old window entry as requested."

2. VALUE-ADD SUGGESTIONS (OPTIONAL but recommended):
   - After confirming what was added, provide helpful value-add suggestions
   - Do NOT add these suggestions to the line item description - keep descriptions factual
   - Use this section to ask clarifying questions or suggest improvements that add value
   - Examples:
     * "Added Allowance for Fireplace: $18,000. Suggestion: Since this is an allowance, do you need to add a separate line item for the installation labor, or is that included?"
     * "Added 7 standard windows. I used standard pricing - did you want to quote for energy-efficient or impact-rated windows instead?"
     * "Added cabinets using cost code 716. If these are custom cabinets, let me know and I can update the pricing."
     * "I wasn't sure about the room location - please confirm if these should go in the Kitchen or if it's a different area."

3. COST CODE MENTION (when relevant):
   - If you selected a cost code and want to confirm it's correct, mention it briefly
   - If you're uncertain about the cost code, ask for clarification
   - Example: "I used cost code 520 (Windows) for this item. Is this correct, or would a different code be more appropriate?"

Keep responses conversational, helpful, and concise. Don't be overly formal. Always provide value-add suggestions when relevant, especially for allowances.

ACTION TYPES:

1. "add_line_item":
   {
     "type": "add_line_item",
     "data": {
       "description": "Clear, detailed description preserving ALL specifics (brands, models, subcontractors, materials). For allowances, prefix with 'ALLOWANCE:'",
       "category": "Short category name (e.g., 'Plumbing', 'Electrical', 'Windows', 'Tile', etc.)",
       "cost_code": "MOST SPECIFIC cost code from the list above (e.g., '406' for Prefab Fireplaces, '715' for Fireplace Mantle, NOT generic codes)",
       "room": "Room name (e.g., 'Kitchen', 'Master Bedroom', 'Primary Bath') or 'General' if unclear",
       "room_name": "Same as room field (for backward compatibility)",
       "room_id": "Optional - UUID of room if you know it (usually omit this, system will resolve room_name)",
       "quantity": number (optional),
       "unit": "EA" | "SF" | "LF" | "SQ" | "ROOM" (optional),
       "unitCost": number (REQUIRED ONLY if user specifies a price - set to exact amount and include pricing_source: "manual"),
       "pricing_source": "manual" | "ai" (REQUIRED if unitCost is provided - use "manual" when user gives price, "ai" otherwise),
       "is_allowance": boolean (REQUIRED if user mentions "allowance" - set to true, then margin_percent must be 0),
       "margin_percent": number (REQUIRED if is_allowance is true - set to 0 for allowances unless user specifies otherwise),
       "notes": "Optional notes"
     }
   }
   
   PRICING RULES:
   - If the user provides a specific price/cost/allowance: Include "unitCost" with the exact amount and set "pricing_source" to "manual"
   - If NO price is mentioned: Omit "unitCost" and "pricing_source" - our pricing engine will look it up automatically
   - NEVER guess prices - only include pricing when explicitly provided by the user
   
   ALLOWANCE RULES (when is_allowance is true):
   - Set "margin_percent" to 0 (unless user explicitly specifies a different margin)
   - The "client_price" will be calculated to equal "direct_cost" (no markup on allowances)
   - DO NOT apply standard markup - allowances are fixed-price items
   - Ensure description starts with "ALLOWANCE:" or clearly indicates it's an allowance

2. "update_line_item":
   {
     "type": "update_line_item",
     "data": {
       "line_item_id": "UUID of existing line item",
       "description": "Updated description" (optional),
       "category": "Updated category" (optional),
       "cost_code": "Updated cost code" (optional),
       "room": "Updated room" (optional),
       "quantity": number (optional),
       "unit": "Updated unit" (optional),
       "notes": "Updated notes" (optional)
     }
   }

3. "delete_line_item":
   {
     "type": "delete_line_item",
     "data": {
       "line_item_id": "UUID of line item to delete"
     }
   }

4. "add_room":
   {
     "type": "add_room",
     "data": {
       "name": "Room name (e.g., 'Master Bedroom', 'Kitchen', 'Primary Bath')",
       "type": "Optional room type (e.g., 'bedroom', 'kitchen', 'bathroom')",
       "area_sqft": number (optional - square footage if mentioned),
       "notes": "Optional notes about the room"
     }
   }
   Use this when the user mentions creating a new room or working on a room that doesn't exist yet.

5. "hide_room":
   {
     "type": "hide_room",
     "data": {
       "room_name": "Name of the room to hide (e.g., 'Kitchen', 'Master Bedroom')"
     }
   }
   Use this when the user says they're not doing a room anymore, want to skip it, or remove it from scope.
   This hides the room and all its line items without deleting them.

6. "info":
   {
     "type": "info",
     "data": {
       "message": "Information message for the user"
     }
   }

ADDITIONAL RULES:
- Only create actions when the user explicitly requests changes OR when analyzing files (images/PDFs)
- For general questions, use "info" action type
- Always provide a helpful response_text even when performing actions
- When adding line items, be specific and atomic (one task per item)
- Match room names to common room types: Kitchen, Primary Bath, Bedroom 1, etc.
- If user asks about something but doesn't request a change, use "info" type only
- PRESERVE ALL DETAILS: Never shorten or summarize - capture full brand names, model numbers, subcontractors
- COST CODES: Always use the most specific code available (e.g., "406" for fireplaces, not "400")
- PRICING: Only include unitCost when user explicitly provides a price - otherwise omit it and let the pricing engine fill it
- When analyzing images:
  * Identify all visible construction work, materials, fixtures, and finishes
  * Extract quantities when visible (e.g., number of windows, square footage, linear feet)
  * Infer appropriate cost codes based on what you see
  * Assign to appropriate rooms if identifiable, otherwise use "General"
- When analyzing PDFs:
  * Extract all line items, specifications, and quantities
  * Identify materials, fixtures, and labor requirements
  * Match extracted items to appropriate cost codes

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
): Promise<Array<{ type: string; success: boolean; id?: string; error?: string }>> {
  const results = []

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'add_line_item': {
          const { data } = action
          
          // Resolve room_name to room_id
          const roomName = data.room_name || data.room || 'General'
          const roomId = await resolveRoomName(roomName, projectId, supabase)
          
          // Check if this is an allowance BEFORE applying pricing
          const isAllowance = data.is_allowance === true || 
            (data.description || '').toUpperCase().trim().startsWith('ALLOWANCE:')
          
          // CRITICAL: Skip pricing service for allowances - they have fixed pricing
          // Apply pricing using the pricing service (only for non-allowance items)
          // This handles manual pricing, user library (first priority), task library lookup (second priority), and defaults to AI (third priority)
          let pricedItem
          if (isAllowance) {
            // For allowances, bypass pricing service and use the data as-is
            // Allowances should have unitCost set directly from user input
            const quantity = data.quantity || 1
            const unitCost = data.unitCost || 0
            const directCost = unitCost * quantity
            
            pricedItem = {
              description: data.description || '',
              category: data.category || 'Other',
              cost_code: data.cost_code || null,
              room_name: roomName,
              quantity: quantity,
              unit: data.unit || null,
              labor_cost: 0,
              material_cost: 0,
              overhead_cost: 0,
              direct_cost: directCost,
              margin_percent: 0,
              client_price: directCost,
              pricing_source: 'manual' as const,
              confidence: null,
              notes: data.notes,
              is_allowance: true
            }
          } else {
            pricedItem = await applyPricing({
              description: data.description || '',
              category: data.category || 'Other',
              cost_code: data.cost_code || null,
              room_name: roomName,
              quantity: data.quantity || 1,
              unit: data.unit || null,
              unitCost: data.unitCost,
              pricing_source: data.pricing_source || 'ai',
              notes: data.notes,
              is_allowance: false
            }, userId)
          }
          
          // Use pricing from the service, but also check for task library pricing data
          // that might have been enriched by enrichActionsWithPricing
          // IMPORTANT: Do NOT override manual pricing - if pricing_source is 'manual', use the service result
          let laborCost: number | null = pricedItem.labor_cost || null
          let materialCost: number | null = pricedItem.material_cost || null
          let directCost: number | null = pricedItem.direct_cost || null
          
          // If enrichActionsWithPricing found task library pricing with breakdown,
          // use that instead (it's more detailed) - but only if NOT manual pricing
          if (pricedItem.pricing_source !== 'manual' && data.pricing_source === 'task_library' && data.unit_cost_mid !== undefined) {
            const quantity = data.quantity || 1
            
            // Calculate labor cost from labor hours if available
            if (data.labor_hours_per_unit !== null && data.labor_hours_per_unit !== undefined) {
              // Assume $50/hour labor rate (this could be configurable per user)
              const laborRatePerHour = 50
              laborCost = data.labor_hours_per_unit * laborRatePerHour * quantity
            }
            
            // Calculate material cost
            if (data.material_cost_per_unit !== null && data.material_cost_per_unit !== undefined) {
              materialCost = data.material_cost_per_unit * quantity
            }
            
            // Use unit_cost_mid as direct cost if available and we don't have breakdown
            if (data.unit_cost_mid !== null && data.unit_cost_mid !== undefined) {
              const unitCostTotal = data.unit_cost_mid * quantity
              if (!laborCost && !materialCost) {
                directCost = unitCostTotal
              } else {
                directCost = (laborCost || 0) + (materialCost || 0)
              }
            } else if (laborCost || materialCost) {
              directCost = (laborCost || 0) + (materialCost || 0)
            }
          }
          
          // Calculate margin and client_price (isAllowance already determined above)
          let marginPercent: number | null = null
          let clientPrice: number | null = null
          
          if (isAllowance) {
            // Allowances: margin = 0, client_price = direct_cost (already set in pricedItem above)
            marginPercent = 0
            clientPrice = pricedItem.client_price || pricedItem.direct_cost || 0
            directCost = pricedItem.direct_cost || 0
            laborCost = 0
            materialCost = 0
          } else {
            // Normal items: calculate margin and client_price
            const defaultMargin = 30 // Default margin percentage
            marginPercent = defaultMargin
            if (directCost && !isNaN(directCost)) {
              clientPrice = directCost * (1 + marginPercent / 100)
            }
          }
          
          const insertData: any = {
            estimate_id: estimateId,
            project_id: projectId,
            description: pricedItem.description,
            category: pricedItem.category,
            cost_code: pricedItem.cost_code,
            room_name: roomName, // Keep room_name for backward compatibility
            room_id: roomId, // Use resolved room_id
            quantity: pricedItem.quantity,
            unit: pricedItem.unit,
            labor_cost: laborCost,
            material_cost: materialCost,
            direct_cost: directCost,
            margin_percent: marginPercent,
            client_price: clientPrice,
            is_allowance: isAllowance,
            pricing_source: pricedItem.pricing_source || 'ai',
            confidence: pricedItem.confidence || data.confidence || null,
            is_active: true
          }
          
          // Add task_library_id if available
          if (data.task_library_id) {
            insertData.task_library_id = data.task_library_id
          }
          
          const { data: newItem, error } = await supabase
            .from('estimate_line_items')
            .insert(insertData)
            .select('id')
            .single()

          if (error) throw error
          results.push({ type: 'add_line_item', success: true, id: newItem.id })
          break
        }

        case 'update_line_item': {
          const { data } = action
          if (!data.line_item_id) {
            results.push({ type: 'update_line_item', success: false, error: 'Missing line_item_id' })
            break
          }

          const updateData: any = {}
          if (data.description !== undefined) updateData.description = data.description
          if (data.category !== undefined) updateData.category = data.category
          if (data.cost_code !== undefined) updateData.cost_code = data.cost_code
          if (data.room !== undefined || data.room_name !== undefined) {
            const roomName = data.room_name || data.room
            updateData.room_name = roomName
            // Resolve room_name to room_id
            const roomId = await resolveRoomName(roomName, projectId, supabase)
            if (roomId) {
              updateData.room_id = roomId
            }
          }
          if (data.quantity !== undefined) updateData.quantity = data.quantity
          if (data.unit !== undefined) updateData.unit = data.unit
          if (data.notes !== undefined) updateData.notes = data.notes

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
            results.push({ type: 'update_line_item', success: true, id: data.line_item_id })
          }
          break
        }

        case 'delete_line_item': {
          const { data } = action
          if (!data.line_item_id) {
            results.push({ type: 'delete_line_item', success: false, error: 'Missing line_item_id' })
            break
          }

          // RLS will automatically verify ownership
          const { error } = await supabase
            .from('estimate_line_items')
            .delete()
            .eq('id', data.line_item_id)

          if (error) {
            if (error.code === 'PGRST116') {
              results.push({ type: 'delete_line_item', success: false, error: 'Line item not found' })
            } else {
              throw error
            }
          } else {
            results.push({ type: 'delete_line_item', success: true, id: data.line_item_id })
          }
          break
        }

        case 'add_room': {
          const { data } = action
          if (!data.name || !data.name.trim()) {
            results.push({ type: 'add_room', success: false, error: 'Missing room name' })
            break
          }

          const roomId = await createRoom(data.name.trim(), projectId, supabase)
          
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

          // Hide the room (set is_active = false)
          const { error: updateError } = await supabase
            .from('rooms')
            .update({ is_active: false })
            .eq('id', matchedRoom.id)

          if (updateError) {
            results.push({ type: 'hide_room', success: false, error: `Failed to hide room: ${updateError.message}` })
            break
          }

          // Cascade: Hide all line items linked to this room
          await supabase
            .from('estimate_line_items')
            .update({ is_active: false })
            .eq('room_id', matchedRoom.id)

          results.push({ type: 'hide_room', success: true, id: matchedRoom.id })
          break
        }

        case 'info': {
          // Info actions don't modify the database
          results.push({ type: 'info', success: true })
          break
        }

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

