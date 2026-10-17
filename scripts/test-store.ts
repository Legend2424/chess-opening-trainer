// Store tests — run with: node scripts/test-store.ts
// Plain node + node:assert. Builds fake Line/Repertoire objects (no PGN parser needed).

import assert from 'node:assert/strict'
import type { AppData, Line, LineStats, ParentSettings, Profile, Repertoire } from '../src/types.ts'
import { BOARD_THEME_IDS, EFFECT_IDS, PIECE_SET_IDS } from '../src/types.ts'
import { OPENINGS } from '../src/data/openings.ts'
import { CATALOG, FREE_ITEM_IDS, itemById } from '../src/store/catalog.ts'
import { levelForXp, levelProgress } from '../src/store/levels.ts'
import { addDaysToKey, createDefaultAppData, localDateKey } from '../src/store/defaults.ts'
import type { DailyStateX } from '../src/store/defaults.ts'
import { computeLineReward, currentStreak, engineGameCoins, nextLineStats, starsFor } from '../src/store/rewards.ts'
import { ACHIEVEMENTS, checkAchievements } from '../src/store/achievements.ts'
import type { LineResultInputX } from '../src/store/achievements.ts'
import * as ops from '../src/store/profileOps.ts'
import * as storage from '../src/store/storage.ts'
import type { KeyValueStorage } from '../src/store/storage.ts'

// ---------------------------------------------------------------------------
// Tiny runner
// ---------------------------------------------------------------------------

let passed = 0
const failures: string[] = []
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    passed++
  } catch (e) {
    failures.push(name)
    console.error(`✗ ${name}\n   ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** Local time (so tests pass in any timezone). */
const T = (y: number, mo: number, d: number, h = 12, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = T(2026, 10, 14, 12, 0) // Wed 14 Oct 2026, noon local

function fakeLine(id: string, userMoveCount = 6, chapterId = 'hF97JQsY', openingId = 'sicilian'): Line {
  return {
    id,
    openingId,
    chapterId,
    chapterTitle: 'Open Sicilian',
    index: 0,
    indexInChapter: 0,
    name: 'Main line',
    startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: [],
    userMoveCount,
    hasOpponentBlunder: false,
  }
}

function input(line: Line, o: Partial<LineResultInputX> = {}): LineResultInputX {
  return {
    line,
    openingId: line.openingId,
    mode: 'random',
    mistakes: 0,
    hintsUsed: 0,
    usedArrowHint: false,
    learnMode: false,
    combo: 0,
    opponentBlunderPunished: false,
    now: NOW,
    ...o,
  }
}

function fakeRep(openingId: string, lines: Line[]): Repertoire {
  const opening = OPENINGS.find((o) => o.id === openingId)!
  return { opening, chapters: [], lines, nodesById: new Map(), movesByPosition: new Map(), linesByNode: new Map() }
}

function stats(o: Partial<LineStats>): LineStats {
  return { attempts: 1, completions: 1, perfects: 1, box: 1, lastPracticed: NOW - 2 * DAY, dueAt: NOW - DAY, lastMistakes: 0, ...o }
}

function fresh(now = NOW): AppData {
  return createDefaultAppData(now)
}

function prof(data: AppData, id = 'david'): Profile {
  return data.profiles.find((p) => p.id === id)!
}

function patchProfile(data: AppData, id: string, patch: Partial<Profile>): AppData {
  return ops.withProfile(data, { ...prof(data, id), ...patch })
}

/** A minimal study PGN with one of the coach's chapters (Open Sicilian). */
const STUDY_V2 = '[Event "x"]\n[ChapterURL "https://lichess.org/study/CZiXOjIp/hF97JQsY"]\n\n1. e4 *'

function sum(b: { coins: number }[]): number {
  return b.reduce((s, x) => s + x.coins, 0)
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as object)) deepFreeze(v)
  }
  return o
}

class MemStorage implements KeyValueStorage {
  map = new Map<string, string>()
  failWrites = false
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
}

// ---------------------------------------------------------------------------
// Catalog, levels, defaults
// ---------------------------------------------------------------------------

await test('catalog: every theme/piece/effect id has exactly one item; ids unique', () => {
  const ids = CATALOG.map((i) => i.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const b of BOARD_THEME_IDS) assert.ok(itemById(`board:${b}`), b)
  for (const p of PIECE_SET_IDS) assert.ok(itemById(`pieces:${p}`), p)
  for (const e of EFFECT_IDS) assert.ok(itemById(`effect:${e}`), e)
  for (const i of CATALOG) assert.equal(i.id, `${i.kind}:${i.refId}`)
})

await test('catalog: prices and level locks match DESIGN §5', () => {
  const price = (id: string) => itemById(id)!.cost
  assert.equal(price('board:green'), 0)
  assert.equal(price('board:ocean'), 150)
  assert.equal(price('board:rainbow'), 2000)
  assert.equal(itemById('board:gold')!.minLevel, 4)
  assert.equal(itemById('board:rainbow')!.minLevel, 5)
  assert.equal(price('pieces:horsey'), 1200)
  assert.equal(itemById('pieces:anarcandy')!.minLevel, 4)
  assert.equal(itemById('pieces:emoji')!.minLevel, 5)
  assert.equal(price('avatar:🐉'), 800)
  assert.equal(price('avatar:🦊'), 100)
  assert.equal(price('trophy:diamond'), 5000)
  assert.equal(price('effect:coin-shower'), 600)
  assert.equal(price('title:gm'), 800)
  assert.equal(itemById('title:bigben')!.name, 'London Bridge')
  assert.deepEqual(
    [...FREE_ITEM_IDS].sort(),
    ['avatar:♞', 'avatar:🐱', 'avatar:🐶', 'avatar:🦉', 'board:brown', 'board:green', 'effect:confetti', 'pieces:cburnett', 'pieces:merida', 'title:rookie'].sort(),
  )
  assert.equal(CATALOG.filter((i) => i.kind === 'avatar').length, 18)
  assert.equal(CATALOG.filter((i) => i.kind === 'trophy').length, 7)
  assert.equal(CATALOG.filter((i) => i.kind === 'title').length, 7)
})

await test('levels: boundaries', () => {
  const L = (xp: number) => levelForXp(xp)
  assert.deepEqual([L(0).level, L(0).name, L(0).nextXp], [1, 'Pawn', 250])
  assert.equal(L(249).name, 'Pawn')
  assert.equal(L(250).name, 'Knight')
  assert.equal(L(599).level, 2)
  assert.equal(L(600).name, 'Bishop')
  assert.equal(L(1199).level, 3)
  assert.deepEqual([L(1200).level, L(1200).name], [4, 'Rook'])
  assert.equal(L(2499).level, 4)
  assert.deepEqual([L(2500).level, L(2500).name], [5, 'Queen'])
  assert.equal(L(4999).name, 'Queen')
  assert.equal(L(5000).name, 'King')
  assert.equal(L(9999).level, 6)
  assert.deepEqual([L(10000).level, L(10000).name, L(10000).emoji, L(10000).nextXp], [7, 'Grandmaster', '🏆', 15000])
  assert.equal(L(14999).level, 7)
  assert.deepEqual([L(15000).level, L(15000).name, L(15000).minXp], [8, 'Grandmaster ★1', 15000])
  assert.deepEqual([L(20000).level, L(20000).name], [9, 'Grandmaster ★2'])
  assert.equal(L(-50).level, 1)
  assert.equal(L(Number.NaN).level, 1)
  assert.equal(levelProgress(425), 0.5)
})

await test('defaults: David & Minka, Pokémon pack, free items owned', () => {
  const d = fresh()
  assert.equal(d.version, 1)
  assert.deepEqual(d.profiles.map((p) => p.name), ['David', 'Minka'])
  assert.equal(d.activeProfileId, null)
  assert.deepEqual(d.parent.rewards, [{ id: 'pokemon-pack', name: 'Pokémon booster pack', emoji: '🎴', cost: 1500, enabled: true, maxPerWeek: 2 }])
  assert.deepEqual(d.parent.maxPly, { sicilian: 30, london: 30, 'vs-d4': 30 })
  assert.equal(d.parent.dailyGoalLines, 5)
  assert.equal(d.parent.pin, null)
  for (const p of d.profiles) {
    for (const id of FREE_ITEM_IDS) assert.ok(p.owned.includes(id))
    assert.equal(p.coins, 0)
    assert.ok(p.owned.includes(`avatar:${p.avatar}`))
    assert.deepEqual(p.equipped, { board: 'green', pieces: 'cburnett', effect: 'confetti', title: 'rookie' })
  }
})

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

await test('rewards: line complete, perfect, new line; capped move coins', () => {
  const p = prof(fresh())
  const r = computeLineReward(input(fakeLine('a', 4)), p, 5)
  assert.deepEqual(r.breakdown.map((b) => [b.label, b.coins]), [['Line complete', 9], ['Perfect!', 10], ['New line', 10]])
  assert.equal(r.coins, 29)
  assert.equal(r.stars, 3)
  const big = computeLineReward(input(fakeLine('b', 40), { mistakes: 2 }), p, 5)
  assert.deepEqual(big.breakdown.map((b) => [b.label, b.coins]), [['Line complete', 20], ['New line', 10]])
  assert.equal(big.stars, 1)
})

await test('rewards: stars', () => {
  assert.equal(starsFor(0, 0, false), 3)
  assert.equal(starsFor(1, 0, false), 2)
  assert.equal(starsFor(0, 1, false), 2)
  assert.equal(starsFor(0, 1, true), 1)
  assert.equal(starsFor(1, 1, true), 1)
  assert.equal(starsFor(2, 0, false), 1)
})

await test('rewards: learn mode = half base rounded up, no other bonuses (except daily goal)', () => {
  const p = prof(fresh())
  const r = computeLineReward(input(fakeLine('a', 4), { learnMode: true, combo: 7, opponentBlunderPunished: true }), p, 5)
  assert.deepEqual(r.breakdown.map((b) => [b.label, b.coins]), [['Learned a line', 5]]) // ceil(9/2)
  assert.equal(r.perfect, false)
  // Learn mode still meets the daily goal.
  const p4 = { ...p, daily: { ...(p.daily as DailyStateX), date: localDateKey(NOW), distinctLineIds: ['x1', 'x2', 'x3', 'x4'], lines: 4 } as DailyStateX }
  const g = computeLineReward(input(fakeLine('a', 4), { learnMode: true }), p4, 5)
  assert.deepEqual(g.breakdown.map((b) => b.label), ['Learned a line', 'Daily goal!', 'Streak started'])
  assert.equal(g.coins, 5 + 30 + 5)
})

await test('rewards: remembered (due + perfect) and not after a fresh failure', () => {
  const line = fakeLine('a', 4)
  const base = prof(fresh())
  const due = { ...base, lineStats: { a: stats({ box: 2, dueAt: NOW - HOUR, lastPracticed: NOW - 3 * DAY }) } }
  const r = computeLineReward(input(line), due, 5)
  assert.deepEqual(r.breakdown.map((b) => [b.label, b.coins]), [['Line complete', 9], ['Perfect!', 10], ['Remembered it!', 5]])
  const notPerfect = computeLineReward(input(line, { mistakes: 1 }), due, 5)
  assert.deepEqual(notPerfect.breakdown.map((b) => b.label), ['Line complete'])
  // Failed 10 minutes ago → box 0, due right away: full reward but no "Remembered".
  const justFailed = { ...base, lineStats: { a: stats({ box: 0, dueAt: NOW - 10 * 60000, lastPracticed: NOW - 10 * 60000 }) } }
  const rf = computeLineReward(input(line), justFailed, 5)
  assert.equal(rf.farmed, false)
  assert.deepEqual(rf.breakdown.map((b) => b.label), ['Line complete', 'Perfect!'])
})

await test('rewards: combo and punished blunder need a perfect line', () => {
  const line = fakeLine('a', 4)
  const p = { ...prof(fresh()), lineStats: { a: stats({ dueAt: NOW + DAY, lastPracticed: NOW - 2 * DAY }) } }
  const c = (combo: number, mistakes = 0) =>
    computeLineReward(input(line, { combo, mistakes }), p, 5).breakdown.find((b) => b.label.startsWith('Combo'))?.coins ?? 0
  assert.equal(c(2), 0)
  assert.equal(c(3), 5)
  assert.equal(c(5), 5)
  assert.equal(c(6), 10)
  assert.equal(c(9), 10)
  assert.equal(c(6, 1), 0)
  const combo4 = computeLineReward(input(line, { combo: 4 }), p, 5).breakdown.find((b) => b.label.startsWith('Combo'))!
  assert.equal(combo4.label, 'Combo x4')
  assert.equal(combo4.emoji, '⚡') // 🔥 is the daily streak's icon
  const bl = computeLineReward(input(line, { opponentBlunderPunished: true }), p, 5)
  assert.ok(bl.breakdown.some((b) => b.label === 'Punished a blunder' && b.coins === 5))
  assert.equal(bl.punishedBlunder, true)
  const bl2 = computeLineReward(input(line, { opponentBlunderPunished: true, hintsUsed: 1 }), p, 5)
  assert.ok(!bl2.breakdown.some((b) => b.emoji === '⚔️'))
})

await test('rewards: daily goal (distinct lines) + streak bonus', () => {
  const today = localDateKey(NOW)
  const base = prof(fresh())
  const four = { ...(base.daily as DailyStateX), date: today, distinctLineIds: ['x1', 'x2', 'x3', 'x4'], lines: 4 } as DailyStateX
  const p = { ...base, daily: four }
  const r = computeLineReward(input(fakeLine('x5', 4)), p, 5)
  assert.equal(r.dailyGoalJustMet, true)
  assert.deepEqual(r.breakdown.slice(-2).map((b) => [b.label, b.coins]), [['Daily goal!', 30], ['Streak started', 5]])
  // Continuing a streak from yesterday: 3 → 4 days → 20.
  const pY = { ...p, lastGoalDate: addDaysToKey(today, -1), streakDays: 3 }
  const ry = computeLineReward(input(fakeLine('x5', 4)), pY, 5)
  assert.equal(ry.streakDays, 4)
  assert.deepEqual(ry.breakdown.slice(-1).map((b) => [b.label, b.coins]), [['4-day streak', 20]])
  // Streak bonus capped at 7 days.
  const pBig = { ...p, lastGoalDate: addDaysToKey(today, -1), streakDays: 12 }
  assert.equal(computeLineReward(input(fakeLine('x5', 4)), pBig, 5).breakdown.slice(-1)[0].coins, 35)
  // Gap → streak restarts at 1.
  const pGap = { ...p, lastGoalDate: addDaysToKey(today, -2), streakDays: 9 }
  assert.equal(computeLineReward(input(fakeLine('x5', 4)), pGap, 5).streakDays, 1)
  // Repeating a line already counted today does not complete the goal.
  const rep = computeLineReward(input(fakeLine('x4', 4)), p, 5)
  assert.equal(rep.dailyGoalJustMet, false)
  assert.equal(rep.countsTowardGoal, false)
  // Already claimed today → no second bonus.
  const claimed = { ...p, daily: { ...four, goalClaimed: true, distinctLineIds: ['x1', 'x2', 'x3', 'x4', 'x5'], lines: 5 } as DailyStateX }
  assert.equal(computeLineReward(input(fakeLine('x6', 4)), claimed, 5).dailyGoalJustMet, false)
  // Yesterday's daily state is ignored (fresh day).
  const stale = { ...p, daily: { ...four, date: addDaysToKey(today, -1) } as DailyStateX }
  assert.equal(computeLineReward(input(fakeLine('x5', 4)), stale, 5).distinctLinesToday, 1)
})

await test('rewards: anti-farming (same line < 60 min, not due) = flat 2, no bonuses', () => {
  const line = fakeLine('a', 10)
  const today = localDateKey(NOW)
  const base = prof(fresh())
  const p = {
    ...base,
    lineStats: { a: stats({ box: 1, lastPracticed: NOW - 30 * 60000, dueAt: NOW + DAY }) },
    daily: { ...(base.daily as DailyStateX), date: today, distinctLineIds: ['x1', 'x2', 'x3', 'x4'], lines: 4 } as DailyStateX,
  }
  const r = computeLineReward(input(line, { combo: 8, opponentBlunderPunished: true }), p, 5)
  assert.equal(r.farmed, true)
  assert.deepEqual(r.breakdown.map((b) => [b.label, b.coins]), [['Practice makes perfect', 2]])
  assert.equal(r.coins, 2)
  assert.equal(r.countsTowardGoal, false) // farmed runs never complete the daily goal
  assert.equal(r.dailyGoalJustMet, false)
  assert.equal(r.stars, 3)
  // Learn mode is farmed too.
  assert.equal(computeLineReward(input(line, { learnMode: true }), p, 5).coins, 2)
  // 61 minutes later → normal reward again.
  const later = computeLineReward(input(line, { now: NOW + 31 * 60000 }), p, 5)
  assert.equal(later.farmed, false)
  assert.ok(later.coins > 2)
  // Clock moved backwards → still treated as "just practised".
  assert.equal(computeLineReward(input(line, { now: NOW - 2 * HOUR }), p, 5).farmed, true)
})

/** Coins from the line itself (achievement chips left out). */
function lineCoins(r: { reward: { breakdown: { label: string; coins: number }[] } }): number {
  return sum(r.reward.breakdown.filter((b) => !b.label.startsWith('🏅')))
}
const MIN = 60_000

await test('anti-farming: perfect → fail → perfect on repeat no longer pays in full (review: kid #1)', () => {
  const line = fakeLine('loop', 10)
  for (const fail of [{ mistakes: 2 }, { usedArrowHint: true, hintsUsed: 2 }]) {
    let d = fresh()
    const r1 = ops.applyLineResult(d, 'david', input(line, { now: NOW }), null)
    assert.equal(r1.farmed, false)
    d = r1.data
    const r2 = ops.applyLineResult(d, 'david', input(line, { now: NOW + 2 * MIN, ...fail }), null)
    assert.equal(r2.farmed, true)
    assert.equal(lineCoins(r2), 2)
    // The farmed failure lowered the box but did NOT make the line due now.
    assert.equal(prof(r2.data).lineStats.loop.box, 0)
    assert.ok(prof(r2.data).lineStats.loop.dueAt > NOW + 2 * MIN)
    const r3 = ops.applyLineResult(r2.data, 'david', input(line, { now: NOW + 4 * MIN }), null)
    assert.equal(r3.farmed, true, JSON.stringify(fail))
    assert.equal(lineCoins(r3), 2)
  }
})

await test('anti-farming: failing on purpose again and again pays 2 after the one quick retry', () => {
  const line = fakeLine('fail', 10)
  const f1 = ops.applyLineResult(fresh(), 'david', input(line, { now: NOW, mistakes: 2 }), null) // new line: full pay
  assert.equal(f1.farmed, false)
  const f2 = ops.applyLineResult(f1.data, 'david', input(line, { now: NOW + 2 * MIN, mistakes: 2 }), null) // the quick retry
  assert.equal(f2.farmed, false)
  assert.ok(lineCoins(f2) > 2)
  const f3 = ops.applyLineResult(f2.data, 'david', input(line, { now: NOW + 4 * MIN, mistakes: 2 }), null)
  assert.equal(f3.farmed, true)
  assert.equal(lineCoins(f3), 2)
  const f4 = ops.applyLineResult(f3.data, 'david', input(line, { now: NOW + 6 * MIN }), null)
  assert.equal(f4.farmed, true)
  // After a real break the line pays normally again (and the retry pass resets).
  const later = ops.applyLineResult(f4.data, 'david', input(line, { now: NOW + 70 * MIN }), null)
  assert.equal(later.farmed, false)
  assert.ok(lineCoins(later) > 2)
  assert.equal(prof(later.data).lineStats.fail.quickRetryUsed, undefined)
  // The legitimate fail → fix right away still pays in full (DESIGN §3).
  const a1 = ops.applyLineResult(fresh(), 'david', input(line, { now: NOW, mistakes: 2 }), null)
  const a2 = ops.applyLineResult(a1.data, 'david', input(line, { now: NOW + 3 * MIN }), null)
  assert.equal(a2.farmed, false)
  assert.ok(a2.reward.breakdown.some((b) => b.label === 'Perfect!'))
})

await test('learn mode: the next run without arrows pays in full once, incl. "New line" (review: kid #2, #3)', () => {
  const line = fakeLine('learn', 10)
  const l1 = ops.applyLineResult(fresh(), 'david', input(line, { now: NOW, learnMode: true }), null)
  assert.deepEqual(l1.reward.breakdown.filter((b) => !b.label.startsWith('🏅')).map((b) => b.label), ['Learned a line'])
  assert.equal(prof(l1.data).lineStats.learn.learnPending, true)
  assert.equal(prof(l1.data).lineStats.learn.learnCompletions, 1)
  const n1 = ops.applyLineResult(l1.data, 'david', input(line, { now: NOW + 2 * MIN }), null)
  assert.equal(n1.farmed, false)
  assert.deepEqual(
    n1.reward.breakdown.filter((b) => !b.label.startsWith('🏅')).map((b) => b.label),
    ['Line complete', 'Perfect!', 'New line'],
  )
  assert.equal(prof(n1.data).lineStats.learn.learnPending, undefined)
  // ...but only once.
  const n2 = ops.applyLineResult(n1.data, 'david', input(line, { now: NOW + 4 * MIN }), null)
  assert.equal(n2.farmed, true)
  // Learn twice in a row (2nd is farmed): the promise still holds once.
  const a = ops.applyLineResult(fresh(), 'david', input(line, { now: NOW, learnMode: true }), null)
  const b = ops.applyLineResult(a.data, 'david', input(line, { now: NOW + MIN, learnMode: true }), null)
  assert.equal(b.farmed, true)
  const c = ops.applyLineResult(b.data, 'david', input(line, { now: NOW + 2 * MIN }), null)
  assert.equal(c.farmed, false)
  // The one free run can't start a loop: failing it keeps the review tomorrow.
  const x = ops.applyLineResult(fresh(), 'david', input(line, { now: NOW, learnMode: true }), null)
  const y = ops.applyLineResult(x.data, 'david', input(line, { now: NOW + MIN, mistakes: 3 }), null)
  assert.equal(y.farmed, false)
  assert.ok(prof(y.data).lineStats.learn.dueAt > NOW + HOUR)
  const z = ops.applyLineResult(y.data, 'david', input(line, { now: NOW + 2 * MIN, learnMode: true }), null)
  assert.equal(z.farmed, true)
  const w = ops.applyLineResult(z.data, 'david', input(line, { now: NOW + 3 * MIN }), null)
  assert.equal(w.farmed, true)
})

await test('learn mode: arrows on every move pays like learn mode, not like a new line (review: kid #3)', () => {
  const line = fakeLine('arrows', 10)
  const p = prof(fresh())
  const heavy = computeLineReward(input(line, { usedArrowHint: true, hintsUsed: 20 }), p, 5)
  assert.equal(heavy.learnLike, true)
  assert.deepEqual(heavy.breakdown.map((b) => [b.label, b.coins]), [['Learned a line', 8]])
  const learn = computeLineReward(input(line, { learnMode: true }), p, 5)
  assert.ok(heavy.coins <= learn.coins)
  // One arrow on a long line is a normal (non-perfect) run.
  const light = computeLineReward(input(line, { usedArrowHint: true, hintsUsed: 2 }), p, 5)
  assert.equal(light.learnLike, false)
  assert.deepEqual(light.breakdown.map((b) => b.label), ['Line complete', 'New line'])
  // A learn-mode completion doesn't use up "New line": the next day's first real run gets it.
  const d1 = ops.applyLineResult(fresh(), 'david', input(line, { now: NOW, learnMode: true }), null).data
  const next = ops.applyLineResult(d1, 'david', input(line, { now: NOW + DAY }), null)
  assert.ok(next.reward.breakdown.some((b) => b.label === 'New line'))
  const after = ops.applyLineResult(next.data, 'david', input(line, { now: NOW + 3 * DAY }), null)
  assert.ok(!after.reward.breakdown.some((b) => b.label === 'New line'))
})

await test('daily goal: lowering the goal does not show it as met until it is claimed (review: code #7)', () => {
  let d = fresh()
  for (let i = 0; i < 4; i++) d = ops.applyLineResult(d, 'david', input(fakeLine(`g${i}`, 4), { now: NOW + i * MIN }), null).data
  assert.deepEqual(ops.dailyGoalProgress(prof(d), NOW + 5 * MIN, 5), { done: 4, goal: 5, met: false })
  d = ops.setDailyGoal(d, 3).data
  assert.deepEqual(ops.dailyGoalProgress(prof(d), NOW + 5 * MIN, d.parent.dailyGoalLines), { done: 4, goal: 3, met: false })
  const r = ops.applyLineResult(d, 'david', input(fakeLine('g9', 4), { now: NOW + 6 * MIN }), null)
  assert.equal(r.reward.dailyGoalJustMet, true)
  assert.equal(ops.dailyGoalProgress(prof(r.data), NOW + 7 * MIN, 3).met, true)
})

await test('storage keeps the learn/retry markers on line stats', () => {
  const d = patchProfile(fresh(), 'david', {
    lineStats: { a: stats({ completions: 2, learnCompletions: 5, learnPending: true, quickRetryUsed: true }), b: stats({}) },
  })
  const v = storage.validateAppData(JSON.parse(JSON.stringify(d)), NOW)
  assert.ok(v.ok)
  if (!v.ok) return
  const a = prof(v.data).lineStats.a
  assert.deepEqual([a.learnCompletions, a.learnPending, a.quickRetryUsed], [2, true, true]) // capped at completions
  assert.deepEqual(
    Object.keys(prof(v.data).lineStats.b).sort(),
    ['attempts', 'box', 'completions', 'dueAt', 'lastMistakes', 'lastPracticed', 'perfects'],
  )
})

await test('rewards: engine game coins', () => {
  assert.equal(engineGameCoins('win', 800), 10)
  assert.equal(engineGameCoins('win', 1200), 20)
  assert.equal(engineGameCoins('win', 1599), 20)
  assert.equal(engineGameCoins('win', 1600), 30)
  assert.equal(engineGameCoins('draw', 2000), 5)
  assert.equal(engineGameCoins('loss', 2000), 0)
  assert.equal(engineGameCoins('win', Number.NaN), 10)
})

// ---------------------------------------------------------------------------
// Line stats rule (DESIGN §1)
// ---------------------------------------------------------------------------

await test('line stats: Leitner update rule (line due)', () => {
  const ok = { mistakes: 0, hintsUsed: 0, usedArrowHint: false, learnMode: false }
  const s1 = nextLineStats(undefined, ok, NOW)
  assert.deepEqual([s1.box, s1.dueAt - NOW, s1.completions, s1.perfects, s1.attempts], [1, DAY, 1, 1, 1])
  const s2 = nextLineStats(s1, ok, s1.dueAt) // reviewed when due
  assert.deepEqual([s2.box, s2.dueAt - s1.dueAt], [2, 2 * DAY])
  const due = { ...s2, dueAt: NOW - HOUR }
  const top = nextLineStats({ ...due, box: 5 }, ok, NOW)
  assert.deepEqual([top.box, top.dueAt - NOW], [5, 16 * DAY])
  const one = nextLineStats({ ...due, box: 3 }, { ...ok, mistakes: 1 }, NOW)
  assert.deepEqual([one.box, one.dueAt - NOW, one.perfects], [3, 4 * DAY, s2.perfects])
  const oneFromZero = nextLineStats({ ...due, box: 0 }, { ...ok, mistakes: 1 }, NOW)
  assert.equal(oneFromZero.box, 1)
  const two = nextLineStats({ ...due, box: 4 }, { ...ok, mistakes: 2 }, NOW)
  assert.deepEqual([two.box, two.dueAt - NOW], [0, 0])
  const arrow = nextLineStats({ ...due, box: 4 }, { ...ok, hintsUsed: 2, usedArrowHint: true }, NOW)
  assert.equal(arrow.box, 0)
  const learn0 = nextLineStats(undefined, { ...ok, learnMode: true }, NOW)
  assert.deepEqual([learn0.box, learn0.dueAt - NOW, learn0.perfects], [0, DAY, 0])
  const learn3 = nextLineStats({ ...s2, box: 3 }, { ...ok, learnMode: true, mistakes: 4 }, NOW + HOUR)
  assert.equal(learn3.box, 3)
  assert.equal(learn3.dueAt, s2.dueAt) // learn mode keeps the review schedule (scheduler.ts)
  const junk = nextLineStats(undefined, { mistakes: -3, hintsUsed: Number.NaN, usedArrowHint: false, learnMode: false }, NOW)
  assert.deepEqual([junk.box, junk.lastMistakes], [1, 0]) // garbage input sanitised
})

await test('line stats: a replay before the line is due never promotes or postpones it (review fix #1)', () => {
  const ok = { mistakes: 0, hintsUsed: 0, usedArrowHint: false, learnMode: false }
  const s1 = nextLineStats(undefined, ok, NOW) // box 1, due tomorrow
  const again = nextLineStats(s1, ok, NOW + 10 * 60000)
  assert.deepEqual([again.box, again.dueAt, again.completions, again.perfects, again.lastPracticed], [1, s1.dueAt, 2, 2, NOW + 10 * 60000])
  // Two hours later (not "farmed" by the coin rule) — still not due, still no promotion.
  assert.equal(nextLineStats(again, ok, NOW + 2 * HOUR).box, 1)
  // Mistakes on a not-due replay still lower the box; one mistake doesn't postpone the review.
  const s3 = { ...s1, box: 3, dueAt: NOW + 3 * DAY }
  const two = nextLineStats(s3, { ...ok, mistakes: 2 }, NOW)
  assert.deepEqual([two.box, two.dueAt], [0, NOW])
  const one = nextLineStats(s3, { ...ok, mistakes: 1 }, NOW)
  assert.deepEqual([one.box, one.dueAt], [3, s3.dueAt])
  const perfect = nextLineStats(s3, ok, NOW)
  assert.deepEqual([perfect.box, perfect.dueAt], [3, s3.dueAt])
  // Box 0 (learning step) can always move to box 1, e.g. right after learn mode.
  const learned = nextLineStats(undefined, { ...ok, learnMode: true }, NOW)
  assert.deepEqual([learned.box, learned.dueAt - NOW], [0, DAY])
  assert.equal(nextLineStats(learned, ok, NOW + 5 * 60000).box, 1)
  // "Due" is by local date: practised yesterday 18:00 → today 09:00 counts as the review.
  const y = nextLineStats(undefined, ok, T(2026, 10, 13, 18))
  assert.equal(nextLineStats(y, ok, T(2026, 10, 14, 9)).box, 2)
  assert.equal(nextLineStats(y, ok, T(2026, 10, 13, 23, 59)).box, 1)
})

// ---------------------------------------------------------------------------
// applyLineResult
// ---------------------------------------------------------------------------

await test('applyLineResult: coins/xp/history/totals/stats, immutable input, breakdown sums to coins', () => {
  const d0 = deepFreeze(fresh())
  const snap = JSON.stringify(d0)
  const line = fakeLine('a', 4)
  const { data, reward, ok } = ops.applyLineResult(d0, 'david', input(line), null)
  assert.ok(ok)
  assert.equal(JSON.stringify(d0), snap)
  const p = prof(data)
  assert.equal(reward.coins, sum(reward.breakdown))
  assert.equal(p.coins, reward.coins)
  assert.equal(p.xp, reward.coins)
  // first-line + first-perfect achievements unlock with the first perfect line
  assert.deepEqual(reward.newAchievements.map((a) => a.id).sort(), ['first-line', 'first-perfect'])
  assert.equal(reward.coins, 29 + 20 + 25)
  assert.equal(p.history[0].reason.startsWith('🏅'), true)
  assert.equal(p.history.length, 3)
  assert.deepEqual(p.totals, { lines: 1, perfects: 1, mistakesFixed: 0, engineWins: 0, blundersPunished: 0 })
  assert.equal(p.lineStats.a.box, 1)
  assert.equal(p.daily.lines, 1)
  assert.deepEqual(p.daily.openingsPracticed, ['sicilian'])
  assert.equal(reward.stars, 3)
  assert.equal(prof(data, 'minka'), prof(d0, 'minka')) // other profile untouched (same object)
})

await test('applyLineResult: achievements unlock exactly once', () => {
  let d = fresh()
  const first = ops.applyLineResult(d, 'david', input(fakeLine('a', 4)), null)
  d = first.data
  const second = ops.applyLineResult(d, 'david', input(fakeLine('b', 4), { now: NOW + 1000 }), null)
  assert.deepEqual(second.reward.newAchievements, [])
  assert.equal(second.reward.coins, 29)
  assert.equal(Object.keys(prof(second.data).achievements).length, 2)
  // checkAchievements never re-reports unlocked ones
  assert.deepEqual(checkAchievements(prof(second.data), { now: NOW }).map((a) => a.id), [])
  // all achievement ids unique, coins within 20..200
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length)
  for (const a of ACHIEVEMENTS) assert.ok(a.coins >= 20 && a.coins <= 200, a.id)
})

await test('applyLineResult: duplicate submission is ignored', () => {
  const d = fresh()
  const inp = input(fakeLine('a', 4))
  const r1 = ops.applyLineResult(d, 'david', inp, null)
  const r2 = ops.applyLineResult(r1.data, 'david', inp, null)
  assert.equal(r2.duplicate, true)
  assert.equal(r2.data, r1.data)
})

await test('applyLineResult: farmed run still updates stats but pays 2', () => {
  let d = fresh()
  d = ops.applyLineResult(d, 'david', input(fakeLine('a', 4)), null).data
  const before = prof(d)
  const r = ops.applyLineResult(d, 'david', input(fakeLine('a', 4), { now: NOW + 10 * 60000, mistakes: 3 }), null)
  assert.equal(r.farmed, true)
  const p = prof(r.data)
  assert.equal(p.coins - before.coins, r.reward.coins)
  assert.equal(r.reward.breakdown[0].coins, 2)
  assert.equal(p.lineStats.a.box, 0)
  assert.equal(p.lineStats.a.completions, 2)
  assert.equal(p.daily.lines, 1)
})

await test('applyLineResult: quick replays never master lines or count toward achievements (review fix #1)', () => {
  const sic = OPENINGS.find((o) => o.id === 'sicilian')!
  const lines = sic.chapters.map((c, i) => fakeLine(`L${i}`, 4, c.id, 'sicilian'))
  const rep = fakeRep('sicilian', lines)
  let d = fresh()
  let t = T(2026, 10, 14, 15, 0)
  const unlocked: string[] = []
  let mastered = 0
  // The reviewer's probe: every chapter's line played perfectly 3 times, a minute apart.
  for (const line of lines) {
    for (let k = 0; k < 3; k++) {
      t += 60000
      const r = ops.applyLineResult(d, 'david', input(line, { now: t, combo: k + 1 }), rep)
      d = r.data
      unlocked.push(...r.reward.newAchievements.map((a) => a.id))
      if (r.reward.lineMastered) mastered++
      assert.equal(r.farmed, k > 0)
    }
  }
  const p = prof(d)
  assert.equal(mastered, 0)
  for (const l of lines) assert.equal(p.lineStats[l.id].box, 1)
  assert.ok(!unlocked.some((id) => id.startsWith('master') || id === 'perfect-10' || id === 'lines-10' || id.startsWith('combo')), unlocked.join())
  assert.deepEqual([p.totals.lines, p.totals.perfects, p.bestCombo, p.daily.perfects], [lines.length, lines.length, 1, lines.length])
  // Replaying one line ten times with a growing trainer combo: no combo achievements.
  let d2 = fresh()
  for (let k = 0; k < 10; k++) {
    d2 = ops.applyLineResult(d2, 'david', input(fakeLine('solo', 4), { now: NOW + k * 60000, combo: k + 1 }), null).data
  }
  assert.equal(prof(d2).bestCombo, 1)
  assert.ok(!prof(d2).achievements['combo-5'])
  assert.equal(prof(d2).totals.lines, 1)
  // Mastery still comes from real reviews on later days: day 0 → box 1, day 1 → 2, day 3 → 3.
  let d3 = fresh(T(2026, 10, 1))
  const line = lines[0]
  const days = [T(2026, 10, 1, 17), T(2026, 10, 2, 9), T(2026, 10, 4, 8)]
  const boxes: number[] = []
  let lastReward: ReturnType<typeof ops.applyLineResult> | null = null
  for (const at of days) {
    lastReward = ops.applyLineResult(d3, 'david', input(line, { now: at }), rep)
    d3 = lastReward.data
    boxes.push(prof(d3).lineStats[line.id].box)
  }
  assert.deepEqual(boxes, [1, 2, 3])
  assert.equal(lastReward!.reward.lineMastered, true)
  assert.ok(lastReward!.reward.newAchievements.some((a) => a.id === 'master-chapter'))
})

await test('applyLineResult: level up, lineMastered, never-give-up, bestCombo', () => {
  let d = patchProfile(fresh(), 'david', { xp: 240, coins: 0, achievements: { 'first-line': 1, 'first-perfect': 1 } })
  d = patchProfile(d, 'david', { lineStats: { a: stats({ box: 2, dueAt: NOW - HOUR, lastPracticed: NOW - 3 * DAY }) } })
  const r = ops.applyLineResult(d, 'david', input(fakeLine('a', 4), { combo: 5 }), null)
  assert.ok(r.reward.levelUp)
  assert.equal(r.reward.levelUp!.from.name, 'Pawn')
  assert.equal(r.reward.levelUp!.to.name, 'Knight')
  assert.equal(r.reward.lineMastered, true)
  assert.equal(prof(r.data).bestCombo, 5)
  assert.ok(r.reward.newAchievements.some((a) => a.id === 'combo-5'))
  const g = ops.applyLineResult(fresh(), 'david', input(fakeLine('b', 4), { mistakes: 3, maxMistakesOnOneMove: 3 }), null)
  assert.ok(g.reward.newAchievements.some((a) => a.id === 'never-give-up'))
  const g2 = ops.applyLineResult(fresh(), 'david', input(fakeLine('b', 4), { mistakes: 4, maxMistakesOnOneMove: 2 }), null)
  assert.ok(!g2.reward.newAchievements.some((a) => a.id === 'never-give-up'))
})

await test('applyLineResult: time-of-day + triple threat achievements', () => {
  const early = ops.applyLineResult(fresh(), 'david', input(fakeLine('a', 4), { now: T(2026, 10, 14, 7, 30) }), null)
  assert.ok(early.reward.newAchievements.some((a) => a.id === 'early-bird'))
  const late = ops.applyLineResult(fresh(), 'david', input(fakeLine('a', 4), { now: T(2026, 10, 14, 20, 0) }), null)
  assert.ok(late.reward.newAchievements.some((a) => a.id === 'night-owl'))
  const noon = ops.applyLineResult(fresh(), 'david', input(fakeLine('a', 4)), null)
  assert.ok(!noon.reward.newAchievements.some((a) => a.id === 'early-bird' || a.id === 'night-owl'))
  let d = fresh()
  d = ops.applyLineResult(d, 'david', input(fakeLine('s', 4, 'c1', 'sicilian')), null).data
  d = ops.applyLineResult(d, 'david', input(fakeLine('l', 4, 'c2', 'london'), { now: NOW + 1 }), null).data
  const r = ops.applyLineResult(d, 'david', input(fakeLine('v', 4, 'c3', 'vs-d4'), { now: NOW + 2 }), null)
  assert.ok(r.reward.newAchievements.some((a) => a.id === 'triple-threat'))
})

await test('applyLineResult: chapter + opening mastery (needs repertoire)', () => {
  const core = OPENINGS.find((o) => o.id === 'london')!.chapters
  const extra = OPENINGS.find((o) => o.id === 'london')!.extraChapters[0]
  const l1 = fakeLine('l1', 4, core[0].id, 'london')
  const l2 = fakeLine('l2', 4, core[0].id, 'london')
  const l3 = fakeLine('l3', 4, core[1].id, 'london')
  const lx = fakeLine('lx', 4, extra.id, 'london') // extra chapter: not needed for opening mastery
  const rep = fakeRep('london', [l1, l2, l3, lx])
  const dueStats = stats({ box: 2, dueAt: NOW - HOUR, lastPracticed: NOW - 3 * DAY })
  let d = patchProfile(fresh(), 'david', {
    lineStats: { l1: stats({ box: 3, dueAt: NOW + DAY }), l2: dueStats, l3: dueStats },
    achievements: { 'first-line': 1, 'first-perfect': 1 },
  })
  // No repertoire → no mastery checks
  const noRep = ops.applyLineResult(d, 'david', input(l2), null)
  assert.ok(!noRep.reward.newAchievements.some((a) => a.id.startsWith('master')))
  const r1 = ops.applyLineResult(d, 'david', input(l2), rep)
  assert.deepEqual(r1.reward.newAchievements.map((a) => a.id), ['master-chapter'])
  d = r1.data
  const r2 = ops.applyLineResult(d, 'david', input(l3, { now: NOW + 1000 }), rep)
  assert.deepEqual(r2.reward.newAchievements.map((a) => [a.id, a.name]), [['master-london', 'Big Ben']])
  // Empty repertoire never counts as mastered
  const empty = checkAchievements(prof(fresh()), { now: NOW, rep: fakeRep('sicilian', []) })
  assert.ok(!empty.some((a) => a.id.startsWith('master')))
})

// ---------------------------------------------------------------------------
// Daily rollover & streaks
// ---------------------------------------------------------------------------

function playDistinct(d: AppData, n: number, start: number, prefix: string, stepMs = 60000): { data: AppData; goalMet: boolean[] } {
  const goalMet: boolean[] = []
  for (let i = 0; i < n; i++) {
    const r = ops.applyLineResult(d, 'david', input(fakeLine(`${prefix}${i}`, 4), { now: start + i * stepMs }), null)
    d = r.data
    goalMet.push(r.reward.dailyGoalJustMet)
  }
  return { data: d, goalMet }
}

await test('daily: rollover at local midnight with injected now; streak continue / reset', () => {
  let d = fresh(T(2026, 10, 14, 9))
  // Day 1, late evening: goal met on the 5th distinct line.
  let res = playDistinct(d, 6, T(2026, 10, 14, 23, 50), 'd1-', 2 * 60000) // 23:50 … 00:00
  assert.deepEqual(res.goalMet, [false, false, false, false, true, false])
  d = res.data
  assert.equal(prof(d).streakDays, 1)
  assert.equal(prof(d).lastGoalDate, '2026-10-14')
  assert.equal(prof(d).daily.date, '2026-10-15') // the 6th line was after midnight → new day
  assert.equal(prof(d).daily.lines, 1)
  // Rollover just after midnight: daily reset, streak alive.
  const rolled = ops.ensureDaily(prof(res.data), T(2026, 10, 15, 0, 30))
  assert.equal(rolled, prof(res.data)) // same day already → identity
  const p2 = ops.ensureDaily(prof(fresh(T(2026, 10, 14))), T(2026, 10, 15, 0, 1))
  assert.equal(p2.daily.date, '2026-10-15')
  assert.equal(p2.daily.goalClaimed, false)
  // Day 2: goal met again → streak 2 with streak bonus 10.
  res = playDistinct(d, 4, T(2026, 10, 15, 10), 'd2-')
  d = res.data
  assert.deepEqual(res.goalMet, [false, false, false, true])
  assert.equal(prof(d).streakDays, 2)
  assert.equal(currentStreak(prof(d), T(2026, 10, 16, 9)), 2) // still alive the next day
  // Skip day 3. Day 4: streak broken (shows 0), next goal → 1.
  assert.equal(currentStreak(prof(d), T(2026, 10, 17, 9)), 0)
  const p4 = ops.ensureDaily(prof(d), T(2026, 10, 17, 9))
  assert.equal(p4.streakDays, 0)
  res = playDistinct(d, 5, T(2026, 10, 17, 9), 'd4-')
  const last = ops.applyLineResult(res.data, 'david', input(fakeLine('x', 4), { now: T(2026, 10, 17, 11) }), null)
  assert.equal(prof(res.data).streakDays, 1)
  assert.equal(prof(res.data).lastGoalDate, '2026-10-17')
  assert.equal(last.reward.dailyGoalJustMet, false)
})

await test('daily: streak bonus amounts across consecutive days', () => {
  let d = fresh(T(2026, 10, 1))
  const bonuses: number[] = []
  for (let day = 1; day <= 9; day++) {
    for (let i = 0; i < 5; i++) {
      const r = ops.applyLineResult(d, 'david', input(fakeLine(`day${day}-${i}`, 4), { now: T(2026, 10, day, 15, i) }), null)
      d = r.data
      if (r.reward.dailyGoalJustMet) bonuses.push(r.reward.breakdown.find((b) => b.emoji === '📅')!.coins)
    }
  }
  assert.deepEqual(bonuses, [5, 10, 15, 20, 25, 30, 35, 35, 35])
  assert.equal(prof(d).streakDays, 9)
  assert.ok(prof(d).achievements['streak-3'] && prof(d).achievements['streak-7'])
})

await test('daily: clock moved back does not grant a second goal for the same day', () => {
  let d = fresh(T(2026, 10, 14))
  d = playDistinct(d, 5, T(2026, 10, 15, 10), 'f-').data // "tomorrow" (clock forward)
  const res = playDistinct(d, 5, T(2026, 10, 14, 10), 'b-') // clock back to today
  assert.deepEqual(res.goalMet, [false, false, false, false, false])
})

await test('daily: rolloverAll resets every player on a new day; identity when nothing changes (review fix #2)', () => {
  let d = playDistinct(fresh(T(2026, 10, 14)), 5, T(2026, 10, 14, 10), 'g-').data
  d = { ...d, activeProfileId: 'david' }
  assert.equal(prof(d).daily.goalClaimed, true)
  const sameDay = ops.rolloverAll(d, T(2026, 10, 14, 22))
  assert.equal(sameDay, d)
  const next = ops.rolloverAll(d, T(2026, 10, 15, 8))
  assert.deepEqual([prof(next).daily.date, prof(next).daily.lines, prof(next).daily.goalClaimed, prof(next).streakDays], ['2026-10-15', 0, false, 1])
  assert.equal(prof(next, 'minka').daily.date, '2026-10-15')
  assert.equal(ops.rolloverAll(next, T(2026, 10, 15, 9)), next)
  // Two days later the streak is gone.
  const later = ops.rolloverAll(d, T(2026, 10, 17, 8))
  assert.deepEqual([prof(later).daily.lines, prof(later).streakDays], [0, 0])
})

await test('daily: a far-future clock jump does not freeze rewards (review fix #5)', () => {
  const now = T(2026, 10, 17, 10)
  const today = localDateKey(now)
  const future = addDaysToKey(today, 365)
  let d = fresh(now)
  d = patchProfile(d, 'david', {
    daily: { ...(prof(d).daily as DailyStateX), date: future, goalClaimed: true, engineGamesRewarded: 3 } as DailyStateX,
    lastGoalDate: future,
    streakDays: 1,
    lineStats: { old: stats({ box: 2, lastPracticed: now + 300 * DAY, dueAt: now + 302 * DAY }) },
  })
  const v = storage.validateAppData(JSON.parse(JSON.stringify(d)), now) // like a reload
  assert.ok(v.ok)
  if (!v.ok) return
  d = v.data
  // Engine games pay again today.
  const eg = ops.applyEngineGame(d, 'david', 'win', 1500, now)
  assert.deepEqual([eg.coins, eg.capped], [20, false])
  d = eg.data
  assert.equal(prof(d).daily.date, today)
  assert.equal(prof(d).lastGoalDate, today) // the "future" goal counts as today's (no double goal)
  // A line last practised "in the future" pays normally (not farmed), and its schedule heals.
  const r = ops.applyLineResult(d, 'david', input(fakeLine('old', 4), { now: now + 60000 }), null)
  assert.equal(r.farmed, false)
  assert.ok(r.reward.coins > 2)
  assert.ok(prof(r.data).lineStats.old.dueAt <= now + 60000 + 4 * DAY)
  // Tomorrow everything is normal: the goal is met and the streak continues.
  const res = playDistinct(r.data, 5, T(2026, 10, 18, 10), 't-')
  assert.deepEqual(res.goalMet, [false, false, false, false, true])
  assert.equal(prof(res.data).streakDays, 2)
  assert.equal(ops.currentStreak(prof(res.data), T(2026, 10, 18, 12)), 2)
  // currentStreak / dailyGoalProgress on raw far-future data are sane too.
  const raw = patchProfile(fresh(now), 'david', { lastGoalDate: future, streakDays: 9 })
  assert.equal(ops.currentStreak(prof(raw), now), 9)
  assert.equal(ops.currentStreak(ops.ensureDaily(prof(raw), now), now + 2 * DAY), 0)
  // A small skew (clock wound back a few hours) is still tolerated as before.
  const near = patchProfile(fresh(now), 'david', { daily: { ...(prof(fresh(now)).daily as DailyStateX), date: addDaysToKey(today, 1), goalClaimed: true } as DailyStateX })
  assert.equal(ops.ensureDaily(prof(near), now), prof(near))
})

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

await test('shop: insufficient coins, buy, buy twice, minLevel, equip', () => {
  let d = fresh()
  const r0 = ops.buyItem(d, 'david', 'board:ocean', NOW)
  assert.equal(r0.ok, false)
  assert.equal(r0.error, 'not-enough-coins')
  assert.equal(r0.data, d)
  d = patchProfile(d, 'david', { coins: 200, xp: 200 })
  const r1 = ops.buyItem(d, 'david', 'board:ocean', NOW)
  assert.ok(r1.ok)
  assert.equal(prof(r1.data).coins, 50 + 20) // 200 - 150 + 'Shopper' achievement (20)
  assert.equal(prof(r1.data).xp, 200 + 20) // spending never lowers XP
  assert.deepEqual(r1.newAchievements.map((a) => a.id), ['first-purchase'])
  assert.ok(prof(r1.data).owned.includes('board:ocean'))
  const r2 = ops.buyItem(r1.data, 'david', 'board:ocean', NOW)
  assert.equal(r2.error, 'already-owned')
  assert.equal(ops.buyItem(r1.data, 'david', 'board:nope', NOW).error, 'unknown-item')
  assert.equal(ops.buyItem(r1.data, 'nobody', 'board:ocean', NOW).error, 'no-profile')
  assert.equal(ops.buyItem(r1.data, 'david', 'board:green', NOW).error, 'already-owned') // free items owned
  // minLevel: gold needs level 4 (Rook, 1200 XP)
  let rich = patchProfile(r1.data, 'david', { coins: 5000, xp: 1199 })
  assert.equal(ops.buyItem(rich, 'david', 'board:gold', NOW).error, 'level-too-low')
  rich = patchProfile(rich, 'david', { xp: 1200 })
  const g = ops.buyItem(rich, 'david', 'board:gold', NOW)
  assert.ok(g.ok)
  assert.equal(prof(g.data).coins, 3500)
  // Exact coins → 0, never negative
  const exact = ops.buyItem(patchProfile(fresh(), 'david', { coins: 150, achievements: { 'first-purchase': 1 } }), 'david', 'board:ocean', NOW)
  assert.equal(prof(exact.data).coins, 0)
  // Equip
  let e = ops.equipItem(g.data, 'david', 'board:gold')
  assert.ok(e.ok)
  assert.equal(prof(e.data).equipped.board, 'gold')
  assert.equal(ops.equipItem(e.data, 'david', 'board:lava').error, 'not-owned')
  e = ops.equipItem(e.data, 'david', 'avatar:🐶')
  assert.equal(prof(e.data).avatar, '🐶')
  assert.ok(ops.isEquipped(prof(e.data), 'avatar:🐶'))
  const t = ops.buyItem(patchProfile(e.data, 'david', { coins: 200 }), 'david', 'trophy:bronze', NOW)
  assert.ok(t.ok)
  assert.equal(ops.equipItem(t.data, 'david', 'trophy:bronze').error, 'not-equippable')
  e = ops.equipItem(e.data, 'david', 'title:rookie')
  assert.equal(prof(e.data).equipped.title, 'rookie')
})

await test('shop: collector after 10 purchases (free items do not count)', () => {
  let d = patchProfile(fresh(), 'david', { coins: 100000, xp: 100000 })
  const cheap = CATALOG.filter((i) => i.cost > 0 && !i.minLevel).slice(0, 10)
  const unlocked: string[] = []
  for (const it of cheap) {
    const r = ops.buyItem(d, 'david', it.id, NOW)
    assert.ok(r.ok, it.id)
    d = r.data
    unlocked.push(...r.newAchievements.map((a) => a.id))
  }
  assert.deepEqual(unlocked, ['first-purchase', 'collector'])
})

// ---------------------------------------------------------------------------
// Redemptions
// ---------------------------------------------------------------------------

await test('redemption: request deducts, decline refunds (no XP), weekly cap (rolling 7 days)', () => {
  let d = fresh()
  assert.equal(ops.requestRedemption(d, 'david', 'pokemon-pack', NOW).error, 'not-enough-coins')
  d = patchProfile(d, 'david', { coins: 5000, xp: 5000 })
  const a = ops.requestRedemption(d, 'david', 'pokemon-pack', NOW)
  assert.ok(a.ok)
  assert.equal(prof(a.data).coins, 3500)
  assert.equal(prof(a.data).xp, 5000)
  assert.equal(prof(a.data).redemptions[0].status, 'pending')
  const b = ops.requestRedemption(a.data, 'david', 'pokemon-pack', NOW + HOUR)
  assert.ok(b.ok)
  assert.equal(prof(b.data).coins, 2000)
  const c = ops.requestRedemption(b.data, 'david', 'pokemon-pack', NOW + 2 * HOUR)
  assert.equal(c.error, 'weekly-limit')
  assert.equal(c.data, b.data)
  // Minka has her own cap
  const m = ops.requestRedemption(patchProfile(b.data, 'minka', { coins: 1500 }), 'minka', 'pokemon-pack', NOW)
  assert.ok(m.ok)
  // Decline → refund, frees a slot
  const idA = a.redemption!.id
  const dec = ops.resolveRedemption(b.data, 'david', idA, false, NOW + 3 * HOUR)
  assert.ok(dec.ok)
  assert.equal(prof(dec.data).coins, 3500)
  assert.equal(prof(dec.data).xp, 5000)
  assert.equal(prof(dec.data).redemptions.find((r) => r.id === idA)!.status, 'declined')
  // Can't resolve twice (no double refund)
  const again = ops.resolveRedemption(dec.data, 'david', idA, false, NOW + 4 * HOUR)
  assert.equal(again.error, 'not-pending')
  assert.equal(ops.resolveRedemption(dec.data, 'david', idA, true, NOW).error, 'not-pending')
  // Slot freed by the decline
  const c2 = ops.requestRedemption(dec.data, 'david', 'pokemon-pack', NOW + 5 * HOUR)
  assert.ok(c2.ok)
  // Approve the other → first-reward achievement
  const ap = ops.resolveRedemption(c2.data, 'david', b.redemption!.id, true, NOW + 6 * HOUR)
  assert.ok(ap.ok)
  assert.deepEqual(ap.newAchievements.map((x) => x.id), ['first-reward'])
  assert.equal(prof(ap.data).coins, 2000 + 50)
  // Rolling week: the cap is still full 6 days later, free again after 7 days from the first
  const d6 = patchProfile(ap.data, 'david', { coins: 10000 })
  assert.equal(ops.requestRedemption(d6, 'david', 'pokemon-pack', NOW + 6 * DAY).error, 'weekly-limit')
  assert.ok(ops.requestRedemption(d6, 'david', 'pokemon-pack', NOW + 7 * DAY + 2 * HOUR).ok)
  // Pending list for the parent
  assert.equal(ops.pendingRedemptions(c2.data).length, 2)
})

await test('redemption: disabled / unknown / unlimited rewards', () => {
  let d = patchProfile(fresh(), 'david', { coins: 10000 })
  const off = ops.setReward(d, { ...d.parent.rewards[0], enabled: false })
  assert.ok(off.ok)
  assert.equal(ops.requestRedemption(off.data, 'david', 'pokemon-pack', NOW).error, 'reward-disabled')
  assert.equal(ops.requestRedemption(d, 'david', 'nope', NOW).error, 'unknown-reward')
  const add = ops.addReward(d, { name: '30 min screen time', emoji: '📺', cost: 300, enabled: true })
  assert.ok(add.ok)
  assert.equal(add.id, '30-min-screen-time')
  d = add.data
  for (let i = 0; i < 5; i++) {
    const r = ops.requestRedemption(d, 'david', add.id!, NOW + i * 60000) // a minute apart (not a double tap)
    assert.ok(r.ok)
    assert.ok(!r.duplicate)
    d = r.data
  }
  assert.equal(prof(d).coins, 10000 - 1500)
  // A removed reward's pending requests can still be resolved (refund uses the snapshot cost)
  const rm = ops.removeReward(d, add.id!)
  assert.ok(rm.ok)
  const pend = prof(rm.data).redemptions.find((r) => r.status === 'pending')!
  const dec = ops.resolveRedemption(rm.data, 'david', pend.id, false, NOW + HOUR)
  assert.equal(prof(dec.data).coins, 10000 - 1200)
})

await test('redemption: double tap charges once; ids unique across players (review fix #6)', () => {
  let d = patchProfile(fresh(), 'david', { coins: 3000 })
  d = patchProfile(d, 'minka', { coins: 3000 })
  const r1 = ops.requestRedemption(d, 'david', 'pokemon-pack', NOW + 100)
  const r2 = ops.requestRedemption(r1.data, 'david', 'pokemon-pack', NOW + 180)
  assert.ok(r1.ok && !r1.duplicate)
  assert.ok(r2.ok && r2.duplicate)
  assert.equal(r2.data, r1.data)
  assert.equal(r2.redemption, r1.redemption)
  assert.equal(prof(r2.data).coins, 1500)
  assert.equal(ops.pendingRedemptions(r2.data).length, 1)
  // A deliberate second request later is fine (weekly cap 2)
  const r3 = ops.requestRedemption(r2.data, 'david', 'pokemon-pack', NOW + 60000)
  assert.ok(r3.ok && !r3.duplicate)
  assert.equal(prof(r3.data).coins, 0)
  // Same moment, two players → different ids
  const m = ops.requestRedemption(r1.data, 'minka', 'pokemon-pack', NOW + 100)
  assert.notEqual(m.redemption!.id, r1.redemption!.id)
})

await test('achievements: 28 defined, coins 20–200', () => {
  assert.equal(ACHIEVEMENTS.length, 28)
  assert.equal(Math.min(...ACHIEVEMENTS.map((a) => a.coins)), 20)
  assert.equal(Math.max(...ACHIEVEMENTS.map((a) => a.coins)), 200)
})

// ---------------------------------------------------------------------------
// Engine games
// ---------------------------------------------------------------------------

await test('engine games: rewards, daily cap of 3, losses do not use a slot, next day resets', () => {
  let d = fresh()
  const loss = ops.applyEngineGame(d, 'david', 'loss', 1600, NOW)
  assert.equal(loss.coins, 0)
  assert.equal(loss.capped, false)
  d = loss.data
  const w1 = ops.applyEngineGame(d, 'david', 'win', 1600, NOW + 1)
  assert.equal(w1.coins, 30)
  assert.deepEqual(w1.newAchievements.map((a) => a.id), ['beat-computer'])
  assert.equal(prof(w1.data).coins, 30 + 50)
  d = w1.data
  const dr = ops.applyEngineGame(d, 'david', 'draw', 800, NOW + 2)
  assert.equal(dr.coins, 5)
  d = dr.data
  const w2 = ops.applyEngineGame(d, 'david', 'win', 1200, NOW + 3)
  assert.equal(w2.coins, 20)
  assert.deepEqual(w2.newAchievements, [])
  d = w2.data
  const w3 = ops.applyEngineGame(d, 'david', 'win', 2000, NOW + 4)
  assert.equal(w3.coins, 0)
  assert.equal(w3.capped, true)
  assert.equal(prof(w3.data).coins, prof(d).coins)
  assert.equal(prof(w3.data).totals.engineWins, 3)
  // Next day: fresh cap
  const w4 = ops.applyEngineGame(w3.data, 'david', 'win', 800, NOW + DAY)
  assert.equal(w4.coins, 10)
  assert.equal(ops.applyEngineGame(w4.data, 'david', 'win' as never, 800, NOW).ok, true)
  assert.equal(ops.applyEngineGame(w4.data, 'david', 'resign' as never, 800, NOW).ok, false)
})

// ---------------------------------------------------------------------------
// Parent ops
// ---------------------------------------------------------------------------

await test('parent: adjustCoins never negative; gifts add XP; validation', () => {
  let d = fresh()
  const g = ops.adjustCoins(d, 'minka', 100, 'Good report', NOW)
  assert.ok(g.ok)
  assert.equal(prof(g.data, 'minka').coins, 100)
  assert.equal(prof(g.data, 'minka').xp, 100)
  assert.equal(prof(g.data, 'minka').history[0].reason, '🎁 Good report')
  const rm = ops.adjustCoins(g.data, 'minka', -500, '', NOW)
  assert.ok(rm.ok)
  assert.equal(prof(rm.data, 'minka').coins, 0)
  assert.equal(prof(rm.data, 'minka').xp, 100)
  assert.equal(prof(rm.data, 'minka').history[0].delta, -100)
  for (const bad of [0, Number.NaN, Infinity, 1e9]) assert.equal(ops.adjustCoins(d, 'minka', bad, '', NOW).ok, false)
  d = g.data
})

await test('parent: PIN validation + constant-shape compare', () => {
  const d = fresh()
  for (const bad of ['123', '12345', 'abcd', ' 123', '12a4', '', '１２３４']) assert.equal(ops.setPin(d, bad).ok, false, bad)
  const s = ops.setPin(d, '0420')
  assert.ok(s.ok)
  assert.equal(s.data.parent.pin, '0420')
  assert.equal(ops.pinMatches('0420', '0420'), true)
  assert.equal(ops.pinMatches('0420', '0421'), false)
  assert.equal(ops.pinMatches('0420', '042'), false)
  assert.equal(ops.pinMatches('0420', '04200'), false)
  assert.equal(ops.pinMatches(null, ''), false)
  assert.equal(ops.pinMatches(null, '0000'), false)
  assert.equal(ops.pinMatches('0420', 420 as unknown as string), false)
})

await test('parent: settings ops validate input', () => {
  const d = fresh()
  assert.equal(ops.setDailyGoal(d, 0).ok, false)
  assert.equal(ops.setDailyGoal(d, 8).data.parent.dailyGoalLines, 8)
  assert.equal(ops.setMaxPly(d, 'london', -1).ok, false)
  assert.equal(ops.setMaxPly(d, 'london', 0).data.parent.maxPly.london, 0)
  const t = ops.toggleExtra(d, 'YwJbmh0T')
  assert.deepEqual(t.data.parent.enabledExtras, ['YwJbmh0T'])
  assert.deepEqual(ops.toggleExtra(t.data, 'YwJbmh0T').data.parent.enabledExtras, [])
  assert.equal(ops.toggleExtra(t.data, 'YwJbmh0T', true).data, t.data)
  assert.equal(ops.setReward(d, { ...d.parent.rewards[0], cost: 0 }).ok, false)
  assert.equal(ops.setReward(d, { ...d.parent.rewards[0], cost: 2000, maxPerWeek: undefined }).data.parent.rewards[0].maxPerWeek, undefined)
  assert.equal(ops.renameProfile(d, 'david', '   ').ok, false)
  assert.equal(prof(ops.renameProfile(d, 'david', '  Dave  ').data).name, 'Dave')
  assert.equal(ops.setAvatar(d, 'david', '🐉').error, 'not-owned') // no free paid avatars
  assert.equal(prof(ops.setAvatar(d, 'david', '🐶').data).avatar, '🐶')
  const played = ops.applyLineResult(d, 'david', input(fakeLine('a')), null).data
  const reset = ops.resetProfile(played, 'david', NOW)
  assert.equal(prof(reset.data).coins, 0)
  assert.deepEqual(prof(reset.data).lineStats, {})
  assert.equal(ops.importStudyPgn(d, 'hello', 'x', NOW).ok, false)
  // A PGN without any of the coach's chapters is refused (review: parent #3): every opening would have 0 lines.
  const noCh = ops.importStudyPgn(d, '[Event "x"]\n\n1. e4 *', 'Study v2', NOW)
  assert.deepEqual([noCh.ok, noCh.error], [false, 'no-chapters'])
  const imp = ops.importStudyPgn(d, STUDY_V2, 'Study v2', NOW)
  assert.ok(imp.ok)
  assert.equal(imp.data.studyOverride!.name, 'Study v2')
  assert.equal(ops.clearStudyOverride(imp.data).studyOverride, undefined)
  assert.equal(ops.selectProfile(d, 'nobody', NOW), d)
  assert.equal(ops.selectProfile(d, 'minka', NOW).activeProfileId, 'minka')
})

await test('history: capped at 200 newest first', () => {
  let d = fresh()
  for (let i = 0; i < 230; i++) d = ops.adjustCoins(d, 'david', 1, `g${i}`, NOW + i).data
  const h = prof(d).history
  assert.equal(h.length, 200)
  assert.equal(h[0].reason, '🎁 g229')
  assert.equal(prof(d).coins, 230)
})

// ---------------------------------------------------------------------------
// Storage & backup
// ---------------------------------------------------------------------------

await test('storage: no localStorage under node → defaults, save returns false, never throws', () => {
  storage.setStorageBackend(null)
  const d = storage.loadAppData(NOW)
  assert.deepEqual(d.profiles.map((p) => p.id), ['david', 'minka'])
  assert.equal(storage.saveAppData(d), false)
  // review fix #9: the "not saving" banner has a reason to show
  assert.equal(storage.getLastSaveError(), storage.STORAGE_UNAVAILABLE_ERROR)
  storage.setStorageBackend(undefined)
  assert.doesNotThrow(() => storage.loadAppData(NOW))
})

await test('storage: save/load round trip, study stored separately, corrupt data stashed', () => {
  const mem = new MemStorage()
  storage.setStorageBackend(mem)
  let d = ops.applyLineResult(fresh(), 'david', input(fakeLine('a', 4)), null).data
  d = ops.importStudyPgn(d, STUDY_V2, 'Study v2', NOW).data
  assert.equal(storage.saveAppData(d), true)
  assert.ok(mem.getItem(storage.STORAGE_KEY))
  assert.ok(!mem.getItem(storage.STORAGE_KEY)!.includes('1. e4 *'))
  assert.ok(mem.getItem(storage.STUDY_KEY)!.includes('1. e4 *'))
  const back = storage.loadAppData(NOW)
  assert.deepEqual(back, d)
  // corrupt JSON → defaults + rescue copy, and saving is paused (the original is never overwritten)
  mem.setItem(storage.STORAGE_KEY, '{oops')
  const def = storage.loadAppData(NOW)
  assert.equal(prof(def).coins, 0)
  assert.equal(mem.getItem(storage.CORRUPT_KEY), '{oops')
  assert.equal(storage.getLoadIssue()!.kind, 'corrupt')
  assert.equal(storage.saveAppData(def), false)
  assert.equal(storage.getLastSaveError(), storage.SAVE_PAUSED_ERROR)
  assert.equal(mem.getItem(storage.STORAGE_KEY), '{oops')
  // "Start fresh" resumes saving
  assert.equal(storage.clearLoadIssue(), true)
  assert.equal(storage.getLoadIssue(), null)
  assert.equal(storage.getLastSaveError(), null)
  // quota errors never throw
  mem.failWrites = true
  assert.equal(storage.saveAppData(d), false)
  assert.ok(storage.getLastSaveError())
  mem.failWrites = false
  // debounced save + flush
  storage.scheduleSave(d)
  assert.equal(storage.hasPendingSave(), true)
  assert.equal(storage.flushSave(), true)
  assert.equal(storage.hasPendingSave(), false)
  assert.deepEqual(storage.loadAppData(NOW), d)
  storage.setStorageBackend(undefined)
})

await test('backup: export/import round trip', () => {
  const mem = new MemStorage()
  storage.setStorageBackend(mem)
  let d = ops.applyLineResult(fresh(), 'david', input(fakeLine('a', 4)), null).data
  d = ops.setPin(d, '1234').data
  d = patchProfile(d, 'minka', { coins: 2000 })
  d = ops.requestRedemption(d, 'minka', 'pokemon-pack', NOW).data
  const json = storage.exportBackup(d, NOW)
  // review fix #4: the parent PIN is never written to a backup file
  assert.equal(JSON.parse(json).data.parent.pin, null)
  assert.ok(!/"pin":\s*"1234"/.test(json))
  const noPin: AppData = { ...d, parent: { ...d.parent, pin: null } }
  const parsed = storage.parseBackup(json, NOW)
  assert.ok(parsed.ok)
  if (parsed.ok) assert.deepEqual(parsed.data, noPin)
  // raw AppData JSON is accepted too
  assert.ok(storage.parseBackup(JSON.stringify(d), NOW).ok)
  // Import onto a device with no PIN yet → still no PIN
  const res = storage.importBackup(json)
  assert.deepEqual(res, { ok: true })
  assert.deepEqual(storage.loadAppData(NOW), noPin)
  // Import onto a device that has a PIN → that PIN is kept
  storage.saveAppData(ops.setPin(fresh(), '8642').data)
  assert.deepEqual(storage.importBackup(json), { ok: true })
  const back = storage.loadAppData(NOW)
  assert.equal(back.parent.pin, '8642')
  assert.deepEqual(back.profiles, d.profiles)
  storage.setStorageBackend(undefined)
})

await test('storage: rejected saved data is never overwritten; rescue copies kept (review fix #3)', () => {
  const mem = new MemStorage()
  storage.setStorageBackend(mem)
  // A save written by a NEWER version of the app (e.g. an old cached build loads it).
  const newer = JSON.parse(JSON.stringify(patchProfile(fresh(), 'david', { coins: 1400, xp: 9000 }))) as Record<string, unknown>
  newer.version = 2
  const original = JSON.stringify(newer)
  mem.setItem(storage.STORAGE_KEY, original)
  const r = storage.loadAppDataDetailed(NOW)
  assert.equal(r.status, 'rejected')
  assert.equal(r.issue!.kind, 'newer-version')
  assert.equal(prof(r.data).coins, 0) // defaults in memory
  assert.equal(storage.getLoadIssue()!.kind, 'newer-version')
  // Playing with the defaults never writes them over the original
  const played = ops.selectProfile(r.data, 'david', NOW)
  assert.equal(storage.saveAppData(played), false)
  storage.scheduleSave(played)
  assert.equal(storage.flushSave(), false)
  assert.equal(mem.getItem(storage.STORAGE_KEY), original)
  assert.equal(mem.getItem(storage.CORRUPT_KEY), original)
  // A second, different rejected load never replaces the first rescue copy
  mem.setItem(storage.STORAGE_KEY, '{"version": 3, "garbage": true}')
  assert.equal(storage.loadAppDataDetailed(NOW).status, 'rejected')
  assert.equal(mem.getItem(storage.CORRUPT_KEY), original)
  assert.equal(mem.getItem(storage.CORRUPT_LATEST_KEY), '{"version": 3, "garbage": true}')
  // Invalid (not newer) data is rejected the same way
  mem.setItem(storage.STORAGE_KEY, JSON.stringify({ version: 1, profiles: [] }))
  assert.equal(storage.loadAppDataDetailed(NOW).issue!.kind, 'invalid')
  // A good backup import ends the paused state and is saved
  const good = patchProfile(fresh(), 'minka', { coins: 77 })
  assert.deepEqual(storage.importBackup(storage.exportBackup(good, NOW)), { ok: true })
  assert.equal(storage.getLoadIssue(), null)
  assert.equal(prof(storage.loadAppData(NOW), 'minka').coins, 77)
  assert.equal(storage.saveAppData(good), true)
  // A later successful load also clears a stale issue (e.g. another tab started fresh)
  mem.setItem(storage.STORAGE_KEY, '{broken')
  storage.loadAppData(NOW)
  assert.ok(storage.getLoadIssue())
  mem.setItem(storage.STORAGE_KEY, JSON.stringify(good))
  assert.equal(storage.loadAppDataDetailed(NOW).status, 'ok')
  assert.equal(storage.getLoadIssue(), null)
  storage.setStorageBackend(undefined)
})

await test('storage: "__proto__" keys in saved records are dropped', () => {
  const d = fresh()
  const txt = JSON.stringify(d).replace(
    '"lineStats":{}',
    '"lineStats":{"__proto__":{"attempts":1,"completions":1,"perfects":1,"box":5,"lastPracticed":1,"dueAt":1,"lastMistakes":0},"abc":{"attempts":1,"completions":1,"perfects":1,"box":2,"lastPracticed":1,"dueAt":1,"lastMistakes":0}}',
  )
  const v = storage.validateAppData(JSON.parse(txt), NOW)
  assert.ok(v.ok)
  if (v.ok) {
    const ls = v.data.profiles[0].lineStats
    assert.equal(Object.getPrototypeOf(ls), Object.prototype)
    assert.deepEqual(Object.keys(ls), ['abc'])
    assert.equal((ls as unknown as { box?: number }).box, undefined)
  }
})

await test('backup: garbage is rejected and nothing is applied', () => {
  const mem = new MemStorage()
  storage.setStorageBackend(mem)
  const good = fresh()
  storage.saveAppData(good)
  const before = mem.getItem(storage.STORAGE_KEY)
  const valid = JSON.parse(storage.exportBackup(good, NOW))
  const mut = (f: (o: any) => void): string => {
    const o = structuredClone(valid)
    f(o)
    return JSON.stringify(o)
  }
  const garbage: Array<[string, string]> = [
    ['empty', ''],
    ['text', 'hello'],
    ['null', 'null'],
    ['number', '42'],
    ['array', '[]'],
    ['empty object', '{}'],
    ['other app', mut((o) => (o.app = 'other-app'))],
    ['newer version', mut((o) => (o.version = 2))],
    ['newer data version', mut((o) => (o.data.version = 2))],
    ['no version', mut((o) => delete o.data.version)],
    ['no profiles', mut((o) => (o.data.profiles = []))],
    ['profiles not array', mut((o) => (o.data.profiles = 'x'))],
    ['negative coins', mut((o) => (o.data.profiles[0].coins = -5))],
    ['string coins', mut((o) => (o.data.profiles[0].coins = 'lots'))],
    ['missing xp', mut((o) => delete o.data.profiles[0].xp)],
    ['no owned', mut((o) => delete o.data.profiles[1].owned)],
    ['duplicate ids', mut((o) => (o.data.profiles[1].id = o.data.profiles[0].id))],
    ['bad pin', mut((o) => (o.data.parent.pin = '12'))],
    ['no parent', mut((o) => delete o.data.parent)],
    ['broken reward', mut((o) => (o.data.parent.rewards[0].cost = 'free'))],
    ['broken study', mut((o) => (o.data.studyOverride = { pgn: 5 }))],
    ['truncated', JSON.stringify(valid).slice(0, 200)],
  ]
  for (const [name, json] of garbage) {
    const r = storage.importBackup(json)
    assert.equal(r.ok, false, name)
    assert.ok(typeof r.error === 'string' && r.error.length > 0, name)
    assert.equal(mem.getItem(storage.STORAGE_KEY), before, `${name}: storage untouched`)
  }
  // Harmless gaps are repaired: unknown items dropped, free items re-added, bad equip reset
  const repaired = storage.parseBackup(
    mut((o) => {
      o.data.profiles[0].owned = ['board:ocean', 'board:does-not-exist']
      o.data.profiles[0].equipped = { board: 'lava', pieces: 'cburnett', effect: 'confetti', title: 'rookie' }
      delete o.data.profiles[0].history
      o.data.profiles[0].coins = 12.7
    }),
    NOW,
  )
  assert.ok(repaired.ok)
  if (repaired.ok) {
    const p = repaired.data.profiles[0]
    assert.ok(p.owned.includes('board:ocean') && p.owned.includes('board:green') && !p.owned.includes('board:does-not-exist'))
    assert.equal(p.equipped.board, 'green')
    assert.deepEqual(p.history, [])
    assert.equal(p.coins, 12)
  }
  storage.setStorageBackend(undefined)
})

// ---------------------------------------------------------------------------
// React store (imported under node; no DOM)
// ---------------------------------------------------------------------------

await test('appStore: actions work without a DOM; PIN flow; import is all-or-nothing', async () => {
  const mem = new MemStorage()
  storage.setStorageBackend(mem)
  const { actions, getAppData, getActiveProfile, subscribe } = await import('../src/store/appStore.ts')
  let notified = 0
  const unsub = subscribe(() => notified++)
  assert.equal(getActiveProfile(), null)
  assert.equal(actions.buyItem('board:ocean').error, 'no-profile')
  actions.selectProfile('david')
  assert.equal(getActiveProfile()!.id, 'david')
  assert.ok(notified > 0)
  // line result + duplicate protection
  const inp = input(fakeLine('a', 4), { now: Date.now() })
  const r1 = actions.applyLineResult(inp, null)
  const r2 = actions.applyLineResult(inp, null)
  assert.equal(r2, r1)
  assert.equal(r1.farmed, false)
  assert.equal(getActiveProfile()!.coins, r1.coins)
  assert.equal(actions.buyItem('board:ocean').error, 'not-enough-coins')
  // PIN
  assert.equal(actions.hasPin(), false)
  assert.equal(actions.verifyPin('0000'), false)
  assert.equal(actions.setPin('12a4').ok, false)
  assert.equal(actions.setPin('2468').ok, true)
  actions.lockParent()
  assert.equal(actions.setPin('1111').ok, false) // changing needs the current PIN or an unlocked session
  assert.equal(actions.setPin('1111', '2468').ok, true)
  assert.equal(actions.verifyPin('1111'), true)
  assert.equal(actions.isParentUnlocked(), true)
  // review fix #8: a kid picking a player locks the parent zone
  actions.selectProfile('minka')
  assert.equal(actions.isParentUnlocked(), false)
  actions.selectProfile('david')
  assert.equal(actions.verifyPin('1111'), true)
  // coins & buying
  assert.equal(actions.adjustCoins('david', 500, 'gift').ok, true)
  assert.equal(actions.buyItem('board:ocean').ok, true)
  assert.equal(actions.equipItem('board:ocean').ok, true)
  assert.equal(getActiveProfile()!.equipped.board, 'ocean')
  assert.equal(actions.requestRedemption('pokemon-pack').error, 'not-enough-coins')
  // review fix #7: an engine game submitted twice (same gameId) pays once
  const coins0 = getActiveProfile()!.coins
  const g1 = actions.applyEngineGame('win', 1600, 'game-1')
  const g2 = actions.applyEngineGame('win', 1600, 'game-1')
  assert.equal(g2, g1)
  assert.equal(g1.coins, 30)
  assert.equal(getActiveProfile()!.coins, coins0 + 30 + 50) // + 'Robot Beater'
  assert.equal(getActiveProfile()!.totals.engineWins, 1)
  assert.equal(actions.applyEngineGame('draw', 800, 'game-2').coins, 5)
  // backup: never contains the PIN; importing keeps this device's PIN
  const json = actions.exportBackup()
  assert.equal(JSON.parse(json).data.parent.pin, null)
  const before = getAppData()
  assert.equal(before.parent.pin, '1111')
  assert.equal(actions.importBackup('{"version":1}').ok, false)
  assert.equal(getAppData(), before)
  const imp = actions.importBackup(json)
  assert.equal(imp.ok, true)
  assert.deepEqual(getAppData(), before)
  assert.equal(getAppData().parent.pin, '1111')
  // storage module routes through the live store once the app store is up
  assert.equal(storage.importBackup('garbage').ok, false)
  assert.equal(getAppData(), getAppData())
  assert.ok(storage.flushSave())
  assert.ok(mem.getItem(storage.STORAGE_KEY)!.includes('"ocean"'))
  // PIN lockout after 5 wrong tries
  for (let i = 0; i < 5; i++) assert.equal(actions.verifyPin('9999'), false)
  assert.ok(actions.pinLockoutMs() > 0)
  assert.equal(actions.verifyPin('1111'), false) // even the right PIN is refused while locked
  actions.signOut()
  assert.equal(getActiveProfile(), null)
  assert.equal(actions.isParentUnlocked(), false)
  unsub()
  storage.setStorageBackend(undefined)
})

await test('parent ops: undo approve, undo gift, gifts that do not level up, unique names (review: parent #10, #12, #14)', () => {
  let d = patchProfile(fresh(), 'david', { coins: 2000 })
  const req = ops.requestRedemption(d, 'david', 'pokemon-pack', NOW)
  assert.ok(req.ok)
  const id = req.redemption!.id
  const ap = ops.resolveRedemption(req.data, 'david', id, true, NOW + 1000)
  assert.ok(ap.ok)
  const un = ops.unresolveRedemption(ap.data, 'david', id, NOW + 5000)
  assert.ok(un.ok)
  const back = prof(un.data).redemptions.find((r) => r.id === id)!
  assert.deepEqual([back.status, back.resolvedAt], ['pending', undefined])
  assert.equal(ops.unresolveRedemption(ap.data, 'david', id, NOW + 1000 + ops.UNDO_APPROVE_MS + 1).error, 'too-late')
  assert.equal(ops.unresolveRedemption(req.data, 'david', id, NOW + 2000).error, 'not-pending')
  // A 600-coin gift levels a new player up; "Undo" takes the coins AND the XP back.
  d = fresh()
  const g = ops.adjustCoins(d, 'minka', 600, '', NOW)
  assert.ok(g.levelUp)
  const u = ops.undoGift(g.data, 'minka', 600, NOW + 1)
  assert.deepEqual([prof(u.data, 'minka').coins, prof(u.data, 'minka').xp], [0, 0])
  // Giving back coins removed by mistake doesn't count toward the level.
  const rm = ops.adjustCoins(g.data, 'minka', -600, '', NOW + 2)
  const giveBack = ops.adjustCoins(rm.data, 'minka', 600, 'undo', NOW + 3, false)
  assert.deepEqual([prof(giveBack.data, 'minka').coins, prof(giveBack.data, 'minka').xp], [600, 600])
  // Names must be unique (any case); re-casing your own name is fine.
  const taken = ops.renameProfile(d, 'david', 'MINKA')
  assert.deepEqual([taken.ok, taken.error], [false, 'name-taken'])
  assert.equal(prof(ops.renameProfile(d, 'david', 'DAVID').data).name, 'DAVID')
  assert.equal(ops.renameProfile(d, 'david', '  ').message, 'Names need 1–20 letters.')
})

await test('parent ops: PIN resets are recorded, merged on import and pause approvals/gifts after a fallback reset (review: parent #1, #2, #11)', () => {
  let d = fresh()
  d = ops.setPin(d, '1234').data
  const r1 = ops.resetPin(d, '5555', NOW)
  const r2 = ops.resetPin(r1.data, '6666', NOW + HOUR, { fallback: true })
  assert.deepEqual(ops.pinResetTimes(r2.data.parent), [NOW, NOW + HOUR])
  assert.equal(ops.latestPinReset(r2.data.parent), NOW + HOUR)
  // Paused for 24 h: approving and gifting; declining and removing still work.
  d = patchProfile(r2.data, 'david', { coins: 2000 })
  const req = ops.requestRedemption(d, 'david', 'pokemon-pack', NOW + HOUR)
  assert.equal(ops.resolveRedemption(req.data, 'david', req.redemption!.id, true, NOW + 2 * HOUR).error, 'reset-cooldown')
  assert.ok(ops.resolveRedemption(req.data, 'david', req.redemption!.id, false, NOW + 2 * HOUR).ok)
  assert.equal(ops.adjustCoins(d, 'david', 10, '', NOW + 2 * HOUR).error, 'reset-cooldown')
  assert.ok(ops.adjustCoins(d, 'david', -10, '', NOW + 2 * HOUR).ok)
  assert.ok(ops.resolveRedemption(req.data, 'david', req.redemption!.id, true, NOW + HOUR + DAY + 1).ok)
  // Importing an OLD backup (no reset records, a PIN, a recovery hash, an ack) can't hide the reset or replace the PIN.
  const old: ParentSettings = { ...fresh().parent, pin: '0000', recoveryHash: 'abcdefgh12', pinResetAckAt: NOW + 10 * DAY, pinResetRequestedAt: 1 }
  const cur = { ...r2.data.parent, recoveryHash: ops.hashRecoveryCode('ABCD-EFGH-JKLM') }
  const m = ops.mergeParentOnImport(cur, old)
  assert.equal(m.pin, '6666')
  assert.equal(m.recoveryHash, cur.recoveryHash)
  assert.deepEqual(ops.pinResetTimes(m), [NOW, NOW + HOUR])
  assert.equal(m.pinFallbackResetAt, NOW + HOUR)
  assert.equal(m.pinResetAckAt, undefined)
  assert.equal(m.pinResetRequestedAt, undefined)
  // A device without a PIN takes the file's.
  assert.equal(ops.mergeParentOnImport(fresh().parent, old).pin, '0000')
})

await test('parent ops: forgot-PIN wait, recovery code, clock jumps (review: parent #1, #9)', () => {
  let d = fresh()
  const q = ops.requestPinReset(d, NOW)
  assert.equal(ops.pinResetReadyAt(q.data.parent), NOW + DAY)
  // Asking again doesn't restart the wait; the parent can cancel it.
  assert.equal(ops.requestPinReset(q.data, NOW + HOUR).data, q.data)
  assert.equal(ops.pinResetReadyAt(ops.cancelPinResetRequest(q.data).data.parent), null)
  // A reset clears the request.
  assert.equal(ops.resetPin(q.data, '1357', NOW + DAY, { fallback: true }).data.parent.pinResetRequestedAt, undefined)
  // Recovery code: case / dashes don't matter; too short never matches.
  d = ops.setRecoveryHash(d, ops.hashRecoveryCode('ab12-cd34')).data
  assert.ok(ops.recoveryCodeMatches(d.parent, 'AB12CD34'))
  assert.ok(ops.recoveryCodeMatches(d.parent, ' ab12 cd34 '))
  assert.ok(!ops.recoveryCodeMatches(d.parent, 'AB12CD35'))
  assert.equal(ops.setRecoveryHash(d, 'x').ok, false)
  // Backups never carry the recovery hash (nor the PIN).
  const backup = JSON.parse(storage.exportBackup(ops.setPin(d, '2468').data, NOW))
  assert.equal(backup.data.parent.recoveryHash, undefined)
  assert.equal(backup.data.parent.pin, null)
  // Clock: moving it back over an hour is recorded; forward (or staying) isn't.
  let c = ops.trackClock(fresh(), NOW)
  assert.equal(c.parent.lastSeenAt, NOW)
  assert.equal(ops.trackClock(c, NOW + 5 * 60000), c) // nothing to write
  c = ops.trackClock(c, NOW + 3 * DAY)
  assert.equal(c.parent.clockJumps, undefined)
  c = ops.trackClock(c, NOW)
  assert.deepEqual(c.parent.clockJumps, [{ from: NOW + 3 * DAY, to: NOW }])
  assert.equal(ops.trackClock(c, NOW + 60000), c) // no new jump every minute
  const v = storage.validateAppData(JSON.parse(JSON.stringify(c)), NOW)
  assert.ok(v.ok && v.data.parent.clockJumps?.length === 1)
  assert.equal(ops.clearClockJumps(c).parent.clockJumps, undefined)
})

await test('storage.importBackup (no live store) keeps the saved PIN even if the file has one (review: parent #11)', () => {
  const mem = new MemStorage()
  storage.setStorageBackend(mem)
  storage.registerLiveStore(null) // the storage-only path (an earlier test registered a live store)
  const mine = ops.setPin(fresh(), '4321').data
  mem.setItem(storage.STORAGE_KEY, JSON.stringify(mine))
  const crafted = JSON.stringify({ ...fresh(), parent: { ...fresh().parent, pin: '9999' } })
  assert.ok(storage.importBackup(crafted).ok)
  assert.equal(JSON.parse(mem.getItem(storage.STORAGE_KEY)!).parent.pin, '4321')
  storage.setStorageBackend(undefined)
})

await test('appStore: PIN lockout survives a reload; grown-up check backs off; forgot-PIN paths; undo restore (review: parent #1, #5, #11)', async () => {
  const mem = new MemStorage()
  storage.setStorageBackend(mem)
  const a = await freshAppStore('pinlock-a')
  assert.ok(a.actions.setPin('2468').ok)
  a.actions.lockParent()
  for (let i = 0; i < 5; i++) assert.equal(a.actions.verifyPin('0000'), false)
  assert.ok(a.actions.pinLockoutMs() > 0)
  storage.flushSave()
  // "Reload": a fresh store on the same storage still knows about the lockout.
  const b = await freshAppStore('pinlock-b')
  assert.ok(b.actions.pinLockoutMs() > 0)
  assert.equal(b.actions.verifyPin('2468'), false)
  // Grown-up question: two wrong answers, then a wait.
  assert.equal(b.actions.adultCheckLockoutMs(), 0)
  b.actions.adultCheckAnswered(false)
  assert.equal(b.actions.adultCheckLockoutMs(), 0)
  b.actions.adultCheckAnswered(false)
  assert.ok(b.actions.adultCheckLockoutMs() > 25_000)
  b.actions.adultCheckAnswered(true)
  assert.equal(b.actions.adultCheckLockoutMs(), 0)
  // Forgot the PIN without a code: a request first, the new PIN only after 24 h.
  assert.equal(b.actions.resetPinAfterWait('1111').ok, false)
  const req = b.actions.requestPinReset()
  assert.ok(req.ok && req.readyAt !== null && req.readyAt > Date.now() + 23 * HOUR)
  assert.equal(b.actions.resetPinAfterWait('1111').ok, false)
  // With the recovery code it works right away (and clears the lockout).
  assert.equal(b.actions.hasRecoveryCode(), false)
  mem.setItem('opening-quest.pinlock', JSON.stringify({ fails: 0, lockedUntil: 0 }))
  assert.equal(b.actions.verifyPin('2468'), true) // parent session open → may set a code
  assert.ok(b.actions.setRecoveryCode('K7PX-2MQR').ok)
  b.actions.lockParent()
  assert.equal(b.actions.resetPinWithCode('K7PX-2MQS', '1111').ok, false)
  assert.ok(b.actions.resetPinWithCode('k7px2mqr', '1111').ok)
  assert.equal(b.getAppData().parent.pin, '1111')
  assert.equal(b.getAppData().parent.pinFallbackResetAt, undefined) // with the code: no pause
  assert.equal(b.getAppData().parent.pinResetRequestedAt, undefined)
  assert.equal(b.actions.pinLockoutMs(), 0)
  // Undo restore: the data from just before the import comes back.
  b.actions.selectProfile('david')
  assert.ok(b.actions.adjustCoins('david', 77, 'x').ok)
  const epoch0 = b.getStoreEpoch()
  const other = JSON.stringify({ app: 'opening-quest', kind: 'backup', version: 1, exportedAt: 1, data: { ...fresh(), parent: { ...fresh().parent, pin: null } } })
  assert.ok(b.actions.importBackup(other).ok)
  assert.equal(b.getActiveProfile()!.coins, 0)
  assert.ok(b.getStoreEpoch() > epoch0) // the trainer's session memory starts clean
  assert.equal(b.getAppData().parent.pin, '1111') // device PIN kept
  assert.ok(b.actions.hasRestoreUndo())
  assert.ok(b.actions.undoRestore().ok)
  assert.equal(b.getActiveProfile()!.coins, 77)
  assert.equal(b.actions.hasRestoreUndo(), false)
  // Resetting a player also starts the session memory clean.
  const e1 = b.getStoreEpoch()
  b.actions.resetProfile('david')
  assert.ok(b.getStoreEpoch() > e1)
  storage.setStorageBackend(undefined)
})

type AppStoreModule = typeof import('../src/store/appStore.ts')
/** A fresh appStore instance (module state starts over) — the query string makes Node load it again. */
async function freshAppStore(tag: string): Promise<AppStoreModule> {
  const spec = `../src/store/appStore.ts?${tag}`
  return (await import(spec)) as AppStoreModule
}

await test('appStore: cold launch on a new day rolls every player over (review fix #2)', async () => {
  const mem = new MemStorage()
  storage.setStorageBackend(mem)
  const now = Date.now()
  const today = localDateKey(now)
  let d: AppData = { ...fresh(now), activeProfileId: 'david' }
  d = patchProfile(d, 'david', {
    daily: {
      date: addDaysToKey(today, -1),
      lines: 5,
      perfects: 5,
      coinsEarned: 200,
      goalClaimed: true,
      openingsPracticed: ['sicilian'],
      engineGamesRewarded: 3,
      distinctLineIds: ['a', 'b', 'c', 'd', 'e'],
    } as DailyStateX,
    streakDays: 4,
    lastGoalDate: addDaysToKey(today, -2),
  })
  d = patchProfile(d, 'minka', { daily: { ...(prof(d, 'minka').daily as DailyStateX), date: addDaysToKey(today, -3), lines: 2 } })
  mem.setItem(storage.STORAGE_KEY, JSON.stringify(d))
  const store = await freshAppStore('cold-launch')
  const p = store.getActiveProfile()!
  assert.deepEqual([p.daily.date, p.daily.lines, p.daily.goalClaimed, p.daily.engineGamesRewarded, p.streakDays], [today, 0, false, 0, 0])
  assert.equal(prof(store.getAppData(), 'minka').daily.date, today)
  // refreshDaily is a no-op (same object) when nothing changed
  const snap = store.getAppData()
  store.actions.refreshDaily()
  assert.equal(store.getAppData(), snap)
  storage.setStorageBackend(undefined)
})

await test('appStore: unreadable save is never overwritten; dismissLoadIssue starts fresh (review fix #3)', async () => {
  const mem = new MemStorage()
  storage.setStorageBackend(mem)
  const newer = JSON.parse(JSON.stringify(patchProfile(fresh(), 'david', { coins: 1400 }))) as Record<string, unknown>
  newer.version = 2
  const original = JSON.stringify(newer)
  mem.setItem(storage.STORAGE_KEY, original)
  const store = await freshAppStore('rejected-load')
  const s1 = store.getStorageStatus()
  assert.equal(s1.loadIssue!.kind, 'newer-version')
  assert.equal(s1.saveError, storage.SAVE_PAUSED_ERROR)
  assert.equal(store.getStorageStatus(), s1) // stable snapshot for useSyncExternalStore
  store.actions.selectProfile('david')
  storage.flushSave()
  assert.equal(mem.getItem(storage.STORAGE_KEY), original) // first tap no longer wipes the save
  let notified = 0
  const unsub = store.subscribe(() => notified++)
  assert.deepEqual(store.actions.dismissLoadIssue(), { ok: true })
  assert.ok(notified > 0)
  assert.deepEqual(store.getStorageStatus(), { loadIssue: null, saveError: null })
  assert.equal(JSON.parse(mem.getItem(storage.STORAGE_KEY)!).version, 1)
  assert.equal(mem.getItem(storage.CORRUPT_KEY), original)
  unsub()
  storage.setStorageBackend(undefined)
})

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.error('FAILED:', failures.join(' | '))
  process.exit(1)
}
