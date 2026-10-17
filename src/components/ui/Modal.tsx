import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx.ts'
import { isTopModal, popModal, pushModal } from './modalStack.ts'

export interface ModalProps {
  open: boolean
  /** Called on ✕, Escape, or a tap on the backdrop (when dismissible). */
  onClose?: () => void
  title?: ReactNode
  children?: ReactNode
  /** Buttons row at the bottom. */
  footer?: ReactNode
  /** Center the footer buttons (default: right-aligned). */
  footerCenter?: boolean
  /** Tap outside / Escape closes (default true when onClose is given). */
  dismissible?: boolean
  /** Hide the ✕ button (default: shown when onClose is given). */
  hideClose?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Accessible label when there is no visible title. */
  ariaLabel?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Focus-safe modal dialog rendered in a portal: focus moves into the dialog,
 * Tab is trapped inside, focus returns to the opener on close, background
 * scrolling is locked. Modals stack: only the top-most one handles Escape and
 * Tab, and the scroll lock is released when the last one closes (in any order).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  footerCenter,
  dismissible,
  hideClose,
  size = 'md',
  className,
  ariaLabel,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const canDismiss = (dismissible ?? true) && !!onClose
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const canDismissRef = useRef(canDismiss)
  canDismissRef.current = canDismiss

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    // Focus the first focusable element (or the dialog itself).
    const t = window.setTimeout(() => {
      if (!dialog) return
      const first = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? dialog).focus({ preventScroll: true })
    }, 30)

    const stackId = pushModal(document.body)

    const onKey = (e: KeyboardEvent) => {
      // Every open modal has a listener; only the top-most one acts.
      if (!isTopModal(stackId)) return
      if (e.key === 'Escape') {
        // Swallow Escape even when not dismissible, so nothing underneath reacts.
        e.stopPropagation()
        if (canDismissRef.current) onCloseRef.current?.()
      } else if (e.key === 'Tab' && dialog) {
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
        if (items.length === 0) {
          e.preventDefault()
          dialog.focus()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)

    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      popModal(stackId)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  const showClose = !!onClose && !hideClose

  return createPortal(
    <div
      className="modal-backdrop game-ui"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && canDismiss) {
          // Close on the click that follows (so the tap doesn't fall through).
          ;(e.currentTarget as HTMLElement).dataset.downOnBackdrop = '1'
        }
      }}
      onClick={(e) => {
        const el = e.currentTarget as HTMLElement
        if (e.target === el && canDismiss && el.dataset.downOnBackdrop === '1') onClose?.()
        delete el.dataset.downOnBackdrop
      }}
    >
      <div
        ref={dialogRef}
        className={cx('modal', size !== 'md' && `modal--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
      >
        {(title || showClose) && (
          <div className="modal__header">
            <div className="modal__title" id={titleId}>
              {title}
            </div>
            {showClose && (
              <button type="button" className="modal__close" aria-label="Close" onClick={() => onClose?.()}>
                ✕
              </button>
            )}
          </div>
        )}
        <div className="modal__body">{children}</div>
        {footer && <div className={cx('modal__footer', footerCenter && 'modal__footer--center')}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export default Modal
