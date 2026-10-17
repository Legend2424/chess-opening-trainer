// Parent zone PIN gate.
//  - No PIN yet: a grown-up check (a multiplication question), then create +
//    confirm a PIN — so the first kid to tap "Parent zone" can't simply set one.
//    Then a RECOVERY CODE is shown once ("write it down").
//  - PIN set: enter it (respects the store's lockout after too many wrong tries,
//    which survives a reload). "Forgot the PIN?" is hidden while locked out.
//  - Forgot the PIN?
//      · with the recovery code: set a new PIN right away;
//      · without it: the grown-up check (with a growing wait after wrong
//        answers) only STARTS a 24-hour wait — anyone who opens the Parent zone
//        with the PIN meanwhile sees the request and can cancel it. After such
//        a reset, approving rewards and gifting coins pause for a day.
//    Every reset is recorded and shown in the Parent zone and under the PIN pad.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { actions, useParentSettings } from '../../store/appStore.ts'
import { latestPinReset, pinResetReadyAt } from '../../store/profileOps.ts'
import { Button, Card, PinPad, toast } from '../../components/ui/index.ts'
import { sfx } from '../../fx/sound.ts'
import { IS_IOS, isStandalone, newRecoveryCode, whenText } from './device.ts'

type Step = 'adult' | 'create' | 'confirm' | 'enter' | 'code' | 'wait' | 'show-code'
/** 'new' = first PIN on this device; 'reset-code' / 'reset-wait' = replacing a forgotten PIN. */
type Mode = 'new' | 'reset-code' | 'reset-wait'

const NOTICE_MS = 30 * 24 * 60 * 60 * 1000

/** Ticks while a lockout is running; returns the remaining ms (0 = free). */
function useTicking(read: () => number): [number, () => void] {
  const [ms, setMs] = useState(read)
  const active = ms > 0
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setMs(read()), 500)
    return () => window.clearInterval(t)
  }, [active, read])
  return [ms, () => setMs(read())]
}

const pinLockRead = () => actions.pinLockoutMs()
const adultLockRead = () => actions.adultCheckLockoutMs()

/** Ticks while a PIN lockout is running; returns the remaining ms (0 = free). */
export function useLockout(): [number, () => void] {
  return useTicking(pinLockRead)
}

function waitText(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`
}

export function lockoutText(ms: number): string {
  return `Too many tries — wait ${waitText(ms)}.`
}

export function ParentGate({ onUnlock, onCancel }: { onUnlock: () => void; onCancel: () => void }) {
  const parent = useParentSettings()
  const hasPin = parent.pin !== null
  const [mode, setMode] = useState<Mode>('new')
  const [step, setStep] = useState<Step>(hasPin ? 'enter' : 'adult')
  const [error, setError] = useState<string | null>(null)
  const first = useRef('')
  const code = useRef('')
  const [shownCode, setShownCode] = useState('')
  const [lockMs, refreshLock] = useLockout()
  const timer = useRef(0)
  /** This gate itself just saved the PIN (the effect below must not treat it as "a PIN appeared"). */
  const savedHere = useRef(false)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // A PIN appeared/disappeared underneath us (e.g. a backup import in another tab).
  useEffect(() => {
    if (hasPin && mode === 'new' && step !== 'enter' && step !== 'show-code' && !savedHere.current) {
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
    code.current = ''
    setError(null)
    if (actions.hasRecoveryCode()) {
      setMode('reset-code')
      setStep('code')
    } else {
      setMode('reset-wait')
      setStep('adult')
    }
  }
  const backToEnter = () => {
    first.current = ''
    code.current = ''
    setError(null)
    setMode('new')
    setStep('enter')
  }
  // In the forgot-PIN flow "Cancel" goes back to the PIN pad, otherwise it leaves.
  const cancel = mode === 'new' ? onCancel : backToEnter

  /** Grown-up check passed. */
  const adultPassed = () => {
    setError(null)
    if (mode !== 'reset-wait') {
      setStep('create')
      return
    }
    const ready = pinResetReadyAt(parent)
    if (ready !== null && Date.now() >= ready) {
      setStep('create')
      return
    }
    if (ready === null) actions.requestPinReset()
    setStep('wait')
  }

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
      // The store update re-renders before this handler's own state updates land.
      savedHere.current = true
      const r =
        mode === 'reset-code'
          ? actions.resetPinWithCode(code.current, pin)
          : mode === 'reset-wait'
            ? actions.resetPinAfterWait(pin)
            : actions.setPin(pin)
      if (!r.ok) {
        savedHere.current = false
        setError(r.message ?? 'That PIN could not be saved.')
        return false
      }
      if (mode === 'new') {
        // First PIN: hand out a recovery code right away (shown once).
        const c = newRecoveryCode()
        if (actions.setRecoveryCode(c).ok) {
          setShownCode(c)
          setStep('show-code')
          toast.success('PIN saved — keep it secret! 🤫', '🔐')
          return true
        }
        toast.success('PIN saved — keep it secret! 🤫', '🔐')
      } else if (mode === 'reset-wait') {
        toast.show({
          kind: 'success',
          emoji: '🔐',
          title: 'New PIN saved — all progress kept.',
          message: 'For safety, approving rewards and gifting coins pause for 24 hours.',
          duration: 6000,
        })
      } else toast.success('New PIN saved — all progress kept. 🤫', '🔐')
      onUnlock()
      return true
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
      ? mode === 'new'
        ? 'Create a parent PIN'
        : 'Pick a new PIN'
      : step === 'confirm'
        ? 'Type the PIN again'
        : 'Parent zone'
  const subtitle =
    step === 'create'
      ? "Pick 4 digits the kids don't know. You'll need them to open the Parent zone."
      : step === 'confirm'
        ? 'Just to be sure.'
        : 'Enter your 4-digit PIN.'
  const stepNo = step === 'adult' || step === 'code' || step === 'wait' ? 1 : step === 'create' ? 2 : 3
  const lastReset = latestPinReset(parent)
  const showReset = step === 'enter' && lastReset !== undefined && Date.now() - lastReset < NOTICE_MS && !((parent.pinResetAckAt ?? 0) >= lastReset)

  let body
  if (step === 'adult') {
    body = (
      <GrownUpCheck
        title={mode === 'new' ? 'Grown-ups only' : 'Forgot the PIN?'}
        subtitle={
          mode === 'new'
            ? 'Setting up the Parent zone? Answer this first.'
            : 'Answer this to ask for a new PIN. Everyone’s progress is kept.'
        }
        onPass={adultPassed}
        onCancel={cancel}
      />
    )
  } else if (step === 'code') {
    body = (
      <RecoveryCodeForm
        onPass={(c) => {
          code.current = c
          setError(null)
          setStep('create')
        }}
        onLost={() => {
          setMode('reset-wait')
          setStep('adult')
        }}
        onCancel={cancel}
      />
    )
  } else if (step === 'wait') {
    const ready = pinResetReadyAt(parent)
    body = (
      <div className="pz-adult">
        <h2 className="pz-adult__title">New PIN requested ⏳</h2>
        <p className="pz-adult__sub">
          Without the recovery code, a new PIN can be set <b>24 hours after asking</b>
          {ready !== null ? (
            <>
              {' '}
              — from <b>{whenText(ready)}</b>
            </>
          ) : null}
          . Come back then and tap “Forgot the PIN?” again.
        </p>
        <p className="pz-adult__sub">
          This stops a kid from changing the PIN. If a grown-up opens the Parent zone with the PIN before then, they'll see this request
          and can cancel it.
        </p>
        <div className="pz-adult__btns">
          <Button type="button" variant="primary" onClick={backToEnter} data-autofocus>
            OK
          </Button>
        </div>
      </div>
    )
  } else if (step === 'show-code') {
    body = (
      <div className="pz-adult">
        <h2 className="pz-adult__title">🔑 Your recovery code</h2>
        <p className="pz-recovery-code num" aria-label={`Recovery code ${shownCode.split('').join(' ')}`}>
          {shownCode}
        </p>
        <p className="pz-adult__sub">
          <b>Write it down now</b> and keep it away from the kids. If you ever forget the PIN, this code lets you set a new one straight
          away. (You can make a new code later in Data → Parent PIN.)
        </p>
        {IS_IOS && !isStandalone() && (
          <p className="pz-adult__sub">
            📲 Tip: put Opening Quest on the Home Screen soon (Data → Install on iPad tells you how — the Home Screen app keeps its own
            progress, so set it up before the kids play a lot).
          </p>
        )}
        <div className="pz-adult__btns">
          <Button type="button" variant="primary" icon="✓" onClick={onUnlock} data-autofocus>
            I wrote it down
          </Button>
        </div>
      </div>
    )
  } else {
    body = (
      <PinPad
        key={`${mode}-${step}`}
        title={title}
        subtitle={subtitle}
        error={locked ? lockoutText(lockMs) : error}
        disabled={locked}
        onComplete={onComplete}
        onCancel={cancel}
      />
    )
  }

  return (
    <div className="meta-scroll">
      <div className="pz-gate">
        <Card className="pz-gate__card anim-pop" padding="lg">
          <div className="pz-gate__icon" aria-hidden>
            {step === 'enter' ? '🔒' : step === 'adult' ? '🧑‍🏫' : step === 'wait' ? '⏳' : '🔐'}
          </div>
          {body}
          {step === 'enter' ? (
            <>
              <p className="pz-gate__note">Grown-ups only: rewards, coins, settings and backups live here.</p>
              {showReset && lastReset !== undefined && (
                <p className="pz-gate__note pz-gate__warn">🔐 The PIN was reset with “Forgot the PIN?” on {whenText(lastReset)}.</p>
              )}
              {locked ? (
                <p className="pz-gate__note">Forgot the PIN? Wait for the timer first.</p>
              ) : (
                <button type="button" className="pz-gate__forgot" onClick={startForgot}>
                  Forgot the PIN?
                </button>
              )}
            </>
          ) : step === 'show-code' || step === 'wait' ? null : (
            <p className="pz-gate__note">Step {stepNo} of 3</p>
          )}
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grown-up check (a "parental gate"): a 2-digit × 2-digit multiplication typed
// on the keyboard. A wrong answer brings a new question; from the second wrong
// answer on there is a growing wait (it survives a reload).
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
  const [waitMs, refreshWait] = useTicking(adultLockRead)
  const waiting = waitMs > 0
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!waiting) input.current?.focus()
  }, [q, waiting])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!answer.trim() || actions.adultCheckLockoutMs() > 0) return
    const ok = Number(answer.trim()) === q[0] * q[1]
    actions.adultCheckAnswered(ok)
    if (ok) {
      sfx.correct()
      onPass()
      return
    }
    sfx.wrong()
    setWrong(true)
    setAnswer('')
    setQ(newQuestion())
    refreshWait()
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
          disabled={waiting}
          aria-label={`What is ${q[0]} times ${q[1]}?`}
          aria-invalid={wrong || undefined}
        />
      </label>
      <p className={wrong || waiting ? 'pz-adult__error' : 'pz-adult__error is-hidden'} role="alert">
        {waiting ? `Not quite — try again in ${waitText(waitMs)}.` : wrong ? 'Not quite — here’s a new one.' : ' '}
      </p>
      <div className="pz-adult__btns">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon="✓" disabled={!answer.trim() || waiting}>
          Check
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Recovery code
// ---------------------------------------------------------------------------

function RecoveryCodeForm({ onPass, onLost, onCancel }: { onPass: (code: string) => void; onLost: () => void; onCancel: () => void }) {
  const [value, setValue] = useState('')
  const [wrong, setWrong] = useState(false)
  // Wrong codes use the same growing wait as the grown-up question.
  const [waitMs, refreshWait] = useTicking(adultLockRead)
  const waiting = waitMs > 0
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!value.trim() || actions.adultCheckLockoutMs() > 0) return
    if (actions.checkRecoveryCode(value)) {
      actions.adultCheckAnswered(true)
      sfx.correct()
      onPass(value)
      return
    }
    actions.adultCheckAnswered(false)
    sfx.wrong()
    setWrong(true)
    refreshWait()
  }
  return (
    <form className="pz-adult" onSubmit={submit} noValidate>
      <h2 className="pz-adult__title">Forgot the PIN?</h2>
      <p className="pz-adult__sub">Type the recovery code you wrote down when the PIN was made. Everyone’s progress is kept.</p>
      <input
        className="pz-input pz-recovery-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value.toUpperCase().slice(0, 12))
          setWrong(false)
        }}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="ABCD-EFGH"
        disabled={waiting}
        aria-label="Recovery code"
        aria-invalid={wrong || undefined}
        autoFocus
      />
      <p className={wrong || waiting ? 'pz-adult__error' : 'pz-adult__error is-hidden'} role="alert">
        {waiting ? `That code isn't right — try again in ${waitText(waitMs)}.` : wrong ? "That code isn't right." : ' '}
      </p>
      <div className="pz-adult__btns">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon="✓" disabled={!value.trim() || waiting}>
          Check
        </Button>
      </div>
      <button type="button" className="pz-gate__forgot" onClick={onLost}>
        I lost the recovery code
      </button>
    </form>
  )
}
