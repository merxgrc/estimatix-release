'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EstimateTable } from "@/components/estimate/EstimateTable"
import { Recorder } from "@/components/voice/Recorder"
import type { Project, Estimate, EstimateStatus } from "@/types/db"
import { Mic, FileText, Trash2, CheckCircle, FileSignature, Loader2, MapPin, Settings } from "lucide-react"
import { finalizeBid, markContractSigned } from "@/actions/estimate-lifecycle"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth-context"
import Link from "next/link"

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
  onEstimateStatusChange?: () => void // Callback to refresh estimates after status change
}

/**
 * Get display info for estimate status
 */
function getStatusBadge(status: EstimateStatus | null | undefined) {
  switch (status) {
    case 'draft':
      return { label: 'Draft', variant: 'outline' as const, className: 'bg-gray-100 text-gray-700 border-gray-300' }
    case 'bid_final':
      return { label: 'Bid Finalized', variant: 'default' as const, className: 'bg-blue-100 text-blue-800 border-blue-300' }
    case 'contract_signed':
      return { label: 'Contract Signed', variant: 'default' as const, className: 'bg-green-100 text-green-800 border-green-300' }
    case 'completed':
      return { label: 'Completed', variant: 'default' as const, className: 'bg-purple-100 text-purple-800 border-purple-300' }
    default:
      return { label: 'Draft', variant: 'outline' as const, className: 'bg-gray-100 text-gray-700 border-gray-300' }
  }
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
  isParsing,
  onEstimateStatusChange
}: EstimateTabProps) {
  const { user } = useAuth()
  const [showRecorder, setShowRecorder] = useState(false)
  const [estimateStatus, setEstimateStatus] = useState<EstimateStatus | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [userRegion, setUserRegion] = useState<string | null>(null)
  const [regionLoaded, setRegionLoaded] = useState(false)

  const activeEstimate = activeEstimateId ? estimates.find(e => e.id === activeEstimateId) ?? null : null
  const estimateData = activeEstimate?.json_data as any || { items: [], assumptions: [], missing_info: [] }

  // Fetch user's region from profile settings
  useEffect(() => {
    const fetchUserRegion = async () => {
      if (!user?.id) {
        setRegionLoaded(true)
        return
      }
      
      try {
        const { data } = await supabase
          .from('user_profile_settings')
          .select('region')
          .eq('user_id', user.id)
          .maybeSingle()
        
        setUserRegion(data?.region || null)
      } catch (err) {
        console.error('Error fetching user region:', err)
      } finally {
        setRegionLoaded(true)
      }
    }
    
    fetchUserRegion()
  }, [user?.id])

  // Fetch estimate status when active estimate changes
  const fetchEstimateStatus = useCallback(async () => {
    if (!activeEstimateId) {
      setEstimateStatus(null)
      return
    }
    
    try {
      const { data, error } = await supabase
        .from('estimates')
        .select('status')
        .eq('id', activeEstimateId)
        .single()
      
      if (!error && data) {
        setEstimateStatus(data.status as EstimateStatus)
      }
    } catch (err) {
      console.error('Error fetching estimate status:', err)
    }
  }, [activeEstimateId])

  useEffect(() => {
    fetchEstimateStatus()
  }, [fetchEstimateStatus])

  // Handle Finalize Bid
  const handleFinalizeBid = async () => {
    if (!activeEstimateId) return
    
    setIsTransitioning(true)
    try {
      const result = await finalizeBid(activeEstimateId)
      
      if (result.success) {
        toast.success('Bid finalized successfully! Pricing has been locked.')
        setEstimateStatus('bid_final')
        onEstimateStatusChange?.()
      } else {
        toast.error(result.error || 'Failed to finalize bid')
      }
    } catch (err) {
      toast.error('An error occurred while finalizing the bid')
    } finally {
      setIsTransitioning(false)
    }
  }

  // Handle Mark Contract Signed
  const handleMarkContractSigned = async () => {
    if (!activeEstimateId) return
    
    setIsTransitioning(true)
    try {
      const result = await markContractSigned(activeEstimateId)
      
      if (result.success) {
        toast.success('Contract marked as signed! Project is ready for work.')
        setEstimateStatus('contract_signed')
        onEstimateStatusChange?.()
      } else {
        toast.error(result.error || 'Failed to mark contract signed')
      }
    } catch (err) {
      toast.error('An error occurred while marking contract signed')
    } finally {
      setIsTransitioning(false)
    }
  }

  const statusBadge = getStatusBadge(estimateStatus)

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

      {/* Region Warning - shown if region is not set */}
      {regionLoaded && !userRegion && estimateStatus === 'draft' && (
        <Alert className="border-amber-200 bg-amber-50">
          <MapPin className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 flex items-center justify-between">
            <span>
              <strong>Region not set.</strong> Set your region in settings to improve pricing accuracy.
            </span>
            <Link href="/onboarding/pricing">
              <Button variant="ghost" size="sm" className="text-amber-700 hover:text-amber-900 hover:bg-amber-100">
                <Settings className="h-4 w-4 mr-1" />
                Set Region
              </Button>
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Estimate Status & Actions */}
      {activeEstimate && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-lg">Estimate Status</CardTitle>
                <Badge variant={statusBadge.variant} className={statusBadge.className}>
                  {statusBadge.label}
                </Badge>
                {userRegion && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {userRegion}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Finalize Bid Button - only show when draft */}
                {estimateStatus === 'draft' && (
                  <Button
                    onClick={handleFinalizeBid}
                    disabled={isTransitioning}
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isTransitioning ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="mr-2 h-4 w-4" />
                    )}
                    Finalize Bid
                  </Button>
                )}
                
                {/* Mark Contract Signed Button - only show when bid_final */}
                {estimateStatus === 'bid_final' && (
                  <Button
                    onClick={handleMarkContractSigned}
                    disabled={isTransitioning}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isTransitioning ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileSignature className="mr-2 h-4 w-4" />
                    )}
                    Mark Contract Signed
                  </Button>
                )}
                
                {estimates.length === 1 && estimateStatus === 'draft' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteEstimate(activeEstimate.id)}
                    disabled={deletingEstimateId === activeEstimate.id}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    {deletingEstimateId === activeEstimate.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
            {/* Status explanation */}
            <CardDescription className="mt-2">
              {estimateStatus === 'draft' && 'This estimate is in draft mode. Finalize the bid when pricing is complete.'}
              {estimateStatus === 'bid_final' && 'Bid has been finalized. Mark as contract signed when the client accepts.'}
              {estimateStatus === 'contract_signed' && 'Contract is signed. You can now track progress and close out when complete.'}
              {estimateStatus === 'completed' && 'This project has been completed and closed out.'}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* AI Summary */}
      {activeEstimate && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">AI Summary</CardTitle>
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

