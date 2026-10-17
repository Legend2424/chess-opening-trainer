import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { sfx } from '../../fx/sound.ts'
import { cx } from './cx.ts'

export interface TabItem<T extends string = string> {
  id: T
  label: ReactNode
  icon?: ReactNode
  /** Small red counter badge (e.g. pending requests). */
  badge?: ReactNode
  disabled?: boolean
}

export interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Tabs share the width equally instead of scrolling. */
  stretch?: boolean
  className?: string
  ariaLabel?: string
}

/** Segmented pill tabs; horizontally scrollable when they don't fit. */
export function Tabs<T extends string = string>({ tabs, value, onChange, stretch, className, ariaLabel }: TabsProps<T>) {
  const ref = useRef<HTMLDivElement>(null)

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const enabled = tabs.filter((t) => !t.disabled)
    const i = enabled.findIndex((t) => t.id === value)
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
    if (next) {
      e.preventDefault()
      onChange(next.id)
      const btn = ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${String(next.id)}"]`)
      btn?.focus()
    }
  }

  return (
    <div ref={ref} className={cx('tabs', stretch && 'tabs--stretch', 'game-ui', className)} role="tablist" aria-label={ariaLabel} onKeyDown={onKey}>
      {tabs.map((t) => {
        const selected = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            className="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            onPointerDown={() => sfx.click()}
            onClick={(e) => {
              if (!selected) onChange(t.id)
              e.currentTarget.scrollIntoView?.({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
            }}
          >
            {t.icon != null && (
              <span className="tab__icon" aria-hidden>
                {t.icon}
              </span>
            )}
            <span>{t.label}</span>
            {t.badge != null && t.badge !== 0 && <span className="tab__badge">{t.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default Tabs
