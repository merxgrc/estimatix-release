"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"

const SIDEBAR_WIDTH_KEY = 'estimatix-sidebar-width'
const SIDEBAR_COLLAPSED_KEY = 'estimatix-sidebar-collapsed'
const MIN_WIDTH = 60
const DEFAULT_WIDTH = 256

interface SidebarContextType {
  sidebarWidth: number
  isCollapsed: boolean
}

const SidebarContext = createContext<SidebarContextType>({
  sidebarWidth: DEFAULT_WIDTH,
  isCollapsed: false,
})

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH)
  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY)
      const savedCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      
      if (savedWidth) {
        const width = parseInt(savedWidth, 10)
        if (width >= MIN_WIDTH && width <= 260) {
          setSidebarWidth(width)
        }
      }
      
      if (savedCollapsed === 'true') {
        setIsCollapsed(true)
      }

      // Listen for storage changes (for cross-tab sync)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === SIDEBAR_WIDTH_KEY && e.newValue) {
          const width = parseInt(e.newValue, 10)
          if (width >= MIN_WIDTH && width <= 260) {
            setSidebarWidth(width)
          }
        }
        if (e.key === SIDEBAR_COLLAPSED_KEY) {
          setIsCollapsed(e.newValue === 'true')
        }
      }

      window.addEventListener('storage', handleStorageChange)
      return () => window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  // Listen for custom events from sidebar component
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleSidebarUpdate = (e: CustomEvent) => {
        if (e.detail.width !== undefined) {
          setSidebarWidth(e.detail.width)
        }
        if (e.detail.isCollapsed !== undefined) {
          setIsCollapsed(e.detail.isCollapsed)
        }
      }

      window.addEventListener('sidebar-update', handleSidebarUpdate as EventListener)
      return () => window.removeEventListener('sidebar-update', handleSidebarUpdate as EventListener)
    }
  }, [])

  return (
    <SidebarContext.Provider value={{ sidebarWidth, isCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}





