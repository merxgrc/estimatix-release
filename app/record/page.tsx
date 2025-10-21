'use client'

import { useState } from 'react'
import { Sidebar } from "@/components/sidebar"
import { Recorder } from "@/components/voice/Recorder"
import { EstimateTable } from "@/components/estimate/EstimateTable"
import { UserMenu } from "@/components/user-menu"
import { AuthGuard } from "@/components/auth-guard"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Sparkles, Mic } from "lucide-react"

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

export default function RecordPage() {
  const { user } = useAuth()
  const [currentStep, setCurrentStep] = useState<'record' | 'parse' | 'estimate'>('record')
  const [transcript, setTranscript] = useState('')
  const [estimateData, setEstimateData] = useState<EstimateData | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  const handleRecordingComplete = async (audioBlob: Blob, transcript: string) => {
    setTranscript(transcript)
    setCurrentStep('parse')
    
    // Parse transcript with AI
    await parseTranscript(transcript)
  }

  const parseTranscript = async (transcript: string) => {
    setIsParsing(true)
    setParseError(null)

    try {
      const response = await fetch('/api/ai/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: null, // No project ID for new estimates
          transcript: transcript
        })
      })

      if (!response.ok) {
        throw new Error(`Parse failed: ${response.status}`)
      }

      const result = await response.json()
      setEstimateData(result.data)
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
    setParseError(null)
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
              <Recorder 
                onRecordingComplete={handleRecordingComplete}
              />
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
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-bold">Project Estimate</h2>
                    <p className="text-muted-foreground">
                      Review and edit the AI-generated line items
                    </p>
                  </div>
                  <Button onClick={resetFlow} variant="outline">
                    Start New Project
                  </Button>
                </div>

                <EstimateTable
                  projectId={null}
                  initialData={estimateData}
                  onSave={handleEstimateSave}
                />
              </div>
            )}
          </main>
        </div>
      </div>
    </AuthGuard>
  )
}
