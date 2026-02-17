/**
 * Zod Schemas for Plan Parsing Pipeline
 * 
 * Phase 1: Blueprint/Plan Parsing
 * - Pass 1: Page Classification (Document Map)
 * - Pass 2: Deep Room Extraction
 * 
 * IMPORTANT: NO PRICING FIELDS - any pricing from AI is ignored
 */

import { z } from 'zod'

// =============================================================================
// Page Classification Types (Pass 1)
// =============================================================================

/**
 * Page types for classification
 */
export const PageTypeSchema = z.enum([
  'cover',           // Title sheet, project info
  'index',           // Table of contents, drawing index
  'floor_plan',      // Floor plan with room layouts
  'room_schedule',   // Room finish schedule, door schedule
  'finish_schedule', // Finish/material schedules
  'notes',           // General notes, specifications
  'specs',           // Written specifications
  'elevation',       // Building elevations
  'section',         // Building sections
  'detail',          // Construction details
  'electrical',      // Electrical plans
  'plumbing',        // Plumbing plans
  'mechanical',      // HVAC/mechanical plans
  'site_plan',       // Site/plot plan
  'irrelevant',      // Cover letters, signatures, etc.
  'other'            // Unclassified
])

export type PageType = z.infer<typeof PageTypeSchema>

/**
 * Pass 1 Output: Page Classification Result
 */
export const PageClassificationSchema = z.object({
  pageNumber: z.number().int().positive(),
  type: PageTypeSchema,
  confidence: z.number().min(0).max(100),
  hasRoomLabels: z.boolean(),
  reason: z.string().max(100).optional(),
})

export type PageClassification = z.infer<typeof PageClassificationSchema>

/**
 * Pass 1 Complete Output
 */
export const Pass1OutputSchema = z.object({
  pages: z.array(PageClassificationSchema),
  totalPages: z.number().int().nonnegative(),
  summary: z.string().optional(),
})

export type Pass1Output = z.infer<typeof Pass1OutputSchema>

// =============================================================================
// Room Extraction Types (Pass 2)
// =============================================================================

/**
 * Room type enumeration
 */
export const RoomTypeSchema = z.enum([
  'bedroom',
  'bathroom',
  'kitchen',
  'living',
  'dining',
  'garage',
  'closet',
  'utility',
  'laundry',
  'hallway',
  'foyer',
  'office',
  'basement',
  'attic',
  'deck',
  'patio',
  'porch',
  'mudroom',
  'pantry',
  'storage',
  'mechanical',
  'other'
])

export type RoomType = z.infer<typeof RoomTypeSchema>

/**
 * Extracted room from Pass 2
 * Now includes level and parsed dimension fields for Phase 1
 */
export const ExtractedRoomSchema = z.object({
  name: z.string().min(1).max(100),
  level: z.string().max(50).nullable().optional(),  // NULL = unknown; set by room-processor from sheet
  type: RoomTypeSchema.nullable().optional(),
  area_sqft: z.number().positive().nullable().optional(),
  length_ft: z.number().positive().nullable().optional(),
  width_ft: z.number().positive().nullable().optional(),
  ceiling_height_ft: z.number().positive().nullable().optional(),
  dimensions: z.string().max(50).nullable().optional(), // Raw dimension string from plans
  notes: z.string().max(500).nullable().optional(),
  confidence: z.number().min(0).max(100).default(50),
  sheet_label: z.string().max(200).nullable().optional(), // Original sheet title for provenance
})

export type ExtractedRoom = z.infer<typeof ExtractedRoomSchema>

/**
 * Suggested line item scaffold (NO PRICING)
 */
export const LineItemScaffoldSchema = z.object({
  description: z.string().min(1).max(200),
  category: z.string().max(50).default('Other'),
  cost_code: z.string().max(10).nullable().optional(),
  room_name: z.string().min(1).max(100),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  // EXPLICITLY NO PRICING - these are always null
})

export type LineItemScaffold = z.infer<typeof LineItemScaffoldSchema>

/**
 * Pass 2 Complete Output
 */
export const Pass2OutputSchema = z.object({
  rooms: z.array(ExtractedRoomSchema),
  lineItems: z.array(LineItemScaffoldSchema).optional(),
  assumptions: z.array(z.string().max(200)),
  missingInfo: z.array(z.string().max(200)),
  warnings: z.array(z.string().max(200)),
})

export type Pass2Output = z.infer<typeof Pass2OutputSchema>

// =============================================================================
// Sheet-Level Parse Result (Phase 1 deterministic pipeline)
// =============================================================================

/**
 * Per-sheet parse result: rooms extracted from a single floor plan sheet.
 */
export const SheetParseResultSchema = z.object({
  sheet_id: z.number().int().positive().describe('Page number in PDF'),
  sheet_title: z.string().max(200),
  detected_level: z.string().max(50),
  classification: z.string().max(30),
  confidence: z.number().min(0).max(100),
  rooms: z.array(ExtractedRoomSchema),
})

export type SheetParseResult = z.infer<typeof SheetParseResultSchema>

/**
 * Complete parse output with per-sheet structure.
 */
export const StructuredParseOutputSchema = z.object({
  sheets: z.array(SheetParseResultSchema),
  all_rooms: z.array(ExtractedRoomSchema),
  all_line_items: z.array(LineItemScaffoldSchema).optional(),
  assumptions: z.array(z.string().max(200)),
  missingInfo: z.array(z.string().max(200)),
  warnings: z.array(z.string().max(200)),
})

export type StructuredParseOutput = z.infer<typeof StructuredParseOutputSchema>

// =============================================================================
// API Request/Response Schemas
// =============================================================================

/**
 * Parse request schema
 */
export const ParseRequestSchema = z.object({
  projectId: z.string().uuid(),
  estimateId: z.string().uuid().optional(),
  fileUrls: z.array(z.string()).min(1).max(10),
  uploadId: z.string().uuid().optional(),
  uploadIds: z.array(z.string().uuid()).optional(), // Fallback: resolve file URLs server-side
  resolveFromProject: z.boolean().optional(), // If true, resolve file URLs from project's blueprint uploads
})

export type ParseRequest = z.infer<typeof ParseRequestSchema>

/**
 * Complete parse response schema
 */
export const ParseResponseSchema = z.object({
  success: z.boolean(),
  planParseId: z.string().uuid().nullable().optional(),
  rooms: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    level: z.string().default('Level 1'),
    type: z.string().nullable().optional(),
    area_sqft: z.number().nullable().optional(),
    length_ft: z.number().nullable().optional(),
    width_ft: z.number().nullable().optional(),
    ceiling_height_ft: z.number().nullable().optional(),
    dimensions: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    confidence: z.number().optional(),
    is_included: z.boolean().default(true),
  })),
  lineItemScaffold: z.array(z.object({
    id: z.string().uuid(),
    description: z.string(),
    category: z.string(),
    cost_code: z.string().nullable().optional(),
    room_name: z.string(),
    quantity: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    // NO pricing fields
    direct_cost: z.null(),
    client_price: z.null(),
  })),
  /** Per-sheet structured output (Phase 1 deterministic pipeline) */
  sheets: z.array(SheetParseResultSchema).optional(),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
  pageClassifications: z.array(PageClassificationSchema),
  totalPages: z.number().int().nonnegative(),
  relevantPages: z.array(z.number().int().positive()),
  processingTimeMs: z.number().nonnegative(),
})

export type ParseResponse = z.infer<typeof ParseResponseSchema>

// =============================================================================
// Fallback / Default Values
// =============================================================================

/**
 * Default fallback room when parsing fails completely
 */
export const FALLBACK_ROOM: ExtractedRoom = {
  name: 'General / Scope Notes',
  level: 'Level 1',
  type: 'other',
  area_sqft: null,
  length_ft: null,
  width_ft: null,
  ceiling_height_ft: null,
  dimensions: null,
  notes: 'We couldn\'t detect specific rooms from your plans. You can rename this room and add line items manually, or try uploading clearer floor plan pages.',
  confidence: 0,
}

/**
 * Default line items for fallback room
 */
export const FALLBACK_LINE_ITEMS: LineItemScaffold[] = [
  {
    description: 'General scope item - add details',
    category: 'General',
    cost_code: '999',
    room_name: 'General / Scope Notes',
    quantity: 1,
    unit: 'LS',
    notes: 'Placeholder item - update with actual scope',
  },
]

/**
 * Create a safe fallback response when parsing completely fails
 * Returns user-friendly messaging with actionable next steps
 */
export function createFallbackResponse(
  error: string,
  totalPages: number = 0,
  planParseId?: string | null
): ParseResponse {
  // Convert technical errors to user-friendly messages
  const userFriendlyError = getUserFriendlyParseError(error)
  
  return {
    success: false,
    planParseId: planParseId || null,
    rooms: [{
      id: crypto.randomUUID?.() || 'fallback-room-id',
      name: FALLBACK_ROOM.name,
      level: FALLBACK_ROOM.level ?? 'Level 1',
      type: FALLBACK_ROOM.type,
      area_sqft: FALLBACK_ROOM.area_sqft,
      dimensions: FALLBACK_ROOM.dimensions,
      notes: FALLBACK_ROOM.notes,
      confidence: FALLBACK_ROOM.confidence,
      is_included: true,
    }],
    lineItemScaffold: FALLBACK_LINE_ITEMS.map(li => ({
      id: crypto.randomUUID?.() || 'fallback-item-id',
      description: li.description,
      category: li.category,
      cost_code: li.cost_code || null,
      room_name: li.room_name,
      quantity: li.quantity || null,
      unit: li.unit || null,
      notes: li.notes || null,
      direct_cost: null,
      client_price: null,
    })),
    assumptions: [
      'Created a general room for you to use',
      'Add specific rooms manually or re-upload clearer floor plan pages',
    ],
    warnings: [userFriendlyError],
    pageClassifications: [],
    totalPages,
    relevantPages: [],
    processingTimeMs: 0,
  }
}

/**
 * Convert technical error messages to user-friendly messages
 */
function getUserFriendlyParseError(error: string): string {
  const lowerError = error.toLowerCase()
  
  if (lowerError.includes('openai') || lowerError.includes('api key')) {
    return 'AI analysis service is temporarily unavailable. You can add rooms manually while we fix this.'
  }
  if (lowerError.includes('scanned') || lowerError.includes('image-only')) {
    return 'This appears to be a scanned document. For best results, try uploading individual floor plan images.'
  }
  if (lowerError.includes('no rooms') || lowerError.includes('could not extract')) {
    return 'We couldn\'t identify specific rooms in this document. Try uploading individual floor plan pages.'
  }
  if (lowerError.includes('corrupted') || lowerError.includes('invalid') || lowerError.includes('failed to parse')) {
    return 'This file couldn\'t be read properly. Try re-saving the PDF or uploading a different version.'
  }
  if (lowerError.includes('timeout') || lowerError.includes('too long')) {
    return 'Processing took too long. Try uploading fewer pages at once.'
  }
  if (lowerError.includes('authentication') || lowerError.includes('unauthorized')) {
    return 'Please sign in again to use this feature.'
  }
  
  // Default: return original but without stack traces
  return error.split('\n')[0].slice(0, 200)
}

// =============================================================================
// Page Type Helpers
// =============================================================================

/**
 * Page types that are relevant for room extraction
 */
export const ROOM_RELEVANT_PAGE_TYPES: PageType[] = [
  'floor_plan',
  'room_schedule',
  'finish_schedule',
]

/**
 * Page types that may contain useful scope information
 */
export const SCOPE_RELEVANT_PAGE_TYPES: PageType[] = [
  'floor_plan',
  'room_schedule',
  'finish_schedule',
  'notes',
  'specs',
]

/**
 * Check if a page type is relevant for room extraction
 */
export function isRoomRelevantPage(type: PageType): boolean {
  return ROOM_RELEVANT_PAGE_TYPES.includes(type)
}

/**
 * Check if a page type is relevant for scope
 */
export function isScopeRelevantPage(type: PageType): boolean {
  return SCOPE_RELEVANT_PAGE_TYPES.includes(type)
}
