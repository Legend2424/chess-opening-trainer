import { cx } from '../../components/ui/index.ts'
import type { UserMoveMark } from '../../trainer/trainerReducer.ts'

/** A mark the kid plays (a branch start's 'skip' marks are left out by the caller). */
export type PlayedMark = Exclude<UserMoveMark, 'skip'>

export interface ProgressDotsProps {
  /** Only the moves to play: no 'skip' marks (see playedMarks). */
  marks: readonly PlayedMark[]
  /** Index in `marks` of the user move being played now (pulses); -1 for none. */
  current: number
  className?: string
}

/** The marks of the moves the kid plays in this run (a branch start's skipped moves left out). */
export function playedMarks(marks: readonly UserMoveMark[]): PlayedMark[] {
  return marks.filter((m): m is PlayedMark => m !== 'skip')
}

/** One dot per user move: pending (empty), clean ✓ (green), fixed ↺ (amber). */
export function ProgressDots({ marks, current, className }: ProgressDotsProps) {
  const done = marks.filter((m) => m !== 'pending').length
  return (
    <ol className={cx('pdots', marks.length > 11 && 'pdots--small', className)} aria-label={`Your moves: ${done} of ${marks.length}`}>
      {marks.map((m, i) => (
        <li
          key={i}
          className={cx('pdot', `pdot--${m}`, i === current && m === 'pending' && 'pdot--current')}
          title={m === 'clean' ? 'Played right first time' : m === 'fixed' ? 'Fixed after a try' : 'Still to play'}
        >
          <span aria-hidden>{m === 'clean' ? '✓' : m === 'fixed' ? '↺' : ''}</span>
        </li>
      ))}
    </ol>
  )
}

export default ProgressDots
