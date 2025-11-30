'use client'

import type { Project } from "@/types/db"

interface ProposalsTabProps {
  project: Project
}

export function ProposalsTab({ project }: ProposalsTabProps) {
  return (
    <div className="p-6 text-muted-foreground">
      Feature coming soon...
    </div>
  )
}


