import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { NutritionData } from '@/lib/types'

interface NutritionCardProps {
  dishName?: string | null
  nutrition?: NutritionData | null
  ingredients?: string | null
  instructions?: string | null
  llmResponse?: string | null
  confidence?: number
  accuracy?: number
  source?: string | null
  estimated?: boolean
  constraint?: string | null
  servingSizeG?: number | null
  prepTimeMins?: number | null
  className?: string
}

function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode
  variant?: 'default' | 'outline'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide',
        variant === 'default'
          ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
          : 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
      )}
    >
      {children}
    </span>
  )
}

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
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-[var(--color-bg)] transition-colors"
      >
        <span className="text-base font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          {title}
        </span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={16} className="text-[var(--color-text-muted)]" />
        </motion.div>
      </button>
      <motion.div
        initial={false}
        animate={{
          height: open ? 'auto' : 0,
          opacity: open ? 1 : 0,
        }}
        transition={{ duration: 0.25, ease: 'easeInOut' }}
        className="overflow-hidden"
      >
        <div className="px-6 pb-5 text-base text-[var(--color-text)] leading-relaxed whitespace-pre-line">
          {children}
        </div>
      </motion.div>
    </div>
  )
}

const PLACEHOLDER_PATTERNS = [
  /^not available/i,
  /^see (estimated )?details below/i,
  /^see below/i,
  /^n\/a$/i,
  /^estimated dish$/i,
  /^unknown$/i,
  /^-$/,
]

function isPlaceholder(val: string | null | undefined): boolean {
  if (!val || val.trim() === '') return true
  const v = val.trim()
  return PLACEHOLDER_PATTERNS.some((p) => p.test(v))
}

export function formatLLMText(text: string) {
  // Convert **bold** to styled spans, bullets to list items
  const lines = text.split('\n')
  return lines.map((line, i) => {
    // Bold headers
    const headerMatch = line.match(/^\*\*(.+?)\*\*$/)
    if (headerMatch) {
      return (
        <h4 key={i} className="font-semibold text-[var(--color-text)] mt-4 mb-1 text-base uppercase tracking-wider">
          {headerMatch[1]}
        </h4>
      )
    }

    // Bullet points
    if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
      return (
        <div key={i} className="flex gap-2 ml-1 my-0.5">
          <span className="text-[var(--color-text-muted)] mt-0.5">·</span>
          <span
            dangerouslySetInnerHTML={{
              __html: line
                .trim()
                .replace(/^[-•]\s*/, '')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'),
            }}
          />
        </div>
      )
    }

    // Regular text with inline bold
    if (line.trim()) {
      return (
        <p
          key={i}
          className="my-1"
          dangerouslySetInnerHTML={{
            __html: line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'),
          }}
        />
      )
    }

    return <div key={i} className="h-2" />
  })
}

export function NutritionCard({
  dishName,
  nutrition,
  ingredients,
  instructions,
  llmResponse,
  confidence,
  accuracy,
  estimated,
  constraint,
  servingSizeG,
  prepTimeMins,
  className,
}: NutritionCardProps) {
  const SKIP_KEYS = new Set(['recipe_name', 'name', 'estimated values', 'estimated_values'])
  const nutritionEntries = nutrition
    ? Object.entries(nutrition).filter(
        ([key, value]) =>
          !SKIP_KEYS.has(key.toLowerCase()) &&
          value !== null &&
          value !== undefined &&
          value !== '' &&
          (typeof value !== 'string' || !isPlaceholder(value)),
      )
    : []

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={cn(
        'rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden',
        className,
      )}
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        {dishName && (
          <h2 className="font-serif text-3xl font-bold text-[var(--color-text)] tracking-tight">
            {dishName}
          </h2>
        )}
        {constraint && (
          <p className="mt-1.5 text-base text-[var(--color-text-muted)]">
            Modified · <span className="italic">{constraint}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {confidence != null && confidence > 0 && (
            <Badge>{Math.round(confidence * 100)}% Confidence</Badge>
          )}
          {accuracy != null && accuracy > 0 && (
            <Badge>{Math.round(accuracy)}% Accuracy</Badge>
          )}
          {estimated && <Badge variant="outline">Estimated</Badge>}
          {servingSizeG != null && (
            <Badge variant="outline">{Math.round(servingSizeG)} g serving</Badge>
          )}
          {prepTimeMins != null && prepTimeMins > 0 && (
            <Badge variant="outline">{prepTimeMins} min</Badge>
          )}
        </div>
      </div>

      {/* Nutrition table */}
      {nutritionEntries.length > 0 ? (
        <div className="border-t border-[var(--color-border)]">
          {nutritionEntries.map(([key, value], i) => (
            <div
              key={key}
              className={cn(
                'flex items-center justify-between px-6 py-3',
                i % 2 === 0
                  ? 'bg-[var(--color-surface)]'
                  : 'bg-[var(--color-bg)]',
              )}
            >
              <span className="text-base text-[var(--color-text-muted)]">{key}</span>
              <span className="text-base font-medium text-[var(--color-text)] tabular-nums">
                {value !== null && value !== undefined ? String(value) : '—'}
              </span>
            </div>
          ))}
        </div>
      ) : (
        !ingredients && !instructions && !llmResponse && (
          <div className="border-t border-[var(--color-border)] px-6 py-5">
            <p className="text-sm text-[var(--color-text-muted)]">
              No nutritional data available for this item.
            </p>
          </div>
        )
      )}

      {/* Ingredients */}
      {!isPlaceholder(ingredients) && (
        <CollapsibleSection title="Ingredients" defaultOpen>
          {ingredients}
        </CollapsibleSection>
      )}

      {/* Instructions */}
      {!isPlaceholder(instructions) && (
        <CollapsibleSection title="Instructions">
          {instructions}
        </CollapsibleSection>
      )}

      {/* LLM Analysis */}
      {llmResponse && (
        <CollapsibleSection title="Analysis">
          <div className="text-base leading-relaxed text-[var(--color-text)]">
            {formatLLMText(llmResponse)}
          </div>
        </CollapsibleSection>
      )}
    </motion.div>
  )
}
