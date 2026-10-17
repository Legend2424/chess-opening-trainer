import { memo, type CSSProperties } from 'react'
import type { BoardThemeId, Color, PieceSetId } from '../../types.ts'
import { boardThemeById, highlightColors, squareBaseStyle } from '../../theme/boards.ts'
import { PieceImage } from '../../theme/pieces.tsx'
import { cx } from './cx.ts'

/** A lively position for shop previews (Sicilian after 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3). */
export const PREVIEW_FEN = 'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R b KQkq - 2 5'

const FILES = 'abcdefgh'

function parsePlacement(fen: string): (string | null)[] {
  // returns 64 entries, index 0 = a8, 63 = h1; values like 'wK' / 'bP'
  const out: (string | null)[] = []
  const placement = (fen === 'start' ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR' : fen).split(' ')[0] ?? ''
  for (const row of placement.split('/')) {
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) out.push(null)
      } else if (/[prnbqkPRNBQK]/.test(ch)) {
        out.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase())
      }
    }
  }
  while (out.length < 64) out.push(null)
  return out.slice(0, 64)
}

export interface MiniBoardProps {
  /** FEN (or 'start'). Default: PREVIEW_FEN. */
  fen?: string
  boardTheme: BoardThemeId | string
  pieceSet: PieceSetId | string
  /** Width/height in px (default 160). */
  size?: number
  orientation?: Color
  lastMove?: [string, string] | null
  /** Draw the theme's rim (default true). */
  frame?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * Lightweight, static (non-interactive) board for previews: shop cards,
 * theme pickers, galleries. No drag & drop, no chess.js - cheap to render many.
 */
export const MiniBoard = memo(function MiniBoard({
  fen = PREVIEW_FEN,
  boardTheme,
  pieceSet,
  size = 160,
  orientation = 'white',
  lastMove,
  frame = true,
  className,
  style,
}: MiniBoardProps) {
  const theme = boardThemeById(boardTheme)
  const hl = highlightColors(theme)
  const cells = parsePlacement(fen)
  const rim = frame ? Math.max(2, Math.round(size * 0.022)) : 0
  const cell = (size - 2 * rim) / 8
  const squares = []
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = orientation === 'white' ? col : 7 - col
      const rank = orientation === 'white' ? 7 - row : row // 0-based rank index (0 = rank 1)
      const sq = FILES[file] + (rank + 1)
      const piece = cells[(7 - rank) * 8 + file]
      const base = squareBaseStyle(theme, sq)
      const isLast = !!lastMove && (lastMove[0] === sq || lastMove[1] === sq)
      const st: CSSProperties = isLast
        ? {
            ...base,
            backgroundImage: [`linear-gradient(${hl.lastMove}, ${hl.lastMove})`, base.backgroundImage].filter(Boolean).join(', '),
          }
        : base
      squares.push(
        <div key={sq} className="mini-board__sq" style={st}>
          {piece && <PieceImage setId={pieceSet} piece={piece} size={cell} />}
        </div>,
      )
    }
  }
  return (
    <div
      className={cx('mini-board', className)}
      role="img"
      aria-label={`${theme.name} board preview`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.04)),
        border: rim ? `${rim}px solid ${theme.frame}` : undefined,
        boxShadow: '0 4px 12px rgba(30, 20, 80, 0.22)',
        ...theme.boardStyle,
        ...style,
      }}
    >
      {squares}
    </div>
  )
})

export default MiniBoard
