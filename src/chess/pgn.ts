// PGN parsing for Lichess study exports (pure, no chess rules here — move
// legality is checked later by repertoire.ts with chess.js).
//
// Handles: several games per file, [Key "Value"] headers (with \" escapes),
// move numbers (`1.` / `1...` / glued `1.e4`), nested variations, `{...}`
// comments (multi-line, several in a row, before the first move = intro),
// `;` rest-of-line comments, `%` escape lines, NAGs `$n`, suffix glyphs
// (`!` `?` `!!` `??` `!?` `?!`, glued or standalone), result tokens, games
// without a result token, unbalanced parentheses.

import type { AnnotationColor, Arrow, Highlight } from '../types.ts'

export interface PgnNode {
  /** SAN as written, minus !/? glyphs (check/mate signs are kept). */
  san: string
  /** Raw comment texts (still containing [%cal]/[%csl]/... commands). */
  comments: string[]
  /** Numeric annotation glyphs, incl. suffix glyphs (!=1 ?=2 !!=3 ??=4 !?=5 ?!=6). */
  nags: number[]
  /** children[0] is the main continuation. */
  children: PgnNode[]
}

export interface PgnGame {
  headers: Record<string, string>
  /** Raw comments that appear before the first move. */
  intro: string[]
  /** First moves; roots[0] is the main line. */
  roots: PgnNode[]
  /** Result token if present ('*', '1-0', '0-1', '1/2-1/2'). */
  result?: string
}

export const GLYPH_NAGS: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 }

const RESULTS = new Set(['*', '1-0', '0-1', '1/2-1/2', '½-½'])
/** Characters that end a movetext word. */
const WORD_END = /[\s{}()[\];$]/

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

interface Frame {
  parentList: PgnNode[]
  lastNode: PgnNode | null
  lastList: PgnNode[] | null
}

class GameBuilder {
  headers: Record<string, string> = {}
  intro: string[] = []
  roots: PgnNode[] = []
  result: string | undefined = undefined
  hasMovetext = false
  ended = false
  private parentList: PgnNode[] = this.roots
  private lastNode: PgnNode | null = null
  private lastList: PgnNode[] | null = null
  private stack: Frame[] = []
  private pending: string[] = []

  move(san: string, glyph: string | null): void {
    this.hasMovetext = true
    const node: PgnNode = { san, comments: this.pending, nags: [], children: [] }
    this.pending = []
    if (glyph) this.glyph(glyph, node)
    this.parentList.push(node)
    this.lastList = this.parentList
    this.lastNode = node
    this.parentList = node.children
  }

  glyph(glyph: string, node: PgnNode | null = this.lastNode): void {
    const nag = GLYPH_NAGS[glyph]
    if (node && nag !== undefined) this.nag(nag, node)
  }

  nag(n: number, node: PgnNode | null = this.lastNode): void {
    if (node && Number.isFinite(n) && n > 0 && !node.nags.includes(n)) node.nags.push(n)
  }

  comment(text: string): void {
    this.hasMovetext = true
    const t = text.trim()
    if (!t) return
    if (this.lastNode) this.lastNode.comments.push(t)
    else if (this.stack.length === 0) this.intro.push(t)
    else this.pending.push(t) // comment before the first move of a variation
  }

  open(): void {
    this.hasMovetext = true
    this.stack.push({ parentList: this.parentList, lastNode: this.lastNode, lastList: this.lastList })
    // A variation is an alternative to the last move played.
    if (this.lastList) this.parentList = this.lastList
    this.lastNode = null
    this.lastList = null
    this.pending = []
  }

  close(): void {
    const frame = this.stack.pop()
    if (!frame) return // unbalanced ')': ignore
    const orphan = this.pending
    this.pending = []
    this.parentList = frame.parentList
    this.lastNode = frame.lastNode
    this.lastList = frame.lastList
    if (orphan.length && this.lastNode) this.lastNode.comments.push(...orphan)
  }

  finish(): PgnGame {
    // Close any unbalanced variations.
    while (this.stack.length) this.close()
    const game: PgnGame = { headers: this.headers, intro: this.intro, roots: this.roots }
    if (this.result !== undefined) game.result = this.result
    return game
  }
}

/** Parse a whole PGN file (one or many games). Never throws on malformed movetext. */
export function parsePgnFile(text: string): PgnGame[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const games: PgnGame[] = []
  let g = new GameBuilder()
  let started = false // current builder has any header or movetext
  const n = src.length
  let i = 0
  let lineStart = true

  const flush = () => {
    if (started) games.push(g.finish())
    g = new GameBuilder()
    started = false
  }

  while (i < n) {
    const c = src[i]

    if (c === '\n' || c === '\r') {
      lineStart = true
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
      i++
      continue
    }
    const atLineStart = lineStart
    lineStart = false

    // `%` escape line (only at the start of a line)
    if (c === '%' && atLineStart) {
      while (i < n && src[i] !== '\n') i++
      continue
    }

    // Header tag
    if (c === '[') {
      const tag = readTag(src, i)
      i = tag.end
      if (tag.key) {
        // Own-property check: a tag named like an Object.prototype member ("constructor",
        // "toString", ...) must not look like a repeated header and split the game.
        if (g.hasMovetext || g.ended || hasOwn(g.headers, tag.key)) flush()
        // defineProperty so even a "__proto__" tag is stored as a plain data property.
        Object.defineProperty(g.headers, tag.key, { value: tag.value, writable: true, enumerable: true, configurable: true })
        started = true
      }
      continue
    }

    // Brace comment (may span lines)
    if (c === '{') {
      const close = src.indexOf('}', i + 1)
      const end = close === -1 ? n : close
      if (!g.ended) {
        g.comment(src.slice(i + 1, end))
        started = true
      }
      i = end + 1
      continue
    }

    // Rest-of-line comment
    if (c === ';') {
      let end = src.indexOf('\n', i + 1)
      if (end === -1) end = n
      if (!g.ended) {
        g.comment(src.slice(i + 1, end))
        started = true
      }
      i = end
      continue
    }

    if (c === '(') {
      if (!g.ended) {
        g.open()
        started = true
      }
      i++
      continue
    }
    if (c === ')') {
      if (!g.ended) g.close()
      i++
      continue
    }

    // NAG
    if (c === '$') {
      let j = i + 1
      while (j < n && src[j] >= '0' && src[j] <= '9') j++
      if (!g.ended) g.nag(parseInt(src.slice(i + 1, j), 10))
      i = j
      continue
    }

    // Stray closing bracket / brace: skip
    if (c === ']' || c === '}') {
      i++
      continue
    }

    // A movetext word
    let j = i
    while (j < n && !WORD_END.test(src[j])) j++
    const word = src.slice(i, j)
    i = j
    handleWord(word)
  }
  flush()
  return games

  function handleWord(raw: string): void {
    if (RESULTS.has(raw)) {
      if (!g.ended) {
        g.result = raw === '½-½' ? '1/2-1/2' : raw
        g.ended = true
        started = true
      }
      return
    }
    let word = raw
    // Leading move number: "12." / "12..." / "12...Nf6" / "1.e4"
    const num = /^(\d+)(\.+)/.exec(word)
    if (num) word = word.slice(num[0].length)
    else if (/^\d+$/.test(word)) return // bare move number without dot
    // Ellipsis tokens like "..." on their own
    word = word.replace(/^\.+/, '')
    if (!word) return
    // Standalone glyph token ("!", "?!", ...)
    if (/^[!?]+$/.test(word)) {
      if (!g.ended) g.glyph(word)
      return
    }
    const gm = /^(.*?)([!?]+)$/.exec(word)
    let san = gm ? gm[1] : word
    const glyph = gm ? gm[2] : null
    // Normalise zero-castling and strip "e.p." markers.
    if (/^0-0(-0)?[+#]?$/.test(san)) san = san.replace(/0/g, 'O')
    san = san.replace(/e\.p\.$/, '')
    if (!san) return
    if (g.ended) {
      // Movetext after a result without new headers: a new header-less game.
      flush()
    }
    g.move(san, glyph)
    started = true
  }
}

/** Reads `[Key "Value"]` starting at src[start] === '['. */
function readTag(src: string, start: number): { key: string | null; value: string; end: number } {
  const n = src.length
  let i = start + 1
  while (i < n && (src[i] === ' ' || src[i] === '\t')) i++
  let k = i
  while (k < n && /[A-Za-z0-9_]/.test(src[k])) k++
  const key = src.slice(i, k)
  i = k
  while (i < n && (src[i] === ' ' || src[i] === '\t')) i++
  let value = ''
  if (src[i] === '"') {
    i++
    while (i < n && src[i] !== '"' && src[i] !== '\n') {
      if (src[i] === '\\' && i + 1 < n && (src[i + 1] === '"' || src[i + 1] === '\\')) {
        value += src[i + 1]
        i += 2
      } else {
        value += src[i]
        i++
      }
    }
    if (src[i] === '"') i++
  }
  // Skip to the closing bracket on this line.
  while (i < n && src[i] !== ']' && src[i] !== '\n') i++
  if (src[i] === ']') i++
  return { key: key || null, value, end: i }
}

const COLOR_OF: Record<string, AnnotationColor> = { G: 'green', R: 'red', B: 'blue', Y: 'yellow' }
const SQ = '[a-h][1-8]'
const CAL_RE = new RegExp(`^([GRBY])(${SQ})(${SQ})$`)
const CSL_RE = new RegExp(`^([GRBY])(${SQ})$`)

/**
 * Splits a raw comment into clean text and drawing commands. All `[%...]`
 * commands ([%cal], [%csl], [%clk], [%eval], [%emt], [%anno], ...) are removed
 * from the text; [%cal] arrows and [%csl] square highlights are returned as data.
 * Whitespace (incl. newlines of multi-line comments) is collapsed to single spaces.
 */
export function parseCommentCommands(raw: string): { text: string; arrows: Arrow[]; highlights: Highlight[] } {
  const arrows: Arrow[] = []
  const highlights: Highlight[] = []
  const stripped = raw.replace(/\[%(\w+)([^\]]*)\]/g, (_all, cmd: string, args: string) => {
    if (cmd === 'cal' || cmd === 'csl') {
      for (const part of args.split(/[\s,]+/)) {
        if (!part) continue
        if (cmd === 'cal') {
          const m = CAL_RE.exec(part)
          if (m && m[2] !== m[3]) arrows.push({ from: m[2], to: m[3], color: COLOR_OF[m[1]] })
        } else {
          const m = CSL_RE.exec(part)
          if (m) highlights.push({ square: m[2], color: COLOR_OF[m[1]] })
        }
      }
    }
    return ' '
  })
  const text = stripped.replace(/\s+/g, ' ').trim()
  return { text, arrows, highlights }
}

/** Combines several raw comments into one clean text plus all their arrows/highlights. */
export function combineComments(raws: string[]): { text: string; arrows: Arrow[]; highlights: Highlight[] } {
  const texts: string[] = []
  const arrows: Arrow[] = []
  const highlights: Highlight[] = []
  for (const r of raws) {
    const p = parseCommentCommands(r)
    // A stray keystroke left in the study ("df") is not a comment: keep only
    // texts with at least 3 letters.
    if (p.text && (p.text.match(/\p{L}/gu)?.length ?? 0) >= 3) texts.push(p.text)
    arrows.push(...p.arrows)
    highlights.push(...p.highlights)
  }
  return { text: texts.join(' '), arrows, highlights }
}
