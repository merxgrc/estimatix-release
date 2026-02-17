'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LogOut, User } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface UserMenuProps {
  user: {
    email?: string
    user_metadata?: {
      full_name?: string
    }
  } | null
}

export function UserMenu({ user }: UserMenuProps) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { signOut } = useAuth()

  const handleLogout = async () => {
    setLoading(true)
    try {
      await signOut()
      router.push('/auth/login')
      router.refresh()
    } catch (error) {
      console.error('Error signing out:', error)
    } finally {
      setLoading(false)
    }
  }

  const displayName = user?.user_metadata?.full_name || user?.email || 'User'

  return (
    <div className="flex items-center gap-2 md:gap-4">
      {/* User name - hidden on mobile to save space */}
      <div className="hidden md:flex items-center space-x-2">
        <User className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground truncate max-w-[150px]">
          {displayName}
        </span>
      </div>
      {/* Logout button - icon-only on mobile */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleLogout}
        disabled={loading}
        className="min-h-[44px] md:min-h-0 flex items-center gap-2"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden md:inline">{loading ? 'Signing out...' : 'Sign out'}</span>
      </Button>
    </div>
  )
}
