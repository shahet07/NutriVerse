import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { MicVAD } from '@ricky0123/vad-web'
import type { CookingSessionState, ChefIntentResponse, ChefParseResponse } from '@/lib/types'

// ── Types ──────────────────────────────────────────────────────────

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export interface UseKitchenSocketReturn {
  status: ConnectionStatus
  state: CookingSessionState | null
  listening: boolean
  transcript: string
  chatMessages: ChatMsg[]
  chatLoading: boolean
  error: string | null
  /** Send parsed recipe data to initialize the cooking session. */
  initSession: (parsed: ChefParseResponse) => void
  startRecording: () => void
  stopRecording: () => void
  sendAction: (action: string, extra?: Record<string, unknown>) => void
  sendChat: (text: string) => void
  /** Request fresh state from server (for timer sync). */
  requestState: () => void
}

// ── Constants ──────────────────────────────────────────────────────

const MAX_RECONNECT = 6
const BASE_DELAY = 600
const MAX_DELAY = 12_000

// ── Hook ───────────────────────────────────────────────────────────

export function useKitchenSocket(sessionId: string): UseKitchenSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [state, setState] = useState<CookingSessionState | null>(null)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const vadRef = useRef<MicVAD | null>(null)
  const reconnectRef = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedRef = useRef(false)
  const connectedOnce = useRef(false)

  const wsUrl = useMemo(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws/kitchen/${encodeURIComponent(sessionId)}`
  }, [sessionId])

  // ── Message handling ────────────────────────────────────────────

  const handleMsg = useCallback((raw: string) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    switch (msg.type) {
      case 'connected':
        break

      case 'state':
        if (msg.payload && typeof msg.payload === 'object') {
          setState(msg.payload as CookingSessionState)
        }
        break

      case 'transcript':
        if (typeof msg.text === 'string') {
          setTranscript(msg.text)
          if (msg.final) setTimeout(() => setTranscript(''), 3000)
        }
        break

      case 'intent': {
        const intent = msg as unknown as ChefIntentResponse & { type: string }
        // Feedback text goes to chat if non-empty and not a NOOP
        if (intent.display_text && intent.action !== 'NOOP' && intent.action !== 'ASK') {
          setChatMessages(prev => [...prev, { role: 'assistant', content: intent.display_text! }])
        }
        break
      }

      case 'chat-reply':
        if (typeof msg.content === 'string') {
          const role = (msg.role as 'user' | 'assistant') ?? 'assistant'
          setChatMessages(prev => [...prev, { role, content: msg.content as string }])
          if (role === 'assistant') setChatLoading(false)
        }
        break

      case 'action-feedback':
        // Brief feedback from touch actions — shown in chat
        if (typeof msg.text === 'string' && msg.text) {
          setChatMessages(prev => [...prev, { role: 'assistant', content: msg.text as string }])
        }
        break

      case 'error':
        setError(typeof msg.message === 'string' ? msg.message : 'Server error')
        break
    }
  }, [])

  // ── Send helpers ────────────────────────────────────────────────

  const sendJson = useCallback((data: Record<string, unknown>) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }, [])

  const initSession = useCallback((parsed: ChefParseResponse) => {
    sendJson({ type: 'init-session', data: parsed })
  }, [sendJson])

  const sendAction = useCallback((action: string, extra?: Record<string, unknown>) => {
    sendJson({ type: 'action', action, ...extra })
  }, [sendJson])

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setChatLoading(true)
    sendJson({ type: 'chat', text: trimmed })
  }, [sendJson])

  const requestState = useCallback(() => {
    sendJson({ type: 'get-state' })
  }, [sendJson])

  // ── Connection lifecycle ────────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null
      wsRef.current.onmessage = null
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      if (wsRef.current.readyState < WebSocket.CLOSING) wsRef.current.close()
    }

    setStatus('connecting')
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      setStatus('connected')
      setError(null)
      reconnectRef.current = 0
      connectedOnce.current = true
    }

    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') handleMsg(e.data)
    }

    ws.onclose = () => {
      if (!closedRef.current) {
        setStatus('disconnected')
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      if (!connectedOnce.current) setError('Could not connect to server.')
    }
  }, [wsUrl, handleMsg])

  const scheduleReconnect = useCallback(() => {
    if (closedRef.current) return
    if (reconnectRef.current >= MAX_RECONNECT) {
      setStatus('error')
      setError('Lost connection. Please refresh the page.')
      return
    }
    const attempt = reconnectRef.current++
    const delay = Math.min(BASE_DELAY * 2 ** attempt, MAX_DELAY)
    reconnectTimer.current = setTimeout(() => {
      if (!closedRef.current) connect()
    }, delay)
  }, [connect])

  // ── Mount / unmount ─────────────────────────────────────────────

  useEffect(() => {
    closedRef.current = false
    connect()
    return () => {
      closedRef.current = true
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      const ws = wsRef.current
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
        if (ws.readyState < WebSocket.CLOSING) ws.close(1000)
        wsRef.current = null
      }
      if (vadRef.current) {
        vadRef.current.pause()
        vadRef.current.destroy()
        vadRef.current = null
      }
    }
  }, [connect])

  // ── MediaRecorder ───────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    if (vadRef.current) return

    try {
      const vad = await MicVAD.new({
        model: 'legacy',
        baseAssetPath: '/',
        onnxWASMBasePath: '/',
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        minSpeechFrames: 3,
        preSpeechPadFrames: 10,
        onSpeechStart: () => {
          setListening(true)
          setError(null)
        },
        onSpeechEnd: (audio: Float32Array) => {
          const ws = wsRef.current
          if (!ws || ws.readyState !== WebSocket.OPEN) return
          ws.send(_encodeWAV(audio, 16000))
          ws.send(JSON.stringify({ type: 'speech_end' }))
          setListening(false)
        },
        onVADMisfire: () => setListening(false),
      })
      vadRef.current = vad
      vad.start()
    } catch (err) {
      const e = err as DOMException
      if (e.name === 'NotAllowedError') {
        setError('Microphone access denied. Please allow mic permission.')
      } else if (e.name === 'NotFoundError') {
        setError('No microphone found.')
      } else {
        setError(`Mic error: ${e.message}`)
      }
      setListening(false)
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.pause()
      vadRef.current.destroy()
      vadRef.current = null
    }
    setListening(false)
    setTranscript('')
  }, [])

  return {
    status,
    state,
    listening,
    transcript,
    chatMessages,
    chatLoading,
    error,
    initSession,
    startRecording,
    stopRecording,
    sendAction,
    sendChat,
    requestState,
  }
}

function _encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataLen = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataLen)
  const view = new DataView(buffer)
  _writeStr(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true)
  _writeStr(view, 8, 'WAVE')
  _writeStr(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)   // PCM
  view.setUint16(22, 1, true)   // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  _writeStr(view, 36, 'data')
  view.setUint32(40, dataLen, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return buffer
}

function _writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}
