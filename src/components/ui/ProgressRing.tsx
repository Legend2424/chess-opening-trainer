import { useId, type CSSProperties, type ReactNode } from 'react'
import { cx } from './cx.ts'

export interface ProgressRingProps {
  /** 0..1 */
  value: number
  /** Diameter in px (default 72). */
  size?: number
  /** Stroke width in px (default size / 9). */
  stroke?: number
  /** Ring colour; pass two colours for a gradient. Default violet gradient. */
  color?: string | [string, string]
  trackColor?: string
  /** Centre content; defaults to the percentage. */
  children?: ReactNode
  /** Hide the default percentage text. */
  hideText?: boolean
  className?: string
  style?: CSSProperties
  ariaLabel?: string
}

export function ProgressRing({
  value,
  size = 72,
  stroke,
  color = ['#9b82ff', '#6c4bf4'],
  trackColor = 'rgba(108, 75, 244, 0.14)',
  children,
  hideText,
  className,
  style,
  ariaLabel,
}: ProgressRingProps) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const sw = stroke ?? Math.max(4, Math.round(size / 9))
  const r = (size - sw) / 2
  const c = 2 * Math.PI * r
  const stroked = Array.isArray(color) ? `url(#rg${gid})` : color
  return (
    <div
      className={cx('ring', className)}
      style={{ width: size, height: size, ...style }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {Array.isArray(color) && (
          <defs>
            <linearGradient id={`rg${gid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={color[0]} />
              <stop offset="100%" stopColor={color[1]} />
            </linearGradient>
          </defs>
        )}
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={sw} />
        <circle
          className="ring__value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={stroked}
          strokeWidth={sw}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ opacity: v > 0 ? 1 : 0 }}
        />
      </svg>
      <div className="ring__center" style={{ fontSize: Math.max(11, Math.round(size * 0.24)) }}>
        {children ?? (hideText ? null : `${Math.round(v * 100)}%`)}
      </div>
    </div>
  )
}

export default ProgressRing
