'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Mic, MicOff, Square, Play, Pause, Upload, AlertCircle, CheckCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'

interface RecorderProps {
  projectId?: string
  onRecordingComplete?: (audioBlob: Blob, transcript: string) => void
}

export function Recorder({ projectId, onRecordingComplete }: RecorderProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [transcript, setTranscript] = useState('')
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isTranscribingAPI, setIsTranscribingAPI] = useState(false)
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const { user } = useAuth()

  // Check microphone permission on mount
  useEffect(() => {
    checkMicrophonePermission()
  }, [])

  // Prevent screen sleep during recording
  useEffect(() => {
    if (isRecording && 'wakeLock' in navigator) {
      navigator.wakeLock?.request('screen').catch(console.error)
    }
  }, [isRecording])

  const checkMicrophonePermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setPermissionGranted(true)
      stream.getTracks().forEach(track => track.stop())
    } catch (err) {
      setPermissionGranted(false)
      setError('Microphone permission denied. Please allow microphone access to record.')
    }
  }

  const startRecording = async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      })
      
      streamRef.current = stream
      audioChunksRef.current = []
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/wav'
      })
      
      mediaRecorderRef.current = mediaRecorder
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }
      
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: mediaRecorder.mimeType 
        })
        setAudioBlob(audioBlob)
        stopTranscription()
      }
      
      mediaRecorder.start(1000) // Collect data every second
      setIsRecording(true)
      setElapsedTime(0)
      
      // Start timer
      intervalRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1)
      }, 1000)
      
      // Start speech recognition
      startTranscription()
      
    } catch (err) {
      setError('Failed to start recording. Please check your microphone permissions.')
      console.error('Recording error:', err)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setIsPaused(false)
      
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
    }
  }

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (isPaused) {
        mediaRecorderRef.current.resume()
        setIsPaused(false)
        startTranscription()
      } else {
        mediaRecorderRef.current.pause()
        setIsPaused(true)
        stopTranscription()
      }
    }
  }

  const startTranscription = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      const recognition = new SpeechRecognition()
      
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'
      
      recognition.onresult = (event) => {
        let finalTranscript = ''
        let interimTranscript = ''
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            finalTranscript += transcript
          } else {
            interimTranscript += transcript
          }
        }
        
        setTranscript(prev => prev + finalTranscript + interimTranscript)
      }
      
      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
      }
      
      recognitionRef.current = recognition
      recognition.start()
      setIsTranscribing(true)
    }
  }

  const stopTranscription = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      setIsTranscribing(false)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const transcribeAudio = async (audioBlob: Blob, clientTranscript: string) => {
    setIsTranscribingAPI(true)
    setError(null)
    
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')
      formData.append('transcript', clientTranscript)
      
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.status}`)
      }
      
      const result = await response.json()
      return result.transcript
    } catch (error) {
      console.error('Transcription API error:', error)
      // Return client transcript as fallback
      return clientTranscript
    } finally {
      setIsTranscribingAPI(false)
    }
  }

  const uploadRecording = async () => {
    if (!audioBlob || !user) {
      setError('Missing audio data or user authentication')
      return
    }
    
    setIsUploading(true)
    setError(null)
    
    try {
      console.log('Starting upload process...', { user: user.id, audioSize: audioBlob.size })
      
      // Get enhanced transcript from API
      console.log('Getting enhanced transcript...')
      const enhancedTranscript = await transcribeAudio(audioBlob, transcript)
      console.log('Enhanced transcript:', enhancedTranscript)
      
      // Create a unique filename with user-specific path
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileExt = audioBlob.type.includes('webm') ? 'webm' : 'wav'
      const fileName = `${user.id}/recording-${timestamp}.${fileExt}`
      
      console.log('Uploading to storage:', fileName)
      
      // Upload to Supabase Storage with user-specific path
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('audio-uploads')
        .upload(fileName, audioBlob, {
          contentType: audioBlob.type,
          upsert: false
        })
      
      if (uploadError) {
        console.error('Storage upload error:', uploadError)
        throw new Error(`Storage error: ${uploadError.message}`)
      }
      
      console.log('Storage upload successful:', uploadData)
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('audio-uploads')
        .getPublicUrl(fileName)
      
      console.log('Generated public URL:', urlData.publicUrl)
      
      // Save to database with user_id and enhanced transcript
      const { data: insertData, error: dbError } = await supabase
        .from('uploads')
        .insert({
          project_id: projectId || null,
          file_url: urlData.publicUrl,
          kind: 'audio',
          user_id: user.id,
        })
        .select()
      
      if (dbError) {
        console.error('Database insert error:', dbError)
        throw new Error(`Database error: ${dbError.message}`)
      }
      
      console.log('Database insert successful:', insertData)
      
      // Update the transcript with the enhanced version
      setTranscript(enhancedTranscript)
      
      setUploadSuccess(true)
      onRecordingComplete?.(audioBlob, enhancedTranscript)
      
    } catch (err) {
      console.error('Upload error details:', {
        error: err,
        message: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined
      })
      
      const errorMessage = err instanceof Error 
        ? err.message 
        : 'Failed to upload recording. Please try again.'
      
      setError(errorMessage)
    } finally {
      setIsUploading(false)
    }
  }

  const resetRecording = () => {
    setAudioBlob(null)
    setTranscript('')
    setElapsedTime(0)
    setUploadSuccess(false)
    setError(null)
  }

  if (permissionGranted === false) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader className="text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <CardTitle>Microphone Access Required</CardTitle>
          <CardDescription>
            Please allow microphone access to record your project description.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button onClick={checkMicrophonePermission} variant="outline">
            Grant Permission
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Recording Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Voice Recording
          </CardTitle>
          <CardDescription>
            Record your project description. Speak clearly and describe your project in detail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Timer */}
          <div className="text-center">
            <div className="text-3xl font-mono font-bold text-primary">
              {formatTime(elapsedTime)}
            </div>
            <div className="text-sm text-muted-foreground">
              {isRecording ? (isPaused ? 'Paused' : 'Recording...') : 'Ready to record'}
            </div>
          </div>

          {/* Controls */}
          <div className="flex justify-center gap-4">
            {!isRecording ? (
              <Button 
                onClick={startRecording} 
                size="lg"
                className="bg-red-500 hover:bg-red-600"
                disabled={permissionGranted === null}
              >
                <Mic className="mr-2 h-4 w-4" />
                Start Recording
              </Button>
            ) : (
              <>
                <Button 
                  onClick={pauseRecording} 
                  variant="outline"
                  size="lg"
                >
                  {isPaused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button 
                  onClick={stopRecording} 
                  variant="destructive"
                  size="lg"
                >
                  <Square className="mr-2 h-4 w-4" />
                  Stop Recording
                </Button>
              </>
            )}
          </div>

          {/* Live Transcript */}
          {isTranscribing && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Live Transcript:
              </div>
              <div className="text-sm">
                {transcript || 'Listening...'}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recording Preview */}
      {audioBlob && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Recording Complete
            </CardTitle>
            <CardDescription>
              Your recording is ready. You can play it back or upload it to save.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Audio Player */}
            <div className="flex justify-center">
              <audio 
                controls 
                src={URL.createObjectURL(audioBlob)}
                className="w-full max-w-md"
              />
            </div>

            {/* Transcript */}
            {transcript && (
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm font-medium text-muted-foreground mb-2">
                  Transcript:
                </div>
                <div className="text-sm">
                  {transcript}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-center gap-4">
              <Button 
                onClick={uploadRecording} 
                disabled={isUploading || isTranscribingAPI}
                className="bg-green-500 hover:bg-green-600"
              >
                {isTranscribingAPI ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Transcribing...
                  </>
                ) : isUploading ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Save Recording
                  </>
                )}
              </Button>
              <Button onClick={resetRecording} variant="outline">
                Record Again
              </Button>
            </div>

            {uploadSuccess && (
              <div className="text-center text-green-600 text-sm">
                ✓ Recording saved successfully!
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
