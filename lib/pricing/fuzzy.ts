/**
 * Fuzzy string matching using a simple character-based similarity algorithm
 * Returns a score between 0 and 1, where 1 is an exact match
 */

export function fuzzyScore(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const s1 = a.toLowerCase().trim()
  const s2 = b.toLowerCase().trim()

  // Exact match after normalization
  if (s1 === s2) return 1

  // Calculate character overlap
  const chars1 = new Set(s1)
  const chars2 = new Set(s2)
  
  let intersection = 0
  for (const char of chars1) {
    if (chars2.has(char)) {
      intersection++
    }
  }

  const union = chars1.size + chars2.size - intersection
  const jaccard = union > 0 ? intersection / union : 0

  // Calculate substring similarity (longest common substring)
  const lcs = longestCommonSubstring(s1, s2)
  const lcsScore = lcs / Math.max(s1.length, s2.length)

  // Calculate word overlap
  const words1 = s1.split(/\s+/).filter(w => w.length > 2)
  const words2 = s2.split(/\s+/).filter(w => w.length > 2)
  
  let commonWords = 0
  const words2Set = new Set(words2)
  for (const word of words1) {
    if (words2Set.has(word)) {
      commonWords++
    }
  }
  
  const wordScore = words1.length > 0 && words2.length > 0
    ? commonWords / Math.max(words1.length, words2.length)
    : 0

  // Combine scores (weighted average)
  // Jaccard: 0.3, LCS: 0.4, Word overlap: 0.3
  const combined = jaccard * 0.3 + lcsScore * 0.4 + wordScore * 0.3

  return Math.min(1, Math.max(0, combined))
}

/**
 * Find the length of the longest common substring
 */
function longestCommonSubstring(s1: string, s2: string): number {
  const m = s1.length
  const n = s2.length
  let maxLen = 0

  // Simple O(m*n) approach
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let len = 0
      while (i + len < m && j + len < n && s1[i + len] === s2[j + len]) {
        len++
      }
      maxLen = Math.max(maxLen, len)
    }
  }

  return maxLen
}









