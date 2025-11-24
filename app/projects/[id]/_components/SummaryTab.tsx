'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EditableProjectTitle } from "@/components/editable-project-title"
import { EditableField } from "@/components/editable-field"
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
  onUpdateTitle: (newTitle: string) => Promise<void>
  onUpdateOwner: (ownerName: string) => Promise<void>
  onUpdateAddress: (address: string) => Promise<void>
  onUpdateProjectType?: (value: string) => Promise<void>
  onUpdateYearBuilt?: (value: string) => Promise<void>
  onUpdateHomeSize?: (value: string) => Promise<void>
  onUpdateLotSize?: (value: string) => Promise<void>
  onUpdateBedrooms?: (value: string) => Promise<void>
  onUpdateBathrooms?: (value: string) => Promise<void>
  onUpdateJobStart?: (value: string) => Promise<void>
  onUpdateJobDeadline?: (value: string) => Promise<void>
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
  onUpdateTitle,
  onUpdateOwner,
  onUpdateAddress,
  onUpdateProjectType,
  onUpdateYearBuilt,
  onUpdateHomeSize,
  onUpdateLotSize,
  onUpdateBedrooms,
  onUpdateBathrooms,
  onUpdateJobStart,
  onUpdateJobDeadline,
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

  // Parse metadata from notes (stored as JSON) or return defaults
  const parseMetadata = () => {
    try {
      if (project.notes) {
        const parsed = JSON.parse(project.notes)
        if (typeof parsed === 'object' && parsed !== null && 'metadata' in parsed) {
          return parsed.metadata
        }
      }
    } catch (e) {
      // If notes is not JSON, return empty metadata
    }
    return {}
  }

  const metadata = parseMetadata()
  const getMetadataValue = (key: string): string | null => {
    return metadata[key] || null
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
              onSave={onUpdateTitle}
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
                    onSave={onUpdateTitle}
                    placeholder="Enter project name"
                  />
                  <EditableField
                    label="Owner Name"
                    value={project.owner_name}
                    onSave={onUpdateOwner}
                    placeholder="Enter owner name"
                  />
                  <div>
                    <EditableField
                      label="Property Address"
                      value={project.project_address}
                      onSave={onUpdateAddress}
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
                  {onUpdateProjectType && (
                    <EditableField
                      label="Project Type"
                      value={getMetadataValue('project_type')}
                      onSave={onUpdateProjectType}
                      placeholder="Enter project type"
                    />
                  )}
                </div>
              </div>

              {/* Property Details Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Property Details</h3>
                <div className="space-y-2 text-sm">
                  {onUpdateYearBuilt && (
                    <EditableField
                      label="Year Built"
                      value={getMetadataValue('year_built')}
                      onSave={onUpdateYearBuilt}
                      placeholder="Enter year built"
                    />
                  )}
                  {onUpdateHomeSize && (
                    <EditableField
                      label="Home Size (sq ft)"
                      value={getMetadataValue('home_size')}
                      onSave={onUpdateHomeSize}
                      placeholder="Enter home size"
                    />
                  )}
                  {onUpdateLotSize && (
                    <EditableField
                      label="Lot Size (sq ft)"
                      value={getMetadataValue('lot_size')}
                      onSave={onUpdateLotSize}
                      placeholder="Enter lot size"
                    />
                  )}
                  {onUpdateBedrooms && (
                    <EditableField
                      label="Bedrooms"
                      value={getMetadataValue('bedrooms')}
                      onSave={onUpdateBedrooms}
                      placeholder="Enter number of bedrooms"
                    />
                  )}
                  {onUpdateBathrooms && (
                    <EditableField
                      label="Bathrooms"
                      value={getMetadataValue('bathrooms')}
                      onSave={onUpdateBathrooms}
                      placeholder="Enter number of bathrooms"
                    />
                  )}
                </div>
              </div>

              {/* Job Details Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Job Details</h3>
                <div className="space-y-2 text-sm">
                  {onUpdateJobStart && (
                    <EditableField
                      label="Job Start Target"
                      value={getMetadataValue('job_start')}
                      onSave={onUpdateJobStart}
                      placeholder="Enter job start target"
                    />
                  )}
                  {onUpdateJobDeadline && (
                    <EditableField
                      label="Job Deadline"
                      value={getMetadataValue('job_deadline')}
                      onSave={onUpdateJobDeadline}
                      placeholder="Enter job deadline"
                    />
                  )}
                </div>
              </div>

              {/* AI Fields Group */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">AI Fields</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <div className="text-muted-foreground">Missing Data Count</div>
                    <div className="font-medium">{missingDataCount}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Last Updated</div>
                    <div className="font-medium">{lastUpdated}</div>
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
