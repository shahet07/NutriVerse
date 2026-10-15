import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { configureAuthApi, loginWithFirebaseToken, refreshTokenPair } from '@/lib/api'
import {
  clearRefreshToken,
  getRefreshToken,
  isDesktopShell,
  onAuthSuccess,
  storeRefreshToken,
} from '@/lib/desktop-auth'
import { firebaseAuth } from '@/lib/firebase'

export interface AuthUser {
  name: string
  email: string
  uid?: string
  googleId?: string
}

interface AuthContextValue {
  user: AuthUser | null
  loginWithEmail: (email: string, password: string) => Promise<void>
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  logout: () => void
  loading: boolean
  isAuthenticated: boolean
  hasBackendSession: boolean
}

const STORAGE_KEY = 'nutrisense-user'

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

function parseJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function userFromJwt(token: string): AuthUser | null {
  const claims = parseJwtClaims(token)
  if (!claims) return null
  const email = typeof claims.email === 'string' ? claims.email : ''
  const name = typeof claims.name === 'string' && claims.name ? claims.name : email.split('@')[0]
  const uid = typeof claims.sub === 'string' ? claims.sub : undefined
  if (!email) return null
  return { email, name, uid }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Start null — Firebase will restore from cache via onAuthStateChanged
  const [user, setUser] = useState<AuthUser | null>(loadUser)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  // loading:true until Firebase fires its first auth state event
  const [loading, setLoading] = useState(true)
  const bootDone = useRef(false)
  const refreshInFlight = useRef<Promise<string | null> | null>(null)
  const backendSyncInFlight = useRef(false)
  // Keep latest refresh token in a ref so the extension sync handler can
  // re-broadcast without making a new API call.
  const latestRefreshToken = useRef<string | null>(null)

  const persistUser = useCallback((authUser: AuthUser | null) => {
    if (!authUser) {
      localStorage.removeItem(STORAGE_KEY)
      setUser(null)
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser))
      setUser(authUser)
    }
  }, [])

  const applyTokenPair = useCallback(async (pair: { access_token: string; refresh_token: string }) => {
    setAccessToken(pair.access_token)
    await storeRefreshToken(pair.refresh_token)
    latestRefreshToken.current = pair.refresh_token
    const parsed = userFromJwt(pair.access_token)
    if (parsed) persistUser(parsed)
    // Broadcast to Chrome extension content script (no-op if extension not installed)
    window.postMessage({
      type: 'NUTRISENSE_EXT_AUTH',
      refreshToken: pair.refresh_token,
      user: parsed,
    }, window.location.origin)
  }, [persistUser])

  const exchangeFirebaseToken = useCallback(async (idToken: string) => {
    const pair = await loginWithFirebaseToken(idToken)
    await applyTokenPair(pair)
  }, [applyTokenPair])

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current
    const runner = (async () => {
      try {
        const saved = await getRefreshToken()
        if (!saved) return null
        const pair = await refreshTokenPair(saved)
        await applyTokenPair(pair)
        return pair.access_token
      } catch {
        setAccessToken(null)
        await clearRefreshToken()
        return null
      }
    })()
    refreshInFlight.current = runner
    try {
      return await runner
    } finally {
      refreshInFlight.current = null
    }
  }, [applyTokenPair])

  // ── Primary session restorer: fires once fast from Firebase cache ──────────
  useEffect(() => {
    // Safety valve only for the pathological case where Firebase never fires at all.
    // In normal operation setLoading(false) is called synchronously inside the callback
    // (before the slow backend exchange), so this timer is a no-op.
    const safetyTimer = setTimeout(() => setLoading(false), 15_000)

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      // Only process the first event — subsequent ones are driven by explicit calls
      if (bootDone.current) return
      bootDone.current = true

      if (firebaseUser) {
        // Set user from Firebase identity immediately so the splash screen clears
        // without waiting for the backend (which may be cold-starting for 45s).
        const email = firebaseUser.email ?? ''
        const name = firebaseUser.displayName ?? email.split('@')[0]
        persistUser({ email, name, uid: firebaseUser.uid })
        setLoading(false)
        // Backend exchange runs in background; retryBackendSync handles failures.
        try {
          const idToken = await firebaseUser.getIdToken()
          await exchangeFirebaseToken(idToken)
        } catch {
          // Firebase identity already set; access token obtained via retryBackendSync
        }
      } else {
        persistUser(null)
        setAccessToken(null)
        setLoading(false)
        void clearRefreshToken()
      }
    })

    return () => {
      clearTimeout(safetyTimer)
      unsubscribe()
    }
  }, []) // intentional empty deps — runs once, refs/callbacks are stable

  // ── Deep-link listener for Electron Google auth callback ──────────────────
  useEffect(() => {
    const unsubscribe = onAuthSuccess(async (payload) => {
      if (!payload?.firebaseIdToken) return
      try {
        await exchangeFirebaseToken(payload.firebaseIdToken)
      } catch {
        // Silently ignore — user stays on current page
      }
    })
    return unsubscribe
  }, [exchangeFirebaseToken])

  // ── Expose Bearer token to api.ts fetch interceptor ───────────────────────
  useEffect(() => {
    configureAuthApi({ getAccessToken: () => accessToken, refreshAccessToken })
    return () => configureAuthApi(null)
  }, [accessToken, refreshAccessToken])

  // If Firebase session exists but backend token exchange previously failed
  // (for example backend was temporarily unavailable), auto-heal in background.
  useEffect(() => {
    if (loading || accessToken || backendSyncInFlight.current) return
    const fbUser = firebaseAuth.currentUser
    if (!fbUser) return

    backendSyncInFlight.current = true
    ;(async () => {
      try {
        const idToken = await fbUser.getIdToken()
        await exchangeFirebaseToken(idToken)
      } catch {
        // keep local Firebase session; we'll retry on focus/visibility
      } finally {
        backendSyncInFlight.current = false
      }
    })()
  }, [loading, accessToken, exchangeFirebaseToken])

  useEffect(() => {
    const retryBackendSync = async () => {
      if (loading || accessToken || backendSyncInFlight.current) return
      const fbUser = firebaseAuth.currentUser
      if (!fbUser) return

      backendSyncInFlight.current = true
      try {
        const idToken = await fbUser.getIdToken()
        await exchangeFirebaseToken(idToken)
      } catch {
        // no-op
      } finally {
        backendSyncInFlight.current = false
      }
    }

    const onFocus = () => {
      void retryBackendSync()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void retryBackendSync()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loading, accessToken, exchangeFirebaseToken])

  // ── Extension sync on connect ─────────────────────────────────────────────
  // When the NutriSense extension loads on this page it fires a custom DOM
  // event. We re-broadcast the current session so the extension gets the token
  // without requiring the user to log in or out again.
  useEffect(() => {
    const handleExtConnected = () => {
      const rt = latestRefreshToken.current
      if (!rt || !user) return
      window.postMessage({
        type: 'NUTRISENSE_EXT_AUTH',
        refreshToken: rt,
        user,
      }, window.location.origin)
    }
    window.addEventListener('nutrisense-ext-connected', handleExtConnected)
    return () => window.removeEventListener('nutrisense-ext-connected', handleExtConnected)
  }, [user])

  // ── Public auth actions ────────────────────────────────────────────────────

  const loginWithEmail = useCallback(async (email: string, password: string) => {
    // Firebase auth errors (wrong password etc.) throw here and surface to the UI
    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password)
    const idToken = await credential.user.getIdToken(true)
    try {
      await exchangeFirebaseToken(idToken)
    } catch {
      // Backend unavailable — still sign in using confirmed Firebase identity
      const name = credential.user.displayName ?? email.split('@')[0]
      persistUser({ email, name, uid: credential.user.uid })
    }
  }, [exchangeFirebaseToken, persistUser])

  const registerWithEmail = useCallback(async (name: string, email: string, password: string) => {
    // Firebase auth errors (email in use, weak password) throw here
    const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password)
    const idToken = await credential.user.getIdToken(true)
    try {
      await exchangeFirebaseToken(idToken)
    } catch {
      // Backend unavailable — sign in with Firebase identity
    }
    // Caller-provided name takes priority over Firebase display name
    persistUser({ email, name, uid: credential.user.uid })
  }, [exchangeFirebaseToken, persistUser])

  const signInWithGoogle = useCallback(async () => {
    let fbUser
    if (isDesktopShell()) {
      const { idToken } = await window.desktopAuth!.googleSignIn()
      const credential = GoogleAuthProvider.credential(idToken)
      const result = await signInWithCredential(firebaseAuth, credential)
      fbUser = result.user
    } else {
      const provider = new GoogleAuthProvider()
      const result = await signInWithPopup(firebaseAuth, provider)
      fbUser = result.user
    }
    // Set user immediately from Firebase identity so navigation is instant.
    // Backend exchange runs in background — don't block on Azure cold-start latency.
    const email = fbUser.email ?? ''
    const name = fbUser.displayName ?? email.split('@')[0]
    persistUser({ email, name, uid: fbUser.uid, googleId: fbUser.uid })
    backendSyncInFlight.current = true
    void (async () => {
      try {
        const idToken = await fbUser.getIdToken(true)
        await exchangeFirebaseToken(idToken)
      } catch {
        // retryBackendSync will pick it up on next focus / visibility change
      } finally {
        backendSyncInFlight.current = false
      }
    })()
  }, [exchangeFirebaseToken, persistUser])

  const logout = useCallback(() => {
    void signOut(firebaseAuth).catch(() => undefined)
    setAccessToken(null)
    persistUser(null)
    void clearRefreshToken().catch(() => undefined)
    // Do not reset bootDone — logout state is handled here directly, not via onAuthStateChanged
    window.postMessage({ type: 'NUTRISENSE_EXT_AUTH', refreshToken: null, user: null }, window.location.origin)
  }, [persistUser])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loginWithEmail,
    registerWithEmail,
    signInWithGoogle,
    logout,
    loading,
    isAuthenticated: !!user,
    hasBackendSession: !!accessToken,
  }), [user, loginWithEmail, registerWithEmail, signInWithGoogle, logout, loading, accessToken])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function useLogout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  return useCallback(() => {
    logout()
    navigate('/login')
  }, [logout, navigate])
}
