'use client'

import { Sidebar } from "@/components/sidebar"
import { AuthGuard } from "@/components/auth-guard"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { LayoutDashboard } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

export default function DashboardPage() {
  const router = useRouter()

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 md:ml-64 flex items-center justify-center p-6">
          <Card className="max-w-xl w-full">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-secondary">
                <LayoutDashboard className="h-10 w-10 text-muted-foreground" />
              </div>
              <CardTitle className="text-2xl">404 - Dashboard Not Found</CardTitle>
              <CardDescription>
                The dashboard page is not available yet. Please check back later.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center gap-4">
              <Button onClick={() => router.push('/projects')} variant="default">
                Go to Projects
              </Button>
              <Button onClick={() => router.back()} variant="outline">
                Go Back
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthGuard>
  )
}
