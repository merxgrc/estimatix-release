'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserMenu } from "@/components/user-menu"
import { AuthGuard } from "@/components/auth-guard"
import { useAuth } from "@/lib/auth-context"
import { db } from "@/lib/db-client"
import { EditableProjectTitle } from "@/components/editable-project-title"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SummaryTab } from "./_components/SummaryTab"
import { EstimateTab } from "./_components/EstimateTab"
// Phase 1: PricingTab removed per PHASE_1_RELEASE_CHECKLIST.md
import { RoomsTab } from "./_components/RoomsTab"
import { FilesTab } from "@/components/files/FilesTab"
import { SpecSheetsTab } from "./_components/SpecSheetsTab"
// Phase 1: SelectionsTab removed per PHASE_1_RELEASE_CHECKLIST.md
import { ProposalsTab } from "./_components/ProposalsTab"
import { ContractsTab } from "./_components/ContractsTab"
import { ManageTab } from "./_components/ManageTab"
import type { Project, Estimate, Upload, Profile } from "@/types/db"
import { ArrowLeft, Trash2, MessageSquare, Download, FileDown, FileText } from "lucide-react"
import { toast } from 'sonner'
import { supabase } from "@/lib/supabase/client"
import { useSidebar } from "@/lib/sidebar-context"
import { CopilotChat } from "@/components/copilot/CopilotChat"
import { Drawer, DrawerContent } from "@/components/ui/sheet"
import { CloseJobModal } from "@/components/projects/CloseJobModal"

export default function ProjectDetailPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const { sidebarWidth, isCollapsed } = useSidebar()
  const projectId = params.id as string

  // Validate that projectId is a valid UUID (not "new" or other invalid values)
  useEffect(() => {
    // Check if projectId is "new" - redirect to the new project page
    if (projectId === 'new') {
      router.push('/projects/new')
      return
    }

    // Basic UUID validation (UUIDs are 36 characters with dashes)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (projectId && !uuidRegex.test(projectId)) {
      console.error('Invalid project ID format:', projectId)
      setError('Invalid project ID')
      setIsLoading(false)
      router.push('/projects')
      return
    }
  }, [projectId, router])

  const [project, setProject] = useState<Project | null>(null)
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [photos, setPhotos] = useState<{ url: string; id: string }[]>([])
  const [documents, setDocuments] = useState<{ url: string; name: string; id: string }[]>([])
  const [estimatorProfile, setEstimatorProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeEstimateId, setActiveEstimateId] = useState<string | null>(null)
  const [deletingProject, setDeletingProject] = useState(false)
  const [deletingEstimateId, setDeletingEstimateId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("summary")
  const [isCopilotOpen, setIsCopilotOpen] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isCloseJobModalOpen, setIsCloseJobModalOpen] = useState(false)
  const [recentActions, setRecentActions] = useState<any[]>([])
  const recentActionsRef = useRef<any[]>([])
  
  // Keep ref in sync with state
  useEffect(() => {
    recentActionsRef.current = recentActions
  }, [recentActions])

  // Handle URL query params for tab and roomId
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab) {
      setActiveTab(tab)
    }
  }, [searchParams])

  useEffect(() => {
    const fetchProjectData = async () => {
      if (!projectId || !user) {
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        // Fetch project, estimates, and uploads in parallel
        // Use Promise.allSettled to handle individual failures gracefully
        const [projectResult, estimatesResult, uploadsResult] = await Promise.allSettled([
          db.getProject(projectId),
          db.getEstimates(projectId),
          db.getUploads(projectId)
        ])

        // Handle project fetch result
        if (projectResult.status === 'rejected') {
          console.error('Error fetching project:', projectResult.reason)
          throw projectResult.reason
        }

        const projectData = projectResult.value
        if (!projectData) {
          setError('Project not found')
          return
        }

        // Handle estimates fetch result
        if (estimatesResult.status === 'rejected') {
          console.error('Error fetching estimates:', estimatesResult.reason)
          // If project exists but estimates fail, still show the project
          // but log the error and set empty estimates
          setProject(projectData)
          setEstimates([])
          console.warn('Could not load estimates, but project loaded successfully')
          return
        }

        const estimatesData = estimatesResult.value
        
        // Handle uploads fetch result
        let uploadsData: Upload[] = []
        if (uploadsResult.status === 'fulfilled') {
          uploadsData = uploadsResult.value
        } else {
          console.warn('Error fetching uploads:', uploadsResult.reason)
        }

        setProject(projectData)
        setEstimates(estimatesData)
        
        // Separate photos and documents from uploads
        const photosData = uploadsData
          .filter(u => u.kind === 'photo')
          .map(u => ({ url: u.file_url, id: u.id }))
        
        const documentsData = uploadsData
          .filter(u => u.kind === 'blueprint')
          .map(u => {
            // Get original filename from database if available, otherwise extract from URL
            const originalFilename = (u as any).original_filename
            let filename = originalFilename
            
            if (!filename) {
              // Fallback: try to extract from URL
              const urlParts = u.file_url.split('/')
              filename = urlParts[urlParts.length - 1] || 'Document'
            }
            
            return { url: u.file_url, name: filename, id: u.id }
          })
        
        setPhotos(photosData)
        setDocuments(documentsData)
        
        // Fetch estimator profile using client-side Supabase
        if (projectData.user_id) {
          try {
            const { data: profile, error } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', projectData.user_id)
              .single()
            
            if (!error && profile) {
              setEstimatorProfile(profile)
            }
          } catch (err) {
            console.warn('Could not load estimator profile:', err)
          }
        }
        
        // Set the most recent estimate as active if any exist
        if (estimatesData.length > 0) {
          setActiveEstimateId(estimatesData[0].id)
        }
      } catch (err) {
        console.error('Error fetching project data:', err)
        
        // Handle Supabase errors and standard errors
        let errorMessage = 'Failed to load project'
        if (err instanceof Error) {
          errorMessage = err.message
        } else if (err && typeof err === 'object') {
          // Handle Supabase PostgrestError
          if ('message' in err && typeof err.message === 'string') {
            errorMessage = err.message
          } else if ('error' in err && typeof err.error === 'string') {
            errorMessage = err.error
          } else if ('code' in err) {
            errorMessage = `Database error: ${err.code || 'Unknown error'}`
          }
        }
        
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProjectData()
  }, [projectId, user])

  // Create a stable function to fetch estimates only (for event listener)
  const fetchEstimates = useCallback(async () => {
    if (!projectId) return
    
    try {
      console.log('[ProjectPage] Refreshing estimates...')
      const estimatesData = await db.getEstimates(projectId)
      setEstimates(estimatesData)
      
      // If no active estimate is set but estimates now exist, select the first one
      // This handles the case where a blueprint parse auto-created an estimate
      setActiveEstimateId(prev => {
        if (!prev && estimatesData.length > 0) {
          console.log('[ProjectPage] Auto-selecting newly created estimate:', estimatesData[0].id)
          return estimatesData[0].id
        }
        return prev
      })
      
      console.log('[ProjectPage] Estimates refreshed:', estimatesData.length, 'estimates')
    } catch (err) {
      console.error('[ProjectPage] Error fetching estimates:', err)
    }
  }, [projectId])

  // Listen for estimate-updated event from Copilot
  useEffect(() => {
    const handleEstimateUpdate = () => {
      fetchEstimates()
    }

    window.addEventListener('estimate-updated', handleEstimateUpdate)
    return () => {
      window.removeEventListener('estimate-updated', handleEstimateUpdate)
    }
  }, [fetchEstimates])

  const handleEstimateSave = (estimateId: string, total: number) => {
    // Refresh estimates list
    db.getEstimates(projectId).then(setEstimates).catch(console.error)
  }

  const handleDeleteProject = async () => {
    if (!project) return
    
    if (!confirm(`Are you sure you want to delete "${project.title}"? This will also delete all estimates associated with this project. This action cannot be undone.`)) {
      return
    }

    setDeletingProject(true)
    try {
      await db.deleteProject(projectId)
      router.push('/projects')
    } catch (err) {
      console.error('Error deleting project:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete project'
      alert(`Error: ${errorMessage}`)
      setDeletingProject(false)
    }
  }

  const handleDeleteEstimate = async (estimateId: string) => {
    if (!confirm('Are you sure you want to delete this estimate? This action cannot be undone.')) {
      return
    }

    setDeletingEstimateId(estimateId)
    try {
      await db.deleteEstimate(estimateId)
      // Remove from local state
      const updatedEstimates = estimates.filter(e => e.id !== estimateId)
      setEstimates(updatedEstimates)
      
      // If we deleted the active estimate, set a new one or clear it
      if (activeEstimateId === estimateId) {
        if (updatedEstimates.length > 0) {
          setActiveEstimateId(updatedEstimates[0].id)
        } else {
          setActiveEstimateId(null)
        }
      }
    } catch (err) {
      console.error('Error deleting estimate:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete estimate'
      alert(`Error: ${errorMessage}`)
    } finally {
      setDeletingEstimateId(null)
    }
  }

  // Refresh function to reload project data after metadata updates
  const refreshProjectData = async () => {
    if (!projectId || !user) return

    try {
      const [projectData, estimatesData, uploadsData] = await Promise.all([
        db.getProject(projectId),
        db.getEstimates(projectId),
        db.getUploads(projectId).catch(() => [])
      ])

      if (projectData) {
        setProject(projectData)
        setEstimates(estimatesData)
        
        // Update photos and documents
        const photosData = uploadsData
          .filter(u => u.kind === 'photo')
          .map(u => ({ url: u.file_url, id: u.id }))
        
        const documentsData = uploadsData
          .filter(u => u.kind === 'blueprint')
          .map(u => {
            const originalFilename = (u as any).original_filename
            let filename = originalFilename
            if (!filename) {
              const urlParts = u.file_url.split('/')
              filename = urlParts[urlParts.length - 1] || 'Document'
            }
            return { url: u.file_url, name: filename, id: u.id }
          })
        
        setPhotos(photosData)
        setDocuments(documentsData)

        // Refresh profile if needed
        if (projectData.user_id) {
          try {
            const { data: profile, error } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', projectData.user_id)
              .single()
            
            if (!error && profile) {
              setEstimatorProfile(profile)
            }
          } catch (err) {
            console.warn('Could not refresh estimator profile:', err)
          }
        }
      }
    } catch (err) {
      console.error('Error refreshing project data:', err)
    }
  }

  const handleUploadPhoto = async (file: File) => {
    if (!user) throw new Error('User not authenticated')

    // Dynamically import supabase to avoid webpack chunking issues
    const { supabase } = await import('@/lib/supabase/client')

    // Upload to Supabase Storage
    // RLS policy requires user_id as first folder: user_id/photos/project_id/filename
    const fileExt = file.name.split('.').pop()
    const timestamp = Date.now()
    const filePath = `${user.id}/photos/${projectId}/${timestamp}.${fileExt}`

    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, file, {
        contentType: file.type,
        upsert: false
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      throw new Error(`Failed to upload photo: ${uploadError.message}`)
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('uploads')
      .getPublicUrl(filePath)

    // Create upload record in database with user_id
    // Use supabase client directly to include user_id
    // Note: user_id is required by RLS policy but not in TypeScript types yet
    const { supabase: supabaseClient } = await import('@/lib/supabase/client')
    const { data: newUpload, error: dbError } = await supabaseClient
      .from('uploads')
      .insert({
        project_id: projectId,
        file_url: publicUrl,
        kind: 'photo',
        user_id: user.id
      } as any)
      .select()
      .single()

    if (dbError) {
      console.error('Database insert error:', dbError)
      // Try to clean up the uploaded file
      await supabase.storage.from('uploads').remove([filePath])
      throw new Error(`Failed to save photo record: ${dbError.message}`)
    }

    // Update local state
    setPhotos([...photos, { url: publicUrl, id: newUpload.id }])
  }

  const handleUploadDocument = async (file: File) => {
    if (!user) throw new Error('User not authenticated')

    // Dynamically import supabase to avoid webpack chunking issues
    const { supabase } = await import('@/lib/supabase/client')

    // Upload to Supabase Storage
    // RLS policy requires user_id as first folder: user_id/documents/project_id/filename
    const fileExt = file.name.split('.').pop()
    const timestamp = Date.now()
    const filePath = `${user.id}/documents/${projectId}/${timestamp}.${fileExt}`

    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, file, {
        contentType: file.type,
        upsert: false
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      throw new Error(`Failed to upload document: ${uploadError.message}`)
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('uploads')
      .getPublicUrl(filePath)

    // Create upload record in database with user_id and original filename
    // Use supabase client directly to include user_id and filename
    // Note: user_id and filename are not in TypeScript types yet
    const { supabase: supabaseClient } = await import('@/lib/supabase/client')
    const { data: newUpload, error: dbError } = await supabaseClient
      .from('uploads')
      .insert({
        project_id: projectId,
        file_url: publicUrl,
        kind: 'blueprint',
        user_id: user.id,
        original_filename: file.name // Store original filename
      } as any)
      .select()
      .single()

    if (dbError) {
      console.error('Database insert error:', dbError)
      // Try to clean up the uploaded file
      await supabase.storage.from('uploads').remove([filePath])
      throw new Error(`Failed to save document record: ${dbError.message}`)
    }

    // Update local state with original filename
    setDocuments([...documents, { url: publicUrl, name: file.name, id: newUpload.id }])
  }

  const handleDeletePhoto = async (id: string) => {
    // Find the upload to get the file path
    const uploads = await db.getUploads(projectId)
    const upload = uploads.find(u => u.id === id && u.kind === 'photo')
    
    if (!upload) throw new Error('Photo not found')

    // Dynamically import supabase to avoid webpack chunking issues
    const { supabase } = await import('@/lib/supabase/client')

    // Extract file path from URL
    const urlParts = upload.file_url.split('/')
    const filePath = urlParts.slice(urlParts.indexOf('uploads') + 1).join('/')

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('uploads')
      .remove([filePath])

    if (storageError) {
      console.error('Error deleting from storage:', storageError)
      // Continue with database deletion even if storage deletion fails
    }

    // Delete from database
    await db.deleteUpload(id)

    // Update local state
    setPhotos(photos.filter(p => p.id !== id))
  }

  const handleDeleteDocument = async (id: string) => {
    // Find the upload to get the file path
    const uploads = await db.getUploads(projectId)
    const upload = uploads.find(u => u.id === id && u.kind === 'blueprint')
    
    if (!upload) throw new Error('Document not found')

    // Dynamically import supabase to avoid webpack chunking issues
    const { supabase } = await import('@/lib/supabase/client')

    // Extract file path from URL
    const urlParts = upload.file_url.split('/')
    const filePath = urlParts.slice(urlParts.indexOf('uploads') + 1).join('/')

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('uploads')
      .remove([filePath])

    if (storageError) {
      console.error('Error deleting from storage:', storageError)
      // Continue with database deletion even if storage deletion fails
    }

    // Delete from database
    await db.deleteUpload(id)

    // Update local state
    setDocuments(documents.filter(d => d.id !== id))
  }

  if (isLoading) {
    return (
      <AuthGuard>
        <div className="flex min-h-screen w-full max-w-[100vw] overflow-x-hidden">
          <Sidebar />
          <div 
            className="app-content flex-1 min-w-0 flex items-center justify-center transition-all duration-200"
            style={{ marginLeft: `${isCollapsed ? 60 : sidebarWidth}px` }}
          >
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              <p className="text-muted-foreground">Loading project...</p>
            </div>
          </div>
        </div>
      </AuthGuard>
    )
  }

  if (error || !project) {
    return (
      <AuthGuard>
        <div className="flex min-h-screen w-full max-w-[100vw] overflow-x-hidden">
          <Sidebar />
          <div 
            className="app-content flex-1 min-w-0 flex items-center justify-center p-4 md:p-6 transition-all duration-200"
            style={{ marginLeft: `${isCollapsed ? 60 : sidebarWidth}px` }}
          >
            <Card className="max-w-xl w-full border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Error Loading Project</CardTitle>
                <CardDescription>{error || 'Project not found'}</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-4">
                <Button onClick={() => router.push('/projects')} variant="outline">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Projects
                </Button>
                <Button onClick={() => window.location.reload()} variant="outline">
                  Retry
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </AuthGuard>
    )
  }

  const activeEstimate = activeEstimateId ? estimates.find(e => e.id === activeEstimateId) ?? null : null

  const handleSendMessage = async (content: string, fileUrls?: string[]) => {
    try {
      // Safely get recentActions - use ref to avoid closure issues
      const actionsToSend = recentActionsRef.current || []
      
      // Get current line items from active estimate for context
      let currentLineItems: any[] = []
      if (activeEstimate) {
        // Load line items for the active estimate directly from Supabase
        const { data: lineItems, error } = await supabase
          .from('estimate_line_items')
          .select('id, description, category, cost_code, room_name, quantity, unit')
          .eq('estimate_id', activeEstimate.id)
        
        if (!error && lineItems) {
          currentLineItems = lineItems.map((item: any) => ({
            id: item.id,
            description: item.description,
            category: item.category,
            cost_code: item.cost_code,
            room_name: item.room_name,
            quantity: item.quantity,
            unit: item.unit
          }))
        }
      }

      // Build messages array
      const messages = [
        {
          role: 'user' as const,
          content
        }
      ]

      // Create FormData if files are present, otherwise use JSON
      let body: FormData | string
      let headers: HeadersInit

      if (fileUrls && fileUrls.length > 0) {
        const formData = new FormData()
        formData.append('messages', JSON.stringify(messages))
        formData.append('projectId', projectId)
        formData.append('currentLineItems', JSON.stringify(currentLineItems))
        formData.append('recentActions', JSON.stringify(actionsToSend))
        formData.append('fileUrls', JSON.stringify(fileUrls))
        body = formData
        headers = {}
      } else {
        body = JSON.stringify({
          messages,
          projectId,
          currentLineItems,
          recentActions: actionsToSend, // Pass recent actions for context
          fileUrls: []
        })
        headers = {
          'Content-Type': 'application/json'
        }
      }

      const response = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers,
        body: body as BodyInit
      })

      if (!response.ok) {
        let errorMessage = 'Failed to send message'
        let errorCode: string | undefined
        let errorDetails: any
        
        try {
          const error = await response.json()
          errorMessage = error.error || errorMessage
          errorCode = error.code
          errorDetails = error.details
          
          // Handle specific error codes with user-friendly messages
          if (errorCode === 'SCANNED_PDF') {
            errorMessage = 'This PDF appears to be a scanned image. Please paste the text manually or use an OCR tool.'
          } else if (errorCode === 'DOWNLOAD_ERROR') {
            errorMessage = `Failed to download file: ${errorMessage}`
          } else if (errorCode === 'PARSE_ERROR') {
            errorMessage = 'We could not parse this PDF. It may be corrupted or image-only. Try re-uploading or pasting the text manually.'
          } else if (errorCode === 'FILE_TOO_LARGE') {
            errorMessage = `File is too large. Maximum size is 100MB.`
          }
        } catch (e) {
          // If JSON parsing fails, use status text
          console.error('Failed to parse error response:', e)
          errorMessage = `Server error: ${response.status} ${response.statusText}`
        }
        
        // Create error with code and details attached as plain properties
        const errorObj: Error & { code?: string; details?: any } = new Error(errorMessage)

        if (errorCode && typeof errorCode === 'string') {
          (errorObj as any).code = errorCode
        }

        if (errorDetails && typeof errorDetails === 'object') {
          // Best-effort serialization to avoid passing complex objects
          let safeDetails: any = undefined
          try {
            safeDetails = JSON.parse(JSON.stringify(errorDetails))
          } catch {
            safeDetails = undefined
          }
          if (safeDetails !== undefined) {
            (errorObj as any).details = safeDetails
          }
        }

        throw errorObj
      }

      let result
      try {
        result = await response.json()
      } catch (e) {
        const text = await response.text()
        console.error('Failed to parse response:', text)
        throw new Error('Invalid response from server')
      }
      
      // Reload estimates to show new line items
      const updatedEstimates = await db.getEstimates(projectId)
      setEstimates(updatedEstimates)
      
      console.log('Copilot response:', result)
      
      // Log action results for debugging
      if (result.executedActions && Array.isArray(result.executedActions)) {
        const failed = result.executedActions.filter((a: any) => !a.success)
        const succeeded = result.executedActions.filter((a: any) => a.success)
        if (failed.length > 0) {
          console.error('[handleSendMessage] Failed actions:', failed)
        }
        if (succeeded.length > 0) {
          console.log('[handleSendMessage] Successful actions:', succeeded.map((a: any) => a.action))
        }
        
        setRecentActions(prev => {
          // Keep only the last 5 actions to avoid context bloat
          const newActions = [...prev, ...result.executedActions]
          return newActions.slice(-5)
        })
      }
      
      // Return the result so the component can immediately update UI
      return result
    } catch (error) {
      console.error('Failed to send message:', error)
      throw error
    }
  }

  const handleVoiceRecord = () => {
    // TODO: Implement voice recording
    console.log('Voice record triggered')
  }

  const handleFileAttach = () => {
    // File attachment is handled directly in CopilotChat component
    console.log('File attachment handled in CopilotChat')
  }

  const handleExportPdf = async () => {
    if (!activeEstimateId) {
      toast.error('Please select an estimate to export')
      return
    }

    setIsExportingPdf(true)
    toast.loading('Generating PDF...', { id: 'export-pdf' })

    try {
      // Fetch PDF from API - it returns a URL to the PDF
      const response = await fetch(`/api/spec-sheets/${activeEstimateId}/pdf`, {
        method: 'GET'
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to generate PDF')
      }

      const data = await response.json()
      const pdfUrl = data.url

      if (!pdfUrl) {
        throw new Error('No PDF URL returned from server')
      }

      // Fetch the PDF blob from the URL
      const pdfResponse = await fetch(pdfUrl)
      if (!pdfResponse.ok) {
        throw new Error('Failed to download PDF')
      }

      const blob = await pdfResponse.blob()

      // Create a download link and trigger download
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      // Sanitize project title for filename
      const sanitizedTitle = (project?.title || 'estimate')
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase()
        .substring(0, 50)
      const dateStr = new Date().toISOString().split('T')[0]
      link.download = `SpecSheet-${sanitizedTitle}-${dateStr}.pdf`
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      toast.success('PDF downloaded successfully!', { id: 'export-pdf' })
    } catch (error) {
      console.error('Failed to export PDF:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to export PDF'
      toast.error(errorMessage, { id: 'export-pdf' })
    } finally {
      setIsExportingPdf(false)
    }
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen w-full max-w-[100vw] overflow-x-hidden">
        <Sidebar />

        <div 
          className="app-content flex-1 min-w-0 transition-all duration-200"
          style={{ marginLeft: `${isCollapsed ? 60 : sidebarWidth}px`, marginRight: '0' }}
        >
          {/* Main content - add right margin on large screens to make room for fixed chat */}
          <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden lg:mr-[400px]">
            {/* Top Bar */}
            <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-auto min-h-[56px] md:h-16 items-center justify-between px-3 md:px-6 py-2 md:py-0 gap-2 flex-wrap md:flex-nowrap">
              <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                <Button variant="ghost" size="sm" onClick={() => router.push('/projects')} className="min-h-[44px] md:min-h-0 shrink-0 px-2 md:px-3">
                  <ArrowLeft className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">Back</span>
                </Button>
                <div className="flex flex-col min-w-0 flex-1">
                  <EditableProjectTitle
                    title={project.title}
                    onSave={async (newTitle: string) => {
                      await db.updateProject(projectId, { title: newTitle })
                      setProject({ ...project, title: newTitle })
                    }}
                    variant="default"
                  />
                  {estimatorProfile && (
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {estimatorProfile.full_name && (
                        <span>Estimator: {estimatorProfile.full_name}</span>
                      )}
                      {estimatorProfile.company_name && (
                        <span className="ml-2 hidden sm:inline">• {estimatorProfile.company_name}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 md:gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportPdf}
                  disabled={isExportingPdf || !activeEstimateId}
                  className="min-h-[44px] md:min-h-0"
                >
                  {isExportingPdf ? (
                    <>
                      <div className="mr-1 md:mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      <span className="hidden sm:inline">Generating...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 md:mr-2" />
                      <span className="hidden sm:inline">Export PDF</span>
                    </>
                  )}
                </Button>
                {project?.status === 'active' && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setIsCloseJobModalOpen(true)}
                    className="min-h-[44px] md:min-h-0"
                  >
                    <FileText className="h-4 w-4 md:mr-2" />
                    <span className="hidden sm:inline">Mark Job Complete</span>
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteProject}
                  disabled={deletingProject}
                  className="min-h-[44px] md:min-h-0"
                >
                  {deletingProject ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4 md:mr-2" />
                      <span className="hidden sm:inline">Delete</span>
                    </>
                  )}
                </Button>
                <UserMenu user={user} />
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="p-4 md:p-6 overflow-x-hidden">
            {/* Tab Navigation */}
            {/* Phase 1: Pricing and Selections tabs removed per PHASE_1_RELEASE_CHECKLIST.md */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="scrollable-tabs max-w-full md:w-full md:grid md:grid-cols-8 md:gap-1">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="estimate">Estimate</TabsTrigger>
                <TabsTrigger value="rooms">Rooms</TabsTrigger>
                <TabsTrigger value="files">Files</TabsTrigger>
                <TabsTrigger value="proposals">Proposals</TabsTrigger>
                <TabsTrigger value="contracts">Contracts</TabsTrigger>
                <TabsTrigger value="manage">Manage</TabsTrigger>
                <TabsTrigger value="spec-sheets">Spec Sheets</TabsTrigger>
              </TabsList>

              <TabsContent value="summary">
                <SummaryTab
                  project={project}
                  activeEstimate={activeEstimate}
                  estimates={estimates}
                  photos={photos}
                  documents={documents}
                  onRefresh={refreshProjectData}
                  onUploadPhoto={handleUploadPhoto}
                  onUploadDocument={handleUploadDocument}
                  onDeletePhoto={handleDeletePhoto}
                  onDeleteDocument={handleDeleteDocument}
                  onNavigateToEstimate={() => setActiveTab("estimate")}
                  onNavigateToFiles={() => setActiveTab("files")}
                />
              </TabsContent>

              <TabsContent value="estimate">
                <EstimateTab
                  project={project}
                  projectId={projectId}
                  estimates={estimates}
                  activeEstimateId={activeEstimateId}
                  setActiveEstimateId={setActiveEstimateId}
                  deletingEstimateId={deletingEstimateId}
                  onDeleteEstimate={handleDeleteEstimate}
                  onSave={handleEstimateSave}
                  onEstimateStatusChange={fetchEstimates}
                />
              </TabsContent>

              {/* Phase 1: Pricing and Selections TabsContent removed per PHASE_1_RELEASE_CHECKLIST.md */}

              <TabsContent value="rooms">
                <RoomsTab project={project} />
              </TabsContent>

              <TabsContent value="files">
                <FilesTab 
                  projectId={projectId}
                  estimateId={activeEstimateId || undefined}
                  onUseInCopilot={(fileUrl, fileName) => {
                    setIsCopilotOpen(true)
                    // Dispatch event to attach file to copilot
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('copilot-file-attach', {
                        detail: { 
                          message: `Analyze this file: ${fileName}`,
                          fileUrl: fileUrl
                        }
                      }))
                    }, 300)
                  }}
                  onBlueprintParsed={async () => {
                    // Refresh estimates after blueprint parsing
                    await fetchEstimates()
                    // Notify EstimateTable + RoomsTab to refetch data
                    // Small delay to ensure React state has settled after fetchEstimates
                    setTimeout(() => {
                      window.dispatchEvent(new Event('estimate-updated'))
                      window.dispatchEvent(new Event('rooms-updated'))
                    }, 200)
                  }}
                />
              </TabsContent>

              <TabsContent value="proposals">
                <ProposalsTab 
                  project={project}
                  activeEstimateId={activeEstimateId}
                />
              </TabsContent>

              <TabsContent value="contracts">
                <ContractsTab 
                  project={project}
                />
              </TabsContent>

              <TabsContent value="manage">
                {project && <ManageTab project={project} />}
              </TabsContent>

              <TabsContent value="spec-sheets">
                <SpecSheetsTab project={project} />
              </TabsContent>
            </Tabs>
          </main>
          </div>

        </div>

        {/* Desktop Copilot Sidebar - Fixed position, always visible when scrolling */}
        <aside className="hidden lg:flex fixed top-0 right-0 w-[400px] h-screen border-l border-border bg-background z-20">
          <CopilotChat
            projectId={projectId}
            onSendMessage={handleSendMessage}
            onVoiceRecord={handleVoiceRecord}
            onFileAttach={handleFileAttach}
            className="h-full w-full"
          />
        </aside>

        {/* Mobile Copilot Drawer */}
        <Drawer open={isCopilotOpen} onOpenChange={setIsCopilotOpen}>
          <DrawerContent className="h-[calc(100vh-6rem)]" title="Copilot">
            <CopilotChat
              projectId={projectId}
              onSendMessage={handleSendMessage}
              onVoiceRecord={handleVoiceRecord}
              onFileAttach={handleFileAttach}
              className="h-full border-0"
            />
          </DrawerContent>
        </Drawer>

        {/* Mobile Floating Action Button */}
        <Button
          onClick={() => setIsCopilotOpen(true)}
          className="lg:hidden fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-30"
          size="icon-lg"
        >
          <MessageSquare className="h-6 w-6" />
          <span className="sr-only">Open Copilot</span>
        </Button>

        {/* Close Job Modal */}
        <CloseJobModal
          projectId={projectId}
          open={isCloseJobModalOpen}
          onOpenChange={setIsCloseJobModalOpen}
          onSuccess={() => {
            // Refresh project data after closing
            refreshProjectData()
          }}
        />
      </div>
    </AuthGuard>
  )
}

