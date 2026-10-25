import { useEffect, useRef } from 'react'
import { cx } from '../../components/ui/index.ts'
import type { PlayedMove } from '../../trainer/trainerReducer.ts'

export interface MoveListProps {
  startFen: string
  history: PlayedMove[]
  /** The wrong move shown on the board (drawn red at the end). */
  wrong: PlayedMove | null
  userColor: 'w' | 'b'
  className?: string
}

/** The moves played so far, "1.e4 c5 2.Nf3 …", newest highlighted; a branch start's auto-played moves in grey. */
export function MoveList({ startFen, history, wrong, userColor, className }: MoveListProps) {
  const parts = startFen.split(/\s+/)
  let side: 'w' | 'b' = parts[1] === 'b' ? 'b' : 'w'
  let num = Number(parts[5]) || 1
  const moves = wrong ? [...history, wrong] : history
  const endRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = endRef.current
    const box = el?.parentElement
    if (el && box) {
      box.scrollTop = box.scrollHeight
      box.scrollLeft = box.scrollWidth
    }
  }, [moves.length])

  const items = moves.map((m, i) => {
    const isWrong = !!wrong && i === moves.length - 1
    const label = side === 'w' ? `${num}.` : i === 0 ? `${num}...` : ''
    const item = (
      <span key={i} className={cx('mlist__item', m.skipped && 'is-skipped')} title={m.skipped ? 'Played for you (skipped ahead)' : undefined}>
        {label && <span className="mlist__num">{label}</span>}
        <span
          className={cx(
            'mlist__san',
            m.by === 'user' ? 'is-user' : 'is-opp',
            i === moves.length - 1 && 'is-last',
            isWrong && 'is-wrong',
            m.skipped && 'is-skipped',
          )}
        >
          {m.san}
          {isWrong && ' ✗'}
        </span>
      </span>
    )
    if (side === 'b') num++
    side = side === 'w' ? 'b' : 'w'
    return item
  })

  return (
    <div className={cx('mlist', className)} aria-label="Moves played">
      {items.length === 0 ? (
        <span className="mlist__empty">{userColor === parts[1] ? 'Your move first!' : 'Your opponent moves first…'}</span>
      ) : (
        items
      )}
      <span ref={endRef} />
    </div>
  )
}

export default MoveList
