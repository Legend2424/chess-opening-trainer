// UI kit regression tests (pure-logic parts). Run: node scripts/test-uikit.ts
// DOM behaviour (Modal stacking, Card keys, PinPad, TopBar, drag-layer fix) is
// covered by the in-browser self-test: /gallery.html?s=selftest
//
// Plain node + node:assert. Exits non-zero on failure.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BOARD_THEME_IDS } from '../src/types.ts'
import {
  BOARD_THEMES,
  BOARD_THEME_LIST,
  boardThemeById,
  coordinateHalo,
  highlightColors,
  isDarkSquare,
  notationColors,
  squareBaseStyle,
  type BoardTheme,
} from '../src/theme/boards.ts'
import { isTopModal, openModalCount, popModal, pushModal } from '../src/components/ui/modalStack.ts'

let passed = 0
const failures: string[] = []
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (e) {
    failures.push(name)
    console.error(`  FAIL ${name}\n   ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  }
}

// ---------------------------------------------------------------------------
// Colour maths (sRGB, WCAG contrast, CIE76 ΔE) and a rough square sampler
// ---------------------------------------------------------------------------

type RGBA = { r: number; g: number; b: number; a: number }

function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  let m = s.match(/^#([0-9a-f]{3})$/)
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16))
    return { r, g, b, a: 1 }
  }
  m = s.match(/^#([0-9a-f]{6})$/)
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 }
  m = s.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x))
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }
  }
  m = s.match(/^hsla?\(([^)]+)\)$/)
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x))
    const [h, sat, l] = [p[0], p[1] / 100, p[2] / 100]
    const k = (n: number) => (n + h / 30) % 12
    const a = sat * Math.min(l, 1 - l)
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: p[3] ?? 1 }
  }
  throw new Error(`unparsed colour ${input}`)
}

function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 }
}
function lin(c: number): number {
  c /= 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function luminance(c: RGBA): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}
function contrast(a: RGBA, b: RGBA): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
function lab(c: RGBA): [number, number, number] {
  const R = lin(c.r)
  const G = lin(c.g)
  const B = lin(c.b)
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}
function deltaE(a: RGBA, b: RGBA): number {
  const A = lab(a)
  const B = lab(b)
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2])
}
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
type Stop = { c: RGBA; pos: number }
type Grad = { radial: boolean; stops: Stop[] }
/** Parses linear/radial gradients; returns null for tiny px-sized decorations (galaxy stars). */
function parseGradient(layer: string): Grad | null {
  const m = layer.match(/^(linear|radial)-gradient\((.*)\)$/s)
  if (!m) return null
  const parts = splitTop(m[2])
  if (parts.some((p) => /\dpx/.test(p))) return null
  const raw: { c: RGBA; pos: number | null }[] = []
  for (const p of parts) {
    const cm = p.match(/^(#[0-9a-f]+|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent)\s*([\d.]+%)?/i)
    if (cm) raw.push({ c: parseColor(cm[1]), pos: cm[2] ? parseFloat(cm[2]) / 100 : null })
  }
  if (raw.length === 0) return null
  raw[0].pos ??= 0
  raw[raw.length - 1].pos ??= 1
  for (let i = 1; i < raw.length - 1; i++) raw[i].pos ??= (raw[i - 1].pos! + 1) / 2
  return { radial: m[1] === 'radial', stops: raw as Stop[] }
}
function gradAt(g: Grad, t: number): RGBA {
  const s = g.stops
  if (t <= s[0].pos) return s[0].c
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].pos) {
      const a = s[i - 1].c.a === 0 ? { ...s[i].c, a: 0 } : s[i - 1].c
      const b = s[i].c.a === 0 ? { ...s[i - 1].c, a: 0 } : s[i].c
      const k = (t - s[i - 1].pos) / Math.max(1e-6, s[i].pos - s[i - 1].pos)
      return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: a.a + (b.a - a.a) * k }
    }
  }
  return s[s.length - 1].c
}
/**
 * Approximate colour of a square at position t along its top-left -> bottom-right
 * diagonal: backgroundColor + backgroundImage layers (radial layers sampled by
 * distance from a 30%/30% centre). Textured themes (transparent squares) use
 * their swatch colours.
 */
function squareColorAt(theme: BoardTheme, square: string, t: number): RGBA {
  const dark = isDarkSquare(square)
  const fallback = parseColor(dark ? theme.swatch[1] : theme.swatch[0])
  const st = squareBaseStyle(theme, square)
  let c = st.backgroundColor ? parseColor(String(st.backgroundColor)) : fallback
  if (c.a < 1) c = over(c, fallback)
  if (st.backgroundImage) {
    const layers = splitTop(String(st.backgroundImage))
      .map(parseGradient)
      .filter((g): g is Grad => g !== null)
    for (const g of layers.reverse()) {
      const tt = g.radial ? Math.min(1, (Math.abs(t - 0.3) * Math.SQRT2) / 0.99) : t
      c = over(gradAt(g, tt), c)
    }
  }
  return c
}

const SQUARES: string[] = []
for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) SQUARES.push(f + r)

/** Worst-case contrast of a theme's coordinate labels where they are drawn. */
function minCoordinateContrast(theme: BoardTheme): { value: number; where: string } {
  const ink = notationColors(theme)
  let worst = { value: Infinity, where: '' }
  for (const sq of SQUARES) {
    const color = parseColor(isDarkSquare(sq) ? ink.dark : ink.light)
    const probes: [number, string][] = []
    // Rank labels sit top-left of the edge files, file labels bottom-right of the edge ranks.
    if (sq[0] === 'a' || sq[0] === 'h') probes.push([0.1, 'rank label'])
    if (sq[1] === '1' || sq[1] === '8') probes.push([0.9, 'file label'])
    for (const [t, what] of probes) {
      const v = contrast(color, squareColorAt(theme, sq, t))
      if (v < worst.value) worst = { value: v, where: `${sq} ${what}` }
    }
  }
  return worst
}

// ---------------------------------------------------------------------------
// boards.ts
// ---------------------------------------------------------------------------

await test('boardThemeById: every real id resolves to itself', () => {
  for (const id of BOARD_THEME_IDS) assert.equal(boardThemeById(id).id, id)
})

await test('boardThemeById: unknown / empty / prototype keys fall back to green (review #2)', () => {
  const bad = ['', 'nope', 'GREEN', 'constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', 'isPrototypeOf']
  for (const id of bad) {
    const t = boardThemeById(id)
    assert.equal(t, BOARD_THEMES.green, `id ${JSON.stringify(id)}`)
    // The crash path from the review: notationColors() during ChessBoard render.
    assert.doesNotThrow(() => notationColors(t))
    assert.doesNotThrow(() => highlightColors(t))
  }
  assert.equal(boardThemeById(null), BOARD_THEMES.green)
  assert.equal(boardThemeById(undefined), BOARD_THEMES.green)
})

await test('every theme: light/dark backgroundColor, notation and frame present', () => {
  assert.equal(BOARD_THEME_LIST.length, BOARD_THEME_IDS.length)
  for (const t of BOARD_THEME_LIST) {
    assert.ok(t.light.backgroundColor, `${t.id} light`)
    assert.ok(t.dark.backgroundColor, `${t.id} dark`)
    assert.ok(t.notation, `${t.id} notation`)
    assert.ok(t.frame, `${t.id} frame`)
  }
})

// Themes whose labels sit over a strong light-to-dark gradient / wood grain;
// they rely on coordinateHalo() and are held to a lower bar.
const SOFT_COORDS: Record<string, number> = { lava: 2.4, brown: 2.4, marble: 2.4 }

await test('coordinate labels readable on every theme (review #5: rainbow, ice)', () => {
  const report: string[] = []
  for (const t of BOARD_THEME_LIST) {
    const { value, where } = minCoordinateContrast(t)
    const min = SOFT_COORDS[t.id] ?? 3
    if (value < min) report.push(`${t.id}: ${value.toFixed(2)} < ${min} at ${where}`)
  }
  assert.deepEqual(report, [])
})

await test('coordinateHalo: dark halo behind light ink, light halo behind dark ink', () => {
  assert.match(coordinateHalo('#ffffff'), /rgba\(20, 12, 40/)
  assert.match(coordinateHalo('#f4f4dc'), /rgba\(20, 12, 40/)
  assert.match(coordinateHalo('#241c52'), /rgba\(255, 255, 255/)
  assert.match(coordinateHalo('#5f7d45'), /rgba\(255, 255, 255/)
  assert.equal(typeof coordinateHalo('not-a-colour'), 'string')
})

await test('last-move and selection tints visible on every square of every theme (review #5: rainbow)', () => {
  const report: string[] = []
  for (const t of BOARD_THEME_LIST) {
    const hl = highlightColors(t)
    const last = parseColor(hl.lastMove)
    const sel = parseColor(hl.selected)
    let minLast = Infinity
    let minSel = Infinity
    let minBoth = Infinity
    for (const sq of SQUARES) {
      for (const pos of [0.1, 0.5, 0.9]) {
        const base = squareColorAt(t, sq, pos)
        const withLast = over(last, base)
        const withSel = over(sel, base)
        minLast = Math.min(minLast, deltaE(base, withLast))
        minSel = Math.min(minSel, deltaE(base, withSel))
        minBoth = Math.min(minBoth, deltaE(withLast, withSel))
      }
    }
    if (minLast < 20) report.push(`${t.id}: last move ΔE ${minLast.toFixed(1)}`)
    if (minSel < 20) report.push(`${t.id}: selection ΔE ${minSel.toFixed(1)}`)
    if (minBoth < 18) report.push(`${t.id}: last move vs selection ΔE ${minBoth.toFixed(1)}`)
  }
  assert.deepEqual(report, [])
})

await test('rainbow dark squares keep reading as dark after a last-move tint', () => {
  const t = BOARD_THEMES.rainbow
  const last = parseColor(highlightColors(t).lastMove)
  // g1 is a dark square: tinted it must stay darker than its untinted light neighbour h1.
  for (const [darkSq, lightSq] of [['g1', 'h1'], ['e1', 'f1'], ['a5', 'a6']]) {
    const tinted = over(last, squareColorAt(t, darkSq, 0.5))
    const neighbour = squareColorAt(t, lightSq, 0.5)
    assert.ok(luminance(tinted) < luminance(neighbour), `${darkSq} vs ${lightSq}`)
  }
})

// ---------------------------------------------------------------------------
// modalStack.ts (review #1)
// ---------------------------------------------------------------------------

await test('modal stack: closing the lower modal first still unlocks scrolling', () => {
  const body = { style: { overflow: '' } }
  const a = pushModal(body)
  assert.equal(body.style.overflow, 'hidden')
  const b = pushModal(body)
  assert.equal(openModalCount(), 2)
  popModal(a) // e.g. the screen unmounts: React cleans A up before B
  assert.equal(body.style.overflow, 'hidden', 'still locked while B is open')
  popModal(b)
  assert.equal(body.style.overflow, '', 'restored to the pre-modal value')
  assert.equal(openModalCount(), 0)
})

await test('modal stack: restores a non-empty original overflow, any close order', () => {
  const body = { style: { overflow: 'auto' } }
  const a = pushModal(body)
  const b = pushModal(body)
  const c = pushModal(body)
  popModal(b)
  popModal(c)
  assert.equal(body.style.overflow, 'hidden')
  popModal(a)
  assert.equal(body.style.overflow, 'auto')
})

await test('modal stack: only the top-most modal handles keys (one Escape closes one)', () => {
  const body = { style: { overflow: '' } }
  const a = pushModal(body)
  const b = pushModal(body)
  assert.equal(isTopModal(b), true)
  assert.equal(isTopModal(a), false)
  // Simulate document capture listeners in registration order (A first, then B).
  const closed: string[] = []
  const handlers = [
    { id: a, close: () => closed.push('A') },
    { id: b, close: () => closed.push('B') },
  ]
  for (const h of handlers) if (isTopModal(h.id)) h.close()
  assert.deepEqual(closed, ['B'])
  popModal(b)
  assert.equal(isTopModal(a), true)
  popModal(a)
  assert.equal(isTopModal(a), false)
})

await test('modal stack: popping twice / unknown ids is harmless', () => {
  const body = { style: { overflow: 'scroll' } }
  const a = pushModal(body)
  popModal(a)
  popModal(a)
  popModal(987654)
  assert.equal(body.style.overflow, 'scroll')
  assert.equal(openModalCount(), 0)
})

// ---------------------------------------------------------------------------
// celebrate.ts (review #9) - fake window + manual animation frames
// ---------------------------------------------------------------------------

type FrameCb = () => void
const frames = new Map<number, FrameCb>()
let nextFrame = 1
function runFrames(n: number): void {
  for (let i = 0; i < n; i++) {
    const due = [...frames.entries()]
    frames.clear()
    for (const [, cb] of due) cb()
  }
}
const g = globalThis as unknown as Record<string, unknown>
g.window = {
  requestAnimationFrame: (cb: FrameCb) => {
    const id = nextFrame++
    frames.set(id, cb)
    return id
  },
  cancelAnimationFrame: (id: number) => {
    frames.delete(id)
  },
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id),
  matchMedia: () => ({ matches: false }),
}
g.requestAnimationFrame = (g.window as Record<string, unknown>).requestAnimationFrame
g.cancelAnimationFrame = (g.window as Record<string, unknown>).cancelAnimationFrame

const fx = await import('../src/fx/celebrate.ts')

await test('celebrate: overlapping streaming effects both keep running', () => {
  void fx.celebrate('emoji-rain')
  assert.equal(fx.activeStreamCount(), 1)
  runFrames(3)
  void fx.celebrate('rainbow') // e.g. level-up on top of the line-complete effect
  assert.equal(fx.activeStreamCount(), 2, 'second effect must not cancel the first')
  runFrames(5)
  assert.equal(fx.activeStreamCount(), 2)
  assert.equal(frames.size, 2, 'one pending frame per stream')
  fx.stopCelebration()
  assert.equal(fx.activeStreamCount(), 0)
  assert.equal(frames.size, 0)
})

await test('celebrate: streams end by themselves after their duration', async () => {
  const realNow = performance.now.bind(performance)
  let offset = 0
  performance.now = () => realNow() + offset
  try {
    void fx.celebrate('coin-shower', { intensity: 0.5 })
    assert.equal(fx.activeStreamCount(), 1)
    runFrames(2)
    offset = 60_000
    runFrames(2)
    assert.equal(fx.activeStreamCount(), 0)
  } finally {
    performance.now = realNow
    fx.stopCelebration()
  }
})

await test('celebrate: unknown and prototype-key effects fall back to confetti', async () => {
  for (const id of ['nope', 'constructor', 'toString', '__proto__']) {
    const p = fx.celebrate(id, { intensity: 0.3 })
    assert.ok(p instanceof Promise)
  }
  fx.stopCelebration()
})

// ---------------------------------------------------------------------------
// sound.ts (review "unverified": iPad 'interrupted' audio state)
// ---------------------------------------------------------------------------

/** A do-anything WebAudio stand-in: every property is a callable fake. */
function fakeNode(): unknown {
  const store: Record<string | symbol, unknown> = {}
  return new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === 'then') return undefined
      if (!(k in store)) store[k] = fakeNode()
      return store[k]
    },
    set: (_t, k, v) => {
      store[k] = v
      return true
    },
    apply: () => fakeNode(),
  })
}
let resumeCalls = 0
let ctxState = 'interrupted'
class FakeAudioContext {
  constructor() {
    const base = {
      get state() {
        return ctxState
      },
      currentTime: 0,
      sampleRate: 22050,
      resume: () => {
        resumeCalls++
        return Promise.resolve()
      },
    }
    return new Proxy(base, {
      get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : fakeNode()),
    }) as unknown as FakeAudioContext
  }
}
;(g.window as Record<string, unknown>).AudioContext = FakeAudioContext
const sound = await import('../src/fx/sound.ts')

await test("sound: resumes an 'interrupted' (Safari) or 'suspended' context, not a running one", () => {
  sound.setMuted(false)
  ctxState = 'interrupted'
  resumeCalls = 0
  sound.sfx.click()
  assert.equal(resumeCalls, 1)
  sound.unlockAudio()
  assert.equal(resumeCalls, 2)
  ctxState = 'suspended'
  sound.sfx.coin()
  assert.equal(resumeCalls, 3)
  ctxState = 'running'
  sound.sfx.move()
  sound.unlockAudio()
  assert.equal(resumeCalls, 3)
  ctxState = 'closed'
  assert.doesNotThrow(() => sound.sfx.correct())
  assert.equal(resumeCalls, 3)
})

// ---------------------------------------------------------------------------
// CSS rules from the review (#6 tap targets, #7 button contrast, #10, #11)
// ---------------------------------------------------------------------------

const uiCss = readFileSync(new URL('../src/styles/ui.css', import.meta.url), 'utf8')
const globalCss = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8')

function ruleBody(css: string, selector: string): string {
  const i = css.indexOf(`${selector} {`)
  assert.ok(i >= 0, `rule ${selector} not found`)
  return css.slice(i, css.indexOf('}', i))
}

await test('buttons: white text >= 4.5:1 over the whole success / danger / info gradient (review #7)', () => {
  const white = parseColor('#ffffff')
  for (const v of ['success', 'danger', 'info']) {
    const body = ruleBody(uiCss, `.btn--${v}`)
    const grad = body.match(/--btn-bg:\s*(linear-gradient\([^;]*\));/)
    assert.ok(grad, `.btn--${v} gradient`)
    const g2 = parseGradient(grad[1])!
    for (const s of g2.stops) {
      const c = contrast(white, s.c)
      assert.ok(c >= 4.5, `.btn--${v}: ${c.toFixed(2)}:1`)
    }
    assert.match(body, /--btn-fg:\s*#fff;/)
  }
})

await test('tap targets: .btn--sm, tappable coin badge, small avatars, TopBar player are >= 48px (review #6)', () => {
  const sm = ruleBody(uiCss, '.btn--sm').match(/--btn-h:\s*(\d+)px/)
  assert.ok(sm && Number(sm[1]) >= 48, '.btn--sm height')
  assert.match(ruleBody(uiCss, 'button.coin-badge::before'), /height:\s*48px/)
  assert.match(ruleBody(uiCss, '.avatar--button::before'), /inset:\s*min\(0px, calc\(\(var\(--size\) - 48px\) \/ 2\)\)/)
  assert.match(ruleBody(uiCss, 'button.topbar__who'), /min-height:\s*var\(--tap\)/)
  assert.match(globalCss, /--tap:\s*48px/)
})

await test('entrance animations and the modal leave no transform behind (review #10)', () => {
  for (const sel of ['.anim-pop', '.anim-fade', '.anim-slide-up', '.anim-bounce', '.anim-shake']) {
    const body = ruleBody(globalCss, sel)
    assert.doesNotMatch(body, /\bboth\b|\bforwards\b/, `${sel} must not retain its end state`)
  }
  assert.doesNotMatch(ruleBody(uiCss, '.modal'), /animation:[^;]*\b(both|forwards)\b/)
  // The dragged-piece layer is shifted back by the measured containing-block origin.
  assert.match(globalCss, /\.cb-board div\[style\*='position: fixed'\] \{\s*transform: translate\(var\(--cb-fix-x, 0px\), var\(--cb-fix-y, 0px\)\);/)
})

await test('toasts sit below the TopBar (review #11)', () => {
  assert.match(ruleBody(uiCss, '.toast-viewport'), /top:\s*var\(--toast-top, calc\(var\(--safe-top\) \+ var\(--topbar-h\) \+ 8px\)\)/)
})

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.error('FAILED:', failures.join(' | '))
  process.exit(1)
}
