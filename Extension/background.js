/**
 * NutriSense AI — Background Service Worker (MV3)
 */

const DEFAULT_API_URL  = 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net'
const FIREBASE_API_KEY = 'AIzaSyDs4D66TAs6PAC_QTDl4xF_6jn6SQpbozE'

// ── Rate limiter ──────────────────────────────────────────────────────────────
// 20 requests per 60-second window per user session.

const RATE_LIMIT  = 20
const RATE_WINDOW = 60 * 1000

async function checkRateLimit() {
  const { rateData } = await chrome.storage.local.get(['rateData'])
  const now  = Date.now()
  const rate = rateData || { count: 0, windowStart: now }

  if (now - rate.windowStart > RATE_WINDOW) {
    await chrome.storage.local.set({ rateData: { count: 1, windowStart: now } })
    return
  }
  if (rate.count >= RATE_LIMIT) {
    const resetIn = Math.ceil((RATE_WINDOW - (now - rate.windowStart)) / 1000)
    throw new Error(`Rate limit reached. Try again in ${resetIn}s.`)
  }
  await chrome.storage.local.set({ rateData: { ...rate, count: rate.count + 1 } })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const { apiUrl } = await chrome.storage.sync.get(['apiUrl'])
  if (!apiUrl) await chrome.storage.sync.set({ apiUrl: DEFAULT_API_URL })

  // Inject content script into all open tabs so presence signals are set
  // immediately on install without needing the broad `tabs` permission.
  // chrome.scripting silently fails on restricted pages (chrome://, etc.).
  const openTabs = await chrome.tabs.query({})
  for (const tab of openTabs) {
    if (!tab.id) continue
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    }).catch(() => {})
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'nutrisense-lookup-text',
      title: 'NutriVerse: Look up "%s"',
      contexts: ['selection'],
    })
    chrome.contextMenus.create({
      id: 'nutrisense-classify-image',
      title: 'NutriVerse: Classify food image',
      contexts: ['image'],
    })
  })
})

// ── Context menu ──────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return
  const base = await getBase()

  if (info.menuItemId === 'nutrisense-lookup-text' && info.selectionText) {
    const query = info.selectionText.trim()
    sendToTab(tab.id, { type: 'SHOW_LOADING', message: `Looking up "${query}"…` })
    try {
      await checkRateLimit()
      const data = await callProcessText(base, query)
      // In context menu (content panel), show estimated warning — don't hard-block.
      sendToTab(tab.id, { type: 'SHOW_NUTRITION', data, query })
    } catch (err) {
      sendToTab(tab.id, { type: 'SHOW_ERROR', message: err.message })
    }
  }

  if (info.menuItemId === 'nutrisense-classify-image' && info.srcUrl) {
    sendToTab(tab.id, { type: 'SHOW_LOADING', message: 'Classifying food image…' })
    try {
      await checkRateLimit()
      const data = await callProcessImage(base, info.srcUrl)
      sendToTab(tab.id, { type: 'SHOW_NUTRITION', data, query: 'Image' })
    } catch (err) {
      sendToTab(tab.id, { type: 'SHOW_ERROR', message: err.message })
    }
  }
})

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── Presence ping (from externally_connectable app page) ──
  if (msg.type === 'ping') {
    sendResponse({ ok: true, version: '2.1.0' })
    return true
  }

  // ── Text query (popup — auth + food detection enforced) ──
  if (msg.type === 'PROCESS_QUERY') {
    ;(async () => {
      try {
        const { refreshToken } = await chrome.storage.local.get(['refreshToken'])
        if (!refreshToken) { sendResponse({ ok: false, error: 'NOT_AUTHED' }); return }
        await checkRateLimit()
        const base = await getBase()
        const data = await callProcessText(base, msg.query)
        if (data.estimated) { sendResponse({ ok: false, error: 'NOT_IN_DATABASE' }); return }
        sendResponse({ ok: true, data })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    })()
    return true
  }

  // ── Image upload from popup (base64 data URL) ──
  if (msg.type === 'PROCESS_IMAGE_DATA') {
    ;(async () => {
      try {
        const { refreshToken } = await chrome.storage.local.get(['refreshToken'])
        if (!refreshToken) { sendResponse({ ok: false, error: 'NOT_AUTHED' }); return }
        await checkRateLimit()
        const base    = await getBase()
        const headers = await buildHeaders()

        // Decode base64 data URL → Blob
        const [meta, b64] = msg.dataUrl.split(',')
        const mime     = meta.match(/:(.*?);/)?.[1] || 'image/jpeg'
        const binary   = atob(b64)
        const bytes    = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob     = new Blob([bytes], { type: mime })
        const filename = msg.filename || 'food.jpg'

        // Use 3-arg append so multipart Content-Disposition always includes filename
        const form = new FormData()
        form.append('image', blob, filename)

        const res = await fetch(`${base}/process`, { method: 'POST', headers, body: form })
        if (!res.ok) {
          const detail = await res.json().catch(() => null)
          throw new Error(detail?.detail || `Server error ${res.status}`)
        }
        const data = await res.json()

        if (data.estimated || (data.confidence != null && data.confidence < 0.35)) {
          sendResponse({ ok: false, error: 'NOT_FOOD_IMAGE' }); return
        }
        sendResponse({ ok: true, data })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    })()
    return true
  }

  // ── Settings ──
  if (msg.type === 'GET_API_URL') {
    chrome.storage.sync.get(['apiUrl'], ({ apiUrl }) =>
      sendResponse({ apiUrl: apiUrl || DEFAULT_API_URL })
    )
    return true
  }
  if (msg.type === 'SET_API_URL') {
    chrome.storage.sync.set({ apiUrl: msg.apiUrl }, () => sendResponse({ ok: true }))
    return true
  }

  // ── Auth sync (from content script bridge) ──
  if (msg.type === 'SYNC_AUTH') {
    ;(async () => {
      if (msg.refreshToken) {
        const toStore = { refreshToken: msg.refreshToken }
        if (msg.user) toStore.authUser = msg.user
        await chrome.storage.local.set(toStore)
        const accessToken = await doRefresh(msg.refreshToken).catch(() => null)
        if (!msg.user && accessToken) {
          const parsed = parseJwtUser(accessToken)
          if (parsed) await chrome.storage.local.set({ authUser: parsed })
        }
      } else {
        await chrome.storage.local.remove(['refreshToken', 'accessToken', 'accessTokenExp', 'authUser'])
      }
      // Notify popup if it is open so it can update without requiring a reopen
      chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {})
      sendResponse({ ok: true })
    })()
    return true
  }

  // ── Auth state ──
  if (msg.type === 'GET_AUTH_STATE') {
    warmupBackend() // fire-and-forget: pre-warm Azure so auth is fast when user clicks
    chrome.storage.local.get(['authUser', 'refreshToken', 'accessToken'], (data) =>
      sendResponse({
        user: data.authUser || null,
        hasToken: !!data.refreshToken,
        isConnected: !!data.refreshToken,
      })
    )
    return true
  }

  // ── Google sign-in (launchWebAuthFlow → Firebase signInWithIdp → NutriSense JWT) ──
  if (msg.type === 'LOGIN_GOOGLE') {
    ;(async () => {
      try {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('auth/timeout')), 3 * 60 * 1000)
        )
        const user = await Promise.race([signInWithGoogle(), timeout])
        sendResponse({ ok: true, user })
      } catch (err) {
        sendResponse({ ok: false, error: friendlyFirebaseError(err.message) })
      }
    })()
    return true
  }

  // ── Firebase email/password login ──
  if (msg.type === 'LOGIN_EMAIL') {
    ;(async () => {
      try {
        const base = await getBase()
        const fbRes = await fetchWithTimeout(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: msg.email, password: msg.password, returnSecureToken: true }),
          },
          10000
        )
        if (!fbRes.ok) {
          const err = await fbRes.json().catch(() => ({}))
          throw new Error(err?.error?.message || 'Firebase sign-in failed')
        }
        const { idToken, email, displayName } = await fbRes.json()

        const nsRes = await fetchWithTimeout(`${base}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
          body: JSON.stringify({ firebase_id_token: idToken }),
        }, 60000)
        if (!nsRes.ok) throw new Error(`Auth failed: ${nsRes.status}`)
        const { access_token, refresh_token } = await nsRes.json()

        const user = parseJwtUser(access_token) || { email, name: displayName || email.split('@')[0] }
        await chrome.storage.local.set({
          refreshToken: refresh_token,
          accessToken:  access_token,
          accessTokenExp: getJwtExp(access_token),
          authUser: user,
        })
        sendResponse({ ok: true, user })
      } catch (err) {
        sendResponse({ ok: false, error: friendlyFirebaseError(err.message) })
      }
    })()
    return true
  }

  // ── Firebase email/password registration ──
  if (msg.type === 'REGISTER_EMAIL') {
    ;(async () => {
      try {
        const base = await getBase()
        // Step 1: Create Firebase account
        const signUpRes = await fetchWithTimeout(
          `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: msg.email, password: msg.password, returnSecureToken: true }),
          },
          10000
        )
        if (!signUpRes.ok) {
          const err = await signUpRes.json().catch(() => ({}))
          throw new Error(err?.error?.message || 'Registration failed')
        }
        let { idToken, email } = await signUpRes.json()

        // Step 2: Set display name if provided
        if (msg.name) {
          const updateRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FIREBASE_API_KEY}`,
            {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken, displayName: msg.name, returnSecureToken: true }),
            }
          )
          if (updateRes.ok) {
            const updated = await updateRes.json()
            idToken = updated.idToken || idToken
          }
        }

        // Step 3: Exchange Firebase ID token → NutriSense JWT
        const nsRes = await fetchWithTimeout(`${base}/auth/login`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
          body: JSON.stringify({ firebase_id_token: idToken }),
        }, 60000)
        if (!nsRes.ok) throw new Error(`Auth failed: ${nsRes.status}`)
        const { access_token, refresh_token } = await nsRes.json()

        const user = parseJwtUser(access_token) || { email, name: msg.name || email.split('@')[0] }
        await chrome.storage.local.set({
          refreshToken:   refresh_token,
          accessToken:    access_token,
          accessTokenExp: getJwtExp(access_token),
          authUser:       user,
        })
        sendResponse({ ok: true, user })
      } catch (err) {
        sendResponse({ ok: false, error: friendlyFirebaseError(err.message) })
      }
    })()
    return true
  }

  // ── Logout ──
  if (msg.type === 'AUTH_LOGOUT') {
    chrome.storage.local.remove(['refreshToken', 'accessToken', 'accessTokenExp', 'authUser'], () =>
      sendResponse({ ok: true })
    )
    return true
  }

  // ── Like / dislike ──
  if (msg.type === 'INTERACT') {
    ;(async () => {
      const base = await getBase()
      try {
        const headers = await buildHeaders()
        if (!headers['Authorization']) {
          sendResponse({ ok: false, error: 'NOT_AUTHED' })
          return
        }
        const { itemId, cluster, action } = msg
        const pathMap = {
          like:      ['POST',   `/users/me/liked/${encodeURIComponent(itemId)}?cluster=${cluster}`],
          unlike:    ['DELETE', `/users/me/liked/${encodeURIComponent(itemId)}?cluster=${cluster}`],
          dislike:   ['POST',   `/users/me/disliked/${encodeURIComponent(itemId)}?cluster=${cluster}`],
          undislike: ['DELETE', `/users/me/disliked/${encodeURIComponent(itemId)}?cluster=${cluster}`],
        }
        const [method, path] = pathMap[action] || []
        if (!method) throw new Error('Unknown action')
        const res = await fetch(`${base}${path}`, { method, headers })
        if (!res.ok) throw new Error(`${res.status}`)
        const data = await res.json()
        sendResponse({ ok: true, state: data.state ?? null })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    })()
    return true
  }
})

// ── API helpers ───────────────────────────────────────────────────────────────

async function getBase() {
  const { apiUrl } = await chrome.storage.sync.get(['apiUrl'])
  return (apiUrl || DEFAULT_API_URL).replace(/\/$/, '')
}

async function fetchWithTimeout(url, options = {}, ms = 20000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal })
    return res
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out. The server may be starting up — try again in a moment.')
    throw err
  } finally {
    clearTimeout(id)
  }
}

// Fire-and-forget: wake the Azure instance early so auth calls are fast.
async function warmupBackend() {
  try {
    const base = await getBase()
    await fetch(`${base}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) })
  } catch { /* ignore — warmup is best-effort */ }
}

async function doRefresh(refreshToken) {
  const base = await getBase()
  const res = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!res.ok) throw new Error('Refresh failed')
  const { access_token } = await res.json()
  await chrome.storage.local.set({
    accessToken: access_token,
    accessTokenExp: getJwtExp(access_token),
  })
  return access_token
}

async function buildHeaders() {
  let { accessToken, accessTokenExp, refreshToken } = await chrome.storage.local.get([
    'accessToken', 'accessTokenExp', 'refreshToken',
  ])
  const now = Math.floor(Date.now() / 1000)
  if (refreshToken && (!accessToken || !accessTokenExp || accessTokenExp - now < 60)) {
    try {
      accessToken = await doRefresh(refreshToken)
    } catch {
      await chrome.storage.local.remove(['refreshToken', 'accessToken', 'accessTokenExp', 'authUser'])
      accessToken = null
    }
  }
  const headers = { 'ngrok-skip-browser-warning': '1' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  return headers
}

async function callProcessText(base, query) {
  const headers = await buildHeaders()
  const url = `${base}/process?nsq=${encodeURIComponent(query)}`
  const res = await fetch(url, { method: 'POST', headers })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || `Server error ${res.status}`)
  }
  return res.json()
}

async function callProcessImage(base, imageUrl) {
  const headers = await buildHeaders()
  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error('Could not fetch the image')
  const blob = await imgRes.blob()

  // Derive a filename with a valid extension.
  // Many CDN/web URLs have no file extension in the path, so we fall back
  // to the blob MIME type to ensure the backend extension check passes.
  const MIME_TO_EXT = {
    'image/jpeg': 'jpg',
    'image/jpg':  'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
    'image/gif':  'gif',
    'image/bmp':  'bmp',
  }
  const VALID_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])

  let name = imageUrl.split('/').pop()?.split('?')[0] || ''
  const urlExt = name.includes('.') ? name.split('.').pop()?.toLowerCase() : null
  if (!urlExt || !VALID_EXTS.has(urlExt)) {
    const mime = (blob.type || 'image/jpeg').split(';')[0].trim()
    const ext  = MIME_TO_EXT[mime] || 'jpg'
    name = `food.${ext}`
  }

  const mime = blob.type || 'image/jpeg'
  const file = new File([blob], name, { type: mime })
  const form = new FormData()
  form.append('image', file)
  const res = await fetch(`${base}/process`, { method: 'POST', headers, body: form })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || `Server error ${res.status}`)
  }
  return res.json()
}

// ── Google OAuth (launchWebAuthFlow — implicit flow, Web Application client) ──
// Web Application OAuth client with https://<ext-id>.chromiumapp.org/ redirect.
// Implicit flow (response_type=token) — no client_secret needed.
// Update GOOGLE_CLIENT_ID below with your Web Application client ID.

const GOOGLE_CLIENT_ID = '41453765044-2532t2nmehsnl1bgscd0nri4svjbi5nl.apps.googleusercontent.com'

async function signInWithGoogle() {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id',     GOOGLE_CLIENT_ID)
  authUrl.searchParams.set('response_type', 'token')
  authUrl.searchParams.set('redirect_uri',  redirectUri)
  authUrl.searchParams.set('scope',         'openid email profile')
  authUrl.searchParams.set('prompt',        'select_account')

  const redirectUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (url) => {
        if (chrome.runtime.lastError || !url) {
          reject(new Error(chrome.runtime.lastError?.message || 'Google sign-in cancelled'))
        } else {
          resolve(url)
        }
      }
    )
  })

  // Extract access_token from URL fragment (#access_token=...&token_type=Bearer...)
  const fragment    = new URL(redirectUrl).hash.slice(1)
  const accessToken = new URLSearchParams(fragment).get('access_token')
  if (!accessToken) throw new Error('Google auth failed — no access token received')

  // Exchange Google access token → Firebase ID token via signInWithIdp
  const fbRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody:            `access_token=${accessToken}&providerId=google.com`,
        requestUri:          'http://localhost',
        returnIdpCredential: true,
        returnSecureToken:   true,
      }),
    }
  )
  if (!fbRes.ok) {
    const err = await fbRes.json().catch(() => ({}))
    throw new Error(err?.error?.message || 'Firebase Google auth failed')
  }
  const { idToken, email, displayName } = await fbRes.json()

  // Exchange Firebase ID token → NutriSense JWT
  const base  = await getBase()
  const nsRes = await fetchWithTimeout(`${base}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' },
    body: JSON.stringify({ firebase_id_token: idToken }),
  }, 60000)
  if (!nsRes.ok) throw new Error(`Backend auth failed: ${nsRes.status}`)
  const { access_token, refresh_token } = await nsRes.json()

  const user = parseJwtUser(access_token) || {
    email,
    name: displayName || email?.split('@')[0] || 'User',
  }
  await chrome.storage.local.set({
    refreshToken:   refresh_token,
    accessToken:    access_token,
    accessTokenExp: getJwtExp(access_token),
    authUser:       user,
  })
  return user
}

// ── JWT helpers ───────────────────────────────────────────────────────────────

function parseJwtUser(token) {
  try {
    const [, payload] = token.split('.')
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    const email = data.email || ''
    const name  = data.name || email.split('@')[0]
    const uid   = data.sub
    if (!email) return null
    return { email, name, uid }
  } catch { return null }
}

function getJwtExp(token) {
  try {
    const [, payload] = token.split('.')
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return data.exp || 0
  } catch { return 0 }
}

function friendlyFirebaseError(msg) {
  if (!msg || typeof msg !== 'string') return 'Sign-in failed. Please try again.'
  if (msg.includes('EMAIL_EXISTS'))      return 'An account with this email already exists. Try signing in.'
  if (msg.includes('OPERATION_NOT_ALLOWED')) return 'Email/password sign-up is not enabled.'
  if (msg.includes('EMAIL_NOT_FOUND') || msg.includes('INVALID_EMAIL')) return 'No account found with this email.'
  if (msg.includes('INVALID_PASSWORD') || msg.includes('INVALID_LOGIN_CREDENTIALS')) return 'Incorrect email or password.'
  if (msg.includes('USER_DISABLED'))     return 'This account has been disabled.'
  if (msg.includes('TOO_MANY_ATTEMPTS')) return 'Too many attempts. Try again later.'
  if (msg.includes('MISSING_PASSWORD'))  return 'Please enter your password.'
  if (msg.includes('WEAK_PASSWORD'))     return 'Password is too weak.'
  if (msg.includes('timed out'))         return 'Server is starting up — please try again in a moment.'
  if (msg.includes('Auth failed'))       return 'Could not reach NutriVerse. Check your connection.'
  if (msg.includes('access_denied') || msg.includes('not approve')) return 'Google sign-in was cancelled.'
  if (msg.includes('cancelled') || msg.includes('cancel')) return 'Sign-in was cancelled.'
  if (msg.includes('no access token')) return 'Google sign-in failed. Please try again.'
  if (msg.includes('Backend auth failed')) return 'Could not reach NutriVerse. Check your connection.'
  return 'Sign-in failed. Please try again.'
}

// ── Tab utility ───────────────────────────────────────────────────────────────

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Inject CSS then JS, then send the message
    Promise.all([
      chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }),
      chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }),
    ])
      .then(() => chrome.tabs.sendMessage(tabId, message).catch(() => {}))
      .catch(() => {})
  })
}
