/**
 * Kitchen — Standalone mobile-first voice-controlled cooking assistant.
 * Route: /kitchen
 *
 * Designed for phone-in-kitchen use.  No PC needed.
 *
 * Flow:
 *   1. Type or speak a dish name → search recipes.
 *   2. Pick a recipe → backend parses it into structured steps.
 *   3. Prep phase: checklist of prep tasks (voice: "done chopping onions").
 *   4. Cooking phase: step-by-step with timers (voice: "next", "start timer").
 *   5. Q&A: "why do we do this?" → LLM answers in chat.
 *   6. Done phase: summary.
 *
 * All processing happens on the backend via a single WebSocket connection.
 */
import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChefHat,
  Search,
  Mic,
  MicOff,
  Timer,
  CheckCircle2,
  Circle,
  Wrench,
  Lightbulb,
  ArrowRight,
  ArrowLeft,
  Send,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  CookingPot,
  ListChecks,
  Wifi,
  WifiOff,
  Flame,
  Clock,
  Loader2,
  X,
  Volume2,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { searchQuery, chefParse } from '@/lib/api'
import { useKitchenSocket } from '@/hooks/use-kitchen-socket'
import type { SearchResult, ChefParseResponse, CookingSessionState } from '@/lib/types'
import { ReportButton } from '@/components/ui/report-button'

// ── Helpers ─────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function generateSessionId(): string {
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Phase type ──────────────────────────────────────────────────────

type AppPhase = 'search' | 'loading' | 'results' | 'parsing' | 'cooking'

// ── Main Component ──────────────────────────────────────────────────

export default function KitchenPage() {
  // -- App-level state --
  const [phase, setPhase] = useState<AppPhase>('search')
  const [searchInput, setSearchInput] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedRecipe, setSelectedRecipe] = useState<SearchResult | null>(null)
  const [sessionId] = useState(generateSessionId)

  // -- WebSocket --
  const {
    status,
    state: sessionState,
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
  } = useKitchenSocket(sessionId)

  // -- Chat input --
  const [chatInput, setChatInput] = useState('')
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // -- Wake lock --
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  // -- Timer tick: poll server state every second when timer is running --
  useEffect(() => {
    if (!sessionState?.timer_running) return
    const interval = setInterval(() => requestState(), 1000)
    return () => clearInterval(interval)
  }, [sessionState?.timer_running, requestState])

  // -- Auto-start voice when session begins --
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (sessionState && status === 'connected' && !autoStartedRef.current) {
      autoStartedRef.current = true
      startRecording()
    }
  }, [sessionState, status, startRecording])

  // -- Wake lock --
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null
    async function req() {
      try {
        if ('wakeLock' in navigator) {
          sentinel = await navigator.wakeLock.request('screen')
          wakeLockRef.current = sentinel
        }
      } catch { /* unsupported */ }
    }
    if (sessionState) req()
    const vis = () => { if (document.visibilityState === 'visible' && sessionState) req() }
    document.addEventListener('visibilitychange', vis)
    return () => { document.removeEventListener('visibilitychange', vis); sentinel?.release() }
  }, [sessionState])

  // -- Auto-scroll chat --
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [chatMessages, chatLoading])

  // ── Search ────────────────────────────────────────────────────────

  const handleSearch = useCallback(async (e?: FormEvent) => {
    e?.preventDefault()
    const q = searchInput.trim()
    if (!q) return
    setPhase('loading')
    try {
      const res = await searchQuery(q, { limit: 5 })
      setResults(res.results ?? [])
      setPhase('results')
    } catch {
      setPhase('search')
    }
  }, [searchInput])

  // ── Recipe select + parse ─────────────────────────────────────────

  const handleSelectRecipe = useCallback(async (recipe: SearchResult) => {
    setSelectedRecipe(recipe)
    setPhase('parsing')
    try {
      const parsed = await chefParse({
        recipe_name: recipe.name,
        instructions: recipe.instructions ?? null,
        ingredients: recipe.raw_ingredients ?? null,
      })
      if (!parsed.steps || parsed.steps.length === 0) {
        setPhase('results')
        return
      }
      // Send to backend via WebSocket
      initSession(parsed)
      setPhase('cooking')
    } catch {
      setPhase('results')
    }
  }, [initSession])

  // ── Chat submit ───────────────────────────────────────────────────

  const handleChatSubmit = useCallback((e?: FormEvent) => {
    e?.preventDefault()
    const msg = chatInput.trim()
    if (!msg || chatLoading) return
    sendChat(msg)
    setChatInput('')
  }, [chatInput, chatLoading, sendChat])

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════

  // -- Search / Results phases --
  if (phase !== 'cooking') {
    return (
      <div className="min-h-[100dvh] bg-[#09090b] text-white flex flex-col">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-4 border-b border-white/[0.06]">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <ChefHat size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">NutriVerse Kitchen</h1>
            <p className="text-[11px] text-white/30">Voice-powered cooking assistant</p>
          </div>
          {status === 'connected' ? (
            <Wifi size={14} className="ml-auto text-emerald-400/60" />
          ) : (
            <WifiOff size={14} className="ml-auto text-red-400/60" />
          )}
        </header>

        <div className="flex-1 flex flex-col p-4 gap-4">
          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="What do you want to cook?"
                autoFocus
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] focus:border-orange-500/40 outline-none text-sm text-white placeholder:text-white/25 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={!searchInput.trim() || phase === 'loading'}
              className="px-4 rounded-xl bg-orange-500/20 text-orange-400 font-semibold text-sm active:bg-orange-500/30 disabled:opacity-30 transition-all"
            >
              {phase === 'loading' ? <Loader2 size={16} className="animate-spin" /> : 'Go'}
            </button>
          </form>

          {/* Loading state */}
          {phase === 'loading' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Loader2 size={24} className="animate-spin text-orange-400" />
              <p className="text-sm text-white/40">Searching recipes...</p>
            </div>
          )}

          {/* Parsing state */}
          {phase === 'parsing' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Loader2 size={24} className="animate-spin text-orange-400" />
              <p className="text-sm text-white/40">
                Preparing {selectedRecipe?.name ?? 'recipe'}...
              </p>
              <p className="text-xs text-white/20">Breaking down into steps</p>
            </div>
          )}

          {/* Results list */}
          {phase === 'results' && (
            <>
              {results.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
                  <p className="text-sm text-white/40">No recipes found</p>
                  <p className="text-xs text-white/20">Try a different dish name</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-white/30 font-medium uppercase tracking-widest">
                    Pick a recipe
                  </p>
                  {results.map((r, i) => (
                    <button
                      key={`${r.name}-${i}`}
                      onClick={() => handleSelectRecipe(r)}
                      className="w-full text-left p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] active:bg-white/[0.06] transition-all"
                    >
                      <p className="font-semibold text-sm">{r.name}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {r.prep_time_mins && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] text-white/30 flex items-center gap-1">
                            <Clock size={9} /> {r.prep_time_mins} min
                          </span>
                        )}
                        {r.calories && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.04] text-white/30 flex items-center gap-1">
                            <Flame size={9} /> {Math.round(r.calories)} kcal
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                  <button
                    onClick={() => { setPhase('search'); setResults([]) }}
                    className="mt-2 text-xs text-white/25 underline underline-offset-2"
                  >
                    Search again
                  </button>
                </div>
              )}
            </>
          )}

          {/* Empty search state */}
          {phase === 'search' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500/10 to-amber-500/5 flex items-center justify-center">
                <CookingPot size={28} className="text-orange-400/60" />
              </div>
              <div className="space-y-1.5">
                <p className="text-base font-semibold text-white/70">Ready to cook?</p>
                <p className="text-xs text-white/25 leading-relaxed max-w-[240px]">
                  Search for a dish above. Once you pick a recipe, I'll guide you through it
                  step by step with voice control.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  //  COOKING PHASE — session active
  // ═══════════════════════════════════════════════════════════════════

  const cookPhase = sessionState?.phase ?? 'prep'
  const isPrep = cookPhase === 'prep'
  const isDone = cookPhase === 'done'

  return (
    <div className="h-[100dvh] bg-[#09090b] text-white flex flex-col">
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur-xl sticky top-0 z-30 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
            <ChefHat size={14} className="text-white" />
          </div>
          <div className="leading-none">
            <p className="text-[13px] font-semibold tracking-tight">Kitchen</p>
            <p className="text-[10px] text-white/30 capitalize mt-0.5 truncate max-w-[150px]">
              {sessionState?.recipe_name ?? selectedRecipe?.name ?? ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Mic toggle */}
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
          {status === 'connected' ? (
            <Wifi size={12} className="text-emerald-400/60" />
          ) : (
            <WifiOff size={12} className="text-red-400/60" />
          )}
        </div>
      </header>

      {/* ── Main scrollable area ── */}
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
                  <Volume2 size={12} className="text-orange-400 flex-shrink-0 animate-pulse" />
                  <p className="text-sm text-orange-300/70 truncate italic">{transcript}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300/80">
              <X size={12} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Waiting for session init */}
          {!sessionState ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16 text-center">
              <Loader2 size={24} className="animate-spin text-orange-400" />
              <p className="text-sm text-white/40">Setting up your cooking session...</p>
            </div>
          ) : isPrep ? (
            /* ─────── PREP PHASE ─────── */
            <div className="flex flex-col gap-4">
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
                      {sessionState.mise_en_place.filter(i => i.done).length}/
                      {sessionState.mise_en_place.length} done
                    </span>
                  )}
                  <ReportButton
                    query={sessionState.recipe_name}
                    responseType="kitchen-prep"
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
                  {sessionState.mise_en_place.map(item => (
                    <button
                      key={item.id}
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
                      <p className={cn('text-sm leading-relaxed', item.done && 'line-through text-white/30')}>
                        {item.text}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {/* Prep progress bar */}
              {sessionState.mise_en_place && sessionState.mise_en_place.length > 0 && (() => {
                const done = sessionState.mise_en_place!.filter(i => i.done).length
                const total = sessionState.mise_en_place!.length
                const pct = total > 0 ? (done / total) * 100 : 0
                return (
                  <div className="space-y-2">
                    <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })()}

              {/* Start cooking button */}
              <button
                onClick={() => sendAction('start-cooking')}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-orange-500/20 to-amber-500/15 border border-orange-500/20 text-orange-300 text-sm font-bold active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <Flame size={16} />
                Start Cooking
              </button>
            </div>
          ) : isDone ? (
            /* ─────── DONE PHASE ─────── */
            <div className="flex flex-col items-center gap-5 py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 size={32} className="text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold">Cooking Complete!</h2>
                <p className="text-sm text-white/40 capitalize">
                  {sessionState.recipe_name} &mdash; all {sessionState.total_steps} steps done
                </p>
              </div>
              <button
                onClick={() => { setPhase('search'); setResults([]); setSearchInput('') }}
                className="px-6 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm font-medium active:scale-95 transition-all"
              >
                Cook Something Else
              </button>
            </div>
          ) : (
            /* ─────── COOKING PHASE ─────── */
            <div className="flex flex-col gap-3">
              {/* Step counter */}
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
                    responseType="kitchen-cooking"
                    dark
                  />
                </div>
              </div>

              {/* Step progress dots */}
              <div className="flex gap-1 items-center">
                {sessionState.steps_overview.map((s, i) => {
                  const isCurrent = i + 1 === sessionState!.current_step
                  const isCompleted = s.completed === 'true'
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'h-1 rounded-full transition-all duration-300',
                        isCurrent ? 'flex-[2] bg-orange-400' : isCompleted ? 'flex-1 bg-emerald-500/60' : 'flex-1 bg-white/[0.06]',
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
                            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" />
                            <circle
                              cx="50" cy="50" r="42" fill="none"
                              stroke={
                                sessionState.timer_left === 0 ? '#22c55e'
                                  : sessionState.timer_left <= 30 ? '#ef4444'
                                    : '#f97316'
                              }
                              strokeWidth="6" strokeLinecap="round"
                              strokeDasharray={`${2 * Math.PI * 42}`}
                              strokeDashoffset={`${2 * Math.PI * 42 * (1 - sessionState.timer_left / sessionState.timer_total)}`}
                              style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={cn(
                              'text-sm font-bold tabular-nums',
                              sessionState.timer_left === 0 && 'text-emerald-400',
                              sessionState.timer_left > 0 && sessionState.timer_left <= 30 && 'text-red-400',
                            )}>
                              {sessionState.timer_left === 0 ? '\u2713' : formatTime(sessionState.timer_left)}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {sessionState.timer_running ? 'Timer running'
                              : sessionState.timer_left === 0 ? 'Timer complete'
                                : 'Timer paused'}
                          </p>
                          <p className="text-[11px] text-white/30 mt-0.5">
                            {formatTime(sessionState.timer_total)} total
                          </p>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => sendAction(sessionState!.timer_running ? 'timer-pause' : 'timer-start')}
                            className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center active:bg-white/10 transition-colors"
                          >
                            {sessionState.timer_running ? <Pause size={14} /> : <Play size={14} />}
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

              {/* Navigation buttons */}
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

              {/* Steps overview accordion */}
              <StepsOverview
                steps={sessionState.steps_overview}
                currentStep={sessionState.current_step}
              />
            </div>
          )}
        </div>

        {/* ── Chat panel ── */}
        <div className="border-t border-white/[0.04] mt-2">
          <div className="px-4 py-2.5 flex items-center gap-2">
            <MessageCircle size={13} className="text-orange-400/60" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/25">
              Chef Assistant
            </span>
            {chatMessages.length > 0 && (
              <span className="text-[10px] bg-orange-500/10 text-orange-400/60 rounded-full px-1.5 py-0.5 font-medium">
                {chatMessages.filter(m => m.role === 'user').length}
              </span>
            )}
          </div>

          {chatMessages.length > 0 && (
            <div ref={chatScrollRef} className="px-4 pb-2 flex flex-col gap-2 max-h-[35vh] overflow-y-auto">
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
                        responseType="kitchen"
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
                    <span className="animate-pulse" style={{ animationDelay: '0.15s' }}>.</span>
                    <span className="animate-pulse" style={{ animationDelay: '0.3s' }}>.</span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Chat input (sticky bottom) ── */}
      <div className="flex-shrink-0 border-t border-white/[0.06] bg-[#09090b]">
        <form onSubmit={handleChatSubmit} className="flex gap-2 px-4 py-3">
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
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
        onClick={() => setOpen(o => !o)}
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
