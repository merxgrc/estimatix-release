'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface UseVoiceChatReturn {
  isRecording: boolean
  isTranscribing: boolean
  transcript: string
  error: string | null
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  resetTranscript: () => void
}

/**
 * Simple voice dictation hook for recording and transcription
 * Focuses on: startRecording -> stopRecording -> transcribe
 * Atomic stop flow: transcription happens synchronously within stopRecording
 */
export function useVoiceChat(): UseVoiceChatReturn {
  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Refs for MediaRecorder
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  /**
   * Transcribe audio blob using /api/transcribe endpoint
   */
  const transcribeAudio = useCallback(async (audioBlob: Blob) => {
    console.log('[Voice Chat] Transcribing blob of size:', audioBlob.size, 'bytes, type:', audioBlob.type)
    setIsTranscribing(true)
    setError(null)
    setTranscript('')

    try {
      const formData = new FormData()
      const audioFile = new File([audioBlob], 'recording.webm', { type: audioBlob.type })
      formData.append('audio', audioFile)

      console.log('[Voice Chat] Sending to /api/transcribe...', { fileName: audioFile.name, fileSize: audioFile.size })

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      })

      console.log('[Voice Chat] Transcription response:', { status: response.status, ok: response.ok })

      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      const transcribedText = data.transcript || ''

      console.log('[Voice Chat] Transcription complete:', { transcriptLength: transcribedText.length, preview: transcribedText.substring(0, 50) })

      setTranscript(transcribedText)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to transcribe audio'
      console.error('[Voice Chat] Transcription error:', err)
      setError(errorMessage)
      setTranscript('')
    } finally {
      setIsTranscribing(false)
      console.log('[Voice Chat] Transcription finished')
    }
  }, [])

  /**
   * Start recording audio from microphone
   */
  const startRecording = useCallback(async () => {
    console.log('[Voice Chat] startRecording called')
    
    try {
      setError(null)
      setTranscript('')

      // Browser support check
      if (typeof window === 'undefined') {
        throw new Error('Window is undefined - not in browser environment')
      }

      if (!navigator.mediaDevices) {
        console.error('[Voice Chat] No mediaDevices support')
        throw new Error('Your browser does not support microphone access. Please use a modern browser.')
      }

      if (!navigator.mediaDevices.getUserMedia) {
        console.error('[Voice Chat] No getUserMedia support')
        throw new Error('Your browser does not support getUserMedia. Please use a modern browser.')
      }

      console.log('[Voice Chat] Requesting mic access...')

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      })

      console.log('[Voice Chat] Mic stream acquired', { 
        streamId: stream.id, 
        tracks: stream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState }))
      })

      streamRef.current = stream
      audioChunksRef.current = []

      // Determine supported mimeType
      let mimeType: string | undefined
      const supportedTypes = ['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/wav']
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type
          console.log('[Voice Chat] Using mimeType:', mimeType)
          break
        }
      }

      if (!mimeType) {
        console.warn('[Voice Chat] No supported mimeType found, using browser default')
      }

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      console.log('[Voice Chat] MediaRecorder created', { 
        state: mediaRecorder.state, 
        mimeType: mediaRecorder.mimeType,
        audioBitsPerSecond: mediaRecorder.audioBitsPerSecond
      })

      mediaRecorderRef.current = mediaRecorder

      // Collect audio chunks
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log('[Voice Chat] Chunk received', { size: event.data.size, type: event.data.type })
          audioChunksRef.current.push(event.data)
        } else {
          console.warn('[Voice Chat] Empty chunk received')
        }
      }

      mediaRecorder.onerror = (event) => {
        console.error('[Voice Chat] MediaRecorder error:', event)
      }

      mediaRecorder.onstart = () => {
        console.log('[Voice Chat] MediaRecorder started')
      }

      // Start recording
      mediaRecorder.start(1000) // Collect data every second
      console.log('[Voice Chat] MediaRecorder.start() called, state:', mediaRecorder.state)
      
      setIsRecording(true)
      console.log('[Voice Chat] isRecording state set to true')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start recording. Please check your microphone permissions.'
      console.error('[Voice Chat] Failed to start recording:', err)
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [])

  /**
   * Stop recording and automatically transcribe
   * Atomic flow: transcription happens synchronously within this function
   */
  const stopRecording = useCallback(async (): Promise<void> => {
    console.log('[Voice Chat] stopRecording called', { 
      hasRecorder: !!mediaRecorderRef.current, 
      isRecording, 
      recorderState: mediaRecorderRef.current?.state 
    })

    if (!mediaRecorderRef.current || !isRecording) {
      console.warn('[Voice Chat] stopRecording called but recorder not active', {
        hasRecorder: !!mediaRecorderRef.current,
        isRecording
      })
      return
    }

    const recorder = mediaRecorderRef.current
    const mimeType = recorder.mimeType

    console.log('[Voice Chat] Stopping recorder...', { 
      state: recorder.state, 
      mimeType,
      chunksCount: audioChunksRef.current.length,
      totalChunkSize: audioChunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0)
    })

    // Update state immediately to prevent cleanup from interfering
    setIsRecording(false)

    // Create a Promise to wait for the final dataavailable event
    return new Promise<void>((resolve) => {
      let finalChunkReceived = false

      // Set up handler for final dataavailable event
      const handleDataAvailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          console.log('[Voice Chat] Final chunk received', { size: event.data.size })
          audioChunksRef.current.push(event.data)
        }
        finalChunkReceived = true
      }

      // Set up handler for when recorder stops
      const handleStop = () => {
        console.log('[Voice Chat] MediaRecorder stopped event fired')
        
        // Wait a tick to ensure all chunks are collected
        setTimeout(() => {
          const audioBlob = new Blob(audioChunksRef.current, {
            type: mimeType || 'audio/webm',
          })

          console.log('[Voice Chat] Audio blob created', { 
            blobSize: audioBlob.size, 
            blobType: audioBlob.type,
            chunksUsed: audioChunksRef.current.length
          })

          // Immediately call transcribe - this happens synchronously in the stop flow
          transcribeAudio(audioBlob).finally(() => {
            resolve()
          })
        }, 100)
      }

      // Attach event handlers
      recorder.addEventListener('dataavailable', handleDataAvailable)
      recorder.addEventListener('stop', handleStop)

      // Request final chunk and stop
      recorder.requestData()
      recorder.stop()
      
      console.log('[Voice Chat] recorder.stop() called, new state:', recorder.state)

      // Stop all tracks (but keep refs for transcription)
      if (streamRef.current) {
        console.log('[Voice Chat] Stopping stream tracks...')
        streamRef.current.getTracks().forEach((track) => {
          track.stop()
          console.log('[Voice Chat] Track stopped', { kind: track.kind, id: track.id })
        })
        // Don't null the stream ref yet - transcription might need it
      }

      // Fallback: if stop event doesn't fire within 2 seconds, proceed anyway
      setTimeout(() => {
        if (!finalChunkReceived) {
          console.warn('[Voice Chat] Stop event timeout, proceeding with transcription')
          const audioBlob = new Blob(audioChunksRef.current, {
            type: mimeType || 'audio/webm',
          })
          transcribeAudio(audioBlob).finally(() => {
            resolve()
          })
        }
      }, 2000)
    })
  }, [isRecording, transcribeAudio])

  /**
   * Reset transcript to empty string
   * Used to clear transcript after it's been consumed to prevent infinite loops
   */
  const resetTranscript = useCallback(() => {
    console.log('[Voice Chat] Resetting transcript')
    setTranscript('')
  }, [])

  // Cleanup on unmount - only cleanup tracks, don't stop recording
  useEffect(() => {
    return () => {
      console.log('[Voice Chat] Cleanup on unmount - stopping tracks only')
      // Only stop stream tracks on unmount, don't interfere with active recording/transcription
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          if (track.readyState !== 'ended') {
            track.stop()
          }
        })
      }
    }
  }, []) // Empty deps - only run on unmount

  return {
    isRecording,
    isTranscribing,
    transcript,
    error,
    startRecording,
    stopRecording,
    resetTranscript,
  }
}
