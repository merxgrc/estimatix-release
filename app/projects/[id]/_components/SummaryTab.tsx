'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EditableProjectTitle } from "@/components/editable-project-title"
import { EditableField } from "@/components/editable-field"
import { db } from "@/lib/db-client"
import type { Project, Estimate } from "@/types/db"
import { 
  MapPin, 
  Calendar, 
  FileText, 
  Image as ImageIcon, 
  Upload as UploadIcon,
  Trash2,
  ExternalLink,
  Home,
  Ruler,
  Bed,
  Bath,
  Clock,
  AlertCircle,
  ArrowRight
} from "lucide-react"

interface SummaryTabProps {
  project: Project
  activeEstimate: Estimate | null
  estimates: Estimate[]
  photos: { url: string; id: string }[]
  documents: { url: string; name: string; id: string }[]
  missingInfo?: string[]
  todos?: string[]
  onRefresh?: () => void
  onUploadPhoto: (file: File) => Promise<void>
  onUploadDocument: (file: File) => Promise<void>
  onDeletePhoto: (id: string) => Promise<void>
  onDeleteDocument: (id: string) => Promise<void>
  onNavigateToEstimate?: () => void
  onNavigateToPhotos?: () => void
  onNavigateToDocuments?: () => void
}

export function SummaryTab({
  project,
  activeEstimate,
  estimates,
  photos,
  documents,
  missingInfo,
  todos,
  onRefresh,
  onUploadPhoto,
  onUploadDocument,
  onDeletePhoto,
  onDeleteDocument,
  onNavigateToEstimate,
  onNavigateToPhotos,
  onNavigateToDocuments
}: SummaryTabProps) {
  const router = useRouter()
  const photoInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadingDocument, setUploadingDocument] = useState(false)
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null)
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)

  // Helper to update project metadata using client-side db.updateProject (same as top of page)
  const handleUpdateMetadata = async (field: string, value: string | number | null) => {
    try {
      const patch: any = {}
      
      // Convert string numbers to actual numbers for numeric fields
      if (['year_built', 'home_size_sqft', 'lot_size_sqft', 'bedrooms', 'bathrooms', 'missing_data_count'].includes(field)) {
        patch[field] = value === '' || value === null ? null : Number(value)
      } else {
        patch[field] = value === '' ? null : value
      }

      // Only add last_summary_update for new metadata fields (not original fields like title, owner_name, project_address)
      // This field is added in migration 004, so it might not exist for older projects
      const originalFields = ['title', 'owner_name', 'project_address', 'client_name']
      if (!originalFields.includes(field)) {
        // Only add timestamp for new metadata fields
        // If the column doesn't exist, Supabase will ignore it or return an error we can handle
        patch.last_summary_update = new Date().toISOString()
      }

      // Use the same db.updateProject method that works at the top of the page
      const updatedProject = await db.updateProject(project.id, patch)
      
      // Update local project state immediately for instant UI feedback
      // The refresh will ensure we have the latest data from the server
      if (onRefresh) {
        onRefresh()
      } else {
        router.refresh()
      }
    } catch (error) {
      // Log full error details for debugging
      console.error(`Error updating ${field}:`, error)
      console.error('Error type:', typeof error)
      console.error('Error constructor:', error?.constructor?.name)
      console.error('Error keys:', error && typeof error === 'object' ? Object.keys(error) : 'N/A')
      console.error('Error JSON:', JSON.stringify(error, null, 2))
      
      // Extract error message from various error formats (Supabase PostgrestError, Error, etc.)
      let errorMessage = `Failed to update ${field}. Please try again.`
      
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage
      } else if (error && typeof error === 'object') {
        // Handle Supabase PostgrestError objects - check all possible properties
        const errorObj = error as any
        
        if (errorObj?.message && typeof errorObj.message === 'string' && errorObj.message.trim()) {
          errorMessage = errorObj.message
        } else if (errorObj?.code && typeof errorObj.code === 'string') {
          // Use code if message is not available
          errorMessage = `Database error (${errorObj.code}). Please try again.`
        } else if (errorObj?.details && typeof errorObj.details === 'string' && errorObj.details.trim()) {
          errorMessage = errorObj.details
        } else if (errorObj?.hint && typeof errorObj.hint === 'string' && errorObj.hint.trim()) {
          errorMessage = errorObj.hint
        } else if (errorObj?.error && typeof errorObj.error === 'string') {
          errorMessage = errorObj.error
        } else {
          // If we can't extract a message, provide a more specific error
          errorMessage = `Failed to update ${field}. The database update may have failed. Please check your connection and try again.`
        }
      }
      
      throw new Error(errorMessage)
    }
  }

  // Handlers for each field
  const handleUpdateTitle = async (value: string) => {
    await handleUpdateMetadata('title', value)
  }

  const handleUpdateOwner = async (value: string) => {
    await handleUpdateMetadata('owner_name', value)
  }

  const handleUpdateAddress = async (value: string) => {
    await handleUpdateMetadata('project_address', value)
  }

  const handleUpdateProjectType = async (value: string) => {
    await handleUpdateMetadata('project_type', value)
  }

  const handleUpdateYearBuilt = async (value: string) => {
    await handleUpdateMetadata('year_built', value)
  }

  const handleUpdateHomeSize = async (value: string) => {
    await handleUpdateMetadata('home_size_sqft', value)
  }

  const handleUpdateLotSize = async (value: string) => {
    await handleUpdateMetadata('lot_size_sqft', value)
  }

  const handleUpdateBedrooms = async (value: string) => {
    await handleUpdateMetadata('bedrooms', value)
  }

  const handleUpdateBathrooms = async (value: string) => {
    await handleUpdateMetadata('bathrooms', value)
  }

  const handleUpdateJobStart = async (value: string) => {
    await handleUpdateMetadata('job_start_target', value)
  }

  const handleUpdateJobDeadline = async (value: string) => {
    await handleUpdateMetadata('job_deadline', value)
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file')
      return
    }

    setUploadingPhoto(true)
    try {
      await onUploadPhoto(file)
      if (photoInputRef.current) {
        photoInputRef.current.value = ''
      }
    } catch (error) {
      console.error('Error uploading photo:', error)
      alert('Failed to upload photo')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingDocument(true)
    try {
      await onUploadDocument(file)
      if (documentInputRef.current) {
        documentInputRef.current.value = ''
      }
    } catch (error) {
      console.error('Error uploading document:', error)
      alert('Failed to upload document')
    } finally {
      setUploadingDocument(false)
    }
  }

  const handleDeletePhoto = async (id: string) => {
    if (!confirm('Are you sure you want to delete this photo?')) return
    
    setDeletingPhotoId(id)
    try {
      await onDeletePhoto(id)
    } catch (error) {
      console.error('Error deleting photo:', error)
      alert('Failed to delete photo')
    } finally {
      setDeletingPhotoId(null)
    }
  }

  const handleDeleteDocument = async (id: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return
    
    setDeletingDocumentId(id)
    try {
      await onDeleteDocument(id)
    } catch (error) {
      console.error('Error deleting document:', error)
      alert('Failed to delete document')
    } finally {
      setDeletingDocumentId(null)
    }
  }

  const handlePhotoClick = () => {
    if (onNavigateToPhotos) {
      onNavigateToPhotos()
    }
  }

  const handleGoToEstimate = () => {
    if (onNavigateToEstimate) {
      onNavigateToEstimate()
    } else {
      router.push(`/projects/${project.id}?tab=estimate`)
    }
  }

  // Get Google Maps URL for address
  const getMapsUrl = (address: string | null) => {
    if (!address) return null
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
  }

  // Extract missing info from estimate if not provided
  const extractedMissingInfo = missingInfo || (
    activeEstimate?.json_data && typeof activeEstimate.json_data === 'object' && 'missing_info' in activeEstimate.json_data
      ? (activeEstimate.json_data as any).missing_info || []
      : []
  )

  // Auto-generate todos from missingInfo if not provided
  const displayTodos = todos || extractedMissingInfo.map((item: string) => `Confirm: ${item}`)

  // Get AI Summary
  const aiSummary = activeEstimate?.ai_summary || 
    (project as any).ai_summary || 
    "No AI summary yet. Generate an estimate to see an AI summary."

  // Format last updated
  const lastUpdated = project.created_at ? new Date(project.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }) : '—'

  // Calculate missing data count
  const missingDataCount = extractedMissingInfo.length

  // Format date values for display
  const formatDate = (dateString: string | null): string | null => {
    if (!dateString) return null
    try {
      return new Date(dateString).toISOString().split('T')[0] // YYYY-MM-DD format
    } catch {
      return dateString
    }
  }

  return (
    <div className="space-y-6">
      {/* ROW 1 - 3 EQUAL-HEIGHT COLUMNS */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr] gap-6 items-stretch min-h-0">
        {/* LEFT COLUMN - METADATA (4 GROUPED COLUMNS) */}
        <Card className="h-full flex flex-col max-h-[600px] min-w-0">
          <CardHeader className="pb-3 flex-shrink-0">
            <EditableProjectTitle
              title={project.title}
              onSave={handleUpdateTitle}
              variant="card"
              className="mb-0"
            />
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto min-h-0">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {/* Project Info Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Project Info</h3>
                <div className="space-y-2 text-sm">
                  <EditableField
                    label="Project Name"
                    value={project.title}
                    onSave={handleUpdateTitle}
                    placeholder="Enter project name"
                  />
                  <EditableField
                    label="Owner Name"
                    value={project.owner_name}
                    onSave={handleUpdateOwner}
                    placeholder="Enter owner name"
                  />
                  <div>
                    <EditableField
                      label="Property Address"
                      value={project.project_address}
                      onSave={handleUpdateAddress}
                      placeholder="Enter property address"
                      multiline
                    />
                    {project.project_address && getMapsUrl(project.project_address) && (
                      <a
                        href={getMapsUrl(project.project_address)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1 text-xs mt-1"
                      >
                        <MapPin className="h-3 w-3" />
                        View in Maps
                      </a>
                    )}
                  </div>
                  <EditableField
                    label="Project Type"
                    value={project.project_type}
                    onSave={handleUpdateProjectType}
                    placeholder="Enter project type"
                  />
                </div>
              </div>

              {/* Property Details Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Property Details</h3>
                <div className="space-y-2 text-sm">
                  <EditableField
                    label="Year Built"
                    value={project.year_built?.toString() || null}
                    onSave={handleUpdateYearBuilt}
                    placeholder="Enter year built"
                  />
                  <EditableField
                    label="Home Size (sq ft)"
                    value={project.home_size_sqft?.toString() || null}
                    onSave={handleUpdateHomeSize}
                    placeholder="Enter home size"
                  />
                  <EditableField
                    label="Lot Size (sq ft)"
                    value={project.lot_size_sqft?.toString() || null}
                    onSave={handleUpdateLotSize}
                    placeholder="Enter lot size"
                  />
                  <EditableField
                    label="Bedrooms"
                    value={project.bedrooms?.toString() || null}
                    onSave={handleUpdateBedrooms}
                    placeholder="Enter number of bedrooms"
                  />
                  <EditableField
                    label="Bathrooms"
                    value={project.bathrooms?.toString() || null}
                    onSave={handleUpdateBathrooms}
                    placeholder="Enter number of bathrooms"
                  />
                </div>
              </div>

              {/* Job Details Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Job Details</h3>
                <div className="space-y-2 text-sm">
                  <EditableField
                    label="Job Start Target"
                    value={formatDate(project.job_start_target)}
                    onSave={handleUpdateJobStart}
                    placeholder="YYYY-MM-DD"
                  />
                  <EditableField
                    label="Job Deadline"
                    value={formatDate(project.job_deadline)}
                    onSave={handleUpdateJobDeadline}
                    placeholder="YYYY-MM-DD"
                  />
                </div>
              </div>

              {/* AI Fields Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">AI Fields</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <div className="text-muted-foreground">Missing Data Count</div>
                    <div className="font-medium">{project.missing_data_count ?? missingDataCount}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Last Updated</div>
                    <div className="font-medium">
                      {project.last_summary_update 
                        ? new Date(project.last_summary_update).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })
                        : lastUpdated}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CENTER COLUMN - DOCUMENTS CARD */}
        <Card className="h-full flex flex-col max-h-[600px] min-w-0">
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-lg">Documents</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {documents.length > 0 ? (
              <div className="space-y-2 flex-1 overflow-y-auto">
                {documents.map((doc) => (
                  <a
                    key={doc.id}
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors min-w-0"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm truncate min-w-0 flex-1">{doc.name}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center w-full">
                  <UploadIcon className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium mb-1">No documents yet</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Drag & drop or click to upload
                  </p>
                  <input
                    ref={documentInputRef}
                    type="file"
                    onChange={handleDocumentUpload}
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.xls,.xlsx"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => documentInputRef.current?.click()}
                    disabled={uploadingDocument}
                  >
                    {uploadingDocument ? (
                      <>
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <UploadIcon className="mr-2 h-4 w-4" />
                        Upload Document
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* RIGHT COLUMN - PHOTOS CARD */}
        <Card className="h-full flex flex-col max-h-[600px] min-w-0">
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-lg">Photos</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {photos.length > 0 ? (
              <div className="flex-1 flex items-center justify-center min-h-0">
                <div
                  className="w-full h-40 md:h-full max-h-[400px] rounded-md overflow-hidden bg-muted cursor-pointer group relative"
                  onClick={handlePhotoClick}
                >
                  <img
                    src={photos[0].url}
                    alt="Project photo"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center w-full">
                  <ImageIcon className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium mb-1">No photos yet</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Drag & drop or click to upload
                  </p>
                  <input
                    ref={photoInputRef}
                    type="file"
                    onChange={handlePhotoUpload}
                    className="hidden"
                    accept="image/*"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                  >
                    {uploadingPhoto ? (
                      <>
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <UploadIcon className="mr-2 h-4 w-4" />
                        Upload Photos
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ROW 2 - AI SUMMARY (FULL WIDTH) */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>AI Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {aiSummary}
          </p>
        </CardContent>
      </Card>

      {/* ROW 3 - MISSING INFORMATION (FULL WIDTH) */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Missing Information</CardTitle>
        </CardHeader>
        <CardContent>
          {extractedMissingInfo.length > 0 ? (
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              {extractedMissingInfo.map((info: string, index: number) => (
                <li key={index}>{info}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No missing information identified yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ROW 4 - TO-DO LIST (FULL WIDTH) */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>To-Do</CardTitle>
        </CardHeader>
        <CardContent>
          {displayTodos.length > 0 ? (
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              {displayTodos.map((todo: string, index: number) => (
                <li key={index}>{todo}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No action items yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ROW 5 - GO TO ESTIMATE BUTTON (FULL WIDTH) */}
      <Card>
        <CardContent className="flex justify-end pt-6">
          <Button onClick={handleGoToEstimate} size="lg">
            Go to Estimate
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
