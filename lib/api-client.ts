/**
 * API Client for Estimatix 2.0
 * Handles communication with server-side AI routes
 */

import type { AIAction } from '@/types/estimate'

/**
 * Response format from the Copilot API
 */
export interface CopilotResponse {
  response_text: string
  actions: Array<{
    type: 'add_line_item' | 'update_line_item' | 'delete_line_item' | 'info'
    data: Record<string, any>
  }>
  executedActions?: Array<{
    type: string
    success: boolean
    id?: string
    error?: string
  }>
}

/**
 * Request parameters for parseEstimateRequest
 */
export interface ParseEstimateRequestParams {
  message: string
  projectId: string
  currentLineItems?: Array<{
    id: string
    description?: string
    category?: string
    cost_code?: string | null
    room_name?: string | null
    quantity?: number | null
    unit?: string | null
  }>
  fileUrls?: string[]
}

/**
 * Parse an estimate request by sending it to the server-side Copilot API
 * This replaces any client-side Gemini SDK calls
 * 
 * @param params - Request parameters
 * @returns Promise resolving to the Copilot response
 */
export async function parseEstimateRequest(
  params: ParseEstimateRequestParams
): Promise<CopilotResponse> {
  const { message, projectId, currentLineItems = [], fileUrls = [] } = params

  // Build the request body to match the API route's expected format
  const body: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    projectId: string
    currentLineItems: typeof currentLineItems
    fileUrls?: string[]
  } = {
    messages: [
      {
        role: 'user',
        content: message
      }
    ],
    projectId,
    currentLineItems,
    fileUrls
  }

  // Make request to server-side API route
  const response = await fetch('/api/ai/copilot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    let errorMessage = 'Failed to parse estimate request'
    try {
      const errorData = await response.json()
      errorMessage = errorData.error || errorMessage
    } catch {
      errorMessage = `Server error: ${response.status} ${response.statusText}`
    }
    throw new Error(errorMessage)
  }

  const data = await response.json()
  
  // Validate response structure
  if (!data.response_text || !Array.isArray(data.actions)) {
    throw new Error('Invalid response format from Copilot API')
  }

  return {
    response_text: data.response_text,
    actions: data.actions
  }
}

