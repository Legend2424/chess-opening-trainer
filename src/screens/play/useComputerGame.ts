// Game state for "Play vs computer": the move list (replayed with chess.js so
// threefold repetition is detected), the robot's replies, undo, hint, resign.
//
// Engine etiquette (one shared Stockfish for the whole app):
//  - playEngine() is called before EVERY robot move, because hint/judge
//    queries switch the shared engine to full strength;
//  - every request carries a generation number; undo / new game / unmount
//    bump it and call stopEngine(), so a late reply is simply ignored.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import {
  bestMove,
  engineStatus,
  onEngineStatus,
  playEngine,
  resetEngine,
  stopEngine,
  type EngineStatus,
} from '../../engine/engineService.ts'
import { sfx } from '../../fx/sound.ts'
import { randomMoveChance } from './strength.ts'

export type Side = 'w' | 'b'

export interface GameSetup {
  /** Start timestamp: unique per game, also the reward's gameId. */
  id: number
  startFen: string
  userColor: Side
  rating: number
}

export interface PlayedMove {
  san: string
  uci: string
  from: string
  to: string
  promotion?: string
  color: Side
  /** Position after the move. */
  fen: string
  captured?: string
  check: boolean
  mate: boolean
}

export type EndReason = 'checkmate' | 'stalemate' | 'threefold' | 'insufficient' | 'fifty' | 'resign'

export interface GameEnd {
  result: 'win' | 'draw' | 'loss'
  reason: EndReason
}

/** Robot think time shown to the player, even when Stockfish answers instantly. */
const MIN_THINK_MS = 700
/** No reply after this long -> offer a "wake it up" retry. */
const STALL_MS = 15000
/** Hint search depth at full strength (fast enough on an iPad). */
const HINT_DEPTH = 12
/** A hint that hasn't come back after this long is given up on. */
const HINT_TIMEOUT_MS = 12000
const MOVE_TIME_MS = 1500
/**
 * Engine still 'loading' after this long -> offer "Restart app". The engine
 * service never reports a worker that fails to load (no onerror / timeout in
 * Engine.init), so without this the screen would wait forever. The load keeps
 * going in the background: if it does finish, the game simply carries on.
 */
export const ENGINE_LOAD_SLOW_MS = 30000

/** When the shared engine started loading (module-wide, so setup -> game keeps counting). */
let loadingSince: number | null = engineStatus() === 'loading' ? Date.now() : null
onEngineStatus((s) => {
  if (s !== 'loading') loadingSince = null
  else if (loadingSince === null) loadingSince = Date.now()
})

/** Full page reload: the only way to throw away a stuck engine without touching engineService. */
export function restartApp(): void {
  window.location.reload()
}

export const moveTimeMs = MOVE_TIME_MS

function replay(startFen: string, moves: PlayedMove[]): Chess {
  const g = new Chess(startFen)
  for (const m of moves) {
    try {
      g.move({ from: m.from, to: m.to, promotion: m.promotion })
    } catch {
      break
    }
  }
  return g
}

/** Play from/to on top of the game so far; null if illegal. */
function tryMove(startFen: string, moves: PlayedMove[], from: string, to: string, promotion?: string): PlayedMove | null {
  const g = replay(startFen, moves)
  try {
    const m = g.move({ from, to, promotion })
    return {
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      from: m.from,
      to: m.to,
      promotion: m.promotion,
      color: m.color,
      fen: m.after,
      captured: m.captured,
      check: g.inCheck(),
      mate: g.isCheckmate(),
    }
  } catch {
    return null
  }
}

function naturalEnd(g: Chess, user: Side): GameEnd | null {
  if (g.isCheckmate()) return { result: g.turn() === user ? 'loss' : 'win', reason: 'checkmate' }
  if (g.isStalemate()) return { result: 'draw', reason: 'stalemate' }
  if (g.isInsufficientMaterial()) return { result: 'draw', reason: 'insufficient' }
  if (g.isThreefoldRepetition()) return { result: 'draw', reason: 'threefold' }
  if (g.isDrawByFiftyMoves()) return { result: 'draw', reason: 'fifty' }
  return null
}

function randomLegalUci(fen: string): string | null {
  try {
    const moves = new Chess(fen).moves({ verbose: true })
    if (moves.length === 0) return null
    const m = moves[Math.floor(Math.random() * moves.length)]
    return m.from + m.to + (m.promotion ?? '')
  } catch {
    return null
  }
}

export function playMoveSound(m: PlayedMove): void {
  if (m.check || m.mate) sfx.check()
  else if (m.captured) sfx.capture()
  else sfx.move()
}

/** Live engine status (idle / loading / ready / error). */
export function useEngineStatus(): EngineStatus {
  const [s, setS] = useState<EngineStatus>(engineStatus)
  useEffect(() => {
    setS(engineStatus())
    const off = onEngineStatus(setS)
    return () => {
      off()
    }
  }, [])
  return s
}

/** True once the engine has been loading for ENGINE_LOAD_SLOW_MS (see above). */
export function useEngineLoadSlow(status: EngineStatus): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (status !== 'loading') {
      setSlow(false)
      return
    }
    if (loadingSince === null) loadingSince = Date.now()
    const left = ENGINE_LOAD_SLOW_MS - (Date.now() - loadingSince)
    if (left <= 0) {
      setSlow(true)
      return
    }
    setSlow(false)
    const t = window.setTimeout(() => setSlow(true), left)
    return () => window.clearTimeout(t)
  }, [status])
  return slow
}

export interface HintState {
  fen: string
  from: string
  to: string
  san: string
}

export function useComputerGame(setup: GameSetup) {
  const { startFen, userColor, rating } = setup
  const [moves, setMoves] = useState<PlayedMove[]>([])
  const [resigned, setResigned] = useState(false)
  const [engineFailed, setEngineFailed] = useState(false)
  const [stalled, setStalled] = useState(false)
  /** Stalls in a row without a robot move landing (2+ = the worker is probably dead). */
  const [stalls, setStalls] = useState(0)
  const [retry, setRetry] = useState(0)
  const [hint, setHint] = useState<HintState | null>(null)
  const [hintBusy, setHintBusy] = useState(false)
  const [hintFailed, setHintFailed] = useState(false)
  const [hintsUsed, setHintsUsed] = useState(0)
  const [undos, setUndos] = useState(0)

  const game = useMemo(() => replay(startFen, moves), [startFen, moves])
  const fen = game.fen()
  const turn = game.turn() as Side
  const inCheck = game.inCheck()
  const end: GameEnd | null = useMemo(
    () => (resigned ? { result: 'loss', reason: 'resign' } : naturalEnd(game, userColor)),
    [resigned, game, userColor],
  )
  const engineTurn = !end && turn !== userColor

  // Refs for async callbacks.
  const genRef = useRef(0)
  const hintGenRef = useRef(0)
  const movesRef = useRef(moves)
  movesRef.current = moves
  const badReplies = useRef(0)

  const cancelHint = useCallback(() => {
    hintGenRef.current++
    setHint(null)
    setHintBusy(false)
    setHintFailed(false)
  }, [])

  // ---- the robot's move ---------------------------------------------------
  useEffect(() => {
    if (!engineTurn) return
    const gen = ++genRef.current
    let replyTimer = 0
    let stallTimer = 0
    const t0 = performance.now()
    setEngineFailed(false)
    setStalled(false)
    stopEngine() // cancels a hint search that may still be running
    playEngine({ rating, moveTimeMs: MOVE_TIME_MS }).then(
      (engine) => {
        if (gen !== genRef.current) return
        stallTimer = window.setTimeout(() => {
          if (gen !== genRef.current) return
          setStalled(true)
          setStalls((n) => n + 1)
        }, STALL_MS)
        engine.go(fen, (uci) => {
          if (gen !== genRef.current) return
          window.clearTimeout(stallTimer)
          let chosen = uci
          if (Math.random() < randomMoveChance(rating)) chosen = randomLegalUci(fen) ?? uci
          const wait = Math.max(0, MIN_THINK_MS - (performance.now() - t0))
          replyTimer = window.setTimeout(() => {
            if (gen !== genRef.current) return
            const base = movesRef.current
            const pm = tryMove(startFen, base, chosen.slice(0, 2), chosen.slice(2, 4), chosen[4])
            if (!pm || pm.color === userColor) {
              // Should not happen (stale reply slipped through): ask again, a few times at most.
              console.warn('[play] ignoring unexpected engine reply', chosen)
              badReplies.current++
              if (badReplies.current <= 3) setRetry((r) => r + 1)
              else {
                setStalled(true)
                setStalls((n) => n + 1)
              }
              return
            }
            badReplies.current = 0
            setStalls(0)
            setMoves((ms) => (ms === base ? [...ms, pm] : ms))
            playMoveSound(pm)
          }, wait)
        })
      },
      () => {
        if (gen === genRef.current) setEngineFailed(true)
      },
    )
    return () => {
      genRef.current++
      window.clearTimeout(replyTimer)
      window.clearTimeout(stallTimer)
      stopEngine()
    }
  }, [engineTurn, fen, rating, startFen, userColor, retry])

  // Stop everything when the game view goes away.
  useEffect(
    () => () => {
      genRef.current++
      hintGenRef.current++
      stopEngine()
    },
    [],
  )

  // ---- player actions -----------------------------------------------------
  const userMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      if (end || turn !== userColor) return false
      const pm = tryMove(startFen, moves, from, to, promotion)
      if (!pm) return false
      cancelHint()
      setMoves([...moves, pm])
      playMoveSound(pm)
      return true
    },
    [end, turn, userColor, startFen, moves, cancelHint],
  )

  /** Moves to drop for "undo": the robot's reply (if any) and the player's last move. */
  const undoCount = useMemo(() => {
    let n = moves.length
    while (n > 0 && moves[n - 1].color !== userColor) n--
    return n === 0 ? 0 : moves.length - (n - 1)
  }, [moves, userColor])

  const canUndo = !end && undoCount > 0

  const undo = useCallback(() => {
    if (!canUndo) return
    genRef.current++
    stopEngine()
    cancelHint()
    badReplies.current = 0
    setStalled(false)
    setUndos((u) => u + 1)
    setMoves(moves.slice(0, moves.length - undoCount))
  }, [canUndo, moves, undoCount, cancelHint])

  const resign = useCallback(() => {
    if (end) return
    genRef.current++
    stopEngine()
    cancelHint()
    setResigned(true)
  }, [end, cancelHint])

  const retryEngine = useCallback(() => {
    // A stalled or failed engine is thrown away so the retry gets a fresh worker.
    if (stalled || engineFailed) resetEngine()
    badReplies.current = 0
    setEngineFailed(false)
    setStalled(false)
    setRetry((r) => r + 1)
  }, [stalled, engineFailed])

  const requestHint = useCallback(async () => {
    if (end || turn !== userColor || hintBusy) return
    const at = fen
    const hg = ++hintGenRef.current
    setHint(null)
    setHintFailed(false)
    setHintBusy(true)
    // A hint search that never answers (hung worker, query stuck behind another
    // caller's search) must not spin forever: give up after HINT_TIMEOUT_MS.
    let timer = 0
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => {
        if (hg === hintGenRef.current) stopEngine()
        resolve(null)
      }, HINT_TIMEOUT_MS)
    })
    const uci: string | null = await Promise.race([bestMove(at, HINT_DEPTH).catch(() => null), timeout])
    window.clearTimeout(timer)
    if (hg !== hintGenRef.current) return // a move / undo happened meanwhile
    setHintBusy(false)
    // Put the shared engine back to playing strength (bestMove switched it to full).
    playEngine({ rating, moveTimeMs: MOVE_TIME_MS }).catch(() => {})
    if (!uci) {
      setHintFailed(true)
      sfx.wrong()
      return 'none' as const
    }
    let san = uci
    try {
      san = new Chess(at).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
    } catch {
      /* keep uci */
    }
    setHint({ fen: at, from: uci.slice(0, 2), to: uci.slice(2, 4), san })
    setHintsUsed((h) => h + 1)
    sfx.hint()
    return 'ok' as const
  }, [end, turn, userColor, hintBusy, fen, rating])

  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null
  const visibleHint = hint && hint.fen === fen ? hint : null

  return {
    setup,
    moves,
    fen,
    turn,
    inCheck,
    end,
    engineTurn,
    engineFailed,
    stalled,
    stalls,
    lastMove,
    hint: visibleHint,
    hintBusy,
    hintFailed: hintFailed && !end && turn === userColor,
    hintsUsed,
    undos,
    canUndo,
    userMoved: moves.some((m) => m.color === userColor),
    userMove,
    undo,
    resign,
    retryEngine,
    requestHint,
  }
}

export type ComputerGame = ReturnType<typeof useComputerGame>
