// Robot strength bands, the reward preview, and the per-player "last used"
// settings for the Play screen. Settings live in their own localStorage key
// ('opening-quest.play'), never in AppData.

export const MIN_RATING = 400
export const MAX_RATING = 2000
export const RATING_STEP = 100
export const DEFAULT_RATING = 800

export interface StrengthBand {
  id: 'beginner' | 'club' | 'strong' | 'expert' | 'master'
  emoji: string
  name: string
  /** Lowest rating in the band (inclusive). */
  min: number
  /** Highest rating in the band (inclusive). */
  max: number
  blurb: string
}

export const STRENGTH_BANDS: StrengthBand[] = [
  { id: 'beginner', emoji: '🐣', name: 'Beginner', min: 400, max: 700, blurb: 'Still learning — makes silly mistakes' },
  { id: 'club', emoji: '🙂', name: 'Club', min: 800, max: 1100, blurb: 'Knows the rules and a few tricks' },
  { id: 'strong', emoji: '💪', name: 'Strong', min: 1200, max: 1500, blurb: 'Spots hanging pieces fast' },
  { id: 'expert', emoji: '🔥', name: 'Expert', min: 1600, max: 1800, blurb: 'A really tough opponent' },
  { id: 'master', emoji: '🤖', name: 'Master', min: 1900, max: 2000, blurb: 'Full robot power — good luck!' },
]

export function clampRating(r: unknown): number {
  const n = typeof r === 'number' && Number.isFinite(r) ? r : DEFAULT_RATING
  const stepped = Math.round(n / RATING_STEP) * RATING_STEP
  return Math.max(MIN_RATING, Math.min(MAX_RATING, stepped))
}

export function bandFor(rating: number): StrengthBand {
  const r = clampRating(rating)
  return STRENGTH_BANDS.find((b) => r >= b.min && r <= b.max) ?? STRENGTH_BANDS[STRENGTH_BANDS.length - 1]
}

/** Coins for a win at this rating (mirrors store/rewards.engineGameCoins). */
export function winCoins(rating: number): number {
  return 10 + (rating >= 1200 ? 10 : 0) + (rating >= 1600 ? 10 : 0)
}

/**
 * Stockfish at its weakest (Skill 1, depth 5) is still far too strong for a
 * true beginner, so below 800 the robot sometimes plays a random legal move:
 * 400 -> 50 % of moves, 600 -> 25 %, 700 -> 12.5 %, 800+ -> never.
 */
export function randomMoveChance(rating: number): number {
  const r = clampRating(rating)
  return r < 800 ? (800 - r) / 800 : 0
}

// ---------------------------------------------------------------------------
// Per-player settings (localStorage, best effort)
// ---------------------------------------------------------------------------

export type ColorChoice = 'white' | 'black' | 'random'

export interface PlayPrefs {
  rating: number
  color: ColorChoice
}

export const PLAY_PREFS_KEY = 'opening-quest.play'

type PrefsFile = Record<string, Partial<PlayPrefs>>

function readFile(): PrefsFile {
  try {
    const raw = window.localStorage.getItem(PLAY_PREFS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PrefsFile) : {}
  } catch {
    return {}
  }
}

export function loadPlayPrefs(profileId: string | null | undefined): PlayPrefs {
  const p = profileId ? readFile()[profileId] : undefined
  const color = p?.color === 'white' || p?.color === 'black' || p?.color === 'random' ? p.color : 'white'
  return { rating: clampRating(p?.rating), color }
}

export function savePlayPrefs(profileId: string | null | undefined, prefs: PlayPrefs): void {
  if (!profileId) return
  try {
    const file = readFile()
    file[profileId] = { rating: clampRating(prefs.rating), color: prefs.color }
    window.localStorage.setItem(PLAY_PREFS_KEY, JSON.stringify(file))
  } catch {
    /* private mode / quota: settings just aren't remembered */
  }
}
