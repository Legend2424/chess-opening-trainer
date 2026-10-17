// Shared contracts for Opening Quest. Every module codes against these types.
// Keep this file free of runtime logic except the small constant ID lists at
// the bottom (they are the single source of truth for catalog/theme IDs).
//
// Node-compat rule: modules under src/chess, src/trainer and src/store/*.ts
// (non-React) are also run directly by `node` in scripts/. So in those files:
//   - use `import type` for type-only imports,
//   - include the `.ts` extension on relative imports,
//   - no enums / namespaces / parameter properties (erasableSyntaxOnly).

export type Color = 'white' | 'black'
export type SideToMove = 'w' | 'b'

// ---------------------------------------------------------------------------
// Study data (parsed from Lichess PGN)
// ---------------------------------------------------------------------------

export type AnnotationColor = 'green' | 'red' | 'blue' | 'yellow'

export interface Arrow {
  from: string // 'e2'
  to: string // 'e4'
  color: AnnotationColor
}

export interface Highlight {
  square: string
  color: AnnotationColor
}

/** One move in a chapter's move tree. */
export interface MoveNode {
  /** Unique within an opening: `${chapterId}:${counter}`. */
  id: string
  chapterId: string
  san: string // 'Nf3', 'O-O', 'exd5' (no !/? suffixes)
  uci: string // 'g1f3', 'e7e8q'
  from: string
  to: string
  promotion?: string // 'q' | 'r' | 'b' | 'n'
  fenBefore: string
  fen: string // position after the move
  ply: number // 1-based: first move from the chapter start = 1
  color: SideToMove // side that MADE this move
  moveNumber: number // full-move number for display ("12" in "12...Nf6")
  /** Coach comment, cleaned of [%cal]/[%csl]/[%clk]/[%eval]/[%anno] commands. */
  comment?: string
  arrows: Arrow[]
  highlights: Highlight[]
  /** Numeric Annotation Glyphs, incl. ones written as suffixes: !=1 ?=2 !!=3 ??=4 !?=5 ?!=6 */
  nags: number[]
  /** children[0] is the main continuation. */
  children: MoveNode[]
  parentId: string | null // null for first moves of a chapter
}

export interface Chapter {
  id: string // Lichess chapter id from [ChapterURL], e.g. 'hF97JQsY'
  title: string // friendly title from OpeningDef (falls back to ChapterName)
  lichessName: string // original [ChapterName]
  url?: string
  startFen: string
  intro?: string // comment before the first move
  introArrows: Arrow[]
  introHighlights: Highlight[]
  roots: MoveNode[] // first moves (roots[0] = main line)
  isExtra: boolean // from OpeningDef.extraChapters
}

/** A root-to-leaf practice path. Always ends with a move by the user's side. */
export interface Line {
  id: string // stable: hash of openingId + chapterId + uci path
  openingId: string
  chapterId: string
  chapterTitle: string
  index: number // order within the opening (chapter order, then main-line-first DFS)
  indexInChapter: number
  /** e.g. "Main line" or "4.c4" / "2...e5 3.Nf3" (where it leaves the chapter main line). */
  name: string
  startFen: string
  moves: MoveNode[]
  userMoveCount: number
  /** true if any opponent move in the line carries ? or ?? (a trap to punish). */
  hasOpponentBlunder: boolean
  /**
   * "This is why!": study moves right after the kid's last move that are shown
   * (auto-played) once the line is complete — the opponent's reply/punishment
   * the study ends with, or a trap demonstration (a ?/?? move by the kid's side
   * and its refutation). Not part of the line's id, never counted as user moves.
   */
  tail?: MoveNode[]
  /** The tail demonstrates a mistake by the kid's side (a trap), not just the opponent's reply. */
  tailIsTrap?: boolean
}

export interface ChapterRef {
  id: string // Lichess chapter id
  title: string
}

export interface OpeningDef {
  id: string // 'sicilian' | 'london' | 'vs-d4'
  name: string
  tagline: string
  side: Color // the side the child plays
  emoji: string
  accent: string // CSS color
  chapters: ChapterRef[] // core chapters, in display order
  extraChapters: ChapterRef[] // optional chapters, off unless enabled by the parent
}

export interface Repertoire {
  opening: OpeningDef
  chapters: Chapter[]
  lines: Line[]
  nodesById: Map<string, MoveNode>
  /** positionKey(fen) -> every study move playable from that position (deduped by uci, main moves first). */
  movesByPosition: Map<string, MoveNode[]>
  /** node id -> lines that pass through that node */
  linesByNode: Map<string, Line[]>
}

// ---------------------------------------------------------------------------
// Profiles, progress, rewards
// ---------------------------------------------------------------------------

export interface LineStats {
  attempts: number // started
  completions: number
  perfects: number // completed with 0 mistakes and 0 hints, not in learn mode
  box: number // Leitner box 0..5 (0 = new / just failed)
  lastPracticed: number // epoch ms
  dueAt: number // epoch ms
  lastMistakes: number
  /**
   * Completions that were learn-mode runs ("Show me the moves", or arrows on
   * about half the moves). The "New line" bonus waits for the first completion
   * that is NOT one of these. Absent = 0.
   */
  learnCompletions?: number
  /** The last completion was a paid learn-mode run: the next normal run is never "farmed". */
  learnPending?: boolean
  /** The one full-pay quick retry after a failed run was used (further quick repeats are "farmed"). */
  quickRetryUsed?: boolean
}

export type ItemKind = 'board' | 'pieces' | 'avatar' | 'trophy' | 'effect' | 'title'

export interface CatalogItem {
  id: string // `${kind}:${refId}`, e.g. 'board:ocean'
  kind: ItemKind
  refId: string // theme / piece-set / effect id, or the emoji/title text key
  name: string
  description: string
  cost: number // 0 = free (owned by default)
  emoji: string // used for icons/previews where no visual preview exists
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  minLevel?: number
}

/** A real-world reward (Pokémon pack etc.). Configured by the parent. */
export interface RewardDef {
  id: string
  name: string
  emoji: string
  cost: number
  enabled: boolean
  maxPerWeek?: number // per profile; undefined = unlimited
}

export interface Redemption {
  id: string
  rewardId: string
  rewardName: string
  emoji: string
  cost: number
  requestedAt: number
  status: 'pending' | 'approved' | 'declined'
  resolvedAt?: number
}

export interface CoinEvent {
  at: number
  delta: number // + earned / - spent
  reason: string
}

export interface DailyState {
  date: string // local 'YYYY-MM-DD'
  lines: number
  perfects: number
  coinsEarned: number
  goalClaimed: boolean
  openingsPracticed: string[]
  engineGamesRewarded: number
}

export interface ProfileSettings {
  sound: boolean
  learnMode: boolean // "Show me the moves" default for new sessions
}

export interface Profile {
  id: string // 'david' | 'minka'
  name: string
  avatar: string // emoji (an owned avatar item's refId)
  color: string // CSS accent
  coins: number // spendable
  xp: number // lifetime coins earned (never decreases) -> level
  lineStats: Record<string, LineStats> // by Line.id
  inOrderIndex: Record<string, number> // `${openingId}` or `${openingId}#${chapterId}` -> next line index
  owned: string[] // CatalogItem ids
  equipped: { board: string; pieces: string; effect: string; title: string } // refIds
  achievements: Record<string, number> // achievement id -> unlocked at (epoch ms)
  daily: DailyState
  streakDays: number // consecutive days the daily goal was met
  lastGoalDate: string // 'YYYY-MM-DD' of the last day the goal was met
  bestCombo: number
  totals: { lines: number; perfects: number; mistakesFixed: number; engineWins: number; blundersPunished: number }
  redemptions: Redemption[]
  history: CoinEvent[] // newest first, capped at 200
  settings: ProfileSettings
  createdAt: number
}

export interface ParentSettings {
  pin: string | null // null until set on first visit
  /** When the PIN was last replaced through "Forgot the PIN?" (legacy single value; see pinResets). */
  pinResetAt?: number
  /**
   * Every "Forgot the PIN?" reset (epoch ms, oldest first, capped at 10). Add-only:
   * a backup import merges these instead of replacing them, so a reset can't be hidden.
   */
  pinResets?: number[]
  /** A reset done with the grown-up question only (no recovery code): approvals and gifts pause for a day after it. */
  pinFallbackResetAt?: number
  /** The parent tapped "That was me" on the PIN-reset notice (hides notices up to this time). */
  pinResetAckAt?: number
  /** SHA-256 (hex) of the parent's recovery code. Never exported in backups. */
  recoveryHash?: string
  /** "Forgot the PIN?" without the recovery code: the reset unlocks 24 h after this request. */
  pinResetRequestedAt?: number
  /** Latest device time seen by the app (to spot the clock being moved). */
  lastSeenAt?: number
  /** Recent big jumps of the device clock (newest last, capped). */
  clockJumps?: Array<{ from: number; to: number }>
  rewards: RewardDef[] // includes the Pokémon pack
  maxPly: Record<string, number> // per opening id; 0 = no limit
  enabledExtras: string[] // extra chapter ids switched on
  dailyGoalLines: number // default 5
}

export interface AppData {
  version: 1
  profiles: Profile[]
  parent: ParentSettings
  activeProfileId: string | null
  /** Optional PGN imported by the parent to replace the bundled study file. */
  studyOverride?: { pgn: string; importedAt: number; name: string }
}

// ---------------------------------------------------------------------------
// Trainer <-> store
// ---------------------------------------------------------------------------

export type TrainerMode = 'random' | 'inorder' | 'chapter'

export interface LineResultInput {
  line: Line
  openingId: string
  mode: TrainerMode
  mistakes: number
  hintsUsed: number
  usedArrowHint: boolean
  learnMode: boolean
  combo: number // consecutive perfect lines in this session INCLUDING this one (0 if not perfect)
  opponentBlunderPunished: boolean
  now: number
}

export interface RewardLine {
  label: string // "Line complete", "Perfect!", "New line", "Combo x3", "Daily goal!"
  coins: number
  emoji: string
}

export interface AchievementDef {
  id: string
  name: string
  description: string
  emoji: string
  coins: number // one-time bonus
  secret?: boolean
}

export interface LevelInfo {
  level: number // 1..
  name: string // 'Pawn', 'Knight', ...
  emoji: string
  minXp: number
  nextXp: number | null // null at max named level
}

export interface Reward {
  coins: number
  breakdown: RewardLine[]
  stars: 1 | 2 | 3
  newAchievements: AchievementDef[]
  levelUp: { from: LevelInfo; to: LevelInfo } | null
  dailyGoalJustMet: boolean
  lineMastered: boolean
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type Screen =
  | { name: 'profiles' }
  | { name: 'home' }
  | { name: 'opening'; openingId: string }
  | { name: 'train'; openingId: string; mode: TrainerMode; chapterId?: string; learnMode: boolean }
  | { name: 'shop'; tab?: ItemKind | 'rewards' }
  | { name: 'trophies' }
  | { name: 'parent' }
  | { name: 'play'; fen?: string; userColor?: Color; openingId?: string }

// ---------------------------------------------------------------------------
// Theme / catalog ID lists (single source of truth)
// ---------------------------------------------------------------------------

/** Board themes. 'green' and 'brown' are free. */
export const BOARD_THEME_IDS = [
  'green', 'brown', 'ocean', 'candy', 'forest', 'ice', 'sunset',
  'marble', 'lava', 'royal-wood', 'galaxy', 'gold', 'rainbow',
] as const
export type BoardThemeId = (typeof BOARD_THEME_IDS)[number]

/** Piece sets. 'cburnett' and 'merida' are free. All but 'emoji' are Lichess SVG sets in public/pieces/<id>/. */
export const PIECE_SET_IDS = [
  'cburnett', 'merida', 'alpha', 'california', 'cardinal', 'staunty',
  'fantasy', 'spatial', 'pixel', 'horsey', 'anarcandy', 'emoji',
] as const
export type PieceSetId = (typeof PIECE_SET_IDS)[number]

/** Celebration effects. 'confetti' is free. */
export const EFFECT_IDS = ['confetti', 'stars', 'fireworks', 'emoji-rain', 'coin-shower', 'rainbow'] as const
export type EffectId = (typeof EFFECT_IDS)[number]
