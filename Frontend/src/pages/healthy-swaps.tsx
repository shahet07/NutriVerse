/**
 * Healthy Swaps page — AI-powered healthier alternative suggestions.
 * Route: /healthy-swaps
 *
 * User enters a dish, the system searches for it via the GraphRAG search
 * endpoint, then routes the dish + results to the LLM for swap analysis.
 */
import { useState, type FormEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, RotateCcw, AlertTriangle } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { cn } from '@/lib/utils'
import { searchQuery, processQuery } from '@/lib/api'
import type { SearchResult, ProcessResponse } from '@/lib/types'
import { ReportButton } from '@/components/ui/report-button'

interface SwapResult {
  loading: boolean
  searchResults: SearchResult[]
  llmResponse: string | null
  error: string | null
}

export default function HealthySwapsPage() {
  const [dish, setDish] = useState('')
  const [result, setResult] = useState<SwapResult>({
    loading: false,
    searchResults: [],
    llmResponse: null,
    error: null,
  })

  const canSubmit = dish.trim().length > 1 && !result.loading

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return

    const trimmed = dish.trim()
    setResult({ loading: true, searchResults: [], llmResponse: null, error: null })

    try {
      // Step 1: Search for the dish in the graph to get nutritional context
      const searchRes = await searchQuery(trimmed, { cluster: 'all', limit: 5 })
      const topResults = searchRes.results.slice(0, 5)

      // Step 2: Build a context-rich query for the LLM
      let contextBlock = ''
      if (topResults.length > 0) {
        const lines = topResults.map((r) => {
          if (r.cluster === 'recipe') {
            return `- ${r.name} (recipe): ${r.calories ?? '?'} kcal, ${r.protein ?? '?'}g protein, ${r.carbohydrates ?? '?'}g carbs, ${r.fats ?? '?'}g fat, ${r.fibre ?? '?'}g fibre`
          }
          return `- ${r.name} (product, ${r.brand ?? 'unknown brand'}): ${r.calories_100g ?? '?'} kcal/100g, ${r.proteins_100g ?? '?'}g protein, ${r.carbohydrates_100g ?? '?'}g carbs, ${r.fat_100g ?? '?'}g fat`
        })
        contextBlock = `\n\nHere are the nutritional profiles found in our database:\n${lines.join('\n')}`
      }

      const llmQuery = `Suggest healthy swaps and lighter alternatives for "${trimmed}". For each swap, explain why it is healthier with specific nutritional reasoning (lower calories, more fibre, less fat, etc.). Compare the original with each alternative.${contextBlock}`

      // Step 3: Send to the LLM via /process
      const llmRes: ProcessResponse = await processQuery(llmQuery)
      const llmText =
        'llm_response' in llmRes && llmRes.llm_response
          ? llmRes.llm_response
          : null

      setResult({
        loading: false,
        searchResults: topResults,
        llmResponse: llmText,
        error: llmText ? null : 'Could not generate swap suggestions. Please try again.',
      })
    } catch (err) {
      setResult({
        loading: false,
        searchResults: [],
        llmResponse: null,
        error: err instanceof Error ? err.message : 'Something went wrong.',
      })
    }
  }

  const handleReset = () => {
    setDish('')
    setResult({ loading: false, searchResults: [], llmResponse: null, error: null })
  }

  const hasResults = result.llmResponse || result.searchResults.length > 0

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-16 py-14">
        <div className="flex gap-12 xl:gap-16 items-start">
          {/* Left: form + results column */}
          <div className="flex-1 min-w-0">
            {/* Heading */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-10"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-green-500 mb-2">
                Healthy Swaps
              </p>
              <h1 className="text-3xl font-bold text-[var(--color-text)] mb-3">
                Find lighter alternatives
              </h1>
              <p className="text-sm text-[var(--color-text-muted)] max-w-lg leading-relaxed">
                Enter any dish and the AI will search our knowledge graph for its nutritional
                profile, then recommend healthier alternatives with a side-by-side breakdown.
              </p>
            </motion.div>

            {/* Input form */}
            <motion.form
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 mb-10"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={dish}
                  onChange={(e) => setDish(e.target.value)}
                  placeholder="Enter any dish... e.g. Biryani, Butter Chicken, Samosa"
                  className={cn(
                    'flex-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]',
                    'px-4 py-3 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)]',
                    'outline-none focus:border-green-500/50 transition-colors',
                  )}
                />
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={cn(
                    'shrink-0 flex h-11 w-11 items-center justify-center rounded-2xl transition-all',
                    canSubmit
                      ? 'bg-green-500 text-white hover:bg-green-600 shadow-lg shadow-green-500/20'
                      : 'bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed',
                  )}
                >
                  <ArrowRight size={16} />
                </button>
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  'inline-flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-all',
                  canSubmit
                    ? 'bg-green-500 text-white hover:bg-green-600 shadow-lg shadow-green-500/20'
                    : 'bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed',
                )}
              >
                Find Healthy Swaps
              </button>
            </motion.form>

            {/* Loading state */}
            <AnimatePresence>
              {result.loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center py-16"
                >
                  <div className="h-8 w-8 rounded-full border-2 border-green-500/30 border-t-green-500 animate-spin mb-4" />
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Searching database and generating swap suggestions...
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error state */}
            {result.error && !result.loading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center mb-8"
              >
                <p className="text-base font-medium text-[var(--color-text)] mb-2">
                  Could not generate suggestions
                </p>
                <p className="text-sm text-[var(--color-text-muted)] mb-4">{result.error}</p>
                <button
                  onClick={handleSubmit}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-5 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                  <RotateCcw size={14} />
                  Retry
                </button>
              </motion.div>
            )}

            {/* Results */}
            <AnimatePresence>
              {hasResults && !result.loading && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-8"
                >
                  {/* LLM swap analysis */}
                  {result.llmResponse && (
                    <div>
                      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                        <div className="px-6 py-4 border-b border-[var(--color-border)]">
                          <h2 className="text-xs font-semibold uppercase tracking-widest text-green-500">
                            Swap Suggestions for {dish}
                          </h2>
                        </div>
                        <div className="px-6 py-5 text-base leading-relaxed text-[var(--color-text)] whitespace-pre-line">
                          {formatLLMText(result.llmResponse)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2 px-1">
                        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                          <AlertTriangle size={9} strokeWidth={1.75} />
                          AI-generated — verify before acting on it
                        </span>
                        <ReportButton
                          query={dish}
                          responseType="healthy-swaps"
                          aiResponse={result.llmResponse}
                        />
                      </div>
                    </div>
                  )}

                  {/* Nutritional context cards */}
                  {result.searchResults.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-4">
                        Related items from our database
                      </h3>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {result.searchResults.map((r) => (
                          <div
                            key={r.id}
                            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
                          >
                            <h4 className="font-semibold text-[var(--color-text)] mb-1">{r.name}</h4>
                            <p className="text-xs text-[var(--color-text-muted)] mb-3">
                              {r.cluster === 'recipe' ? 'Recipe' : (r.brand ?? 'Product')}
                            </p>
                            <div className="space-y-1.5 text-sm">
                              {r.cluster === 'recipe' ? (
                                <>
                                  {r.calories != null && <NutrRow label="Calories" value={`${r.calories.toFixed(0)} kcal`} />}
                                  {r.protein != null && <NutrRow label="Protein" value={`${r.protein.toFixed(1)}g`} />}
                                  {r.carbohydrates != null && <NutrRow label="Carbs" value={`${r.carbohydrates.toFixed(1)}g`} />}
                                  {r.fats != null && <NutrRow label="Fat" value={`${r.fats.toFixed(1)}g`} />}
                                  {r.fibre != null && <NutrRow label="Fibre" value={`${r.fibre.toFixed(1)}g`} />}
                                </>
                              ) : (
                                <>
                                  {r.calories_100g != null && <NutrRow label="Calories/100g" value={`${r.calories_100g.toFixed(0)} kcal`} />}
                                  {r.proteins_100g != null && <NutrRow label="Protein/100g" value={`${r.proteins_100g.toFixed(1)}g`} />}
                                  {r.carbohydrates_100g != null && <NutrRow label="Carbs/100g" value={`${r.carbohydrates_100g.toFixed(1)}g`} />}
                                  {r.fat_100g != null && <NutrRow label="Fat/100g" value={`${r.fat_100g.toFixed(1)}g`} />}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* New search button */}
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={handleReset}
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-5 py-2.5 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-green-500/30 transition-colors"
                    >
                      <RotateCcw size={14} />
                      Try another dish
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right: desktop info panel */}
          <aside className="hidden xl:flex flex-col gap-5 w-80 flex-shrink-0 pt-16">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-green-500 mb-4">
                What makes a healthy swap?
              </h3>
              <ul className="space-y-2.5">
                {[
                  'Lower calorie density per serving',
                  'Higher fibre for better satiety',
                  'Reduced saturated fat',
                  'Lower glycaemic index',
                  'More micronutrients (iron, calcium, vitamins)',
                  'Less sodium and free sugars',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 bg-green-500 opacity-70" />
                    <span className="text-[var(--color-text-muted)] leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-4">
                Popular swaps
              </h3>
              <div className="space-y-2">
                {[
                  { from: 'White Rice', to: 'Brown Rice / Quinoa' },
                  { from: 'Puri', to: 'Chapati / Tandoori Roti' },
                  { from: 'Fried Samosa', to: 'Baked Samosa / Dhokla' },
                  { from: 'Gulab Jamun', to: 'Fruit Chaat' },
                  { from: 'Cream Curry', to: 'Tomato-based Curry' },
                ].map(({ from, to }) => (
                  <div key={from} className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--color-text-muted)]">{from}</span>
                    <span className="text-green-500">&rarr;</span>
                    <span className="font-medium text-[var(--color-text)]">{to}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}

/* ── Helper: format LLM text with basic markdown ── */
function formatLLMText(text: string) {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    const headerMatch = line.match(/^\*\*(.+?)\*\*$/)
    if (headerMatch) {
      return (
        <h4 key={i} className="font-semibold text-[var(--color-text)] mt-4 mb-1 text-base uppercase tracking-wider">
          {headerMatch[1]}
        </h4>
      )
    }
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      return (
        <div key={i} className="flex gap-2 ml-1 my-0.5">
          <span className="text-[var(--color-text-muted)] mt-0.5">&middot;</span>
          <span
            dangerouslySetInnerHTML={{
              __html: line.trim().replace(/^[-*]\s*/, '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'),
            }}
          />
        </div>
      )
    }
    if (line.trim()) {
      return (
        <p key={i} className="my-1" dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
      )
    }
    return <div key={i} className="h-2" />
  })
}

/* ── Helper: nutrition row ── */
function NutrRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="font-medium text-[var(--color-text)] tabular-nums">{value}</span>
    </div>
  )
}
