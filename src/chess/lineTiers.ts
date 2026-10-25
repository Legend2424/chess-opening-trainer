// Practice tiers (docs/practice-structure.md §1–2): which lines are the coach's main lines, key
// replies, deeper lines and Plan B, how laps and main-line rounds are ordered, and where a
// branch-start run begins. Pure logic: runs in the browser and under plain node.
//
// Type-only imports: repertoire.ts imports this module at runtime (it classifies every build), so
// nothing here may import repertoire.ts at runtime. The two tiny helpers below are local copies.

import type { Chapter, Line, LineStats, LineTier, MoveNode, Repertoire } from '../types.ts'

/** First 4 FEN fields (same as repertoire.ts positionKey). */
const posKey = (fen: string): string => fen.trim().split(/\s+/).slice(0, 4).join(' ')
/** "12.Nf3" / "12...Nf6" (same as repertoire.ts moveLabel). */
const label = (n: MoveNode): string => (n.color === 'w' ? `${n.moveNumber}.${n.san}` : `${n.moveNumber}...${n.san}`)

export const TIER_ORDER: readonly LineTier[] = ['main', 'key', 'deep', 'planb']

export const TIER_META: Record<LineTier, { emoji: string; name: string; plural: string; hint: string }> = {
  main: { emoji: '⭐', name: 'Main line', plural: 'Main lines', hint: "Your coach's main line" },
  key: { emoji: '🔑', name: 'Key reply', plural: 'Key replies', hint: 'When they try something else early' },
  deep: { emoji: '🌿', name: 'Deeper line', plural: 'Deeper lines', hint: 'They try something else again later' },
  planb: { emoji: '🅱️', name: 'Plan B', plural: 'Plan B lines', hint: "Your coach's second-choice move" },
}

const TIER_RANK: Record<LineTier, number> = { main: 0, key: 1, deep: 2, planb: 3 }

/**
 * Sets tier, deviations, branchPly, parentLineId, ownUserMoves and startPly on every line (§1.1–1.2).
 * `lines` must be in build order (chapter order, then main-line-first DFS within a chapter). Touches
 * nothing else (id, index, name, moves stay as they are) and is idempotent.
 */
export function classifyLines(chapters: Chapter[], lines: Line[], userColor: 'w' | 'b'): void {
  const chapterById = new Map(chapters.map((c) => [c.id, c]))
  const byChapter = new Map<string, Line[]>()
  for (const line of lines) {
    const arr = byChapter.get(line.chapterId)
    if (arr) arr.push(line)
    else byChapter.set(line.chapterId, [line])
  }
  for (const [chapterId, chLines] of byChapter) {
    const roots = chapterById.get(chapterId)?.roots
    chLines.sort((a, b) => a.indexInChapter - b.indexInChapter)
    for (let i = 0; i < chLines.length; i++) {
      const line = chLines[i]
      const moves = line.moves
      // Deviations: a move that is not the tree's first choice at its point.
      let deviations = 0
      let kidDeviation = false
      for (let k = 0; k < moves.length; k++) {
        const siblings = k === 0 ? roots : moves[k - 1].children
        const first = siblings?.[0] ?? moves[k] // unknown chapter: no information, no deviation
        if (first !== moves[k]) {
          deviations++
          if (moves[k].color === userColor) kidDeviation = true
        }
      }
      line.deviations = deviations
      line.tier = deviations === 0 ? 'main' : kidDeviation ? 'planb' : deviations === 1 ? 'key' : 'deep'

      // Parent: the earlier line of the chapter sharing the longest start (first one wins a tie).
      let branchPly = 0
      let parent: Line | null = null
      for (let j = 0; j < i; j++) {
        const o = chLines[j].moves
        let c = 0
        while (c < o.length && c < moves.length && o[c] === moves[c]) c++
        if (parent === null || c > branchPly) {
          parent = chLines[j]
          branchPly = c
        }
      }
      line.branchPly = branchPly
      if (parent) line.parentLineId = parent.id
      else delete line.parentLineId

      let own = 0
      for (let k = branchPly; k < moves.length; k++) if (moves[k].color === userColor) own++
      line.ownUserMoves = own

      // Branch start: the kid's last move before branchPly (one known move to get his bearings).
      let startPly = 0
      if (parent) {
        for (let k = branchPly - 1; k >= 0; k--) {
          if (moves[k].color === userColor) {
            startPly = k
            break
          }
        }
      }
      line.startPly = startPly
    }
    // Guard: a chapter whose main path was dropped (e.g. a duplicate of another chapter's line)
    // still gets a main line, its first one.
    if (chLines.length > 0 && !chLines.some((l) => l.tier === 'main')) {
      const first = chLines[0]
      first.tier = 'main'
      first.startPly = 0
    }
  }
}

/** The line's tier; an unclassified line counts as 'deep'. */
export function tierOf(line: Line): LineTier {
  return line.tier ?? 'deep'
}

export function tierCounts(lines: readonly Line[]): Record<LineTier, number> {
  const out: Record<LineTier, number> = { main: 0, key: 0, deep: 0, planb: 0 }
  for (const l of lines) out[tierOf(l)]++
  return out
}

/**
 * The lines of a lap (§2.3): every line (Plan B only when `includePlanB`), ordered by tier
 * (main, key, deep, Plan B), then by `line.index` (chapter order, then tree order).
 */
export function lapLines(lines: readonly Line[], includePlanB: boolean): Line[] {
  return lines
    .filter((l) => includePlanB || tierOf(l) !== 'planb')
    .sort((a, b) => TIER_RANK[tierOf(a)] - TIER_RANK[tierOf(b)] || a.index - b.index)
}

/**
 * The first line of `ordered` not done and not skipped; then the first skipped one not done (a
 * failed line comes back at the end of the lap); null when every line is done.
 */
export function nextLapLine(ordered: readonly Line[], done: ReadonlySet<string>, skip?: ReadonlySet<string>): Line | null {
  let fallback: Line | null = null
  for (const l of ordered) {
    if (done.has(l.id)) continue
    if (skip && skip.has(l.id)) {
      if (!fallback) fallback = l
      continue
    }
    return l
  }
  return fallback
}

/** The main lines (in `lines` order), shuffled with Fisher-Yates. */
export function mainRoundQueue(lines: readonly Line[], rng: () => number): Line[] {
  const q = lines.filter((l) => tierOf(l) === 'main')
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)))
    const t = q[i]
    q[i] = q[j]
    q[j] = t
  }
  return q
}

/** A parent line at this box or more is "mastered" enough to skip the shared start. */
export const BRANCH_START_PARENT_BOX = 3

/**
 * Where a lap run of `line` starts (§2.5 rules 2–4; rule 1, "the mode is lap", is the caller's):
 * `line.startPly` for a deep or Plan B line whose parent is mastered, except every 3rd completion
 * (completions % 3 === 2), which plays the whole line. Otherwise 0 (move 1).
 */
export function branchStartPly(line: Line, stats: Readonly<Record<string, LineStats>>): number {
  const tier = tierOf(line)
  if (tier !== 'deep' && tier !== 'planb') return 0
  const sp = line.startPly ?? 0
  if (!(sp > 0) || !line.parentLineId) return 0
  const parentBox = stats[line.parentLineId]?.box ?? 0
  if (!(parentBox >= BRANCH_START_PARENT_BOX)) return 0
  const completions = stats[line.id]?.completions ?? 0
  if (completions % 3 === 2) return 0
  return sp
}

/** The chapter's first choice (children[0]) at `node`'s point, when `node` isn't it; else null. */
export function mainAlternative(rep: Repertoire, node: MoveNode): MoveNode | null {
  let siblings: MoveNode[] | undefined
  if (node.parentId) siblings = rep.nodesById.get(node.parentId)?.children
  else siblings = rep.chapters.find((c) => c.id === node.chapterId)?.roots
  const first = siblings?.[0]
  if (!first || first === node || first.id === node.id) return null
  return first
}

export interface MoveConflict {
  fenBefore: string
  moves: Array<{ chapterId: string; chapterTitle: string; label: string }>
}

/**
 * Positions (kid to move) where two chapters' FIRST-CHOICE kid moves differ, usually reached by
 * transposition (§1.5). Only moves that some practice line plays count.
 */
export function findMoveConflicts(rep: Repertoire): MoveConflict[] {
  const userColor: 'w' | 'b' = rep.opening.side === 'white' ? 'w' : 'b'
  type Entry = { fenBefore: string; byChapter: Map<string, Map<string, MoveNode>> }
  const byPos = new Map<string, Entry>()
  const visit = (siblings: MoveNode[]) => {
    for (let i = 0; i < siblings.length; i++) {
      const n = siblings[i]
      if (i === 0 && n.color === userColor && (rep.linesByNode.get(n.id)?.length ?? 0) > 0) {
        const k = posKey(n.fenBefore)
        let e = byPos.get(k)
        if (!e) byPos.set(k, (e = { fenBefore: n.fenBefore, byChapter: new Map() }))
        let m = e.byChapter.get(n.chapterId)
        if (!m) e.byChapter.set(n.chapterId, (m = new Map()))
        if (!m.has(n.san)) m.set(n.san, n)
      }
      visit(n.children)
    }
  }
  for (const ch of rep.chapters) visit(ch.roots)
  const titleOf = new Map(rep.chapters.map((c) => [c.id, c.title]))
  const out: MoveConflict[] = []
  for (const e of byPos.values()) {
    if (e.byChapter.size < 2) continue
    const sans = new Set<string>()
    for (const m of e.byChapter.values()) for (const san of m.keys()) sans.add(san)
    if (sans.size < 2) continue
    const moves: MoveConflict['moves'] = []
    for (const [chapterId, m] of e.byChapter) {
      for (const n of m.values()) moves.push({ chapterId, chapterTitle: titleOf.get(chapterId) ?? chapterId, label: label(n) })
    }
    out.push({ fenBefore: e.fenBefore, moves })
  }
  return out
}

/**
 * Rough minutes to play `lines`: 3.5 s per kid move + 0.8 s per opponent move + 6 s per line,
 * counted from `startPlyOf(line)` (default 0), rounded to whole minutes, at least 1 (0 lines -> 0).
 */
export function estimateMinutes(lines: readonly Line[], userColor: 'w' | 'b', startPlyOf?: (l: Line) => number): number {
  if (lines.length === 0) return 0
  let s = 0
  for (const l of lines) {
    const sp = Math.max(0, Math.min(l.moves.length, Math.floor(startPlyOf?.(l) ?? 0) || 0))
    let kid = 0
    for (let k = sp; k < l.moves.length; k++) if (l.moves[k].color === userColor) kid++
    s += kid * 3.5 + (l.moves.length - sp - kid) * 0.8 + 6
  }
  return Math.max(1, Math.round(s / 60))
}
