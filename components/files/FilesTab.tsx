'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { db } from '@/lib/db-client'
import { useAuth } from '@/lib/auth-context'
import * as tus from 'tus-js-client'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { 
  Upload, 
  Download, 
  Trash2, 
  MoreVertical, 
  FileText, 
  Image as ImageIcon, 
  FileAudio,
  Video,
  File,
  Sparkles,
  X,
  Loader2,
  ScanLine,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Upload as UploadType } from '@/types/db'
import { cn } from '@/lib/utils'
import { BlueprintReviewDrawer } from '@/components/plans/BlueprintReviewDrawer'

interface FilesTabProps {
  projectId: string
  estimateId?: string
  onUseInCopilot?: (fileUrl: string, fileName: string) => void
  onBlueprintParsed?: () => void
}

type FileTag = 'blueprint' | 'spec' | 'photo' | 'other'
type FileType = 'pdf' | 'image' | 'audio' | 'video' | 'other'

const TAG_OPTIONS: { value: FileTag; label: string }[] = [
  { value: 'blueprint', label: 'Blueprint' },
  { value: 'spec', label: 'Spec' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
]

function getFileTypeIcon(fileType: FileType | null | undefined) {
  switch (fileType) {
    case 'pdf':
      return <FileText className="h-4 w-4 text-destructive" />
    case 'image':
      return <ImageIcon className="h-4 w-4 text-primary" />
    case 'audio':
      return <FileAudio className="h-4 w-4 text-primary/70" />
    case 'video':
      return <Video className="h-4 w-4 text-purple-500" />
    default:
      return <File className="h-4 w-4 text-gray-500" />
  }
}

function detectFileType(fileName: string, mimeType?: string): FileType {
  const ext = fileName.split('.').pop()?.toLowerCase()
  
  if (mimeType) {
    if (mimeType.includes('pdf')) return 'pdf'
    if (mimeType.includes('image')) return 'image'
    if (mimeType.includes('audio')) return 'audio'
    if (mimeType.includes('video')) return 'video'
  }
  
  if (ext) {
    if (['pdf'].includes(ext)) return 'pdf'
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
    if (['mp3', 'wav', 'webm', 'm4a', 'ogg'].includes(ext)) return 'audio'
    if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) return 'video'
  }
  
  return 'other'
}

// Max file size: 100MB (Supabase bucket limit set in migration 032)
const MAX_FILE_SIZE_MB = 100
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

export function FilesTab({ projectId, estimateId, onUseInCopilot, onBlueprintParsed }: FilesTabProps) {
  const { user } = useAuth()
  const [files, setFiles] = useState<UploadType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [selectedTag, setSelectedTag] = useState<FileTag>('other')
  const [dragActive, setDragActive] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  
  // Blueprint parsing state
  const [selectedFilesForParsing, setSelectedFilesForParsing] = useState<Set<string>>(new Set())
  const [isParsing, setIsParsing] = useState(false)
  const [parseResult, setParseResult] = useState<any>(null)
  const [showReviewDrawer, setShowReviewDrawer] = useState(false)
  const [activeParseEstimateId, setActiveParseEstimateId] = useState<string | undefined>(undefined)
  
  // Keep activeParseEstimateId in sync with prop
  const effectiveEstimateId = activeParseEstimateId || estimateId

  const loadFiles = useCallback(async () => {
    if (!projectId) return

    try {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('uploads')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setFiles(data || [])
    } catch (error) {
      console.error('Error loading files:', error)
      toast.error('Failed to load files')
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const handleFileSelect = (file: File) => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
      toast.error(`File too large (${sizeMB}MB)`, {
        description: `Maximum file size is ${MAX_FILE_SIZE_MB}MB. To upload larger blueprints: (1) Use Adobe Acrobat or SmallPDF.com to compress the PDF, or (2) Split into separate files per floor/section.`,
        duration: 10000,
      })
      return
    }
    
    const fileType = detectFileType(file.name, file.type)
    setUploadFile(file)
    setUploadProgress(0)
    // Default to 'blueprint' for PDFs so they're ready for parsing
    setSelectedTag(fileType === 'image' ? 'photo' : fileType === 'pdf' ? 'blueprint' : 'other')
    
    // Warn for large files
    if (file.size > 20 * 1024 * 1024) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
      toast.info(`Large file selected (${sizeMB}MB)`, {
        description: 'Upload may take a moment. Please wait for completion.',
        duration: 4000,
      })
    }
  }

  const handleUpload = async () => {
    if (!uploadFile || !user) {
      toast.error('Please select a file to upload')
      return
    }

    try {
      setIsUploading(true)
      setUploadProgress(0)

      // Upload to Supabase Storage
      const timestamp = Date.now()
      const sanitizedFileName = uploadFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')
      const filePath = `${user.id}/files/${projectId}/${timestamp}-${sanitizedFileName}`

      // For large files (>6MB), use TUS resumable upload protocol
      const LARGE_FILE_THRESHOLD = 6 * 1024 * 1024
      
      if (uploadFile.size > LARGE_FILE_THRESHOLD) {
        // Large file: use TUS resumable upload
        console.log(`[Upload] Large file (${(uploadFile.size / 1024 / 1024).toFixed(1)}MB), using TUS resumable upload...`)
        
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const { data: { session } } = await supabase.auth.getSession()
        const accessToken = session?.access_token
        
        if (!accessToken) {
          throw new Error('Authentication required for upload')
        }

        // TUS resumable upload
        await new Promise<void>((resolve, reject) => {
          const upload = new tus.Upload(uploadFile, {
            endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
            retryDelays: [0, 1000, 3000, 5000],
            headers: {
              authorization: `Bearer ${accessToken}`,
              'x-upsert': 'false',
            },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            metadata: {
              bucketName: 'uploads',
              objectName: filePath,
              contentType: uploadFile.type,
              cacheControl: '3600',
            },
            chunkSize: 6 * 1024 * 1024, // 6MB chunks
            onError: (error) => {
              console.error('[TUS Upload] Error:', error)
              reject(new Error(`Upload failed: ${error.message}`))
            },
            onProgress: (bytesUploaded, bytesTotal) => {
              const percentage = Math.round((bytesUploaded / bytesTotal) * 100)
              setUploadProgress(percentage)
            },
            onSuccess: () => {
              console.log('[TUS Upload] Success!')
              setUploadProgress(100)
              resolve()
            },
          })

          // Check for previous uploads to resume
          upload.findPreviousUploads().then((previousUploads) => {
            if (previousUploads.length > 0) {
              console.log('[TUS Upload] Resuming previous upload...')
              upload.resumeFromPreviousUpload(previousUploads[0])
            }
            upload.start()
          })
        })
      } else {
        // Small file: use standard Supabase upload
        const { error: uploadError } = await supabase.storage
          .from('uploads')
          .upload(filePath, uploadFile, {
            contentType: uploadFile.type,
            upsert: false,
          })

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`)
        }
        
        setUploadProgress(100)
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('uploads')
        .getPublicUrl(filePath)

      // Determine the file type for parsing
      const detectedFileType = detectFileType(uploadFile.name, uploadFile.type)
      
      // Create upload record via API (bypasses RLS cache issues)
      const createResponse = await fetch('/api/uploads/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          fileUrl: publicUrl,
          kind: selectedTag === 'photo' ? 'photo' : selectedTag === 'blueprint' ? 'blueprint' : 'other',
          tag: selectedTag, // For blueprint parsing
          fileType: detectedFileType, // pdf, image, etc.
          originalFilename: uploadFile.name,
        })
      })
      
      const createResult = await createResponse.json()
      
      if (!createResponse.ok) {
        // Clean up uploaded file
        await supabase.storage.from('uploads').remove([filePath])
        throw new Error(`Failed to save file record: ${createResult.error}`)
      }

      toast.success('File uploaded successfully')
      setUploadFile(null)
      setSelectedTag('other')
      setUploadProgress(0)
      loadFiles()
    } catch (error) {
      console.error('Upload error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to upload file')
    } finally {
      setIsUploading(false)
      setUploadProgress(0)
    }
  }

  const handleDelete = async (fileId: string, fileUrl: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return

    try {
      // Extract file path from URL
      const urlParts = fileUrl.split('/')
      const filePath = urlParts.slice(urlParts.indexOf('files') || urlParts.indexOf('uploads')).join('/')

      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('uploads')
        .remove([filePath])

      if (storageError) {
        console.warn('Storage delete error (file may already be deleted):', storageError)
      }

      // Delete from database
      const { error: dbError } = await supabase
        .from('uploads')
        .delete()
        .eq('id', fileId)

      if (dbError) throw dbError

      toast.success('File deleted successfully')
      loadFiles()
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('Failed to delete file')
    }
  }

  const handleDownload = (fileUrl: string, fileName: string) => {
    const link = document.createElement('a')
    link.href = fileUrl
    link.download = fileName
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleUseInCopilot = (file: UploadType) => {
    if (onUseInCopilot) {
      onUseInCopilot(file.file_url, file.original_filename || 'File')
    } else {
      // Fallback: dispatch event to open copilot
      window.dispatchEvent(new CustomEvent('open-copilot', {
        detail: { 
          message: `Analyze this file: ${file.original_filename || 'File'}`,
          fileUrl: file.file_url
        }
      }))
      toast.info('Opening Copilot...')
    }
  }

  // Update file tag - try 'tag' column first, fallback to 'kind'
  const handleUpdateTag = async (fileId: string, newTag: FileTag) => {
    try {
      // Try updating 'tag' first
      const { error: tagError } = await supabase
        .from('uploads')
        .update({ tag: newTag })
        .eq('id', fileId)

      if (tagError) {
        // If tag column doesn't exist, try 'kind' column
        if (tagError.message.includes('schema cache') || tagError.message.includes('column')) {
          console.log('Tag column not found, updating kind instead')
          const { error: kindError } = await supabase
            .from('uploads')
            .update({ kind: newTag })
            .eq('id', fileId)
          
          if (kindError) throw kindError
        } else {
          throw tagError
        }
      }
      
      toast.success(`Changed tag to "${newTag}"`)
      loadFiles()
    } catch (error) {
      console.error('Update tag error:', error)
      toast.error('Failed to update tag')
    }
  }

  // Toggle file selection for parsing
  const toggleFileForParsing = (fileId: string) => {
    setSelectedFilesForParsing(prev => {
      const next = new Set(prev)
      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }
      return next
    })
  }

  // Get storage path from file URL
  const getStoragePath = (fileUrl: string | undefined | null): string => {
    if (!fileUrl) return ''
    // Extract storage path from public URL
    // Format: .../storage/v1/object/public/uploads/user_id/files/project_id/filename
    const match = fileUrl.match(/uploads\/(.+)$/)
    return match ? match[1] : fileUrl
  }

  // Parse selected blueprints (or a specific file if passed directly)
  const handleParseBlueprints = async (singleFile?: UploadType) => {
    // If a single file is passed (from dropdown), use it directly
    // Otherwise use the checkbox selection
    const filesToParse = singleFile
      ? [singleFile]
      : files.filter(f => selectedFilesForParsing.has(f.id))

    if (filesToParse.length === 0) {
      toast.error('Please select at least one file to parse')
      return
    }

    setIsParsing(true)
    try {
      // Auto-create estimate if none exists — but reuse existing draft first
      let activeEstimateId = estimateId
      if (!activeEstimateId) {
        // Check if there's already a draft estimate for this project
        const existingEstimates = await db.getEstimates(projectId)
        const existingDraft = existingEstimates.find(e => e.status === 'draft')
        
        if (existingDraft) {
          activeEstimateId = existingDraft.id
          console.log('[Parse] Reusing existing draft estimate:', activeEstimateId)
        } else {
          toast.info('Creating estimate for this project...')
          const newEstimate = await db.createEstimate({
            project_id: projectId,
            json_data: { items: [], assumptions: [], missing_info: [] },
          })
          activeEstimateId = newEstimate.id
          console.log('[Parse] Created new estimate:', activeEstimateId)
        }
        
        setActiveParseEstimateId(activeEstimateId)
        // Notify parent so it picks up the estimate
        onBlueprintParsed?.()
      } else {
        setActiveParseEstimateId(activeEstimateId)
      }

      // Convert file URLs to storage paths (skip any without URLs)
      const fileUrls = filesToParse
        .map(f => getStoragePath(f.file_url))
        .filter(url => url !== '')

      // Get upload IDs (filter nulls) as fallback for server-side URL resolution
      const uploadIds = filesToParse.map(f => f.id).filter(Boolean) as string[]
      const uploadId = uploadIds.length === 1 ? uploadIds[0] : undefined

      const needsServerResolve = fileUrls.length === 0
      if (needsServerResolve) {
        console.warn('[Parse] file_url missing on uploads, server will resolve from project blueprints')
      }

      const response = await fetch('/api/plans/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          estimateId: activeEstimateId,
          fileUrls: fileUrls.length > 0 ? fileUrls : ['__resolve_from_uploads__'],
          uploadId: uploadId || undefined,
          uploadIds: uploadIds.length > 0 ? uploadIds : undefined,
          resolveFromProject: needsServerResolve, // Tell server to look up blueprint files
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to parse plans')
      }

      // Always show results in review drawer, even on partial failure
      // This gives users the fallback room + actionable next steps
      setParseResult(result)
      setShowReviewDrawer(true)
      
      if (!result.success) {
        // Partial failure - still show drawer with fallback room
        toast.warning(
          "We couldn't fully read this plan",
          {
            description: 'You can still add rooms manually or try uploading clearer pages.',
            duration: 6000,
          }
        )
      } else if (result.rooms?.length === 0) {
        toast.warning('No rooms detected', {
          description: 'Try uploading individual floor plan pages or adding notes.',
          duration: 5000,
        })
      } else {
        toast.success(`Detected ${result.rooms?.length || 0} rooms`, {
          description: 'Review and edit before applying to your estimate.',
          duration: 4000,
        })
      }
    } catch (error) {
      console.error('Parse error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to parse plans'
      
      // Show user-friendly error with actionable next steps
      toast.error(
        "We couldn't read this plan yet",
        {
          description: getParseErrorHelpText(errorMessage),
          duration: 8000,
        }
      )
    } finally {
      setIsParsing(false)
    }
  }

  // Helper to get user-friendly error descriptions
  const getParseErrorHelpText = (errorMessage: string): string => {
    if (errorMessage.includes('OpenAI') || errorMessage.includes('API key')) {
      return 'AI service is temporarily unavailable. Try again later or add rooms manually.'
    }
    if (errorMessage.includes('scanned') || errorMessage.includes('image-only')) {
      return 'This looks like a scanned PDF. Try uploading individual floor plan images instead.'
    }
    if (errorMessage.includes('corrupted') || errorMessage.includes('invalid')) {
      return 'This file may be damaged. Try re-saving the PDF or uploading a different version.'
    }
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      return 'Processing took too long. Try uploading smaller files or fewer pages at once.'
    }
    return 'Try: (1) Upload clearer floor plan pages, (2) Add notes describing the scope, or (3) Create rooms manually.'
  }

  // Check if file is parseable (blueprint/spec, pdf/image)
  const isFileParseableForBlueprint = (file: UploadType): boolean => {
    // Check both 'tag' and 'kind' fields (kind is fallback if tag column doesn't exist)
    const tag = (file.tag || file.kind) as FileTag
    const fileType = file.file_type as FileType
    
    // Also try to detect file type from URL if file_type is missing
    const urlLower = file.file_url?.toLowerCase() || ''
    const isPdfOrImage = fileType === 'pdf' || fileType === 'image' || 
                         urlLower.endsWith('.pdf') || 
                         urlLower.endsWith('.png') || 
                         urlLower.endsWith('.jpg') || 
                         urlLower.endsWith('.jpeg')
    
    return (tag === 'blueprint' || tag === 'spec') && isPdfOrImage
  }

  // Get count of parseable files
  const parseableFiles = files.filter(isFileParseableForBlueprint)
  const selectedParseableCount = [...selectedFilesForParsing].filter(id => 
    files.find(f => f.id === id && isFileParseableForBlueprint(f))
  ).length


  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0])
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getTagBadgeVariant = (tag: FileTag | null | undefined) => {
    switch (tag) {
      case 'blueprint':
        return 'default'
      case 'spec':
        return 'secondary'
      case 'photo':
        return 'outline'
      default:
        return 'outline'
    }
  }

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        className={cn(
          'border-2 border-dashed rounded-lg p-6 transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-border',
          uploadFile ? 'bg-muted/50' : ''
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {!uploadFile ? (
          <div className="flex flex-col items-center justify-center gap-4">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">Drag and drop files here</p>
              <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
              <p className="text-xs text-muted-foreground mt-2">
                Maximum file size is 100MB. To upload larger blueprints: (1)&nbsp;Use Adobe Acrobat or
                SmallPDF.com to compress the PDF, or (2)&nbsp;Split into separate files per floor/section.
              </p>
            </div>
            <input
              type="file"
              id="file-upload"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleFileSelect(e.target.files[0])
                }
              }}
            />
            <Button
              variant="outline"
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              Select File
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {getFileTypeIcon(detectFileType(uploadFile.name, uploadFile.type))}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{uploadFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(uploadFile.size / 1024 / 1024).toFixed(2)} MB
                    {uploadFile.size > 20 * 1024 * 1024 && (
                      <span className="ml-2 text-amber-600">(large file)</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={selectedTag} onValueChange={(v) => setSelectedTag(v as FileTag)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAG_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleUpload}
                  disabled={isUploading}
                  size="sm"
                  className="min-h-[44px] sm:min-h-0"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {uploadProgress}%
                    </>
                  ) : (
                    'Upload'
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setUploadFile(null)}
                  disabled={isUploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Progress bar */}
            {isUploading && (
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-primary h-full transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Parse Plans Button */}
      {parseableFiles.length > 0 && (
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
          <div className="flex items-center gap-2 text-sm">
            <ScanLine className="h-4 w-4 text-primary" />
            <span>
              {selectedParseableCount > 0 
                ? `${selectedParseableCount} file${selectedParseableCount > 1 ? 's' : ''} selected for parsing`
                : 'Select blueprint/spec files to parse for rooms'
              }
            </span>
          </div>
          <Button
            onClick={() => handleParseBlueprints()}
            disabled={isParsing || selectedParseableCount === 0}
            size="sm"
          >
            {isParsing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Parsing...
              </>
            ) : (
              <>
                <ScanLine className="mr-2 h-4 w-4" />
                Parse Plans
              </>
            )}
          </Button>
        </div>
      )}

      {/* Files Table / Cards */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading files...</div>
      ) : files.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No files uploaded yet. Drag and drop files above to get started.
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="border rounded-lg hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {parseableFiles.length > 0 && (
                    <TableHead className="w-10">Parse</TableHead>
                  )}
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Tag</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => {
                  const isParseable = isFileParseableForBlueprint(file)
                  const isSelected = selectedFilesForParsing.has(file.id)
                  
                  return (
                    <TableRow key={file.id}>
                      {parseableFiles.length > 0 && (
                        <TableCell>
                          {isParseable ? (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleFileForParsing(file.id)}
                            />
                          ) : null}
                        </TableCell>
                      )}
                      <TableCell>
                        <button
                          onClick={() => window.open(file.file_url, '_blank')}
                          className="text-left hover:underline text-sm font-medium"
                        >
                          {file.original_filename || file.file_url.split('/').pop() || 'Untitled'}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getFileTypeIcon(file.file_type as FileType)}
                          <span className="text-xs text-muted-foreground capitalize">
                            {file.file_type || 'other'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getTagBadgeVariant((file.tag || file.kind) as FileTag)}>
                          {(file.tag || file.kind) as FileTag || 'other'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(file.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleDownload(
                                file.file_url,
                                file.original_filename || 'file'
                              )}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Download
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUseInCopilot(file)}
                            >
                              <Sparkles className="h-4 w-4 mr-2" />
                              Use in Copilot
                            </DropdownMenuItem>
                            {isParseable && (
                              <DropdownMenuItem
                                onClick={() => handleParseBlueprints(file)}
                              >
                                <ScanLine className="h-4 w-4 mr-2" />
                                Parse for Rooms
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-xs">Change Tag</DropdownMenuLabel>
                            {(file.tag || file.kind) !== 'blueprint' && (
                              <DropdownMenuItem onClick={() => handleUpdateTag(file.id, 'blueprint')}>
                                📐 Blueprint
                              </DropdownMenuItem>
                            )}
                            {(file.tag || file.kind) !== 'spec' && (
                              <DropdownMenuItem onClick={() => handleUpdateTag(file.id, 'spec')}>
                                📄 Spec
                              </DropdownMenuItem>
                            )}
                            {(file.tag || file.kind) !== 'photo' && (
                              <DropdownMenuItem onClick={() => handleUpdateTag(file.id, 'photo')}>
                                📷 Photo
                              </DropdownMenuItem>
                            )}
                            {(file.tag || file.kind) !== 'other' && (file.tag || file.kind) && (
                              <DropdownMenuItem onClick={() => handleUpdateTag(file.id, 'other')}>
                                📁 Other
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(file.id, file.file_url)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card List */}
          <div className="space-y-3 md:hidden">
            {files.map((file) => {
              const isParseable = isFileParseableForBlueprint(file)
              const isSelected = selectedFilesForParsing.has(file.id)

              return (
                <div key={file.id} className="border rounded-lg p-4 bg-card space-y-3">
                  {/* Top row: icon + name + actions */}
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {getFileTypeIcon(file.file_type as FileType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => window.open(file.file_url, '_blank')}
                        className="text-left hover:underline text-sm font-medium truncate block w-full"
                      >
                        {file.original_filename || file.file_url.split('/').pop() || 'Untitled'}
                      </button>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground capitalize">
                          {file.file_type || 'other'}
                        </span>
                        <Badge variant={getTagBadgeVariant((file.tag || file.kind) as FileTag)} className="text-xs">
                          {(file.tag || file.kind) as FileTag || 'other'}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDate(file.created_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isParseable && parseableFiles.length > 0 && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleFileForParsing(file.id)}
                          className="mr-1"
                        />
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-9 w-9">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleDownload(
                              file.file_url,
                              file.original_filename || 'file'
                            )}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleUseInCopilot(file)}
                          >
                            <Sparkles className="h-4 w-4 mr-2" />
                            Use in Copilot
                          </DropdownMenuItem>
                          {isParseable && (
                            <DropdownMenuItem
                              onClick={() => handleParseBlueprints(file)}
                            >
                              <ScanLine className="h-4 w-4 mr-2" />
                              Parse for Rooms
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs">Change Tag</DropdownMenuLabel>
                          {(file.tag || file.kind) !== 'blueprint' && (
                            <DropdownMenuItem onClick={() => handleUpdateTag(file.id, 'blueprint')}>
                              📐 Blueprint
                            </DropdownMenuItem>
                          )}
                          {(file.tag || file.kind) !== 'spec' && (
                            <DropdownMenuItem onClick={() => handleUpdateTag(file.id, 'spec')}>
                              📄 Spec
                            </DropdownMenuItem>
                          )}
                          {(file.tag || file.kind) !== 'photo' && (
                            <DropdownMenuItem onClick={() => handleUpdateTag(file.id, 'photo')}>
                              📷 Photo
                            </DropdownMenuItem>
                          )}
                          {(file.tag || file.kind) !== 'other' && (file.tag || file.kind) && (
                            <DropdownMenuItem onClick={() => handleUpdateTag(file.id, 'other')}>
                              📁 Other
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDelete(file.id, file.file_url)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Blueprint Review Drawer */}
      {effectiveEstimateId && (
        <BlueprintReviewDrawer
          open={showReviewDrawer}
          onOpenChange={setShowReviewDrawer}
          parseResult={parseResult}
          projectId={projectId}
          estimateId={effectiveEstimateId}
          onApplyComplete={() => {
            setSelectedFilesForParsing(new Set())
            setParseResult(null)
            setActiveParseEstimateId(undefined)
            onBlueprintParsed?.()
          }}
          onReparse={() => handleParseBlueprints()}
          isReparsing={isParsing}
        />
      )}
    </div>
  )
}





