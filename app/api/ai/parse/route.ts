import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs' // Disable Edge runtime for OpenAI API compatibility

// Zod schema for line items validation
const DimensionSchema = z.object({
  unit: z.enum(['in', 'ft', 'cm', 'm']),
  width: z.number().positive(),
  height: z.number().positive(),
  depth: z.number().nullable().optional()
})

const LineItemSchema = z.object({
  category: z.enum(['Windows', 'Doors', 'Cabinets', 'Flooring', 'Plumbing', 'Electrical', 'Other']),
  description: z.string().min(1),
  quantity: z.number().positive(),
  dimensions: DimensionSchema.nullable().optional(),
  unit_cost: z.number().positive().nullable().optional(),
  total: z.number().positive().nullable().optional(),
  notes: z.string().optional().nullable()
})

const ParseResultSchema = z.object({
  items: z.array(LineItemSchema),
  assumptions: z.array(z.string()).optional(),
  missing_info: z.array(z.string()).optional()
})

type ParseResult = z.infer<typeof ParseResultSchema>

export async function POST(request: NextRequest) {
  try {
    const { projectId, transcript } = await request.json()
    
    console.log('AI Parse API called with:', { projectId, transcriptLength: transcript?.length })
    
    if (!transcript) {
      console.error('Missing transcript in request')
      return NextResponse.json(
        { error: 'Missing transcript' },
        { status: 400 }
      )
    }

    const openaiApiKey = process.env.OPENAI_API_KEY
    let parseResult: ParseResult

    if (!openaiApiKey) {
      console.warn('OpenAI API key not configured, using fallback parsing')
      // Fallback parsing without OpenAI
      parseResult = {
        items: [
          {
            category: 'Other',
            description: transcript,
            quantity: 1,
            dimensions: null,
            unit_cost: undefined,
            total: undefined,
            notes: 'Parsed from transcript (OpenAI not available)'
          }
        ],
        assumptions: ['OpenAI API not available - using basic parsing'],
        missing_info: ['Detailed item breakdown requires OpenAI API key']
      }
    } else {
      // Parse transcript with OpenAI
      parseResult = await parseTranscriptWithAI(transcript, openaiApiKey)
    }
    
    // Store result in estimates table
    const supabase = await createServerClient()
    const { data: estimateData, error: estimateError } = await supabase
      .from('estimates')
      .insert({
        project_id: projectId,
        json_data: parseResult,
        ai_summary: `Parsed ${parseResult.items.length} line items from transcript`,
        total: parseResult.items.reduce((sum, item) => sum + (item.total || 0), 0)
      })
      .select()
      .single()

    if (estimateError) {
      console.error('Database error:', estimateError)
      console.error('Database error details:', JSON.stringify(estimateError, null, 2))
      return NextResponse.json(
        { error: `Failed to store estimate data: ${estimateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: parseResult,
      estimateId: estimateData.id
    })

  } catch (error) {
    console.error('AI parse error:', error)
    return NextResponse.json(
      { error: 'Failed to parse transcript' },
      { status: 500 }
    )
  }
}

async function parseTranscriptWithAI(transcript: string, apiKey: string): Promise<ParseResult> {
  const prompt = `You are an expert construction estimator. Parse the following project description into structured line items.

STRICT RULES:
1. NORMALIZE UNITS: Convert all measurements to consistent units (prefer feet/inches for US projects)
2. AGGREGATE DUPLICATES: Combine identical items with total quantities
3. INFER REASONABLE DEFAULTS: Use industry standards for missing specifications
4. NEVER INVENT QUANTITIES: If unclear, add to missing_info instead of guessing
5. CATEGORIZE PROPERLY: Use exact categories (Windows, Doors, Cabinets, Flooring, Plumbing, Electrical, Other)
6. CALCULATE TOTALS: Only if unit_cost is provided or can be reasonably estimated

PROJECT DESCRIPTION:
${transcript}

Return ONLY valid JSON matching this exact schema:
{
  "items": [
    {
      "category": "Windows|Doors|Cabinets|Flooring|Plumbing|Electrical|Other",
      "description": "detailed item description",
      "quantity": number,
      "dimensions": {
        "unit": "in|ft|cm|m",
        "width": number,
        "height": number,
        "depth": number (optional)
      } | null,
      "unit_cost": number (optional),
      "total": number (optional),
      "notes": "string (optional)"
    }
  ],
  "assumptions": ["string array of assumptions made"],
  "missing_info": ["string array of unclear information"]
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
          content: 'You are a construction estimator. Return only valid JSON matching the exact schema provided.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1, // Low temperature for consistent, structured output
      max_tokens: 2000,
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

  try {
    const parsed = JSON.parse(content)
    return ParseResultSchema.parse(parsed)
  } catch (parseError) {
    console.error('JSON parse error:', parseError)
    console.error('Raw content:', content)
    throw new Error('Failed to parse OpenAI response as valid JSON')
  }
}
