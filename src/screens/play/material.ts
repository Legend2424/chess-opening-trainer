// Captured pieces and material balance.
//
// Captures made in this game come straight from the move list (exact, so a
// promotion is never mistaken for a capture). Pieces already gone in the start
// position (an opening's main line, a "Play on" position) are read from the
// start FEN, where a promoted piece above the starting count stands in for a
// pawn rather than counting that pawn as captured.
import type { Side } from './useComputerGame.ts'

export type PieceType = 'q' | 'r' | 'b' | 'n' | 'p'

const START_COUNT: Record<PieceType, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 }
const VALUE: Record<PieceType, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 }
export const PIECE_ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p']
const OFFICERS: PieceType[] = ['q', 'r', 'b', 'n']

type Counts = Record<Side, Record<PieceType, number>>

function countPieces(fen: string): Counts {
  const count: Counts = {
    w: { q: 0, r: 0, b: 0, n: 0, p: 0 },
    b: { q: 0, r: 0, b: 0, n: 0, p: 0 },
  }
  const placement = fen.split(' ')[0] ?? ''
  for (const ch of placement) {
    const t = ch.toLowerCase() as PieceType
    if (!(t in START_COUNT)) continue
    count[ch === t ? 'b' : 'w'][t]++
  }
  return count
}

/** Pieces above the starting count (only possible through promotion). */
function promotedExtras(c: Record<PieceType, number>): PieceType[] {
  const out: PieceType[] = []
  for (const t of OFFICERS) for (let i = START_COUNT[t]; i < c[t]; i++) out.push(t)
  return out
}

const byStrength = (a: PieceType, b: PieceType) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b)

export interface MaterialInfo {
  /** Pieces of `side` that are gone (captured by the other side), strongest first. */
  missing: Record<Side, PieceType[]>
  /** Promoted pieces of `side` still on the board above the starting count. */
  promoted: Record<Side, PieceType[]>
  /** White material minus black material (pawn = 1), from the current position. */
  diff: number
}

export interface CaptureLike {
  color: Side
  captured?: string
}

export function materialOf(startFen: string, moves: readonly CaptureLike[], fen: string): MaterialInfo {
  const start = countPieces(startFen)
  const now = countPieces(fen)
  const missing: Record<Side, PieceType[]> = { w: [], b: [] }
  const promoted: Record<Side, PieceType[]> = { w: [], b: [] }
  let diff = 0
  for (const side of ['w', 'b'] as Side[]) {
    const c = start[side]
    for (const t of OFFICERS) for (let i = c[t]; i < START_COUNT[t]; i++) missing[side].push(t)
    const pawnsGone = START_COUNT.p - c.p - promotedExtras(c).length
    for (let i = 0; i < pawnsGone; i++) missing[side].push('p')
    promoted[side] = promotedExtras(now[side])
    for (const t of PIECE_ORDER) diff += (side === 'w' ? 1 : -1) * now[side][t] * VALUE[t]
  }
  for (const m of moves) {
    const t = m.captured as PieceType | undefined
    if (t && t in START_COUNT) missing[m.color === 'w' ? 'b' : 'w'].push(t)
  }
  missing.w.sort(byStrength)
  missing.b.sort(byStrength)
  return { missing, promoted, diff }
}
