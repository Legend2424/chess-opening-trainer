// Achievements (DESIGN.md §3). Pure; runs under plain node.
//
// checkAchievements() looks at the profile AFTER an action has been applied and
// returns only the achievements that are newly unlocked (not yet in
// profile.achievements). The caller grants the coins and records them.

import type { AchievementDef, LineResultInput, Profile, Repertoire } from '../types.ts'
import { OPENINGS } from '../data/openings.ts'
import { itemById } from './catalog.ts'
import { isLineMastered } from './rewards.ts'
import { lapOf, medalOf, readiness } from './mastery.ts'

/** LineResultInput plus an optional extra the trainer may pass for "Never give up". */
export type LineResultInputX = LineResultInput & {
  /** Most mistakes made on any single user move of the line (trainer's max mistakesHere). */
  maxMistakesOnOneMove?: number
}

export interface AchievementContext {
  now: number
  /** The line just completed (enables time-of-day / never-give-up checks). */
  line?: LineResultInputX
  /** Repertoire of the opening just practised (enables mastery checks). */
  rep?: Repertoire | null
  /** Optionally every loaded repertoire (mastery checks for all of them). */
  reps?: Repertoire[]
}

interface AchievementRule extends AchievementDef {
  test: (p: Profile, ctx: AchievementContext) => boolean
}

const MASTER_NAMES: Record<string, { name: string; emoji: string }> = {
  sicilian: { name: 'Dragon Tamer', emoji: '🐉' },
  london: { name: 'Big Ben', emoji: '🏰' },
  'vs-d4': { name: 'Gatekeeper', emoji: '🛡️' },
}

/** "Every main line gold" achievement names (docs/practice-structure.md §4.6). */
const GOLD_NAMES: Record<string, string> = {
  sicilian: 'Golden Dragon',
  london: 'Golden Tower',
  'vs-d4': 'Golden Gate',
}

function localHour(ms: number): number {
  return new Date(ms).getHours()
}

export function purchasedItemCount(p: Profile): number {
  let n = 0
  for (const id of p.owned) {
    const item = itemById(id)
    if (item && item.cost > 0) n++
  }
  return n
}

function allReps(ctx: AchievementContext): Repertoire[] {
  const out: Repertoire[] = []
  if (ctx.rep) out.push(ctx.rep)
  for (const r of ctx.reps ?? []) if (r && !out.includes(r)) out.push(r)
  return out
}

/** True if the chapter has at least one line and every one of them is mastered. */
export function isChapterMastered(p: Profile, rep: Repertoire, chapterId: string): boolean {
  const lines = rep.lines.filter((l) => l.chapterId === chapterId)
  return lines.length > 0 && lines.every((l) => isLineMastered(p.lineStats[l.id]))
}

/** True if every line of the opening's CORE chapters is mastered (extras don't count). */
export function isOpeningMastered(p: Profile, rep: Repertoire): boolean {
  const core = new Set(rep.opening.chapters.map((c) => c.id))
  const lines = rep.lines.filter((l) => core.has(l.chapterId))
  return lines.length > 0 && lines.every((l) => isLineMastered(p.lineStats[l.id]))
}

function anyChapterMastered(p: Profile, ctx: AchievementContext): boolean {
  for (const rep of allReps(ctx)) {
    const chapterIds = new Set(rep.lines.map((l) => l.chapterId))
    for (const c of chapterIds) if (isChapterMastered(p, rep, c)) return true
  }
  return false
}

function openingMastered(p: Profile, ctx: AchievementContext, openingId: string): boolean {
  return allReps(ctx).some((rep) => rep.opening.id === openingId && isOpeningMastered(p, rep))
}

/** Lines of the opening's CORE chapters (extras don't count, like isOpeningMastered). */
function coreLines(rep: Repertoire): Repertoire['lines'] {
  const core = new Set(rep.opening.chapters.map((c) => c.id))
  return rep.lines.filter((l) => core.has(l.chapterId))
}

/** True if the opening has main lines and every one of them has a gold medal. */
export function allMainsGold(p: Profile, rep: Repertoire): boolean {
  const mains = coreLines(rep).filter((l) => l.tier === 'main')
  return mains.length > 0 && mains.every((l) => medalOf(p.lineStats[l.id]) === 3)
}

/** Tournament ready (mastery.readiness) over the opening's core lines. */
export function isTournamentReady(p: Profile, rep: Repertoire): boolean {
  return readiness(coreLines(rep), p.lineStats).ready
}

function openingAllGold(p: Profile, ctx: AchievementContext, openingId: string): boolean {
  return allReps(ctx).some((rep) => rep.opening.id === openingId && allMainsGold(p, rep))
}

function openingReady(p: Profile, ctx: AchievementContext, openingId: string): boolean {
  return allReps(ctx).some((rep) => rep.opening.id === openingId && isTournamentReady(p, rep))
}

/** Highest lap number reached in any opening (3 laps finished = lap 4). */
function maxLapNumber(p: Profile): number {
  let n = 1
  for (const id of Object.keys(p.laps ?? {})) n = Math.max(n, lapOf(p, id).n)
  return n
}

function count(id: string, name: string, emoji: string, coins: number, description: string, test: (p: Profile) => boolean): AchievementRule {
  return { id, name, emoji, coins, description, test: (p) => test(p) }
}

const RULES: AchievementRule[] = [
  // Lines & perfects
  count('first-line', 'First Steps', '👣', 20, 'Finish your very first line.', (p) => p.totals.lines >= 1),
  count('first-perfect', 'Flawless!', '⭐', 25, 'Finish a line with no mistakes and no hints.', (p) => p.totals.perfects >= 1),
  count('perfect-10', 'Sharp Shooter', '🎯', 50, 'Play 10 perfect lines.', (p) => p.totals.perfects >= 10),
  count('perfect-50', 'Precision Pro', '💫', 100, 'Play 50 perfect lines.', (p) => p.totals.perfects >= 50),
  count('perfect-100', 'Perfectionist', '🌟', 200, 'Play 100 perfect lines.', (p) => p.totals.perfects >= 100),
  count('lines-10', 'Getting Going', '📗', 30, 'Finish 10 lines.', (p) => p.totals.lines >= 10),
  count('lines-50', 'Bookworm', '📚', 75, 'Finish 50 lines.', (p) => p.totals.lines >= 50),
  count('lines-200', 'Opening Scholar', '🎓', 150, 'Finish 200 lines.', (p) => p.totals.lines >= 200),
  count('lines-500', 'Opening Encyclopedia', '🏛️', 200, 'Finish 500 lines.', (p) => p.totals.lines >= 500),
  // Combos & streaks
  count('combo-5', 'On Fire', '🔥', 50, 'Get a combo of 5 perfect lines in a row.', (p) => p.bestCombo >= 5),
  count('combo-10', 'Unstoppable', '☄️', 100, 'Get a combo of 10 perfect lines in a row.', (p) => p.bestCombo >= 10),
  count('daily-goal', 'Goal Getter', '🥅', 20, 'Reach your daily goal for the first time.', (p) => p.lastGoalDate !== ''),
  count('streak-3', 'Three in a Row', '📅', 40, 'Reach your daily goal 3 days in a row.', (p) => p.streakDays >= 3),
  count('streak-7', 'Week Warrior', '🗓️', 100, 'Reach your daily goal 7 days in a row.', (p) => p.streakDays >= 7),
  count('streak-30', 'Monthly Master', '🏅', 200, 'Reach your daily goal 30 days in a row.', (p) => p.streakDays >= 30),
  count('punish-blunder', 'Punisher', '⚔️', 30, "Punish your opponent's blunder in a perfect line.", (p) => p.totals.blundersPunished >= 1),
  // Mastery (needs the repertoire)
  {
    id: 'master-chapter',
    name: 'Chapter Champion',
    emoji: '📖',
    coins: 75,
    description: 'Master every line of a chapter.',
    test: anyChapterMastered,
  },
  ...OPENINGS.map<AchievementRule>((o) => {
    const meta = MASTER_NAMES[o.id] ?? { name: `${o.name} Master`, emoji: o.emoji }
    return {
      id: `master-${o.id}`,
      name: meta.name,
      emoji: meta.emoji,
      coins: 200,
      description: `Master every line of the ${o.name}.`,
      test: (p, ctx) => openingMastered(p, ctx, o.id),
    }
  }),
  // Practice structure: main-line rounds, medals, tournament ready, laps
  count('round-1', 'Warmed Up', '🏃', 20, 'Finish a Main Lines round.', (p) => (p.totals.rounds ?? 0) >= 1),
  count(
    'clean-round',
    'Clean Sweep',
    '🧹',
    50,
    'Finish a Main Lines round with every line perfect on the first try.',
    (p) => (p.totals.cleanRounds ?? 0) >= 1,
  ),
  ...OPENINGS.map<AchievementRule>((o) => ({
    id: `gold-${o.id}`,
    name: GOLD_NAMES[o.id] ?? `Golden ${o.name}`,
    emoji: '🥇',
    coins: 100,
    description: `Win a gold medal on every main line of the ${o.name}.`,
    test: (p, ctx) => openingAllGold(p, ctx, o.id),
  })),
  ...OPENINGS.map<AchievementRule>((o) => ({
    id: `ready-${o.id}`,
    name: 'Tournament Ready',
    emoji: '🏆',
    coins: 200,
    description: `Get Tournament Ready in the ${o.name}: every main line gold and every key reply mastered.`,
    test: (p, ctx) => openingReady(p, ctx, o.id),
  })),
  count('lap-1', 'Tree Climber', '🌳', 75, 'Finish a lap: play every line of an opening.', (p) => (p.totals.laps ?? 0) >= 1),
  count('lap-3', 'Evergreen', '🌲', 150, 'Finish 3 laps of one opening.', (p) => maxLapNumber(p) >= 4),
  // Daily / time of day / grit
  {
    id: 'triple-threat',
    name: 'Triple Threat',
    emoji: '🔱',
    coins: 50,
    description: 'Practise all three openings in one day.',
    test: (p) => OPENINGS.every((o) => p.daily.openingsPracticed.includes(o.id)),
  },
  {
    id: 'early-bird',
    name: 'Early Bird',
    emoji: '🐦',
    coins: 25,
    description: 'Finish a line before 8 in the morning.',
    secret: true,
    test: (_p, ctx) => !!ctx.line && localHour(ctx.line.now) < 8,
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    emoji: '🦉',
    coins: 25,
    description: 'Finish a line after 8 in the evening.',
    secret: true,
    test: (_p, ctx) => !!ctx.line && localHour(ctx.line.now) >= 20,
  },
  {
    id: 'never-give-up',
    name: 'Never Give Up',
    emoji: '💪',
    coins: 30,
    description: 'Finish a line after 3 or more tries on one move.',
    test: (_p, ctx) => !!ctx.line && (ctx.line.maxMistakesOnOneMove ?? ctx.line.mistakes) >= 3,
  },
  // Shop & rewards
  count('first-purchase', 'Shopper', '🛍️', 20, 'Buy something in the shop.', (p) => purchasedItemCount(p) >= 1),
  count('collector', 'Collector', '🧺', 100, 'Buy 10 things in the shop.', (p) => purchasedItemCount(p) >= 10),
  count('first-reward', 'Treat Time', '🎁', 50, 'Get your first real reward.', (p) => p.redemptions.some((r) => r.status === 'approved')),
  // Computer
  count('beat-computer', 'Robot Beater', '🤖', 50, 'Beat the computer.', (p) => p.totals.engineWins >= 1),
]

export const ACHIEVEMENTS: AchievementDef[] = RULES.map(({ test: _test, ...def }) => def)

const DEF_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]))

/** Newly unlocked achievements (never ones already in profile.achievements). */
export function checkAchievements(profile: Profile, ctx: AchievementContext): AchievementDef[] {
  const out: AchievementDef[] = []
  for (const rule of RULES) {
    if (profile.achievements[rule.id] !== undefined) continue
    let hit = false
    try {
      hit = rule.test(profile, ctx)
    } catch {
      hit = false
    }
    if (hit) out.push(DEF_BY_ID.get(rule.id)!)
  }
  return out
}
