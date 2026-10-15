import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Eye, EyeOff, ArrowRight, Check, AlertCircle } from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { useAuth } from '@/hooks/use-auth'
import landingBg from '@/assets/landing-bg.png'

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
})

const FIREBASE_ERRORS: Record<string, string> = {
  'auth/email-already-in-use': 'An account already exists with this email.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/popup-closed-by-user': 'Sign-up was cancelled.',
  'auth/cancelled-popup-request': 'Sign-up was cancelled.',
  'auth/popup-blocked': 'Pop-up was blocked. Please allow pop-ups for this site.',
  'auth/internal-error': 'Google sign-up failed. Please try again.',
}

function toFriendlyError(error: unknown): string {
  if (!(error instanceof Error)) return 'Registration failed. Please try again.'
  const code = (error as { code?: string }).code
  if (code && FIREBASE_ERRORS[code]) return FIREBASE_ERRORS[code]
  if (error.message.includes('Server error')) return 'Could not reach the server. Please try again.'
  return 'Registration failed. Please try again.'
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'Contains a number', met: /\d/.test(password) },
    { label: 'Contains uppercase', met: /[A-Z]/.test(password) },
  ]
  if (!password) return null
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="mt-2 space-y-1.5"
    >
      {checks.map((c) => (
        <div key={c.label} className="flex items-center gap-2">
          <div className={`h-3.5 w-3.5 rounded-full flex items-center justify-center transition-colors duration-300 ${
            c.met ? 'bg-white/80' : 'bg-white/10 border border-white/15'
          }`}>
            {c.met && <Check size={8} strokeWidth={3} className="text-black" />}
          </div>
          <span className={`text-[11px] font-sans transition-colors duration-300 ${c.met ? 'text-white/55' : 'text-white/20'}`}>
            {c.label}
          </span>
        </div>
      ))}
    </motion.div>
  )
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/'
  const { registerWithEmail, signInWithGoogle } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = () => setError(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!agreed) {
      setError('Please accept the terms to continue.')
      return
    }
    setIsLoading(true)
    try {
      await registerWithEmail(name, email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(toFriendlyError(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleRegister = async () => {
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
          <motion.div {...fadeUp(0.15)} className="mb-8">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.45em] text-white/30 mb-3">
              Get started
            </p>
            <h2 className="font-serif text-4xl font-bold text-white leading-tight tracking-tight">
              Create your<br />
              <span className="font-light italic">account</span>
            </h2>
            <p className="mt-3 text-sm text-white/35 font-sans leading-relaxed">
              Join NutriVerse and start your nutrition journey today.
            </p>
          </motion.div>

          {/* Error banner */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 flex items-start gap-2.5 px-4 py-3 rounded-xl
                bg-white/[0.04] border border-white/[0.10] text-sm text-white/60 font-sans"
            >
              <AlertCircle size={15} strokeWidth={1.75} className="flex-shrink-0 mt-0.5 text-white/35" />
              {error}
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <motion.div {...fadeUp(0.22)} className="space-y-1.5">
              <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.3em] text-white/40">
                Full name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); clearError() }}
                placeholder="Your name"
                required
                autoComplete="name"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3.5 text-sm
                  text-white placeholder:text-white/20 font-sans outline-none
                  focus:border-white/25 focus:bg-white/[0.07]
                  hover:border-white/14 hover:bg-white/[0.06]
                  transition-all duration-200"
              />
            </motion.div>

            <motion.div {...fadeUp(0.28)} className="space-y-1.5">
              <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.3em] text-white/40">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearError() }}
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

            <motion.div {...fadeUp(0.34)} className="space-y-1.5">
              <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.3em] text-white/40">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError() }}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
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
              <PasswordStrength password={password} />
            </motion.div>

            <motion.div {...fadeUp(0.40)} className="space-y-1.5">
              <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.3em] text-white/40">
                Confirm password
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); clearError() }}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3.5 pr-12 text-sm
                    text-white placeholder:text-white/20 font-sans outline-none
                    focus:border-white/25 focus:bg-white/[0.07]
                    hover:border-white/14 hover:bg-white/[0.06]
                    transition-all duration-200"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/25
                    hover:text-white/55 transition-colors duration-150"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
                </button>
              </div>
            </motion.div>

            {/* Terms */}
            <motion.div {...fadeUp(0.46)}>
              <label className="flex items-start gap-3 cursor-pointer group">
                <div
                  onClick={() => setAgreed(!agreed)}
                  className={`mt-0.5 flex-shrink-0 h-4 w-4 rounded flex items-center justify-center
                    border transition-all duration-200
                    ${agreed ? 'bg-white border-white' : 'bg-white/[0.04] border-white/15 group-hover:border-white/30'}`}
                >
                  {agreed && <Check size={9} strokeWidth={3} className="text-black" />}
                </div>
                <span className="text-[12px] text-white/30 font-sans leading-relaxed">
                  I agree to NutriVerse's{' '}
                  <Link
                    to="/privacy"
                    className="text-white/55 underline underline-offset-2 hover:text-white/80 transition-colors"
                  >
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link
                    to="/privacy"
                    className="text-white/55 underline underline-offset-2 hover:text-white/80 transition-colors"
                  >
                    Privacy Policy
                  </Link>
                </span>
              </label>
            </motion.div>

            <motion.div {...fadeUp(0.52)}>
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
                    Create account
                    <ArrowRight size={15} strokeWidth={2.25} />
                  </>
                )}
              </motion.button>
            </motion.div>
          </form>

          {/* Divider */}
          <motion.div {...fadeUp(0.58)} className="my-7 flex items-center gap-4">
            <div className="flex-1 h-px bg-white/[0.07]" />
            <span className="text-[11px] text-white/20 font-sans">or</span>
            <div className="flex-1 h-px bg-white/[0.07]" />
          </motion.div>

          {/* Google */}
          <motion.div {...fadeUp(0.62)}>
            <motion.button
              type="button"
              onClick={handleGoogleRegister}
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

          {/* Login link */}
          <motion.p {...fadeUp(0.70)} className="mt-7 text-center text-sm text-white/30 font-sans">
            Already have an account?{' '}
            <Link
              to="/login"
              className="text-white/65 hover:text-white transition-colors duration-150 font-medium"
            >
              Sign in
            </Link>
          </motion.p>
        </motion.div>

        {/* Bottom fine print */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.9 }}
          className="text-center space-y-1.5"
        >
          <p className="text-[11px] text-white/15 font-sans">
            NutriVerse — Intelligent nutrition analysis, powered by artificial intelligence.
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
            Your journey<br />
            <span className="font-light italic">starts here.</span>
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.7 }}
            className="mt-4 text-[13px] text-white/45 font-sans leading-relaxed max-w-[280px]"
          >
            Join thousands making smarter food decisions with AI-powered nutrition analysis.
          </motion.p>
        </div>
      </div>

    </div>
  )
}
