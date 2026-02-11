/**
 * Shared Chromium browser launcher for PDF generation.
 *
 * Uses `@sparticuz/chromium` for the binary (works on Vercel / AWS Lambda)
 * and `playwright-core` for the browser automation API.
 *
 * This replaces the previous `import { chromium } from 'playwright'` pattern
 * which required a full Playwright install (+ browser download) that doesn't
 * exist in serverless environments.
 */

import chromium from '@sparticuz/chromium'
import { chromium as playwright } from 'playwright-core'
import type { Browser } from 'playwright-core'

/**
 * Launch a headless Chromium browser suitable for both local dev and production.
 */
export async function launchBrowser(): Promise<Browser> {
  const browser = await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  })
  return browser
}
