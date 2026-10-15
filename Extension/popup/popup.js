/**
 * NutriSense AI — Popup Script v2
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────

const authChip      = document.getElementById('auth-chip')
const authUserName  = document.getElementById('auth-user-name')
const btnDisconnect = document.getElementById('btn-disconnect')

const viewLogin     = document.getElementById('view-login')
const loginBrand    = document.getElementById('login-brand')
const btnGoogle     = document.getElementById('btn-google')
const btnGoogleLabel= document.getElementById('btn-google-label')
const authTabs      = document.querySelectorAll('.auth-tab')

// Login form
const loginForm     = document.getElementById('login-form')
const loginEmail    = document.getElementById('login-email')
const loginPassword = document.getElementById('login-password')
const btnLogin      = document.getElementById('btn-login')

// Register form
const registerForm  = document.getElementById('register-form')
const regName       = document.getElementById('reg-name')
const regEmail      = document.getElementById('reg-email')
const regPassword   = document.getElementById('reg-password')
const regConfirm    = document.getElementById('reg-confirm')
const btnRegister   = document.getElementById('btn-register')

const loginError    = document.getElementById('login-error')

const viewPrivacy  = document.getElementById('view-privacy')
const viewMain     = document.getElementById('view-main')
const queryForm    = document.getElementById('query-form')
const queryInput   = document.getElementById('query-input')
const btnSubmit    = document.getElementById('btn-submit')
const submitIcon   = document.getElementById('submit-icon')
const resultArea   = document.getElementById('result-area')

const modeTabs     = document.querySelectorAll('.mode-tab')
const modeText     = document.getElementById('mode-text')
const modeImage    = document.getElementById('mode-image')
const imageFile    = document.getElementById('image-file')
const imageZone    = document.getElementById('image-zone')
const imagePreview = document.getElementById('image-preview')
const btnAnalyze   = document.getElementById('btn-analyze')

// ── State ─────────────────────────────────────────────────────────────────────

let currentUser   = null
let selectedImage = null // { dataUrl, filename }

// ── Init ──────────────────────────────────────────────────────────────────────

viewLogin.classList.add('hidden')

async function init() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' })
    if (state?.isConnected && state?.user) {
      showConnected(state.user)
    } else {
      showLoginView()
    }
  } catch {
    showLoginView()
  }
}

init()

// If auth completes while this popup is open, update immediately.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AUTH_STATE_CHANGED' && !currentUser) init()
})

// ── Auth views ────────────────────────────────────────────────────────────────

async function showConnected(user) {
  currentUser = user
  authChip.classList.remove('hidden')
  authUserName.textContent = user.name || user.email
  viewLogin.classList.add('hidden')

  // Check if this account has accepted the privacy policy
  const ppKey = `pp_${user.uid || btoa(user.email)}`
  const stored = await chrome.storage.local.get([ppKey])

  if (!stored[ppKey]) {
    viewPrivacy.classList.remove('hidden')
    viewMain.classList.add('hidden')
    // Wire up the full privacy policy link (only needs href set once)
    const ppLink = document.getElementById('pp-full-link')
    ppLink.href = chrome.runtime.getURL('privacy-policy.html')
    ppLink.addEventListener('click', (e) => {
      e.preventDefault()
      chrome.tabs.create({ url: ppLink.href })
    })
  } else {
    viewPrivacy.classList.add('hidden')
    viewMain.classList.remove('hidden')
    setTimeout(() => queryInput.focus(), 50)
  }
}

function showLoginView() {
  currentUser = null
  authChip.classList.add('hidden')
  viewMain.classList.add('hidden')
  viewPrivacy.classList.add('hidden')
  viewLogin.classList.remove('hidden')
}

// ── Auth mode toggle ──────────────────────────────────────────────────────────

let authMode = 'login' // 'login' | 'register'

authTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.auth
    if (mode === authMode) return
    authMode = mode

    authTabs.forEach((t) => {
      t.classList.toggle('active', t.dataset.auth === mode)
      t.setAttribute('aria-selected', t.dataset.auth === mode ? 'true' : 'false')
    })

    const isRegister = mode === 'register'
    loginForm.classList.toggle('hidden', isRegister)
    registerForm.classList.toggle('hidden', !isRegister)
    loginBrand.classList.toggle('hidden', isRegister)
    btnGoogleLabel.textContent = isRegister ? 'Sign up with Google' : 'Continue with Google'
    loginError.classList.add('hidden')

    // Focus first input of active form
    setTimeout(() => {
      const first = isRegister ? regName : loginEmail
      first.focus()
    }, 50)
  })
})

// ── Password visibility toggles ───────────────────────────────────────────────

const EYE_OPEN = `<svg class="eye-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
const EYE_OFF  = `<svg class="eye-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`

function bindPwToggle(toggleId, inputEl) {
  const btn = document.getElementById(toggleId)
  btn.addEventListener('click', () => {
    const show = inputEl.type === 'password'
    inputEl.type = show ? 'text' : 'password'
    btn.innerHTML = show ? EYE_OFF : EYE_OPEN
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
  })
}

bindPwToggle('login-pw-toggle',    loginPassword)
bindPwToggle('reg-pw-toggle',      regPassword)
bindPwToggle('reg-confirm-toggle', regConfirm)

// ── Login — email/password ────────────────────────────────────────────────────

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const email    = loginEmail.value.trim()
  const password = loginPassword.value
  if (!email || !password) return

  setLoginLoading(true)
  loginError.classList.add('hidden')

  const res = await chrome.runtime.sendMessage({ type: 'LOGIN_EMAIL', email, password })
  setLoginLoading(false)

  if (res.ok) {
    showConnected(res.user)
  } else {
    loginError.textContent = res.error || 'Sign in failed.'
    loginError.classList.remove('hidden')
  }
})

function setLoginLoading(on) {
  btnLogin.disabled = on
  document.getElementById('btn-login-text').textContent = on ? 'Signing in…' : 'Sign In'
  document.getElementById('btn-login-spinner').classList.toggle('hidden', !on)
}


// ── Register — email/password ─────────────────────────────────────────────────

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const name     = regName.value.trim()
  const email    = regEmail.value.trim()
  const password = regPassword.value
  const confirm  = regConfirm.value

  if (!email || !password) return

  if (password !== confirm) {
    loginError.textContent = 'Passwords do not match.'
    loginError.classList.remove('hidden')
    regConfirm.focus()
    return
  }

  if (password.length < 6) {
    loginError.textContent = 'Password must be at least 6 characters.'
    loginError.classList.remove('hidden')
    regPassword.focus()
    return
  }

  setRegisterLoading(true)
  loginError.classList.add('hidden')

  const res = await chrome.runtime.sendMessage({ type: 'REGISTER_EMAIL', email, password, name })
  setRegisterLoading(false)

  if (res.ok) {
    showConnected(res.user)
  } else {
    loginError.textContent = res.error || 'Registration failed.'
    loginError.classList.remove('hidden')
  }
})

function setRegisterLoading(on) {
  btnRegister.disabled = on
  document.getElementById('btn-register-text').textContent = on ? 'Creating…' : 'Create Account'
  document.getElementById('btn-register-spinner').classList.toggle('hidden', !on)
}

// ── Login — Google ────────────────────────────────────────────────────────────

btnGoogle.addEventListener('click', async () => {
  const originalHTML = btnGoogle.innerHTML
  btnGoogle.disabled = true
  btnGoogle.innerHTML = `<svg class="btn-spinner" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Signing in…</span>`
  loginError.classList.add('hidden')

  // After 8s hint that we're waiting for the Google popup to complete
  const hintTimer = setTimeout(() => {
    if (btnGoogle.disabled) {
      btnGoogle.innerHTML = `<svg class="btn-spinner" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-opacity="0.25" stroke-width="1.5"/><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Waiting for Google…</span>`
    }
  }, 8000)

  let res
  try {
    res = await chrome.runtime.sendMessage({ type: 'LOGIN_GOOGLE' })
  } catch {
    // Extension popup closed while auth window was open. Re-check auth state —
    // the background may have completed sign-in successfully.
    clearTimeout(hintTimer)
    btnGoogle.disabled  = false
    btnGoogle.innerHTML = originalHTML
    const state = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }).catch(() => null)
    if (state?.isConnected && state?.user) {
      showConnected(state.user)
    } else {
      loginError.textContent = 'Sign-in window closed. Please try again.'
      loginError.classList.remove('hidden')
    }
    return
  }

  clearTimeout(hintTimer)
  btnGoogle.disabled  = false
  btnGoogle.innerHTML = originalHTML

  if (res?.ok) {
    showConnected(res.user)
  } else {
    loginError.textContent = res?.error || 'Google sign-in failed.'
    loginError.classList.remove('hidden')
  }
})

// ── Open full app ─────────────────────────────────────────────────────────────
// On Windows, send the user to apps.microsoft.com — the page auto-prompts the
// Microsoft Store app, which launches the installed NutriVerse if present and
// otherwise shows the install screen. Non-Windows platforms fall back to the
// hosted web build.

const STORE_WEB_URL = 'https://apps.microsoft.com/detail/9NQL47W346F6'
const WEB_APP_URL   = 'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net'

async function openNutriVerseApp() {
  let isWindows = false
  try {
    const info = await chrome.runtime.getPlatformInfo()
    isWindows = info.os === 'win'
  } catch {
    isWindows = /Windows/i.test(navigator.userAgent)
  }
  chrome.tabs.create({ url: isWindows ? STORE_WEB_URL : WEB_APP_URL })
}

document.getElementById('btn-open-app').addEventListener('click', openNutriVerseApp)

// ── Sign out ──────────────────────────────────────────────────────────────────

btnDisconnect.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' })
  showLoginView()
  resultArea.innerHTML = ''
})

// ── Privacy policy gate ───────────────────────────────────────────────────────

document.getElementById('pp-checkbox').addEventListener('change', (e) => {
  document.getElementById('btn-pp-agree').disabled = !e.target.checked
})

document.getElementById('btn-pp-agree').addEventListener('click', async () => {
  if (!currentUser) return
  const ppKey = `pp_${currentUser.uid || btoa(currentUser.email)}`
  await chrome.storage.local.set({ [ppKey]: true })
  viewPrivacy.classList.add('hidden')
  viewMain.classList.remove('hidden')
  setTimeout(() => queryInput.focus(), 50)
})

// ── Mode toggle ───────────────────────────────────────────────────────────────

function switchTab(mode) {
  modeTabs.forEach((t) => {
    const active = t.dataset.mode === mode
    t.classList.toggle('active', active)
    t.setAttribute('aria-selected', active ? 'true' : 'false')
  })
  modeText.classList.toggle('hidden', mode !== 'text')
  modeImage.classList.toggle('hidden', mode !== 'image')
  resultArea.innerHTML = ''
  if (mode === 'text') setTimeout(() => queryInput.focus(), 50)
}

modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.mode))
})

// ── Text query ────────────────────────────────────────────────────────────────

queryForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const query = queryInput.value.trim()
  if (!query) return

  setLoading(true)
  showLoading(`Looking up "${query}"…`)

  const res = await chrome.runtime.sendMessage({ type: 'PROCESS_QUERY', query })
  setLoading(false)

  if (res.ok) {
    renderResult(res.data, query)
  } else if (res.error === 'NOT_IN_DATABASE') {
    showNotInDatabase(query)
  } else if (res.error === 'NOT_AUTHED') {
    showLoginView()
  } else {
    showError(res.error || 'Something went wrong.')
  }
})

function setLoading(on) {
  btnSubmit.disabled       = on
  submitIcon.style.opacity = on ? '0.3' : '1'
}

// ── Image mode ────────────────────────────────────────────────────────────────

imageZone.addEventListener('click', () => imageFile.click())

function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = (e) => {
    const dataUrl = e.target.result
    selectedImage = { dataUrl, filename: file.name }
    imagePreview.src = dataUrl
    imagePreview.classList.remove('hidden')
    document.getElementById('image-zone-inner').classList.add('hidden')
    btnAnalyze.classList.remove('hidden')
    resultArea.innerHTML = ''
  }
  reader.readAsDataURL(file)
}

imageFile.addEventListener('change', () => loadImageFile(imageFile.files?.[0]))

// ── Drag and drop ─────────────────────────────────────────────────────────────

imageZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  imageZone.classList.add('drag-over')
})

imageZone.addEventListener('dragleave', (e) => {
  if (!imageZone.contains(e.relatedTarget)) imageZone.classList.remove('drag-over')
})

imageZone.addEventListener('drop', (e) => {
  e.preventDefault()
  imageZone.classList.remove('drag-over')
  const file = e.dataTransfer.files?.[0]
  loadImageFile(file)
})

btnAnalyze.addEventListener('click', async () => {
  if (!selectedImage) return

  btnAnalyze.disabled    = true
  btnAnalyze.textContent = 'Analyzing…'
  showLoading('Identifying food…')

  const res = await chrome.runtime.sendMessage({
    type:     'PROCESS_IMAGE_DATA',
    dataUrl:  selectedImage.dataUrl,
    filename: selectedImage.filename,
  })

  btnAnalyze.disabled    = false
  btnAnalyze.textContent = 'Analyze Image'

  if (res.ok) {
    renderResult(res.data, 'Image')
  } else if (res.error === 'NOT_FOOD_IMAGE') {
    showError('No Indian food detected. Please upload a clear photo of a dish.')
  } else if (res.error === 'NOT_AUTHED') {
    showLoginView()
  } else {
    showError(res.error || 'Analysis failed.')
  }
})

// ── Rendering ─────────────────────────────────────────────────────────────────

function h(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function showLoading(msg) {
  resultArea.innerHTML = `<div class="ns-loading"><div class="ns-spinner"></div><span>${h(msg)}</span></div>`
}

function showError(msg) {
  resultArea.innerHTML = `<div class="ns-error-box">${h(msg)}</div>`
}

function showNotInDatabase(query) {
  resultArea.innerHTML = `
    <div class="ns-not-found">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="11" y1="8" x2="11" y2="12"/><circle cx="11" cy="16" r="0.5" fill="currentColor"/>
      </svg>
      <div>
        <div class="ns-not-found-title">"${h(query)}" not in our database</div>
        <div class="ns-not-found-sub">NutriVerse covers Indian cuisine. Try a dish name like Biryani, Dal Makhani, or Masala Dosa.</div>
      </div>
    </div>`
}

function nutritionRows(nutrition) {
  if (!nutrition || typeof nutrition !== 'object') return ''
  const rows = Object.entries(nutrition)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `
      <div class="ns-row">
        <span class="ns-label">${h(k.replace(/_/g, ' '))}</span>
        <span class="ns-value">${h(v)}</span>
      </div>`)
    .join('')
  return rows ? `<div class="ns-section-label">Nutrition</div>${rows}` : ''
}

function llmBlock(text) {
  return text ? `<div class="ns-llm">${h(text)}</div>` : ''
}

function interactButtons(itemId, cluster, currentState) {
  if (!currentUser || !itemId) return ''
  const liked    = currentState === 'liked'
  const disliked = currentState === 'disliked'
  return `<div class="ns-interact" data-id="${h(itemId)}" data-cluster="${h(cluster)}">
    <button class="ns-interact-btn ${liked ? 'active-like' : ''}" data-action="like" title="Like">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 22V11L14 2l1 1-1 6h6a2 2 0 0 1 2 2l-2 9H7z"/>
        <line x1="7" y1="11" x2="3" y2="11"/><line x1="3" y1="22" x2="7" y2="22"/><line x1="3" y1="11" x2="3" y2="22"/>
      </svg>
    </button>
    <button class="ns-interact-btn ${disliked ? 'active-dislike' : ''}" data-action="dislike" title="Dislike">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="${disliked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 2v11l-7 9-1-1 1-6H4a2 2 0 0 1-2-2l2-9h13z"/>
        <line x1="17" y1="13" x2="21" y2="13"/><line x1="21" y1="2" x2="17" y2="2"/><line x1="21" y1="13" x2="21" y2="2"/>
      </svg>
    </button>
  </div>`
}

function renderResult(data, query) {
  if (data.error) { showError(data.error); return }
  switch (data.pathway) {
    case 'extraction': case 'estimation':
      resultArea.innerHTML = renderExtraction(data); break
    case 'comparison':
      resultArea.innerHTML = renderComparison(data); break
    case 'modification':
      resultArea.innerHTML = renderModification(data); break
    case 'search':
      resultArea.innerHTML = renderSearch(data); break
    default:
      resultArea.innerHTML = `<div class="ns-error-box">Unexpected response.</div>`
  }
  attachInteractHandlers()
}

function renderExtraction(data) {
  const name   = (data.recipe_name || 'Unknown dish').replace(/\s*\(Estimated\)\s*/i, '').trim()
  const itemId = data.meta?.id || data.meta?.node_id || null
  return `
    <div class="ns-card">
      <div class="ns-card-head">
        <div class="ns-card-name-row">
          <div class="ns-card-name">${h(name)}</div>
          ${interactButtons(itemId, 'recipe', null)}
        </div>
        <div class="ns-card-meta">
          ${data.confidence != null ? `<span class="ns-conf">${Math.round(data.confidence * 100)}% match</span>` : ''}
          ${data.estimated ? `<span class="ns-tag">Estimated</span>` : ''}
          ${data.meta?.serving_size_g != null ? `<span class="ns-tag">${Math.round(data.meta.serving_size_g)} g serving</span>` : ''}
          ${data.meta?.total_time != null && data.meta.total_time > 0 ? `<span class="ns-tag">${data.meta.total_time} min</span>` : ''}
        </div>
      </div>
      ${nutritionRows(data.nutrition)}
      ${llmBlock(data.llm_response)}
    </div>`
}

function renderComparison(data) {
  const a = data.dish_a || 'Dish A'
  const b = data.dish_b || 'Dish B'
  return `
    <div class="ns-card">
      <div class="ns-card-head">
        <div class="ns-card-name">${h(a)} vs ${h(b)}</div>
        <div class="ns-card-meta"><span class="ns-tag">Comparison</span></div>
      </div>
      <div class="ns-compare-grid">
        <div class="ns-compare-col">
          <div class="ns-compare-col-head">${h(a)}</div>
          ${nutritionRows(data.nutrition_a)}
        </div>
        <div class="ns-compare-col">
          <div class="ns-compare-col-head">${h(b)}</div>
          ${nutritionRows(data.nutrition_b)}
        </div>
      </div>
      ${llmBlock(data.llm_response)}
    </div>`
}

function renderModification(data) {
  const name = (data.recipe_name || 'Recipe').replace(/\s*\(Estimated\)\s*/i, '').trim()
  return `
    <div class="ns-card">
      <div class="ns-card-head">
        <div class="ns-card-name">${h(name)}</div>
        <div class="ns-card-meta">
          <span class="ns-tag">Modified</span>
          ${data.constraint ? `<span class="ns-tag">${h(data.constraint)}</span>` : ''}
        </div>
      </div>
      ${nutritionRows(data.nutrition)}
      ${llmBlock(data.llm_response)}
    </div>`
}

function renderSearch(data) {
  if (!data.results?.length) {
    return `<div class="ns-card"><div class="ns-empty-state">No results for "${h(data.query)}"</div></div>`
  }
  const items = data.results.slice(0, 6).map((r) => `
    <div class="ns-result">
      <div class="ns-result-left">
        <div class="ns-result-name">${h(r.name)}</div>
        <div class="ns-result-sub">${[r.brand, r.cluster].filter(Boolean).map(h).join(' · ')}</div>
      </div>
      <div class="ns-result-right">
        ${r.calories != null ? `<div class="ns-result-cal">${Math.round(r.calories)} kcal</div>` : ''}
        ${interactButtons(r.id, r.cluster, r.interaction_state)}
      </div>
    </div>`).join('')
  return `
    <div class="ns-card">
      <div class="ns-card-head">
        <div class="ns-card-name">${h(data.query)}</div>
        <div class="ns-card-meta"><span class="ns-conf">${data.results.length} results</span></div>
      </div>
      ${items}
      ${llmBlock(data.llm_response)}
    </div>`
}

// ── Interaction handlers ──────────────────────────────────────────────────────

function attachInteractHandlers() {
  resultArea.querySelectorAll('.ns-interact-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!currentUser) { showError('Sign in to like or dislike items.'); return }

      const container = btn.closest('.ns-interact')
      const itemId    = container.dataset.id
      const cluster   = container.dataset.cluster
      const action    = btn.dataset.action
      const isActive  = btn.classList.contains(`active-${action}`)
      const resolved  = isActive ? (action === 'like' ? 'unlike' : 'undislike') : action

      const likeBtn    = container.querySelector('[data-action="like"]')
      const dislikeBtn = container.querySelector('[data-action="dislike"]')
      likeBtn.classList.remove('active-like')
      dislikeBtn.classList.remove('active-dislike')
      if (!isActive) btn.classList.add(`active-${action}`)

      const res = await chrome.runtime.sendMessage({ type: 'INTERACT', itemId, cluster, action: resolved })

      if (!res.ok) {
        likeBtn.classList.remove('active-like')
        dislikeBtn.classList.remove('active-dislike')
        if (res.error === 'NOT_AUTHED') showError('Sign in to like or dislike items.')
      } else if (res.state) {
        likeBtn.classList.toggle('active-like',    res.state === 'liked')
        dislikeBtn.classList.toggle('active-dislike', res.state === 'disliked')
      }
    })
  })
}
