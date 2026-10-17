// React side of the trainer: owns line selection, the pure reducer, the
// opponent's auto-replies, sounds, background engine insight on mistakes and
// the one-time reward when a line is completed.
//
// NOTE: TrainerState is never persisted or serialised (it can be MBs — every
// MoveNode carries its subtree). It lives in React state + a ref only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Line, Repertoire, TrainerMode } from '../types.ts'
import { pickLine } from '../chess/scheduler.ts'
import { userColorOf } from '../chess/repertoire.ts'
import {
  expectedNode,
  initTrainer,
  trainerReducer,
  type Feedback,
  type PlayedMove,
  type TrainerAction,
  type TrainerContext,
  type TrainerState,
} from './trainerReducer.ts'
import { actions, getActiveProfile, type LineReward } from '../store/appStore.ts'
import type { LineResultInputX } from '../store/achievements.ts'
import { sfx } from '../fx/sound.ts'
import { engineStatus, judgeMistake, preloadEngine, stopEngine, type MistakeVerdict } from '../engine/engineService.ts'

export interface UseTrainerOptions {
  mode: TrainerMode
  /** Chapter mode: the chapter to practise. */
  chapterId?: string
  /** "Show me the moves" at the start of the session. */
  learnMode: boolean
}

/** Engine verdict on the wrong move currently shown (for Hoot's extra sentence). */
export interface MistakeInsight {
  /** Feedback id of the wrong move it belongs to. */
  feedbackId: number
  status: 'pending' | 'done'
  verdict: MistakeVerdict | null
}

/** Everything the completion modal needs. */
export interface LineOutcome {
  /** Unique per completion (for one-shot effects). */
  id: number
  line: Line
  reward: LineReward
  perfect: boolean
  learnMode: boolean
  mistakes: number
  hintsUsed: number
  /** Session combo after this line. */
  combo: number
  /** In-order / chapter mode: this was the last line, the run starts over. */
  wrapped: boolean
  /** Mistakes/hints/arrows from an attempt abandoned mid-line (Restart, leaving) were added in. */
  carried: boolean
  /** Board position at the end (for "Play on vs computer"). */
  fen: string
}

export interface TrainerApi {
  /** 'empty' = the pool has no lines (e.g. a chapter without lines). */
  status: 'loading' | 'empty' | 'ready'
  state: TrainerState | null
  pool: Line[]
  /** In-order / chapter mode: index of the current line in `pool` (-1 in random mode). */
  lineIndex: number
  userColor: 'w' | 'b'
  /** Arrows for every move are shown ("Show me the moves"). */
  learnMode: boolean
  /** This line counts as a learn-mode line for rewards. */
  lineIsLearn: boolean
  setLearnMode: (on: boolean) => void
  /** ChessBoard onMove: true iff the move is now shown on the board. */
  userMove: (from: string, to: string, promotion?: string) => boolean
  takeBack: () => void
  hint: () => void
  restart: () => void
  nextLine: () => void
  /** Feedback to display: the live one, or a recent "book-alt" kept until the next user action. */
  feedback: Feedback | null
  insight: MistakeInsight | null
  outcome: LineOutcome | null
  /** The completion modal should be open (shortly after the last move). */
  showComplete: boolean
  closeComplete: () => void
  combo: number
  sessionCoins: number
  sessionLines: number
  /** Increments on every wrong move (board shake). */
  shake: number
}

/** Session combo per player; survives leaving the trainer (but not a reload). */
const sessionCombos = new Map<string, number>()

/**
 * An attempt abandoned mid-line (Restart, leaving the trainer, a new line before
 * this one was finished) still counts: its mistakes, hints and arrows are added
 * to the next completion of the same line, so restarting can't turn a failed
 * attempt into a "Perfect" (and push the line up a Leitner box or grow the
 * combo). Keyed by `profileId|lineId`; plain numbers only (never TrainerState).
 * Session memory only, and an abandoned attempt older than CARRY_MS is forgotten.
 */
interface Carry {
  mistakes: number
  hintsUsed: number
  usedArrowHint: boolean
  /** Most mistakes on one move (for "Never Give Up"). */
  maxHere: number
  /** "Show me the moves" arrows were seen. */
  learn: boolean
  at: number
}
const carries = new Map<string, Carry>()
const CARRY_MS = 60 * 60 * 1000

function carryKey(lineId: string): string {
  return `${getActiveProfile()?.id ?? ''}|${lineId}`
}

function peekCarry(lineId: string, now = Date.now()): Carry | undefined {
  const k = carryKey(lineId)
  const c = carries.get(k)
  if (c && now - c.at > CARRY_MS) {
    carries.delete(k)
    return undefined
  }
  return c
}

const FIRST_REPLY_MS = 900
const REPLY_MS = 600
const SHOW_COMPLETE_MS = 650

function isCapture(m: PlayedMove | undefined): boolean {
  return !!m && m.san.includes('x')
}

function moveSound(m: PlayedMove | undefined): void {
  if (isCapture(m)) sfx.capture()
  else sfx.move()
}

export function inOrderKey(openingId: string, mode: TrainerMode, chapterId?: string): string {
  return mode === 'chapter' && chapterId ? `${openingId}#${chapterId}` : openingId
}

export function useTrainer(rep: Repertoire | null, opts: UseTrainerOptions): TrainerApi {
  const { mode, chapterId } = opts
  const openingId = rep?.opening.id ?? ''
  const userColor: 'w' | 'b' = rep ? userColorOf(rep.opening) : 'w'
  const orderKey = inOrderKey(openingId, mode, chapterId)

  const pool = useMemo<Line[]>(() => {
    if (!rep) return []
    return mode === 'chapter' ? rep.lines.filter((l) => l.chapterId === chapterId) : rep.lines
  }, [rep, mode, chapterId])

  /** "Try again": the opponent keeps choosing this line while it is still possible. */
  const pinnedLineRef = useRef<string | null>(null)
  /** The line just finished: the opponent steers away from it on the next line (unless it's the only one). */
  const avoidLineRef = useRef<string | undefined>(undefined)

  const ctx = useMemo<TrainerContext | null>(() => {
    if (!rep) return null
    return {
      rep,
      // Weighted by the player's spaced-repetition stats (read fresh at pick time).
      pick: (lines: Line[]) => {
        const pinned = pinnedLineRef.current
        if (pinned) {
          const keep = lines.find((l) => l.id === pinned)
          if (keep) return keep
        }
        return pickLine(lines, getActiveProfile()?.lineStats ?? {}, Date.now(), { avoidLineId: avoidLineRef.current })
      },
    }
  }, [rep])

  const [state, setState] = useState<TrainerState | null>(null)
  const [lineIndex, setLineIndex] = useState(-1)
  const [learnMode, setLearn] = useState(opts.learnMode)
  const [lineIsLearn, setLineIsLearn] = useState(opts.learnMode)
  const [sticky, setSticky] = useState<Feedback | null>(null)
  const [insight, setInsight] = useState<MistakeInsight | null>(null)
  const [outcome, setOutcome] = useState<LineOutcome | null>(null)
  const [showComplete, setShowComplete] = useState(false)
  const [combo, setCombo] = useState(() => sessionCombos.get(getActiveProfile()?.id ?? '') ?? 0)
  const [sessionCoins, setSessionCoins] = useState(0)
  const [sessionLines, setSessionLines] = useState(0)
  const [shake, setShake] = useState(0)

  // Refs: the reducer runs synchronously in event handlers, so the board's
  // onMove can tell right away whether the move is shown.
  const stateRef = useRef<TrainerState | null>(null)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const repRef = useRef(rep)
  repRef.current = rep
  const poolRef = useRef(pool)
  poolRef.current = pool
  const learnRef = useRef(opts.learnMode)
  const lineLearnRef = useRef(opts.learnMode)
  /** A "Show me the moves" arrow was on screen in this run (or in an abandoned attempt of this line). */
  const arrowSeenRef = useRef(false)
  const lineIndexRef = useRef(-1)
  const maxMistakesRef = useRef(0)
  /** Bumped on every new line / restart: late engine results for an old run are ignored. */
  const runRef = useRef(0)
  const completedRunRef = useRef(-1)
  const outcomeSeq = useRef(0)
  const completeTimer = useRef<number | undefined>(undefined)
  const pendingJudges = useRef(0)
  const aliveRef = useRef(true)
  const initedFor = useRef<{ rep: Repertoire; pool: Line[] } | null>(null)

  const clearCompleteTimer = () => {
    if (completeTimer.current !== undefined) window.clearTimeout(completeTimer.current)
    completeTimer.current = undefined
  }

  /**
   * The current run is being thrown away before the line was completed: keep
   * what went wrong in it for the next completion of this line (see `carries`).
   */
  const abandonRun = useCallback(() => {
    const s = stateRef.current
    if (!s || s.phase === 'complete' || completedRunRef.current === runRef.current) return
    const learn = arrowSeenRef.current
    if (s.mistakes === 0 && s.hintsUsed === 0 && !s.usedArrowHint && !learn) return
    const prev = peekCarry(s.line.id)
    carries.set(carryKey(s.line.id), {
      mistakes: (prev?.mistakes ?? 0) + s.mistakes,
      hintsUsed: (prev?.hintsUsed ?? 0) + s.hintsUsed,
      usedArrowHint: !!prev?.usedArrowHint || s.usedArrowHint,
      maxHere: Math.max(prev?.maxHere ?? 0, maxMistakesRef.current),
      learn: !!prev?.learn || learn,
      at: Date.now(),
    })
  }, [])

  /** Reset per-line bookkeeping (new line or restart) for a run on `lineId`. */
  const resetRun = useCallback((lineId: string) => {
    clearCompleteTimer()
    runRef.current++
    maxMistakesRef.current = 0
    // Arrows already seen in an abandoned attempt of this line keep it a learn-mode line.
    const carriedLearn = !!peekCarry(lineId)?.learn
    arrowSeenRef.current = carriedLearn
    lineLearnRef.current = learnRef.current || carriedLearn
    setLineIsLearn(lineLearnRef.current)
    setSticky(null)
    setInsight(null)
    setOutcome(null)
    setShowComplete(false)
  }, [])

  const commit = (next: TrainerState) => {
    stateRef.current = next
    setState(next)
  }

  const startLine = useCallback(
    (line: Line, index: number, avoidLineId?: string) => {
      const c = ctxRef.current
      if (!c) return
      abandonRun()
      resetRun(line.id)
      pinnedLineRef.current = null
      avoidLineRef.current = avoidLineId
      lineIndexRef.current = index
      setLineIndex(index)
      commit(initTrainer(line, { mode, learnMode: learnRef.current, userColor }, c))
    },
    [mode, userColor, abandonRun, resetRun],
  )

  const chooseLine = useCallback(
    (avoidLineId?: string): { line: Line; index: number } | null => {
      const p = poolRef.current
      if (p.length === 0) return null
      const profile = getActiveProfile()
      if (mode === 'random') {
        const line = pickLine(p, profile?.lineStats ?? {}, Date.now(), { avoidLineId })
        return { line, index: -1 }
      }
      const stored = profile?.inOrderIndex[orderKey] ?? 0
      const index = ((Math.floor(stored) % p.length) + p.length) % p.length
      return { line: p[index], index }
    },
    [mode, orderKey],
  )

  // ---- completion ------------------------------------------------------------
  const complete = useCallback(
    (s: TrainerState) => {
      const run = runRef.current
      if (completedRunRef.current === run) return // exactly once per run
      completedRunRef.current = run
      const r = repRef.current
      if (!r) return
      const now = Date.now() // captured once for this completion
      // Add in an attempt of this line that was abandoned mid-way (Restart / leaving).
      const carry = peekCarry(s.line.id, now)
      carries.delete(carryKey(s.line.id))
      const mistakes = s.mistakes + (carry?.mistakes ?? 0)
      const hintsUsed = s.hintsUsed + (carry?.hintsUsed ?? 0)
      const usedArrowHint = s.usedArrowHint || !!carry?.usedArrowHint
      const learn = lineLearnRef.current || !!carry?.learn
      const perfect = mistakes === 0 && hintsUsed === 0 && !usedArrowHint && !learn
      const profileId = getActiveProfile()?.id ?? ''
      const comboBefore = sessionCombos.get(profileId) ?? 0
      const input: LineResultInputX = {
        line: s.line,
        openingId: r.opening.id,
        mode,
        mistakes,
        hintsUsed,
        usedArrowHint,
        learnMode: learn,
        combo: perfect ? comboBefore + 1 : 0,
        opponentBlunderPunished: s.opponentBlundered,
        now,
        maxMistakesOnOneMove: Math.max(maxMistakesRef.current, carry?.maxHere ?? 0),
      }
      const reward = actions.applyLineResult(input, r)
      // A quick repeat ("farmed") neither grows nor breaks the combo; a non-perfect line breaks it.
      const nextCombo = perfect ? (reward.farmed ? comboBefore : comboBefore + 1) : 0
      sessionCombos.set(profileId, nextCombo)
      setCombo(nextCombo)
      setSessionCoins((c) => c + reward.coins)
      setSessionLines((n) => n + 1)

      let wrapped = false
      const p = poolRef.current
      if (mode !== 'random' && p.length > 0 && lineIndexRef.current >= 0) {
        const nextIdx = lineIndexRef.current + 1
        wrapped = nextIdx >= p.length
        actions.setInOrderIndex(orderKey, wrapped ? 0 : nextIdx)
      }

      sfx.complete()
      setOutcome({
        id: ++outcomeSeq.current,
        line: s.line,
        reward,
        perfect,
        learnMode: learn,
        mistakes,
        hintsUsed,
        combo: nextCombo,
        wrapped,
        carried: !!carry,
        fen: s.fen,
      })
      clearCompleteTimer()
      completeTimer.current = window.setTimeout(() => {
        completeTimer.current = undefined
        if (aliveRef.current && runRef.current === run) setShowComplete(true)
      }, SHOW_COMPLETE_MS)
    },
    [mode, orderKey],
  )

  // ---- engine insight -----------------------------------------------------------
  const judge = useCallback((prev: TrainerState, next: TrainerState) => {
    const fb = next.feedback
    const exp = expectedNode(next)
    const wrong = next.wrong
    if (!fb || !exp || !wrong) return
    if (engineStatus() === 'error') return
    const run = runRef.current
    const fid = fb.id
    setInsight({ feedbackId: fid, status: 'pending', verdict: null })
    pendingJudges.current++
    judgeMistake(prev.fen, wrong.uci, exp.uci)
      .catch(() => null)
      .then((verdict) => {
        pendingJudges.current = Math.max(0, pendingJudges.current - 1)
        if (!aliveRef.current || runRef.current !== run) return
        const cur = stateRef.current
        if (!cur || cur.feedback?.id !== fid) return // the kid already moved on
        setInsight({ feedbackId: fid, status: 'done', verdict })
      })
  }, [])

  // ---- dispatch ------------------------------------------------------------------
  const dispatch = useCallback(
    (action: TrainerAction): { prev: TrainerState; next: TrainerState } | null => {
      const prev = stateRef.current
      if (!prev) return null
      const next = trainerReducer(prev, action)
      if (next === prev) return { prev, next }
      commit(next)
      if (next.mistakesHere > maxMistakesRef.current) maxMistakesRef.current = next.mistakesHere

      switch (action.type) {
        case 'opponentMove':
          moveSound(next.history[next.history.length - 1])
          break
        case 'userMove': {
          const fb = next.feedback
          setSticky(fb && fb.kind === 'book-alt' ? fb : null)
          if (next.phase === 'wrongMove') {
            sfx.wrong()
            setShake((n) => n + 1)
            if (fb?.kind === 'wrong') judge(prev, next)
            else setInsight(null)
          } else if (next.fen !== prev.fen) {
            moveSound(next.history[next.history.length - 1])
            if (next.phase === 'complete') complete(next)
          } else {
            // "other-line": not played; the piece to move glows for free.
            sfx.pop()
          }
          break
        }
        case 'takeBack':
          setSticky(null)
          if (next.hintLevel > prev.hintLevel) sfx.hint()
          break
        case 'hint':
          setSticky(null)
          sfx.hint()
          break
        default:
          break
      }
      return { prev, next }
    },
    [complete, judge],
  )

  // ---- first line (and a fresh one if the repertoire is rebuilt) -----------------
  useEffect(() => {
    if (!rep || !ctx) return
    const done = initedFor.current
    if (done && done.rep === rep && done.pool === pool) return
    initedFor.current = { rep, pool }
    const prevId = stateRef.current?.line.id
    const c = chooseLine(prevId)
    if (c) startLine(c.line, c.index, prevId)
    else {
      stateRef.current = null
      setState(null)
    }
  }, [rep, ctx, pool, chooseLine, startLine])

  // ---- opponent auto-replies -------------------------------------------------------
  useEffect(() => {
    if (!state || state.phase !== 'opponentToMove' || !ctx) return
    const t = window.setTimeout(() => dispatch({ type: 'opponentMove', ctx }), state.ply === 0 ? FIRST_REPLY_MS : REPLY_MS)
    return () => window.clearTimeout(t)
  }, [state, ctx, dispatch])

  // ---- "Show me the moves" arrow on screen (the board reveals it on the user's turn) ----
  useEffect(() => {
    if (learnMode && state?.phase === 'userToMove') arrowSeenRef.current = true
  }, [learnMode, state])

  // ---- engine warm-up + cleanup ---------------------------------------------------
  useEffect(() => {
    aliveRef.current = true
    // Let the board render first; the engine is only needed for mistake insight.
    const t = window.setTimeout(() => preloadEngine(), 1500)
    return () => {
      aliveRef.current = false
      window.clearTimeout(t)
      clearCompleteTimer()
      abandonRun() // leaving mid-line: the attempt still counts when the line is finished later
      if (pendingJudges.current > 0) {
        pendingJudges.current = 0
        stopEngine()
      }
    }
  }, [abandonRun])

  // ---- public API --------------------------------------------------------------------
  const userMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      const c = ctxRef.current
      if (!c) return false
      const r = dispatch(promotion ? { type: 'userMove', from, to, promotion, ctx: c } : { type: 'userMove', from, to, ctx: c })
      return !!r && r.next.fen !== r.prev.fen
    },
    [dispatch],
  )

  const takeBack = useCallback(() => {
    dispatch({ type: 'takeBack' })
  }, [dispatch])

  const hint = useCallback(() => {
    dispatch({ type: 'hint' })
  }, [dispatch])

  const restart = useCallback(() => {
    const s = stateRef.current
    if (!s) return
    abandonRun() // mid-line: the mistakes/hints so far still count for this line
    resetRun(s.line.id)
    pinnedLineRef.current = s.line.id
    dispatch({ type: 'restart' })
  }, [dispatch, abandonRun, resetRun])

  const nextLine = useCallback(() => {
    const prevId = stateRef.current?.line.id
    const c = chooseLine(prevId)
    if (c) startLine(c.line, c.index, prevId)
  }, [chooseLine, startLine])

  const setLearnMode = useCallback((on: boolean) => {
    learnRef.current = on
    setLearn(on)
    const s = stateRef.current
    // Seeing arrows during a line makes it a learn-mode line. Switching them
    // off before any arrow was on screen makes it a normal line again. (After
    // the line is complete the switch only affects the next line.)
    if (!s || s.phase !== 'complete') {
      if (on) {
        lineLearnRef.current = true
        if (s && s.phase === 'userToMove') arrowSeenRef.current = true // the arrow shows right away
      } else if (!arrowSeenRef.current) lineLearnRef.current = false
      setLineIsLearn(lineLearnRef.current)
    }
    actions.setSetting('learnMode', on)
  }, [])

  const closeComplete = useCallback(() => setShowComplete(false), [])

  const feedback = state?.feedback ?? sticky
  const liveInsight = insight && state && state.phase === 'wrongMove' && state.feedback?.id === insight.feedbackId ? insight : null

  return {
    status: !rep ? 'loading' : pool.length === 0 ? 'empty' : state ? 'ready' : 'loading',
    state,
    pool,
    lineIndex,
    userColor,
    learnMode,
    lineIsLearn,
    setLearnMode,
    userMove,
    takeBack,
    hint,
    restart,
    nextLine,
    feedback,
    insight: liveInsight,
    outcome,
    showComplete: showComplete && !!outcome,
    closeComplete,
    combo,
    sessionCoins,
    sessionLines,
    shake,
  }
}
