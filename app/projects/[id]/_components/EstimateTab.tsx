'use client'

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EstimateTable } from "@/components/estimate/EstimateTable"
import { Recorder } from "@/components/voice/Recorder"
import type { Project, Estimate } from "@/types/db"
import { Mic, FileText, Trash2 } from "lucide-react"

interface EstimateTabProps {
  project: Project
  projectId: string
  estimates: Estimate[]
  activeEstimateId: string | null
  setActiveEstimateId: (id: string | null) => void
  deletingEstimateId: string | null
  onDeleteEstimate: (estimateId: string) => Promise<void>
  onSave: (estimateId: string, total: number) => void
  onRecordingComplete: (audioBlob: Blob, transcript: string) => Promise<void>
  isParsing: boolean
}

export function EstimateTab({
  project,
  projectId,
  estimates,
  activeEstimateId,
  setActiveEstimateId,
  deletingEstimateId,
  onDeleteEstimate,
  onSave,
  onRecordingComplete,
  isParsing
}: EstimateTabProps) {
  const [showRecorder, setShowRecorder] = useState(false)

  const activeEstimate = activeEstimateId ? estimates.find(e => e.id === activeEstimateId) ?? null : null
  const estimateData = activeEstimate?.json_data as any || { items: [], assumptions: [], missing_info: [] }

  const handleRecordingComplete = async (audioBlob: Blob, transcript: string) => {
    await onRecordingComplete(audioBlob, transcript)
    setShowRecorder(false)
  }

  return (
    <div className="space-y-4">
      {/* Create Estimate Button */}
      <div className="flex justify-end">
        <Button
          onClick={() => setShowRecorder(!showRecorder)}
          variant="default"
          disabled={isParsing}
        >
          {isParsing ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Creating Estimate...
            </>
          ) : (
            <>
              <Mic className="mr-2 h-4 w-4" />
              {showRecorder ? 'Cancel Recording' : 'Create Estimate with Voice'}
            </>
          )}
        </Button>
      </div>

      {/* Recorder Component */}
      {showRecorder && (
        <Card>
          <CardHeader>
            <CardTitle>Record Project Description</CardTitle>
            <CardDescription>
              Describe your project by voice. The AI will parse your description and create line items.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Recorder
              projectId={projectId}
              onRecordingComplete={handleRecordingComplete}
            />
          </CardContent>
        </Card>
      )}

      {/* Select Estimate (if multiple) */}
      {estimates.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Select Estimate</CardTitle>
            <CardDescription>
              Choose which estimate to view or edit
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {estimates.map((estimate) => (
                <div key={estimate.id} className="flex items-center gap-1">
                  <Button
                    variant={activeEstimateId === estimate.id ? "default" : "outline"}
                    onClick={() => setActiveEstimateId(estimate.id)}
                    className="flex items-center gap-2"
                  >
                    <FileText className="h-4 w-4" />
                    {new Date(estimate.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric'
                    })}
                    {estimate.total && (
                      <span className="ml-2">${estimate.total.toLocaleString()}</span>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteEstimate(estimate.id)}
                    disabled={deletingEstimateId === estimate.id}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    {deletingEstimateId === estimate.id ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-destructive border-t-transparent" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Summary */}
      {activeEstimate && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">AI Summary</CardTitle>
              {estimates.length === 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDeleteEstimate(activeEstimate.id)}
                  disabled={deletingEstimateId === activeEstimate.id}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  {deletingEstimateId === activeEstimate.id ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-destructive border-t-transparent" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Estimate
                    </>
                  )}
                </Button>
              )}
            </div>
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

      {/* Estimate Table */}
      <div className="relative">
        {estimates.length > 1 && activeEstimateId && (
          <div className="absolute top-0 right-0 z-10">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeleteEstimate(activeEstimateId)}
              disabled={deletingEstimateId === activeEstimateId}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              {deletingEstimateId === activeEstimateId ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-destructive border-t-transparent" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Estimate
                </>
              )}
            </Button>
          </div>
        )}
        <EstimateTable
          projectId={projectId}
          estimateId={activeEstimateId}
          initialData={estimateData || { items: [], assumptions: [], missing_info: [] }}
          onSave={onSave}
        />
      </div>
    </div>
  )
}

