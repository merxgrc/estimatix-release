'use client'

import { useState, useRef, useEffect } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface EditableFieldProps {
  label: string
  value: string | null
  onSave: (newValue: string) => Promise<void>
  placeholder?: string
  multiline?: boolean
  className?: string
  disabled?: boolean
}

export function EditableField({ 
  label, 
  value, 
  onSave, 
  placeholder = '',
  multiline = false,
  className,
  disabled = false 
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedValue, setEditedValue] = useState(value || '')
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  // Update local state when value prop changes
  useEffect(() => {
    setEditedValue(value || '')
  }, [value])

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      if (!multiline) {
        (inputRef.current as HTMLInputElement).select()
      }
    }
  }, [isEditing, multiline])

  const handleStartEdit = () => {
    if (disabled) return
    setIsEditing(true)
    setEditedValue(value || '')
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditedValue(value || '')
  }

  const handleSave = async () => {
    const trimmedValue = editedValue.trim()
    
    // Allow empty values (user can clear the field)
    if (trimmedValue === (value || '')) {
      // No change, just cancel
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave(trimmedValue || '')
      setIsEditing(false)
    } catch (error) {
      console.error(`Error saving ${label}:`, error)
      alert(`Failed to save ${label.toLowerCase()}. Please try again.`)
      setEditedValue(value || '') // Revert on error
    } finally {
      setIsSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Enter' && multiline && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  if (isEditing) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        <div className="flex items-start gap-2">
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={editedValue}
              onChange={(e) => setEditedValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSaving}
              placeholder={placeholder}
              rows={3}
              className={cn(
                'flex-1 border border-primary rounded-md px-2 py-1',
                'focus:outline-none focus:ring-2 focus:ring-primary',
                'resize-none'
              )}
            />
          ) : (
            <Input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={editedValue}
              onChange={(e) => setEditedValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSaving}
              placeholder={placeholder}
              className="flex-1"
            />
          )}
          <div className="flex gap-1">
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
        </div>
      </div>
    )
  }

  return (
    <div className={cn('group', className)}>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        {!disabled && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleStartEdit}
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            title={`Edit ${label.toLowerCase()}`}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div 
        className={cn(
          'mt-1 text-sm',
          value ? 'text-foreground' : 'text-muted-foreground italic',
          !disabled && 'cursor-pointer hover:text-primary transition-colors'
        )}
        onClick={handleStartEdit}
        title={disabled ? undefined : "Click to edit"}
      >
        {value || placeholder || `Click to add ${label.toLowerCase()}`}
      </div>
    </div>
  )
}

