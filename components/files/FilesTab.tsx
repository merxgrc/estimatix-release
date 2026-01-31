'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
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
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type { Upload as UploadType } from '@/types/db'
import { cn } from '@/lib/utils'

interface FilesTabProps {
  projectId: string
  onUseInCopilot?: (fileUrl: string, fileName: string) => void
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
      return <FileText className="h-4 w-4 text-red-500" />
    case 'image':
      return <ImageIcon className="h-4 w-4 text-blue-500" />
    case 'audio':
      return <FileAudio className="h-4 w-4 text-green-500" />
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

export function FilesTab({ projectId, onUseInCopilot }: FilesTabProps) {
  const { user } = useAuth()
  const [files, setFiles] = useState<UploadType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [selectedTag, setSelectedTag] = useState<FileTag>('other')
  const [dragActive, setDragActive] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)

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
    const fileType = detectFileType(file.name, file.type)
    setUploadFile(file)
    setSelectedTag(fileType === 'image' ? 'photo' : fileType === 'pdf' ? 'spec' : 'other')
  }

  const handleUpload = async () => {
    if (!uploadFile || !user) {
      toast.error('Please select a file to upload')
      return
    }

    try {
      setIsUploading(true)

      // Upload to Supabase Storage
      const fileExt = uploadFile.name.split('.').pop()
      const timestamp = Date.now()
      const sanitizedFileName = uploadFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')
      const filePath = `${user.id}/files/${projectId}/${timestamp}-${sanitizedFileName}`

      const { error: uploadError } = await supabase.storage
        .from('uploads')
        .upload(filePath, uploadFile, {
          contentType: uploadFile.type,
          upsert: false
        })

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`)
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('uploads')
        .getPublicUrl(filePath)

      // Detect file type
      const fileType = detectFileType(uploadFile.name, uploadFile.type)

      // Create upload record
      const { data: newUpload, error: dbError } = await supabase
        .from('uploads')
        .insert({
          project_id: projectId,
          file_url: publicUrl,
          kind: selectedTag === 'photo' ? 'photo' : selectedTag === 'blueprint' ? 'blueprint' : 'other',
          original_filename: uploadFile.name,
          file_type: fileType,
          tag: selectedTag,
          user_id: user.id
        } as any)
        .select()
        .single()

      if (dbError) {
        // Clean up uploaded file
        await supabase.storage.from('uploads').remove([filePath])
        throw new Error(`Failed to save file record: ${dbError.message}`)
      }

      toast.success('File uploaded successfully')
      setUploadFile(null)
      setSelectedTag('other')
      loadFiles()
    } catch (error) {
      console.error('Upload error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to upload file')
    } finally {
      setIsUploading(false)
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
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1">
              {getFileTypeIcon(detectFileType(uploadFile.name, uploadFile.type))}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{uploadFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(uploadFile.size / 1024 / 1024).toFixed(2)} MB
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
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setUploadFile(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Files Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading files...</div>
      ) : files.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No files uploaded yet. Drag and drop files above to get started.
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id}>
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
                    <Badge variant={getTagBadgeVariant(file.tag as FileTag)}>
                      {(file.tag as FileTag) || 'other'}
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}





