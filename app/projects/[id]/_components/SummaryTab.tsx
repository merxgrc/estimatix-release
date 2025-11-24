'use client'

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EditableProjectTitle } from "@/components/editable-project-title"
import { EditableField } from "@/components/editable-field"
import type { Project, Estimate } from "@/types/db"
import { Calendar, FileText, DollarSign, ArrowRight } from "lucide-react"

interface SummaryTabProps {
  project: Project
  activeEstimate: Estimate | null
  estimates: Estimate[]
  onUpdateTitle: (newTitle: string) => Promise<void>
  onUpdateOwner: (ownerName: string) => Promise<void>
  onUpdateAddress: (address: string) => Promise<void>
  onNavigateToEstimate: () => void
}

export function SummaryTab({
  project,
  activeEstimate,
  estimates,
  onUpdateTitle,
  onUpdateOwner,
  onUpdateAddress,
  onNavigateToEstimate
}: SummaryTabProps) {
  return (
    <div className="space-y-6">
      {/* Project Info Card */}
      <Card>
        <CardHeader>
          <EditableProjectTitle
            title={project.title}
            onSave={onUpdateTitle}
            variant="card"
            className="mb-0"
          />
          <CardDescription>
            <div className="space-y-3 mt-3">
              <EditableField
                label="Owner"
                value={project.owner_name}
                onSave={onUpdateOwner}
                placeholder="Property owner name"
              />
              <EditableField
                label="Address"
                value={project.project_address}
                onSave={onUpdateAddress}
                placeholder="Property address"
                multiline
              />
            </div>
            {project.client_name && (
              <div className="mt-3">
                <span className="text-sm text-muted-foreground">Client: {project.client_name}</span>
              </div>
            )}
            <div className="flex items-center gap-4 mt-3 text-sm">
              <div className="flex items-center text-muted-foreground">
                <Calendar className="mr-2 h-4 w-4" />
                Created {new Date(project.created_at).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </div>
              {estimates.length > 0 && (
                <div className="flex items-center text-muted-foreground">
                  <FileText className="mr-2 h-4 w-4" />
                  {estimates.length} {estimates.length === 1 ? 'estimate' : 'estimates'}
                </div>
              )}
              {activeEstimate?.total && (
                <div className="flex items-center text-muted-foreground">
                  <DollarSign className="mr-2 h-4 w-4" />
                  ${activeEstimate.total.toLocaleString()}
                </div>
              )}
            </div>
          </CardDescription>
        </CardHeader>
        {project.notes && (
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-line">
              {project.notes}
            </p>
          </CardContent>
        )}
      </Card>

      {/* AI Summary (Read-only) */}
      {activeEstimate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">AI Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const summary = activeEstimate.ai_summary
              // Check if it's the debug text pattern
              const isDebugText = summary && /Parsed \d+ specification sections and \d+ line items from transcript/i.test(summary)
              
              if (summary && !isDebugText) {
                // Show real AI summary
                return (
                  <p className="text-sm text-muted-foreground">
                    {summary}
                  </p>
                )
              } else {
                // Show placeholder
                return (
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>No AI summary available yet.</p>
                    <p>
                      After running the Walk-n-Talk feature or uploading documents, Estimatix will generate a clean project summary including:
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Main scopes of work</li>
                      <li>Key trades involved</li>
                      <li>Major cost drivers</li>
                      <li>High-level project description</li>
                    </ul>
                    <p className="mt-3">
                      You can fill in missing details manually or through voice recording.
                    </p>
                  </div>
                )
              }
            })()}
          </CardContent>
        </Card>
      )}

      {/* Missing Information (Read-only) */}
      {activeEstimate && activeEstimate.json_data && (
        (() => {
          const estimateData = activeEstimate.json_data as any
          const missingInfo = estimateData.missing_info || []
          if (missingInfo.length > 0) {
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Missing Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                    {missingInfo.map((info: string, index: number) => (
                      <li key={index}>{info}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )
          }
          return null
        })()
      )}

      {/* Link to Estimate Tab */}
      <Card>
        <CardContent className="pt-6">
          <Button onClick={onNavigateToEstimate} className="w-full" variant="default">
            Go to Estimate
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

