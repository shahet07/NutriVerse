import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, EyeOff, ArrowRight, AlertCircle, CheckCircle } from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { useAuth } from '@/hooks/use-auth'
import { firebaseAuth } from '@/lib/firebase'
import { sendPasswordResetEmail } from 'firebase/auth'
import landingBg from '@/assets/landing-bg.png'

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
})

const FIREBASE_ERRORS: Record<string, string> = {
  'auth/user-not-found': 'No account found with this email.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect password. Please try again.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/cancelled-popup-request': 'Sign-in was cancelled.',
  'auth/popup-blocked': 'Pop-up was blocked. Please allow pop-ups for this site.',
  'auth/internal-error': 'Google sign-in failed. Please try again.',
}

function toFriendlyError(error: unknown): string {
  if (!(error instanceof Error)) return 'Sign-in failed. Please try again.'
  const code = (error as { code?: string }).code
  if (code && FIREBASE_ERRORS[code]) return FIREBASE_ERRORS[code]
  if (error.message.includes('Server error')) return 'Could not reach the server. Please try again.'
  return 'Sign-in failed. Please try again.'
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/'
  const { loginWithEmail, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetMode, setResetMode] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      await loginWithEmail(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(toFriendlyError(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResetLoading(true)
    try {
      await sendPasswordResetEmail(firebaseAuth, resetEmail)
      setResetSent(true)
    } catch (err) {
      setError(toFriendlyError(err))
    } finally {
      setResetLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError(null)
    setGoogleLoading(true)
    try {
      await signInWithGoogle()
      navigate(from, { replace: true })
    } catch (err) {
      setError(toFriendlyError(err))
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-[#0A0A0A]">

      {/* ── Left panel — form ── */}
      <div className="flex-1 flex flex-col justify-between py-10 px-8 md:px-14 lg:px-20">

        <motion.div {...fadeUp(0)}>
          <Logo size="sm" alwaysWhite />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-full max-w-sm mx-auto"
        >
          {/* Heading */}
          <motion.div {...fadeUp(0.15)} className="mb-9">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.45em] text-white/30 mb-3">
              Welcome back
            </p>
            <h2 className="font-serif text-4xl font-bold text-white leading-tight tracking-tight">
              Sign in to<br />
              <span className="font-light italic">NutriVerse</span>
            </h2>
            <p className="mt-3 text-sm text-white/35 font-sans leading-relaxed">
              Your nutrition intelligence platform awaits.
            </p>
          </motion.div>

          {/* Error banner */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 flex items-start gap-2.5 px-4 py-3 rounded-xl
                bg-white/[0.04] border border-white/[0.10] text-sm text-white/60 font-sans"
            >
              <AlertCircle size={15} strokeWidth={1.75} className="flex-shrink-0 mt-0.5 text-white/35" />
              {error}
            </motion.div>
          )}

          {/* Forgot password panel */}
          {resetMode && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-5 rounded-xl bg-white/[0.03] border border-white/[0.08]"
            >
              {resetSent ? (
                <div className="flex items-start gap-3">
                  <CheckCircle size={16} strokeWidth={1.75} className="flex-shrink-0 mt-0.5 text-white/50" />
                  <div>
                    <p className="text-sm text-white/70 font-sans">Reset link sent to <span className="text-white/90">{resetEmail}</span>.</p>
                    <p className="text-xs text-white/35 font-sans mt-1">Check your inbox and follow the link to reset your password.</p>
                    <button
                      type="button"
                      onClick={() => { setResetMode(false); setResetSent(false); setResetEmail('') }}
                      className="mt-3 text-[11px] text-white/40 hover:text-white/70 font-sans transition-colors"
                    >
                      Back to sign in
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <p className="text-sm text-white/50 font-sans">Enter your email and we'll send a reset link.</p>
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm
                      text-white placeholder:text-white/20 font-sans outline-none
                      focus:border-white/25 transition-all duration-200"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={resetLoading}
                      className="flex-1 bg-white/10 hover:bg-white/15 border border-white/10 text-white/80
                        font-sans text-sm font-medium py-2.5 rounded-xl transition-all duration-200
                        disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {resetLoading ? <span className="inline-block h-4 w-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin mx-auto" /> : 'Send reset link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setResetMode(false); setError(null) }}
                      className="text-[11px] text-white/30 hover:text-white/60 font-sans transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <motion.div {...fadeUp(0.25)} className="space-y-1.5">
              <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.3em] text-white/40">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null) }}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3.5 text-sm
                  text-white placeholder:text-white/20 font-sans outline-none
                  focus:border-white/25 focus:bg-white/[0.07]
                  hover:border-white/14 hover:bg-white/[0.06]
                  transition-all duration-200"
              />
            </motion.div>

            <motion.div {...fadeUp(0.32)} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.3em] text-white/40">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => { setResetMode(true); setError(null) }}
                  className="text-[11px] text-white/30 hover:text-white/60 font-sans transition-colors duration-150"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null) }}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3.5 pr-12 text-sm
                    text-white placeholder:text-white/20 font-sans outline-none
                    focus:border-white/25 focus:bg-white/[0.07]
                    hover:border-white/14 hover:bg-white/[0.06]
                    transition-all duration-200"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/25
                    hover:text-white/55 transition-colors duration-150"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
                </button>
              </div>
            </motion.div>

            <motion.div {...fadeUp(0.40)}>
              <motion.button
                type="submit"
                disabled={isLoading || googleLoading}
                whileHover={{ scale: isLoading ? 1 : 1.01 }}
                whileTap={{ scale: isLoading ? 1 : 0.99 }}
                className="w-full mt-1 bg-white text-black font-sans font-semibold text-sm py-3.5 rounded-xl
                  hover:bg-white/92 transition-all duration-200
                  flex items-center justify-center gap-2
                  disabled:opacity-50 disabled:cursor-not-allowed
                  shadow-[0_1px_20px_rgba(255,255,255,0.08)]"
              >
                {isLoading ? (
                  <div className="h-4 w-4 border-2 border-black/25 border-t-black rounded-full animate-spin" />
                ) : (
                  <>
                    Sign in
                    <ArrowRight size={15} strokeWidth={2.25} />
                  </>
                )}
              </motion.button>
            </motion.div>
          </form>

          {/* Divider */}
          <motion.div {...fadeUp(0.48)} className="my-8 flex items-center gap-4">
            <div className="flex-1 h-px bg-white/[0.07]" />
            <span className="text-[11px] text-white/20 font-sans">or</span>
            <div className="flex-1 h-px bg-white/[0.07]" />
          </motion.div>

          {/* Google */}
          <motion.div {...fadeUp(0.52)}>
            <motion.button
              type="button"
              onClick={handleGoogleLogin}
              disabled={googleLoading || isLoading}
              whileHover={{ scale: googleLoading ? 1 : 1.01 }}
              whileTap={{ scale: googleLoading ? 1 : 0.99 }}
              className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-4 py-3.5
                text-sm text-white/80 font-sans font-medium
                hover:bg-white/[0.08] hover:border-white/20
                transition-all duration-200
                flex items-center justify-center gap-3
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {googleLoading ? (
                <div className="h-4 w-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Continue with Google
                </>
              )}
            </motion.button>
          </motion.div>

          {/* Register link */}
          <motion.p {...fadeUp(0.60)} className="mt-7 text-center text-sm text-white/30 font-sans">
            Don't have an account?{' '}
            <Link
              to="/register"
              className="text-white/65 hover:text-white transition-colors duration-150 font-medium"
            >
              Create one
            </Link>
          </motion.p>
        </motion.div>

        {/* Bottom fine print */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="text-center space-y-1.5"
        >
          <p className="text-[11px] text-white/15 font-sans">
            By continuing, you agree to NutriVerse's{' '}
            <Link to="/privacy" className="underline underline-offset-2 hover:text-white/35 transition-colors">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/privacy" className="underline underline-offset-2 hover:text-white/35 transition-colors">
              Privacy Policy
            </Link>
            .
          </p>
          <p className="text-[10px] text-white/10 font-sans">
            For educational purposes only. Not intended as medical advice.
          </p>
        </motion.div>
      </div>

      {/* ── Right panel — food imagery ── */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[55%] relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${landingBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0A] via-black/20 to-transparent" />
        <div className="absolute inset-0 bg-black/30" />
        <div className="absolute left-0 inset-y-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />

        <div className="relative z-10 flex flex-col justify-end p-14 pb-16">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="font-serif text-[2.6rem] font-bold text-white leading-[1.15] tracking-tight max-w-xs"
          >
            Understand<br />
            <span className="font-light italic">what you eat.</span>
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.7 }}
            className="mt-4 text-[13px] text-white/45 font-sans leading-relaxed max-w-[280px]"
          >
            Analyze nutrition, compare meals, and make smarter food choices — powered by AI.
          </motion.p>
        </div>
      </div>

    </div>
  )
}
