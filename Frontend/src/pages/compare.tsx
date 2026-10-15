/**
 * Compare Dishes page — side-by-side nutritional comparison.
 * Route: /compare
 *
 * Accepts two food inputs (each can be a recipe or a product name),
 * then submits "A vs B" to the AI for comparison analysis.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeftRight, ArrowRight } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { cn } from '@/lib/utils'

type FoodType = 'Recipe' | 'Product'

interface FoodInput {
  value: string
  type: FoodType
}

const QUICK_EXAMPLES = [
  ['Butter Chicken', 'Paneer Tikka'],
  ['Samosa', 'Dhokla'],
  ['White Rice', 'Brown Rice'],
  ['Masala Dosa', 'Plain Dosa'],
]

export default function ComparePage() {
  const navigate = useNavigate()
  const [foodA, setFoodA] = useState<FoodInput>({ value: '', type: 'Recipe' })
  const [foodB, setFoodB] = useState<FoodInput>({ value: '', type: 'Recipe' })

  const canSubmit = foodA.value.trim().length > 1 && foodB.value.trim().length > 1

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return
    const query = `Compare ${foodA.value.trim()} vs ${foodB.value.trim()}`
    navigate('/results', { state: { query } })
  }

  const applyExample = (a: string, b: string) => {
    setFoodA((p) => ({ ...p, value: a }))
    setFoodB((p) => ({ ...p, value: b }))
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-16 py-14">
        <div className="flex gap-12 xl:gap-16 items-start">
          {/* Left: form column */}
          <div className="flex-1 min-w-0">
            {/* Heading */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-10"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)] mb-2">
                Compare Dishes
              </p>
              <h1 className="text-3xl font-bold text-[var(--color-text)] mb-3">
                Side-by-side nutrition
              </h1>
              <p className="text-sm text-[var(--color-text-muted)] max-w-lg leading-relaxed">
                Enter any two dishes, recipes, or packaged products to get a
                detailed nutritional comparison with an AI recommendation.
              </p>
            </motion.div>

            {/* Quick examples */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mb-8 flex flex-wrap gap-2"
            >
              {QUICK_EXAMPLES.map(([a, b]) => (
                <button
                  key={`${a}-${b}`}
                  onClick={() => applyExample(a, b)}
                  className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/50 hover:text-[var(--color-text)] transition-colors"
                >
                  {a} vs {b}
                </button>
              ))}
            </motion.div>

            {/* Two food inputs */}
            <motion.form
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
            >
              {/* Food inputs row */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
                <FoodInputCard
                  label="First food"
                  placeholder="e.g. Butter Chicken"
                  value={foodA.value}
                  foodType={foodA.type}
                  onChange={(v) => setFoodA((p) => ({ ...p, value: v }))}
                  onTypeChange={(t) => setFoodA((p) => ({ ...p, type: t }))}
                />

                {/* VS badge */}
                <div className="flex items-end justify-center pb-1">
                  <div className="flex h-11 w-11 flex-col items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]">
                    <ArrowLeftRight size={13} className="text-[var(--color-accent)]" />
                    <span className="text-[9px] font-bold tracking-widest text-[var(--color-text-muted)] mt-0.5">VS</span>
                  </div>
                </div>

                <FoodInputCard
                  label="Second food"
                  placeholder="e.g. Paneer Tikka"
                  value={foodB.value}
                  foodType={foodB.type}
                  onChange={(v) => setFoodB((p) => ({ ...p, value: v }))}
                  onTypeChange={(t) => setFoodB((p) => ({ ...p, type: t }))}
                />
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
                Compare
                <ArrowRight size={15} />
              </button>
            </motion.form>
          </div>

          {/* Right: desktop info panel */}
          <aside className="hidden xl:flex flex-col gap-5 w-80 flex-shrink-0 pt-16">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)] mb-4">How it works</h3>
              <ol className="space-y-4">
                {[
                  { step: '01', text: 'Enter any two dishes, recipes, or packaged products' },
                  { step: '02', text: 'AI fetches nutritional data from the knowledge graph' },
                  { step: '03', text: 'Get a side-by-side breakdown with a health recommendation' },
                ].map(({ step, text }) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <span className="font-bold text-[var(--color-accent)] flex-shrink-0">{step}</span>
                    <span className="text-[var(--color-text-muted)] leading-relaxed">{text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">Tip</h3>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                If a dish isn&apos;t in the database, the AI will estimate its nutrition from training knowledge and clearly mark it as estimated.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}

/* ── Food input card with type selector ── */

function FoodInputCard({
  label,
  placeholder,
  value,
  foodType,
  onChange,
  onTypeChange,
}: {
  label: string
  placeholder: string
  value: string
  foodType: FoodType
  onChange: (v: string) => void
  onTypeChange: (t: FoodType) => void
}) {
  const types: FoodType[] = ['Recipe', 'Product']

  return (
    <div className="flex flex-col gap-2">
      {/* Label + type toggle row */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
          {label}
        </label>
        <div className="flex rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)]">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTypeChange(t)}
              className={cn(
                'px-3 py-1 text-xs font-medium transition-all duration-150',
                t === foodType
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-2xl border bg-[var(--color-surface)]',
          'px-4 py-4 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)]',
          'outline-none transition-colors duration-150',
          'border-[var(--color-border)] focus:border-[var(--color-accent)]/60',
        )}
      />
    </div>
  )
}
