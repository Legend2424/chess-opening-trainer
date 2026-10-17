// Parent zone PIN gate.
//  - No PIN yet: a grown-up check (a multiplication question), then create +
//    confirm a PIN — so the first kid to tap "Parent zone" can't simply set one.
//  - PIN set: enter it (respects the store's lockout after too many wrong tries).
//    "Forgot the PIN?" passes the same grown-up check and sets a new PIN while
//    keeping every player's progress.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { actions, useParentSettings } from '../../store/appStore.ts'
import { Button, Card, PinPad, toast } from '../../components/ui/index.ts'
import { sfx } from '../../fx/sound.ts'

type Step = 'adult' | 'create' | 'confirm' | 'enter'
/** 'new' = first PIN on this device, 'reset' = replacing a forgotten PIN. */
type Mode = 'new' | 'reset'

/** Ticks while a PIN lockout is running; returns the remaining ms (0 = free). */
export function useLockout(): [number, () => void] {
  const [ms, setMs] = useState(() => actions.pinLockoutMs())
  const active = ms > 0
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setMs(actions.pinLockoutMs()), 500)
    return () => window.clearInterval(t)
  }, [active])
  return [ms, () => setMs(actions.pinLockoutMs())]
}

export function lockoutText(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return s >= 60 ? `Too many tries — wait ${Math.ceil(s / 60)} min.` : `Too many tries — wait ${s} s.`
}

/** Replace a forgotten PIN, keeping all data (recorded as parent.pinResetAt). */
function resetForgottenPin(pin: string): { ok: boolean; message?: string } {
  const r = actions.resetPin(pin)
  return r.ok ? { ok: true } : { ok: false, message: r.message ?? 'The new PIN could not be saved.' }
}

export function ParentGate({ onUnlock, onCancel }: { onUnlock: () => void; onCancel: () => void }) {
  const parent = useParentSettings()
  const hasPin = parent.pin !== null
  const [mode, setMode] = useState<Mode>('new')
  const [step, setStep] = useState<Step>(hasPin ? 'enter' : 'adult')
  const [error, setError] = useState<string | null>(null)
  const first = useRef('')
  const [lockMs, refreshLock] = useLockout()
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // A PIN appeared/disappeared underneath us (e.g. a backup import in another tab).
  useEffect(() => {
    if (hasPin && mode === 'new' && step !== 'enter') {
      setStep('enter')
      setError(null)
    }
    if (!hasPin && step === 'enter') {
      setMode('new')
      setStep('adult')
      setError(null)
    }
  }, [hasPin, mode, step])

  const startForgot = () => {
    first.current = ''
    setError(null)
    setMode('reset')
    setStep('adult')
  }
  const backToEnter = () => {
    first.current = ''
    setError(null)
    setMode('new')
    setStep('enter')
  }
  // In the forgot-PIN flow "Cancel" goes back to the PIN pad, otherwise it leaves.
  const cancel = mode === 'reset' ? backToEnter : onCancel

  const onComplete = (pin: string): boolean => {
    if (step === 'enter') {
      if (actions.pinLockoutMs() > 0) {
        refreshLock()
        return false
      }
      if (actions.verifyPin(pin)) {
        sfx.correct()
        setError(null)
        onUnlock()
        return true
      }
      refreshLock()
      setError("That's not the PIN — try again.")
      return false
    }
    if (step === 'create') {
      first.current = pin
      setError(null)
      setStep('confirm')
      return true
    }
    // confirm
    if (pin === first.current) {
      const r = mode === 'reset' ? resetForgottenPin(pin) : actions.setPin(pin)
      if (r.ok) {
        toast.success(mode === 'reset' ? 'New PIN saved — all progress kept. 🤫' : 'PIN saved — keep it secret! 🤫', '🔐')
        onUnlock()
        return true
      }
      setError(r.message ?? 'That PIN could not be saved.')
      return false
    }
    setError("Those PINs didn't match. Let's start again.")
    timer.current = window.setTimeout(() => {
      first.current = ''
      setStep('create')
    }, 500)
    return false
  }

  const locked = step === 'enter' && lockMs > 0
  const title =
    step === 'create'
      ? mode === 'reset'
        ? 'Pick a new PIN'
        : 'Create a parent PIN'
      : step === 'confirm'
        ? 'Type the PIN again'
        : 'Parent zone'
  const subtitle =
    step === 'create'
      ? "Pick 4 digits the kids don't know. You'll need them to open the Parent zone."
      : step === 'confirm'
        ? 'Just to be sure.'
        : 'Enter your 4-digit PIN.'
  const stepNo = step === 'adult' ? 1 : step === 'create' ? 2 : 3

  return (
    <div className="meta-scroll">
      <div className="pz-gate">
        <Card className="pz-gate__card anim-pop" padding="lg">
          <div className="pz-gate__icon" aria-hidden>
            {step === 'enter' ? '🔒' : step === 'adult' ? '🧑‍🏫' : '🔐'}
          </div>
          {step === 'adult' ? (
            <GrownUpCheck
              title={mode === 'reset' ? 'Forgot the PIN?' : 'Grown-ups only'}
              subtitle={
                mode === 'reset'
                  ? 'Answer this to pick a new PIN. Everyone’s progress is kept.'
                  : 'Setting up the Parent zone? Answer this first.'
              }
              onPass={() => {
                setError(null)
                setStep('create')
              }}
              onCancel={cancel}
            />
          ) : (
            <PinPad
              key={`${mode}-${step}`}
              title={title}
              subtitle={subtitle}
              error={locked ? lockoutText(lockMs) : error}
              disabled={locked}
              onComplete={onComplete}
              onCancel={cancel}
            />
          )}
          {step === 'enter' ? (
            <>
              <p className="pz-gate__note">Grown-ups only: rewards, coins, settings and backups live here.</p>
              <button type="button" className="pz-gate__forgot" onClick={startForgot}>
                Forgot the PIN?
              </button>
            </>
          ) : (
            <p className="pz-gate__note">Step {stepNo} of 3</p>
          )}
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grown-up check (a "parental gate"): a 2-digit × 2-digit multiplication typed
// on the keyboard. A wrong answer brings a new question.
// ---------------------------------------------------------------------------

function pick(lo: number, hi: number, skip: (n: number) => boolean): number {
  for (;;) {
    const n = lo + Math.floor(Math.random() * (hi - lo + 1))
    if (!skip(n)) return n
  }
}

function newQuestion(): [number, number] {
  const easy = (n: number) => n % 10 === 0 || n % 11 === 0
  return [pick(12, 29, easy), pick(13, 39, easy)]
}

function GrownUpCheck({ title, subtitle, onPass, onCancel }: { title: string; subtitle: string; onPass: () => void; onCancel: () => void }) {
  const [q, setQ] = useState<[number, number]>(newQuestion)
  const [answer, setAnswer] = useState('')
  const [wrong, setWrong] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [q])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!answer.trim()) return
    if (Number(answer.trim()) === q[0] * q[1]) {
      sfx.correct()
      onPass()
      return
    }
    sfx.wrong()
    setWrong(true)
    setAnswer('')
    setQ(newQuestion())
  }

  return (
    <form className="pz-adult" onSubmit={submit} noValidate>
      <h2 className="pz-adult__title">{title}</h2>
      <p className="pz-adult__sub">{subtitle}</p>
      <label className="pz-adult__q">
        <span className="pz-adult__sum">
          {q[0]} × {q[1]} =
        </span>
        <input
          ref={input}
          className="pz-input pz-adult__input"
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value.replace(/\D/g, '').slice(0, 5))
            setWrong(false)
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label={`What is ${q[0]} times ${q[1]}?`}
          aria-invalid={wrong || undefined}
        />
      </label>
      <p className={wrong ? 'pz-adult__error' : 'pz-adult__error is-hidden'} role="alert">
        {wrong ? 'Not quite — here’s a new one.' : ' '}
      </p>
      <div className="pz-adult__btns">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon="✓" disabled={!answer.trim()}>
          Check
        </Button>
      </div>
    </form>
  )
}
