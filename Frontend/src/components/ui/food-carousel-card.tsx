import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef, type MouseEvent } from 'react'
import { ChefHat, Clock3, ThumbsUp, ThumbsDown, Sparkles, Eye, Flame, Dumbbell, Wheat, Droplets } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { logLiked, logUnliked, logDisliked, logUndisliked, logViewed } from '@/lib/api'
import { ReportButton } from '@/components/ui/report-button'
import type { FoodCardData } from '@/lib/types'

interface FoodCarouselCardProps {
  item: FoodCardData
  variant?: 'recommend' | 'cooked'
  onInteractionChange?: (
    itemId: string,
    cluster: 'recipe' | 'product',
    state: 'liked' | 'disliked' | null,
  ) => void
}


function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    })
  } catch {
    return ''
  }
}

export function FoodCarouselCard({
  item,
  variant = 'recommend',
  onInteractionChange,
}: FoodCarouselCardProps) {
  const navigate = useNavigate()
  const { isAuthenticated, hasBackendSession } = useAuth()
  const isRecipe = item.cluster === 'recipe'
  const cluster = isRecipe ? 'recipe' : 'product'
  const [liked, setLiked] = useState(item.interaction_state === 'liked')
  const [disliked, setDisliked] = useState(item.interaction_state === 'disliked')
  const [busy, setBusy] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const viewedRef = useRef(false)

  useEffect(() => {
    setLiked(item.interaction_state === 'liked')
    setDisliked(item.interaction_state === 'disliked')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.cluster])

  useEffect(() => {
    if (!isAuthenticated || viewedRef.current) return
    const el = cardRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting || viewedRef.current) return
        viewedRef.current = true
        logViewed(item.id, cluster).catch(() => null)
        observer.disconnect()
      },
      { threshold: 0.6 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [isAuthenticated, item.id, cluster])

  const handleLike = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (busy) return

    const prevLiked = liked
    const prevDisliked = disliked
    const nextLiked = !liked

    setLiked(nextLiked)
    if (nextLiked) setDisliked(false)
    onInteractionChange?.(item.id, cluster, nextLiked ? 'liked' : null)

    setBusy(true)
    try {
      const serverState = nextLiked
        ? await logLiked(item.id, cluster)
        : await logUnliked(item.id, cluster)
      setLiked(serverState === 'liked')
      setDisliked(serverState === 'disliked')
      onInteractionChange?.(item.id, cluster, serverState)
    } catch (err) {
      setLiked(prevLiked)
      setDisliked(prevDisliked)
      onInteractionChange?.(item.id, cluster, prevLiked ? 'liked' : prevDisliked ? 'disliked' : null)
      console.warn('[FoodCarouselCard] Like failed:', err instanceof Error ? err.message : err)
    } finally {
      setBusy(false)
    }
  }, [busy, liked, disliked, item.id, cluster, onInteractionChange])

  const handleDislike = useCallback(async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (busy) return

    const prevLiked = liked
    const prevDisliked = disliked
    const nextDisliked = !disliked

    setDisliked(nextDisliked)
    if (nextDisliked) setLiked(false)
    onInteractionChange?.(item.id, cluster, nextDisliked ? 'disliked' : null)

    setBusy(true)
    try {
      const serverState = nextDisliked
        ? await logDisliked(item.id, cluster)
        : await logUndisliked(item.id, cluster)
      setLiked(serverState === 'liked')
      setDisliked(serverState === 'disliked')
      onInteractionChange?.(item.id, cluster, serverState)
    } catch (err) {
      setLiked(prevLiked)
      setDisliked(prevDisliked)
      onInteractionChange?.(item.id, cluster, prevLiked ? 'liked' : prevDisliked ? 'disliked' : null)
      console.warn('[FoodCarouselCard] Dislike failed:', err instanceof Error ? err.message : err)
    } finally {
      setBusy(false)
    }
  }, [busy, liked, disliked, item.id, cluster, onInteractionChange])

  const accentColor = isRecipe ? '#b8833d' : '#3a7cc9'

  const macros = [
    { icon: Flame, label: 'Cal', value: item.calories != null ? Math.round(item.calories) : null, unit: '' },
    { icon: Dumbbell, label: 'Protein', value: item.protein != null ? Math.round(item.protein) : null, unit: 'g' },
    { icon: Wheat, label: 'Carbs', value: item.carbohydrates != null ? Math.round(item.carbohydrates) : null, unit: 'g' },
    { icon: Droplets, label: 'Fat', value: item.fats != null ? Math.round(item.fats) : null, unit: 'g' },
  ]

  const subtitle = isRecipe
    ? [
        item.prep_time_mins != null ? `${item.prep_time_mins} min` : null,
        item.serving_size_g != null ? `${Math.round(item.serving_size_g)}g` : null,
      ]
        .filter(Boolean)
        .join(' \u00b7 ')
    : [item.brand, item.category].filter(Boolean).join(' \u00b7 ')

  return (
    <div
      className="carousel-card-wrapper flex-shrink-0"
      style={{ width: 'clamp(340px, 28vw, 420px)' }}
    >
      <div
        ref={cardRef}
        className={cn(
          'carousel-card relative flex h-[340px] flex-col overflow-hidden rounded-2xl group cursor-pointer',
          'transition-all duration-300 ease-out will-change-transform',
        )}
        style={{
          backgroundColor: 'rgba(16, 17, 20, 0.9)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
        onClick={() => navigate(`/search?q=${encodeURIComponent(item.name)}`)}
      >
        {/* Subtle top-edge highlight */}
        <div
          className="absolute top-0 left-[10%] right-[10%] h-px z-10"
          style={{
            background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)`,
          }}
        />

        {/* Inner ambient glow */}
        <div
          className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 h-40 w-56 rounded-full opacity-[0.06] blur-3xl transition-opacity duration-500 group-hover:opacity-[0.12]"
          style={{ backgroundColor: accentColor }}
        />

        {/* Badge row */}
        <div className="relative flex items-center justify-between px-6 pt-5">
          {/* Left badges */}
          <div className="flex items-center gap-2.5">
            {item.is_filler && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-[11px] font-medium tracking-wide text-white/70">
                <Sparkles size={11} className="text-white/50" />
                Suggested
              </span>
            )}
            {variant === 'cooked' && !item.is_filler && (
              <span
                className="rounded-full border border-white/12 px-3 py-1 text-[11px] font-medium tracking-wide text-white/85"
                style={{ backgroundColor: `${accentColor}25` }}
              >
                Cooked
              </span>
            )}
            {isRecipe && item.prep_time_mins != null && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-white/50">
                <Clock3 size={11} />
                {item.prep_time_mins} min
              </span>
            )}
          </div>

          {/* Like/dislike controls */}
          {variant === 'recommend' && isAuthenticated && hasBackendSession && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleLike}
                disabled={busy}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-200',
                  liked
                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                    : 'border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/[0.08]',
                )}
                title={liked ? 'Unlike' : 'Like'}
              >
                <ThumbsUp size={13} strokeWidth={liked ? 2.5 : 2} />
              </button>
              <button
                onClick={handleDislike}
                disabled={busy}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-200',
                  disliked
                    ? 'border-red-400/40 bg-red-500/15 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.15)]'
                    : 'border-white/10 text-white/40 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/[0.08]',
                )}
                title={disliked ? 'Remove dislike' : 'Dislike'}
              >
                <ThumbsDown size={13} strokeWidth={disliked ? 2.5 : 2} />
              </button>
            </div>
          )}
        </div>

        {/* Title & subtitle */}
        <div className="px-6 pt-4 pb-1">
          <h3 className="line-clamp-2 font-serif text-lg font-semibold leading-snug text-white/95 tracking-[-0.01em]">
            {item.name}
          </h3>
          {subtitle && (
            <p className="mt-2 truncate text-xs text-white/45 tracking-wide">
              {subtitle}
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="mx-6 mt-3 mb-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Macro row */}
        <div className="flex items-center justify-between px-6">
          {macros.map((m, i) => (
            <div key={m.label} className="flex items-center gap-2">
              {i > 0 && <div className="h-7 w-px bg-white/[0.08] -ml-1 mr-2" />}
              <div className="flex flex-col items-center min-w-[48px]">
                <m.icon size={13} className="text-white/30 mb-1.5" />
                <span className="text-sm font-semibold tabular-nums text-white/90 leading-none">
                  {m.value != null ? `${m.value}${m.unit}` : '\u2014'}
                </span>
                <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.15em] text-white/35 leading-none">
                  {m.label}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Cooked metadata */}
        {variant === 'cooked' && !item.is_filler && item.cooked_at && (
          <div className="mx-6 mt-4 flex items-center justify-end rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5">
            <span className="text-[11px] text-white/40">{formatDate(item.cooked_at)}</span>
          </div>
        )}

        {/* Footer */}
        <div className="mt-auto flex items-center gap-3 border-t border-white/[0.07] px-6 py-3">
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/search?q=${encodeURIComponent(item.name)}`)
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-[11px] font-medium text-white/60 transition-all duration-200 hover:bg-white/[0.06] hover:text-white/90 hover:border-white/20"
          >
            <Eye size={12} />
            View
          </button>
          {isRecipe && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigate('/chef', {
                  state: {
                    recipe: {
                      name: item.name,
                      food_name: item.food_name,
                      serving_size_g: item.serving_size_g,
                      prep_time_mins: item.prep_time_mins,
                      cluster: item.cluster,
                      id: item.id,
                    },
                  },
                })
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-[11px] font-medium text-white/60 transition-all duration-200 hover:bg-white/[0.06] hover:text-white/90 hover:border-white/20"
            >
              <ChefHat size={12} />
              Cook
            </button>
          )}
          {variant === 'recommend' && isAuthenticated && !hasBackendSession && (
            <span className="text-[11px] text-white/40">Syncing...</span>
          )}
          <div
            className="ml-auto flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <ReportButton
              query={item.name}
              responseType={variant === 'cooked' ? 'cooked-history' : 'recommendation'}
              dark
            />
            <span
              className="text-[10px] font-medium uppercase tracking-[0.18em] transition-colors duration-200"
              style={{ color: `${accentColor}80` }}
            >
              {isRecipe ? 'Recipe' : 'Product'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
