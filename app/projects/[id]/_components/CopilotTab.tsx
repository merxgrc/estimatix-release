'use client'

import { useState, useEffect } from 'react'
import { CopilotChat } from '@/components/copilot/CopilotChat'
import { parseEstimateRequest } from '@/lib/api-client'
import { db } from '@/lib/db-client'
import { supabase } from '@/lib/supabase/client'
import { toast } from 'sonner'
import type { Project, Estimate } from '@/types/db'

interface CopilotTabProps {
  project: Project
  projectId: string
  estimates: Estimate[]
  activeEstimateId: string | null
  onEstimateUpdate: () => void
}

export function CopilotTab({
  project,
  projectId,
  estimates,
  activeEstimateId,
  onEstimateUpdate
}: CopilotTabProps) {
  const [currentLineItems, setCurrentLineItems] = useState<Array<{
    id: string
    description?: string
    category?: string
    cost_code?: string | null
    room_name?: string | null
    quantity?: number | null
    unit?: string | null
  }>>([])

  // Load current line items from the active estimate
  useEffect(() => {
    const loadLineItems = async () => {
      if (activeEstimateId) {
        try {
          const { data, error } = await supabase
            .from('estimate_line_items')
            .select('id, description, category, cost_code, room_name, quantity, unit')
            .eq('estimate_id', activeEstimateId)
            .order('created_at', { ascending: true })

          if (error) {
            console.error('Error loading line items:', error)
            return
          }

          if (data) {
            setCurrentLineItems(data.map(item => ({
              id: item.id,
              description: item.description || undefined,
              category: item.category || undefined,
              cost_code: item.cost_code,
              room_name: item.room_name,
              quantity: item.quantity,
              unit: item.unit
            })))
          }
        } catch (err) {
          console.error('Error in loadLineItems:', err)
        }
      } else {
        setCurrentLineItems([])
      }
    }

    loadLineItems()
  }, [activeEstimateId])

  const handleSendMessage = async (content: string, fileUrls?: string[]): Promise<{ response_text: string; actions?: any[] } | undefined> => {
    try {
      // Call the copilot API
      const response = await parseEstimateRequest({
        message: content,
        projectId,
        currentLineItems,
        fileUrls: fileUrls || []
      })

      // Check if any actions were executed successfully
      if (response.executedActions && response.executedActions.length > 0) {
        const successfulActions = response.executedActions.filter(a => a.success)
        if (successfulActions.length > 0) {
          // Refresh estimates and line items
          onEstimateUpdate()
          
          // Show success message
          const actionTypes = successfulActions.map(a => a.type).join(', ')
          toast.success(`Copilot executed: ${actionTypes}`)
        }
      }

      // The CopilotChat component will handle displaying the response
      // by loading messages from the database
      return undefined
    } catch (error) {
      console.error('Error sending message to copilot:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to send message to copilot')
      throw error
    }
  }

  return (
    <div className="h-[calc(100vh-200px)]">
      <CopilotChat
        projectId={projectId}
        onSendMessage={handleSendMessage}
      />
    </div>
  )
}



