import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs' // Disable Edge runtime for OpenAI API compatibility

// Zod schema for spec sections
const SpecItemSchema = z.object({
  text: z.string().nullable(),
  label: z.string().nullable(),
  subitems: z.array(z.string()).optional(),
})

const SpecSectionSchema = z.object({
  code: z.string(),
  title: z.string(),
  allowance: z.number().nullable(),
  items: z.array(SpecItemSchema),
  subcontractor: z.string().nullable(),
  notes: z.string().nullable().optional(),
})

// Structured line item schema (for AI to parse)
// NOTE: line_items will now ALWAYS be structured objects with atomic tasks.
// Each described task becomes its own line item.
// AI sets labor_cost, margin_percent, client_price to null (user fills these in UI).
const StructuredLineItemSchema = z.object({
  description: z.string(),
  category: z.string().optional(),
  cost_code: z.string().optional(),
  room: z.string().optional(),

  quantity: z.number().optional(),
  unit: z.string().optional(),

  unit_labor_cost: z.number().optional().nullable(),
  unit_material_cost: z.number().optional().nullable(),
  unit_total_cost: z.number().optional().nullable(),

  total_direct_cost: z.number().optional().nullable(),

  pricing_source: z.enum(['task_library', 'user_library', 'manual']).optional(),
  confidence: z.number().optional(),

  notes: z.string().optional(),

  // Legacy fields for backward compatibility
  labor_cost: z.number().nullable().optional(),
  margin_percent: z.number().nullable().optional(),
  client_price: z.number().nullable().optional(),
})

// Combined parse result schema - line_items MUST be structured objects
const ParseResultSchema = z.object({
  projectId: z.string(),
  spec_sections: z.array(SpecSectionSchema),
  line_items: z.array(StructuredLineItemSchema),
  assumptions: z.array(z.string()).optional(),
  missing_info: z.array(z.string()).optional()
})

type ParseResult = z.infer<typeof ParseResultSchema>

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { transcript, projectId } = body
    
    console.log('AI Parse API called with:', { projectId, transcriptLength: transcript?.length })
    
    // Validate required fields
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid transcript' },
        { status: 400 }
      )
    }

    if (!projectId || typeof projectId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid projectId. A project must be created before parsing.' },
        { status: 400 }
      )
    }

    const openaiApiKey = process.env.OPENAI_API_KEY

    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      )
    }

    // Parse transcript with OpenAI to generate spec sections and line items
    const parseResult = await parseTranscriptWithAI(transcript, projectId, openaiApiKey)
    
    // Validate projectId from parse result
    if (!parseResult.projectId || parseResult.projectId === 'null' || parseResult.projectId === 'undefined') {
      throw new Error('AI returned invalid projectId. Cannot save estimate.')
    }

    // Normalize allowances (convert string "$5000" to number 5000)
    const normalizedSections = normalizeAllowances(parseResult.spec_sections)
    
    // Ensure spec_sections have items - populate from line_items if empty
    const enrichedSections = enrichSpecSections(normalizedSections, parseResult.line_items)
    
    console.log('Final spec_sections:', JSON.stringify(enrichedSections, null, 2))
    
    // Store result in estimates table
    const supabase = await createServerClient()
    
    // First, check if an estimate already exists for this project
    const { data: existingEstimate, error: checkError } = await supabase
      .from('estimates')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking existing estimate:', checkError)
      return NextResponse.json(
        { error: `Failed to check existing estimate: ${checkError.message}` },
        { status: 500 }
      )
    }

    // Process line items - all items are now atomic structured objects
    const processedItems = parseResult.line_items.map((item) => {
      // All line items are structured objects (enforced by schema)
      if (typeof item === 'object' && item !== null) {
        return {
          category: item.category || 'Other',
          description: item.description || '',
          cost_code: item.cost_code || '999',
          room_name: item.room || null, // Preserve AI-detected room, use null if not detected
          labor_cost: item.labor_cost ?? null,
          margin_percent: item.margin_percent ?? null,
          client_price: item.client_price ?? null,
          notes: item.notes || null
        }
      }
      // Fallback for unexpected types (should not happen with structured-only schema)
      return {
        category: 'Other',
        description: '',
        cost_code: '999',
        room_name: null, // No default room - let user select
        labor_cost: null,
        margin_percent: null,
        client_price: null,
        notes: null
      }
    })

    // Calculate total from all items (using client_price)
    const calculatedTotal = processedItems.reduce((sum, item) => {
      return sum + (item.client_price || 0)
    }, 0)

    // Prepare data for insert/update
    const estimateData = {
      project_id: projectId,
      spec_sections: enrichedSections,
      json_data: {
        items: processedItems,
        assumptions: parseResult.assumptions || [],
        missing_info: parseResult.missing_info || []
      },
      ai_summary: `Parsed ${enrichedSections.length} specification sections and ${parseResult.line_items.length} atomic line items from transcript`,
      total: calculatedTotal || 0
    }

    let estimateId: string

    if (existingEstimate) {
      console.log('Saving to estimate:', existingEstimate.id)
      
      // Update existing estimate
      const { data: updatedEstimate, error: updateError } = await supabase
        .from('estimates')
        .update({
          spec_sections: enrichedSections,
          json_data: estimateData.json_data,
          ai_summary: estimateData.ai_summary,
          total: estimateData.total
        })
        .eq('id', existingEstimate.id)
        .select()
        .single()

      if (updateError) {
        console.error('Database update error:', updateError)
        return NextResponse.json(
          { error: `Failed to update estimate: ${updateError.message}` },
          { status: 500 }
        )
      }

      console.log('Supabase update done')
      estimateId = updatedEstimate.id
    } else {
      console.log('Creating new estimate for project:', projectId)
      
      // Insert new estimate
      const { data: newEstimate, error: insertError } = await supabase
        .from('estimates')
        .insert(estimateData)
        .select()
        .single()

      if (insertError) {
        console.error('Database insert error:', insertError)
        return NextResponse.json(
          { error: `Failed to store estimate data: ${insertError.message}` },
          { status: 500 }
        )
      }

      console.log('Supabase insert done')
      estimateId = newEstimate.id
    }

    // Save line items to estimate_line_items table
    if (processedItems.length > 0) {
      // Delete existing line items for this estimate
      await supabase
        .from('estimate_line_items')
        .delete()
        .eq('estimate_id', estimateId)

      // Insert new atomic line items
      const lineItemsToInsert = processedItems.map(item => ({
        estimate_id: estimateId,
        project_id: projectId,
        room_name: item.room_name,
        description: item.description,
        category: item.category,
        cost_code: item.cost_code,
        labor_cost: item.labor_cost,
        margin_percent: item.margin_percent,
        client_price: item.client_price
      }))

      const { error: lineItemsError } = await supabase
        .from('estimate_line_items')
        .insert(lineItemsToInsert)

      if (lineItemsError) {
        console.error('Error saving line items to database:', lineItemsError)
        // Don't fail the request, but log the error
      } else {
        console.log(`Saved ${lineItemsToInsert.length} atomic line items to estimate_line_items table`)
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        spec_sections: enrichedSections,
        items: processedItems.map((item) => ({
          category: item.category,
          description: item.description,
          cost_code: item.cost_code,
          room_name: item.room_name,
          labor_cost: item.labor_cost,
          margin_percent: item.margin_percent,
          client_price: item.client_price,
          notes: item.notes || ''
        }))
      },
      estimateId: estimateId
    })

  } catch (error) {
    console.error('AI parse error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse transcript' },
      { status: 500 }
    )
  }
}

// Normalize allowances: convert string "$5000" to number 5000
function normalizeAllowances(sections: any[]): any[] {
  return sections.map(section => {
    if (section.allowance !== null && section.allowance !== undefined) {
      if (typeof section.allowance === 'string') {
        // Remove $, commas, and whitespace, then parse
        const cleaned = section.allowance.replace(/[$,\s]/g, '')
        const parsed = parseFloat(cleaned)
        section.allowance = isNaN(parsed) ? null : parsed
      }
    }
    return section
  })
}

// Enrich spec sections with items from line_items if they're empty
// Groups atomic line items by cost_code (trade) and room
function enrichSpecSections(sections: any[], lineItems: any[]): any[] {
  // If sections already have items, use them
  // Otherwise, build sections from atomic line items grouped by cost_code and room
  if (sections.length > 0 && sections.every(s => s.items && s.items.length > 0)) {
    return sections
  }

  // Group line items by cost_code (trade), then by room
  const itemsByCostCode = new Map<string, any[]>()
  
  lineItems.forEach(item => {
    if (typeof item === 'object' && item !== null) {
      const costCode = item.cost_code || '999'
      const room = item.room || item.room_name || 'General'
      
      if (!itemsByCostCode.has(costCode)) {
        itemsByCostCode.set(costCode, [])
      }
      
      itemsByCostCode.get(costCode)!.push({
        room,
        description: item.description || ''
      })
    }
  })

  // Build spec sections from grouped items
  const enrichedSections = Array.from(itemsByCostCode.entries()).map(([costCode, items]) => {
    // Group items by room
    const itemsByRoom = new Map<string, string[]>()
    
    items.forEach(item => {
      const room = item.room || 'General'
      if (!itemsByRoom.has(room)) {
        itemsByRoom.set(room, [])
      }
      if (item.description) {
        itemsByRoom.get(room)!.push(item.description)
      }
    })

    // Find existing section or create new one
    const existingSection = sections.find(s => s.code === costCode)
    
    // Get trade title from existing section or map from cost code
    const tradeTitleMap: Record<string, string> = {
      '201': 'DEMO',
      '305': 'FRAMING',
      '402': 'HVAC',
      '404': 'PLUMBING',
      '405': 'ELECTRICAL',
      '520': 'WINDOWS',
      '530': 'DOORS',
      '640': 'CABINETS',
      '641': 'COUNTERTOPS',
      '950': 'TILE',
      '960': 'FLOORING',
      '990': 'PAINT',
      '999': 'OTHER'
    }

    const sectionItems = Array.from(itemsByRoom.entries()).map(([room, descriptions]) => ({
      text: room,
      label: room,
      subitems: descriptions
    }))

    return {
      code: costCode,
      title: existingSection?.title || tradeTitleMap[costCode] || 'OTHER',
      allowance: existingSection?.allowance || null,
      items: sectionItems,
      subcontractor: existingSection?.subcontractor || null,
      notes: existingSection?.notes || null
    }
  })

  // Merge with existing sections that might have different cost codes
  const mergedSections = [...sections]
  enrichedSections.forEach(newSection => {
    const existingIndex = mergedSections.findIndex(s => s.code === newSection.code)
    if (existingIndex >= 0) {
      // Update existing section with grouped items if it's empty
      if (!mergedSections[existingIndex].items || mergedSections[existingIndex].items.length === 0) {
        mergedSections[existingIndex].items = newSection.items
      }
    } else {
      // Add new section
      mergedSections.push(newSection)
    }
  })

  // Ensure all sections have at least one item
  return mergedSections.map(section => {
    if (!section.items || section.items.length === 0) {
      section.items = [{
        text: `Work items for ${section.title}`,
        label: null,
        subitems: []
      }]
    }
    return section
  })
}


const TRADE_MAPPINGS: Array<{
  keywords: string[]
  code: string
  title: string
  category: 'Windows' | 'Doors' | 'Cabinets' | 'Flooring' | 'Plumbing' | 'Electrical' | 'Other'
}> = [
  { keywords: ['demo', 'demolition', 'remove', 'tear out'], code: '201', title: 'DEMO', category: 'Other' },
  { keywords: ['framing', 'framer', 'rough carpentry', 'stud'], code: '305', title: 'FRAMING', category: 'Other' },
  { keywords: ['plumb', 'plumbing', 'fixture', 'pipe'], code: '404', title: 'PLUMBING', category: 'Plumbing' },
  { keywords: ['electrical', 'lighting', 'wire', 'outlet', 'switch'], code: '405', title: 'ELECTRICAL', category: 'Electrical' },
  { keywords: ['hvac', 'mechanical', 'vent'], code: '402', title: 'HVAC', category: 'Other' },
  { keywords: ['window'], code: '520', title: 'WINDOWS', category: 'Windows' },
  { keywords: ['door'], code: '530', title: 'DOORS', category: 'Doors' },
  { keywords: ['cabinet', 'millwork', 'built-in'], code: '640', title: 'CABINETRY', category: 'Cabinets' },
  { keywords: ['countertop', 'counter top', 'solid surface'], code: '641', title: 'COUNTERTOPS', category: 'Cabinets' },
  { keywords: ['floor', 'flooring', 'hardwood', 'laminate'], code: '960', title: 'FLOORING', category: 'Flooring' },
  { keywords: ['tile', 'stone'], code: '950', title: 'TILE', category: 'Flooring' },
  { keywords: ['paint', 'finish', 'coating'], code: '990', title: 'PAINT', category: 'Other' },
]

function parseNumericValue(value: any): number | null {
  if (typeof value === 'number' && isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,]/g, '').trim()
    const parsed = Number(cleaned)
    return isNaN(parsed) ? null : parsed
  }
  return null
}

function matchTradeFromText(text?: string, fallbackCode?: string) {
  const lower = (text || '').toLowerCase()
  if (fallbackCode) {
    const byCode = TRADE_MAPPINGS.find(mapping => mapping.code === fallbackCode)
    if (byCode) return byCode
  }
  for (const mapping of TRADE_MAPPINGS) {
    if (mapping.keywords.some(keyword => lower.includes(keyword))) {
      return mapping
    }
  }
  return {
    keywords: [],
    code: fallbackCode || '999',
    title: (text || 'GENERAL').toUpperCase(),
    category: 'Other' as const,
  }
}

function sanitizeSpecItems(items: any, fallbackLabel?: string) {
  if (!Array.isArray(items) || items.length === 0) {
    return [
      {
        text: fallbackLabel || null,
        label: fallbackLabel || null,
        subitems: [],
      },
    ]
  }

  return items.map((item: any) => {
    if (typeof item === 'string') {
      return {
        text: item,
        label: fallbackLabel || null,
        subitems: [],
      }
    }

    return {
      text: typeof item?.text === 'string' ? item.text : null,
      label: typeof item?.label === 'string' ? item.label : fallbackLabel || null,
      subitems: Array.isArray(item?.subitems) ? item.subitems.map((entry: any) => String(entry)) : [],
    }
  })
}

function sanitizeSpecSections(sections: any[] = []): any[] {
  return sections.map((section, index) => {
    const tradeSource = `${section?.title || ''} ${section?.label || ''} ${section?.code || ''} ${section?.cost_code || ''}`
    const trade = matchTradeFromText(tradeSource, section?.code || section?.cost_code)
    const title = (section?.title || section?.label || trade.title || `SECTION_${index + 1}`).toUpperCase()

    return {
      code: section?.code || trade.code,
      title,
      allowance: parseNumericValue(section?.allowance),
      items: sanitizeSpecItems(section?.items, section?.label || title),
      subcontractor: section?.subcontractor ? String(section.subcontractor) : null,
      notes: section?.notes ? String(section.notes) : null,
    }
  })
}

function sanitizeLineItems(lineItems: any[] = []): Array<Record<string, any>> {
  return lineItems.map((item) => {
    // All line items must be structured objects (enforced by schema)
    // Fallback handling for unexpected types
    if (!item || typeof item !== 'object') {
      return {
        description: typeof item === 'string' ? item : '',
        category: 'Other' as const,
        cost_code: '999',
        room: 'General',
        labor_cost: null,
        margin_percent: null,
        client_price: null,
        notes: ''
      }
    }

    const trade = matchTradeFromText(item.category || item.cost_code || item.description || '')
    const laborCost = parseNumericValue(item.labor_cost)
    const marginPercent = parseNumericValue(item.margin_percent)
    const clientPrice = parseNumericValue(item.client_price)

    return {
      description: item.description ? String(item.description) : trade.title,
      category: trade.category,
      cost_code: item.cost_code || trade.code,
      room: item.room || item.room_name || 'General',
      labor_cost: laborCost,
      margin_percent: marginPercent,
      client_price: clientPrice,
      notes: item.notes ? String(item.notes) : '',
    }
  })
}

function sanitizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (item == null) return null
      return String(item)
    })
    .filter((entry): entry is string => Boolean(entry && entry.trim().length > 0))
}

function sanitizeParseResult(raw: any, fallbackProjectId: string) {
  const spec_sections = sanitizeSpecSections(Array.isArray(raw?.spec_sections) ? raw.spec_sections : [])
  const line_items = sanitizeLineItems(Array.isArray(raw?.line_items) ? raw.line_items : [])

  return {
    projectId: typeof raw?.projectId === 'string' ? raw.projectId : fallbackProjectId,
    spec_sections,
    line_items,
    assumptions: sanitizeStringArray(raw?.assumptions),
    missing_info: sanitizeStringArray(raw?.missing_info),
  }
}

async function parseTranscriptWithAI(
  transcript: string,
  projectId: string,
  apiKey: string
): Promise<ParseResult> {
  const prompt = `You are a senior construction estimator. Parse the contractor transcript into precise JSON that matches ParseResultSchema exactly. Do not change field names or structure.

CORE BEHAVIOR (STRICT) — ATOMIC LINE ITEMS ONLY
1. ATOMIC TASK RULE — MOST IMPORTANT:
   EVERY described task MUST become its own separate line item. Never group multiple tasks into one line item.
   
   Example:
   Transcript: "Demo full kitchen by removing upper cabinets, lower cabinets, soffit, bar, and opening wall for plumbing."
   
   You MUST create 5 separate line items:
   - room: "Kitchen", description: "Remove upper cabinets", category: "Demo", cost_code: "201"
   - room: "Kitchen", description: "Remove lower cabinets", category: "Demo", cost_code: "201"
   - room: "Kitchen", description: "Remove soffit", category: "Demo", cost_code: "201"
   - room: "Kitchen", description: "Remove bar area", category: "Demo", cost_code: "201"
   - room: "Kitchen", description: "Open wall for plumbing", category: "Demo", cost_code: "201"
   
   NEVER create combined descriptions like:
   ❌ "Remove upper cabinets, lower cabinets, soffit, bar, and open wall for plumbing"
   ❌ "Complete kitchen demolition"
   ❌ "Kitchen demo — full scope"
   
   ALWAYS split each action into its own atomic line item.

2. Room Detection:
   - Detect rooms such as Kitchen, Family Room, Primary Bath, Bedroom 1, Bedroom 2, Exterior, etc.
   - Set room field for each line item based on where the task occurs.
   - If room is not mentioned, set "room": "General".
   - Rooms MUST also appear in spec_sections grouped by trade.

3. Cost Codes and Categories:
   - Assign the correct cost_code based on the trade (see mapping below).
   - Assign the correct category based on the trade.
   - These must match: Demo → cost_code "201", Plumbing → "404", etc.

4. Pricing Fields (AI sets to null):
   - labor_cost: null (user will fill in UI)
   - margin_percent: null (user will fill in UI)
   - client_price: null (computed in UI as labor_cost * (1 + margin_percent/100))
   - DO NOT attempt to assign costs unless explicitly stated in transcript.

5. Line Item Format (required for each object):
   description: atomic action only (e.g., "Remove upper cabinets", not "Remove upper and lower cabinets")
   category: one of: Windows, Doors, Cabinets, Flooring, Plumbing, Electrical, HVAC, Demo, Framing, Paint, Countertops, Tile, Other
   cost_code: string matching category (see mapping)
   room: detected room name or "General"
   labor_cost: null
   margin_percent: null
   client_price: null
   notes: optional clarification

CATEGORY + COST CODE MAPPING:
- Demo / demolition → category "Demo", cost_code "201"
- Framing / rough carpentry → category "Framing", cost_code "305"
- Plumbing → category "Plumbing", cost_code "404"
- Electrical → category "Electrical", cost_code "405"
- HVAC / mechanical → category "HVAC", cost_code "402"
- Windows → category "Windows", cost_code "520"
- Doors → category "Doors", cost_code "530"
- Cabinets / built-ins → category "Cabinets", cost_code "640"
- Countertops → category "Countertops", cost_code "641"
- Tile / stone → category "Tile", cost_code "950"
- Flooring → category "Flooring", cost_code "960"
- Paint / coatings → category "Paint", cost_code "990"
- Default fallback → category "Other", cost_code "999"

Note: Category must be one of: "Windows", "Doors", "Cabinets", "Flooring", "Plumbing", "Electrical", "HVAC", "Demo", "Framing", "Paint", "Countertops", "Tile", "Other".

SPEC SECTIONS:
SPEC SECTION CONSOLIDATION RULE (CRITICAL):
For each trade (e.g. DEMO 201), you MUST generate exactly ONE spec_section object.

Do NOT output multiple spec_sections with the same code/title.
Do NOT split DEMO into multiple sections per room.

Structure:
- Create ONE spec_section per unique cost_code/trade.
- Group all line_items by cost_code, then by room.
- Each room becomes one item inside the spec_section:
    { "text": "Kitchen", "label": "Kitchen", "subitems": [...] }
    { "text": "Family Room", "label": "Family Room", "subitems": [...] }
    { "text": "Exterior", "label": "Exterior", "subitems": [...] }

- For each room, extract subitems from line_items that match that cost_code and room.
- Each subitem should be the description from a matching line_item.

Example:
If you have line_items:
  - room: "Kitchen", description: "Remove upper cabinets", cost_code: "201"
  - room: "Kitchen", description: "Remove lower cabinets", cost_code: "201"
  - room: "Kitchen", description: "Remove soffit", cost_code: "201"

Then spec_section for DEMO 201 should have:
  {
    "code": "201",
    "title": "DEMO",
    "allowance": null,
    "items": [
      { 
        "text": "Kitchen", 
        "label": "Kitchen",
        "subitems": [
          "Remove upper cabinets",
          "Remove lower cabinets", 
          "Remove soffit"
        ]
      }
    ]
  }

Do NOT repeat the trade name ("DEMO") at the item level.
Do NOT add duplicate section headers.
- Only assign allowance at the section level if explicitly mentioned in transcript.

OUTPUT FORMAT:
Return strictly:
{
  "projectId": "${projectId}",
  "spec_sections": [...],
  "line_items": [...],
  "assumptions": [...],
  "missing_info": [...]
}

Example line_items output:
"line_items": [
  {
    "description": "Remove upper cabinets",
    "category": "Demo",
    "cost_code": "201",
    "room": "Kitchen",
    "labor_cost": null,
    "margin_percent": null,
    "client_price": null
  },
  {
    "description": "Remove lower cabinets",
    "category": "Demo",
    "cost_code": "201",
    "room": "Kitchen",
    "labor_cost": null,
    "margin_percent": null,
    "client_price": null
  }
]

All numbers must be numeric (no commas, no "$").
Return JSON only, no markdown.

TRANSCRIPT:
${transcript}`

  // Retry logic for transient errors (502, 503, 504)
  const maxRetries = 3
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.pow(2, attempt - 1) * 1000
        console.log(`Retrying OpenAI API call (attempt ${attempt + 1}/${maxRetries}) after ${delayMs}ms...`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: [
                'You are Estimatix\'s parsing engine, a senior construction estimator AI.',
                'Your job is to convert contractor speech into STRICTLY structured JSON that matches ParseResultSchema exactly.',
                '',
                'Hard rules:',
                '- Always return valid JSON with no comments, no trailing commas, no markdown.',
                '- Never return plain strings in line_items. Every line item MUST be a structured object.',
                '- Never invent IDs. Use the projectId exactly as provided in the user prompt.',
                '- All numeric fields must be bare numbers (no "$", no commas).',
                '- If information is vague or missing, set labor_cost=null, margin_percent=null, client_price=null and record what is missing in missing_info.',
                '',
                'Proposal vs Estimate responsibilities:',
                '- spec_sections: for human-readable spec sheet (proposal PDF). One section per trade (per cost code). Group by room with subitems as atomic task descriptions.',
                '- line_items: atomic tasks ONLY. Every described task becomes its own line item. Never group multiple tasks into one line item.',
                '',
                'You must obey the user prompt exactly. If any conflict exists, prefer the user prompt.'
              ].join('\n')
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1, // Low temperature for consistent, structured output
          max_tokens: 4000,
          response_format: { type: 'json_object' }
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const status = response.status
        const isRetryable = status === 502 || status === 503 || status === 504 || status === 429
        
        // If it's a retryable error and we have retries left, continue to retry
        if (isRetryable && attempt < maxRetries - 1) {
          lastError = new Error(`OpenAI API error: ${status} ${errorData.error?.message || response.statusText}`)
          console.warn(`OpenAI API returned ${status}, will retry...`, errorData)
          continue
        }
        
        // Non-retryable error or out of retries
        console.error('OpenAI API error:', { status, errorData, attempt: attempt + 1 })
        throw new Error(`OpenAI API error: ${status} ${errorData.error?.message || response.statusText}${attempt > 0 ? ` (after ${attempt + 1} attempts)` : ''}`)
      }

      // Success - break out of retry loop
      const result = await response.json()
      const content = result.choices[0]?.message?.content

      if (!content) {
        throw new Error('No content returned from OpenAI')
      }

      // Log raw AI output
      console.log('AI RAW OUTPUT:', content)

      try {
        const parsed = JSON.parse(content)
        const sanitized = sanitizeParseResult(parsed, projectId)
        
        // Log sanitized JSON
        console.log('AI PARSED JSON:', JSON.stringify(sanitized, null, 2))
        
        // Validate with Zod schema
        const validated = ParseResultSchema.parse(sanitized)
        
        // Ensure line_items are properly formatted (all items are structured objects)
        const normalizedLineItems = validated.line_items.map(item => {
          // All line items are structured objects (enforced by schema)
          const categoryOptions: Array<'Windows' | 'Doors' | 'Cabinets' | 'Flooring' | 'Plumbing' | 'Electrical' | 'HVAC' | 'Demo' | 'Framing' | 'Paint' | 'Countertops' | 'Tile' | 'Other'> = 
            ['Windows', 'Doors', 'Cabinets', 'Flooring', 'Plumbing', 'Electrical', 'HVAC', 'Demo', 'Framing', 'Paint', 'Countertops', 'Tile', 'Other']
          const validCategory = item.category && categoryOptions.includes(item.category as any) 
            ? item.category 
            : 'Other' as const

          if (item && typeof item === 'object') {
            return {
              description: item.description || '',
              category: validCategory,
              cost_code: item.cost_code || '999',
              room: item.room || 'General',
              labor_cost: item.labor_cost ?? null,
              margin_percent: item.margin_percent ?? null,
              client_price: item.client_price ?? null,
              notes: item.notes || ''
            }
          }
          // Fallback for unexpected types (should not happen with structured-only schema)
          return {
            description: '',
            category: 'Other' as const,
            cost_code: '999',
            room: 'General',
            labor_cost: null,
            margin_percent: null,
            client_price: null,
            notes: ''
          }
        })
        
        return {
          ...validated,
          line_items: normalizedLineItems
        }
      } catch (parseError) {
        console.error('JSON parse/validation error:', parseError)
        console.error('Raw content:', content)
        
        // Fallback: return safe empty structure instead of throwing
        console.warn('Falling back to safe empty structure due to parse error')
        return {
          projectId: projectId,
          spec_sections: [],
          line_items: [],
          assumptions: [],
          missing_info: ['Failed to parse AI response. Please try again or add items manually.']
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        // Check if it's a network error that might benefit from retry suggestion
        const isNetworkError = lastError.message.includes('fetch failed') || 
                              lastError.message.includes('ECONNREFUSED') ||
                              lastError.message.includes('ENOTFOUND')
        
        if (isNetworkError) {
          throw new Error(`Network error connecting to OpenAI API. Please check your internet connection and try again.${attempt > 0 ? ` (tried ${attempt + 1} times)` : ''}`)
        }
        
        throw lastError
      }
      
      // Otherwise, log and continue to retry
      console.warn(`OpenAI API call failed (attempt ${attempt + 1}/${maxRetries}):`, lastError.message)
    }
  }
  
  // Should not reach here, but handle it just in case
  throw lastError || new Error('Failed to call OpenAI API after retries')
}
