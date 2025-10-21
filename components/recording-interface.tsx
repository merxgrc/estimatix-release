"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Mic, Square, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export function RecordingInterface() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [estimate, setEstimate] = useState<any>(null)

  // TODO: Implement Web Speech API for voice recording
  const handleStartRecording = () => {
    setIsRecording(true)
    // TODO: Start recording with Web Speech API
    // const recognition = new (window as any).webkitSpeechRecognition()
    // recognition.continuous = true
    // recognition.interimResults = true
    // recognition.onresult = (event: any) => { ... }
    // recognition.start()
  }

  const handleStopRecording = () => {
    setIsRecording(false)
    // TODO: Stop recording
  }

  // TODO: Implement AI estimate generation
  const handleGenerateEstimate = async () => {
    if (!transcript.trim()) return

    setIsGenerating(true)

    try {
      // TODO: Call API endpoint to generate estimate using AI SDK
      // const response = await fetch('/api/generate-estimate', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ transcript })
      // })
      // const data = await response.json()
      // setEstimate(data.estimate)

      // Mock data for demonstration
      setTimeout(() => {
        setEstimate({
          projectName: "Kitchen Remodel",
          items: [
            { description: "Demolition", quantity: 1, unit: "job", unitPrice: 1500, total: 1500 },
            { description: "Cabinets", quantity: 15, unit: "linear ft", unitPrice: 200, total: 3000 },
            { description: "Countertops", quantity: 25, unit: "sq ft", unitPrice: 75, total: 1875 },
            { description: "Flooring", quantity: 150, unit: "sq ft", unitPrice: 8, total: 1200 },
            { description: "Electrical", quantity: 1, unit: "job", unitPrice: 2500, total: 2500 },
            { description: "Plumbing", quantity: 1, unit: "job", unitPrice: 1800, total: 1800 },
          ],
          subtotal: 11875,
          tax: 950,
          total: 12825,
        })
        setIsGenerating(false)
      }, 2000)
    } catch (error) {
      console.error("Error generating estimate:", error)
      setIsGenerating(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Recording Card */}
      <Card>
        <CardHeader>
          <CardTitle>Voice Recording</CardTitle>
          <CardDescription>
            Describe your project in detail. Include materials, dimensions, and any special requirements.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Record Button */}
          <div className="flex justify-center">
            <button
              onClick={isRecording ? handleStopRecording : handleStartRecording}
              className={cn(
                "flex h-32 w-32 items-center justify-center rounded-full transition-all",
                isRecording
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
            >
              {isRecording ? <Square className="h-12 w-12" /> : <Mic className="h-12 w-12" />}
            </button>
          </div>

          {isRecording && <p className="text-center text-sm text-muted-foreground">Recording... Click to stop</p>}

          {/* Transcript */}
          <div>
            <label htmlFor="transcript" className="mb-2 block text-sm font-medium">
              Live Transcript
            </label>
            <Textarea
              id="transcript"
              placeholder="Your transcript will appear here as you speak..."
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
              aria-label="Project transcript"
            />
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerateEstimate}
            disabled={!transcript.trim() || isGenerating}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Estimate...
              </>
            ) : (
              "Generate Estimate"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Estimate Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Estimate Preview</CardTitle>
          <CardDescription>
            {estimate ? "Review and edit your generated estimate" : "Your estimate will appear here"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {estimate ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">{estimate.projectName}</h3>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {estimate.items.map((item: any, index: number) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{item.description}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell className="text-right">${item.unitPrice.toLocaleString()}</TableCell>
                        <TableCell className="text-right">${item.total.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={4} className="text-right font-semibold">
                        Subtotal
                      </TableCell>
                      <TableCell className="text-right font-semibold">${estimate.subtotal.toLocaleString()}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4} className="text-right">
                        Tax (8%)
                      </TableCell>
                      <TableCell className="text-right">${estimate.tax.toLocaleString()}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4} className="text-right text-lg font-bold">
                        Total
                      </TableCell>
                      <TableCell className="text-right text-lg font-bold">${estimate.total.toLocaleString()}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="flex gap-2">
                <Button className="flex-1">Save Estimate</Button>
                <Button variant="outline" className="flex-1 bg-transparent">
                  Export PDF
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[300px] items-center justify-center text-center">
              <div>
                <p className="text-muted-foreground">
                  Record your project description and click "Generate Estimate" to see results here.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
