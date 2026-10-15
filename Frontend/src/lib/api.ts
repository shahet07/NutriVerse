import type {
  ProcessResponse,
  SearchResponse,
  SearchFilters,
  ChatRequest,
  ChatResponseData,
  ChefParseRequest,
  ChefParseResponse,
  ChefIntentRequest,
  ChefIntentResponse,
  TokenPairResponse,
  RecommendationResponse,
  CookedResponse,
  FoodCardData,
  InteractionStatesResponse,
} from './types'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

// Header that tells ngrok to skip its browser interstitial page.
// Without this, API fetch() calls through an ngrok tunnel receive an HTML
// warning page instead of the expected JSON response.
const COMMON_HEADERS: Record<string, string> = {
  'ngrok-skip-browser-warning': '1',
}

interface AuthApiConfig {
  getAccessToken: () => string | null
  refreshAccessToken: () => Promise<string | null>
}

let authApiConfig: AuthApiConfig | null = null

export function configureAuthApi(config: AuthApiConfig | null): void {
  authApiConfig = config
}

interface ApiRequestOptions extends RequestInit {
  skipAuthRetry?: boolean
}

async function apiFetch(path: string, init: ApiRequestOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {})
  Object.entries(COMMON_HEADERS).forEach(([k, v]) => headers.set(k, v))

  const accessToken = authApiConfig?.getAccessToken() ?? null
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  const firstResponse = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })

  if (
    firstResponse.status !== 401 ||
    init.skipAuthRetry ||
    !authApiConfig?.refreshAccessToken
  ) {
    return firstResponse
  }

  const refreshedAccessToken = await authApiConfig.refreshAccessToken()
  if (!refreshedAccessToken) return firstResponse

  const retryHeaders = new Headers(init.headers ?? {})
  Object.entries(COMMON_HEADERS).forEach(([k, v]) => retryHeaders.set(k, v))
  retryHeaders.set('Authorization', `Bearer ${refreshedAccessToken}`)

  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: retryHeaders,
    skipAuthRetry: true,
  } as ApiRequestOptions)
}

async function readErrorAndThrow(res: Response): Promise<never> {
  const text = await res.text()
  throw new Error(`Server error ${res.status}: ${text}`)
}

// ── App config (exposes PUBLIC_URL set in backend .env) ──────────────────────
export interface AppConfig {
  /** Publicly reachable base URL of the server (e.g. ngrok or deployed domain). */
  remote_base_url: string
  /** "production" when PUBLIC_URL is set, "local" otherwise. */
  deployment: 'production' | 'local'
}

/**
 * Fetch runtime config from the backend.  Used by the P2P Kitchen Remote
 * feature to build the correct QR code URL when the app is behind ngrok or
 * deployed to a public host.
 *
 * Falls back gracefully — never throws; returns empty strings on error.
 */
export async function getAppConfig(): Promise<AppConfig> {
  try {
    const res = await apiFetch('/config')
    if (!res.ok) return { remote_base_url: '', deployment: 'local' }
    return res.json()
  } catch {
    return { remote_base_url: '', deployment: 'local' }
  }
}

export async function reportIssue(payload: {
  description: string
  query?: string
  response_type?: string
}): Promise<void> {
  const res = await apiFetch('/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) await readErrorAndThrow(res)
}

export async function reportIssueWithImage(payload: {
  description: string
  query?: string
  response_type?: string
  image?: File | null
}): Promise<void> {
  const form = new FormData()
  form.append('description', payload.description)
  if (payload.query) form.append('query', payload.query)
  if (payload.response_type) form.append('response_type', payload.response_type)
  if (payload.image) form.append('image', payload.image)
  const res = await apiFetch('/report/feedback', { method: 'POST', body: form })
  if (!res.ok) await readErrorAndThrow(res)
}

export async function processQuery(
  query?: string,
  image?: File,
): Promise<ProcessResponse> {
  const form = new FormData()
  if (query) form.append('query', query)
  if (image) form.append('image', image)

  const res = await apiFetch('/process', {
    method: 'POST',
    body: form,
  })

  if (!res.ok) await readErrorAndThrow(res)

  return res.json()
}

export async function searchQuery(
  q: string,
  filters: Partial<SearchFilters> = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams()
  params.set('q', q)
  if (filters.cluster) params.set('cluster', filters.cluster)
  if (filters.limit) params.set('limit', String(filters.limit))
  if (filters.healthTags?.length) {
    for (const tag of filters.healthTags) params.append('health_tags', tag)
  }
  if (filters.excludeAllergens?.length) {
    for (const a of filters.excludeAllergens) params.append('exclude_allergens', a)
  }

  const res = await apiFetch(`/search?${params.toString()}`)

  if (!res.ok) await readErrorAndThrow(res)

  return res.json()
}

export async function chatWithProduct(body: ChatRequest): Promise<ChatResponseData> {
  const res = await apiFetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) await readErrorAndThrow(res)

  return res.json()
}

export async function chefParse(body: ChefParseRequest): Promise<ChefParseResponse> {
  const res = await apiFetch('/chef/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) await readErrorAndThrow(res)

  return res.json()
}

export async function chefIntent(body: ChefIntentRequest): Promise<ChefIntentResponse> {
  const res = await apiFetch('/chef/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) await readErrorAndThrow(res)

  return res.json()
}

// ── Phase 6.5 — User Graph API ────────────────────────────────────────────────

export async function getRecommendations(params?: {
  cluster?: 'all' | 'recipe' | 'product'
  limit?: number
}): Promise<RecommendationResponse> {
  const p = new URLSearchParams()
  if (params?.cluster) p.set('cluster', params.cluster)
  if (params?.limit) p.set('limit', String(params.limit))
  const res = await apiFetch(`/users/me/recommendations?${p.toString()}`)
  if (!res.ok) return { items: [], cold_start: true, cluster: 'all', total: 0 }
  return res.json()
}

export async function getCookedHistory(params?: {
  limit?: number
}): Promise<CookedResponse> {
  const p = new URLSearchParams()
  if (params?.limit) p.set('limit', String(params.limit))
  const res = await apiFetch(`/users/me/cooked?${p.toString()}`)
  if (!res.ok) return { items: [], total: 0 }
  return res.json()
}

export async function logViewed(itemId: string, cluster: 'recipe' | 'product'): Promise<void> {
  const res = await apiFetch(`/users/me/viewed/${encodeURIComponent(itemId)}?cluster=${cluster}`, { method: 'POST' })
  if (!res.ok) await readErrorAndThrow(res)
}

export async function logLiked(itemId: string, cluster: 'recipe' | 'product'): Promise<'liked' | 'disliked' | null> {
  const res = await apiFetch(`/users/me/liked/${encodeURIComponent(itemId)}?cluster=${cluster}`, { method: 'POST' })
  if (!res.ok) await readErrorAndThrow(res)
  const data = await res.json()
  return (data.state ?? 'liked') as 'liked' | 'disliked' | null
}

export async function logUnliked(itemId: string, cluster: 'recipe' | 'product'): Promise<'liked' | 'disliked' | null> {
  const res = await apiFetch(`/users/me/liked/${encodeURIComponent(itemId)}?cluster=${cluster}`, { method: 'DELETE' })
  if (!res.ok) await readErrorAndThrow(res)
  const data = await res.json()
  return (data.state ?? null) as 'liked' | 'disliked' | null
}

export async function logDisliked(itemId: string, cluster: 'recipe' | 'product'): Promise<'liked' | 'disliked' | null> {
  const res = await apiFetch(`/users/me/disliked/${encodeURIComponent(itemId)}?cluster=${cluster}`, { method: 'POST' })
  if (!res.ok) await readErrorAndThrow(res)
  const data = await res.json()
  return (data.state ?? 'disliked') as 'liked' | 'disliked' | null
}

export async function logUndisliked(itemId: string, cluster: 'recipe' | 'product'): Promise<'liked' | 'disliked' | null> {
  const res = await apiFetch(`/users/me/disliked/${encodeURIComponent(itemId)}?cluster=${cluster}`, { method: 'DELETE' })
  if (!res.ok) await readErrorAndThrow(res)
  const data = await res.json()
  return (data.state ?? null) as 'liked' | 'disliked' | null
}

export async function getInteractionStates(
  items: Array<{ id: string; cluster: 'recipe' | 'product' }>,
): Promise<InteractionStatesResponse> {
  if (items.length === 0) return { items: [] }
  const params = new URLSearchParams()
  for (const item of items) {
    params.append('item', `${item.cluster}:${item.id}`)
  }
  const res = await apiFetch(`/users/me/interactions?${params.toString()}`)
  if (!res.ok) return { items: [] }
  return res.json()
}

export async function logCooked(recipeId: string, rating?: number): Promise<void> {
  await apiFetch(`/users/me/cooked/${recipeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rating != null ? { rating } : {}),
  })
}

export async function getAllergenTags(): Promise<string[]> {
  const res = await apiFetch('/users/me/allergen-tags')
  if (!res.ok) return []
  return res.json()
}

export async function setUserPreferences(data: {
  cuisines: string[]
  health_tags: string[]
  health_goal?: string | null
}): Promise<void> {
  const res = await apiFetch('/users/me/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) await readErrorAndThrow(res)
}

export { type FoodCardData }

// ─────────────────────────────────────────────────────────────────────────────

export async function loginWithFirebaseToken(firebaseIdToken: string): Promise<TokenPairResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ firebase_id_token: firebaseIdToken }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) await readErrorAndThrow(res)
  return res.json()
}

export async function refreshTokenPair(refreshToken: string): Promise<TokenPairResponse> {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) await readErrorAndThrow(res)
  return res.json()
}
