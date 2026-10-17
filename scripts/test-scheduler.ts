// Spaced-repetition scheduler tests. Run: node scripts/test-scheduler.ts
import assert from 'node:assert/strict'
import {
  BOX_INTERVAL_DAYS,
  DAY_MS,
  isDue,
  isMastered,
  lineWeight,
  openingProgress,
  pickLine,
  seededRng,
  updateLineStats,
} from '../src/chess/scheduler.ts'
import type { Line, LineStats } from '../src/types.ts'

let passed = 0
let failed = 0
function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL ${name}`)
    console.log(e)
  }
}

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const perfect = { mistakes: 0, hintsUsed: 0, usedArrowHint: false, learnMode: false }
const stats = (p: Partial<LineStats>): LineStats => ({
  attempts: 1,
  completions: 1,
  perfects: 0,
  box: 0,
  lastPracticed: NOW - DAY_MS,
  dueAt: NOW,
  lastMistakes: 0,
  ...p,
})
const fakeLine = (id: string): Line => ({
  id,
  openingId: 'o',
  chapterId: 'c',
  chapterTitle: 'C',
  index: 0,
  indexInChapter: 0,
  name: id,
  startFen: '',
  moves: [],
  userMoveCount: 1,
  hasOpponentBlunder: false,
})

console.log('Scheduler')

test('constants', () => {
  assert.deepEqual(BOX_INTERVAL_DAYS, [0, 1, 2, 4, 8, 16])
})

test('isMastered / isDue', () => {
  assert.equal(isMastered(undefined), false)
  assert.equal(isMastered(stats({ box: 2 })), false)
  assert.equal(isMastered(stats({ box: 3 })), true)
  assert.equal(isMastered(stats({ box: 5 })), true)
  assert.equal(isDue(undefined, NOW), true, 'unseen counts as due')
  assert.equal(isDue(stats({ dueAt: NOW }), NOW), true)
  assert.equal(isDue(stats({ dueAt: NOW + 1 }), NOW), false)
})

test('perfect: box + 1 (max 5), dueAt = now + interval, counters', () => {
  const s1 = updateLineStats(undefined, perfect, NOW)
  assert.deepEqual(s1, { attempts: 1, completions: 1, perfects: 1, box: 1, lastPracticed: NOW, dueAt: NOW + DAY_MS, lastMistakes: 0 })
  let s = s1
  const boxes = [1]
  for (let i = 0; i < 6; i++) {
    s = updateLineStats(s, perfect, NOW)
    boxes.push(s.box)
    assert.equal(s.dueAt, NOW + BOX_INTERVAL_DAYS[s.box] * DAY_MS)
  }
  assert.deepEqual(boxes, [1, 2, 3, 4, 5, 5, 5])
  assert.equal(s.perfects, 7)
  assert.equal(s.completions, 7)
})

test('1 mistake, no arrow hint: box unchanged, min 1', () => {
  const one = { mistakes: 1, hintsUsed: 0, usedArrowHint: false, learnMode: false }
  assert.equal(updateLineStats(undefined, one, NOW).box, 1)
  assert.equal(updateLineStats(stats({ box: 0 }), one, NOW).box, 1)
  const s = updateLineStats(stats({ box: 4 }), one, NOW)
  assert.equal(s.box, 4)
  assert.equal(s.dueAt, NOW + 8 * DAY_MS)
  assert.equal(s.perfects, 0)
  assert.equal(s.lastMistakes, 1)
  // a piece-highlight hint (no arrow) with 0 mistakes is treated the same way
  assert.equal(updateLineStats(stats({ box: 3 }), { mistakes: 0, hintsUsed: 1, usedArrowHint: false, learnMode: false }, NOW).box, 3)
})

test('otherwise: box 0, due now', () => {
  for (const r of [
    { mistakes: 2, hintsUsed: 0, usedArrowHint: false, learnMode: false },
    { mistakes: 1, hintsUsed: 2, usedArrowHint: true, learnMode: false },
    { mistakes: 0, hintsUsed: 2, usedArrowHint: true, learnMode: false },
  ]) {
    const s = updateLineStats(stats({ box: 4 }), r, NOW)
    assert.equal(s.box, 0)
    assert.equal(s.dueAt, NOW)
  }
})

test('learn mode: box unchanged; box 0 -> due tomorrow; otherwise schedule kept; not a perfect', () => {
  const learn = { mistakes: 0, hintsUsed: 0, usedArrowHint: false, learnMode: true }
  const s0 = updateLineStats(undefined, learn, NOW)
  assert.equal(s0.box, 0)
  assert.equal(s0.dueAt, NOW + DAY_MS)
  assert.equal(s0.perfects, 0)
  assert.equal(s0.completions, 1)
  const prev = stats({ box: 3, dueAt: NOW + 2 * DAY_MS })
  const s3 = updateLineStats(prev, learn, NOW)
  assert.equal(s3.box, 3)
  assert.equal(s3.dueAt, NOW + 2 * DAY_MS)
  assert.equal(updateLineStats(stats({ box: 2 }), { ...learn, mistakes: 5 }, NOW).box, 2)
})

test('weights: unseen 4, overdue 3 + days (cap 10), not due 0.3/(box+1)', () => {
  assert.equal(lineWeight(undefined, NOW), 4)
  assert.equal(lineWeight(stats({ dueAt: NOW }), NOW), 3)
  assert.equal(lineWeight(stats({ dueAt: NOW - 2 * DAY_MS }), NOW), 5)
  assert.equal(lineWeight(stats({ dueAt: NOW - 1.5 * DAY_MS }), NOW), 4.5)
  assert.equal(lineWeight(stats({ dueAt: NOW - 30 * DAY_MS }), NOW), 10)
  assert.equal(lineWeight(stats({ box: 0, dueAt: NOW + 1 }), NOW), 0.3)
  assert.ok(Math.abs(lineWeight(stats({ box: 2, dueAt: NOW + DAY_MS }), NOW) - 0.1) < 1e-12)
  assert.ok(Math.abs(lineWeight(stats({ box: 5, dueAt: NOW + DAY_MS }), NOW) - 0.05) < 1e-12)
})

test('seededRng is deterministic and in [0,1)', () => {
  const a = seededRng(42)
  const b = seededRng(42)
  const xs = Array.from({ length: 1000 }, () => a())
  const ys = Array.from({ length: 1000 }, () => b())
  assert.deepEqual(xs, ys)
  assert.ok(xs.every((x) => x >= 0 && x < 1))
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, seededRng(43)))
})

const lines = ['a', 'b', 'c', 'd'].map(fakeLine)
const st: Record<string, LineStats> = {
  // a: unseen (4), b: overdue 2 days (5), c: not due box 2 (0.1), d: not due box 0 (0.3)
  b: stats({ box: 1, dueAt: NOW - 2 * DAY_MS }),
  c: stats({ box: 2, dueAt: NOW + DAY_MS }),
  d: stats({ box: 0, dueAt: NOW + DAY_MS }),
}

test('pickLine: deterministic with a seeded rng', () => {
  const run = (seed: number) => {
    const rng = seededRng(seed)
    return Array.from({ length: 50 }, () => pickLine(lines, st, NOW, { rng }).id).join('')
  }
  assert.equal(run(7), run(7))
  assert.notEqual(run(7), run(8))
})

test('pickLine: picks by cumulative weight (rng boundaries)', () => {
  // total = 4 + 5 + 0.1 + 0.3 = 9.4; order a, b, c, d
  const at = (x: number) => pickLine(lines, st, NOW, { rng: () => x }).id
  assert.equal(at(0), 'a')
  assert.equal(at(3.99 / 9.4), 'a')
  assert.equal(at(4.01 / 9.4), 'b')
  assert.equal(at(8.99 / 9.4), 'b')
  assert.equal(at(9.05 / 9.4), 'c')
  assert.equal(at(9.2 / 9.4), 'd')
  assert.equal(at(0.999999), 'd')
})

test('pickLine: frequencies follow the weights', () => {
  const rng = seededRng(123)
  const n = 20000
  const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 }
  for (let i = 0; i < n; i++) counts[pickLine(lines, st, NOW, { rng }).id]++
  const expect: Record<string, number> = { a: 4 / 9.4, b: 5 / 9.4, c: 0.1 / 9.4, d: 0.3 / 9.4 }
  for (const k of Object.keys(expect)) assert.ok(Math.abs(counts[k] / n - expect[k]) < 0.015, `${k}: ${counts[k] / n} vs ${expect[k]}`)
})

test('pickLine: avoidLineId is avoided unless it is the only line', () => {
  const rng = seededRng(1)
  for (let i = 0; i < 500; i++) assert.notEqual(pickLine(lines, st, NOW, { rng, avoidLineId: 'b' }).id, 'b')
  assert.equal(pickLine([lines[1]], st, NOW, { rng, avoidLineId: 'b' }).id, 'b')
  assert.equal(pickLine(lines, st, NOW, { rng: () => 0, avoidLineId: 'a' }).id, 'b')
  assert.throws(() => pickLine([], st, NOW))
})

test('openingProgress', () => {
  const p = openingProgress(lines, { ...st, a: stats({ box: 3, dueAt: NOW + 4 * DAY_MS }) }, NOW)
  assert.deepEqual(p, { total: 4, seen: 4, mastered: 1, due: 1, percentMastered: 25 })
  const q = openingProgress(lines, {}, NOW)
  assert.deepEqual(q, { total: 4, seen: 0, mastered: 0, due: 0, percentMastered: 0 })
  assert.deepEqual(openingProgress([], {}, NOW), { total: 0, seen: 0, mastered: 0, due: 0, percentMastered: 0 })
  // 2 of 3 mastered -> 66 (floored, so 100% only when everything is mastered)
  const three = lines.slice(0, 3)
  const r = openingProgress(three, { a: stats({ box: 3, dueAt: NOW + 1 }), b: stats({ box: 4, dueAt: NOW + 1 }) }, NOW)
  assert.equal(r.percentMastered, 66)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
