import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

async function parseWithPdfParse(buffer: Buffer) {
  const pdfParseModule = await import('pdf-parse')
  const pdfParse = (pdfParseModule as any).default || pdfParseModule
  return pdfParse(buffer)
}

async function parseWithPdfJs(buffer: Buffer) {
  // Legacy build (mjs) avoids canvas dependency on Node.js
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) })
  const doc = await loadingTask.promise
  const pages: string[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const strings = content.items?.map((item: any) => item.str).filter(Boolean) ?? []
    pages.push(strings.join(' '))
  }

  return {
    text: pages.join('\n\n'),
    numpages: doc.numPages,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { bucketName, filePath } = await req.json()

    if (!bucketName || !filePath) {
      return NextResponse.json(
        { code: 'BAD_REQUEST', message: 'bucketName and filePath are required.' },
        { status: 400 }
      )
    }

    const supabase = createServiceRoleClient()

    // Download guard
    console.log(`[PDF Success] Downloading file: ${filePath}`)
    const { data, error: downloadError } = await supabase.storage.from(bucketName).download(filePath)
    if (downloadError || !data) {
      console.error(`[PDF Error] Download failed for ${filePath}:`, downloadError)
      return NextResponse.json(
        { code: 'FILE_NOT_FOUND', message: 'Could not retrieve file.' },
        { status: 404 }
      )
    }

    const buffer = Buffer.from(await data.arrayBuffer())
    console.log(`[PDF Success] File size: ${buffer.length} bytes`)

    // Size guard
    if (buffer.length > MAX_FILE_SIZE) {
      const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
      console.warn(`[PDF Warning] File too large (${fileSizeMB}MB) for ${filePath}`)
      return NextResponse.json(
        { code: 'FILE_TOO_LARGE', message: 'PDF exceeds 10MB size limit.' },
        { status: 413 }
      )
    }

    // Primary attempt: pdf-parse
    let extractedText = ''
    let pageCount = 0
    try {
      const pdfData = await parseWithPdfParse(buffer)
      extractedText = pdfData.text || ''
      pageCount = pdfData.numpages || 0
    } catch (primaryErr) {
      console.warn(`[PDF Warning] pdf-parse failed, attempting fallback with pdfjs-dist:`, primaryErr)
      // Fallback with pdfjs-dist
      try {
        const pdfData = await parseWithPdfJs(buffer)
        extractedText = pdfData.text || ''
        pageCount = pdfData.numpages || 0
      } catch (fallbackErr) {
        console.error(`[PDF Error] Fallback parser failed for ${filePath}:`, fallbackErr)
        return NextResponse.json(
          { code: 'CORRUPTED_FILE', message: 'PDF file is corrupted or incompatible.' },
          { status: 422 }
        )
      }
    }

    // Empty text guard
    if (!extractedText.trim()) {
      console.warn(`[PDF Warning] Scanned/empty PDF detected for ${filePath}`)
      return NextResponse.json(
        { code: 'SCANNED_PDF', message: 'This looks like an image-only PDF. Please paste the text manually.' },
        { status: 422 }
      )
    }

    console.log(`[PDF Success] Parsed text length: ${extractedText.length}, pages=${pageCount}`)
    return NextResponse.json(
      { success: true, text: extractedText, pageCount },
      { status: 200 }
    )
  } catch (err) {
    console.error('[PDF Error] Unexpected failure:', err)
    return NextResponse.json(
      { code: 'UNEXPECTED_ERROR', message: 'Unexpected error processing PDF.' },
      { status: 500 }
    )
  }
}

