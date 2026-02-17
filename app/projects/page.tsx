'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserMenu } from "@/components/user-menu"
import { AuthGuard } from "@/components/auth-guard"
import { EditableProjectTitle } from "@/components/editable-project-title"
import { Plus, FolderOpen, Calendar, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { db } from "@/lib/db-client"
import type { Project } from "@/types/db"
import { useSidebar } from "@/lib/sidebar-context"

export default function ProjectsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { sidebarWidth, isCollapsed } = useSidebar()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [isCreatingProject, setIsCreatingProject] = useState(false)

  useEffect(() => {
    const fetchProjects = async () => {
      if (!user) {
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)
        const userProjects = await db.getProjects()
        setProjects(userProjects)
      } catch (err) {
        console.error('Error fetching projects:', err)
        setError(err instanceof Error ? err.message : 'Failed to load projects')
      } finally {
        setIsLoading(false)
      }
    }

    fetchProjects()
  }, [user])

  const handleCreateProject = async () => {
    if (!user?.id) return

    setIsCreatingProject(true)
    try {
      const project = await db.createProject({
        user_id: user.id,
        title: `New Project ${new Date().toLocaleDateString()}`,
        client_name: null,
        notes: null,
      })
      router.push(`/projects/${project.id}`)
    } catch (err) {
      console.error('Error creating project:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to create project'
      alert(`Error: ${errorMessage}`)
      setIsCreatingProject(false)
    }
  }

  const handleDeleteProject = async (projectId: string, projectTitle: string) => {
    if (!confirm(`Are you sure you want to delete "${projectTitle}"? This will also delete all estimates associated with this project. This action cannot be undone.`)) {
      return
    }

    setDeletingProjectId(projectId)
    try {
      await db.deleteProject(projectId)
      // Remove from local state
      setProjects(prev => prev.filter(p => p.id !== projectId))
    } catch (err) {
      console.error('Error deleting project:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete project'
      alert(`Error: ${errorMessage}`)
    } finally {
      setDeletingProjectId(null)
    }
  }

  const handleUpdateProjectTitle = async (projectId: string, newTitle: string) => {
    try {
      await db.updateProject(projectId, { title: newTitle })
      // Update local state
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, title: newTitle } : p))
    } catch (err) {
      console.error('Error updating project title:', err)
      throw err // Re-throw so EditableProjectTitle can handle it
    }
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen w-full max-w-[100vw] overflow-x-hidden">
        <Sidebar />

        <div 
          className="app-content flex-1 min-w-0 transition-all duration-200"
          style={{ marginLeft: `${isCollapsed ? 60 : sidebarWidth}px` }}
        >
        {/* Top Bar */}
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-16 items-center justify-between px-4 md:px-6">
            <h1 className="text-xl font-semibold">Projects</h1>
            <div className="flex items-center space-x-4">
              <Button onClick={handleCreateProject} disabled={isCreatingProject}>
                {isCreatingProject ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    New Project
                  </>
                )}
              </Button>
              <UserMenu user={user} />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-4 md:p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                <p className="text-muted-foreground">Loading projects...</p>
              </div>
            </div>
          ) : error ? (
            <Card className="mx-auto max-w-2xl border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Error Loading Projects</CardTitle>
                <CardDescription>{error}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => window.location.reload()} variant="outline">
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : projects.length === 0 ? (
            <Card className="mx-auto max-w-2xl">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-secondary">
                  <FolderOpen className="h-10 w-10 text-muted-foreground" />
                </div>
                <CardTitle>No Projects Yet</CardTitle>
                <CardDescription>
                  Create your first project estimate by recording a voice description of your project.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <Button onClick={handleCreateProject} disabled={isCreatingProject} size="lg">
                  {isCreatingProject ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Create First Project
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <Card key={project.id} className="hover:shadow-lg transition-shadow relative group">
                  <CardHeader>
                    <div onClick={(e) => e.stopPropagation()}>
                      <EditableProjectTitle
                        title={project.title}
                        onSave={(newTitle) => handleUpdateProjectTitle(project.id, newTitle)}
                        variant="card"
                        className="line-clamp-2"
                      />
                    </div>
                    {project.client_name && (
                      <CardDescription className="line-clamp-1">
                        {project.client_name}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <Link href={`/projects/${project.id}`} className="block">
                    <CardContent>
                      <div className="flex items-center text-sm text-muted-foreground">
                        <Calendar className="mr-2 h-4 w-4" />
                        <span>
                          {new Date(project.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      </div>
                      {project.notes && (
                        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                          {project.notes}
                        </p>
                      )}
                    </CardContent>
                  </Link>
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleDeleteProject(project.id, project.title)
                      }}
                      disabled={deletingProjectId === project.id}
                      className="h-8 w-8 p-0"
                    >
                      {deletingProjectId === project.id ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </main>
        </div>
      </div>
    </AuthGuard>
  )
}


