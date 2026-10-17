import type { ReactNode } from 'react'
import { sfx } from '../../fx/sound.ts'
import { cx } from './cx.ts'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  /** Emoji shown inside the thumb when on / off. */
  onIcon?: ReactNode
  offIcon?: ReactNode
  className?: string
}

/** Big touch-friendly switch (role="switch"). The whole row is the tap target. */
export function Toggle({ checked, onChange, label, description, disabled, onIcon, offIcon, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cx('toggle', 'game-ui', className)}
      onClick={() => {
        sfx.click()
        onChange(!checked)
      }}
    >
      {(label != null || description != null) && (
        <span className="toggle__text">
          {label != null && <span className="toggle__label">{label}</span>}
          {description != null && <span className="toggle__desc">{description}</span>}
        </span>
      )}
      <span className="toggle__track" aria-hidden>
        <span className="toggle__thumb">{checked ? onIcon : offIcon}</span>
      </span>
    </button>
  )
}

export default Toggle
