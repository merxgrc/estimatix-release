/**
 * Deterministic Room Post-Processor
 *
 * Phase 1 requirements:
 * 1. Detect sheet level BEFORE creating rooms.
 * 2. Exact room counts — never merge, never reduce count below what plan shows.
 * 3. Contextual naming: "Bathroom 1 – Level 2" or "Master Bath – Level 1".
 * 4. Parse dimension strings into numeric length_ft / width_ft.
 * 5. Dedupe using sheet + label heuristics without losing real rooms.
 */

import type { ExtractedRoom } from './schemas'

// =============================================================================
// Types
// =============================================================================

export interface SheetInfo {
  pageNumber: number
  sheetTitle: string
  detectedLevel: string
  classification: string
  confidence: number
}

export interface SheetRoomResult {
  sheet: SheetInfo
  rooms: ExtractedRoom[]
}

// =============================================================================
// Level Detection
// =============================================================================

/**
 * Canonical level names used throughout the system.
 * All detected levels are mapped to one of these.
 */
export const CANONICAL_LEVELS = [
  'Basement',
  'Level 1',
  'Level 2',
  'Level 3',
  'Level 4',
  'Garage',
  'Attic',
  'Roof',
] as const

export type CanonicalLevel = typeof CANONICAL_LEVELS[number]

/**
 * Patterns to detect building level from sheet title or page text.
 * Order matters: more specific patterns first.
 */
const LEVEL_PATTERNS: Array<{ pattern: RegExp; level: CanonicalLevel }> = [
  // Basement variants
  { pattern: /\bbasement\b/i, level: 'Basement' },
  { pattern: /\blower\s*level\b/i, level: 'Basement' },
  { pattern: /\bcellar\b/i, level: 'Basement' },

  // Garage (before numbered levels — "Garage Level" is Garage, not Level N)
  { pattern: /\bgarage\b/i, level: 'Garage' },

  // Attic / Roof
  { pattern: /\battic\b/i, level: 'Attic' },
  { pattern: /\broof\s*(?:plan|level)?\b/i, level: 'Roof' },

  // Explicit "Level N"
  { pattern: /\blevel\s*4\b/i, level: 'Level 4' },
  { pattern: /\blevel\s*3\b/i, level: 'Level 3' },
  { pattern: /\blevel\s*2\b/i, level: 'Level 2' },
  { pattern: /\blevel\s*1\b/i, level: 'Level 1' },

  // Floor N variants
  { pattern: /\b(?:4th|fourth)\s*floor\b/i, level: 'Level 4' },
  { pattern: /\b(?:3rd|third)\s*floor\b/i, level: 'Level 3' },
  { pattern: /\b(?:2nd|second)\s*floor\b/i, level: 'Level 2' },
  { pattern: /\b(?:1st|first|ground)\s*floor\b/i, level: 'Level 1' },
  { pattern: /\bmain\s*(?:level|floor)\b/i, level: 'Level 1' },

  // "Upper" / "Lower" when no number
  { pattern: /\bupper\s*(?:level|floor|story)\b/i, level: 'Level 2' },
  { pattern: /\blower\s*(?:floor|story)\b/i, level: 'Level 1' },

  // Sheet naming conventions: A1-01 = Level 1, A2-01 = Level 2
  { pattern: /\bA-?1[-\s]/i, level: 'Level 1' },
  { pattern: /\bA-?2[-\s]/i, level: 'Level 2' },
  { pattern: /\bA-?3[-\s]/i, level: 'Level 3' },
]

/**
 * Detect the building level from a sheet title and/or page text.
 * Returns a canonical level name or 'Level 1' as default.
 */
export function detectLevelFromText(
  sheetTitle: string,
  pageText?: string
): CanonicalLevel {
  // Check sheet title first (highest priority)
  for (const { pattern, level } of LEVEL_PATTERNS) {
    if (pattern.test(sheetTitle)) {
      return level
    }
  }

  // Check page text (first ~500 chars — level usually appears near top)
  if (pageText) {
    const headerText = pageText.slice(0, 500)
    for (const { pattern, level } of LEVEL_PATTERNS) {
      if (pattern.test(headerText)) {
        return level
      }
    }
  }

  return 'Level 1'
}

/**
 * Extract a sheet title from page text heuristics.
 * Construction plan pages typically have a title block in the first few lines.
 */
export function extractSheetTitle(pageText: string): string {
  const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean)

  // Look for lines that contain typical sheet title patterns
  for (const line of lines.slice(0, 15)) {
    // "FIRST FLOOR PLAN", "LEVEL 1 FLOOR PLAN", "A1-01 FLOOR PLAN", etc.
    if (/(?:floor\s*plan|level\s*\d|basement|garage|attic)/i.test(line)) {
      return line.slice(0, 100)
    }
  }

  // Fall back to the first non-trivial line
  for (const line of lines.slice(0, 5)) {
    if (line.length > 5 && line.length < 120) {
      return line
    }
  }

  return 'Untitled Sheet'
}

// =============================================================================
// Dimension Parsing
// =============================================================================

/**
 * Parse a dimension string into numeric feet values.
 *
 * Handles formats:
 *   "12'-0\" x 14'-6\""  → { length: 12, width: 14.5 }
 *   "12' x 14'"          → { length: 12, width: 14 }
 *   "12x14"              → { length: 12, width: 14 }
 *   "12'-6\" x 14'-0\""  → { length: 12.5, width: 14 }
 *   "12.5 x 14.5"        → { length: 12.5, width: 14.5 }
 *   "12'6\" x 14'3\""    → { length: 12.5, width: 14.25 }
 */
export function parseDimensions(
  dimString: string | null | undefined
): { length_ft: number; width_ft: number } | null {
  if (!dimString) return null

  // Normalize: remove special chars, normalize quotes
  const cleaned = dimString
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")  // smart quotes
    .replace(/\u2033/g, '"')  // double prime
    .replace(/\u2032/g, "'")  // prime
    .replace(/\s+/g, ' ')
    .trim()

  // Pattern: feet-inches format  "12'-6" x 14'-0""  or  "12'6" x 14'3""
  const feetInchesPattern = /(\d+)['\u2032][-\s]?(\d+)?["\u2033]?\s*[xX×]\s*(\d+)['\u2032][-\s]?(\d+)?["\u2033]?/
  const feetInchesMatch = cleaned.match(feetInchesPattern)
  if (feetInchesMatch) {
    const ft1 = parseInt(feetInchesMatch[1], 10)
    const in1 = feetInchesMatch[2] ? parseInt(feetInchesMatch[2], 10) : 0
    const ft2 = parseInt(feetInchesMatch[3], 10)
    const in2 = feetInchesMatch[4] ? parseInt(feetInchesMatch[4], 10) : 0
    return {
      length_ft: round2(ft1 + in1 / 12),
      width_ft: round2(ft2 + in2 / 12),
    }
  }

  // Pattern: feet only  "12' x 14'"  or  "12 x 14"
  const feetOnlyPattern = /(\d+(?:\.\d+)?)['\s]*[xX×]\s*(\d+(?:\.\d+)?)['\s]*/
  const feetOnlyMatch = cleaned.match(feetOnlyPattern)
  if (feetOnlyMatch) {
    return {
      length_ft: round2(parseFloat(feetOnlyMatch[1])),
      width_ft: round2(parseFloat(feetOnlyMatch[2])),
    }
  }

  return null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// =============================================================================
// Deterministic Room Naming
// =============================================================================

/**
 * Apply deterministic naming to extracted rooms.
 *
 * Rules:
 * 1. If AI gave a clearly unique name (e.g. "Master Bedroom", "Kitchen"),
 *    keep it and append " – Level N".
 * 2. If name is generic or duplicated within a level (e.g. "Bathroom",
 *    "Bedroom"), number them: "Bathroom 1 – Level 2", "Bathroom 2 – Level 2".
 * 3. NEVER reduce room count. Numbering ensures distinct names.
 */
export function applyDeterministicNames(
  rooms: ExtractedRoom[],
  level: string
): ExtractedRoom[] {
  if (rooms.length === 0) return []

  // Count occurrences of each base name (without existing numbers/suffixes)
  const baseNameCounts = new Map<string, number>()

  for (const room of rooms) {
    const base = extractBaseName(room.name)
    baseNameCounts.set(base, (baseNameCounts.get(base) || 0) + 1)
  }

  // Track counters for numbering
  const nameCounters = new Map<string, number>()

  return rooms.map(room => {
    const base = extractBaseName(room.name)
    const occurrences = baseNameCounts.get(base) || 1

    let displayName: string

    if (occurrences === 1) {
      // Unique name — use as-is (but strip trailing numbers if AI added them)
      displayName = cleanRoomName(room.name)
    } else {
      // Multiple rooms with same base — number them
      const counter = (nameCounters.get(base) || 0) + 1
      nameCounters.set(base, counter)
      displayName = `${cleanRoomName(base)} ${counter}`
    }

    // Store name WITHOUT level suffix — level is in the separate `level` field.
    // UI renders as "${name} — ${level}".
    return {
      ...room,
      name: displayName,
      level,
    }
  })
}

/**
 * Extract the base name for grouping purposes.
 * "Bathroom 1" → "Bathroom"
 * "Master Bedroom" → "Master Bedroom"
 * "Bedroom 3" → "Bedroom"
 * "Walk-in Closet" → "Walk-in Closet"
 */
function extractBaseName(name: string): string {
  // Remove trailing numbers and common separators
  return name
    .replace(/\s*[-–—]\s*Level\s*\d+/i, '')  // Remove existing level suffix
    .replace(/\s*[-–—]\s*(?:Basement|Garage|Attic|Roof)/i, '')
    .replace(/\s+\d+\s*$/, '')  // Remove trailing number like "Bathroom 1"
    .replace(/\s*#\d+\s*$/, '') // Remove trailing "#1"
    .trim()
}

/**
 * Clean up a room name: expand abbreviations, fix casing.
 */
function cleanRoomName(name: string): string {
  // Strip any existing level suffix the AI may have included in the name
  // e.g. "Office – Level 2" → "Office", "Kitchen - Basement" → "Kitchen"
  let cleaned = name
    .replace(/\s*[-–—]\s*Level\s*\d+/i, '')
    .replace(/\s*[-–—]\s*(?:Basement|Garage|Attic|Roof)/i, '')
    .trim()

  // Expand common abbreviations
  const abbreviations: Record<string, string> = {
    'mbr': 'Master Bedroom',
    'mba': 'Master Bathroom',
    'mbath': 'Master Bathroom',
    'br': 'Bedroom',
    'ba': 'Bathroom',
    'kit': 'Kitchen',
    'lr': 'Living Room',
    'dr': 'Dining Room',
    'fr': 'Family Room',
    'gr': 'Great Room',
    'gar': 'Garage',
    'lndry': 'Laundry',
    'util': 'Utility',
    'mech': 'Mechanical',
    'wic': 'Walk-in Closet',
    'pwdr': 'Powder Room',
    'foy': 'Foyer',
    'pnt': 'Pantry',
    'mud': 'Mudroom',
  }

  const lower = cleaned.toLowerCase().trim()
  // Check for exact abbreviation match
  if (abbreviations[lower]) {
    return abbreviations[lower]
  }

  // Check for abbreviation with number: "BR1" → "Bedroom"
  const abbrMatch = lower.match(/^([a-z]+)\s*(\d+)?$/)
  if (abbrMatch && abbreviations[abbrMatch[1]]) {
    return abbreviations[abbrMatch[1]]
  }

  // Title-case the name
  return cleaned
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim()
}

// =============================================================================
// Cross-Sheet Deduplication
// =============================================================================

/**
 * Deduplicate rooms across sheets while NEVER reducing count
 * below what any single sheet indicates.
 *
 * Strategy:
 * - Group rooms by level.
 * - Within a level, rooms from the SAME sheet are trusted (never deduped).
 * - Rooms from DIFFERENT sheets with identical name+level are deduped
 *   (they're the same room seen on overlapping pages).
 * - But: if two sheets both show "Bathroom 1 – Level 2", keep only one.
 */
export function deduplicateAcrossSheets(
  sheetResults: SheetRoomResult[]
): ExtractedRoom[] {
  // Track rooms by level → name → best confidence room
  const roomsByLevelName = new Map<string, ExtractedRoom>()

  for (const { rooms } of sheetResults) {
    for (const room of rooms) {
      const key = `${room.level}::${room.name.toLowerCase().trim()}`
      const existing = roomsByLevelName.get(key)

      if (!existing || (room.confidence ?? 0) > (existing.confidence ?? 0)) {
        roomsByLevelName.set(key, room)
      }
    }
  }

  return Array.from(roomsByLevelName.values())
}

// =============================================================================
// Full Post-Processing Pipeline
// =============================================================================

/**
 * Process raw AI-extracted rooms through the deterministic pipeline.
 *
 * Input:  Raw rooms from AI (may have inconsistent names, no levels)
 * Output: Deterministic rooms with levels, numbered names, parsed dimensions
 */
export function postProcessRooms(
  rawRooms: ExtractedRoom[],
  level: string
): ExtractedRoom[] {
  // Step 1: Parse dimensions → fill in length_ft / width_ft
  const withDimensions = rawRooms.map(room => {
    const parsed = parseDimensions(room.dimensions)
    return {
      ...room,
      level,
      length_ft: room.length_ft ?? parsed?.length_ft ?? null,
      width_ft: room.width_ft ?? parsed?.width_ft ?? null,
    }
  })

  // Step 2: Apply deterministic naming
  const named = applyDeterministicNames(withDimensions, level)

  return named
}
