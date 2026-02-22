/**
 * AI-Powered Page Classification and Room Extraction
 * 
 * PASS 1: Document Map / Page Classification
 * - Classifies pages into types
 * - Detects building level per sheet (Level 1, Level 2, Basement, etc.)
 * - Identifies pages of interest for deep parsing
 * 
 * PASS 2: Deep Parse (per-sheet, level-aware)
 * - Extracts rooms from each relevant sheet with its detected level
 * - Uses deterministic naming: "Bathroom 1 – Level 2"
 * - Parses dimensions into length_ft / width_ft
 * - NO PRICING - all pricing fields are null
 */

import {
  type PageClassification,
  type PageType,
  type ExtractedRoom,
  type LineItemScaffold,
  type Pass1Output,
  type Pass2Output,
  PageClassificationSchema,
  ExtractedRoomSchema,
  LineItemScaffoldSchema,
  ROOM_RELEVANT_PAGE_TYPES,
} from './schemas'

import {
  detectLevelFromText,
  extractSheetTitle,
  postProcessRooms,
  deduplicateAcrossSheets,
  type SheetInfo,
  type SheetRoomResult,
} from './room-processor'

// =============================================================================
// Types
// =============================================================================

interface ClassifyPagesInput {
  pages: Array<{ pageNumber: number; text: string }>
  apiKey: string
}

interface ExtractRoomsInput {
  pageTexts: string[]
  pageNumbers: number[]
  apiKey: string
}

/** New: per-sheet extraction input */
interface ExtractRoomsPerSheetInput {
  sheet: SheetInfo
  pageText: string
  apiKey: string
}

interface GenerateLineItemsInput {
  rooms: ExtractedRoom[]
  apiKey: string
}

/** Enriched classification with level detection */
export interface EnrichedPageClassification extends PageClassification {
  detectedLevel: string
  sheetTitle: string
}

// =============================================================================
// PASS 1: Page Classification
// =============================================================================

/**
 * Classify pages using GPT-4o-mini for speed
 * Returns classification for each page
 */
export async function classifyPagesWithAI(
  input: ClassifyPagesInput
): Promise<Pass1Output> {
  const { pages, apiKey } = input
  
  if (pages.length === 0) {
    return { pages: [], totalPages: 0 }
  }

  const systemPrompt = `You are an expert at analyzing construction blueprint and plan documents.

Your task is to classify each page of a document based on its content.

For each page, determine:
1. pageNumber: The page number provided
2. type: One of: cover, index, floor_plan, room_schedule, finish_schedule, notes, specs, elevation, section, detail, electrical, plumbing, mechanical, site_plan, irrelevant, other
3. confidence: 0-100 how confident you are in the classification
4. hasRoomLabels: true if page contains room names/labels (BEDROOM, KITCHEN, BATH, LIVING, etc.)
5. reason: Brief reason for classification (max 50 characters)

Return JSON:
{
  "pages": [
    { "pageNumber": 1, "type": "cover", "confidence": 95, "hasRoomLabels": false, "reason": "Title sheet" },
    { "pageNumber": 2, "type": "floor_plan", "confidence": 90, "hasRoomLabels": true, "reason": "First floor layout" }
  ]
}

CLASSIFICATION GUIDE:
- cover/index: Title sheets, drawing indexes, table of contents
- floor_plan: Room layouts showing walls, doors, room labels - MOST IMPORTANT
- room_schedule: Tables listing room finishes, door schedules
- finish_schedule: Material/finish specification tables
- notes/specs: General notes, written specifications
- elevation: Building views from sides (exterior/interior)
- section: Cut-through views of building
- detail: Enlarged construction details
- electrical/plumbing/mechanical: System-specific plans
- site_plan: Property layout, landscaping
- irrelevant: Cover letters, signatures, certifications
- other: Unclassified pages

PRIORITY: Accurately identify floor_plan and room_schedule pages - they contain room information.`

  const userContent = pages.map(p => 
    `--- PAGE ${p.pageNumber} ---\n${p.text.slice(0, 1200)}`
  ).join('\n\n')

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Classify these ${pages.length} pages:\n\n${userContent}` }
        ],
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('[Pass1] Classification API error:', errorData)
      // Return fallback classifications
      return createFallbackClassifications(pages)
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content
    
    if (!content) {
      console.warn('[Pass1] No content in response, using fallback')
      return createFallbackClassifications(pages)
    }

    const parsed = JSON.parse(content)
    const rawClassifications = Array.isArray(parsed) 
      ? parsed 
      : (parsed.pages || parsed.classifications || [])
    
    // Validate and normalize each classification
    const validatedClassifications: PageClassification[] = rawClassifications.map((c: Record<string, unknown>) => {
      const validated = PageClassificationSchema.safeParse({
        pageNumber: c.pageNumber || 1,
        type: normalizePageType(c.type as string),
        confidence: typeof c.confidence === 'number' ? c.confidence : 50,
        hasRoomLabels: c.hasRoomLabels ?? false,
        reason: typeof c.reason === 'string' ? c.reason.slice(0, 100) : undefined,
      })
      
      if (validated.success) {
        return validated.data
      }
      
      // Fallback for invalid entry
      return {
        pageNumber: typeof c.pageNumber === 'number' ? c.pageNumber : 1,
        type: 'other' as const,
        confidence: 50,
        hasRoomLabels: true, // Assume yes to be safe
        reason: 'Classification failed',
      }
    })

    return {
      pages: validatedClassifications,
      totalPages: pages.length,
      summary: `Classified ${validatedClassifications.length} pages`,
    }
  } catch (error) {
    console.error('[Pass1] Classification error:', error)
    return createFallbackClassifications(pages)
  }
}

/**
 * Normalize AI-returned page type to our enum
 */
function normalizePageType(type: string | undefined): PageType {
  if (!type) return 'other'
  
  const normalized = type.toLowerCase().replace(/[^a-z_]/g, '')
  
  const typeMap: Record<string, PageType> = {
    cover: 'cover',
    index: 'index',
    floorplan: 'floor_plan',
    floor_plan: 'floor_plan',
    roomschedule: 'room_schedule',
    room_schedule: 'room_schedule',
    finishschedule: 'finish_schedule',
    finish_schedule: 'finish_schedule',
    notes: 'notes',
    specs: 'specs',
    specifications: 'specs',
    elevation: 'elevation',
    section: 'section',
    detail: 'detail',
    details: 'detail',
    electrical: 'electrical',
    plumbing: 'plumbing',
    mechanical: 'mechanical',
    siteplan: 'site_plan',
    site_plan: 'site_plan',
    irrelevant: 'irrelevant',
  }
  
  return typeMap[normalized] || 'other'
}

/**
 * Create fallback classifications when API fails
 */
function createFallbackClassifications(
  pages: Array<{ pageNumber: number; text: string }>
): Pass1Output {
  return {
    pages: pages.map(p => ({
      pageNumber: p.pageNumber,
      type: 'other' as const,
      confidence: 30,
      hasRoomLabels: p.text.toLowerCase().includes('room') || 
                     p.text.toLowerCase().includes('bedroom') ||
                     p.text.toLowerCase().includes('kitchen'),
      reason: 'Fallback - API unavailable',
    })),
    totalPages: pages.length,
    summary: 'Fallback classifications applied',
  }
}

// =============================================================================
// Page Selection for Deep Parse
// =============================================================================

/**
 * Select pages that should be deep-parsed for room extraction
 */
export function selectPagesForDeepParse(
  classifications: PageClassification[],
  maxPages: number = 10
): number[] {
  // Priority order for page types
  const priorityTypes: PageType[] = [
    'floor_plan',
    'room_schedule',
    'finish_schedule',
  ]
  
  const selectedPages: number[] = []
  
  // First, add all high-confidence floor plans
  for (const c of classifications) {
    if (c.type === 'floor_plan' && c.confidence >= 70) {
      if (!selectedPages.includes(c.pageNumber)) {
        selectedPages.push(c.pageNumber)
      }
    }
  }
  
  // Add pages with room labels
  for (const c of classifications) {
    if (c.hasRoomLabels && !selectedPages.includes(c.pageNumber)) {
      selectedPages.push(c.pageNumber)
    }
  }
  
  // Add room schedules
  for (const c of classifications) {
    if (c.type === 'room_schedule' && !selectedPages.includes(c.pageNumber)) {
      selectedPages.push(c.pageNumber)
    }
  }
  
  // If still under max, add other potentially useful pages
  if (selectedPages.length < maxPages) {
    for (const c of classifications) {
      if (selectedPages.length >= maxPages) break
      
      if (
        ROOM_RELEVANT_PAGE_TYPES.includes(c.type) &&
        !selectedPages.includes(c.pageNumber)
      ) {
        selectedPages.push(c.pageNumber)
      }
    }
  }
  
  // If no pages selected, fall back to first few pages
  if (selectedPages.length === 0) {
    const fallbackCount = Math.min(5, classifications.length)
    for (let i = 0; i < fallbackCount; i++) {
      selectedPages.push(classifications[i].pageNumber)
    }
  }
  
  // Limit to maxPages and sort
  return selectedPages.slice(0, maxPages).sort((a, b) => a - b)
}

// =============================================================================
// Level Enrichment for Classifications
// =============================================================================

/**
 * Enrich page classifications with detected building level and sheet title.
 * Uses text content heuristics to detect "Level 1", "Basement", etc.
 */
export function enrichClassificationsWithLevel(
  classifications: PageClassification[],
  pages: Array<{ pageNumber: number; text: string }>
): EnrichedPageClassification[] {
  const pageTextMap = new Map(pages.map(p => [p.pageNumber, p.text]))

  return classifications.map(c => {
    const pageText = pageTextMap.get(c.pageNumber) || ''
    const sheetTitle = extractSheetTitle(pageText)
    const detectedLevel = detectLevelFromText(sheetTitle, pageText)

    return {
      ...c,
      detectedLevel,
      sheetTitle,
    }
  })
}

/**
 * Group classified pages by detected level for per-sheet extraction.
 * Returns SheetInfo objects for each floor_plan page.
 */
export function groupPagesByLevel(
  enriched: EnrichedPageClassification[]
): SheetInfo[] {
  return enriched
    .filter(c => 
      c.type === 'floor_plan' || 
      c.hasRoomLabels || 
      c.type === 'room_schedule'
    )
    .map(c => ({
      pageNumber: c.pageNumber,
      sheetTitle: c.sheetTitle,
      detectedLevel: c.detectedLevel,
      classification: c.type,
      confidence: c.confidence,
    }))
}

// =============================================================================
// PASS 2: Deep Room Extraction (per-sheet, level-aware)
// =============================================================================

/**
 * Extract rooms from a SINGLE sheet/page with level context.
 * This is the core of deterministic parsing: one sheet → one level → rooms.
 *
 * Key differences from legacy extractRoomsFromPagesWithAI:
 * 1. Processes one sheet at a time (not all pages merged)
 * 2. Tells the AI what level the sheet is
 * 3. Instructs AI to report EXACT room count, no merging
 * 4. Post-processes with deterministic naming
 */
export async function extractRoomsFromSheetWithAI(
  input: ExtractRoomsPerSheetInput
): Promise<SheetRoomResult> {
  const { sheet, pageText, apiKey } = input

  if (!pageText || pageText.trim().length < 20) {
    return {
      sheet,
      rooms: [],
    }
  }

  const truncatedText = pageText.length > 20000
    ? pageText.slice(0, 20000) + '\n[... truncated ...]'
    : pageText

  const systemPrompt = `You are an expert construction estimator analyzing a SINGLE floor plan sheet.

THIS SHEET IS: "${sheet.sheetTitle}"
BUILDING LEVEL: ${sheet.detectedLevel}

Extract ALL rooms and spaces shown on THIS sheet. For EACH distinct room or space:
1. name: Room name EXACTLY as labeled on the plan. Expand abbreviations (MBR→Master Bedroom, BA→Bathroom, BR→Bedroom, KIT→Kitchen, LR→Living Room, DR→Dining Room, FR→Family Room, GR→Great Room, WIC→Walk-in Closet, PWDR→Powder Room).
2. type: One of: bedroom, bathroom, kitchen, living, dining, garage, closet, utility, laundry, hallway, foyer, office, basement, attic, deck, patio, porch, mudroom, pantry, storage, mechanical, other
3. area_sqft: Square footage if shown (number or null)
4. dimensions: Dimension string if shown (e.g. "12'-0\\" x 14'-6\\"") or null
5. notes: Special notes visible on plan
6. confidence: 0-100

Return JSON:
{
  "rooms": [
    { "name": "Master Bedroom", "type": "bedroom", "area_sqft": 250, "dimensions": "12'-0\\" x 20'-0\\"", "notes": null, "confidence": 95 }
  ],
  "room_count_by_type": { "bedroom": 3, "bathroom": 2, "kitchen": 1 },
  "assumptions": [],
  "missingInfo": [],
  "warnings": []
}

CRITICAL RULES:
- Report EVERY distinct room/space shown. If the plan shows 3 bedrooms, return 3 separate bedroom entries.
- Do NOT merge rooms. "Bathroom" appearing twice means TWO bathrooms — return both.
- If two rooms have the same label (e.g. two rooms labeled "BEDROOM"), return BOTH as separate entries.
- Include closets, pantries, walk-in closets, powder rooms, laundry, utility, storage.
- Include hallways only if they are labeled as a room on the plan.
- Use the room name from the plan. Do NOT invent creative names — use exactly what is labeled.
- If a room label is unclear, use the type with a number (e.g. "Bedroom 1", "Bathroom 2").
- DO NOT include any pricing information.
- The "room_count_by_type" field is for verification — it MUST match the actual rooms array length per type.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Extract all rooms from this ${sheet.detectedLevel} floor plan sheet:\n\n${truncatedText}` }
        ],
        temperature: 0.1, // Very low temp for determinism
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error(`[Pass2-Sheet] Room extraction API error for page ${sheet.pageNumber}:`, errorData)
      return { sheet, rooms: [] }
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content

    if (!content) {
      return { sheet, rooms: [] }
    }

    const parsed = JSON.parse(content)

    // Validate rooms with Zod
    const rawRooms: ExtractedRoom[] = (parsed.rooms || [])
      .map((r: Record<string, unknown>) => {
        const validated = ExtractedRoomSchema.safeParse({
          name: (r.name as string) || 'Unnamed Room',
          level: sheet.detectedLevel,
          type: normalizeRoomType(r.type as string),
          area_sqft: typeof r.area_sqft === 'number' ? r.area_sqft : null,
          dimensions: r.dimensions || null,
          notes: r.notes || null,
          confidence: typeof r.confidence === 'number' ? r.confidence : 50,
        })

        return validated.success ? validated.data : null
      })
      .filter(Boolean) as ExtractedRoom[]

    // Verify room count consistency
    if (parsed.room_count_by_type && typeof parsed.room_count_by_type === 'object') {
      const expectedTotal = Object.values(parsed.room_count_by_type as Record<string, number>)
        .reduce((sum: number, n) => sum + (typeof n === 'number' ? n : 0), 0)
      if (rawRooms.length < expectedTotal) {
        console.warn(
          `[Pass2-Sheet] Room count mismatch on page ${sheet.pageNumber}: ` +
          `AI reported ${expectedTotal} in counts but returned ${rawRooms.length} rooms`
        )
      }
    }

    // Post-process: deterministic naming + dimension parsing
    const processedRooms = postProcessRooms(rawRooms, sheet.detectedLevel)

    // Stamp each room with the sheet label for provenance
    const roomsWithSheet = processedRooms.map(r => ({
      ...r,
      sheet_label: sheet.sheetTitle || null,
    }))

    return {
      sheet,
      rooms: roomsWithSheet,
    }
  } catch (error) {
    console.error(`[Pass2-Sheet] Room extraction error for page ${sheet.pageNumber}:`, error)
    return { sheet, rooms: [] }
  }
}

/**
 * Extract rooms from ALL relevant sheets, one at a time.
 * This is the main Phase 1 entry point for room extraction.
 *
 * Flow:
 * 1. For each floor_plan sheet, call extractRoomsFromSheetWithAI
 * 2. Deduplicate across sheets (same room on overlapping pages)
 * 3. Return flat array of deterministically named rooms
 */
export async function extractRoomsPerSheet(input: {
  sheets: SheetInfo[]
  pages: Array<{ pageNumber: number; text: string }>
  apiKey: string
}): Promise<{
  rooms: ExtractedRoom[]
  sheetResults: SheetRoomResult[]
  assumptions: string[]
  warnings: string[]
  missingInfo: string[]
}> {
  const { sheets, pages, apiKey } = input
  const pageTextMap = new Map(pages.map(p => [p.pageNumber, p.text]))

  const allSheetResults: SheetRoomResult[] = []
  const allAssumptions: string[] = []
  const allWarnings: string[] = []
  const allMissingInfo: string[] = []

  // Process each sheet sequentially (could parallelize later)
  for (const sheet of sheets) {
    const pageText = pageTextMap.get(sheet.pageNumber) || ''

    if (pageText.trim().length < 20) {
      allWarnings.push(`Page ${sheet.pageNumber} (${sheet.sheetTitle}): insufficient text for extraction`)
      continue
    }

    console.log(`[Pass2-Sheet] Extracting rooms from page ${sheet.pageNumber}: "${sheet.sheetTitle}" → ${sheet.detectedLevel}`)

    const result = await extractRoomsFromSheetWithAI({
      sheet,
      pageText,
      apiKey,
    })

    allSheetResults.push(result)

    if (result.rooms.length > 0) {
      allAssumptions.push(
        `Page ${sheet.pageNumber} (${sheet.sheetTitle}): found ${result.rooms.length} rooms on ${sheet.detectedLevel}`
      )
    } else {
      allWarnings.push(
        `Page ${sheet.pageNumber} (${sheet.sheetTitle}): no rooms detected`
      )
    }
  }

  // Deduplicate across sheets (same room on overlapping pages)
  const deduped = deduplicateAcrossSheets(allSheetResults)

  return {
    rooms: deduped,
    sheetResults: allSheetResults,
    assumptions: allAssumptions,
    warnings: allWarnings,
    missingInfo: allMissingInfo,
  }
}

// =============================================================================
// PASS 2: Legacy Room Extraction (kept for backward compatibility + fallback)
// =============================================================================

/**
 * Extract rooms from selected pages using GPT-4o (legacy: all pages merged).
 * Kept as fallback when per-sheet extraction isn't possible (e.g. no classifications).
 */
export async function extractRoomsFromPagesWithAI(
  input: ExtractRoomsInput
): Promise<Pass2Output> {
  const { pageTexts, pageNumbers, apiKey } = input
  
  if (pageTexts.length === 0) {
    return {
      rooms: [],
      assumptions: ['No pages provided for room extraction'],
      missingInfo: ['Document content unavailable'],
      warnings: ['Please add rooms manually'],
    }
  }

  // Combine texts with page markers
  const combinedText = pageTexts.map((text, i) => 
    `=== PAGE ${pageNumbers[i]} ===\n${text}`
  ).join('\n\n')
  
  // Truncate if too long
  const maxChars = 40000
  const truncatedText = combinedText.length > maxChars 
    ? combinedText.slice(0, maxChars) + '\n\n[... content truncated ...]'
    : combinedText

  const systemPrompt = `You are an expert construction estimator analyzing floor plans and blueprints.

Extract ALL rooms and spaces from the document. For each room:
1. name: Room name as shown (expand abbreviations: MBR→Master Bedroom, BA→Bathroom)
2. type: One of: bedroom, bathroom, kitchen, living, dining, garage, closet, utility, laundry, hallway, foyer, office, basement, attic, deck, patio, porch, mudroom, pantry, storage, mechanical, other
3. level: Building level this room is on. Detect from sheet title or context. Use canonical names: "Level 1", "Level 2", "Basement", "Garage", "Attic".
4. area_sqft: Square footage if shown (number only, or null)
5. dimensions: Dimensions if shown (e.g., "12'-0\" x 14'-6\"" or null)
6. notes: Special notes about the room
7. confidence: 0-100 confidence this is a real, distinct room

Return JSON:
{
  "rooms": [
    { "name": "Master Bedroom", "level": "Level 1", "type": "bedroom", "area_sqft": 250, "dimensions": "12'-0\" x 20'-0\"", "notes": null, "confidence": 95 }
  ],
  "assumptions": ["Assumed 'BR' means Bedroom"],
  "missingInfo": ["Kitchen dimensions not visible"],
  "warnings": ["Some room labels unclear"]
}

CRITICAL RULES:
- Extract ALL distinct rooms/spaces (bedrooms, bathrooms, closets, pantries, etc.)
- If plan shows 3 bathrooms, return 3 separate entries — NEVER merge.
- Use clear, professional names (expand abbreviations)
- Include master closets, walk-in closets, pantries as separate rooms
- DETECT the building level from page context (e.g. "SECOND FLOOR PLAN" → "Level 2")
- Set lower confidence for unclear or inferred rooms
- DO NOT include any pricing information`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Extract all rooms from these ${pageNumbers.length} pages:\n\n${truncatedText}` }
        ],
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('[Pass2] Room extraction API error:', errorData)
      return {
        rooms: [],
        assumptions: [],
        missingInfo: [],
        warnings: ['AI room extraction failed. Please add rooms manually.'],
      }
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content
    
    if (!content) {
      return {
        rooms: [],
        assumptions: [],
        missingInfo: [],
        warnings: ['No response from AI room extraction.'],
      }
    }

    const parsed = JSON.parse(content)
    
    // Validate rooms with Zod
    const validatedRooms: ExtractedRoom[] = (parsed.rooms || [])
      .map((r: Record<string, unknown>) => {
        const validated = ExtractedRoomSchema.safeParse({
          name: r.name || 'Unnamed Room',
          level: r.level || 'Level 1',
          type: normalizeRoomType(r.type as string),
          area_sqft: typeof r.area_sqft === 'number' ? r.area_sqft : null,
          dimensions: r.dimensions || null,
          notes: r.notes || null,
          confidence: typeof r.confidence === 'number' ? r.confidence : 50,
        })
        
        return validated.success ? validated.data : null
      })
      .filter(Boolean) as ExtractedRoom[]

    return {
      rooms: validatedRooms,
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
      missingInfo: Array.isArray(parsed.missingInfo) ? parsed.missingInfo : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    }
  } catch (error) {
    console.error('[Pass2] Room extraction error:', error)
    return {
      rooms: [],
      assumptions: [],
      missingInfo: [],
      warnings: [`Room extraction error: ${error instanceof Error ? error.message : 'Unknown error'}`],
    }
  }
}

/**
 * Normalize room type to our enum
 */
function normalizeRoomType(type: string | undefined): string | null {
  if (!type) return null
  
  const normalized = type.toLowerCase().replace(/[^a-z]/g, '')
  
  const typeMap: Record<string, string> = {
    bedroom: 'bedroom',
    bath: 'bathroom',
    bathroom: 'bathroom',
    kitchen: 'kitchen',
    living: 'living',
    livingroom: 'living',
    dining: 'dining',
    diningroom: 'dining',
    garage: 'garage',
    closet: 'closet',
    utility: 'utility',
    laundry: 'laundry',
    hallway: 'hallway',
    hall: 'hallway',
    foyer: 'foyer',
    entry: 'foyer',
    office: 'office',
    study: 'office',
    basement: 'basement',
    attic: 'attic',
    deck: 'deck',
    patio: 'patio',
    porch: 'porch',
    mudroom: 'mudroom',
    pantry: 'pantry',
    storage: 'storage',
    mechanical: 'mechanical',
  }
  
  return typeMap[normalized] || 'other'
}

// =============================================================================
// Line Item Scaffold Generation
// =============================================================================

/**
 * Generate line item scaffolds for rooms
 * NO PRICING - all cost fields are null
 */
export async function generateLineItemScaffoldWithAI(
  input: GenerateLineItemsInput
): Promise<LineItemScaffold[]> {
  const { rooms, apiKey } = input
  
  if (rooms.length === 0) return []

  const roomList = rooms.map(r => 
    `- ${r.name} (${r.type || 'room'}${r.area_sqft ? `, ${r.area_sqft} sqft` : ''})`
  ).join('\n')

  const systemPrompt = `You are an expert construction estimator. Generate a scaffold of typical line items for the given rooms.

Return JSON:
{
  "items": [
    {
      "description": "Paint walls and ceiling",
      "category": "Paint",
      "cost_code": "723",
      "room_name": "Master Bedroom",
      "quantity": null,
      "unit": "ROOM",
      "notes": null
    }
  ]
}

COST CODES:
- 723: Paint
- 734: Wood Floor / 733: Vinyl Floor / 737: Carpet
- 405: Electrical
- 404: Plumbing
- 728: Tile
- 402: HVAC
- 740: Lighting
- 716: Cabinetry
- 721: Countertops
- 739: Plumbing Fixtures
- 999: General/Other

RULES:
- Include common items per room: paint, flooring, electrical, plumbing (where applicable)
- For bathrooms: include tile, fixtures, plumbing
- For kitchens: include cabinetry, countertops, appliances
- DO NOT include any pricing - leave cost fields null
- Quantities can be null if unknown
- Keep descriptions concise but clear
- Suggest 3-5 key items per room maximum
- DO NOT include unit costs, material costs, labor costs, or any pricing information`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate line item scaffolds for these rooms:\n${roomList}` }
        ],
        temperature: 0.4,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      console.warn('[Scaffold] API failed, returning empty scaffold')
      return []
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content
    
    if (!content) return []

    const parsed = JSON.parse(content)
    const items = Array.isArray(parsed) ? parsed : (parsed.items || parsed.lineItems || [])
    
    // Validate with Zod and strip any pricing
    return items
      .map((item: Record<string, unknown>) => {
        const validated = LineItemScaffoldSchema.safeParse({
          description: item.description || '',
          category: item.category || 'Other',
          cost_code: item.cost_code || '999',
          room_name: item.room_name || 'General',
          quantity: typeof item.quantity === 'number' ? item.quantity : null,
          unit: item.unit || null,
          notes: item.notes || null,
          // Explicitly exclude any pricing fields AI might return
        })
        
        return validated.success ? validated.data : null
      })
      .filter(Boolean) as LineItemScaffold[]
  } catch (error) {
    console.error('[Scaffold] Generation error:', error)
    return []
  }
}

// =============================================================================
// Image Analysis (for image files or scanned PDFs)
// =============================================================================

/**
 * Analyze an image file for room extraction using vision
 */
export async function analyzeImageForRoomsWithAI(
  imageUrl: string,
  apiKey: string
): Promise<Pass2Output> {
  // Check if this is a PDF URL - GPT-4 Vision works best with images
  const isPdf = imageUrl.toLowerCase().endsWith('.pdf')
  
  const systemPrompt = `You are an expert construction estimator analyzing ${isPdf ? 'architectural floor plans' : 'floor plan images'}.

Look at the floor plan image and extract ALL rooms and spaces you can identify.
For each room:
1. name: Room name EXACTLY as labeled on the plan (expand abbreviations: MBR→Master Bedroom, BA→Bathroom, BR→Bedroom)
2. level: Detect the building level from the sheet title or context. Use: "Level 1", "Level 2", "Basement", "Garage", "Attic". Default "Level 1" if unclear.
3. type: bedroom, bathroom, kitchen, living, dining, garage, closet, utility, laundry, hallway, foyer, office, basement, attic, deck, patio, porch, mudroom, pantry, storage, mechanical, other
4. area_sqft: Estimated square footage if determinable (or null)
5. dimensions: Dimensions if shown (or null)
6. notes: Any relevant notes
7. confidence: 0-100 confidence

Return JSON:
{
  "rooms": [
    { "name": "Master Bedroom", "level": "Level 1", "type": "bedroom", "area_sqft": 250, "dimensions": "12' x 20'", "notes": null, "confidence": 90 }
  ],
  "assumptions": ["List assumptions made"],
  "missingInfo": ["Information that couldn't be determined"],
  "warnings": ["Any issues or quality concerns"]
}

CRITICAL RULES:
- Report EVERY distinct room/space visible. If you see 3 bedrooms, return 3 entries.
- Do NOT merge rooms with the same type — they are separate spaces.
- Use the name from the plan. If unclear, use type with number: "Bedroom 1", "Bathroom 2".
- Include closets, pantries, laundry rooms
- Note if image quality affects analysis
- DO NOT include any pricing information`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this floor plan and extract all rooms:' },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      return {
        rooms: [],
        assumptions: [],
        missingInfo: [],
        warnings: ['Image analysis failed. Please add rooms manually.'],
      }
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content
    
    if (!content) {
      return {
        rooms: [],
        assumptions: [],
        missingInfo: [],
        warnings: ['No response from image analysis.'],
      }
    }

    const parsed = JSON.parse(content)
    
    // Validate rooms with level
    const validatedRooms: ExtractedRoom[] = (parsed.rooms || [])
      .map((r: Record<string, unknown>) => {
        const validated = ExtractedRoomSchema.safeParse({
          name: r.name || 'Unnamed Room',
          level: r.level || 'Level 1',
          type: normalizeRoomType(r.type as string),
          area_sqft: typeof r.area_sqft === 'number' ? r.area_sqft : null,
          dimensions: r.dimensions || null,
          notes: r.notes || null,
          confidence: typeof r.confidence === 'number' ? r.confidence : 50,
        })
        
        return validated.success ? validated.data : null
      })
      .filter(Boolean) as ExtractedRoom[]

    // Post-process with deterministic naming
    // Group by level, apply naming per level
    const roomsByLevel = new Map<string, ExtractedRoom[]>()
    for (const room of validatedRooms) {
      const level = room.level || 'Unknown'
      const existing = roomsByLevel.get(level) || []
      existing.push(room)
      roomsByLevel.set(level, existing)
    }

    const processedRooms: ExtractedRoom[] = []
    for (const [level, rooms] of roomsByLevel) {
      processedRooms.push(...postProcessRooms(rooms, level))
    }

    return {
      rooms: processedRooms,
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
      missingInfo: Array.isArray(parsed.missingInfo) ? parsed.missingInfo : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    }
  } catch (error) {
    console.error('[Image] Analysis error:', error)
    return {
      rooms: [],
      assumptions: [],
      missingInfo: [],
      warnings: [`Image analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`],
    }
  }
}

/**
 * Analyze multiple base64-encoded images with vision AI
 * Used for scanned PDFs that have been rendered to images
 */
export async function analyzeBase64ImagesForRooms(
  images: Array<{ pageNumber: number; base64: string }>,
  apiKey: string
): Promise<Pass2Output> {
  if (images.length === 0) {
    return {
      rooms: [],
      assumptions: [],
      missingInfo: [],
      warnings: ['No images provided for analysis'],
    }
  }

  const systemPrompt = `You are an expert construction estimator analyzing floor plan images from architectural blueprints.

Look at each floor plan image and extract ALL rooms and spaces you can identify.

FIRST: Determine the building level for EACH page from the sheet title, header, or context.
Use canonical level names: "Level 1", "Level 2", "Basement", "Garage", "Attic". Default to "Level 1".

For each room:
1. name: Room name EXACTLY as labeled on the plan (expand abbreviations: BR→Bedroom, BA→Bathroom, MBR→Master Bedroom, KIT→Kitchen)
2. level: Building level this room is on
3. type: bedroom, bathroom, kitchen, living, dining, garage, closet, utility, laundry, hallway, foyer, office, basement, attic, deck, patio, porch, mudroom, pantry, storage, mechanical, other
4. area_sqft: Square footage if determinable (calculate from dimensions, or null)
5. dimensions: Dimension string if shown (e.g. "12'-0\\" x 14'-6\\"") or null
6. notes: Any relevant notes about finishes, features
7. confidence: 0-100

Return JSON:
{
  "rooms": [
    { "name": "Primary Bedroom", "level": "Level 1", "type": "bedroom", "area_sqft": 180, "dimensions": "12' x 15'", "notes": "Walk-in closet", "confidence": 90 },
    { "name": "Kitchen", "level": "Level 1", "type": "kitchen", "area_sqft": 144, "dimensions": "12' x 12'", "notes": "Island layout", "confidence": 85 }
  ],
  "assumptions": [],
  "missingInfo": [],
  "warnings": []
}

CRITICAL RULES:
- Report EVERY distinct room/space visible across all images. If you see 5 bathrooms, return 5.
- Do NOT merge rooms — each is a separate space even if the same type.
- Use names from the plan. If unclear, use type with number: "Bedroom 1", "Bathroom 2".
- Include closets, pantries, laundry rooms, garages
- DO NOT include any pricing information`

  try {
    // Build content array with all images
    const content: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = [
      { type: 'text', text: `Analyze these ${images.length} floor plan page(s) and extract all rooms:` }
    ]
    
    // Add each image as base64
    for (const img of images) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${img.base64}`,
          detail: 'high'  // Use high detail for floor plans
        }
      })
    }

    // Log payload size for diagnostics
    const totalBase64 = images.reduce((sum, img) => sum + img.base64.length, 0)
    console.log(`[Vision] Sending ${images.length} image(s) to gpt-4o, total base64: ${Math.round(totalBase64 / 1024)}KB`)

    const requestBody = JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content }
      ],
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    })
    console.log(`[Vision] Request body size: ${Math.round(requestBody.length / 1024)}KB`)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: requestBody,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Vision] API error (${response.status}): ${errorText.substring(0, 500)}`)
      return {
        rooms: [],
        assumptions: [],
        missingInfo: [],
        warnings: [`Vision analysis failed (HTTP ${response.status}). The images may be too large or unclear.`],
      }
    }

    const result = await response.json()
    const responseContent = result.choices?.[0]?.message?.content
    
    if (!responseContent) {
      return {
        rooms: [],
        assumptions: [],
        missingInfo: [],
        warnings: ['No response from vision analysis.'],
      }
    }

    const parsed = JSON.parse(responseContent)
    
    // Validate rooms with level
    const validatedRooms: ExtractedRoom[] = (parsed.rooms || [])
      .map((r: Record<string, unknown>) => {
        const validated = ExtractedRoomSchema.safeParse({
          name: r.name || 'Unnamed Room',
          level: r.level || 'Level 1',
          type: r.type || 'other',
          area_sqft: r.area_sqft,
          dimensions: r.dimensions || null,
          notes: r.notes || null,
          confidence: typeof r.confidence === 'number' ? r.confidence : 50,
        })
        
        return validated.success ? validated.data : null
      })
      .filter(Boolean) as ExtractedRoom[]

    // Post-process with deterministic naming per level
    const roomsByLevel = new Map<string, ExtractedRoom[]>()
    for (const room of validatedRooms) {
      const level = room.level || 'Unknown'
      const existing = roomsByLevel.get(level) || []
      existing.push(room)
      roomsByLevel.set(level, existing)
    }

    const processedRooms: ExtractedRoom[] = []
    for (const [level, rooms] of roomsByLevel) {
      processedRooms.push(...postProcessRooms(rooms, level))
    }

    return {
      rooms: processedRooms,
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : ['Analyzed from rendered PDF pages'],
      missingInfo: Array.isArray(parsed.missingInfo) ? parsed.missingInfo : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    }
  } catch (error) {
    console.error('[Vision] Base64 analysis error:', error)
    return {
      rooms: [],
      assumptions: [],
      missingInfo: [],
      warnings: [`Vision analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`],
    }
  }
}
