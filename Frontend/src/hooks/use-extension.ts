import { useEffect, useState } from 'react'

const EXTENSION_ID = 'ekeccifmanfpnoncndkodionjocbmcff'
const STORE_URL =
  'https://chromewebstore.google.com/detail/ekeccifmanfpnoncndkodionjocbmcff'

// Extension signals its presence in any of three ways (content script sets these):
//   1. document.documentElement.setAttribute('data-nutrisense-ext', '1')
//   2. window.__nutrisenseExtension = true
//   3. localStorage.setItem('nutrisense-ext-installed', 'true')
// Once externally_connectable is configured we also ping via chrome.runtime.
declare global {
  interface Window {
    __nutrisenseExtension?: boolean
    chrome?: {
      runtime?: {
        sendMessage?: (id: string, msg: unknown, cb: (r: unknown) => void) => void
      }
    }
  }
}

function detectExtension(): boolean {
  if (document.documentElement.hasAttribute('data-nutrisense-ext')) return true
  if (window.__nutrisenseExtension) return true
  if (localStorage.getItem('nutrisense-ext-installed') === 'true') return true
  return false
}

async function pingExtension(): Promise<boolean> {
  try {
    const cr = window.chrome
    if (!cr?.runtime?.sendMessage) return false
    return await new Promise<boolean>((resolve) => {
      cr.runtime!.sendMessage!(EXTENSION_ID, { type: 'ping' }, (response) => {
        resolve(!!response)
      })
      // Timeout — if extension doesn't respond within 300ms it's not installed
      setTimeout(() => resolve(false), 300)
    })
  } catch {
    return false
  }
}

export function useExtension() {
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      if (detectExtension()) {
        if (!cancelled) setInstalled(true)
        return
      }
      const pinged = await pingExtension()
      if (!cancelled) setInstalled(pinged)
    }

    check()

    // Re-check after a short delay — content scripts run after page load
    const t = setTimeout(check, 1200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [])

  return { installed, storeUrl: STORE_URL }
}
