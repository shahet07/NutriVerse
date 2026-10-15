import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  size?: 'sm' | 'lg' | 'xl'
  alwaysWhite?: boolean
}

export function Logo({ className, size = 'lg', alwaysWhite = false }: LogoProps) {
  const color = alwaysWhite ? '#FFFFFF' : 'var(--color-text)'
  return (
    <div className={cn('select-none', className)}>
      <h1
        className={cn(
          'font-serif font-bold tracking-tight',
          size === 'xl' ? 'text-6xl md:text-7xl lg:text-8xl' :
          size === 'lg' ? 'text-5xl md:text-6xl' : 'text-xl',
        )}
        style={{ lineHeight: 1.05, color }}
      >
        <span
          className={cn(
            'font-black italic',
            size === 'xl' ? 'text-8xl md:text-9xl lg:text-[10rem]' :
            size === 'lg' ? 'text-7xl md:text-8xl' : 'text-3xl',
          )}
          style={{ fontFeatureSettings: '"swsh" 1' }}
        >
          N
        </span>
        utri
        <span className="font-light">Verse</span>
      </h1>
    </div>
  )
}
