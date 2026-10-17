import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx.ts'

export type ChipTone = 'violet' | 'gold' | 'green' | 'red' | 'blue' | 'gray' | 'white' | 'solid'

export interface ChipProps {
  children?: ReactNode
  /** Leading emoji/icon. */
  icon?: ReactNode
  tone?: ChipTone
  size?: 'md' | 'lg'
  /** Pop-in animation (e.g. reward breakdown chips); use with style={{'--i': n}} to stagger. */
  pop?: boolean
  className?: string
  style?: CSSProperties
  title?: string
}

/** Small rounded label: "3 lines to review", "+10 ⭐ Perfect!", "NEW". */
export function Chip({ children, icon, tone = 'violet', size = 'md', pop, className, style, title }: ChipProps) {
  return (
    <span
      className={cx('chip', tone !== 'violet' && `chip--${tone}`, size === 'lg' && 'chip--lg', pop && 'anim-pop anim-delay', className)}
      style={style}
      title={title}
    >
      {icon != null && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  )
}

export default Chip
