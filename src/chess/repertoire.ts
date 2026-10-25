// Builds practice repertoires (move trees + root-to-leaf lines) from parsed
// study chapters. Pure logic: runs in the browser and under plain node.

import { Chess } from 'chess.js'
import type { Chapter, ChapterRef, Line, MoveNode, OpeningDef, Repertoire } from '../types.ts'
import type { PgnGame, PgnNode } from './pgn.ts'
import { combineComments } from './pgn.ts'
import { STUDY_OVERRIDES, type StudyOverride } from '../data/studyOverrides.ts'
import { classifyLines } from './lineTiers.ts'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface BuildOptions {
  /** Max plies per line counted from the chapter start; 0 = no cap. */
  maxPly: number
  /** Extra chapter ids (from OpeningDef.extraChapters) to include. */
  enabledExtras: string[]
  /** Corrections on top of the study (default: src/data/studyOverrides.ts; [] = none). */
  overrides?: StudyOverride[]
}

/** First 4 FEN fields (placement, side, castling, en passant) — ignores move counters. */
export function positionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ')
}

/** Lichess chapter id from the [ChapterURL] header (last path segment), or null. */
export function chapterIdOf(game: PgnGame): string | null {
  const url = game.headers.ChapterURL
  if (!url) return null
  const m = /\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(url.trim())
  return m ? m[1] : null
}

export function isDubious(node: MoveNode): boolean {
  return node.nags.includes(2) || node.nags.includes(4) || node.nags.includes(6)
}

export function isBlunder(node: MoveNode): boolean {
  return node.nags.includes(2) || node.nags.includes(4)
}

export function userColorOf(def: OpeningDef): 'w' | 'b' {
  return def.side === 'white' ? 'w' : 'b'
}

export function bookMovesAt(rep: Repertoire, fen: string): MoveNode[] {
  return rep.movesByPosition.get(positionKey(fen)) ?? []
}

/** "12.Nf3" / "12...Nf6" (always numbered). */
export function moveLabel(node: MoveNode): string {
  return node.color === 'w' ? `${node.moveNumber}.${node.san}` : `${node.moveNumber}...${node.san}`
}

/** SAN sequence with move numbers, e.g. "1.e4 c5 2.Nf3" or "2...e5 3.Nf3". */
export function movesLabel(nodes: MoveNode[]): string {
  return nodes
    .map((n, i) => (i === 0 ? moveLabel(n) : n.color === 'w' ? `${n.moveNumber}.${n.san}` : n.san))
    .join(' ')
}

/** FNV-1a 32-bit over UTF-16 code units. */
function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Short stable id: two FNV-1a passes (different offset bases), base36. */
export function stableHash(s: string): string {
  const a = fnv1a(s, 0x811c9dc5).toString(36).padStart(7, '0')
  const b = fnv1a(s, 0x01000193 ^ 0x5bd1e995).toString(36).padStart(7, '0')
  return a + b.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Move stepping. chess.js's public move()/undo() build a full `Move` object
// (legal-move generation + SAN + two FENs) on every call, which made building
// the study ~3x slower than needed. When the (1.x) internals are present we
// use them directly; a self-check on construction falls back to the public API
// if they ever change shape.
// ---------------------------------------------------------------------------

interface Played {
  san: string
  from: string
  to: string
  promotion?: string
  color: 'w' | 'b'
  before: string
  after: string
}

interface Stepper {
  /** Plays a SAN move from the current position; null if unplayable. */
  play(san: string): Played | null
  /** Undoes the last successful play(). */
  back(): void
}

interface InternalMove {
  color: 'w' | 'b'
  from: number
  to: number
  piece: string
  promotion?: string
  flags: number
}

interface ChessInternals {
  _moveFromSan(san: string, strict?: boolean): InternalMove | null
  _moveToSan(move: InternalMove, moves: InternalMove[]): string
  _moves(opts: { legal?: boolean; piece?: string }): InternalMove[]
  _makeMove(move: InternalMove): void
  _undoMove(): unknown
  _isKingAttacked(color: 'w' | 'b'): boolean
}

const KSIDE_CASTLE_FLAG = 32
const QSIDE_CASTLE_FLAG = 64
const NULL_MOVE_FLAG = 128
const FILES = 'abcdefgh'
/** Standard SAN (check marks already stripped): piece, from-file, from-rank, target, promotion. */
const SAN_RE = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBNqrbn]))?$/
/** 0x88 board index -> algebraic square. */
function algebraic(i: number): string {
  return FILES[i & 15] + String(8 - (i >> 4))
}

function isNullSan(san: string): boolean {
  return san === '--' || san === 'Z0' || san === '0000' || san === '@@@@'
}

function publicStepper(chess: Chess): Stepper {
  return {
    play(san) {
      if (isNullSan(san)) return null
      try {
        const m = chess.move(san)
        const p: Played = { san: m.san, from: m.from, to: m.to, color: m.color, before: m.before, after: m.after }
        if (m.promotion) p.promotion = m.promotion
        return p
      } catch {
        return null
      }
    },
    back() {
      chess.undo()
    },
  }
}

function fastStepper(chess: Chess): Stepper | null {
  const c = chess as unknown as ChessInternals
  if (
    typeof c._moveFromSan !== 'function' ||
    typeof c._moveToSan !== 'function' ||
    typeof c._moves !== 'function' ||
    typeof c._makeMove !== 'function' ||
    typeof c._undoMove !== 'function' ||
    typeof c._isKingAttacked !== 'function'
  ) {
    return null
  }
  return {
    play(san) {
      if (isNullSan(san)) return null
      let mv: InternalMove | null = null
      // Legal moves of the same piece type to the same square (all SAN needs for disambiguation).
      let legal: InternalMove[] | null = null
      const isLegal = (x: InternalMove): boolean => {
        c._makeMove(x)
        const ok = !c._isKingAttacked(x.color)
        c._undoMove()
        return ok
      }
      // Common case: resolve standard SAN from pseudo-legal moves of one piece
      // type, checking legality only for the few moves that land on the target.
      const clean = san.replace(/[+#]+$/, '')
      const castle = /^[O0]-[O0](-[O0])?$/.exec(clean)
      if (castle) {
        const bit = castle[1] ? QSIDE_CASTLE_FLAG : KSIDE_CASTLE_FLAG
        const x = c._moves({ legal: false, piece: 'k' }).find((m) => (m.flags & bit) !== 0)
        if (x && isLegal(x)) {
          mv = x
          legal = [x]
        }
      } else {
        const p = SAN_RE.exec(clean)
        if (p) {
          const piece = p[1] ? p[1].toLowerCase() : 'p'
          const fromFile = p[2] ? FILES.indexOf(p[2]) : -1
          const fromRank = p[3] ? 8 - Number(p[3]) : -1
          const to = (8 - Number(p[4][1])) * 16 + FILES.indexOf(p[4][0])
          const promo = p[5] ? p[5].toLowerCase() : undefined
          const same: InternalMove[] = []
          let found: InternalMove | null = null
          let count = 0
          for (const x of c._moves({ legal: false, piece })) {
            if (x.to !== to || x.piece !== piece || !isLegal(x)) continue
            same.push(x)
            if (fromFile >= 0 && (x.from & 15) !== fromFile) continue
            if (fromRank >= 0 && x.from >> 4 !== fromRank) continue
            if ((x.promotion ?? undefined) !== promo) continue
            found = x
            count++
          }
          if (count === 1) {
            mv = found
            legal = same
          }
        }
      }
      if (!mv) {
        // Unusual notation (or ambiguous SAN): let chess.js's sloppy parser try.
        try {
          mv = c._moveFromSan(san, false)
        } catch {
          mv = null
        }
        if (!mv || mv.flags & NULL_MOVE_FLAG) return null
        legal = c._moves({ legal: true, piece: mv.piece })
      }
      const before = chess.fen()
      const outSan = c._moveToSan(mv, legal ?? c._moves({ legal: true, piece: mv.piece }))
      c._makeMove(mv)
      const p: Played = { san: outSan, from: algebraic(mv.from), to: algebraic(mv.to), color: mv.color, before, after: chess.fen() }
      if (mv.promotion) p.promotion = mv.promotion
      return p
    },
    back() {
      c._undoMove()
    },
  }
}

/** Verifies the fast path against the public API on a few tricky moves. */
function fastStepperWorks(): boolean {
  try {
    const probe = 'r3k2r/1P6/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1'
    const seqs: string[][] = [['exd6'], ['bxa8=Q+'], ['O-O-O'], ['Ra2']]
    for (const seq of seqs) {
      const a = new Chess(probe)
      const b = new Chess(probe)
      const fast = fastStepper(a)
      if (!fast) return false
      const slow = publicStepper(b)
      for (const san of seq) {
        const x = fast.play(san)
        const y = slow.play(san)
        if (!x || !y) return false
        if (x.san !== y.san || x.from !== y.from || x.to !== y.to || x.promotion !== y.promotion) return false
        if (x.before !== y.before || x.after !== y.after || x.color !== y.color) return false
      }
      fast.back()
      if (a.fen() !== new Chess(probe).fen()) return false
      if (fast.play('Qh8') !== null) return false
    }
    return true
  } catch {
    return false
  }
}

let fastOk: boolean | null = null
function makeStepper(chess: Chess): Stepper {
  if (fastOk === null) fastOk = fastStepperWorks()
  return (fastOk && fastStepper(chess)) || publicStepper(chess)
}

interface WalkInfo {
  /** number of non-first-child steps on the path from the chapter root */
  varDepth: number
  /** preorder index across the whole opening (chapter order, main line first) */
  order: number
  /** whether this node is on the chapter main line */
  main: boolean
  /** trie id of the uci path from the chapter start (dedupes identical paths) */
  canon: number
}

interface ChapterBuild {
  chapter: Chapter
  info: Map<MoveNode, WalkInfo>
}

function buildChapter(
  ref: ChapterRef,
  game: PgnGame,
  isExtra: boolean,
  chess: Chess,
  stepper: Stepper,
  counters: { order: number; canon: number; trie: Map<string, number> },
  warn: (msg: string) => void,
): ChapterBuild | null {
  const id = ref.id
  const headerFen = game.headers.FEN
  let startFen = START_FEN
  try {
    chess.load(headerFen && headerFen.trim() ? headerFen.trim() : START_FEN)
    startFen = chess.fen()
  } catch (e) {
    warn(`[repertoire] chapter ${id}: bad FEN "${headerFen}" (${(e as Error).message}); chapter skipped`)
    return null
  }

  const info = new Map<MoveNode, WalkInfo>()
  let counter = 0

  const walk = (
    list: PgnNode[],
    parent: MoveNode | null,
    out: MoveNode[],
    ply: number,
    varDepth: number,
    main: boolean,
    parentCanon: number,
  ): void => {
    for (let k = 0; k < list.length; k++) {
      const pn = list[k]
      const m = stepper.play(pn.san)
      if (!m) {
        warn(`[repertoire] chapter ${id}: unplayable move "${pn.san}" at ${chess.fen()}; branch skipped`)
        continue
      }
      const c = combineComments(pn.comments)
      const fenParts = m.before.split(' ')
      const node: MoveNode = {
        id: `${id}:${counter++}`,
        chapterId: id,
        san: m.san,
        uci: m.from + m.to + (m.promotion ?? ''),
        from: m.from,
        to: m.to,
        fenBefore: m.before,
        fen: m.after,
        ply,
        color: m.color,
        moveNumber: parseInt(fenParts[5], 10) || 1,
        arrows: c.arrows,
        highlights: c.highlights,
        nags: pn.nags.slice(),
        children: [],
        parentId: parent ? parent.id : null,
      }
      if (m.promotion) node.promotion = m.promotion
      if (c.text) node.comment = c.text
      // Children order = PGN order; the first *playable* child is the main one.
      const isFirst = out.length === 0
      const nodeVarDepth = varDepth + (isFirst ? 0 : 1)
      const nodeMain = main && isFirst
      const trieKey = `${parentCanon}|${node.uci}`
      let canon = counters.trie.get(trieKey)
      if (canon === undefined) {
        canon = counters.canon++
        counters.trie.set(trieKey, canon)
      }
      out.push(node)
      info.set(node, { varDepth: nodeVarDepth, order: counters.order++, main: nodeMain, canon })
      walk(pn.children, node, node.children, ply + 1, nodeVarDepth, nodeMain, canon)
      stepper.back()
    }
  }

  const roots: MoveNode[] = []
  // Each chapter gets its own trie root so identical paths in different chapters stay distinct.
  const rootCanon = counters.canon++
  walk(game.roots, null, roots, 1, 0, true, rootCanon)

  const intro = combineComments(game.intro)
  const chapter: Chapter = {
    id,
    title: ref.title || game.headers.ChapterName || id,
    lichessName: game.headers.ChapterName ?? '',
    startFen,
    introArrows: intro.arrows,
    introHighlights: intro.highlights,
    roots,
    isExtra,
  }
  if (game.headers.ChapterURL) chapter.url = game.headers.ChapterURL
  if (intro.text) chapter.intro = intro.text
  return { chapter, info }
}

// ---------------------------------------------------------------------------
// Study overrides (src/data/studyOverrides.ts)
// ---------------------------------------------------------------------------

/** SAN without check/mate signs and !/? glyphs, for path matching. */
function sanKey(san: string): string {
  return san.replace(/[+#!?]+$/g, '').replace(/[+#]/g, '')
}

function splitPath(path: string): string[] {
  return path
    .trim()
    .split(/\s+/)
    .filter((t) => t && !/^\d+\.+$/.test(t))
    .map((t) => sanKey(t.replace(/^\d+\.+/, '')))
}

function clonePgn(list: PgnNode[]): PgnNode[] {
  return list.map((n) => ({ san: n.san, comments: n.comments.slice(), nags: n.nags.slice(), children: clonePgn(n.children) }))
}

/** Walks `path` down a PGN tree; returns the list holding the last node and its index. */
function findPgn(roots: PgnNode[], path: string[]): { list: PgnNode[]; index: number } | null {
  let list = roots
  for (let k = 0; k < path.length; k++) {
    const i = list.findIndex((n) => sanKey(n.san) === path[k])
    if (i < 0) return null
    if (k === path.length - 1) return { list, index: i }
    list = list[i].children
  }
  return null
}

/** Tree edits (cut, refutation reply) on a COPY of the chapter's PGN game. */
function applyTreeOverrides(game: PgnGame, chapterId: string, overrides: StudyOverride[], warn: (m: string) => void): PgnGame {
  const mine = overrides.filter((o) => o.chapterId === chapterId && (o.action === 'cut' || (o.action === 'nag' && o.reply)))
  if (mine.length === 0) return game
  const roots = clonePgn(game.roots)
  // Cuts last, so a reply/nag deeper in a cut subtree never warns needlessly.
  for (const o of [...mine.filter((x) => x.action !== 'cut'), ...mine.filter((x) => x.action === 'cut')]) {
    const hit = findPgn(roots, splitPath(o.path))
    if (!hit) {
      warn(`[repertoire] override not applied (path not in chapter ${chapterId}): ${o.path}`)
      continue
    }
    const node = hit.list[hit.index]
    if (o.action === 'cut') {
      hit.list.splice(hit.index, 1)
      continue
    }
    const reply = sanKey(o.reply ?? '')
    const j = node.children.findIndex((c) => sanKey(c.san) === reply)
    if (j > 0) node.children.unshift(...node.children.splice(j, 1))
    else if (j < 0) node.children.unshift({ san: o.reply ?? '', comments: [], nags: [], children: [] })
  }
  return { ...game, roots }
}

/** Finds a built node by SAN path from the chapter start. */
function findNode(roots: MoveNode[], path: string[]): MoveNode | null {
  let list = roots
  let node: MoveNode | null = null
  for (const san of path) {
    node = list.find((n) => sanKey(n.san) === san) ?? null
    if (!node) return null
    list = node.children
  }
  return node
}

/**
 * Builds the repertoire for one opening. Never throws on bad study data:
 * unplayable SAN skips that branch (console.warn), missing chapters are skipped.
 */
export function buildRepertoire(def: OpeningDef, games: PgnGame[], opts: BuildOptions): Repertoire {
  const warn = (msg: string) => console.warn(msg)
  const overrides = opts.overrides ?? STUDY_OVERRIDES
  const byId = new Map<string, PgnGame>()
  for (const g of games) {
    const cid = chapterIdOf(g)
    if (cid && !byId.has(cid)) byId.set(cid, g)
  }

  const userColor = userColorOf(def)
  const maxPly = opts.maxPly > 0 ? Math.floor(opts.maxPly) : 0
  const extras = new Set(opts.enabledExtras)
  const refs: { ref: ChapterRef; isExtra: boolean }[] = [
    ...def.chapters.map((ref) => ({ ref, isExtra: false })),
    ...def.extraChapters.filter((r) => extras.has(r.id)).map((ref) => ({ ref, isExtra: true })),
  ]

  const chess = new Chess()
  const stepper = makeStepper(chess)
  const counters = { order: 0, canon: 0, trie: new Map<string, number>() }
  const chapters: Chapter[] = []
  const builds: ChapterBuild[] = []
  const seenChapters = new Set<string>()
  for (const { ref, isExtra } of refs) {
    if (seenChapters.has(ref.id)) continue
    seenChapters.add(ref.id)
    const game = byId.get(ref.id)
    if (!game) {
      warn(`[repertoire] ${def.id}: chapter ${ref.id} (${ref.title}) not found in study; skipped`)
      continue
    }
    const b = buildChapter(ref, applyTreeOverrides(game, ref.id, overrides, warn), isExtra, chess, stepper, counters, warn)
    if (!b) continue
    chapters.push(b.chapter)
    builds.push(b)
  }

  // ---- overrides on the built trees: annotations + comments ----------------
  // A nag goes onto EVERY node with the same position + move (all chapters),
  // so the same move reached by another move order is marked too.
  const nagByKey = new Map<string, number>()
  for (const o of overrides) {
    if (o.action !== 'nag' && o.action !== 'comment') continue
    const b = builds.find((x) => x.chapter.id === o.chapterId)
    if (!b) continue // chapter not in this opening (or switched off)
    const node = findNode(b.chapter.roots, splitPath(o.path))
    if (!node) {
      warn(`[repertoire] override not applied (path not in chapter ${o.chapterId}): ${o.path}`)
      continue
    }
    if (o.action === 'comment') {
      if (o.text) node.comment = o.text
      else delete node.comment
    } else if (o.nag) nagByKey.set(`${positionKey(node.fenBefore)}|${node.uci}`, o.nag)
  }
  if (nagByKey.size > 0) {
    for (const b of builds) {
      for (const node of b.info.keys()) {
        const nag = nagByKey.get(`${positionKey(node.fenBefore)}|${node.uci}`)
        if (nag !== undefined && !node.nags.includes(nag)) node.nags.push(nag)
      }
    }
  }

  // ---- nodesById + movesByPosition --------------------------------------
  const nodesById = new Map<string, MoveNode>()
  const allInfo = new Map<MoveNode, WalkInfo>()
  const byPos = new Map<string, Map<string, MoveNode>>()
  /** position|uci of every move marked ?/?? in ANY chapter (opponent traps transpose too). */
  const blunderKeys = new Set<string>()
  for (const b of builds) {
    for (const [node, inf] of b.info) {
      nodesById.set(node.id, node)
      allInfo.set(node, inf)
      const key = positionKey(node.fenBefore)
      if (isBlunder(node)) blunderKeys.add(`${key}|${node.uci}`)
      let m = byPos.get(key)
      if (!m) byPos.set(key, (m = new Map()))
      const prev = m.get(node.uci)
      if (!prev || better(inf, allInfo.get(prev)!)) m.set(node.uci, node)
    }
  }
  const movesByPosition = new Map<string, MoveNode[]>()
  for (const [key, m] of byPos) {
    const list = [...m.values()].sort((a, b) => cmpInfo(allInfo.get(a)!, allInfo.get(b)!))
    movesByPosition.set(key, list)
  }

  // ---- lines ---------------------------------------------------------------
  interface Candidate {
    b: ChapterBuild
    rank: number
    moves: MoveNode[]
    tail?: MoveNode[]
    trap: boolean
  }
  const perChapter: Candidate[][] = []
  builds.forEach((b, rank) => {
    const ch = b.chapter
    // 1+2: every root→leaf path, stopping before a dubious user move (`stop`).
    const raw: Array<{ path: MoveNode[]; stop?: MoveNode }> = []
    const path: MoveNode[] = []
    const dfs = (nodes: MoveNode[]) => {
      for (const node of nodes) {
        if (node.color === userColor && isDubious(node)) {
          raw.push({ path: path.slice(), stop: node })
          continue
        }
        path.push(node)
        if (node.children.length === 0) raw.push({ path: path.slice() })
        else dfs(node.children)
        path.pop()
      }
    }
    dfs(ch.roots)

    // 3+4: truncate, trim trailing opponent moves. What was trimmed becomes the
    // line's "tail", shown after the line is complete: the opponent's reply the
    // study ends with, or — when the path stopped before a ?/?? move by the kid's
    // side — a trap demo (that move and its refutation). Not when the cap cut
    // the line (then the rest is just more theory).
    const cut: Candidate[] = []
    for (const { path: p, stop } of raw) {
      let moves = maxPly > 0 && p.length > maxPly ? p.slice(0, maxPly) : p
      let end = moves.length
      while (end > 0 && moves[end - 1].color !== userColor) end--
      if (end === 0) continue
      if (end < moves.length) moves = moves.slice(0, end)
      const rest = p.slice(moves.length)
      let tail: MoveNode[] | undefined
      let trap = false
      if (rest.every((n) => n.color !== userColor)) {
        if (stop) {
          if (isBlunder(stop)) {
            tail = [...rest, stop]
            if (stop.children[0]) tail.push(stop.children[0])
            trap = true
          }
        } else if (rest.length > 0) tail = rest
      }
      cut.push({ b, rank, moves, tail, trap })
    }

    // 5: dedupe identical uci paths; drop strict prefixes of other lines. When
    // two raw paths collapse into one line, the first (main-line-most) wins.
    const canonOf = (n: MoveNode) => b.info.get(n)!.canon
    const hasLonger = new Set<number>() // canon ids that are a strict prefix of some line
    for (const c of cut) for (let k = 0; k < c.moves.length - 1; k++) hasLonger.add(canonOf(c.moves[k]))
    const seen = new Set<number>()
    const kept: Candidate[] = []
    for (const c of cut) {
      const last = canonOf(c.moves[c.moves.length - 1])
      if (seen.has(last) || hasLonger.has(last)) continue
      seen.add(last)
      kept.push(c)
    }
    perChapter.push(kept)
  })

  // 5b: the same across chapters (same start position + moves): a line that
  // repeats an earlier chapter's line, or is a strict prefix of another
  // chapter's line, is dropped. A core line is never dropped because of an
  // EXTRA chapter, so switching extras on/off never changes the core lines.
  interface TrieNode {
    kids: Map<string, TrieNode>
    ends: Candidate[]
    /** Chapters with a line that goes on past this node. */
    deeper: Array<{ chapterId: string; isExtra: boolean }>
  }
  const trieRoots = new Map<string, TrieNode>()
  const newTrie = (): TrieNode => ({ kids: new Map(), ends: [], deeper: [] })
  const endNode = new Map<Candidate, TrieNode>()
  for (const list of perChapter) {
    for (const c of list) {
      const startKey = positionKey(c.b.chapter.startFen)
      let node = trieRoots.get(startKey)
      if (!node) trieRoots.set(startKey, (node = newTrie()))
      for (let k = 0; k < c.moves.length; k++) {
        if (k > 0 && !node.deeper.some((d) => d.chapterId === c.b.chapter.id)) {
          node.deeper.push({ chapterId: c.b.chapter.id, isExtra: c.b.chapter.isExtra })
        }
        let next = node.kids.get(c.moves[k].uci)
        if (!next) node.kids.set(c.moves[k].uci, (next = newTrie()))
        node = next
      }
      node.ends.push(c)
      endNode.set(c, node)
    }
  }
  const crossDropped = (c: Candidate): boolean => {
    const node = endNode.get(c)!
    const ch = c.b.chapter
    if (node.deeper.some((d) => d.chapterId !== ch.id && (!d.isExtra || ch.isExtra))) return true
    return node.ends.some((o) => o !== c && o.b.chapter.id !== ch.id && o.rank < c.rank)
  }

  const lines: Line[] = []
  const usedIds = new Set<string>()
  for (const list of perChapter) {
    let indexInChapter = 0
    for (const c of list) {
      if (crossDropped(c)) continue
      const { b, moves } = c
      const ch = b.chapter
      // 6: name — where the line leaves the chapter main line, plus (if
      // different) the last place it picks a side variation, so sibling lines
      // read differently: "4.c4 Qd6", "4.c4 … 9...Nbd7".
      let name = 'Main line'
      const leave = moves.findIndex((n) => !b.info.get(n)!.main)
      if (leave >= 0) {
        name = movesLabel(moves.slice(leave, leave + 2))
        let lastBranch = -1
        for (let k = moves.length - 1; k > leave + 1; k--) {
          const siblings = k === 0 ? ch.roots : moves[k - 1].children
          if (siblings.length > 1 && siblings[0] !== moves[k]) {
            lastBranch = k
            break
          }
        }
        if (lastBranch > 0) name += ` … ${movesLabel(moves.slice(lastBranch, lastBranch + 1))}`
      }
      // 7: id (the tail is NOT part of it, so ids and progress stay stable)
      const hashInput = `${def.id}|${ch.id}|${moves.map((n) => n.uci).join(' ')}`
      let id = stableHash(hashInput)
      if (usedIds.has(id)) {
        let k = 2
        while (usedIds.has(`${id}-${k}`)) k++
        id = `${id}-${k}`
      }
      usedIds.add(id)
      let userMoveCount = 0
      let hasOpponentBlunder = false
      for (const n of moves) {
        if (n.color === userColor) userMoveCount++
        else if (blunderKeys.has(`${positionKey(n.fenBefore)}|${n.uci}`)) hasOpponentBlunder = true
      }
      const line: Line = {
        id,
        openingId: def.id,
        chapterId: ch.id,
        chapterTitle: ch.title,
        index: lines.length,
        indexInChapter: indexInChapter++,
        name,
        startFen: ch.startFen,
        moves,
        userMoveCount,
        hasOpponentBlunder,
      }
      if (c.tail && c.tail.length > 0) {
        line.tail = c.tail
        if (c.trap) line.tailIsTrap = true
      }
      lines.push(line)
    }
  }

  // Any names still shared within a chapter get a counter: "… (2)".
  const nameCount = new Map<string, number>()
  for (const line of lines) {
    const key = `${line.chapterId}|${line.name}`
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1)
  }
  const nameSeen = new Map<string, number>()
  for (const line of lines) {
    const key = `${line.chapterId}|${line.name}`
    if ((nameCount.get(key) ?? 0) < 2) continue
    const k = (nameSeen.get(key) ?? 0) + 1
    nameSeen.set(key, k)
    line.name = `${line.name} (${k})`
  }

  // Practice tiers (docs/practice-structure.md §1): computed on every build, never part of the id.
  classifyLines(chapters, lines, userColor)

  const linesByNode = new Map<string, Line[]>()
  for (const line of lines) {
    for (const n of line.moves) {
      const arr = linesByNode.get(n.id)
      if (arr) arr.push(line)
      else linesByNode.set(n.id, [line])
    }
  }

  return { opening: def, chapters, lines, nodesById, movesByPosition, linesByNode }
}

function cmpInfo(a: WalkInfo, b: WalkInfo): number {
  return a.varDepth - b.varDepth || a.order - b.order
}

function better(a: WalkInfo, b: WalkInfo): boolean {
  return cmpInfo(a, b) < 0
}
