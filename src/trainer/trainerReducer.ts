// The trainer: a pure reducer over a practice line. The React hook adds
// timers (auto opponent moves), sounds and engine insight on top of it.

import { Chess } from 'chess.js'
import type { Line, MoveNode, Repertoire, TrainerMode } from '../types.ts'
import { bookMovesAt, isBlunder, isDubious, positionKey } from '../chess/repertoire.ts'

export type Phase = 'opponentToMove' | 'userToMove' | 'wrongMove' | 'complete'

export type FeedbackKind =
  | 'correct'
  | 'book-alt'
  | 'other-line'
  | 'wrong'
  | 'known-bad'
  | 'opponent-blunder'
  | 'hint'
  | 'complete'

export interface Feedback {
  kind: FeedbackKind
  /** correct/book-alt/complete/opponent-blunder: the node just played; other-line/known-bad: the
   *  book node the user tried; wrong/hint: the expected node. */
  node?: MoveNode
  /** known-bad: the study's answer to the dubious move (its first child), if any. */
  refutation?: MoveNode
  /** Increments on every new feedback, so the UI can re-trigger toasts/animations. */
  id: number
}

export interface PlayedMove {
  san: string
  uci: string
  from: string
  to: string
  /** Position after the move. */
  fen: string
  by: 'user' | 'opponent'
  nodeId: string | null
}

export interface TrainerConfig {
  mode: TrainerMode
  learnMode: boolean
  userColor: 'w' | 'b'
}

/**
 * Plain data (no Maps/functions), but NOT meant to be persisted or posted anywhere: `line.moves`
 * holds MoveNodes whose `children` carry their whole subtree, so JSON.stringify(state) can reach
 * several MB (≈3.3 MB worst case: Smith-Morra at maxPly 0). To resume a session, persist
 * `{ lineId: state.line.id, mode: state.config.mode }` and re-init from the repertoire.
 *
 * Invariants: `history.length === ply` (outside 'wrongMove' the board `fen` is the position after
 * `line.moves[ply - 1]`), and in random mode every candidate line shares `line.startFen` and has
 * the played position at the same ply.
 */
export interface TrainerState {
  config: TrainerConfig
  /** Current target line. */
  line: Line
  /** Random mode: ids of lines still consistent with the moves played ([] in other modes). */
  candidates: string[]
  /** Plies played along `line.moves` (index of the next move in `line.moves`). */
  ply: number
  /** Position shown on the board. While phase === 'wrongMove' this INCLUDES the wrong move. */
  fen: string
  /** Moves actually played (never contains the wrong move being shown). */
  history: PlayedMove[]
  /** Last move shown on the board (the wrong move while phase === 'wrongMove'). */
  lastMove: [string, string] | null
  phase: Phase
  /** The wrong move currently shown on the board. */
  wrong: PlayedMove | null
  mistakes: number
  /** Mistakes at the current user move. */
  mistakesHere: number
  /** At the current user move: 1 = highlight the piece, 2 = show the arrow. */
  hintLevel: 0 | 1 | 2
  /** Hints requested via the 'hint' action (free highlights are not counted). */
  hintsUsed: number
  usedArrowHint: boolean
  /** One per user move in line.moves. */
  userMoveMarks: ('pending' | 'clean' | 'fixed')[]
  opponentBlundered: boolean
  feedback: Feedback | null
  // --- additions beyond DESIGN.md §2 (needed to keep the reducer pure) ---
  /** Hints requested at the current user move (decides 'clean' vs 'fixed'). */
  hintsHere: number
  /** Last feedback id handed out (feedback ids keep increasing across restarts). */
  feedbackSeq: number
  /** Random mode: candidate ids at the start of the line (used by 'restart', which has no ctx). */
  startCandidates: string[]
}

export interface TrainerContext {
  rep: Repertoire
  /** Chooses among lines (random mode); typically pickLine() with the profile's stats. */
  pick: (lines: Line[]) => Line
}

export type TrainerAction =
  | { type: 'opponentMove'; ctx: TrainerContext }
  | { type: 'userMove'; from: string; to: string; promotion?: string; ctx: TrainerContext }
  | { type: 'takeBack' }
  | { type: 'hint' }
  | { type: 'restart' }

// ---------------------------------------------------------------------------
// Per-repertoire lookup caches (repertoires are immutable once built)
// ---------------------------------------------------------------------------

const lineMaps = new WeakMap<Repertoire, Map<string, Line>>()
function lineById(rep: Repertoire, id: string): Line | undefined {
  let m = lineMaps.get(rep)
  if (!m) {
    m = new Map(rep.lines.map((l) => [l.id, l]))
    lineMaps.set(rep, m)
  }
  return m.get(id)
}

const posUciMaps = new WeakMap<Repertoire, Map<string, MoveNode[]>>()
/** Every study node (not de-duplicated) for `positionKey|uci`. */
function nodesFor(rep: Repertoire, fen: string, uci: string): MoveNode[] {
  let m = posUciMaps.get(rep)
  if (!m) {
    m = new Map()
    for (const n of rep.nodesById.values()) {
      const k = `${positionKey(n.fenBefore)}|${n.uci}`
      const arr = m.get(k)
      if (arr) arr.push(n)
      else m.set(k, [n])
    }
    posUciMaps.set(rep, m)
  }
  return m.get(`${positionKey(fen)}|${uci}`) ?? []
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countUserMoves(line: Line, userColor: 'w' | 'b', upTo = line.moves.length): number {
  let n = 0
  for (let i = 0; i < upTo && i < line.moves.length; i++) if (line.moves[i].color === userColor) n++
  return n
}

function phaseAt(line: Line, ply: number, userColor: 'w' | 'b'): Phase {
  const next = line.moves[ply]
  if (!next) return 'complete'
  return next.color === userColor ? 'userToMove' : 'opponentToMove'
}

function fresh(line: Line, config: TrainerConfig, startCandidates: string[], feedbackSeq: number): TrainerState {
  return {
    config,
    line,
    candidates: startCandidates.slice(),
    ply: 0,
    fen: line.startFen,
    history: [],
    lastMove: null,
    phase: phaseAt(line, 0, config.userColor),
    wrong: null,
    mistakes: 0,
    mistakesHere: 0,
    hintLevel: 0,
    hintsUsed: 0,
    usedArrowHint: false,
    userMoveMarks: new Array(countUserMoves(line, config.userColor)).fill('pending'),
    opponentBlundered: false,
    feedback: null,
    hintsHere: 0,
    feedbackSeq,
    startCandidates,
  }
}

function feedback(state: TrainerState, kind: FeedbackKind, node?: MoveNode, refutation?: MoveNode): { feedback: Feedback; feedbackSeq: number } {
  const id = state.feedbackSeq + 1
  const f: Feedback = { kind, id }
  if (node) f.node = node
  if (refutation) f.refutation = refutation
  return { feedback: f, feedbackSeq: id }
}

/** Plays `uci`-described move from `fen` with chess.js; null if illegal. `promotion` is case-insensitive. */
function tryMove(fen: string, from: string, to: string, promotion?: string) {
  try {
    const chess = new Chess(fen)
    const m = chess.move(promotion ? { from, to, promotion: promotion.toLowerCase() } : { from, to })
    return { san: m.san, from: m.from, to: m.to, promotion: m.promotion as string | undefined, fen: m.after }
  } catch {
    return null
  }
}

/** Switch the target line, keeping the marks of user moves already played. */
function retarget(state: TrainerState, line: Line, ply: number): TrainerState {
  if (line === state.line && ply === state.ply) return state
  const u = state.config.userColor
  const playedMarks = state.userMoveMarks.slice(0, countUserMoves(state.line, u, state.ply))
  const marks: TrainerState['userMoveMarks'] = new Array(countUserMoves(line, u)).fill('pending')
  const k = countUserMoves(line, u, ply)
  // Align the most recent played marks with the user moves before `ply` in the new line.
  for (let i = 0; i < k; i++) {
    const src = playedMarks.length - k + i
    marks[i] = src >= 0 ? playedMarks[src] : 'clean'
  }
  return { ...state, line, ply, userMoveMarks: marks }
}

function linesOf(rep: Repertoire, ids: string[]): Line[] {
  const out: Line[] = []
  for (const id of ids) {
    const l = lineById(rep, id)
    if (l) out.push(l)
  }
  return out
}

/** Random mode: find a line to follow after the user played book move `uci` at `state.fen`. */
function findRetarget(state: TrainerState, uci: string, ctx: TrainerContext): { line: Line; ply: number; candidates: string[] } | null {
  // 1. A candidate line (same move order so far) that continues with this move.
  const through = linesOf(ctx.rep, state.candidates).filter((l) => l.moves[state.ply]?.uci === uci)
  if (through.length) {
    return { line: pickFrom(ctx, through), ply: state.ply, candidates: through.map((l) => l.id) }
  }
  // 2. Transposition: the same position reached by another move order somewhere in the study.
  //    Only lines from the same start position that reach it at the SAME ply qualify, so that
  //    `history.length === ply` holds, every played user move maps onto one of the new line's
  //    user moves (no unplayed moves credited), and 'restart' (startCandidates) stays valid.
  //    A study move found only at another ply / from another start falls back to 'other-line'.
  const startKey = positionKey(state.line.startFen)
  const lines: Line[] = []
  for (const node of nodesFor(ctx.rep, state.fen, uci)) {
    if (node.ply - 1 !== state.ply) continue
    for (const l of ctx.rep.linesByNode.get(node.id) ?? []) {
      if (l.moves[state.ply] !== node || lines.includes(l)) continue
      if (positionKey(l.startFen) !== startKey) continue
      lines.push(l)
    }
  }
  if (lines.length === 0) return null
  return { line: pickFrom(ctx, lines), ply: state.ply, candidates: lines.map((l) => l.id) }
}

/** ctx.pick, guarded: a picker that returns something outside `lines` gets lines[0]. */
function pickFrom(ctx: TrainerContext, lines: Line[]): Line {
  const l = ctx.pick(lines)
  return l && lines.includes(l) ? l : lines[0]
}

/** Advance after the user played `node` (expected or accepted book move). */
function advanceUser(state: TrainerState, node: MoveNode, played: PlayedMove, kind: 'correct' | 'book-alt', ctx: TrainerContext): TrainerState {
  const u = state.config.userColor
  const marks = state.userMoveMarks.slice()
  const idx = countUserMoves(state.line, u, state.ply)
  if (idx < marks.length) marks[idx] = state.mistakesHere > 0 || state.hintsHere > 0 ? 'fixed' : 'clean'
  const ply = state.ply + 1
  const candidates =
    state.config.mode === 'random'
      ? linesOf(ctx.rep, state.candidates)
          .filter((l) => l.moves[state.ply]?.uci === played.uci)
          .map((l) => l.id)
      : state.candidates
  const done = ply >= state.line.moves.length
  const fb = feedback(state, done ? 'complete' : kind, node)
  return {
    ...state,
    ply,
    candidates,
    fen: played.fen,
    history: [...state.history, { ...played, nodeId: node.id }],
    lastMove: [played.from, played.to],
    phase: done ? 'complete' : phaseAt(state.line, ply, u),
    wrong: null,
    mistakesHere: 0,
    hintLevel: 0,
    hintsHere: 0,
    userMoveMarks: marks,
    ...fb,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initTrainer(line: Line, config: TrainerConfig, ctx: TrainerContext): TrainerState {
  let start: string[] = []
  if (config.mode === 'random') {
    const key = positionKey(line.startFen)
    start = ctx.rep.lines.filter((l) => positionKey(l.startFen) === key).map((l) => l.id)
    if (!start.includes(line.id)) start.push(line.id)
  }
  return fresh(line, config, start, 0)
}

/** line.moves[ply] when it is the user's turn (also while a wrong move is shown). */
export function expectedNode(state: TrainerState): MoveNode | null {
  if (state.phase !== 'userToMove' && state.phase !== 'wrongMove') return null
  const n = state.line.moves[state.ply]
  return n && n.color === state.config.userColor ? n : null
}

/** Last played study node (for the coach comment / arrows), null at the start. */
export function currentNode(state: TrainerState): MoveNode | null {
  return state.ply > 0 ? (state.line.moves[state.ply - 1] ?? null) : null
}

/** Which user move (0-based) is next == number of user moves already played in `line`. */
export function userMoveIndex(state: TrainerState): number {
  return countUserMoves(state.line, state.config.userColor, state.ply)
}

export function trainerReducer(state: TrainerState, action: TrainerAction): TrainerState {
  switch (action.type) {
    case 'opponentMove':
      return opponentMove(state, action.ctx)
    case 'userMove':
      return userMove(state, action.from, action.to, action.promotion, action.ctx)
    case 'takeBack':
      return takeBack(state)
    case 'hint':
      return hint(state)
    case 'restart': {
      // startCandidates = every line sharing the start position of the line we began with. If the
      // current line is not among them (should not happen: retargets keep the start position), it
      // starts elsewhere, so the old candidates would not match the board: restart on it alone.
      let start = state.startCandidates.slice()
      if (state.config.mode === 'random' && !start.includes(state.line.id)) start = [state.line.id]
      return fresh(state.line, state.config, start, state.feedbackSeq)
    }
    default:
      return state
  }
}

function opponentMove(state: TrainerState, ctx: TrainerContext): TrainerState {
  if (state.phase !== 'opponentToMove') return state
  const u = state.config.userColor
  let s = state
  const boardKey = positionKey(s.fen)
  if (s.config.mode === 'random' && s.candidates.length > 1) {
    // Only lines whose next move is an opponent move from exactly the position on the board.
    const pool = linesOf(ctx.rep, s.candidates).filter((l) => {
      const n = l.moves[s.ply]
      return n !== undefined && n.color !== u && positionKey(n.fenBefore) === boardKey
    })
    if (pool.length) {
      const target = ctx.pick(pool)
      if (target && target !== s.line && pool.includes(target)) s = retarget(s, target, s.ply)
    }
  }
  const node = s.line.moves[s.ply]
  if (!node || node.color === u) return state
  const synced = positionKey(node.fenBefore) === boardKey
  const m = synced ? tryMove(s.fen, node.from, node.to, node.promotion) : null
  if (!m) {
    // Unreachable while the invariants hold. Rather than freezing in 'opponentToMove' (the hook
    // would retry forever), resync the board to the target line's own position.
    console.warn(`[trainer] board out of sync with line ${s.line.id} at ply ${s.ply}; resyncing to the line`)
  }
  const played: PlayedMove = {
    san: m ? m.san : node.san,
    uci: node.uci,
    from: node.from,
    to: node.to,
    fen: m ? m.fen : node.fen,
    by: 'opponent',
    nodeId: node.id,
  }
  const ply = s.ply + 1
  const candidates =
    s.config.mode === 'random'
      ? linesOf(ctx.rep, s.candidates)
          .filter((l) => l.moves[s.ply]?.uci === node.uci)
          .map((l) => l.id)
      : s.candidates
  if (s.config.mode === 'random' && !candidates.includes(s.line.id)) candidates.push(s.line.id)
  const blunder = isBlunder(node)
  const fb = blunder ? feedback(s, 'opponent-blunder', node) : { feedback: null, feedbackSeq: s.feedbackSeq }
  return {
    ...s,
    ply,
    candidates,
    fen: played.fen,
    history: [...s.history, played],
    lastMove: [played.from, played.to],
    phase: phaseAt(s.line, ply, u),
    wrong: null,
    mistakesHere: 0,
    hintLevel: 0,
    hintsHere: 0,
    opponentBlundered: s.opponentBlundered || blunder,
    ...fb,
  }
}

function userMove(state: TrainerState, from: string, to: string, promotion: string | undefined, ctx: TrainerContext): TrainerState {
  if (state.phase !== 'userToMove') return state
  const m = tryMove(state.fen, from, to, promotion)
  if (!m) return state // illegal: nothing happens
  const uci = m.from + m.to + (m.promotion ?? '')
  const played: PlayedMove = { san: m.san, uci, from: m.from, to: m.to, fen: m.fen, by: 'user', nodeId: null }

  // 1. The expected move.
  const expected = expectedNode(state)
  if (expected && expected.uci === uci) return advanceUser(state, expected, played, 'correct', ctx)

  // The de-duplicated book node for this move (main-line-most), plus every study node with the
  // same position + move: a move counts as good if ANY chapter plays it without ?/??/?!.
  const repNode = bookMovesAt(ctx.rep, state.fen).find((n) => n.uci === uci)
  const all = repNode ? nodesFor(ctx.rep, state.fen, uci) : []
  const book = repNode && !isDubious(repNode) ? repNode : (all.find((n) => !isDubious(n)) ?? repNode)
  if (book && !isDubious(book)) {
    // 2. Another (good) move from the study.
    if (state.config.mode === 'random') {
      const r = findRetarget(state, uci, ctx)
      if (r) {
        const s = { ...retarget(state, r.line, r.ply), candidates: r.candidates }
        return advanceUser(s, r.line.moves[r.ply], played, 'book-alt', ctx)
      }
    }
    return {
      ...state,
      hintLevel: state.hintLevel >= 1 ? state.hintLevel : 1,
      ...feedback(state, 'other-line', book),
    }
  }

  // 3. A move the study marks as bad, or 4. any other move.
  const knownBad = book && isDubious(book) ? book : null
  let refutation: MoveNode | undefined
  if (knownBad) {
    refutation = knownBad.children[0]
    if (!refutation) {
      for (const n of all) {
        if (n.children[0]) {
          refutation = n.children[0]
          break
        }
      }
    }
  }
  return {
    ...state,
    phase: 'wrongMove',
    wrong: { ...played, nodeId: knownBad ? knownBad.id : null },
    fen: played.fen,
    lastMove: [played.from, played.to],
    mistakes: state.mistakes + 1,
    mistakesHere: state.mistakesHere + 1,
    ...(knownBad ? feedback(state, 'known-bad', knownBad, refutation) : feedback(state, 'wrong', expected ?? undefined)),
  }
}

function takeBack(state: TrainerState): TrainerState {
  if (state.phase !== 'wrongMove') return state
  const last = state.history[state.history.length - 1]
  let hintLevel = state.hintLevel
  if (state.mistakesHere >= 3) hintLevel = 2
  else if (state.mistakesHere >= 2 && hintLevel < 1) hintLevel = 1
  const base: TrainerState = {
    ...state,
    phase: 'userToMove',
    wrong: null,
    fen: last ? last.fen : state.line.startFen,
    lastMove: last ? [last.from, last.to] : null,
    hintLevel,
    feedback: null,
  }
  if (hintLevel > state.hintLevel) return { ...base, ...feedback(state, 'hint', expectedNode(base) ?? undefined) }
  return base
}

/**
 * hintLevel += 1 (max 2), counted in hintsUsed. `usedArrowHint` is set only when the arrow is the
 * SECOND hint the kid asked for at this move. If level 1 came for free (other-line, or take-back
 * escalation), the next press shows the arrow but costs like a single hint, so playing a correct
 * study move never costs more than playing a wrong one.
 */
function hint(state: TrainerState): TrainerState {
  if (state.phase !== 'userToMove' || state.hintLevel >= 2) return state
  const hintLevel = (state.hintLevel + 1) as 1 | 2
  return {
    ...state,
    hintLevel,
    hintsUsed: state.hintsUsed + 1,
    hintsHere: state.hintsHere + 1,
    usedArrowHint: state.usedArrowHint || (hintLevel === 2 && state.hintsHere >= 1),
    ...feedback(state, 'hint', expectedNode(state) ?? undefined),
  }
}
