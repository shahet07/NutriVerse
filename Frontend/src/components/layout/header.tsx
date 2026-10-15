import { useNavigate, useLocation } from 'react-router-dom'
import { Menu, ArrowLeft, Home } from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { SearchBar } from '@/components/ui/search-bar'
import { useSidebar } from '@/hooks/use-sidebar'
import { cn } from '@/lib/utils'

interface HeaderProps {
  onSearch?: (query: string, image?: File) => void
  defaultQuery?: string
  className?: string
}

export function Header({ onSearch, defaultQuery = '', className }: HeaderProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { openSidebar } = useSidebar()

  const isHome = location.pathname === '/'

  const handleSearch = (query: string, image?: File) => {
    if (onSearch) {
      onSearch(query, image)
    } else if (image) {
      navigate('/results', { state: { query, image } })
    } else {
      navigate(`/search?q=${encodeURIComponent(query)}`)
    }
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b border-[var(--color-border)]',
        'bg-[var(--color-surface)]/80 backdrop-blur-xl',
        className,
      )}
    >
      <div className="mx-auto flex h-16 items-center gap-4 px-6 sm:px-8">

        {/* Hamburger — opens the sidebar drawer */}
        <button
          onClick={openSidebar}
          aria-label="Open navigation"
          className={cn(
            'flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-lg',
            'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            'hover:bg-[var(--color-bg)] transition-colors duration-150',
          )}
        >
          <Menu size={20} strokeWidth={1.75} />
        </button>

        {/* Back button — visible on all non-home pages */}
        {!isHome && (
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className={cn(
              'flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-lg',
              'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              'hover:bg-[var(--color-bg)] transition-colors duration-150',
            )}
          >
            <ArrowLeft size={18} strokeWidth={1.75} />
          </button>
        )}

        {/* Home button — visible on all non-home pages */}
        {!isHome && (
          <button
            onClick={() => navigate('/')}
            aria-label="Go home"
            className={cn(
              'flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-lg',
              'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              'hover:bg-[var(--color-bg)] transition-colors duration-150',
            )}
          >
            <Home size={18} strokeWidth={1.75} />
          </button>
        )}

        {/* Logo — click to go home */}
        <button
          onClick={() => navigate('/')}
          className="flex-shrink-0 focus:outline-none"
          aria-label="Home"
        >
          <Logo size="sm" />
        </button>

        {/* Visual divider */}
        <div className="h-5 w-px bg-[var(--color-border)] flex-shrink-0" />

        {/* Search bar */}
        <div className="flex-1">
          <SearchBar
            compact
            onSearch={handleSearch}
            defaultValue={defaultQuery}
            placeholder="Search any dish..."
          />
        </div>

      </div>
    </header>
  )
}
