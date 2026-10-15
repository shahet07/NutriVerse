/**
 * Chef Remote – Phone-side kitchen companion.
 * Route: /chef-remote?session=<sessionId>
 *
 * Opened on a phone by scanning a QR code from the PC's /chef page.
 * Streams audio to the FastAPI backend via WebSocket for real-time
 * speech-to-text and intent parsing — no client-side SpeechRecognition,
 * no PeerJS, no WebRTC.  Fully MS Store sandbox compatible.
 *
 * Architecture:
 *   Phone MediaRecorder (WebM/Opus, 250 ms) ──► WebSocket ──► Backend
 *   Backend: VAD → STT (Whisper) → Intent Pipeline → JSON response
 *   Backend also relays CookingSessionState from the PC host.
 *
 * The phone does NO AI processing — transcription, intent parsing, and
 * Q&A chat all happen on the backend.  This page is a premium,
 * touch-optimised display + microphone.
 */
import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChefHat,
  Wifi,
  WifiOff,
  Timer,
  CheckCircle2,
  Circle,
  Wrench,
  Lightbulb,
  ArrowRight,
  ArrowLeft,
  Send,
  MessageCircle,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  CookingPot,
  ListChecks,
  Flame,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAudioWebSocket } from '@/hooks/use-audio-websocket'
import type { CookingSessionState, ChefIntentResponse } from '@/lib/types'
import { ReportButton } from '@/components/ui/report-button'

// ── Helpers ─────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getSessionIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  // Support both ?session= (new) and ?peer= (legacy QR codes) for smooth migration
  return params.get('session') ?? params.get('peer') ?? null
}

// ── Main Component ──────────────────────────────────────────────────

export default function ChefRemotePage() {
  // -- Session ID from URL --
  const sessionId = getSessionIdFromUrl()

  // -- Audio WebSocket hook (replaces PeerJS + SpeechRecognition) --
  const {
    connectionStatus,
    sessionState,
    listening,
    transcript,
    chatMessages,
    chatLoading,
    errorMsg,
    startRecording,
    stopRecording,
    sendAction,
    sendChat,
    onIntent,
  } = useAudioWebSocket({ sessionId, role: 'phone', timeslice: 250 })

  // -- Chat input --
  const [chatInput, setChatInput] = useState('')
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // -- Wake lock ref --
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  // -- Persist session ID for reconnects on page refresh --
  useEffect(() => {
    if (sessionId) {
      sessionStorage.setItem('nutrisense-chef-session', sessionId)
    }
  }, [sessionId])

  // -- Handle voice intent responses from the backend --
  useEffect(() => {
    onIntent((_intent: ChefIntentResponse) => {
      // Intents are relayed to the host PC, which updates the session state
      // and pushes it back through the WebSocket.  The phone only needs to
      // handle display_text for local chat feedback.
    })
  }, [onIntent])

  // -- Auto-start voice when connected --
  useEffect(() => {
    if (connectionStatus === 'connected') {
      startRecording()
    }
    return () => {
      stopRecording()
    }
  }, [connectionStatus, startRecording, stopRecording])

  // -- Screen Wake Lock ───────────────────────────────────────────

  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null

    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          sentinel = await navigator.wakeLock.request('screen')
          wakeLockRef.current = sentinel
          sentinel.addEventListener('release', () => {
            wakeLockRef.current = null
          })
        }
      } catch {
        /* unsupported or denied */
      }
    }

    if (connectionStatus === 'connected') requestWakeLock()

    function handleVis() {
      if (document.visibilityState === 'visible' && connectionStatus === 'connected')
        requestWakeLock()
    }
    document.addEventListener('visibilitychange', handleVis)
    return () => {
      document.removeEventListener('visibilitychange', handleVis)
      sentinel?.release()
    }
  }, [connectionStatus])

  // -- Chat submit ────────────────────────────────────────────────

  const handleChatSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault()
      const msg = chatInput.trim()
      if (!msg || chatLoading) return
      sendChat(msg)
      setChatInput('')
    },
    [chatInput, chatLoading, sendChat],
  )

  // Auto-scroll chat
  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [chatMessages])

  // Automatically auto-scroll to the latest unchecked prep item
  useEffect(() => {
    if (sessionState?.phase === 'prep' && sessionState?.mise_en_place) {
      const firstUnchecked = sessionState.mise_en_place.find((i) => !i.done)
      if (firstUnchecked) {
        const el = document.getElementById(`prep-item-${firstUnchecked.id}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }
  }, [sessionState?.mise_en_place, sessionState?.phase])

  // ── RENDER ────────────────────────────────────────────────────────

  // -- Connecting / Error screen --
  if (connectionStatus !== 'connected') {
    return (
      <div className="min-h-[100dvh] bg-[#09090b] text-white flex flex-col items-center justify-center p-8">
        <div className="flex flex-col items-center gap-8 text-center max-w-xs">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/10 flex items-center justify-center">
              {connectionStatus === 'error' || connectionStatus === 'disconnected' ? (
                <WifiOff size={32} className="text-red-400" />
              ) : (
                <div className="w-8 h-8 rounded-full border-[3px] border-white/10 border-t-orange-400 animate-spin" />
              )}
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-semibold tracking-tight">NutriVerse Kitchen</h1>
            <p className="text-sm text-white/40 leading-relaxed">
              {connectionStatus === 'connecting' && 'Connecting to your cooking session...'}
              {connectionStatus === 'disconnected' && 'Session disconnected. Reconnecting...'}
              {connectionStatus === 'error' && (errorMsg ?? 'Connection failed.')}
            </p>
          </div>
          {(connectionStatus === 'error' || connectionStatus === 'disconnected') && (
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-2xl bg-white/[0.06] border border-white/[0.08] text-sm font-medium active:scale-95 transition-all"
            >
              Retry Connection
            </button>
          )}
        </div>
      </div>
    )
  }

  const phase = sessionState?.phase ?? 'cooking'
  const isPrep = phase === 'prep'
  const isDone = phase === 'done'

  // -- Connected – main UI --
  return (
    <div className="h-[100dvh] bg-[#09090b] text-white flex flex-col">
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur-xl sticky top-0 z-30 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <ChefHat size={14} className="text-white" />
          </div>
          <div className="leading-none">
            <p className="text-[13px] font-semibold tracking-tight">Kitchen Remote</p>
            {sessionState && (
              <p className="text-[10px] text-white/30 capitalize mt-0.5 truncate max-w-[150px]">
                {sessionState.recipe_name}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Voice indicator / toggle */}
          <button
            onClick={listening ? stopRecording : startRecording}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all',
              listening
                ? 'bg-orange-500/15 text-orange-400'
                : 'bg-white/[0.04] text-white/30',
            )}
          >
            {listening ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-400" />
                </span>
                Listening
              </>
            ) : (
              <>
                <MicOff size={11} />
                Mic off
              </>
            )}
          </button>
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/80">
            <Wifi size={11} />
            <span className="hidden min-[360px]:inline">Connected</span>
          </div>
        </div>
      </header>

      {/* ── Split Layout Area ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Upper Phase Section */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="p-4 pb-2 flex flex-col gap-3">
          {/* Live transcript bar */}
          <AnimatePresence>
            {transcript && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-500/[0.08] border border-orange-500/10">
                  <Mic size={12} className="text-orange-400 flex-shrink-0 animate-pulse" />
                  <p className="text-sm text-orange-300/70 truncate italic">{transcript}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!sessionState ? (
            /* Waiting for session */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-white/[0.03] flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-orange-400 animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-white/60">Waiting for session</p>
                <p className="text-xs text-white/25">Start a recipe on your PC to begin</p>
              </div>
            </div>
          ) : isPrep ? (
            /* ─────── PREP PHASE ─────── */
            <div className="flex flex-col gap-4">
              {/* Phase badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ListChecks size={14} className="text-amber-400" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-amber-400/80">
                    Preparation
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {sessionState.mise_en_place && (
                    <span className="text-xs tabular-nums text-white/30">
                      {sessionState.mise_en_place.filter((i) => i.done).length}/
                      {sessionState.mise_en_place.length} done
                    </span>
                  )}
                  <ReportButton
                    query={sessionState.recipe_name}
                    responseType="chef-remote-prep"
                    dark
                  />
                </div>
              </div>

              {/* Info chips */}
              <div className="flex flex-wrap gap-2">
                {sessionState.estimated_total_minutes && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] text-[11px] text-white/40">
                    <Timer size={11} /> {sessionState.estimated_total_minutes} min total
                  </span>
                )}
                {sessionState.total_steps > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] text-[11px] text-white/40">
                    <CookingPot size={11} /> {sessionState.total_steps} steps
                  </span>
                )}
                {sessionState.tools_required && sessionState.tools_required.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] text-[11px] text-white/40">
                    <Wrench size={11} /> {sessionState.tools_required.join(', ')}
                  </span>
                )}
              </div>

              {/* Prep checklist */}
              {sessionState.mise_en_place && sessionState.mise_en_place.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {sessionState.mise_en_place.map((item) => (
                    <button
                      key={item.id}
                      id={`prep-item-${item.id}`}
                      onClick={() => sendAction('toggle-prep', { id: item.id })}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 rounded-2xl border transition-all w-full text-left active:scale-[0.98]',
                        item.done
                          ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                          : 'border-white/[0.06] bg-white/[0.02]',
                      )}
                    >
                      {item.done ? (
                        <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <Circle size={16} className="text-white/20 flex-shrink-0 mt-0.5" />
                      )}
                      <p
                        className={cn(
                          'text-sm leading-relaxed',
                          item.done && 'line-through text-white/30',
                        )}
                      >
                        {item.text}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {/* Prep progress bar */}
              {sessionState.mise_en_place &&
                sessionState.mise_en_place.length > 0 &&
                (() => {
                  const done = sessionState.mise_en_place!.filter((i) => i.done).length
                  const total = sessionState.mise_en_place!.length
                  const pct = total > 0 ? (done / total) * 100 : 0
                  return (
                    <div className="space-y-1.5">
                      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {done === total && (
                        <div className="flex flex-col items-center gap-3 pt-1">
                          <p className="text-xs text-emerald-400/80 text-center">
                            All prep done – ready to cook!
                          </p>
                          <motion.button
                            onClick={() => sendAction('start-cooking')}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className={cn(
                              'flex items-center justify-center gap-2 w-full py-4 rounded-2xl',
                              'bg-gradient-to-r from-orange-500 to-amber-500 text-white',
                              'text-[15px] font-bold tracking-tight active:scale-[0.98] transition-transform',
                            )}
                          >
                            <Flame size={17} />
                            Start Cooking
                          </motion.button>
                        </div>
                      )}
                    </div>
                  )
                })()}
            </div>
          ) : isDone ? (
            /* ─────── DONE PHASE ─────── */
            <div className="flex flex-col items-center gap-5 py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 size={32} className="text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold">Cooking Complete</h2>
                <p className="text-sm text-white/40 capitalize">
                  {sessionState.recipe_name} – all {sessionState.total_steps} steps done
                </p>
              </div>
            </div>
          ) : (
            /* ─────── COOKING PHASE ─────── */
            <div className="flex flex-col gap-3">
              {/* Step counter + progress */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-orange-400/80">
                  Cooking
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums text-white/40">
                    <span className="text-orange-400 font-bold">{sessionState.current_step}</span>
                    <span className="mx-0.5">/</span>
                    {sessionState.total_steps}
                  </span>
                  <ReportButton
                    query={`${sessionState.recipe_name} — step ${sessionState.current_step}: ${sessionState.current_action}`}
                    responseType="chef-remote-cooking"
                    dark
                  />
                </div>
              </div>

              {/* Step progress bar */}
              <div className="flex gap-1 items-center">
                {sessionState.steps_overview.map((s, i) => {
                  const isCurrent = i + 1 === sessionState!.current_step
                  const isCompleted = s.completed === 'true'
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'h-1 rounded-full transition-all duration-300',
                        isCurrent
                          ? 'flex-[2] bg-orange-400'
                          : isCompleted
                            ? 'flex-1 bg-emerald-500/60'
                            : 'flex-1 bg-white/[0.06]',
                      )}
                    />
                  )
                })}
              </div>

              {/* Current step card */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={sessionState.current_step}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-2xl bg-white/[0.03] border border-white/[0.06] overflow-hidden"
                >
                  <div className="p-5">
                    {sessionState.current_tool && (
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <Wrench size={11} className="text-white/25" />
                        <span className="text-[11px] text-white/25 capitalize font-medium">
                          {sessionState.current_tool}
                        </span>
                      </div>
                    )}
                    <p className="text-[17px] font-semibold leading-relaxed tracking-tight">
                      {sessionState.current_action}
                    </p>
                    {sessionState.current_tip && (
                      <div className="mt-4 flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/[0.06] border border-amber-500/10">
                        <Lightbulb size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                        <p className="text-[13px] text-amber-200/60 leading-relaxed">
                          {sessionState.current_tip}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Timer */}
                  {sessionState.timer_total != null && sessionState.timer_left != null && (
                    <div className="border-t border-white/[0.04] px-5 py-4">
                      <div className="flex items-center gap-4">
                        <div className="relative w-14 h-14 flex-shrink-0">
                          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                            <circle
                              cx="50"
                              cy="50"
                              r="42"
                              fill="none"
                              stroke="rgba(255,255,255,0.04)"
                              strokeWidth="6"
                            />
                            <circle
                              cx="50"
                              cy="50"
                              r="42"
                              fill="none"
                              stroke={
                                sessionState.timer_left === 0
                                  ? '#22c55e'
                                  : sessionState.timer_left <= 30
                                    ? '#ef4444'
                                    : '#f97316'
                              }
                              strokeWidth="6"
                              strokeLinecap="round"
                              strokeDasharray={`${2 * Math.PI * 42}`}
                              strokeDashoffset={`${2 * Math.PI * 42 * (1 - sessionState.timer_left / sessionState.timer_total)}`}
                              style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span
                              className={cn(
                                'text-sm font-bold tabular-nums',
                                sessionState.timer_left === 0 && 'text-emerald-400',
                                sessionState.timer_left > 0 &&
                                  sessionState.timer_left <= 30 &&
                                  'text-red-400',
                              )}
                            >
                              {sessionState.timer_left === 0
                                ? '\u2713'
                                : formatTime(sessionState.timer_left)}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {sessionState.timer_running
                              ? 'Timer running'
                              : sessionState.timer_left === 0
                                ? 'Timer complete'
                                : 'Timer paused'}
                          </p>
                          <p className="text-[11px] text-white/30 mt-0.5">
                            {formatTime(sessionState.timer_total)} total
                          </p>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() =>
                              sendAction(
                                sessionState!.timer_running ? 'timer-pause' : 'timer-start',
                              )
                            }
                            className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center active:bg-white/10 transition-colors"
                          >
                            {sessionState.timer_running ? (
                              <Pause size={14} />
                            ) : (
                              <Play size={14} />
                            )}
                          </button>
                          <button
                            onClick={() => sendAction('timer-reset')}
                            className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center active:bg-white/10 transition-colors"
                          >
                            <RotateCcw size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Navigation */}
              <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-2">
                <button
                  onClick={() => sendAction('prev')}
                  className="flex items-center justify-center gap-1 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] font-medium active:bg-white/[0.06] transition-colors"
                >
                  <ArrowLeft size={14} /> Prev
                </button>
                <button
                  onClick={() => sendAction('done')}
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-orange-500/15 border border-orange-500/20 text-orange-300 text-[13px] font-bold active:bg-orange-500/25 transition-colors"
                >
                  <CheckCircle2 size={14} />
                  {sessionState.current_step === sessionState.total_steps ? 'Finish' : 'Done'}
                </button>
                <button
                  onClick={() => sendAction('next')}
                  className="flex items-center justify-center gap-1 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] font-medium active:bg-white/[0.06] transition-colors"
                >
                  Next <ArrowRight size={14} />
                </button>
              </div>

              {/* Steps overview (collapsible) */}
              <StepsOverview
                steps={sessionState.steps_overview}
                currentStep={sessionState.current_step}
              />
            </div>
          )}
        </div>
        </div>

        {/* ── Chat panel (always visible, up to 40% height) ── */}
        <div className="flex-none max-h-[40vh] flex flex-col border-t border-white/[0.04] bg-[#09090b] z-10">
          <div className="px-4 py-2.5 flex items-center gap-2 flex-shrink-0">
            <MessageCircle size={13} className="text-orange-400/60" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/25">
              Chef Assistant
            </span>
            {chatMessages.length > 0 && (
              <span className="text-[10px] bg-orange-500/10 text-orange-400/60 rounded-full px-1.5 py-0.5 font-medium">
                {Math.ceil(chatMessages.filter((m) => m.role === 'user').length)}
              </span>
            )}
          </div>

          {chatMessages.length > 0 && (
            <div ref={chatScrollRef} className="px-4 pb-2 flex flex-col gap-2 flex-1 overflow-y-auto">
              {chatMessages.map((msg, i) => (
                <div key={i} className={msg.role === 'assistant' ? 'mr-auto w-[85%]' : 'ml-auto'}>
                  <div
                    className={cn(
                      'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-orange-500/15 text-orange-200/90'
                        : 'bg-white/[0.04] border border-white/[0.06] text-white/70',
                    )}
                  >
                    {msg.content}
                  </div>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center justify-between mt-2 px-1">
                      <span className="inline-flex items-center gap-1 text-[10px] text-white/30">
                        <AlertTriangle size={9} strokeWidth={1.75} />
                        AI-generated — verify before acting on it
                      </span>
                      <ReportButton
                        query={i > 0 && chatMessages[i - 1].role === 'user' ? chatMessages[i - 1].content : undefined}
                        responseType="chef-remote"
                        aiResponse={msg.content}
                        dark
                      />
                    </div>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div className="mr-auto rounded-2xl px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.06] text-white/30 text-sm">
                  <span className="inline-flex gap-0.5">
                    <span className="animate-pulse">.</span>
                    <span className="animate-pulse" style={{ animationDelay: '0.15s' }}>
                      .
                    </span>
                    <span className="animate-pulse" style={{ animationDelay: '0.3s' }}>
                      .
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Chat input bar (sticky bottom, always visible) ── */}
      <div className="flex-shrink-0 border-t border-white/[0.06] bg-[#09090b]">
        <form onSubmit={handleChatSubmit} className="flex gap-2 px-4 py-3">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask about this recipe..."
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] focus:border-orange-500/30 outline-none text-sm text-white placeholder:text-white/20 transition-colors"
          />
          <button
            type="submit"
            disabled={!chatInput.trim() || chatLoading}
            className="w-10 h-10 rounded-xl bg-orange-500/15 text-orange-400 flex items-center justify-center active:bg-orange-500/25 disabled:opacity-30 transition-all flex-shrink-0"
          >
            <Send size={15} />
          </button>
        </form>
        <div className="h-[env(safe-area-inset-bottom,0px)]" />
      </div>
    </div>
  )
}

// ── Steps Overview Accordion ────────────────────────────────────────

function StepsOverview({
  steps,
  currentStep,
}: {
  steps: Array<{ id: string; action: string; completed: string }>
  currentStep: number
}) {
  const [open, setOpen] = useState(false)

  if (steps.length <= 1) return null

  return (
    <div className="rounded-xl border border-white/[0.04] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-white/25 active:bg-white/[0.02] transition-colors"
      >
        All Steps
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ArrowRight size={12} className="rotate-90" />
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 flex flex-col gap-0.5 max-h-[30vh] overflow-y-auto">
              {steps.map((s, i) => {
                const isCurrent = i + 1 === currentStep
                const isDone = s.completed === 'true'
                return (
                  <div
                    key={s.id}
                    className={cn(
                      'flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-[12px]',
                      isCurrent && 'bg-orange-500/[0.06] text-orange-300',
                      isDone && !isCurrent && 'text-white/20 line-through',
                      !isCurrent && !isDone && 'text-white/40',
                    )}
                  >
                    <span className="flex-shrink-0 mt-0.5">
                      {isDone ? (
                        <CheckCircle2 size={12} className="text-emerald-500/60" />
                      ) : isCurrent ? (
                        <Circle size={12} className="text-orange-400" />
                      ) : (
                        <Circle size={12} className="text-white/10" />
                      )}
                    </span>
                    <span className="leading-relaxed">{s.action}</span>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
