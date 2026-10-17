import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { cx } from './cx.ts'

function reducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

export interface CountUpOptions {
  /** Animation length in ms (default 900). */
  duration?: number
  /** Start value on first mount (default: `value`, i.e. no animation on mount). */
  from?: number
  /** Delay before counting starts, ms. */
  delay?: number
  /** Called on every displayed integer change (e.g. to tick a sound). */
  onTick?: (n: number) => void
}

/** Animated number that counts from its previous value to `value`. */
export function useCountUp(value: number, opts: CountUpOptions = {}): number {
  const { duration = 900, from, delay = 0 } = opts
  const [shown, setShown] = useState(from ?? value)
  const shownRef = useRef(from ?? value)
  const onTickRef = useRef(opts.onTick)
  onTickRef.current = opts.onTick

  useEffect(() => {
    const start = shownRef.current
    if (start === value) return
    if (reducedMotion() || duration <= 0) {
      shownRef.current = value
      setShown(value)
      return
    }
    let raf = 0
    let t0 = 0
    const timer = window.setTimeout(() => {
      const step = (now: number) => {
        if (!t0) t0 = now
        const p = Math.min(1, (now - t0) / duration)
        const n = Math.round(start + (value - start) * easeOutCubic(p))
        if (n !== shownRef.current) {
          shownRef.current = n
          setShown(n)
          onTickRef.current?.(n)
        }
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, delay)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [value, duration, delay])

  return shown
}

export interface CountUpProps extends CountUpOptions {
  value: number
  className?: string
  style?: CSSProperties
  /** Prefix such as '+'. */
  prefix?: string
}

/** Inline count-up number (Fredoka, tabular digits). */
export function CountUp({ value, className, style, prefix, ...opts }: CountUpProps) {
  const n = useCountUp(value, opts)
  return (
    <span className={cx('count-up', className)} style={style}>
      {prefix}
      {n.toLocaleString()}
    </span>
  )
}

export interface CoinBadgeProps {
  value: number
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Count up/down when `value` changes (default true). */
  animate?: boolean
  /** Count from this value on mount (e.g. coins before the reward). */
  from?: number
  /** Show a floating "+N" when the value goes up (default true). */
  showDelta?: boolean
  onClick?: () => void
  className?: string
  title?: string
}

/** Gold coin counter with a bump + floating "+N" when it changes. */
export function CoinBadge({ value, size = 'md', animate = true, from, showDelta = true, onClick, className, title }: CoinBadgeProps) {
  const shown = useCountUp(value, { duration: animate ? 900 : 0, from: animate ? from : undefined })
  const prev = useRef(from ?? value)
  const [delta, setDelta] = useState<{ n: number; key: number } | null>(null)
  const [bump, setBump] = useState(0)

  useEffect(() => {
    const d = value - prev.current
    prev.current = value
    if (d === 0) return
    setBump((b) => b + 1)
    if (showDelta) setDelta({ n: d, key: Date.now() })
    const t = window.setTimeout(() => setDelta(null), 1200)
    return () => window.clearTimeout(t)
  }, [value, showDelta])

  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={cx('coin-badge', size !== 'md' && `coin-badge--${size}`, bump > 0 && 'is-bumping', className)}
      // Re-trigger the bump animation on every change.
      key={bump}
      onClick={onClick}
      title={title ?? `${value} coins`}
      aria-label={`${value} coins`}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <span className="coin-badge__coin" aria-hidden>
        ★
      </span>
      <span className="coin-badge__value">{shown.toLocaleString()}</span>
      {delta && (
        <span key={delta.key} className={cx('coin-badge__delta', delta.n < 0 && 'coin-badge__delta--neg')} aria-hidden>
          {delta.n > 0 ? `+${delta.n}` : delta.n}
        </span>
      )}
    </Tag>
  )
}

export default CoinBadge
