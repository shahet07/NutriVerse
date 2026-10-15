import { useState, useEffect } from 'react'
import { Minus, Square, X } from 'lucide-react'

declare global {
  interface Window {
    desktopWindow?: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (cb: (val: boolean) => void) => () => void
    }
  }
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!window.desktopWindow) return
    window.desktopWindow.isMaximized().then(setMaximized)
    return window.desktopWindow.onMaximizeChange(setMaximized)
  }, [])

  if (!window.desktopWindow) return null

  return (
    <div
      className="flex items-center justify-between select-none shrink-0"
      style={{
        height: '32px',
        backgroundColor: 'rgba(10, 10, 12, 0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 px-4">
        <img src="./icons/icon16.png" width={13} height={13} alt="" className="opacity-70" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <span className="text-[11px] font-medium tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>
          NutriVerse
        </span>
      </div>

      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => window.desktopWindow?.minimize()}
          className="flex items-center justify-center h-full px-5 transition-colors duration-150"
          style={{ color: 'rgba(255,255,255,0.4)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          title="Minimize"
        >
          <Minus size={11} strokeWidth={2} />
        </button>
        <button
          onClick={() => window.desktopWindow?.maximize()}
          className="flex items-center justify-center h-full px-5 transition-colors duration-150"
          style={{ color: 'rgba(255,255,255,0.4)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          <Square size={10} strokeWidth={2} />
        </button>
        <button
          onClick={() => window.desktopWindow?.close()}
          className="flex items-center justify-center h-full px-5 transition-colors duration-150"
          style={{ color: 'rgba(255,255,255,0.4)' }}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'rgba(232,17,35,0.85)'
            e.currentTarget.style.color = 'rgba(255,255,255,0.9)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = 'rgba(255,255,255,0.4)'
          }}
          title="Close"
        >
          <X size={11} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
