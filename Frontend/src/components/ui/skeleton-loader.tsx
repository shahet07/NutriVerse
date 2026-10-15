import { cn } from '@/lib/utils'

export function SkeletonLoader({ className }: { className?: string }) {
  return (
    <div className={cn('w-full max-w-4xl mx-auto space-y-6 animate-fade-in', className)}>
      {/* Title skeleton */}
      <div className="space-y-3">
        <div className="h-8 w-48 rounded-lg bg-[var(--color-border)] animate-pulse-subtle" />
        <div className="h-4 w-32 rounded bg-[var(--color-border)] animate-pulse-subtle" />
      </div>

      {/* Nutrition table skeleton */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center justify-between px-6 py-3.5',
              i % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-bg)]',
            )}
          >
            <div className="h-4 w-24 rounded bg-[var(--color-border)] animate-pulse-subtle" />
            <div className="h-4 w-16 rounded bg-[var(--color-border)] animate-pulse-subtle" />
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="space-y-3">
        <div className="h-4 w-full rounded bg-[var(--color-border)] animate-pulse-subtle" />
        <div className="h-4 w-5/6 rounded bg-[var(--color-border)] animate-pulse-subtle" />
        <div className="h-4 w-4/6 rounded bg-[var(--color-border)] animate-pulse-subtle" />
      </div>
    </div>
  )
}
