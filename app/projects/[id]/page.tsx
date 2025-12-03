'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
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
import { PricingTab } from "./_components/PricingTab"
import { RoomsTab } from "./_components/RoomsTab"
import { PhotosTab } from "./_components/PhotosTab"
import { DocumentsTab } from "./_components/DocumentsTab"
import { WalkTab } from "./_components/WalkTab"
import { SpecSheetsTab } from "./_components/SpecSheetsTab"
import type { Project, Estimate, Upload, Profile } from "@/types/db"
import { ArrowLeft, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase/client"
import { useSidebar } from "@/lib/sidebar-context"

export default function ProjectDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { user } = useAuth()
  const { sidebarWidth, isCollapsed } = useSidebar()
  const projectId = params.id as string

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
  const [isParsing, setIsParsing] = useState(false)
  const [activeTab, setActiveTab] = useState("summary")

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

  const handleEstimateSave = (estimateId: string, total: number) => {
    // Refresh estimates list
    db.getEstimates(projectId).then(setEstimates).catch(console.error)
  }

  const handleRecordingComplete = async (audioBlob: Blob, transcript: string) => {
    if (!transcript.trim()) {
      alert('No transcript available. Please try recording again.')
      return
    }

    setIsParsing(true)

    try {
      // Parse transcript with AI
      const response = await fetch('/api/ai/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: projectId,
          transcript: transcript
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData.error || `Parse failed: ${response.status}`
        
        // Provide user-friendly messages for common errors
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          throw new Error(`Service temporarily unavailable. The AI parsing service is experiencing issues. Please try again in a few moments. (${errorMessage})`)
        }
        
        throw new Error(errorMessage)
      }

      const result = await response.json()
      
      // Refresh estimates list to show the new estimate
      // Use a small delay to ensure the database has committed the new estimate
      await new Promise(resolve => setTimeout(resolve, 300))
      const updatedEstimates = await db.getEstimates(projectId)
      setEstimates(updatedEstimates)
      
      // Set the newly created estimate as active
      if (result.estimateId) {
        setActiveEstimateId(result.estimateId)
        
        // Force a re-render by ensuring the estimate is in the list
        // The EstimateTable will update via the useEffect that watches initialData
        // The estimateData is computed from activeEstimate which will update when estimates list updates
      } else {
        // If no estimateId was returned, try to find the most recent estimate
        if (updatedEstimates.length > 0) {
          setActiveEstimateId(updatedEstimates[0].id)
        }
      }
    } catch (error) {
      console.error('Parse error:', error)
      alert(error instanceof Error ? error.message : 'Failed to parse transcript')
    } finally {
      setIsParsing(false)
    }
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
        <div className="flex min-h-screen">
          <Sidebar />
          <div 
            className="flex-1 flex items-center justify-center transition-all duration-200"
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
        <div className="flex min-h-screen">
          <Sidebar />
          <div 
            className="flex-1 flex items-center justify-center p-6 transition-all duration-200"
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

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />

        <div 
          className="flex-1 transition-all duration-200"
          style={{ marginLeft: `${isCollapsed ? 60 : sidebarWidth}px` }}
        >
          {/* Top Bar */}
          <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center justify-between px-4 md:px-6">
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={() => router.push('/projects')}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <div className="flex flex-col">
                  <EditableProjectTitle
                    title={project.title}
                    onSave={async (newTitle: string) => {
                      await db.updateProject(projectId, { title: newTitle })
                      setProject({ ...project, title: newTitle })
                    }}
                    variant="default"
                  />
                  {estimatorProfile && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {estimatorProfile.full_name && (
                        <span>Estimator: {estimatorProfile.full_name}</span>
                      )}
                      {estimatorProfile.company_name && (
                        <span className="ml-2">• {estimatorProfile.company_name}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteProject}
                  disabled={deletingProject}
                >
                  {deletingProject ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Project
                    </>
                  )}
                </Button>
                <UserMenu user={user} />
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="p-4 md:p-6">
            {/* Tab Navigation */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-full grid grid-cols-8 gap-1">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="estimate">Estimate</TabsTrigger>
                <TabsTrigger value="pricing">Pricing</TabsTrigger>
                <TabsTrigger value="rooms">Rooms</TabsTrigger>
                <TabsTrigger value="photos">Photos</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="walk">Walk-n-Talk</TabsTrigger>
                <TabsTrigger value="proposals">Spec Sheets</TabsTrigger>
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
                  onNavigateToPhotos={() => setActiveTab("photos")}
                  onNavigateToDocuments={() => setActiveTab("documents")}
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
                  onRecordingComplete={handleRecordingComplete}
                  isParsing={isParsing}
                />
              </TabsContent>

              <TabsContent value="pricing">
                <PricingTab
                  project={project}
                  estimates={estimates}
                  activeEstimateId={activeEstimateId}
                />
              </TabsContent>

              <TabsContent value="rooms">
                <RoomsTab project={project} />
              </TabsContent>

              <TabsContent value="photos">
                <PhotosTab project={project} />
              </TabsContent>

              <TabsContent value="documents">
                <DocumentsTab project={project} />
              </TabsContent>

              <TabsContent value="walk">
                <WalkTab project={project} />
              </TabsContent>

              <TabsContent value="proposals">
                <SpecSheetsTab project={project} />
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div>
    </AuthGuard>
  )
}

