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

// Combined parse result schema - line_items can be strings OR structured objects
const ParseResultSchema = z.object({
  projectId: z.string(),
  spec_sections: z.array(SpecSectionSchema),
  line_items: z.array(z.union([
    z.string(), // Backward compatible: simple strings
    StructuredLineItemSchema // New: structured objects with quantities, costs, etc.
  ])),
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

    // Process line items - handle both string and structured formats
    const processedItems = parseResult.line_items.map((item) => {
      // If it's already a structured object, use it
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
      // If it's a string, parse it or use defaults
      return {
        category: 'Other' as const,
        description: typeof item === 'string' ? item : '',
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
function enrichSpecSections(sections: any[], lineItems: (string | any)[]): any[] {
  return sections.map(section => {
    // If section has no items, try to populate from line_items
    if (section.items.length === 0 && lineItems.length > 0) {
      // Convert line items to strings for matching
      const lineItemStrings = lineItems.map(item => {
        if (typeof item === 'string') return item.toLowerCase()
        return (item.description || '').toLowerCase()
      })
      
      // Find line items that might belong to this category
      const categoryKeywords = section.title.toLowerCase()
      const relevantItems = lineItems.filter((item, index) => {
        const itemStr = lineItemStrings[index]
        return itemStr.includes(categoryKeywords) || itemStr.includes(section.code)
      })
      
      if (relevantItems.length > 0) {
        section.items = relevantItems.map(item => {
          const description = typeof item === 'string' ? item : (item.description || '')
          return {
            text: description,
            label: null,
            subitems: []
          }
        })
      } else {
        // If no matches, at least add the first few line items
        section.items = lineItems.slice(0, 3).map(item => {
          const description = typeof item === 'string' ? item : (item.description || '')
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

async function parseTranscriptWithAI(
  transcript: string,
  projectId: string,
  apiKey: string
): Promise<ParseResult> {
  const prompt = `You are a professional construction estimator. Convert contractor speech into structured, detailed line items with quantities, costs, categories, and cost codes.

CRITICAL RULES:
1. ALWAYS extract quantities from spoken numbers (e.g., "seven windows" → quantity: 7, "three doors" → quantity: 3)
2. ALWAYS extract unit costs from price mentions (e.g., "$100 each" → unit_cost: 100, "fifty dollars per" → unit_cost: 50)
3. ALWAYS calculate total = quantity × unit_cost when both are available
4. ALWAYS assign correct categories: Windows, Doors, Cabinets, Flooring, Plumbing, Electrical, or Other
5. ALWAYS map categories to cost codes: Windows=520, Doors=530, Cabinets=640, Flooring=960, Plumbing=404, Electrical=405, Other=999
6. ALWAYS detect room names (Kitchen, Bathroom, Bedroom, Living Room, etc.) or use "General" if not specified
7. NEVER combine multiple items into one line - separate them
8. NEVER output unstructured merged descriptions like "Replace seven windows at $100 each"
9. ALWAYS output structured objects with separate fields for quantity, unit_cost, total, category, etc.

CATEGORY MAPPING:
- Windows, window, windows → category: "Windows", cost_code: "520"
- Door, doors → category: "Doors", cost_code: "530"
- Cabinet, cabinets, cabinetry → category: "Cabinets", cost_code: "640"
- Floor, flooring, floor covering → category: "Flooring", cost_code: "960"
- Plumbing, plumb, pipe, fixture → category: "Plumbing", cost_code: "404"
- Electrical, wire, outlet, switch, light → category: "Electrical", cost_code: "405"
- Demo, demolition, remove, tear out → category: "Other", cost_code: "201"
- Paint, painting → category: "Other", cost_code: "990"
- Default → category: "Other", cost_code: "999"

NUMBER CONVERSION EXAMPLES:
- "one" → 1, "two" → 2, "three" → 3, "four" → 4, "five" → 5
- "six" → 6, "seven" → 7, "eight" → 8, "nine" → 9, "ten" → 10
- "eleven" → 11, "twelve" → 12, "thirteen" → 13, "fourteen" → 14, "fifteen" → 15
- "twenty" → 20, "thirty" → 30, "fifty" → 50, "one hundred" → 100

COST EXTRACTION EXAMPLES:
- "$100 each" → unit_cost: 100
- "one hundred dollars per" → unit_cost: 100
- "$50 per unit" → unit_cost: 50
- "fifty dollars each" → unit_cost: 50
- "$25/square foot" → unit_cost: 25 (note: "per square foot" in notes)

ROOM DETECTION:
- "kitchen" → room: "Kitchen"
- "bathroom" → room: "Bathroom"
- "bedroom" → room: "Bedroom"
- "living room" → room: "Living Room"
- "family room" → room: "Family Room"
- If no room mentioned → room: "General"

EXAMPLE INPUT: "Replace seven windows at one hundred dollars each in the kitchen"

EXAMPLE OUTPUT:
{
  "line_items": [
    {
      "description": "Replace window",
      "category": "Windows",
      "quantity": 7,
      "unit_cost": 100,
      "total": 700,
      "cost_code": "520",
      "room": "Kitchen",
      "notes": ""
    }
  ]
}

For spec_sections:
- Detect categories like DEMO, FRAMING, PLUMBING, ELECTRICAL, HVAC, WINDOWS, STUCCO, CABINETRY, COUNTERTOPS, FLOORING, TILE, PAINT.
- Map them to codes: DEMO=201, FRAMING=305, PLUMBING=404, ELECTRICAL=405, HVAC=402, WINDOWS=520, STUCCO=703, CABINETRY=640, COUNTERTOPS=641, FLOORING=960, TILE=950, PAINT=990.
- Extract allowances ("Allowance: $5000" → 5000).
- Extract subcontractors.
- Convert sentences into bullet lists.
- If the user says "Family room:" treat it as a label with subitems.
- Never leave items empty.
- Never leave allowances null if mentioned.
- Never output empty sections.

PROJECT DESCRIPTION:
${transcript}

Return ONLY valid JSON matching this exact schema. You MUST use structured objects for line_items:
{
  "projectId": "${projectId}",
  "spec_sections": [
    {
      "code": "520",
      "title": "WINDOWS",
      "allowance": null,
      "items": [
        {
          "text": "Replace window",
          "label": null,
          "subitems": []
        }
      ],
      "subcontractor": null,
      "notes": null
    }
  ],
  "line_items": [
    {
      "description": "Replace window",
      "category": "Windows",
      "quantity": 7,
      "unit_cost": 100,
      "total": 700,
      "cost_code": "520",
      "room": "Kitchen",
      "notes": ""
    }
  ],
  "assumptions": ["Assumptions made during estimation"],
  "missing_info": ["Information that needs clarification"]
}

IMPORTANT: 
- line_items MUST be an array of structured objects, NOT strings
- Each object MUST have description, category, quantity, unit_cost, total
- Extract ALL numbers and costs from the speech
- Separate multiple items into individual line items
- Be precise and conservative. If any information is unclear, add it to missing_info rather than guessing.`

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
          content: 'You are a professional construction estimator AI. Your task is to parse contractor speech into structured line items with quantities, unit costs, totals, categories, cost codes, and rooms. You MUST extract all numerical values (quantities, prices) from spoken text. Convert number words to digits. Calculate totals automatically. Assign correct categories and cost codes. Detect room names or use "General". Separate multiple items into individual line items. NEVER combine items into unstructured descriptions. ALWAYS output line_items as an array of structured objects (NOT strings) with description, category, quantity, unit_cost, total, cost_code, and room fields. Return only valid JSON matching the exact schema. Never leave items empty. Never leave allowances null if mentioned. Always include projectId in your response.'
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
    
    // Log parsed JSON
    console.log('AI PARSED JSON:', JSON.stringify(parsed, null, 2))
    
    // Validate with Zod schema
    const validated = ParseResultSchema.parse(parsed)
    
    // Ensure line_items are properly formatted (handle both string and object formats)
    const normalizedLineItems = validated.line_items.map(item => {
      if (typeof item === 'string') {
        // Keep as string for backward compatibility
        return item
      }
      // Ensure structured objects have required fields
      if (item && typeof item === 'object') {
        return {
          description: item.description || '',
          category: item.category || 'Other',
          quantity: item.quantity ?? 1,
          unit_cost: item.unit_cost ?? null,
          total: item.total ?? (item.quantity && item.unit_cost ? item.quantity * item.unit_cost : null),
          cost_code: item.cost_code || '',
          room: item.room || 'General',
          notes: item.notes || ''
        }
      }
      return item
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
