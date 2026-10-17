// Thin wrapper around the single-threaded Stockfish 16 WASM build (nmrugg/stockfish.js,
// GPLv3 — see public/engine/README.md). It runs with the classical evaluation (the NNUE
// net is not shipped). Runs entirely in the browser (no server, no per-move network calls).
//
// STRENGTH MODEL — Skill Level + search depth (calibrated to Lichess's levels).
// Earlier attempts used UCI_Elo (injects random blunders -> inconsistent) and a
// home-grown MultiPV softmax (in endgames "low centipawn-loss" is a poor proxy
// for good technique, so it picked aimless non-progress moves). Both felt weak.
//
// Lichess's own AI levels are a well-known, validated reference:
//   L5 Skill 7  depth 5  (~1500)   L6 Skill 11 depth 8  (~1900)
//   L7 Skill 15 depth 13 (~2300)   L8 full strength, depth 22 (~2800)
// We map the 800–2000 slider onto Skill Level (0–20) + a search depth, with the
// TOP of the slider = full Skill 20 at a deep search so it genuinely plays the
// best move. The thinking-time slider becomes a movetime *cap* (whichever of
// depth / time is reached first), so strong levels stay responsive.

import { assetUrl } from '../util/assetUrl.ts'

export interface StrengthSettings {
  /** Target opponent strength, ~800–2000. */
  rating: number
  /** Hard cap on thinking time per move, milliseconds. */
  moveTimeMs: number
}

/** A position evaluation from the perspective of the side to move. */
export interface Score {
  cp?: number
  mate?: number
}

type BestMoveCallback = (uci: string) => void

const ENGINE_URL = assetUrl('engine/stockfish-nnue-16-single.js')

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Skill Level (0–20) and search depth for a target rating on the 800–2500 slider. */
export function ratingToSkillDepth(rating: number): { skill: number; depth: number } {
  if (rating <= 2000) {
    // 800 -> Skill 1 / depth 5 ; 2000 -> Skill 20 / depth 16 (full strength).
    const t = clamp((rating - 800) / (2000 - 800), 0, 1)
    return {
      skill: clamp(Math.round(lerp(1, 20, t)), 0, 20),
      depth: clamp(Math.round(lerp(5, 16, t)), 1, 30),
    }
  }
  // Above 2000: already full Skill 20, so push strength by searching deeper.
  // 2000 -> depth 16 ; 2500 -> depth 24 (near-master tactical accuracy).
  const t = clamp((rating - 2000) / (2500 - 2000), 0, 1)
  return { skill: 20, depth: clamp(Math.round(lerp(16, 24, t)), 1, 40) }
}

/**
 * One search the engine runs (robot move, evaluation or best-move query).
 * Searches run ONE AT A TIME, in order, so every `bestmove` belongs to the
 * search at the head of the queue (no cross-talk between the trainer's
 * mistake check and the robot's move).
 */
interface Task {
  fen: string
  /** The `go …` command. */
  go: string
  /** Skill Level for this search (20 = full strength for analysis). */
  skill: number
  /** Give up (resolve null, report a hang) if no bestmove after this long once STARTED; 0 = never. */
  timeoutMs: number
  /** Called exactly once: with the result, or with nulls when cancelled / timed out / disposed. */
  done: (bestmove: string | null, score: Score | null) => void
  timer?: ReturnType<typeof setTimeout>
}

export class Engine {
  private worker: Worker | null = null
  private lastScore: Score | null = null
  private strength: StrengthSettings = { rating: 1200, moveTimeMs: 3000 }
  private playDepth = 10
  private playSkill = 20
  /** Skill Level last sent to the worker (null = unknown). */
  private sentSkill: number | null = null
  private queue: Task[] = []
  private current: Task | null = null
  /** `go` commands sent whose `bestmove` hasn't arrived yet. */
  private inFlight = 0
  /** bestmove replies still due from searches that were stopped; they answer nobody. */
  private staleBestmoves = 0
  /** Called when a started search never answers (the worker is probably stuck). */
  onHang: (() => void) | null = null

  /**
   * Load the wasm engine and complete the UCI handshake. Rejects if the worker
   * fails to load (e.g. offline / 404) or doesn't answer within `timeoutMs`,
   * so callers can show an error and retry with a fresh Engine.
   */
  async init(timeoutMs = 60_000): Promise<void> {
    if (this.worker) return
    const worker = new Worker(ENGINE_URL)
    this.worker = worker
    worker.onmessage = (e: MessageEvent) => this.handleLine(String(e.data))
    let fail: (err: Error) => void = () => {}
    const failed = new Promise<never>((_, reject) => {
      fail = reject
    })
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault?.()
      fail(new Error(`Stockfish failed to load${e.message ? `: ${e.message}` : ''}`))
    }
    const timer = setTimeout(() => fail(new Error('Stockfish took too long to start')), timeoutMs)
    const handshake = (async () => {
      this.send('uci')
      await this.waitFor('uciok')
      this.send('setoption name Threads value 1')
      // 16 MB is plenty for depth ≤ 24 on one thread, and kinder to an iPad's memory.
      this.send('setoption name Hash value 16')
      this.send('setoption name UCI_AnalyseMode value false')
      this.send('setoption name UCI_LimitStrength value false')
      await this.isReady()
    })()
    try {
      await Promise.race([handshake, failed])
    } finally {
      clearTimeout(timer)
    }
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd)
  }

  // --- UCI line handling -------------------------------------------------

  private lineWaiters: Array<{ match: string; resolve: () => void }> = []

  private handleLine(line: string) {
    for (let i = this.lineWaiters.length - 1; i >= 0; i--) {
      if (line.startsWith(this.lineWaiters[i].match)) {
        this.lineWaiters[i].resolve()
        this.lineWaiters.splice(i, 1)
      }
    }

    // Track the best line's score (for evaluate()).
    if (line.startsWith('info') && line.includes(' score ')) {
      const sc = line.match(/score (cp|mate) (-?\d+)/)
      if (sc) this.lastScore = sc[1] === 'cp' ? { cp: Number(sc[2]) } : { mate: Number(sc[2]) }
    }

    if (line.startsWith('bestmove')) {
      if (this.inFlight > 0) this.inFlight--
      if (this.staleBestmoves > 0) {
        // The reply of a stopped search: the next search's info lines come after it.
        this.staleBestmoves--
        this.lastScore = null
        return
      }
      const t = this.current
      this.current = null
      if (t) {
        clearTimeout(t.timer)
        const uciMove = line.split(/\s+/)[1]
        t.done(uciMove && uciMove !== '(none)' ? uciMove : null, this.lastScore)
      }
      this.pump()
    }
  }

  private waitFor(prefix: string): Promise<void> {
    return new Promise((resolve) => {
      this.lineWaiters.push({ match: prefix, resolve })
    })
  }

  private isReady(): Promise<void> {
    this.send('isready')
    return this.waitFor('readyok')
  }

  // --- The search queue --------------------------------------------------

  private enqueue(t: Task) {
    if (!this.worker) {
      t.done(null, null)
      return
    }
    this.queue.push(t)
    this.pump()
  }

  /** Starts the next queued search if none is running. */
  private pump() {
    if (this.current || !this.worker) return
    const t = this.queue.shift()
    if (!t) return
    this.current = t
    this.lastScore = null
    if (this.sentSkill !== t.skill) {
      this.send(`setoption name Skill Level value ${t.skill}`)
      this.sentSkill = t.skill
    }
    this.send(`position fen ${t.fen}`)
    this.inFlight++
    this.send(t.go)
    if (t.timeoutMs > 0) t.timer = setTimeout(() => this.timedOut(t), t.timeoutMs)
  }

  private timedOut(t: Task) {
    if (this.current !== t) return
    this.current = null
    this.staleBestmoves = this.inFlight
    if (this.inFlight > 0) this.send('stop')
    t.done(null, null)
    this.onHang?.()
    this.pump()
  }

  // --- Strength ----------------------------------------------------------

  /** Playing strength for go(): Skill Level is sent with each robot search (analysis always runs at 20). */
  setStrength(s: StrengthSettings) {
    this.strength = s
    const { skill, depth } = ratingToSkillDepth(s.rating)
    this.playDepth = depth
    // Skill Level weakens by occasionally choosing a slightly worse candidate;
    // at 20 there is no weakening, so the top of the slider plays best moves.
    this.playSkill = skill
  }

  // --- Search ------------------------------------------------------------

  /** Ask for a move from the given FEN. Calls back with a UCI move string (never after stop()). */
  go(fen: string, cb: BestMoveCallback) {
    // Depth drives strength; movetime is a safety cap so strong levels in a
    // complex position still answer promptly. Whichever is reached first wins.
    this.enqueue({
      fen,
      go: `go depth ${this.playDepth} movetime ${this.strength.moveTimeMs}`,
      skill: this.playSkill,
      timeoutMs: 0, // the Play screen has its own "the robot is stuck" handling
      done: (uci) => {
        if (uci) cb(uci)
      },
    })
  }

  /**
   * Evaluate a position to a fixed depth (full strength), returning the score
   * from the perspective of the side to move, or null (cancelled / timed out).
   * `timeoutMs` counts from when the search STARTS, not from when it was queued.
   */
  evaluate(fen: string, depth = 12, timeoutMs = 0): Promise<Score | null> {
    return new Promise((resolve) => {
      this.enqueue({ fen, go: `go depth ${depth}`, skill: 20, timeoutMs, done: (_m, score) => resolve(score) })
    })
  }

  /** Find the best move at a fixed depth (full strength), as a UCI string, or null. Used by the "Show best move" hint. */
  bestMoveAtDepth(fen: string, depth = 18, timeoutMs = 0): Promise<string | null> {
    return new Promise((resolve) => {
      this.enqueue({ fen, go: `go depth ${depth}`, skill: 20, timeoutMs, done: (uci) => resolve(uci) })
    })
  }

  /**
   * Cancel EVERYTHING: the running search (its late `bestmove` is ignored) and
   * every queued one. Pending evaluate()/bestMoveAtDepth() promises resolve with
   * null; a cancelled go() never calls back.
   */
  stop() {
    const cancelled = [...(this.current ? [this.current] : []), ...this.queue]
    this.current = null
    this.queue = []
    this.staleBestmoves = this.inFlight
    if (this.inFlight > 0) this.send('stop')
    for (const t of cancelled) {
      clearTimeout(t.timer)
      t.done(null, null)
    }
  }

  dispose() {
    this.stop()
    this.onHang = null
    this.worker?.terminate()
    this.worker = null
    this.inFlight = 0
    this.staleBestmoves = 0
    this.sentSkill = null
    this.lineWaiters = []
  }
}
