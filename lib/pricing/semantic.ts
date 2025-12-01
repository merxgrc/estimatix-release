/**
 * Semantic search using vector embeddings
 * Uses pgvector cosine similarity for fast similarity search
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables for semantic search')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

export interface SemanticMatch {
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
  similarity: number // 0-1, where 1 is most similar
}

/**
 * Perform semantic search using vector embeddings
 * @param queryEmbedding - The embedding vector to search for (1536 dimensions)
 * @param limit - Maximum number of results to return
 * @param costCode - Optional cost code filter
 * @param region - Optional region filter
 */
export async function semanticSearch(
  queryEmbedding: number[],
  limit: number = 5,
  costCode?: string | null,
  region?: string | null
): Promise<SemanticMatch[]> {
  if (!queryEmbedding || queryEmbedding.length !== 1536) {
    throw new Error('Invalid query embedding: must be 1536 dimensions')
  }

  // Build query with filters
  // Note: We fetch all matching tasks and calculate similarity in JS
  // For better performance with large datasets, consider using pgvector's <=> operator directly in SQL
  let query = supabase
    .from('task_library')
    .select('id, cost_code, description, unit, region, unit_cost_low, unit_cost_mid, unit_cost_high, labor_hours_per_unit, material_cost_per_unit, embedding')
    .not('embedding', 'is', null)
    .limit(100) // Limit to avoid fetching too many rows

  // Apply filters
  if (costCode) {
    query = query.eq('cost_code', costCode)
  }

  if (region) {
    query = query.or(`region.eq.${region},region.is.null`)
  }

  // Execute query
  const { data, error } = await query

  if (error) {
    throw new Error(`Semantic search failed: ${error.message}`)
  }

  if (!data || data.length === 0) {
    return []
  }

  // Calculate cosine similarity for each result
  const results: SemanticMatch[] = data
    .map((task: any) => {
      if (!task.embedding || !Array.isArray(task.embedding)) {
        return null
      }

      // Calculate cosine similarity: 1 - cosine_distance
      // cosine_distance = 1 - dot(a,b) / (||a|| * ||b||)
      const similarity = cosineSimilarity(queryEmbedding, task.embedding)

      return {
        task: {
          id: task.id,
          cost_code: task.cost_code,
          description: task.description,
          unit: task.unit,
          region: task.region,
          unit_cost_low: task.unit_cost_low,
          unit_cost_mid: task.unit_cost_mid,
          unit_cost_high: task.unit_cost_high,
          labor_hours_per_unit: task.labor_hours_per_unit,
          material_cost_per_unit: task.material_cost_per_unit,
        },
        similarity: Math.max(0, Math.min(1, similarity)) // Clamp to 0-1
      }
    })
    .filter((match): match is SemanticMatch => match !== null)
    .sort((a, b) => b.similarity - a.similarity) // Sort by similarity descending
    .slice(0, limit)

  return results
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

