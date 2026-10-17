// React store (DESIGN.md §3): one module-level AppData, read through
// useSyncExternalStore, changed only through `actions` (which wrap the pure
// profileOps). Every change is saved (debounced 300 ms) and flushed when the
// page is hidden. Safe to import under node (no DOM access at import time).

import { useSyncExternalStore } from 'react'
import type {
  AppData,
  ParentSettings,
  Profile,
  ProfileSettings,
  Repertoire,
  Reward,
  RewardDef,
} from '../types.ts'
import type { LineResultInputX } from './achievements.ts'
import * as ops from './profileOps.ts'
import type { EngineGameOutcome, OpError, OpResult, ShopResult } from './profileOps.ts'
import type { EngineResult } from './rewards.ts'
import {
  auxGet,
  auxRemove,
  auxSet,
  BEFORE_RESTORE_KEY,
  cancelPendingSave,
  clearLoadIssue,
  exportBackup as exportBackupJson,
  flushSave,
  getLastSaveError,
  getLoadIssue,
  importBackup as importBackupJson,
  loadAppDataDetailed,
  onStorageStatusChange,
  parseBackup,
  registerLiveStore,
  requestPersistentStorage,
  scheduleSave,
  STORAGE_KEY,
  STUDY_KEY,
} from './storage.ts'
import type { LoadIssue } from './storage.ts'

export type { LoadIssue }

// ---------------------------------------------------------------------------
// Core store
// ---------------------------------------------------------------------------

let state: AppData | null = null
const listeners = new Set<() => void>()

/**
 * Bumped whenever the data is swapped wholesale (backup import / undo) or a
 * player is reset, so session memory kept outside the store (the trainer's
 * combo and carried mistakes) can start clean. Reading it never loads anything.
 */
let storeEpoch = 0
export function getStoreEpoch(): number {
  return storeEpoch
}

function init(): AppData {
  if (state === null) {
    // Roll every player's daily goal/streak over right away, so a cold launch
    // on a new day never shows yesterday's goal ring.
    const now = Date.now()
    state = ops.trackClock(ops.rolloverAll(loadAppDataDetailed().data, now), now)
    registerLiveStore({ get: () => getAppData(), replace: (d) => replaceAll(d) })
    // Registered after the first load so nothing notifies during a render.
    onStorageStatusChange(() => {
      if (refreshStatus()) notify()
    })
    installBrowserHooks()
  }
  return state
}

/** Current data (non-reactive read). */
export function getAppData(): AppData {
  return state ?? init()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  for (const l of Array.from(listeners)) {
    try {
      l()
    } catch (e) {
      console.error('[store] listener failed', e)
    }
  }
}

function commit(next: AppData, immediate = false): void {
  const cur = getAppData()
  if (next === cur) return
  state = next
  scheduleSave(next)
  if (immediate) flushSave()
  notify()
}

/**
 * Swap in a whole new AppData (backup import). Keeps the current player if they
 * still exist, and this device's parent PIN and recovery code (a hand-made file
 * can't replace them; backups never contain them). PIN-reset and clock records
 * of both are merged, so restoring an old backup can't hide a reset.
 */
function replaceAll(d: AppData): void {
  const cur = getAppData()
  const keepActive = cur.activeProfileId && d.profiles.some((p) => p.id === cur.activeProfileId) ? cur.activeProfileId : null
  lastLine = null
  engineGames.clear()
  storeEpoch++
  const now = Date.now()
  const next = ops.trackClock(
    ops.rolloverAll({ ...d, activeProfileId: keepActive, parent: ops.mergeParentOnImport(cur.parent, d.parent) }, now),
    now,
  )
  commit(next, true)
}

let hooksInstalled = false
function installBrowserHooks(): void {
  if (hooksInstalled || typeof window === 'undefined' || typeof document === 'undefined') return
  hooksInstalled = true
  try {
    void requestPersistentStorage()
    window.addEventListener('pagehide', () => flushSave())
    window.addEventListener('beforeunload', () => flushSave())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave()
      else actions.refreshDaily()
    })
    // Another tab saved: adopt its data (keeps this tab's chosen player).
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY && e.key !== STUDY_KEY) return
      const r = loadAppDataDetailed()
      if (r.status === 'rejected' || r.status === 'unavailable') {
        // e.g. a newer build in another tab: keep this tab's data; saving is
        // paused (getLoadIssue) so the other tab's data is never overwritten.
        notify()
        return
      }
      if (r.status === 'empty') {
        // Storage was cleared elsewhere: this tab holds the only copy — write it back.
        scheduleSave(getAppData())
        return
      }
      cancelPendingSave()
      const cur = getAppData()
      const fresh = ops.rolloverAll(r.data, Date.now())
      const active = cur.activeProfileId && fresh.profiles.some((p) => p.id === cur.activeProfileId) ? cur.activeProfileId : fresh.activeProfileId
      state = { ...fresh, activeProfileId: active }
      lastLine = null
      notify()
    })
    // Roll the daily goal over at local midnight while the app stays open.
    window.setInterval(() => actions.refreshDaily(), 60_000)
  } catch (e) {
    console.warn('[store] could not install page hooks', e)
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useAppData(): AppData {
  return useSyncExternalStore(subscribe, getAppData, getAppData)
}

function activeProfileSnapshot(): Profile | null {
  return ops.getActiveProfile(getAppData())
}

/** The signed-in player (null on the "Who's playing?" screen). */
export function useActiveProfile(): Profile | null {
  return useSyncExternalStore(subscribe, activeProfileSnapshot, activeProfileSnapshot)
}

function parentSnapshot(): ParentSettings {
  return getAppData().parent
}

export function useParentSettings(): ParentSettings {
  return useSyncExternalStore(subscribe, parentSnapshot, parentSnapshot)
}

export function getActiveProfile(): Profile | null {
  return activeProfileSnapshot()
}

// ---------------------------------------------------------------------------
// Storage status (for a "progress isn't being saved" banner)
// ---------------------------------------------------------------------------

export interface StorageStatus {
  /** Saved data couldn't be read; saving is paused until actions.dismissLoadIssue() or a backup import. */
  loadIssue: LoadIssue | null
  /** Why the last save failed (null = saving works). */
  saveError: string | null
}

let statusSnap: StorageStatus = { loadIssue: null, saveError: null }

function refreshStatus(): boolean {
  const loadIssue = getLoadIssue()
  const saveError = getLastSaveError()
  if (loadIssue === statusSnap.loadIssue && saveError === statusSnap.saveError) return false
  statusSnap = { loadIssue, saveError }
  return true
}

/** Current storage status (stable object until something changes). */
export function getStorageStatus(): StorageStatus {
  getAppData()
  refreshStatus()
  return statusSnap
}

export function useStorageStatus(): StorageStatus {
  return useSyncExternalStore(subscribe, getStorageStatus, getStorageStatus)
}

// ---------------------------------------------------------------------------
// Parent PIN session (in memory only)
// ---------------------------------------------------------------------------

/** Sliding window: each parent action extends it. The Parent screen should still call lockParent() on unmount. */
const PARENT_SESSION_MS = 2 * 60 * 1000
const PIN_FREE_TRIES = 5
const PIN_LOCK_MAX_MS = 5 * 60_000
/** Wrong PINs / grown-up answers survive a reload (side keys: never in backups). */
const PINLOCK_KEY = 'opening-quest.pinlock'
const ADULTCHECK_KEY = 'opening-quest.adultcheck'
const ADULT_FREE_TRIES = 2
const ADULT_LOCK_MAX_MS = 10 * 60_000
let parentUnlockedUntil = 0

interface TryLock {
  fails: number
  lockedUntil: number
}

/** Read a try-counter; a lock further ahead than `maxMs` (clock moved) is clamped. */
function readLock(key: string, maxMs: number): TryLock {
  try {
    const raw: unknown = JSON.parse(auxGet(key) ?? 'null')
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>
      const fails = typeof o.fails === 'number' && Number.isFinite(o.fails) && o.fails > 0 ? Math.floor(o.fails) : 0
      const until = typeof o.lockedUntil === 'number' && Number.isFinite(o.lockedUntil) ? o.lockedUntil : 0
      return { fails, lockedUntil: Math.min(until, Date.now() + maxMs) }
    }
  } catch {
    // unreadable: start over
  }
  return { fails: 0, lockedUntil: 0 }
}

function writeLock(key: string, s: TryLock): void {
  if (s.fails === 0 && s.lockedUntil === 0) auxRemove(key)
  else auxSet(key, JSON.stringify(s))
}

function touchParent(): void {
  if (Date.now() < parentUnlockedUntil) parentUnlockedUntil = Date.now() + PARENT_SESSION_MS
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Plain<T> = Omit<T, 'data'>

function run<T extends { data: AppData }>(r: T): Plain<T> {
  commit(r.data)
  const { data: _data, ...rest } = r
  return rest
}

function noProfile(): Plain<OpResult> {
  return { ok: false, error: 'no-profile', message: ops.OP_ERROR_MESSAGES['no-profile'] }
}

function noProfileShop(): Plain<ShopResult> {
  return { ...noProfile(), newAchievements: [], levelUp: null }
}

/** The Reward to show, plus whether the anti-farming rule applied (flat 2 coins). */
export type LineReward = Reward & {
  /**
   * Quick repeat of a line just done well: paid a flat 2 coins and counted for
   * nothing else. The trainer should NOT grow its combo on a farmed run.
   */
  farmed: boolean
}

const EMPTY_REWARD: LineReward = {
  coins: 0,
  breakdown: [],
  stars: 1,
  newAchievements: [],
  levelUp: null,
  dailyGoalJustMet: false,
  lineMastered: false,
  farmed: false,
}

/** Last applied line result, so a double-submitted completion returns the same reward. */
let lastLine: { key: string; reward: LineReward } | null = null

/** Recently applied engine games by `${profileId}|${gameId}` (double-submit protection). */
const engineGames = new Map<string, Plain<EngineGameOutcome>>()
const ENGINE_GAMES_REMEMBERED = 50

export interface SimpleResult {
  ok: boolean
  error?: OpError | string
  message?: string
}

export const actions = {
  // --- players ---------------------------------------------------------
  /** Pick a player. Also locks the parent zone (a kid is using the iPad now). */
  selectProfile(profileId: string): void {
    actions.lockParent()
    commit(ops.selectProfile(getAppData(), profileId, Date.now()))
  },
  signOut(): void {
    actions.lockParent()
    commit(ops.selectProfile(getAppData(), null, Date.now()))
  },
  /** Daily rollover for every player (runs at start, on focus and every minute). */
  refreshDaily(): void {
    const now = Date.now()
    commit(ops.trackClock(ops.rolloverAll(getAppData(), now), now))
  },

  // --- training --------------------------------------------------------
  /**
   * Record a completed line for the active player and return the reward to show.
   * Capture `input.now` ONCE when the line completes: a repeat call with the
   * same line + now returns the same reward and changes nothing.
   */
  applyLineResult(input: LineResultInputX, rep?: Repertoire | null): LineReward {
    const d = getAppData()
    const id = d.activeProfileId
    if (!id || !input || !input.line) return EMPTY_REWARD
    const key = `${id}|${input.line.id}|${input.now}`
    if (lastLine && lastLine.key === key) return lastLine.reward
    const res = ops.applyLineResult(d, id, input, rep)
    const reward: LineReward = { ...res.reward, farmed: res.farmed }
    if (!res.ok || res.duplicate) return reward
    commit(res.data)
    lastLine = { key, reward }
    return reward
  },
  /**
   * Reward a finished game vs the computer (max 3 rewarded games per day).
   * Pass a `gameId` that is unique per game (e.g. the game's start time): a
   * second call with the same id returns the first outcome and pays nothing.
   */
  applyEngineGame(result: EngineResult, rating: number, gameId?: string | number): Plain<EngineGameOutcome> {
    const d = getAppData()
    if (!d.activeProfileId) return { ...noProfile(), coins: 0, capped: false, newAchievements: [], levelUp: null }
    const key = gameId !== undefined && gameId !== null && gameId !== '' ? `${d.activeProfileId}|${String(gameId)}` : null
    if (key !== null) {
      const seen = engineGames.get(key)
      if (seen) return seen
    }
    const out = run(ops.applyEngineGame(d, d.activeProfileId, result, rating, Date.now()))
    if (key !== null && out.ok) {
      engineGames.set(key, out)
      if (engineGames.size > ENGINE_GAMES_REMEMBERED) engineGames.delete(engineGames.keys().next().value as string)
    }
    return out
  },
  setSetting<K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]): SimpleResult {
    const d = getAppData()
    if (!d.activeProfileId) return noProfile()
    return run(ops.setProfileSetting(d, d.activeProfileId, key, value))
  },
  setInOrderIndex(key: string, idx: number): SimpleResult {
    const d = getAppData()
    if (!d.activeProfileId) return noProfile()
    return run(ops.setInOrderIndex(d, d.activeProfileId, key, idx))
  },

  // --- shop ------------------------------------------------------------
  buyItem(itemId: string): Plain<ShopResult> {
    const d = getAppData()
    if (!d.activeProfileId) return noProfileShop()
    return run(ops.buyItem(d, d.activeProfileId, itemId, Date.now()))
  },
  equipItem(itemId: string): SimpleResult {
    const d = getAppData()
    if (!d.activeProfileId) return noProfile()
    return run(ops.equipItem(d, d.activeProfileId, itemId))
  },
  /**
   * Ask a parent for a real reward: coins are deducted now, refunded if declined.
   * A double tap (same reward again within 10 s) returns ok with `duplicate: true` and charges nothing.
   */
  requestRedemption(rewardId: string): SimpleResult & { duplicate?: boolean } {
    const d = getAppData()
    if (!d.activeProfileId) return noProfile()
    const { redemption: _r, ...rest } = run(ops.requestRedemption(d, d.activeProfileId, rewardId, Date.now()))
    return rest
  },

  // --- parent: requests & coins ---------------------------------------
  resolveRedemption(profileId: string, redemptionId: string, approve: boolean): Plain<ShopResult> {
    touchParent()
    return run(ops.resolveRedemption(getAppData(), profileId, redemptionId, approve, Date.now()))
  },
  /** "Undo" a few seconds after approving: the request waits again. */
  unresolveRedemption(profileId: string, redemptionId: string): SimpleResult {
    touchParent()
    return run(ops.unresolveRedemption(getAppData(), profileId, redemptionId, Date.now()))
  },
  /** Gift (+) or remove (−). `countsTowardLevel` defaults to true for gifts (false = e.g. giving back removed coins). */
  adjustCoins(profileId: string, delta: number, note: string, countsTowardLevel?: boolean): Plain<ShopResult> {
    touchParent()
    return run(ops.adjustCoins(getAppData(), profileId, delta, note, Date.now(), countsTowardLevel ?? delta > 0))
  },
  /** "Undo" right after a gift: coins and the XP it added go back. */
  undoGift(profileId: string, amount: number): SimpleResult {
    touchParent()
    return run(ops.undoGift(getAppData(), profileId, amount, Date.now()))
  },

  // --- parent: PIN -----------------------------------------------------
  hasPin(): boolean {
    return getAppData().parent.pin !== null
  },
  /**
   * Check the parent PIN; success opens a 2-minute sliding parent session
   * (extended by every parent action). After 5 wrong tries, further tries are
   * refused for a while. The Parent screen should ALWAYS show the PIN pad on
   * mount and call lockParent() on unmount; isParentUnlocked() is for gating
   * inside a mounted Parent screen (e.g. changing the PIN).
   */
  verifyPin(pin: string): boolean {
    const t = Date.now()
    const lock = readLock(PINLOCK_KEY, PIN_LOCK_MAX_MS)
    if (t < lock.lockedUntil) return false
    const stored = getAppData().parent.pin
    const ok = ops.pinMatches(stored, pin) && stored !== null
    if (ok) {
      writeLock(PINLOCK_KEY, { fails: 0, lockedUntil: 0 })
      parentUnlockedUntil = t + PARENT_SESSION_MS
    } else {
      // The count survives a reload, so the wait keeps growing across launches.
      const fails = lock.fails + 1
      const lockedUntil = fails >= PIN_FREE_TRIES ? t + Math.min(PIN_LOCK_MAX_MS, 30_000 * 2 ** (fails - PIN_FREE_TRIES)) : lock.lockedUntil
      writeLock(PINLOCK_KEY, { fails, lockedUntil })
    }
    return ok
  },
  /** Milliseconds until PIN entry is allowed again (0 = now). */
  pinLockoutMs(): number {
    return Math.max(0, readLock(PINLOCK_KEY, PIN_LOCK_MAX_MS).lockedUntil - Date.now())
  },
  /** Milliseconds until the grown-up question may be answered again (0 = now). */
  adultCheckLockoutMs(): number {
    return Math.max(0, readLock(ADULTCHECK_KEY, ADULT_LOCK_MAX_MS).lockedUntil - Date.now())
  },
  /** Record a grown-up-question answer: after 2 wrong ones, a 30 s wait that doubles each time (max 10 min). */
  adultCheckAnswered(correct: boolean): void {
    if (correct) {
      writeLock(ADULTCHECK_KEY, { fails: 0, lockedUntil: 0 })
      return
    }
    const t = Date.now()
    const lock = readLock(ADULTCHECK_KEY, ADULT_LOCK_MAX_MS)
    const fails = lock.fails + 1
    const lockedUntil =
      fails >= ADULT_FREE_TRIES ? t + Math.min(ADULT_LOCK_MAX_MS, 30_000 * 2 ** (fails - ADULT_FREE_TRIES)) : lock.lockedUntil
    writeLock(ADULTCHECK_KEY, { fails, lockedUntil })
  },
  isParentUnlocked(): boolean {
    return Date.now() < parentUnlockedUntil
  },
  lockParent(): void {
    parentUnlockedUntil = 0
  },
  /**
   * Set the 4-digit PIN. Changing an existing PIN needs either a recent
   * successful verifyPin() (parent session open) or `currentPin`.
   */
  setPin(pin: string, currentPin?: string): SimpleResult {
    const d = getAppData()
    if (d.parent.pin !== null && !actions.isParentUnlocked() && !(currentPin !== undefined && ops.pinMatches(d.parent.pin, currentPin))) {
      return { ok: false, error: 'invalid', message: 'Enter the current PIN first.' }
    }
    const r = run(ops.setPin(d, pin))
    if (r.ok) parentUnlockedUntil = Date.now() + PARENT_SESSION_MS
    return r
  },
  /** True when a recovery code was set up on this device. */
  hasRecoveryCode(): boolean {
    return !!getAppData().parent.recoveryHash
  },
  /** Store (the hash of) a new recovery code; needs the parent session (or no PIN yet). */
  setRecoveryCode(code: string): SimpleResult {
    const d = getAppData()
    if (d.parent.pin !== null && !actions.isParentUnlocked()) return { ok: false, error: 'invalid', message: 'Enter the PIN first.' }
    if (ops.cleanRecoveryCode(code).length < 8) return { ok: false, error: 'invalid' }
    touchParent()
    const r = run(ops.setRecoveryHash(d, ops.hashRecoveryCode(code)))
    flushSave()
    return r
  },
  checkRecoveryCode(code: string): boolean {
    return ops.recoveryCodeMatches(getAppData().parent, code)
  },
  /** "Forgot the PIN?" with the recovery code: set a new PIN right away. */
  resetPinWithCode(code: string, pin: string): SimpleResult {
    if (!ops.recoveryCodeMatches(getAppData().parent, code)) return { ok: false, error: 'invalid', message: "That recovery code isn't right." }
    return finishPinReset(pin, false)
  },
  /**
   * "Forgot the PIN?" without the recovery code: the first call starts a 24-hour
   * wait (shown to whoever opens the parent zone with the PIN, who can cancel it).
   */
  requestPinReset(): SimpleResult & { readyAt: number | null } {
    const r = run(ops.requestPinReset(getAppData(), Date.now()))
    flushSave()
    return { ...r, readyAt: ops.pinResetReadyAt(getAppData().parent) }
  },
  cancelPinResetRequest(): SimpleResult {
    touchParent()
    return run(ops.cancelPinResetRequest(getAppData()))
  },
  /** After the 24-hour wait: set the new PIN (approvals and gifts then pause for a day). */
  resetPinAfterWait(pin: string): SimpleResult {
    const ready = ops.pinResetReadyAt(getAppData().parent)
    if (ready === null || Date.now() < ready) return { ok: false, error: 'invalid', message: 'The new PIN can only be set when the wait is over.' }
    return finishPinReset(pin, true)
  },
  /** "That was me": hide the PIN-reset notices. */
  ackPinReset(): SimpleResult {
    touchParent()
    return run(ops.ackPinReset(getAppData(), Date.now()))
  },
  clearClockJumps(): void {
    touchParent()
    commit(ops.clearClockJumps(getAppData()))
  },

  // --- parent: rewards & training settings ----------------------------
  setReward(reward: RewardDef): SimpleResult {
    touchParent()
    return run(ops.setReward(getAppData(), reward))
  },
  addReward(reward: Omit<RewardDef, 'id'> & { id?: string }): SimpleResult & { id?: string } {
    touchParent()
    return run(ops.addReward(getAppData(), reward))
  },
  removeReward(rewardId: string): SimpleResult {
    touchParent()
    return run(ops.removeReward(getAppData(), rewardId))
  },
  /** Changing the line length re-ids lines that get cut differently (their progress starts over; the old length brings it back). The Training tab shows how many before asking. */
  setMaxPly(openingId: string, ply: number): SimpleResult {
    touchParent()
    return run(ops.setMaxPly(getAppData(), openingId, ply))
  },
  toggleExtra(chapterId: string, on?: boolean): SimpleResult {
    touchParent()
    return run(ops.toggleExtra(getAppData(), chapterId, on))
  },
  setDailyGoal(lines: number): SimpleResult {
    touchParent()
    return run(ops.setDailyGoal(getAppData(), lines))
  },

  // --- parent: profiles ------------------------------------------------
  renameProfile(profileId: string, name: string): SimpleResult {
    touchParent()
    return run(ops.renameProfile(getAppData(), profileId, name))
  },
  setAvatar(profileId: string, emoji: string): SimpleResult {
    touchParent()
    return run(ops.setAvatar(getAppData(), profileId, emoji))
  },
  resetProfile(profileId: string): SimpleResult {
    touchParent()
    lastLine = null
    storeEpoch++
    return run(ops.resetProfile(getAppData(), profileId, Date.now()))
  },

  // --- parent: study data & backup ------------------------------------
  importStudyPgn(text: string, name: string): SimpleResult {
    touchParent()
    const r = ops.importStudyPgn(getAppData(), text, name, Date.now())
    if (r.ok) commit(r.data, true)
    return { ok: r.ok, error: r.error, message: r.message }
  },
  clearStudyOverride(): void {
    touchParent()
    commit(ops.clearStudyOverride(getAppData()), true)
  },
  /** Backup JSON of the live data. Never contains the parent PIN. */
  exportBackup(): string {
    flushSave()
    return exportBackupJson(getAppData())
  },
  /**
   * Validate first; applies all-or-nothing. Keeps the current PIN (backups have none). Ends a
   * paused-saving state. The data as it was is kept aside first, for undoRestore().
   */
  importBackup(json: string): { ok: boolean; error?: string } {
    touchParent()
    getAppData() // make sure the live store is registered
    if (parseBackup(json).ok && !getLoadIssue()) {
      flushSave()
      // Best effort (a quota problem just means no undo).
      if (!auxSet(BEFORE_RESTORE_KEY, exportBackupJson(getAppData()))) auxRemove(BEFORE_RESTORE_KEY)
    }
    return importBackupJson(json)
  },
  /** A copy from before the last restore exists ("Undo restore"). */
  hasRestoreUndo(): boolean {
    return auxGet(BEFORE_RESTORE_KEY) !== null
  },
  /** Put back the data from just before the last backup restore. */
  undoRestore(): { ok: boolean; error?: string } {
    touchParent()
    const text = auxGet(BEFORE_RESTORE_KEY)
    if (!text) return { ok: false, error: 'Nothing to undo.' }
    getAppData()
    const r = importBackupJson(text)
    if (r.ok) auxRemove(BEFORE_RESTORE_KEY)
    return r
  },
  forgetRestoreUndo(): void {
    auxRemove(BEFORE_RESTORE_KEY)
  },
  /**
   * "Start fresh" after the saved data couldn't be read (useStorageStatus().loadIssue):
   * keeps the unreadable data as a rescue copy in storage, then saves the current
   * data over it. For 'newer-version' issues, prefer telling the parent to reload the app.
   */
  dismissLoadIssue(): SimpleResult {
    touchParent()
    if (!clearLoadIssue()) return { ok: true }
    scheduleSave(getAppData())
    const saved = flushSave()
    notify()
    return saved ? { ok: true } : { ok: false, error: 'invalid', message: getLastSaveError() ?? 'Saving failed.' }
  },
}

/** Shared end of both "Forgot the PIN?" paths. */
function finishPinReset(pin: string, fallback: boolean): SimpleResult {
  if (getStorageStatus().loadIssue) {
    return { ok: false, error: 'invalid', message: "The saved data can't be read right now, so the PIN can't be changed." }
  }
  const r = run(ops.resetPin(getAppData(), pin, Date.now(), { fallback }))
  if (r.ok) {
    flushSave()
    writeLock(PINLOCK_KEY, { fails: 0, lockedUntil: 0 })
    writeLock(ADULTCHECK_KEY, { fails: 0, lockedUntil: 0 })
    parentUnlockedUntil = Date.now() + PARENT_SESSION_MS
  }
  return r
}

export type Actions = typeof actions
