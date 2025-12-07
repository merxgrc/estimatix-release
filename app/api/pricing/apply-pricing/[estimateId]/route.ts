import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, requireAuth } from '@/lib/supabase/server'
import { matchTask } from '@/lib/pricing/match-task'
import { upsertSelectionFromLineItem, suggestAllowanceForSelection } from '@/lib/selections'

export const runtime = 'nodejs'

// Constants
const DEFAULT_LABOR_RATE = 85
const OVERHEAD_PERCENT = 0.10
const DEFAULT_MARGIN = 20

const QUALITY_MULTIPLIERS = {
  Budget: 0.9,
  Standard: 1.0,
  Premium: 1.2,
} as const

interface PricingMatch {
  unit_cost: number
  pricing_source: 'user_library' | 'task_library' | 'manual'
  confidence: number
  task_library_id?: string | null
  labor_hours_per_unit?: number | null
  material_cost_per_unit?: number | null
  matched_via?: 'semantic' | 'fuzzy' | 'cost_code_only'
}

/**
 * Find pricing match for a line item using vector-first matching
 */
async function findPricing(
  lineItem: any,
  userCostMap: Map<string, any>,
  taskLibrary: any[],
  userMarginRules: any[],
  userRegion: string | null,
  qualityMultiplier: number
): Promise<PricingMatch> {
  const costCode: string | null = lineItem.cost_code || null
  const description: string = lineItem.description || ''

  // If we have nothing to match on, fall back to manual
  if (!description.trim() && !costCode) {
    return {
      unit_cost: 0,
      pricing_source: 'manual',
      confidence: 0,
    }
  }

  // 1) Vector + fuzzy + cost_code matching via matchTask
  try {
    const hybridMatch = await matchTask({
      description,
      cost_code: costCode,
      region: userRegion,
      queryEmbedding: null, // let matchTask generate/query embedding as needed
    })

    if (hybridMatch && hybridMatch.task) {
      const task = hybridMatch.task
      const userOverride = userCostMap.get(task.id)

      // Choose base unit cost: user override > unit_cost_mid > low > high > 0
      const baseCost =
        (userOverride?.custom_unit_cost as number | undefined) ??
        (task.unit_cost_mid as number | null) ??
        (task.unit_cost_low as number | null) ??
        (task.unit_cost_high as number | null) ??
        0

      const adjustedCost = baseCost * qualityMultiplier

      return {
        unit_cost: adjustedCost,
        pricing_source: userOverride ? 'user_library' : 'task_library',
        confidence: hybridMatch.confidence ?? 50,
        task_library_id: task.id,
        labor_hours_per_unit: task.labor_hours_per_unit ?? null,
        material_cost_per_unit: task.material_cost_per_unit ?? null,
        matched_via: hybridMatch.matched_via ?? 'semantic',
      }
    }
  } catch (err) {
    console.warn('matchTask failed, will try cost_code-only fallback:', err)
  }

  // 2) Cost-code-only fallback when matchTask fails or finds nothing
  if (costCode) {
    // Prefer matches in user's region, then national/NULL
    let candidates = taskLibrary.filter((t) => t.cost_code === costCode)

    if (userRegion) {
      const regionMatches = candidates.filter(
        (t) => t.region === userRegion
      )
      const nationalMatches = candidates.filter(
        (t) => t.region === null || t.region === 'National'
      )

      if (regionMatches.length > 0) {
        candidates = regionMatches
      } else if (nationalMatches.length > 0) {
        candidates = nationalMatches
      }
    }

    if (candidates.length > 0) {
      const task = candidates[0]
      const userOverride = userCostMap.get(task.id)

      const baseCost =
        (userOverride?.custom_unit_cost as number | undefined) ??
        (task.unit_cost_mid as number | null) ??
        (task.unit_cost_low as number | null) ??
        (task.unit_cost_high as number | null) ??
        0

      const adjustedCost = baseCost * qualityMultiplier

      return {
        unit_cost: adjustedCost,
        pricing_source: userOverride ? 'user_library' : 'task_library',
        confidence: 50,
        task_library_id: task.id,
        labor_hours_per_unit: task.labor_hours_per_unit ?? null,
        material_cost_per_unit: task.material_cost_per_unit ?? null,
        matched_via: 'cost_code_only',
      }
    }
  }

  // 3) Final fallback: manual pricing required
  return {
    unit_cost: 0,
    pricing_source: 'manual',
    confidence: 30,
  }
}

/**
 * Get margin for a cost code from user margin rules
 */
function getMarginForCostCode(
  costCode: string | null,
  userMarginRules: any[],
  defaultMarginFromSettings: number
): number {
  if (!costCode) return defaultMarginFromSettings

  for (const rule of userMarginRules) {
    if (
      rule.applies_to_cost_codes &&
      Array.isArray(rule.applies_to_cost_codes) &&
      rule.applies_to_cost_codes.includes(costCode)
    ) {
      return rule.default_margin || defaultMarginFromSettings
    }
  }

  return defaultMarginFromSettings
}

/**
 * Calculate pricing breakdown from match and margin
 */
function calculatePricing(
  lineItem: any,
  match: PricingMatch,
  margin: number
): {
  labor_cost: number
  material_cost: number
  overhead_cost: number
  direct_cost: number
  client_price: number
  unit_labor_cost: number
  unit_material_cost: number
  unit_total_cost: number
  total_direct_cost: number
} {
  const quantity = lineItem.quantity || 1
  const unitCost = match.unit_cost

  let unitLaborCost: number
  let unitMaterialCost: number

  if (
    match.labor_hours_per_unit !== null &&
    match.labor_hours_per_unit !== undefined &&
    match.material_cost_per_unit !== null &&
    match.material_cost_per_unit !== undefined
  ) {
    unitLaborCost = (match.labor_hours_per_unit || 0) * DEFAULT_LABOR_RATE
    unitMaterialCost = match.material_cost_per_unit || 0
  } else {
    // Heuristic split: 70% labor / 30% material
    unitLaborCost = unitCost * 0.7
    unitMaterialCost = unitCost * 0.3
  }

  const labor_cost = unitLaborCost * quantity
  const material_cost = unitMaterialCost * quantity
  const overhead_cost = (labor_cost + material_cost) * OVERHEAD_PERCENT
  const direct_cost = labor_cost + material_cost + overhead_cost
  const client_price = direct_cost * (1 + margin / 100)

  const unit_total_cost = unitLaborCost + unitMaterialCost
  const total_direct_cost = unit_total_cost * quantity

  const round = (n: number) => Math.round(n * 100) / 100

  return {
    labor_cost: round(labor_cost),
    material_cost: round(material_cost),
    overhead_cost: round(overhead_cost),
    direct_cost: round(direct_cost),
    client_price: round(client_price),
    unit_labor_cost: round(unitLaborCost),
    unit_material_cost: round(unitMaterialCost),
    unit_total_cost: round(unit_total_cost),
    total_direct_cost: round(total_direct_cost),
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ estimateId: string }> }
) {
  try {
    const { estimateId } = await context.params

    if (!estimateId) {
      return NextResponse.json(
        { error: 'Missing estimateId parameter' },
        { status: 400 }
      )
    }

    // 1. Auth & ownership
    const user = await requireAuth()
    if (!user || !user.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const supabase = await createServerClient()

    // 2. Load estimate and verify ownership
    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .select('id, project_id')
      .eq('id', estimateId)
      .single()

    if (estimateError || !estimate) {
      return NextResponse.json(
        { error: 'Estimate not found' },
        { status: 404 }
      )
    }

    // Verify project belongs to user
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', estimate.project_id)
      .single()

    if (projectError || !project || project.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized: Estimate does not belong to user' },
        { status: 403 }
      )
    }

    // 3. Load all required data
    // 3a. Load line items
    const { data: lineItems, error: lineItemsError } = await supabase
      .from('estimate_line_items')
      .select('*')
      .eq('estimate_id', estimateId)

    if (lineItemsError) {
      console.error('Error loading line items:', lineItemsError)
      return NextResponse.json(
        { error: `Failed to load line items: ${lineItemsError.message}` },
        { status: 500 }
      )
    }

    if (!lineItems || lineItems.length === 0) {
      return NextResponse.json({
        success: true,
        estimateId,
        updated: 0
      })
    }

    // 3b. Load user_margin_rules
    const { data: marginRules, error: marginRulesError } = await supabase
      .from('user_margin_rules')
      .select('*')
      .eq('user_id', user.id)

    if (marginRulesError) {
      console.error('Error loading margin rules:', marginRulesError)
      // Continue without margin rules (use default)
    }

    // 3c. Load user_cost_library with joined task_library
    const { data: userCostLibrary, error: userCostError } = await supabase
      .from('user_cost_library')
      .select('*, task_library:task_library_id(*)')
      .eq('user_id', user.id)

    if (userCostError) {
      console.error('Error loading user cost library:', userCostError)
      // Continue without user overrides
    }

    // 3d. Load user_profile_settings
    const { data: userSettings, error: settingsError } = await supabase
      .from('user_profile_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (settingsError && settingsError.code !== 'PGRST116') {
      console.error('Error loading user profile settings:', settingsError)
      // Continue with defaults
    }

    // 3e. Load task_library
    const { data: taskLibrary, error: taskLibraryError } = await supabase
      .from('task_library')
      .select('*')

    if (taskLibraryError) {
      console.error('Error loading task library:', taskLibraryError)
      return NextResponse.json(
        { error: `Failed to load task library: ${taskLibraryError.message}` },
        { status: 500 }
      )
    }

    // 4. Extract settings and compute quality multiplier
    const userRegion = userSettings?.region || 'National'
    const userQuality = userSettings?.quality || 'Standard'
    const defaultMarginFromSettings = userSettings?.default_margin
      ? Number(userSettings.default_margin)
      : DEFAULT_MARGIN

    const qualityMultiplier =
      QUALITY_MULTIPLIERS[userQuality as keyof typeof QUALITY_MULTIPLIERS] || 1.0

    // 5. Build user cost map for quick lookup
    const userCostMap = new Map<string, any>()
    if (userCostLibrary && Array.isArray(userCostLibrary)) {
      userCostLibrary.forEach((row: any) => {
        if (row.task_library_id) {
          userCostMap.set(row.task_library_id, row)
        }
      })
    }

    // 6. Process each line item
    let updatedCount = 0
    const updates: any[] = []

    for (const lineItem of lineItems) {
      // Find pricing match using vector-first engine
      const match = await findPricing(
        lineItem,
        userCostMap,
        taskLibrary || [],
        marginRules || [],
        userRegion,
        qualityMultiplier
      )

      // Get margin for this cost code
      const margin = getMarginForCostCode(
        lineItem.cost_code || null,
        marginRules || [],
        defaultMarginFromSettings
      )

      // Calculate pricing breakdown
      const pricing = calculatePricing(lineItem, match, margin)

      // Prepare update
      updates.push({
        id: lineItem.id,
        labor_cost: pricing.labor_cost,
        material_cost: pricing.material_cost,
        overhead_cost: pricing.overhead_cost,
        direct_cost: pricing.direct_cost,
        margin_percent: margin,
        client_price: pricing.client_price,
        pricing_source: match.pricing_source,
        confidence: match.confidence,
        task_library_id: match.task_library_id || null,
        matched_via: match.matched_via || null,
        unit_labor_cost: pricing.unit_labor_cost,
        unit_material_cost: pricing.unit_material_cost,
        unit_total_cost: pricing.unit_total_cost,
        total_direct_cost: pricing.total_direct_cost,
        applied_region: userRegion,
        applied_quality: userQuality,
        applied_margin: margin,
      })
    }

    // 7. Batch update all line items
    for (const update of updates) {
      const updateData: any = {
        labor_cost: update.labor_cost,
        material_cost: update.material_cost,
        overhead_cost: update.overhead_cost,
        direct_cost: update.direct_cost,
        margin_percent: update.margin_percent,
        client_price: update.client_price,
        pricing_source: update.pricing_source,
        confidence: update.confidence,
        task_library_id: update.task_library_id || null,
        matched_via: update.matched_via || null,
        unit_labor_cost: update.unit_labor_cost,
        unit_material_cost: update.unit_material_cost,
        unit_total_cost: update.unit_total_cost,
        total_direct_cost: update.total_direct_cost,
        applied_region: update.applied_region,
        applied_quality: update.applied_quality,
        applied_margin: update.applied_margin,
      }

      const { error: updateError } = await supabase
        .from('estimate_line_items')
        .update(updateData)
        .eq('id', update.id)

      if (updateError) {
        console.error(`Error updating line item ${update.id}:`, updateError)
        // Continue with other updates
      } else {
        updatedCount++
      }
    }

    // 8. Handle selections and allowances (non-blocking)
    // After pricing is applied, sync selections for allowance line items
    try {
      // Load all line items with is_allowance = true
      const { data: allowanceLineItems, error: allowanceError } = await supabase
        .from('estimate_line_items')
        .select('*')
        .eq('estimate_id', estimateId)
        .eq('is_allowance', true)

      if (!allowanceError && allowanceLineItems && allowanceLineItems.length > 0) {
        for (const lineItem of allowanceLineItems) {
          try {
            // Upsert selection from line item
            const selection = await upsertSelectionFromLineItem(
              {
                ...lineItem,
                estimate_id: estimateId,
                room: lineItem.room_name || undefined,
              },
              user.id
            )

            // If selection was created/updated and allowance is null, suggest it
            if (selection && selection.allowance === null) {
              await suggestAllowanceForSelection(selection, user.id)
            }
          } catch (selectionError) {
            // Log but don't fail - selections are additive
            console.warn(`Failed to process selection for line item ${lineItem.id}:`, selectionError)
          }
        }
      }
    } catch (selectionsError) {
      // Log but don't fail - selections failures should never break pricing
      console.warn('Selections processing failed (non-blocking):', selectionsError)
    }

    return NextResponse.json({
      success: true,
      estimateId,
      updated: updatedCount
    })

  } catch (error) {
    console.error('Apply pricing error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
