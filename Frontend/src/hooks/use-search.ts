import { useState, useCallback } from 'react'
import { processQuery } from '@/lib/api'
import type { ProcessResponse } from '@/lib/types'

interface SearchState {
  loading: boolean
  result: ProcessResponse | null
  error: string | null
  imagePreview: string | null
}

export function useSearch() {
  const [state, setState] = useState<SearchState>({
    loading: false,
    result: null,
    error: null,
    imagePreview: null,
  })

  const search = useCallback(async (query?: string, image?: File) => {
    setState({
      loading: true,
      result: null,
      error: null,
      imagePreview: image ? URL.createObjectURL(image) : null,
    })

    try {
      const result = await processQuery(query, image)
      setState((s) => ({ ...s, loading: false, result }))
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }))
    }
  }, [])

  const reset = useCallback(() => {
    setState({ loading: false, result: null, error: null, imagePreview: null })
  }, [])

  return { ...state, search, reset }
}
