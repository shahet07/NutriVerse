import { motion } from 'framer-motion'
import { formatLLMText } from './nutrition-card'
import type { ComparisonResponse, NutritionData } from '@/lib/types'
import { cn } from '@/lib/utils'

const SKIP_KEYS = new Set(['recipe_name', 'name', 'estimated values', 'estimated_values'])

function getNutritionEntries(nutrition: NutritionData | null | undefined) {
  if (!nutrition) return []
  return Object.entries(nutrition).filter(
    ([key, value]) =>
      !SKIP_KEYS.has(key.toLowerCase()) &&
      value !== null &&
      value !== undefined &&
      value !== '',
  )
}

function NutritionTable({ nutrition }: { nutrition: NutritionData }) {
  const entries = getNutritionEntries(nutrition)
  if (entries.length === 0) return null
  return (
    <div className="mt-5 rounded-xl border border-[var(--color-border)] overflow-hidden text-sm">
      {entries.map(([key, value], i) => (
        <div
          key={key}
          className={cn(
            'flex items-center justify-between px-4 py-2.5',
            i % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-bg)]',
          )}
        >
          <span className="text-[var(--color-text-muted)]">{key}</span>
          <span className="font-medium text-[var(--color-text)] tabular-nums">{String(value)}</span>
        </div>
      ))}
    </div>
  )
}

interface DishCardProps {
  name: string | null | undefined
  nutrition: NutritionData | null | undefined
  accuracy: number | undefined
  estimated: boolean | undefined
}

function DishCard({ name, nutrition, accuracy, estimated }: DishCardProps) {
  const hasNutrition = getNutritionEntries(nutrition).length > 0

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="font-serif text-2xl font-bold text-[var(--color-text)] tracking-tight leading-tight">
        {name ?? 'Unknown dish'}
      </h2>
      <div className="flex flex-wrap gap-2 mt-3">
        {accuracy != null && accuracy > 0 && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide bg-[var(--color-accent)] text-[var(--color-accent-contrast)]">
            {Math.round(accuracy)}% Accuracy
          </span>
        )}
        {estimated && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide border border-[var(--color-border)] text-[var(--color-text-muted)]">
            Estimated
          </span>
        )}
      </div>
      {hasNutrition && <NutritionTable nutrition={nutrition!} />}
    </div>
  )
}

interface ComparisonViewProps {
  data: ComparisonResponse
  className?: string
}

export function ComparisonView({ data, className }: ComparisonViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className={cn('w-full', className)}
    >
      {/* VS Header */}
      <div className="flex items-center justify-center gap-4 mb-8">
        <span className="font-serif text-xl font-bold text-[var(--color-text)] tracking-tight text-right flex-1 min-w-0">
          {data.dish_a ?? 'Dish A'}
        </span>
        <span className="flex shrink-0 items-center justify-center w-10 h-10 rounded-full border border-[var(--color-border)] text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
          vs
        </span>
        <span className="font-serif text-xl font-bold text-[var(--color-text)] tracking-tight flex-1 min-w-0">
          {data.dish_b ?? 'Dish B'}
        </span>
      </div>

      {/* Side-by-side dish cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <DishCard
          name={data.dish_a}
          nutrition={data.nutrition_a}
          accuracy={data.accuracy}
          estimated={data.estimated}
        />
        <DishCard
          name={data.dish_b}
          nutrition={data.nutrition_b}
          accuracy={data.accuracy}
          estimated={data.estimated}
        />
      </div>

      {/* LLM Analysis */}
      {data.llm_response && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="mt-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
        >
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-4">
            Comparison Analysis
          </h3>
          <div className="text-sm leading-relaxed text-[var(--color-text)]">
            {formatLLMText(data.llm_response)}
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
