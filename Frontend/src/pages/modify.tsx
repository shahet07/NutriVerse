import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { cn } from '@/lib/utils'

const PRESET_CONSTRAINTS = [
  'low-calorie',
  'gluten-free',
  'vegan',
  'high-protein',
  'low-carb',
  'no dairy',
  'diabetic-friendly',
  'low-sodium',
]

const QUICK_EXAMPLES = [
  'Butter chicken vegan',
  'Biryani low calorie',
  'Samosa baked gluten-free',
  'Make dal makhani high protein',
  'Gulab Jamun sugar-free',
  'Palak paneer without dairy',
]

export default function ModifyPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const canSubmit = query.trim().length > 2

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return
    navigate('/results', { state: { query: query.trim() } })
  }

  const applyExample = (example: string) => {
    setQuery(example)
  }

  const applyPreset = (preset: string) => {
    setQuery((prev) => {
      const trimmed = prev.trim()
      if (!trimmed) return preset
      if (trimmed.includes(preset)) return trimmed.replace(preset, '').trim()
      return `${trimmed} ${preset}`
    })
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-16 py-14">
        <div className="flex gap-12 xl:gap-16 items-start">
          {/* ── Left: form column ── */}
          <div className="flex-1 min-w-0">

            {/* Heading */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-10"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)] mb-2">
                Modify Recipe
              </p>
              <h1 className="text-3xl font-bold text-[var(--color-text)] mb-3">
                Adapt to your needs
              </h1>
              <p className="text-sm text-[var(--color-text-muted)] max-w-lg leading-relaxed">
                Describe the dish and how you want it modified — the AI rewrites
                ingredients, method, and recalculates nutrition.
              </p>
            </motion.div>

            {/* Quick examples */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mb-8 flex flex-wrap gap-2"
            >
              {QUICK_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => applyExample(ex)}
                  className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/50 hover:text-[var(--color-text)] transition-colors"
                >
                  {ex}
                </button>
              ))}
            </motion.div>

            {/* Form */}
            <motion.form
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
            >
              {/* Single input card */}
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Your request
                  </label>
                  <textarea
                    rows={3}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSubmit()
                      }
                    }}
                    placeholder="e.g. Biryani low calorie, Make butter chicken vegan, Samosa without gluten…"
                    className={cn(
                      'w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]',
                      'px-4 py-3.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)]',
                      'outline-none focus:border-[var(--color-accent)]/60 transition-colors duration-150 leading-relaxed',
                    )}
                  />
                </div>

                {/* Preset chips */}
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[var(--color-text-muted)] opacity-70">Add a constraint:</p>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_CONSTRAINTS.map((p) => {
                      const active = query.includes(p)
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => applyPreset(p)}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150',
                            active
                              ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/50 hover:text-[var(--color-text)]',
                          )}
                        >
                          {p}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  'mt-2 w-full inline-flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-semibold transition-all duration-200',
                  canSubmit
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:opacity-90 shadow-lg shadow-[var(--color-accent)]/25 active:scale-[0.98]'
                    : 'bg-[var(--color-border)] text-[var(--color-text-muted)] cursor-not-allowed opacity-50',
                )}
              >
                <Sparkles size={15} />
                Modify with AI
                <ArrowRight size={15} />
              </button>
            </motion.form>
          </div>

          {/* ── Right: desktop info panel ── */}
          <aside className="hidden xl:flex flex-col gap-5 w-80 flex-shrink-0 pt-16">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)] mb-4">How it works</h3>
              <ol className="space-y-4">
                {[
                  { step: '01', text: 'Type a dish name followed by your dietary goal' },
                  { step: '02', text: 'AI fetches the original recipe from the knowledge graph' },
                  { step: '03', text: 'Ingredients, method, and nutrition are rewritten to match' },
                ].map(({ step, text }) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <span className="font-bold text-[var(--color-accent)] flex-shrink-0">{step}</span>
                    <span className="text-[var(--color-text-muted)] leading-relaxed">{text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)] mb-4">What AI can modify</h3>
              <ul className="space-y-2.5">
                {[
                  'Swap high-calorie ingredients',
                  'Adjust cooking method (bake vs fry)',
                  'Convert to vegan or vegetarian',
                  'Remove allergens like gluten or dairy',
                  'Increase protein content',
                  'Reduce sodium for heart health',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 bg-[var(--color-accent)] opacity-70" />
                    <span className="text-[var(--color-text-muted)] leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">Tip</h3>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                Type the dish first, then the constraint — e.g. &ldquo;Biryani low calorie&rdquo;. You can stack multiple constraints like &ldquo;vegan gluten-free&rdquo;.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
