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
// NOTE: line_items will now ALWAYS be structured objects.
// If the transcript is vague, use quantity=1, unit_cost=null, total=null (0-like)
// and explain what's missing in `missing_info`.
const StructuredLineItemSchema = z.object({
  description: z.string(),
  category: z.enum(['Windows', 'Doors', 'Cabinets', 'Flooring', 'Plumbing', 'Electrical', 'Other']).optional(),
  quantity: z.number().optional(),
  unit_cost: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  cost_code: z.string().optional(),
  room: z.string().optional(),
  notes: z.string().optional(),
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

    // Process line items - all items are now structured objects
    const processedItems = parseResult.line_items.map((item) => {
      // All line items are structured objects (enforced by schema)
      if (typeof item === 'object' && item !== null) {
        return {
          category: (item.category || 'Other') as 'Windows' | 'Doors' | 'Cabinets' | 'Flooring' | 'Plumbing' | 'Electrical' | 'Other',
          description: item.description || '',
          quantity: item.quantity ?? 1,
          dimensions: null,
          unit_cost: item.unit_cost ?? undefined,
          total: item.total ?? (item.quantity && item.unit_cost ? item.quantity * item.unit_cost : undefined),
          notes: item.notes || null
        }
      }
      // Fallback for unexpected types (should not happen with structured-only schema)
      return {
        category: 'Other' as const,
        description: '',
        quantity: 1,
        dimensions: null,
        unit_cost: undefined,
        total: undefined,
        notes: null
      }
    })

    // Calculate total from all items
    const calculatedTotal = processedItems.reduce((sum, item) => {
      return sum + (item.total || 0)
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
      ai_summary: `Parsed ${enrichedSections.length} specification sections and ${parseResult.line_items.length} line items from transcript`,
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

    return NextResponse.json({
      success: true,
      data: {
        spec_sections: enrichedSections,
        items: processedItems.map((item) => ({
          category: item.category,
          description: item.description,
          quantity: item.quantity,
          dimensions: item.dimensions,
          unit_cost: item.unit_cost,
          total: item.total,
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
function enrichSpecSections(sections: any[], lineItems: any[]): any[] {
  return sections.map(section => {
    // If section has no items, try to populate from line_items
    if (section.items.length === 0 && lineItems.length > 0) {
      // All line items are structured objects
      const lineItemStrings = lineItems.map(item => {
        if (typeof item === 'object' && item !== null) {
          return (item.description || '').toLowerCase()
        }
        return ''
      })
      
      // Find line items that might belong to this category
      const categoryKeywords = section.title.toLowerCase()
      const relevantItems = lineItems.filter((item, index) => {
        const itemStr = lineItemStrings[index]
        return itemStr.includes(categoryKeywords) || itemStr.includes(section.code)
      })
      
      if (relevantItems.length > 0) {
        section.items = relevantItems.map(item => {
          const description = typeof item === 'object' && item !== null ? (item.description || '') : ''
          return {
            text: description,
          label: null,
          subitems: []
          }
        })
      } else {
        // If no matches, at least add the first few line items
        section.items = lineItems.slice(0, 3).map(item => {
          const description = typeof item === 'object' && item !== null ? (item.description || '') : ''
          return {
            text: description,
          label: null,
          subitems: []
          }
        })
      }
    }
    
    // Ensure at least one item exists
    if (section.items.length === 0) {
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
        quantity: 1,
        unit_cost: null,
        total: null,
        cost_code: '999',
        room: 'General',
        notes: ''
      }
    }

    const trade = matchTradeFromText(item.category || item.cost_code || item.description || '')
    const quantity = typeof item.quantity === 'number' && isFinite(item.quantity)
      ? item.quantity
      : parseNumericValue(item.quantity) || 1
    const unitCost = parseNumericValue(item.unit_cost)
    const total = parseNumericValue(item.total)

    return {
      description: item.description ? String(item.description) : trade.title,
      category: trade.category,
      quantity,
      unit_cost: unitCost,
      total: total ?? (unitCost != null ? unitCost * quantity : null),
      cost_code: item.cost_code || trade.code,
      room: item.room ? String(item.room) : 'General',
      notes: item.notes ? String(item.notes) : (item.allowance ? 'Allowance covers full scope' : ''),
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

CORE BEHAVIOR (STRICT)
1. Allowance Rule — MOST IMPORTANT:
   When the transcript provides a single allowance for an entire trade (e.g., "demo allowance for the whole thing is $5000"), you MUST:
     a. Create ONE grouped line item for that trade.
     b. Set:
          quantity = 1
          unit_cost = allowanceAmount
          total = allowanceAmount
     c. Create a descriptive line item name that includes the rooms affected:
          "Complete demolition scope — Kitchen, Family Room, Exterior"
     d. Set the correct cost code for the trade.
     e. Add a clear notes field:
          "Allowance covers entire demo scope."
     f. Also set spec_section.allowance = allowanceAmount.
   Never divide the allowance across subtasks.
   Never leave line_items with unit_cost or total equal to 0 when an allowance was provided.

2. Trade Grouping:
   - Only create multiple line_items for the same trade if the transcript gives separate costs.
   - Otherwise, always group into ONE line item per trade.

3. Room Detection:
   - Detect rooms such as Kitchen, Family Room, Primary Bath, Bedroom 1, Bedroom 2, Exterior, etc.
   - Rooms MUST appear in spec_sections as:
        text: RoomName
        subitems: bullet list of tasks for that room
   - For line_items only include "room" if the transcript gives per-room pricing.  
     Otherwise, set "room": "General".

4. No Guessing:
   - If no price is mentioned and no allowance exists:
         quantity = 1
         unit_cost = 0
         total = 0
         Add to missing_info: "Need cost for [trade/scope]."
   - DO NOT invent dimensions, lengths, counts, materials, or costs.

5. Line Item Format (required for each object):
   description
   category
   quantity
   unit_cost
   total
   cost_code
   room
   notes

CATEGORY + COST CODE MAPPING:
- Demo / demolition → category "Other", cost_code "201"
- Framing / rough carpentry → category "Other", cost_code "305"
- Plumbing → category "Plumbing", cost_code "404"
- Electrical → category "Electrical", cost_code "405"
- HVAC / mechanical → category "Other", cost_code "402"
- Windows → category "Windows", cost_code "520"
- Doors → category "Doors", cost_code "530"
- Cabinets / built-ins → category "Cabinets", cost_code "640"
- Countertops → category "Cabinets", cost_code "641"
- Tile / stone → category "Flooring", cost_code "950"
- Flooring → category "Flooring", cost_code "960"
- Paint / coatings → category "Other", cost_code "990"
- Default fallback → category "Other", cost_code "999"

Note: Category must be one of: "Windows", "Doors", "Cabinets", "Flooring", "Plumbing", "Electrical", or "Other".

SPEC SECTIONS:
SPEC SECTION CONSOLIDATION RULE (CRITICAL):
For each trade (e.g. DEMO 201), you MUST generate exactly ONE spec_section object.

Do NOT output multiple spec_sections with the same code/title.
Do NOT split DEMO into multiple sections per room.

Instead:
- Create a single spec_section for the trade.
- Each room becomes one item inside that section:
    { "text": "Kitchen", "subitems": [...] }
    { "text": "Family Room", "subitems": [...] }
    { "text": "Exterior", "subitems": [...] }

Do NOT repeat the trade name ("DEMO") at the item level.
Do NOT add duplicate section headers.
Do NOT wrap items inside additional section layers.

Example of correct structure:

"spec_sections": [
  {
    "code": "201",
    "title": "DEMO",
    "allowance": 5000,
    "items": [
      { "text": "Kitchen", "subitems": [ "Remove upper cabinets", "Remove lower cabinets", "Remove soffit", "Remove bar area", "Open wall for plumbing" ] },
      { "text": "Family Room", "subitems": [ "Remove fireplace", "Remove sheetrock", "Remove two small windows" ] },
      { "text": "Exterior", "subitems": [ "Cut stucco around openings" ] }
    ]
  }
]

Never output:
DEMO 201
DEMO 201
DEMO 201
before each room.

Always consolidate into ONE trade section with multiple room items.

- Create ONE spec_section per trade.
- Use the correct title + code (e.g., DEMO 201).
- Inside each section:
     items = array of { text, label, subitems }
- Each room should be:
     text: "Kitchen"
     subitems: ["Remove upper cabinets", "Remove lower cabinets", …]
- Only assign allowance at the section level when explicitly mentioned.

OUTPUT FORMAT:
Return strictly:
{
  "projectId": "${projectId}",
  "spec_sections": [...],
  "line_items": [...],
  "assumptions": [...],
  "missing_info": [...]
}

All numbers must be numeric (no commas, no "$").
Return JSON only, no markdown.

TRANSCRIPT:
${transcript}`

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
            '- If information is vague or missing, use sensible defaults (quantity=1, unit_cost=null, total=null) and record what is missing in missing_info.',
            '',
            'Proposal vs Estimate responsibilities:',
            '- spec_sections: for human-readable spec sheet (proposal PDF). One section per trade (per cost code). Use bullets and sub-bullets, grouped by room.',
            '- line_items: for internal estimating ONLY (no need to match the PDF exactly). One main priced line item per trade when the cost or allowance is lump-sum.',
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
    console.error('OpenAI API error:', { status: response.status, errorData })
    throw new Error(`OpenAI API error: ${response.status} ${errorData.error?.message || response.statusText}`)
  }

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
      const categoryOptions: Array<'Windows' | 'Doors' | 'Cabinets' | 'Flooring' | 'Plumbing' | 'Electrical' | 'Other'> = 
        ['Windows', 'Doors', 'Cabinets', 'Flooring', 'Plumbing', 'Electrical', 'Other']
      const validCategory = item.category && categoryOptions.includes(item.category as any) 
        ? item.category 
        : 'Other' as const

      if (item && typeof item === 'object') {
        return {
          description: item.description || '',
          category: validCategory,
          quantity: item.quantity ?? 1,
          unit_cost: item.unit_cost ?? null,
          total: item.total ?? (item.quantity && item.unit_cost ? item.quantity * item.unit_cost : null),
          cost_code: item.cost_code || '',
          room: item.room || 'General',
          notes: item.notes || ''
        }
      }
      // Fallback for unexpected types (should not happen with structured-only schema)
      return {
        description: '',
        category: 'Other' as const,
        quantity: 1,
        unit_cost: null,
        total: null,
        cost_code: '999',
        room: 'General',
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
    // This prevents breaking the UI if AI returns bad JSON
    console.warn('Falling back to safe empty structure due to parse error')
    return {
      projectId: projectId,
      spec_sections: [],
      line_items: [],
      assumptions: [],
      missing_info: ['Failed to parse AI response. Please try again or add items manually.']
    }
  }
}
