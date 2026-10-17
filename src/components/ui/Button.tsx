import { forwardRef, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react'
import { sfx } from '../../fx/sound.ts'
import { cx } from './cx.ts'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'success' | 'info'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon (emoji or element). */
  icon?: ReactNode
  /** Trailing icon. */
  iconRight?: ReactNode
  /** Full width. */
  block?: boolean
  /** Pill shape. */
  round?: boolean
  /** Gentle attention pulse (e.g. "Take it back"). */
  pulse?: boolean
  /** Moving shine (e.g. "Next line"). */
  shine?: boolean
  /** Play the click sound on press (default true). */
  clickSound?: boolean
}

/** Chunky 3D button: a bottom "edge" shadow that squishes on press. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconRight,
    block,
    round,
    pulse,
    shine,
    clickSound = true,
    className,
    children,
    type = 'button',
    disabled,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
    ...rest
  },
  ref,
) {
  const [pressed, setPressed] = useState(false)
  const iconOnly = !children && (icon || iconRight)

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cx(
        'btn',
        `btn--${variant}`,
        `btn--${size}`,
        block && 'btn--block',
        round && 'btn--round',
        pulse && 'btn--pulse',
        shine && 'btn--shine',
        iconOnly && 'btn--icon-only',
        pressed && 'is-pressed',
        className,
      )}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        if (!disabled) {
          setPressed(true)
          if (clickSound) sfx.click()
        }
        onPointerDown?.(e)
      }}
      onPointerUp={(e) => {
        setPressed(false)
        onPointerUp?.(e)
      }}
      onPointerLeave={(e) => {
        setPressed(false)
        onPointerLeave?.(e)
      }}
      onPointerCancel={(e) => {
        setPressed(false)
        onPointerCancel?.(e)
      }}
      {...rest}
    >
      {icon != null && (
        <span className="btn__icon" aria-hidden>
          {icon}
        </span>
      )}
      {children != null && <span className="btn__label">{children}</span>}
      {iconRight != null && (
        <span className="btn__icon" aria-hidden>
          {iconRight}
        </span>
      )}
    </button>
  )
})

export default Button
