import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Home,
  Camera,
  ChefHat,
  GitCompare,
  Sliders,
  User,
  Settings,
  LogIn,
  LogOut,
  ChevronRight,
  Puzzle,
  Check,
  ExternalLink,
} from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { useSidebar } from '@/hooks/use-sidebar'
import { useAuth, useLogout } from '@/hooks/use-auth'
import { useExtension } from '@/hooks/use-extension'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  description: string
  icon: React.FC<{ size?: number; strokeWidth?: number; className?: string }>
  path: string
  badge?: string
}

const featureItems: NavItem[] = [
  {
    label: 'Home',
    description: 'Search, compare & explore dishes',
    icon: Home,
    path: '/',
  },
  {
    label: 'Image Analysis',
    description: 'Upload a photo — AI identifies the dish',
    icon: Camera,
    path: '/image',
  },
  {
    label: 'Compare Dishes',
    description: 'Side-by-side nutritional comparison',
    icon: GitCompare,
    path: '/compare',
  },
  {
    label: 'Modify Recipe',
    description: 'Adapt any recipe to your dietary needs',
    icon: Sliders,
    path: '/modify',
  },
  {
    label: 'AI Chef Mode',
    description: 'Interactive step-by-step cook mode with timers',
    icon: ChefHat,
    path: '/chef',
  },
]

const accountItems: NavItem[] = [
  {
    label: 'My Account',
    description: 'Profile, dietary preferences & app settings',
    icon: Settings,
    path: '/settings',
  },
]

export function Sidebar() {
  const { open, closeSidebar } = useSidebar()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isAuthenticated } = useAuth()
  const logout = useLogout()
  const { installed, storeUrl } = useExtension()

  const handleNav = (path: string) => {
    navigate(path)
    closeSidebar()
  }

  const handleLogout = () => {
    closeSidebar()
    logout()
  }

  const isActive = (item: NavItem) => {
    if (item.path === '/') {
      return location.pathname === '/' && item.label === 'Home'
    }
    return location.pathname === item.path
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={closeSidebar}
            aria-hidden="true"
          />

          {/* Drawer */}
          <motion.aside
            key="sidebar-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 38, mass: 0.9 }}
            className={cn(
              'fixed left-0 top-0 z-50 h-full w-96',
              'flex flex-col',
              'bg-[var(--color-surface)] border-r border-[var(--color-border)]',
              'shadow-2xl',
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-5 border-b border-[var(--color-border)]">
              <button onClick={() => handleNav('/')} aria-label="Home" className="focus:outline-none">
                <Logo size="sm" />
              </button>
              <button
                onClick={closeSidebar}
                aria-label="Close navigation"
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full',
                  'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
                  'hover:bg-[var(--color-bg)] transition-colors duration-150',
                )}
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>

            {/* Scrollable nav body */}
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">

              {/* ── Features ── */}
              <section>
                <p className="px-2 mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Features
                </p>
                <ul className="space-y-0.5">
                  {featureItems.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item)
                    return (
                      <li key={item.label}>
                        <button
                          onClick={() => handleNav(item.path)}
                          className={cn(
                            'w-full flex items-center gap-3.5 px-3 py-3 rounded-xl',
                            'text-left transition-colors duration-150',
                            active
                              ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                              : 'hover:bg-[var(--color-bg)] text-[var(--color-text)]',
                          )}
                        >
                          <Icon
                            size={18}
                            strokeWidth={1.75}
                            className={cn(
                              'flex-shrink-0',
                              active ? 'text-[var(--color-accent-contrast)]' : 'text-[var(--color-text-muted)]',
                            )}
                          />
                          <span className="flex items-center gap-2">
                            <span className="text-[15px] font-medium">{item.label}</span>
                            {item.badge && (
                              <span className={cn(
                                'text-[9px] font-semibold px-1.5 py-0.5 rounded-full tracking-wide',
                                active
                                  ? 'bg-[var(--color-accent-contrast)]/20 text-[var(--color-accent-contrast)]'
                                  : 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
                              )}>
                                {item.badge}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>

              {/* ── Chrome Extension ── */}
              <section>
                <p className="px-2 mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Extension
                </p>
                {installed ? (
                  <div className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-xl',
                    'bg-[var(--color-bg)] border border-[var(--color-border)]',
                  )}>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0
                      bg-emerald-500/10 border border-emerald-500/20">
                      <Check size={15} strokeWidth={2} className="text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[var(--color-text)] leading-none">
                        Extension installed
                      </p>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-none">
                        NutriVerse for Chrome
                      </p>
                    </div>
                  </div>
                ) : (
                  <a
                    href={storeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeSidebar}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3 rounded-xl w-full',
                      'bg-[var(--color-bg)] border border-[var(--color-border)]',
                      'hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/5',
                      'transition-colors duration-150 group',
                    )}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0
                      bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20">
                      <Puzzle size={15} strokeWidth={1.75} className="text-[var(--color-accent)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[var(--color-text)] leading-none">
                        Get the extension
                      </p>
                      <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-none">
                        NutriVerse for Chrome
                      </p>
                    </div>
                    <ExternalLink
                      size={13}
                      strokeWidth={1.75}
                      className="flex-shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors"
                    />
                  </a>
                )}
              </section>

              {/* ── Account ── */}
              <section>
                <p className="px-2 mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Account
                </p>
                <ul className="space-y-0.5">
                  {accountItems.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item)
                    return (
                      <li key={item.label}>
                        <button
                          onClick={() => handleNav(item.path)}
                          className={cn(
                            'w-full flex items-center gap-3.5 px-3 py-3 rounded-xl',
                            'text-left transition-colors duration-150',
                            active
                              ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]'
                              : 'hover:bg-[var(--color-bg)] text-[var(--color-text)]',
                          )}
                        >
                          <Icon
                            size={18}
                            strokeWidth={1.75}
                            className={cn(
                              'flex-shrink-0',
                              active ? 'text-[var(--color-accent-contrast)]' : 'text-[var(--color-text-muted)]',
                            )}
                          />
                          <span className="flex-1 text-[15px] font-medium">{item.label}</span>
                          <ChevronRight
                            size={14}
                            className={cn(
                              'flex-shrink-0 transition-colors',
                              active ? 'text-[var(--color-accent-contrast)]/60' : 'text-[var(--color-text-muted)]',
                            )}
                          />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            </nav>

            {/* Footer — user strip + theme */}
            <div className="border-t border-[var(--color-border)]">
              {isAuthenticated && user ? (
                /* Logged-in user strip */
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full
                    bg-[var(--color-accent)] text-[var(--color-accent-contrast)]
                    text-xs font-bold font-sans flex-shrink-0 select-none">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-[var(--color-text)] leading-none truncate">{user.name}</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-none truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    aria-label="Sign out"
                    title="Sign out"
                    className="flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0
                      text-[var(--color-text-muted)] hover:text-[var(--color-text)]
                      hover:bg-[var(--color-bg)] transition-colors duration-150"
                  >
                    <LogOut size={15} strokeWidth={1.75} />
                  </button>
                </div>
              ) : (
                /* Guest strip */
                <button
                  onClick={() => handleNav('/login')}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--color-bg)] transition-colors duration-150"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-bg)] border border-[var(--color-border)]">
                    <User size={15} className="text-[var(--color-text-muted)]" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-[var(--color-text)] leading-none">Guest User</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-none flex items-center gap-1">
                      <LogIn size={10} />
                      Sign in for personalisation
                    </p>
                  </div>
                  <ChevronRight size={14} className="text-[var(--color-text-muted)]" />
                </button>
              )}

              {/* Theme row */}
              <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">Appearance</span>
                <ThemeToggle />
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
