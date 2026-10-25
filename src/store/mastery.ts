// Main-line medals, per-tier progress, "Tournament ready", laps and the
// main-line round bonus (docs/practice-structure.md §3, §4). Pure; runs under plain node.
//
// Tiers come from Line.tier (set by src/chess/lineTiers.ts on every build). A
// line without a tier counts as 'deep' here, like lineTiers.tierOf().

import type { LapRecord, Line, LineStats, LineTier, Profile } from '../types.ts'
import { isDueToday, isMastered } from '../chess/scheduler.ts'
import type { DailyStateX } from './defaults.ts'
import { effectiveDaily, nonNegInt } from './rewards.ts'

function tierOfLine(line: Line): LineTier {
  return line.tier ?? 'deep'
}

function boxOf(s: LineStats | undefined): number {
  return s ? Math.min(5, nonNegInt(s.box)) : 0
}

// ---------------------------------------------------------------------------
// Main-line medals (§3.2): earned once, never lost
// ---------------------------------------------------------------------------

export const MEDALS: ReadonlyArray<{
  level: 1 | 2 | 3
  name: 'Bronze' | 'Silver' | 'Gold'
  emoji: string
  perfects: number
  days: number
  box: number
  coins: number
}> = [
  { level: 1, name: 'Bronze', emoji: '🥉', perfects: 5, days: 1, box: 0, coins: 10 },
  { level: 2, name: 'Silver', emoji: '🥈', perfects: 15, days: 4, box: 0, coins: 25 },
  { level: 3, name: 'Gold', emoji: '🥇', perfects: 30, days: 8, box: 3, coins: 50 },
]

/**
 * Distinct local days with a perfect run. Old saves have no `perfectDays`: they
 * read as min(perfects, box) (each box promotion happened on its own day) until
 * the next perfect run writes the real value.
 */
export function perfectDaysOf(s: LineStats | undefined): number {
  if (!s) return 0
  if (typeof s.perfectDays === 'number' && Number.isFinite(s.perfectDays)) return nonNegInt(s.perfectDays)
  return Math.min(nonNegInt(s.perfects), boxOf(s))
}

/** The medal stored on the line (0 = none). */
export function medalOf(s: LineStats | undefined): 0 | 1 | 2 | 3 {
  const m = s?.medal
  return m === 1 || m === 2 || m === 3 ? m : 0
}

/** The best medal the stats qualify for right now (not necessarily paid yet). */
export function qualifiedMedal(s: LineStats | undefined): 0 | 1 | 2 | 3 {
  if (!s) return 0
  const perfects = nonNegInt(s.perfects)
  const days = perfectDaysOf(s)
  const box = boxOf(s)
  let best: 0 | 1 | 2 | 3 = 0
  for (const m of MEDALS) if (perfects >= m.perfects && days >= m.days && box >= m.box) best = m.level
  return best
}

/**
 * The medal earned so far (stored) and what the next one needs. `next` is null
 * at gold. Remaining = next.perfects - perfects (runs) and next.days - days
 * (days); either can be 0 or below when only the other one is missing (or the
 * medal is waiting to be paid on the line's next completion).
 */
export function medalProgress(s: LineStats | undefined): {
  level: 0 | 1 | 2 | 3
  next: (typeof MEDALS)[number] | null
  perfects: number
  days: number
  box: number
} {
  const level = medalOf(s)
  return {
    level,
    next: MEDALS.find((m) => m.level === level + 1) ?? null,
    perfects: s ? nonNegInt(s.perfects) : 0,
    days: perfectDaysOf(s),
    box: boxOf(s),
  }
}

// ---------------------------------------------------------------------------
// Per tier (§3.3)
// ---------------------------------------------------------------------------

export interface TierCount {
  total: number
  seen: number
  mastered: number
  due: number
}

/** total / seen / mastered / due per tier (same counting as scheduler.openingProgress). */
export function tierProgress(
  lines: readonly Line[],
  stats: Readonly<Record<string, LineStats>>,
  now: number,
): Record<LineTier, TierCount> {
  const out: Record<LineTier, TierCount> = {
    main: { total: 0, seen: 0, mastered: 0, due: 0 },
    key: { total: 0, seen: 0, mastered: 0, due: 0 },
    deep: { total: 0, seen: 0, mastered: 0, due: 0 },
    planb: { total: 0, seen: 0, mastered: 0, due: 0 },
  }
  for (const l of lines) {
    const c = out[tierOfLine(l)]
    c.total++
    const s = Object.prototype.hasOwnProperty.call(stats, l.id) ? stats[l.id] : undefined
    if (!s) continue
    c.seen++
    if (isMastered(s)) c.mastered++
    if (isDueToday(s, now)) c.due++
  }
  return out
}

// ---------------------------------------------------------------------------
// Tournament ready (§3.4)
// ---------------------------------------------------------------------------

export interface Readiness {
  percent: number
  ready: boolean
  mains: number
  /** Main lines with at least bronze / silver / gold. */
  mainsByMedal: [number, number, number]
  keys: number
  keysMastered: number
}

/**
 * mainPart = average medal/3 over main lines, keyPart = average min(box, 3)/3
 * over key replies; percent = floor(100 * (half of each, or mainPart alone when
 * there are no key replies)), at least 1 when above 0. Ready = 100%.
 * Integer arithmetic, so 100 means exactly every main gold + every key mastered.
 */
export function readiness(lines: readonly Line[], stats: Readonly<Record<string, LineStats>>): Readiness {
  const get = (id: string): LineStats | undefined => (Object.prototype.hasOwnProperty.call(stats, id) ? stats[id] : undefined)
  let mains = 0
  let mainPoints = 0
  const mainsByMedal: [number, number, number] = [0, 0, 0]
  let keys = 0
  let keyPoints = 0
  let keysMastered = 0
  for (const l of lines) {
    const t = tierOfLine(l)
    const s = get(l.id)
    if (t === 'main') {
      mains++
      const m = medalOf(s)
      mainPoints += m
      for (let i = 0; i < m; i++) mainsByMedal[i]++
    } else if (t === 'key') {
      keys++
      const b = boxOf(s)
      keyPoints += Math.min(b, 3)
      if (b >= 3) keysMastered++
    }
  }
  let percent = 0
  if (mains > 0) {
    // keys ? (mainPoints/(3·mains) + keyPoints/(3·keys)) / 2 : mainPoints/(3·mains)
    const num = keys > 0 ? mainPoints * keys + keyPoints * mains : mainPoints
    const den = keys > 0 ? 6 * mains * keys : 3 * mains
    percent = num > 0 ? Math.max(1, Math.floor((100 * num) / den)) : 0
  }
  return { percent, ready: percent === 100, mains, mainsByMedal, keys, keysMastered }
}

// ---------------------------------------------------------------------------
// Laps (§2.3, §4.5)
// ---------------------------------------------------------------------------

export const LAP_COINS_PER_LINE = 2

/** The line belongs to the lap set (Plan B only when the parent has it on). */
export function inLap(line: Line, includePlanB: boolean): boolean {
  return includePlanB || line.tier !== 'planb'
}

/** The current lap of an opening (absent → lap 1, nothing done). Always a fresh, sanitised copy. */
export function lapOf(p: Profile, openingId: string): LapRecord {
  const laps = p.laps
  const rec = laps && Object.prototype.hasOwnProperty.call(laps, openingId) ? laps[openingId] : undefined
  if (!rec || typeof rec !== 'object') return { n: 1, done: [] }
  const n = typeof rec.n === 'number' && Number.isFinite(rec.n) && rec.n >= 1 ? Math.floor(rec.n) : 1
  const done = Array.isArray(rec.done) ? rec.done.filter((x): x is string => typeof x === 'string') : []
  return { n, done }
}

/** Lap progress against the current lap set (ids in `done` outside the set are ignored). */
export function lapProgress(
  p: Profile,
  openingId: string,
  lapLineIds: readonly string[],
): { n: number; done: number; total: number; doneIds: Set<string> } {
  const rec = lapOf(p, openingId)
  const set = new Set(lapLineIds)
  const doneIds = new Set<string>()
  for (const id of rec.done) if (set.has(id)) doneIds.add(id)
  return { n: rec.n, done: doneIds.size, total: set.size, doneIds }
}

// ---------------------------------------------------------------------------
// Main-line round bonus (§4.4)
// ---------------------------------------------------------------------------

export const ROUND_BONUS_PER_LINE = 2
export const ROUND_CLEAN_BONUS = 10
export const ROUND_BONUSES_PER_DAY = 3

/** Round bonuses still to be paid today (all openings). */
export function roundBonusesLeft(p: Profile, now: number): number {
  const d = effectiveDaily(p, now) as DailyStateX
  return Math.max(0, ROUND_BONUSES_PER_DAY - nonNegInt(d.roundsRewarded))
}
