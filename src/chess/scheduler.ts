// Spaced repetition (Leitner boxes) for practice lines. Pure logic.

import type { Line, LineStats } from '../types.ts'

export const DAY_MS = 24 * 60 * 60 * 1000

/** Review interval per Leitner box, in days (box 0 = due immediately). */
export const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 8, 16]
export const MAX_BOX = BOX_INTERVAL_DAYS.length - 1

export interface LineResult {
  mistakes: number
  hintsUsed: number
  usedArrowHint: boolean
  learnMode: boolean
}

export function isMastered(s?: LineStats): boolean {
  return !!s && s.box >= 3
}

/** Local midnight at the end of `now`'s day (epoch ms). */
export function startOfNextLocalDay(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/**
 * Due for review TODAY (local calendar day): a line whose review time is later
 * today already counts, so practising a bit earlier each day still finds that
 * day's reviews. Unseen lines count as due. (The anti-farming rule in
 * store/rewards.ts deliberately keeps using the exact timestamp.)
 */
export function isDueToday(s: LineStats | undefined, now: number): boolean {
  return !s || !(s.dueAt >= startOfNextLocalDay(now))
}

/** Unseen lines count as due. Due = due today (see isDueToday). */
export function isDue(s: LineStats | undefined, now: number): boolean {
  return isDueToday(s, now)
}

function clampBox(b: number): number {
  if (!Number.isFinite(b)) return 0
  return Math.max(0, Math.min(MAX_BOX, Math.floor(b)))
}

/**
 * New stats after completing a line.
 * - learn mode: box unchanged; if box is 0 the line comes back tomorrow, otherwise its schedule is kept.
 * - perfect (0 mistakes, 0 hints): box + 1 (max 5).
 * - at most 1 mistake and no arrow hint: box unchanged, but at least 1.
 * - otherwise: box 0 (due again right away).
 * dueAt = now + BOX_INTERVAL_DAYS[box] days.
 */
export function updateLineStats(prev: LineStats | undefined, r: LineResult, now: number): LineStats {
  const p: LineStats = prev ?? { attempts: 0, completions: 0, perfects: 0, box: 0, lastPracticed: 0, dueAt: now, lastMistakes: 0 }
  const prevBox = clampBox(p.box)
  const perfect = r.mistakes === 0 && r.hintsUsed === 0
  let box: number
  let dueAt: number
  if (r.learnMode) {
    box = prevBox
    dueAt = box === 0 ? now + DAY_MS : prev ? p.dueAt : now + BOX_INTERVAL_DAYS[box] * DAY_MS
  } else {
    if (perfect) box = Math.min(MAX_BOX, prevBox + 1)
    else if (r.mistakes <= 1 && !r.usedArrowHint) box = Math.max(1, prevBox)
    else box = 0
    dueAt = now + BOX_INTERVAL_DAYS[box] * DAY_MS
  }
  return {
    attempts: (p.attempts || 0) + 1,
    completions: (p.completions || 0) + 1,
    perfects: (p.perfects || 0) + (perfect && !r.learnMode ? 1 : 0),
    box,
    lastPracticed: now,
    dueAt,
    lastMistakes: r.mistakes,
  }
}

/**
 * Selection weight: unseen 4 · due today 3 + days overdue (min 3, capped at 10)
 * · not due 0.3 / (box + 1).
 */
export function lineWeight(s: LineStats | undefined, now: number): number {
  if (!s) return 4
  if (isDueToday(s, now)) return Math.min(10, Math.max(3, 3 + (now - s.dueAt) / DAY_MS))
  return 0.3 / (clampBox(s.box) + 1)
}

/**
 * Weighted random pick. Avoids `avoidLineId` unless it is the only line.
 * Deterministic for a given `rng`. Throws if `lines` is empty.
 */
export function pickLine(
  lines: Line[],
  stats: Record<string, LineStats>,
  now: number,
  opts: { avoidLineId?: string; rng?: () => number } = {},
): Line {
  if (lines.length === 0) throw new Error('pickLine: no lines to pick from')
  const rng = opts.rng ?? Math.random
  let pool = lines
  if (opts.avoidLineId !== undefined && lines.length > 1) {
    const filtered = lines.filter((l) => l.id !== opts.avoidLineId)
    if (filtered.length > 0) pool = filtered
  }
  if (pool.length === 1) return pool[0]
  const weights = pool.map((l) => lineWeight(stats[l.id], now))
  const total = weights.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
  let r = rng() * total
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r < 0) return pool[i]
  }
  return pool[pool.length - 1]
}

/**
 * Like pickLine, but first picks a CHAPTER (weight = its most urgent line's
 * weight), then a line inside it. A chapter with 80 lines would otherwise come
 * up 80 times as often as one with 9 (Coach's Choice re-picks at every opponent
 * move, so each branch's share follows its number of leaf lines).
 */
export function pickLineBalanced(
  lines: Line[],
  stats: Record<string, LineStats>,
  now: number,
  opts: { avoidLineId?: string; rng?: () => number } = {},
): Line {
  if (lines.length === 0) throw new Error('pickLineBalanced: no lines to pick from')
  const rng = opts.rng ?? Math.random
  let pool = lines
  if (opts.avoidLineId !== undefined && lines.length > 1) {
    const filtered = lines.filter((l) => l.id !== opts.avoidLineId)
    if (filtered.length > 0) pool = filtered
  }
  const groups = new Map<string, Line[]>()
  for (const l of pool) {
    const g = groups.get(l.chapterId)
    if (g) g.push(l)
    else groups.set(l.chapterId, [l])
  }
  if (groups.size <= 1) return pickLine(pool, stats, now, { rng })
  const list = [...groups.values()]
  const weights = list.map((g) => g.reduce((m, l) => Math.max(m, lineWeight(stats[l.id], now)), 0))
  const total = weights.reduce((a, b) => a + b, 0)
  let chosen = list[list.length - 1]
  if (!(total > 0)) chosen = list[Math.min(list.length - 1, Math.floor(rng() * list.length))]
  else {
    let r = rng() * total
    for (let i = 0; i < list.length; i++) {
      r -= weights[i]
      if (r < 0) {
        chosen = list[i]
        break
      }
    }
  }
  return pickLine(chosen, stats, now, { rng })
}

export function openingProgress(
  lines: Line[],
  stats: Record<string, LineStats>,
  now: number,
): { total: number; seen: number; mastered: number; due: number; percentMastered: number } {
  let seen = 0
  let mastered = 0
  let due = 0
  for (const l of lines) {
    const s = stats[l.id]
    if (!s) continue
    seen++
    if (isMastered(s)) mastered++
    if (isDueToday(s, now)) due++
  }
  const total = lines.length
  // Floored (100% only when everything is mastered), but at least 1% once a line is mastered.
  const percentMastered = total ? (mastered > 0 ? Math.max(1, Math.floor((mastered / total) * 100)) : 0) : 0
  return { total, seen, mastered, due, percentMastered }
}

/** Deterministic PRNG (mulberry32) — handy for tests and reproducible picks. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
