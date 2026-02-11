/**
 * PDF Utilities for Plan Parsing
 * 
 * Provides:
 * - Page-by-page text extraction
 * - Page count detection
 * - Text-based page sampling for large documents
 * 
 * Note: For image-only PDFs, the main route falls back to 
 * treating the PDF as needing manual room entry.
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

// =============================================================================
// PDF Text Extraction (Page by Page)
// =============================================================================

/**
 * Extract text from each page of a PDF buffer
 * Uses pdfjs-dist for page-level extraction
 * Falls back to pdf-parse if pdfjs fails
 */
export async function extractPdfPagesWithText(
  buffer: Buffer
): Promise<PdfExtractionResult> {
  const result: PdfExtractionResult = {
    pages: [],
    totalPages: 0,
    hasEmbeddedText: false,
  }

  try {
    // Try pdfjs-dist for page-by-page extraction
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // Disable worker to avoid worker-file resolution issues in Next.js server
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
        
        result.pages.push({
          pageNumber: i,
          text,
          hasText: text.length > 20, // Meaningful text threshold
        })
        
        if (text.length > 20) {
          result.hasEmbeddedText = true
        }
      } catch (pageError) {
        console.warn(`[PDF] Error extracting page ${i}:`, pageError)
        result.pages.push({
          pageNumber: i,
          text: '',
          hasText: false,
        })
      }
    }
    
    return result
  } catch (error) {
    console.error('[PDF] pdfjs extraction error:', error)
    
    // Fallback to pdf-parse v2 (PDFParse class with getText() + getInfo())
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PDFParse } = require('pdf-parse')
      const parser = new PDFParse({ data: buffer })
      
      // Get page count from getInfo
      let pageCount = 1
      try {
        const info = await parser.getInfo()
        pageCount = info?.total || 1
      } catch {
        // If getInfo fails, continue with default
      }
      
      const textResult = await parser.getText()
      await parser.destroy().catch(() => {})
      
      const fullText: string = textResult?.text || ''
      result.totalPages = pageCount
      
      // Split by form feed or multiple newlines (common page breaks)
      const pageTexts = fullText.split(/\f|\n{4,}/).filter((p: string) => p.trim().length > 0)
      
      if (pageTexts.length > 0) {
        result.hasEmbeddedText = true
        pageTexts.forEach((text: string, index: number) => {
          result.pages.push({
            pageNumber: index + 1,
            text: text.trim(),
            hasText: text.trim().length > 20,
          })
        })
      } else if (fullText.trim().length > 0) {
        result.hasEmbeddedText = true
        result.pages.push({
          pageNumber: 1,
          text: fullText.trim(),
          hasText: true,
        })
      }
      
      return result
    } catch (fallbackError) {
      console.error('[PDF] pdf-parse v2 fallback error:', fallbackError)
      return {
        pages: [],
        totalPages: 0,
        hasEmbeddedText: false,
        error: 'Failed to extract text from PDF. The file may be image-only or corrupted.',
      }
    }
  }
}

// =============================================================================
// Page Sampling for Large Documents
// =============================================================================

/**
 * Intelligently sample pages from a large document for classification
 * 
 * Strategy:
 * - Always include first 5 pages (often contain floor plans, index)
 * - Always include last 2 pages (may have schedules, notes)
 * - Sample evenly from the middle
 * - Prioritize pages with more text content
 */
export function samplePagesForClassification(
  pages: ExtractedPage[],
  maxPages: number = 20
): ExtractedPage[] {
  const totalPages = pages.length
  
  if (totalPages <= maxPages) {
    return pages
  }
  
  const samples: ExtractedPage[] = []
  const usedPageNumbers = new Set<number>()
  
  // Always include first 5 pages
  const firstN = Math.min(5, totalPages)
  for (let i = 0; i < firstN; i++) {
    samples.push(pages[i])
    usedPageNumbers.add(pages[i].pageNumber)
  }
  
  // Always include last 2 pages
  const lastN = Math.min(2, totalPages - firstN)
  for (let i = totalPages - lastN; i < totalPages; i++) {
    if (!usedPageNumbers.has(pages[i].pageNumber)) {
      samples.push(pages[i])
      usedPageNumbers.add(pages[i].pageNumber)
    }
  }
  
  // Fill remaining slots with evenly distributed pages that have text
  const remaining = maxPages - samples.length
  if (remaining > 0) {
    const middlePages = pages.filter(p => 
      !usedPageNumbers.has(p.pageNumber) && p.hasText
    )
    
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
  
  // Sort by page number
  return samples.sort((a, b) => a.pageNumber - b.pageNumber)
}

/**
 * Truncate text content for API calls
 */
export function truncatePageText(text: string, maxChars: number = 1500): string {
  if (text.length <= maxChars) return text
  
  // Try to truncate at a sentence boundary
  const truncated = text.slice(0, maxChars)
  const lastPeriod = truncated.lastIndexOf('.')
  const lastNewline = truncated.lastIndexOf('\n')
  const cutPoint = Math.max(lastPeriod, lastNewline, maxChars - 100)
  
  return truncated.slice(0, cutPoint) + '...'
}

/**
 * Prepare pages for API classification call
 */
export function preparePagesForClassification(
  pages: ExtractedPage[],
  maxTotalChars: number = 50000
): Array<{ pageNumber: number; text: string }> {
  const result: Array<{ pageNumber: number; text: string }> = []
  let totalChars = 0
  const charPerPage = Math.floor(maxTotalChars / pages.length)
  
  for (const page of pages) {
    const truncatedText = truncatePageText(page.text, Math.min(charPerPage, 1500))
    result.push({
      pageNumber: page.pageNumber,
      text: truncatedText,
    })
    totalChars += truncatedText.length
    
    if (totalChars > maxTotalChars) break
  }
  
  return result
}

// =============================================================================
// Page Content Analysis
// =============================================================================

/**
 * Quick heuristic check if a page likely contains room information
 * Based on common room-related keywords
 */
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

/**
 * Quick heuristic check if a page likely contains a schedule
 */
export function pageContainsSchedule(text: string): boolean {
  const lowerText = text.toLowerCase()
  const scheduleKeywords = [
    'schedule', 'finish schedule', 'door schedule',
    'window schedule', 'room finish', 'material schedule',
    'fixture schedule', 'hardware schedule',
  ]
  
  return scheduleKeywords.some(keyword => lowerText.includes(keyword))
}

/**
 * Detect if PDF is likely a scanned document (minimal text)
 */
export function isLikelyScannedPdf(extractionResult: PdfExtractionResult): boolean {
  if (extractionResult.totalPages === 0) return true
  if (!extractionResult.hasEmbeddedText) return true
  
  // If less than 20% of pages have meaningful text, likely scanned
  const pagesWithText = extractionResult.pages.filter(p => p.hasText).length
  return pagesWithText / extractionResult.totalPages < 0.2
}

// =============================================================================
// PDF Type Detection
// =============================================================================

export type PdfDocType = 'vector' | 'scanned' | 'mixed'

export interface PdfTypeDetection {
  type: PdfDocType
  /** Ratio of pages with meaningful text (0-1) */
  textRatio: number
  /** Total page count */
  totalPages: number
  /** Number of pages with meaningful embedded text */
  pagesWithText: number
  /** Number of pages without meaningful text (likely images/scans) */
  pagesWithoutText: number
  /** File size in bytes (if provided) */
  fileSizeBytes?: number
}

/**
 * Detect PDF type: vector (text-rich), scanned (image-only), or mixed.
 * Uses the extraction result that's already computed during triage.
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

  return {
    type,
    textRatio,
    totalPages,
    pagesWithText,
    pagesWithoutText,
    fileSizeBytes,
  }
}

/**
 * Get page count from a PDF buffer using pdf-parse v2.
 * Useful when pdfjs-dist fails to load the document entirely.
 */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse')
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

export interface RenderedPage {
  pageNumber: number
  base64: string  // Base64-encoded PNG
  width: number
  height: number
}

/**
 * Render specific PDF pages to base64 images for vision AI analysis.
 * 
 * Primary method: pdf-parse v2 getScreenshot (pure JS, no native deps).
 * Fallback: pdfjs-dist + node-canvas (requires native canvas).
 * 
 * @param buffer - PDF buffer
 * @param pageNumbers - Array of page numbers to render (1-indexed)
 * @param scale - Render scale (1.0 = 72dpi, 2.0 = 144dpi)
 * @returns Array of rendered pages with base64 PNG data
 */
export async function renderPdfPagesToImages(
  buffer: Buffer,
  pageNumbers: number[],
  scale: number = 1.5  // 1.5x scale for better OCR quality
): Promise<RenderedPage[]> {
  if (pageNumbers.length === 0) return []
  
  console.log(`[PDF Utils] Attempting to render ${pageNumbers.length} pages: ${pageNumbers.join(', ')}`)
  
  // ------------------------------------------------------------------
  // Primary: pdf-parse v2 getScreenshot (no native dependencies needed)
  // ------------------------------------------------------------------
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse')
    const parser = new PDFParse({ data: buffer })
    
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
        // dataUrl is "data:image/png;base64,..."
        const dataUrl: string = page.dataUrl || page.data_url || ''
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : ''
        
        if (base64 && base64.length > 100) {
          results.push({
            pageNumber: pageNumbers[i] ?? (i + 1),
            base64,
            width: page.width || 0,
            height: page.height || 0,
          })
          console.log(`[PDF Utils] Page ${pageNumbers[i]} rendered via pdf-parse (${Math.round(base64.length / 1024)}KB)`)
        }
      }
    }
    
    if (results.length > 0) {
      console.log(`[PDF Utils] Successfully rendered ${results.length}/${pageNumbers.length} pages via pdf-parse v2`)
      return results
    }
    
    console.warn('[PDF Utils] pdf-parse getScreenshot returned no usable pages, trying pdfjs+canvas fallback')
  } catch (ppError) {
    console.warn('[PDF Utils] pdf-parse getScreenshot failed, trying pdfjs+canvas fallback:', ppError instanceof Error ? ppError.message : ppError)
  }
  
  // ------------------------------------------------------------------
  // Fallback: pdfjs-dist + node-canvas (requires native canvas module)
  // ------------------------------------------------------------------
  const results: RenderedPage[] = []
  
  try {
    let createCanvas: any
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const canvasModule = require('canvas')
      createCanvas = canvasModule.createCanvas
      console.log('[PDF Utils] Canvas module loaded successfully via require()')
    } catch (canvasError) {
      console.error('[PDF Utils] Canvas require error:', canvasError)
      console.warn('[PDF Utils] Neither pdf-parse nor canvas could render pages. Install canvas system deps or ensure pdf-parse v2 is working.')
      return []
    }
    
    // Load PDF
    console.log('[PDF Utils] Loading PDF document via pdfjs-dist...')
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
    console.log(`[PDF Utils] PDF loaded, ${doc.numPages} pages`)
    
    for (const pageNum of pageNumbers) {
      if (pageNum < 1 || pageNum > doc.numPages) {
        console.warn(`[PDF Utils] Page ${pageNum} out of range (1-${doc.numPages})`)
        continue
      }
      
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
          console.log(`[PDF Utils] Page ${pageNum} rendered via pdfjs+canvas (${Math.round(base64.length / 1024)}KB)`)
        }
      } catch (pageError) {
        console.error(`[PDF Utils] Failed to render page ${pageNum}:`, pageError)
      }
    }
    
    console.log(`[PDF Utils] Successfully rendered ${results.length}/${pageNumbers.length} pages via pdfjs+canvas`)
    return results
  } catch (error) {
    console.error('[PDF Utils] PDF rendering error:', error)
    return results
  }
}

/**
 * Select best pages to render for room detection
 * For scanned PDFs, typically want pages 2-5 which are usually floor plans
 */
export function selectPagesForVisionAnalysis(
  totalPages: number,
  maxPages: number = 3
): number[] {
  if (totalPages <= 0) return []
  if (totalPages <= maxPages) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  
  // For construction documents, floor plans are usually pages 2-5
  // Cover page is typically page 1
  const targetPages: number[] = []
  
  // Skip cover page (1), take next few pages
  for (let i = 2; i <= Math.min(totalPages, maxPages + 1); i++) {
    targetPages.push(i)
  }
  
  return targetPages
}
