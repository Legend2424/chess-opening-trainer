// Spaced repetition (Leitner boxes) for practice lines. Pure logic.

import type { Line, LineStats, LineTier } from '../types.ts'

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
 * Longest review gap per practice tier, in days (docs/practice-structure.md §2.1): a main line at
 * box 4 or 5 comes back every week. Applied when a review is written; saved due dates stay.
 */
export const MAX_INTERVAL_DAYS: Record<LineTier, number> = { main: 7, key: 12, deep: 16, planb: 16 }
const DEFAULT_MAX_INTERVAL_DAYS = BOX_INTERVAL_DAYS[MAX_BOX]

/** The review-gap cap for a tier; an unclassified line (undefined) gets the uncapped 16 days. */
export function maxIntervalDaysFor(tier: LineTier | undefined): number {
  return (tier && MAX_INTERVAL_DAYS[tier]) || DEFAULT_MAX_INTERVAL_DAYS
}

/**
 * New stats after completing a line.
 * - learn mode: box unchanged; if box is 0 the line comes back tomorrow, otherwise its schedule is kept.
 * - perfect (0 mistakes, 0 hints): box + 1 (max 5).
 * - at most 1 mistake and no arrow hint: box unchanged, but at least 1.
 * - otherwise: box 0 (due again right away).
 * dueAt = now + min(BOX_INTERVAL_DAYS[box], maxIntervalDays) days. The default cap (16) changes nothing.
 */
export function updateLineStats(prev: LineStats | undefined, r: LineResult, now: number, maxIntervalDays: number = DEFAULT_MAX_INTERVAL_DAYS): LineStats {
  const p: LineStats = prev ?? { attempts: 0, completions: 0, perfects: 0, box: 0, lastPracticed: 0, dueAt: now, lastMistakes: 0 }
  const prevBox = clampBox(p.box)
  const perfect = r.mistakes === 0 && r.hintsUsed === 0
  const cap = Number.isFinite(maxIntervalDays) && maxIntervalDays >= 0 ? maxIntervalDays : DEFAULT_MAX_INTERVAL_DAYS
  const interval = (b: number) => Math.min(BOX_INTERVAL_DAYS[b], cap) * DAY_MS
  let box: number
  let dueAt: number
  if (r.learnMode) {
    box = prevBox
    dueAt = box === 0 ? now + Math.min(1, cap) * DAY_MS : prev ? p.dueAt : now + interval(box)
  } else {
    if (perfect) box = Math.min(MAX_BOX, prevBox + 1)
    else if (r.mistakes <= 1 && !r.usedArrowHint) box = Math.max(1, prevBox)
    else box = 0
    dueAt = now + interval(box)
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

// ---------------------------------------------------------------------------
// Coach's Choice by tier (docs/practice-structure.md §2.1)
// ---------------------------------------------------------------------------

export type CoachTier = 'main' | 'key' | 'deep'
const COACH_TIERS: readonly CoachTier[] = ['main', 'key', 'deep']

/** Base tier quotas (percent). */
export const COACH_QUOTA: Record<CoachTier, number> = { main: 35, key: 40, deep: 25 }
/** The main quota once every main line of the opening has a gold medal. */
export const COACH_QUOTA_MAIN_ALL_GOLD = 20

/** line.tier, unclassified = 'deep' (same rule as lineTiers.tierOf; no runtime import needed here). */
function tierOfLine(l: Line): LineTier {
  return l.tier ?? 'deep'
}

/**
 * Lines Coach's Choice may pick (§2.1 steps 1–2): never Plan B; a main line always; any other line
 * once it or its parent line has had one good run (box >= 1). Nothing is shown as locked.
 */
export function coachEligible(lines: readonly Line[], stats: Readonly<Record<string, LineStats>>): Line[] {
  const learned = (id: string | undefined) => id !== undefined && (stats[id]?.box ?? 0) >= 1
  return lines.filter((l) => {
    const t = tierOfLine(l)
    if (t === 'planb') return false
    return t === 'main' || learned(l.id) || learned(l.parentLineId)
  })
}

/**
 * Share of each tier (sums to 1; all 0 when nothing is eligible). Per-line weight w_t = quota_t / n_t,
 * capped for key and deep at the main lines' weight; a tier's share is proportional to n_t * w_t.
 */
export function coachTierShares(eligible: readonly Line[], allMainsGold: boolean): Record<CoachTier, number> {
  const n: Record<CoachTier, number> = { main: 0, key: 0, deep: 0 }
  for (const l of eligible) {
    const t = tierOfLine(l)
    if (t !== 'planb') n[t]++
  }
  const quota: Record<CoachTier, number> = { ...COACH_QUOTA, main: allMainsGold ? COACH_QUOTA_MAIN_ALL_GOLD : COACH_QUOTA.main }
  const w: Record<CoachTier, number> = { main: 0, key: 0, deep: 0 }
  for (const t of COACH_TIERS) w[t] = n[t] > 0 ? quota[t] / n[t] : 0
  if (n.main > 0) {
    w.key = Math.min(w.key, w.main)
    w.deep = Math.min(w.deep, w.main)
  }
  const total = COACH_TIERS.reduce((s, t) => s + n[t] * w[t], 0)
  const out: Record<CoachTier, number> = { main: 0, key: 0, deep: 0 }
  if (!(total > 0)) return out
  for (const t of COACH_TIERS) out[t] = (n[t] * w[t]) / total
  return out
}

/**
 * Coach's Choice: picks a tier by its share (rng), then a line inside it with pickLineBalanced
 * (chapter balancing + spaced-repetition weights). `avoidLineId` is avoided inside the tier, and a
 * tier whose only eligible line is the avoided one sits this pick out (unless nothing else is
 * eligible). With nothing eligible (e.g. unclassified lines), falls back to pickLineBalanced over the
 * non-Plan-B lines, then over all lines. Throws if `lines` is empty.
 */
export function pickCoachLine(
  lines: Line[],
  stats: Record<string, LineStats>,
  now: number,
  opts: { avoidLineId?: string; rng?: () => number } = {},
): Line {
  if (lines.length === 0) throw new Error('pickCoachLine: no lines to pick from')
  const rng = opts.rng ?? Math.random
  const eligible = coachEligible(lines, stats)
  if (eligible.length === 0) {
    const notB = lines.filter((l) => tierOfLine(l) !== 'planb')
    return pickLineBalanced(notB.length ? notB : lines, stats, now, opts)
  }
  const mains = lines.filter((l) => tierOfLine(l) === 'main')
  const allMainsGold = mains.length > 0 && mains.every((l) => stats[l.id]?.medal === 3)
  const shares = coachTierShares(eligible, allMainsGold)
  const pools: Record<CoachTier, Line[]> = { main: [], key: [], deep: [] }
  for (const l of eligible) {
    const t = tierOfLine(l)
    if (t !== 'planb') pools[t].push(l)
  }
  const avoid = opts.avoidLineId
  if (avoid !== undefined && eligible.length > 1) {
    for (const t of COACH_TIERS) if (pools[t].length === 1 && pools[t][0].id === avoid) shares[t] = 0
  }
  const live = COACH_TIERS.filter((t) => shares[t] > 0 && pools[t].length > 0)
  if (live.length === 0) return pickLineBalanced(eligible, stats, now, { avoidLineId: avoid, rng })
  const total = live.reduce((s, t) => s + shares[t], 0)
  let r = rng() * total
  let tier = live[live.length - 1]
  for (const t of live) {
    r -= shares[t]
    if (r < 0) {
      tier = t
      break
    }
  }
  // Inside the tier every line competes on its own spaced-repetition weight (no
  // chapter balancing): a chapter with a single key reply must not hand that one
  // line its whole chapter's slot, or it would come up more often than a main line.
  return pickLine(pools[tier], stats, now, { avoidLineId: avoid, rng })
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
