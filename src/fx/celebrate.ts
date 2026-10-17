// Celebration effects built on canvas-confetti. One function per EffectId.
// Respects prefers-reduced-motion (no particles at all) and never throws.

import confetti from 'canvas-confetti'
import type { EffectId } from '../types.ts'

export interface CelebrateOptions {
  /** Where bursts start, 0..1 of the viewport (default: centre / sides per effect). */
  origin?: { x: number; y: number }
  /** 0.5 = small (e.g. a purchase), 1 = normal, 1.5 = big (level up). Default 1. */
  intensity?: number
  /** Emojis for 'emoji-rain' (default: a party mix). */
  emojis?: string[]
  /** Override the colour palette. */
  colors?: string[]
  /** Ignore prefers-reduced-motion (e.g. a preview button in the shop). */
  force?: boolean
}

export const EFFECT_NAMES: Record<EffectId, string> = {
  confetti: 'Confetti',
  stars: 'Shooting Stars',
  fireworks: 'Fireworks',
  'emoji-rain': 'Emoji Rain',
  'coin-shower': 'Coin Shower',
  rainbow: 'Rainbow Blast',
}

const Z = 2500 // above modals (1000) and toasts (1500)
const PARTY = ['#6c4bf4', '#ffb800', '#22c55e', '#3b82f6', '#ef4444', '#ec4899', '#06b6d4']
const RAINBOW = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#6366f1', '#a855f7']
const GOLD = ['#ffb800', '#ffd84d', '#f59e0b', '#fff3b0']
const DEFAULT_EMOJIS = ['🎉', '⭐', '🏆', '♟️', '🦉', '👑', '💎']

type Shape = confetti.Shape
type Opts = confetti.Options

let timers: number[] = []
/** Pending animation-frame id of every running stream (one entry per stream). */
const streams = new Set<{ raf: number }>()

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const textShapeCache = new Map<string, Shape | null>()

/** confetti.shapeFromText needs OffscreenCanvas; fall back to null when unavailable. */
function textShape(text: string, scalar: number): Shape | null {
  const key = `${text}@${scalar}`
  if (textShapeCache.has(key)) return textShapeCache.get(key) ?? null
  let shape: Shape | null = null
  try {
    const fn = (confetti as unknown as { shapeFromText?: typeof confetti.shapeFromText }).shapeFromText
    if (typeof fn === 'function' && typeof OffscreenCanvas !== 'undefined') {
      shape = fn({ text, scalar })
    }
  } catch {
    shape = null
  }
  textShapeCache.set(key, shape)
  return shape
}

function fire(opts: Opts): void {
  try {
    void confetti({ zIndex: Z, disableForReducedMotion: false, ...opts })
  } catch {
    /* ignore */
  }
}

function later(ms: number, fn: () => void): void {
  if (typeof window === 'undefined') return
  const id = window.setTimeout(() => {
    timers = timers.filter((t) => t !== id)
    fn()
  }, ms)
  timers.push(id)
}

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/**
 * Run `frame` every animation frame for `ms` milliseconds. Streams are
 * independent: overlapping effects (e.g. emoji rain, then a level-up coin
 * shower) both run to the end; stopCelebration() cancels them all.
 */
function stream(ms: number, frame: () => void): void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return
  const end = performance.now() + ms
  const handle = { raf: 0 }
  const tick = () => {
    try {
      frame()
    } catch {
      /* ignore */
    }
    if (performance.now() < end && streams.has(handle)) handle.raf = window.requestAnimationFrame(tick)
    else streams.delete(handle)
  }
  streams.add(handle)
  handle.raf = window.requestAnimationFrame(tick)
}

/** Number of streaming effects still running (for tests / debugging). */
export function activeStreamCount(): number {
  return streams.size
}

function effectConfetti(k: number, o: CelebrateOptions): number {
  const colors = o.colors ?? PARTY
  const origin = o.origin ?? { x: 0.5, y: 0.6 }
  fire({ particleCount: Math.round(90 * k), spread: 75, startVelocity: 48, origin, colors, scalar: 1.1 })
  later(180, () => {
    fire({ particleCount: Math.round(45 * k), angle: 60, spread: 60, origin: { x: 0, y: 0.75 }, colors })
    fire({ particleCount: Math.round(45 * k), angle: 120, spread: 60, origin: { x: 1, y: 0.75 }, colors })
  })
  return 1800
}

function effectStars(k: number, o: CelebrateOptions): number {
  const colors = o.colors ?? ['#ffe066', '#ffd43b', '#fab005', '#fff9db', '#ffffff']
  const origin = o.origin ?? { x: 0.5, y: 0.45 }
  const base: Opts = {
    spread: 360,
    ticks: 70,
    gravity: 0,
    decay: 0.94,
    startVelocity: 26,
    shapes: ['star'],
    colors,
    origin,
  }
  const shoot = () => {
    fire({ ...base, particleCount: Math.round(36 * k), scalar: 1.25 })
    fire({ ...base, particleCount: Math.round(14 * k), scalar: 0.8, shapes: ['circle'] })
  }
  shoot()
  later(140, shoot)
  later(300, shoot)
  return 1500
}

function effectFireworks(k: number, o: CelebrateOptions): number {
  const duration = 2600 * Math.min(1.4, Math.max(0.6, k))
  const colors = o.colors
  const bursts = Math.round(7 * k)
  for (let i = 0; i < bursts; i++) {
    later(i * (duration / bursts), () => {
      const palette = colors ?? [RAINBOW[Math.floor(Math.random() * RAINBOW.length)], '#ffffff', '#ffd84d']
      fire({
        particleCount: Math.round(70 * Math.max(0.6, k)),
        startVelocity: 32,
        spread: 360,
        ticks: 70,
        gravity: 0.9,
        decay: 0.92,
        scalar: 1,
        origin: { x: rand(0.15, 0.85), y: rand(0.15, 0.45) },
        colors: palette,
      })
    })
  }
  return duration + 800
}

function effectEmojiRain(k: number, o: CelebrateOptions): number {
  const emojis = o.emojis && o.emojis.length ? o.emojis : DEFAULT_EMOJIS
  const scalar = 2.4
  const shapes = emojis.map((e) => textShape(e, scalar)).filter((s): s is Shape => s !== null)
  const duration = 2400 * Math.min(1.4, Math.max(0.6, k))
  if (shapes.length === 0) {
    // No OffscreenCanvas (older iOS): rain coloured circles instead.
    stream(duration, () => {
      fire({ particleCount: 2, angle: 270, spread: 30, startVelocity: 8, gravity: 0.8, ticks: 300, origin: { x: Math.random(), y: -0.05 }, colors: PARTY, shapes: ['circle'], scalar: 1.4 })
    })
    return duration + 2500
  }
  let n = 0
  stream(duration, () => {
    n++
    if (n % 2 !== 0) return
    fire({
      particleCount: 1,
      angle: 270,
      spread: 20,
      startVelocity: 6,
      gravity: 0.7,
      drift: rand(-0.4, 0.4),
      ticks: 320,
      flat: true,
      scalar,
      shapes: [shapes[Math.floor(Math.random() * shapes.length)]],
      origin: { x: Math.random(), y: -0.08 },
    })
  })
  return duration + 3000
}

function effectCoinShower(k: number, o: CelebrateOptions): number {
  const scalar = 2.2
  const coin = textShape('🪙', scalar)
  const duration = 2000 * Math.min(1.4, Math.max(0.6, k))
  const colors = o.colors ?? GOLD
  // Opening pop of gold from the origin.
  fire({ particleCount: Math.round(60 * k), spread: 80, startVelocity: 42, origin: o.origin ?? { x: 0.5, y: 0.55 }, colors, shapes: ['circle'], scalar: 1.1 })
  let n = 0
  stream(duration, () => {
    n++
    if (coin) {
      if (n % 2 !== 0) return
      fire({
        particleCount: 1,
        angle: 270,
        spread: 25,
        startVelocity: 10,
        gravity: 1.1,
        ticks: 240,
        flat: true,
        scalar,
        shapes: [coin],
        origin: { x: Math.random(), y: -0.08 },
      })
    } else {
      fire({ particleCount: 2, angle: 270, spread: 25, startVelocity: 10, gravity: 1.1, ticks: 240, origin: { x: Math.random(), y: -0.05 }, colors, shapes: ['circle'], scalar: 1.5 })
    }
  })
  return duration + 2500
}

function effectRainbow(k: number, o: CelebrateOptions): number {
  const colors = o.colors ?? RAINBOW
  const duration = 1800 * Math.min(1.4, Math.max(0.6, k))
  let i = 0
  stream(duration, () => {
    const c = [colors[i++ % colors.length]]
    fire({ particleCount: 3, angle: 60, spread: 55, startVelocity: 58, origin: { x: 0, y: 0.8 }, colors: c, scalar: 1.1 })
    fire({ particleCount: 3, angle: 120, spread: 55, startVelocity: 58, origin: { x: 1, y: 0.8 }, colors: c, scalar: 1.1 })
  })
  later(duration * 0.5, () => {
    fire({ particleCount: Math.round(80 * k), spread: 120, startVelocity: 40, origin: o.origin ?? { x: 0.5, y: 0.5 }, colors, shapes: ['star', 'circle'], scalar: 1.2 })
  })
  return duration + 1800
}

const EFFECTS: Record<EffectId, (k: number, o: CelebrateOptions) => number> = {
  confetti: effectConfetti,
  stars: effectStars,
  fireworks: effectFireworks,
  'emoji-rain': effectEmojiRain,
  'coin-shower': effectCoinShower,
  rainbow: effectRainbow,
}

/**
 * Play a celebration. Resolves (roughly) when the particles are gone.
 * Unknown ids fall back to 'confetti'. With reduced motion it resolves immediately.
 */
export function celebrate(effect: EffectId | string, opts: CelebrateOptions = {}): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (!opts.force && prefersReducedMotion()) return Promise.resolve()
  const run = Object.prototype.hasOwnProperty.call(EFFECTS, effect) ? EFFECTS[effect as EffectId] : EFFECTS.confetti
  const k = Math.max(0.3, Math.min(2, opts.intensity ?? 1))
  let ms = 1500
  try {
    ms = run(k, opts)
  } catch {
    ms = 0
  }
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** Stop everything immediately (e.g. when leaving a screen). */
export function stopCelebration(): void {
  for (const t of timers) clearTimeout(t)
  timers = []
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    for (const s of streams) window.cancelAnimationFrame(s.raf)
  }
  streams.clear()
  try {
    confetti.reset()
  } catch {
    /* ignore */
  }
}
