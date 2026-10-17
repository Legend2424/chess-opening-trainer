// Repertoire builder tests + stats. Run: node scripts/test-repertoire.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import { parsePgnFile } from '../src/chess/pgn.ts'
import { bookMovesAt, buildRepertoire, isBlunder, isDubious, positionKey, userColorOf } from '../src/chess/repertoire.ts'
import type { BuildOptions } from '../src/chess/repertoire.ts'
import { OPENINGS } from '../src/data/openings.ts'
import type { Line, MoveNode, OpeningDef, Repertoire } from '../src/types.ts'

const text = readFileSync(new URL('../public/studies/opening-lines.pgn', import.meta.url), 'utf8')
const games = parsePgnFile(text)

let checks = 0
function check(rep: Repertoire, opts: BuildOptions, label: string): void {
  const def = rep.opening
  const u = userColorOf(def)
  const ctx = `${def.id} ${label}`

  // chapters: core in order, then enabled extras in order
  const expectedChapters = [
    ...def.chapters.map((c) => c.id),
    ...def.extraChapters.filter((c) => opts.enabledExtras.includes(c.id)).map((c) => c.id),
  ]
  assert.deepEqual(
    rep.chapters.map((c) => c.id),
    expectedChapters,
    `${ctx}: chapter order`,
  )

  // nodesById covers every tree node, parent links are right
  const treeNodes: MoveNode[] = []
  const walk = (nodes: MoveNode[], parent: MoveNode | null, ply: number) => {
    for (const n of nodes) {
      treeNodes.push(n)
      assert.equal(n.parentId, parent ? parent.id : null)
      assert.equal(n.ply, ply)
      if (parent) assert.equal(n.fenBefore, parent.fen)
      walk(n.children, n, ply + 1)
    }
  }
  for (const ch of rep.chapters) {
    walk(ch.roots, null, 1)
    for (const r of ch.roots) assert.equal(r.fenBefore, ch.startFen)
  }
  assert.equal(rep.nodesById.size, treeNodes.length, `${ctx}: nodesById size`)
  for (const n of treeNodes) assert.equal(rep.nodesById.get(n.id), n)

  // lines
  const ids = new Set<string>()
  const byChapter = new Map<string, Line[]>()
  rep.lines.forEach((line, i) => {
    assert.equal(line.index, i, `${ctx}: index`)
    assert.equal(line.openingId, def.id)
    assert.ok(!ids.has(line.id), `${ctx}: duplicate id ${line.id}`)
    ids.add(line.id)
    const arr = byChapter.get(line.chapterId) ?? []
    assert.equal(line.indexInChapter, arr.length, `${ctx}: indexInChapter`)
    arr.push(line)
    byChapter.set(line.chapterId, arr)

    const moves = line.moves
    assert.ok(moves.length > 0)
    assert.equal(moves[moves.length - 1].color, u, `${ctx}: ${line.id} must end with a user move`)
    if (opts.maxPly > 0) assert.ok(moves.length <= opts.maxPly, `${ctx}: maxPly`)
    let userMoves = 0
    let oppBlunder = false
    moves.forEach((m, k) => {
      assert.equal(m.chapterId, line.chapterId)
      assert.equal(m.parentId, k === 0 ? null : moves[k - 1].id, `${ctx}: ${line.id} is a tree path`)
      if (m.color === u) {
        userMoves++
        assert.ok(!isDubious(m), `${ctx}: ${line.id} teaches dubious user move ${m.san}`)
      } else if (isBlunder(m)) oppBlunder = true
    })
    assert.equal(line.userMoveCount, userMoves)
    assert.equal(line.hasOpponentBlunder, oppBlunder)
    assert.ok(line.userMoveCount >= 1)

    // replays legally from startFen with a fresh chess.js
    const chess = new Chess(line.startFen)
    for (const m of moves) {
      const r = chess.move(m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to })
      assert.equal(r.san, m.san)
      assert.equal(r.after, m.fen, `${ctx}: ${line.id} replay`)
    }
  })

  // per chapter: no duplicates, no strict prefixes, one "Main line" at most
  for (const [cid, lines] of byChapter) {
    const keys = lines.map((l) => l.moves.map((m) => m.uci).join(' '))
    assert.equal(new Set(keys).size, keys.length, `${ctx}: duplicate path in ${cid}`)
    for (let a = 0; a < keys.length; a++)
      for (let b = 0; b < keys.length; b++)
        if (a !== b) assert.ok(!keys[b].startsWith(keys[a] + ' '), `${ctx}: ${lines[a].id} is a prefix of ${lines[b].id} in ${cid}`)
    assert.ok(lines.filter((l) => l.name === 'Main line').length <= 1, `${ctx}: several "Main line" in ${cid}`)
  }

  // coverage: every non-dubious user move reachable without a dubious user move (and within maxPly) is taught
  const covered = (n: MoveNode, blocked: boolean): void => {
    const isUser = n.color === u
    const nowBlocked = blocked || (isUser && isDubious(n)) || (opts.maxPly > 0 && n.ply > opts.maxPly)
    if (isUser && !nowBlocked) assert.ok(rep.linesByNode.get(n.id)?.length, `${ctx}: user move ${n.id} ${n.san} not in any line`)
    for (const c of n.children) covered(c, nowBlocked)
  }
  for (const ch of rep.chapters) for (const r of ch.roots) covered(r, false)

  // linesByNode consistent
  let total = 0
  for (const [nid, lines] of rep.linesByNode) {
    assert.ok(rep.nodesById.has(nid))
    for (const l of lines) assert.ok(l.moves.some((m) => m.id === nid))
    total += lines.length
  }
  assert.equal(
    total,
    rep.lines.reduce((s, l) => s + l.moves.length, 0),
  )

  // movesByPosition consistent
  for (const [key, list] of rep.movesByPosition) {
    const ucis = list.map((n) => n.uci)
    assert.equal(new Set(ucis).size, ucis.length, `${ctx}: dup uci at ${key}`)
    for (const n of list) {
      assert.equal(positionKey(n.fenBefore), key)
      assert.equal(rep.nodesById.get(n.id), n)
    }
  }
  for (const n of treeNodes) {
    const list = bookMovesAt(rep, n.fenBefore)
    assert.ok(
      list.some((x) => x.uci === n.uci),
      `${ctx}: ${n.id} missing from movesByPosition`,
    )
  }
  // main-line node first: at the chapter start, roots[0] of the first chapter leads
  const first = rep.chapters[0]
  if (first?.roots[0]) assert.equal(bookMovesAt(rep, first.startFen)[0].uci, first.roots[0].uci)
  checks++
}

function stats(lines: Line[]) {
  const n = lines.length
  const um = lines.map((l) => l.userMoveCount)
  return {
    n,
    avg: n ? um.reduce((a, b) => a + b, 0) / n : 0,
    max: n ? Math.max(...um) : 0,
    longest: n ? Math.max(...lines.map((l) => l.moves.length)) : 0,
  }
}

const pad = (s: string | number, w: number) => String(s).padEnd(w)
const lpad = (s: string | number, w: number) => String(s).padStart(w)

// ---------------------------------------------------------------------------
// Timing (cold first build, then warm)
// ---------------------------------------------------------------------------
const allExtras = (o: OpeningDef) => o.extraChapters.map((c) => c.id)
const timeAll = (opts: (o: OpeningDef) => BuildOptions) => {
  const t = performance.now()
  for (const o of OPENINGS) buildRepertoire(o, games, opts(o))
  return performance.now() - t
}
const tParse0 = performance.now()
parsePgnFile(text)
const tParse = performance.now() - tParse0
const tCold = timeAll((o) => ({ maxPly: 30, enabledExtras: allExtras(o) }))
const tWarm = timeAll((o) => ({ maxPly: 30, enabledExtras: allExtras(o) }))
const tCore = timeAll(() => ({ maxPly: 30, enabledExtras: [] }))
console.log(
  `Timing: parse ${tParse.toFixed(1)} ms; build all 3 openings (all extras) cold ${tCold.toFixed(1)} ms, warm ${tWarm.toFixed(1)} ms; core only ${tCore.toFixed(1)} ms`,
)
assert.ok(tCold < 300, `build too slow: ${tCold} ms`)

// ---------------------------------------------------------------------------
// Builds + invariants
// ---------------------------------------------------------------------------
const configs: { label: string; opts: (o: OpeningDef) => BuildOptions }[] = [
  { label: 'maxPly 30', opts: () => ({ maxPly: 30, enabledExtras: [] }) },
  { label: 'maxPly 0', opts: () => ({ maxPly: 0, enabledExtras: [] }) },
  { label: 'maxPly 30 + extras', opts: (o) => ({ maxPly: 30, enabledExtras: allExtras(o) }) },
  { label: 'maxPly 0 + extras', opts: (o) => ({ maxPly: 0, enabledExtras: allExtras(o) }) },
  { label: 'maxPly 10', opts: () => ({ maxPly: 10, enabledExtras: [] }) },
]

const built = new Map<string, Map<string, Repertoire>>() // label -> opening -> rep
for (const cfg of configs) {
  const m = new Map<string, Repertoire>()
  for (const o of OPENINGS) {
    const warnings: string[] = []
    const orig = console.warn
    console.warn = (...a: unknown[]) => void warnings.push(a.join(' '))
    let rep: Repertoire, again: Repertoire
    try {
      rep = buildRepertoire(o, games, cfg.opts(o))
      again = buildRepertoire(o, games, cfg.opts(o))
    } finally {
      console.warn = orig
    }
    assert.deepEqual(warnings, [], `${o.id} ${cfg.label}: warnings`)
    check(rep, cfg.opts(o), cfg.label)
    // ids (and names) identical across two builds
    assert.deepEqual(
      rep.lines.map((l) => `${l.id} ${l.name}`),
      again.lines.map((l) => `${l.id} ${l.name}`),
      `${o.id} ${cfg.label}: unstable ids`,
    )
    m.set(o.id, rep)
  }
  built.set(cfg.label, m)
}

// Core-chapter lines are the same whether extras are enabled or not.
for (const [core, extra] of [
  ['maxPly 30', 'maxPly 30 + extras'],
  ['maxPly 0', 'maxPly 0 + extras'],
]) {
  for (const o of OPENINGS) {
    const a = built.get(core)!.get(o.id)!.lines.map((l) => l.id)
    const b = built
      .get(extra)!
      .get(o.id)!
      .lines.filter((l) => o.chapters.some((c) => c.id === l.chapterId))
      .map((l) => l.id)
    assert.deepEqual(a, b, `${o.id}: core lines differ when extras are enabled`)
  }
}

// Ids differ between openings / maxPly settings only when the move list differs.
{
  const a = built.get('maxPly 30')!
  const b = built.get('maxPly 0')!
  for (const o of OPENINGS) {
    const keyA = new Map(a.get(o.id)!.lines.map((l) => [l.moves.map((m) => m.uci).join(' ') + '|' + l.chapterId, l.id]))
    for (const l of b.get(o.id)!.lines) {
      const k = l.moves.map((m) => m.uci).join(' ') + '|' + l.chapterId
      if (keyA.has(k)) assert.equal(keyA.get(k), l.id, 'same path => same id regardless of maxPly')
    }
  }
}

// Names follow DESIGN §1 rule 6 (spot checks on real data).
{
  const sic = built.get('maxPly 0')!.get('sicilian')!
  const open = sic.lines.filter((l) => l.chapterId === 'hF97JQsY')
  assert.equal(open[0].name, 'Main line')
  const names = new Set(open.map((l) => l.name))
  assert.ok(names.has('1.f4 f5'), 'variation 1.f4 f5 named "1.f4 f5"')
  assert.ok(names.has('4...e5'), 'last-move divergence has no second move')
  assert.ok(names.has('5.c4 Bg7'))
  const lon = built.get('maxPly 0')!.get('london')!
  assert.ok(lon.lines.some((l) => /^\d+\.\.\.\S+ \d+\.\S+$/.test(l.name)), 'black divergence names look like "2...e5 3.Nf3"')
}

// ---------------------------------------------------------------------------
// Stats table
// ---------------------------------------------------------------------------
console.log('\nLines per opening/chapter (user moves avg/max; longest line in plies). "+" = optional extra chapter.')
const header = `${pad('Opening', 9)} ${pad('Chapter', 34)} | ${pad('maxPly 30', 26)} | ${pad('maxPly 0 (full)', 26)}`
const sub = `${pad('', 9)} ${pad('', 34)} | ${lpad('lines', 5)} ${lpad('user avg', 8)} ${lpad('max', 4)} ${lpad('plies', 6)} | ${lpad('lines', 5)} ${lpad('user avg', 8)} ${lpad('max', 4)} ${lpad('plies', 6)}`
console.log(header)
console.log(sub)
console.log('-'.repeat(sub.length))
const cell = (s: ReturnType<typeof stats>) => `${lpad(s.n, 5)} ${lpad(s.avg.toFixed(1), 8)} ${lpad(s.max, 4)} ${lpad(s.longest, 6)}`
for (const o of OPENINGS) {
  const r30 = built.get('maxPly 30 + extras')!.get(o.id)!
  const r0 = built.get('maxPly 0 + extras')!.get(o.id)!
  for (const ch of r30.chapters) {
    const title = (ch.isExtra ? '+ ' : '') + ch.title
    console.log(
      `${pad(o.id, 9)} ${pad(title.slice(0, 34), 34)} | ${cell(stats(r30.lines.filter((l) => l.chapterId === ch.id)))} | ${cell(stats(r0.lines.filter((l) => l.chapterId === ch.id)))}`,
    )
  }
  const core30 = built.get('maxPly 30')!.get(o.id)!.lines
  const core0 = built.get('maxPly 0')!.get(o.id)!.lines
  console.log(`${pad(o.id, 9)} ${pad('TOTAL core', 34)} | ${cell(stats(core30))} | ${cell(stats(core0))}`)
  console.log(`${pad(o.id, 9)} ${pad('TOTAL core + extras', 34)} | ${cell(stats(r30.lines))} | ${cell(stats(r0.lines))}`)
  console.log('-'.repeat(sub.length))
}
{
  const r = built.get('maxPly 30')!
  const dupNames = OPENINGS.map((o) => {
    const lines = r.get(o.id)!.lines
    return `${o.id} ${lines.length - new Set(lines.map((l) => l.chapterId + '|' + l.name)).size}`
  })
  console.log(`Lines sharing a name with another line of the same chapter (maxPly 30): ${dupNames.join(', ')}`)
}

console.log(`\nOK — ${checks} repertoire builds checked (${configs.length} configs x ${OPENINGS.length} openings)`)
