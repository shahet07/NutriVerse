import { useState, useCallback, useRef } from 'react'
import { searchQuery } from '@/lib/api'
import type { SearchResponse, SearchFilters } from '@/lib/types'

interface SemanticSearchState {
  loading: boolean
  response: SearchResponse | null
  error: string | null
  lastQuery: string
}

export function useSemanticSearch() {
  const [state, setState] = useState<SemanticSearchState>({
    loading: false,
    response: null,
    error: null,
    lastQuery: '',
  })
  // Debounce / cancel ref
  const abortRef = useRef<AbortController | null>(null)

  const search = useCallback(async (q: string, filters: Partial<SearchFilters> = {}) => {
    if (!q.trim()) return

    // Cancel previous in-flight request
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setState({ loading: true, response: null, error: null, lastQuery: q })

    try {
      const response = await searchQuery(q, filters)
      setState({ loading: false, response, error: null, lastQuery: q })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Search failed',
      }))
    }
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setState({ loading: false, response: null, error: null, lastQuery: '' })
  }, [])

  return { ...state, search, reset }
}
