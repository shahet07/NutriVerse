const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron')
const path = require('path')
const os = require('os')
const http = require('http')
const crypto = require('crypto')
const keytar = require('keytar')

const APP_PROTOCOL = 'nutrisense'
const AUTH_CHANNEL = 'on-auth-success'
const CREDENTIAL_SERVICE = 'NutriVerse'
const CREDENTIAL_ACCOUNT = 'refresh-token'

const DESKTOP_CLIENT_ID = '41453765044-9nt3ti03gu5f1ur8bj2t9kfhnhhs22i1.apps.googleusercontent.com'

// Google explicitly permits embedding Desktop OAuth client secrets in native/
// installed apps — they are not considered secret for this client type.
// The .env file is never bundled into the APPX package, so we embed directly.
const DESKTOP_CLIENT_SECRET = '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'

// Chromium sometimes picks QUIC for googleapis.com and the handshake gets
// dropped (often by Windows Defender / corporate filters), surfacing as
// ERR_CONNECTION_CLOSED on Firebase's identitytoolkit endpoint. Forcing
// TCP+TLS avoids the broken negotiation.
app.commandLine.appendSwitch('disable-quic')

let mainWindow = null

// ── Google OAuth: system browser + loopback HTTP server ───────────────────
// System browser already has the user's Google accounts logged in, so the
// account picker appears immediately (no email/password form). Google
// redirects to http://127.0.0.1:<random-port> which is served by a
// short-lived local HTTP server in the main process. Code → id_token via
// PKCE + client_secret (embedding the secret is permitted for Desktop clients).
ipcMain.handle('auth:google-sign-in', async () => {
  const clientSecret = DESKTOP_CLIENT_SECRET

  const codeVerifier = crypto.randomBytes(64).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('base64url')

  return new Promise((resolve, reject) => {
    let settled = false
    let timeoutId = null
    let redirectUri = ''

    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1')
      if (reqUrl.pathname !== '/') {
        res.writeHead(404).end()
        return
      }

      const code = reqUrl.searchParams.get('code')
      const returnedState = reqUrl.searchParams.get('state')
      const oauthError = reqUrl.searchParams.get('error')

      if (oauthError || !code || returnedState !== state) {
        const msg = oauthError || 'Invalid response from Google.'
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
           .end(renderCallbackPage({ ok: false, message: msg }))
        settle(() => reject(new Error(oauthError || 'auth/invalid-response')))
        return
      }

      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: DESKTOP_CLIENT_ID,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            code_verifier: codeVerifier,
          }),
        })
        const tokens = await tokenRes.json()
        if (tokens.id_token) {
          // Wait for the socket to drain BEFORE resolving the IPC — otherwise
          // closing the server can drop the response and the browser never
          // navigates to the callback page (hence no deep-link redirect).
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(renderCallbackPage({ ok: true }), () => {
            settle(() => resolve({ idToken: tokens.id_token }))
          })
        } else {
          const msg = tokens.error_description || 'Token exchange failed.'
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(renderCallbackPage({ ok: false, message: msg }), () => {
            settle(() => reject(new Error(msg)))
          })
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(renderCallbackPage({ ok: false, message: 'Network error during token exchange.' }), () => {
          settle(() => reject(err))
        })
      }
    })

    const settle = (fn) => {
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      server.close()
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
      fn()
    }

    server.on('error', (err) => settle(() => reject(err)))

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      redirectUri = `http://127.0.0.1:${port}`

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', DESKTOP_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'openid email profile')
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('prompt', 'select_account')

      void shell.openExternal(authUrl.toString())

      timeoutId = setTimeout(() => settle(() => reject(new Error('auth/timeout'))), 5 * 60 * 1000)
    })
  })
})

// Callback page shown in the user's browser after Google redirects back.
// On success: navigates to nutrisense://auth/done, which triggers the OS to
// refocus the already-running Electron instance via the second-instance
// handler + handleDeepLink. The tab also attempts to close itself.
function renderCallbackPage({ ok, message }) {
  const title = ok ? 'Signed in · NutriVerse' : 'Sign-in failed · NutriVerse'
  const heading = ok ? "You're signed in" : 'Something went wrong'
  const body = ok
    ? 'Returning you to NutriVerse…'
    : (message || 'Please close this tab and try again.')
  const accent = ok ? '#4ADE80' : '#F87171'
  const deepLink = `${APP_PROTOCOL}://auth/done`
  const returnScript = ok
    ? `<script>
        (function(){
          var returned = false;
          function goBack(){ if(returned) return; returned = true; window.location.href = ${JSON.stringify(deepLink)}; }
          setTimeout(goBack, 400);
          setTimeout(function(){ try{ window.close() }catch(e){} }, 1500);
        })();
      </script>`
    : ''
  const manualLink = ok
    ? `<a href="${deepLink}" class="back">Return to NutriVerse</a>`
    : ''
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  html,body{margin:0;height:100%;background:#0A0A0A;color:#fff;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
  .wrap{display:flex;align-items:center;justify-content:center;height:100%;}
  .card{max-width:420px;padding:40px;text-align:center;}
  .dot{width:10px;height:10px;border-radius:50%;background:${accent};margin:0 auto 22px;
    box-shadow:0 0 24px ${accent}55;}
  h1{font-size:22px;font-weight:600;margin:0 0 10px;letter-spacing:-0.02em;}
  p{font-size:14px;color:rgba(255,255,255,0.55);line-height:1.55;margin:0;}
  .back{display:inline-block;margin-top:22px;padding:10px 18px;border-radius:10px;
    background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);
    color:#fff;text-decoration:none;font-size:13px;}
  .back:hover{background:rgba(255,255,255,0.10);}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="dot"></div>
  <h1>${heading}</h1>
  <p>${body}</p>
  ${manualLink}
</div></div>
${returnScript}
</body></html>`
}

// ── Deep link dispatcher ───────────────────────────────────────────────────
function handleDeepLink(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${APP_PROTOCOL}:`) return
    const normalizedPath = `${url.hostname}${url.pathname}`.replace(/^\/+/, '')
    if (!normalizedPath.startsWith('auth')) return
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    const token = url.searchParams.get('token')
    if (token) mainWindow?.webContents.send(AUTH_CHANNEL, { firebaseIdToken: token })
  } catch {
    // malformed URL — ignore
  }
}

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    icon: path.join(__dirname, '../../icon/app_logo.png'),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.maximize()

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false))

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
    mainWindow.loadURL(rendererUrl)
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── Single instance + protocol ─────────────────────────────────────────────
function registerProtocol() {
  // In dev mode Windows invokes the handler with CWD=C:\WINDOWS\system32, so
  // argv[1] MUST be an absolute path — path.resolve expands it per-user at
  // runtime, no hardcoding required.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ])
    }
    return
  }
  app.setAsDefaultProtocolClient(APP_PROTOCOL)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`))
    if (deepLink) handleDeepLink(deepLink)
  })
}

app.whenReady().then(() => {
  registerProtocol()
  createWindow()

  if (process.platform === 'darwin') {
    app.on('open-url', (event, url) => {
      event.preventDefault()
      handleDeepLink(url)
    })
  } else {
    const deepLink = process.argv.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`))
    if (deepLink) handleDeepLink(deepLink)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ── IPC ────────────────────────────────────────────────────────────────────
ipcMain.handle('system:get-lan-ip', () => {
  const nets = os.networkInterfaces()
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
})

ipcMain.handle('auth:open-system-browser', async (_event, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Only HTTPS auth URLs are allowed.')
  }
  await shell.openExternal(url)
})

ipcMain.handle('auth:store-refresh-token', async (_event, refreshToken) => {
  if (typeof refreshToken !== 'string' || refreshToken.length < 10) {
    throw new Error('Invalid refresh token payload.')
  }
  await keytar.setPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT, refreshToken)
})

ipcMain.handle('auth:get-refresh-token', async () => {
  return keytar.getPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
})

ipcMain.handle('auth:clear-refresh-token', async () => {
  await keytar.deletePassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
