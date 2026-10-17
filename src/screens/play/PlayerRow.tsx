import type { CSSProperties, ReactNode } from 'react'
import { PieceImage } from '../../theme/pieces.tsx'
import { cx } from '../../components/ui/index.ts'
import { materialOf, type CaptureLike, type PieceType } from './material.ts'
import type { Side } from './useComputerGame.ts'

export interface PlayerRowProps {
  avatar: ReactNode
  name: ReactNode
  sub?: ReactNode
  /** The colour this player plays. */
  side: Side
  /** Where the game started, the moves so far and the current position. */
  startFen: string
  moves: readonly CaptureLike[]
  fen: string
  pieceSet: string
  /** Glow when it's this player's turn. */
  active?: boolean
  /** Extra content on the right (e.g. a "thinking" chip). */
  status?: ReactNode
  accent?: string
  className?: string
}

function group(list: PieceType[]): { t: PieceType; n: number }[] {
  const groups: { t: PieceType; n: number }[] = []
  for (const t of list) {
    const last = groups[groups.length - 1]
    if (last && last.t === t) last.n++
    else groups.push({ t, n: 1 })
  }
  return groups
}

/** Player strip: avatar, name, the pieces they captured (+ promoted pieces) and their material lead. */
export function PlayerRow({ avatar, name, sub, side, startFen, moves, fen, pieceSet, active, status, accent, className }: PlayerRowProps) {
  const { missing, promoted, diff } = materialOf(startFen, moves, fen)
  const opp: Side = side === 'w' ? 'b' : 'w'
  const taken = missing[opp]
  const extra = promoted[side]
  const lead = side === 'w' ? diff : -diff
  const label =
    (taken.length ? `Captured ${taken.length} piece${taken.length === 1 ? '' : 's'}` : 'No captures yet') +
    (extra.length ? `, ${extra.length} promoted` : '')
  return (
    <div
      className={cx('play-player', active && 'is-active', className)}
      style={accent ? ({ ['--player-accent' as string]: accent } as CSSProperties) : undefined}
    >
      <span className="play-player__avatar" aria-hidden>
        {avatar}
      </span>
      <div className="play-player__info">
        <div className="play-player__name">{name}</div>
        {sub && <div className="play-player__sub">{sub}</div>}
      </div>
      <div className="play-player__captured" aria-label={label}>
        {group(taken).map((g) => (
          <span key={g.t} className="play-captured__group">
            {Array.from({ length: g.n }, (_, i) => (
              <PieceImage key={i} setId={pieceSet} piece={`${opp}${g.t.toUpperCase()}`} size={20} className="play-captured__piece" />
            ))}
          </span>
        ))}
        {group(extra).map((g) => (
          <span key={`promo-${g.t}`} className="play-captured__group play-captured__group--promoted" title="Promoted">
            {Array.from({ length: g.n }, (_, i) => (
              <PieceImage key={i} setId={pieceSet} piece={`${side}${g.t.toUpperCase()}`} size={20} className="play-captured__piece" />
            ))}
          </span>
        ))}
        {lead > 0 && <span className="play-captured__lead num">+{lead}</span>}
      </div>
      {status}
    </div>
  )
}

export default PlayerRow
