// Web Speech API TypeScript declarations

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onstart: (() => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

interface SpeechRecognitionStatic {
  new (): SpeechRecognition
}

interface Window {
  SpeechRecognition: SpeechRecognitionStatic
  webkitSpeechRecognition: SpeechRecognitionStatic
}

// Wake Lock API
interface WakeLock {
  request(type: 'screen'): Promise<WakeLockSentinel>
}

interface WakeLockSentinel {
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
  removeEventListener(type: 'release', listener: () => void): void
}

interface Navigator {
  wakeLock?: WakeLock
}


