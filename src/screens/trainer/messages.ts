// Hoot's lines for the trainer: kind, short, varied. Pure helpers.
import type { Line, MoveNode } from '../../types.ts'
import { moveLabel } from '../../chess/repertoire.ts'
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

/** The opponent's move just played (if the last move was theirs). */
export function lastOpponentMove(state: TrainerState): MoveNode | null {
  const n = state.ply > 0 ? state.line.moves[state.ply - 1] : undefined
  return n && n.color !== state.config.userColor ? n : null
}

const NUMBERED = /^(\d+)(\.\.\.|\.)(.+)$/

/**
 * The line name with the user's not-yet-played moves hidden ("4.c4 Qd6" ->
 * "4.? Qd6" for White), so the name never gives the answer away.
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
      const hidden = color === userColor && (idx < 0 || idx >= ply)
      if (!hidden) return tok
      // Always numbered, so a hidden move never reads like a "?" annotation.
      return `${num}${color === 'w' ? '.' : '...'}?`
    })
    .join(' ')
}
