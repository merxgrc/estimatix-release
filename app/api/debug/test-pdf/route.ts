import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/supabase/server'

export const runtime = 'nodejs' // Required for pdf-parse and Buffer operations

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB in bytes

/**
 * Debug endpoint for testing PDF processing pipeline
 * 
 * This route tests PDF text extraction from Supabase Storage:
 * - Downloads file from Storage using Admin client (bypasses RLS)
 * - Converts blob to Buffer
 * - Parses PDF with pdf-parse
 * - Validates extracted text
 * - Provides detailed logging for debugging
 * 
 * Usage:
 * POST /api/debug/test-pdf
 * Content-Type: application/json
 * Body: { filePath: string, bucketName: string }
 * 
 * Response:
 * {
 *   success: boolean,
 *   filePath?: string,
 *   bucketName?: string,
 *   fileSize?: number,
 *   extractedText?: string,
 *   textLength?: number,
 *   pageCount?: number,
 *   first100Chars?: string,
 *   error?: string,
 *   code?: string,
 *   details?: any
 * }
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[PDF Debug] Starting PDF processing test...')

    // Require authentication
    const user = await requireAuth()
    if (!user || !user.id) {
      console.error('[PDF Debug] Authentication failed')
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    console.log('[PDF Debug] User authenticated:', user.id)

    // Parse request body
    const body = await req.json()
    const { filePath, bucketName } = body

    if (!filePath || typeof filePath !== 'string') {
      console.error('[PDF Debug] Missing or invalid filePath:', filePath)
      return NextResponse.json(
        { error: 'Missing or invalid filePath in request body' },
        { status: 400 }
      )
    }

    if (!bucketName || typeof bucketName !== 'string') {
      console.error('[PDF Debug] Missing or invalid bucketName:', bucketName)
      return NextResponse.json(
        { error: 'Missing or invalid bucketName in request body' },
        { status: 400 }
      )
    }

    console.log('[PDF Debug] Request parameters:', { filePath, bucketName })

    // Step 1: Initialize Supabase Admin client (bypasses RLS)
    console.log('[PDF Debug] Initializing Supabase Admin client...')
    const supabase = createServiceRoleClient()
    console.log('[PDF Debug] Supabase Admin client initialized successfully')

    // Step 2: Download file from Storage
    console.log('[PDF Debug] Attempting to download file from Storage...')
    console.log('[PDF Debug] Bucket:', bucketName, 'Path:', filePath)

    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(filePath)

    if (downloadError) {
      const errorCode = (downloadError as any)?.statusCode ?? (downloadError as any)?.code
      console.error('[PDF Debug] Download Error:', downloadError)
      console.error('[PDF Debug] Error code:', errorCode)
      console.error('[PDF Debug] Error message:', downloadError.message)
      return NextResponse.json(
        {
          success: false,
          error: `Failed to download file from Storage: ${downloadError.message}`,
          code: errorCode?.toString() || 'DOWNLOAD_ERROR',
          details: {
            bucketName,
            filePath,
            errorCode,
          },
        },
        { status: 500 }
      )
    }

    if (!fileData) {
      console.error('[PDF Debug] Download returned null/undefined fileData')
      return NextResponse.json(
        {
          success: false,
          error: 'File download returned null data',
          code: 'EMPTY_DOWNLOAD',
        },
        { status: 500 }
      )
    }

    console.log('[PDF Debug] Download Success - File downloaded from Storage')
    console.log('[PDF Debug] File blob type:', fileData.type)
    console.log('[PDF Debug] File blob size:', fileData.size, 'bytes')

    // Step 3: Convert blob to Buffer
    console.log('[PDF Debug] Converting blob to Buffer...')
    const arrayBuffer = await fileData.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    console.log('[PDF Debug] Buffer created successfully')
    console.log('[PDF Debug] Buffer length:', buffer.length, 'bytes')

    // Step 4: Check file size
    const fileSizeBytes = buffer.length
    const fileSizeMB = fileSizeBytes / (1024 * 1024)
    console.log('[PDF Debug] File size:', fileSizeMB.toFixed(2), 'MB')

    if (fileSizeBytes > MAX_FILE_SIZE) {
      console.error('[PDF Debug] File size exceeds limit:', fileSizeMB.toFixed(2), 'MB > 10MB')
      return NextResponse.json(
        {
          success: false,
          error: `File size (${fileSizeMB.toFixed(2)}MB) exceeds maximum allowed size (10MB)`,
          code: 'FILE_TOO_LARGE',
          fileSize: fileSizeBytes,
          maxSize: MAX_FILE_SIZE,
        },
        { status: 413 }
      )
    }

    console.log('[PDF Debug] File size check passed')

    // Step 5: Parse PDF with pdf-parse
    console.log('[PDF Debug] Importing pdf-parse module...')
    let pdfParse: any
    try {
      const pdfParseModule = await import('pdf-parse')
      pdfParse = (pdfParseModule as any).default || pdfParseModule
      console.log('[PDF Debug] pdf-parse imported successfully')
    } catch (importError) {
      console.error('[PDF Debug] Failed to import pdf-parse:', importError)
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to import pdf-parse module',
          code: 'IMPORT_ERROR',
          details: importError instanceof Error ? importError.message : String(importError),
        },
        { status: 500 }
      )
    }

    console.log('[PDF Debug] Attempting to parse PDF buffer...')
    let pdfData: any
    try {
      pdfData = await pdfParse(buffer)
      console.log('[PDF Debug] PDF parsed successfully')
      console.log('[PDF Debug] Page count:', pdfData.numpages)
      console.log('[PDF Debug] Extracted text length:', pdfData.text?.length || 0, 'characters')
    } catch (parseError) {
      console.error('[PDF Error] PDF parsing failed:', parseError)
      console.error('[PDF Error] Error type:', parseError instanceof Error ? parseError.constructor.name : typeof parseError)
      console.error('[PDF Error] Error message:', parseError instanceof Error ? parseError.message : String(parseError))
      console.error('[PDF Error] Error stack:', parseError instanceof Error ? parseError.stack : 'No stack trace')

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to parse PDF file',
          code: 'PARSE_ERROR',
          details: {
            message: parseError instanceof Error ? parseError.message : String(parseError),
            type: parseError instanceof Error ? parseError.constructor.name : typeof parseError,
          },
        },
        { status: 500 }
      )
    }

    // Step 6: Log first 100 characters of extracted text
    const extractedText = pdfData.text || ''
    const first100Chars = extractedText.substring(0, 100)
    console.log('[PDF Debug] First 100 characters of extracted text:')
    console.log('[PDF Debug]', first100Chars)
    console.log('[PDF Debug] Full text length:', extractedText.length)

    // Step 7: Check if text is empty or whitespace only
    const trimmedText = extractedText.trim()
    if (!trimmedText || trimmedText.length === 0) {
      console.error('[PDF Debug] Extracted text is empty or whitespace only')
      console.error('[PDF Debug] This likely indicates a scanned/image-based PDF')
      return NextResponse.json(
        {
          success: false,
          error: 'This appears to be a scanned image.',
          code: 'SCANNED_PDF',
          details: {
            textLength: extractedText.length,
            trimmedLength: trimmedText.length,
            pageCount: pdfData.numpages,
          },
        },
        { status: 422 }
      )
    }

    console.log('[PDF Debug] Text extraction validation passed')
    console.log('[PDF Debug] Non-whitespace text length:', trimmedText.length)

    // Success response
    return NextResponse.json({
      success: true,
      filePath,
      bucketName,
      fileSize: fileSizeBytes,
      fileSizeMB: parseFloat(fileSizeMB.toFixed(2)),
      extractedText: extractedText,
      textLength: extractedText.length,
      trimmedTextLength: trimmedText.length,
      pageCount: pdfData.numpages,
      first100Chars: first100Chars,
      metadata: {
        info: pdfData.info,
        metadata: pdfData.metadata,
      },
    })

  } catch (error) {
    console.error('[PDF Debug] Unexpected error:', error)
    console.error('[PDF Debug] Error type:', error instanceof Error ? error.constructor.name : typeof error)
    console.error('[PDF Debug] Error message:', error instanceof Error ? error.message : String(error))
    console.error('[PDF Debug] Error stack:', error instanceof Error ? error.stack : 'No stack trace')

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process PDF',
        code: 'UNEXPECTED_ERROR',
        details: process.env.NODE_ENV === 'development'
          ? {
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              type: error instanceof Error ? error.constructor.name : typeof error,
            }
          : undefined,
      },
      { status: 500 }
    )
  }
}

