/**
 * Product chat page — dedicated LLM conversation about a specific food item.
 *
 * Route: /product-chat
 * Navigation state: { result: SearchResult }
 *
 * Displays the item's nutrition summary at the top, then a full-page
 * chat thread below with a fixed input bar at the bottom.
 */
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Send, Sparkles, AlertTriangle } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { chatWithProduct } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ReportButton } from '@/components/ui/report-button'
import type { SearchResult, ChatMessagePayload } from '@/lib/types'

/* ── Chat message type ───────────────────────────────────────────── */
interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
}

/* ── Build context dict from a SearchResult ──────────────────────── */
function buildContext(r: SearchResult): Record<string, unknown> {
  const ctx: Record<string, unknown> = { name: r.name, type: r.cluster }

  if (r.cluster === 'recipe') {
    if (r.serving_size_g != null) ctx.serving_size_g = r.serving_size_g
    if (r.calories != null) ctx.calories_kcal = r.calories
    if (r.protein != null) ctx.protein_g = r.protein
    if (r.carbohydrates != null) ctx.carbohydrates_g = r.carbohydrates
    if (r.fats != null) ctx.fats_g = r.fats
    if (r.fibre != null) ctx.fibre_g = r.fibre
    if (r.free_sugar != null) ctx.free_sugar_g = r.free_sugar
    if (r.sodium != null) ctx.sodium_mg = r.sodium
    if (r.calcium != null) ctx.calcium_mg = r.calcium
    if (r.iron != null) ctx.iron_mg = r.iron
    if (r.vitamin_c != null) ctx.vitamin_c_mg = r.vitamin_c
    if (r.folate != null) ctx.folate_mcg = r.folate
    if (r.prep_time_mins != null) ctx.prep_time_mins = r.prep_time_mins
    if (r.raw_ingredients) ctx.ingredients = r.raw_ingredients
    if (r.instructions) ctx.cooking_instructions = r.instructions
  } else {
    if (r.brand) ctx.brand = r.brand
    if (r.category) ctx.category = r.category
    if (r.calories_100g != null) ctx.calories_per_100g = r.calories_100g
    if (r.proteins_100g != null) ctx.protein_per_100g = r.proteins_100g
    if (r.carbohydrates_100g != null) ctx.carbs_per_100g = r.carbohydrates_100g
    if (r.fat_100g != null) ctx.fat_per_100g = r.fat_100g
    if (r.fiber_100g != null) ctx.fiber_per_100g = r.fiber_100g
    if (r.sugars_100g != null) ctx.sugars_per_100g = r.sugars_100g
    if (r.sodium_100g != null) ctx.sodium_per_100g = r.sodium_100g
    if (r.nutriscore_grade) ctx.nutriscore = r.nutriscore_grade
    if (r.nova_group != null) ctx.nova_group = r.nova_group
  }

  return ctx
}

/* ── Nutrition rows for the summary header ───────────────────────── */
function nutritionRows(r: SearchResult): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  if (r.cluster === 'recipe') {
    if (r.calories != null) rows.push({ label: 'Calories (kcal)', value: r.calories.toFixed(2) })
    if (r.carbohydrates != null) rows.push({ label: 'Carbohydrates (g)', value: r.carbohydrates.toFixed(2) })
    if (r.protein != null) rows.push({ label: 'Protein (g)', value: r.protein.toFixed(2) })
    if (r.fats != null) rows.push({ label: 'Fats (g)', value: r.fats.toFixed(2) })
    if (r.fibre != null) rows.push({ label: 'Fibre (g)', value: r.fibre.toFixed(2) })
  } else {
    if (r.calories_100g != null) rows.push({ label: 'Calories / 100g (kcal)', value: r.calories_100g.toFixed(2) })
    if (r.carbohydrates_100g != null) rows.push({ label: 'Carbohydrates / 100g (g)', value: r.carbohydrates_100g.toFixed(2) })
    if (r.proteins_100g != null) rows.push({ label: 'Protein / 100g (g)', value: r.proteins_100g.toFixed(2) })
    if (r.fat_100g != null) rows.push({ label: 'Fat / 100g (g)', value: r.fat_100g.toFixed(2) })
    if (r.fiber_100g != null) rows.push({ label: 'Fibre / 100g (g)', value: r.fiber_100g.toFixed(2) })
  }
  return rows
}

/* =================================================================
   Main page
   ================================================================= */
export default function ProductChatPage() {
  const location = useLocation()
  const navigate = useNavigate()

  const result = (location.state as { result?: SearchResult } | null)?.result ?? null

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [history, setHistory] = useState<ChatMessagePayload[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Redirect if no result passed
  useEffect(() => {
    if (!result) navigate('/')
  }, [result, navigate])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(async () => {
    const q = input.trim()
    if (!q || loading || !result) return

    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content: q }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)

    const newHistory: ChatMessagePayload[] = [...history, { role: 'user', content: q }]

    try {
      const res = await chatWithProduct({
        message: q,
        context: buildContext(result),
        history: newHistory,
      })
      const assistantMsg: ChatMsg = { id: `a-${Date.now()}`, role: 'assistant', content: res.reply }
      setMessages((prev) => [...prev, assistantMsg])
      setHistory([...newHistory, { role: 'assistant', content: res.reply }])
    } catch (err) {
      const errorMsg: ChatMsg = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: `Could not process your request. ${err instanceof Error ? err.message : 'Please try again.'}`,
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }, [input, loading, result, history])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  if (!result) return null

  const rows = nutritionRows(result)

  return (
    <div className="flex flex-col min-h-screen bg-[var(--color-bg)]">
      <Header />

      <main className="flex-1 mx-auto w-full max-w-screen-2xl px-6 sm:px-8 lg:px-16 pt-6 pb-40">
        {/* ── Back button ── */}
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mb-6"
        >
          <ArrowLeft size={16} />
          Back to results
        </button>

        {/* ── Item summary card ── */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden mb-8">
          <div className="px-6 pt-5 pb-4">
            <h1 className="font-serif text-2xl font-bold text-[var(--color-text)] tracking-tight">
              {result.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                {result.cluster === 'recipe' ? 'Recipe' : 'Product'}
              </span>
              {result.cluster !== 'recipe' && result.brand && (
                <span className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-xs">
                  {result.brand}
                </span>
              )}
              {result.cluster !== 'recipe' && result.category && (
                <span className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-xs">
                  {result.category}
                </span>
              )}
            </div>
          </div>

          {rows.length > 0 && (
            <div className="border-t border-[var(--color-border)]">
              {rows.map(({ label, value }, i) => (
                <div
                  key={label}
                  className={cn(
                    'flex items-center justify-between px-6 py-2.5',
                    i % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-bg)]',
                  )}
                >
                  <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
                  <span className="text-sm font-medium text-[var(--color-text)] tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-[var(--color-border)] px-6 py-2.5 flex justify-end">
            <ReportButton
              query={result.name}
              responseType={result.cluster === 'recipe' ? 'recipe-card' : 'product-card'}
            />
          </div>
        </div>

        {/* ── Chat thread ── */}
        <div className="flex flex-col gap-5">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Sparkles size={32} className="mx-auto text-[var(--color-text-muted)] mb-4 opacity-40" />
              <p className="text-base font-medium text-[var(--color-text)] mb-1">
                Ask anything about {result.name}
              </p>
              <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto leading-relaxed">
                Try questions like &ldquo;Is this good for weight loss?&rdquo; or
                &ldquo;What are healthier alternatives?&rdquo;
              </p>
            </div>
          )}

          {messages.map((msg, idx) => {
            const prevUserQuery =
              msg.role === 'assistant' && idx > 0 && messages[idx - 1].role === 'user'
                ? messages[idx - 1].content
                : undefined
            return (
              <div key={msg.id} className="flex flex-col gap-3">
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="rounded-2xl rounded-tr-sm bg-[var(--color-accent)] text-[var(--color-accent-contrast)] px-5 py-3 text-sm font-medium max-w-[75%]">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20">
                        <Sparkles size={14} className="text-[var(--color-accent)]" />
                      </div>
                      <div className="rounded-2xl rounded-tl-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] px-5 py-3 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                    <div className="flex items-center justify-between pl-11 pr-1">
                      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                        <AlertTriangle size={9} strokeWidth={1.75} />
                        AI-generated — verify before acting on it
                      </span>
                      <ReportButton
                        query={prevUserQuery}
                        responseType={result.cluster === 'recipe' ? 'recipe-chat' : 'product-chat'}
                        aiResponse={msg.content}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {loading && (
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20">
                <Sparkles size={14} className="text-[var(--color-accent)]" />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-[var(--color-surface)] border border-[var(--color-border)] px-5 py-3 text-sm text-[var(--color-text-muted)]">
                Thinking...
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* ── Fixed bottom input bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur-md">
        <form
          onSubmit={(e: FormEvent) => { e.preventDefault(); handleSend() }}
          className="mx-auto max-w-screen-2xl px-6 sm:px-8 lg:px-16 py-3"
        >
          <div
            className={cn(
              'flex items-end gap-3 rounded-2xl border px-4 py-3',
              'border-[var(--color-border)] bg-[var(--color-surface)]',
              'focus-within:border-[var(--color-accent)]/50 transition-colors duration-150',
            )}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${result.name}...`}
              className="flex-1 resize-none bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none leading-relaxed max-h-36"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className={cn(
                'shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150',
                input.trim() && !loading
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:opacity-90'
                  : 'bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed',
              )}
            >
              <Send size={14} />
            </button>
          </div>
          <p className="mt-1.5 text-center text-xs text-[var(--color-text-muted)]">
            Enter to send · Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  )
}
