import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs' // Disable Edge runtime for OpenAI API compatibility

export async function POST(request: NextRequest) {
  try {
    // Parse multipart form data
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File
    
    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      )
    }

    // Check if OpenAI API key is available
    const openaiApiKey = process.env.OPENAI_API_KEY
    
    if (openaiApiKey) {
      // Use OpenAI Whisper API for accurate transcription
      try {
        const transcription = await transcribeWithOpenAI(audioFile, openaiApiKey)
        return NextResponse.json({ transcript: transcription })
      } catch (error) {
        console.error('OpenAI transcription error:', error)
        // Fall back to client transcript if OpenAI fails
        const clientTranscript = formData.get('transcript') as string
        return NextResponse.json({ 
          transcript: clientTranscript || 'Transcription failed' 
        })
      }
    } else {
      // Use client-side Web Speech API transcript as fallback
      const clientTranscript = formData.get('transcript') as string
      return NextResponse.json({ 
        transcript: clientTranscript || 'No transcript available' 
      })
    }
  } catch (error) {
    console.error('Transcription API error:', error)
    return NextResponse.json(
      { error: 'Transcription failed' },
      { status: 500 }
    )
  }
}

async function transcribeWithOpenAI(audioFile: File, apiKey: string): Promise<string> {
  // Convert File to Buffer
  const arrayBuffer = await audioFile.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  
  // Create FormData for OpenAI API
  const formData = new FormData()
  formData.append('file', new Blob([buffer], { type: audioFile.type }), audioFile.name)
  formData.append('model', 'whisper-1')
  formData.append('language', 'en')
  formData.append('response_format', 'json')

  // Call OpenAI Whisper API
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(`OpenAI API error: ${response.status} ${errorData.error?.message || response.statusText}`)
  }

  const result = await response.json()
  return result.text || 'No transcription available'
}
