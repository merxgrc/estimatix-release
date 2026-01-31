'use client'

import { useParams } from 'next/navigation'
import { FilesTab } from '@/components/files/FilesTab'
import { useSidebar } from '@/lib/sidebar-context'

export default function FilesPage() {
  const params = useParams()
  const projectId = params.id as string
  const { setIsCopilotOpen } = useSidebar()

  const handleUseInCopilot = (fileUrl: string, fileName: string) => {
    // Open copilot if closed
    setIsCopilotOpen(true)
    
    // Dispatch event to set the message in copilot
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('copilot-file-attach', {
        detail: {
          message: `Analyze this file: ${fileName}`,
          fileUrl: fileUrl
        }
      }))
    }, 300) // Small delay to ensure copilot is open
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Files</h1>
        <p className="text-muted-foreground">Manage project files, blueprints, photos, and documents</p>
      </div>
      <FilesTab projectId={projectId} onUseInCopilot={handleUseInCopilot} />
    </div>
  )
}





