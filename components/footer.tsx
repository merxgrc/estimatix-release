import Link from "next/link"

export function Footer() {
  return (
    <footer className="border-t border-border bg-secondary">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <div className="mb-4 flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <span className="text-lg font-bold">E</span>
              </div>
              <span className="text-xl font-bold">Estimatix</span>
            </div>
            <p className="text-sm text-muted-foreground">AI-powered estimating for modern contractors.</p>
          </div>

          {/* Phase 1: Pricing link removed per PHASE_1_RELEASE_CHECKLIST.md */}
          <div>
            <h3 className="mb-4 text-sm font-semibold">Product</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="#features" className="transition-colors hover:text-foreground">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/projects" className="transition-colors hover:text-foreground">
                  Projects
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold">Company</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="#" className="transition-colors hover:text-foreground">
                  About
                </Link>
              </li>
              <li>
                <Link href="#" className="transition-colors hover:text-foreground">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="#" className="transition-colors hover:text-foreground">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold">Legal</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="#" className="transition-colors hover:text-foreground">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="#" className="transition-colors hover:text-foreground">
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Estimatix. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
