'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from "@/components/sidebar"
import { AuthGuard } from "@/components/auth-guard"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { LayoutDashboard } from "lucide-react"
import { useRouter } from "next/navigation"
import { useSidebar } from "@/lib/sidebar-context"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase/client"
import { PricingSetupModal } from "@/components/onboarding/PricingSetupModal"
import { EstimationAccuracyWidget } from "@/components/dashboard/EstimationAccuracyWidget"

export default function DashboardPage() {
  const router = useRouter()
  const { sidebarWidth, isCollapsed } = useSidebar()
  const { user } = useAuth()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    checkOnboarding()
  }, [user])

  const checkOnboarding = async () => {
    if (!user?.id) {
      setIsChecking(false)
      return
    }

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('region_factor, quality_tier')
        .eq('id', user.id)
        .single()

      // Safe fail: If there's an error (e.g., profile doesn't exist, network issue), show onboarding
      if (error) {
        // PGRST116 means "no rows found" - this is expected for new users without a profile
        if (error.code === 'PGRST116') {
          console.log('[Onboarding] Profile not found - showing onboarding modal')
        } else {
          console.error('[Onboarding] Error checking profile:', {
            code: error.code,
            message: error.message,
            details: error.details
          })
        }
        // Show onboarding by default if we can't check the profile
        setShowOnboarding(true)
        setIsChecking(false)
        return
      }

      // Show onboarding if region_factor or quality_tier is null or missing
      if (!profile || !profile.region_factor || !profile.quality_tier) {
        console.log('[Onboarding] Profile missing region_factor or quality_tier - showing onboarding modal')
        setShowOnboarding(true)
      } else {
        console.log('[Onboarding] Profile setup complete - skipping onboarding')
      }
    } catch (error) {
      console.error('[Onboarding] Exception in onboarding check:', error instanceof Error ? error.message : String(error))
      // Safe fail: Show onboarding if there's any exception
      setShowOnboarding(true)
    } finally {
      setIsChecking(false)
    }
  }

  if (isChecking) {
    return (
      <AuthGuard>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </AuthGuard>
    )
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <div 
          className="flex-1 p-6 transition-all duration-200"
          style={{ marginLeft: `${isCollapsed ? 60 : sidebarWidth}px` }}
        >
          <div className="max-w-7xl mx-auto space-y-6">
            <div>
              <h1 className="text-3xl font-bold">Dashboard</h1>
              <p className="text-muted-foreground mt-2">Overview of your projects and estimation accuracy</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <EstimationAccuracyWidget />
              
              {/* Placeholder for future widgets */}
              <Card>
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
                  <CardDescription>Common tasks</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button onClick={() => router.push('/projects')} className="w-full" variant="outline">
                    View All Projects
                  </Button>
                  <Button onClick={() => router.push('/record')} className="w-full" variant="outline">
                    Create New Estimate
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Onboarding Modal */}
        <PricingSetupModal
          open={showOnboarding}
          onOpenChange={setShowOnboarding}
          onComplete={() => {
            setShowOnboarding(false)
            // Refresh the page to show updated dashboard
            window.location.reload()
          }}
        />
      </div>
    </AuthGuard>
  )
}
