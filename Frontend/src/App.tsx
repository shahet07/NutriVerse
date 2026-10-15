import { useState, useEffect, useRef } from 'react'
import { Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from './hooks/use-auth'
import LoadingScreen from './pages/loading'
import Home from './pages/home'
import Results from './pages/results'
import SearchPage from './pages/search'
import ProductChatPage from './pages/product-chat'
import ImagePage from './pages/image'
import ComparePage from './pages/compare'
import ModifyPage from './pages/modify'
import HealthySwapsPage from './pages/healthy-swaps'
import ChefPage from './pages/chef'
import ChefRemotePage from './pages/chef-remote'
import KitchenPage from './pages/kitchen'
import Profile from './pages/profile'
import Settings from './pages/settings'
import LoginPage from './pages/login'
import RegisterPage from './pages/register'
import PrivacyPage from './pages/privacy'
import { Sidebar } from './components/layout/sidebar'
import { TitleBar } from './components/layout/title-bar'

// No splash + no forced login redirect for these routes
const AUTH_ROUTES = ['/login', '/register', '/privacy']
// Only redirect authenticated users AWAY from these (not from /privacy which is always public)
const AUTHED_REDIRECT_ROUTES = ['/login', '/register']

function App() {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  const [minSplashDone, setMinSplashDone] = useState(false)
  const [postAuthSplash, setPostAuthSplash] = useState(false)
  const prevAuth = useRef(isAuthenticated)

  useEffect(() => {
    const timer = setTimeout(() => setMinSplashDone(true), 3000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!prevAuth.current && isAuthenticated) {
      setPostAuthSplash(true)
      const timer = setTimeout(() => setPostAuthSplash(false), 3000)
      prevAuth.current = isAuthenticated
      return () => clearTimeout(timer)
    }
    prevAuth.current = isAuthenticated
  }, [isAuthenticated])

  const path = location.pathname.replace(/\/+$/, '') || '/'

  // ── Chef Remote: completely separate flow, no auth ──
  // Phone scans QR → splash for 3s → chef-remote UI. Zero auth dependency.
  if (path.startsWith('/chef-remote')) {
    return (
      <div className="flex flex-col h-screen">
        <TitleBar />
        <div className="flex-1 overflow-y-auto relative">
          <AnimatePresence>
            {!minSplashDone && <LoadingScreen />}
          </AnimatePresence>
          <ChefRemotePage />
        </div>
      </div>
    )
  }

  // ── PC / main app flow ──
  const isAuthPage = AUTH_ROUTES.includes(path)
  const authReady = !loading
  const showSplash = !isAuthPage && (!minSplashDone || !authReady || postAuthSplash)

  if (!showSplash && !isAuthenticated && !isAuthPage) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // /privacy is public — authenticated users can visit it (e.g. from Settings).
  // Only redirect away from strict auth-only pages (login, register).
  if (!showSplash && isAuthenticated && AUTHED_REDIRECT_ROUTES.includes(path)) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex flex-col h-screen">
      <TitleBar />
      <div className="flex-1 overflow-y-auto relative">
        <AnimatePresence>
          {showSplash && <LoadingScreen />}
        </AnimatePresence>

        {!isAuthPage && <Sidebar />}

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/results" element={<Results />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/product-chat" element={<ProductChatPage />} />
          <Route path="/image" element={<ImagePage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/modify" element={<ModifyPage />} />
          <Route path="/healthy-swaps" element={<HealthySwapsPage />} />
          <Route path="/chef" element={<ChefPage />} />
          <Route path="/chef-remote" element={<ChefRemotePage />} />
          <Route path="/kitchen" element={<KitchenPage />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/privacy" element={<PrivacyPage />} />
        </Routes>
      </div>
    </div>
  )
}

export default App
