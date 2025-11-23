'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserMenu } from "@/components/user-menu"
import { AuthGuard } from "@/components/auth-guard"
import { useAuth } from "@/lib/auth-context"
import { db } from "@/lib/db-client"
import { EstimateTable } from "@/components/estimate/EstimateTable"
import type { Project, Estimate } from "@/types/db"
import { ArrowLeft, Calendar, FileText, DollarSign, Plus, Trash2 } from "lucide-react"
import Link from "next/link"

export default function ProjectDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { user } = useAuth()
  const projectId = params.id as string

  const [project, setProject] = useState<Project | null>(null)
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeEstimateId, setActiveEstimateId] = useState<string | null>(null)
  const [deletingProject, setDeletingProject] = useState(false)
  const [deletingEstimateId, setDeletingEstimateId] = useState<string | null>(null)

  useEffect(() => {
    const fetchProjectData = async () => {
      if (!projectId || !user) {
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        // Fetch project and estimates in parallel
        // Use Promise.allSettled to handle individual failures gracefully
        const [projectResult, estimatesResult] = await Promise.allSettled([
          db.getProject(projectId),
          db.getEstimates(projectId)
        ])

        // Handle project fetch result
        if (projectResult.status === 'rejected') {
          console.error('Error fetching project:', projectResult.reason)
          throw projectResult.reason
        }

        const projectData = projectResult.value
        if (!projectData) {
          setError('Project not found')
          return
        }

        // Handle estimates fetch result
        if (estimatesResult.status === 'rejected') {
          console.error('Error fetching estimates:', estimatesResult.reason)
          // If project exists but estimates fail, still show the project
          // but log the error and set empty estimates
          setProject(projectData)
          setEstimates([])
          console.warn('Could not load estimates, but project loaded successfully')
          return
        }

        const estimatesData = estimatesResult.value

        setProject(projectData)
        setEstimates(estimatesData)
        
        // Set the most recent estimate as active if any exist
        if (estimatesData.length > 0) {
          setActiveEstimateId(estimatesData[0].id)
        }
      } catch (err) {
        console.error('Error fetching project data:', err)
        
        // Handle Supabase errors and standard errors
        let errorMessage = 'Failed to load project'
        if (err instanceof Error) {
          errorMessage = err.message
        } else if (err && typeof err === 'object') {
          // Handle Supabase PostgrestError
          if ('message' in err && typeof err.message === 'string') {
            errorMessage = err.message
          } else if ('error' in err && typeof err.error === 'string') {
            errorMessage = err.error
          } else if ('code' in err) {
            errorMessage = `Database error: ${err.code || 'Unknown error'}`
          }
        }
        
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProjectData()
  }, [projectId, user])

  const handleEstimateSave = (estimateId: string, total: number) => {
    // Refresh estimates list
    db.getEstimates(projectId).then(setEstimates).catch(console.error)
  }

  const handleDeleteProject = async () => {
    if (!project) return
    
    if (!confirm(`Are you sure you want to delete "${project.title}"? This will also delete all estimates associated with this project. This action cannot be undone.`)) {
      return
    }

    setDeletingProject(true)
    try {
      await db.deleteProject(projectId)
      router.push('/dashboard')
    } catch (err) {
      console.error('Error deleting project:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete project'
      alert(`Error: ${errorMessage}`)
      setDeletingProject(false)
    }
  }

  const handleDeleteEstimate = async (estimateId: string) => {
    if (!confirm('Are you sure you want to delete this estimate? This action cannot be undone.')) {
      return
    }

    setDeletingEstimateId(estimateId)
    try {
      await db.deleteEstimate(estimateId)
      // Remove from local state
      const updatedEstimates = estimates.filter(e => e.id !== estimateId)
      setEstimates(updatedEstimates)
      
      // If we deleted the active estimate, set a new one or clear it
      if (activeEstimateId === estimateId) {
        if (updatedEstimates.length > 0) {
          setActiveEstimateId(updatedEstimates[0].id)
        } else {
          setActiveEstimateId(null)
        }
      }
    } catch (err) {
      console.error('Error deleting estimate:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete estimate'
      alert(`Error: ${errorMessage}`)
    } finally {
      setDeletingEstimateId(null)
    }
  }

  if (isLoading) {
    return (
      <AuthGuard>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 md:ml-64 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              <p className="text-muted-foreground">Loading project...</p>
            </div>
          </div>
        </div>
      </AuthGuard>
    )
  }

  if (error || !project) {
    return (
      <AuthGuard>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 md:ml-64 flex items-center justify-center p-6">
            <Card className="max-w-xl w-full border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Error Loading Project</CardTitle>
                <CardDescription>{error || 'Project not found'}</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-4">
                <Button onClick={() => router.push('/dashboard')} variant="outline">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Dashboard
                </Button>
                <Button onClick={() => window.location.reload()} variant="outline">
                  Retry
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </AuthGuard>
    )
  }

  const activeEstimate = activeEstimateId ? estimates.find(e => e.id === activeEstimateId) : null
  const estimateData = activeEstimate?.json_data as any || { items: [], assumptions: [], missing_info: [] }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />

        <div className="flex-1 md:ml-64">
          {/* Top Bar */}
          <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center justify-between px-4 md:px-6">
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <h1 className="text-xl font-semibold">{project.title}</h1>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteProject}
                  disabled={deletingProject}
                >
                  {deletingProject ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Project
                    </>
                  )}
                </Button>
                <UserMenu user={user} />
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="p-4 md:p-6 space-y-6">
            {/* Project Info Card */}
            <Card>
              <CardHeader>
                <CardTitle>{project.title}</CardTitle>
                <CardDescription>
                  {project.client_name && (
                    <span className="block">{project.client_name}</span>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-sm">
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

            {/* Estimates Section - Always show the estimate interface */}
            <div className="space-y-4">
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
                            onClick={() => handleDeleteEstimate(estimate.id)}
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

              {activeEstimate && activeEstimate.ai_summary && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">AI Summary</CardTitle>
                      {estimates.length === 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteEstimate(activeEstimate.id)}
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
                    <p className="text-sm text-muted-foreground">
                      {activeEstimate.ai_summary}
                    </p>
                  </CardContent>
                </Card>
              )}

              <div className="relative">
                {estimates.length > 1 && activeEstimateId && (
                  <div className="absolute top-0 right-0 z-10">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteEstimate(activeEstimateId)}
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
                  onSave={handleEstimateSave}
                />
              </div>
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  )
}

