// Persistence (DESIGN.md §3): localStorage load/save (debounced), validation +
// migrations, backup export/import. Never throws to the caller. Safe under
// plain node (no localStorage → in-memory defaults; tests can inject a backend).

import type {
  AppData,
  CoinEvent,
  ItemKind,
  LapRecord,
  LineStats,
  ParentSettings,
  Profile,
  ProfileSettings,
  Redemption,
  RewardDef,
  TimeSpent,
} from '../types.ts'
import { normTimeSpent } from './timeSpent.ts'
import { migrateLineStats } from './lineMigration.ts'
import { LINE_ID_MIGRATIONS } from '../data/lineMigrations.ts'
import { findItem, itemById, DEFAULT_EQUIPPED, FREE_ITEM_IDS } from './catalog.ts'
import {
  createDefaultAppData,
  createDefaultParentSettings,
  defaultSeedFor,
  emptyDaily,
  HISTORY_CAP,
  isDateKey,
  localDateKey,
} from './defaults.ts'
import type { DailyStateX } from './defaults.ts'
import { mergeParentOnImport } from './profileOps.ts'

export const STORAGE_KEY = 'opening-quest.v1'
/** The (large) imported study PGN is stored separately so a quota problem there never blocks progress saves. */
export const STUDY_KEY = 'opening-quest.v1.study'
/**
 * Unreadable saved data is copied here (so it can be recovered). The FIRST
 * rescue copy is never overwritten; a later, different one goes to CORRUPT_LATEST_KEY.
 */
export const CORRUPT_KEY = 'opening-quest.v1.corrupt'
export const CORRUPT_LATEST_KEY = 'opening-quest.v1.corrupt.latest'
/** The data as it was just before the last backup restore (for "Undo restore"). */
export const BEFORE_RESTORE_KEY = 'opening-quest.v1.before-restore'
export const CURRENT_VERSION = 1
export const SAVE_DEBOUNCE_MS = 300
export const BACKUP_APP_ID = 'opening-quest'
export const MAX_BACKUP_CHARS = 10_000_000
const MAX_PROFILES = 8

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

let backendOverride: KeyValueStorage | null | undefined = undefined

/** Tests: inject a fake storage (`null` = none, `undefined` = auto-detect localStorage). Resets save/load status. */
export function setStorageBackend(s: KeyValueStorage | null | undefined): void {
  backendOverride = s
  lastStudyRef = undefined
  loadIssue = null
  lastSaveError = null
}

function backend(): KeyValueStorage | null {
  if (backendOverride !== undefined) return backendOverride
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null
    return localStorage
  } catch {
    return null // e.g. SecurityError when storage is blocked
  }
}

// Small side keys (PIN lockout, grown-up check back-off, restore rescue copy):
// never part of AppData, backups or the cross-tab 'storage' adoption. Never throw.
export function auxGet(key: string): string | null {
  try {
    return backend()?.getItem(key) ?? null
  } catch {
    return null
  }
}
export function auxSet(key: string, value: string): boolean {
  try {
    const ls = backend()
    if (!ls) return false
    ls.setItem(key, value)
    return true
  } catch {
    return false
  }
}
export function auxRemove(key: string): void {
  try {
    backend()?.removeItem(key)
  } catch {
    // best effort
  }
}

let lastSaveError: string | null = null
/**
 * Why progress is NOT being saved right now (null after a successful save):
 * storage unavailable, quota full, or saving paused because the saved data
 * couldn't be read (see getLoadIssue). Drives a "progress isn't being saved" banner.
 */
export function getLastSaveError(): string | null {
  return lastSaveError
}

/** Why the saved data was rejected on load. While set, saving is PAUSED so the original is never overwritten. */
export interface LoadIssue {
  kind: 'corrupt' | 'invalid' | 'newer-version'
  /** Short explanation (from validation). */
  error: string
  at: number
}

let loadIssue: LoadIssue | null = null

/** Non-null while saved data could not be read; saves are paused until clearLoadIssue() or a backup import. */
export function getLoadIssue(): LoadIssue | null {
  return loadIssue
}

let statusListener: (() => void) | null = null
/** The app store listens here to re-render when getLastSaveError()/getLoadIssue() change. */
export function onStorageStatusChange(fn: (() => void) | null): void {
  statusListener = fn
}
function statusChanged(): void {
  try {
    statusListener?.()
  } catch {
    // never let a UI listener break persistence
  }
}
function setSaveError(e: string | null): void {
  if (e === lastSaveError) return
  lastSaveError = e
  statusChanged()
}
function setLoadIssue(i: LoadIssue | null): void {
  if (i === loadIssue) return
  loadIssue = i
  statusChanged()
}

export const SAVE_PAUSED_ERROR = "Saving is paused: the saved progress on this device couldn't be read."
export const STORAGE_UNAVAILABLE_ERROR = 'Storage is not available on this device.'

/** Ask the browser not to evict our data (iPad Safari can clear storage). */
export function requestPersistentStorage(): Promise<boolean> {
  try {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator | undefined) : undefined
    const p = nav?.storage?.persist?.()
    return p ? p.catch(() => false) : Promise.resolve(false)
  } catch {
    return Promise.resolve(false)
  }
}

// ---------------------------------------------------------------------------
// Validation / normalisation
// ---------------------------------------------------------------------------

export type ValidateResult = { ok: true; data: AppData } | { ok: false; error: string }

type Obj = Record<string, unknown>

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}
function int0(x: unknown, def = 0): number {
  return isNum(x) && x >= 0 ? Math.floor(x) : def
}
function str(x: unknown, def: string, max = 200): string {
  return typeof x === 'string' ? x.slice(0, max) : def
}
function bool(x: unknown, def: boolean): boolean {
  return typeof x === 'boolean' ? x : def
}
function strArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []
}
/** Object.entries without '__proto__' (JSON.parse makes it an own key; assigning it would swap the prototype). */
function safeEntries(o: Obj): Array<[string, unknown]> {
  return Object.entries(o).filter(([k]) => k !== '__proto__')
}

/** Migrations: MIGRATIONS[v] turns a version-v object into version v+1. */
const MIGRATIONS: Record<number, (raw: Obj) => Obj> = {}

function normLineStats(x: unknown): LineStats | null {
  if (!isObj(x)) return null
  if (!isNum(x.box) || !isNum(x.lastPracticed) || !isNum(x.dueAt)) return null
  const s: LineStats = {
    attempts: int0(x.attempts),
    completions: int0(x.completions),
    perfects: int0(x.perfects),
    box: Math.min(5, int0(x.box)),
    lastPracticed: x.lastPracticed,
    dueAt: x.dueAt,
    lastMistakes: int0(x.lastMistakes),
  }
  // Optional economy markers (see LineStats): kept only when meaningful.
  const lc = int0(x.learnCompletions)
  if (lc > 0) s.learnCompletions = Math.min(lc, s.completions)
  if (x.learnPending === true) s.learnPending = true
  if (x.quickRetryUsed === true) s.quickRetryUsed = true
  // Medal record (docs/practice-structure.md §3.2). A perfect day needs a perfect run.
  if (isNum(x.perfectDays) && x.perfectDays >= 0) s.perfectDays = Math.min(Math.floor(x.perfectDays), s.perfects)
  if (isDateKey(x.lastPerfectDay)) s.lastPerfectDay = x.lastPerfectDay
  if (x.medal === 1 || x.medal === 2 || x.medal === 3) s.medal = x.medal
  return s
}

/** The current id of a line saved under `id` (LINE_ID_MIGRATIONS, same rule as migrateLineStats). */
function renamedLineId(id: string): string {
  return Object.prototype.hasOwnProperty.call(LINE_ID_MIGRATIONS, id) && LINE_ID_MIGRATIONS[id] ? LINE_ID_MIGRATIONS[id] : id
}

/**
 * A new study renames lines; progress follows lines whose moves didn't change.
 * migrateLineStats keeps one entry whole when several saved ids land on the same
 * line. A medal is never lost and never paid twice (docs/practice-structure.md
 * §3.2), so the kept entry gets the best medal of every entry merged into it.
 */
function migrateStats(lineStats: Record<string, LineStats>): Record<string, LineStats> {
  const out = migrateLineStats(lineStats, LINE_ID_MIGRATIONS)
  if (out === lineStats) return out
  for (const [id, s] of Object.entries(lineStats)) {
    if (s.medal === undefined) continue
    const to = renamedLineId(id)
    const kept = Object.prototype.hasOwnProperty.call(out, to) ? out[to] : undefined
    if (kept && (kept.medal ?? 0) < s.medal) out[to] = { ...kept, medal: s.medal }
  }
  return out
}

/** Most line ids kept in one opening's current lap (the biggest opening has ~55 lines). */
const LAP_DONE_CAP = 1000

/**
 * profile.laps: per opening `n` an integer >= 1 and `done` unique line ids
 * (invalid entries dropped). Renamed line ids follow LINE_ID_MIGRATIONS, like lineStats.
 */
function normLaps(x: unknown): Record<string, LapRecord> | undefined {
  if (!isObj(x)) return undefined
  const out: Record<string, LapRecord> = {}
  let any = false
  for (const [k, v] of safeEntries(x)) {
    if (!isObj(v) || !isNum(v.n) || v.n < 1) continue
    out[k] = { n: Math.floor(v.n), done: Array.from(new Set(strArray(v.done).map(renamedLineId))).slice(-LAP_DONE_CAP) }
    any = true
  }
  return any ? out : undefined
}

/** profile.mainRoundBest: per opening a finite time > 0 (ms). */
function normRoundBest(x: unknown): Record<string, number> | undefined {
  if (!isObj(x)) return undefined
  const out: Record<string, number> = {}
  let any = false
  for (const [k, v] of safeEntries(x)) {
    if (!isNum(v) || v <= 0) continue
    out[k] = v
    any = true
  }
  return any ? out : undefined
}

function normDaily(x: unknown, now: number): DailyStateX {
  if (!isObj(x) || !isDateKey(x.date)) return emptyDaily(localDateKey(now))
  const ids = Array.from(new Set(strArray(x.distinctLineIds)))
  const d: DailyStateX = {
    date: x.date,
    lines: Array.isArray(x.distinctLineIds) ? ids.length : int0(x.lines),
    perfects: int0(x.perfects),
    coinsEarned: int0(x.coinsEarned),
    goalClaimed: bool(x.goalClaimed, false),
    openingsPracticed: Array.from(new Set(strArray(x.openingsPracticed))),
    engineGamesRewarded: int0(x.engineGamesRewarded),
    distinctLineIds: ids,
  }
  // Main-line round bonuses paid today (absent = 0).
  if (isNum(x.roundsRewarded) && x.roundsRewarded >= 0) d.roundsRewarded = Math.floor(x.roundsRewarded)
  return d
}

function normRedemption(x: unknown): Redemption | null {
  if (!isObj(x)) return null
  if (typeof x.id !== 'string' || typeof x.rewardId !== 'string' || !isNum(x.cost) || !isNum(x.requestedAt)) return null
  if (x.status !== 'pending' && x.status !== 'approved' && x.status !== 'declined') return null
  const r: Redemption = {
    id: x.id,
    rewardId: x.rewardId,
    rewardName: str(x.rewardName, 'Reward', 60),
    emoji: str(x.emoji, '🎁', 8),
    cost: int0(x.cost),
    requestedAt: x.requestedAt,
    status: x.status,
  }
  if (isNum(x.resolvedAt)) r.resolvedAt = x.resolvedAt
  return r
}

function normEvent(x: unknown): CoinEvent | null {
  if (!isObj(x) || !isNum(x.at) || !isNum(x.delta) || typeof x.reason !== 'string') return null
  return { at: x.at, delta: Math.trunc(x.delta), reason: x.reason.slice(0, 120) }
}

function normProfile(x: unknown, now: number): Profile | string {
  if (!isObj(x)) return 'A player entry is broken.'
  if (typeof x.id !== 'string' || !x.id || x.id.length > 40) return 'A player has no id.'
  if (typeof x.name !== 'string' || !x.name.trim()) return `Player "${x.id}" has no name.`
  if (!isNum(x.coins) || x.coins < 0) return `Player "${x.name}" has an invalid coin count.`
  if (!isNum(x.xp) || x.xp < 0) return `Player "${x.name}" has invalid XP.`
  if (!Array.isArray(x.owned)) return `Player "${x.name}" has no item list.`
  if (!isObj(x.lineStats)) return `Player "${x.name}" has no progress data.`

  const seed = defaultSeedFor(x.id)

  const lineStats: Record<string, LineStats> = {}
  for (const [k, v] of safeEntries(x.lineStats)) {
    const s = normLineStats(v)
    if (s) lineStats[k] = s
  }

  const inOrderIndex: Record<string, number> = {}
  if (isObj(x.inOrderIndex)) for (const [k, v] of safeEntries(x.inOrderIndex)) if (isNum(v) && v >= 0) inOrderIndex[k] = Math.floor(v)

  // Owned: known catalogue ids only, plus every free item.
  const owned: string[] = []
  for (const id of [...FREE_ITEM_IDS, ...strArray(x.owned)]) if (itemById(id) && !owned.includes(id)) owned.push(id)

  const eqIn = isObj(x.equipped) ? x.equipped : {}
  const slot = (kind: ItemKind, key: keyof typeof DEFAULT_EQUIPPED): string => {
    const ref = eqIn[key]
    if (typeof ref === 'string') {
      const it = findItem(kind, ref)
      if (it && owned.includes(it.id)) return ref
    }
    return DEFAULT_EQUIPPED[key]
  }
  const equipped = {
    board: slot('board', 'board'),
    pieces: slot('pieces', 'pieces'),
    effect: slot('effect', 'effect'),
    title: slot('title', 'title'),
  }

  let avatar = typeof x.avatar === 'string' ? x.avatar : ''
  const av = findItem('avatar', avatar)
  if (!av || !owned.includes(av.id)) avatar = seed?.avatar ?? '🦉'

  const achievements: Record<string, number> = {}
  if (isObj(x.achievements)) for (const [k, v] of safeEntries(x.achievements)) if (isNum(v)) achievements[k] = v

  const t = isObj(x.totals) ? x.totals : {}
  const st = isObj(x.settings) ? x.settings : {}
  const settings: ProfileSettings = { sound: bool(st.sound, true), learnMode: bool(st.learnMode, false) }

  const redemptions = Array.isArray(x.redemptions)
    ? x.redemptions.map(normRedemption).filter((r): r is Redemption => r !== null)
    : []
  const history = Array.isArray(x.history)
    ? x.history.map(normEvent).filter((e): e is CoinEvent => e !== null).slice(0, HISTORY_CAP)
    : []

  const totals: Profile['totals'] = {
    lines: int0(t.lines),
    perfects: int0(t.perfects),
    mistakesFixed: int0(t.mistakesFixed),
    engineWins: int0(t.engineWins),
    blundersPunished: int0(t.blundersPunished),
  }
  // Main-line rounds / clean rounds / laps finished (absent on old saves).
  for (const k of ['rounds', 'cleanRounds', 'laps'] as const) {
    const v = t[k]
    if (isNum(v) && v >= 0) totals[k] = Math.floor(v)
  }
  const laps = normLaps(x.laps)
  const mainRoundBest = normRoundBest(x.mainRoundBest)

  return {
    id: x.id,
    name: x.name.trim().slice(0, 20),
    avatar,
    color: typeof x.color === 'string' && x.color ? x.color.slice(0, 40) : (seed?.color ?? '#6c4bf4'),
    coins: Math.floor(x.coins),
    xp: Math.floor(x.xp),
    // A new study renames lines; progress (and every medal) follows lines whose moves didn't change.
    lineStats: migrateStats(lineStats),
    inOrderIndex,
    owned,
    equipped,
    achievements,
    daily: normDaily(x.daily, now),
    streakDays: int0(x.streakDays),
    lastGoalDate: isDateKey(x.lastGoalDate) ? x.lastGoalDate : '',
    bestCombo: int0(x.bestCombo),
    totals,
    ...(laps ? { laps } : {}),
    ...(mainRoundBest ? { mainRoundBest } : {}),
    redemptions,
    history,
    settings,
    createdAt: isNum(x.createdAt) ? x.createdAt : now,
    ...withTime(normTimeSpent(x.timeSpent)),
  }
}

function withTime(t: TimeSpent | undefined): { timeSpent?: TimeSpent } {
  return t ? { timeSpent: t } : {}
}

function normReward(x: unknown): RewardDef | null {
  if (!isObj(x) || typeof x.id !== 'string' || !x.id || typeof x.name !== 'string' || !isNum(x.cost) || x.cost < 1) return null
  const r: RewardDef = {
    id: x.id.slice(0, 40),
    name: x.name.slice(0, 40),
    emoji: str(x.emoji, '🎁', 8),
    cost: Math.floor(x.cost),
    enabled: bool(x.enabled, true),
  }
  if (isNum(x.maxPerWeek) && x.maxPerWeek >= 1) r.maxPerWeek = Math.floor(x.maxPerWeek)
  return r
}

function normParent(x: unknown): ParentSettings | string {
  const def = createDefaultParentSettings()
  if (!isObj(x)) return 'Parent settings are missing.'
  let pin: string | null = null
  if (x.pin !== null && x.pin !== undefined) {
    if (typeof x.pin !== 'string' || !/^\d{4}$/.test(x.pin)) return 'The parent PIN is invalid.'
    pin = x.pin
  }
  if (!Array.isArray(x.rewards)) return 'The rewards list is missing.'
  const rewards: RewardDef[] = []
  for (const r of x.rewards) {
    const nr = normReward(r)
    if (!nr) return 'A reward in the backup is broken.'
    if (!rewards.some((o) => o.id === nr.id)) rewards.push(nr)
  }
  const maxPly: Record<string, number> = { ...def.maxPly }
  if (isObj(x.maxPly)) for (const [k, v] of safeEntries(x.maxPly)) if (isNum(v) && v >= 0 && v <= 400) maxPly[k] = Math.floor(v)
  const goal = isNum(x.dailyGoalLines) && x.dailyGoalLines >= 1 && x.dailyGoalLines <= 50 ? Math.floor(x.dailyGoalLines) : def.dailyGoalLines
  const out: ParentSettings = {
    pin,
    rewards,
    maxPly,
    enabledExtras: Array.from(new Set(strArray(x.enabledExtras))),
    dailyGoalLines: goal,
  }
  if (typeof x.includePlanB === 'boolean') out.includePlanB = x.includePlanB
  if (isNum(x.pinResetAt) && x.pinResetAt > 0) out.pinResetAt = x.pinResetAt
  if (Array.isArray(x.pinResets)) {
    const resets = Array.from(new Set(x.pinResets.filter((t): t is number => isNum(t) && t > 0))).sort((a, b) => a - b).slice(-10)
    if (resets.length) out.pinResets = resets
  }
  for (const k of ['pinFallbackResetAt', 'pinResetAckAt', 'pinResetRequestedAt', 'lastSeenAt'] as const) {
    const v = x[k]
    if (isNum(v) && v > 0) out[k] = v
  }
  if (typeof x.recoveryHash === 'string' && /^[0-9a-z]{8,64}$/.test(x.recoveryHash)) out.recoveryHash = x.recoveryHash
  if (Array.isArray(x.clockJumps)) {
    const jumps = x.clockJumps
      .filter((j): j is { from: number; to: number } => isObj(j) && isNum(j.from) && isNum(j.to))
      .map((j) => ({ from: j.from, to: j.to }))
      .slice(-10)
    if (jumps.length) out.clockJumps = jumps
  }
  return out
}

/**
 * Check and normalise saved/imported data. Rejects anything that isn't an
 * Opening Quest save (wrong/missing version, no players, broken coins…);
 * repairs harmless gaps (missing settings, unknown items, bad history rows).
 * Returns a brand-new object; the input is never used by reference.
 */
export function validateAppData(rawIn: unknown, now: number = Date.now()): ValidateResult {
  if (!isObj(rawIn)) return { ok: false, error: "This doesn't look like Opening Quest data." }
  let raw: Obj = rawIn
  if (!isNum(raw.version) || !Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, error: 'The data has no valid version number.' }
  }
  if (raw.version > CURRENT_VERSION) return { ok: false, error: 'This backup is from a newer version of the app.' }
  for (let v = raw.version; v < CURRENT_VERSION; v++) {
    const m = MIGRATIONS[v]
    if (!m) return { ok: false, error: `Can't upgrade data from version ${v}.` }
    raw = m(raw)
  }
  if (!Array.isArray(raw.profiles) || raw.profiles.length < 1) return { ok: false, error: 'The data has no players.' }
  if (raw.profiles.length > MAX_PROFILES) return { ok: false, error: 'The data has too many players.' }
  const profiles: Profile[] = []
  for (const rp of raw.profiles) {
    const p = normProfile(rp, now)
    if (typeof p === 'string') return { ok: false, error: p }
    if (profiles.some((o) => o.id === p.id)) return { ok: false, error: `Player "${p.id}" appears twice.` }
    profiles.push(p)
  }
  const parent = normParent(raw.parent)
  if (typeof parent === 'string') return { ok: false, error: parent }

  const data: AppData = {
    version: 1,
    profiles,
    parent,
    activeProfileId:
      typeof raw.activeProfileId === 'string' && profiles.some((p) => p.id === raw.activeProfileId) ? raw.activeProfileId : null,
  }
  if (raw.studyOverride !== undefined && raw.studyOverride !== null) {
    const so = raw.studyOverride
    if (!isObj(so) || typeof so.pgn !== 'string' || !so.pgn.trim()) return { ok: false, error: 'The imported study in the backup is broken.' }
    data.studyOverride = { pgn: so.pgn, importedAt: isNum(so.importedAt) ? so.importedAt : now, name: str(so.name, 'Imported study', 80) }
  }
  return { ok: true, data }
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/** Reference of the studyOverride last written to STUDY_KEY (undefined = unknown). */
let lastStudyRef: AppData['studyOverride'] | null | undefined = undefined

/**
 * Keep a rescue copy of unreadable saved data. The first copy (CORRUPT_KEY) is
 * never overwritten; a later, different copy goes to CORRUPT_LATEST_KEY.
 */
function stashRejected(ls: KeyValueStorage, text: string): void {
  try {
    const first = ls.getItem(CORRUPT_KEY)
    if (first === null) ls.setItem(CORRUPT_KEY, text)
    else if (first !== text && ls.getItem(CORRUPT_LATEST_KEY) !== text) ls.setItem(CORRUPT_LATEST_KEY, text)
  } catch {
    // ignore (quota): saving stays paused, so the original is still in STORAGE_KEY
  }
}

export type LoadStatus = 'ok' | 'empty' | 'unavailable' | 'rejected'
export interface LoadResult {
  status: LoadStatus
  /** The saved data ('ok') or fresh defaults (every other status). */
  data: AppData
  issue?: LoadIssue
}

function rejectLoad(ls: KeyValueStorage, text: string, kind: LoadIssue['kind'], error: string, now: number): LoadResult {
  console.warn('[store] saved data rejected:', error)
  stashRejected(ls, text)
  const issue: LoadIssue = { kind, error, at: now }
  setLoadIssue(issue)
  setSaveError(SAVE_PAUSED_ERROR)
  return { status: 'rejected', data: createDefaultAppData(now), issue }
}

function resolvedLoad(): void {
  setLoadIssue(null)
  if (lastSaveError === SAVE_PAUSED_ERROR || lastSaveError === STORAGE_UNAVAILABLE_ERROR) setSaveError(null)
}

/**
 * Load saved data, with its status. Never throws.
 * - 'ok': the saved data (validated + migrated);
 * - 'empty': nothing saved yet → defaults;
 * - 'unavailable': no usable storage → defaults (getLastSaveError() says so);
 * - 'rejected': the saved data can't be read (damaged, invalid, or written by a
 *   newer version) → defaults, a rescue copy is kept, and SAVING IS PAUSED
 *   (getLoadIssue() !== null) so these defaults never overwrite the original.
 *   Saving resumes after clearLoadIssue() ("start fresh") or a backup import.
 */
export function loadAppDataDetailed(now: number = Date.now()): LoadResult {
  const ls = backend()
  if (!ls) {
    setSaveError(STORAGE_UNAVAILABLE_ERROR)
    return { status: 'unavailable', data: createDefaultAppData(now) }
  }
  let text: string | null = null
  try {
    text = ls.getItem(STORAGE_KEY)
  } catch {
    setSaveError(STORAGE_UNAVAILABLE_ERROR)
    return { status: 'unavailable', data: createDefaultAppData(now) }
  }
  if (!text) {
    lastStudyRef = undefined
    resolvedLoad()
    return { status: 'empty', data: createDefaultAppData(now) }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return rejectLoad(ls, text, 'corrupt', 'The saved progress is damaged.', now)
  }
  if (isObj(raw) && isNum(raw.version) && raw.version > CURRENT_VERSION) {
    return rejectLoad(ls, text, 'newer-version', 'The saved progress is from a newer version of the app.', now)
  }
  const v = validateAppData(raw, now)
  if (!v.ok) return rejectLoad(ls, text, 'invalid', v.error, now)
  resolvedLoad()
  const data = v.data
  if (data.studyOverride) {
    // Stored inline (not by saveAppData): force it out to STUDY_KEY on the next save.
    lastStudyRef = undefined
    return { status: 'ok', data }
  }
  try {
    const s = ls.getItem(STUDY_KEY)
    if (s) {
      const so: unknown = JSON.parse(s)
      if (isObj(so) && typeof so.pgn === 'string' && so.pgn.trim()) {
        data.studyOverride = {
          pgn: so.pgn,
          importedAt: isNum(so.importedAt) ? so.importedAt : now,
          name: str(so.name, 'Imported study', 80),
        }
      }
    }
  } catch {
    // ignore a broken study blob; the bundled study is used instead
  }
  lastStudyRef = data.studyOverride ?? null
  return { status: 'ok', data }
}

/** Load saved data (or fresh defaults). Never throws. See loadAppDataDetailed for the paused-saving rule. */
export function loadAppData(now: number = Date.now()): AppData {
  return loadAppDataDetailed(now).data
}

/**
 * "Start fresh" after a rejected load: keeps the unreadable data as a rescue
 * copy, then lets saving resume (the next save overwrites STORAGE_KEY).
 * Returns false when there was no load issue.
 */
export function clearLoadIssue(): boolean {
  if (!loadIssue) return false
  const ls = backend()
  if (ls) {
    try {
      const text = ls.getItem(STORAGE_KEY)
      if (text) stashRejected(ls, text)
    } catch {
      // nothing more we can do
    }
  }
  setLoadIssue(null)
  if (lastSaveError === SAVE_PAUSED_ERROR) setSaveError(null)
  return true
}

/** A smaller copy used when the full save hits the storage quota. */
function compacted(main: Omit<AppData, 'studyOverride'>): Omit<AppData, 'studyOverride'> {
  return {
    ...main,
    profiles: main.profiles.map((p) => ({
      ...p,
      history: p.history.slice(0, 30),
      redemptions: p.redemptions.filter((r, i) => r.status === 'pending' || i < 20),
    })),
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

/**
 * Save immediately. Returns false (never throws) on failure, with the reason in
 * getLastSaveError(). Refuses while saving is paused (getLoadIssue() !== null).
 */
export function saveAppData(data: AppData): boolean {
  if (loadIssue) {
    setSaveError(SAVE_PAUSED_ERROR)
    return false
  }
  const ls = backend()
  if (!ls) {
    setSaveError(STORAGE_UNAVAILABLE_ERROR)
    return false
  }
  const { studyOverride, ...main } = data
  let err: string | null = null
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(main))
  } catch (e) {
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify(compacted(main)))
    } catch (e2) {
      err = errText(e2 ?? e)
    }
  }
  const studyNow = studyOverride ?? null
  if (studyNow !== lastStudyRef) {
    try {
      if (studyNow) ls.setItem(STUDY_KEY, JSON.stringify(studyNow))
      else ls.removeItem(STUDY_KEY)
      lastStudyRef = studyNow
    } catch (e) {
      err = err ?? `Study: ${errText(e)}`
    }
  }
  setSaveError(err)
  return err === null
}

let pending: AppData | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** Debounced save (300 ms). The latest data wins. */
export function scheduleSave(data: AppData, delayMs: number = SAVE_DEBOUNCE_MS): void {
  pending = data
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    flushSave()
  }, delayMs)
}

/** Write any pending debounced save now (call on pagehide / visibility hidden). True if nothing was pending or the save worked. */
export function flushSave(): boolean {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (!pending) return true
  const d = pending
  pending = null
  return saveAppData(d)
}

export function cancelPendingSave(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  pending = null
}

export function hasPendingSave(): boolean {
  return pending !== null
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export interface BackupFile {
  app: typeof BACKUP_APP_ID
  kind: 'backup'
  version: number
  exportedAt: number
  data: AppData
}

/** The app store registers itself so exportBackup()/importBackup() act on live state. */
export interface LiveStore {
  get(): AppData
  /** Swap in imported data. Must keep this device's PIN / recovery code and merge the PIN-reset records (mergeParentOnImport). */
  replace(data: AppData): void
}
let live: LiveStore | null = null
export function registerLiveStore(store: LiveStore | null): void {
  live = store
}

/**
 * Backup JSON of `data` (default: the live store's state, else what is saved).
 * The parent PIN and the recovery-code hash are NEVER written to the file
 * (`parent.pin` is null), so a kid who opens the backup can't read them.
 * Importing keeps the device's current PIN.
 */
export function exportBackup(data?: AppData, now: number = Date.now()): string {
  const d = data ?? live?.get() ?? loadAppData(now)
  const safe: AppData = { ...d, parent: { ...d.parent, pin: null } }
  delete safe.parent.recoveryHash
  const file: BackupFile = { app: BACKUP_APP_ID, kind: 'backup', version: CURRENT_VERSION, exportedAt: now, data: safe }
  return JSON.stringify(file, null, 1)
}

/** Parse + validate a backup (wrapped BackupFile or a raw AppData object). Applies nothing. */
export function parseBackup(json: string, now: number = Date.now()): ValidateResult {
  if (typeof json !== 'string' || !json.trim()) return { ok: false, error: 'The file is empty.' }
  if (json.length > MAX_BACKUP_CHARS) return { ok: false, error: 'The file is too big to be a backup.' }
  let raw: unknown
  try {
    raw = JSON.parse(json.replace(/^﻿/, ''))
  } catch {
    return { ok: false, error: "This file isn't an Opening Quest backup." }
  }
  if (!isObj(raw)) return { ok: false, error: "This file isn't an Opening Quest backup." }
  if (raw.app !== undefined) {
    if (raw.app !== BACKUP_APP_ID || raw.kind !== 'backup') return { ok: false, error: "This file isn't an Opening Quest backup." }
    if (!isNum(raw.version) || raw.version > CURRENT_VERSION) return { ok: false, error: 'This backup is from a newer version of the app.' }
    return validateAppData(raw.data, now)
  }
  if (!('profiles' in raw)) return { ok: false, error: "This file isn't an Opening Quest backup." }
  return validateAppData(raw, now)
}

/** The parent settings in what is currently saved (null if none / unreadable). */
function savedParent(ls: KeyValueStorage): ParentSettings | null {
  try {
    const text = ls.getItem(STORAGE_KEY)
    if (!text) return null
    const raw: unknown = JSON.parse(text)
    if (!isObj(raw)) return null
    const p = normParent(raw.parent)
    return typeof p === 'string' ? null : p
  } catch {
    return null
  }
}

/**
 * Validate and apply a backup — all or nothing. With a registered live store
 * the state is swapped atomically (and saved); otherwise it is written to storage.
 * A backup without a PIN keeps the device's current PIN. A successful import
 * also ends a paused-saving state (the unreadable data keeps its rescue copy).
 */
export function importBackup(json: string): { ok: boolean; error?: string } {
  const r = parseBackup(json)
  if (!r.ok) return { ok: false, error: r.error }
  if (live) {
    clearLoadIssue()
    live.replace(r.data)
    return { ok: true }
  }
  const ls = backend()
  if (!ls) return { ok: false, error: STORAGE_UNAVAILABLE_ERROR }
  let data = r.data
  const cur = savedParent(ls)
  if (cur) data = { ...data, parent: mergeParentOnImport(cur, data.parent) }
  // Keep the unreadable original before overwriting it.
  if (loadIssue) {
    try {
      const text = ls.getItem(STORAGE_KEY)
      if (text) stashRejected(ls, text)
    } catch {
      // best effort
    }
  }
  // Write both keys; roll back the study key if the main write fails.
  let prevStudy: string | null = null
  try {
    prevStudy = ls.getItem(STUDY_KEY)
  } catch {
    prevStudy = null
  }
  const { studyOverride, ...main } = data
  try {
    if (studyOverride) ls.setItem(STUDY_KEY, JSON.stringify(studyOverride))
    else ls.removeItem(STUDY_KEY)
  } catch (e) {
    return { ok: false, error: `Couldn't save: ${errText(e)}` }
  }
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(main))
  } catch (e) {
    try {
      if (prevStudy === null) ls.removeItem(STUDY_KEY)
      else ls.setItem(STUDY_KEY, prevStudy)
    } catch {
      // best effort
    }
    return { ok: false, error: `Couldn't save: ${errText(e)}` }
  }
  lastStudyRef = studyOverride ?? null
  resolvedLoad()
  return { ok: true }
}
