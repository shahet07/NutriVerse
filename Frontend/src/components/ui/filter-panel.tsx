/**
 * FilterPanel — sidebar panel for GraphRAG search filters.
 * Controls: cluster toggle, health tag pills, allergen exclusion pills.
 */
import { motion, AnimatePresence } from 'framer-motion'
import { ChefHat, Package, Globe, Check, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchFilters } from '@/lib/types'

/* ── Allergens (static, matching the graph's AllergenTag nodes) ─── */
const ALLERGENS = [
  { id: 'Dairy', label: 'Dairy' },
  { id: 'Nuts', label: 'Nuts' },
  { id: 'Gluten', label: 'Gluten' },
  { id: 'Soy', label: 'Soy' },
  { id: 'Eggs', label: 'Eggs' },
  { id: 'Shellfish', label: 'Shellfish' },
  { id: 'Sesame', label: 'Sesame' },
]

const CLUSTER_OPTIONS = [
  { id: 'all', label: 'All', icon: Globe },
  { id: 'recipe', label: 'Recipes', icon: ChefHat },
  { id: 'product', label: 'Products', icon: Package },
] as const

interface FilterPanelProps {
  filters: SearchFilters
  availableHealthTags: string[]
  onChange: (filters: SearchFilters) => void
  /** Call to collapse on mobile */
  onClose?: () => void
  className?: string
}

/* ── Small toggle pill ───────────────────────────────────────────── */
function Pill({
  label,
  active,
  onToggle,
}: {
  label: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150',
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
          : 'border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/50 hover:text-[var(--color-text)]',
      )}
    >
      {label}
      {active && <Check size={10} className="shrink-0" />}
    </button>
  )
}

export function FilterPanel({
  filters,
  availableHealthTags,
  onChange,
  onClose,
  className,
}: FilterPanelProps) {
  /* ── helpers ── */
  const setCluster = (cluster: SearchFilters['cluster']) =>
    onChange({ ...filters, cluster })

  const toggleHealthTag = (tag: string) => {
    const next = filters.healthTags.includes(tag)
      ? filters.healthTags.filter((t) => t !== tag)
      : [...filters.healthTags, tag]
    onChange({ ...filters, healthTags: next })
  }

  const toggleAllergen = (id: string) => {
    const next = filters.excludeAllergens.includes(id)
      ? filters.excludeAllergens.filter((a) => a !== id)
      : [...filters.excludeAllergens, id]
    onChange({ ...filters, excludeAllergens: next })
  }

  const hasActiveFilters =
    filters.healthTags.length > 0 ||
    filters.excludeAllergens.length > 0 ||
    filters.cluster !== 'all'

  const clearAll = () =>
    onChange({ cluster: 'all', healthTags: [], excludeAllergens: [], limit: filters.limit })

  return (
    <div
      className={cn(
        'flex flex-col gap-6 rounded-2xl border border-[var(--color-border)]',
        'bg-[var(--color-surface)] p-5',
        className,
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <SlidersHorizontal size={15} />
          Filters
        </div>
        <div className="flex items-center gap-2">
          <AnimatePresence>
            {hasActiveFilters && (
              <motion.button
                key="clear"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                onClick={clearAll}
                className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                Clear all
              </motion.button>
            )}
          </AnimatePresence>
          {onClose && (
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-[var(--color-bg)] text-[var(--color-text-muted)] transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Cluster ── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Food cluster
        </p>
        <div className="flex gap-2">
          {CLUSTER_OPTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setCluster(id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition-all duration-150',
                filters.cluster === id
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text)]',
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Health Tags ── */}
      {availableHealthTags.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Health goals
          </p>
          <div className="flex flex-wrap gap-2">
            {availableHealthTags.map((tag) => (
              <Pill
                key={tag}
                label={tag}
                active={filters.healthTags.includes(tag)}
                onToggle={() => toggleHealthTag(tag)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Allergen exclusion ── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Exclude allergens
        </p>
        <div className="flex flex-wrap gap-2">
          {ALLERGENS.map(({ id, label }) => (
            <Pill
              key={id}
              label={label}
              active={filters.excludeAllergens.includes(id)}
              onToggle={() => toggleAllergen(id)}
            />
          ))}
        </div>
        {filters.excludeAllergens.length > 0 && (
          <p className="mt-2 text-xs text-[var(--color-text-muted)] leading-relaxed">
            Results containing {filters.excludeAllergens.join(', ')} will be hidden.
          </p>
        )}
      </div>
    </div>
  )
}
