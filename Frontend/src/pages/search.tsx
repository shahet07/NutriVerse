/**
 * Search page — semantic search with filters.
 *
 * Route: /search?q=<query>
 * Features:
 * - Table-style nutrition cards grouped by Recipes and Products
 * - 3 results shown initially per cluster; "See more" expands to ~15
 * - Filter panel (cluster toggle + health-tag pills + allergen pills)
 * - "Ask AI" navigates to a dedicated chat page
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { FilterPanel } from '@/components/ui/filter-panel'
import { SearchResultCard } from '@/components/ui/search-result-card'
import { SkeletonLoader } from '@/components/ui/skeleton-loader'
import { useSemanticSearch } from '@/hooks/use-semantic-search'
import { useAuth } from '@/hooks/use-auth'
import { usePreferences } from '@/hooks/use-preferences'
import { getInteractionStates } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { SearchFilters, SearchResult } from '@/lib/types'

const INITIAL_PER_CLUSTER = 3
const EXPANDED_PER_CLUSTER = 15

/* -- Empty state -------------------------------------------------- */
function EmptyState({ query }: { query: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-24 text-center"
    >
      <p className="text-base font-medium text-[var(--color-text)] mb-2">
        No results found for &ldquo;{query}&rdquo;
      </p>
      <p className="text-sm text-[var(--color-text-muted)] max-w-sm leading-relaxed">
        Try a different spelling or fewer filters.
      </p>
    </motion.div>
  )
}

/* -- Section heading ---------------------------------------------- */
function SectionHeading({
  label,
  count,
}: {
  label: string
  count: number
}) {
  return (
    <div className="flex items-center gap-3 mb-5 mt-10 first:mt-0">
      <h2 className="text-lg font-bold text-[var(--color-text)]">{label}</h2>
      <span className="text-sm text-[var(--color-text-muted)]">({count})</span>
    </div>
  )
}

/* =================================================================
   Main search page
   ================================================================= */
export default function SearchPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { loading: authLoading, isAuthenticated, hasBackendSession } = useAuth()
  const { prefs } = usePreferences()

  const q = searchParams.get('q') ?? ''

  const { loading, response, error, search, reset } = useSemanticSearch()
  const [filters, setFilters] = useState<SearchFilters>(() => ({
    cluster: 'all',
    // Health tags are NOT auto-applied from preferences — users choose them
    // explicitly via the filter panel so no over-restrictive AND-filter surprises.
    healthTags: [],
    // Allergen exclusions ARE applied automatically — safety-critical.
    excludeAllergens: prefs.excludeAllergens,
    limit: 50,
  }))
  const [showFilters, setShowFilters] = useState(false)
  const [showAllRecipes, setShowAllRecipes] = useState(false)
  const [showAllProducts, setShowAllProducts] = useState(false)
  const [interactionOverrides, setInteractionOverrides] = useState<Record<string, 'liked' | 'disliked' | null>>({})

  const runSearch = useCallback(
    (query: string, f: SearchFilters) => {
      if (!query.trim()) return
      search(query, f)
    },
    [search],
  )

  // Track whether the initial mount search has already run so the filters
  // effect only fires on genuine user-driven filter changes, not on mount.
  const didMountSearch = useRef(false)

  useEffect(() => {
    if (q) {
      runSearch(q, filters)
      didMountSearch.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  useEffect(() => {
    if (!didMountSearch.current) return
    if (q) runSearch(q, filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  useEffect(() => {
    if (!q || authLoading) return
    // Re-hydrate interaction_state once backend session is ready (post login/refresh).
    if (hasBackendSession) runSearch(q, filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, hasBackendSession, q])

  useEffect(() => {
    if (!isAuthenticated || !response?.results?.length) return
    const items = response.results.map((r) => ({ id: String(r.id), cluster: r.cluster }))
    getInteractionStates(items)
      .then((payload) => {
        if (!payload.items.length) return
        setInteractionOverrides((prev) => {
          const next = { ...prev }
          for (const row of payload.items) {
            next[`${row.cluster}:${row.id}`] = row.state
          }
          return next
        })
      })
      .catch(() => null)
  }, [isAuthenticated, response?.results])

  const handleNewSearch = (query: string) => {
    reset()
    setShowAllRecipes(false)
    setShowAllProducts(false)
    setSearchParams({ q: query })
  }

  const handleFilterChange = (f: SearchFilters) => {
    setFilters(f)
  }

  const handleOpenChat = (result: SearchResult) => {
    navigate('/product-chat', { state: { result } })
  }

  const handleCardInteraction = useCallback((
    itemId: string,
    cluster: 'recipe' | 'product',
    interactionState: 'liked' | 'disliked' | null,
  ) => {
    setInteractionOverrides((prev) => ({
      ...prev,
      [`${cluster}:${itemId}`]: interactionState,
    }))
  }, [])

  /* -- No query -> empty prompt -- */
  if (!q) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)]">
        <Header />
        <div className="flex flex-col items-center justify-center py-32 px-4 text-center">
          <p className="text-lg font-medium text-[var(--color-text)] mb-2">Search for food</p>
          <p className="text-sm text-[var(--color-text-muted)] max-w-md leading-relaxed">
            Use the search bar above to find recipes and products across our database
            of 725+ Indian recipes and 6,400+ packaged products.
          </p>
        </div>
      </div>
    )
  }

  const results = response?.results ?? []
  const resultsWithOverrides = results.map((r) => {
    const override = interactionOverrides[`${r.cluster}:${r.id}`]
    if (override === undefined) return r
    return { ...r, interaction_state: override }
  })
  const allRecipeResults = resultsWithOverrides.filter((r) => r.cluster === 'recipe')
  const allProductResults = resultsWithOverrides.filter((r) => r.cluster === 'product')
  const recipeResults = showAllRecipes
    ? allRecipeResults.slice(0, EXPANDED_PER_CLUSTER)
    : allRecipeResults.slice(0, INITIAL_PER_CLUSTER)
  const productResults = showAllProducts
    ? allProductResults.slice(0, EXPANDED_PER_CLUSTER)
    : allProductResults.slice(0, INITIAL_PER_CLUSTER)
  const displayedTotal = recipeResults.length + productResults.length

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Header onSearch={handleNewSearch} defaultQuery={q} />

      <div className="mx-auto max-w-screen-2xl px-6 sm:px-8 lg:px-16 py-8">
        {/* -- Page header -- */}
        <div className="flex items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text)]">
              Results for{' '}
              <span className="text-[var(--color-text-muted)] font-normal">&ldquo;{q}&rdquo;</span>
            </h1>
            {response && !loading && (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Showing {displayedTotal} of {response.total} result{response.total !== 1 ? 's' : ''}
                {filters.cluster === 'all' && displayedTotal > 0 && (
                  <> &mdash; {recipeResults.length} recipes, {productResults.length} products</>
                )}
              </p>
            )}
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors duration-150',
              showFilters
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            <SlidersHorizontal size={15} />
            Filters
          </button>
        </div>

        {/* -- Collapsible filter bar -- */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              key="filter-bar"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-6"
            >
              <FilterPanel
                filters={filters}
                availableHealthTags={response?.health_tags_available ?? []}
                onChange={handleFilterChange}
                onClose={() => setShowFilters(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* -- Loading -- */}
        {loading && <SkeletonLoader />}

        {/* -- Error -- */}
        {error && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center"
          >
            <p className="text-base font-medium text-[var(--color-text)] mb-2">Search failed</p>
            <p className="text-sm text-[var(--color-text-muted)] mb-6 max-w-sm mx-auto">{error}</p>
            <button
              onClick={() => runSearch(q, filters)}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-5 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <RotateCcw size={14} />
              Retry
            </button>
          </motion.div>
        )}

        {/* -- Empty state -- */}
        {!loading && !error && response && response.total === 0 && (
          <EmptyState query={q} />
        )}

        {/* -- Results -- */}
        {!loading && !error && (recipeResults.length > 0 || productResults.length > 0) && (
          <>
            {/* Recipes */}
            {recipeResults.length > 0 && (
              <div>
                <SectionHeading label="Recipes" count={allRecipeResults.length} />
                <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">
                  {recipeResults.map((result, i) => (
                    <SearchResultCard
                      key={result.id}
                      result={result}
                      index={i}
                      onChat={handleOpenChat}
                      onInteractionChange={handleCardInteraction}
                    />
                  ))}
                </div>
                {!showAllRecipes && allRecipeResults.length > INITIAL_PER_CLUSTER && (
                  <div className="flex justify-center mt-6">
                    <button
                      onClick={() => setShowAllRecipes(true)}
                      className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-2.5 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/50 transition-colors"
                    >
                      See more recipes ({allRecipeResults.length - INITIAL_PER_CLUSTER} more)
                    </button>
                  </div>
                )}
                {showAllRecipes && allRecipeResults.length > INITIAL_PER_CLUSTER && (
                  <div className="flex justify-center mt-6">
                    <button
                      onClick={() => setShowAllRecipes(false)}
                      className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-2.5 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/50 transition-colors"
                    >
                      Show fewer recipes
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Products */}
            {productResults.length > 0 && (
              <div>
                <SectionHeading label="Products" count={allProductResults.length} />
                <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">
                  {productResults.map((result, i) => (
                    <SearchResultCard
                      key={result.id}
                      result={result}
                      index={i}
                      onChat={handleOpenChat}
                      onInteractionChange={handleCardInteraction}
                    />
                  ))}
                </div>
                {!showAllProducts && allProductResults.length > INITIAL_PER_CLUSTER && (
                  <div className="flex justify-center mt-6">
                    <button
                      onClick={() => setShowAllProducts(true)}
                      className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-2.5 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/50 transition-colors"
                    >
                      See more products ({allProductResults.length - INITIAL_PER_CLUSTER} more)
                    </button>
                  </div>
                )}
                {showAllProducts && allProductResults.length > INITIAL_PER_CLUSTER && (
                  <div className="flex justify-center mt-6">
                    <button
                      onClick={() => setShowAllProducts(false)}
                      className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-2.5 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/50 transition-colors"
                    >
                      Show fewer products
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
