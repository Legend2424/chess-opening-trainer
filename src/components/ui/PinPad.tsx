import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { sfx } from '../../fx/sound.ts'
import { cx } from './cx.ts'

export interface PinPadProps {
  /** Number of digits (default 4). */
  length?: number
  title?: ReactNode
  subtitle?: ReactNode
  /**
   * Called with the full PIN. Return `false` (or a Promise resolving to false)
   * to show the error shake and clear the dots.
   */
  onComplete: (pin: string) => boolean | void | Promise<boolean | void>
  /** Error text shown under the dots (e.g. "That's not it - try again"). */
  error?: ReactNode
  /** Shows a "Cancel" key in the bottom-left corner. */
  onCancel?: () => void
  disabled?: boolean
  /** Change this value to clear the entered digits from outside. */
  resetKey?: number | string
  className?: string
}

/** How long the red shake shows before the dots clear. */
const FAIL_CLEAR_MS = 350

/**
 * 4-digit keypad for the parent zone. Also accepts the physical keyboard.
 * A rejected PIN shakes the dots red, clears them, and the red state lasts
 * only until the next key press (or a `resetKey` change).
 */
export function PinPad({ length = 4, title, subtitle, onComplete, error, onCancel, disabled, resetKey, className }: PinPadProps) {
  const [digits, setDigitsState] = useState('')
  const digitsRef = useRef('')
  const busyRef = useRef(false)
  /** Remount key for the dots row: bumping it replays the shake animation. */
  const [shake, setShake] = useState(0)
  /** Red error look on the dots (the last attempt was rejected). */
  const [failed, setFailed] = useState(false)
  const clearTimer = useRef(0)
  const mounted = useRef(true)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const setDigits = useCallback((v: string) => {
    digitsRef.current = v
    setDigitsState(v)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      window.clearTimeout(clearTimer.current)
    }
  }, [])

  useEffect(() => {
    window.clearTimeout(clearTimer.current)
    busyRef.current = false
    setFailed(false)
    setDigits('')
  }, [resetKey, setDigits])

  const fail = useCallback(() => {
    sfx.wrong()
    setShake((s) => s + 1)
    setFailed(true)
    // Stay busy until the dots are cleared, so a fast next digit is not wiped.
    window.clearTimeout(clearTimer.current)
    clearTimer.current = window.setTimeout(() => {
      setDigits('')
      busyRef.current = false
    }, FAIL_CLEAR_MS)
  }, [setDigits])

  const press = useCallback(
    (d: string) => {
      if (disabled || busyRef.current) return
      const cur = digitsRef.current
      if (cur.length >= length) return
      setFailed(false)
      const next = cur + d
      setDigits(next)
      if (next.length === length) {
        busyRef.current = true
        window.setTimeout(async () => {
          let ok = true
          try {
            ok = (await onCompleteRef.current(next)) !== false
          } catch {
            ok = false
          }
          if (!mounted.current) return
          if (ok) busyRef.current = false
          else fail()
        }, 120)
      }
    },
    [disabled, length, fail, setDigits],
  )

  const back = useCallback(() => {
    if (disabled || busyRef.current) return
    setFailed(false)
    setDigits(digitsRef.current.slice(0, -1))
  }, [disabled, setDigits])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        press(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, back])

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  return (
    <div className={cx('pinpad', 'game-ui', className)}>
      {title != null && <div className="pinpad__title">{title}</div>}
      {subtitle != null && <div className="pinpad__subtitle">{subtitle}</div>}
      <div
        key={shake}
        className={cx('pinpad__dots', failed && 'is-error')}
        aria-label={`${digits.length} of ${length} digits entered`}
      >
        {Array.from({ length }, (_, i) => (
          <span key={i} className={cx('pinpad__dot', i < digits.length && 'is-filled')} />
        ))}
      </div>
      <div className="pinpad__error" role="alert">
        {error}
      </div>
      <div className="pinpad__keys">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className="pinpad__key"
            disabled={disabled}
            onPointerDown={() => sfx.click()}
            onClick={() => press(k)}
          >
            {k}
          </button>
        ))}
        {onCancel ? (
          <button type="button" className="pinpad__key pinpad__key--fn" onClick={onCancel} aria-label="Cancel">
            ✕
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="pinpad__key" disabled={disabled} onPointerDown={() => sfx.click()} onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="pinpad__key pinpad__key--fn"
          disabled={disabled || digits.length === 0}
          onPointerDown={() => sfx.click()}
          onClick={back}
          aria-label="Delete"
        >
          ⌫
        </button>
      </div>
    </div>
  )
}

export default PinPad
