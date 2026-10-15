/**
 * AI Chef Agent -- Interactive Cook Mode (Redesigned)
 * Route: /chef
 *
 * Flow:
 * 1. User types a dish name.
 * 2. System fetches up to 3 matching recipes and lets user pick one.
 * 3. LLM structures instructions into Prep + Cook Steps.
 * 4. Step-by-step cook mode with per-step countdown timers.
 * 5. Context-aware Q&A chat panel that knows the current cooking stage.
 * 6. Phone remote: QR ? WebSocket ? voice commands from kitchen.
 *
 * Voice Architecture:
 *   Phone (MediaRecorder) ? WebSocket ? Backend (STT + Intent Pipeline)
 *   Backend relays parsed intents to the PC host, which executes them.
 *   No PeerJS, no WebRTC, no client-side SpeechRecognition.
 */
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChefHat,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Timer,
  Play,
  Pause,
  RotateCcw,
  Wrench,
  Lightbulb,
  Send,
  SkipForward,
  Search,
  Flame,
  Clock,
  UtensilsCrossed,
  Smartphone,
  Mic,
  Wifi,
  X,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Header } from '@/components/layout/header'
import { cn } from '@/lib/utils'
import { searchQuery, chefParse, chatWithProduct, getAppConfig, logCooked } from '@/lib/api'
import { ReportButton } from '@/components/ui/report-button'
import { useHostWebSocket } from '@/hooks/use-host-websocket'
import { useAuth } from '@/hooks/use-auth'
import type {
  ChefIntentResponse,
  ChefParseResponse,
  CookStep,
  CookingSessionState,
  MiseEnPlaceItem,
  SearchResult,
} from '@/lib/types'

// -- Types -------------------------------------------------------------------

type Phase =
  | 'search'
  | 'loading-results'
  | 'results'
  | 'parsing'
  | 'generating'
  | 'prep'
  | 'cooking'
  | 'done'

interface QAMessage {
  role: 'user' | 'assistant'
  content: string
}

interface TimerState {
  running: boolean
  timeLeft: number
  total: number
}

// -- Helpers -----------------------------------------------------------------

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function normalizeChefRemoteBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '')
    if (!path || path === '/') {
      url.pathname = '/chef-remote'
    } else if (!path.endsWith('/chef-remote')) {
      url.pathname = `${path}/chef-remote`
    }
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    const noTrail = trimmed.replace(/\/+$/, '')
    if (noTrail.endsWith('/chef-remote')) return noTrail
    return `${noTrail}/chef-remote`
  }
}

/**
 * String-aware brace matcher � skips { and } inside quoted strings.
 */
function extractJsonByBraceMatch(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escapeNext = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (ch === '\\' && inString) {
      escapeNext = true
      continue
    }
    if (ch === '"' && !escapeNext) {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Attempt to parse a JSON blob and convert it into a ChefParseResponse.
 */
function parseChefJson(
  jsonStr: string,
  recipeName: string,
): ChefParseResponse | null {
  try {
    const data = JSON.parse(jsonStr)
    if (!data.steps || !Array.isArray(data.steps) || data.steps.length === 0)
      return null
    return {
      recipe_name: recipeName,
      mise_en_place: (data.mise_en_place ?? []).map(
        (item: Record<string, unknown>, i: number) => ({
          id: (item.id as number) ?? i + 1,
          text: String(item.text ?? ''),
          duration_minutes: (item.duration_minutes as number) ?? null,
        }),
      ),
      steps: data.steps.map(
        (step: Record<string, unknown>, i: number) => ({
          id: (step.id as number) ?? i + 1,
          action: String(step.action ?? ''),
          timer_seconds: (step.timer_seconds as number) ?? null,
          tool: step.tool ? String(step.tool) : null,
          tip: step.tip ? String(step.tip) : null,
        }),
      ),
      tools_required: Array.isArray(data.tools_required)
        ? data.tools_required.map(String)
        : [],
      estimated_total_minutes: (data.estimated_total_minutes as number) ?? null,
      parse_error: null,
    }
  } catch {
    return null
  }
}

/**
 * Regex-based last-resort extraction of step actions from raw JSON text.
 */
function regexExtractSteps(
  raw: string,
  recipeName: string,
): ChefParseResponse | null {
  const actionRe = /"action"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  const actions: string[] = []
  let m: RegExpExecArray | null
  while ((m = actionRe.exec(raw)) !== null) {
    actions.push(m[1].replace(/\\n/g, ' ').trim())
  }
  if (actions.length < 2) return null

  const timerRe =
    /"action"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*"timer_seconds"\s*:\s*(\d+|null)/g
  const timers: (number | null)[] = []
  while ((m = timerRe.exec(raw)) !== null) {
    timers.push(m[1] === 'null' ? null : Number(m[1]))
  }

  const miseRe = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"duration_minutes"\s*:\s*(\d+|null)/g
  const mise: MiseEnPlaceItem[] = []
  while ((m = miseRe.exec(raw)) !== null) {
    mise.push({
      id: mise.length + 1,
      text: m[1].replace(/\\n/g, ' ').trim(),
      duration_minutes: m[2] === 'null' ? null : Number(m[2]),
    })
  }

  return {
    recipe_name: recipeName,
    mise_en_place: mise,
    steps: actions.map((action, i) => ({
      id: i + 1,
      action,
      timer_seconds: timers[i] ?? null,
      tool: null,
      tip: null,
    })),
    tools_required: [],
    estimated_total_minutes: null,
    parse_error: null,
  }
}

function tryRecoverJsonFromAction(
  action: string,
  recipeName: string,
): ChefParseResponse | null {
  const trimmed = action.trim()
  if (
    !trimmed.startsWith('{') &&
    !trimmed.includes('"mise_en_place"') &&
    !trimmed.includes('"steps"')
  ) {
    return null
  }

  // Strategy 1: String-aware brace matching + JSON.parse
  const braceMatched = extractJsonByBraceMatch(trimmed)
  if (braceMatched) {
    const result = parseChefJson(braceMatched, recipeName)
    if (result) return result
  }

  // Strategy 2: Try JSON.parse on the full text directly
  const directResult = parseChefJson(trimmed, recipeName)
  if (directResult) return directResult

  // Strategy 3: Repair common LLM issues and retry
  let repaired = trimmed
    .replace(/,\s*([}\]])/g, '$1')               // trailing commas
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
  const repairedBrace = extractJsonByBraceMatch(repaired)
  if (repairedBrace) {
    const result = parseChefJson(repairedBrace, recipeName)
    if (result) return result
  }

  // Strategy 4: Regex extraction as last resort
  return regexExtractSteps(trimmed, recipeName)
}

function tryRecoverFromFragmentedSteps(
  parsed: ChefParseResponse,
): ChefParseResponse | null {
  const hasJsonFragments = parsed.steps.some(
    (s) =>
      /^\s*"[\w_]+"/.test(s.action) ||
      s.action.trim().startsWith('{') ||
      s.action.trim().startsWith('['),
  )
  if (!hasJsonFragments) return null

  const reconstructed = parsed.steps.map((s) => s.action).join('\n')
  const wrapped = reconstructed.trim().startsWith('{')
    ? reconstructed
    : `{${reconstructed}}`
  return tryRecoverJsonFromAction(wrapped, parsed.recipe_name)
}

/**
 * Check if a step's action text looks like raw JSON that should NOT be displayed.
 */
function looksLikeRawJson(action: string): boolean {
  const t = action.trim()
  return (
    (t.startsWith('{') && t.length > 200) ||
    t.includes('"mise_en_place"') ||
    t.includes('"steps"') ||
    (t.includes('"action"') && t.includes('"timer_seconds"'))
  )
}

function recoverIfNeeded(parsed: ChefParseResponse): ChefParseResponse {
  // Case 1: Single step containing the entire raw JSON blob
  if (
    parsed.steps.length === 1 &&
    (parsed.steps[0].action.trim().startsWith('{') ||
      parsed.steps[0].action.includes('"steps"'))
  ) {
    const recovered = tryRecoverJsonFromAction(
      parsed.steps[0].action,
      parsed.recipe_name,
    )
    if (recovered && recovered.steps.length > 0) return recovered
  }

  // Case 2: Multiple steps that are fragmented JSON
  if (
    parsed.steps.length > 3 &&
    parsed.steps.some((s) => /^\s*"[\w_]+"/.test(s.action))
  ) {
    const recovered = tryRecoverFromFragmentedSteps(parsed)
    if (recovered && recovered.steps.length > 0) return recovered
  }

  // Case 3: All steps are JSON objects/keys
  if (
    parsed.steps.length >= 1 &&
    parsed.steps.every(
      (s) =>
        s.action.trim().startsWith('{') || s.action.trim().startsWith('"'),
    )
  ) {
    const joined = parsed.steps.map((s) => s.action.trim()).join(',\n')
    const wrapped = `{ "steps": [${joined}] }`
    const recovered = tryRecoverJsonFromAction(wrapped, parsed.recipe_name)
    if (recovered && recovered.steps.length > 0) return recovered
  }

  // Case 4: Steps look like raw JSON but none of the above recovered them
  // Try regex extraction on all step text combined
  if (parsed.steps.some((s) => looksLikeRawJson(s.action))) {
    const allText = parsed.steps.map((s) => s.action).join('\n')
    const recovered = regexExtractSteps(allText, parsed.recipe_name)
    if (recovered && recovered.steps.length >= 2) return recovered

    // If we reach here, we'll try to just show the text anyway rather than failing entirely
    // We clean up the JSON noise
    const cleanedSteps = parsed.steps.map(s => ({
      ...s,
      action: s.action.replace(/["{}\[\]_]+/g, ' ').replace(/\b(action|timer|seconds|tool|tip)\b/gi, '').trim()
    })).filter(s => s.action.length > 5)

    if (cleanedSteps.length > 0) {
      return {
        ...parsed,
        steps: cleanedSteps,
        parse_error: null
      }
    }

    return {
      ...parsed,
      steps: [],
      parse_error:
        'Could not parse the AI-generated recipe steps. Please retry.',
    }
  }

  return parsed
}

// -- Sub-components ----------------------------------------------------------

function RecipeCard({
  recipe,
  onSelect,
}: {
  recipe: SearchResult
  onSelect: () => void
}) {
  return (
    <motion.button
      onClick={onSelect}
      className="w-full text-left p-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-all group"
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base group-hover:text-[var(--color-accent)] transition-colors capitalize">
            {recipe.name}
          </h3>
        </div>
        <ArrowRight
          size={18}
          className="text-[var(--color-muted)] group-hover:text-[var(--color-accent)] flex-shrink-0 mt-1 transition-colors"
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-[var(--color-muted)]">
        {recipe.calories != null && (
          <span className="flex items-center gap-1">
            <Flame size={11} /> {Math.round(recipe.calories)} cal
          </span>
        )}
        {recipe.protein != null && (
          <span>P {Math.round(recipe.protein)}g</span>
        )}
        {recipe.carbohydrates != null && (
          <span>C {Math.round(recipe.carbohydrates)}g</span>
        )}
        {recipe.fats != null && <span>F {Math.round(recipe.fats)}g</span>}
        {recipe.prep_time_mins != null && (
          <span className="flex items-center gap-1">
            <Clock size={11} /> {recipe.prep_time_mins} min
          </span>
        )}
      </div>

      {recipe.raw_ingredients && (
        <p className="mt-3 text-xs text-[var(--color-muted)] line-clamp-2 leading-relaxed">
          {recipe.raw_ingredients.length > 120
            ? recipe.raw_ingredients.slice(0, 120) + '...'
            : recipe.raw_ingredients}
        </p>
      )}
    </motion.button>
  )
}

function StepTimer({
  seconds,
  onStateChange,
  onComplete,
}: {
  seconds: number
  onStateChange?: (state: TimerState) => void
  onComplete?: () => void
}) {
  const [timeLeft, setTimeLeft] = useState(seconds)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<number | null>(null)
  const completedRef = useRef(false)

  useEffect(() => {
    setTimeLeft(seconds)
    setRunning(false)
    completedRef.current = false
    if (intervalRef.current) clearInterval(intervalRef.current)
  }, [seconds])

  useEffect(() => {
    onStateChange?.({ running, timeLeft, total: seconds })
  }, [running, timeLeft, seconds, onStateChange])

  // Listen for voice-driven timer commands from the remote pipeline
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (detail === 'start') setRunning(true)
      else if (detail === 'pause') setRunning(false)
      else if (detail === 'reset') {
        setTimeLeft(seconds)
        setRunning(false)
        completedRef.current = false
      }
    }
    window.addEventListener('chef-timer-control', handler)
    return () => window.removeEventListener('chef-timer-control', handler)
  }, [seconds])

  useEffect(() => {
    if (running) {
      intervalRef.current = window.setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(intervalRef.current!)
            setRunning(false)
            if (!completedRef.current) {
              completedRef.current = true
              onComplete?.()
            }
            return 0
          }
          return t - 1
        })
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [running, onComplete])

  const pct = (timeLeft / seconds) * 100
  const isUrgent = timeLeft <= 30 && timeLeft > 0
  const isDone = timeLeft === 0

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="6"
          />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke={
              isDone
                ? '#22c55e'
                : isUrgent
                  ? '#ef4444'
                  : 'var(--color-accent)'
            }
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 44}`}
            strokeDashoffset={`${2 * Math.PI * 44 * (1 - pct / 100)}`}
            style={{
              transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s',
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              'text-2xl font-bold tabular-nums',
              isUrgent && !isDone && 'text-red-500',
              isDone && 'text-green-500',
            )}
          >
            {isDone ? 'Done' : formatTime(timeLeft)}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        {!isDone && (
          <button
            onClick={() => setRunning((r) => !r)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              running
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:opacity-90',
            )}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
            {running ? 'Pause' : 'Start'}
          </button>
        )}
        <button
          onClick={() => {
            setTimeLeft(seconds)
            setRunning(false)
            completedRef.current = false
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-[var(--color-muted)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-all"
        >
          <RotateCcw size={14} />
          Reset
        </button>
      </div>
    </div>
  )
}

function StepTimeline({
  steps,
  currentIndex,
  completedSteps,
  onStepClick,
}: {
  steps: CookStep[]
  currentIndex: number
  completedSteps: Set<number>
  onStepClick: (index: number) => void
}) {
  return (
    <div className="flex gap-1.5 items-center">
      {steps.map((step, i) => {
        const isCompleted = completedSteps.has(step.id)
        const isCurrent = i === currentIndex
        return (
          <button
            key={step.id}
            onClick={() => onStepClick(i)}
            className={cn(
              'h-1.5 rounded-full transition-all duration-300',
              isCurrent
                ? 'w-8 bg-[var(--color-accent)]'
                : isCompleted
                  ? 'w-4 bg-green-500'
                  : 'w-4 bg-[var(--color-border)]',
            )}
            title={`Step ${i + 1}`}
          />
        )
      })}
    </div>
  )
}

// -- Main Page ---------------------------------------------------------------

export default function ChefPage() {
  const location = useLocation()
  const { isAuthenticated } = useAuth()
  const [phase, setPhase] = useState<Phase>('search')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [chefData, setChefData] = useState<ChefParseResponse | null>(null)
  const [recipeContext, setRecipeContext] =
    useState<Record<string, unknown> | null>(null)
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null)

  const [recipeOptions, setRecipeOptions] = useState<SearchResult[]>([])

  const [prepChecked, setPrepChecked] = useState<Set<number>>(new Set())

  const [stepIndex, setStepIndex] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())

  const [timerState, setTimerState] = useState<TimerState | null>(null)

  const [qaInput, setQaInput] = useState('')
  const [qaMessages, setQaMessages] = useState<QAMessage[]>([])
  const [qaLoading, setQaLoading] = useState(false)
  const qaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const launchedRef = useRef(false)
  const submittingRef = useRef(false)

  const canStartCooking =
    chefData?.mise_en_place.length === 0 ||
    prepChecked.size === chefData?.mise_en_place.length

  const currentStep: CookStep | null = chefData?.steps[stepIndex] ?? null
  const totalSteps = chefData?.steps.length ?? 0

  const cookingContext = useMemo(() => {
    if (!chefData || !currentStep) return ''

    const parts: string[] = []
    parts.push(`Currently on step ${stepIndex + 1} of ${totalSteps}.`)
    parts.push(`Current action: "${currentStep.action}"`)

    if (currentStep.tool) {
      parts.push(`Using: ${currentStep.tool}`)
    }

    if (currentStep.timer_seconds && timerState) {
      if (timerState.running) {
        parts.push(
          `Timer is RUNNING: ${formatTime(timerState.timeLeft)} remaining out of ${formatTime(timerState.total)}.`,
        )
      } else if (timerState.timeLeft === 0) {
        parts.push('Timer has completed for this step.')
      } else {
        parts.push(
          `Timer set for ${formatTime(timerState.total)} but not yet started.`,
        )
      }
    }

    if (completedSteps.size > 0) {
      parts.push(
        `Completed ${completedSteps.size} of ${totalSteps} steps so far.`,
      )
    }

    if (stepIndex < totalSteps - 1) {
      const nextStep = chefData.steps[stepIndex + 1]
      parts.push(`Next step will be: "${nextStep.action}"`)
    }

    return parts.join(' ')
  }, [chefData, currentStep, stepIndex, totalSteps, timerState, completedSteps])

  // -- Parse a recipe into chef steps ----------------------------------------

  const parseRecipe = useCallback(
    async (recipe: SearchResult, _retryCount = 0) => {
      const MAX_FRONTEND_RETRIES = 1
      const hasStoredInstructions = !!(
        recipe.instructions && recipe.instructions.trim().length > 30
      )
      setPhase(hasStoredInstructions ? 'parsing' : 'generating')
      setError(null)
      setActiveRecipeId(recipe.id)

      setRecipeContext({
        name: recipe.name,
        serving_size_g: recipe.serving_size_g,
        calories: recipe.calories,
        protein: recipe.protein,
        carbohydrates: recipe.carbohydrates,
        fats: recipe.fats,
        fibre: recipe.fibre,
        prep_time_mins: recipe.prep_time_mins,
        ingredients: recipe.raw_ingredients,
      })

      try {
        const parsed = await chefParse({
          recipe_name: recipe.name,
          instructions: recipe.instructions ?? null,
          ingredients: recipe.raw_ingredients ?? undefined,
        })

        if (parsed.parse_error && parsed.steps.length === 0) {
          // If we haven't retried yet, auto-retry once
          if (_retryCount < MAX_FRONTEND_RETRIES) {
            console.warn(
              `Chef parse failed (attempt ${_retryCount + 1}), auto-retrying...`,
            )
            return parseRecipe(recipe, _retryCount + 1)
          }
          setError(`Failed to structure recipe: ${parsed.parse_error}`)
          setPhase('search')
          return
        }

        const finalParsed = recoverIfNeeded(parsed)

        // If recovery stripped all steps, auto-retry once
        if (
          finalParsed.steps.length === 0 &&
          _retryCount < MAX_FRONTEND_RETRIES
        ) {
          console.warn(
            `Chef recovery produced 0 steps (attempt ${_retryCount + 1}), auto-retrying...`,
          )
          return parseRecipe(recipe, _retryCount + 1)
        }

        if (finalParsed.steps.length === 0) {
          setError(
            'Could not structure the recipe steps. Please try again.',
          )
          setPhase('search')
          return
        }

        setChefData(finalParsed)
        setPrepChecked(new Set())
        setStepIndex(0)
        setCompletedSteps(new Set())
        setTimerState(null)
        setQaMessages([])
        setPhase(finalParsed.mise_en_place.length > 0 ? 'prep' : 'cooking')
      } catch (err) {
        if (_retryCount < MAX_FRONTEND_RETRIES) {
          console.warn(
            `Chef parse threw error (attempt ${_retryCount + 1}), auto-retrying...`,
          )
          return parseRecipe(recipe, _retryCount + 1)
        }
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to parse recipe. Please try again.',
        )
        setPhase('search')
      }
    },
    [],
  )

  // -- Handle search ---------------------------------------------------------

  const handleSearch = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      const trimmed = query.trim()
      if (!trimmed || submittingRef.current) return

      submittingRef.current = true
      setPhase('loading-results')
      setError(null)
      setRecipeOptions([])

      try {
        const searchRes = await searchQuery(trimmed, {
          cluster: 'recipe',
          limit: 5,
        })
        const recipes = searchRes.results.filter(
          (r) => r.cluster === 'recipe',
        )

        if (recipes.length === 0) {
          setError(
            `No recipes found for "${trimmed}". Try a different dish name.`,
          )
          setPhase('search')
          return
        }

        if (recipes.length === 1) {
          setRecipeOptions(recipes)
          await parseRecipe(recipes[0])
          return
        }

        setRecipeOptions(recipes.slice(0, 3))
        setPhase('results')
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.',
        )
        setPhase('search')
      } finally {
        submittingRef.current = false
      }
    },
    [query, parseRecipe],
  )

  // -- Auto-launch from search navigation ------------------------------------

  useEffect(() => {
    const stateRecipe = (
      location.state as { recipe?: SearchResult } | null
    )?.recipe
    if (stateRecipe && !launchedRef.current) {
      launchedRef.current = true
      setQuery(stateRecipe.name)
      parseRecipe(stateRecipe)
    }
  }, [location.state, parseRecipe])

  // -- Step navigation -------------------------------------------------------

  const handleStepComplete = useCallback(() => {
    if (!chefData) return
    if (phase === 'prep') return // Do not advance cooking steps while in prep phase

    const newCompleted = new Set(completedSteps)
    newCompleted.add(currentStep!.id)
    setCompletedSteps(newCompleted)
    setTimerState(null)

    if (stepIndex < totalSteps - 1) {
      setStepIndex((i) => i + 1)
    } else {
      setPhase('done')
    }
  }, [chefData, completedSteps, currentStep, stepIndex, totalSteps, phase])

  const handlePrevStep = useCallback(() => {
    if (stepIndex > 0) {
      setStepIndex((i) => i - 1)
      setTimerState(null)
    }
  }, [stepIndex])

  const handleStepJump = useCallback(
    (index: number) => {
      if (index >= 0 && index < totalSteps) {
        setStepIndex(index)
        setTimerState(null)
      }
    },
    [totalSteps],
  )

  const handleTimerStateChange = useCallback((state: TimerState) => {
    setTimerState(state)
  }, [])

  // -- Context-aware Q&A ----------------------------------------------------

  const handleQASubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()
      const msg = qaInput.trim()
      if (!msg || qaLoading) return

      const userMessage: QAMessage = { role: 'user', content: msg }
      const newMessages = [...qaMessages, userMessage]
      setQaMessages(newMessages)
      setQaInput('')
      setQaLoading(true)

      try {
        let contextPrefix = ''
        if (phase === 'cooking' && cookingContext) {
          contextPrefix = `[COOKING SESSION for "${chefData?.recipe_name}"] ${cookingContext}\n\nUser asks: `
        } else if (phase === 'done') {
          contextPrefix = `[COMPLETED cooking "${chefData?.recipe_name}" -- all ${totalSteps} steps done]\n\nUser asks: `
        } else if (phase === 'prep') {
          const prepDone = prepChecked.size
          const prepTotal = chefData?.mise_en_place.length ?? 0
          contextPrefix = `[PREPARATION PHASE for "${chefData?.recipe_name}" -- ${prepDone}/${prepTotal} prep tasks completed]\n\nUser asks: `
        }

        const res = await chatWithProduct({
          message: `${contextPrefix}${msg}`,
          context: recipeContext ?? undefined,
          history: qaMessages
            .slice(-6)
            .map((m) => ({ role: m.role, content: m.content })),
        })
        setQaMessages([
          ...newMessages,
          { role: 'assistant', content: res.reply },
        ])
      } catch {
        setQaMessages([
          ...newMessages,
          {
            role: 'assistant',
            content: 'Sorry, I could not answer that right now.',
          },
        ])
      } finally {
        setQaLoading(false)
      }
    },
    [
      qaInput,
      qaLoading,
      qaMessages,
      chefData,
      recipeContext,
      phase,
      cookingContext,
      totalSteps,
      prepChecked,
    ],
  )

  useEffect(() => {
    if (qaRef.current) {
      qaRef.current.scrollTop = qaRef.current.scrollHeight
    }
  }, [qaMessages])

  // -- Log cooked when session completes ------------------------------------

  const cookedLoggedRef = useRef(false)

  useEffect(() => {
    if (phase === 'done' && activeRecipeId && isAuthenticated && !cookedLoggedRef.current) {
      cookedLoggedRef.current = true
      logCooked(activeRecipeId).catch(() => null)
    }
    if (phase !== 'done') {
      cookedLoggedRef.current = false
    }
  }, [phase, activeRecipeId, isAuthenticated])

  // -- Reset -----------------------------------------------------------------

  const resetAll = useCallback(() => {
    setPhase('search')
    setChefData(null)
    setQuery('')
    setError(null)
    setRecipeOptions([])
    setPrepChecked(new Set())
    setStepIndex(0)
    setCompletedSteps(new Set())
    setTimerState(null)
    setQaMessages([])
    setQaInput('')
    setActiveRecipeId(null)
    cookedLoggedRef.current = false
    launchedRef.current = false
    submittingRef.current = false
  }, [])
  // -------------------------------------------------------------------
  //  Kitchen Remote (WebSocket host connection)
  // -------------------------------------------------------------------

  const [remoteBaseUrl, setRemoteBaseUrl] = useState<string>(
    normalizeChefRemoteBaseUrl(import.meta.env.VITE_REMOTE_URL ?? '')
  )

  useEffect(() => {
    if (remoteBaseUrl) return

    async function resolveOriginForPhone(): Promise<string> {
      const { hostname, port, protocol } = window.location
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        // In Electron: ask the main process for the real LAN IP at runtime
        const desktopSystem = (window as unknown as Record<string, unknown>).desktopSystem as
          | { getLanIp: () => Promise<string | null> }
          | undefined
        if (desktopSystem?.getLanIp) {
          try {
            const lanIp = await desktopSystem.getLanIp()
            if (lanIp) return `${protocol}//${lanIp}${port ? `:${port}` : ''}`
          } catch {}
        }
        // Dev fallback: VITE_LAN_HOST build-time override
        const buildTimeIp = import.meta.env.VITE_LAN_HOST as string | undefined
        if (buildTimeIp) return `${protocol}//${buildTimeIp}${port ? `:${port}` : ''}`
      }
      return window.location.origin
    }

    getAppConfig()
      .then(async (cfg) => {
        const fallback = await resolveOriginForPhone()
        setRemoteBaseUrl(
          normalizeChefRemoteBaseUrl(cfg.remote_base_url ? cfg.remote_base_url : fallback),
        )
      })
      .catch(async () => {
        const fallback = await resolveOriginForPhone()
        setRemoteBaseUrl(normalizeChefRemoteBaseUrl(fallback))
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const host = useHostWebSocket()
  const [showQR, setShowQR] = useState(false)
  const [lastVoiceText, setLastVoiceText] = useState<string | null>(null)

  // -- Build the state snapshot to push to phone --
  const buildSessionState = useCallback((): CookingSessionState | null => {
    if (!chefData) return null
    const step = chefData.steps[stepIndex]
    if (!step && phase !== 'prep' && phase !== 'done') return null
    return {
      recipe_name: chefData.recipe_name,
      current_step: stepIndex + 1,
      total_steps: totalSteps,
      current_action: step?.action ?? 'Preparing ingredients',
      current_tool: step?.tool ?? null,
      current_tip: step?.tip ?? null,
      timer_total: step?.timer_seconds ?? null,
      timer_left: timerState?.timeLeft ?? null,
      timer_running: timerState?.running ?? false,
      completed_steps: Array.from(completedSteps),
      phase: phase as 'prep' | 'cooking' | 'done',
      steps_overview: chefData.steps.map((s) => ({
        id: String(s.id),
        action: s.action.length > 60 ? s.action.slice(0, 57) + '...' : s.action,
        completed: completedSteps.has(s.id) ? 'true' : 'false',
      })),
      mise_en_place: chefData.mise_en_place.map((item) => ({
        id: item.id,
        text: item.text,
        done: prepChecked.has(item.id),
      })),
      tools_required: chefData.tools_required,
      estimated_total_minutes: chefData.estimated_total_minutes,
      chat_messages: qaMessages.slice(-20),
    }
  }, [chefData, stepIndex, totalSteps, timerState, completedSteps, phase, prepChecked, qaMessages])

  // -- Push state to phone whenever it changes or when WS reconnects --
  useEffect(() => {
    if (!host.phoneConnected || !host.wsConnected) return
    const state = buildSessionState()
    if (state) host.sendState(state)
  }, [host.phoneConnected, host.wsConnected, buildSessionState, host.sendState])

  // -- Helper: add a voice interaction to chat (both local + phone) --
  const addVoiceToChat = useCallback(
    (userText: string, replyText: string) => {
      const userMsg: QAMessage = { role: 'user', content: `[Voice] ${userText}` }
      const assistantMsg: QAMessage = { role: 'assistant', content: replyText }
      setQaMessages((prev) => [...prev, userMsg, assistantMsg])
      host.sendChatReply({ role: 'user', content: `[Voice] ${userText}` })
      host.sendChatReply({ role: 'assistant', content: replyText })
    },
    [host],
  )

  const lastIntentTimeRef = useRef<number>(0)

  // Handle voice intents pre-processed by the backend (STT + intent pipeline).
  // The backend handles speech-to-text, deduplication via VAD, and the 3-stage
  // intent pipeline � the host just receives the parsed intent and executes it.
  const handleVoiceIntentFromPhone = useCallback(
    async (intent: ChefIntentResponse & { raw_text?: string }) => {
      if (!chefData) return
      if (intent.filtered) return

      // Debounce: ignore repeated intents within 1.5 seconds (prevents double skips)
      const now = Date.now()
      if (now - lastIntentTimeRef.current < 1500) {
        return
      }
      lastIntentTimeRef.current = now

      const voiceText = intent.raw_text || intent.display_text || ''
      if (voiceText) setLastVoiceText(voiceText)

      switch (intent.action) {
        case 'NEXT':
        case 'DONE':
          if (phase === 'prep') {
            const uncompleted = chefData.mise_en_place.find(
              (item) => !prepChecked.has(item.id),
            )
            if (uncompleted) {
              setPrepChecked((prev) => {
                const next = new Set(prev)
                next.add(uncompleted.id)
                return next
              })
              addVoiceToChat(voiceText, `Checked off prep item: ${uncompleted.text}`)
            } else {
              setPhase('cooking')
              addVoiceToChat(voiceText, 'All prep done! Starting cooking phase.')
            }
          } else {
            handleStepComplete()
            if (intent.display_text) {
              addVoiceToChat(voiceText, intent.display_text)
            }
          }
          break

        case 'PREV':
          if (phase === 'cooking') {
            if (stepIndex === 0) {
              setPrepChecked(new Set())
              setPhase('prep')
              addVoiceToChat(voiceText, 'Going back to preparation phase.')
            } else {
              handlePrevStep()
            }
          }
          if (intent.display_text) {
            addVoiceToChat(voiceText, intent.display_text)
          }
          break

        case 'STRIKE': {
          if (phase === 'prep') {
            setPhase('cooking')
            addVoiceToChat(voiceText, 'Starting cooking phase.')
          }
          const targetStep = intent.step
          if (targetStep && targetStep >= 1 && targetStep <= totalSteps) {
            const targetId = chefData.steps[targetStep - 1]?.id
            if (targetId) {
              setCompletedSteps((prev) => {
                const next = new Set(prev)
                next.add(targetId)
                return next
              })
              if (intent.display_text) {
                addVoiceToChat(voiceText, intent.display_text)
              }
            }
          }
          break
        }

        case 'STRIKE_PREP': {
          if (intent.prep_item) {
            const matched = chefData.mise_en_place.find(
              (item) => item.text === intent.prep_item,
            )
            if (matched) {
              setPrepChecked((prev) => {
                const next = new Set(prev)
                next.add(matched.id)
                return next
              })
              if (intent.display_text) {
                addVoiceToChat(voiceText, intent.display_text)
              }
            }
          }
          break
        }

        case 'TIMER_START':
          window.dispatchEvent(new CustomEvent('chef-timer-control', { detail: 'start' }))
          break

        case 'TIMER_PAUSE':
          window.dispatchEvent(new CustomEvent('chef-timer-control', { detail: 'pause' }))
          break

        case 'TIMER_RESET':
          window.dispatchEvent(new CustomEvent('chef-timer-control', { detail: 'reset' }))
          break

        case 'START_COOKING':
          if (phase === 'prep') {
            const allPrepIds = chefData.mise_en_place.map((item) => item.id)
            setPrepChecked(new Set(allPrepIds))
            setPhase('cooking')
            addVoiceToChat(voiceText, 'All preparation tasks checked! Starting cooking phase.')
          }
          break

        case 'REPEAT': {
          const state = buildSessionState()
          if (state) host.sendState(state)
          break
        }

        case 'FINISH_SESSION':
          addVoiceToChat(voiceText, 'Enjoy your meal! The session is complete.')
          setTimeout(() => {
            resetAll()
          }, 4000)
          break

        case 'ASK': {
          const question = intent.question || voiceText
          const userMessage: QAMessage = { role: 'user', content: `[Voice] ${question}` }
          const newMessages = [...qaMessages, userMessage]
          setQaMessages(newMessages)
          host.sendChatReply({ role: 'user', content: `[Voice] ${question}` })

          try {
            let contextPrefix = ''
            if (phase === 'prep') {
              contextPrefix = `[PREPARATION PHASE - voice command] Recipe: ${chefData.recipe_name}. The user is preparing mise en place before cooking.\n\nUser asks: `
            } else if (phase === 'cooking' && cookingContext) {
              contextPrefix = `[COOKING SESSION - voice command] ${cookingContext}\n\nUser asks: `
            } else if (phase === 'done') {
              contextPrefix = `[COMPLETED cooking "${chefData.recipe_name}"]\n\nUser asks: `
            }
            const res = await chatWithProduct({
              message: `${contextPrefix}${question}`,
              context: recipeContext ?? undefined,
              history: qaMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
            })
            setQaMessages([...newMessages, { role: 'assistant', content: res.reply }])
            host.sendChatReply({ role: 'assistant', content: res.reply })
          } catch {
            const errMsg = 'Sorry, I could not answer that.'
            setQaMessages([...newMessages, { role: 'assistant', content: errMsg }])
            host.sendChatReply({ role: 'assistant', content: errMsg })
          }
          break
        }

        case 'NOOP':
        default:
          break
      }
    },
    [
      chefData,
      totalSteps,
      handleStepComplete,
      handlePrevStep,
      buildSessionState,
      qaMessages,
      phase,
      cookingContext,
      recipeContext,
      addVoiceToChat,
      host,
      canStartCooking,
      setPhase,
    ],
  )

  // Register voice intent callback
  useEffect(() => {
    host.onVoiceIntent(handleVoiceIntentFromPhone)
  }, [host.onVoiceIntent, handleVoiceIntentFromPhone])

  // Register chat callback � phone user typed a question in chat
  const handleChatFromPhone = useCallback(
    async (text: string) => {
      if (!text.trim() || !chefData) return
      const msg = text.trim()

      const userMessage: QAMessage = { role: 'user', content: msg }
      const newMessages = [...qaMessages, userMessage]
      setQaMessages(newMessages)

      try {
        let contextPrefix = ''
        if (phase === 'cooking' && cookingContext) {
          contextPrefix = `[COOKING SESSION for "${chefData.recipe_name}"] ${cookingContext}\n\nUser asks: `
        } else if (phase === 'prep') {
          contextPrefix = `[PREPARATION PHASE for "${chefData.recipe_name}"]\n\nUser asks: `
        } else if (phase === 'done') {
          contextPrefix = `[COMPLETED cooking "${chefData.recipe_name}"]\n\nUser asks: `
        }
        const res = await chatWithProduct({
          message: `${contextPrefix}${msg}`,
          context: recipeContext ?? undefined,
          history: qaMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        })
        setQaMessages([...newMessages, { role: 'assistant', content: res.reply }])
        host.sendChatReply({ role: 'assistant', content: res.reply })
      } catch {
        const errMsg = 'Sorry, I could not answer that right now.'
        setQaMessages([...newMessages, { role: 'assistant', content: errMsg }])
        host.sendChatReply({ role: 'assistant', content: errMsg })
      }
    },
    [chefData, qaMessages, phase, cookingContext, recipeContext, host],
  )

  useEffect(() => {
    host.onPhoneChat(handleChatFromPhone)
  }, [host.onPhoneChat, handleChatFromPhone])

  // -- Handle structured actions from phone (prep toggle, navigation, timer) --
  const handleActionFromPhone = useCallback(
    (action: string, payload?: Record<string, unknown>) => {
      if (!chefData) return
      switch (action) {
        case 'toggle-prep': {
          const id = Number(payload?.id)
          if (!isNaN(id)) {
            setPrepChecked((prev) => {
              const next = new Set(prev)
              next.has(id) ? next.delete(id) : next.add(id)
              return next
            })
          }
          break
        }
        case 'next':
          if (stepIndex < totalSteps - 1) setStepIndex((i) => i + 1)
          break
        case 'prev':
          handlePrevStep()
          break
        case 'done':
          handleStepComplete()
          break
        case 'timer-start':
          window.dispatchEvent(new CustomEvent('chef-timer-control', { detail: 'start' }))
          break
        case 'timer-pause':
          window.dispatchEvent(new CustomEvent('chef-timer-control', { detail: 'pause' }))
          break
        case 'timer-reset':
          window.dispatchEvent(new CustomEvent('chef-timer-control', { detail: 'reset' }))
          break
        case 'start-cooking':
          if (canStartCooking) setPhase('cooking')
          break
        case 'repeat': {
          const state = buildSessionState()
          if (state) host.sendState(state)
          break
        }
      }
    },
    [chefData, stepIndex, totalSteps, handlePrevStep, handleStepComplete, host, buildSessionState, canStartCooking, setPhase],
  )

  useEffect(() => {
    host.onPhoneAction(handleActionFromPhone)
  }, [host.onPhoneAction, handleActionFromPhone])

  // Auto-close QR modal when phone connects
  useEffect(() => {
    if (host.phoneConnected && showQR) setShowQR(false)
  }, [host.phoneConnected, showQR])

  // QR code URL � session-based (no PeerJS broker)
  const qrUrl = host.sessionId && remoteBaseUrl ? `${remoteBaseUrl}?session=${host.sessionId}` : null

  // -- Render ----------------------------------------------------------------

  const isWidePhase = phase === 'prep' || phase === 'cooking' || phase === 'results'

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <Header />

      <main
        className={cn(
          'mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16',
          isWidePhase ? 'max-w-7xl' : 'max-w-2xl',
        )}
      >
        <AnimatePresence mode="wait">
          {/* PHASE: Search */}
          {phase === 'search' && (
            <motion.div
              key="search"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center gap-8 text-center"
            >
              <div className="p-5 rounded-3xl bg-[var(--color-accent)]/10">
                <ChefHat size={48} className="text-[var(--color-accent)]" />
              </div>

              <div>
                <h1 className="text-3xl font-bold mb-2">AI Chef</h1>
                <p className="text-[var(--color-muted)] max-w-sm mx-auto text-sm leading-relaxed">
                  Search for any dish to get an interactive, step-by-step
                  cooking session with timers, preparation guides, and a
                  chef assistant on standby.
                </p>
              </div>

              <form onSubmit={handleSearch} className="w-full max-w-xl flex gap-2">
                <div className="flex-1 relative">
                  <Search
                    size={18}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
                  />
                  <input
                    type="text"
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Butter Chicken, Biryani, Dal Tadka..."
                    className="w-full pl-10 pr-4 py-3.5 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none transition-all text-sm"
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={query.trim().length < 2}
                  className="flex items-center gap-2 px-5 py-3.5 rounded-2xl bg-[var(--color-accent)] text-[var(--color-accent-contrast)] font-medium text-sm hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-pointer hover:border-\[var\(--color-accent\)\]"
                >
                  Search <ArrowRight size={16} />
                </button>
              </form>

              {error && (
                <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-4 py-3 rounded-xl max-w-sm">
                  {error}
                </p>
              )}
            </motion.div>
          )}

          {/* PHASE: Loading Results */}
          {phase === 'loading-results' && (
            <motion.div
              key="loading-results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 text-center py-12"
            >
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
                <Search
                  size={22}
                  className="text-[var(--color-accent)] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                />
              </div>
              <p className="font-semibold text-lg">Searching recipes...</p>
              <p className="text-sm text-[var(--color-muted)]">
                Finding the best matches for &quot;{query}&quot;
              </p>
            </motion.div>
          )}

          {/* PHASE: Results (pick from up to 3) */}
          {phase === 'results' && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col gap-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <button
                    onClick={resetAll}
                    className="flex items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors mb-2"
                  >
                    <ArrowLeft size={14} /> Back to search
                  </button>
                  <h2 className="text-xl font-bold">Select a Recipe</h2>
                  <p className="text-sm text-[var(--color-muted)] mt-1">
                    {recipeOptions.length} matches found for &quot;{query}&quot;
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recipeOptions.map((recipe) => (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    onSelect={() => {
                      setQuery(recipe.name)
                      parseRecipe(recipe)
                    }}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {/* PHASE: Parsing / Generating */}
          {(phase === 'parsing' || phase === 'generating') && (
            <motion.div
              key="parsing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 text-center py-12"
            >
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
                <ChefHat
                  size={24}
                  className="text-[var(--color-accent)] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                />
              </div>
              <div>
                {phase === 'generating' ? (
                  <>
                    <p className="font-semibold text-lg">
                      Generating your recipe...
                    </p>
                    <p className="text-[var(--color-muted)] text-sm mt-1">
                      Creating steps, timers, and preparation tasks from scratch
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-lg">
                      Structuring your recipe...
                    </p>
                    <p className="text-[var(--color-muted)] text-sm mt-1">
                      Parsing instructions into steps, timers, and preparation
                      tasks
                    </p>
                  </>
                )}
              </div>
            </motion.div>
          )}

          {/* PHASE: Preparation � single-column layout with inline phone card + chat below */}
          {phase === 'prep' && chefData && (
            <motion.div
              key="prep"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col gap-8"
            >
              {/* TOP ROW: prep content + phone remote card side-by-side on desktop */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 items-start">
                {/* LEFT: Main prep content */}
                <div className="flex flex-col gap-6 min-w-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <button
                        onClick={resetAll}
                        className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors mb-2"
                      >
                        <ArrowLeft size={12} /> New search
                      </button>
                      <h2 className="text-2xl font-bold capitalize">
                        {chefData.recipe_name}
                      </h2>
                      <p className="text-xs uppercase tracking-widest text-[var(--color-muted)] mt-1">
                        Preparation
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-center px-4 py-2 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)]">
                        <p className="text-2xl font-bold text-[var(--color-accent)]">
                          {prepChecked.size}/{chefData.mise_en_place.length}
                        </p>
                        <p className="text-xs text-[var(--color-muted)]">ready</p>
                      </div>
                      <ReportButton
                        query={chefData.recipe_name}
                        responseType="chef-prep"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {chefData.estimated_total_minutes && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-muted)]">
                        <Timer size={13} />
                        {formatMinutes(chefData.estimated_total_minutes)} total
                      </div>
                    )}
                    {chefData.steps.length > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-muted)]">
                        <UtensilsCrossed size={13} />
                        {chefData.steps.length} steps
                      </div>
                    )}
                    {chefData.tools_required.length > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-muted)]">
                        <Wrench size={13} />
                        {chefData.tools_required.join(', ')}
                      </div>
                    )}
                  </div>

                  <AnimatePresence mode="popLayout">
                    {!canStartCooking ? (
                      <motion.div
                        key="prep-list"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col gap-2"
                      >
                        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider">
                          Before you start
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {chefData.mise_en_place.map((item: MiseEnPlaceItem) => {
                            const checked = prepChecked.has(item.id)
                            return (
                              <motion.button
                                key={item.id}
                                onClick={() =>
                                  setPrepChecked((prev) => {
                                    const next = new Set(prev)
                                    checked ? next.delete(item.id) : next.add(item.id)
                                    return next
                                  })
                                }
                                className={cn(
                                  'flex items-start gap-3 p-4 rounded-2xl border text-left transition-all',
                                  checked
                                    ? 'border-green-400/50 bg-green-50 dark:bg-green-900/15'
                                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]',
                                )}
                                whileHover={{ scale: 1.005 }}
                                whileTap={{ scale: 0.995 }}
                              >
                                {checked ? (
                                  <CheckCircle2
                                    size={20}
                                    className="text-green-500 flex-shrink-0 mt-0.5"
                                  />
                                ) : (
                                  <Circle
                                    size={20}
                                    className="text-[var(--color-muted)] flex-shrink-0 mt-0.5"
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p
                                    className={cn(
                                      'text-sm leading-relaxed',
                                      checked && 'line-through text-[var(--color-muted)]',
                                    )}
                                  >
                                    {item.text}
                                  </p>
                                  {item.duration_minutes && !checked && (
                                    <p className="text-xs text-[var(--color-muted)] mt-0.5 flex items-center gap-1">
                                      <Timer size={11} /> ~{item.duration_minutes} min
                                    </p>
                                  )}
                                </div>
                              </motion.button>
                            )
                          })}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="start-cooking-btn"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="py-6"
                      >
                        <div className="flex flex-col items-center text-center gap-4 mb-4">
                          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                            <CheckCircle2 size={32} className="text-green-500" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold">Preparation Complete</h3>
                            <p className="text-xs text-[var(--color-muted)] mt-1">All ingredients are ready.</p>
                          </div>
                        </div>
                        <motion.button
                          onClick={() => setPhase('cooking')}
                          className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-semibold text-sm transition-all mt-2 bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:opacity-90"
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                        >
                          <ArrowRight size={18} /> Start Cooking Phase
                        </motion.button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {!canStartCooking && (
                    <motion.button
                      onClick={() => setPhase('cooking')}
                      className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-semibold text-sm transition-all mt-2 bg-[var(--color-surface)] text-[var(--color-muted)] border border-[var(--color-border)] cursor-pointer hover:border-[var(--color-accent)]"
                    >
                      Skip to Cooking <ArrowRight size={16} className="ml-1 opacity-50" />
                    </motion.button>
                  )}
                </div>

                {/* RIGHT: Phone Remote � inline card with QR */}
                <div className="lg:sticky lg:top-24 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col items-center gap-4">
                  <div className="w-full">
                    <div className="flex items-center gap-2 mb-1">
                      <Smartphone size={15} className="text-[var(--color-accent)]" />
                      <span className="text-sm font-semibold">Kitchen Remote</span>
                    </div>
                    <p className="text-xs text-[var(--color-muted)]">
                      Scan with your phone to use as a hands-free remote
                    </p>
                  </div>

                  {qrUrl ? (
                    <>
                      <div className="p-3 bg-white rounded-2xl">
                        <QRCodeSVG value={qrUrl} size={160} level="M" includeMargin={false} />
                      </div>

                      {host.phoneConnected ? (
                        <div className="flex items-center gap-2 text-xs font-medium text-green-600 dark:text-green-400">
                          <Wifi size={14} />
                          Phone connected
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                          <div className="w-3.5 h-3.5 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
                          Waiting for phone...
                        </div>
                      )}

                      <div className="w-full rounded-xl bg-[var(--color-bg)] p-2.5 text-[10px] text-[var(--color-muted)] break-all select-all">
                        {qrUrl}
                      </div>

                      <div className="text-[10px] text-[var(--color-muted)] text-center space-y-0.5">
                        <p>1. Scan QR with phone camera</p>
                        <p>2. Open link in browser</p>
                        <p>3. Tap mic &amp; speak commands</p>
                        <p className="mt-1 opacity-60">Secure WebSocket � no cloud relay</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-4">
                      <div className="w-6 h-6 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
                      <p className="text-xs text-[var(--color-muted)]">Setting up connection...</p>
                      {host.errorMsg && (
                        <p className="text-[10px] text-red-500">{host.errorMsg}</p>
                      )}
                    </div>
                  )}

                  {/* Voice indicator */}
                  {lastVoiceText && host.phoneConnected && (
                    <div className="w-full rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] p-2.5 flex items-start gap-2">
                      <Mic size={13} className="text-[var(--color-accent)] flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-[var(--color-muted)] italic leading-relaxed">
                        &ldquo;{lastVoiceText}&rdquo;
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* BELOW: Full-width chat panel */}
              <ChatPanel
                messages={qaMessages}
                loading={qaLoading}
                input={qaInput}
                onInputChange={setQaInput}
                onSubmit={handleQASubmit}
                qaRef={qaRef}
                placeholder="Any questions about the preparation? Voice commands also reach here."
                tall
              />
            </motion.div>
          )}

          {/* PHASE: Cooking � wide 2-column layout on desktop */}
          {phase === 'cooking' && chefData && currentStep && (
            <motion.div
              key="cooking"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start"
            >
              {/* LEFT: Main cooking content */}
              <div className="flex flex-col gap-5 min-w-0">
                <div className="flex items-center justify-between">
                  <div>
                    <button
                      onClick={resetAll}
                      className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors mb-1"
                    >
                      <ArrowLeft size={12} /> New search
                    </button>
                    <p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
                      {chefData.recipe_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Phone remote connection button */}
                    <button
                      onClick={() => setShowQR(true)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all',
                        host.phoneConnected
                          ? 'border-green-400/50 bg-green-50 dark:bg-green-900/15 text-green-700 dark:text-green-400'
                          : 'border-[var(--color-border)] hover:border-[var(--color-accent)] text-[var(--color-muted)]',
                      )}
                      title={host.phoneConnected ? 'Phone connected' : 'Connect phone as kitchen remote'}
                    >
                      {host.phoneConnected ? (
                        <>
                          <Wifi size={13} className="text-green-500" />
                          Phone connected
                        </>
                      ) : (
                        <>
                          <Smartphone size={13} />
                          Connect phone
                        </>
                      )}
                    </button>

                    <p className="text-sm font-medium tabular-nums">
                      Step{' '}
                      <span className="text-[var(--color-accent)]">
                        {stepIndex + 1}
                      </span>{' '}
                      / {totalSteps}
                    </p>
                    <ReportButton
                      query={`${chefData.recipe_name} — step ${stepIndex + 1}: ${currentStep.action}`}
                      responseType="chef-cooking"
                    />
                  </div>
                </div>

                {/* Voice command indicator */}
                {host.phoneConnected && lastVoiceText && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/15 border border-blue-200/50 dark:border-blue-800/40 text-xs">
                    <Mic size={13} className="text-blue-500 flex-shrink-0" />
                    <span className="text-blue-700 dark:text-blue-300 truncate">
                      &quot;{lastVoiceText}&quot;
                    </span>
                  </div>
                )}

                <StepTimeline
                  steps={chefData.steps}
                  currentIndex={stepIndex}
                  completedSteps={completedSteps}
                  onStepClick={handleStepJump}
                />

                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep.id}
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -40 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-3xl bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden"
                  >
                    <div className="p-8">
                      {currentStep.tool && (
                        <div className="flex items-center gap-1.5 mb-3">
                          <Wrench
                            size={13}
                            className="text-[var(--color-muted)]"
                          />
                          <span className="text-xs capitalize text-[var(--color-muted)] font-medium">
                            {currentStep.tool}
                          </span>
                        </div>
                      )}

                      <p className="text-xl font-semibold leading-relaxed">
                        {currentStep.action}
                      </p>

                      {currentStep.tip && (
                        <div className="mt-5 flex items-start gap-2 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-800/40">
                          <Lightbulb
                            size={15}
                            className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
                          />
                          <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                            {currentStep.tip}
                          </p>
                        </div>
                      )}
                    </div>

                    {currentStep.timer_seconds && (
                      <div className="flex justify-center py-6 border-t border-[var(--color-border)]">
                        <StepTimer
                          key={currentStep.id}
                          seconds={currentStep.timer_seconds}
                          onStateChange={handleTimerStateChange}
                        />
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>

                <div className="flex gap-3">
                  <button
                    onClick={handlePrevStep}
                    disabled={stepIndex === 0}
                    className="flex items-center gap-1.5 px-5 py-3.5 rounded-2xl border border-[var(--color-border)] text-sm font-medium transition-all hover:border-[var(--color-accent)] disabled:opacity-30 disabled:cursor-pointer hover:border-\[var\(--color-accent\)\]"
                  >
                    <ArrowLeft size={16} /> Prev
                  </button>

                  <button
                    onClick={handleStepComplete}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[var(--color-accent)] text-[var(--color-accent-contrast)] font-semibold text-sm hover:opacity-90 transition-all"
                  >
                    {stepIndex === totalSteps - 1 ? (
                      <>
                        <CheckCircle2 size={16} /> Finish
                      </>
                    ) : (
                      <>
                        <SkipForward size={16} /> Next Step
                      </>
                    )}
                  </button>
                </div>

                {/* Steps overview on desktop */}
                {chefData.steps.length > 1 && (
                  <div className="hidden lg:block rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                    <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">
                      All Steps
                    </p>
                    <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                      {chefData.steps.map((step, i) => {
                        const isDone = completedSteps.has(step.id)
                        const isCurrent = i === stepIndex
                        return (
                          <button
                            key={step.id}
                            onClick={() => handleStepJump(i)}
                            className={cn(
                              'flex items-start gap-2.5 px-3 py-2 rounded-xl text-left text-sm transition-all',
                              isCurrent
                                ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-medium'
                                : isDone
                                  ? 'text-[var(--color-muted)] line-through'
                                  : 'text-[var(--color-text)] hover:bg-[var(--color-bg)]',
                            )}
                          >
                            <span className="flex-shrink-0 mt-0.5">
                              {isDone ? (
                                <CheckCircle2 size={14} className="text-green-500" />
                              ) : isCurrent ? (
                                <Circle size={14} className="text-[var(--color-accent)]" />
                              ) : (
                                <Circle size={14} className="text-[var(--color-border)]" />
                              )}
                            </span>
                            <span className="line-clamp-1">{step.action}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Sticky chat sidebar */}
              <div className="lg:sticky lg:top-24">
                <ChatPanel
                  messages={qaMessages}
                  loading={qaLoading}
                  input={qaInput}
                  onInputChange={setQaInput}
                  onSubmit={handleQASubmit}
                  qaRef={qaRef}
                  placeholder={
                    timerState?.running
                      ? 'Ask anything while you wait...'
                      : 'Questions about this step?'
                  }
                  tall
                />
              </div>
            </motion.div>
          )}

          {/* PHASE: Done */}
          {phase === 'done' && chefData && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 text-center py-8 max-w-2xl mx-auto"
            >
              <div className="p-5 rounded-3xl bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 size={48} className="text-green-500" />
              </div>

              <div>
                <h2 className="text-2xl font-bold mb-2">Enjoy your meal!</h2>
                <p className="text-[var(--color-muted)] max-w-xs mx-auto text-sm">
                  All {totalSteps} steps for{' '}
                  <strong className="capitalize">{chefData.recipe_name}</strong>{' '}
                  are done. Time to plate up. The session is complete.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={resetAll}
                  className="px-5 py-3 rounded-2xl border border-[var(--color-border)] text-sm font-medium hover:border-[var(--color-accent)] transition-all"
                >
                  Cook Another Dish
                </button>
                <button
                  onClick={() => {
                    setPhase('cooking')
                    setStepIndex(0)
                    setCompletedSteps(new Set())
                    setTimerState(null)
                  }}
                  className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-[var(--color-accent)] text-[var(--color-accent-contrast)] text-sm font-medium hover:opacity-90 transition-all"
                >
                  <RotateCcw size={15} /> Cook Again
                </button>
              </div>

              <div className="w-full mt-2">
                <ChatPanel
                  messages={qaMessages}
                  loading={qaLoading}
                  input={qaInput}
                  onInputChange={setQaInput}
                  onSubmit={handleQASubmit}
                  qaRef={qaRef}
                  placeholder="Any follow-up questions about the dish?"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* -- QR Code Modal (Phone Remote) -- */}
      <AnimatePresence>
        {showQR && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowQR(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--color-surface)] rounded-3xl border border-[var(--color-border)] p-8 shadow-2xl max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-bold text-lg">Connect Phone</h3>
                  <p className="text-xs text-[var(--color-muted)] mt-0.5">
                    Scan with your phone camera to use as a kitchen remote
                  </p>
                </div>
                <button
                  onClick={() => setShowQR(false)}
                  className="p-1.5 rounded-lg hover:bg-[var(--color-bg)] transition-colors"
                >
                  <X size={18} className="text-[var(--color-muted)]" />
                </button>
              </div>

              {qrUrl ? (
                <div className="flex flex-col items-center gap-5">
                  <div className="p-4 bg-white rounded-2xl">
                    <QRCodeSVG
                      value={qrUrl}
                      size={200}
                      level="M"
                      includeMargin={false}
                    />
                  </div>

                  {host.phoneConnected ? (
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                      <Wifi size={16} />
                      Phone connected � voice commands active
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-sm text-[var(--color-muted)]">
                        Waiting for phone to connect...
                      </p>
                      <div className="w-5 h-5 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
                    </div>
                  )}

                  <div className="w-full rounded-xl bg-[var(--color-bg)] p-3 text-xs text-[var(--color-muted)] break-all select-all">
                    {qrUrl}
                  </div>

                  <div className="text-xs text-[var(--color-muted)] text-center space-y-1">
                    <p>1. Scan QR code with phone camera</p>
                    <p>2. Open the link in your phone browser</p>
                    <p>3. Tap the microphone and speak commands</p>
                    <p className="text-[10px] mt-2">
                      Secure WebSocket � no data goes to the cloud
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="w-8 h-8 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
                  <p className="text-sm text-[var(--color-muted)]">
                    Setting up connection...
                  </p>
                  {host.errorMsg && (
                    <p className="text-xs text-red-500">{host.errorMsg}</p>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// -- Chat Panel Component ----------------------------------------------------

function ChatPanel({
  messages,
  loading,
  input,
  onInputChange,
  onSubmit,
  qaRef,
  placeholder,
  tall = false,
}: {
  messages: QAMessage[]
  loading: boolean
  input: string
  onInputChange: (val: string) => void
  onSubmit: (e?: FormEvent) => void
  qaRef: React.RefObject<HTMLDivElement | null>
  placeholder?: string
  tall?: boolean
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loading])

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <ChefHat size={15} className="text-[var(--color-accent)]" />
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
          Chef Assistant
        </span>
        {messages.length > 0 && (
          <span className="text-[10px] bg-[var(--color-accent)]/15 text-[var(--color-accent)] rounded-full px-2 py-0.5 font-medium">
            {Math.ceil(messages.length / 2)}
          </span>
        )}
      </div>

      {messages.length > 0 && (
        <div
          ref={qaRef}
          className={cn(
            'overflow-y-auto flex flex-col gap-2.5 px-4 py-3',
            tall ? 'max-h-[50vh]' : 'max-h-52',
          )}
        >
          {messages.map((msg, i) => {
            const isAssistant = msg.role === 'assistant'
            const prevUserQuery =
              isAssistant && i > 0 && messages[i - 1].role === 'user'
                ? messages[i - 1].content
                : undefined
            return (
              <div
                key={i}
                className={cn(
                  'flex flex-col gap-1 max-w-[88%]',
                  isAssistant ? 'mr-auto items-start' : 'ml-auto items-end',
                )}
              >
                <div
                  className={cn(
                    'rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                    isAssistant
                      ? 'bg-[var(--color-bg)] border border-[var(--color-border)]'
                      : 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]',
                  )}
                >
                  {msg.content}
                </div>
                {isAssistant && (
                  <ReportButton
                    query={prevUserQuery}
                    responseType="chef-chat"
                    aiResponse={msg.content}
                  />
                )}
              </div>
            )
          })}
          {loading && (
            <div className="mr-auto rounded-xl px-3.5 py-2.5 bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-muted)] text-sm">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">.</span>
                <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="flex gap-2 px-4 py-3 border-t border-[var(--color-border)]"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
          placeholder={placeholder ?? 'Ask the chef...'}
          className="flex-1 px-3.5 py-2.5 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none text-sm"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="p-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:opacity-90 disabled:opacity-40 transition-all"
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  )
}
