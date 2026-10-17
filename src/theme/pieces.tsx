// Piece sets: Lichess SVG sets (public/pieces/<set>/<wK>.svg) + a fun 'emoji' set.

import type { ComponentProps, CSSProperties, ReactElement } from 'react'
import type { Chessboard } from 'react-chessboard'
import { PIECE_SET_IDS, type PieceSetId } from '../types.ts'
import { assetUrl } from './boards.ts'

export const PIECE_CODES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'] as const
export type PieceCode = (typeof PIECE_CODES)[number]

type RcProps = ComponentProps<typeof Chessboard>
/** react-chessboard's `customPieces` map. */
export type CustomPieces = NonNullable<RcProps['customPieces']>

export const PIECE_SET_NAMES: Record<PieceSetId, string> = {
  cburnett: 'Classic',
  merida: 'Merida',
  alpha: 'Alpha',
  california: 'California',
  cardinal: 'Cardinal',
  staunty: 'Staunty',
  fantasy: 'Fantasy',
  spatial: 'Spatial',
  pixel: 'Pixel',
  horsey: 'Horsey',
  anarcandy: 'Anarcandy',
  emoji: 'Emoji Party',
}

export const PIECE_SET_LIST: { id: PieceSetId; name: string }[] = PIECE_SET_IDS.map((id) => ({
  id,
  name: PIECE_SET_NAMES[id],
}))

/** Emoji used by the 'emoji' set (same for both colours; the disc shows the colour). */
export const EMOJI_PIECES: Record<string, string> = {
  K: '👑',
  Q: '👸',
  R: '🏰',
  B: '🧙',
  N: '🐴',
  P: '🐣',
}

function normalizeSet(setId: string): PieceSetId {
  return (PIECE_SET_IDS as readonly string[]).includes(setId) ? (setId as PieceSetId) : 'cburnett'
}

/** URL of one Lichess piece SVG (not valid for 'emoji'). */
export function pieceUrl(setId: PieceSetId, piece: PieceCode): string {
  const set = setId === 'emoji' ? 'cburnett' : setId
  return assetUrl(`pieces/${set}/${piece}.svg`)
}

const imgStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
}

function EmojiDisc({ piece, size }: { piece: string; size: number }) {
  const white = piece[0] === 'w'
  const emoji = EMOJI_PIECES[piece[1]] ?? '❓'
  const disc = Math.round(size * 0.86)
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          width: disc,
          height: disc,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          boxSizing: 'border-box',
          border: `${Math.max(2, Math.round(size * 0.05))}px solid ${white ? '#3b82f6' : '#ffb800'}`,
          background: white
            ? 'radial-gradient(circle at 35% 30%, #ffffff 0%, #eef2ff 60%, #d7ddf5 100%)'
            : 'radial-gradient(circle at 35% 30%, #4b4588 0%, #2a2560 60%, #17143d 100%)',
          boxShadow: `0 ${Math.max(1, Math.round(size * 0.04))}px ${Math.max(2, Math.round(size * 0.08))}px rgba(0,0,0,0.35)`,
          fontSize: Math.round(size * 0.52),
          lineHeight: 1,
          fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
        }}
      >
        {emoji}
      </div>
    </div>
  )
}

export interface PieceImageProps {
  setId: PieceSetId | string
  piece: PieceCode | string
  size: number
  style?: CSSProperties
  className?: string
}

/** Renders a single piece of a set at `size` px. */
export function PieceImage({ setId, piece, size, style, className }: PieceImageProps) {
  const set = normalizeSet(setId)
  if (set === 'emoji') {
    return (
      <div className={className} style={{ width: size, height: size, ...style }}>
        <EmojiDisc piece={piece} size={size} />
      </div>
    )
  }
  return (
    <div className={className} style={{ width: size, height: size, ...style }}>
      <img src={pieceUrl(set, piece as PieceCode)} alt="" draggable={false} style={imgStyle} />
    </div>
  )
}

const piecesCache = new Map<PieceSetId, CustomPieces>()

/**
 * react-chessboard `customPieces` for a set. Cached per set so the object
 * identity is stable (react-chessboard re-initialises pieces when it changes).
 */
export function buildCustomPieces(setId: PieceSetId | string): CustomPieces {
  const set = normalizeSet(setId)
  const cached = piecesCache.get(set)
  if (cached) return cached
  const map: CustomPieces = {}
  for (const code of PIECE_CODES) {
    map[code] = ({ squareWidth, isDragging }): ReactElement => {
      const lift: CSSProperties = isDragging
        ? { transform: 'scale(1.18) translateY(-6%)', filter: 'drop-shadow(0 6px 6px rgba(0,0,0,0.35))' }
        : {}
      if (set === 'emoji') {
        return (
          <div style={{ width: squareWidth, height: squareWidth, ...lift }}>
            <EmojiDisc piece={code} size={squareWidth} />
          </div>
        )
      }
      return (
        <div style={{ width: squareWidth, height: squareWidth, ...lift }}>
          <img src={pieceUrl(set, code)} alt="" draggable={false} style={imgStyle} />
        </div>
      )
    }
  }
  piecesCache.set(set, map)
  return map
}

const preloaded = new Set<string>()

/** Warm the browser cache for a set (e.g. when the shop opens). */
export function preloadPieceSet(setId: PieceSetId | string): void {
  const set = normalizeSet(setId)
  if (set === 'emoji' || preloaded.has(set) || typeof Image === 'undefined') return
  preloaded.add(set)
  for (const code of PIECE_CODES) {
    const img = new Image()
    img.src = pieceUrl(set, code)
  }
}

export interface PiecePreviewProps {
  setId: PieceSetId | string
  /** Size of each piece in px (default 44). */
  size?: number
  /** Pieces to show (default: white King, black Queen, white Knight). */
  pieces?: (PieceCode | string)[]
  /** Background behind the pieces (default: a soft light/dark split). */
  background?: string
  className?: string
  style?: CSSProperties
}

/** Shop preview: K, Q, N of a set side by side. */
export function PiecePreview({ setId, size = 44, pieces = ['wK', 'bQ', 'wN'], background, className, style }: PiecePreviewProps) {
  return (
    <div
      className={['piece-preview', className].filter(Boolean).join(' ')}
      aria-label={`${PIECE_SET_NAMES[normalizeSet(setId)]} pieces`}
      role="img"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Math.round(size * 0.06),
        padding: Math.round(size * 0.14),
        borderRadius: Math.round(size * 0.35),
        background: background ?? 'linear-gradient(135deg, #f4f1ff 0%, #ffffff 50%, #e8e4fb 100%)',
        ...style,
      }}
    >
      {pieces.map((p, i) => (
        <PieceImage key={`${p}-${i}`} setId={setId} piece={p} size={size} />
      ))}
    </div>
  )
}
