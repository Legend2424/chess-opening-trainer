// Repertoire builder tests + stats. Run: node scripts/test-repertoire.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import { parsePgnFile } from '../src/chess/pgn.ts'
import { bookMovesAt, buildRepertoire, isBlunder, isDubious, positionKey, userColorOf } from '../src/chess/repertoire.ts'
import type { BuildOptions } from '../src/chess/repertoire.ts'
import { OPENINGS } from '../src/data/openings.ts'
import type { StudyOverride } from '../src/data/studyOverrides.ts'
import { LINE_ID_MIGRATIONS } from '../src/data/lineMigrations.ts'
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

  // A move marked ?/?? in ANY chapter (same position + move) makes it an opponent blunder everywhere.
  const blunderKeys = new Set<string>()
  for (const n of rep.nodesById.values()) if (isBlunder(n)) blunderKeys.add(`${positionKey(n.fenBefore)}|${n.uci}`)

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
      } else if (blunderKeys.has(`${positionKey(m.fenBefore)}|${m.uci}`)) oppBlunder = true
    })
    // tail: continues the line's last position; opponent moves, or a trap demo whose only
    // kid-side move is a ?/?? (never counted as a user move)
    if (line.tail) {
      assert.ok(line.tail.length > 0, `${ctx}: empty tail`)
      assert.equal(line.tail[0].fenBefore, moves[moves.length - 1].fen, `${ctx}: ${line.id} tail continues the line`)
      for (let k = 1; k < line.tail.length; k++) assert.equal(line.tail[k].fenBefore, line.tail[k - 1].fen)
      const kidMoves = line.tail.filter((m) => m.color === u)
      if (line.tailIsTrap) {
        assert.equal(kidMoves.length, 1, `${ctx}: ${line.id} trap tail`)
        assert.ok(isBlunder(kidMoves[0]), `${ctx}: ${line.id} trap move is ?/??`)
      } else assert.equal(kidMoves.length, 0, `${ctx}: ${line.id} tail has a kid move`)
    }
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

  // across chapters (same start + moves): no duplicates, no strict prefixes — except that a CORE
  // line may be a prefix of an EXTRA chapter's line (extras never change the core lines)
  {
    const coreIds = new Set(def.chapters.map((c) => c.id))
    const keyOf = (l: Line) => `${positionKey(l.startFen)}|${l.moves.map((m) => m.uci).join(' ')}`
    const all = rep.lines.map((l) => ({ l, k: keyOf(l) }))
    const set = new Set(all.map((x) => x.k))
    assert.equal(set.size, all.length, `${ctx}: same path in two chapters`)
    for (const a of all)
      for (const b of all)
        if (a.l.chapterId !== b.l.chapterId && b.k.startsWith(a.k + ' '))
          assert.ok(coreIds.has(a.l.chapterId) && !coreIds.has(b.l.chapterId), `${ctx}: ${a.l.id} is a prefix of ${b.l.id} (other chapter)`)
  }

  // coverage: every non-dubious user move reachable without a dubious user move (and within maxPly)
  // is taught — in its own chapter, or by another chapter's line with the very same moves
  const pathKeys = new Set<string>()
  for (const l of rep.lines) {
    let k = positionKey(l.startFen)
    for (const m of l.moves) pathKeys.add((k += ` ${m.uci}`))
  }
  const covered = (n: MoveNode, blocked: boolean, key: string): void => {
    const isUser = n.color === u
    const nowBlocked = blocked || (isUser && isDubious(n)) || (opts.maxPly > 0 && n.ply > opts.maxPly)
    const k = `${key} ${n.uci}`
    if (isUser && !nowBlocked) assert.ok(rep.linesByNode.get(n.id)?.length || pathKeys.has(k), `${ctx}: user move ${n.id} ${n.san} not in any line`)
    for (const c of n.children) covered(c, nowBlocked, k)
  }
  for (const ch of rep.chapters) for (const r of ch.roots) covered(r, false, positionKey(ch.startFen))

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
  const open = sic.lines.filter((l) => l.chapterId === 'nlQ9e14g') // Open Sicilian
  assert.equal(open[0].name, 'Main line')
  const names = new Set(open.map((l) => l.name))
  assert.ok(names.has('5.c4 Bg7'), 'variation 5.c4 named "5.c4 Bg7"')
  assert.ok(names.has('7.Qd2 O-O … 8.f3'), 'a later side variation is added after "…"')
  const side = sic.lines.filter((l) => l.chapterId === 'L3QbzELB') // Side lines
  assert.equal(side[0].name, 'Main line')
  const sideNames = new Set(side.map((l) => l.name))
  assert.ok(sideNames.has('2.f4 Nc6'), 'variation 2.f4 Nc6 named "2.f4 Nc6"')
  assert.ok(sideNames.has('6...Nf6'), 'last-move divergence has no second move')
  const lon = built.get('maxPly 0')!.get('london')!
  assert.ok(lon.lines.some((l) => /^\d+\.\.\.\S+ \d+\.\S+$/.test(l.name)), 'black divergence names look like "2...e5 3.Nf3"')
}

/** Every study node played from the position after `sans` (from the standard start). */
function nodesAt(rep: Repertoire, sans: string): MoveNode[] {
  const c = new Chess()
  for (const s of sans.split(' ')) c.move(s)
  const key = positionKey(c.fen())
  return [...rep.nodesById.values()].filter((n) => positionKey(n.fenBefore) === key)
}
const sansOf = (moves: MoveNode[]) => moves.map((m) => m.san).join(' ')

// Study overrides (src/data/studyOverrides.ts, review: chess #1, #6, #7, #9).
{
  const sic = built.get('maxPly 0 + extras')!.get('sicilian')!
  const sic30 = built.get('maxPly 30')!.get('sicilian')!
  const lon = built.get('maxPly 30')!.get('london')!
  const lon0 = built.get('maxPly 0')!.get('london')!
  const d4 = built.get('maxPly 30')!.get('vs-d4')!
  // A kid move the study plays without a mark is marked, so nothing teaches it: Alapin 13...Qd7?? (14.Nxd6+).
  const qd7 = nodesAt(sic, 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Bg4 Be2 Nf6 d4 cxd4 cxd4 e6 Nc3 Qa5 Bd2 Qb6 O-O Bxf3 Bxf3 Bd6 Be3 Qc7 Nb5').filter((n) => n.san === 'Qd7')
  assert.ok(qd7.length >= 1 && qd7.every((n) => n.nags.includes(4)), '13...Qd7?? marked')
  // The engine refutation is made the first answer: Smith-Morra 9...Nd5? 10.Bxd5! (the study only has 10.Nxd5)…
  const nd5 = nodesAt(sic, 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 g6 Bc4 Bg7 O-O Nf6 h3 e6 e5').filter((n) => n.san === 'Nd5')
  assert.ok(nd5.length >= 1 && nd5.every(isBlunder), '9...Nd5? marked')
  assert.equal(nd5[0].children[0].san, 'Bxd5', 'the engine refutation is the first answer')
  // …also where the study stops right after the mistake (Old Benoni 6.Nc4? 6...Qc3+).
  const nc4 = nodesAt(lon, 'd4 Nf6 Bf4 e6 Nf3 c5 e3 Qb6 Na3 Qxb2').filter((n) => n.san === 'Nc4')
  assert.ok(nc4.length === 1 && isBlunder(nc4[0]), '6.Nc4? marked')
  assert.deepEqual(nc4[0].children.map((n) => n.san), ['Qc3+'])
  // (A mark reached by ANOTHER move order — the old 7...Bxf3? case — has no real example in this
  // study any more; it is checked on the synthetic study below.)
  for (const rep of [sic, lon, d4]) {
    for (const l of rep.lines) {
      for (const m of l.moves) if (m.color === userColorOf(rep.opening)) assert.ok(!isDubious(m), `${l.id} teaches ${m.san}`)
    }
  }
  // Opponent blunders the study left unmarked are flagged (Punish it!).
  const punish = (rep: Repertoire, san: string, ply: number) =>
    rep.lines.some((l) => l.hasOpponentBlunder && l.moves.some((m) => m.san === san && m.ply === ply && m.color !== userColorOf(rep.opening) && isBlunder(m)))
  assert.ok(punish(sic30, 'O-O-O', 19), '10.O-O-O?? line (Open Sicilian, carried over)')
  assert.ok(punish(sic30, 'O-O-O', 21), '11.O-O-O? line (Open Sicilian)')
  assert.ok(punish(d4, 'e4', 15), '8.e4?? line (QGD 5.Bf4)')
  assert.ok(punish(lon, 'Rc8', 24), '12...Rc8?? line (London, all the variations)')
  // Where the study stops right after the blunder, the engine's punishment ends the line (24...Qf8?? 25.Qxh7#).
  const qf8 = lon0.lines.find((l) => l.moves.some((m) => m.san === 'Qf8' && isBlunder(m)))
  assert.ok(qf8 && qf8.hasOpponentBlunder && qf8.moves[qf8.moves.length - 1].san === 'Qxh7#', '24...Qf8?? 25.Qxh7# line')
  // Trap demos: the line stops before the kid's ?/?? move and shows it (with its refutation) afterwards.
  const qd7Trap = sic30.lines.find((l) => l.tailIsTrap && l.tail!.some((m) => m.san === 'Qd7'))
  assert.ok(qd7Trap, '13...Qd7?? trap demo')
  assert.equal(qd7Trap!.moves[qd7Trap!.moves.length - 1].san, 'Qc7', 'the line stops at 12...Qc7')
  assert.deepEqual(qd7Trap!.tail!.map((m) => m.san), ['Nb5', 'Qd7', 'Nxd6+'])
  const nd5Trap = sic30.lines.find((l) => l.tailIsTrap && l.tail!.some((m) => m.san === 'Nd5'))
  assert.ok(nd5Trap, '9...Nd5? trap demo')
  assert.deepEqual(nd5Trap!.tail!.map((m) => m.san), ['e5', 'Nd5', 'Bxd5'], 'with the engine refutation the study lacks')
  // (No London line has a trap demo in this study; a White one is checked on the synthetic study below.)
  // A ?! kid move stops the line WITHOUT a trap demo: QGD 5.Bf4 … 7...Nh5 8.Be5 f6?! (9.Ng5!).
  const nh5 = d4.lines.filter((l) => sansOf(l.moves) === 'd4 d5 c4 e6 Nc3 Be7 Nf3 Nf6 Bf4 c6 e3 O-O Bd3 Nh5')
  assert.ok(nh5.length === 1 && !nh5[0].tail, '5...c6 6.e3 line ends at 7...Nh5, nothing after it')
  assert.ok(!d4.lines.some((l) => [...l.moves, ...(l.tail ?? [])].some((m) => m.san === 'fxe5')), '9...fxe5? is no longer reached')
  // "What happens next": the study's final reply after the kid's last move is kept as a tail.
  // (QGD 5.Bf4 6.e3 c5 7.dxc5 Bxc5 8.a3 Nc6 9.Qc2 Qa5 is followed in the study by 10.Rd1.)
  const qa5 = d4.lines.filter((l) => sansOf(l.moves) === 'd4 d5 c4 e6 Nc3 Be7 Nf3 Nf6 Bf4 O-O e3 c5 dxc5 Bxc5 a3 Nc6 Qc2 Qa5')
  assert.ok(qa5.length === 1 && !qa5[0].tailIsTrap && qa5[0].tail?.map((m) => m.san).join(' ') === 'Rd1', '10.Rd1 shown after 9...Qa5')
  // Comment clean-up: a 2-letter keystroke is dropped, "Alternative" is reworded, a typo is fixed.
  const job = built.get('maxPly 0 + extras')!.get('london')!
  assert.ok(![...job.nodesById.values()].some((n) => n.comment === 'df'), '"df" dropped')
  assert.ok([...job.nodesById.values()].some((n) => n.comment === 'Another good move here.'))
  assert.deepEqual(
    [...sic.nodesById.values()].filter((n) => n.comment?.includes('Ng4 idea')).map((n) => n.comment),
    ['When white bishop is on e3 always look at the Ng4 idea in any opening!!'],
  )
  // Overrides can be switched off (and then nothing is marked).
  const raw = buildRepertoire(OPENINGS[0], games, { maxPly: 0, enabledExtras: [], overrides: [] })
  assert.ok(raw.lines.some((l) => l.moves.some((m) => m.san === 'Qd7' && m.color === 'b' && m.ply === 26)), '13...Qd7 taught by the bare study')
  const rawNd5 = nodesAt(raw, 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 g6 Bc4 Bg7 O-O Nf6 h3 e6 e5').filter((n) => n.san === 'Nd5')
  assert.ok(rawNd5.length === 1 && !isDubious(rawNd5[0]) && rawNd5[0].children.length === 0, '9...Nd5: no mark, no inserted reply')
}

// Overrides on a synthetic study, for what the coach's study has no real example of: a mark that
// reaches the same move by ANOTHER move order (review: chess #1), a 'cut' contrast note, and a
// trap demo for a White repertoire (with the engine's reply where the study stops).
{
  const url = (id: string) => `[ChapterURL "https://lichess.org/study/TEST0000/${id}"]`
  const pgn = [
    // Smith-Morra, 5.Nf3 6.Bc4: 9...Nd5 is the main line here (the study answers 10.Nxd5).
    `${url('SYNSMORA')}\n\n1. e4 c5 2. d4 cxd4 3. c3 dxc3 4. Nxc3 Nc6 5. Nf3 g6 6. Bc4 Bg7 7. O-O Nf6 8. h3 e6 9. e5 Nd5 10. Nxd5 exd5 *`,
    // 5.Bc4 6.Nf3 reaches the same position after 9.e5; a contrast note 1...d5 must never be drilled.
    `${url('SYNSMORB')}\n\n1. e4 c5 (1... d5 { Not our opening, just for comparison. } 2. exd5 Qxd5) 2. d4 cxd4 3. c3 dxc3 4. Nxc3 Nc6 5. Bc4 g6 6. Nf3 Bg7 7. O-O Nf6 8. h3 e6 9. e5 Ng8 (9... Nd5 10. Nxd5 exd5) *`,
    // London: 5.Ne5 drops the queen to the pin (the study has no answer after it).
    `${url('SYNLONDN')}\n\n1. d4 d5 2. Bf4 Nf6 3. Nf3 Bg4 4. e3 e6 5. Ne5 *`,
  ].join('\n\n')
  const synGames = parsePgnFile(pgn)
  const overrides: StudyOverride[] = [
    { chapterId: 'SYNSMORA', path: 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 g6 Bc4 Bg7 O-O Nf6 h3 e6 e5 Nd5', action: 'nag', nag: 2, reply: 'Bxd5' },
    { chapterId: 'SYNSMORB', path: 'e4 d5', action: 'cut' },
    { chapterId: 'SYNLONDN', path: 'd4 d5 Bf4 Nf6 Nf3 Bg4 e3 e6 Ne5', action: 'nag', nag: 4, reply: 'Bxd1' },
  ]
  const synDef = (id: string, side: 'white' | 'black', chapters: string[]): OpeningDef => ({
    id, name: id, tagline: '', side, emoji: '', accent: '', chapters: chapters.map((c) => ({ id: c, title: c })), extraChapters: [],
  })
  const blackDef = synDef('synb', 'black', ['SYNSMORA', 'SYNSMORB'])
  const whiteDef = synDef('synw', 'white', ['SYNLONDN'])
  const opts: BuildOptions = { maxPly: 0, enabledExtras: [], overrides }
  const warnings: string[] = []
  const orig = console.warn
  console.warn = (...a: unknown[]) => void warnings.push(a.join(' '))
  let syn: Repertoire, synW: Repertoire
  try {
    syn = buildRepertoire(blackDef, synGames, opts)
    synW = buildRepertoire(whiteDef, synGames, opts)
  } finally {
    console.warn = orig
  }
  assert.deepEqual(warnings, [], 'synthetic overrides: warnings')
  check(syn, opts, 'synthetic')
  check(synW, opts, 'synthetic')

  // 9...Nd5? is marked in BOTH move orders that reach the position; nothing teaches it.
  const viaBc4 = nodesAt(syn, 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Bc4 g6 Nf3 Bg7 O-O Nf6 h3 e6 e5')
  const nd5 = viaBc4.filter((n) => n.san === 'Nd5')
  assert.deepEqual(nd5.map((n) => n.chapterId), ['SYNSMORA', 'SYNSMORB'], 'one Nd5 node per chapter')
  assert.ok(nd5.every(isBlunder), '9...Nd5 by transposition is marked too')
  assert.deepEqual(nd5.map((n) => n.children[0].san), ['Bxd5', 'Nxd5'], 'the reply goes only into the chapter the override names')
  const book = bookMovesAt(syn, nd5[1].fenBefore)
  assert.ok(book.some((n) => n.san === 'Ng8' && !isDubious(n)))
  assert.ok(book.filter((n) => n.san === 'Nd5').every(isDubious))
  assert.equal(book.find((n) => n.san === 'Nd5')!.children[0].san, 'Bxd5', 'the book node carries the engine refutation')
  for (const l of syn.lines) for (const m of l.moves) if (m.color === 'b') assert.ok(!isDubious(m), `synthetic: ${l.id} teaches ${m.san}`)
  const trap = syn.lines.find((l) => l.tailIsTrap)
  assert.ok(trap && trap.chapterId === 'SYNSMORA', 'trap demo in the chapter whose main line had 9...Nd5')
  assert.deepEqual(trap!.tail!.map((m) => m.san), ['e5', 'Nd5', 'Bxd5'])
  // Contrast notes are cut: no line plays 1...d5.
  assert.ok(!syn.lines.some((l) => l.moves[0].san === 'e4' && l.moves[1]?.san === 'd5'), 'no 1.e4 d5 line')
  assert.deepEqual(syn.lines.map((l) => `${l.chapterId} ${sansOf(l.moves)}`), [
    'SYNSMORA e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 g6 Bc4 Bg7 O-O Nf6 h3 e6',
    'SYNSMORB e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Bc4 g6 Nf3 Bg7 O-O Nf6 h3 e6 e5 Ng8',
  ])
  // Without the overrides the contrast line and 9...Nd5 are drilled, and nothing is marked.
  const bare = buildRepertoire(blackDef, synGames, { maxPly: 0, enabledExtras: [], overrides: [] })
  assert.ok(bare.lines.some((l) => sansOf(l.moves) === 'e4 d5 exd5 Qxd5'), 'bare: 1.e4 d5 line')
  assert.ok(bare.lines.some((l) => l.moves.some((m) => m.san === 'Nd5' && m.color === 'b')), 'bare: 9...Nd5 taught')
  assert.ok(![...bare.nodesById.values()].some(isDubious), 'bare: nothing marked')

  // White trap demo: the line stops at 4.e3, then shows 4...e6 5.Ne5?? and the reply 5...Bxd1.
  assert.equal(synW.lines.length, 1)
  const wTrap = synW.lines[0]
  assert.equal(sansOf(wTrap.moves), 'd4 d5 Bf4 Nf6 Nf3 Bg4 e3')
  assert.equal(wTrap.tailIsTrap, true)
  assert.deepEqual(wTrap.tail!.map((m) => m.san), ['e6', 'Ne5', 'Bxd1'])
  assert.ok(wTrap.tail![1].nags.includes(4), '5.Ne5??')
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

// Study replaced: every migration target must be a real line id today (at some
// parent line-length setting), otherwise the kids' carried-over progress would be
// renamed onto a line that no longer exists. Re-run scripts/build-line-migrations.ts.
{
  const games = parsePgnFile(readFileSync('public/studies/opening-lines.pgn', 'utf8'))
  const allExtras = OPENINGS.flatMap((o) => o.extraChapters.map((c) => c.id))
  const ids = new Set<string>()
  for (const maxPly of [0, 20, 30, 40, 50])
    for (const extras of [[], allExtras])
      for (const def of OPENINGS) for (const l of buildRepertoire(def, games, { maxPly, enabledExtras: extras }).lines) ids.add(l.id)
  const dangling = Object.entries(LINE_ID_MIGRATIONS).filter(([, to]) => !ids.has(to))
  assert.deepEqual(dangling, [], 'line migrations point at line ids that no longer exist — re-run scripts/build-line-migrations.ts')
  console.log(`Line migrations: ${Object.keys(LINE_ID_MIGRATIONS).length} old ids carried over, all targets exist`)
}

console.log(`\nOK — ${checks} repertoire builds checked (${configs.length} configs x ${OPENINGS.length} openings + ${checks - configs.length * OPENINGS.length} synthetic)`)
