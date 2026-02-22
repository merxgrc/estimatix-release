/**
 * Client-Side PDF → Image Renderer
 *
 * Uses pdfjs-dist in the browser to render PDF pages to canvas, then
 * exports them as base64 PNG data URLs. These can be uploaded to
 * Supabase Storage and sent to the vision AI endpoint when the
 * server-side PDF renderer fails.
 *
 * Usage:
 *   import { renderPdfPagesClientSide } from '@/lib/plans/client-pdf-renderer'
 *
 *   const pages = await renderPdfPagesClientSide(file, [1, 2, 3], 1.0)
 *   // pages[0] = { pageNumber, dataUrl, width, height }
 */

import * as pdfjsLib from 'pdfjs-dist'

// Point the worker at the CDN copy that matches the installed version.
// This avoids having to bundle pdf.worker.mjs through webpack.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

export interface ClientRenderedPage {
  pageNumber: number
  /** data:image/png;base64,… URL suitable for <img> or upload */
  dataUrl: string
  /** Raw base64 without data: prefix */
  base64: string
  width: number
  height: number
}

/**
 * Render specific pages of a PDF File object to PNG images in the browser.
 *
 * @param file  A browser File / Blob of a PDF
 * @param pageNumbers  1-based page numbers to render (defaults to first 3)
 * @param scale  CSS-pixel scale factor (1.0 = 72 DPI, 1.5 = 108 DPI)
 * @returns  Array of rendered pages
 */
export async function renderPdfPagesClientSide(
  file: File | Blob,
  pageNumbers?: number[],
  scale = 1.0,
): Promise<ClientRenderedPage[]> {
  const arrayBuffer = await file.arrayBuffer()

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  })
  const doc = await loadingTask.promise

  const totalPages = doc.numPages
  const targets = pageNumbers ?? selectDefaultPages(totalPages, 3)

  const results: ClientRenderedPage[] = []

  for (const num of targets) {
    if (num < 1 || num > totalPages) continue

    const page = await doc.getPage(num)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) continue

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: ctx, viewport }).promise

    const dataUrl = canvas.toDataURL('image/png')
    const base64 = dataUrl.split(',')[1] || ''

    results.push({
      pageNumber: num,
      dataUrl,
      base64,
      width: canvas.width,
      height: canvas.height,
    })

    // Free memory
    canvas.width = 0
    canvas.height = 0
  }

  await doc.destroy()
  return results
}

/**
 * Get the total page count of a PDF without rendering.
 */
export async function getPdfPageCountClient(file: File | Blob): Promise<number> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const doc = await loadingTask.promise
  const count = doc.numPages
  await doc.destroy()
  return count
}

/** Select up to `max` page numbers, skipping the cover page. */
function selectDefaultPages(totalPages: number, max: number): number[] {
  if (totalPages <= 0) return []
  if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i + 1)
  // Skip cover, pick next pages
  const result: number[] = []
  for (let i = 2; i <= Math.min(totalPages, max + 1); i++) {
    result.push(i)
  }
  return result
}
