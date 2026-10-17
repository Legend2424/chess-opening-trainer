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
  cancelPendingSave,
  clearLoadIssue,
  exportBackup as exportBackupJson,
  flushSave,
  getLastSaveError,
  getLoadIssue,
  importBackup as importBackupJson,
  loadAppDataDetailed,
  onStorageStatusChange,
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

function init(): AppData {
  if (state === null) {
    // Roll every player's daily goal/streak over right away, so a cold launch
    // on a new day never shows yesterday's goal ring.
    state = ops.rolloverAll(loadAppDataDetailed().data, Date.now())
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
 * still exist, and the current parent PIN when the backup has none (backups
 * never contain the PIN).
 */
function replaceAll(d: AppData): void {
  const cur = getAppData()
  const keepActive = cur.activeProfileId && d.profiles.some((p) => p.id === cur.activeProfileId) ? cur.activeProfileId : null
  const pin = d.parent.pin ?? cur.parent.pin
  lastLine = null
  engineGames.clear()
  const next = ops.rolloverAll({ ...d, activeProfileId: keepActive, parent: { ...d.parent, pin } }, Date.now())
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
let pinFails = 0
let pinLockedUntil = 0
let parentUnlockedUntil = 0

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
    commit(ops.rolloverAll(getAppData(), Date.now()))
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
  adjustCoins(profileId: string, delta: number, note: string): Plain<ShopResult> {
    touchParent()
    return run(ops.adjustCoins(getAppData(), profileId, delta, note, Date.now()))
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
    if (t < pinLockedUntil) return false
    const stored = getAppData().parent.pin
    const ok = ops.pinMatches(stored, pin) && stored !== null
    if (ok) {
      pinFails = 0
      parentUnlockedUntil = t + PARENT_SESSION_MS
    } else {
      pinFails++
      if (pinFails >= PIN_FREE_TRIES) pinLockedUntil = t + Math.min(5 * 60_000, 30_000 * 2 ** (pinFails - PIN_FREE_TRIES))
    }
    return ok
  },
  /** Milliseconds until PIN entry is allowed again (0 = now). */
  pinLockoutMs(): number {
    return Math.max(0, pinLockedUntil - Date.now())
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
  /** Note: changing line length re-ids truncated lines (their progress starts over) — warn the parent. */
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
  /** Validate first; applies all-or-nothing. Keeps the current PIN (backups have none). Ends a paused-saving state. */
  importBackup(json: string): { ok: boolean; error?: string } {
    touchParent()
    getAppData() // make sure the live store is registered
    return importBackupJson(json)
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

export type Actions = typeof actions
