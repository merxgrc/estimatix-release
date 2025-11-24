"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, FolderOpen, TrendingUp, History, FileText, FolderPlus, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { db } from "@/lib/db-client"

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Projects", href: "/projects", icon: FolderOpen },
  { name: "Market", href: "/market", icon: TrendingUp },
  { name: "Historical Data", href: "/historical-data", icon: History },
  { name: "Estimate", href: "/estimate", icon: FileText },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [isCreatingProject, setIsCreatingProject] = useState(false)

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
      alert('Failed to create project. Please try again.')
      setIsCreatingProject(false)
    }
  }

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 border-r border-border bg-secondary md:block">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center border-b border-border px-6">
            <Link href="/" className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <span className="text-lg font-bold">E</span>
              </div>
              <span className="text-xl font-bold">Estimatix</span>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navigation.map((item) => {
              // For Projects, also match /projects/[id] paths
              const isActive = item.href === "/projects" 
                ? pathname === item.href || pathname?.startsWith("/projects/")
                : pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </Link>
              )
            })}
            <Button
              onClick={handleCreateProject}
              disabled={isCreatingProject}
              className="w-full justify-start mt-2"
              variant="default"
            >
              {isCreatingProject ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Creating...
                </>
              ) : (
                <>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  New Project
                </>
              )}
            </Button>
          </nav>

          {/* User Section */}
          <div className="border-t border-border p-4">
            <div className="mb-3 flex items-center gap-3 px-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {user?.user_metadata?.full_name 
                  ? user.user_metadata.full_name.charAt(0).toUpperCase()
                  : user?.email 
                    ? user.email.charAt(0).toUpperCase()
                    : 'U'}
              </div>
              <div className="flex-1 text-sm min-w-0">
                <p className="font-medium truncate">
                  {user?.user_metadata?.full_name || user?.user_metadata?.name || 'User'}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.email || 'No email'}
                </p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              className="w-full justify-start" 
              size="sm"
              onClick={async () => {
                try {
                  await signOut()
                  router.push('/auth/login')
                } catch (err) {
                  console.error('Error signing out:', err)
                  alert('Failed to sign out. Please try again.')
                }
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background md:hidden">
        <div className="flex items-center justify-around">
          {navigation.map((item) => {
            // For Projects, also match /projects/[id] paths
            const isActive = item.href === "/projects" 
              ? pathname === item.href || pathname?.startsWith("/projects/")
              : pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            )
          })}
          <button
            onClick={handleCreateProject}
            disabled={isCreatingProject}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
              isCreatingProject ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {isCreatingProject ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            ) : (
              <FolderPlus className="h-5 w-5" />
            )}
            New Project
          </button>
        </div>
      </nav>
    </>
  )
}
