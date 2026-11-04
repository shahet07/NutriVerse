import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

function getFirebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  }
}

function initFirebaseApp(): FirebaseApp {
  const existing = getApps()
  if (existing.length > 0) return existing[0]
  return initializeApp(getFirebaseConfig())
}

/**
 * getAuth() throws on an empty API key, which would blank the whole app, so
 * Firebase only starts when configured. Without it, use-auth.tsx falls back to
 * the backend's local-development sign-in.
 */
export const firebaseAuth: Auth | null = getFirebaseConfig().apiKey
  ? getAuth(initFirebaseApp())
  : null

export const isLocalAuthMode = firebaseAuth === null
