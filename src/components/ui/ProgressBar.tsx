import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx.ts'

export interface ProgressBarProps {
  /** Current value (0..max). */
  value: number
  /** Default 1 (so `value` can be a fraction). */
  max?: number
  /** Fill colour or gradient (default violet gradient). */
  color?: string
  /** Bar height in px (default 14). */
  height?: number
  /** Label above the bar (left). */
  label?: ReactNode
  /** Text above the bar (right), e.g. "3 / 5". Pass `true` for an automatic percentage. */
  valueText?: ReactNode | true
  striped?: boolean
  className?: string
  style?: CSSProperties
}

export function ProgressBar({ value, max = 1, color, height, label, valueText, striped, className, style }: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const vars: Record<string, string> = {}
  if (color) vars['--fill'] = color
  if (height) vars['--h'] = `${height}px`
  const labelled = label != null || valueText != null

  const bar = (
    <div
      className={cx('progress', striped && 'progress--striped', !labelled && className)}
      style={labelled ? vars : { ...vars, ...style }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  )
  if (!labelled) return bar
  return (
    <div className={cx('progress-wrap', className)} style={style}>
      <div className="progress-wrap__label">
        <span>{label}</span>
        <span className="num">{valueText === true ? `${Math.round(pct)}%` : valueText}</span>
      </div>
      {bar}
    </div>
  )
}

export default ProgressBar
