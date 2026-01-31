import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase/server'
import { suggestAllowanceForSelection } from '@/lib/selections'
import { requireAuth } from '@/lib/supabase/server'

export const runtime = 'nodejs' // Disable Edge runtime for OpenAI API compatibility

// Allowance keywords for determining if cost_code 999 should be assigned
const ALLOWANCE_KEYWORDS = ['allowance', 'budget', 'finish package', '$', 'fixture package']

/**
 * Check if description contains allowance keywords (case-insensitive)
 */
function containsAllowanceKeywords(description: string): boolean {
  if (!description || typeof description !== 'string') return false
  const lowerDesc = description.toLowerCase()
  return ALLOWANCE_KEYWORDS.some(keyword => lowerDesc.includes(keyword.toLowerCase()))
}

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
// EXCEPTION: For allowance items, client_price = allowance_amount automatically.
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

  // Allowance fields (for allowance line items)
  is_allowance: z.boolean().default(false),
  allowance_amount: z.number().nullable().optional(),
  subcontractor: z.string().nullable().optional(),
  allowance_notes: z.string().optional(),

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

// Selection classification schema
const SelectionClassificationSchema = z.object({
  is_selection: z.boolean(),
  category: z.string().nullable(),
  product_title: z.string().nullable(),
  extended_description: z.string().nullable(),
  subcontractor: z.string().nullable(),
  stated_allowance: z.number().nullable(),
})

type SelectionClassification = z.infer<typeof SelectionClassificationSchema>

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { transcript, projectId, estimateId } = body
    
    console.log('AI Parse API called with:', { projectId, estimateId, transcriptLength: transcript?.length })
    
    // Get user for selection creation (needed for ownership verification)
    const user = await requireAuth()
    if (!user || !user.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }
    
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

    // If estimateId is provided, we're modifying an existing estimate
    // Otherwise, create a new estimate
    const isModifyingExisting = estimateId && typeof estimateId === 'string'

    // Normalize allowances (convert string "$5000" to number 5000)
    const normalizedSections = normalizeAllowances(parseResult.spec_sections)
    
    // Ensure spec_sections have items - populate from line_items if empty
    const enrichedSections = enrichSpecSections(normalizedSections, parseResult.line_items)
    
    console.log('Final spec_sections:', JSON.stringify(enrichedSections, null, 2))
    
    // Store result in estimates table
    const supabase = await createServerClient()
    
    // Check if estimate already exists for this project
    // If estimateId is provided, use it; otherwise check for existing estimate
    let existingEstimate = null
    if (isModifyingExisting) {
      const { data, error } = await supabase
        .from('estimates')
        .select('id')
        .eq('id', estimateId)
        .single()
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error checking existing estimate:', error)
        return NextResponse.json(
          { error: `Failed to check existing estimate: ${error.message}` },
          { status: 500 }
        )
      }
      
      if (data) {
        existingEstimate = data
      }
    } else {
      const { data, error: checkError } = await supabase
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
      
      existingEstimate = data
    }

    // Process line items - all items are now atomic structured objects
    const processedItems = parseResult.line_items.map((item) => {
      // All line items are structured objects (enforced by schema)
      if (typeof item === 'object' && item !== null) {
        const description = item.description || ''
        const isAllowance = item.is_allowance === true
        
        // Only assign cost_code='999' if:
        // 1. cost_code is already provided (preserve it)
        // 2. OR description contains allowance keywords (for non-allowance items)
        // Otherwise, leave cost_code as null/undefined (don't force 999)
        let costCode = item.cost_code
        if (!costCode && !isAllowance && containsAllowanceKeywords(description)) {
          costCode = '999'
        }
        
        // For allowance items: set client_price = allowance_amount automatically
        // Skip pricing engine for allowances
        let clientPrice = item.client_price ?? 0
        if (isAllowance && item.allowance_amount !== null && item.allowance_amount !== undefined) {
          clientPrice = item.allowance_amount
        }
        
        return {
          category: item.category || 'Other',
          description: description,
          cost_code: costCode || null, // Don't force 999 if no allowance keywords
          room_name: item.room || 'General', // Default to 'General' if not detected
          quantity: item.quantity ?? 1, // Default to 1 if not provided
          unit: item.unit || 'EA', // Default to 'EA' if not provided
          labor_cost: isAllowance ? null : (item.labor_cost ?? 0), // Allowances don't use labor_cost
          margin_percent: isAllowance ? null : (item.margin_percent ?? 0), // Allowances don't use margin
          client_price: clientPrice,
          is_allowance: isAllowance,
          allowance_amount: isAllowance ? (item.allowance_amount ?? null) : null,
          subcontractor: isAllowance ? (item.subcontractor ?? null) : null,
          allowance_notes: isAllowance ? (item.allowance_notes ?? null) : null,
          notes: item.notes || null
        }
      }
      // Fallback for unexpected types (should not happen with structured-only schema)
      return {
        category: 'Other',
        description: '',
        cost_code: null, // Don't force 999 in fallback
        room_name: 'General',
        quantity: 1,
        unit: 'EA',
        labor_cost: 0,
        margin_percent: 0,
        client_price: 0,
        is_allowance: false,
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

    let finalEstimateId: string

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
      finalEstimateId = updatedEstimate.id
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
      finalEstimateId = newEstimate.id
    }

    // Save line items to estimate_line_items table
    if (processedItems.length > 0) {
      // Delete existing line items for this estimate (only if creating new estimate, not modifying)
      // When modifying, we append new items instead of replacing
      if (!isModifyingExisting) {
        await supabase
          .from('estimate_line_items')
          .delete()
          .eq('estimate_id', finalEstimateId)
      }

      // Insert new atomic line items
      // Preserve cost_code if provided, otherwise use null (don't force 999)
      // Include is_allowance flag and allowance fields for allowance items
      const lineItemsToInsert = processedItems.map(item => ({
        estimate_id: finalEstimateId,
        project_id: projectId,
        room_name: item.room_name,
        description: item.description,
        category: item.category,
        cost_code: item.cost_code || null, // Don't force 999 - preserve null if not set
        quantity: item.quantity,
        unit: item.unit,
        labor_cost: item.labor_cost,
        margin_percent: item.margin_percent,
        client_price: item.client_price,
        is_allowance: item.is_allowance || false, // Include is_allowance flag
        allowance_amount: item.is_allowance ? (item.allowance_amount || null) : null,
        subcontractor: item.is_allowance ? (item.subcontractor || null) : null,
        allowance_notes: item.is_allowance ? (item.allowance_notes || null) : null
      }))

      const { data: insertedLineItems, error: lineItemsError } = await supabase
        .from('estimate_line_items')
        .insert(lineItemsToInsert)
        .select()

      if (lineItemsError) {
        console.error('Error saving line items to database:', lineItemsError)
        // Don't fail the request, but log the error
      } else {
        console.log(`Saved ${insertedLineItems?.length || 0} atomic line items to estimate_line_items table`)
        
        // AI-assisted selection detection (non-blocking)
        // Process each line item to detect if it's a selection
        // SKIP allowance items - they don't go through selection detection
        if (insertedLineItems && insertedLineItems.length > 0) {
          const nonAllowanceItems = insertedLineItems.filter(item => !item.is_allowance)
          if (nonAllowanceItems.length > 0) {
            await detectAndCreateSelections(
              nonAllowanceItems,
              finalEstimateId,
              user.id,
              openaiApiKey
            ).catch((err) => {
              // Log but don't fail - selection detection is additive
              console.warn('Selection detection failed (non-blocking):', err)
            })
          }
        }
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
          quantity: item.quantity,
          unit: item.unit,
          labor_cost: item.labor_cost,
          margin_percent: item.margin_percent,
          client_price: item.client_price,
          notes: item.notes || ''
        })),
        assumptions: parseResult.assumptions || [],
        missing_info: parseResult.missing_info || []
      },
      estimateId: finalEstimateId
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
        cost_code: null, // Don't force 999 in fallback
        room: 'General',
        labor_cost: null,
        margin_percent: null,
        client_price: null,
        notes: '',
        is_allowance: false
      }
    }

    const description = item.description ? String(item.description) : ''
    const isAllowance = item.is_allowance === true
    const trade = matchTradeFromText(item.category || item.cost_code || description || '')
    const laborCost = parseNumericValue(item.labor_cost)
    const marginPercent = parseNumericValue(item.margin_percent)
    // For allowance items, use allowance_amount as client_price if provided
    const clientPrice = isAllowance && item.allowance_amount !== null && item.allowance_amount !== undefined
      ? parseNumericValue(item.allowance_amount)
      : parseNumericValue(item.client_price)

    // Preserve cost_code if provided, otherwise:
    // - Use trade.code if it's not '999'
    // - Only use '999' if description contains allowance keywords (for non-allowance items)
    let costCode = item.cost_code
    if (!costCode) {
      if (trade.code !== '999') {
        costCode = trade.code
      } else if (!isAllowance && containsAllowanceKeywords(description)) {
        costCode = '999'
      } else {
        costCode = null // Don't force 999
      }
    }

    return {
      description: description || trade.title,
      category: trade.category,
      cost_code: costCode,
      room: item.room || item.room_name || 'General',
      labor_cost: isAllowance ? null : laborCost, // Allowances don't use labor_cost
      margin_percent: isAllowance ? null : marginPercent, // Allowances don't use margin
      client_price: clientPrice,
      notes: item.notes || item.allowance_notes ? String(item.notes || item.allowance_notes) : '',
      is_allowance: isAllowance,
      allowance_amount: isAllowance ? parseNumericValue(item.allowance_amount) : null,
      subcontractor: isAllowance ? (item.subcontractor ? String(item.subcontractor) : null) : null
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

CORE BEHAVIOR (STRICT) — ATOMIC LINE ITEMS WITH ALLOWANCE EXCEPTION

1. ALLOWANCE DETECTION RULE — HIGHEST PRIORITY:
   If the user input contains allowance patterns, create ONLY ONE line item (do NOT split):
   
   Allowance patterns to detect:
   - "allowance is [amount]"
   - "allowance of [amount]"
   - "budget [amount]" or "budget of [amount]"
   - "$[number]" followed by allowance context
   - "[something] allowance" (e.g., "fireplace allowance", "tile allowance")
   - Phrases like "subcontractor will be X" or "done by X" combined with dollar amounts
   
   When allowance patterns are detected:
   - Create ONLY ONE line item (do NOT split into multiple items)
   - Set is_allowance: true
   - Extract allowance_amount from text (numeric value, no "$" or commas)
   - Extract subcontractor if mentioned (e.g., "subcontractor will be ABC Company", "done by XYZ")
   - Set description to the entire scope paragraph (preserve full context)
   - Set quantity: 1, unit: "EA"
   - Detect room normally
   - Assign cost_code based on content (fireplace → appropriate code, framing → 305, etc.)
   - Set client_price: allowance_amount (automatically, skip pricing engine)
   - Set labor_cost: null, margin_percent: null (allowances don't use these)
   - Set allowance_notes: any additional context about the allowance
   
   Example:
   Transcript: "Fireplace allowance is $18,000. Subcontractor will be Pacific Hearth & Home. This includes the fireplace unit, installation, and all related work."
   
   Create ONE line item:
   {
     "description": "Fireplace allowance is $18,000. Subcontractor will be Pacific Hearth & Home. This includes the fireplace unit, installation, and all related work.",
     "is_allowance": true,
     "allowance_amount": 18000,
     "subcontractor": "Pacific Hearth & Home",
     "cost_code": "520", // or appropriate code for fireplace
     "room": "Family Room", // if mentioned, else "General"
     "quantity": 1,
     "unit": "EA",
     "client_price": 18000,
     "labor_cost": null,
     "margin_percent": null,
     "allowance_notes": "Includes fireplace unit, installation, and all related work"
   }
   
   DO NOT split this into multiple line items.

2. ATOMIC TASK RULE — FOR NON-ALLOWANCE ITEMS:
   If NO allowance patterns are detected, then:
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
   For NON-ALLOWANCE items:
   - description: atomic action only (e.g., "Remove upper cabinets", not "Remove upper and lower cabinets")
   - category: one of: Windows, Doors, Cabinets, Flooring, Plumbing, Electrical, HVAC, Demo, Framing, Paint, Countertops, Tile, Other
   - cost_code: string matching category (see mapping)
   - room: detected room name or "General"
   - labor_cost: null
   - margin_percent: null
   - client_price: null
   - is_allowance: false (or omit)
   - notes: optional clarification
   
   For ALLOWANCE items:
   - description: full scope paragraph (preserve entire context)
   - is_allowance: true
   - allowance_amount: numeric value extracted from text (no "$" or commas)
   - subcontractor: extracted if mentioned (e.g., "Pacific Hearth & Home")
   - allowance_notes: optional additional context
   - cost_code: based on content (fireplace, framing, etc.)
   - room: detected room name or "General"
   - quantity: 1
   - unit: "EA"
   - client_price: allowance_amount (set automatically)
   - labor_cost: null
   - margin_percent: null

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

Example line_items output (non-allowance):
"line_items": [
  {
    "description": "Remove upper cabinets",
    "category": "Demo",
    "cost_code": "201",
    "room": "Kitchen",
    "labor_cost": null,
    "margin_percent": null,
    "client_price": null,
    "is_allowance": false
  },
  {
    "description": "Remove lower cabinets",
    "category": "Demo",
    "cost_code": "201",
    "room": "Kitchen",
    "labor_cost": null,
    "margin_percent": null,
    "client_price": null,
    "is_allowance": false
  }
]

Example line_items output (allowance):
"line_items": [
  {
    "description": "Fireplace allowance is $18,000. Subcontractor will be Pacific Hearth & Home. This includes the fireplace unit, installation, and all related work.",
    "is_allowance": true,
    "allowance_amount": 18000,
    "subcontractor": "Pacific Hearth & Home",
    "cost_code": "520",
    "room": "Family Room",
    "quantity": 1,
    "unit": "EA",
    "client_price": 18000,
    "labor_cost": null,
    "margin_percent": null,
    "allowance_notes": "Includes fireplace unit, installation, and all related work"
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
                'Spec Sheet vs Estimate responsibilities:',
                '- spec_sections: for human-readable spec sheet (spec sheet PDF). One section per trade (per cost code). Group by room with subitems as atomic task descriptions.',
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

          const isAllowance = item.is_allowance === true

          if (item && typeof item === 'object') {
            // For allowance items, use allowance_amount as client_price
            const clientPrice = isAllowance && item.allowance_amount !== null && item.allowance_amount !== undefined
              ? item.allowance_amount
              : (item.client_price ?? null)

            return {
              description: item.description || '',
              is_allowance: isAllowance,
              category: validCategory,
              cost_code: item.cost_code || null,
              room: item.room || 'General',
              labor_cost: isAllowance ? null : (item.labor_cost ?? null), // Allowances don't use labor_cost
              margin_percent: isAllowance ? null : (item.margin_percent ?? null), // Allowances don't use margin
              client_price: clientPrice,
              notes: item.notes || item.allowance_notes || undefined,
              allowance_amount: isAllowance ? (item.allowance_amount ?? null) : undefined,
              subcontractor: isAllowance ? (item.subcontractor ?? null) : undefined
            }
          }
          // Fallback for unexpected types (should not happen with structured-only schema)
          return {
            description: '',
            is_allowance: false,
            category: 'Other' as const,
            cost_code: null,
            room: 'General',
            labor_cost: null,
            margin_percent: null,
            client_price: null,
            notes: undefined
          }
        })
        
        return {
          ...validated,
          line_items: normalizedLineItems as any // Type assertion needed due to optional fields in schema
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

/**
 * AI-assisted selection detection
 * Classifies each line item description to determine if it's a product selection
 * and auto-creates selection rows when detected
 */
async function detectAndCreateSelections(
  lineItems: Array<{
    id: string
    estimate_id: string
    project_id: string
    room_name: string | null
    description: string
    category: string
    cost_code: string
  }>,
  estimateId: string,
  userId: string,
  openaiApiKey: string
): Promise<void> {
  const supabase = await createServerClient()
  
  console.log(`[Selection Detection] Processing ${lineItems.length} line items for selection detection`)
  
  // Process each line item (with error tolerance)
  for (const lineItem of lineItems) {
    try {
      // Skip if description is empty
      if (!lineItem.description || lineItem.description.trim().length === 0) {
        continue
      }

      // STRICT RULE: Only create selection if:
      // 1. cost_code is already '999' (manually set), OR
      // 2. description contains allowance keywords
      const isCostCode999 = lineItem.cost_code === '999'
      const hasAllowanceKeywords = containsAllowanceKeywords(lineItem.description)
      
      if (!isCostCode999 && !hasAllowanceKeywords) {
        // Skip - don't create selection and don't assign cost_code 999
        continue
      }

      // Classify the line item description
      const classification = await classifyLineItemAsSelection(
        lineItem.description,
        openaiApiKey
      )

      if (!classification || !classification.is_selection) {
        continue // Not a selection, skip
      }

      console.log(`[Selection Detection] Detected selection: "${lineItem.description}"`)

      // Create selection row
      // NOTE: Do NOT copy cost_code, room, category, or description from line items
      // Selections should only store: allowance, subcontractor, product_name (title)
      // Line items remain the source of truth for all other fields
      const selectionData: any = {
        estimate_id: estimateId,
        title: classification.product_title || lineItem.description.substring(0, 100) || 'Untitled Selection',
        subcontractor: classification.subcontractor || null,
        allowance: classification.stated_allowance || null,
        source: 'ai_text',
        // Explicitly set these to null - they should not be synced from line items
        cost_code: null,
        room: null,
        category: null,
        description: null,
      }

      const { data: newSelection, error: insertError } = await supabase
        .from('selections')
        .insert(selectionData)
        .select()
        .single()

      if (insertError) {
        console.error(`[Selection Detection] Failed to create selection for "${lineItem.description}":`, insertError)
        continue // Skip to next item
      }

      console.log(`[Selection Detection] Created selection: ${newSelection.id}`)

      // Update line item to reference the selection (we have the ID from insert)
      const updateData: any = {
        selection_id: newSelection.id,
      }

      // Set is_allowance flag if selection has an allowance
      if (newSelection.allowance !== null) {
        updateData.is_allowance = true
      }

      const { error: updateError } = await supabase
        .from('estimate_line_items')
        .update(updateData)
        .eq('id', lineItem.id)

      if (updateError) {
        console.warn(`[Selection Detection] Failed to link selection to line item:`, updateError)
        // Continue - selection was created successfully
      } else {
        console.log(`[Selection Detection] Linked selection ${newSelection.id} to line item ${lineItem.id}`)
      }

      // Trigger allowance suggestion if allowance is null
      if (newSelection.allowance === null) {
        try {
          await suggestAllowanceForSelection(newSelection, userId)
          console.log(`[Selection Detection] Triggered allowance suggestion for selection ${newSelection.id}`)
        } catch (suggestionError) {
          console.warn(`[Selection Detection] Allowance suggestion failed:`, suggestionError)
          // Non-blocking - continue
        }
      }

    } catch (error) {
      // Log but continue processing other items
      console.warn(`[Selection Detection] Error processing line item "${lineItem.description}":`, error)
    }
  }

  console.log(`[Selection Detection] Completed processing ${lineItems.length} line items`)
}

/**
 * Classify a line item description to determine if it's a product selection
 * Uses GPT-4o-mini for lightweight classification
 */
async function classifyLineItemAsSelection(
  description: string,
  apiKey: string
): Promise<SelectionClassification | null> {
  try {
    const prompt = `Classify the following construction line item description to determine if it represents a product selection (specific brand, model, or product choice).

A line item is a SELECTION if:
- It mentions a specific brand name (e.g., "Town & Country", "GE Café", "Emser Tile")
- It mentions a model number or product identifier (e.g., "TC42", "36-inch Range", "Aura White 12x24")
- It mentions a product type that implies a choice (e.g., "Fireplace allowance", "Tile selection", "We're choosing...")
- It mentions a price or allowance amount

Return JSON with:
- is_selection: boolean (true if this is a product selection)
- category: string or null (product category like "Prefab Fireplaces", "Appliances", "Tile", etc.)
- product_title: string or null (short product name/title, e.g., "Town & Country TC42 Fireplace")
- extended_description: string or null (full descriptive text if available)
- subcontractor: string or null (if mentioned, e.g., "Pacific Hearth & Home")
- stated_allowance: number or null (if a dollar amount is mentioned, extract as number)

Example inputs and outputs:
Input: "Town & Country TC42 Fireplace"
Output: {"is_selection": true, "category": "Prefab Fireplaces", "product_title": "Town & Country TC42 Fireplace", "extended_description": null, "subcontractor": null, "stated_allowance": null}

Input: "Fireplace allowance $18,000"
Output: {"is_selection": true, "category": "Prefab Fireplaces", "product_title": "Fireplace", "extended_description": null, "subcontractor": null, "stated_allowance": 18000}

Input: "Remove upper cabinets"
Output: {"is_selection": false, "category": null, "product_title": null, "extended_description": null, "subcontractor": null, "stated_allowance": null}

Input: "Emser Tile — Aura White 12x24 installed by Pacific Tile"
Output: {"is_selection": true, "category": "Tile", "product_title": "Emser Tile Aura White 12x24", "extended_description": null, "subcontractor": "Pacific Tile", "stated_allowance": null}

Return JSON only, no markdown.

Description to classify:
${description}`

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
            content: 'You are a construction product classification assistant. Return only valid JSON matching the SelectionClassificationSchema.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 200,
      response_format: { type: 'json_object' }
    })
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(`OpenAI API error: ${response.status} ${errorData.error?.message || response.statusText}`)
  }

  const result = await response.json()
  const content = result.choices[0]?.message?.content

  if (!content) {
    throw new Error('No content returned from OpenAI')
  }

    const parsed = JSON.parse(content)
    const validated = SelectionClassificationSchema.parse(parsed)

    return validated

  } catch (error) {
    console.warn(`[Selection Classification] Failed to classify "${description}":`, error)
    return null // Return null on error (non-blocking)
  }
}
