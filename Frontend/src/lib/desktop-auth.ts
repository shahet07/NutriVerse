import { isLocalAuthMode } from './firebase'

const LOCAL_REFRESH_KEY = 'nutrisense-local-refresh-token'

export interface DeepLinkAuthPayload {
  firebaseIdToken: string
}

type AuthSuccessHandler = (payload: DeepLinkAuthPayload) => void

declare global {
  interface Window {
    desktopAuth?: {
      googleSignIn: () => Promise<{ idToken: string }>
      openSystemBrowser: (url: string) => Promise<void>
      storeRefreshToken: (token: string) => Promise<void>
      getRefreshToken: () => Promise<string | null>
      clearRefreshToken: () => Promise<void>
      onAuthSuccess: (handler: AuthSuccessHandler) => () => void
    }
  }
}

export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && !!window.desktopAuth
}

export async function openSystemBrowser(url: string): Promise<void> {
  if (isDesktopShell()) {
    await window.desktopAuth!.openSystemBrowser(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function storeRefreshToken(token: string): Promise<void> {
  if (!isDesktopShell()) {
    if (isLocalAuthMode) localStorage.setItem(LOCAL_REFRESH_KEY, token)
    return
  }
  await window.desktopAuth!.storeRefreshToken(token)
}

export async function getRefreshToken(): Promise<string | null> {
  if (!isDesktopShell()) {
    return isLocalAuthMode ? localStorage.getItem(LOCAL_REFRESH_KEY) : null
  }
  return window.desktopAuth!.getRefreshToken()
}

export async function clearRefreshToken(): Promise<void> {
  if (!isDesktopShell()) {
    if (isLocalAuthMode) localStorage.removeItem(LOCAL_REFRESH_KEY)
    return
  }
  await window.desktopAuth!.clearRefreshToken()
}

export function onAuthSuccess(handler: AuthSuccessHandler): () => void {
  if (!isDesktopShell()) return () => undefined
  return window.desktopAuth!.onAuthSuccess(handler)
}
