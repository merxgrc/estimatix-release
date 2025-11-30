'use client'

import type { Project } from "@/types/db"

interface PhotosTabProps {
  project: Project
}

export function PhotosTab({ project }: PhotosTabProps) {
  return (
    <div className="p-6 text-muted-foreground">
      Feature coming soon...
    </div>
  )
}


