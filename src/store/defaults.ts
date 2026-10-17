// Default app data + small date helpers shared by the store. Pure; runs under plain node.

import type { AppData, DailyState, ParentSettings, Profile, RewardDef } from '../types.ts'
import { DEFAULT_MAX_PLY, OPENINGS } from '../data/openings.ts'
import { DEFAULT_EQUIPPED, FREE_ITEM_IDS } from './catalog.ts'

// ---------------------------------------------------------------------------
// Local-date helpers (daily goal / streaks roll over at LOCAL midnight)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Local calendar date 'YYYY-MM-DD' for an epoch-ms timestamp. */
export function localDateKey(ms: number): string {
  const d = new Date(Number.isFinite(ms) ? ms : 0)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function isDateKey(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s)
}

/** Shift a 'YYYY-MM-DD' key by whole local days (DST-safe). '' for invalid keys. */
export function addDaysToKey(key: string, delta: number): string {
  if (!isDateKey(key)) return ''
  const [y, m, d] = key.split('-').map(Number)
  return localDateKey(new Date(y, m - 1, d + delta, 12).getTime())
}

export function previousDateKey(key: string): string {
  return addDaysToKey(key, -1)
}

/**
 * DailyState as stored by this module. `distinctLineIds` is an optional extra
 * (DESIGN.md §3 allows it) so the daily goal counts DISTINCT lines.
 * `lines` always equals distinctLineIds.length.
 */
export type DailyStateX = DailyState & { distinctLineIds?: string[] }

export function emptyDaily(date: string): DailyStateX {
  return {
    date,
    lines: 0,
    perfects: 0,
    coinsEarned: 0,
    goalClaimed: false,
    openingsPracticed: [],
    engineGamesRewarded: 0,
    distinctLineIds: [],
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const HISTORY_CAP = 200
export const DEFAULT_DAILY_GOAL = 5

export const POKEMON_REWARD: RewardDef = {
  id: 'pokemon-pack',
  name: 'Pokémon booster pack',
  emoji: '🎴',
  cost: 1500,
  enabled: true,
  maxPerWeek: 2,
}

export function createDefaultParentSettings(): ParentSettings {
  const maxPly: Record<string, number> = {}
  for (const o of OPENINGS) maxPly[o.id] = DEFAULT_MAX_PLY
  return {
    pin: null,
    rewards: [{ ...POKEMON_REWARD }],
    maxPly,
    enabledExtras: [],
    dailyGoalLines: DEFAULT_DAILY_GOAL,
  }
}

interface ProfileSeed {
  id: string
  name: string
  avatar: string
  color: string
}

export const DEFAULT_PROFILES: readonly ProfileSeed[] = [
  { id: 'david', name: 'David', avatar: '🦉', color: '#3b82f6' },
  { id: 'minka', name: 'Minka', avatar: '🐱', color: '#ec4899' },
]

export function createProfile(seed: ProfileSeed, now: number): Profile {
  return {
    id: seed.id,
    name: seed.name,
    avatar: seed.avatar,
    color: seed.color,
    coins: 0,
    xp: 0,
    lineStats: {},
    inOrderIndex: {},
    owned: [...FREE_ITEM_IDS],
    equipped: { ...DEFAULT_EQUIPPED },
    achievements: {},
    daily: emptyDaily(localDateKey(now)),
    streakDays: 0,
    lastGoalDate: '',
    bestCombo: 0,
    totals: { lines: 0, perfects: 0, mistakesFixed: 0, engineWins: 0, blundersPunished: 0 },
    redemptions: [],
    history: [],
    settings: { sound: true, learnMode: false },
    createdAt: now,
  }
}

/** Seed (id/name/avatar/colour) for a default profile id, if it is one. */
export function defaultSeedFor(id: string): ProfileSeed | undefined {
  return DEFAULT_PROFILES.find((p) => p.id === id)
}

export function createDefaultAppData(now: number = Date.now()): AppData {
  return {
    version: 1,
    profiles: DEFAULT_PROFILES.map((s) => createProfile(s, now)),
    parent: createDefaultParentSettings(),
    activeProfileId: null,
  }
}
