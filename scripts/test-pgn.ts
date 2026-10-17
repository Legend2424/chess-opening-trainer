// PGN parser tests. Run: node scripts/test-pgn.ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import { parseCommentCommands, parsePgnFile } from '../src/chess/pgn.ts'
import type { PgnGame, PgnNode } from '../src/chess/pgn.ts'
import { buildRepertoire, chapterIdOf } from '../src/chess/repertoire.ts'
import type { MoveNode, OpeningDef } from '../src/types.ts'

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

const one = (pgn: string): PgnGame => {
  const games = parsePgnFile(pgn)
  assert.equal(games.length, 1, 'expected exactly one game')
  return games[0]
}
const sans = (nodes: PgnNode[]) => nodes.map((n) => n.san)
/** Main line SANs from a list of roots. */
const mainLine = (roots: PgnNode[]): string[] => {
  const out: string[] = []
  let cur = roots[0]
  while (cur) {
    out.push(cur.san)
    cur = cur.children[0]
  }
  return out
}

/** Build a one-chapter repertoire from movetext (for FEN/castling/promotion checks). */
function buildOne(movetext: string, headers: Record<string, string> = {}, side: 'white' | 'black' = 'white') {
  const hdr = Object.entries({ ChapterURL: 'https://lichess.org/study/TEST0000/abcdEFGH', ChapterName: 'T', ...headers })
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n')
  const games = parsePgnFile(`${hdr}\n\n${movetext}\n`)
  const def: OpeningDef = {
    id: 't',
    name: 'T',
    tagline: '',
    side,
    emoji: '',
    accent: '',
    chapters: [{ id: 'abcdEFGH', title: 'T' }],
    extraChapters: [],
  }
  return buildRepertoire(def, games, { maxPly: 0, enabledExtras: [] })
}

function silenceWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const orig = console.warn
  const warnings: string[] = []
  console.warn = (...a: unknown[]) => {
    warnings.push(a.map(String).join(' '))
  }
  try {
    return { result: fn(), warnings }
  } finally {
    console.warn = orig
  }
}

console.log('PGN parser — unit tests')

test('headers, escaped quotes, several games, result tokens', () => {
  const games = parsePgnFile(
    [
      '[Event "A \\"quoted\\" name"]',
      '[Result "1-0"]',
      '',
      '1. e4 e5 1-0',
      '',
      '[Event "Two"]',
      '',
      '1. d4 d5 0-1',
      '',
      '[Event "Three"]',
      '1. c4 1/2-1/2',
      '[Event "Four"]',
      '*',
      '',
    ].join('\n'),
  )
  assert.equal(games.length, 4)
  assert.equal(games[0].headers.Event, 'A "quoted" name')
  assert.deepEqual(sans(games[0].roots), ['e4'])
  assert.equal(games[0].result, '1-0')
  assert.equal(games[1].result, '0-1')
  assert.equal(games[2].result, '1/2-1/2')
  assert.equal(games[3].result, '*')
  assert.deepEqual(games[3].roots, [])
})

test('game without result token followed by the next game headers', () => {
  const games = parsePgnFile('[Event "A"]\n\n1. e4 e5 2. Nf3\n\n\n[Event "B"]\n\n1. d4 *\n')
  assert.equal(games.length, 2)
  assert.deepEqual(mainLine(games[0].roots), ['e4', 'e5', 'Nf3'])
  assert.equal(games[0].result, undefined)
  assert.deepEqual(mainLine(games[1].roots), ['d4'])
})

test('repeated header key starts a new game even without movetext', () => {
  const games = parsePgnFile('[Event "A"]\n[Site "x"]\n[Event "B"]\n\n1. e4 *')
  assert.equal(games.length, 2)
  assert.deepEqual(games[0].roots, [])
  assert.equal(games[1].headers.Event, 'B')
})

test('header names like Object.prototype members do not split the game (regression)', () => {
  const games = parsePgnFile('[Event "a"]\n[constructor "x"]\n[toString "y"]\n[hasOwnProperty "z"]\n[__proto__ "p"]\n\n1. e4 *')
  assert.equal(games.length, 1)
  assert.deepEqual(mainLine(games[0].roots), ['e4'])
  const h = games[0].headers
  assert.deepEqual(Object.keys(h), ['Event', 'constructor', 'toString', 'hasOwnProperty', '__proto__'])
  assert.equal(h.constructor as unknown, 'x')
  assert.equal(h.toString as unknown, 'y')
  assert.equal(Object.getOwnPropertyDescriptor(h, '__proto__')?.value, 'p')
  assert.equal(Object.getPrototypeOf(h), Object.prototype, 'prototype untouched')
  assert.equal(JSON.parse(JSON.stringify(h)).Event, 'a')
  // a genuinely repeated one still starts a new game
  assert.equal(parsePgnFile('[toString "a"]\n[toString "b"]\n1. e4 *').length, 2)
})

test('nested variations, several levels deep', () => {
  const g = one('1. e4 (1. d4 d5 (1... Nf6 2. c4 (2. Nf3 g6 (2... e6))) 2. c4) 1... e5 2. Nf3 (2. f4 exf4 (2... d5)) 2... Nc6 *')
  assert.deepEqual(sans(g.roots), ['e4', 'd4'])
  assert.deepEqual(mainLine(g.roots), ['e4', 'e5', 'Nf3', 'Nc6'])
  const d4 = g.roots[1]
  assert.deepEqual(sans(d4.children), ['d5', 'Nf6'])
  assert.deepEqual(sans(d4.children[0].children), ['c4'])
  const nf6 = d4.children[1]
  assert.deepEqual(sans(nf6.children), ['c4', 'Nf3'])
  assert.deepEqual(sans(nf6.children[1].children), ['g6', 'e6'])
  const e5 = g.roots[0].children[0]
  assert.deepEqual(sans(e5.children), ['Nf3', 'f4'])
  assert.deepEqual(sans(e5.children[1].children), ['exf4', 'd5'])
})

test("'1...' black-first notation after a variation", () => {
  const g = one('1. e4 (1. f4 f5 2. e4) 1... c5 2. Nf3 *')
  assert.deepEqual(sans(g.roots), ['e4', 'f4'])
  assert.deepEqual(mainLine(g.roots), ['e4', 'c5', 'Nf3'])
  assert.deepEqual(mainLine([g.roots[1]]), ['f4', 'f5', 'e4'])
})

test('glued move numbers (1.e4 / 1...e5) and zero castling', () => {
  const g = one('1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.0-0 *')
  assert.deepEqual(mainLine(g.roots), ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])
  const g2 = one('1.e4 (1.d4) 1...e5 *')
  assert.deepEqual(mainLine(g2.roots), ['e4', 'e5'])
})

test('comment before first move = intro; consecutive comments; comment after move', () => {
  const g = one('{ Welcome! [%cal Ge2e4] } { Second intro } 1. e4 { Good move } { [%csl Gd5] } 1... c5 *')
  assert.deepEqual(g.intro, ['Welcome! [%cal Ge2e4]', 'Second intro'])
  assert.deepEqual(g.roots[0].comments, ['Good move', '[%csl Gd5]'])
  assert.deepEqual(g.roots[0].children[0].comments, [])
})

test('comment at the start of a variation attaches to its first move', () => {
  const g = one('1. e4 ( { Or the queen pawn } 1. d4 { solid } ) 1... e5 *')
  assert.deepEqual(g.roots[1].comments, ['Or the queen pawn', 'solid'])
  assert.deepEqual(g.intro, [])
})

test('comment after a closing parenthesis belongs to the move before the variation', () => {
  const g = one('1. e4 (1. d4) { about e4 } 1... e5 *')
  assert.deepEqual(g.roots[0].comments, ['about e4'])
  assert.deepEqual(mainLine(g.roots), ['e4', 'e5'])
})

test('multi-line comments and ; rest-of-line comments', () => {
  const g = one('1. e4 { They get double\nisolated pawns. } e5 ; a line comment\n2. Nf3 *')
  assert.deepEqual(mainLine(g.roots), ['e4', 'e5', 'Nf3'])
  assert.equal(parseCommentCommands(g.roots[0].comments[0]).text, 'They get double isolated pawns.')
  assert.deepEqual(g.roots[0].children[0].comments, ['a line comment'])
})

test("suffix glyphs incl. '!!' '?!' '!?' '??' and NAG numbers", () => {
  const g = one('1. e4! e5? 2. Nf3!! Nc6?? 3. Bb5!? a6?! 4. Ba4 $1 $18 Nf6 $2 5. O-O ! b5 ?? 6. Bb3+! *')
  const ml: PgnNode[] = []
  for (let n: PgnNode | undefined = g.roots[0]; n; n = n.children[0]) ml.push(n)
  assert.deepEqual(
    ml.map((n) => [n.san, n.nags]),
    [
      ['e4', [1]],
      ['e5', [2]],
      ['Nf3', [3]],
      ['Nc6', [4]],
      ['Bb5', [5]],
      ['a6', [6]],
      ['Ba4', [1, 18]],
      ['Nf6', [2]],
      ['O-O', [1]],
      ['b5', [4]],
      ['Bb3+', [1]],
    ],
  )
})

test('[%cal]/[%csl] with multiple entries and all four colours', () => {
  const r = parseCommentCommands('Look [%cal Gd2d4,Rg8f6, Bb1c3,Ye2e4] here [%csl Gc4,Bd5,Rh7,Ya1]')
  assert.equal(r.text, 'Look here')
  assert.deepEqual(r.arrows, [
    { from: 'd2', to: 'd4', color: 'green' },
    { from: 'g8', to: 'f6', color: 'red' },
    { from: 'b1', to: 'c3', color: 'blue' },
    { from: 'e2', to: 'e4', color: 'yellow' },
  ])
  assert.deepEqual(r.highlights, [
    { square: 'c4', color: 'green' },
    { square: 'd5', color: 'blue' },
    { square: 'h7', color: 'red' },
    { square: 'a1', color: 'yellow' },
  ])
  const r2 = parseCommentCommands('[%csl Gd4][%cal Gd2d4]')
  assert.equal(r2.text, '')
  assert.equal(r2.arrows.length, 1)
  assert.equal(r2.highlights.length, 1)
})

test('[%clk]/[%eval]/[%emt]/[%anno ...] are stripped from text', () => {
  const r = parseCommentCommands('[%clk 0:10:00] [%eval 0.25] [%anno "SomeCoach", somecoach] Nice move [%emt 0:00:05] [%eval #-3,20]')
  assert.equal(r.text, 'Nice move')
  assert.deepEqual(r.arrows, [])
  assert.deepEqual(r.highlights, [])
  const g = one('1. Nf3 { [%clk 1:59:55] } 1... d5 { [%clk 1:58:46] } 2. d4 { [%anno "testuser", testuser] df } *')
  assert.equal(parseCommentCommands(g.roots[0].comments[0]).text, '')
  assert.equal(parseCommentCommands(g.roots[0].children[0].children[0].comments[0]).text, 'df')
})

test('malformed input never throws (unbalanced parens, unterminated comment, junk)', () => {
  assert.doesNotThrow(() => parsePgnFile('1. e4 ) ) e5 ( ( 2. Nf3 *'))
  assert.doesNotThrow(() => parsePgnFile('[Event "x"]\n1. e4 { never closed'))
  assert.doesNotThrow(() => parsePgnFile('] } $ $x 1. ?? !! e4 *'))
  assert.doesNotThrow(() => parsePgnFile(''))
  const g = one('[Event "x"]\n1. e4 (1. d4 d5 2. c4')
  assert.deepEqual(sans(g.roots), ['e4', 'd4'])
})

test('empty chapter', () => {
  const g = one('[Event "E"]\n[ChapterURL "https://lichess.org/study/CZiXOjIp/gXTvfVCy"]\n\n *\n')
  assert.deepEqual(g.roots, [])
  assert.deepEqual(g.intro, [])
  assert.equal(chapterIdOf(g), 'gXTvfVCy')
})

test('FEN-start chapter with black to move and 1... notation', () => {
  const fen = '2b1kb2/8/8/8/4K3/8/8/8 b - - 0 1'
  const rep = buildOne('1... Be6 2. Kd4 Bd6 3. Kd3 *', { FEN: fen, SetUp: '1' }, 'black')
  const ch = rep.chapters[0]
  assert.equal(ch.startFen, fen)
  const first = ch.roots[0]
  assert.equal(first.san, 'Be6')
  assert.equal(first.color, 'b')
  assert.equal(first.moveNumber, 1)
  assert.equal(first.ply, 1)
  assert.equal(first.children[0].moveNumber, 2)
  assert.equal(rep.lines.length, 1)
  assert.deepEqual(rep.lines[0].moves.map((m) => m.san), ['Be6', 'Kd4', 'Bd6']) // trimmed to end on a black move
})

test('castling both sides and promotion =Q / =N', () => {
  const fen = 'r3k2r/6P1/8/8/8/8/8/R3K2R w KQkq - 0 1'
  const rep = buildOne('1. O-O O-O-O 2. gxh8=Q (2. g8=N) 2... Rxh8 3. Ra7 Rh1+ 4. Kxh1 *', { FEN: fen, SetUp: '1' })
  const oo = rep.chapters[0].roots[0]
  assert.equal(oo.uci, 'e1g1')
  assert.equal(oo.san, 'O-O')
  const ooo = oo.children[0]
  assert.equal(ooo.uci, 'e8c8')
  assert.equal(ooo.san, 'O-O-O')
  const [promo, under] = ooo.children
  assert.equal(promo.uci, 'g7h8q')
  assert.equal(promo.promotion, 'q')
  assert.equal(promo.san, 'gxh8=Q')
  assert.equal(under.uci, 'g7g8n')
  assert.equal(under.promotion, 'n')
  assert.equal(under.san, 'g8=N')
  const check = promo.children[0].children[0].children[0]
  assert.equal(check.san, 'Rh1+')
  assert.equal(check.children[0].san, 'Kxh1')
})

test('unplayable SAN skips the branch with a warning, keeps the rest', () => {
  const { result: rep, warnings } = silenceWarnings(() => buildOne('1. e4 (1. Ke5 e5) (1. d4 Qxh7) 1... e5 2. Nf3 *'))
  assert.equal(warnings.length, 2)
  const roots = rep.chapters[0].roots
  assert.deepEqual(roots.map((n) => n.san), ['e4', 'd4'])
  assert.deepEqual(roots[1].children, [])
  assert.deepEqual(rep.lines.map((l) => l.moves.map((m) => m.san).join(' ')), ['e4 e5 Nf3', 'd4'])
})

test('comments on nodes become MoveNode.comment / arrows / highlights; intro on chapter', () => {
  const rep = buildOne('{ Hello [%csl Ge4] } 1. e4 { Center! [%cal Gd2d4] } { more } e5 { [%clk 0:01:00] } Nf3 { df } *')
  const ch = rep.chapters[0]
  assert.equal(ch.intro, 'Hello')
  assert.deepEqual(ch.introHighlights, [{ square: 'e4', color: 'green' }])
  const e4 = ch.roots[0]
  assert.equal(e4.comment, 'Center! more')
  assert.deepEqual(e4.arrows, [{ from: 'd2', to: 'd4', color: 'green' }])
  assert.equal(e4.children[0].comment, undefined)
  // A stray keystroke (fewer than 3 letters) is not a coach comment (review: chess #9).
  assert.equal(e4.children[0].children[0].comment, undefined)
})

// ---------------------------------------------------------------------------
// Real study files
// ---------------------------------------------------------------------------

const PUBLIC = new URL('../public/studies/opening-lines.pgn', import.meta.url)
const RAW = new URL('../data/studies/opening-lines-CZiXOjIp.raw.pgn', import.meta.url)

/** Replays every node with chess.js's public API and checks SAN/uci/FENs. */
function verifyTree(nodes: MoveNode[], chess: Chess): number {
  let n = 0
  for (const node of nodes) {
    chess.load(node.fenBefore)
    const m = chess.move(node.san)
    assert.equal(m.san, node.san, `san ${node.id}`)
    assert.equal(m.from + m.to + (m.promotion ?? ''), node.uci, `uci ${node.id}`)
    assert.equal(m.after, node.fen, `fen ${node.id}`)
    assert.equal(m.color, node.color, `color ${node.id}`)
    n += 1 + verifyTree(node.children, chess)
  }
  return n
}

/** uci tree signature for comparing the public extract against the raw export. */
function signature(nodes: MoveNode[]): string {
  return nodes.map((n) => n.uci + (n.children.length ? `(${signature(n.children)})` : '')).join(',')
}

function allChaptersDef(games: PgnGame[]): OpeningDef {
  return {
    id: 'all',
    name: 'All',
    tagline: '',
    side: 'white',
    emoji: '',
    accent: '',
    chapters: games.map((g) => ({ id: chapterIdOf(g) ?? '', title: g.headers.ChapterName ?? '' })),
    extraChapters: [],
  }
}

console.log('\nReal study data')

test('public extract: 23 chapters, all ids present, zero unplayable moves, SAN/FEN verified', () => {
  const games = parsePgnFile(readFileSync(PUBLIC, 'utf8'))
  assert.equal(games.length, 23)
  const ids = games.map(chapterIdOf)
  assert.ok(ids.every((x) => x && x.length === 8), 'every chapter has a ChapterURL id')
  assert.equal(new Set(ids).size, games.length)
  const { result: rep, warnings } = silenceWarnings(() => buildRepertoire(allChaptersDef(games), games, { maxPly: 0, enabledExtras: [] }))
  assert.deepEqual(warnings, [])
  const chess = new Chess()
  let n = 0
  for (const ch of rep.chapters) n += verifyTree(ch.roots, chess)
  assert.equal(n, rep.nodesById.size)
  console.log(`       ${games.length} chapters, ${n} nodes replayed with chess.js`)
})

if (existsSync(RAW)) {
  test('raw export: all 53 chapters parse and build without throwing; zero unplayable moves', () => {
    const t0 = performance.now()
    const games = parsePgnFile(readFileSync(RAW, 'utf8'))
    const t1 = performance.now()
    assert.equal(games.length, 53)
    const ids = games.map(chapterIdOf)
    assert.ok(ids.every((x) => x && x.length === 8))
    assert.equal(new Set(ids).size, 53)
    // Parsing fidelity: build WITHOUT the study overrides (they cut/insert moves on purpose).
    const { result: rep, warnings } = silenceWarnings(() =>
      buildRepertoire(allChaptersDef(games), games, { maxPly: 0, enabledExtras: [], overrides: [] }),
    )
    const t2 = performance.now()
    if (warnings.length) console.log(warnings.join('\n'))
    assert.equal(warnings.length, 0, 'unplayable SAN warnings')
    assert.equal(rep.chapters.length, 53)
    const empty = games.filter((g) => g.roots.length === 0).length
    const fenStarts = games.filter((g) => g.headers.FEN).length
    const clk = games.filter((g) => JSON.stringify(g.roots).includes('[%clk')).length
    const chess = new Chess()
    let n = 0
    for (const ch of rep.chapters) n += verifyTree(ch.roots, chess)
    assert.equal(n, rep.nodesById.size)
    // Every node's SAN equals the PGN's SAN (minus check marks), i.e. nothing was silently re-interpreted.
    const pgnSans: string[] = []
    const walk = (ns: PgnNode[]) => ns.forEach((x) => (pgnSans.push(x.san.replace(/[+#]/g, '')), walk(x.children)))
    games.forEach((g) => walk(g.roots))
    const nodeSans: string[] = []
    const walk2 = (ns: MoveNode[]) => ns.forEach((x) => (nodeSans.push(x.san.replace(/[+#]/g, '')), walk2(x.children)))
    rep.chapters.forEach((c) => walk2(c.roots))
    assert.deepEqual(nodeSans, pgnSans)
    // NAGs / glyphs from the raw file
    const nags = new Map<number, number>()
    for (const node of rep.nodesById.values()) for (const x of node.nags) nags.set(x, (nags.get(x) ?? 0) + 1)
    assert.ok((nags.get(18) ?? 0) > 0, '$18 present')
    assert.ok((nags.get(4) ?? 0) > 0 && (nags.get(6) ?? 0) > 0, '?? and ?! present')
    // No [%...] command leaks into cleaned comments
    for (const node of rep.nodesById.values()) assert.ok(!node.comment || !node.comment.includes('[%'), `clean comment ${node.id}`)
    console.log(
      `       53 chapters (${empty} empty, ${fenStarts} FEN start, ${clk} with [%clk]); ${n} nodes; parse ${(t1 - t0).toFixed(0)} ms, build ${(t2 - t1).toFixed(0)} ms; NAGs ${[...nags].map(([k, v]) => `$${k}x${v}`).join(' ')}`,
    )
  })

  test('public extract has the same move trees as the raw export for its 23 chapters', () => {
    const raw = parsePgnFile(readFileSync(RAW, 'utf8'))
    const pub = parsePgnFile(readFileSync(PUBLIC, 'utf8'))
    const def = allChaptersDef(pub)
    const a = buildRepertoire(def, pub, { maxPly: 0, enabledExtras: [] })
    const b = buildRepertoire(def, raw, { maxPly: 0, enabledExtras: [] })
    assert.equal(a.chapters.length, b.chapters.length)
    for (let i = 0; i < a.chapters.length; i++) {
      assert.equal(signature(a.chapters[i].roots), signature(b.chapters[i].roots), a.chapters[i].id)
    }
    assert.deepEqual(
      a.lines.map((l) => l.id),
      b.lines.map((l) => l.id),
    )
  })
} else {
  console.log(`  SKIP raw export not found at ${RAW.pathname} (it is gitignored)`)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
