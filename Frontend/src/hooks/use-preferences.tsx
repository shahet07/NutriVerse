/**
 * usePreferences — persists user dietary preferences + allergen exclusions
 * to localStorage. Used by both Settings page (write) and Search page (read).
 *
 * Storage key: "nutrisense-preferences"
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

export interface UserPreferences {
  /** Health tag IDs to always auto-apply as search filters */
  activeDiets: string[]
  /** Allergen IDs to always exclude from results */
  excludeAllergens: string[]
}

const DEFAULT_PREFS: UserPreferences = {
  activeDiets: [],
  excludeAllergens: [],
}

const STORAGE_KEY = 'nutrisense-preferences'

function loadPrefs(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<UserPreferences>
    return {
      activeDiets: parsed.activeDiets ?? [],
      excludeAllergens: parsed.excludeAllergens ?? [],
    }
  } catch {
    return DEFAULT_PREFS
  }
}

interface PreferencesCtx {
  prefs: UserPreferences
  setActiveDiets: (ids: string[]) => void
  setExcludeAllergens: (ids: string[]) => void
  clearAll: () => void
}

const PreferencesContext = createContext<PreferencesCtx>({
  prefs: DEFAULT_PREFS,
  setActiveDiets: () => {},
  setExcludeAllergens: () => {},
  clearAll: () => {},
})

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(loadPrefs)

  // Persist whenever prefs change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  }, [prefs])

  const setActiveDiets = useCallback((ids: string[]) => {
    setPrefs((p) => ({ ...p, activeDiets: ids }))
  }, [])

  const setExcludeAllergens = useCallback((ids: string[]) => {
    setPrefs((p) => ({ ...p, excludeAllergens: ids }))
  }, [])

  const clearAll = useCallback(() => {
    setPrefs(DEFAULT_PREFS)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <PreferencesContext.Provider value={{ prefs, setActiveDiets, setExcludeAllergens, clearAll }}>
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences() {
  return useContext(PreferencesContext)
}
