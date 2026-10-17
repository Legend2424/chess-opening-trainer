import type { CSSProperties, ReactNode } from 'react'
import { sfx } from '../../fx/sound.ts'
import { cx } from './cx.ts'

const SIZES = { xs: 32, sm: 44, md: 56, lg: 84, xl: 128 } as const

export interface AvatarProps {
  /** The avatar emoji (a Profile.avatar). */
  emoji: string
  /** Background colour (e.g. Profile.color). */
  color?: string
  size?: keyof typeof SIZES | number
  /** White outline ring (e.g. "selected"). */
  ring?: boolean
  /** Small corner badge (level emoji, a check mark...). */
  badge?: ReactNode
  /** Gentle floating animation. */
  float?: boolean
  onClick?: () => void
  className?: string
  style?: CSSProperties
  label?: string
}

export function Avatar({ emoji, color, size = 'md', ring, badge, float, onClick, className, style, label }: AvatarProps) {
  const px = typeof size === 'number' ? size : SIZES[size]
  const st: Record<string, string | number> = { ...(style as Record<string, string | number>), '--size': `${px}px` }
  if (color) st['--avatar-color'] = color
  const content = (
    <>
      <span className={cx('avatar__emoji', float && 'anim-float')} aria-hidden>
        {emoji}
      </span>
      {badge != null && <span className="avatar__badge">{badge}</span>}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        className={cx('avatar', 'avatar--button', ring && 'avatar--ring', className)}
        style={st}
        onClick={onClick}
        onPointerDown={() => sfx.click()}
        aria-label={label ?? 'Avatar'}
      >
        {content}
      </button>
    )
  }
  return (
    <span className={cx('avatar', ring && 'avatar--ring', className)} style={st} role="img" aria-label={label ?? emoji}>
      {content}
    </span>
  )
}

export default Avatar
