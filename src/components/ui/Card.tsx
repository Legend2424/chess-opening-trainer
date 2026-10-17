import { forwardRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { sfx } from '../../fx/sound.ts'
import { cx } from './cx.ts'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** Coloured top border (CSS colour). */
  accent?: string
  /** Outlined instead of shadowed. */
  flat?: boolean
  /** Frosted translucent card. */
  glass?: boolean
  /** Greyed out and not clickable. */
  disabled?: boolean
  /** Optional title rendered in the heading font. */
  title?: string
  children?: ReactNode
}

/**
 * White rounded card. With `onClick` it becomes a pressable (button role,
 * keyboard accessible, squish on press, click sound).
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = 'md', accent, flat, glass, disabled, title, className, style, children, onClick, onKeyDown, ...rest },
  ref,
) {
  const interactive = !!onClick && !disabled
  const [pressed, setPressed] = useState(false)
  const st: CSSProperties = { ...style }
  if (accent) (st as Record<string, string>)['--card-accent'] = accent

  return (
    <div
      ref={ref}
      className={cx(
        'card',
        padding !== 'md' && `card--pad-${padding}`,
        flat && 'card--flat',
        glass && 'card--glass',
        accent && 'card--accent',
        interactive && 'card--interactive',
        disabled && 'card--disabled',
        pressed && 'is-pressed',
        className,
      )}
      style={st}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-disabled={disabled || undefined}
      onClick={interactive ? onClick : undefined}
      onPointerDown={
        interactive
          ? () => {
              setPressed(true)
              sfx.click()
            }
          : undefined
      }
      onPointerUp={interactive ? () => setPressed(false) : undefined}
      onPointerLeave={interactive ? () => setPressed(false) : undefined}
      onPointerCancel={interactive ? () => setPressed(false) : undefined}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        // Only keys aimed at the card itself: a focused button/input inside a
        // pressable card keeps its own Enter/Space behaviour.
        if (interactive && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          ;(e.currentTarget as HTMLDivElement).click()
        }
        onKeyDown?.(e)
      }}
      {...rest}
    >
      {title && <h3 className="card__title">{title}</h3>}
      {children}
    </div>
  )
})

export default Card
