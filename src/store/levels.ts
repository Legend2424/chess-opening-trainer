// Levels from lifetime XP (= lifetime coins earned). Pure; runs under plain node.

import type { LevelInfo } from '../types.ts'

interface NamedLevel {
  name: string
  emoji: string
  minXp: number
}

/** Named levels, index + 1 = level number. */
export const LEVELS: readonly NamedLevel[] = [
  { name: 'Pawn', emoji: '♟️', minXp: 0 },
  { name: 'Knight', emoji: '♞', minXp: 250 },
  { name: 'Bishop', emoji: '♝', minXp: 600 },
  { name: 'Rook', emoji: '♜', minXp: 1200 },
  { name: 'Queen', emoji: '♛', minXp: 2500 },
  { name: 'King', emoji: '♚', minXp: 5000 },
  { name: 'Grandmaster', emoji: '🏆', minXp: 10000 },
]

/** After Grandmaster: "Grandmaster ★N" every +5000 XP. */
export const STAR_STEP_XP = 5000

const GM_INDEX = LEVELS.length - 1
const GM_XP = LEVELS[GM_INDEX].minXp

export function levelForXp(xpIn: number): LevelInfo {
  const xp = Number.isFinite(xpIn) && xpIn > 0 ? Math.floor(xpIn) : 0
  if (xp < GM_XP) {
    let i = 0
    while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].minXp) i++
    const l = LEVELS[i]
    return { level: i + 1, name: l.name, emoji: l.emoji, minXp: l.minXp, nextXp: LEVELS[i + 1].minXp }
  }
  const stars = Math.floor((xp - GM_XP) / STAR_STEP_XP)
  const minXp = GM_XP + stars * STAR_STEP_XP
  const gm = LEVELS[GM_INDEX]
  return {
    level: GM_INDEX + 1 + stars,
    name: stars === 0 ? gm.name : `${gm.name} ★${stars}`,
    emoji: gm.emoji,
    minXp,
    // The star ladder never ends, so there is always a next goal to show.
    nextXp: minXp + STAR_STEP_XP,
  }
}

/** 0..1 progress from the current level's minXp to the next level. */
export function levelProgress(xp: number): number {
  const info = levelForXp(xp)
  if (info.nextXp === null) return 1
  const span = info.nextXp - info.minXp
  const x = Number.isFinite(xp) ? Math.max(0, xp) : 0
  return span > 0 ? Math.min(1, Math.max(0, (x - info.minXp) / span)) : 1
}

/** Level-up detection between two XP totals (null if same level). */
export function levelUpBetween(fromXp: number, toXp: number): { from: LevelInfo; to: LevelInfo } | null {
  const from = levelForXp(fromXp)
  const to = levelForXp(toXp)
  return to.level > from.level ? { from, to } : null
}
