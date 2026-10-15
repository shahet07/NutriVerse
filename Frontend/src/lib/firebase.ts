import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

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

const firebaseApp = initFirebaseApp()
export const firebaseAuth = getAuth(firebaseApp)
