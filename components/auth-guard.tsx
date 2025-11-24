'use client'

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

interface AuthGuardProps {
  children: React.ReactNode
  requireAuth?: boolean
}

export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
  const { user, loading } = useAuth()
  const router = useRouter()

  // 1. Hooks MUST run before any returns
  useEffect(() => {
    if (!loading) {
      if (requireAuth && !user) {
        router.push('/auth/login')
      }
      if (!requireAuth && user) {
        router.push('/projects')
      }
    }
  }, [user, loading, requireAuth, router])

  // 2. AFTER all hooks, we can safely return UI

  // Still loading session
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  // Protected pages → user required
  if (requireAuth && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Redirecting...
      </div>
    )
  }

  // Public pages → user NOT allowed (login/signup/etc)
  if (!requireAuth && user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Redirecting...
      </div>
    )
  }

  // Allowed to see the page
  return <>{children}</>
}
