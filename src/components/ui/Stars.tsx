import { useId } from 'react'
import { cx } from './cx.ts'

export interface StarsProps {
  /** Earned stars (0..max). */
  count: number
  /** Default 3. */
  max?: number
  /** Star size in px (default 40). */
  size?: number
  /** Pop in one after another (default true). */
  animate?: boolean
  /** Middle star raised & larger (reward-screen style). Default true when max = 3. */
  arc?: boolean
  className?: string
}

function StarSvg({ on, gid }: { on: boolean; gid: string }) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path
        d="M12 1.8l3.05 6.2 6.83 1-4.94 4.82 1.17 6.8L12 17.4l-6.11 3.22 1.17-6.8L2.12 9l6.83-1z"
        fill={on ? `url(#${gid})` : '#cfcbe3'}
        stroke={on ? '#d08a00' : '#b4afcf'}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8.2 8.6l2.1-.3.9-1.9" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** 1–3 gold stars with a staggered pop-in. */
export function Stars({ count, max = 3, size = 40, animate = true, arc, className }: StarsProps) {
  const gid = 'sg' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const isArc = arc ?? max === 3
  return (
    <div
      className={cx('stars', isArc && 'stars--arc', className)}
      style={{ ['--star-size' as string]: `${size}px` }}
      role="img"
      aria-label={`${count} of ${max} stars`}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe46b" />
            <stop offset="60%" stopColor="#ffc21a" />
            <stop offset="100%" stopColor="#f5a300" />
          </linearGradient>
        </defs>
      </svg>
      {Array.from({ length: max }, (_, i) => {
        const on = i < count
        return (
          <span
            key={i}
            className={cx('star', !on && 'star--off', animate && on && 'star--anim')}
            style={{ ['--i' as string]: i }}
          >
            <StarSvg on={on} gid={gid} />
          </span>
        )
      })}
    </div>
  )
}

export default Stars
