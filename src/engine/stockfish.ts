// Thin wrapper around the single-threaded Stockfish NNUE WASM build.
// Runs entirely in the browser (no server, no per-move network calls).
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

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-nnue-16-single.js`

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

export class Engine {
  private worker: Worker | null = null
  private ready = false
  private readyWaiters: Array<() => void> = []
  private onBestMove: BestMoveCallback | null = null
  private onEval: ((s: Score | null) => void) | null = null
  private onBestQuery: ((uci: string | null) => void) | null = null
  private lastScore: Score | null = null
  private evalQueue: Promise<Score | null> = Promise.resolve(null)
  private strength: StrengthSettings = { rating: 1200, moveTimeMs: 3000 }
  private playDepth = 10

  /** Load the wasm engine and complete the UCI handshake. */
  async init(): Promise<void> {
    if (this.worker) return
    this.worker = new Worker(ENGINE_URL)
    this.worker.onmessage = (e: MessageEvent) => this.handleLine(String(e.data))
    this.send('uci')
    await this.waitFor('uciok')
    this.send('setoption name Threads value 1')
    this.send('setoption name Hash value 64')
    this.send('setoption name UCI_AnalyseMode value false')
    await this.isReady()
    this.ready = true
    this.readyWaiters.forEach((r) => r())
    this.readyWaiters = []
  }

  /** Resolves once the engine has finished loading. */
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve()
    return new Promise((res) => this.readyWaiters.push(res))
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
      const uciMove = line.split(/\s+/)[1]
      if (this.onBestQuery) {
        const cb = this.onBestQuery
        this.onBestQuery = null
        cb(uciMove && uciMove !== '(none)' ? uciMove : null)
        return
      }
      if (this.onEval) {
        const cb = this.onEval
        const s = this.lastScore
        this.onEval = null
        cb(s)
        return
      }
      const cb = this.onBestMove
      this.onBestMove = null
      if (cb && uciMove && uciMove !== '(none)') cb(uciMove)
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

  // --- Strength ----------------------------------------------------------

  setStrength(s: StrengthSettings) {
    this.strength = s
    const { skill, depth } = ratingToSkillDepth(s.rating)
    this.playDepth = depth
    // Skill Level weakens by occasionally choosing a slightly worse candidate;
    // at 20 there is no weakening, so the top of the slider plays best moves.
    this.send('setoption name UCI_LimitStrength value false')
    this.send(`setoption name Skill Level value ${skill}`)
  }

  // --- Search ------------------------------------------------------------

  newGame() {
    this.send('ucinewgame')
  }

  /** Ask for a move from the given FEN. Calls back with a UCI move string. */
  go(fen: string, cb: BestMoveCallback) {
    this.onBestMove = cb
    this.send(`position fen ${fen}`)
    // Depth drives strength; movetime is a safety cap so strong levels in a
    // complex position still answer promptly. Whichever is reached first wins.
    this.send(`go depth ${this.playDepth} movetime ${this.strength.moveTimeMs}`)
  }

  /**
   * Evaluate a position to a fixed depth, returning the score from the
   * perspective of the side to move. Calls serialize on this worker, so it's
   * safe to fire several in a row (used by the analysis engine for hints and
   * blunder detection — keep it OFF the playing engine).
   */
  evaluate(fen: string, depth = 12): Promise<Score | null> {
    const task = () =>
      new Promise<Score | null>((resolve) => {
        this.onEval = resolve
        this.lastScore = null
        this.send(`position fen ${fen}`)
        this.send(`go depth ${depth}`)
      })
    this.evalQueue = this.evalQueue.then(task, task)
    return this.evalQueue
  }

  /**
   * Find the best move at a fixed (deep) depth, returning a UCI move string.
   * Serializes on the eval queue like evaluate(), so use it on the full-strength
   * analysis engine — never the playing engine. Used by the "Show best move" hint.
   */
  bestMoveAtDepth(fen: string, depth = 18): Promise<string | null> {
    const task = () =>
      new Promise<string | null>((resolve) => {
        this.onBestQuery = resolve
        this.send(`position fen ${fen}`)
        this.send(`go depth ${depth}`)
      })
    this.evalQueue = this.evalQueue.then(task, task) as Promise<Score | null>
    return this.evalQueue as unknown as Promise<string | null>
  }

  /** Stop the current search (e.g. when the position changes mid-think). */
  stop() {
    this.onBestMove = null
    this.onEval = null
    this.onBestQuery = null
    this.send('stop')
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.ready = false
  }
}
