/**
 * NutriSense AI — Content Script
 * Uses Shadow DOM for complete CSS isolation from the host page.
 */
;(function () {
  if (window.__nutrisenseInjected) return
  window.__nutrisenseInjected = true

  // ── Signal presence to the NutriSense app ────────────────────────────────────
  // The app's useExtension hook reads these to show "Installed" in the sidebar.
  document.documentElement.setAttribute('data-nutrisense-ext', '1')
  window.__nutrisenseExtension = true
  try { localStorage.setItem('nutrisense-ext-installed', 'true') } catch {}

  // ── Styles (isolated inside Shadow DOM) ──────────────────────────────────────

  const STYLES = `
    :host {
      all: initial;
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      display: block;
    }

    #panel {
      width: 360px;
      max-height: 520px;
      overflow-y: auto;
      background: rgba(8, 8, 8, 0.97);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-top: 2px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.8), 0 4px 16px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #f0f0f0;
      -webkit-font-smoothing: antialiased;
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px) scale(0.98);
      transition: opacity 0.18s ease, transform 0.18s ease;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }

    #panel.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0) scale(1);
    }

    #panel::-webkit-scrollbar { width: 4px; }
    #panel::-webkit-scrollbar-track { background: transparent; }
    #panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

    /* ── Close button ── */
    #close-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 24px;
      height: 24px;
      background: rgba(255,255,255,0.06);
      border: none;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      color: rgba(255,255,255,0.4);
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
    }
    #close-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    #close-btn svg { display: block; }

    /* ── Estimated warning ── */
    .est-bar {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 9px 16px;
      background: rgba(220, 60, 60, 0.12);
      border-bottom: 1px solid rgba(220, 60, 60, 0.2);
      color: #e07070;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.01em;
    }
    .est-bar svg { flex-shrink: 0; }

    /* ── Header ── */
    .ns-head {
      padding: 18px 48px 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .ns-name {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
      line-height: 1.3;
      word-break: break-word;
      letter-spacing: -0.01em;
    }
    .ns-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 5px;
    }
    .ns-conf {
      font-size: 11px;
      color: rgba(255,255,255,0.35);
      font-weight: 500;
    }
    .ns-tag {
      font-size: 10px;
      font-weight: 600;
      color: rgba(255,255,255,0.3);
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 3px;
      padding: 1px 7px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    /* ── Section label ── */
    .ns-section-label {
      padding: 10px 16px 4px;
      font-size: 10px;
      font-weight: 700;
      color: rgba(255,255,255,0.25);
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    /* ── Nutrition rows ── */
    .ns-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      min-height: 36px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .ns-row:last-child { border-bottom: none; }
    .ns-label {
      font-size: 12.5px;
      color: rgba(255,255,255,0.45);
      text-transform: capitalize;
      flex: 1;
      padding-right: 16px;
    }
    .ns-value {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }

    /* ── LLM block ── */
    .ns-llm {
      margin: 0;
      padding: 12px 16px;
      border-top: 1px solid rgba(255,255,255,0.06);
      font-size: 12px;
      color: rgba(255,255,255,0.4);
      line-height: 1.65;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 120px;
      overflow-y: auto;
    }

    /* ── Search results ── */
    .ns-result {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      gap: 12px;
    }
    .ns-result:last-child { border-bottom: none; }
    .ns-result-left { flex: 1; min-width: 0; }
    .ns-result-name {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ns-result-sub {
      font-size: 11px;
      color: rgba(255,255,255,0.3);
      margin-top: 2px;
    }
    .ns-result-cal {
      font-size: 13px;
      font-weight: 700;
      color: rgba(255,255,255,0.7);
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }

    /* ── Compare ── */
    .ns-compare-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .ns-compare-col:first-child { border-right: 1px solid rgba(255,255,255,0.07); }
    .ns-compare-col-head {
      padding: 10px 16px 6px;
      font-size: 10px;
      font-weight: 700;
      color: rgba(255,255,255,0.25);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .ns-compare-col .ns-row { padding: 0 12px; min-height: 32px; }
    .ns-compare-col .ns-label { font-size: 11px; }
    .ns-compare-col .ns-value { font-size: 11px; }

    /* ── Loading ── */
    .ns-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 18px 16px;
      color: rgba(255,255,255,0.35);
      font-size: 12.5px;
    }
    .ns-ring {
      width: 14px;
      height: 14px;
      border: 1.5px solid rgba(255,255,255,0.1);
      border-top-color: rgba(255,255,255,0.4);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Error ── */
    .ns-error {
      padding: 14px 16px;
      font-size: 12px;
      color: #e07070;
      line-height: 1.5;
    }

    /* ── Empty ── */
    .ns-empty {
      padding: 20px 16px;
      text-align: center;
      font-size: 12px;
      color: rgba(255,255,255,0.25);
    }

    /* ── Like / dislike ── */
    .ns-interact {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }
    .ns-interact-btn {
      all: unset;
      cursor: pointer;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: rgba(255,255,255,0.25);
      transition: background 0.15s, color 0.15s;
    }
    .ns-interact-btn:hover { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.6); }
    .ns-interact-btn.active-like    { color: #5cc878; }
    .ns-interact-btn.active-dislike { color: #e07070; }
    .ns-interact-btn svg { display: block; }

    .ns-toast {
      position: absolute;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 5px;
      padding: 5px 12px;
      font-size: 11px;
      color: rgba(255,255,255,0.6);
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .ns-toast.show { opacity: 1; }

    /* name row with interact buttons */
    .ns-head-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }
    .ns-head-row .ns-name { flex: 1; }

    /* result right side */
    .ns-result-right {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    /* ── Footer branding ── */
    .ns-footer {
      padding: 8px 16px 10px;
      border-top: 1px solid rgba(255,255,255,0.05);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.15);
      text-align: right;
    }
  `

  // ── Shadow DOM setup ──────────────────────────────────────────────────────────

  let host = null
  let shadow = null
  let panelEl = null

  function getPanel() {
    if (host) return

    host = document.createElement('div')
    document.body.appendChild(host)

    shadow = host.attachShadow({ mode: 'open' })

    const styleEl = document.createElement('style')
    styleEl.textContent = STYLES
    shadow.appendChild(styleEl)

    panelEl = document.createElement('div')
    panelEl.id = 'panel'

    const closeBtn = document.createElement('button')
    closeBtn.id = 'close-btn'
    closeBtn.title = 'Close'
    closeBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>`
    closeBtn.addEventListener('click', hidePanel)
    panelEl.appendChild(closeBtn)

    shadow.appendChild(panelEl)

    document.addEventListener('mousedown', (e) => {
      if (host && !host.contains(e.target) && !shadow.contains(e.target)) hidePanel()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hidePanel()
    })
  }

  function hidePanel() {
    if (panelEl) panelEl.classList.remove('visible')
  }

  function showPanel(html) {
    getPanel()
    Array.from(panelEl.children).forEach((c) => {
      if (c.id !== 'close-btn') c.remove()
    })
    const content = document.createElement('div')
    content.innerHTML = html
    panelEl.appendChild(content)
    panelEl.classList.add('visible')
    attachPanelInteractHandlers()
  }

  function showToast(msg) {
    let toast = shadow.getElementById('ns-panel-toast')
    if (!toast) {
      toast = document.createElement('div')
      toast.id = 'ns-panel-toast'
      toast.className = 'ns-toast'
      panelEl.appendChild(toast)
    }
    toast.textContent = msg
    toast.classList.add('show')
    clearTimeout(toast._timer)
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2200)
  }

  function attachPanelInteractHandlers() {
    shadow.querySelectorAll('.ns-interact-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const container = btn.closest('.ns-interact')
        const itemId  = container.dataset.id
        const cluster = container.dataset.cluster
        const action  = btn.dataset.action
        const isActive = btn.classList.contains(`active-${action}`)
        const resolved = isActive
          ? (action === 'like' ? 'unlike' : 'undislike')
          : action

        const likeBtn    = container.querySelector('[data-action="like"]')
        const dislikeBtn = container.querySelector('[data-action="dislike"]')
        likeBtn.classList.remove('active-like')
        dislikeBtn.classList.remove('active-dislike')
        if (!isActive) btn.classList.add(`active-${action}`)

        const res = await chrome.runtime.sendMessage({
          type: 'INTERACT', itemId, cluster, action: resolved,
        }).catch(() => ({ ok: false, error: 'Extension error' }))

        if (!res.ok) {
          likeBtn.classList.remove('active-like')
          dislikeBtn.classList.remove('active-dislike')
          if (res.error === 'NOT_AUTHED') showToast('Sign in to NutriVerse to like recipes')
        } else if (res.state) {
          likeBtn.classList.toggle('active-like', res.state === 'liked')
          dislikeBtn.classList.toggle('active-dislike', res.state === 'disliked')
        }
      })
    })
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function h(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function estBar() {
    return `<div class="est-bar">
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M8 2L1 14h14L8 2z"/><line x1="8" y1="7" x2="8" y2="10"/><circle cx="8" cy="12.5" r="0.5" fill="currentColor"/>
      </svg>
      Estimated by LLM — not found in database
    </div>`
  }

  function nutRows(nutrition) {
    if (!nutrition || typeof nutrition !== 'object') return ''
    const rows = Object.entries(nutrition)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `<div class="ns-row">
        <span class="ns-label">${h(k.replace(/_/g, ' '))}</span>
        <span class="ns-value">${h(v)}</span>
      </div>`)
      .join('')
    return rows ? `<div class="ns-section-label">Nutrition</div>${rows}` : ''
  }

  function llm(text) {
    return text ? `<div class="ns-llm">${h(text)}</div>` : ''
  }

  function footer() {
    return `<div class="ns-footer">NutriVerse</div>`
  }

  // ── Renderers ─────────────────────────────────────────────────────────────────

  function interactBtns(itemId, cluster, state) {
    if (!itemId) return ''
    const liked    = state === 'liked'
    const disliked = state === 'disliked'
    return `<div class="ns-interact" data-id="${h(itemId)}" data-cluster="${h(cluster)}">
      <button class="ns-interact-btn ${liked ? 'active-like' : ''}" data-action="like" title="Like">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 22V11L14 2l1 1-1 6h6a2 2 0 0 1 2 2l-2 9H7z"/>
          <line x1="7" y1="11" x2="3" y2="11"/><line x1="3" y1="22" x2="7" y2="22"/><line x1="3" y1="11" x2="3" y2="22"/>
        </svg>
      </button>
      <button class="ns-interact-btn ${disliked ? 'active-dislike' : ''}" data-action="dislike" title="Dislike">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${disliked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 2v11l-7 9-1-1 1-6H4a2 2 0 0 1-2-2l2-9h13z"/>
          <line x1="17" y1="13" x2="21" y2="13"/><line x1="21" y1="2" x2="17" y2="2"/><line x1="21" y1="13" x2="21" y2="2"/>
        </svg>
      </button>
    </div>`
  }

  function renderExtraction(data) {
    const name = (data.recipe_name || 'Unknown dish').replace(/\s*\(Estimated\)\s*/i, '').trim()
    const itemId = data.meta?.id || data.meta?.node_id || null
    return `
      ${data.estimated ? estBar() : ''}
      <div class="ns-head">
        <div class="ns-head-row">
          <div class="ns-name">${h(name)}</div>
          ${interactBtns(itemId, 'recipe', null)}
        </div>
        <div class="ns-meta">
          ${data.confidence != null ? `<span class="ns-conf">${Math.round(data.confidence * 100)}% match</span>` : ''}
          ${data.estimated ? `<span class="ns-tag">Estimated</span>` : ''}
          ${data.meta?.serving_size_g != null ? `<span class="ns-tag">${Math.round(data.meta.serving_size_g)} g serving</span>` : ''}
          ${data.meta?.total_time != null && data.meta.total_time > 0 ? `<span class="ns-tag">${data.meta.total_time} min</span>` : ''}
        </div>
      </div>
      ${nutRows(data.nutrition)}
      ${llm(data.llm_response)}
      ${footer()}
    `
  }

  function renderComparison(data) {
    const a = data.dish_a || 'Dish A'
    const b = data.dish_b || 'Dish B'
    return `
      <div class="ns-head">
        <div class="ns-name">${h(a)} vs ${h(b)}</div>
        <div class="ns-meta"><span class="ns-tag">Comparison</span></div>
      </div>
      <div class="ns-compare-grid">
        <div class="ns-compare-col">
          <div class="ns-compare-col-head">${h(a)}</div>
          ${nutRows(data.nutrition_a)}
        </div>
        <div class="ns-compare-col">
          <div class="ns-compare-col-head">${h(b)}</div>
          ${nutRows(data.nutrition_b)}
        </div>
      </div>
      ${llm(data.llm_response)}
      ${footer()}
    `
  }

  function renderModification(data) {
    const name = (data.recipe_name || 'Recipe').replace(/\s*\(Estimated\)\s*/i, '').trim()
    return `
      ${data.estimated ? estBar() : ''}
      <div class="ns-head">
        <div class="ns-name">${h(name)}</div>
        <div class="ns-meta">
          <span class="ns-tag">Modified</span>
          ${data.constraint ? `<span class="ns-tag">${h(data.constraint)}</span>` : ''}
        </div>
      </div>
      ${nutRows(data.nutrition)}
      ${llm(data.llm_response)}
      ${footer()}
    `
  }

  function renderSearch(data) {
    if (!data.results?.length) {
      return `<div class="ns-head"><div class="ns-name">No results</div></div>
        <div class="ns-empty">Nothing found for "${h(data.query)}"</div>${footer()}`
    }
    const items = data.results.slice(0, 6).map((r) => `
      <div class="ns-result">
        <div class="ns-result-left">
          <div class="ns-result-name">${h(r.name)}</div>
          <div class="ns-result-sub">${[r.brand, r.cluster].filter(Boolean).map(h).join(' · ')}</div>
        </div>
        <div class="ns-result-right">
          ${r.calories != null ? `<div class="ns-result-cal">${Math.round(r.calories)} kcal</div>` : ''}
          ${interactBtns(r.id, r.cluster, r.interaction_state)}
        </div>
      </div>`).join('')
    return `
      <div class="ns-head">
        <div class="ns-name">${h(data.query)}</div>
        <div class="ns-meta"><span class="ns-conf">${data.results.length} results</span></div>
      </div>
      ${items}
      ${llm(data.llm_response)}
      ${footer()}
    `
  }

  function renderData(data, query) {
    if (data.error) return `<div class="ns-head"><div class="ns-name">Error</div></div><div class="ns-error">${h(data.error)}</div>`
    switch (data.pathway) {
      case 'extraction': case 'estimation': return renderExtraction(data)
      case 'comparison':   return renderComparison(data)
      case 'modification': return renderModification(data)
      case 'search':       return renderSearch(data)
      default:             return renderExtraction({ ...data, recipe_name: query })
    }
  }

  // ── Announce extension presence to the app ────────────────────────────────
  // Fires a DOM event so the app can re-broadcast its current session
  // immediately — handles the case where the extension was installed while
  // the user was already logged in (no login/logout event would fire).
  window.dispatchEvent(new CustomEvent('nutrisense-ext-connected'))

  // ── Auth bridge (catches postMessage from NutriSense app) ────────────────────

  window.addEventListener('message', (e) => {
    if (e.data?.type !== 'NUTRISENSE_EXT_AUTH') return
    // Only accept from the same origin (app page) or known NutriSense hosts
    const origin = e.origin || ''
    const ALLOWED_ORIGINS = new Set([
      'https://nutrisense-ai-c8f2anche0b6a8be.southeastasia-01.azurewebsites.net',
      'https://nutrisense.app',
      'https://app.nutrisense.app',
      'http://localhost:5173',
      'http://localhost:3000',
    ])
    const allowed = origin === window.location.origin || ALLOWED_ORIGINS.has(origin)
    if (!allowed) return
    chrome.runtime.sendMessage({
      type: 'SYNC_AUTH',
      refreshToken: e.data.refreshToken || null,
      user: e.data.user || null,
    }).catch(() => {})
  })

  // ── Message listener ──────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'REQUEST_AUTH_SYNC':
        // Background asked us to re-trigger the app's auth broadcast
        window.dispatchEvent(new CustomEvent('nutrisense-ext-connected'))
        break
      case 'SHOW_LOADING':
        showPanel(`<div class="ns-loading"><div class="ns-ring"></div><span>${h(msg.message || 'Loading…')}</span></div>`)
        break
      case 'SHOW_NUTRITION':
        showPanel(renderData(msg.data, msg.query))
        break
      case 'SHOW_ERROR':
        showPanel(`<div class="ns-head"><div class="ns-name">Error</div></div><div class="ns-error">${h(msg.message)}</div>`)
        break
    }
  })
})()
