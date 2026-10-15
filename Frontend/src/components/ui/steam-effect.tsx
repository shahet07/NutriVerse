import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
//  NutriSense · Steam Engine v4 – "Real Steam"
//
//  Fixes from v3:
//    · Gradual spawn ramp — 0 particles at load, ~2/frame trickling in over 4s
//    · Tighter spawn arc matching the food surface, not the bowl rim edges
//    · Far fewer particles (65+40+12) at lower alpha → wispy, not a wall
//    · Bottom fade: particles are invisible at birth and only appear as they
//      rise slightly, creating a natural "emerging from the food" connection
//    · Gentler, slower movement — real steam doesn't rush upward
// ─────────────────────────────────────────────────────────────────────────────

// ── Spawn arc — 5 points hugging the food surface ────────────────────────────
const FOOD_ZONES = [
  { xFrac: 0.730, yFrac: 0.488 },
  { xFrac: 0.765, yFrac: 0.475 },
  { xFrac: 0.800, yFrac: 0.470 },   // centre of food
  { xFrac: 0.835, yFrac: 0.475 },
  { xFrac: 0.870, yFrac: 0.488 },
]
const ATTRACT_X = 0.800   // gentle pull target

// Pool caps
const N_VOLUME  = 90
const N_TENDRIL = 55
const N_CORE    = 18

// Peak alpha per layer — more visible but still translucent
const A_VOLUME  = 0.062
const A_TENDRIL = 0.085
const A_CORE    = 0.072

// How many NEW particles we allow per frame (controls ramp-up)
const SPAWN_PER_FRAME = 6

// ── Types ────────────────────────────────────────────────────────────────────
interface Particle {
  x: number; y: number
  vx: number; vy: number
  angle: number; angVel: number
  rx: number; ry: number
  life: number; maxLife: number
  wobble: number; wobbleSpeed: number
  f1: number; f2: number; f3: number
  hue: number; spawnY: number
  layer: 'volume' | 'tendril' | 'core'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Smooth raised-cosine envelope — slow 25 % fade-in, long 50 % tail */
const env = (t: number, peak: number): number => {
  if (t < 0.25) return peak * (0.5 - 0.5 * Math.cos(Math.PI * (t / 0.25)))
  if (t < 0.45) return peak
  const u = (t - 0.45) / 0.55
  return peak * Math.pow(1 - u, 2.0)
}

/** Warm grey-blue palette shifting cooler as smoke rises */
const smokeRGB = (hue: number, rise: number): [number, number, number] => {
  const warm = Math.max(0, 1 - rise * 2.2)
  return [
    Math.max(0, Math.min(255, Math.round(170 + warm * 35 + Math.sin(hue * 6.28) * 8))),
    Math.max(0, Math.min(255, Math.round(178 + warm * 18 + Math.sin(hue * 5.1)  * 6))),
    Math.max(0, Math.min(255, Math.round(205 +              Math.cos(hue * 4.8)  * 10))),
  ]
}

/** Cheap 2D curl turbulence from layered sin fields */
const curl = (x: number, y: number, t: number): [number, number] => {
  const s = 0.0015
  return [
    Math.sin(y * s + t * 0.0007) * 0.22 +
    Math.sin(y * s * 2.4 - t * 0.0010) * 0.10 +
    Math.cos(x * s * 1.6 + y * s * 0.8 + t * 0.0005) * 0.06,

    Math.cos(x * s + t * 0.0006) * 0.07 +
    Math.sin(x * s * 2.0 + y * s - t * 0.0008) * 0.03,
  ]
}

// ── Component ────────────────────────────────────────────────────────────────
export function SteamEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef  = useRef(0)
  const tickRef   = useRef(0)
  const volRef    = useRef<Particle[]>([])
  const tendRef   = useRef<Particle[]>([])
  const coreRef   = useRef<Particle[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize()
    window.addEventListener('resize', resize)

    // Random food-surface spawn point
    const zone = () => {
      const z = FOOD_ZONES[Math.floor(Math.random() * FOOD_ZONES.length)]
      return { zx: canvas.width * z.xFrac, zy: canvas.height * z.yFrac }
    }

    // ── Factories ────────────────────────────────────────────────────────
    const mkVolume = (): Particle => {
      const { zx, zy } = zone()
      const sy = zy + (Math.random() - 0.5) * canvas.height * 0.012
      const sp = 0.28 + Math.random() * 0.42   // SLOW rise
      const a  = -Math.PI / 2 + (Math.random() - 0.5) * 0.50
      return {
        x: zx + (Math.random() - 0.5) * canvas.width * 0.018, y: sy, spawnY: sy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        angle: a + Math.PI / 2, angVel: (Math.random() - 0.5) * 0.008,
        rx: 3 + Math.random() * 7, ry: 16 + Math.random() * 52,
        life: 0, maxLife: 350 + Math.random() * 600,
        wobble: Math.random() * 6.28, wobbleSpeed: (Math.random() - 0.5) * 0.012,
        f1: 0.4 + Math.random() * 0.8, f2: 1.5 + Math.random() * 1.3, f3: 3.0 + Math.random() * 1.1,
        hue: Math.random(), layer: 'volume',
      }
    }

    const mkTendril = (): Particle => {
      const { zx, zy } = zone()
      const sy = zy + (Math.random() - 0.5) * canvas.height * 0.010
      const sp = 0.40 + Math.random() * 0.55
      const a  = -Math.PI / 2 + (Math.random() - 0.5) * 0.38
      return {
        x: zx + (Math.random() - 0.5) * canvas.width * 0.014, y: sy, spawnY: sy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        angle: a + Math.PI / 2, angVel: (Math.random() - 0.5) * 0.018,
        rx: 1 + Math.random() * 3, ry: 10 + Math.random() * 34,
        life: 0, maxLife: 250 + Math.random() * 450,
        wobble: Math.random() * 6.28, wobbleSpeed: (Math.random() - 0.5) * 0.020,
        f1: 0.5 + Math.random() * 1.0, f2: 1.8 + Math.random() * 1.5, f3: 3.6 + Math.random() * 1.4,
        hue: Math.random(), layer: 'tendril',
      }
    }

    const mkCore = (): Particle => {
      const { zx, zy } = zone()
      const sy = zy + (Math.random() - 0.5) * canvas.height * 0.006
      const sp = 0.55 + Math.random() * 0.50
      const a  = -Math.PI / 2 + (Math.random() - 0.5) * 0.20
      return {
        x: zx + (Math.random() - 0.5) * canvas.width * 0.008, y: sy, spawnY: sy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        angle: a + Math.PI / 2, angVel: (Math.random() - 0.5) * 0.025,
        rx: 0.8 + Math.random() * 1.8, ry: 8 + Math.random() * 24,
        life: 0, maxLife: 180 + Math.random() * 320,
        wobble: Math.random() * 6.28, wobbleSpeed: (Math.random() - 0.5) * 0.026,
        f1: 0.6 + Math.random() * 0.8, f2: 2.2 + Math.random() * 1.2, f3: 4.2 + Math.random() * 1.4,
        hue: Math.random(), layer: 'core',
      }
    }

    // ── Physics ──────────────────────────────────────────────────────────
    const step = (p: Particle, tick: number) => {
      p.life++
      p.wobble += p.wobbleSpeed

      const [cfx, cfy] = curl(p.x, p.y, tick)
      p.vx += cfx * 0.014
      p.vy += cfy * 0.008

      p.x += p.vx + Math.sin(p.wobble * p.f1) * 0.28 +
                     Math.sin(p.wobble * p.f2 + 1.2) * 0.12 +
                     Math.cos(p.wobble * p.f3 - 0.5) * 0.04
      p.y += p.vy

      p.vy *= 0.9988
      p.vx *= 0.9980

      // Gentle spin tracking velocity
      p.angle += p.angVel
      const ta = Math.atan2(p.vx, -p.vy)
      p.angle += (((ta - p.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.03

      // Slow growth
      const gf = Math.max(0.1, 1 - p.life / p.maxLife * 0.85)
      const gr = p.layer === 'volume' ? 0.10 : p.layer === 'tendril' ? 0.03 : 0.015
      p.rx += gr * gf * 0.20
      p.ry += gr * gf

      // Very gentle column pull — keeps smoke from wandering off
      p.vx += (canvas.width * ATTRACT_X - p.x) * 0.0000040
    }

    // ── Draw ─────────────────────────────────────────────────────────────
    const draw = (p: Particle, alpha: number, r: number, g: number, b: number) => {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.angle)

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.ry)
      grad.addColorStop(0,    `rgba(${r},${g},${b},${(alpha * 0.85).toFixed(4)})`)
      grad.addColorStop(0.20, `rgba(${r},${g},${b},${(alpha * 0.72).toFixed(4)})`)
      grad.addColorStop(0.50, `rgba(${r},${g},${b},${(alpha * 0.35).toFixed(4)})`)
      grad.addColorStop(0.78, `rgba(${r},${g},${b},${(alpha * 0.10).toFixed(4)})`)
      grad.addColorStop(1,    `rgba(${r},${g},${b},0)`)

      ctx.scale(p.rx / p.ry, 1)
      ctx.beginPath()
      ctx.arc(0, 0, p.ry, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()
      ctx.restore()
    }

    // ── Warm glow at food surface ────────────────────────────────────────
    const drawGlow = () => {
      const bx = canvas.width  * ATTRACT_X
      const by = canvas.height * 0.478
      const gl = ctx.createRadialGradient(bx, by, 0, bx, by, canvas.width * 0.12)
      gl.addColorStop(0,    'rgba(230,190,125,0.028)')
      gl.addColorStop(0.55, 'rgba(210,165,100,0.010)')
      gl.addColorStop(1,    'rgba(180,140, 80,0)')
      ctx.beginPath()
      ctx.ellipse(bx, by, canvas.width * 0.12, canvas.height * 0.028, 0, 0, Math.PI * 2)
      ctx.fillStyle = gl
      ctx.fill()
    }

    // ── Main loop ────────────────────────────────────────────────────────
    const animate = () => {
      const tick = ++tickRef.current
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.globalCompositeOperation = 'screen'

      // Throttled spawn: only SPAWN_PER_FRAME new particles per frame, split
      // proportionally across layers. This prevents the burst and creates a
      // natural ~4 second build-up to steady state.
      let budget = SPAWN_PER_FRAME
      // Distribute budget across layers, prioritising volume
      while (budget > 0) {
        const roll = Math.random()
        if (roll < 0.50 && volRef.current.length < N_VOLUME) {
          volRef.current.push(mkVolume()); budget--
        } else if (roll < 0.82 && tendRef.current.length < N_TENDRIL) {
          tendRef.current.push(mkTendril()); budget--
        } else if (coreRef.current.length < N_CORE) {
          coreRef.current.push(mkCore()); budget--
        } else if (volRef.current.length < N_VOLUME) {
          volRef.current.push(mkVolume()); budget--
        } else { break }
      }

      // Cull dead
      volRef.current  = volRef.current.filter(p  => p.life < p.maxLife)
      tendRef.current = tendRef.current.filter(p => p.life < p.maxLife)
      coreRef.current = coreRef.current.filter(p => p.life < p.maxLife)

      drawGlow()

      // Helper: rise-based alpha that fades particles sitting right at the
      // food surface, making them "emerge" naturally from the dish.
      const alphaFor = (p: Particle, layerPeak: number) => {
        const t  = p.life / p.maxLife
        const rn = Math.max(0, Math.min(1, (p.spawnY - p.y) / (canvas.height * 0.40)))
        // Bottom-fade: invisible at spawnY, full visibility ~30 px above food
        const emerge = Math.min(1, (p.spawnY - p.y) / (canvas.height * 0.035))
        const shimmer = 1 + Math.sin(p.wobble * 3.5 + p.hue * 6.28) * 0.06
        const [r, g, b] = smokeRGB(p.hue, rn)
        const a = env(t, layerPeak) * shimmer * Math.max(0, emerge)
        return { a, r, g, b }
      }

      // Layer 1 — soft volume body
      for (const p of volRef.current) {
        step(p, tick)
        const { a, r, g, b } = alphaFor(p, A_VOLUME)
        if (a > 0.001) draw(p, a, r, g, b)
      }

      // Layer 2 — tendrils (mid detail)
      for (const p of tendRef.current) {
        step(p, tick)
        const { a, r, g, b } = alphaFor(p, A_TENDRIL)
        if (a > 0.001) draw(p, a, r, g, b)
      }

      // Layer 3 — core (tight, fast)
      for (const p of coreRef.current) {
        step(p, tick)
        const { a, r, g, b } = alphaFor(p, A_CORE)
        if (a > 0.001) draw(p, a, r, g, b)
      }

      ctx.globalCompositeOperation = 'source-over'
      frameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 3 }}
    />
  )
}
