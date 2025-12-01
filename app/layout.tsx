import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { AuthProvider } from "@/lib/auth-context"
import { Toaster } from "sonner"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Estimatix - AI-Assisted Contractor Estimating",
  description: "Generate accurate project estimates through voice recording powered by AI",
  manifest: "/manifest.json", // TODO: Create manifest.json for PWA
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          {children}
        </AuthProvider>
        <Toaster />
        {/* TODO: Add service worker registration script */}
      </body>
    </html>
  )
}
