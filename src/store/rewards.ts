// Coin rewards for completed lines (DESIGN.md §3). Pure; runs under plain node.
//
// Line stats use the spaced-repetition rule from src/chess/scheduler.ts
// (DESIGN.md §1) — imported, not copied, so there is one source of truth.

import type { LineResultInput, LineStats, Profile, RewardLine } from '../types.ts'
import { BOX_INTERVAL_DAYS, DAY_MS, isDueToday, isMastered, updateLineStats } from '../chess/scheduler.ts'
import { addDaysToKey, emptyDaily, isDateKey, localDateKey, previousDateKey } from './defaults.ts'
import type { DailyStateX } from './defaults.ts'

export { BOX_INTERVAL_DAYS, DAY_MS }

// ---------------------------------------------------------------------------
// Spaced repetition (delegates to src/chess/scheduler.ts)
// ---------------------------------------------------------------------------

export function isLineMastered(s?: LineStats): boolean {
  return isMastered(s)
}

export interface LineOutcome {
  mistakes: number
  hintsUsed: number
  usedArrowHint: boolean
  learnMode: boolean
}

function boxOf(s: LineStats): number {
  const b = s.box
  return typeof b === 'number' && Number.isFinite(b) ? Math.max(0, Math.min(5, Math.floor(b))) : 0
}

/**
 * True when a completion may move the line UP a Leitner box: the line is new,
 * in box 0 (learning step), or due today (local date, so practising a bit
 * earlier in the day than last time still counts as the review).
 */
export function canPromote(prev: LineStats | undefined, now: number): boolean {
  if (!prev || boxOf(prev) === 0) return true
  const due = typeof prev.dueAt === 'number' && Number.isFinite(prev.dueAt) ? prev.dueAt : 0
  return due <= now || isDueToday({ ...prev, dueAt: due }, now)
}

/**
 * scheduler.updateLineStats with the trainer's numbers sanitised first (no NaN /
 * negatives), plus one guard: replaying a line that is NOT due yet can never
 * raise its box or push its review later (so quick "Try again" replays can't
 * master a line in minutes). Mistakes on such a replay still lower the box.
 * `maxIntervalDays` (the line tier's review cap, scheduler.maxIntervalDaysFor)
 * is passed through; absent = the scheduler's default (no extra cap).
 */
export function nextLineStats(prev: LineStats | undefined, r: LineOutcome, now: number, maxIntervalDays?: number): LineStats {
  const next = updateLineStats(
    prev,
    { mistakes: nonNegInt(r.mistakes), hintsUsed: nonNegInt(r.hintsUsed), usedArrowHint: !!r.usedArrowHint, learnMode: !!r.learnMode },
    now,
    maxIntervalDays,
  )
  if (!prev || r.learnMode || canPromote(prev, now)) return next
  const prevBox = boxOf(prev)
  const prevDue = Number.isFinite(prev.dueAt) ? prev.dueAt : next.dueAt
  return { ...next, box: Math.min(next.box, prevBox), dueAt: Math.min(next.dueAt, prevDue) }
}

export function nonNegInt(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export const BASE_COINS = 5
export const MAX_MOVE_COINS = 15
export const PERFECT_BONUS = 10
export const NEW_LINE_BONUS = 10
export const REMEMBERED_BONUS = 5
export const COMBO_BONUS = 5 // combo >= 3
export const BIG_COMBO_BONUS = 10 // combo >= 6
export const BLUNDER_BONUS = 5
export const DAILY_GOAL_BONUS = 30
export const STREAK_BONUS_PER_DAY = 5
export const STREAK_BONUS_MAX_DAYS = 7
export const FARM_WINDOW_MS = 60 * 60 * 1000
export const FARM_COINS = 2
/** Base pay of a branch-start run (lap mode, shared start auto-played): 2 + min(kid moves played, 15). */
export const BRANCH_BASE_COINS = 2
/**
 * Clock-skew tolerance. Dates/timestamps up to this far AHEAD of the device
 * clock are kept (so winding the clock back a little can't unlock a second
 * daily goal); anything further ahead is treated as a wrong clock and pulled
 * back to today, so one bad clock jump can't freeze rewards for months.
 */
export const CLOCK_SKEW_DAYS = 1
export const CLOCK_SKEW_MS = CLOCK_SKEW_DAYS * DAY_MS

export function clampDailyGoal(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 5
  return Math.min(50, Math.max(1, v))
}

/** profile.lastGoalDate as of `now` ('' if never); a date too far ahead (wrong clock) becomes today. */
export function saneLastGoalDate(profile: Profile, now: number): string {
  const last = profile.lastGoalDate
  if (!isDateKey(last)) return ''
  const today = localDateKey(now)
  return last > addDaysToKey(today, CLOCK_SKEW_DAYS) ? today : last
}

/**
 * Daily rollover (pure). On a new LOCAL date `daily` is reset and the streak
 * survives only if the goal was met yesterday (or today). Daily state dated up
 * to CLOCK_SKEW_DAYS ahead is kept; further ahead is a clock error and is reset
 * (a goal claimed on such a "future" day counts as today's goal). Returns the
 * SAME object when nothing changes.
 */
export function rolloverDaily(profile: Profile, now: number): Profile {
  const today = localDateKey(now)
  const maxAhead = addDaysToKey(today, CLOCK_SKEW_DAYS)
  const goalDate = saneLastGoalDate(profile, now)
  const d = profile.daily as DailyStateX | undefined
  const keep = !!d && isDateKey(d.date) && d.date >= today && d.date <= maxAhead
  if (keep && goalDate === profile.lastGoalDate) return profile
  const alive = goalDate !== '' && goalDate >= previousDateKey(today)
  const daily: DailyStateX =
    keep && d ? { ...d, goalClaimed: d.goalClaimed || goalDate === d.date } : { ...emptyDaily(today), goalClaimed: goalDate === today }
  return { ...profile, daily, lastGoalDate: goalDate, streakDays: alive ? nonNegInt(profile.streakDays) : 0 }
}

/** The profile's daily state as of `now` (= rolloverDaily(profile, now).daily; never mutates). */
export function effectiveDaily(profile: Profile, now: number): DailyStateX {
  return rolloverDaily(profile, now).daily as DailyStateX
}

export function distinctLineIdsOf(d: DailyStateX): string[] {
  return Array.isArray(d.distinctLineIds) ? d.distinctLineIds : []
}

/** Streak length as of `now`: alive if the goal was met today or yesterday, else 0. */
export function currentStreak(profile: Profile, now: number): number {
  const today = localDateKey(now)
  const last = saneLastGoalDate(profile, now)
  if (last && (last >= today || last === previousDateKey(today))) return nonNegInt(profile.streakDays)
  return 0
}

/** Streak after meeting the goal today: continue if met yesterday, else start at 1. */
export function streakAfterGoal(profile: Profile, now: number): number {
  const today = localDateKey(now)
  const last = saneLastGoalDate(profile, now)
  const streak = nonNegInt(profile.streakDays)
  if (last && last >= today) return Math.max(1, streak) // already met today (or clock moved back)
  if (last && last === previousDateKey(today)) return streak + 1
  return 1
}

export function starsFor(mistakes: number, hintsUsed: number, usedArrowHint: boolean): 1 | 2 | 3 {
  const m = nonNegInt(mistakes)
  if (m === 0 && nonNegInt(hintsUsed) === 0 && !usedArrowHint) return 3
  if (m <= 1 && !usedArrowHint) return 2
  return 1
}

export interface LineRewardResult {
  coins: number
  breakdown: RewardLine[]
  stars: 1 | 2 | 3
  /** 0 mistakes, 0 hints, not learn mode. */
  perfect: boolean
  /**
   * A learn-mode run: "Show me the moves" was on, or the arrow hint was used on
   * about half the moves or more (each arrow costs 2 hints). Pays "Learned a
   * line" (half the base) and never the "New line" bonus.
   */
  learnLike: boolean
  /**
   * Same line completed < 60 min ago and not due → flat 2 coins, no bonuses.
   * Exception: the first normal run right after a paid learn-mode run.
   */
  farmed: boolean
  /** The free pass after a learn-mode run was used (see LineStats.learnPending). */
  afterLearn: boolean
  /** A quick retry of a line that is due only because the last run failed. */
  retryOfFail: boolean
  isNewLine: boolean
  wasDue: boolean
  /** This completion adds a new distinct line to today's goal count. */
  countsTowardGoal: boolean
  /** Distinct lines today after this completion. */
  distinctLinesToday: number
  dailyGoalJustMet: boolean
  /** Streak after this completion (only changes when the goal was just met). */
  streakDays: number
  /** Opponent blunder punished on a perfect, non-learn run. */
  punishedBlunder: boolean
  /**
   * A branch-start run (input.userMovesPlayed below the line's kid moves): pay
   * follows the kid moves actually played (docs/practice-structure.md §4.2).
   */
  branchStart: boolean
  /** Kid moves the pay is based on: max(1, userMovesPlayed) on a branch start, else line.userMoveCount. */
  movesPaid: number
}

/**
 * Kid moves a run is paid for. A number below the line's kid moves means a
 * branch-start run (max(1, played)); absent, invalid or >= the line's count =
 * the whole line (null).
 */
export function branchMovesPlayed(input: Pick<LineResultInput, 'line' | 'userMovesPlayed'>): number | null {
  const played = input.userMovesPlayed
  if (typeof played !== 'number' || !Number.isFinite(played)) return null
  if (played >= nonNegInt(input.line.userMoveCount)) return null
  return Math.max(1, nonNegInt(played))
}

/**
 * Coins for one completed line. `profile` is the profile BEFORE this result is
 * applied (its lineStats entry for the line is the previous one).
 */
export function computeLineReward(input: LineResultInput, profile: Profile, dailyGoalLines: number): LineRewardResult {
  const now = input.now
  const line = input.line
  const prev: LineStats | undefined = profile.lineStats[line.id]
  const mistakes = nonNegInt(input.mistakes)
  const hints = nonNegInt(input.hintsUsed)
  const arrow = !!input.usedArrowHint
  const learn = !!input.learnMode
  const stars = starsFor(mistakes, hints, arrow)
  const clean = mistakes === 0 && hints === 0 && !arrow
  const perfect = clean && !learn
  // Branch-start run (§4.2): every amount follows the kid moves actually played.
  const branch = branchMovesPlayed(input)
  const branchStart = branch !== null
  const moves = branch ?? nonNegInt(line.userMoveCount)
  /** A bonus chip, capped at the moves played on a branch start. */
  const capped = (coins: number, cap: number): number => (branchStart ? Math.min(coins, cap) : coins)
  const learnLike = learn || (arrow && hints >= Math.max(1, moves))

  const seenBefore = !!prev && prev.lastPracticed > 0
  // Exact timestamp on purpose (anti-farming): "due later today" is not due here.
  const wasDue = seenBefore && prev.dueAt <= now
  // Learn-mode completions don't use up the "New line" bonus.
  const isNewLine = !prev || nonNegInt(prev.completions) - nonNegInt(prev.learnCompletions) <= 0
  // A slightly negative elapsed time (clock moved back) also counts as "just
  // now"; a lastPracticed more than a day ahead is a wrong clock, not "recent".
  const elapsed = seenBefore ? now - prev.lastPracticed : Infinity
  const recentlyPracticed = seenBefore && elapsed < FARM_WINDOW_MS && elapsed > -CLOCK_SKEW_MS
  // "Try it without the arrows" right after learning a line pays in full once.
  const afterLearn = !!prev && prev.learnPending === true && !learnLike
  // Due only because the last run failed (a failure sets the review to "now").
  // Fixing it right away pays in full ONCE; failing again and again doesn't
  // keep paying (else "make 2 mistakes every time" would beat playing well).
  const justFailed = seenBefore && prev.dueAt <= prev.lastPracticed
  const retryOfFail = recentlyPracticed && wasDue && justFailed
  const farmed = recentlyPracticed && (!wasDue || (retryOfFail && prev.quickRetryUsed === true)) && !afterLearn

  const daily = effectiveDaily(profile, now)
  const ids = distinctLineIdsOf(daily)
  const countsTowardGoal = !farmed && !ids.includes(line.id)
  const distinctLinesToday = ids.length + (countsTowardGoal ? 1 : 0)
  const goal = clampDailyGoal(dailyGoalLines)
  const dailyGoalJustMet = countsTowardGoal && !daily.goalClaimed && distinctLinesToday >= goal
  const streakDays = dailyGoalJustMet ? streakAfterGoal(profile, now) : nonNegInt(profile.streakDays)

  const breakdown: RewardLine[] = []
  let punishedBlunder = false

  if (farmed) {
    breakdown.push({ label: 'Practice makes perfect', coins: FARM_COINS, emoji: '🪙' })
  } else {
    const base = (branchStart ? BRANCH_BASE_COINS : BASE_COINS) + Math.min(moves, MAX_MOVE_COINS)
    if (learnLike) {
      breakdown.push({ label: 'Learned a line', coins: Math.ceil(base / 2), emoji: '📖' })
    } else {
      breakdown.push({ label: 'Line complete', coins: base, emoji: '🪙' })
      if (perfect) breakdown.push({ label: 'Perfect!', coins: capped(PERFECT_BONUS, moves), emoji: '⭐' })
      if (isNewLine) breakdown.push({ label: 'New line', coins: capped(NEW_LINE_BONUS, moves), emoji: '✨' })
      // "Remembered" means recalled after a gap: a line re-done right after
      // failing it is due again immediately, but that is not remembering. Due
      // later today counts (the review is today's).
      if (seenBefore && isDueToday(prev, now) && perfect && !recentlyPracticed) {
        breakdown.push({ label: 'Remembered it!', coins: capped(REMEMBERED_BONUS, moves), emoji: '🧠' })
      }
      const combo = nonNegInt(input.combo)
      if (perfect && combo >= 3) {
        breakdown.push({ label: `Combo x${combo}`, coins: capped(combo >= 6 ? BIG_COMBO_BONUS : COMBO_BONUS, moves), emoji: '⚡' })
      }
      if (perfect && input.opponentBlunderPunished) {
        punishedBlunder = true
        breakdown.push({ label: 'Punished a blunder', coins: capped(BLUNDER_BONUS, moves), emoji: '⚔️' })
      }
    }
    if (dailyGoalJustMet) {
      breakdown.push({ label: 'Daily goal!', coins: DAILY_GOAL_BONUS, emoji: '🎯' })
      breakdown.push({
        label: streakDays > 1 ? `${streakDays}-day streak` : 'Streak started',
        coins: STREAK_BONUS_PER_DAY * Math.min(streakDays, STREAK_BONUS_MAX_DAYS),
        emoji: '📅',
      })
    }
  }

  const coins = breakdown.reduce((s, b) => s + b.coins, 0)
  return {
    coins,
    breakdown,
    stars,
    perfect,
    learnLike,
    farmed,
    afterLearn,
    retryOfFail,
    isNewLine,
    wasDue,
    countsTowardGoal,
    distinctLinesToday,
    dailyGoalJustMet,
    streakDays,
    punishedBlunder,
    branchStart,
    movesPaid: moves,
  }
}

// ---------------------------------------------------------------------------
// Engine games
// ---------------------------------------------------------------------------

export type EngineResult = 'win' | 'draw' | 'loss'
export const ENGINE_DAILY_CAP = 3

/** win 10 (+10 if rating ≥ 1200, +10 more if ≥ 1600), draw 5, loss 0. */
export function engineGameCoins(result: EngineResult, rating: number): number {
  const r = Number.isFinite(rating) ? rating : 0
  if (result === 'win') return 10 + (r >= 1200 ? 10 : 0) + (r >= 1600 ? 10 : 0)
  if (result === 'draw') return 5
  return 0
}
