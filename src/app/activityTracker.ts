// Books each player's ACTIVE time on the app (shown on Home, Trophies and in
// the Parent zone).
//
// Rule (ActivityClock): every tap, move or key press adds the time since the
// previous one, capped — 1 minute while training/browsing, 2 minutes vs the
// robot (real games need thinking time). Above the cap only the cap counts, so
// an iPad left open on the table stops adding time. Nothing counts while the
// app is hidden/locked, on the "Who's playing?" screen or in the Parent zone.
// Counted time is saved every 30 s and whenever the page hides.

import type { Screen } from '../types.ts'
import { ActivityClock } from '../store/activityClock.ts'
import { actions, getAppData, subscribe } from '../store/appStore.ts'

export const ACTIVE_GAP_CAP_MS = 60_000
export const ACTIVE_GAP_CAP_PLAY_MS = 120_000
const FLUSH_EVERY_MS = 30_000

const clock = new ActivityClock()
/** The player the running clock is counting for. */
let clockProfile: string | null = null
let screen: Screen['name'] = 'profiles'
let installed = false

function capMs(): number {
  return screen === 'play' ? ACTIVE_GAP_CAP_PLAY_MS : ACTIVE_GAP_CAP_MS
}

function shouldCount(): boolean {
  const pid = getAppData().activeProfileId
  return !!pid && screen !== 'profiles' && screen !== 'parent' && document.visibilityState !== 'hidden'
}

function flush(immediate = false): void {
  const ms = clock.take()
  if (ms > 0 && clockProfile) actions.addActiveTime(clockProfile, ms, immediate)
}

/** Start / stop / switch player to match the current state. */
function sync(immediate = false): void {
  const now = Date.now()
  const pid = getAppData().activeProfileId
  if (clock.running && (!shouldCount() || clockProfile !== pid)) {
    clock.stop(now, capMs())
    flush(immediate)
  }
  if (!clock.running && shouldCount()) {
    clock.start(now)
    clockProfile = pid
  }
}

function onActivity(): void {
  if (!shouldCount()) return
  if (!clock.running || clockProfile !== getAppData().activeProfileId) sync()
  clock.tap(Date.now(), capMs())
}

/** Tell the tracker which screen is showing (called by App on every screen change). */
export function setActivityScreen(name: Screen['name']): void {
  if (name === screen) return
  screen = name
  sync()
}

/** Install the listeners once (main.tsx). */
export function installActivityTracker(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const opts: AddEventListenerOptions = { capture: true, passive: true }
  window.addEventListener('pointerdown', onActivity, opts)
  window.addEventListener('pointerup', onActivity, opts)
  window.addEventListener('keydown', onActivity, opts)
  window.addEventListener('wheel', onActivity, opts)
  document.addEventListener('visibilitychange', () => sync(document.visibilityState === 'hidden'))
  window.addEventListener('pagehide', () => {
    clock.stop(Date.now(), capMs())
    flush(true)
  })
  // Player picked / switched / signed out.
  let lastPid = getAppData().activeProfileId
  subscribe(() => {
    const pid = getAppData().activeProfileId
    if (pid !== lastPid) {
      lastPid = pid
      sync()
    }
  })
  window.setInterval(() => flush(), FLUSH_EVERY_MS)
  sync()
}
