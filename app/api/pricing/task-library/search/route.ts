import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Fuzzy similarity function for description matching
function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase()
  const s2 = b.toLowerCase()
  
  // If strings are identical, return 100%
  if (s1 === s2) return 1.0
  
  // Count overlapping characters
  const overlap = [...s1].filter(char => s2.includes(char)).length
  const maxLength = Math.max(s1.length, s2.length)
  
  if (maxLength === 0) return 0
  
  // Calculate similarity based on character overlap
  const charSimilarity = overlap / maxLength
  
  // Also check for substring matches (higher weight)
  const containsMatch = s1.includes(s2) || s2.includes(s1)
  const substringBonus = containsMatch ? 0.3 : 0
  
  // Check for word overlap
  const words1 = s1.split(/\s+/).filter(w => w.length > 2)
  const words2 = s2.split(/\s+/).filter(w => w.length > 2)
  const commonWords = words1.filter(w => words2.includes(w)).length
  const wordSimilarity = words1.length > 0 && words2.length > 0
    ? commonWords / Math.max(words1.length, words2.length)
    : 0
  
  // Combine metrics (character similarity + word similarity + substring bonus)
  return Math.min(1.0, charSimilarity * 0.4 + wordSimilarity * 0.5 + substringBonus)
}

interface SearchRequest {
  cost_code?: string
  description?: string
  region?: string
}

interface TaskLibraryResult {
  id: string
  cost_code: string
  description: string
  unit: string
  region: string | null
  unit_cost_low: number | null
  unit_cost_mid: number | null
  unit_cost_high: number | null
  labor_hours_per_unit: number | null
  material_cost_per_unit: number | null
  notes: string | null
  confidence?: number
}

async function searchTaskLibrary(params: SearchRequest) {
  const { cost_code, description, region } = params

  // Validate input - at least one search parameter required
  if (!cost_code && !description && !region) {
    throw new Error('At least one search parameter (cost_code, description, or region) is required')
  }

  const supabase = await createServerClient()

  // Build query based on provided parameters
  let query = supabase
    .from('task_library')
    .select('id, cost_code, description, unit, region, unit_cost_low, unit_cost_mid, unit_cost_high, labor_hours_per_unit, material_cost_per_unit, notes')

  // Step 1: Filter by cost_code if provided (exact match)
  if (cost_code) {
    query = query.eq('cost_code', cost_code)
  }

  // Step 2: Filter by region if provided
  if (region) {
    // Include NULL regions (national) or exact region match
    query = query.or(`region.is.null,region.eq.${region}`)
  }

  // Execute query
  const { data: tasks, error } = await query

  if (error) {
    console.error('Error querying task_library:', error)
    throw new Error(`Database error: ${error.message}`)
  }

  if (!tasks || tasks.length === 0) {
    return []
  }

  // Step 3: If description is provided, compute similarity scores
  let results: TaskLibraryResult[] = tasks

  if (description && description.trim().length > 0) {
    // Compute confidence score for each task based on description similarity
    results = tasks.map((task) => {
      const confidenceScore = similarity(description, task.description)
      return {
        ...task,
        confidence: Math.round(confidenceScore * 100) // Convert to 0-100 scale
      }
    })

    // Sort by confidence descending (highest similarity first)
    results.sort((a, b) => {
      const confidenceA = a.confidence || 0
      const confidenceB = b.confidence || 0
      
      // If confidences are equal, prefer exact cost_code match
      if (confidenceA === confidenceB && cost_code) {
        if (a.cost_code === cost_code && b.cost_code !== cost_code) return -1
        if (b.cost_code === cost_code && a.cost_code !== cost_code) return 1
      }
      
      return confidenceB - confidenceA
    })
  } else {
    // No description provided - if cost_code was provided, sort by description
    // Otherwise, maintain database order
    if (cost_code && description === undefined) {
      // Just return results as-is (sorted by database default)
      results = tasks as TaskLibraryResult[]
    }
  }

  // Return top 20 results
  return results.slice(0, 20)
}

export async function POST(request: NextRequest) {
  try {
    const body: SearchRequest = await request.json()
    const tasks = await searchTaskLibrary(body)
    
    return NextResponse.json({
      tasks
    })

  } catch (error) {
    console.error('Task library search error:', error)
    
    // Handle validation errors with 400 status
    if (error instanceof Error && error.message.includes('required')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

// Also support GET method with query parameters for convenience
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const params: SearchRequest = {
      cost_code: searchParams.get('cost_code') || undefined,
      description: searchParams.get('description') || undefined,
      region: searchParams.get('region') || undefined
    }

    const tasks = await searchTaskLibrary(params)
    
    return NextResponse.json({
      tasks
    })

  } catch (error) {
    console.error('Task library search GET error:', error)
    
    // Handle validation errors with 400 status
    if (error instanceof Error && error.message.includes('required')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

