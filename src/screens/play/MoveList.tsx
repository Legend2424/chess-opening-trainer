import { useEffect, useRef } from 'react'
import { cx } from '../../components/ui/index.ts'
import type { PlayedMove } from './useComputerGame.ts'

interface Row {
  num: number
  white?: { san: string; idx: number }
  black?: { san: string; idx: number }
}

function buildRows(startFen: string, moves: PlayedMove[]): Row[] {
  const parts = startFen.split(' ')
  let num = Math.max(1, Number(parts[5]) || 1)
  const rows: Row[] = []
  let row: Row | null = null
  moves.forEach((m, idx) => {
    const cell = { san: m.san, idx }
    if (m.color === 'w') {
      row = { num, white: cell }
      rows.push(row)
    } else {
      if (!row) {
        row = { num }
        rows.push(row)
      }
      row.black = cell
      row = null
      num++
    }
  })
  return rows
}

/** Compact SAN move list ("1. e4 e5  2. Nf3 …") that keeps the newest move in view. */
export function MoveList({ startFen, moves, className }: { startFen: string; moves: PlayedMove[]; className?: string }) {
  const ref = useRef<HTMLOListElement>(null)
  const rows = buildRows(startFen, moves)
  const lastIdx = moves.length - 1

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [moves.length])

  if (moves.length === 0) {
    return <div className={cx('play-moves', 'play-moves--empty', className)}>No moves yet — the board is waiting! ♟️</div>
  }
  return (
    <ol ref={ref} className={cx('play-moves', className)} aria-label="Moves played">
      {rows.map((r, i) => (
        <li key={i} className="play-moves__row">
          <span className="play-moves__num num">{r.num}.</span>
          <span className={cx('play-moves__san', r.white?.idx === lastIdx && 'is-last')}>{r.white ? r.white.san : '…'}</span>
          {r.black && <span className={cx('play-moves__san', r.black.idx === lastIdx && 'is-last')}>{r.black.san}</span>}
        </li>
      ))}
    </ol>
  )
}

export default MoveList
