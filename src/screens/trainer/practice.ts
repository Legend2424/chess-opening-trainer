// Small pure helpers for the practice-structure UI (docs/practice-structure.md §5):
// clock text, medal and tier labels, the next-medal line, chapter tokens. No React.
import type { Line, LineStats, LineTier } from '../../types.ts'
import { TIER_META, TIER_ORDER, tierCounts } from '../../chess/lineTiers.ts'
import { medalProgress, ROUND_BONUSES_PER_DAY } from '../../store/mastery.ts'

/** "0:41", "4:12", "12:05", "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const MEDAL_EMOJI = ['', '🥉', '🥈', '🥇'] as const
export const MEDAL_NAME = ['', 'Bronze', 'Silver', 'Gold'] as const

/** 🥉 / 🥈 / 🥇, or '' for no medal. */
export function medalEmoji(level: number): string {
  return MEDAL_EMOJI[level === 1 || level === 2 || level === 3 ? level : 0]
}

/** "⭐ Main line", "🔑 Key reply", … */
export function tierLabel(tier: LineTier): string {
  const m = TIER_META[tier]
  return `${m.emoji} ${m.name}`
}

/**
 * The line name to show next to its tier chip: '' when the name only repeats the chip
 * ("Main line" beside "⭐ Main line"), so the title doesn't read "Main line ⭐ Main line".
 */
export function lineNameBesideTier(name: string, tier: LineTier | undefined): string {
  const n = name.trim()
  return n && n.toLowerCase() === TIER_META[tier ?? 'deep'].name.toLowerCase() ? '' : name
}

/**
 * What the next medal still needs, e.g. "🥈 in 3 more perfect runs · 2 more days".
 * Gold: "🥇 Gold — you know it cold!". Everything met (paid at the line's next completion):
 * "🥉 comes with your next run!".
 */
export function nextMedalText(s: LineStats | undefined): string {
  const p = medalProgress(s)
  if (!p.next) return '🥇 Gold — you know it cold!'
  const runs = Math.max(0, p.next.perfects - p.perfects)
  const days = Math.max(0, p.next.days - p.days)
  const parts: string[] = []
  if (runs > 0) parts.push(`${runs} more perfect ${runs === 1 ? 'run' : 'runs'}`)
  if (days > 0) parts.push(`${days} more ${days === 1 ? 'day' : 'days'}`)
  const needBox = p.box < p.next.box
  if (parts.length === 0 && !needBox) return `${p.next.emoji} comes with your next run!`
  if (parts.length === 0) return `${p.next.emoji} once this line is mastered ✅`
  return `${p.next.emoji} in ${parts.join(' · ')}${needBox ? ' · and mastered ✅' : ''}`
}

/** "●●○" — round bonuses still to be paid today. */
export function bonusDots(left: number, total: number = ROUND_BONUSES_PER_DAY): string {
  const l = Math.max(0, Math.min(total, Math.floor(left) || 0))
  return '●'.repeat(l) + '○'.repeat(Math.max(0, total - l))
}

/** A chapter title short enough for a token: "Alapin (2.c3)" -> "Alapin", "QGD: White plays 5.Bf4" -> "QGD: 5.Bf4". */
export function shortChapterTitle(title: string): string {
  const t = title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\b(White|Black) plays\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t || title
}

/** Local 'YYYY-MM-DD'. */
export function localDayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The line was completed today (local day). */
export function playedToday(s: LineStats | undefined, now: number): boolean {
  return !!s && Number.isFinite(s.lastPracticed) && s.lastPracticed > 0 && localDayKey(s.lastPracticed) === localDayKey(now)
}

/** "⭐ · 🔑 4 · 🌿 2 · 🅱️ 10" for a chapter's lines (a lone main line shows just ⭐). */
export function tierLine(lines: readonly Line[]): string {
  const c = tierCounts(lines)
  const parts: string[] = []
  for (const t of TIER_ORDER) {
    const n = c[t]
    if (n === 0) continue
    const e = TIER_META[t].emoji
    parts.push(t === 'main' && n === 1 ? e : `${e} ${n}`)
  }
  return parts.join(' · ')
}

/** Per tier, done / total of a lap set (tiers without lines left out). */
export function lapTierRows(ordered: readonly Line[], doneIds: ReadonlySet<string>): Array<{ tier: LineTier; done: number; total: number }> {
  const rows: Array<{ tier: LineTier; done: number; total: number }> = []
  for (const t of TIER_ORDER) {
    const inTier = ordered.filter((l) => (l.tier ?? 'deep') === t)
    if (inTier.length === 0) continue
    rows.push({ tier: t, done: inTier.filter((l) => doneIds.has(l.id)).length, total: inTier.length })
  }
  return rows
}

/** "1 line" / "6 lines". */
export function linesWord(n: number): string {
  return n === 1 ? '1 line' : `${n} lines`
}
