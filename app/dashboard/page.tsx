'use client'

import { Sidebar } from "@/components/sidebar"
import { AuthGuard } from "@/components/auth-guard"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"
import { useSidebar } from "@/lib/sidebar-context"
// Phase 1: PricingSetupModal removed per PHASE_1_RELEASE_CHECKLIST.md
import { EstimationAccuracyWidget } from "@/components/dashboard/EstimationAccuracyWidget"

export default function DashboardPage() {
  const router = useRouter()
  const { sidebarWidth, isCollapsed } = useSidebar()

  // Phase 1: Pricing onboarding removed - manual pricing only

  return (
    <AuthGuard>
      <div className="flex min-h-screen w-full max-w-[100vw] overflow-x-hidden">
        <Sidebar />
        <div 
          className="flex-1 min-w-0 p-6 transition-all duration-200"
          style={{ marginLeft: `${isCollapsed ? 60 : sidebarWidth}px` }}
        >
          <div className="max-w-7xl mx-auto space-y-6 w-full">
            <div>
              <h1 className="text-3xl font-bold">Dashboard</h1>
              <p className="text-muted-foreground mt-2">Overview of your projects</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <EstimationAccuracyWidget />
              
              {/* Quick Actions */}
              <Card>
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
                  <CardDescription>Common tasks</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button onClick={() => router.push('/projects')} className="w-full" variant="outline">
                    View All Projects
                  </Button>
                  <Button onClick={() => router.push('/projects/new')} className="w-full" variant="outline">
                    Create New Project
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  )
}
