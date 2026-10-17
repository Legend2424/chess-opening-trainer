// One lazily-loaded Stockfish instance shared by the whole app (a worker plus
// a ~0.6 MB wasm, classical evaluation — the NNUE net is not shipped, see
// public/engine/README.md — so we never want two on an iPad). The trainer uses
// it to judge how bad a wrong move was; the Play screen uses it as the opponent.
//
// Searches run one at a time in the Engine's queue, each with its own Skill
// Level (analysis at full strength, the robot at its playing strength), so the
// two callers never steal each other's answers. stopEngine() cancels the
// running search AND everything queued, also while the engine is still loading.
import { Chess } from 'chess.js'
import { Engine, type Score, type StrengthSettings } from './stockfish.ts'

let engine: Engine | null = null
let loading: Promise<Engine> | null = null
/** Bumped by stopEngine(): work started before it gives up at its next step. */
let cancelEpoch = 0

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'
let status: EngineStatus = 'idle'
const listeners = new Set<(s: EngineStatus) => void>()
function setStatus(s: EngineStatus) {
  status = s
  listeners.forEach((l) => l(s))
}

export function engineStatus(): EngineStatus {
  return status
}

export function onEngineStatus(cb: (s: EngineStatus) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Load (once) and return the engine. Safe to call many times. */
export function getEngine(): Promise<Engine> {
  if (engine) return Promise.resolve(engine)
  if (!loading) {
    setStatus('loading')
    const e = new Engine()
    // A search that never answers: throw THIS engine away (never a newer one).
    e.onHang = () => {
      if (engine === e) resetEngine()
    }
    const p = e
      .init()
      .then(() => {
        if (loading !== p) {
          // resetEngine() ran while this one was loading: it is not ours any more.
          e.dispose()
          throw new Error('Stockfish was restarted')
        }
        engine = e
        setStatus('ready')
        return e
      })
      .catch((err: unknown) => {
        if (loading === p) {
          loading = null
          setStatus('error')
        }
        e.dispose()
        throw err
      })
    loading = p
  }
  return loading
}

/** Start loading in the background (e.g. when a training screen opens). */
export function preloadEngine(): void {
  getEngine().catch(() => {
    /* reported via status */
  })
}

/**
 * Stop whatever the engine is doing: the running search and every queued one
 * (pending queries resolve with null). Also cancels work still waiting for the
 * engine to load (e.g. the trainer's mistake check when the trainer closes).
 */
export function stopEngine(): void {
  cancelEpoch++
  engine?.stop()
}

/**
 * Throw the engine away (e.g. it stopped answering). The next getEngine()
 * loads a fresh worker; the browser cache makes that quick.
 */
export function resetEngine(): void {
  const old = engine
  engine = null
  loading = null
  cancelEpoch++
  old?.dispose()
  setStatus('idle')
}

/** An analysis search that hasn't answered this long after it STARTED is given up (and the engine reset). */
const ANALYSIS_TIMEOUT_MS = 20_000

function toCp(s: Score | null): number | null {
  if (!s) return null
  if (s.mate !== undefined) return s.mate > 0 ? 10000 - s.mate * 10 : -10000 - s.mate * 10
  return s.cp ?? null
}

/** Score (centipawns, from White's point of view) of a position, or null. Null too if stopEngine() ran since `epoch`. */
export async function evaluateWhite(fen: string, depth = 12, epoch: number = cancelEpoch): Promise<number | null> {
  const e = await getEngine()
  if (epoch !== cancelEpoch) return null
  const cp = toCp(await e.evaluate(fen, depth, ANALYSIS_TIMEOUT_MS))
  if (cp === null || epoch !== cancelEpoch) return null
  return fen.split(' ')[1] === 'w' ? cp : -cp
}

/** Best move (uci) at full strength, or null. */
export async function bestMove(fen: string, depth = 14): Promise<string | null> {
  const epoch = cancelEpoch
  const e = await getEngine()
  if (epoch !== cancelEpoch) return null
  return e.bestMoveAtDepth(fen, depth, ANALYSIS_TIMEOUT_MS)
}

export type MistakeVerdict = {
  /** 'blunder' loses ≥ 2 pawns vs the study move; 'worse' ≥ 0.7; 'fine' otherwise. */
  kind: 'blunder' | 'worse' | 'fine'
  /** How many centipawns worse than the study move (≥ 0). */
  lossCp: number
}

function fenAfter(fenBefore: string, uci: string): string | null {
  try {
    const c = new Chess(fenBefore)
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    return c.fen()
  } catch {
    return null
  }
}

/**
 * Compare a wrong move with the study move from the same position.
 * Returns null if the engine can't load, the moves are invalid, or
 * stopEngine() was called meanwhile (then no further search is started).
 */
export async function judgeMistake(
  fenBefore: string,
  wrongUci: string,
  bookUci: string,
  depth = 11,
): Promise<MistakeVerdict | null> {
  const epoch = cancelEpoch
  const afterWrong = fenAfter(fenBefore, wrongUci)
  const afterBook = fenAfter(fenBefore, bookUci)
  if (!afterWrong || !afterBook) return null
  try {
    const wrong = await evaluateWhite(afterWrong, depth, epoch)
    // Cancelled (stopEngine) or failed: don't start a second search.
    if (wrong === null || epoch !== cancelEpoch) return null
    const book = await evaluateWhite(afterBook, depth, epoch)
    if (book === null || epoch !== cancelEpoch) return null
    const mover = fenBefore.split(' ')[1] === 'w' ? 1 : -1
    const lossCp = Math.max(0, (book - wrong) * mover)
    const kind = lossCp >= 200 ? 'blunder' : lossCp >= 70 ? 'worse' : 'fine'
    return { kind, lossCp }
  } catch {
    return null
  }
}

/** Configure the engine as a playing opponent of the given strength (used by its next go()). */
export async function playEngine(strength: StrengthSettings): Promise<Engine> {
  const e = await getEngine()
  e.setStrength(strength)
  return e
}
