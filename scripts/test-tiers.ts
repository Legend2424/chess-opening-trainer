// Practice tiers (docs/practice-structure.md §1–2, §7). Run: node scripts/test-tiers.ts
//
// The snapshots below are measured on the bundled study ("Opening lines for Tournaments"). When the
// study file is replaced, re-check the numbers against the spec's tables (and re-take ID_SNAPSHOT).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parsePgnFile } from '../src/chess/pgn.ts'
import { buildRepertoire, stableHash, userColorOf } from '../src/chess/repertoire.ts'
import {
  BRANCH_START_PARENT_BOX,
  TIER_META,
  TIER_ORDER,
  branchStartPly,
  classifyLines,
  estimateMinutes,
  findMoveConflicts,
  lapLines,
  mainAlternative,
  mainRoundQueue,
  nextLapLine,
  tierCounts,
  tierOf,
} from '../src/chess/lineTiers.ts'
import { seededRng } from '../src/chess/scheduler.ts'
import { OPENINGS } from '../src/data/openings.ts'
import type { Line, LineStats, LineTier, OpeningDef, Repertoire } from '../src/types.ts'

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

const games = parsePgnFile(readFileSync(new URL('../public/studies/opening-lines.pgn', import.meta.url), 'utf8'))
const build = (maxPly: number, def: OpeningDef) => buildRepertoire(def, games, { maxPly, enabledExtras: def.extraChapters.map((c) => c.id) })
const reps = new Map<number, Repertoire[]>()
for (const maxPly of [0, 20, 30, 40]) reps.set(maxPly, OPENINGS.map((o) => build(maxPly, o)))
const reps30 = reps.get(30)!
const repOf = (id: string) => reps30.find((r) => r.opening.id === id)!

const TIER_FIELDS = ['tier', 'deviations', 'branchPly', 'parentLineId', 'ownUserMoves', 'startPly'] as const
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const kidMovesFrom = (l: Line, u: 'w' | 'b', from: number) => l.moves.slice(from).filter((m) => m.color === u).length
const stats = (p: Partial<LineStats>): LineStats => ({ attempts: 1, completions: 1, perfects: 0, box: 0, lastPracticed: 0, dueAt: 0, lastMistakes: 0, ...p })

console.log('Tiers')

test('TIER_ORDER / TIER_META', () => {
  assert.deepEqual(TIER_ORDER, ['main', 'key', 'deep', 'planb'])
  assert.deepEqual(
    TIER_ORDER.map((t) => `${TIER_META[t].emoji} ${TIER_META[t].name} / ${TIER_META[t].plural}`),
    ['⭐ Main line / Main lines', '🔑 Key reply / Key replies', '🌿 Deeper line / Deeper lines', '🅱️ Plan B / Plan B lines'],
  )
  for (const t of TIER_ORDER) assert.ok(TIER_META[t].hint.length > 0)
  assert.equal(BRANCH_START_PARENT_BOX, 3)
})

// §1.3: [lines, main, key, deep, planb, kid moves from move 1, lap kid moves] per chapter.
const SNAPSHOT_30: Record<string, Record<string, number[]>> = {
  sicilian: {
    'Open Sicilian': [6, 1, 2, 2, 1, 72, 52],
    'Alapin (2.c3)': [17, 1, 4, 2, 10, 184, 111],
    'Delayed Alapin (2.Nf3 Nc6 3.c3)': [4, 1, 0, 0, 3, 47, 32],
    'Smith-Morra Gambit': [4, 1, 1, 0, 2, 40, 34],
    'Closed Sicilian (2.Nc3)': [13, 1, 4, 3, 5, 108, 80],
    'Side lines': [10, 1, 3, 2, 4, 91, 79],
  },
  london: {
    'All the variations': [20, 1, 4, 11, 4, 182, 122],
    'Against ...c5': [12, 1, 7, 1, 3, 125, 110],
    'Old Benoni (1...c5)': [16, 1, 3, 3, 9, 123, 90],
    "Jobava vs King's Indian": [7, 1, 1, 1, 4, 74, 44],
  },
  'vs-d4': {
    'QGD: White plays 5.Bg5': [4, 1, 1, 1, 1, 48, 33],
    'QGD: White plays 5.Bf4': [14, 1, 1, 0, 12, 153, 82],
    'QGD: Exchange variation': [1, 1, 0, 0, 0, 11, 11],
  },
}

test('snapshot at maxPly 30: per-chapter counts and kid moves (§1.3); totals 13 / 31 / 26 / 58', () => {
  const total: Record<LineTier, number> = { main: 0, key: 0, deep: 0, planb: 0 }
  let full = 0
  let lap = 0
  for (const rep of reps30) {
    const u = userColorOf(rep.opening)
    const got: Record<string, number[]> = {}
    for (const ch of rep.chapters) {
      const xs = rep.lines.filter((l) => l.chapterId === ch.id)
      const c = tierCounts(xs)
      const f = sum(xs.map((l) => l.userMoveCount))
      // Lap kid moves: main and key from move 1, deep and Plan B from startPly (parents mastered).
      const k = sum(xs.map((l) => (l.tier === 'main' || l.tier === 'key' ? l.userMoveCount : kidMovesFrom(l, u, l.startPly ?? 0))))
      got[ch.title] = [xs.length, c.main, c.key, c.deep, c.planb, f, k]
      for (const t of TIER_ORDER) total[t] += c[t]
      full += f
      lap += k
    }
    assert.deepEqual(got, SNAPSHOT_30[rep.opening.id], rep.opening.id)
  }
  assert.deepEqual(total, { main: 13, key: 31, deep: 26, planb: 58 })
  assert.equal(full, 1258)
  assert.equal(lap, 880)
})

test('stable across move caps (§1.4): main 13 and key 31 at maxPly 0 / 20 / 30 / 40', () => {
  const want: Record<number, number[]> = { 0: [13, 31, 28, 59], 20: [13, 31, 24, 56], 30: [13, 31, 26, 58], 40: [13, 31, 26, 58] }
  for (const [maxPly, rs] of reps) {
    const t: Record<LineTier, number> = { main: 0, key: 0, deep: 0, planb: 0 }
    for (const rep of rs) {
      const c = tierCounts(rep.lines)
      for (const k of TIER_ORDER) t[k] += c[k]
    }
    assert.deepEqual([t.main, t.key, t.deep, t.planb], want[maxPly], `maxPly ${maxPly}`)
  }
})

test('every chapter with lines has exactly one main line, its indexInChapter 0', () => {
  for (const rs of reps.values()) {
    for (const rep of rs) {
      for (const ch of rep.chapters) {
        const xs = rep.lines.filter((l) => l.chapterId === ch.id)
        if (!xs.length) continue
        const mains = xs.filter((l) => l.tier === 'main')
        assert.equal(mains.length, 1, `${rep.opening.id} ${ch.title}`)
        assert.equal(mains[0].indexInChapter, 0)
        assert.equal(mains[0].deviations, 0)
        assert.equal(mains[0].branchPly, 0)
        assert.equal(mains[0].startPly, 0)
        assert.equal(mains[0].parentLineId, undefined)
        assert.equal(mains[0].ownUserMoves, mains[0].userMoveCount)
      }
    }
  }
})

test('tier rules, parents, branchPly, startPly, ownUserMoves (every build)', () => {
  let nonMain = 0
  let keyLines = 0
  let lastDevMatches = 0
  for (const rs of reps.values()) {
    for (const rep of rs) {
      const u = userColorOf(rep.opening)
      const byId = new Map(rep.lines.map((l) => [l.id, l]))
      for (const line of rep.lines) {
        const ch = rep.chapters.find((c) => c.id === line.chapterId)!
        // Deviations recounted from the tree.
        const devs: number[] = []
        line.moves.forEach((m, k) => {
          const sib = k === 0 ? ch.roots : line.moves[k - 1].children
          if (sib[0] !== m) devs.push(k)
        })
        const kidDev = devs.some((k) => line.moves[k].color === u)
        assert.equal(line.deviations, devs.length)
        const tier: LineTier = devs.length === 0 ? 'main' : kidDev ? 'planb' : devs.length === 1 ? 'key' : 'deep'
        assert.equal(line.tier, tier, `${line.chapterTitle} ${line.name}`)
        assert.equal(line.ownUserMoves, kidMovesFrom(line, u, line.branchPly!))
        if (tier === 'main') continue
        nonMain++
        // Parent: an earlier line of the same chapter; shares exactly branchPly plies (same nodes).
        const parent = byId.get(line.parentLineId!)
        assert.ok(parent, 'parent exists')
        assert.equal(parent.chapterId, line.chapterId)
        assert.ok(parent.indexInChapter < line.indexInChapter)
        const bp = line.branchPly!
        assert.ok(bp > 0 && bp < line.moves.length, 'branches inside the line')
        for (let k = 0; k < bp; k++) assert.equal(line.moves[k], parent.moves[k])
        assert.ok(bp === parent.moves.length || parent.moves[bp] !== line.moves[bp])
        // No earlier line of the chapter shares more.
        for (const o of rep.lines) {
          if (o.chapterId !== line.chapterId || o.indexInChapter >= line.indexInChapter) continue
          let c = 0
          while (c < o.moves.length && c < line.moves.length && o.moves[c] === line.moves[c]) c++
          assert.ok(c <= bp)
          if (c === bp) assert.ok(o.indexInChapter >= parent.indexInChapter, 'first one wins a tie')
        }
        if (tier === 'key') {
          keyLines++
          assert.equal(bp, devs[0], `${line.chapterTitle} ${line.name}: a key line branches at its only deviation`)
        }
        if (bp === devs[devs.length - 1]) lastDevMatches++
        // startPly: the kid's last move before branchPly, or 0 when there is none.
        const sp = line.startPly!
        const kidBefore = line.moves.slice(0, bp).map((m, k) => (m.color === u ? k : -1)).filter((k) => k >= 0)
        if (kidBefore.length === 0) assert.equal(sp, 0)
        else {
          assert.equal(sp, kidBefore[kidBefore.length - 1])
          assert.equal(line.moves[sp].color, u)
        }
        assert.ok(sp < bp)
        for (let k = sp + 1; k < bp; k++) assert.notEqual(line.moves[k].color, u, 'no kid move between startPly and branchPly')
      }
    }
  }
  console.log(`       ${nonMain} non-main lines, ${keyLines} key lines; branchPly = last deviation for ${lastDevMatches}`)
  // §1.2: 113 of 115 at maxPly 30 (the two Alapin lines whose exact parent was cut branch earlier).
  const at30 = reps30.flatMap((rep) => rep.lines.filter((l) => l.tier !== 'main'))
  const match30 = at30.filter((l) => {
    const ch = reps30.find((r) => r.opening.id === l.openingId)!.chapters.find((c) => c.id === l.chapterId)!
    let last = -1
    l.moves.forEach((m, k) => {
      if ((k === 0 ? ch.roots : l.moves[k - 1].children)[0] !== m) last = k
    })
    return last === l.branchPly
  })
  assert.equal(at30.length, 115)
  assert.equal(match30.length, 113)
})

test('parent tiers (§1.2): key <- main, deep <- key or deep', () => {
  for (const rep of reps30) {
    const byId = new Map(rep.lines.map((l) => [l.id, l]))
    for (const l of rep.lines) {
      if (l.tier === 'key') assert.equal(byId.get(l.parentLineId!)!.tier, 'main')
      if (l.tier === 'deep') assert.ok(['key', 'deep'].includes(byId.get(l.parentLineId!)!.tier!))
    }
  }
})

test('classifyLines is idempotent and leaves id, index, indexInChapter, name and moves unchanged', () => {
  for (const rep of reps30) {
    const u = userColorOf(rep.opening)
    const before = rep.lines.map((l) => ({ ...l }))
    classifyLines(rep.chapters, rep.lines, u)
    rep.lines.forEach((l, i) => {
      for (const k of Object.keys(before[i]) as (keyof Line)[]) assert.equal(l[k], before[i][k], `${k}`)
      assert.deepEqual(Object.keys(l).sort(), Object.keys(before[i]).sort())
    })
    // From scratch (tier fields stripped, lines in a shuffled array): the same result.
    const stripped = rep.lines.map((l) => {
      const c = { ...l }
      for (const f of TIER_FIELDS) delete c[f]
      return c
    })
    const shuffled = stripped.slice().reverse()
    classifyLines(rep.chapters, shuffled, u)
    stripped.forEach((l, i) => {
      for (const f of TIER_FIELDS) assert.equal(l[f], before[i][f], f)
      assert.equal(l.moves, before[i].moves)
      for (const k of ['id', 'index', 'indexInChapter', 'name'] as const) assert.equal(l[k], before[i][k])
    })
  }
})

// sha256 (first 16 hex) of `${id}|${index}|${indexInChapter}|${name}` per line, taken from a build
// BEFORE classification existed (same study): ids, order and names must not move.
const ID_SNAPSHOT: Record<string, string> = {
  'sicilian@0': '1668c73c49085cf5:54',
  'london@0': '3b0f3f14fdf53b26:58',
  'vs-d4@0': 'd44a17123b53ca67:19',
  'sicilian@20': '329bb74cda0ae746:53',
  'london@20': '54fba835977914c7:53',
  'vs-d4@20': '43cbd3e9cc46784d:18',
  'sicilian@30': '8f670bb2af43cc38:54',
  'london@30': 'e5f5dd2d6ed6f36d:55',
  'vs-d4@30': '96be96662997e5a5:19',
  'sicilian@40': '1668c73c49085cf5:54',
  'london@40': '6fbf13733bfaf18d:55',
  'vs-d4@40': 'd44a17123b53ca67:19',
}

test('line ids, order and names are the same as before classification (saved progress keeps applying)', () => {
  for (const [maxPly, rs] of reps) {
    for (const rep of rs) {
      const s = rep.lines.map((l) => `${l.id}|${l.index}|${l.indexInChapter}|${l.name}`).join('\n')
      const got = createHash('sha256').update(s).digest('hex').slice(0, 16) + ':' + rep.lines.length
      assert.equal(got, ID_SNAPSHOT[`${rep.opening.id}@${maxPly}`], `${rep.opening.id} @${maxPly}`)
      // …and an id is still the hash of the moves only (never of a tier field).
      for (const l of rep.lines) {
        const h = stableHash(`${rep.opening.id}|${l.chapterId}|${l.moves.map((m) => m.uci).join(' ')}`)
        assert.ok(l.id === h || l.id.startsWith(`${h}-`))
      }
    }
  }
})

test('tierOf / tierCounts: an unclassified line counts as deep', () => {
  const l = { ...repOf('sicilian').lines[0] }
  delete l.tier
  assert.equal(tierOf(l), 'deep')
  assert.deepEqual(tierCounts([l, repOf('sicilian').lines[0]]), { main: 1, key: 0, deep: 1, planb: 0 })
  assert.deepEqual(tierCounts([]), { main: 0, key: 0, deep: 0, planb: 0 })
})

console.log('Laps, rounds, branch starts')

test('lapLines: tier order, index order within a tier, Plan B off; sizes 54/55/19 and 29/35/6', () => {
  const sizes: number[] = []
  const must: number[] = []
  for (const rep of reps30) {
    for (const on of [true, false]) {
      const ls = lapLines(rep.lines, on)
      ;(on ? sizes : must).push(ls.length)
      for (let i = 1; i < ls.length; i++) {
        const a = TIER_ORDER.indexOf(tierOf(ls[i - 1]))
        const b = TIER_ORDER.indexOf(tierOf(ls[i]))
        assert.ok(a <= b, 'tier order')
        if (a === b) assert.ok(ls[i - 1].index < ls[i].index, 'index order')
      }
      if (!on) assert.ok(!ls.some((l) => l.tier === 'planb'))
      else assert.equal(ls.length, rep.lines.length)
    }
    assert.notEqual(lapLines(rep.lines, true), rep.lines, 'a new array')
  }
  assert.deepEqual(sizes, [54, 55, 19])
  assert.deepEqual(must, [29, 35, 6])
  // Input order doesn't matter, and the input isn't reordered.
  const rep = repOf('london')
  const rev = rep.lines.slice().reverse()
  assert.deepEqual(lapLines(rev, true).map((l) => l.id), lapLines(rep.lines, true).map((l) => l.id))
  assert.equal(rev[0], rep.lines[rep.lines.length - 1])
})

test('nextLapLine: honours done and skip; falls back to skipped lines; null when everything is done', () => {
  const ls = lapLines(repOf('vs-d4').lines, true)
  const ids = ls.map((l) => l.id)
  assert.equal(nextLapLine(ls, new Set()), ls[0])
  assert.equal(nextLapLine(ls, new Set([ids[0], ids[1]])), ls[2])
  assert.equal(nextLapLine(ls, new Set([ids[0]]), new Set([ids[1], ids[2]])), ls[3])
  // Everything left is skipped: the first skipped one comes back.
  const allButTwo = new Set(ids.slice(0, -2))
  assert.equal(nextLapLine(ls, allButTwo, new Set(ids.slice(-2))), ls[ls.length - 2])
  assert.equal(nextLapLine(ls, allButTwo, new Set([ids[ids.length - 2]])), ls[ls.length - 1])
  // A done line that is also skipped stays done.
  assert.equal(nextLapLine(ls, new Set(ids.slice(0, -1)), new Set([ids[0]])), ls[ls.length - 1])
  assert.equal(nextLapLine(ls, new Set(ids)), null)
  assert.equal(nextLapLine(ls, new Set(ids), new Set(ids)), null)
  assert.equal(nextLapLine([], new Set()), null)
  // Stale ids in done are ignored.
  assert.equal(nextLapLine(ls, new Set(['gone', 'old'])), ls[0])
})

test('branchStartPly rule table (§2.5)', () => {
  for (const rep of reps30) {
    const deep = rep.lines.find((l) => l.tier === 'deep' && (l.startPly ?? 0) > 0)!
    const planb = rep.lines.find((l) => l.tier === 'planb' && (l.startPly ?? 0) > 0)!
    const key = rep.lines.find((l) => l.tier === 'key' && (l.startPly ?? 0) > 0)!
    const main = rep.lines.find((l) => l.tier === 'main')!
    for (const line of [deep, planb]) {
      assert.ok(line, `${rep.opening.id}: a deep and a Plan B line with a branch start`)
      const p = line.parentLineId!
      const at = (parentBox: number, completions?: number) =>
        branchStartPly(line, { [p]: stats({ box: parentBox }), ...(completions === undefined ? {} : { [line.id]: stats({ completions }) }) })
      assert.equal(at(2, 0), 0, 'parent box 2')
      assert.equal(at(0), 0)
      for (const c of [0, 1, 3, 4]) assert.equal(at(3, c), line.startPly, `completions ${c}`)
      assert.equal(at(3), line.startPly, 'never completed')
      assert.equal(at(5, 1), line.startPly)
      for (const c of [2, 5, 8]) assert.equal(at(3, c), 0, `every 3rd completion plays the whole line (${c})`)
      assert.equal(branchStartPly(line, {}), 0, 'no stats')
    }
    if (key) assert.equal(branchStartPly(key, { [key.parentLineId!]: stats({ box: 5 }) }), 0, 'key lines start from move 1')
    assert.equal(branchStartPly(main, { [main.id]: stats({ box: 5 }) }), 0, 'main lines start from move 1')
  }
  // A line without a usable startPly or parent starts from move 1.
  const l = repOf('sicilian').lines.find((x) => x.tier === 'deep' && (x.startPly ?? 0) > 0)!
  assert.equal(branchStartPly({ ...l, startPly: 0 }, { [l.parentLineId!]: stats({ box: 3 }) }), 0)
  assert.equal(branchStartPly({ ...l, parentLineId: undefined }, { [l.parentLineId!]: stats({ box: 3 }) }), 0)
})

test('mainRoundQueue: main lines only, each exactly once, deterministic with seededRng', () => {
  for (const rep of reps30) {
    const mains = rep.lines.filter((l) => l.tier === 'main').map((l) => l.id).sort()
    const a = mainRoundQueue(rep.lines, seededRng(5)).map((l) => l.id)
    const b = mainRoundQueue(rep.lines, seededRng(5)).map((l) => l.id)
    assert.deepEqual(a, b)
    assert.deepEqual(a.slice().sort(), mains)
    assert.ok(mainRoundQueue(rep.lines, seededRng(5)) !== rep.lines)
  }
  // It really shuffles: over many seeds every Sicilian main line opens a round.
  const sic = repOf('sicilian')
  const firsts = new Set<string>()
  for (let seed = 0; seed < 200; seed++) firsts.add(mainRoundQueue(sic.lines, seededRng(seed))[0].id)
  assert.equal(firsts.size, 6)
  assert.deepEqual(mainRoundQueue([], Math.random), [])
  assert.equal(mainRoundQueue(sic.lines, () => 0.999999).length, 6, 'rng near 1 stays in range')
})

test('estimateMinutes: main rounds ~5 / ~3 / ~3 min; laps 44 / 41 / 17, with branch starts 33 / 31 / 11, must-know 22 / 24 / 5', () => {
  const bs = (l: Line) => (l.tier === 'deep' || l.tier === 'planb' ? (l.startPly ?? 0) : 0)
  const got = reps30.map((rep) => {
    const u = userColorOf(rep.opening)
    return [
      estimateMinutes(rep.lines.filter((l) => l.tier === 'main'), u),
      estimateMinutes(lapLines(rep.lines, true), u),
      estimateMinutes(lapLines(rep.lines, true), u, bs),
      estimateMinutes(lapLines(rep.lines, false), u, bs),
    ]
  })
  assert.deepEqual(got, [
    [5, 44, 33, 22],
    [3, 41, 31, 24],
    [3, 17, 11, 5],
  ])
  assert.equal(estimateMinutes([], 'w'), 0)
  const one = repOf('london').lines.find((l) => l.userMoveCount <= 3)!
  assert.equal(estimateMinutes([one], 'w'), 1, 'at least 1 minute')
})

console.log('Branch notes, conflicts, guard')

test('mainAlternative: the chapter first choice at a deviation, null on the main move', () => {
  for (const rep of reps30) {
    const u = userColorOf(rep.opening)
    for (const line of rep.lines) {
      const ch = rep.chapters.find((c) => c.id === line.chapterId)!
      line.moves.forEach((m, k) => {
        const first = (k === 0 ? ch.roots : line.moves[k - 1].children)[0]
        assert.equal(mainAlternative(rep, m), first === m ? null : first)
      })
    }
    // A key line's deviation is an opponent move: Hoot can name "instead of X they play Y".
    const key = rep.lines.find((l) => l.tier === 'key')
    if (key) {
      const dev = key.moves[key.branchPly!]
      assert.notEqual(dev.color, u)
      const alt = mainAlternative(rep, dev)!
      assert.ok(alt && alt.fenBefore === dev.fenBefore && alt.uci !== dev.uci)
    }
  }
  // A deviation at the chapter's first move: the alternative is chapter.roots[0].
  const lon = repOf('london')
  const rootAlt = lon.chapters.flatMap((c) => c.roots.slice(1).map((r) => ({ r, c })))[0]
  if (rootAlt) assert.equal(mainAlternative(lon, rootAlt.r), rootAlt.c.roots[0])
})

test('findMoveConflicts: 2 / 2 / 0 at maxPly 30 (§1.5)', () => {
  const show = (rep: Repertoire) =>
    findMoveConflicts(rep).map((c) => c.moves.map((m) => `${m.chapterTitle}: ${m.label}`).join(' vs '))
  assert.deepEqual(show(repOf('sicilian')), [
    'Closed Sicilian (2.Nc3): 5...Nh6 vs Side lines: 5...Bd7',
    'Closed Sicilian (2.Nc3): 6...c4 vs Side lines: 6...Nf6',
  ])
  assert.deepEqual(show(repOf('london')), ['All the variations: 5.c3 vs Against ...c5: 5.Be2', 'All the variations: 5.c4 vs Against ...c5: 5.Nc3'])
  assert.deepEqual(show(repOf('vs-d4')), [])
  for (const c of findMoveConflicts(repOf('sicilian'))) {
    assert.ok(c.fenBefore.includes(' b '), 'the kid (Black) is to move')
    for (const m of c.moves) assert.ok(repOf('sicilian').chapters.some((ch) => ch.id === m.chapterId))
  }
  for (const maxPly of [0, 40]) assert.deepEqual(reps.get(maxPly)!.map((r) => findMoveConflicts(r).length), [2, 2, 0], `maxPly ${maxPly}`)
})

test('guard: a chapter whose main path was dropped promotes its first line to main', () => {
  // Chapter B's main path (1.d4 d5 2.c4 e6) repeats chapter A's line, so it is dropped; B's only
  // line left is the kid's second choice 2...c6 (a Plan B by the rules).
  const pgn = [
    '[ChapterURL "https://lichess.org/study/TEST0000/GUARDAAA"]\n\n1. d4 d5 2. c4 e6 *',
    '[ChapterURL "https://lichess.org/study/TEST0000/GUARDBBB"]\n\n1. d4 d5 2. c4 e6 (2... c6 3. Nc3 Nf6) *',
  ].join('\n\n')
  const def: OpeningDef = {
    id: 'guard', name: 'Guard', tagline: '', side: 'black', emoji: '', accent: '',
    chapters: [{ id: 'GUARDAAA', title: 'A' }, { id: 'GUARDBBB', title: 'B' }], extraChapters: [],
  }
  const rep = buildRepertoire(def, parsePgnFile(pgn), { maxPly: 0, enabledExtras: [], overrides: [] })
  assert.deepEqual(rep.lines.map((l) => `${l.chapterId} ${l.indexInChapter} ${l.moves.map((m) => m.san).join(' ')}`), [
    'GUARDAAA 0 d4 d5 c4 e6',
    'GUARDBBB 0 d4 d5 c4 c6 Nc3 Nf6',
  ])
  const b = rep.lines[1]
  assert.equal(b.deviations, 1)
  assert.equal(b.tier, 'main', 'promoted')
  assert.equal(b.branchPly, 0)
  assert.equal(b.startPly, 0)
  assert.equal(b.parentLineId, undefined)
  assert.equal(rep.lines[0].tier, 'main')
  assert.equal(mainRoundQueue(rep.lines, seededRng(1)).length, 2)
  // Without the duplicate, B's main line is main and 2...c6 is Plan B.
  const solo = buildRepertoire({ ...def, chapters: [{ id: 'GUARDBBB', title: 'B' }] }, parsePgnFile(pgn), { maxPly: 0, enabledExtras: [], overrides: [] })
  assert.deepEqual(solo.lines.map((l) => l.tier), ['main', 'planb'])
  assert.equal(solo.lines[1].parentLineId, solo.lines[0].id)
  assert.equal(solo.lines[1].branchPly, 3)
  assert.equal(solo.lines[1].startPly, 1, "the kid's 1...d5")
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
