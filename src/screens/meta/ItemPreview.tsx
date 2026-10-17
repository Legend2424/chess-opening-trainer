// Live previews of shop items: boards on a mini board with the player's own
// pieces, piece sets on the player's own board, avatars, trophies, a little
// animated sample of each celebration effect, and titles as a name ribbon.

import { memo, type CSSProperties } from 'react'
import type { CatalogItem, EffectId, Profile } from '../../types.ts'
import { Avatar, MiniBoard, cx } from '../../components/ui/index.ts'
import { boardThemeById, squareBaseStyle } from '../../theme/boards.ts'
import { PieceImage } from '../../theme/pieces.tsx'

export type PreviewSize = 'md' | 'lg'

export interface ItemPreviewProps {
  item: CatalogItem
  profile: Profile
  size?: PreviewSize
}

export function ItemPreview({ item, profile, size = 'md' }: ItemPreviewProps) {
  const lg = size === 'lg'
  switch (item.kind) {
    case 'board':
      return <MiniBoard boardTheme={item.refId} pieceSet={profile.equipped.pieces} size={lg ? 220 : 128} lastMove={['b1', 'c3']} />
    case 'pieces':
      return <PieceStrip setId={item.refId} boardId={profile.equipped.board} square={lg ? 76 : 50} />
    case 'avatar':
      return <Avatar emoji={item.refId} color={profile.color} size={lg ? 128 : 88} float={lg} />
    case 'trophy':
      return (
        <span className={cx('trophy-prev', lg && 'trophy-prev--lg')}>
          <span className="trophy-prev__emoji">{item.emoji}</span>
          <span className="trophy-prev__base" aria-hidden />
        </span>
      )
    case 'effect':
      return <EffectSample effect={item.refId as EffectId} big={lg} />
    case 'title':
      return (
        <span className={cx('title-prev', lg && 'title-prev--lg')}>
          <span className="title-prev__who">
            <Avatar emoji={profile.avatar} color={profile.color} size={lg ? 'md' : 'sm'} />
            <span className="title-prev__name">{profile.name}</span>
          </span>
          <span className="title-prev__ribbon">
            <span aria-hidden>{item.emoji}</span> {item.name}
          </span>
        </span>
      )
    default:
      return <span style={{ fontSize: lg ? 96 : 64 }}>{item.emoji}</span>
  }
}

/** Three squares of the player's board with K, Q, N of a piece set. */
const PieceStrip = memo(function PieceStrip({ setId, boardId, square }: { setId: string; boardId: string; square: number }) {
  const theme = boardThemeById(boardId)
  const cells: Array<[string, string]> = [
    ['b1', 'wK'],
    ['c1', 'bQ'],
    ['d1', 'wN'],
  ]
  const rim = Math.max(3, Math.round(square * 0.07))
  return (
    <span
      className="piece-strip"
      role="img"
      aria-label="Piece preview"
      style={{
        border: `${rim}px solid ${theme.frame}`,
        ...theme.boardStyle,
      }}
    >
      {cells.map(([sq, piece]) => (
        <span key={sq} className="piece-strip__sq" style={{ width: square, height: square, ...squareBaseStyle(theme, sq) }}>
          <PieceImage setId={setId} piece={piece} size={square} />
        </span>
      ))}
    </span>
  )
})

// ---------------------------------------------------------------------------
// Effect samples (pure CSS, so a grid of them stays cheap)
// ---------------------------------------------------------------------------

type SampleMode = 'fall' | 'burst' | 'twinkle' | 'rainbow'

const SAMPLES: Record<EffectId, { mode: SampleMode; glyphs?: string[]; colors: string[]; count: number }> = {
  confetti: { mode: 'fall', colors: ['#6c4bf4', '#ffb800', '#22c55e', '#3b82f6', '#ef4444', '#ec4899'], count: 16 },
  stars: { mode: 'twinkle', glyphs: ['⭐', '✨', '🌟'], colors: ['#ffd84d'], count: 9 },
  fireworks: { mode: 'burst', colors: ['#ef4444', '#ffb800', '#3b82f6', '#22c55e', '#ec4899', '#a855f7'], count: 14 },
  'emoji-rain': { mode: 'fall', glyphs: ['😄', '🎉', '🥳', '😎', '🤩'], colors: ['#fff'], count: 10 },
  'coin-shower': { mode: 'fall', glyphs: ['🪙'], colors: ['#ffb800'], count: 11 },
  rainbow: { mode: 'rainbow', glyphs: ['✨'], colors: ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7'], count: 6 },
}

/** Deterministic 0..1 "random" so the sample looks the same every render. */
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

export const EffectSample = memo(function EffectSample({ effect, big }: { effect: EffectId; big?: boolean }) {
  const spec = SAMPLES[effect] ?? SAMPLES.confetti
  const parts = []
  for (let i = 0; i < spec.count; i++) {
    const glyph = spec.glyphs ? spec.glyphs[i % spec.glyphs.length] : null
    const color = spec.colors[i % spec.colors.length]
    const angle = (i / spec.count) * Math.PI * 2
    const st = {
      '--x': `${Math.round(6 + rand(i, 1) * 88)}%`,
      '--y': `${Math.round(10 + rand(i, 2) * 70)}%`,
      '--delay': `${(rand(i, 3) * 2.2).toFixed(2)}s`,
      '--dur': `${(1.6 + rand(i, 4) * 1.2).toFixed(2)}s`,
      '--rot': `${Math.round(rand(i, 5) * 720 - 360)}deg`,
      '--dx': `${Math.round(Math.cos(angle) * 42)}px`,
      '--dy': `${Math.round(Math.sin(angle) * 42)}px`,
      '--c': color,
      '--s': (0.75 + rand(i, 6) * 0.6).toFixed(2),
    } as CSSProperties
    parts.push(
      <span key={i} className={cx('fx-sample__p', glyph ? 'fx-sample__p--glyph' : 'fx-sample__p--chip')} style={st}>
        {glyph}
      </span>,
    )
  }
  return (
    <span className={cx('fx-sample', `fx-sample--${spec.mode}`, big && 'fx-sample--lg')} role="img" aria-label={`${effect} effect preview`}>
      {spec.mode === 'rainbow' && <span className="fx-sample__arc" aria-hidden />}
      {spec.mode === 'burst' && <span className="fx-sample__core" aria-hidden />}
      {parts}
    </span>
  )
})
