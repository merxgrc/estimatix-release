import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Mic, FileText, Zap, Shield, Clock, TrendingUp } from "lucide-react"
import Link from "next/link"

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col w-full max-w-[100vw] overflow-x-hidden">
      <Navbar />

      {/* Hero Section */}
      <section className="relative flex flex-1 items-center justify-center px-4 py-20 md:py-32">
        <div className="container mx-auto max-w-5xl text-center">
          <div className="mb-6 inline-block rounded-full border border-border bg-secondary px-4 py-1.5 text-sm text-muted-foreground">
            AI-Powered Estimating
          </div>
          <h1 className="mb-6 text-balance text-4xl font-bold tracking-tight md:text-6xl lg:text-7xl">
            Voice Your Vision.
            <br />
            <span className="text-muted-foreground">Get Instant Estimates.</span>
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-pretty text-lg text-muted-foreground md:text-xl">
            Estimatix transforms how contractors create project estimates. Simply describe your project by voice, and
            our AI generates detailed, accurate estimates in seconds.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/dashboard">Get Started</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto bg-transparent">
              <Link href="#features">Learn More</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="border-t border-border px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-balance text-3xl font-bold md:text-4xl">Built for Modern Contractors</h2>
            <p className="mx-auto max-w-2xl text-pretty text-muted-foreground">
              Everything you need to create professional estimates faster than ever before.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <Mic className="mb-2 h-10 w-10" />
                <CardTitle>Voice Recording</CardTitle>
                <CardDescription>
                  Describe your project naturally. Our AI understands construction terminology and context.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Zap className="mb-2 h-10 w-10" />
                <CardTitle>Instant Generation</CardTitle>
                <CardDescription>
                  Get detailed estimates in seconds, not hours. AI-powered analysis of materials, labor, and costs.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <FileText className="mb-2 h-10 w-10" />
                <CardTitle>Professional Output</CardTitle>
                <CardDescription>
                  Export polished, client-ready estimates with itemized breakdowns and totals.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Clock className="mb-2 h-10 w-10" />
                <CardTitle>Save Time</CardTitle>
                <CardDescription>
                  Reduce estimate creation time by 90%. Spend more time building, less time calculating.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Shield className="mb-2 h-10 w-10" />
                <CardTitle>Accurate Pricing</CardTitle>
                <CardDescription>
                  AI trained on real construction data ensures competitive and realistic pricing.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <TrendingUp className="mb-2 h-10 w-10" />
                <CardTitle>Win More Bids</CardTitle>
                <CardDescription>
                  Respond to opportunities faster with professional estimates that impress clients.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Phase 1: Pricing Section removed per PHASE_1_RELEASE_CHECKLIST.md */}

      {/* FAQ Section */}
      <section id="faq" className="border-t border-border px-4 py-20">
        <div className="container mx-auto max-w-3xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-balance text-3xl font-bold md:text-4xl">Frequently Asked Questions</h2>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">How accurate are the AI-generated estimates?</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Our AI is trained on thousands of real construction projects and pricing data. While estimates provide
                  a strong baseline, we always recommend reviewing and adjusting based on your specific market
                  conditions and expertise.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Can I edit the generated estimates?</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  All estimates are fully editable. The AI provides a starting point, and you have complete control to
                  adjust quantities, pricing, and line items.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">What types of projects does Estimatix support?</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Estimatix works with residential and commercial projects including remodeling, new construction,
                  electrical, plumbing, HVAC, and more. Our AI understands a wide range of construction trades.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Is my data secure?</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Yes. We use enterprise-grade encryption and security practices. Your project data and estimates are
                  private and never shared with third parties.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-border px-4 py-20">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="mb-4 text-balance text-3xl font-bold md:text-4xl">Ready to Transform Your Estimating?</h2>
          <p className="mb-8 text-pretty text-lg text-muted-foreground">
            Join hundreds of contractors saving time and winning more bids with Estimatix.
          </p>
          <Button asChild size="lg">
            <Link href="/dashboard">Start Free Trial</Link>
          </Button>
        </div>
      </section>

      {/* Sticky Mobile CTA */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background p-4 md:hidden">
        <Button asChild className="w-full" size="lg">
          <Link href="/dashboard">Get Started Free</Link>
        </Button>
      </div>

      <Footer />
    </div>
  )
}
