import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Sun,
  Moon,
  Leaf,
  AlertTriangle,
  Shield,
  LogOut,
  LogIn,
  UserPlus,
  Check,
  Info,
  Flag,
  ImagePlus,
  Send,
  X,
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { useTheme } from '@/hooks/use-theme'
import { usePreferences } from '@/hooks/use-preferences'
import { useAuth, useLogout } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { reportIssueWithImage } from '@/lib/api'

// ─── types ───────────────────────────────────────────────────────────────────
type DietTag = { id: string; label: string; description: string }
type AllergenTag = { id: string; label: string }

// ─── data ─────────────────────────────────────────────────────────────────────
const DIET_TAGS: DietTag[] = [
  { id: 'vegetarian',       label: 'Vegetarian',       description: 'Exclude meat & seafood' },
  { id: 'vegan',            label: 'Vegan',             description: 'Exclude all animal products' },
  { id: 'gluten-free',      label: 'Gluten-Free',       description: 'Exclude wheat, barley, rye' },
  { id: 'diabetic-friendly',label: 'Diabetic Friendly', description: 'Low glycaemic index dishes' },
  { id: 'high-protein',     label: 'High Protein',      description: 'Prioritise protein-dense results' },
  { id: 'low-calorie',      label: 'Low Calorie',       description: 'Under 400 kcal per serving' },
  { id: 'heart-healthy',    label: 'Heart Healthy',     description: 'Low sodium & saturated fat' },
  { id: 'keto',             label: 'Keto',              description: 'Very low carbohydrate dishes' },
]

const ALLERGENS: AllergenTag[] = [
  { id: 'dairy',    label: 'Dairy' },
  { id: 'nuts',     label: 'Nuts' },
  { id: 'gluten',   label: 'Gluten' },
  { id: 'soy',      label: 'Soy' },
  { id: 'eggs',     label: 'Eggs' },
  { id: 'shellfish',label: 'Shellfish' },
  { id: 'sesame',   label: 'Sesame' },
  { id: 'mustard',  label: 'Mustard' },
]


const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.055, duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  }),
}

// ─── reusable components ──────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)] px-1">
        {title}
      </p>
      <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden divide-y divide-[var(--color-border)]">
        {children}
      </div>
    </section>
  )
}

function Row({
  icon: Icon, label, description, right, onClick, danger,
}: {
  icon: React.FC<{ size?: number; className?: string; strokeWidth?: number }>
  label: string
  description?: string
  right?: React.ReactNode
  onClick?: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'w-full flex items-center gap-4 px-4 py-3.5 text-left',
        onClick
          ? danger
            ? 'hover:bg-red-500/5 transition-colors duration-150'
            : 'hover:bg-[var(--color-bg)] transition-colors duration-150'
          : 'cursor-default',
      )}
    >
      <Icon
        size={16} strokeWidth={1.75}
        className={cn('flex-shrink-0', danger ? 'text-red-500/70' : 'text-[var(--color-text-muted)]')}
      />
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium', danger ? 'text-red-500' : 'text-[var(--color-text)]')}>{label}</p>
        {description && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-snug">{description}</p>
        )}
      </div>
      {right}
    </button>
  )
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className={cn(
        'relative h-6 w-11 rounded-full border transition-colors duration-200 flex-shrink-0',
        on
          ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
          : 'bg-[var(--color-bg)] border-[var(--color-border)]',
      )}
      aria-label="Toggle"
    >
      <span className={cn(
        'absolute top-0.5 left-0.5 h-5 w-5 rounded-full transition-transform duration-200',
        'bg-[var(--color-accent-contrast)] shadow-sm',
        on ? 'translate-x-5' : 'translate-x-0',
      )} />
    </button>
  )
}

// ─── report modal ─────────────────────────────────────────────────────────────
function ReportModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be under 2 MB.')
      return
    }
    setImage(file)
    setPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setStatus('sending')
    try {
      await reportIssueWithImage({ description: text.trim(), response_type: 'settings', image })
      setStatus('done')
      setTimeout(onClose, 1800)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Flag size={15} strokeWidth={1.75} className="text-[var(--color-text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Report an issue</h3>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe the issue — wrong nutrition values, inaccurate dish info, bad formatting…"
            rows={4}
            maxLength={2000}
            className={cn(
              'w-full resize-none rounded-xl border border-[var(--color-border)]',
              'bg-[var(--color-bg)] px-4 py-3 text-sm text-[var(--color-text)]',
              'placeholder:text-[var(--color-text-muted)] outline-none',
              'focus:border-[var(--color-accent)]/50 transition-colors duration-150',
            )}
          />

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />

          {preview ? (
            <div className="relative w-full rounded-xl overflow-hidden border border-[var(--color-border)]">
              <img src={preview} alt="Attached screenshot" className="w-full max-h-48 object-contain bg-[var(--color-bg)]" />
              <button
                type="button"
                onClick={() => { setImage(null); setPreview(null); if (fileRef.current) fileRef.current.value = '' }}
                className="absolute top-2 right-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                'w-full flex items-center justify-center gap-2 rounded-xl border border-dashed',
                'border-[var(--color-border)] py-3 text-xs text-[var(--color-text-muted)]',
                'hover:border-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors duration-150',
              )}
            >
              <ImagePlus size={13} strokeWidth={1.75} />
              Attach a screenshot (optional, max 2 MB)
            </button>
          )}

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-text-muted)]">{text.length}/2000</span>
            <button
              type="submit"
              disabled={!text.trim() || status === 'sending' || status === 'done'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all duration-150',
                status === 'done'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                  : 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              {status === 'done' ? (
                <><Check size={11} strokeWidth={2} /> Submitted</>
              ) : status === 'sending' ? (
                <span className="h-3 w-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <><Send size={11} strokeWidth={1.75} /> Submit</>
              )}
            </button>
          </div>
          {status === 'error' && (
            <p className="text-[11px] text-red-400">Failed to submit — please try again.</p>
          )}
        </form>
      </div>
    </div>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const navigate = useNavigate()
  const { theme, toggle: toggleTheme } = useTheme()
  const { user, isAuthenticated } = useAuth()
  const logout = useLogout()
  const { prefs, setActiveDiets, setExcludeAllergens } = usePreferences()
  const [reportOpen, setReportOpen] = useState(false)

  const activeDiets     = new Set(prefs.activeDiets)
  const activeAllergens = new Set(prefs.excludeAllergens)

  const toggleDiet = (id: string) => {
    const next = new Set(activeDiets)
    next.has(id) ? next.delete(id) : next.add(id)
    setActiveDiets([...next])
  }

  const toggleAllergen = (id: string) => {
    const next = new Set(activeAllergens)
    next.has(id) ? next.delete(id) : next.add(id)
    setExcludeAllergens([...next])
  }

  // Avatar initials helper
  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Header />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-7">

        {/* ── Profile card ── */}
        <motion.div variants={fadeUp} custom={0} initial="hidden" animate="show">
          <div className="rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] px-5 py-5">
            {isAuthenticated && user ? (
              /* Logged-in profile */
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full
                  bg-[var(--color-accent)] text-[var(--color-accent-contrast)]
                  text-lg font-bold select-none">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-[var(--color-text)] truncate">{user.name}</p>
                  <p className="text-sm text-[var(--color-text-muted)] mt-0.5 truncate">{user.email}</p>
                  {user.googleId && (
                    <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-[var(--color-text-muted)]
                      bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-0.5 rounded-full">
                      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Connected with Google
                    </span>
                  )}
                </div>
              </div>
            ) : (
              /* Guest profile */
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full
                  bg-[var(--color-bg)] border-2 border-dashed border-[var(--color-border)]
                  text-[var(--color-text-muted)] text-lg font-bold select-none">
                  ?
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-[var(--color-text)]">Guest</p>
                  <p className="text-sm text-[var(--color-text-muted)] mt-0.5 leading-snug">
                    Sign in to save preferences, get personalised suggestions, and access your history across devices.
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => navigate('/login')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium
                      bg-[var(--color-accent)] text-[var(--color-accent-contrast)]
                      hover:opacity-90 transition-opacity"
                  >
                    <LogIn size={14} strokeWidth={2} />
                    Sign in
                  </button>
                  <button
                    onClick={() => navigate('/register')}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium
                      border border-[var(--color-border)] text-[var(--color-text)]
                      hover:bg-[var(--color-bg)] transition-colors"
                  >
                    <UserPlus size={14} strokeWidth={2} />
                    Register
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Dietary Preferences ── */}
        <motion.div variants={fadeUp} custom={1} initial="hidden" animate="show">
          <Section title="Dietary Preferences">
            <div className="px-4 py-4">
              <p className="text-xs text-[var(--color-text-muted)] mb-3 leading-relaxed">
                Select the diets that apply to you. Search results and meal suggestions will be filtered to match.
              </p>
              <div className="flex flex-wrap gap-2">
                {DIET_TAGS.map((tag) => {
                  const active = activeDiets.has(tag.id)
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleDiet(tag.id)}
                      title={tag.description}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150',
                        active
                          ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)] border-[var(--color-accent)]'
                          : 'bg-[var(--color-bg)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-text-muted)]',
                      )}
                    >
                      {active && <Check size={10} strokeWidth={2.5} />}
                      <Leaf size={10} strokeWidth={1.75} />
                      {tag.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </Section>
        </motion.div>

        {/* ── Allergen Alerts ── */}
        <motion.div variants={fadeUp} custom={2} initial="hidden" animate="show">
          <Section title="Allergen Alerts">
            <div className="px-4 py-4">
              <p className="text-xs text-[var(--color-text-muted)] mb-3 leading-relaxed">
                Mark your allergens below. Any dish containing them will be automatically excluded from your results.
              </p>
              <div className="flex flex-wrap gap-2">
                {ALLERGENS.map((allergen) => {
                  const active = activeAllergens.has(allergen.id)
                  return (
                    <button
                      key={allergen.id}
                      onClick={() => toggleAllergen(allergen.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150',
                        active
                          ? 'bg-red-500/10 text-red-500 border-red-500/30 dark:text-red-400 dark:border-red-400/30'
                          : 'bg-[var(--color-bg)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-text-muted)]',
                      )}
                    >
                      {active && <AlertTriangle size={10} strokeWidth={2.5} />}
                      {allergen.label}
                    </button>
                  )
                })}
              </div>
              {activeAllergens.size > 0 && (
                <motion.p
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="mt-3 text-[11px] text-red-500 dark:text-red-400 flex items-center gap-1.5"
                >
                  <AlertTriangle size={11} strokeWidth={2} />
                  {activeAllergens.size} allergen{activeAllergens.size > 1 ? 's' : ''} selected — these will never appear in your results.
                </motion.p>
              )}
            </div>
          </Section>
        </motion.div>

        {/* ── Appearance & Notifications ── */}
        <motion.div variants={fadeUp} custom={3} initial="hidden" animate="show">
          <Section title="Preferences">
            <Row
              icon={theme === 'dark' ? Moon : Sun}
              label="Theme"
              description={theme === 'dark' ? 'Dark mode' : 'Light mode'}
              onClick={toggleTheme}
              right={
                <div className="flex items-center gap-2">
                  <Sun size={12} className="text-[var(--color-text-muted)]" />
                  <Toggle on={theme === 'dark'} onToggle={toggleTheme} />
                  <Moon size={12} className="text-[var(--color-text-muted)]" />
                </div>
              }
            />
          </Section>
        </motion.div>

        {/* ── Feedback ── */}
        <motion.div variants={fadeUp} custom={4} initial="hidden" animate="show">
          <Section title="Feedback">
            <Row
              icon={Flag}
              label="Report an issue"
              description="Something look wrong? Describe it and attach a screenshot."
              onClick={() => setReportOpen(true)}
            />
          </Section>
        </motion.div>

        {/* ── App info ── */}
        <motion.div variants={fadeUp} custom={5} initial="hidden" animate="show">
          <Section title="App Info">
            <Row
              icon={Info}
              label="NutriVerse"
              description="Version 1.0 · Indian Nutrition Intelligence · Free to use"
            />
            <Row
              icon={Shield}
              label="Your privacy"
              description="View our Privacy Policy — what we collect and how we use it"
              onClick={() => navigate('/privacy')}
            />
          </Section>
        </motion.div>

        {/* ── Account / Data ── */}
        <motion.div variants={fadeUp} custom={6} initial="hidden" animate="show">
          <Section title="Account">
            {isAuthenticated ? (
              <Row
                icon={LogOut}
                label="Sign out"
                description="You can sign back in at any time"
                onClick={logout}
                danger
              />
            ) : (
              <Row
                icon={LogIn}
                label="Sign in"
                description="Sync your preferences and history across devices"
                onClick={() => navigate('/login')}
              />
            )}
          </Section>
        </motion.div>

        <div className="pb-8" />
      </main>

      {reportOpen && <ReportModal onClose={() => setReportOpen(false)} />}
    </div>
  )
}
