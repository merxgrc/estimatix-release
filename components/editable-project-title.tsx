'use client'

import { useState, useRef, useEffect } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EditableProjectTitleProps {
  title: string
  onSave: (newTitle: string) => Promise<void>
  className?: string
  variant?: 'default' | 'large' | 'card'
  disabled?: boolean
}

export function EditableProjectTitle({ 
  title, 
  onSave, 
  className,
  variant = 'default',
  disabled = false 
}: EditableProjectTitleProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedTitle, setEditedTitle] = useState(title)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Update local state when title prop changes
  useEffect(() => {
    setEditedTitle(title)
  }, [title])

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    if (disabled) return
    setIsEditing(true)
    setEditedTitle(title)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditedTitle(title)
  }

  const handleSave = async () => {
    const trimmedTitle = editedTitle.trim()
    if (!trimmedTitle) {
      // Don't allow empty titles
      setEditedTitle(title)
      setIsEditing(false)
      return
    }

    if (trimmedTitle === title) {
      // No change, just cancel
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave(trimmedTitle)
      setIsEditing(false)
    } catch (error) {
      console.error('Error saving project title:', error)
      alert('Failed to save project title. Please try again.')
      setEditedTitle(title) // Revert on error
    } finally {
      setIsSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  const sizeClasses = {
    default: 'text-xl font-semibold',
    large: 'text-2xl font-bold',
    card: 'text-lg font-semibold'
  }

  if (isEditing) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <input
          ref={inputRef}
          type="text"
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          className={cn(
            'flex-1 border border-primary rounded-md px-2 py-1',
            'focus:outline-none focus:ring-2 focus:ring-primary',
            sizeClasses[variant]
          )}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSave}
          disabled={isSaving}
          className="h-8 w-8 p-0"
        >
          {isSaving ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Check className="h-4 w-4 text-green-600" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCancel}
          disabled={isSaving}
          className="h-8 w-8 p-0"
        >
          <X className="h-4 w-4 text-red-600" />
        </Button>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-2 group', className)}>
      <h1 
        className={cn(sizeClasses[variant], 'cursor-pointer hover:text-primary transition-colors')}
        onClick={handleStartEdit}
        title="Click to edit"
      >
        {title}
      </h1>
      {!disabled && (
        <Button
          size="sm"
          variant="ghost"
          onClick={handleStartEdit}
          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Edit project name"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

