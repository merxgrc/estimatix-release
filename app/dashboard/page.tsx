'use client'

import { Sidebar } from "@/components/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UserMenu } from "@/components/user-menu"
import { AuthGuard } from "@/components/auth-guard"
import { Plus, FolderOpen } from "lucide-react"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"

export default function DashboardPage() {
  const { user } = useAuth()

  // TODO: Fetch user projects from Supabase
  const projects: any[] = [] // Empty for now

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />

        <div className="flex-1 md:ml-64">
        {/* Top Bar */}
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-16 items-center justify-between px-4 md:px-6">
            <h1 className="text-xl font-semibold">Projects</h1>
            <div className="flex items-center space-x-4">
              <Button asChild>
                <Link href="/record">
                  <Plus className="mr-2 h-4 w-4" />
                  New Project
                </Link>
              </Button>
              <UserMenu user={user} />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-4 md:p-6">
          {projects.length === 0 ? (
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
                <Button asChild size="lg">
                  <Link href="/record">
                    <Plus className="mr-2 h-4 w-4" />
                    Create First Project
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* TODO: Map through projects and display cards */}
            </div>
          )}
        </main>
        </div>
      </div>
    </AuthGuard>
  )
}
