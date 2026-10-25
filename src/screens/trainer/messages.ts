// Hoot's lines for the trainer: kind, short, varied. Pure helpers.
import type { Line, MoveNode, Repertoire } from '../../types.ts'
import { isBlunder, moveLabel, positionKey } from '../../chess/repertoire.ts'
import type { TrainerState } from '../../trainer/trainerReducer.ts'
import type { MistakeVerdict } from '../../engine/engineService.ts'

/** Deterministic "random" choice so a message doesn't change on re-render. */
export function pickBy<T>(list: readonly T[], seed: number): T {
  return list[Math.abs(Math.floor(seed)) % list.length]
}

/** Neutral on purpose: the engine may add "that move loses material" right after. */
export const WRONG_LINES = [
  "Oops! That's not the move from your study.",
  'Nice try! Your study has a different move here.',
  'Not quite — your coach plays something else here.',
  "Hmm, that's not the one. Let's have another go!",
  "Whoops! Let's find your coach's move.",
] as const

export const PRAISE_LINES = ['Nice move! 👍', "That's it! ✅", 'Yes! Spot on! 🎯', 'Great memory! 🧠', 'Correct! ✨'] as const

/** Branch start (lap mode): the shared start was played for the kid. */
export const SKIP_AHEAD_LINE = '⏩ Skipped ahead! You know how this starts — the grey moves were played for you.'

/** Main-line round: a line finished with a mistake comes back once at the end. */
export const REQUEUE_LINE = "Let's fix that one at the end 💪"

/** Leaving a main-line round part-way. */
export const LEAVE_ROUND_LINE = 'Lines you finished still count — the round bonus needs the whole round.'

export const YOUR_MOVE_LINES = [
  'Your move! What does your coach play here?',
  "Your turn! What's the move from your study? 🤔",
  'Your move — you know this one! 💪',
] as const

export function insightText(v: MistakeVerdict): string {
  switch (v.kind) {
    case 'blunder':
      return '⚠️ That move loses material!'
    case 'worse':
      return 'Hmm, that gives your opponent the better game.'
    default:
      return "Not a bad move — but your coach's plan is different."
  }
}

export interface CoachNote {
  id: string
  label: string
  text: string
}

/**
 * Coach comments worth showing now: every study move played since (and
 * including) the user's last move, so a comment on the user's move stays
 * readable after the opponent's quick reply.
 */
export function recentNotes(state: TrainerState): CoachNote[] {
  const out: CoachNote[] = []
  for (let i = state.ply - 1; i >= 0; i--) {
    const n = state.line.moves[i]
    if (!n) break
    if (n.comment) out.unshift({ id: n.id, label: moveLabel(n), text: n.comment })
    if (n.color === state.config.userColor) break
  }
  return out
}

/** Coach comments of the tail moves shown so far (after the line is complete). */
export function tailNotes(state: TrainerState): CoachNote[] {
  const out: CoachNote[] = []
  const tail = state.line.tail ?? []
  for (let i = 0; i < state.tailPly && i < tail.length; i++) {
    const n = tail[i]
    if (n.comment) out.push({ id: n.id, label: moveLabel(n), text: n.comment })
  }
  return out
}

export interface OpeningNorms {
  /** The opponent's most common first move (when the opponent moves first), e.g. 1.e4 in the Sicilian. */
  firstOpponent: MoveNode | null
  /** Per position (positionKey): the kid's most common FIRST move of a line from there. */
  firstUser: Map<string, MoveNode>
}

const normsCache = new WeakMap<Repertoire, OpeningNorms>()

/** How the opening's lines usually start (majority by number of lines). Cached per repertoire. */
export function openingNorms(rep: Repertoire): OpeningNorms {
  const hit = normsCache.get(rep)
  if (hit) return hit
  const u = rep.opening.side === 'white' ? 'w' : 'b'
  const opp = new Map<string, { node: MoveNode; n: number }>()
  const user = new Map<string, Map<string, { node: MoveNode; n: number }>>()
  for (const l of rep.lines) {
    const first = l.moves[0]
    if (first && first.color !== u) {
      const e = opp.get(first.uci)
      if (e) e.n++
      else opp.set(first.uci, { node: first, n: 1 })
    }
    const fu = l.moves.find((m) => m.color === u)
    if (fu) {
      const key = positionKey(fu.fenBefore)
      let m = user.get(key)
      if (!m) user.set(key, (m = new Map()))
      const e = m.get(fu.uci)
      if (e) e.n++
      else m.set(fu.uci, { node: fu, n: 1 })
    }
  }
  const top = (m: Map<string, { node: MoveNode; n: number }>) => [...m.values()].sort((a, b) => b.n - a.n)[0]?.node ?? null
  const firstUser = new Map<string, MoveNode>()
  for (const [k, m] of user) {
    const t = top(m)
    if (t) firstUser.set(k, t)
  }
  const out: OpeningNorms = { firstOpponent: top(opp), firstUser }
  normsCache.set(rep, out)
  return out
}

/** The opponent's move just played (if the last move was theirs). */
export function lastOpponentMove(state: TrainerState): MoveNode | null {
  const n = state.ply > 0 ? state.line.moves[state.ply - 1] : undefined
  return n && n.color !== state.config.userColor ? n : null
}

const NUMBERED = /^(\d+)(\.\.\.|\.)(.+)$/

/**
 * The line name with the user's not-yet-played moves hidden ("4.c4 Qd6" ->
 * "4.? Qd6" for White), so the name never gives the answer away. An opponent
 * blunder still to come is hidden too (it would spoil "punish the blunder").
 */
export function displayLineName(line: Line, ply: number, revealAll: boolean, userColor: 'w' | 'b'): string {
  if (revealAll || !line.name || line.name === 'Main line') return line.name || 'Main line'
  let prevNum = 0
  let prevColor: 'w' | 'b' | null = null
  let searchFrom = 0
  return line.name
    .split(/\s+/)
    .map((tok) => {
      const m = NUMBERED.exec(tok)
      let num: number
      let color: 'w' | 'b'
      let san: string
      if (m) {
        num = Number(m[1])
        color = m[2] === '...' ? 'b' : 'w'
        san = m[3]
      } else if (prevColor && /^[A-Za-z]/.test(tok)) {
        color = prevColor === 'w' ? 'b' : 'w'
        num = prevColor === 'w' ? prevNum : prevNum + 1
        san = tok
      } else {
        prevColor = null // "…" or anything else
        return tok
      }
      prevNum = num
      prevColor = color
      const idx = line.moves.findIndex((n, i) => i >= searchFrom && n.moveNumber === num && n.color === color && n.san === san)
      if (idx >= 0) searchFrom = idx + 1
      const hidden =
        (color === userColor && (idx < 0 || idx >= ply)) || (color !== userColor && idx >= ply && isBlunder(line.moves[idx]))
      if (!hidden) return tok
      // Always numbered, so a hidden move never reads like a "?" annotation.
      return `${num}${color === 'w' ? '.' : '...'}?`
    })
    .join(' ')
}
