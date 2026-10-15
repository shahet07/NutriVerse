import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChefHat, ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { logLiked, logUnliked, logDisliked, logUndisliked, logViewed } from '@/lib/api'
import { ReportButton } from '@/components/ui/report-button'
import type { SearchResult } from '@/lib/types'

/* ── Collapsible section ────────────────────────────────────────── */
function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-[var(--color-border)]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left
          hover:bg-[var(--color-bg)] transition-colors"
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          {title}
        </span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
        </motion.div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-line">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Nutrition rows ─────────────────────────────────────────────── */
function buildNutritionRows(result: SearchResult): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  if (result.cluster === 'recipe') {
    if (result.serving_size_g != null) rows.push({ label: 'Serving size',       value: `${Math.round(result.serving_size_g)} g` })
    if (result.calories != null)      rows.push({ label: 'Calories (kcal)',    value: result.calories.toFixed(1) })
    if (result.protein != null)       rows.push({ label: 'Protein (g)',         value: result.protein.toFixed(1) })
    if (result.carbohydrates != null) rows.push({ label: 'Carbohydrates (g)',   value: result.carbohydrates.toFixed(1) })
    if (result.fats != null)          rows.push({ label: 'Fats (g)',            value: result.fats.toFixed(1) })
    if (result.free_sugar != null)    rows.push({ label: 'Free Sugar (g)',      value: result.free_sugar.toFixed(1) })
    if (result.fibre != null)         rows.push({ label: 'Fibre (g)',           value: result.fibre.toFixed(1) })
    if (result.sodium != null)        rows.push({ label: 'Sodium (mg)',         value: result.sodium.toFixed(1) })
    if (result.calcium != null)       rows.push({ label: 'Calcium (mg)',        value: result.calcium.toFixed(1) })
    if (result.iron != null)          rows.push({ label: 'Iron (mg)',           value: result.iron.toFixed(1) })
    if (result.vitamin_c != null)     rows.push({ label: 'Vitamin C (mg)',      value: result.vitamin_c.toFixed(1) })
    if (result.folate != null)        rows.push({ label: 'Folate (µg)',         value: result.folate.toFixed(1) })
  } else {
    if (result.calories_100g != null)      rows.push({ label: 'Calories / 100g',    value: result.calories_100g.toFixed(1) })
    if (result.proteins_100g != null)      rows.push({ label: 'Protein / 100g (g)', value: result.proteins_100g.toFixed(1) })
    if (result.carbohydrates_100g != null) rows.push({ label: 'Carbs / 100g (g)',   value: result.carbohydrates_100g.toFixed(1) })
    if (result.fat_100g != null)           rows.push({ label: 'Fat / 100g (g)',     value: result.fat_100g.toFixed(1) })
    if (result.sugars_100g != null)        rows.push({ label: 'Sugars / 100g (g)', value: result.sugars_100g.toFixed(1) })
    if (result.fiber_100g != null)         rows.push({ label: 'Fibre / 100g (g)',  value: result.fiber_100g.toFixed(1) })
    if (result.sodium_100g != null)        rows.push({ label: 'Sodium / 100g (mg)',value: result.sodium_100g.toFixed(1) })
  }
  return rows
}

/* ── Main card ──────────────────────────────────────────────────── */
interface SearchResultCardProps {
  result: SearchResult
  index?: number
  onChat?: (result: SearchResult) => void
  onInteractionChange?: (
    itemId: string,
    cluster: 'recipe' | 'product',
    state: 'liked' | 'disliked' | null,
  ) => void
}

export function SearchResultCard({
  result,
  index = 0,
  onChat,
  onInteractionChange,
}: SearchResultCardProps) {
  const navigate = useNavigate()
  const { isAuthenticated, hasBackendSession } = useAuth()
  const isRecipe = result.cluster === 'recipe'
  const cluster  = isRecipe ? 'recipe' : 'product'
  const rows     = buildNutritionRows(result)

  const [liked,    setLiked]    = useState(result.interaction_state === 'liked')
  const [disliked, setDisliked] = useState(result.interaction_state === 'disliked')
  const [busy,     setBusy]     = useState(false)
  const [toast,    setToast]    = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.type === 'success' ? 2000 : 3000)
    return () => clearTimeout(t)
  }, [toast])

  const cardRef = useRef<HTMLDivElement>(null)
  const viewedRef = useRef(false)

  // Only sync when the item identity changes, not on every interaction_state update.
  // See food-carousel-card.tsx for the reasoning.
  useEffect(() => {
    setLiked(result.interaction_state === 'liked')
    setDisliked(result.interaction_state === 'disliked')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.id, result.cluster])

  useEffect(() => {
    if (!isAuthenticated || viewedRef.current) return
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !viewedRef.current) {
          viewedRef.current = true
          logViewed(result.id, cluster).catch(() => null)
          observer.disconnect()
        }
      },
      { threshold: 0.5 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isAuthenticated, result.id, cluster])

  const handleLike = useCallback(async () => {
    if (busy) return
    const prevLiked = liked
    const prevDisliked = disliked
    const nextLiked = !liked
    setLiked(nextLiked)
    if (nextLiked) setDisliked(false)
    onInteractionChange?.(result.id, cluster, nextLiked ? 'liked' : null)
    setBusy(true)
    try {
      const serverState = nextLiked
        ? await logLiked(result.id, cluster)
        : await logUnliked(result.id, cluster)
      setLiked(serverState === 'liked')
      setDisliked(serverState === 'disliked')
      onInteractionChange?.(result.id, cluster, serverState)
      setToast({ message: nextLiked ? 'Saved to your taste profile' : 'Removed from taste profile', type: 'success' })
    } catch (err) {
      setLiked(prevLiked)
      setDisliked(prevDisliked)
      onInteractionChange?.(result.id, cluster, prevLiked ? 'liked' : prevDisliked ? 'disliked' : null)
      const detail = err instanceof Error ? err.message : 'Unknown error'
      setToast({ message: `Couldn't save preference: ${detail}`, type: 'error' })
    } finally {
      setBusy(false)
    }
  }, [busy, liked, disliked, result.id, cluster, onInteractionChange])

  const handleDislike = useCallback(async () => {
    if (busy) return
    const prevLiked = liked
    const prevDisliked = disliked
    const nextDisliked = !disliked
    setDisliked(nextDisliked)
    if (nextDisliked) setLiked(false)
    onInteractionChange?.(result.id, cluster, nextDisliked ? 'disliked' : null)
    setBusy(true)
    try {
      const serverState = nextDisliked
        ? await logDisliked(result.id, cluster)
        : await logUndisliked(result.id, cluster)
      setLiked(serverState === 'liked')
      setDisliked(serverState === 'disliked')
      onInteractionChange?.(result.id, cluster, serverState)
      setToast({ message: nextDisliked ? 'Noted — you disliked this' : 'Dislike removed', type: 'success' })
    } catch (err) {
      setLiked(prevLiked)
      setDisliked(prevDisliked)
      onInteractionChange?.(result.id, cluster, prevLiked ? 'liked' : prevDisliked ? 'disliked' : null)
      const detail = err instanceof Error ? err.message : 'Unknown error'
      setToast({ message: `Couldn't save preference: ${detail}`, type: 'error' })
    } finally {
      setBusy(false)
    }
  }, [busy, liked, disliked, result.id, cluster, onInteractionChange])

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: index * 0.055, ease: 'easeOut' }}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-4">

          {/* Title + metadata */}
          <div className="flex-1 min-w-0">
            <h2 className="font-serif text-2xl font-bold text-[var(--color-text)] tracking-tight leading-tight">
              {result.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {isRecipe && result.prep_time_mins != null && (
                <Pill>{result.prep_time_mins} min</Pill>
              )}
              {isRecipe && result.serving_size_g != null && (
                <Pill>{Math.round(result.serving_size_g)}g serving</Pill>
              )}
              {!isRecipe && result.brand && (
                <Pill>{result.brand}</Pill>
              )}
              {!isRecipe && result.category && (
                <Pill>{result.category}</Pill>
              )}
              <Pill accent>{Math.round(result.final_score * 100)}% match</Pill>
            </div>
          </div>

          {/* Like / Dislike buttons — auth-gated */}
          {isAuthenticated && hasBackendSession && (
            <div className="flex items-center gap-1.5 flex-shrink-0 pt-1">
              <button
                onClick={(e) => { e.stopPropagation(); handleLike() }}
                disabled={busy}
                title={liked ? 'Unlike' : 'Like'}
                className={cn(
                  'flex items-center justify-center h-8 w-8 rounded-lg border transition-all duration-150',
                  liked
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-emerald-500/30 hover:text-emerald-500',
                )}
              >
                <ThumbsUp size={14} strokeWidth={liked ? 2.5 : 1.75} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDislike() }}
                disabled={busy}
                title={disliked ? 'Remove dislike' : 'Dislike'}
                className={cn(
                  'flex items-center justify-center h-8 w-8 rounded-lg border transition-all duration-150',
                  disliked
                    ? 'border-red-500/40 bg-red-500/10 text-red-500'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-red-500/30 hover:text-red-500',
                )}
              >
                <ThumbsDown size={14} strokeWidth={disliked ? 2.5 : 1.75} />
              </button>
            </div>
          )}
          {isAuthenticated && !hasBackendSession && (
            <span className="text-[11px] text-[var(--color-text-muted)] opacity-70">
              Syncing account...
            </span>
          )}
        </div>
      </div>

      {/* Nutrition table */}
      {rows.length > 0 && (
        <div className="border-t border-[var(--color-border)]">
          {rows.map(({ label, value }, i) => (
            <div
              key={label}
              className={cn(
                'flex items-center justify-between px-5 py-2.5',
                i % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-bg)]',
              )}
            >
              <span className="text-sm text-[var(--color-text-muted)]">{label}</span>
              <span className="text-sm font-semibold text-[var(--color-text)] tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Collapsible sections */}
      {isRecipe && result.raw_ingredients && (
        <CollapsibleSection title="Ingredients" defaultOpen>
          {result.raw_ingredients}
        </CollapsibleSection>
      )}
      {isRecipe && result.instructions && (
        <CollapsibleSection title="Instructions">
          {result.instructions}
        </CollapsibleSection>
      )}

      {/* Inline toast */}
      {toast && (
        <div
          className={cn(
            'mx-5 mb-3 rounded-lg px-3 py-2 text-xs font-medium',
            toast.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20',
          )}
        >
          {toast.message}
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-[var(--color-border)] px-5 py-3 flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onChat?.(result) }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium',
            'border-[var(--color-border)] text-[var(--color-text-muted)]',
            'hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/50 transition-colors duration-150',
          )}
        >
          <MessageSquare size={12} strokeWidth={1.75} />
          Ask AI
        </button>

        {isRecipe && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigate('/chef', { state: { recipe: result } })
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium',
              'border-[var(--color-border)] text-[var(--color-text-muted)]',
              'hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/50 transition-colors duration-150',
            )}
          >
            <ChefHat size={12} strokeWidth={1.75} />
            Cook Mode
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          {/* Interaction hint when not logged in */}
          {!isAuthenticated && (
            <span className="text-[11px] text-[var(--color-text-muted)] opacity-50">
              Sign in to like or dislike
            </span>
          )}
          <ReportButton
            query={result.name}
            responseType={isRecipe ? 'recipe-result-card' : 'product-result-card'}
          />
        </div>
      </div>
    </motion.div>
  )
}

/* ── Metadata pill ──────────────────────────────────────────────── */
function Pill({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        accent
          ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/8 text-[var(--color-accent)]'
          : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)]',
      )}
    >
      {children}
    </span>
  )
}
