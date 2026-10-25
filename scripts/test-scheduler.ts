// Spaced-repetition scheduler tests. Run: node scripts/test-scheduler.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePgnFile } from '../src/chess/pgn.ts'
import { buildRepertoire } from '../src/chess/repertoire.ts'
import { OPENINGS } from '../src/data/openings.ts'
import {
  BOX_INTERVAL_DAYS,
  COACH_QUOTA,
  COACH_QUOTA_MAIN_ALL_GOLD,
  MAX_INTERVAL_DAYS,
  DAY_MS,
  coachEligible,
  coachTierShares,
  maxIntervalDaysFor,
  pickCoachLine,
  isDue,
  isDueToday,
  isMastered,
  lineWeight,
  openingProgress,
  pickLine,
  pickLineBalanced,
  seededRng,
  startOfNextLocalDay,
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
  // Due = due TODAY (local day): a review later today already counts (review fix: code #2).
  const midnight = startOfNextLocalDay(NOW)
  assert.ok(midnight > NOW && midnight - NOW <= DAY_MS + 3600_000)
  assert.equal(isDue(stats({ dueAt: midnight - 1 }), NOW), true)
  assert.equal(isDueToday(stats({ dueAt: midnight - 1 }), NOW), true)
  assert.equal(isDue(stats({ dueAt: midnight }), NOW), false)
  assert.equal(isDue(stats({ dueAt: NOW + DAY_MS }), NOW), false)
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
  assert.equal(lineWeight(stats({ box: 0, dueAt: NOW + DAY_MS }), NOW), 0.3)
  // Due later today: weighted like a line that is due now.
  assert.equal(lineWeight(stats({ box: 1, dueAt: startOfNextLocalDay(NOW) - 1 }), NOW), 3)
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
  // The first mastered line shows at least 1% (not 0% for days).
  const many = Array.from({ length: 154 }, (_, i) => fakeLine(`m${i}`))
  assert.equal(openingProgress(many, { m0: stats({ box: 3, dueAt: NOW + 4 * DAY_MS }) }, NOW).percentMastered, 1)
})

test('pickLineBalanced: each chapter gets a fair share, whatever its size (review: kid #4)', () => {
  const inCh = (id: string, ch: string): Line => ({ ...fakeLine(id), chapterId: ch })
  const pool = [
    ...Array.from({ length: 80 }, (_, i) => inCh(`big${i}`, 'closed')),
    ...Array.from({ length: 10 }, (_, i) => inCh(`small${i}`, 'open')),
    inCh('solo', 'side'),
  ]
  const rng = seededRng(99)
  const n = 9000
  const byCh: Record<string, number> = { closed: 0, open: 0, side: 0 }
  for (let i = 0; i < n; i++) byCh[pickLineBalanced(pool, {}, NOW, { rng }).chapterId]++
  for (const k of Object.keys(byCh)) assert.ok(Math.abs(byCh[k] / n - 1 / 3) < 0.03, `${k}: ${byCh[k] / n}`)
  // Plain pickLine is proportional to the number of lines (what Coach's Choice did before).
  const plain: Record<string, number> = { closed: 0, open: 0, side: 0 }
  for (let i = 0; i < n; i++) plain[pickLine(pool, {}, NOW, { rng }).chapterId]++
  assert.ok(plain.closed / n > 0.8)
  // Chapter weight = its most urgent line: a chapter with nothing due is rare.
  const st2: Record<string, LineStats> = {}
  for (let i = 0; i < 10; i++) st2[`small${i}`] = stats({ box: 3, dueAt: NOW + 3 * DAY_MS })
  const w: Record<string, number> = { closed: 0, open: 0, side: 0 }
  for (let i = 0; i < n; i++) w[pickLineBalanced(pool, st2, NOW, { rng }).chapterId]++
  assert.ok(w.open / n < 0.02, `open: ${w.open / n}`)
  // avoidLineId still works, and a lone line is returned.
  for (let i = 0; i < 300; i++) assert.notEqual(pickLineBalanced(pool, {}, NOW, { rng, avoidLineId: 'solo' }).id, 'solo')
  assert.equal(pickLineBalanced([pool[0]], {}, NOW, { rng, avoidLineId: pool[0].id }).id, pool[0].id)
  assert.throws(() => pickLineBalanced([], {}, NOW))
})

// ---------------------------------------------------------------------------
console.log('Review caps per tier (docs/practice-structure.md §2.1)')

/** updateLineStats exactly as it was before the per-tier cap (reference for the regression test). */
function updateLineStatsBefore(prev: LineStats | undefined, r: typeof perfect, now: number): LineStats {
  const p: LineStats = prev ?? { attempts: 0, completions: 0, perfects: 0, box: 0, lastPracticed: 0, dueAt: now, lastMistakes: 0 }
  const prevBox = Number.isFinite(p.box) ? Math.max(0, Math.min(5, Math.floor(p.box))) : 0
  const isPerfect = r.mistakes === 0 && r.hintsUsed === 0
  let box: number
  let dueAt: number
  if (r.learnMode) {
    box = prevBox
    dueAt = box === 0 ? now + DAY_MS : prev ? p.dueAt : now + BOX_INTERVAL_DAYS[box] * DAY_MS
  } else {
    if (isPerfect) box = Math.min(5, prevBox + 1)
    else if (r.mistakes <= 1 && !r.usedArrowHint) box = Math.max(1, prevBox)
    else box = 0
    dueAt = now + BOX_INTERVAL_DAYS[box] * DAY_MS
  }
  return {
    attempts: (p.attempts || 0) + 1,
    completions: (p.completions || 0) + 1,
    perfects: (p.perfects || 0) + (isPerfect && !r.learnMode ? 1 : 0),
    box,
    lastPracticed: now,
    dueAt,
    lastMistakes: r.mistakes,
  }
}

test('MAX_INTERVAL_DAYS / maxIntervalDaysFor', () => {
  assert.deepEqual(MAX_INTERVAL_DAYS, { main: 7, key: 12, deep: 16, planb: 16 })
  assert.equal(maxIntervalDaysFor('main'), 7)
  assert.equal(maxIntervalDaysFor('key'), 12)
  assert.equal(maxIntervalDaysFor('deep'), 16)
  assert.equal(maxIntervalDaysFor('planb'), 16)
  assert.equal(maxIntervalDaysFor(undefined), 16)
})

test('updateLineStats: the default cap (and 16) gives exactly the results of before', () => {
  const results = [
    perfect,
    { mistakes: 1, hintsUsed: 0, usedArrowHint: false, learnMode: false },
    { mistakes: 0, hintsUsed: 1, usedArrowHint: false, learnMode: false },
    { mistakes: 2, hintsUsed: 0, usedArrowHint: false, learnMode: false },
    { mistakes: 0, hintsUsed: 2, usedArrowHint: true, learnMode: false },
    { mistakes: 0, hintsUsed: 0, usedArrowHint: false, learnMode: true },
    { mistakes: 3, hintsUsed: 2, usedArrowHint: true, learnMode: true },
  ]
  const prevs: (LineStats | undefined)[] = [undefined]
  for (const box of [0, 1, 2, 3, 4, 5, 7, -1, NaN]) prevs.push(stats({ box, dueAt: NOW + 3 * DAY_MS, perfects: 4, completions: 6, attempts: 9 }))
  let n = 0
  for (const prev of prevs) {
    for (const r of results) {
      const want = updateLineStatsBefore(prev, r, NOW)
      assert.deepEqual(updateLineStats(prev, r, NOW), want)
      assert.deepEqual(updateLineStats(prev, r, NOW, 16), want)
      assert.deepEqual(updateLineStats(prev, r, NOW, maxIntervalDaysFor('deep')), want)
      assert.deepEqual(updateLineStats(prev, r, NOW, NaN), want, 'a bad cap falls back to the default')
      n++
    }
  }
  assert.equal(n, prevs.length * results.length)
})

test('updateLineStats with cap 7 / 12: box 5 comes back after 7 / 12 days; shorter gaps unchanged', () => {
  // Main line: box 4 -> 5 by a perfect run.
  assert.equal(updateLineStats(stats({ box: 4 }), perfect, NOW, 7).dueAt, NOW + 7 * DAY_MS)
  assert.equal(updateLineStats(stats({ box: 4 }), perfect, NOW, 7).box, 5)
  assert.equal(updateLineStats(stats({ box: 5 }), perfect, NOW, 7).dueAt, NOW + 7 * DAY_MS)
  // box 3 -> 4 = 8 days, capped at 7 for a main line, kept for a key reply
  assert.equal(updateLineStats(stats({ box: 3 }), perfect, NOW, 7).dueAt, NOW + 7 * DAY_MS)
  assert.equal(updateLineStats(stats({ box: 3 }), perfect, NOW, 12).dueAt, NOW + 8 * DAY_MS)
  assert.equal(updateLineStats(stats({ box: 4 }), perfect, NOW, 12).dueAt, NOW + 12 * DAY_MS)
  // shorter gaps are untouched
  assert.equal(updateLineStats(stats({ box: 2 }), perfect, NOW, 7).dueAt, NOW + 4 * DAY_MS)
  assert.equal(updateLineStats(stats({ box: 4 }), { mistakes: 2, hintsUsed: 0, usedArrowHint: false, learnMode: false }, NOW, 7).dueAt, NOW)
  // 1 mistake keeps box 5: still capped
  assert.equal(updateLineStats(stats({ box: 5 }), { mistakes: 1, hintsUsed: 0, usedArrowHint: false, learnMode: false }, NOW, 7).dueAt, NOW + 7 * DAY_MS)
})

test('updateLineStats learn mode with a cap: box kept, saved due date kept, new line back tomorrow', () => {
  const learn = { mistakes: 0, hintsUsed: 0, usedArrowHint: false, learnMode: true }
  // The learn branch's `now + interval` is capped too, but it is only reachable at box 0 (= 1 day).
  assert.equal(updateLineStats(undefined, learn, NOW, 7).dueAt, NOW + DAY_MS)
  assert.equal(updateLineStats(stats({ box: 0, dueAt: NOW + 30 * DAY_MS }), learn, NOW, 7).dueAt, NOW + DAY_MS)
  // A saved due date is not rewritten by a learn-mode run (the cap applies from the next review).
  const s = updateLineStats(stats({ box: 5, dueAt: NOW + 16 * DAY_MS }), learn, NOW, 7)
  assert.equal(s.box, 5)
  assert.equal(s.dueAt, NOW + 16 * DAY_MS)
})

// ---------------------------------------------------------------------------
console.log("Coach's Choice by tier")

const studyGames = parsePgnFile(readFileSync(new URL('../public/studies/opening-lines.pgn', import.meta.url), 'utf8'))
const study = OPENINGS.map((o) => buildRepertoire(o, studyGames, { maxPly: 30, enabledExtras: [] }))
const studyOf = (id: string) => study.find((r) => r.opening.id === id)!
/** Every line learned once (box 1, due now): everything but Plan B is eligible. */
const allLearned = (ls: Line[], extra: Partial<LineStats> = {}): Record<string, LineStats> =>
  Object.fromEntries(ls.map((l) => [l.id, stats({ box: 1, dueAt: NOW, ...extra })]))

test('constants', () => {
  assert.deepEqual(COACH_QUOTA, { main: 35, key: 40, deep: 25 })
  assert.equal(COACH_QUOTA_MAIN_ALL_GOLD, 20)
})

test('coachEligible: fresh -> main lines only; own box 1 or parent box 1 unlocks; Plan B never', () => {
  for (const rep of study) {
    const mains = rep.lines.filter((l) => l.tier === 'main')
    assert.deepEqual(coachEligible(rep.lines, {}), mains)
    // a main line with one good run unlocks its key replies (and nothing deeper)
    const m = mains[0]
    const kids = rep.lines.filter((l) => l.parentLineId === m.id && l.tier !== 'planb')
    const e1 = coachEligible(rep.lines, { [m.id]: stats({ box: 1 }) })
    assert.deepEqual(new Set(e1.map((l) => l.id)), new Set([...mains, ...kids].map((l) => l.id)))
    assert.ok(e1.every((l) => l.tier !== 'planb'))
    // box 0 (a failed run) unlocks nothing
    assert.deepEqual(coachEligible(rep.lines, { [m.id]: stats({ box: 0 }) }), mains)
    // a line's own box 1 unlocks it, whatever its parent
    const deep = rep.lines.find((l) => l.tier === 'deep')
    if (deep) assert.ok(coachEligible(rep.lines, { [deep.id]: stats({ box: 1 }) }).includes(deep))
    // Plan B: never, even when it and its parent are mastered
    const all5 = allLearned(rep.lines, { box: 5 })
    const e = coachEligible(rep.lines, all5)
    assert.equal(e.length, rep.lines.filter((l) => l.tier !== 'planb').length)
    assert.ok(!e.some((l) => l.tier === 'planb'))
    // order is kept
    assert.deepEqual(e.map((l) => l.index), e.map((l) => l.index).slice().sort((a, b) => a - b))
  }
})

test('coachTierShares on the real study (everything eligible): 35/40/25, QGD 50/33/17, all gold 20/85', () => {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
  const shares = (id: string, gold = false) => {
    const rep = studyOf(id)
    return coachTierShares(coachEligible(rep.lines, allLearned(rep.lines)), gold)
  }
  for (const id of ['sicilian', 'london']) {
    const s = shares(id)
    assert.ok(near(s.main, 0.35) && near(s.key, 0.4) && near(s.deep, 0.25), `${id}: ${JSON.stringify(s)}`)
  }
  const q = shares('vs-d4')
  assert.ok(near(q.main, 0.5) && near(q.key, 1 / 3) && near(q.deep, 1 / 6), JSON.stringify(q))
  const g = shares('sicilian', true)
  assert.ok(near(g.main, 20 / 85) && near(g.key, 40 / 85) && near(g.deep, 25 / 85), JSON.stringify(g))
  // fresh profile: main lines only
  assert.deepEqual(coachTierShares(coachEligible(studyOf('london').lines, {}), false), { main: 1, key: 0, deep: 0 })
  // nothing eligible: all 0; Plan B lines passed in are ignored
  assert.deepEqual(coachTierShares([], false), { main: 0, key: 0, deep: 0 })
  assert.deepEqual(coachTierShares(studyOf('london').lines.filter((l) => l.tier === 'planb'), false), { main: 0, key: 0, deep: 0 })
  for (const rep of study) {
    const s = coachTierShares(rep.lines, false)
    assert.ok(near(s.main + s.key + s.deep, 1))
  }
})

test('pickCoachLine: 20,000 seeded picks follow the tier shares (±1.5 points)', () => {
  for (const [id, gold] of [['sicilian', false], ['london', false], ['vs-d4', false], ['sicilian', true]] as const) {
    const rep = studyOf(id)
    const st = allLearned(rep.lines)
    if (gold) for (const l of rep.lines) if (l.tier === 'main') st[l.id] = { ...st[l.id], medal: 3 }
    const want = coachTierShares(coachEligible(rep.lines, st), gold)
    const rng = seededRng(2024)
    const n = 20000
    const got: Record<string, number> = { main: 0, key: 0, deep: 0, planb: 0 }
    for (let i = 0; i < n; i++) got[pickCoachLine(rep.lines, st, NOW, { rng }).tier!]++
    assert.equal(got.planb, 0)
    for (const t of ['main', 'key', 'deep'] as const) {
      assert.ok(Math.abs(got[t] / n - want[t]) < 0.015, `${id}${gold ? ' gold' : ''} ${t}: ${got[t] / n} vs ${want[t]}`)
    }
    console.log(`       ${id}${gold ? ' (all gold)' : ''}: main ${((got.main / n) * 100).toFixed(1)}% key ${((got.key / n) * 100).toFixed(1)}% deep ${((got.deep / n) * 100).toFixed(1)}%`)
  }
  // A fresh profile only ever gets main lines.
  const rng = seededRng(3)
  for (const rep of study) for (let i = 0; i < 300; i++) assert.equal(pickCoachLine(rep.lines, {}, NOW, { rng }).tier, 'main')
  // Deterministic for a given rng.
  const sic = studyOf('sicilian')
  const run = () => {
    const r = seededRng(77)
    return Array.from({ length: 40 }, () => pickCoachLine(sic.lines, allLearned(sic.lines), NOW, { rng: r }).id).join(',')
  }
  assert.equal(run(), run())
})

test('pickCoachLine: avoidLineId is respected (also when it is the only line of its tier)', () => {
  const rng = seededRng(11)
  for (const rep of study) {
    const st = allLearned(rep.lines)
    for (const avoid of rep.lines.filter((l) => l.tier !== 'planb')) {
      for (let i = 0; i < 60; i++) assert.notEqual(pickCoachLine(rep.lines, st, NOW, { rng, avoidLineId: avoid.id }).id, avoid.id)
    }
  }
  // QGD has one deep line: avoiding it moves its share to the other tiers.
  const q = studyOf('vs-d4')
  const deep = q.lines.filter((l) => l.tier === 'deep')
  assert.equal(deep.length, 1)
  const tiers = new Set<string>()
  for (let i = 0; i < 500; i++) tiers.add(pickCoachLine(q.lines, allLearned(q.lines), NOW, { rng, avoidLineId: deep[0].id }).tier!)
  assert.deepEqual([...tiers].sort(), ['key', 'main'])
  // The only eligible line is returned even when avoided.
  const qx = q.lines.filter((l) => l.chapterTitle === 'QGD: Exchange variation')
  assert.equal(qx.length, 1)
  assert.equal(pickCoachLine(qx, {}, NOW, { rng, avoidLineId: qx[0].id }), qx[0])
})

test('pickCoachLine: falls back when nothing is eligible; throws on no lines', () => {
  const rng = seededRng(5)
  // Unclassified lines (no tier = deep, never learned): still picks one of them.
  for (let i = 0; i < 50; i++) assert.ok(lines.includes(pickCoachLine(lines, {}, NOW, { rng })))
  // Only Plan B lines on offer (the opponent's re-pick after the kid chose a Plan B move): one of them.
  const planb = studyOf('sicilian').lines.filter((l) => l.tier === 'planb').slice(0, 5)
  for (let i = 0; i < 50; i++) assert.ok(planb.includes(pickCoachLine(planb, {}, NOW, { rng })))
  // Candidates without an eligible line but with non-Plan-B lines: a non-Plan-B one.
  const sic = studyOf('sicilian')
  const mixed = [...planb, ...sic.lines.filter((l) => l.tier === 'deep').slice(0, 2)]
  for (let i = 0; i < 50; i++) assert.equal(pickCoachLine(mixed, {}, NOW, { rng }).tier, 'deep')
  assert.throws(() => pickCoachLine([], {}, NOW))
})

test('pickCoachLine: no key or deep line comes up more often than a main line (equal urgency)', () => {
  for (const o of OPENINGS) {
    const rep = studyOf(o.id)
    const stats: Record<string, LineStats> = {}
    for (const l of rep.lines)
      stats[l.id] = { attempts: 1, completions: 1, perfects: 1, box: 1, lastPracticed: NOW - DAY_MS, dueAt: NOW - 1000, lastMistakes: 0 }
    const rng = seededRng(11)
    const n = new Map<string, number>()
    const N = 20000
    for (let i = 0; i < N; i++) {
      const l = pickCoachLine(rep.lines, stats, NOW, { rng })
      n.set(l.id, (n.get(l.id) ?? 0) + 1)
    }
    const share = (l: Line) => (n.get(l.id) ?? 0) / N
    const minMain = Math.min(...rep.lines.filter((l) => l.tier === 'main').map(share))
    for (const l of rep.lines.filter((x) => x.tier === 'key' || x.tier === 'deep'))
      assert.ok(share(l) <= minMain + 0.01, `${o.id} ${l.tier} ${l.chapterTitle} ${l.name}: ${(share(l) * 100).toFixed(1)}% > main ${(minMain * 100).toFixed(1)}%`)
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
