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

// Combined parse result schema - line_items as simple strings
const ParseResultSchema = z.object({
  projectId: z.string(),
  spec_sections: z.array(SpecSectionSchema),
  line_items: z.array(z.string()), // Simple string array for pricing
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

    // Prepare data for insert/update
    const estimateData = {
      project_id: projectId,
      spec_sections: enrichedSections,
      json_data: {
        items: parseResult.line_items.map((item, index) => ({
          category: 'Other',
          description: item,
          quantity: 1,
          dimensions: null,
          unit_cost: null,
          total: null,
          notes: null
        })),
        assumptions: parseResult.assumptions || [],
        missing_info: parseResult.missing_info || []
      },
      ai_summary: `Parsed ${enrichedSections.length} specification sections and ${parseResult.line_items.length} line items from transcript`,
      total: 0 // Will be calculated when costs are added
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
        items: parseResult.line_items.map((item, index) => ({
          category: 'Other' as const,
          description: item,
          quantity: 1,
          dimensions: null,
          unit_cost: undefined,
          total: undefined,
          notes: ''
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
function enrichSpecSections(sections: any[], lineItems: string[]): any[] {
  return sections.map(section => {
    // If section has no items, try to populate from line_items
    if (section.items.length === 0 && lineItems.length > 0) {
      // Find line items that might belong to this category
      const categoryKeywords = section.title.toLowerCase()
      const relevantItems = lineItems.filter(item => 
        item.toLowerCase().includes(categoryKeywords) ||
        item.toLowerCase().includes(section.code)
      )
      
      if (relevantItems.length > 0) {
        section.items = relevantItems.map(item => ({
          text: item,
          label: null,
          subitems: []
        }))
      } else {
        // If no matches, at least add the first few line items
        section.items = lineItems.slice(0, 3).map(item => ({
          text: item,
          label: null,
          subitems: []
        }))
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
  const prompt = `You convert contractor speech into TWO outputs:
1. line_items: short, simple, per-action items (used for pricing).
2. spec_sections: formatted specification sections for the PDF.

You MUST produce both.

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

For line_items:
- Each actionable statement becomes a simple, flat line item string.
- These must always be populated even if spec_sections is empty.
- Examples: "Remove existing kitchen cabinets", "Install new plumbing fixtures", "Wire electrical outlets"

PROJECT DESCRIPTION:
${transcript}

Return ONLY valid JSON matching this exact schema:
{
  "projectId": "${projectId}",
  "spec_sections": [
    {
      "code": "201",
      "title": "DEMO",
      "allowance": null,
      "items": [
        {
          "text": "Remove existing kitchen cabinets",
          "label": null,
          "subitems": []
        },
        {
          "text": null,
          "label": "Family room",
          "subitems": ["Remove carpet", "Remove baseboards"]
        }
      ],
      "subcontractor": null,
      "notes": null
    }
  ],
  "line_items": [
    "Remove existing kitchen cabinets",
    "Remove carpet from family room",
    "Remove baseboards from family room",
    "Install new kitchen cabinets"
  ],
  "assumptions": ["Assumptions made during estimation"],
  "missing_info": ["Information that needs clarification"]
}

Be precise and conservative. If any information is unclear, add it to missing_info rather than guessing.`

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
          content: 'You are a construction estimator assistant. Convert natural spoken construction descriptions into structured specifications. You MUST output both line_items (array of strings) and spec_sections (array of sections). Never leave items empty. Never leave allowances null if mentioned. Return only valid JSON matching the exact schema provided. Always include projectId in your response.'
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
    
    const validated = ParseResultSchema.parse(parsed)
    return validated
  } catch (parseError) {
    console.error('JSON parse/validation error:', parseError)
    console.error('Raw content:', content)
    throw new Error('Failed to parse OpenAI response as valid JSON matching the schema')
  }
}
