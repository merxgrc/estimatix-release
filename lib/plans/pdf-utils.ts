/**
 * PDF Utilities for Plan Parsing
 * 
 * PRIMARY: pdf-parse v2 (self-contained, bundles its own pdfjs-dist, no native deps)
 * FALLBACK: pdfjs-dist (for edge cases where pdf-parse fails)
 * 
 * Provides:
 * - Page-by-page text extraction
 * - Page count detection
 * - PDF type detection (vector / scanned / mixed)
 * - PDF page rendering to images for vision AI
 * - Text-based page sampling for large documents
 */

// =============================================================================
// Types
// =============================================================================

export interface ExtractedPage {
  pageNumber: number
  text: string
  hasText: boolean
}

export interface PdfExtractionResult {
  pages: ExtractedPage[]
  totalPages: number
  hasEmbeddedText: boolean
  error?: string
}

export interface RenderedPage {
  pageNumber: number
  base64: string  // Base64-encoded PNG
  width: number
  height: number
}

export type PdfDocType = 'vector' | 'scanned' | 'mixed'

export interface PdfTypeDetection {
  type: PdfDocType
  textRatio: number
  totalPages: number
  pagesWithText: number
  pagesWithoutText: number
  fileSizeBytes?: number
}

// =============================================================================
// Internal: get PDFParse class (cached)
// =============================================================================

let _PDFParse: any = null

function getPDFParseClass(): any {
  if (!_PDFParse) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('pdf-parse')
      _PDFParse = mod.PDFParse || mod.default?.PDFParse
      if (!_PDFParse) throw new Error('PDFParse class not found in pdf-parse module')
      console.log('[PDF Utils] pdf-parse loaded successfully via require()')
    } catch (err) {
      console.error('[PDF Utils] Failed to load pdf-parse via require():', err instanceof Error ? err.message : err)
      throw err
    }
  }
  return _PDFParse
}

// =============================================================================
// PDF Text Extraction (Page by Page)
// =============================================================================

/**
 * Extract text from each page of a PDF buffer.
 * 
 * PRIMARY: pdf-parse v2 getText()
 * FALLBACK: pdfjs-dist legacy build
 */
export async function extractPdfPagesWithText(
  buffer: Buffer
): Promise<PdfExtractionResult> {
  const startMs = Date.now()
  const result: PdfExtractionResult = {
    pages: [],
    totalPages: 0,
    hasEmbeddedText: false,
  }

  // Diagnostic header
  console.log(`[PDF Utils] extractPdfPagesWithText: buffer ${buffer.length} bytes, first5=${buffer.toString('ascii', 0, 5)}`)

  // ---------------------------------------------------------------
  // PRIMARY: pdf-parse v2 (self-contained, no native deps needed)
  // ---------------------------------------------------------------
  try {
    const PDFParse = getPDFParseClass()
    console.log('[PDF Utils] PDFParse class loaded OK')
    const parser = new PDFParse({ data: buffer })
    console.log('[PDF Utils] PDFParse instance created')

    // Get page count
    let pageCount = 1
    try {
      const info = await parser.getInfo()
      pageCount = info?.total || 1
      console.log(`[PDF Utils] pdf-parse getInfo: ${pageCount} pages (${Date.now() - startMs}ms)`)
    } catch (infoErr) {
      console.warn('[PDF Utils] pdf-parse getInfo failed:', infoErr instanceof Error ? infoErr.message : infoErr)
      if (infoErr instanceof Error) console.warn('[PDF Utils] getInfo stack:', infoErr.stack?.split('\n').slice(0, 3).join('\n'))
    }

    // Get text
    const textResult = await parser.getText()
    await parser.destroy().catch(() => {})
    console.log(`[PDF Utils] pdf-parse getText completed (${Date.now() - startMs}ms), keys: ${Object.keys(textResult || {}).join(',')}`)

    result.totalPages = pageCount

    // pdf-parse v2 getText returns { pages: [{ text, num }], text, total }
    if (textResult?.pages && Array.isArray(textResult.pages)) {
      for (const page of textResult.pages) {
        const text = (page.text || '').trim()
        const pageNum = page.num || (result.pages.length + 1)
        result.pages.push({
          pageNumber: pageNum,
          text,
          hasText: text.length > 20,
        })
        if (text.length > 20) {
          result.hasEmbeddedText = true
        }
      }
      // If pdf-parse returned fewer page objects than total, fill in blanks
      while (result.pages.length < pageCount) {
        result.pages.push({
          pageNumber: result.pages.length + 1,
          text: '',
          hasText: false,
        })
      }
    } else {
      // Fallback: try splitting the full text by form feeds
      const fullText: string = textResult?.text || ''
      console.log(`[PDF Utils] getText returned no page array; full text length: ${fullText.length}`)
      if (fullText.trim().length > 0) {
        result.hasEmbeddedText = true
        const pageTexts = fullText.split(/\f|\n{4,}/).filter((p: string) => p.trim().length > 0)
        if (pageTexts.length > 0) {
          pageTexts.forEach((text: string, index: number) => {
            result.pages.push({
              pageNumber: index + 1,
              text: text.trim(),
              hasText: text.trim().length > 20,
            })
          })
        } else {
          result.pages.push({ pageNumber: 1, text: fullText.trim(), hasText: true })
        }
      }
    }

    console.log(`[PDF Utils] pdf-parse extracted ${result.pages.length} pages, ${result.pages.filter(p => p.hasText).length} with text (${Date.now() - startMs}ms)`)
    return result
  } catch (primaryError) {
    console.error('[PDF Utils] pdf-parse v2 PRIMARY extraction FAILED:', primaryError instanceof Error ? primaryError.message : primaryError)
    if (primaryError instanceof Error) {
      console.error('[PDF Utils] PRIMARY stack:', primaryError.stack)
    }
  }

  // ---------------------------------------------------------------
  // FALLBACK: pdfjs-dist (may have bundling issues on Vercel)
  // ---------------------------------------------------------------
  try {
    console.log('[PDF Utils] Trying pdfjs-dist fallback...')
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = ''
    }
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    })
    const doc = await loadingTask.promise

    result.totalPages = doc.numPages

    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const page = await doc.getPage(i)
        const content = await page.getTextContent()
        const strings = content.items
          ?.map((item: Record<string, unknown>) => (item as { str?: string }).str)
          .filter(Boolean) ?? []
        const text = strings.join(' ').trim()

        result.pages.push({ pageNumber: i, text, hasText: text.length > 20 })
        if (text.length > 20) result.hasEmbeddedText = true
      } catch (pageError) {
        console.warn(`[PDF Utils] pdfjs page ${i} error:`, pageError)
        result.pages.push({ pageNumber: i, text: '', hasText: false })
      }
    }

    console.log(`[PDF Utils] pdfjs-dist extracted ${result.pages.length} pages, ${result.pages.filter(p => p.hasText).length} with text`)
    return result
  } catch (fallbackError) {
    console.error('[PDF Utils] pdfjs-dist FALLBACK also FAILED:', fallbackError instanceof Error ? fallbackError.message : fallbackError)
    if (fallbackError instanceof Error) {
      console.error('[PDF Utils] FALLBACK stack:', fallbackError.stack)
    }
    return {
      pages: [],
      totalPages: 0,
      hasEmbeddedText: false,
      error: `Failed to extract text from PDF (both parsers failed). The file may be image-only or corrupted. Primary: pdf-parse error. Fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
    }
  }
}

// =============================================================================
// Page Sampling for Large Documents
// =============================================================================

/**
 * Intelligently sample pages from a large document for classification.
 * Strategy: first 5 + last 2 + evenly sampled middle pages with text.
 */
export function samplePagesForClassification(
  pages: ExtractedPage[],
  maxPages: number = 20
): ExtractedPage[] {
  const totalPages = pages.length
  if (totalPages <= maxPages) return pages

  const samples: ExtractedPage[] = []
  const usedPageNumbers = new Set<number>()

  // First 5 pages
  const firstN = Math.min(5, totalPages)
  for (let i = 0; i < firstN; i++) {
    samples.push(pages[i])
    usedPageNumbers.add(pages[i].pageNumber)
  }

  // Last 2 pages
  const lastN = Math.min(2, totalPages - firstN)
  for (let i = totalPages - lastN; i < totalPages; i++) {
    if (!usedPageNumbers.has(pages[i].pageNumber)) {
      samples.push(pages[i])
      usedPageNumbers.add(pages[i].pageNumber)
    }
  }

  // Fill remaining with middle pages that have text
  const remaining = maxPages - samples.length
  if (remaining > 0) {
    const middlePages = pages.filter(p => !usedPageNumbers.has(p.pageNumber) && p.hasText)
    if (middlePages.length > 0) {
      const step = Math.max(1, Math.floor(middlePages.length / remaining))
      for (let i = 0; i < remaining && i * step < middlePages.length; i++) {
        const page = middlePages[i * step]
        if (!usedPageNumbers.has(page.pageNumber)) {
          samples.push(page)
          usedPageNumbers.add(page.pageNumber)
        }
      }
    }
  }

  return samples.sort((a, b) => a.pageNumber - b.pageNumber)
}

/** Truncate text content for API calls */
export function truncatePageText(text: string, maxChars: number = 1500): string {
  if (text.length <= maxChars) return text
  const truncated = text.slice(0, maxChars)
  const lastPeriod = truncated.lastIndexOf('.')
  const lastNewline = truncated.lastIndexOf('\n')
  const cutPoint = Math.max(lastPeriod, lastNewline, maxChars - 100)
  return truncated.slice(0, cutPoint) + '...'
}

/** Prepare pages for API classification call */
export function preparePagesForClassification(
  pages: ExtractedPage[],
  maxTotalChars: number = 50000
): Array<{ pageNumber: number; text: string }> {
  const result: Array<{ pageNumber: number; text: string }> = []
  let totalChars = 0
  const charPerPage = Math.floor(maxTotalChars / pages.length)

  for (const page of pages) {
    const truncatedText = truncatePageText(page.text, Math.min(charPerPage, 1500))
    result.push({ pageNumber: page.pageNumber, text: truncatedText })
    totalChars += truncatedText.length
    if (totalChars > maxTotalChars) break
  }

  return result
}

// =============================================================================
// Page Content Analysis (Heuristics)
// =============================================================================

export function pageContainsRoomKeywords(text: string): boolean {
  const lowerText = text.toLowerCase()
  const roomKeywords = [
    'bedroom', 'bathroom', 'kitchen', 'living', 'dining',
    'garage', 'closet', 'laundry', 'utility', 'hallway',
    'foyer', 'office', 'basement', 'attic', 'porch',
    'master', 'guest', 'family room', 'great room',
    'mbr', 'br1', 'br2', 'ba1', 'ba2', 'mba',
    'sqft', 'sq ft', 'square feet', 'sf',
    'floor plan', 'layout', 'room schedule',
  ]
  return roomKeywords.some(keyword => lowerText.includes(keyword))
}

export function pageContainsSchedule(text: string): boolean {
  const lowerText = text.toLowerCase()
  const scheduleKeywords = [
    'schedule', 'finish schedule', 'door schedule',
    'window schedule', 'room finish', 'material schedule',
    'fixture schedule', 'hardware schedule',
  ]
  return scheduleKeywords.some(keyword => lowerText.includes(keyword))
}

export function isLikelyScannedPdf(extractionResult: PdfExtractionResult): boolean {
  if (extractionResult.totalPages === 0) return true
  if (!extractionResult.hasEmbeddedText) return true
  const pagesWithText = extractionResult.pages.filter(p => p.hasText).length
  return pagesWithText / extractionResult.totalPages < 0.2
}

// =============================================================================
// PDF Type Detection
// =============================================================================

/**
 * Detect PDF type: vector (text-rich), scanned (image-only), or mixed.
 *
 * Thresholds:
 *  - vector:  >= 80% pages have text
 *  - scanned: <= 20% pages have text
 *  - mixed:   between 20-80%
 */
export function detectPdfType(
  extractionResult: PdfExtractionResult,
  fileSizeBytes?: number,
): PdfTypeDetection {
  const { totalPages, pages, hasEmbeddedText } = extractionResult

  if (totalPages === 0) {
    return { type: 'scanned', textRatio: 0, totalPages: 0, pagesWithText: 0, pagesWithoutText: 0, fileSizeBytes }
  }

  const pagesWithText = pages.filter(p => p.hasText).length
  const pagesWithoutText = totalPages - pagesWithText
  const textRatio = pagesWithText / totalPages

  let type: PdfDocType
  if (!hasEmbeddedText || textRatio <= 0.2) {
    type = 'scanned'
  } else if (textRatio >= 0.8) {
    type = 'vector'
  } else {
    type = 'mixed'
  }

  return { type, textRatio, totalPages, pagesWithText, pagesWithoutText, fileSizeBytes }
}

/**
 * Get page count from a PDF buffer using pdf-parse v2.
 * Useful when text extraction fails entirely.
 */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    const PDFParse = getPDFParseClass()
    const parser = new PDFParse({ data: buffer })
    const info = await parser.getInfo()
    await parser.destroy().catch(() => {})
    return info?.total || 0
  } catch {
    return 0
  }
}

// =============================================================================
// PDF Page to Image Conversion (for Vision AI)
// =============================================================================

/**
 * Maximum base64 size per image (bytes). Images above this are re-rendered at
 * lower scale to stay within OpenAI vision API payload limits (~20 MB total).
 */
const MAX_IMAGE_BASE64_BYTES = 4 * 1024 * 1024 // 4 MB per image

/**
 * Render specific PDF pages to base64 images for vision AI analysis.
 * 
 * PRIMARY: pdf-parse v2 getScreenshot (pure JS, no native deps needed)
 * FALLBACK: pdfjs-dist + node-canvas (requires native canvas)
 *
 * Images that exceed MAX_IMAGE_BASE64_BYTES are automatically re-rendered
 * at a lower scale (0.75) to keep payloads manageable.
 */
export async function renderPdfPagesToImages(
  buffer: Buffer,
  pageNumbers: number[],
  scale: number = 1.0
): Promise<RenderedPage[]> {
  if (pageNumbers.length === 0) return []

  const startMs = Date.now()
  console.log(`[PDF Utils] renderPdfPagesToImages: ${pageNumbers.length} pages [${pageNumbers.join(', ')}] at scale ${scale}, buffer ${buffer.length} bytes`)

  // ---------------------------------------------------------------
  // PRIMARY: pdf-parse v2 getScreenshot (no native dependencies)
  // ---------------------------------------------------------------
  try {
    const PDFParse = getPDFParseClass()
    const parser = new PDFParse({ data: buffer })

    console.log(`[PDF Utils] Calling getScreenshot (scale=${scale})...`)
    const ssResult = await parser.getScreenshot({
      partial: pageNumbers,
      scale,
      imageDataUrl: true,
      imageBuffer: false,
    })

    await parser.destroy().catch(() => {})

    const results: RenderedPage[] = []

    if (ssResult?.pages && Array.isArray(ssResult.pages)) {
      for (let i = 0; i < ssResult.pages.length; i++) {
        const page = ssResult.pages[i]
        const dataUrl: string = page.dataUrl || page.data_url || ''
        let base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : ''

        if (base64 && base64.length > 100) {
          const sizeKB = Math.round(base64.length / 1024)
          const pageNum = page.pageNumber || pageNumbers[i] || (i + 1)

          // If the image is too large, re-render at lower scale
          if (base64.length > MAX_IMAGE_BASE64_BYTES && scale > 0.5) {
            console.warn(`[PDF Utils] Page ${pageNum} image is ${sizeKB}KB (>${Math.round(MAX_IMAGE_BASE64_BYTES / 1024)}KB), re-rendering at scale 0.75`)
            try {
              const smallParser = new PDFParse({ data: buffer })
              const smallSs = await smallParser.getScreenshot({
                partial: [pageNum],
                scale: 0.75,
                imageDataUrl: true,
                imageBuffer: false,
              })
              await smallParser.destroy().catch(() => {})
              const smallPage = smallSs?.pages?.[0]
              const smallUrl: string = smallPage?.dataUrl || smallPage?.data_url || ''
              const smallBase64 = smallUrl.includes(',') ? smallUrl.split(',')[1] : ''
              if (smallBase64 && smallBase64.length > 100) {
                base64 = smallBase64
                console.log(`[PDF Utils] Page ${pageNum} re-rendered: ${Math.round(smallBase64.length / 1024)}KB`)
              }
            } catch (resizeErr) {
              console.warn(`[PDF Utils] Re-render at lower scale failed for page ${pageNum}:`, resizeErr instanceof Error ? resizeErr.message : resizeErr)
            }
          }

          results.push({
            pageNumber: pageNum,
            base64,
            width: page.width || 0,
            height: page.height || 0,
          })
          console.log(`[PDF Utils] Page ${pageNum} rendered via pdf-parse: ${Math.round(base64.length / 1024)}KB, ${page.width}x${page.height} (${Date.now() - startMs}ms)`)
        }
      }
    } else {
      console.warn('[PDF Utils] getScreenshot returned:', ssResult ? Object.keys(ssResult) : 'null')
    }

    if (results.length > 0) {
      console.log(`[PDF Utils] Successfully rendered ${results.length}/${pageNumbers.length} pages via pdf-parse v2 (${Date.now() - startMs}ms)`)
      return results
    }

    console.warn('[PDF Utils] pdf-parse getScreenshot returned no usable pages')
  } catch (ppError) {
    console.error('[PDF Utils] pdf-parse getScreenshot FAILED:', ppError instanceof Error ? ppError.message : ppError)
    if (ppError instanceof Error) {
      console.error('[PDF Utils] getScreenshot stack:', ppError.stack)
    }
  }

  // ---------------------------------------------------------------
  // FALLBACK: pdfjs-dist + node-canvas
  // ---------------------------------------------------------------
  const results: RenderedPage[] = []

  try {
    let createCanvas: any
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const canvasModule = require('canvas')
      createCanvas = canvasModule.createCanvas
      console.log('[PDF Utils] Canvas module loaded for pdfjs fallback')
    } catch (canvasErr) {
      console.warn('[PDF Utils] Canvas not available, skipping pdfjs+canvas fallback:', canvasErr instanceof Error ? canvasErr.message : canvasErr)
      return []
    }

    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = ''
    }

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
      useSystemFonts: true,
    })
    const doc = await loadingTask.promise

    for (const pageNum of pageNumbers) {
      if (pageNum < 1 || pageNum > doc.numPages) continue

      try {
        const page = await doc.getPage(pageNum)
        const viewport = page.getViewport({ scale })
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        const context = canvas.getContext('2d')

        context.fillStyle = 'white'
        context.fillRect(0, 0, canvas.width, canvas.height)

        await page.render({ canvasContext: context, viewport, background: 'white' }).promise

        const dataUrl = canvas.toDataURL('image/png')
        const base64 = dataUrl.split(',')[1]

        if (base64 && base64.length > 100) {
          results.push({
            pageNumber: pageNum,
            base64,
            width: Math.ceil(viewport.width),
            height: Math.ceil(viewport.height),
          })
          console.log(`[PDF Utils] pdfjs+canvas page ${pageNum}: ${Math.round(base64.length / 1024)}KB`)
        }
      } catch (pageError) {
        console.error(`[PDF Utils] pdfjs+canvas page ${pageNum} error:`, pageError)
      }
    }

    if (results.length > 0) {
      console.log(`[PDF Utils] pdfjs+canvas rendered ${results.length} pages (${Date.now() - startMs}ms)`)
    }
    return results
  } catch (error) {
    console.error('[PDF Utils] pdfjs+canvas fallback error:', error instanceof Error ? error.message : error)
    if (error instanceof Error) console.error('[PDF Utils] pdfjs+canvas stack:', error.stack)
    return results
  }
}

/**
 * Select best pages to render for room detection.
 * For construction docs, floor plans are usually pages 2-5 (page 1 = cover).
 */
export function selectPagesForVisionAnalysis(
  totalPages: number,
  maxPages: number = 3
): number[] {
  if (totalPages <= 0) return []
  if (totalPages <= maxPages) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  // Skip cover page (1), take next pages
  const targetPages: number[] = []
  for (let i = 2; i <= Math.min(totalPages, maxPages + 1); i++) {
    targetPages.push(i)
  }

  return targetPages
}
