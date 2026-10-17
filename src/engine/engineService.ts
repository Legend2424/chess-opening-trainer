// One lazily-loaded Stockfish instance shared by the whole app (the NNUE net is
// ~40 MB, so we never want two on an iPad). The trainer uses it to judge how
// bad a wrong move was; the Play screen uses it as the opponent.
import { Chess } from 'chess.js'
import { Engine, type Score, type StrengthSettings } from './stockfish.ts'

let engine: Engine | null = null
let loading: Promise<Engine> | null = null
let mode: 'analysis' | 'play' = 'analysis'

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
    loading = e
      .init()
      .then(() => {
        engine = e
        setStatus('ready')
        return e
      })
      .catch((err: unknown) => {
        loading = null
        e.dispose()
        setStatus('error')
        throw err
      })
  }
  return loading
}

/** Start loading in the background (e.g. when a training screen opens). */
export function preloadEngine(): void {
  getEngine().catch(() => {
    /* reported via status */
  })
}

/** Stop whatever the engine is doing (pending queries resolve with null). */
export function stopEngine(): void {
  engine?.stop()
}

function toCp(s: Score | null): number | null {
  if (!s) return null
  if (s.mate !== undefined) return s.mate > 0 ? 10000 - s.mate * 10 : -10000 - s.mate * 10
  return s.cp ?? null
}

async function analysisEngine(): Promise<Engine> {
  const e = await getEngine()
  if (mode !== 'analysis') {
    e.setFullStrength()
    mode = 'analysis'
  }
  return e
}

/** Score (centipawns, from White's point of view) of a position, or null. */
export async function evaluateWhite(fen: string, depth = 12): Promise<number | null> {
  const e = await analysisEngine()
  const cp = toCp(await e.evaluate(fen, depth))
  if (cp === null) return null
  return fen.split(' ')[1] === 'w' ? cp : -cp
}

/** Best move (uci) at full strength, or null. */
export async function bestMove(fen: string, depth = 14): Promise<string | null> {
  const e = await analysisEngine()
  return e.bestMoveAtDepth(fen, depth)
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
 * Returns null if the engine can't load or the moves are invalid.
 */
export async function judgeMistake(
  fenBefore: string,
  wrongUci: string,
  bookUci: string,
  depth = 11,
): Promise<MistakeVerdict | null> {
  const afterWrong = fenAfter(fenBefore, wrongUci)
  const afterBook = fenAfter(fenBefore, bookUci)
  if (!afterWrong || !afterBook) return null
  try {
    const wrong = await evaluateWhite(afterWrong, depth)
    const book = await evaluateWhite(afterBook, depth)
    if (wrong === null || book === null) return null
    const mover = fenBefore.split(' ')[1] === 'w' ? 1 : -1
    const lossCp = Math.max(0, (book - wrong) * mover)
    const kind = lossCp >= 200 ? 'blunder' : lossCp >= 70 ? 'worse' : 'fine'
    return { kind, lossCp }
  } catch {
    return null
  }
}

/** Configure the engine as a playing opponent of the given strength. */
export async function playEngine(strength: StrengthSettings): Promise<Engine> {
  const e = await getEngine()
  e.setStrength(strength)
  mode = 'play'
  return e
}
