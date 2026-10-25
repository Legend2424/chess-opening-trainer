// Trainer reducer tests. Run: node scripts/test-trainer.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import { parsePgnFile } from '../src/chess/pgn.ts'
import { bookMovesAt, buildRepertoire, isBlunder, isDubious, positionKey, userColorOf } from '../src/chess/repertoire.ts'
import { pickLine, seededRng, updateLineStats } from '../src/chess/scheduler.ts'
import { OPENINGS } from '../src/data/openings.ts'
import type { StudyOverride } from '../src/data/studyOverrides.ts'
import { currentNode, expectedNode, initTrainer, trainerReducer, userMoveIndex } from '../src/trainer/trainerReducer.ts'
import type { FeedbackKind, TrainerConfig, TrainerContext, TrainerState } from '../src/trainer/trainerReducer.ts'
import type { Line, MoveNode, OpeningDef, Repertoire, TrainerMode } from '../src/types.ts'

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
const allExtras = (o: OpeningDef) => o.extraChapters.map((c) => c.id)
const reps30 = OPENINGS.map((o) => buildRepertoire(o, games, { maxPly: 30, enabledExtras: allExtras(o) }))
const reps0 = OPENINGS.map((o) => buildRepertoire(o, games, { maxPly: 0, enabledExtras: allExtras(o) }))

/** '[trainer] ...' warnings (board/line desync). Any unexpected one fails the run. */
const trainerWarnings: string[] = []
const origWarn = console.warn
console.warn = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  if (msg.startsWith('[trainer]')) trainerWarnings.push(msg)
  else origWarn(...args)
}

const firstPick = (lines: Line[]) => lines[0]
/** Prefers `id` whenever it is offered (keeps the random-mode target stable). */
const prefer = (id: string) => (lines: Line[]) => lines.find((l) => l.id === id) ?? lines[0]
const ctxOf = (rep: Repertoire, pick: (lines: Line[]) => Line = firstPick): TrainerContext => ({ rep, pick })
const cfg = (rep: Repertoire, mode: TrainerMode, learnMode = false): TrainerConfig => ({ mode, learnMode, userColor: userColorOf(rep.opening) })

function opp(s: TrainerState, ctx: TrainerContext): TrainerState {
  return trainerReducer(s, { type: 'opponentMove', ctx })
}
function play(s: TrainerState, ctx: TrainerContext, from: string, to: string, promotion?: string): TrainerState {
  return trainerReducer(s, promotion ? { type: 'userMove', from, to, promotion, ctx } : { type: 'userMove', from, to, ctx })
}
function playNode(s: TrainerState, ctx: TrainerContext, n: MoveNode): TrainerState {
  return play(s, ctx, n.from, n.to, n.promotion)
}

/** Plays the expected moves (opponent auto) until `stop(state)` or completion. Returns the final state and feedback log. */
function drive(s: TrainerState, ctx: TrainerContext, stop: (s: TrainerState) => boolean = () => false) {
  const log: FeedbackKind[] = []
  let guard = 0
  while (s.phase !== 'complete' && !stop(s)) {
    assert.ok(guard++ < 1000, 'runaway')
    if (s.phase === 'opponentToMove') s = opp(s, ctx)
    else if (s.phase === 'userToMove') {
      const e = expectedNode(s)
      assert.ok(e, 'expected node at user turn')
      const next = playNode(s, ctx, e)
      assert.notEqual(next, s, 'expected move must be accepted')
      s = next
    } else assert.fail(`unexpected phase ${s.phase}`)
    if (s.feedback) log.push(s.feedback.kind)
  }
  return { s, log }
}

/** Plays `line` (inorder) up to `ply`, user's turn. */
function reach(rep: Repertoire, line: Line, ply: number, mode: TrainerMode = 'inorder', pick?: (lines: Line[]) => Line) {
  const ctx = ctxOf(rep, pick ?? prefer(line.id))
  const { s } = drive(initTrainer(line, cfg(rep, mode), ctx), ctx, (st) => st.ply >= ply)
  assert.equal(s.ply, ply)
  assert.equal(s.phase, 'userToMove')
  return { s, ctx }
}

/** A legal move at `fen` that is not a book move there. */
function nonBookMove(rep: Repertoire, fen: string): { from: string; to: string; promotion?: string } {
  const book = new Set(bookMovesAt(rep, fen).map((n) => n.uci))
  const moves = new Chess(fen).moves({ verbose: true })
  const m = moves.find((x) => !book.has(x.from + x.to + (x.promotion ?? '')))
  assert.ok(m, 'some non-book legal move')
  return m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to }
}

// ---------------------------------------------------------------------------
console.log('Full replays')

for (const [label, reps] of [
  ['maxPly 30 + extras', reps30],
  ['maxPly 0 + extras', reps0],
] as const) {
  test(`inorder: every line of every opening replays perfectly (${label})`, () => {
    let n = 0
    let plies = 0
    for (const rep of reps) {
      const ctx = ctxOf(rep)
      for (const line of rep.lines) {
        let s = initTrainer(line, cfg(rep, 'inorder'), ctx)
        assert.equal(s.phase, line.moves[0].color === userColorOf(rep.opening) ? 'userToMove' : 'opponentToMove')
        assert.equal(s.userMoveMarks.length, line.userMoveCount)
        assert.equal(currentNode(s), null)
        let sawBlunder = false
        let guard = 0
        while (s.phase !== 'complete') {
          assert.ok(guard++ < 500)
          if (s.phase === 'opponentToMove') {
            assert.equal(expectedNode(s), null)
            s = opp(s, ctx)
            const last = s.history[s.history.length - 1]
            assert.equal(last.by, 'opponent')
            // A move marked ?/?? here OR in another chapter (same position + move) is a blunder.
            if (isBlunder(line.moves[s.ply - 1])) assert.equal(s.feedback?.kind, 'opponent-blunder')
            if (s.feedback?.kind === 'opponent-blunder') sawBlunder = true
          } else {
            const e = expectedNode(s)!
            assert.equal(e, line.moves[s.ply])
            assert.equal(userMoveIndex(s), line.moves.slice(0, s.ply).filter((m) => m.color === userColorOf(rep.opening)).length)
            s = playNode(s, ctx, e)
            assert.equal(s.feedback?.kind, s.phase === 'complete' ? 'complete' : 'correct')
          }
          assert.equal(currentNode(s), line.moves[s.ply - 1])
          assert.equal(s.fen, line.moves[s.ply - 1].fen)
        }
        assert.equal(s.line, line)
        assert.equal(s.ply, line.moves.length)
        assert.equal(s.mistakes, 0)
        assert.equal(s.hintsUsed, 0)
        assert.equal(s.usedArrowHint, false)
        assert.ok(s.userMoveMarks.every((m) => m === 'clean'))
        assert.equal(s.opponentBlundered, line.hasOpponentBlunder)
        assert.equal(sawBlunder, line.hasOpponentBlunder)
        assert.deepEqual(
          s.history.map((h) => h.uci),
          line.moves.map((m) => m.uci),
        )
        assert.deepEqual(
          s.history.map((h) => h.nodeId),
          line.moves.map((m) => m.id),
        )
        assert.equal(userMoveIndex(s), line.userMoveCount)
        n++
        plies += line.moves.length
      }
    }
    console.log(`       ${n} lines, ${plies} plies`)
  })
}

test('random mode: every line completes when the picker prefers it', () => {
  let n = 0
  for (const rep of reps30) {
    for (const line of rep.lines) {
      const ctx = ctxOf(rep, prefer(line.id))
      const { s } = drive(initTrainer(line, cfg(rep, 'random'), ctx), ctx)
      assert.equal(s.phase, 'complete')
      assert.equal(s.line.id, line.id)
      assert.equal(s.mistakes, 0)
      assert.ok(s.candidates.includes(line.id))
      n++
    }
  }
  console.log(`       ${n} lines`)
})

test('random mode: opponent varies its replies (seeded pickLine); history always matches the target line', () => {
  const rng = seededRng(2026)
  for (const rep of reps30) {
    const finals = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const ctx = ctxOf(rep, (lines) => pickLine(lines, {}, 0, { rng }))
      const start = rep.lines[0]
      const { s } = drive(initTrainer(start, cfg(rep, 'random'), ctx), ctx)
      assert.equal(s.phase, 'complete')
      assert.equal(s.mistakes, 0)
      assert.deepEqual(
        s.history.map((h) => h.uci),
        s.line.moves.map((m) => m.uci),
      )
      assert.equal(s.userMoveMarks.length, s.line.userMoveCount)
      assert.ok(s.userMoveMarks.every((m) => m === 'clean'))
      finals.add(s.line.id)
    }
    assert.ok(finals.size > Math.min(20, rep.lines.length / 3), `${rep.opening.id}: only ${finals.size} distinct lines reached`)
    console.log(`       ${rep.opening.id}: 300 games reached ${finals.size}/${rep.lines.length} distinct lines`)
  }
})

// ---------------------------------------------------------------------------
console.log('Mistakes, hints, take-backs')

test('wrong move -> wrongMove -> takeBack -> hint escalation (2 => level 1, 3 => level 2)', () => {
  const rep = reps30[0] // Sicilian: opponent moves first
  const line = rep.lines[0]
  const ctx = ctxOf(rep)
  let s = opp(initTrainer(line, cfg(rep, 'inorder'), ctx), ctx)
  assert.equal(s.phase, 'userToMove')
  const before = s
  const bad = nonBookMove(rep, s.fen)
  const exp = expectedNode(s)!

  s = play(s, ctx, bad.from, bad.to, bad.promotion)
  assert.equal(s.phase, 'wrongMove')
  assert.equal(s.feedback?.kind, 'wrong')
  assert.equal(s.feedback?.node, exp)
  assert.equal(s.wrong?.from, bad.from)
  assert.equal(s.wrong?.nodeId, null)
  assert.notEqual(s.fen, before.fen, 'board shows the wrong move')
  assert.deepEqual(s.lastMove, [bad.from, bad.to])
  assert.equal(s.mistakes, 1)
  assert.equal(s.mistakesHere, 1)
  assert.equal(s.history.length, before.history.length, 'wrong move is not in history')
  assert.equal(expectedNode(s), exp, 'expected node still available while the wrong move is shown')
  // nothing but takeBack works now
  assert.equal(playNode(s, ctx, exp), s)
  assert.equal(trainerReducer(s, { type: 'hint' }), s)
  assert.equal(opp(s, ctx), s)

  s = trainerReducer(s, { type: 'takeBack' })
  assert.equal(s.phase, 'userToMove')
  assert.equal(s.wrong, null)
  assert.equal(s.fen, before.fen)
  assert.deepEqual(s.lastMove, before.lastMove)
  assert.equal(s.hintLevel, 0, '1 mistake: no hint yet')
  assert.equal(trainerReducer(s, { type: 'takeBack' }), s, 'takeBack only in wrongMove')

  s = trainerReducer(play(s, ctx, bad.from, bad.to, bad.promotion), { type: 'takeBack' })
  assert.equal(s.mistakesHere, 2)
  assert.ok(s.hintLevel >= 1, '2 mistakes: piece highlight')
  assert.equal(s.feedback?.kind, 'hint')
  assert.equal(s.feedback?.node, exp)

  s = trainerReducer(play(s, ctx, bad.from, bad.to, bad.promotion), { type: 'takeBack' })
  assert.equal(s.mistakesHere, 3)
  assert.equal(s.hintLevel, 2, '3 mistakes: arrow')
  assert.equal(s.mistakes, 3)
  assert.equal(s.hintsUsed, 0, 'escalation is not a requested hint')

  s = playNode(s, ctx, exp)
  assert.equal(s.feedback?.kind, 'correct')
  assert.equal(s.mistakesHere, 0)
  assert.equal(s.hintLevel, 0)
  assert.equal(s.userMoveMarks[0], 'fixed')
  const { s: done } = drive(s, ctx)
  assert.equal(done.phase, 'complete')
  assert.equal(done.mistakes, 3)
  assert.deepEqual(done.userMoveMarks.slice(1), new Array(done.userMoveMarks.length - 1).fill('clean'))
})

test('hint action: 0 -> 1 -> 2 (arrow), capped, counted; marks the move fixed', () => {
  const rep = reps30[1] // London: user moves first
  const line = rep.lines[0]
  const ctx = ctxOf(rep)
  let s = initTrainer(line, cfg(rep, 'inorder'), ctx)
  assert.equal(s.phase, 'userToMove')
  s = trainerReducer(s, { type: 'hint' })
  assert.equal(s.hintLevel, 1)
  assert.equal(s.feedback?.kind, 'hint')
  assert.equal(s.feedback?.node, line.moves[0])
  assert.equal(s.usedArrowHint, false)
  s = trainerReducer(s, { type: 'hint' })
  assert.equal(s.hintLevel, 2)
  assert.equal(s.usedArrowHint, true)
  assert.equal(trainerReducer(s, { type: 'hint' }), s, 'capped at 2')
  assert.equal(s.hintsUsed, 2)
  s = playNode(s, ctx, line.moves[0])
  assert.equal(s.userMoveMarks[0], 'fixed')
  assert.equal(s.hintLevel, 0)
  assert.equal(trainerReducer(s, { type: 'hint' }), s, 'no hints on the opponent turn')
})

test('illegal moves and out-of-turn actions leave the state unchanged', () => {
  const rep = reps30[1]
  const line = rep.lines[0]
  const ctx = ctxOf(rep)
  const s = initTrainer(line, cfg(rep, 'inorder'), ctx)
  assert.equal(play(s, ctx, 'e2', 'e5'), s)
  assert.equal(play(s, ctx, 'e7', 'e5'), s, "opponent's piece")
  assert.equal(play(s, ctx, 'e4', 'e5'), s, 'empty square')
  assert.equal(play(s, ctx, 'z9', 'e5'), s, 'nonsense square')
  assert.equal(opp(s, ctx), s, 'not the opponent turn')
  const s2 = playNode(s, ctx, line.moves[0])
  assert.equal(s2.phase, 'opponentToMove')
  assert.equal(playNode(s2, ctx, line.moves[1]), s2, 'not the user turn')
})

test('restart: back to the start of the same line, config kept, feedback ids keep increasing', () => {
  const rep = reps30[0]
  const line = rep.lines[3]
  const ctx = ctxOf(rep)
  let s = opp(initTrainer(line, cfg(rep, 'chapter', true), ctx), ctx)
  const bad = nonBookMove(rep, s.fen)
  s = play(s, ctx, bad.from, bad.to, bad.promotion)
  const seq = s.feedback!.id
  const r = trainerReducer(s, { type: 'restart' })
  const fresh = initTrainer(line, cfg(rep, 'chapter', true), ctx)
  assert.equal(r.line, line)
  assert.deepEqual(r.config, { mode: 'chapter', learnMode: true, userColor: 'b' })
  for (const k of ['ply', 'fen', 'history', 'lastMove', 'phase', 'wrong', 'mistakes', 'mistakesHere', 'hintLevel', 'hintsUsed', 'usedArrowHint', 'userMoveMarks', 'opponentBlundered', 'feedback'] as const) {
    assert.deepEqual(r[k], fresh[k], k)
  }
  const r2 = opp(r, ctx)
  const r3 = play(r2, ctx, bad.from, bad.to, bad.promotion)
  assert.ok(r3.feedback!.id > seq)
})

// ---------------------------------------------------------------------------
console.log('Book moves: known-bad, other-line, book-alt')

/** Finds (line, ply, node) where the user to move could play a book node matching `want` other than the expected one. */
function findAlt(rep: Repertoire, want: (n: MoveNode, line: Line, ply: number) => boolean) {
  const u = userColorOf(rep.opening)
  for (const line of rep.lines) {
    for (let k = 0; k < line.moves.length; k++) {
      const e = line.moves[k]
      if (e.color !== u) continue
      for (const n of bookMovesAt(rep, e.fenBefore)) if (n.uci !== e.uci && want(n, line, k)) return { line, ply: k, node: n }
    }
  }
  return null
}

test('known-bad: a real dubious user move from the study (Sicilian 5...Nxd4?, London 9.Bd3??, vs-d4 8...dxc4?!)', () => {
  let found = 0
  for (const rep of reps30) {
    const hit = findAlt(rep, (n) => isDubious(n))
    if (!hit) continue
    found++
    const { s, ctx } = reach(rep, hit.line, hit.ply)
    const r = playNode(s, ctx, hit.node)
    assert.equal(r.phase, 'wrongMove')
    assert.equal(r.feedback?.kind, 'known-bad')
    assert.equal(r.feedback?.node, hit.node)
    // The study's answer (red arrow) only for a real mistake ?/??, not for a dubious ?! (review: chess #5).
    if (isBlunder(hit.node)) {
      assert.ok(r.feedback?.refutation, 'refutation present')
      assert.equal(r.feedback?.refutation?.parentId, hit.node.id)
    } else assert.equal(r.feedback?.refutation, undefined)
    assert.equal(r.wrong?.nodeId, hit.node.id)
    assert.equal(r.mistakes, 1)
    assert.equal(r.mistakesHere, 1)
    assert.equal(r.fen, hit.node.fen)
    const t = trainerReducer(r, { type: 'takeBack' })
    assert.equal(t.fen, s.fen)
    const { s: done } = drive(t, ctx)
    assert.equal(done.phase, 'complete')
    assert.equal(done.userMoveMarks[userMoveIndex(s)], 'fixed')
    console.log(
      `       ${rep.opening.id}: ${hit.node.moveNumber}${hit.node.color === 'w' ? '.' : '...'}${hit.node.san} (nags ${hit.node.nags}) refuted by ${r.feedback?.refutation?.san} in line "${hit.line.name}"`,
    )
  }
  assert.equal(found, 3, 'Sicilian, London and vs-d4 each have a reachable dubious user move')
  // also in random mode
  const rep = reps30[1]
  const hit = findAlt(rep, (n) => isDubious(n))!
  const { s, ctx } = reach(rep, hit.line, hit.ply, 'random')
  assert.equal(playNode(s, ctx, hit.node).feedback?.kind, 'known-bad')
  // …and a move marked by an override (studyOverrides.ts), not by the coach: Alapin 10...Qxb2?? 11.Rb1.
  const sic = reps30[0]
  const qxb2 = findAlt(sic, (n) => n.san === 'Qxb2' && isDubious(n))
  assert.ok(qxb2, '10...Qxb2?? is a book alternative after 10.O-O')
  const q = reach(sic, qxb2.line, qxb2.ply)
  const rq = playNode(q.s, q.ctx, qxb2.node)
  assert.equal(rq.feedback?.kind, 'known-bad')
  assert.equal(rq.feedback?.refutation?.san, 'Rb1')
})

test("inorder: a different non-dubious book move -> 'other-line', not played, no mistake, free highlight", () => {
  for (const rep of reps30) {
    const hit = findAlt(rep, (n) => !isDubious(n))
    assert.ok(hit, `${rep.opening.id}: no alternative book move found`)
    for (const mode of ['inorder', 'chapter'] as const) {
      const { s, ctx } = reach(rep, hit.line, hit.ply, mode)
      const r = playNode(s, ctx, hit.node)
      assert.equal(r.feedback?.kind, 'other-line')
      assert.equal(r.feedback?.node?.uci, hit.node.uci)
      assert.equal(r.phase, 'userToMove')
      assert.equal(r.ply, s.ply)
      assert.equal(r.fen, s.fen)
      assert.equal(r.history, s.history)
      assert.equal(r.mistakes, 0)
      assert.equal(r.mistakesHere, 0)
      assert.equal(r.hintsUsed, 0)
      assert.equal(r.hintLevel, 1)
      assert.equal(r.line, hit.line)
      const c = playNode(r, ctx, hit.line.moves[hit.ply])
      assert.ok(c.feedback?.kind === 'correct' || c.feedback?.kind === 'complete')
      assert.equal(c.userMoveMarks[userMoveIndex(s)], 'clean', 'a free highlight does not make it "fixed"')
    }
  }
})

test("random mode: a different book move -> 'book-alt', retargets to a line through that move", () => {
  for (const rep of reps30) {
    // an alternative that some line with the same move order continues with
    const hit = findAlt(rep, (n, line, ply) =>
      !isDubious(n) &&
      rep.lines.some((l) => l.moves.length > ply + 1 && l.moves[ply].uci === n.uci && l.moves.slice(0, ply).every((m, i) => m.uci === line.moves[i].uci)),
    )
    assert.ok(hit, `${rep.opening.id}: no book-alt case`)
    const reached = reach(rep, hit.line, hit.ply, 'random')
    const s = reached.s
    // from here on, follow the longest line on offer (so the retargeted line does not end right away)
    const ctx = ctxOf(rep, (lines) => lines.reduce((a, b) => (b.moves.length > a.moves.length ? b : a)))
    const r = playNode(s, ctx, hit.node)
    assert.equal(r.feedback?.kind, 'book-alt')
    assert.notEqual(r.line.id, hit.line.id)
    assert.equal(r.ply, hit.ply + 1)
    assert.equal(r.line.moves[hit.ply].uci, hit.node.uci)
    assert.equal(r.history[r.history.length - 1].uci, hit.node.uci)
    assert.equal(r.mistakes, 0)
    assert.ok(r.candidates.includes(r.line.id))
    for (const id of r.candidates) {
      const l = rep.lines.find((x) => x.id === id)!
      assert.deepEqual(
        l.moves.slice(0, r.ply).map((m) => m.uci),
        r.history.map((h) => h.uci),
      )
    }
    assert.equal(r.userMoveMarks.length, r.line.userMoveCount)
    const { s: done } = drive(r, { ...ctx, pick: firstPick })
    assert.equal(done.phase, 'complete')
    assert.equal(done.mistakes, 0)
    assert.deepEqual(
      done.history.map((h) => h.uci),
      done.line.moves.map((m) => m.uci),
    )
    console.log(`       ${rep.opening.id}: "${hit.line.name}" -> "${r.line.name}" via ${hit.node.san}`)
  }
})

test('random mode: book-alt through a transposition in the real study (falls back to linesByNode)', () => {
  let found = 0
  for (const rep of reps0) {
    const u = userColorOf(rep.opening)
    // positions where the user can play a book move that no line with the same move order has
    outer: for (const line of rep.lines) {
      for (let k = 0; k < line.moves.length; k++) {
        if (line.moves[k].color !== u) continue
        const prefix = line.moves.slice(0, k).map((m) => m.uci)
        const sameOrder = rep.lines.filter((l) => l.moves.length > k && l.moves.slice(0, k).every((m, i) => m.uci === prefix[i]))
        for (const n of bookMovesAt(rep, line.moves[k].fenBefore)) {
          if (isDubious(n) || sameOrder.some((l) => l.moves[k].uci === n.uci)) continue
          // a transposition only counts when the other line has this position at the SAME ply
          // (and the same start); cross-ply cases are covered by the 'other-line' test below
          const through = rep.lines.filter((l) =>
            positionKey(l.startFen) === positionKey(line.startFen) &&
            l.moves[k]?.uci === n.uci && positionKey(l.moves[k].fenBefore) === positionKey(line.moves[k].fenBefore),
          )
          if (!through.length) continue
          const { s, ctx } = reach(rep, line, k, 'random')
          const r = playNode(s, ctx, n)
          assert.ok(r.feedback?.kind === 'book-alt' || r.feedback?.kind === 'complete', `got ${r.feedback?.kind}`)
          assert.ok(through.some((l) => l.id === r.line.id))
          assert.equal(positionKey(r.line.moves[r.ply - 1].fen), positionKey(r.fen), 'aligned on the transposed position')
          assert.equal(r.line.moves[r.ply - 1].uci, n.uci)
          assert.equal(r.ply, k + 1, 'same ply')
          assert.equal(r.history.length, r.ply)
          const { s: done } = drive(r, { ...ctx, pick: firstPick })
          assert.equal(done.phase, 'complete')
          assert.equal(done.mistakes, 0)
          console.log(
            `       ${rep.opening.id}: in "${line.chapterTitle} / ${line.name}" played ${n.san} -> "${r.line.chapterTitle} / ${r.line.name}" (${r.line.moves.slice(0, r.ply).map((m) => m.san).join(' ')})`,
          )
          found++
          break outer
        }
      }
    }
  }
  assert.ok(found >= 1, 'at least one real transposition case')
})

// ---------------------------------------------------------------------------
console.log('Synthetic study')

const SYN = `[ChapterName "QGD"]
[ChapterURL "https://lichess.org/study/TEST0000/AAAAAAAA"]

{ Play d5 and e6. } 1. d4 d5 2. c4 e6 (2... c5?! { too sharp } 3. cxd5 { [%cal Gd1a4] } Qxd5) 3. Nc3 Nf6 4. Bg5?? dxc4 *

[ChapterName "English"]
[ChapterURL "https://lichess.org/study/TEST0000/BBBBBBBB"]

1. c4 e6 2. d4 d5 3. Nc3 Be7 4. Nf3 Nf6 *

[ChapterName "Promo"]
[ChapterURL "https://lichess.org/study/TEST0000/CCCCCCCC"]
[FEN "8/8/8/8/8/8/k3p3/6K1 b - - 0 1"]
[SetUp "1"]

1... e1=Q+ 2. Kg2 Qe4+ *
`
const synDef: OpeningDef = {
  id: 'syn',
  name: 'Syn',
  tagline: '',
  side: 'black',
  emoji: '',
  accent: '',
  chapters: [
    { id: 'AAAAAAAA', title: 'QGD' },
    { id: 'BBBBBBBB', title: 'English' },
    { id: 'CCCCCCCC', title: 'Promo' },
  ],
  extraChapters: [],
}
const syn = buildRepertoire(synDef, parsePgnFile(SYN), { maxPly: 0, enabledExtras: [] })

test('synthetic repertoire: lines and names', () => {
  assert.deepEqual(
    syn.lines.map((l) => `${l.chapterId}: ${l.name}: ${l.moves.map((m) => m.san).join(' ')}`),
    [
      'AAAAAAAA: Main line: d4 d5 c4 e6 Nc3 Nf6 Bg5 dxc4',
      'BBBBBBBB: Main line: c4 e6 d4 d5 Nc3 Be7 Nf3 Nf6',
      'CCCCCCCC: Main line: e1=Q+ Kg2 Qe4+',
    ],
  )
  assert.equal(syn.lines[0].hasOpponentBlunder, true)
})

test('synthetic: transposition 1.d4 d5 2.c4 e6 3.Nc3 Be7 retargets to the English chapter', () => {
  const A = syn.lines[0]
  const ctx = ctxOf(syn, prefer(A.id))
  let s = initTrainer(A, cfg(syn, 'random'), ctx)
  assert.equal(s.candidates.length, 2, 'both chapters start from the initial position')
  s = drive(s, ctx, (st) => st.ply >= 5).s
  assert.equal(s.candidates.length, 1)
  const r = play(s, ctx, 'f8', 'e7')
  assert.equal(r.feedback?.kind, 'book-alt')
  assert.equal(r.line.chapterId, 'BBBBBBBB')
  assert.equal(r.ply, 6)
  assert.deepEqual(r.candidates, [syn.lines[1].id])
  assert.equal(currentNode(r)?.san, 'Be7')
  assert.deepEqual(r.userMoveMarks, ['clean', 'clean', 'clean', 'pending'])
  const { s: done } = drive(r, ctx)
  assert.equal(done.phase, 'complete')
  assert.equal(done.line.chapterId, 'BBBBBBBB')
  assert.deepEqual(
    done.history.map((h) => h.san),
    ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Be7', 'Nf3', 'Nf6'],
  )
  // same move in inorder mode is only 'other-line'
  const s2 = drive(initTrainer(A, cfg(syn, 'inorder'), ctx), ctx, (st) => st.ply >= 5).s
  const r2 = play(s2, ctx, 'f8', 'e7')
  assert.equal(r2.feedback?.kind, 'other-line')
  assert.equal(r2.ply, 5)
})

test('synthetic: known-bad 2...c5?! with refutation 3.cxd5; opponent blunder 4.Bg5??', () => {
  const A = syn.lines[0]
  const ctx = ctxOf(syn)
  let s = drive(initTrainer(A, cfg(syn, 'inorder'), ctx), ctx, (st) => st.ply >= 3).s
  const r = play(s, ctx, 'c7', 'c5')
  assert.equal(r.feedback?.kind, 'known-bad')
  // ?! is only dubious: no "your opponent can answer…" refutation / red arrow (review: chess #5)
  assert.equal(r.feedback?.refutation, undefined)
  assert.equal(r.feedback?.node?.children[0]?.san, 'cxd5')
  assert.deepEqual(r.feedback?.node?.children[0]?.arrows, [{ from: 'd1', to: 'a4', color: 'green' }])
  assert.equal(r.feedback?.node?.comment, 'too sharp')
  s = trainerReducer(r, { type: 'takeBack' })
  const { s: done, log } = drive(s, ctx)
  assert.equal(done.phase, 'complete')
  assert.ok(log.includes('opponent-blunder'))
  assert.equal(done.opponentBlundered, true)
  assert.equal(done.mistakes, 1)
})

test('synthetic: promotion needs the promotion piece; =Q accepted (any case), =N is wrong', () => {
  const P = syn.lines[2]
  const ctx = ctxOf(syn)
  const s = initTrainer(P, cfg(syn, 'inorder'), ctx)
  assert.equal(s.phase, 'userToMove')
  assert.equal(play(s, ctx, 'e2', 'e1'), s, 'promotion without piece is not a legal move')
  const n = play(s, ctx, 'e2', 'e1', 'n')
  assert.equal(n.phase, 'wrongMove')
  const N = play(s, ctx, 'e2', 'e1', 'N')
  assert.equal(N.phase, 'wrongMove', 'upper-case N is the same wrong move')
  assert.equal(N.wrong?.uci, 'e2e1n')
  const Q = play(s, ctx, 'e2', 'e1', 'Q')
  assert.equal(Q.feedback?.kind, 'correct', 'upper-case Q is accepted (regression: was treated as illegal)')
  assert.equal(Q.history[0].uci, 'e2e1q')
  const q = play(s, ctx, 'e2', 'e1', 'q')
  assert.equal(q.feedback?.kind, 'correct')
  assert.equal(q.history[0].san, 'e1=Q+')
  const { s: done } = drive(q, ctx)
  assert.equal(done.phase, 'complete')
})

test('a move marked ?! in one chapter but played plainly in another counts as a good book move', () => {
  const pgn = `[ChapterURL "https://lichess.org/study/TEST0000/XXXXXXXX"]

1. d4 d5 2. c4 c5?! (2... e6 3. Nc3) *

[ChapterURL "https://lichess.org/study/TEST0000/YYYYYYYY"]

1. d4 d5 2. c4 c5 3. cxd5 Qxd5 *
`
  const def: OpeningDef = { ...synDef, chapters: [{ id: 'XXXXXXXX', title: 'X' }, { id: 'YYYYYYYY', title: 'Y' }] }
  const rep = buildRepertoire(def, parsePgnFile(pgn), { maxPly: 0, enabledExtras: [] })
  assert.deepEqual(
    rep.lines.map((l) => `${l.name}: ${l.moves.map((m) => m.san).join(' ')}`),
    ['2...e6: d4 d5 c4 e6', 'Main line: d4 d5 c4 c5 cxd5 Qxd5'],
  )
  const X = rep.lines[0]
  const repNode = bookMovesAt(rep, X.moves[3].fenBefore).find((n) => n.uci === 'c7c5')!
  assert.ok(isDubious(repNode), 'the de-duplicated node is the dubious one (main line of the first chapter)')
  const ctx = ctxOf(rep, prefer(X.id))
  const s = drive(initTrainer(X, cfg(rep, 'inorder'), ctx), ctx, (st) => st.ply >= 3).s
  const r = play(s, ctx, 'c7', 'c5')
  assert.equal(r.feedback?.kind, 'other-line')
  assert.equal(r.feedback?.node?.chapterId, 'YYYYYYYY')
  const s2 = drive(initTrainer(X, cfg(rep, 'random'), ctx), ctx, (st) => st.ply >= 3).s
  const r2 = play(s2, ctx, 'c7', 'c5')
  assert.equal(r2.feedback?.kind, 'book-alt')
  assert.equal(r2.line.chapterId, 'YYYYYYYY')
})

test('state is plain data (no Maps/functions) — but large: persist { lineId, mode }, not the state', () => {
  const rep = reps30[2]
  const ctx = ctxOf(rep)
  const { s } = drive(initTrainer(rep.lines[0], cfg(rep, 'random'), ctx), ctx, (st) => st.ply >= 3)
  assert.doesNotThrow(() => JSON.stringify(s))
})

// ---------------------------------------------------------------------------
console.log('Review regressions')

const prevStats = (box: number) => ({ attempts: 3, completions: 3, perfects: 3, box, lastPracticed: 0, dueAt: 0, lastMistakes: 0 })

test("other-line's free highlight + ONE Hint press = a single hint, not an arrow hint (box kept)", () => {
  for (const rep of reps30) {
    const hit = findAlt(rep, (n) => !isDubious(n))
    assert.ok(hit)
    const { s, ctx } = reach(rep, hit.line, hit.ply, 'inorder')
    const r = playNode(s, ctx, hit.node)
    assert.equal(r.feedback?.kind, 'other-line')
    assert.equal(r.hintLevel, 1)
    const h = trainerReducer(r, { type: 'hint' })
    assert.equal(h.hintLevel, 2, 'the arrow is shown')
    assert.equal(h.hintsUsed, 1)
    assert.equal(h.usedArrowHint, false, 'regression: the free level made one press count as an arrow hint')
    assert.equal(trainerReducer(h, { type: 'hint' }), h, 'capped')
    // identical cost to a single plain press without the study move first
    const plain = trainerReducer(s, { type: 'hint' })
    assert.equal(plain.hintsUsed, h.hintsUsed)
    assert.equal(plain.usedArrowHint, h.usedArrowHint)
    const c = playNode(h, ctx, hit.line.moves[hit.ply])
    assert.equal(c.userMoveMarks[userMoveIndex(s)], 'fixed')
    const { s: done } = drive(c, ctx)
    assert.equal(done.phase, 'complete')
    const res = { mistakes: done.mistakes, hintsUsed: done.hintsUsed, usedArrowHint: done.usedArrowHint, learnMode: false }
    assert.deepEqual([res.mistakes, res.hintsUsed, res.usedArrowHint], [0, 1, false])
    assert.equal(updateLineStats(prevStats(3), res, 1).box, 3, 'a box-3 line stays in box 3')
    // a real second request still counts: plain press, other-line (level stays 1), press -> arrow hint
    const p1 = trainerReducer(s, { type: 'hint' })
    const p2 = playNode(p1, ctx, hit.node)
    assert.equal(p2.feedback?.kind, 'other-line')
    assert.equal(p2.hintLevel, 1)
    const p3 = trainerReducer(p2, { type: 'hint' })
    assert.equal(p3.hintLevel, 2)
    assert.equal(p3.hintsUsed, 2)
    assert.equal(p3.usedArrowHint, true)
  }
})

test('take-back escalation level 1 is free too: one press after 2 mistakes is not an arrow hint', () => {
  const rep = reps30[0]
  const ctx = ctxOf(rep)
  let s = opp(initTrainer(rep.lines[0], cfg(rep, 'inorder'), ctx), ctx)
  const bad = nonBookMove(rep, s.fen)
  for (let i = 0; i < 2; i++) s = trainerReducer(play(s, ctx, bad.from, bad.to, bad.promotion), { type: 'takeBack' })
  assert.equal(s.hintLevel, 1)
  s = trainerReducer(s, { type: 'hint' })
  assert.equal(s.hintLevel, 2)
  assert.equal(s.hintsUsed, 1)
  assert.equal(s.usedArrowHint, false)
})

// Chapters: A (start), F (starts from a FEN = after 1.e4 e5), B (1.Nf3 from the start), C (reaches
// the position after 1.e4 e5 at ply 4 instead of 2).
const XS = (id: string) => `[ChapterURL "https://lichess.org/study/TEST0000/${id}"]`
const synX = buildRepertoire(
  { ...synDef, id: 'synx', side: 'white', chapters: ['A', 'F', 'B', 'C'].map((c) => ({ id: c.repeat(8), title: c })) },
  parsePgnFile(
    [
      `[ChapterName "A"]\n${XS('AAAAAAAA')}\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 *`,
      `[ChapterName "F"]\n${XS('FFFFFFFF')}\n[SetUp "1"]\n[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]\n\n2. Nf3 Nc6 3. Bb5 *`,
      `[ChapterName "B"]\n${XS('BBBBBBBB')}\n\n1. Nf3 d5 2. g3 *`,
      `[ChapterName "C"]\n${XS('CCCCCCCC')}\n\n1. e3 e6 2. e4 e5 3. Nf3 *`,
    ].join('\n\n'),
  ),
  { maxPly: 0, enabledExtras: [] },
)
const X = (c: string) => synX.lines.find((l) => l.chapterId === c.repeat(8))!

test('random mode: a study move found only at another ply / from another start is other-line, not book-alt', () => {
  assert.equal(synX.lines.length, 4)
  const A = X('A')
  // picker that would grab F or C if they were ever offered
  const ctx = ctxOf(synX, (ls) => ls.find((l) => l !== A) ?? ls[0])
  let s = initTrainer(A, cfg(synX, 'random'), ctx)
  assert.deepEqual(s.candidates.map((id) => synX.lines.find((l) => l.id === id)!.chapterId[0]).sort(), ['A', 'B', 'C'], 'F starts elsewhere')
  s = opp(play(s, ctx, 'e2', 'e4'), ctx)
  assert.equal(s.ply, 2)
  const r = play(s, ctx, 'g1', 'f3')
  assert.equal(r.feedback?.kind, 'other-line', 'regression: used to jump to F (ply 0) or C (ply 4)')
  assert.equal(r.line, A)
  assert.equal(r.ply, 2)
  assert.equal(r.history, s.history)
  assert.equal(r.fen, s.fen)
  assert.equal(r.mistakes, 0)
  assert.equal(r.hintLevel, 1)
  // restart stays consistent with the board
  const rs = trainerReducer(r, { type: 'restart' })
  assert.equal(rs.fen, A.startFen)
  for (const id of rs.candidates) assert.equal(positionKey(synX.lines.find((l) => l.id === id)!.startFen), positionKey(A.startFen))
  const { s: done } = drive(r, ctx)
  assert.equal(done.phase, 'complete')
  assert.equal(done.line, A)
  assert.equal(done.history.length, done.ply)
})

test('restart (defensive): a line from another start restarts on that line alone', () => {
  const A = X('A')
  const F = X('F')
  const ctx = ctxOf(synX)
  const s = initTrainer(A, cfg(synX, 'random'), ctx)
  const r = trainerReducer({ ...s, line: F }, { type: 'restart' })
  assert.deepEqual(r.candidates, [F.id])
  assert.equal(r.fen, F.startFen)
})

test("random mode: the opponent never re-picks a candidate whose position differs from the board", () => {
  const F = X('F')
  const B = X('B')
  const ctx = ctxOf(synX, prefer(B.id))
  // F's first move 2.Nf3 has the same uci (g1f3) as B's 1.Nf3 from another position
  let s = initTrainer(F, cfg(synX, 'random'), ctx)
  assert.deepEqual(s.candidates, [F.id])
  s = { ...s, candidates: [B.id, F.id] } // force a stale candidate in
  s = play(s, ctx, 'g1', 'f3')
  assert.equal(s.feedback?.kind, 'correct')
  s = opp(s, ctx)
  assert.equal(s.line, F, 'B (1.Nf3 d5 from the start) is not consistent with the board')
  assert.equal(s.history[1].san, 'Nc6')
  assert.equal(positionKey(s.fen), positionKey(F.moves[1].fen))
})

test('opponentMove resyncs (with a console.warn) instead of playing on a board that left the line', () => {
  const A = X('A')
  const ctx = ctxOf(synX)
  const s = play(initTrainer(A, cfg(synX, 'inorder'), ctx), ctx, 'e2', 'e4')
  const before = trainerWarnings.length
  const broken = { ...s, fen: new Chess().fen() } // corrupted: board back at the start
  const r = opp(broken, ctx)
  assert.equal(trainerWarnings.length, before + 1)
  trainerWarnings.length = before // expected warning
  assert.equal(r.fen, A.moves[1].fen)
  assert.equal(r.phase, 'userToMove')
  assert.equal(r.history[1].uci, 'e7e5')
})

test('real study (maxPly 0): every cross-ply-only study move is other-line in random mode', () => {
  let checked = 0
  for (const rep of reps0) {
    const m = new Map<string, MoveNode[]>()
    for (const n of rep.nodesById.values()) {
      const k = `${positionKey(n.fenBefore)}|${n.uci}`
      m.set(k, [...(m.get(k) ?? []), n])
    }
    const u = userColorOf(rep.opening)
    for (const line of rep.lines) {
      for (let k = 0; k < line.moves.length; k++) {
        const e = line.moves[k]
        if (e.color !== u) continue
        const pk = positionKey(e.fenBefore)
        for (const n of bookMovesAt(rep, e.fenBefore)) {
          if (n.uci === e.uci) continue
          const nodes = (m.get(`${pk}|${n.uci}`) ?? []).filter((x) => (rep.linesByNode.get(x.id) ?? []).length > 0)
          if (!nodes.length || nodes.every(isDubious) || nodes.some((x) => x.ply - 1 === k)) continue
          const prefix = line.moves.slice(0, k + 1)
          const sameOrder = rep.lines.some((l) => l.moves[k]?.uci === n.uci && prefix.slice(0, k).every((p, i) => l.moves[i].uci === p.uci))
          if (sameOrder) continue
          const { s, ctx } = reach(rep, line, k, 'random')
          const r = playNode(s, ctx, n)
          assert.equal(r.feedback?.kind, 'other-line', `${rep.opening.id} ${line.name} ply ${k} ${n.san}`)
          assert.equal(r.ply, k)
          assert.equal(r.history.length, k)
          checked++
        }
      }
    }
  }
  console.log(
    `       ${checked} cross-ply-only study moves checked` +
      (checked === 0 ? ' (this study has none; the synthetic "another ply / another start" test covers the rule)' : ''),
  )
})

test('random-mode fuzz (maxPly 0, all extras): history.length === ply, board on the line, candidates consistent', () => {
  const rng = seededRng(7)
  let games = 0
  for (const rep of reps0) {
    const byId = new Map(rep.lines.map((l) => [l.id, l]))
    for (let g = 0; g < 120; g++) {
      const ctx = ctxOf(rep, (ls) => ls[Math.floor(rng() * ls.length)])
      let s = initTrainer(rep.lines[Math.floor(rng() * rep.lines.length)], cfg(rep, 'random'), ctx)
      for (let guard = 0; s.phase !== 'complete'; guard++) {
        assert.ok(guard < 500)
        if (s.phase === 'opponentToMove') s = opp(s, ctx)
        else {
          // mostly expected moves, sometimes another book move
          const book = bookMovesAt(rep, s.fen).filter((n) => !isDubious(n))
          const n = rng() < 0.3 && book.length ? book[Math.floor(rng() * book.length)] : expectedNode(s)!
          const r = playNode(s, ctx, n)
          s = r.phase === 'userToMove' && r.ply === s.ply ? playNode(r, ctx, expectedNode(r)!) : r
        }
        assert.equal(s.history.length, s.ply)
        if (s.ply > 0) assert.equal(positionKey(s.fen), positionKey(s.line.moves[s.ply - 1].fen))
        assert.equal(s.userMoveMarks.length, s.line.userMoveCount)
        assert.ok(s.candidates.includes(s.line.id))
        for (const id of s.candidates) {
          const l = byId.get(id)!
          assert.equal(positionKey(l.startFen), positionKey(s.line.startFen))
          if (s.ply > 0) assert.equal(positionKey(l.moves[s.ply - 1].fen), positionKey(s.fen))
        }
      }
      assert.equal(s.mistakes, 0)
      games++
    }
  }
  console.log(`       ${games} fuzzed games`)
})

// ---------------------------------------------------------------------------
console.log('Review fixes: overrides by transposition, tails, blunders in any chapter')

test('random mode: a ?-marked move reached by the other move order is known-bad, not "also in your study" (chess #1)', () => {
  // Real study: 5...Nxd4? is marked in "Side lines" (2.c4 Nc6 3.Nf3 g6 4.d4 cxd4 5.Nxd4); the Open
  // Sicilian reaches the same position by 2.Nf3 Nc6 3.d4 cxd4 4.Nxd4 g6 5.c4 (5...Bg7 is the move).
  {
    const rep = reps30[0]
    const line = rep.lines.find((l) => l.chapterId === 'nlQ9e14g' && l.moves.map((m) => m.san).join(' ').startsWith('e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 c4 Bg7'))
    assert.ok(line, 'Open Sicilian 5.c4 Bg7 line')
    const ply = line!.moves.findIndex((m) => m.san === 'Bg7')
    const { s, ctx } = reach(rep, line!, ply, 'random')
    const r = play(s, ctx, 'c6', 'd4')
    assert.equal(r.feedback?.kind, 'known-bad')
    assert.equal(r.phase, 'wrongMove')
    assert.equal(r.feedback?.node?.chapterId, 'L3QbzELB')
    assert.equal(r.feedback?.refutation?.san, 'Qxd4')
  }
  // An OVERRIDE mark reaching a node the study plays unmarked by another move order (the old
  // Alapin 7...Bxf3? case) has no real example in this study: synthetic two-chapter study.
  // Chapter A plays 9...Nd5 and an override marks it ? with the engine reply 10.Bxd5; chapter B
  // reaches the same position by 5.Bc4 6.Nf3, plays 9...Ng8 and keeps 9...Nd5 as a plain side-line.
  const url = (id: string) => `[ChapterURL "https://lichess.org/study/TEST0000/${id}"]`
  const pgn = [
    `${url('SYNSMORA')}\n\n1. e4 c5 2. d4 cxd4 3. c3 dxc3 4. Nxc3 Nc6 5. Nf3 g6 6. Bc4 Bg7 7. O-O Nf6 8. h3 e6 9. e5 Nd5 10. Nxd5 exd5 *`,
    `${url('SYNSMORB')}\n\n1. e4 c5 2. d4 cxd4 3. c3 dxc3 4. Nxc3 Nc6 5. Bc4 g6 6. Nf3 Bg7 7. O-O Nf6 8. h3 e6 9. e5 Ng8 (9... Nd5 10. Nxd5 exd5) *`,
  ].join('\n\n')
  const overrides: StudyOverride[] = [
    { chapterId: 'SYNSMORA', path: 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 g6 Bc4 Bg7 O-O Nf6 h3 e6 e5 Nd5', action: 'nag', nag: 2, reply: 'Bxd5' },
  ]
  const def: OpeningDef = { ...synDef, id: 'synmorra', chapters: [{ id: 'SYNSMORA', title: 'A' }, { id: 'SYNSMORB', title: 'B' }] }
  const rep = buildRepertoire(def, parsePgnFile(pgn), { maxPly: 0, enabledExtras: [], overrides })
  const line = rep.lines.find((l) => l.chapterId === 'SYNSMORB')!
  assert.equal(line.moves[line.moves.length - 1].san, 'Ng8')
  const ply = line.moves.length - 1
  for (const mode of ['random', 'inorder'] as const) {
    const { s, ctx } = reach(rep, line, ply, mode)
    const r = play(s, ctx, 'f6', 'd5')
    assert.equal(r.feedback?.kind, 'known-bad', mode)
    assert.equal(r.phase, 'wrongMove')
    assert.equal(r.feedback?.refutation?.san, 'Bxd5')
  }
  // Without the override the very same move is a good book move of chapter A.
  const bare = buildRepertoire(def, parsePgnFile(pgn), { maxPly: 0, enabledExtras: [], overrides: [] })
  const bareLine = bare.lines.find((l) => l.chapterId === 'SYNSMORB' && l.moves[l.moves.length - 1].san === 'Ng8')!
  const { s, ctx } = reach(bare, bareLine, ply, 'random')
  const r = play(s, ctx, 'f6', 'd5')
  assert.equal(r.feedback?.kind, 'book-alt', 'bare: 9...Nd5 is just another book move')
})

test('tail: after the last user move the study\'s reply / trap demo plays; ids and counts unchanged (chess #2, #5)', () => {
  let tails = 0
  let traps = 0
  for (const rep of reps30) {
    const ctx = ctxOf(rep)
    for (const line of rep.lines) {
      if (!line.tail) continue
      tails++
      if (line.tailIsTrap) traps++
      const { s } = drive(initTrainer(line, cfg(rep, 'inorder'), ctx), ctx)
      assert.equal(s.phase, 'complete')
      assert.equal(s.tailPly, 0)
      let t = s
      for (let k = 0; k < line.tail.length; k++) {
        t = trainerReducer(t, { type: 'tailMove' })
        assert.equal(t.tailPly, k + 1)
        assert.equal(t.phase, 'complete')
        assert.equal(t.fen, line.tail[k].fen)
        assert.equal(t.history.length, t.ply + t.tailPly)
        assert.equal(t.history[t.history.length - 1].by, line.tail[k].color === userColorOf(rep.opening) ? 'user' : 'opponent')
      }
      assert.equal(trainerReducer(t, { type: 'tailMove' }), t, 'nothing after the tail')
      // counts and marks are about the line only
      assert.equal(t.userMoveMarks.length, line.userMoveCount)
      assert.equal(t.mistakes, 0)
      // restart clears it
      assert.equal(trainerReducer(t, { type: 'restart' }).tailPly, 0)
    }
    // tailMove does nothing before the line is complete
    const l0 = rep.lines.find((l) => l.tail)!
    const s0 = initTrainer(l0, cfg(rep, 'inorder'), ctx)
    assert.equal(trainerReducer(s0, { type: 'tailMove' }), s0)
  }
  // "Opening lines for Tournaments" at maxPly 30: 11 lines with a tail, 2 of them trap demos
  // (Sicilian 13...Qd7?? 14.Nxd6+ and 9...Nd5? 10.Bxd5).
  assert.ok(tails >= 11, `${tails} lines with a tail`)
  assert.ok(traps >= 2, `${traps} trap demos`)
})

test('opponent blunder marked in another chapter counts here too (chess #7)', () => {
  // The coach's study has no real case any more (it was London 4...Qb6?, marked in one chapter
  // only), so a synthetic London study: the coach marks 4...Qxb2?? in chapter X (3.e3 Qb6 4.Nc3);
  // chapter Y reaches the same position by 3.Nc3 Qb6 4.e3 and plays 4...Qxb2 without a mark.
  const pgn = [
    '[ChapterURL "https://lichess.org/study/TEST0000/SYNOPPXX"]\n\n1. d4 d5 2. Bf4 c5 3. e3 Qb6 4. Nc3 Qxb2?? 5. Nxd5 *',
    '[ChapterURL "https://lichess.org/study/TEST0000/SYNOPPYY"]\n\n1. d4 d5 2. Bf4 c5 3. Nc3 Qb6 4. e3 Qxb2 5. Nxd5 Nf6 6. Bb5+ *',
  ].join('\n\n')
  const def: OpeningDef = { ...synDef, id: 'synopp', side: 'white', chapters: [{ id: 'SYNOPPXX', title: 'X' }, { id: 'SYNOPPYY', title: 'Y' }] }
  const rep = buildRepertoire(def, parsePgnFile(pgn), { maxPly: 0, enabledExtras: [] })
  assert.ok(rep.lines.find((l) => l.chapterId === 'SYNOPPYY')!.moves.some((m) => m.san === 'Qxb2' && !isBlunder(m)), 'unmarked in Y')
  const keys = new Set<string>()
  for (const n of rep.nodesById.values()) if (isBlunder(n)) keys.add(`${positionKey(n.fenBefore)}|${n.uci}`)
  const hit = rep.lines.find((l) =>
    l.moves.some((m) => m.color === 'b' && !isBlunder(m) && keys.has(`${positionKey(m.fenBefore)}|${m.uci}`)),
  )
  assert.ok(hit, 'a line with an opponent move marked only elsewhere')
  assert.equal(hit!.hasOpponentBlunder, true)
  const ctx = ctxOf(rep, prefer(hit!.id))
  const { s, log } = drive(initTrainer(hit!, cfg(rep, 'inorder'), ctx), ctx)
  assert.ok(log.includes('opponent-blunder'))
  assert.equal(s.opponentBlundered, true)
})

if (trainerWarnings.length) {
  failed++
  console.log(`  FAIL unexpected [trainer] warnings:\n${trainerWarnings.join('\n')}`)
}
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
