"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, FolderOpen, TrendingUp, History, FileText, FolderPlus, LogOut, ChevronLeft, ChevronRight } from "lucide-react"
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

const SIDEBAR_WIDTH_KEY = 'estimatix-sidebar-width'
const SIDEBAR_COLLAPSED_KEY = 'estimatix-sidebar-collapsed'
const MIN_WIDTH = 60
const MAX_WIDTH = 260
const DEFAULT_WIDTH = 256

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  
  // Sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const resizeHandleRef = useRef<HTMLDivElement>(null)

  // Load saved width and collapsed state from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY)
      const savedCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      
      if (savedWidth) {
        const width = parseInt(savedWidth, 10)
        if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
          setSidebarWidth(width)
        }
      }
      
      if (savedCollapsed === 'true') {
        setIsCollapsed(true)
      }
    }
  }, [])

  // Save width to localStorage and notify context
  useEffect(() => {
    if (typeof window !== 'undefined' && !isCollapsed) {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString())
      window.dispatchEvent(new CustomEvent('sidebar-update', { 
        detail: { width: sidebarWidth, isCollapsed } 
      }))
    }
  }, [sidebarWidth, isCollapsed])

  // Save collapsed state to localStorage and notify context
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isCollapsed.toString())
      window.dispatchEvent(new CustomEvent('sidebar-update', { 
        detail: { width: sidebarWidth, isCollapsed } 
      }))
    }
  }, [isCollapsed, sidebarWidth])

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    // Prevent text selection during resize
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isCollapsed) {
        const newWidth = e.clientX
        if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
          setSidebarWidth(newWidth)
        } else if (newWidth < MIN_WIDTH) {
          setSidebarWidth(MIN_WIDTH)
        } else if (newWidth > MAX_WIDTH) {
          setSidebarWidth(MAX_WIDTH)
        }
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isResizing, isCollapsed])

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed)
  }

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

  const currentWidth = isCollapsed ? MIN_WIDTH : sidebarWidth

  return (
    <>
      {/* Desktop Sidebar */}
      <aside 
        ref={sidebarRef}
        className="fixed inset-y-0 left-0 z-50 hidden border-r border-border bg-secondary md:block transition-all duration-200"
        style={{ width: `${currentWidth}px` }}
      >
        <div className="flex h-full flex-col relative">
          {/* Resize Handle */}
          {!isCollapsed && (
            <div
              ref={resizeHandleRef}
              onMouseDown={handleMouseDown}
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 transition-colors group"
              style={{ zIndex: 10 }}
            >
              <div className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 w-1 h-16 bg-border rounded-full group-hover:bg-primary" />
            </div>
          )}

          {/* Collapse Toggle Button */}
          <button
            onClick={toggleCollapse}
            className="absolute top-4 -right-3 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-accent transition-colors"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>

          {/* Logo */}
          <div className={cn(
            "flex h-16 items-center border-b border-border transition-all",
            isCollapsed ? "justify-center px-2" : "px-6"
          )}>
            <Link href="/" className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground flex-shrink-0">
                <span className="text-lg font-bold">E</span>
              </div>
              {!isCollapsed && (
                <span className="text-xl font-bold whitespace-nowrap">Estimatix</span>
              )}
            </Link>
          </div>

          {/* Navigation */}
          <nav className={cn(
            "flex-1 space-y-1 py-4 transition-all",
            isCollapsed ? "px-2" : "px-3"
          )}>
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
                    "flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors",
                    isCollapsed ? "justify-center px-2" : "px-3",
                    isActive
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                  )}
                  title={isCollapsed ? item.name : undefined}
                >
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  {!isCollapsed && <span className="whitespace-nowrap">{item.name}</span>}
                </Link>
              )
            })}
            <Button
              onClick={handleCreateProject}
              disabled={isCreatingProject}
              className={cn(
                "w-full mt-2",
                isCollapsed ? "justify-center px-2" : "justify-start"
              )}
              variant="default"
              title={isCollapsed ? "New Project" : undefined}
            >
              {isCreatingProject ? (
                <>
                  <div className={cn("h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent", !isCollapsed && "mr-2")} />
                  {!isCollapsed && "Creating..."}
                </>
              ) : (
                <>
                  <FolderPlus className={cn("h-4 w-4", !isCollapsed && "mr-2")} />
                  {!isCollapsed && "New Project"}
                </>
              )}
            </Button>
          </nav>

          {/* User Section */}
          <div className={cn(
            "border-t border-border transition-all",
            isCollapsed ? "p-2" : "p-4"
          )}>
            <div className={cn(
              "mb-3 flex items-center gap-3",
              isCollapsed ? "justify-center" : "px-2"
            )}>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground flex-shrink-0">
                {user?.user_metadata?.full_name 
                  ? user.user_metadata.full_name.charAt(0).toUpperCase()
                  : user?.email 
                    ? user.email.charAt(0).toUpperCase()
                    : 'U'}
              </div>
              {!isCollapsed && (
                <div className="flex-1 text-sm min-w-0">
                  <p className="font-medium truncate">
                    {user?.user_metadata?.full_name || user?.user_metadata?.name || 'User'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user?.email || 'No email'}
                  </p>
                </div>
              )}
            </div>
            <Button 
              variant="ghost" 
              className={cn(
                "w-full",
                isCollapsed ? "justify-center px-2" : "justify-start"
              )}
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
              title={isCollapsed ? "Sign Out" : undefined}
            >
              <LogOut className={cn("h-4 w-4", !isCollapsed && "mr-2")} />
              {!isCollapsed && "Sign Out"}
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
