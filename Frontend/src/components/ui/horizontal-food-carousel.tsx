import { useRef, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { FoodCarouselCard } from '@/components/ui/food-carousel-card'
import { cn } from '@/lib/utils'
import type { FoodCardData } from '@/lib/types'

interface HorizontalFoodCarouselProps {
  title: string
  subtitle?: string
  accentColor?: string
  items: FoodCardData[]
  isLoading?: boolean
  variant?: 'recommend' | 'cooked'
  hasInteractions?: boolean
  onInteractionChange?: (
    itemId: string,
    cluster: 'recipe' | 'product',
    state: 'liked' | 'disliked' | null,
  ) => void
}

function SkeletonCard() {
  return (
    <div
      className="flex-shrink-0 animate-pulse rounded-2xl"
      style={{
        width: 'clamp(340px, 28vw, 420px)',
        height: 340,
        backgroundColor: 'rgba(16, 17, 20, 0.9)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="flex flex-col gap-5 p-6 pt-7">
        <div>
          <div className="h-5 w-3/4 rounded bg-white/[0.06]" />
          <div className="mt-3 h-3 w-1/2 rounded bg-white/[0.04]" />
        </div>
        <div className="h-px bg-white/[0.06]" />
        <div className="flex items-center justify-between px-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="h-3.5 w-3.5 rounded-full bg-white/[0.05]" />
              <div className="h-4 w-10 rounded bg-white/[0.06]" />
              <div className="h-2 w-7 rounded bg-white/[0.03]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function EmptyState({
  variant,
  hasInteractions = false,
}: {
  variant: 'recommend' | 'cooked'
  hasInteractions?: boolean
}) {
  let primary = ''
  let secondary = ''

  if (variant === 'cooked') {
    primary = 'No cooked recipes yet'
    secondary = 'Open a recipe and hit Cook Mode to get started'
  } else if (hasInteractions) {
    primary = 'We\'re learning your taste'
    secondary = 'Keep exploring and liking dishes to refine your picks'
  } else {
    primary = 'Like some recipes to get personalised picks'
    secondary = 'Search for dishes you enjoy and tap the thumbs-up button'
  }

  return (
    <div
      className="flex-shrink-0 flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-10 text-center"
      style={{
        width: 'clamp(340px, 28vw, 420px)',
        height: 340,
      }}
    >
      <p className="text-sm font-medium text-white/30">{primary}</p>
      <p className="mt-1.5 text-[11px] text-white/18 leading-relaxed">{secondary}</p>
    </div>
  )
}

const HOVER_TRACK_STYLES = `
.carousel-card {
  transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity 280ms ease,
              box-shadow 350ms ease,
              border-color 300ms ease;
}
.carousel-track:hover .carousel-card-wrapper .carousel-card {
  opacity: 0.55;
}
.carousel-card-wrapper:hover .carousel-card {
  opacity: 1 !important;
  transform: scale(1.03) translateY(-6px);
  z-index: 20;
  border-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow:
    0 24px 56px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 0 40px rgba(184, 131, 61, 0.06);
}
.carousel-card-wrapper {
  padding-top: 10px;
  padding-bottom: 10px;
}
`

export function HorizontalFoodCarousel({
  title,
  subtitle,
  accentColor = '#b8833d',
  items,
  isLoading = false,
  variant = 'recommend',
  hasInteractions = false,
  onInteractionChange,
}: HorizontalFoodCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollByAmount = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const cardWidth = el.querySelector('.carousel-card-wrapper')?.clientWidth ?? 360
    const step = cardWidth + 16
    el.scrollBy({
      left: direction === 'right' ? step : -step,
      behavior: 'smooth',
    })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 5) return
      e.preventDefault()
      el.scrollBy({ left: e.deltaY * 2.5, behavior: 'smooth' })
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  const showEmpty = !isLoading && items.length === 0

  return (
    <div className="relative">
      <style>{HOVER_TRACK_STYLES}</style>

      {/* Section header */}
      <div className="mb-5 flex items-baseline justify-between px-10">
        <div>
          <motion.h2
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="text-sm font-semibold uppercase tracking-[0.2em]"
            style={{ color: accentColor }}
          >
            {title}
          </motion.h2>
          {subtitle && (
            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="mt-1 text-[11px] text-white/25"
            >
              {subtitle}
            </motion.p>
          )}
        </div>

        {/* Arrow buttons */}
        {!showEmpty && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => scrollByAmount('left')}
              aria-label="Scroll left"
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-150',
                'border-white/10 text-white/30 hover:border-white/30 hover:text-white/70 hover:bg-white/5',
              )}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => scrollByAmount('right')}
              aria-label="Scroll right"
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-150',
                'border-white/10 text-white/30 hover:border-white/30 hover:text-white/70 hover:bg-white/5',
              )}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Overflow wrapper — clips horizontal overflow while allowing vertical for scale */}
      <div className="overflow-x-clip overflow-y-visible">
        {/* Track */}
        <div
          ref={scrollRef}
          className="carousel-track -my-4 flex gap-4 overflow-x-auto px-10 py-8"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', willChange: 'scroll-position' }}
        >
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            : showEmpty
            ? <EmptyState variant={variant} hasInteractions={hasInteractions} />
            : items.map((item) => (
                <FoodCarouselCard
                  key={item.id}
                  item={item}
                  variant={variant}
                  onInteractionChange={onInteractionChange}
                />
              ))}
        </div>
      </div>

      {/* Fade edges */}
      <div
        className="pointer-events-none absolute right-0 top-12 bottom-0 w-24 z-10"
        style={{
          background: 'linear-gradient(to right, transparent, #0c0c0c)',
        }}
      />
      <div
        className="pointer-events-none absolute left-0 top-12 bottom-0 w-10 z-10"
        style={{
          background: 'linear-gradient(to left, transparent, #0c0c0c)',
        }}
      />
    </div>
  )
}
