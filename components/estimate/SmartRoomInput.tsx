'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Check, ChevronDown } from 'lucide-react'

interface SmartRoomInputProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
  options?: string[]
}

const DEFAULT_ROOM_OPTIONS = [
  "Primary Bedroom", "Primary Bath",
  "Bedroom 1", "Bath 1",
  "Bedroom 2", "Bath 2",
  "Bedroom 3", "Bath 3",
  "Guest Bedroom", "Guest Bath",
  "Powder", "Kitchen", "Pantry",
  "Living/Family", "Dining",
  "Mudroom", "Pool Bath",
  "Bar", "Garage"
]

// Room name aliases - maps common variations to canonical room names
const ROOM_ALIASES: Record<string, string> = {
  // Living/Family variations
  "family room": "Living/Family",
  "family": "Living/Family",
  "living room": "Living/Family",
  "living": "Living/Family",
  "great room": "Living/Family",
  "greatroom": "Living/Family",
  
  // Primary Bedroom variations
  "master bedroom": "Primary Bedroom",
  "master": "Primary Bedroom",
  "main bedroom": "Primary Bedroom",
  
  // Primary Bath variations
  "master bath": "Primary Bath",
  "master bathroom": "Primary Bath",
  "main bath": "Primary Bath",
  "main bathroom": "Primary Bath",
  
  // Kitchen variations
  "kitchen": "Kitchen",
  
  // Dining variations
  "dining room": "Dining",
  "dining": "Dining",
  
  // Powder variations
  "powder room": "Powder",
  "powder": "Powder",
  "half bath": "Powder",
  "half bathroom": "Powder",
  
  // Garage variations
  "garage": "Garage",
  
  // Mudroom variations
  "mud room": "Mudroom",
  "mudroom": "Mudroom",
  
  // Pool Bath variations
  "pool bathroom": "Pool Bath",
  "pool bath": "Pool Bath",
}

// Helper function to normalize room name and find canonical match
function normalizeRoomName(input: string, options: string[]): string | null {
  if (!input || !input.trim()) return null
  
  const normalized = input.toLowerCase().trim()
  
  // Check direct alias match
  if (ROOM_ALIASES[normalized]) {
    return ROOM_ALIASES[normalized]
  }
  
  // Check if input matches any option (case-insensitive)
  const exactMatch = options.find(opt => opt.toLowerCase() === normalized)
  if (exactMatch) {
    return exactMatch
  }
  
  // Check if input contains or is contained by any option
  const containsMatch = options.find(opt => {
    const optLower = opt.toLowerCase()
    return optLower.includes(normalized) || normalized.includes(optLower)
  })
  if (containsMatch) {
    return containsMatch
  }
  
  // Check partial word matches (e.g., "family" matches "Living/Family")
  const words = normalized.split(/\s+/)
  for (const word of words) {
    if (word.length >= 3) { // Only match words with 3+ characters
      const wordMatch = options.find(opt => {
        const optLower = opt.toLowerCase()
        return optLower.includes(word) || optLower.split(/[\/\s]+/).some(part => part === word)
      })
      if (wordMatch) {
        return wordMatch
      }
    }
  }
  
  return null
}

export function SmartRoomInput({
  value,
  onChange,
  onBlur,
  placeholder = "Select or type room name",
  className,
  options = DEFAULT_ROOM_OPTIONS
}: SmartRoomInputProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState(value || '')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Update input value when prop value changes
  useEffect(() => {
    setInputValue(value || '')
  }, [value])

  // Filter options based on input value for autocomplete, but always show all options in dropdown
  const filteredOptions = React.useMemo(() => {
    if (!inputValue.trim()) {
      return options
    }
    const lowerInput = inputValue.toLowerCase()
    
    // Check if input matches any alias
    const aliasMatch = ROOM_ALIASES[lowerInput]
    if (aliasMatch) {
      return [aliasMatch]
    }
    
    // Filter options that match the input
    return options.filter(option => {
      const optLower = option.toLowerCase()
      // Direct match
      if (optLower.includes(lowerInput) || lowerInput.includes(optLower)) {
        return true
      }
      // Check if any word in input matches any part of option
      const inputWords = lowerInput.split(/\s+/)
      const optionParts = optLower.split(/[\/\s]+/)
      return inputWords.some(word => 
        word.length >= 3 && optionParts.some(part => part.includes(word) || word.includes(part))
      )
    })
  }, [inputValue, options])

  // Always show all options in dropdown (for selection), but highlight filtered matches
  const displayOptions = React.useMemo(() => {
    // Always show all predefined options so user can always select from the list
    return options
  }, [options])

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    setIsOpen(true)
    setHighlightedIndex(-1)
    
    // Try to find a canonical match for the input
    const canonicalMatch = normalizeRoomName(newValue, options)
    if (canonicalMatch) {
      // If we found a match, use the canonical name
      onChange(canonicalMatch)
    } else {
      // Otherwise, use the typed value (custom room)
      onChange(newValue)
    }
  }

  // Handle option selection
  const handleSelectOption = (option: string) => {
    setInputValue(option)
    setIsOpen(false)
    onChange(option)
    inputRef.current?.blur()
  }

  // Handle input focus
  const handleFocus = () => {
    setIsOpen(true)
  }

  // Handle input blur
  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Delay to allow option click to fire
    setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setIsOpen(false)
        setHighlightedIndex(-1)
        
        // Normalize the room name on blur (e.g., "family room" -> "Living/Family")
        if (inputValue.trim()) {
          const canonicalMatch = normalizeRoomName(inputValue, options)
          if (canonicalMatch && canonicalMatch !== inputValue) {
            // Update to canonical name if a match was found
            setInputValue(canonicalMatch)
            onChange(canonicalMatch)
          }
        }
        
        onBlur?.()
      }
    }, 200)
  }

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true)
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev => {
        const next = prev < options.length - 1 ? prev + 1 : prev
        // Scroll into view
        if (listRef.current && next >= 0) {
          const items = listRef.current.children
          if (items[next]) {
            items[next].scrollIntoView({ block: 'nearest' })
          }
        }
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => {
        const next = prev > 0 ? prev - 1 : -1
        // Scroll into view
        if (listRef.current && next >= 0) {
          const items = listRef.current.children
          if (items[next]) {
            items[next].scrollIntoView({ block: 'nearest' })
          }
        }
        return next
      })
    } else if (e.key === 'Enter' && highlightedIndex >= 0 && options[highlightedIndex]) {
      e.preventDefault()
      handleSelectOption(options[highlightedIndex])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setHighlightedIndex(-1)
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pr-8"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
          <ChevronDown className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )} />
        </div>
      </div>

      {/* Dropdown list - always show all predefined options */}
      {isOpen && (
        <ul
          ref={listRef}
          className="absolute z-50 w-full mt-1 max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {displayOptions.map((option, index) => {
            const isHighlighted = index === highlightedIndex
            const isSelected = value === option
            // Highlight options that match the current input (for autocomplete feedback)
            const matchesInput = inputValue.trim() && option.toLowerCase().includes(inputValue.toLowerCase())

            return (
              <li
                key={option}
                onClick={() => handleSelectOption(option)}
                className={cn(
                  "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  isHighlighted && "bg-accent text-accent-foreground",
                  isSelected && "font-medium",
                  matchesInput && !isSelected && "bg-accent/50"
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                {isSelected && (
                  <Check className="mr-2 h-4 w-4" />
                )}
                <span>{option}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

