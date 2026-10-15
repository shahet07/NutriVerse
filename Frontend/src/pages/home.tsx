import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useMotionValue,
  animate,
} from 'framer-motion'
import {
  Menu,
  Camera,
  Search,
  ArrowRight,
  X,
  Sparkles,
  Flame,
  Leaf,
  Zap,
  UtensilsCrossed,
  ImageIcon,
  ChevronDown,
} from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { SteamEffect } from '@/components/ui/steam-effect'
import { HorizontalFoodCarousel } from '@/components/ui/horizontal-food-carousel'
import { useSidebar } from '@/hooks/use-sidebar'
import { useAuth } from '@/hooks/use-auth'
import { getRecommendations, getCookedHistory, searchQuery } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { FoodCardData, SearchResult } from '@/lib/types'
import landingBg from '@/assets/landing-bg.png'


const CHIPS = [
  { label: 'High protein breakfast', icon: Flame, mode: 'search' },
  { label: 'Compare Biryani vs Pulao', icon: Zap, mode: 'chat' },
  { label: 'Keto-friendly snacks', icon: Leaf, mode: 'search' },
  { label: 'Make Paneer Tikka low calorie', icon: Sparkles, mode: 'chat' },
  { label: 'Diabetic friendly desserts', icon: Leaf, mode: 'search' },
  { label: 'Sambar nutrition facts', icon: UtensilsCrossed, mode: 'chat' },
]

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export default function Home() {
  const navigate = useNavigate()
  const { openSidebar } = useSidebar()
  const { user, loading: authLoading } = useAuth()

  /* ── Omnibox state ── */
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  /* ── Recommender state ── */
  const [recommendations, setRecommendations] = useState<FoodCardData[]>([])
  const [cooked, setCooked] = useState<FoodCardData[]>([])
  const [isColdStart, setIsColdStart] = useState(false)
  const [isLoadingRec, setIsLoadingRec] = useState(true)
  const hasLoadedOnce = useRef(false)

  const handleCardInteraction = useCallback((
    itemId: string,
    cluster: 'recipe' | 'product',
    interactionState: 'liked' | 'disliked' | null,
  ) => {
    const updateState = (prev: FoodCardData[]) =>
      prev.map((card) =>
        card.id === itemId && card.cluster === cluster
          ? { ...card, interaction_state: interactionState }
          : card,
      )
    setRecommendations(updateState)
    setCooked(updateState)
  }, [])

  /* ── Scroll-driven hero parallax ── */
  const heroRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { scrollY } = useScroll({ container: scrollContainerRef })
  const heroContentOpacity = useTransform(scrollY, [0, 260], [1, 0])
  const heroContentY = useTransform(scrollY, [0, 260], [0, -32])
  const bgParallaxY = useTransform(scrollY, [0, 600], [0, 120])
  const chevronOpacity = useTransform(scrollY, [0, 80], [1, 0])

  /* ── Chevron bounce animation ── */
  const chevronY = useMotionValue(0)
  useEffect(() => {
    const ctrl = animate(chevronY, [0, 8, 0], {
      duration: 1.8,
      repeat: Infinity,
      ease: 'easeInOut',
    })
    return ctrl.stop
  }, [chevronY])

  /* ── Popular-items fallback via public search API ── */
  const FALLBACK_QUERIES = ['biryani', 'paneer', 'dal', 'chicken curry', 'dosa']

  const fetchPopularFallback = useCallback(async (): Promise<FoodCardData[]> => {
    const pick = FALLBACK_QUERIES[Math.floor(Math.random() * FALLBACK_QUERIES.length)]
    try {
      const res = await searchQuery(pick, { cluster: 'recipe', limit: 20 })
      return res.results.map((r: SearchResult) => ({
        id: r.id,
        name: r.name,
        cluster: r.cluster,
        food_name: r.food_name ?? null,
        serving_size_g: r.serving_size_g ?? null,
        calories: r.calories ?? r.calories_100g ?? null,
        protein: r.protein ?? r.proteins_100g ?? null,
        carbohydrates: r.carbohydrates ?? r.carbohydrates_100g ?? null,
        fats: r.fats ?? r.fat_100g ?? null,
        fibre: r.fibre ?? r.fiber_100g ?? null,
        prep_time_mins: r.prep_time_mins ?? null,
        brand: r.brand ?? null,
        category: r.category ?? null,
      }))
    } catch {
      return []
    }
  }, [])

  /* ── Fetch recommendations + cooked history in parallel ── */
  const fetchRecData = useCallback(async () => {
    if (authLoading) return
    // Only show skeleton placeholders on the very first load.
    // Subsequent refreshes swap data silently so cards stay mounted
    // and local interaction state (likes) is preserved.
    if (!hasLoadedOnce.current) setIsLoadingRec(true)

    try {
      if (user) {
        const [recRes, cookedRes] = await Promise.all([
          getRecommendations({ limit: 20 }),
          getCookedHistory({ limit: 8 }),
        ])

        if (recRes.items.length > 0) {
          setRecommendations(recRes.items)
          setCooked(cookedRes.items)
          setIsColdStart(recRes.cold_start)
          return
        }

        setCooked(cookedRes.items)
      }

      const fallback = await fetchPopularFallback()
      setRecommendations(fallback)
      setIsColdStart(true)
    } catch {
      const fallback = await fetchPopularFallback()
      setRecommendations(fallback)
      setCooked([])
      setIsColdStart(true)
    } finally {
      setIsLoadingRec(false)
      hasLoadedOnce.current = true
    }
  }, [user, authLoading, fetchPopularFallback])

  useEffect(() => {
    fetchRecData()
  }, [fetchRecData])

  // Refresh recommendations when the tab comes back from being hidden (e.g. user
  // switches tabs for a while).  We intentionally do NOT listen to `window.focus`
  // because on Windows that can fire when clicking inside the same window,
  // which sets isLoadingRec=true, unmounts the cards, and wipes local like state.
  useEffect(() => {
    const handleVisChange = () => {
      if (document.visibilityState === 'visible' && !authLoading) {
        fetchRecData()
      }
    }
    document.addEventListener('visibilitychange', handleVisChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisChange)
    }
  }, [fetchRecData, authLoading])

  const hasCookedHistory = cooked.length > 0

  /* ── Search ── */
  const handleSubmit = useCallback(
    (q?: string) => {
      const text = (q ?? query).trim()
      if (selectedImage) {
        navigate('/results', { state: { query: text, image: selectedImage } })
      } else if (text) {
        navigate(`/search?q=${encodeURIComponent(text)}`)
      }
    },
    [query, selectedImage, navigate],
  )

  const handleChipClick = (chip: (typeof CHIPS)[number]) => {
    if (chip.mode === 'chat') {
      navigate('/results', { state: { query: chip.label } })
    } else {
      navigate(`/search?q=${encodeURIComponent(chip.label)}`)
    }
  }

  /* ── Image handling ── */
  const handleImageFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return
    if (file.size > 10 * 1024 * 1024) return
    setSelectedImage(file)
    setImagePreviewUrl(URL.createObjectURL(file))
  }, [])

  const removeImage = useCallback(() => {
    setSelectedImage(null)
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl)
    setImagePreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [imagePreviewUrl])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImageFile(file)
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounter.current = 0
    const file = e.dataTransfer.files?.[0]
    if (file) handleImageFile(file)
  }

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file' && ACCEPTED_TYPES.includes(item.type)) {
          const file = item.getAsFile()
          if (file) handleImageFile(file)
          break
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [handleImageFile])

  const hasInput = query.trim() || selectedImage
  const showBelowFold = !authLoading

  return (
    <div ref={scrollContainerRef} className="relative w-full h-full overflow-x-hidden overflow-y-auto">

      {/* ════════════════════════════════════════════════
          HERO SECTION
          ════════════════════════════════════════════════ */}
      <section ref={heroRef} className="relative h-screen overflow-hidden">

        {/* Hamburger */}
        <button
          onClick={openSidebar}
          aria-label="Open navigation"
          className="absolute top-4 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-lg
            text-white/60 hover:text-white hover:bg-white/10 transition-colors duration-150"
        >
          <Menu size={22} strokeWidth={1.75} />
        </button>

        {/* Background with parallax */}
        <motion.div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${landingBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
            backgroundRepeat: 'no-repeat',
            y: bgParallaxY,
            scale: 1.12,
          }}
        />

        {/* Vignette */}
        <div className="absolute inset-0 z-[1] bg-gradient-to-b from-black/80 via-black/25 to-black/65" />

        {/* Steam */}
        <SteamEffect />

        {/* Main content — fades as hero scrolls away */}
        <motion.div
          style={{ opacity: heroContentOpacity, y: heroContentY }}
          className="relative z-20 flex h-full flex-col items-center justify-center px-4 py-16 lg:pr-[22vw]"
        >
          <motion.div
            initial={{ opacity: 0, y: -32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="text-center"
          >
            <Logo size="xl" alwaysWhite className="drop-shadow-2xl" />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.6 }}
            className="mt-4 text-[11px] font-sans font-medium uppercase tracking-[0.5em] text-white/65"
            style={{ textShadow: '0 1px 10px rgba(0,0,0,0.8)' }}
          >
            Intelligent Nutrition Analysis
          </motion.p>

          {/* Omnibox */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mt-10 w-full max-w-2xl"
          >
            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={cn(
                'relative rounded-2xl border backdrop-blur-xl transition-all duration-300',
                isDragging
                  ? 'border-white/60 bg-white/20 shadow-[0_0_24px_rgba(255,255,255,0.15)]'
                  : isFocused
                    ? 'border-white/50 bg-white/15 shadow-[0_0_0_1px_rgba(255,255,255,0.3),0_8px_32px_rgba(0,0,0,0.4)]'
                    : 'border-white/25 bg-white/10 hover:bg-white/14 hover:border-white/35',
              )}
            >
              <AnimatePresence>
                {isDragging && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-10 rounded-2xl flex items-center justify-center bg-white/10 backdrop-blur-sm"
                  >
                    <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
                      <ImageIcon size={18} />
                      Drop image here
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {imagePreviewUrl && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-3 px-4 pt-3">
                      <div className="relative h-16 w-16 rounded-xl overflow-hidden border border-white/20 flex-shrink-0">
                        <img
                          src={imagePreviewUrl}
                          alt="Upload preview"
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={removeImage}
                          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 transition-opacity"
                        >
                          <X size={14} className="text-white" />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white/70 truncate">
                          {selectedImage?.name}
                        </p>
                        <p className="text-[11px] text-white/40">
                          {selectedImage
                            ? `${(selectedImage.size / 1024).toFixed(0)} KB`
                            : ''}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSubmit()
                }}
                className="flex items-center gap-2 px-4 py-3"
              >
                <Search
                  size={20}
                  strokeWidth={isFocused ? 2.2 : 1.5}
                  className={cn(
                    'flex-shrink-0 transition-all duration-300',
                    isFocused ? 'text-white' : 'text-white/50',
                  )}
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                  placeholder="Ask anything about nutrition..."
                  autoFocus
                  className="flex-1 bg-transparent text-white placeholder:text-white/40 text-base outline-none font-sans"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all duration-150"
                  aria-label="Upload image"
                >
                  <Camera size={18} strokeWidth={1.5} />
                </button>
                <AnimatePresence>
                  {hasInput && (
                    <motion.button
                      type="submit"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="flex-shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition-shadow hover:shadow-lg"
                    >
                      <ArrowRight size={16} strokeWidth={2} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </form>

              <div className="flex items-center gap-3 px-4 pb-2.5 text-[11px] text-white/30">
                <span>Paste or drop an image</span>
                <span className="w-px h-3 bg-white/15" />
                <span>Enter to search</span>
              </div>
            </div>
          </motion.div>

          {/* Suggestion chips */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.85, duration: 0.5 }}
            className="mt-6 flex flex-wrap justify-center gap-2.5 max-w-2xl"
          >
            {CHIPS.map((chip, i) => (
              <motion.button
                key={chip.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.95 + i * 0.06, duration: 0.3 }}
                onClick={() => handleChipClick(chip)}
                className="group flex items-center gap-2 rounded-full border border-white/15 bg-white/8 backdrop-blur-md
                  pl-3 pr-4 py-2 text-xs font-medium text-white/60
                  hover:bg-white/16 hover:text-white hover:border-white/35
                  transition-all duration-200"
              >
                <chip.icon
                  size={13}
                  strokeWidth={1.75}
                  className="text-white/40 group-hover:text-white/80 transition-colors"
                />
                {chip.label}
              </motion.button>
            ))}
          </motion.div>
        </motion.div>

        {/* Bounce chevron — only shown when personalised content is below */}
        {showBelowFold && (
          <motion.div
            style={{ opacity: chevronOpacity, y: chevronY }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-1"
          >
            <ChevronDown
              size={22}
              strokeWidth={1.5}
              className="text-white/30"
            />
          </motion.div>
        )}

        {/* Corner watermark blocker */}
        <div className="absolute bottom-0 right-0 z-30 w-72 h-28
          bg-gradient-to-tl from-black from-50% via-black/95 via-70% to-transparent" />
        <div className="absolute bottom-0 right-0 z-31 w-48 h-16 bg-black" />
      </section>

      {/* ════════════════════════════════════════════════
          BELOW-THE-FOLD — Personalised Content
          Only rendered when the user is authenticated.
          ════════════════════════════════════════════════ */}
      {showBelowFold && (
        <section
          className="relative w-full"
          style={{ backgroundColor: '#0c0c0c' }}
        >
          {/* Top separator gradient — blends from the hero's black bottom edge */}
          <div
            className="absolute top-0 left-0 right-0 h-16 pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, #000 0%, #0c0c0c 100%)',
            }}
          />

          {/* Content */}
          <div className="relative pt-16 pb-24 flex flex-col gap-16">

            {/* ── Row 1: Recommendations / Popular ── */}
            <HorizontalFoodCarousel
              title={
                isColdStart || !user
                  ? 'Popular Right Now'
                  : 'Recommended For You'
              }
              subtitle={
                !isLoadingRec && isColdStart && user
                  ? 'Personalises as you cook and like dishes'
                  : !isLoadingRec && !user
                    ? 'Sign in to get personalized recommendations'
                    : undefined
              }
              accentColor="#b8833d"
              items={isLoadingRec ? [] : recommendations}
              isLoading={isLoadingRec}
              variant="recommend"
              hasInteractions={!isColdStart}
              onInteractionChange={handleCardInteraction}
            />

            {/* ── Row 2: Previously Cooked — only shown when user has cook history ── */}
            {(isLoadingRec || hasCookedHistory) && (
              <>
                <div
                  className="mx-10 h-px"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
                />
                <HorizontalFoodCarousel
                  title="Previously Cooked"
                  accentColor="#6b8f5e"
                  items={isLoadingRec ? [] : cooked}
                  isLoading={isLoadingRec}
                  variant="cooked"
                  onInteractionChange={handleCardInteraction}
                />
              </>
            )}
          </div>

          {/* Bottom fade into terminal black */}
          <div
            className="h-12 w-full pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, #0c0c0c, #000)',
            }}
          />
        </section>
      )}
    </div>
  )
}
