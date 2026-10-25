// Pure, immutable operations on AppData (DESIGN.md §3). Runs under plain node.
//
// Every op returns a NEW AppData (or the same object when nothing changed) and
// never mutates its input. Economy rules: coins never go negative; buying
// needs enough coins + the item's minLevel and can't buy twice; redemptions
// deduct immediately and refund on decline; weekly cap per reward per profile
// (rolling 7 days); engine games capped per day; daily rollover by LOCAL date.

import type {
  AchievementDef,
  AppData,
  CoinEvent,
  LapRecord,
  LapResult,
  LevelInfo,
  Line,
  LineStats,
  ParentSettings,
  Profile,
  ProfileSettings,
  Redemption,
  Repertoire,
  Reward,
  RewardDef,
  RewardLine,
} from '../types.ts'
import { maxIntervalDaysFor } from '../chess/scheduler.ts'
import { checkAchievements } from './achievements.ts'
import type { AchievementContext, LineResultInputX } from './achievements.ts'
import { findItem, itemById } from './catalog.ts'
import { addDaysToKey, createProfile, defaultSeedFor, HISTORY_CAP, isDateKey, localDateKey } from './defaults.ts'
import type { DailyStateX } from './defaults.ts'
import { levelForXp, levelUpBetween } from './levels.ts'
import { OPENINGS } from '../data/openings.ts'
import {
  clampDailyGoal,
  CLOCK_SKEW_DAYS,
  computeLineReward,
  DAY_MS,
  distinctLineIdsOf,
  effectiveDaily,
  ENGINE_DAILY_CAP,
  engineGameCoins,
  isLineMastered,
  nextLineStats,
  nonNegInt,
  rolloverDaily,
} from './rewards.ts'
import type { EngineResult } from './rewards.ts'
import {
  inLap,
  LAP_COINS_PER_LINE,
  lapOf,
  lapProgress,
  medalOf,
  MEDALS,
  perfectDaysOf,
  qualifiedMedal,
  ROUND_BONUS_PER_LINE,
  ROUND_BONUSES_PER_DAY,
  ROUND_CLEAN_BONUS,
  roundBonusesLeft,
} from './mastery.ts'

export const WEEK_MS = 7 * DAY_MS
export const MAX_COIN_ADJUST = 100000
export const RESOLVED_REDEMPTIONS_KEPT = 100
/** A second request for the same reward within this window is a double tap: ignored. */
export const REDEMPTION_DOUBLE_TAP_MS = 10_000

// ---------------------------------------------------------------------------
// Results & errors
// ---------------------------------------------------------------------------

export type OpError =
  | 'no-profile'
  | 'unknown-item'
  | 'already-owned'
  | 'not-owned'
  | 'not-equippable'
  | 'not-enough-coins'
  | 'level-too-low'
  | 'unknown-reward'
  | 'reward-disabled'
  | 'weekly-limit'
  | 'not-pending'
  | 'invalid'
  | 'name-taken'
  | 'reset-cooldown'
  | 'no-chapters'
  | 'too-late'

/** Kid-friendly messages for each error code. */
export const OP_ERROR_MESSAGES: Record<OpError, string> = {
  'no-profile': 'Pick a player first!',
  'unknown-item': "Hmm, we couldn't find that item.",
  'already-owned': 'You already have this one! 🎉',
  'not-owned': "You don't have that one yet.",
  'not-equippable': 'Trophies live on your shelf — they are always on show!',
  'not-enough-coins': 'Not enough coins yet — keep practising! 💪',
  'level-too-low': 'Level up a bit more to unlock this! ⭐',
  'unknown-reward': "Hmm, we couldn't find that reward.",
  'reward-disabled': 'This reward is switched off right now.',
  'weekly-limit': "You've asked for this one enough this week. Try again in a few days! 📅",
  'not-pending': 'That request was already answered.',
  'invalid': "That didn't look right — please try again.",
  'name-taken': 'Another player already has that name.',
  'reset-cooldown':
    'For safety, approving rewards and gifting coins pause for 24 hours after the PIN was reset without the recovery code.',
  'no-chapters': "This file has none of the coach's chapters — download the whole study (all chapters) and try again.",
  'too-late': 'Too late to undo that one.',
}

export interface OpResult {
  data: AppData
  ok: boolean
  error?: OpError
  message?: string
}

export interface ShopResult extends OpResult {
  newAchievements: AchievementDef[]
  levelUp: { from: LevelInfo; to: LevelInfo } | null
}

export interface LineResultOutcome {
  data: AppData
  reward: Reward
  ok: boolean
  /** Identical result (same line + same `now`) was already applied: ignored. */
  duplicate: boolean
  /** True when the anti-farming rule applied (flat 2 coins). */
  farmed: boolean
}

export interface EngineGameOutcome extends OpResult {
  coins: number
  /** Daily cap reached: the game counted for stats but earned no coins. */
  capped: boolean
  newAchievements: AchievementDef[]
  levelUp: { from: LevelInfo; to: LevelInfo } | null
}

function fail(data: AppData, error: OpError): OpResult {
  return { data, ok: false, error, message: OP_ERROR_MESSAGES[error] }
}

function failShop(data: AppData, error: OpError): ShopResult {
  return { ...fail(data, error), newAchievements: [], levelUp: null }
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

export function getProfile(data: AppData, profileId: string | null | undefined): Profile | undefined {
  if (!profileId) return undefined
  return data.profiles.find((p) => p.id === profileId)
}

export function getActiveProfile(data: AppData): Profile | null {
  return getProfile(data, data.activeProfileId) ?? null
}

/** Replace one profile (identity-preserving when unchanged). */
export function withProfile(data: AppData, profile: Profile): AppData {
  const i = data.profiles.findIndex((p) => p.id === profile.id)
  if (i < 0 || data.profiles[i] === profile) return data
  const profiles = data.profiles.slice()
  profiles[i] = profile
  return { ...data, profiles }
}

function withParent(data: AppData, patch: Partial<ParentSettings>): AppData {
  return { ...data, parent: { ...data.parent, ...patch } }
}

export function levelOf(profile: Profile): LevelInfo {
  return levelForXp(profile.xp)
}

/** Prepend a coin event, newest first, capped at HISTORY_CAP. */
export function pushHistory(history: CoinEvent[], ev: CoinEvent): CoinEvent[] {
  const next = [ev, ...history]
  return next.length > HISTORY_CAP ? next.slice(0, HISTORY_CAP) : next
}

/**
 * Add (or remove) coins. Positive deltas from earning also add XP when
 * `earned` is true; negative deltas never take coins below 0. Records history.
 */
export function addCoins(profile: Profile, delta: number, reason: string, now: number, earned: boolean): Profile {
  const d = Number.isFinite(delta) ? Math.trunc(delta) : 0
  if (d === 0) return profile
  const coins = Math.max(0, nonNegInt(profile.coins) + d)
  const actual = coins - nonNegInt(profile.coins)
  if (actual === 0) return profile
  const xp = nonNegInt(profile.xp) + (earned && actual > 0 ? actual : 0)
  return { ...profile, coins, xp, history: pushHistory(profile.history, { at: now, delta: actual, reason }) }
}

/** Grant newly unlocked achievements (coins + xp + timestamp). Each id at most once. */
function grantAchievements(profile: Profile, defs: AchievementDef[], now: number): Profile {
  let p = profile
  for (const a of defs) {
    if (p.achievements[a.id] !== undefined) continue
    p = { ...p, achievements: { ...p.achievements, [a.id]: now } }
    p = addCoins(p, a.coins, `🏅 ${a.name}`, now, true)
  }
  return p
}

function unlockAndGrant(profile: Profile, ctx: AchievementContext): { profile: Profile; unlocked: AchievementDef[] } {
  const unlocked = checkAchievements(profile, ctx)
  return { profile: grantAchievements(profile, unlocked, ctx.now), unlocked }
}

// ---------------------------------------------------------------------------
// Daily rollover & streaks
// ---------------------------------------------------------------------------

/**
 * Reset `daily` on a new LOCAL date. The streak survives the rollover only if
 * the goal was met yesterday (or today); otherwise it shows 0 and restarts at 1
 * with the next goal. Daily state dated more than a day ahead (wrong clock) is
 * reset too. Returns the same object when nothing changes. (= rewards.rolloverDaily)
 */
export function ensureDaily(profile: Profile, now: number): Profile {
  return rolloverDaily(profile, now)
}

/** ensureDaily on EVERY profile (call on app start, after imports, on focus, every minute). Identity-preserving. */
export function rolloverAll(data: AppData, now: number): AppData {
  let out = data
  for (const p of data.profiles) out = withProfile(out, ensureDaily(p, now))
  return out
}

/** Daily view for display without committing (e.g. the Home goal ring). */
export function currentDaily(profile: Profile, now: number): DailyStateX {
  return effectiveDaily(profile, now)
}

/**
 * Today's goal for display. `met` = the goal was really claimed (bonus paid,
 * streak counted). After a parent LOWERS the goal, `done >= goal` can be true
 * while `met` is still false: the next new line claims it (show that, not "Done!").
 */
export function dailyGoalProgress(profile: Profile, now: number, goalLines: number): { done: number; goal: number; met: boolean } {
  const d = effectiveDaily(profile, now)
  const goal = clampDailyGoal(goalLines)
  const done = distinctLineIdsOf(d).length
  return { done, goal, met: d.goalClaimed }
}

export { currentStreak } from './rewards.ts'

// ---------------------------------------------------------------------------
// Line results
// ---------------------------------------------------------------------------

function emptyReward(): Reward {
  return { coins: 0, breakdown: [], stars: 1, newAchievements: [], levelUp: null, dailyGoalJustMet: false, lineMastered: false }
}

/** Display name of an opening (for coin history rows). */
function openingName(openingId: string, rep?: Repertoire | null): string {
  if (rep && rep.opening && rep.opening.id === openingId) return rep.opening.name
  return OPENINGS.find((o) => o.id === openingId)?.name ?? openingId
}

/**
 * Lap bookkeeping for one completion (docs/practice-structure.md §2.3). A
 * completion counts when `counts` (2+ stars, not learn-like; any mode, quick
 * repeats included) and the line is in the opening's lap set. With the opening's
 * repertoire the lap rolls over once every lap-set id is done; without it the
 * line is only recorded (the set is unknown: `total` 0, never a rollover).
 * Null when the completion doesn't count.
 */
function lapAfterCompletion(
  p: Profile,
  includePlanB: boolean,
  line: Line,
  openingId: string,
  counts: boolean,
  rep: Repertoire | null | undefined,
): { record: LapRecord; result: LapResult } | null {
  if (!counts || !openingId) return null
  const repHere = rep && rep.opening && rep.opening.id === openingId && Array.isArray(rep.lines) ? rep : null
  let lapIds: string[] | null = null
  if (repHere) {
    lapIds = repHere.lines.filter((l) => inLap(l, includePlanB)).map((l) => l.id)
    if (!lapIds.includes(line.id)) return null
  } else if (!inLap(line, includePlanB)) {
    return null
  }
  const rec = lapOf(p, openingId)
  const done = rec.done.includes(line.id) ? rec.done : [...rec.done, line.id]
  if (!lapIds) {
    return { record: { n: rec.n, done }, result: { openingId, n: rec.n, done: done.length, total: 0, completed: false, coins: 0 } }
  }
  const prog = lapProgress({ ...p, laps: { ...p.laps, [openingId]: { n: rec.n, done } } }, openingId, lapIds)
  const completed = prog.total > 0 && prog.done === prog.total
  const coins = completed ? LAP_COINS_PER_LINE * prog.total : 0
  return {
    record: completed ? { n: rec.n + 1, done: [] } : { n: rec.n, done },
    result: { openingId, n: rec.n, done: prog.done, total: prog.total, completed, coins },
  }
}

/**
 * Apply a completed line: rewards, line stats (DESIGN.md §1 rule, review gap
 * capped per tier), totals, daily goal + streak, combo, main-line medal, lap,
 * achievements, level-up (docs/practice-structure.md §3–§4).
 *
 * `reward.coins` is the TOTAL coins this completion earned, including medal,
 * lap and achievement bonuses; `reward.breakdown` sums to it (achievement chips
 * are labelled "🏅 <name>").
 */
export function applyLineResult(
  data: AppData,
  profileId: string,
  input: LineResultInputX,
  rep?: Repertoire | null,
): LineResultOutcome {
  const p0 = getProfile(data, profileId)
  if (!p0 || !input || !input.line || typeof input.line.id !== 'string' || !Number.isFinite(input.now)) {
    return { data, reward: emptyReward(), ok: false, duplicate: false, farmed: false }
  }
  const now = input.now
  const line = input.line
  const prevStats: LineStats | undefined = p0.lineStats[line.id]
  if (prevStats && prevStats.lastPracticed === now) {
    // Same completion submitted twice (e.g. a double-fired effect): ignore.
    return { data, reward: emptyReward(), ok: true, duplicate: true, farmed: false }
  }

  let p = ensureDaily(p0, now)
  const xpBefore = p.xp
  const r = computeLineReward(input, p, data.parent.dailyGoalLines)

  // Line stats. The longest review gap depends on the tier (main 7 days, key 12, others 16).
  let newStats: LineStats = nextLineStats(
    prevStats,
    { mistakes: input.mistakes, hintsUsed: input.hintsUsed, usedArrowHint: input.usedArrowHint, learnMode: input.learnMode },
    now,
    maxIntervalDaysFor(line.tier),
  )
  // A farmed run (quick repeat of a line that isn't due) may lower the box but
  // never makes the line due sooner: otherwise "fail on purpose, then replay"
  // would turn the 2-coin repeat back into a full-pay "due" run every time.
  // The one-off full-pay run after a learn-mode run is treated the same way.
  if ((r.farmed || r.afterLearn) && prevStats && Number.isFinite(prevStats.dueAt)) {
    newStats = { ...newStats, dueAt: Math.max(newStats.dueAt, prevStats.dueAt) }
  }
  const learnCompletions = nonNegInt(prevStats?.learnCompletions) + (r.learnLike ? 1 : 0)
  if (learnCompletions > 0) newStats.learnCompletions = learnCompletions
  // After a paid learn-mode run, the next normal run is never "farmed" (the
  // completion screen promises bonus coins for trying without the arrows). A
  // farmed learn-mode repeat keeps that promise; nothing else renews it.
  if (r.learnLike && (!r.farmed || prevStats?.learnPending === true)) newStats.learnPending = true
  // The single full-pay quick retry of a just-failed line has been used.
  if (r.farmed ? prevStats?.quickRetryUsed === true : r.retryOfFail) newStats.quickRetryUsed = true
  // updateLineStats builds a fresh object: carry the perfect-day record and the medal forward.
  // An old save has no perfectDays: its estimate (min(perfects, box), from the box BEFORE this
  // run) is written now, so a failed run that drops the box can't shrink it.
  if (prevStats) {
    newStats.perfectDays = perfectDaysOf(prevStats)
    if (isDateKey(prevStats.lastPerfectDay)) newStats.lastPerfectDay = prevStats.lastPerfectDay
    const m = medalOf(prevStats)
    if (m > 0) newStats.medal = m as 1 | 2 | 3
  }
  // A perfect run (not learn mode; quick repeats included) on a new local day
  // adds a perfect day. A day already counted, or one up to CLOCK_SKEW_DAYS
  // ahead (clock moved back), doesn't count again; a date further ahead is a
  // wrong clock and gets replaced.
  if (r.perfect) {
    const today = localDateKey(now)
    const last = prevStats?.lastPerfectDay
    const alreadyCounted = isDateKey(last) && last >= today && last <= addDaysToKey(today, CLOCK_SKEW_DAYS)
    if (!alreadyCounted) {
      newStats.perfectDays = perfectDaysOf(prevStats) + 1
      newStats.lastPerfectDay = today
    }
  }
  // Main-line medal (§3.2): evaluated on every completion of a main line (quick
  // repeats included), paid once per level, never taken away.
  const medalChips: RewardLine[] = []
  const medalsPaid: Array<(typeof MEDALS)[number]> = []
  let medal: Reward['medal']
  if (line.tier === 'main') {
    const had = medalOf(newStats)
    const q = qualifiedMedal(newStats)
    if (q > had) {
      let coins = 0
      for (const m of MEDALS) {
        if (m.level <= had || m.level > q) continue
        coins += m.coins
        medalsPaid.push(m)
        medalChips.push({ label: `${m.name} medal`, coins: m.coins, emoji: m.emoji })
      }
      newStats.medal = q as 1 | 2 | 3
      medal = { level: q as 1 | 2 | 3, coins }
    }
  }
  const medalCoins = medal?.coins ?? 0
  const lineMastered = !isLineMastered(prevStats) && isLineMastered(newStats)

  // Lap (§2.3): 2+ stars, not learn-like, any mode (quick repeats count too).
  const openingId = input.openingId || line.openingId
  const lap = lapAfterCompletion(p, data.parent.includePlanB !== false, line, openingId, r.stars >= 2 && !r.learnLike, rep)
  const lapCoins = lap?.result.coins ?? 0

  // Totals. Farmed runs (quick repeats of a line just done well) pay a flat 2
  // coins and count toward nothing else: not lines/perfects (→ achievements),
  // not bestCombo, not today's perfects. (Spread first: keeps rounds / laps.)
  const counts = !r.farmed
  const perfectCounted = r.perfect && counts
  const t = p.totals
  const totals: Profile['totals'] = {
    ...t,
    lines: nonNegInt(t.lines) + (counts ? 1 : 0),
    perfects: nonNegInt(t.perfects) + (perfectCounted ? 1 : 0),
    mistakesFixed: nonNegInt(t.mistakesFixed) + nonNegInt(input.mistakes),
    engineWins: nonNegInt(t.engineWins),
    blundersPunished: nonNegInt(t.blundersPunished) + (r.punishedBlunder ? 1 : 0),
  }
  if (lap?.result.completed) totals.laps = nonNegInt(t.laps) + 1

  // Daily
  const d0 = effectiveDaily(p, now)
  const ids = distinctLineIdsOf(d0)
  const distinctLineIds = r.countsTowardGoal ? [...ids, line.id] : ids
  const daily: DailyStateX = {
    ...d0,
    lines: distinctLineIds.length,
    perfects: nonNegInt(d0.perfects) + (perfectCounted ? 1 : 0),
    coinsEarned: nonNegInt(d0.coinsEarned) + r.coins + medalCoins + lapCoins,
    goalClaimed: d0.goalClaimed || r.dailyGoalJustMet,
    openingsPracticed: openingId && !d0.openingsPracticed.includes(openingId) ? [...d0.openingsPracticed, openingId] : d0.openingsPracticed,
    distinctLineIds,
  }

  const combo = perfectCounted ? nonNegInt(input.combo) : 0
  p = {
    ...p,
    lineStats: { ...p.lineStats, [line.id]: newStats },
    totals,
    daily,
    bestCombo: Math.max(nonNegInt(p.bestCombo), combo),
    streakDays: r.dailyGoalJustMet ? r.streakDays : p.streakDays,
    lastGoalDate: r.dailyGoalJustMet ? localDateKey(now) : p.lastGoalDate,
  }
  if (lap) p = { ...p, laps: { ...p.laps, [openingId]: lap.record } }
  p = addCoins(p, r.coins, `🎓 ${line.chapterTitle || 'Line'} · ${line.name || 'line'}`, now, true)
  // One coin-history row per medal, like the chips (a jump to silver pays bronze AND silver).
  for (const m of medalsPaid) p = addCoins(p, m.coins, `${m.emoji} ${m.name} medal · ${line.chapterTitle || 'Main line'}`, now, true)
  if (lap && lapCoins > 0) p = addCoins(p, lapCoins, `🌳 Lap ${lap.result.n} complete · ${openingName(openingId, rep)}`, now, true)

  // Achievements
  const { profile: p2, unlocked } = unlockAndGrant(p, { now, line: input, rep: rep ?? null })
  p = p2
  const achCoins = unlocked.reduce((s, a) => s + a.coins, 0)
  if (achCoins > 0) {
    const dd = p.daily as DailyStateX
    p = { ...p, daily: { ...dd, coinsEarned: nonNegInt(dd.coinsEarned) + achCoins } as DailyStateX }
  }

  const breakdown: RewardLine[] = [
    ...r.breakdown,
    ...medalChips,
    ...(lap && lapCoins > 0 ? [{ label: `Lap ${lap.result.n} complete`, coins: lapCoins, emoji: '🌳' }] : []),
    ...unlocked.map((a) => ({ label: `🏅 ${a.name}`, coins: a.coins, emoji: a.emoji })),
  ]
  const reward: Reward = {
    coins: r.coins + medalCoins + lapCoins + achCoins,
    breakdown,
    stars: r.stars,
    newAchievements: unlocked,
    levelUp: levelUpBetween(xpBefore, p.xp),
    dailyGoalJustMet: r.dailyGoalJustMet,
    lineMastered,
  }
  if (medal) reward.medal = medal
  if (lap) reward.lap = lap.result
  return { data: withProfile(data, p), reward, ok: true, duplicate: false, farmed: r.farmed }
}

// ---------------------------------------------------------------------------
// Main-line rounds (docs/practice-structure.md §4.4)
// ---------------------------------------------------------------------------

export interface MainRoundInput {
  openingId: string
  /** The round's startedAt (the app store dedupes on profile|opening|roundId). */
  roundId: number
  /** Main lines played in the round (a re-queued line may appear twice; counted once). */
  lineIds: string[]
  /** Every line was perfect on its first try. */
  clean: boolean
  /** Round time in ms (personal best). */
  ms: number
  now: number
}

export interface MainRoundOutcome {
  data: AppData
  ok: boolean
  coins: number
  breakdown: RewardLine[]
  /** false once 3 round bonuses were paid today */
  bonusPaid: boolean
  roundsLeftToday: number
  newBest: boolean
  bestMs: number | null
  newAchievements: AchievementDef[]
  levelUp: { from: LevelInfo; to: LevelInfo } | null
}

/** Most distinct lines one round can be paid for (the biggest opening has 6 main lines). */
export const MAX_ROUND_LINES = 30

function bestRoundMs(p: Profile, openingId: string): number | null {
  const b = p.mainRoundBest
  const v = b && Object.prototype.hasOwnProperty.call(b, openingId) ? b[openingId] : undefined
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * A finished main-line round: totals.rounds (+ cleanRounds), the personal best
 * (clean and faster rounds only, no coins), and the round bonus (2 coins per
 * distinct main line, +10 when clean) for the first ROUND_BONUSES_PER_DAY rounds
 * a day, all openings together. The lines themselves were already paid by
 * applyLineResult. With the opening's repertoire only its main lines count.
 * Runs the achievement check (with the repertoire). `coins` includes
 * achievement bonuses; `breakdown` sums to it. No dedupe here: the app store
 * dedupes on profile|opening|roundId.
 */
export function applyMainRound(data: AppData, profileId: string, input: MainRoundInput, rep?: Repertoire | null): MainRoundOutcome {
  const p0 = getProfile(data, profileId)
  const now = input && typeof input.now === 'number' ? input.now : NaN
  const failed = (): MainRoundOutcome => ({
    data,
    ok: false,
    coins: 0,
    breakdown: [],
    bonusPaid: false,
    roundsLeftToday: p0 && Number.isFinite(now) ? roundBonusesLeft(p0, now) : 0,
    newBest: false,
    bestMs: p0 && input && typeof input.openingId === 'string' ? bestRoundMs(p0, input.openingId) : null,
    newAchievements: [],
    levelUp: null,
  })
  if (!p0 || !input || typeof input.openingId !== 'string' || !input.openingId || !Number.isFinite(now)) return failed()
  if (typeof input.roundId !== 'number' || !Number.isFinite(input.roundId) || !Array.isArray(input.lineIds)) return failed()
  const openingId = input.openingId
  let ids = Array.from(new Set(input.lineIds.filter((x): x is string => typeof x === 'string' && x !== '')))
  if (rep && rep.opening && rep.opening.id === openingId && Array.isArray(rep.lines)) {
    const mains = new Set(rep.lines.filter((l) => l.tier === 'main').map((l) => l.id))
    ids = ids.filter((id) => mains.has(id))
  }
  const n = Math.min(ids.length, MAX_ROUND_LINES)
  if (n === 0) return failed()
  const clean = input.clean === true
  const ms = typeof input.ms === 'number' && Number.isFinite(input.ms) && input.ms > 0 ? Math.round(input.ms) : 0

  let p = ensureDaily(p0, now)
  const xpBefore = p.xp
  const daily = p.daily as DailyStateX
  const paidToday = nonNegInt(daily.roundsRewarded)
  const bonusPaid = paidToday < ROUND_BONUSES_PER_DAY
  const breakdown: RewardLine[] = []
  if (bonusPaid) {
    breakdown.push({ label: `Round bonus · ${n} ${n === 1 ? 'line' : 'lines'}`, coins: ROUND_BONUS_PER_LINE * n, emoji: '⭐' })
    if (clean) breakdown.push({ label: 'Clean sweep', coins: ROUND_CLEAN_BONUS, emoji: '🧹' })
  }
  const bonus = breakdown.reduce((s, b) => s + b.coins, 0)

  const t = p.totals
  p = { ...p, totals: { ...t, rounds: nonNegInt(t.rounds) + 1, cleanRounds: nonNegInt(t.cleanRounds) + (clean ? 1 : 0) } }
  const prevBest = bestRoundMs(p, openingId)
  const newBest = clean && ms > 0 && (prevBest === null || ms < prevBest)
  if (newBest) p = { ...p, mainRoundBest: { ...p.mainRoundBest, [openingId]: ms } }
  if (bonusPaid) {
    p = { ...p, daily: { ...daily, roundsRewarded: paidToday + 1, coinsEarned: nonNegInt(daily.coinsEarned) + bonus } as DailyStateX }
    p = addCoins(p, bonus, `⭐ Main-line round · ${openingName(openingId, rep)}`, now, true)
  }

  const { profile: p2, unlocked } = unlockAndGrant(p, { now, rep: rep ?? null })
  p = p2
  const achCoins = unlocked.reduce((s, a) => s + a.coins, 0)
  if (achCoins > 0) {
    const dd = p.daily as DailyStateX
    p = { ...p, daily: { ...dd, coinsEarned: nonNegInt(dd.coinsEarned) + achCoins } as DailyStateX }
  }
  return {
    data: withProfile(data, p),
    ok: true,
    coins: bonus + achCoins,
    breakdown: [...breakdown, ...unlocked.map((a) => ({ label: `🏅 ${a.name}`, coins: a.coins, emoji: a.emoji }))],
    bonusPaid,
    roundsLeftToday: roundBonusesLeft(p, now),
    newBest,
    bestMs: newBest ? ms : prevBest,
    newAchievements: unlocked,
    levelUp: levelUpBetween(xpBefore, p.xp),
  }
}

// ---------------------------------------------------------------------------
// Engine games
// ---------------------------------------------------------------------------

export function applyEngineGame(data: AppData, profileId: string, result: EngineResult, rating: number, now: number): EngineGameOutcome {
  const p0 = getProfile(data, profileId)
  if (!p0 || (result !== 'win' && result !== 'draw' && result !== 'loss')) {
    return { ...fail(data, p0 ? 'invalid' : 'no-profile'), coins: 0, capped: false, newAchievements: [], levelUp: null }
  }
  let p = ensureDaily(p0, now)
  const xpBefore = p.xp
  const base = engineGameCoins(result, rating)
  const daily = p.daily as DailyStateX
  const capped = base > 0 && nonNegInt(daily.engineGamesRewarded) >= ENGINE_DAILY_CAP
  const coins = capped ? 0 : base

  if (result === 'win') p = { ...p, totals: { ...p.totals, engineWins: nonNegInt(p.totals.engineWins) + 1 } }
  if (coins > 0) {
    p = {
      ...p,
      daily: {
        ...daily,
        engineGamesRewarded: nonNegInt(daily.engineGamesRewarded) + 1,
        coinsEarned: nonNegInt(daily.coinsEarned) + coins,
      } as DailyStateX,
    }
    p = addCoins(p, coins, result === 'win' ? '🤖 Beat the computer' : '🤖 Draw vs the computer', now, true)
  }
  const { profile: p2, unlocked } = unlockAndGrant(p, { now })
  p = p2
  return {
    data: withProfile(data, p),
    ok: true,
    coins,
    capped,
    newAchievements: unlocked,
    levelUp: levelUpBetween(xpBefore, p.xp),
  }
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

export function canBuy(profile: Profile, itemId: string): { ok: boolean; error?: OpError } {
  const item = itemById(itemId)
  if (!item) return { ok: false, error: 'unknown-item' }
  if (profile.owned.includes(item.id)) return { ok: false, error: 'already-owned' }
  if (item.minLevel !== undefined && levelOf(profile).level < item.minLevel) return { ok: false, error: 'level-too-low' }
  if (nonNegInt(profile.coins) < item.cost) return { ok: false, error: 'not-enough-coins' }
  return { ok: true }
}

export function buyItem(data: AppData, profileId: string, itemId: string, now: number): ShopResult {
  const p0 = getProfile(data, profileId)
  if (!p0) return failShop(data, 'no-profile')
  const check = canBuy(p0, itemId)
  if (!check.ok) return failShop(data, check.error!)
  const item = itemById(itemId)!
  let p: Profile = { ...p0, owned: [...p0.owned, item.id] }
  if (item.cost > 0) p = addCoins(p, -item.cost, `🛒 ${item.name}`, now, false)
  const { profile: p2, unlocked } = unlockAndGrant(p, { now })
  return { data: withProfile(data, p2), ok: true, newAchievements: unlocked, levelUp: levelUpBetween(p0.xp, p2.xp) }
}

/** Equip an owned item. Avatars set profile.avatar; trophies can't be equipped. */
export function equipItem(data: AppData, profileId: string, itemId: string): OpResult {
  const p = getProfile(data, profileId)
  if (!p) return fail(data, 'no-profile')
  const item = itemById(itemId)
  if (!item) return fail(data, 'unknown-item')
  if (!p.owned.includes(item.id)) return fail(data, 'not-owned')
  switch (item.kind) {
    case 'avatar':
      return { data: withProfile(data, { ...p, avatar: item.refId }), ok: true }
    case 'board':
    case 'pieces':
    case 'effect':
    case 'title':
      return { data: withProfile(data, { ...p, equipped: { ...p.equipped, [item.kind]: item.refId } }), ok: true }
    default:
      return fail(data, 'not-equippable')
  }
}

export function isEquipped(profile: Profile, itemId: string): boolean {
  const item = itemById(itemId)
  if (!item) return false
  if (item.kind === 'avatar') return profile.avatar === item.refId
  if (item.kind === 'trophy') return false
  return profile.equipped[item.kind] === item.refId
}

// ---------------------------------------------------------------------------
// Real-world rewards (redemptions)
// ---------------------------------------------------------------------------

/** Non-declined requests for this reward in the rolling 7 days before `now`. */
export function redemptionsThisWeek(profile: Profile, rewardId: string, now: number): number {
  return profile.redemptions.filter(
    (r) => r.rewardId === rewardId && r.status !== 'declined' && now - r.requestedAt < WEEK_MS,
  ).length
}

export function canRequestRedemption(profile: Profile, reward: RewardDef | undefined, now: number): { ok: boolean; error?: OpError } {
  if (!reward) return { ok: false, error: 'unknown-reward' }
  if (!reward.enabled) return { ok: false, error: 'reward-disabled' }
  if (reward.maxPerWeek !== undefined && redemptionsThisWeek(profile, reward.id, now) >= reward.maxPerWeek) {
    return { ok: false, error: 'weekly-limit' }
  }
  if (nonNegInt(profile.coins) < nonNegInt(reward.cost)) return { ok: false, error: 'not-enough-coins' }
  return { ok: true }
}

function trimRedemptions(list: Redemption[]): Redemption[] {
  const resolved = list.filter((r) => r.status !== 'pending')
  if (resolved.length <= RESOLVED_REDEMPTIONS_KEPT) return list
  const keep = new Set(resolved.slice(0, RESOLVED_REDEMPTIONS_KEPT))
  return list.filter((r) => r.status === 'pending' || keep.has(r))
}

export interface RedemptionResult extends OpResult {
  redemption?: Redemption
  /** A pending request for the same reward was made seconds ago (double tap): nothing changed, `redemption` is that one. */
  duplicate?: boolean
}

/**
 * Ask for a real reward: coins are deducted now (refunded if a parent declines).
 * A repeat request for the same reward within REDEMPTION_DOUBLE_TAP_MS is
 * treated as a double tap: ok, nothing charged, returns the existing request.
 */
export function requestRedemption(data: AppData, profileId: string, rewardId: string, now: number): RedemptionResult {
  const p0 = getProfile(data, profileId)
  if (!p0) return fail(data, 'no-profile')
  const recent = p0.redemptions.find(
    (r) => r.rewardId === rewardId && r.status === 'pending' && Math.abs(now - r.requestedAt) < REDEMPTION_DOUBLE_TAP_MS,
  )
  if (recent) return { data, ok: true, redemption: recent, duplicate: true }
  const reward = data.parent.rewards.find((r) => r.id === rewardId)
  const check = canRequestRedemption(p0, reward, now)
  if (!check.ok) return fail(data, check.error!)
  const rw = reward!
  const cost = nonNegInt(rw.cost)
  const redemption: Redemption = {
    // Profile id included so ids are unique across players (safe as React keys in the parent list).
    id: `${rw.id}-${p0.id}-${now.toString(36)}-${p0.redemptions.length.toString(36)}`,
    rewardId: rw.id,
    rewardName: rw.name,
    emoji: rw.emoji,
    cost,
    requestedAt: now,
    status: 'pending',
  }
  let p: Profile = { ...p0, redemptions: trimRedemptions([redemption, ...p0.redemptions]) }
  p = addCoins(p, -cost, `🎁 Asked for ${rw.name}`, now, false)
  return { data: withProfile(data, p), ok: true, redemption }
}

/**
 * Parent approves or declines a pending request. Decline refunds the coins (no XP).
 * Approving is paused for a day after a PIN reset done without the recovery code.
 */
export function resolveRedemption(data: AppData, profileId: string, redemptionId: string, approve: boolean, now: number): ShopResult {
  const p0 = getProfile(data, profileId)
  if (!p0) return failShop(data, 'no-profile')
  const red = p0.redemptions.find((r) => r.id === redemptionId)
  if (!red || red.status !== 'pending') return failShop(data, 'not-pending')
  if (approve && now < resetCooldownUntil(data.parent)) return failShop(data, 'reset-cooldown')
  const updated: Redemption = { ...red, status: approve ? 'approved' : 'declined', resolvedAt: now }
  let p: Profile = { ...p0, redemptions: p0.redemptions.map((r) => (r === red ? updated : r)) }
  if (!approve) p = addCoins(p, red.cost, `↩️ Refund: ${red.rewardName}`, now, false)
  const { profile: p2, unlocked } = unlockAndGrant(p, { now })
  return { data: withProfile(data, p2), ok: true, newAchievements: unlocked, levelUp: levelUpBetween(p0.xp, p2.xp) }
}

/** "Undo" a moment after approving: back to waiting (only within UNDO_APPROVE_MS). */
export const UNDO_APPROVE_MS = 10_000
export function unresolveRedemption(data: AppData, profileId: string, redemptionId: string, now: number): OpResult {
  const p0 = getProfile(data, profileId)
  if (!p0) return fail(data, 'no-profile')
  const red = p0.redemptions.find((r) => r.id === redemptionId)
  if (!red || red.status !== 'approved' || red.resolvedAt === undefined) return fail(data, 'not-pending')
  if (!(now - red.resolvedAt < UNDO_APPROVE_MS && now >= red.resolvedAt - 1000)) return fail(data, 'too-late')
  const back: Redemption = { ...red, status: 'pending' }
  delete back.resolvedAt
  return { data: withProfile(data, { ...p0, redemptions: p0.redemptions.map((r) => (r === red ? back : r)) }), ok: true }
}

/** All pending requests across profiles (for the Parent zone). */
export function pendingRedemptions(data: AppData): Array<{ profileId: string; profileName: string; redemption: Redemption }> {
  const out: Array<{ profileId: string; profileName: string; redemption: Redemption }> = []
  for (const p of data.profiles) {
    for (const r of p.redemptions) if (r.status === 'pending') out.push({ profileId: p.id, profileName: p.name, redemption: r })
  }
  return out.sort((a, b) => a.redemption.requestedAt - b.redemption.requestedAt)
}

// ---------------------------------------------------------------------------
// Parent: coins, profiles
// ---------------------------------------------------------------------------

/**
 * Parent gift (+) or removal (−, never below 0). A gift counts toward the level
 * (XP) unless `countsTowardLevel` is false (e.g. giving back coins removed by
 * mistake). Gifts are paused for a day after a PIN reset without the recovery code.
 */
export function adjustCoins(
  data: AppData,
  profileId: string,
  delta: number,
  note: string,
  now: number,
  countsTowardLevel: boolean = delta > 0,
): ShopResult {
  const p0 = getProfile(data, profileId)
  if (!p0) return failShop(data, 'no-profile')
  if (!Number.isFinite(delta) || Math.trunc(delta) === 0 || Math.abs(delta) > MAX_COIN_ADJUST) return failShop(data, 'invalid')
  const d = Math.trunc(delta)
  if (d > 0 && now < resetCooldownUntil(data.parent)) return failShop(data, 'reset-cooldown')
  const text = typeof note === 'string' && note.trim() ? note.trim().slice(0, 80) : d > 0 ? 'Gift from a parent' : 'Removed by a parent'
  const p = addCoins(p0, d, `${d > 0 ? '🎁' : '➖'} ${text}`, now, countsTowardLevel)
  return { data: withProfile(data, p), ok: true, newAchievements: [], levelUp: levelUpBetween(p0.xp, p.xp) }
}

/**
 * "Undo" right after a parent gift: takes the coins back AND the XP the gift
 * added (a mistaken gift shouldn't leave the kid a level higher).
 */
export function undoGift(data: AppData, profileId: string, amount: number, now: number): OpResult {
  const p0 = getProfile(data, profileId)
  if (!p0) return fail(data, 'no-profile')
  const n = nonNegInt(amount)
  if (n < 1 || n > MAX_COIN_ADJUST) return fail(data, 'invalid')
  const p1 = addCoins(p0, -n, '↩️ Gift undone', now, false)
  const taken = nonNegInt(p0.coins) - nonNegInt(p1.coins)
  const p = { ...p1, xp: Math.max(0, nonNegInt(p1.xp) - taken) }
  return { data: withProfile(data, p), ok: true }
}

export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const n = name.replace(/\s+/g, ' ').trim()
  if (n.length < 1 || n.length > 20) return null
  return n
}

export function renameProfile(data: AppData, profileId: string, name: string): OpResult {
  const p = getProfile(data, profileId)
  if (!p) return fail(data, 'no-profile')
  const n = cleanName(name)
  if (!n) return { ...fail(data, 'invalid'), message: 'Names need 1–20 letters.' }
  // Two players with the same name would be mixed up (requests list, profile picker).
  if (data.profiles.some((o) => o.id !== p.id && o.name.toLowerCase() === n.toLowerCase())) return fail(data, 'name-taken')
  return { data: withProfile(data, { ...p, name: n }), ok: true }
}

/** Set a profile's avatar. Only avatars the profile owns (no free gifts via this path). */
export function setAvatar(data: AppData, profileId: string, emoji: string): OpResult {
  const p = getProfile(data, profileId)
  if (!p) return fail(data, 'no-profile')
  const item = findItem('avatar', emoji)
  if (!item) return fail(data, 'unknown-item')
  if (!p.owned.includes(item.id)) return fail(data, 'not-owned')
  return { data: withProfile(data, { ...p, avatar: item.refId }), ok: true }
}

/** Wipe a profile's progress (keeps id, name and colour). */
export function resetProfile(data: AppData, profileId: string, now: number): OpResult {
  const p = getProfile(data, profileId)
  if (!p) return fail(data, 'no-profile')
  const seed = defaultSeedFor(p.id) ?? { id: p.id, name: p.name, avatar: '🦉', color: p.color }
  const fresh = createProfile({ id: p.id, name: p.name, avatar: seed.avatar, color: p.color }, now)
  // Time on the app is a record for the parent, not progress: keep it.
  if (p.timeSpent) fresh.timeSpent = p.timeSpent
  return { data: withProfile(data, fresh), ok: true }
}

export function setInOrderIndex(data: AppData, profileId: string, key: string, idx: number): OpResult {
  const p = getProfile(data, profileId)
  if (!p) return fail(data, 'no-profile')
  if (typeof key !== 'string' || !key || !Number.isFinite(idx)) return fail(data, 'invalid')
  const v = Math.max(0, Math.floor(idx))
  if (p.inOrderIndex[key] === v) return { data, ok: true }
  return { data: withProfile(data, { ...p, inOrderIndex: { ...p.inOrderIndex, [key]: v } }), ok: true }
}

export function setProfileSetting<K extends keyof ProfileSettings>(
  data: AppData,
  profileId: string,
  key: K,
  value: ProfileSettings[K],
): OpResult {
  const p = getProfile(data, profileId)
  if (!p) return fail(data, 'no-profile')
  if ((key !== 'sound' && key !== 'learnMode') || typeof value !== 'boolean') return fail(data, 'invalid')
  if (p.settings[key] === value) return { data, ok: true }
  return { data: withProfile(data, { ...p, settings: { ...p.settings, [key]: value } }), ok: true }
}

export function selectProfile(data: AppData, profileId: string | null, now: number): AppData {
  if (profileId === null) return data.activeProfileId === null ? data : { ...data, activeProfileId: null }
  const p = getProfile(data, profileId)
  if (!p) return data
  const d = withProfile(data, ensureDaily(p, now))
  return d.activeProfileId === profileId ? d : { ...d, activeProfileId: profileId }
}

// ---------------------------------------------------------------------------
// Parent: PIN & settings
// ---------------------------------------------------------------------------

export const PIN_RE = /^\d{4}$/

/** Constant-shape comparison: always walks all 4 positions, no early exit. */
export function pinMatches(stored: string | null, attempt: unknown): boolean {
  const s = typeof stored === 'string' ? stored : ''
  const a = typeof attempt === 'string' ? attempt : ''
  let diff = (s.length === 4 ? 0 : 1) | (a.length === 4 ? 0 : 1)
  for (let i = 0; i < 4; i++) diff |= (s.charCodeAt(i) || 0) ^ (a.charCodeAt(i) || 0)
  return diff === 0
}

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_RE.test(pin)
}

export function setPin(data: AppData, pin: string): OpResult {
  if (!isValidPin(pin)) return fail(data, 'invalid')
  return { data: withParent(data, { pin }), ok: true }
}

export const PIN_RESETS_KEPT = 10
/** "Forgot the PIN?" without the recovery code: the new PIN can be set this long after asking. */
export const PIN_RESET_WAIT_MS = DAY_MS
/** After such a reset, approving rewards and gifting coins pause this long. */
export const RESET_COOLDOWN_MS = DAY_MS

function isTime(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0
}

/** Every recorded "Forgot the PIN?" reset, oldest first (incl. the legacy single pinResetAt). */
export function pinResetTimes(parent: ParentSettings): number[] {
  const all = [...(Array.isArray(parent.pinResets) ? parent.pinResets : []), parent.pinResetAt].filter(isTime)
  return Array.from(new Set(all)).sort((a, b) => a - b).slice(-PIN_RESETS_KEPT)
}

export function latestPinReset(parent: ParentSettings): number | undefined {
  const t = pinResetTimes(parent)
  return t.length ? t[t.length - 1] : undefined
}

/** Until when approvals/gifts are paused (0 = not paused). */
export function resetCooldownUntil(parent: ParentSettings): number {
  return isTime(parent.pinFallbackResetAt) ? parent.pinFallbackResetAt + RESET_COOLDOWN_MS : 0
}

/**
 * "Forgot the PIN?": replace it without the old one. There is no server, so
 * this can't be truly secure. Instead every reset is recorded (pinResets,
 * add-only), the parent zone and the PIN pad show it, and a reset done with
 * the grown-up question only (`fallback`, no recovery code) pauses approvals
 * and gifts for a day.
 */
export function resetPin(data: AppData, pin: string, now: number, opts: { fallback?: boolean } = {}): OpResult {
  if (!isValidPin(pin)) return fail(data, 'invalid')
  const pinResets = [...pinResetTimes(data.parent), now].slice(-PIN_RESETS_KEPT)
  const patch: Partial<ParentSettings> = { pin, pinResetAt: now, pinResets }
  if (opts.fallback) patch.pinFallbackResetAt = now
  const out = withParent(data, patch)
  delete out.parent.pinResetRequestedAt
  return { data: out, ok: true }
}

/** "Forgot the PIN?" without the recovery code: start the 24-hour wait (keeps an earlier request). */
export function requestPinReset(data: AppData, now: number): OpResult {
  if (isTime(data.parent.pinResetRequestedAt) && data.parent.pinResetRequestedAt <= now + DAY_MS) return { data, ok: true }
  return { data: withParent(data, { pinResetRequestedAt: now }), ok: true }
}

/** Parent (with the PIN) cancels a pending "Forgot the PIN?" request. */
export function cancelPinResetRequest(data: AppData): OpResult {
  if (data.parent.pinResetRequestedAt === undefined) return { data, ok: true }
  const out = withParent(data, {})
  delete out.parent.pinResetRequestedAt
  return { data: out, ok: true }
}

/** When the waiting "Forgot the PIN?" request may set a new PIN (null = no request). */
export function pinResetReadyAt(parent: ParentSettings): number | null {
  return isTime(parent.pinResetRequestedAt) ? parent.pinResetRequestedAt + PIN_RESET_WAIT_MS : null
}

/** "That was me": hide the PIN-reset notices up to now. */
export function ackPinReset(data: AppData, now: number): OpResult {
  return { data: withParent(data, { pinResetAckAt: now }), ok: true }
}

/** Normalised recovery code (letters/digits, upper case). */
export function cleanRecoveryCode(code: string): string {
  return typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : ''
}

/** One-way hash of a recovery code (FNV-1a twice, salted; plenty for a code that lives next to the PIN). */
export function hashRecoveryCode(code: string): string {
  const s = `opening-quest|${cleanRecoveryCode(code)}`
  const fnv = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
    return h.toString(36).padStart(7, '0')
  }
  return fnv(0x811c9dc5) + fnv(0x5bd1e995) + fnv(0x27d4eb2f)
}

export function recoveryCodeMatches(parent: ParentSettings, code: string): boolean {
  const c = cleanRecoveryCode(code)
  return !!parent.recoveryHash && c.length >= 8 && hashRecoveryCode(c) === parent.recoveryHash
}

export function setRecoveryHash(data: AppData, hash: string): OpResult {
  if (typeof hash !== 'string' || !/^[0-9a-z]{8,64}$/.test(hash)) return fail(data, 'invalid')
  return { data: withParent(data, { recoveryHash: hash }), ok: true }
}

/**
 * Parent settings after importing a backup: the backup's rewards and training
 * settings, but this DEVICE's PIN and recovery code (backups never carry them;
 * a hand-made file must not be able to replace them), and the PIN-reset and
 * clock records of BOTH merged (add-only), so restoring an old backup can't
 * hide a reset.
 */
export function mergeParentOnImport(cur: ParentSettings, incoming: ParentSettings): ParentSettings {
  const out: ParentSettings = { ...incoming, pin: cur.pin ?? incoming.pin }
  delete out.recoveryHash
  delete out.pinResetAckAt
  delete out.pinResetRequestedAt
  delete out.pinFallbackResetAt
  delete out.lastSeenAt
  delete out.clockJumps
  if (cur.recoveryHash) out.recoveryHash = cur.recoveryHash
  if (isTime(cur.pinResetAckAt)) out.pinResetAckAt = cur.pinResetAckAt
  if (isTime(cur.pinResetRequestedAt)) out.pinResetRequestedAt = cur.pinResetRequestedAt
  const resets = pinResetTimes({ ...cur, pinResets: [...pinResetTimes(cur), ...pinResetTimes(incoming)] })
  delete out.pinResets
  delete out.pinResetAt
  if (resets.length) {
    out.pinResets = resets
    out.pinResetAt = resets[resets.length - 1]
  }
  const fallback = Math.max(isTime(cur.pinFallbackResetAt) ? cur.pinFallbackResetAt : 0, isTime(incoming.pinFallbackResetAt) ? incoming.pinFallbackResetAt : 0)
  if (fallback > 0) out.pinFallbackResetAt = fallback
  const seen = Math.max(isTime(cur.lastSeenAt) ? cur.lastSeenAt : 0, isTime(incoming.lastSeenAt) ? incoming.lastSeenAt : 0)
  if (seen > 0) out.lastSeenAt = seen
  const jumps = new Map<string, { from: number; to: number }>()
  for (const j of [...(cur.clockJumps ?? []), ...(incoming.clockJumps ?? [])]) if (isTime(j?.from) && isTime(j?.to)) jumps.set(`${j.from}|${j.to}`, j)
  if (jumps.size) out.clockJumps = [...jumps.values()].sort((a, b) => a.to - b.to).slice(-CLOCK_JUMPS_KEPT)
  return out
}

// ---------------------------------------------------------------------------
// Device clock
// ---------------------------------------------------------------------------

export const CLOCK_JUMPS_KEPT = 10
/** Moving the clock back more than this is recorded (daily limits rely on the clock). */
export const CLOCK_BACK_MS = 60 * 60 * 1000
const CLOCK_SEEN_STEP_MS = 10 * 60 * 1000

/**
 * Remember the latest device time and record the clock being turned BACK (by
 * more than an hour) — the daily coin limits and the 60-minute repeat rule
 * trust the clock, so the parent zone shows such jumps. (A jump forward can't
 * be told apart from not using the app for a while, so it isn't recorded.)
 * Identity-preserving; writes at most every 10 minutes.
 */
export function trackClock(data: AppData, now: number): AppData {
  if (!isTime(now)) return data
  const last = data.parent.lastSeenAt
  if (!isTime(last)) return withParent(data, { lastSeenAt: now })
  if (now < last - CLOCK_BACK_MS) {
    const clockJumps = [...(data.parent.clockJumps ?? []), { from: last, to: now }].slice(-CLOCK_JUMPS_KEPT)
    return withParent(data, { lastSeenAt: now, clockJumps })
  }
  if (now > last + CLOCK_SEEN_STEP_MS) return withParent(data, { lastSeenAt: now })
  return data
}

/** Parent dismisses the clock warnings. */
export function clearClockJumps(data: AppData): AppData {
  if (!data.parent.clockJumps) return data
  const out = withParent(data, {})
  delete out.parent.clockJumps
  return out
}

function cleanReward(raw: Partial<RewardDef>, id: string): RewardDef | null {
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  const emoji = typeof raw.emoji === 'string' && raw.emoji.trim() ? raw.emoji.trim().slice(0, 8) : '🎁'
  const cost = typeof raw.cost === 'number' && Number.isFinite(raw.cost) ? Math.floor(raw.cost) : NaN
  if (!name || !(cost >= 1 && cost <= 1000000)) return null
  let maxPerWeek: number | undefined
  if (raw.maxPerWeek !== undefined && raw.maxPerWeek !== null) {
    const m = Number(raw.maxPerWeek)
    if (!Number.isFinite(m) || m < 1 || m > 100) return null
    maxPerWeek = Math.floor(m)
  }
  const out: RewardDef = { id, name, emoji, cost, enabled: raw.enabled !== false }
  if (maxPerWeek !== undefined) out.maxPerWeek = maxPerWeek
  return out
}

/** Update an existing reward (matched by id). `maxPerWeek: undefined` = unlimited. */
export function setReward(data: AppData, reward: RewardDef): OpResult {
  const i = data.parent.rewards.findIndex((r) => r.id === reward?.id)
  if (i < 0) return fail(data, 'unknown-reward')
  const clean = cleanReward(reward, reward.id)
  if (!clean) return fail(data, 'invalid')
  const rewards = data.parent.rewards.slice()
  rewards[i] = clean
  return { data: withParent(data, { rewards }), ok: true }
}

function slug(s: string): string {
  const base = s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  return base || 'reward'
}

export function addReward(data: AppData, reward: Omit<RewardDef, 'id'> & { id?: string }): OpResult & { id?: string } {
  const taken = new Set(data.parent.rewards.map((r) => r.id))
  const base = slug(reward?.id || reward?.name || '')
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  const clean = cleanReward(reward ?? {}, id)
  if (!clean) return fail(data, 'invalid')
  return { data: withParent(data, { rewards: [...data.parent.rewards, clean] }), ok: true, id }
}

/** Remove a reward. Existing requests keep their snapshot (name/cost) and can still be resolved. */
export function removeReward(data: AppData, rewardId: string): OpResult {
  if (!data.parent.rewards.some((r) => r.id === rewardId)) return fail(data, 'unknown-reward')
  return { data: withParent(data, { rewards: data.parent.rewards.filter((r) => r.id !== rewardId) }), ok: true }
}

export function setMaxPly(data: AppData, openingId: string, ply: number): OpResult {
  if (typeof openingId !== 'string' || !openingId || !Number.isFinite(ply) || ply < 0 || ply > 400) return fail(data, 'invalid')
  return { data: withParent(data, { maxPly: { ...data.parent.maxPly, [openingId]: Math.floor(ply) } }), ok: true }
}

export function toggleExtra(data: AppData, chapterId: string, on?: boolean): OpResult {
  if (typeof chapterId !== 'string' || !chapterId) return fail(data, 'invalid')
  const has = data.parent.enabledExtras.includes(chapterId)
  const want = on === undefined ? !has : on
  if (want === has) return { data, ok: true }
  const enabledExtras = want ? [...data.parent.enabledExtras, chapterId] : data.parent.enabledExtras.filter((c) => c !== chapterId)
  return { data: withParent(data, { enabledExtras }), ok: true }
}

export function setDailyGoal(data: AppData, n: number): OpResult {
  if (!Number.isFinite(n) || n < 1 || n > 50) return fail(data, 'invalid')
  return { data: withParent(data, { dailyGoalLines: Math.floor(n) }), ok: true }
}

/** Plan B lines in laps on/off (docs/practice-structure.md §5.5). Absent = on. */
export function setIncludePlanB(data: AppData, on: boolean): OpResult {
  if (typeof on !== 'boolean') return fail(data, 'invalid')
  if ((data.parent.includePlanB !== false) === on) return { data, ok: true }
  return { data: withParent(data, { includePlanB: on }), ok: true }
}

export const MAX_STUDY_PGN_CHARS = 4_000_000

/** Lichess chapter ids ([ChapterURL] last segment) found in a study PGN. */
export function studyChapterIds(pgn: string): string[] {
  const out = new Set<string>()
  for (const m of pgn.matchAll(/\[ChapterURL\s+"[^"]*\/([A-Za-z0-9_-]+)\/?(?:[?#][^"]*)?"\]/g)) out.add(m[1])
  return [...out]
}

export function importStudyPgn(data: AppData, text: string, name: string, now: number): OpResult {
  if (typeof text !== 'string') return fail(data, 'invalid')
  const pgn = text.replace(/^﻿/, '')
  if (!pgn.trim() || pgn.length > MAX_STUDY_PGN_CHARS || !/\[\w+\s+"/.test(pgn)) return fail(data, 'invalid')
  // Without any of the coach's chapters every opening would end up with 0 lines.
  const known = new Set(OPENINGS.flatMap((o) => [...o.chapters, ...o.extraChapters].map((c) => c.id)))
  if (!studyChapterIds(pgn).some((id) => known.has(id))) return fail(data, 'no-chapters')
  const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'Imported study'
  return { data: { ...data, studyOverride: { pgn, importedAt: now, name: label } }, ok: true }
}

export function clearStudyOverride(data: AppData): AppData {
  if (data.studyOverride === undefined) return data
  const { studyOverride: _drop, ...rest } = data
  return rest
}
