/**
 * Hybrid matching engine combining fuzzy matching, semantic search, and confidence scoring
 */

import { fuzzyScore } from './fuzzy'
import { semanticSearch } from './semantic'

export interface MatchResult {
  task: {
    id: string
    cost_code: string | null
    description: string
    unit: string
    region: string | null
    unit_cost_low: number | null
    unit_cost_mid: number | null
    unit_cost_high: number | null
    labor_hours_per_unit: number | null
    material_cost_per_unit: number | null
  }
  confidence: number // 0-100
  matched_via: 'semantic' | 'fuzzy' | 'cost_code_only'
}

export interface MatchTaskParams {
  description: string
  cost_code?: string | null
  region?: string | null
  queryEmbedding?: number[] | null
}

/**
 * Match a line item description to a task in the library
 * Uses hybrid approach: cost code filtering + semantic search + fuzzy matching
 */
export async function matchTask({
  description,
  cost_code,
  region,
  queryEmbedding
}: MatchTaskParams): Promise<MatchResult | null> {
  if (!description || description.trim().length === 0) {
    return null
  }

  // Generate embedding if not provided
  let embedding = queryEmbedding
  
  if (!embedding || embedding.length !== 1536) {
    const openaiApiKey = process.env.OPENAI_API_KEY
    if (openaiApiKey) {
      try {
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: description,
          }),
        })

        if (embeddingResponse.ok) {
          const embeddingData = await embeddingResponse.json()
          embedding = embeddingData.data[0]?.embedding
        }
      } catch (embedError) {
        console.warn('Failed to generate embedding, falling back to fuzzy matching:', embedError)
      }
    }
  }

  // If we have an embedding, use semantic search
  let semanticMatches: Array<{ task: any; similarity: number }> = []
  
  if (embedding && embedding.length === 1536) {
    try {
      semanticMatches = await semanticSearch(embedding, 20, cost_code || null, region || null)
    } catch (error) {
      console.error('Semantic search error:', error)
      // Fall back to fuzzy matching if semantic search fails
    }
  }

  // If no semantic matches, fall back to fuzzy matching
  // We'll need to fetch tasks manually for fuzzy matching
  let fuzzyCandidates: any[] = []
  
  if (semanticMatches.length === 0) {
    // Fetch tasks for fuzzy matching
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      })

      let query = supabase
        .from('task_library')
        .select('id, cost_code, description, unit, region, unit_cost_low, unit_cost_mid, unit_cost_high, labor_hours_per_unit, material_cost_per_unit')

      // Apply cost code filter if provided
      if (cost_code) {
        query = query.eq('cost_code', cost_code)
      }

      // Apply region filter if provided
      if (region) {
        query = query.or(`region.eq.${region},region.is.null`)
      }

      const { data, error } = await query.limit(100)

      if (!error && data) {
        fuzzyCandidates = data
      }
    }
  }

  // Score all candidates
  const scoredCandidates: Array<{
    task: any
    fuzzyScore: number
    semanticScore: number
    finalScore: number
  }> = []

  // Process semantic matches
  for (const match of semanticMatches) {
    const fuzzy = fuzzyScore(description, match.task.description)
    const semantic = match.similarity
    
    // Region boost
    let regionBoost = 1.0
    if (region && match.task.region === region) {
      regionBoost = 1.10
    }

    // Combine scores: 40% fuzzy + 50% semantic + 10% region boost
    const final = (0.4 * fuzzy + 0.5 * semantic) * regionBoost

    scoredCandidates.push({
      task: match.task,
      fuzzyScore: fuzzy,
      semanticScore: semantic,
      finalScore: Math.min(1, final) // Cap at 1.0
    })
  }

  // Process fuzzy candidates (if no semantic matches)
  if (scoredCandidates.length === 0 && fuzzyCandidates.length > 0) {
    for (const candidate of fuzzyCandidates) {
      const fuzzy = fuzzyScore(description, candidate.description)
      
      // Region boost
      let regionBoost = 1.0
      if (region && candidate.region === region) {
        regionBoost = 1.10
      }

      const final = fuzzy * regionBoost

      scoredCandidates.push({
        task: candidate,
        fuzzyScore: fuzzy,
        semanticScore: 0,
        finalScore: Math.min(1, final)
      })
    }
  }

  // Sort by final score descending
  scoredCandidates.sort((a, b) => b.finalScore - a.finalScore)

  // Return best match if score is above threshold
  if (scoredCandidates.length === 0) {
    return null
  }

  const best = scoredCandidates[0]

  // Determine match method
  let matchedVia: 'semantic' | 'fuzzy' | 'cost_code_only' = 'fuzzy'
  if (best.semanticScore > 0.5 && best.finalScore > 0.7) {
    matchedVia = 'semantic'
  } else if (best.finalScore > 0.3) {
    matchedVia = 'fuzzy'
  } else {
    matchedVia = 'cost_code_only'
  }

  return {
    task: best.task,
    confidence: Math.round(best.finalScore * 100), // Convert to 0-100
    matched_via: matchedVia
  }
}

