'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from "@/components/sidebar"
import { Recorder } from "@/components/voice/Recorder"
import { EstimateTable } from "@/components/estimate/EstimateTable"
import { UserMenu } from "@/components/user-menu"
import { AuthGuard } from "@/components/auth-guard"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Sparkles, Mic } from "lucide-react"
import { supabase } from "@/lib/supabase/client"

interface EstimateData {
  items: Array<{
    category: 'Windows' | 'Doors' | 'Cabinets' | 'Flooring' | 'Plumbing' | 'Electrical' | 'Other'
    description: string
    quantity: number
    dimensions?: {
      unit: 'in' | 'ft' | 'cm' | 'm'
      width: number
      height: number
      depth?: number
    } | null
    unit_cost?: number
    total?: number
    notes?: string
  }>
  assumptions?: string[]
  missing_info?: string[]
}

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
            notes: projectInfo.projectDescription,
          })
          .select()
          .single()

        if (error) {
          console.error('Error creating project:', error)
          setParseError(`Failed to create project: ${error.message}`)
          return
        }

        setProjectId(project.id)
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
    setTranscript(transcript)
    setCurrentStep('parse')
    
    // Parse transcript with AI
    await parseTranscript(transcript)
  }

  const parseTranscript = async (incomingTranscript: string) => {
    setIsParsing(true)
    setParseError(null)
    
    // Wait for project to be created if needed
    if (!projectId) {
      setParseError('Project is being created. Please wait...')
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
        throw new Error(errorData.error || `Parse failed: ${response.status}`)
      }

      const result = await response.json()
      setEstimateData(result.data)
      setEstimateId(result.estimateId ?? null)
      setCurrentStep('estimate')
    } catch (error) {
      console.error('Parse error:', error)
      setParseError(error instanceof Error ? error.message : 'Failed to parse transcript')
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
          <div className="flex-1 md:ml-64 flex items-center justify-center p-6">
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

        <div className="flex-1 md:ml-64">
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

            {/* Recording Step */}
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
                <Recorder 
                  onRecordingComplete={handleRecordingComplete}
                />
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
                  {isParsing ? (
                    <div className="text-center py-8">
                      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
                      <p className="text-muted-foreground">Processing transcript...</p>
                    </div>
                  ) : parseError ? (
                    <div className="text-center py-8">
                      <div className="text-red-600 mb-4">❌ Parse Error</div>
                      <p className="text-muted-foreground mb-4">{parseError}</p>
                      <div className="flex justify-center space-x-4">
                        <Button onClick={() => parseTranscript(transcript)} variant="outline">
                          Try Again
                        </Button>
                        <Button onClick={resetFlow} variant="outline">
                          Start Over
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="text-green-600 mb-4">✅ Parse Complete</div>
                      <p className="text-muted-foreground mb-4">
                        Found {estimateData?.items.length || 0} line items
                      </p>
                      <Button onClick={() => setCurrentStep('estimate')} className="bg-blue-600 hover:bg-blue-700">
                        Continue to Estimate
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Estimate Step */}
            {currentStep === 'estimate' && estimateData && (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">Project Estimate</h2>
                    <p className="text-muted-foreground">
                      Review and edit the AI-generated line items
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

                <EstimateTable
                  projectId={null}
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
            )}
          </main>
        </div>
      </div>
    </AuthGuard>
  )
}
