// Time spent on the app per player (pure; runs under plain node).
//
// The amounts come from the activity clock (activityClock.ts): it only counts
// time between taps/moves, each gap capped, so an app left open on the table
// doesn't keep adding minutes. This module just stores and summarises them.

import type { AppData, Profile, TimeSpent } from '../types.ts'
import { addDaysToKey, isDateKey, localDateKey } from './defaults.ts'
import { getProfile, withProfile, type OpResult } from './profileOps.ts'

/** How many local days of per-day history to keep. */
export const TIME_BY_DAY_KEEP = 120
/** One credit can never add more than this (a sanity cap on bad input). */
export const MAX_TIME_CREDIT_MS = 10 * 60_000
const DAY_MS = 86_400_000
/** Upper bound for a stored total when validating saved data / backups. */
const MAX_TOTAL_MS = 100 * 365 * DAY_MS

export interface TimeSummary {
  totalMs: number
  todayMs: number
  /** Today plus the 6 days before it. */
  weekMs: number
  /** Last 7 local days, oldest first (for a little bar chart). */
  days: { date: string; ms: number }[]
}

/** Add `ms` of active time to a player, booked on the local day of `now`. */
export function addActiveTime(data: AppData, profileId: string, ms: number, now: number): OpResult {
  const p = getProfile(data, profileId)
  if (!p) return { data, ok: false, error: 'no-profile' }
  if (!Number.isFinite(ms) || ms < 1 || !Number.isFinite(now)) return { data, ok: true }
  const add = Math.min(Math.round(ms), MAX_TIME_CREDIT_MS)
  const day = localDateKey(now)
  const prev: TimeSpent = p.timeSpent ?? { totalMs: 0, byDay: {} }
  const byDay: Record<string, number> = { ...prev.byDay, [day]: (prev.byDay[day] ?? 0) + add }
  const keys = Object.keys(byDay).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - TIME_BY_DAY_KEEP))) delete byDay[k]
  return { data: withProfile(data, { ...p, timeSpent: { totalMs: prev.totalMs + add, byDay } }), ok: true }
}

export function timeSummary(profile: Profile, now: number): TimeSummary {
  const t = profile.timeSpent
  const today = localDateKey(now)
  const days: { date: string; ms: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const date = addDaysToKey(today, -i)
    days.push({ date, ms: t?.byDay[date] ?? 0 })
  }
  return {
    totalMs: t?.totalMs ?? 0,
    todayMs: t?.byDay[today] ?? 0,
    weekMs: days.reduce((s, d) => s + d.ms, 0),
    days,
  }
}

/** "0 min", "<1 min", "12 min", "1 h 5 min", "23 h". Rounds down to whole minutes. */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0)
  const mins = Math.floor(safe / 60_000)
  if (mins === 0 && safe >= 1000) return '<1 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Compact form for small stat tiles: "0m", "<1m", "45m", "1h 45m", "12h 35m", and "123h" from 100 h. */
export function formatDurationShort(ms: number): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0)
  const mins = Math.floor(safe / 60_000)
  if (mins === 0) return safe >= 1000 ? '<1m' : '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h >= 100 || m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Validate a stored TimeSpent (storage / backup import). Unknown or broken -> undefined. */
export function normTimeSpent(x: unknown): TimeSpent | undefined {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return undefined
  const o = x as Record<string, unknown>
  const total =
    typeof o.totalMs === 'number' && Number.isFinite(o.totalMs) && o.totalMs > 0 ? Math.min(Math.floor(o.totalMs), MAX_TOTAL_MS) : 0
  const byDay: Record<string, number> = {}
  if (typeof o.byDay === 'object' && o.byDay !== null && !Array.isArray(o.byDay)) {
    for (const [k, v] of Object.entries(o.byDay as Record<string, unknown>)) {
      // Real calendar dates only ("2026-02-31" or "9999-99-99" would never be pruned).
      if (k === '__proto__' || !isDateKey(k) || addDaysToKey(k, 0) !== k) continue
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) byDay[k] = Math.min(Math.floor(v), DAY_MS)
    }
  }
  const keys = Object.keys(byDay).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - TIME_BY_DAY_KEEP))) delete byDay[k]
  if (total === 0 && keys.length === 0) return undefined
  // The total can't be less than what the kept days add up to.
  const sum = Object.values(byDay).reduce((s, v) => s + v, 0)
  return { totalMs: Math.min(Math.max(total, sum), MAX_TOTAL_MS), byDay }
}
