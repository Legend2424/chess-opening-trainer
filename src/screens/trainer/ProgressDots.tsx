import { cx } from '../../components/ui/index.ts'

export interface ProgressDotsProps {
  marks: ('pending' | 'clean' | 'fixed')[]
  /** Index of the user move being played now (pulses); -1 for none. */
  current: number
  className?: string
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
