// WebAudio-synthesised sound effects - no audio files.
//
// iOS Safari only lets an AudioContext start inside a user gesture, so the
// context is created/resumed on the first pointerdown/touchend/keydown (the
// listeners are installed automatically when this module loads in a browser).
// Every call is a no-op when muted, when WebAudio is unavailable, or before
// the context could be unlocked - it never throws.

type Wave = OscillatorType

interface ToneOpts {
  freq: number
  /** Glide to this frequency over the note. */
  to?: number
  type?: Wave
  /** Start offset in seconds from "now". */
  at?: number
  dur?: number
  gain?: number
  attack?: number
  /** Optional low-pass cutoff. */
  lowpass?: number
  detune?: number
}

interface NoiseOpts {
  at?: number
  dur?: number
  gain?: number
  /** Band-pass centre frequency. */
  freq?: number
  q?: number
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
let muted = false
let volume = 0.7
let unlockInstalled = false

function AudioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = AudioCtor()
  if (!Ctor) return null
  try {
    ctx = new Ctor()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 12
    comp.ratio.value = 4
    comp.attack.value = 0.003
    comp.release.value = 0.2
    master = ctx.createGain()
    master.gain.value = volume
    master.connect(comp)
    comp.connect(ctx.destination)
  } catch {
    ctx = null
    master = null
  }
  return ctx
}

/**
 * True when the context should be resumed: 'suspended', or Safari's
 * non-standard 'interrupted' (after a call, Siri or an app switch).
 */
function needsResume(c: AudioContext): boolean {
  const state = c.state as string
  return state !== 'running' && state !== 'closed'
}

function resume(c: AudioContext): void {
  try {
    void c.resume().catch(() => {})
  } catch {
    /* ignore */
  }
}

/** Resume/unlock the audio context. Safe to call any time (ideally in a gesture handler). */
export function unlockAudio(): void {
  const c = ensureContext()
  if (!c) return
  try {
    if (needsResume(c)) resume(c)
    // Playing a 1-sample silent buffer inside the gesture fully unlocks old iOS.
    const buf = c.createBuffer(1, 1, 22050)
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.start(0)
  } catch {
    /* ignore */
  }
}

const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'mousedown', 'keydown'] as const

/** Install one-shot listeners that unlock audio on the first user interaction. */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return
  unlockInstalled = true
  const handler = () => {
    unlockAudio()
    if (ctx && ctx.state === 'running') {
      for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, handler, true)
    }
  }
  for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, handler, { capture: true, passive: true })
  // iOS may suspend the context when the app goes to the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') {
      for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, handler, { capture: true, passive: true })
    }
  })
}

export function setMuted(m: boolean): void {
  muted = m
}

export function isMuted(): boolean {
  return muted
}

/** Master volume 0..1 (default 0.7). */
export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v))
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02)
}

function ready(): AudioContext | null {
  if (muted) return null
  const c = ensureContext()
  if (!c || !master) return null
  if (needsResume(c)) resume(c)
  if (c.state === 'closed') return null
  return c
}

function tone(c: AudioContext, o: ToneOpts): void {
  if (!master) return
  const t0 = c.currentTime + (o.at ?? 0) + 0.005
  const dur = o.dur ?? 0.15
  const attack = o.attack ?? 0.008
  const peak = o.gain ?? 0.3
  const osc = c.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, t0)
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur)
  if (o.detune) osc.detune.value = o.detune
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  let node: AudioNode = osc
  if (o.lowpass) {
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = o.lowpass
    osc.connect(lp)
    node = lp
  }
  node.connect(g)
  g.connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

function noise(c: AudioContext, o: NoiseOpts): void {
  if (!master) return
  if (!noiseBuf) {
    const len = Math.floor(c.sampleRate * 0.5)
    noiseBuf = c.createBuffer(1, len, c.sampleRate)
    const data = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  const t0 = c.currentTime + (o.at ?? 0) + 0.005
  const dur = o.dur ?? 0.05
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = o.freq ?? 1800
  bp.Q.value = o.q ?? 1.2
  const g = c.createGain()
  g.gain.setValueAtTime(o.gain ?? 0.3, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(bp)
  bp.connect(g)
  g.connect(master)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}

function play(fn: (c: AudioContext) => void): void {
  const c = ready()
  if (!c) return
  try {
    fn(c)
  } catch {
    /* never let a sound crash the app */
  }
}

// Note frequencies
const N = {
  C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, C7: 2093.0,
}

export const sfx = {
  /** Wooden "tock" of a piece landing. */
  move(): void {
    play((c) => {
      tone(c, { freq: 190, to: 120, type: 'sine', dur: 0.09, gain: 0.5, attack: 0.002 })
      noise(c, { dur: 0.035, gain: 0.35, freq: 2400, q: 0.9 })
    })
  },
  /** A slightly heavier double knock. */
  capture(): void {
    play((c) => {
      tone(c, { freq: 230, to: 110, type: 'sine', dur: 0.12, gain: 0.55, attack: 0.002 })
      noise(c, { dur: 0.05, gain: 0.45, freq: 1600, q: 0.8 })
      noise(c, { at: 0.045, dur: 0.04, gain: 0.25, freq: 2600, q: 1 })
    })
  },
  /** Bright two-note "ding-ding". */
  correct(): void {
    play((c) => {
      tone(c, { freq: N.G5, type: 'triangle', dur: 0.16, gain: 0.22 })
      tone(c, { freq: N.C6, type: 'triangle', at: 0.08, dur: 0.28, gain: 0.24 })
      tone(c, { freq: N.C7, type: 'sine', at: 0.08, dur: 0.2, gain: 0.05 })
    })
  },
  /** A soft, friendly "boop-bonk" (not scary). */
  wrong(): void {
    play((c) => {
      tone(c, { freq: 330, to: 262, type: 'sine', dur: 0.16, gain: 0.25, attack: 0.01 })
      tone(c, { freq: 247, to: 196, type: 'sine', at: 0.13, dur: 0.24, gain: 0.22, attack: 0.01 })
    })
  },
  /** Little fanfare for finishing a line. */
  complete(): void {
    play((c) => {
      const notes = [N.C5, N.E5, N.G5, N.C6]
      notes.forEach((f, i) => tone(c, { freq: f, type: 'triangle', at: i * 0.09, dur: 0.22, gain: 0.22 }))
      tone(c, { freq: N.E6, type: 'triangle', at: 0.36, dur: 0.5, gain: 0.18 })
      tone(c, { freq: N.G6, type: 'sine', at: 0.36, dur: 0.5, gain: 0.08 })
      noise(c, { at: 0.36, dur: 0.3, gain: 0.05, freq: 8000, q: 0.7 })
    })
  },
  /** Classic coin pickup. */
  coin(): void {
    play((c) => {
      tone(c, { freq: N.B5, type: 'square', dur: 0.08, gain: 0.08, lowpass: 5000 })
      tone(c, { freq: N.E6, type: 'square', at: 0.07, dur: 0.3, gain: 0.08, lowpass: 5000 })
    })
  },
  /** Rising fanfare. */
  levelUp(): void {
    play((c) => {
      const run = [N.C5, N.E5, N.G5, N.C6, N.E6]
      run.forEach((f, i) => tone(c, { freq: f, type: 'triangle', at: i * 0.07, dur: 0.18, gain: 0.2 }))
      ;[N.C6, N.E6, N.G6].forEach((f) => tone(c, { freq: f, type: 'triangle', at: 0.4, dur: 0.7, gain: 0.12 }))
      noise(c, { at: 0.4, dur: 0.5, gain: 0.05, freq: 9000, q: 0.6 })
    })
  },
  /** "Ka-ching!" */
  purchase(): void {
    play((c) => {
      noise(c, { dur: 0.06, gain: 0.3, freq: 3000, q: 1.5 })
      tone(c, { freq: N.E6, type: 'square', at: 0.05, dur: 0.12, gain: 0.07, lowpass: 6000 })
      tone(c, { freq: N.A5 * 2, type: 'square', at: 0.12, dur: 0.45, gain: 0.07, lowpass: 6000 })
      noise(c, { at: 0.12, dur: 0.35, gain: 0.06, freq: 7000, q: 0.8 })
    })
  },
  /** Tiny UI tick. */
  click(): void {
    play((c) => {
      tone(c, { freq: 1400, to: 900, type: 'sine', dur: 0.04, gain: 0.12, attack: 0.002 })
    })
  },
  /** Magical upward sweep for hints. */
  hint(): void {
    play((c) => {
      tone(c, { freq: 600, to: 1500, type: 'sine', dur: 0.32, gain: 0.14, attack: 0.02 })
      tone(c, { freq: 900, to: 2200, type: 'triangle', at: 0.06, dur: 0.3, gain: 0.05, attack: 0.02 })
    })
  },
  /** Sparkly achievement chime. */
  achievement(): void {
    play((c) => {
      ;[N.G5, N.C6, N.E6, N.G6].forEach((f, i) => tone(c, { freq: f, type: 'sine', at: i * 0.06, dur: 0.4, gain: 0.14 }))
      noise(c, { at: 0.2, dur: 0.4, gain: 0.05, freq: 9000, q: 0.6 })
    })
  },
  /** Bubble pop for toasts / small UI events. */
  pop(): void {
    play((c) => {
      tone(c, { freq: 420, to: 900, type: 'sine', dur: 0.08, gain: 0.18, attack: 0.003 })
    })
  },
  /** Gentle warning blip for "check". */
  check(): void {
    play((c) => {
      tone(c, { freq: N.A5, type: 'triangle', dur: 0.1, gain: 0.12 })
      tone(c, { freq: N.A5, type: 'triangle', at: 0.12, dur: 0.12, gain: 0.12 })
    })
  },
}

export type SfxName = keyof typeof sfx

/** Play a sound by name (handy for data-driven code). */
export function playSfx(name: SfxName): void {
  sfx[name]()
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installAudioUnlock()
}
