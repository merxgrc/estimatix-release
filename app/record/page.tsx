'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from "@/components/sidebar"
import { Recorder } from "@/components/voice/Recorder"
import { EstimateTable } from "@/components/estimate/EstimateTable"
import { EstimateChat } from "@/components/estimate/EstimateChat"
import { UserMenu } from "@/components/user-menu"
import { AuthGuard } from "@/components/auth-guard"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Sparkles, Mic } from "lucide-react"
import { supabase } from "@/lib/supabase/client"
import { useSidebar } from "@/lib/sidebar-context"
import type { EstimateData } from "@/types/estimate"

interface ProjectIntakeData {
  projectName: string
  clientName: string
  clientAddress: string
  projectDescription: string
}

const STORAGE_KEY = 'estimatix:project-intake'

export default function RecordPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { sidebarWidth, isCollapsed } = useSidebar()
  const [currentStep, setCurrentStep] = useState<'record' | 'parse' | 'estimate'>('record')
  const [transcript, setTranscript] = useState('')
  const [estimateData, setEstimateData] = useState<EstimateData | null>(null)
  const [estimateId, setEstimateId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [projectInfo, setProjectInfo] = useState<ProjectIntakeData | null>(null)
  const [isCreatingProject, setIsCreatingProject] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        setProjectInfo(JSON.parse(saved))
      } catch {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    }
  }, [])

  // Create project when projectInfo is available
  useEffect(() => {
    const createProjectIfNeeded = async () => {
      if (!projectInfo || !user || projectId) return

      setIsCreatingProject(true)
      try {
        if (!user || !user.id) {
          setParseError('You must be logged in to create a project')
          setIsCreatingProject(false)
          return
        }

        const { data: project, error } = await supabase
          .from('projects')
          .insert({
            user_id: user.id,
            title: projectInfo.projectName,
            client_name: projectInfo.clientName,
            project_address: projectInfo.clientAddress || null,
            notes: projectInfo.projectDescription,
          })
          .select()
          .single()

        if (error) {
          console.error('Error creating project:', error)
          
          // Handle specific Supabase API key errors
          if (error.message && (error.message.includes('API key') || error.message.includes('apikey'))) {
            console.warn('Supabase API key error during project creation - this may be a timing issue')
            setParseError('Authentication issue. Please wait a moment and refresh the page, or try again.')
          } else {
            setParseError(`Failed to create project: ${error.message || 'Unknown error'}`)
          }
          return
        }

        setProjectId(project.id)

        // Metadata is already set during project creation, no need to sync again
      } catch (err) {
        console.error('Error creating project:', err)
        setParseError('Failed to create project')
      } finally {
        setIsCreatingProject(false)
      }
    }

    createProjectIfNeeded()
  }, [projectInfo, user, projectId])

  const handleRecordingComplete = async (audioBlob: Blob, transcript: string) => {
    if (!transcript || transcript.trim().length === 0) {
      setParseError('No transcript was generated. Please try recording again.')
      return
    }
    setTranscript(transcript)
    setCurrentStep('parse')
    setParseError(null)
  }

  // Auto-parse when both transcript and projectId are available
  const parseTriggeredRef = useRef(false)
  useEffect(() => {
    if (currentStep === 'parse' && transcript && transcript.trim().length > 0 && projectId && !isParsing && !estimateData && !parseError && !parseTriggeredRef.current) {
      parseTriggeredRef.current = true
      const timer = setTimeout(() => {
        parseTranscript(transcript)
      }, 200) // Small delay to ensure state is settled
      return () => clearTimeout(timer)
    }
  }, [currentStep, transcript, projectId, isParsing, estimateData, parseError])
  
  // Reset parse trigger when resetting flow
  useEffect(() => {
    if (currentStep === 'record') {
      parseTriggeredRef.current = false
    }
  }, [currentStep])

  const parseTranscript = async (incomingTranscript: string) => {
    setIsParsing(true)
    setParseError(null)
    
    // Wait for project to be created if needed
    if (!projectId) {
      setParseError('Project is being created. Please wait...')
      setIsParsing(false)
      return
    }

    // Ensure user is authenticated
    if (!user || !user.id) {
      setParseError('You must be logged in to parse transcript. Please refresh the page.')
      setIsParsing(false)
      return
    }

    const combined = [projectInfo?.projectDescription, incomingTranscript]
      .filter((chunk) => chunk && chunk.trim().length > 0)
      .join('\n\n')

    if (!combined.trim()) {
      setParseError('Please record audio or provide a written project description before parsing.')
      setCurrentStep('record')
      setIsParsing(false)
      return
    }

    try {
      const response = await fetch('/api/ai/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: projectId,
          transcript: combined
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData.error || `Parse failed: ${response.status} ${response.statusText}`
        
        // Check if it's an API key error - provide helpful message
        if (errorMessage.includes('API key') || errorMessage.includes('apikey')) {
          console.error('API key error in parse:', errorData)
          throw new Error('Authentication error. Please refresh the page and try again.')
        }
        
        throw new Error(errorMessage)
      }

      const result = await response.json()
      // Transform API response to match unified EstimateData type
      // The API already returns the correct structure, but we ensure all required fields are present
      const transformedData: EstimateData = {
        items: (result.data.items || []).map((item: any) => ({
          room_name: item.room_name || 'General',
          description: item.description || '',
          category: item.category || 'Other',
          cost_code: item.cost_code || '999',
          quantity: item.quantity ?? 1,
          unit: item.unit || 'EA',
          labor_cost: item.labor_cost ?? 0,
          margin_percent: item.margin_percent ?? 0,
          client_price: item.client_price ?? 0,
          notes: item.notes || undefined
        })),
        assumptions: result.data.assumptions || [],
        missing_info: result.data.missing_info || []
      }
      setEstimateData(transformedData)
      setEstimateId(result.estimateId ?? null)
      setCurrentStep('estimate')

      // Metadata is already set during project creation, no need to sync again
    } catch (error) {
      console.error('Parse error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to parse transcript'
      
      // Filter out Supabase API key errors in console (they're often harmless timing issues)
      if (errorMessage.includes('API key') || errorMessage.includes('apikey')) {
        console.warn('Supabase API key warning (may be harmless):', error)
        // Still show user-friendly error
        setParseError('Authentication issue. Please wait a moment and try again, or refresh the page.')
      } else {
        setParseError(errorMessage)
      }
    } finally {
      setIsParsing(false)
    }
  }

  const handleEstimateSave = (estimateId: string, total: number) => {
    console.log('Estimate saved:', { estimateId, total })
    // TODO: Navigate to project or show success message
  }

  const resetFlow = () => {
    setCurrentStep('record')
    setTranscript('')
    setEstimateData(null)
    setEstimateId(null)
    setParseError(null)
  }

  if (!projectInfo) {
    return (
      <AuthGuard>
        <div className="flex min-h-screen">
          <Sidebar />
          <div 
            className="flex-1 flex items-center justify-center p-6 transition-all duration-200"
            style={{ marginLeft: `${isCollapsed ? 60 : sidebarWidth}px` }}
          >
            <Card className="max-w-xl w-full">
              <CardHeader>
                <CardTitle>Project details required</CardTitle>
                <CardDescription>
                  Please add the client name, address, and project description before recording.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex justify-end">
                <Button onClick={() => router.push('/projects/new')}>
                  Go to Intake Form
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </AuthGuard>
    )
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />

        <div 
          className="flex-1 transition-all duration-200"
          style={{ marginLeft: `${isCollapsed ? 60 : sidebarWidth}px` }}
        >
          {/* Top Bar */}
          <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center justify-between px-4 md:px-6">
              <h1 className="text-xl font-semibold">New Estimate</h1>
              <UserMenu user={user} />
            </div>
          </header>

          {/* Main Content */}
          <main className="p-4 md:p-6 space-y-6">
            <Card>
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>{projectInfo.projectName}</CardTitle>
                  <CardDescription>
                    {projectInfo.clientName} • {projectInfo.clientAddress}
                  </CardDescription>
                </div>
                <Button variant="outline" onClick={() => router.push('/projects/new')}>
                  Edit Details
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {projectInfo.projectDescription}
                </p>
              </CardContent>
            </Card>

            {/* Step Indicator */}
            <div className="flex items-center justify-center space-x-4">
              <div className={`flex items-center space-x-2 ${currentStep === 'record' ? 'text-blue-600' : currentStep === 'parse' ? 'text-blue-600' : 'text-green-600'}`}>
                <Mic className="h-5 w-5" />
                <span className="font-medium">Record</span>
              </div>
              <div className="w-8 h-0.5 bg-gray-300"></div>
              <div className={`flex items-center space-x-2 ${currentStep === 'parse' ? 'text-blue-600' : currentStep === 'estimate' ? 'text-green-600' : 'text-gray-400'}`}>
                <Sparkles className="h-5 w-5" />
                <span className="font-medium">Parse</span>
              </div>
              <div className="w-8 h-0.5 bg-gray-300"></div>
              <div className={`flex items-center space-x-2 ${currentStep === 'estimate' ? 'text-blue-600' : 'text-gray-400'}`}>
                <span className="font-medium">Estimate</span>
              </div>
            </div>

            {/* Recording Step - Now shows Chat Interface */}
            {currentStep === 'record' && (
              <div className="space-y-4">
                {isCreatingProject && (
                  <Card className="border-blue-200 bg-blue-50">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-center space-x-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
                        <p className="text-sm text-blue-800">Creating project...</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
                
                {/* Chat Interface for adding/modifying estimates */}
                {projectId && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Estimate Chat</CardTitle>
                      <CardDescription>
                        Describe your project or add/modify line items. Use the microphone to record or type directly.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="h-[600px]">
                        <EstimateChat
                          projectId={projectId}
                          estimateId={estimateId}
                          onEstimateUpdate={(newEstimateId, newData) => {
                            setEstimateId(newEstimateId)
                            setEstimateData(newData)
                            setCurrentStep('estimate')
                          }}
                          onLineItemClick={(lineItemId) => {
                            // Scroll to line item in estimate table
                            console.log('Line item clicked:', lineItemId)
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Parsing Step */}
            {currentStep === 'parse' && (
              <Card className="mx-auto max-w-2xl">
                <CardHeader className="text-center">
                  <CardTitle className="flex items-center justify-center space-x-2">
                    <Sparkles className="h-6 w-6 text-blue-600" />
                    <span>Parsing Your Project</span>
                  </CardTitle>
                  <CardDescription>
                    AI is analyzing your project description to extract line items
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Show transcript preview */}
                  {transcript && (
                    <div className="p-4 bg-muted rounded-lg mb-4">
                      <div className="text-sm font-medium text-muted-foreground mb-2">
                        Transcript:
                      </div>
                      <div className="text-sm whitespace-pre-wrap">
                        {transcript}
                      </div>
                    </div>
                  )}

                  {!projectId && isCreatingProject ? (
                    <div className="text-center py-8">
                      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
                      <p className="text-muted-foreground">Creating project...</p>
                      <p className="text-sm text-muted-foreground mt-2">Please wait while we set up your project</p>
                    </div>
                  ) : !projectId ? (
                    <div className="text-center py-8">
                      <div className="text-yellow-600 mb-4">⚠️ Waiting for Project</div>
                      <p className="text-muted-foreground mb-4">Project creation is taking longer than expected.</p>
                      <Button onClick={resetFlow} variant="outline">
                        Start Over
                      </Button>
                    </div>
                  ) : isParsing ? (
                    <div className="text-center py-8">
                      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
                      <p className="text-muted-foreground">Processing transcript...</p>
                    </div>
                  ) : parseError ? (
                    <div className="text-center py-8">
                      <div className="text-red-600 mb-4">❌ Parse Error</div>
                      <p className="text-muted-foreground mb-4">{parseError}</p>
                      <div className="flex justify-center space-x-4">
                        {transcript && (
                          <Button onClick={() => parseTranscript(transcript)} variant="outline">
                            Try Again
                          </Button>
                        )}
                        <Button onClick={resetFlow} variant="outline">
                          Start Over
                        </Button>
                      </div>
                    </div>
                  ) : estimateData ? (
                    <div className="text-center py-8">
                      <div className="text-green-600 mb-4">✅ Parse Complete</div>
                      <p className="text-muted-foreground mb-4">
                        Found {estimateData?.items.length || 0} line items
                      </p>
                      <Button onClick={() => setCurrentStep('estimate')} className="bg-blue-600 hover:bg-blue-700">
                        Continue to Estimate
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
                      <p className="text-muted-foreground">Preparing to parse...</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Estimate Step - Now uses Chat Interface */}
            {currentStep === 'estimate' && estimateData && (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">Project Estimate</h2>
                    <p className="text-muted-foreground">
                      Review and edit the AI-generated line items. Use the chat to add or modify items.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={resetFlow} variant="outline">
                      Reset Estimate
                    </Button>
                    <Button variant="secondary" onClick={() => router.push('/projects/new')}>
                      New Project Intake
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Chat Panel */}
                  <Card className="lg:col-span-1">
                    <CardHeader>
                      <CardTitle>Estimate Chat</CardTitle>
                      <CardDescription>
                        Describe changes or additions to your estimate
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="h-[600px]">
                        <EstimateChat
                          projectId={projectId!}
                          estimateId={estimateId}
                          onEstimateUpdate={(newEstimateId, newData) => {
                            setEstimateId(newEstimateId)
                            setEstimateData(newData)
                            // Reload estimate table
                          }}
                          onLineItemClick={(lineItemId) => {
                            // Scroll to line item in estimate table
                            // TODO: Implement scroll to line item
                            console.log('Line item clicked:', lineItemId)
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Estimate Table */}
                  <div className="lg:col-span-1">
                    <EstimateTable
                      projectId={projectId}
                      initialData={estimateData}
                      onSave={handleEstimateSave}
                      estimateId={estimateId}
                      projectMetadata={{
                        projectName: projectInfo.projectName,
                        clientName: projectInfo.clientName,
                        clientAddress: projectInfo.clientAddress,
                        projectDescription: projectInfo.projectDescription,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </AuthGuard>
  )
}
