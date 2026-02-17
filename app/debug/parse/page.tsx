'use client'

/**
 * Dev-Only Debug Parse Result Page
 *
 * Upload a PDF blueprint and see the structured parse output:
 * - Sheet classification (page type, detected level, confidence)
 * - Per-sheet room extraction (room name, type, level, dimensions)
 * - Room counts by level and by type
 * - Area-based item detection preview
 *
 * Path: /debug/parse
 * Only available in development (NODE_ENV !== 'production')
 */

import { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Upload, FileText, Loader2, AlertTriangle, CheckCircle2, Building2, Layers } from 'lucide-react'

interface SheetResult {
  sheet_id: number
  sheet_title: string
  detected_level: string
  classification: string
  room_count: number
  rooms: Array<{
    name: string
    level: string
    type: string | null
    area_sqft: number | null
    dimensions: string | null
    length_ft?: number | null
    width_ft?: number | null
    ceiling_height_ft?: number | null
    confidence: number
  }>
}

interface ParseResult {
  success: boolean
  method: string
  pdfType: string
  totalPages: number
  pagesWithText: number
  sheets: SheetResult[]
  sheetsDetected: number
  rooms: Array<{
    name: string
    level: string
    type: string | null
    area_sqft: number | null
    dimensions: string | null
    length_ft?: number | null
    width_ft?: number | null
    ceiling_height_ft?: number | null
    confidence: number
  }>
  roomCount: number
  roomsByLevel: Record<string, number>
  roomsByType: Record<string, number>
  pageClassifications: Array<{
    pageNumber: number
    type: string
    confidence: number
    hasRoomLabels: boolean
    detectedLevel: string
    sheetTitle: string
    reason?: string
  }>
  processingTimeMs: number
  error?: string
}

export default function DebugParsePage() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleUpload = useCallback(async () => {
    if (!file) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/plans/test-parse', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || `HTTP ${response.status}`)
        return
      }

      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [file])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.type === 'application/pdf' || droppedFile.name.endsWith('.pdf'))) {
      setFile(droppedFile)
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="bg-orange-100 p-2 rounded-lg">
            <Building2 className="h-6 w-6 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Debug Parse Result</h1>
            <p className="text-sm text-muted-foreground">
              Upload a blueprint PDF to see sheet classification, level detection, and room extraction results.
            </p>
          </div>
          <Badge variant="outline" className="ml-auto text-orange-600 border-orange-300">DEV ONLY</Badge>
        </div>

        {/* Upload Area */}
        <Card>
          <CardContent className="pt-6">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-orange-400 hover:bg-orange-50/50 transition-colors"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">
                {file ? (
                  <span className="flex items-center justify-center gap-2">
                    <FileText className="h-4 w-4" />
                    {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                ) : (
                  'Drop a PDF here or click to select'
                )}
              </p>
              <input
                id="file-input"
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0]
                  if (selected) setFile(selected)
                }}
              />
            </div>

            <div className="flex justify-end mt-4">
              <Button
                onClick={handleUpload}
                disabled={!file || loading}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  'Parse Blueprint'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-800">Parse Error</p>
                <p className="text-sm text-red-600 mt-1">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Summary Bar */}
            <Card className={result.success ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-4">
                  {result.success ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  )}
                  <span className="font-semibold">
                    {result.success ? 'Parse Successful' : 'Parse Completed with Warnings'}
                  </span>
                  <span className="text-sm text-muted-foreground ml-auto">
                    {result.processingTimeMs}ms
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-2xl font-bold">{result.totalPages}</div>
                    <div className="text-xs text-muted-foreground">Total Pages</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-2xl font-bold">{result.sheetsDetected}</div>
                    <div className="text-xs text-muted-foreground">Sheets Detected</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-2xl font-bold text-orange-600">{result.roomCount}</div>
                    <div className="text-xs text-muted-foreground">Rooms Found</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-2xl font-bold">{Object.keys(result.roomsByLevel || {}).length}</div>
                    <div className="text-xs text-muted-foreground">Levels</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Rooms by Level */}
            {result.roomsByLevel && Object.keys(result.roomsByLevel).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="h-5 w-5" />
                    Rooms by Level
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {Object.entries(result.roomsByLevel).map(([level, count]) => (
                      <div key={level} className="bg-gray-50 rounded-lg p-3 border text-center">
                        <div className="text-lg font-bold">{count}</div>
                        <div className="text-xs text-muted-foreground">{level}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Rooms by Type */}
            {result.roomsByType && Object.keys(result.roomsByType).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Rooms by Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(result.roomsByType)
                      .sort(([, a], [, b]) => b - a)
                      .map(([type, count]) => (
                        <Badge key={type} variant="secondary" className="text-sm">
                          {type}: {count}
                        </Badge>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Per-Sheet Detail */}
            {result.sheets && result.sheets.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Sheet-Level Detail</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {result.sheets.map((sheet) => (
                    <div key={sheet.sheet_id} className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Badge className="bg-orange-100 text-orange-700 border-orange-200">
                          Page {sheet.sheet_id}
                        </Badge>
                        <span className="font-medium">{sheet.sheet_title || 'Untitled'}</span>
                        <Badge variant="outline">{sheet.detected_level}</Badge>
                        <Badge variant="secondary">{sheet.classification}</Badge>
                        <span className="ml-auto text-sm text-muted-foreground">
                          {sheet.room_count} room{sheet.room_count !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {sheet.rooms.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-left text-muted-foreground">
                                <th className="pb-2 pr-4">Room Name</th>
                                <th className="pb-2 pr-4">Type</th>
                                <th className="pb-2 pr-4">Level</th>
                                <th className="pb-2 pr-4">Area (sqft)</th>
                                <th className="pb-2 pr-4">Dimensions</th>
                                <th className="pb-2 pr-4">L × W × H (ft)</th>
                                <th className="pb-2">Confidence</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sheet.rooms.map((room, idx) => (
                                <tr key={idx} className="border-b last:border-0">
                                  <td className="py-2 pr-4 font-medium">{room.name}</td>
                                  <td className="py-2 pr-4">
                                    <Badge variant="outline" className="text-xs">{room.type || 'other'}</Badge>
                                  </td>
                                  <td className="py-2 pr-4">{room.level}</td>
                                  <td className="py-2 pr-4">{room.area_sqft ?? '—'}</td>
                                  <td className="py-2 pr-4 text-xs text-muted-foreground">
                                    {room.dimensions || '—'}
                                  </td>
                                  <td className="py-2 pr-4 text-xs">
                                    {room.length_ft || '—'} × {room.width_ft || '—'} × {room.ceiling_height_ft || '—'}
                                  </td>
                                  <td className="py-2">
                                    <span className={`text-xs font-medium ${
                                      room.confidence >= 80 ? 'text-green-600' :
                                      room.confidence >= 50 ? 'text-yellow-600' : 'text-red-600'
                                    }`}>
                                      {room.confidence}%
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No rooms detected on this sheet</p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Page Classifications */}
            {result.pageClassifications && result.pageClassifications.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Page Classifications</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4">Page</th>
                          <th className="pb-2 pr-4">Type</th>
                          <th className="pb-2 pr-4">Level</th>
                          <th className="pb-2 pr-4">Sheet Title</th>
                          <th className="pb-2 pr-4">Room Labels</th>
                          <th className="pb-2 pr-4">Confidence</th>
                          <th className="pb-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.pageClassifications.map((pc) => (
                          <tr key={pc.pageNumber} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{pc.pageNumber}</td>
                            <td className="py-2 pr-4">
                              <Badge
                                variant={pc.type === 'floor_plan' ? 'default' : 'outline'}
                                className={pc.type === 'floor_plan' ? 'bg-orange-600' : ''}
                              >
                                {pc.type}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4">{pc.detectedLevel}</td>
                            <td className="py-2 pr-4 text-xs max-w-[200px] truncate">
                              {pc.sheetTitle || '—'}
                            </td>
                            <td className="py-2 pr-4">
                              {pc.hasRoomLabels ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2 pr-4">{pc.confidence}%</td>
                            <td className="py-2 text-xs text-muted-foreground">{pc.reason || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Raw JSON (collapsible) */}
            <Card>
              <CardHeader>
                <CardTitle>
                  <details>
                    <summary className="cursor-pointer">Raw JSON Response</summary>
                  </details>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <details>
                  <summary className="text-sm text-muted-foreground cursor-pointer mb-2">
                    Click to expand
                  </summary>
                  <pre className="bg-gray-900 text-gray-100 text-xs p-4 rounded-lg overflow-auto max-h-[600px]">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
