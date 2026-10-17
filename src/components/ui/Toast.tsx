import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { sfx } from '../../fx/sound.ts'
import { cx } from './cx.ts'

export type ToastKind = 'info' | 'success' | 'error' | 'coin' | 'achievement'

export interface ToastOptions {
  message?: ReactNode
  title?: ReactNode
  emoji?: string
  kind?: ToastKind
  /** ms before auto-dismiss (default 2800; 0 = sticky until tapped). */
  duration?: number
  /** Play a matching sound (default true). */
  sound?: boolean
  /** A button in the toast (e.g. "Undo"); tapping it runs onClick and closes the toast. */
  action?: { label: string; onClick: () => void }
}

interface ToastItem extends ToastOptions {
  id: number
  leaving: boolean
}

export interface ToastApi {
  show: (opts: ToastOptions | string) => number
  success: (message: ReactNode, emoji?: string) => number
  error: (message: ReactNode, emoji?: string) => number
  info: (message: ReactNode, emoji?: string) => number
  coin: (amount: number, reason?: ReactNode) => number
  achievement: (title: ReactNode, message?: ReactNode, emoji?: string) => number
  dismiss: (id: number) => void
}

const MAX = 3
let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function snapshot() {
  return items
}

function dismiss(id: number) {
  if (!items.some((t) => t.id === id && !t.leaving)) return
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t))
  emit()
  setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, 260)
}

const DEFAULT_EMOJI: Record<ToastKind, string> = {
  info: '🦉',
  success: '✅',
  error: '😅',
  coin: '🪙',
  achievement: '🏆',
}

function show(opts: ToastOptions | string): number {
  const o: ToastOptions = typeof opts === 'string' ? { message: opts } : opts
  const id = nextId++
  const kind = o.kind ?? 'info'
  const item: ToastItem = { ...o, kind, emoji: o.emoji ?? DEFAULT_EMOJI[kind], id, leaving: false }
  items = [...items.filter((t) => !t.leaving).slice(-(MAX - 1)), item]
  emit()
  if (o.sound !== false) {
    if (kind === 'coin') sfx.coin()
    else if (kind === 'achievement') sfx.achievement()
    else if (kind !== 'error') sfx.pop()
  }
  const duration = o.duration ?? 2800
  if (duration > 0 && typeof window !== 'undefined') window.setTimeout(() => dismiss(id), duration)
  return id
}

/** Imperative toast API - usable from anywhere (a <ToastViewport/> must be mounted). */
export const toast: ToastApi = {
  show,
  success: (message, emoji) => show({ message, emoji, kind: 'success' }),
  error: (message, emoji) => show({ message, emoji, kind: 'error' }),
  info: (message, emoji) => show({ message, emoji, kind: 'info' }),
  coin: (amount, reason) =>
    show({ kind: 'coin', title: `${amount >= 0 ? '+' : ''}${amount} coins`, message: reason, emoji: '🪙' }),
  achievement: (title, message, emoji) => show({ kind: 'achievement', title, message, emoji: emoji ?? '🏆', duration: 4000 }),
  dismiss,
}

/** Hook form of the toast API (stable object). */
export function useToast(): ToastApi {
  return toast
}

/** Renders the toast stack (top centre, just below the TopBar; see --toast-top in ui.css). Mount once. */
export function ToastViewport() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="toast-viewport game-ui" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('toast', `toast--${t.kind}`, t.leaving && 'is-leaving')} onClick={() => dismiss(t.id)}>
          {t.emoji && (
            <span className="toast__emoji" aria-hidden>
              {t.emoji}
            </span>
          )}
          <div className="toast__body">
            {t.title != null && <div className="toast__title">{t.title}</div>}
            {t.message != null && <div className="toast__msg">{t.message}</div>}
          </div>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={(e) => {
                e.stopPropagation()
                const run = t.action!.onClick
                dismiss(t.id)
                run()
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  )
}

/** Convenience wrapper: renders children plus the toast viewport. */
export function ToastProvider({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <ToastViewport />
    </>
  )
}

export default ToastProvider
