import { Moon, Sun } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTheme } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()

  return (
    <motion.button
      onClick={toggle}
      whileTap={{ scale: 0.9 }}
      className={cn(
        'relative flex h-10 w-10 items-center justify-center rounded-full',
        'border border-[var(--color-border)] bg-[var(--color-surface)]',
        'transition-colors hover:bg-[var(--color-border)]',
        className,
      )}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      <motion.div
        initial={false}
        animate={{ rotate: theme === 'dark' ? 180 : 0 }}
        transition={{ duration: 0.4, ease: 'easeInOut' }}
      >
        {theme === 'light' ? (
          <Moon size={18} className="text-[var(--color-text)]" />
        ) : (
          <Sun size={18} className="text-[var(--color-text)]" />
        )}
      </motion.div>
    </motion.button>
  )
}
