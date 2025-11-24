'use client'

import type { Project } from "@/types/db"

interface RoomsTabProps {
  project: Project
}

export function RoomsTab({ project }: RoomsTabProps) {
  return (
    <div className="p-6 text-muted-foreground">
      Feature coming soon...
    </div>
  )
}

