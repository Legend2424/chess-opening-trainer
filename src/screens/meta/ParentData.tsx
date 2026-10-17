// Parent zone → 💾 Data: study PGN import/revert, backup export/import,
// change PIN, "install on iPad" tip, and the storage problem card.

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { AppData } from '../../types.ts'
import { actions, useAppData, useStorageStatus } from '../../store/appStore.ts'
import { parseBackup } from '../../store/storage.ts'
import { localDateKey } from '../../store/defaults.ts'
import { OPENINGS, STUDY_URL } from '../../data/openings.ts'
import { chapterIdsIn, previewStudy, useRepertoires } from '../../chess/useRepertoires.ts'
import { Button, Card, Chip, Modal, PinPad, toast } from '../../components/ui/index.ts'
import { ConfirmModal, Banner, clockTime, plural, shortDate } from './common.tsx'
import { lockoutText, useLockout } from './ParentGate.tsx'
import { IS_IOS, isStandalone, newRecoveryCode } from './device.ts'

// ---------------------------------------------------------------------------
// Backup export / import
// ---------------------------------------------------------------------------

export function backupFileName(now: number = Date.now()): string {
  return `opening-quest-backup-${localDateKey(now)}.json`
}

/**
 * Export the backup. On touch devices (iPad) with file sharing, opens the share
 * sheet (Save to Files, AirDrop, Mail...); otherwise downloads the file.
 */
export async function exportBackupFile(preferShare = true): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const json = actions.exportBackup()
  const name = backupFileName()
  const blob = new Blob([json], { type: 'application/json' })
  let coarse = false
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches
  } catch {
    coarse = false
  }
  if (preferShare && coarse && typeof File !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    try {
      const file = new File([blob], name, { type: 'application/json' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Opening Quest backup' })
        return 'shared'
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // Anything else: fall back to a normal download.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return 'downloaded'
}

async function runExport(preferShare = true) {
  try {
    const r = await exportBackupFile(preferShare)
    if (r === 'shared') toast.success('Backup shared. Keep it somewhere safe!', '💾')
    else if (r === 'downloaded') toast.success(`Saved ${backupFileName()}`, '💾')
  } catch {
    toast.error('Could not export the backup.')
  }
}

interface PendingImport {
  text: string
  fileName: string
  exportedAt: number | null
  players: string
}

/** Hidden file input + confirm dialog for importing a backup. */
function useBackupImport() {
  const ref = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    let text = ''
    try {
      text = await f.text()
    } catch {
      toast.error("Couldn't read that file.")
      return
    }
    const parsed = parseBackup(text)
    if (!parsed.ok) {
      toast.error(/newer version/i.test(parsed.error) ? `${parsed.error} Reload the app to update it first.` : parsed.error)
      return
    }
    let exportedAt: number | null = null
    try {
      const raw = JSON.parse(text.replace(/^﻿/, '')) as { exportedAt?: unknown }
      if (typeof raw.exportedAt === 'number') exportedAt = raw.exportedAt
    } catch {
      exportedAt = null
    }
    const players = parsed.data.profiles.map((p) => `${p.name} (${plural(p.coins, 'coin')})`).join(', ')
    setPending({ text, fileName: f.name, exportedAt, players })
  }

  const confirm = () => {
    if (!pending) return
    const r = actions.importBackup(pending.text)
    setPending(null)
    if (r.ok) {
      toast.show({
        kind: 'success',
        emoji: '✅',
        message: 'Backup restored!',
        duration: 8000,
        action: actions.hasRestoreUndo()
          ? {
              label: 'Undo',
              onClick: () => {
                const u = actions.undoRestore()
                if (u.ok) toast.success('Restore undone — everything is back as it was.', '↩️')
                else toast.error(u.error ?? 'Could not undo the restore.')
              },
            }
          : undefined,
      })
    } else toast.error(r.error ?? 'That backup could not be restored.')
  }

  const elements = (
    <>
      <input ref={ref} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e)} />
      <ConfirmModal
        open={!!pending}
        title="Restore this backup?"
        confirmLabel="Replace everything"
        variant="danger"
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      >
        {pending && (
          <>
            <p>
              <b>{pending.fileName}</b>
              {pending.exportedAt ? ` · saved ${shortDate(pending.exportedAt)} ${clockTime(pending.exportedAt)}` : ''}
            </p>
            <p>Players: {pending.players || '—'}</p>
            <p>
              ⚠️ This <b>replaces all progress on this iPad</b> with the backup. The parent PIN and recovery code stay the same. You can
              undo it right after.
            </p>
          </>
        )}
      </ConfirmModal>
    </>
  )
  return { open: () => ref.current?.click(), elements }
}

// ---------------------------------------------------------------------------
// Storage problem card (shown above the tabs)
// ---------------------------------------------------------------------------

export function StorageIssueCard() {
  const { loadIssue, saveError } = useStorageStatus()
  const backup = useBackupImport()
  const [confirmFresh, setConfirmFresh] = useState(false)
  if (!loadIssue && !saveError) return null

  if (loadIssue?.kind === 'newer-version') {
    return (
      <Banner tone="warn" icon="⬆️" action={<Button size="sm" variant="primary" onClick={() => window.location.reload()}>Reload app</Button>}>
        <b>This iPad's progress was saved by a newer version of Opening Quest.</b> Reload the app to update — nothing has been lost, and
        saving is paused until then.
      </Banner>
    )
  }

  if (loadIssue) {
    return (
      <Card padding="sm" className="pz-card pz-issue">
        <h3 className="meta-section-title">⚠️ Saved progress couldn't be read</h3>
        <p className="pz-help">
          {loadIssue.error} Saving is paused so nothing gets overwritten. Restore a backup, or start fresh (the unreadable data is kept
          as a rescue copy on this device).
        </p>
        <div className="pz-row-btns">
          <Button variant="primary" icon="📂" onClick={backup.open}>
            Restore a backup
          </Button>
          <Button variant="danger" icon="🌱" onClick={() => setConfirmFresh(true)}>
            Start fresh
          </Button>
        </div>
        {backup.elements}
        <ConfirmModal
          open={confirmFresh}
          title="Start fresh?"
          confirmLabel="Start fresh"
          variant="danger"
          onCancel={() => setConfirmFresh(false)}
          onConfirm={() => {
            setConfirmFresh(false)
            const r = actions.dismissLoadIssue()
            if (r.ok) toast.success('Saving is back on.', '💾')
            else toast.error(r.message ?? 'Saving still fails.')
          }}
        >
          <p>The kids continue from what is on screen now, and saving starts again. The unreadable data stays on this device as a rescue copy.</p>
        </ConfirmModal>
      </Card>
    )
  }

  return (
    <Banner
      tone="warn"
      icon="💾"
      action={
        <Button size="sm" variant="primary" onClick={() => void runExport()}>
          Export backup
        </Button>
      }
    >
      <b>Progress isn't being saved:</b> {saveError} Check that Safari isn't in Private Browsing and the iPad has free space.
    </Banner>
  )
}

// ---------------------------------------------------------------------------
// Data tab
// ---------------------------------------------------------------------------

export function DataSection() {
  return (
    <div className="pz-stack">
      <StudyCard />
      <div className="pz-grid-2">
        <BackupCard />
        <div className="pz-stack">
          <PinCard />
          <InstallCard />
        </div>
      </div>
    </div>
  )
}

/** What importing a study would do, per opening (built with the current training settings). */
interface StudyPreview {
  rows: Array<{ id: string; emoji: string; name: string; before: number; after: number; kept: number; added: number; missing: string[] }>
  /** Some opening would lose lines or chapters. */
  loses: boolean
}

function previewImport(text: string, data: AppData, current: ReturnType<typeof useRepertoires>): StudyPreview {
  const reps = previewStudy(text, data.parent.maxPly, data.parent.enabledExtras)
  let loses = false
  const rows = reps.map((rep) => {
    const o = rep.opening
    const cur = current.byId[o.id]
    const before = new Set((cur?.lines ?? []).map((l) => l.id))
    const after = rep.lines.map((l) => l.id)
    const kept = after.filter((id) => before.has(id)).length
    const found = new Set(rep.chapters.map((c) => c.id))
    const had = new Set((cur?.chapters ?? []).map((c) => c.id))
    const missing = o.chapters.filter((c) => had.has(c.id) && !found.has(c.id)).map((c) => c.title)
    if (missing.length > 0 || after.length < before.size) loses = true
    return { id: o.id, emoji: o.emoji, name: o.name, before: before.size, after: after.length, kept, added: after.length - kept, missing }
  })
  return { rows, loses }
}

function StudyCard() {
  const data = useAppData()
  const reps = useRepertoires()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ text: string; name: string; preview: StudyPreview } | null>(null)
  const [revert, setRevert] = useState(false)
  const imported = data.studyOverride

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    let text = ''
    try {
      text = await f.text()
    } catch {
      toast.error("Couldn't read that file.")
      return
    }
    if (!/\[\w+\s+"/.test(text)) {
      toast.error("That doesn't look like a PGN file.")
      return
    }
    try {
      // The coach's chapters are found by their Lichess chapter ids.
      const ids = chapterIdsIn(text)
      const known = OPENINGS.flatMap((o) => [...o.chapters, ...o.extraChapters]).filter((c) => ids.has(c.id))
      if (known.length === 0) {
        toast.show({
          kind: 'error',
          title: "This file has none of the coach's chapters.",
          message: 'On Lichess, download the WHOLE study (all chapters), not a single chapter.',
          duration: 7000,
        })
        return
      }
      setPending({ text, name: f.name, preview: previewImport(text, data, reps) })
    } catch {
      toast.error("Couldn't read that study file.")
    }
  }

  return (
    <Card padding="sm" className="pz-card">
      <div className="pz-section-head">
        <h2 className="meta-section-title">📖 Study data</h2>
        <Chip tone={imported ? 'blue' : 'gray'}>{imported ? 'Imported' : 'Bundled'}</Chip>
      </div>
      <p className="pz-help">
        {imported ? (
          <>
            Using <b>{imported.name}</b>, imported {shortDate(imported.importedAt)}.
          </>
        ) : (
          <>Using the coach's study that came with the app.</>
        )}{' '}
        To update: open{' '}
        <a href={STUDY_URL} target="_blank" rel="noopener noreferrer">
          the Lichess study
        </a>
        , use its share/export menu to download the PGN with <i>all chapters</i>, then import that file here. Lines that didn't change keep
        their progress.
      </p>
      <div className="pz-study">
        {OPENINGS.map((o) => {
          const rep = reps.byId[o.id]
          const found = rep ? new Set(rep.chapters.map((c) => c.id)) : null
          const missing = found ? o.chapters.filter((c) => !found.has(c.id)) : []
          return (
            <div key={o.id} className="pz-study__row">
              <span className="pz-study__emoji" style={{ background: o.accent }} aria-hidden>
                {o.emoji}
              </span>
              <span className="pz-study__name">{o.name}</span>
              <span className="pz-study__count">
                {rep ? `${plural(rep.lines.length, 'line')} · ${plural(rep.chapters.length, 'chapter')}` : reps.status === 'loading' ? 'Loading…' : '—'}
              </span>
              {rep && rep.lines.length === 0 && <Chip tone="red">No lines found!</Chip>}
              {missing.length > 0 && (
                <Chip tone="gold" title={missing.map((c) => c.title).join(', ')}>
                  {missing.length} missing
                </Chip>
              )}
            </div>
          )
        })}
        {reps.status === 'error' && <Banner tone="error" icon="😕">{reps.error ?? "The study couldn't be loaded."}</Banner>}
      </div>
      <div className="pz-row-btns">
        <Button variant="primary" icon="📥" onClick={() => fileRef.current?.click()}>
          Import PGN file
        </Button>
        {imported && (
          <Button variant="secondary" icon="↩️" onClick={() => setRevert(true)}>
            Revert to bundled
          </Button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        // iOS/iPadOS greys out files whose extension it doesn't know (".pgn")
        // when `accept` is set, so leave it off there: onFile checks the content.
        accept={IS_IOS ? undefined : '.pgn,text/plain'}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onFile(e)}
      />

      <ConfirmModal
        open={!!pending}
        title="Use this study file?"
        confirmLabel={pending?.preview.loses ? 'Import anyway' : 'Import'}
        icon="📥"
        variant={pending?.preview.loses ? 'danger' : 'primary'}
        size="md"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return
          const r = actions.importStudyPgn(pending.text, pending.name)
          setPending(null)
          if (r.ok) toast.success('Study imported! Check the line counts below.', '📖')
          else toast.error(r.message ?? 'That file could not be imported.')
        }}
      >
        {pending && (
          <>
            <p>
              <b>{pending.name}</b> ({Math.round(pending.text.length / 1024)} KB)
            </p>
            <ul className="pz-preview">
              {pending.preview.rows.map((r) => (
                <li key={r.id}>
                  {r.emoji} <b>{r.name}</b>: {r.before} → <b>{r.after}</b> lines ({r.kept} kept, {r.added} new)
                  {r.missing.length > 0 && <> — ⚠️ missing: {r.missing.join(', ')}</>}
                </li>
              ))}
            </ul>
            {pending.preview.loses ? (
              <p>
                ⚠️ <b>Some lines or chapters would disappear</b> — is this the whole study (all chapters)? Their progress is kept and
                comes back with “Revert to bundled”.
              </p>
            ) : (
              <p>Lines that are the same as before keep their progress; new or changed lines start fresh.</p>
            )}
          </>
        )}
      </ConfirmModal>
      <ConfirmModal
        open={revert}
        title="Go back to the bundled study?"
        confirmLabel="Revert"
        onCancel={() => setRevert(false)}
        onConfirm={() => {
          setRevert(false)
          actions.clearStudyOverride()
          toast.success('Back to the bundled study.', '📖')
        }}
      >
        <p>The imported file is removed. Lines that also exist in the bundled study keep their progress.</p>
      </ConfirmModal>
    </Card>
  )
}

function BackupCard() {
  const backup = useBackupImport()
  let coarse = false
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches
  } catch {
    coarse = false
  }
  return (
    <Card padding="sm" className="pz-card">
      <h2 className="meta-section-title">💾 Backup</h2>
      <p className="pz-help">
        Everything — both players, coins, items, progress and rewards — in one file (<code>{backupFileName()}</code>). The PIN is never
        included. Save it to Files or send it to yourself now and then.
      </p>
      <div className="pz-row-btns">
        <Button variant="primary" icon="📤" onClick={() => void runExport(true)}>
          Export backup
        </Button>
        <Button variant="secondary" icon="📂" onClick={backup.open}>
          Import backup
        </Button>
      </div>
      {coarse && (
        <button type="button" className="pz-link" onClick={() => void runExport(false)}>
          Download the file instead of sharing
        </button>
      )}
      {actions.hasRestoreUndo() && (
        <div className="pz-row-btns">
          <Button
            variant="secondary"
            size="sm"
            icon="↩️"
            onClick={() => {
              const u = actions.undoRestore()
              if (u.ok) toast.success('Restore undone — everything is back as it was.', '↩️')
              else toast.error(u.error ?? 'Could not undo the restore.')
            }}
          >
            Undo the last restore
          </Button>
        </div>
      )}
      {backup.elements}
    </Card>
  )
}

function PinCard() {
  const data = useAppData()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const hasCode = !!data.parent.recoveryHash
  return (
    <Card padding="sm" className="pz-card">
      <h2 className="meta-section-title">🔑 Parent PIN</h2>
      <p className="pz-help">The kids need a grown-up for rewards, coins and settings.</p>
      <div className="pz-row-btns">
        <Button variant="secondary" icon="🔑" onClick={() => setOpen(true)}>
          Change PIN
        </Button>
      </div>
      <p className="pz-help">
        <b>Recovery code:</b>{' '}
        {hasCode
          ? '✅ set. If the PIN is forgotten, it sets a new one right away.'
          : 'none yet. Without it, “Forgot the PIN?” makes you wait 24 hours (so a kid can’t simply change it).'}
      </p>
      <div className="pz-row-btns">
        <Button variant="secondary" icon="🧾" onClick={() => setCode(newRecoveryCode())}>
          {hasCode ? 'Make a new recovery code' : 'Make a recovery code'}
        </Button>
      </div>
      <ChangePinModal open={open} onClose={() => setOpen(false)} />
      <ConfirmModal
        open={code !== null}
        title="🔑 Your new recovery code"
        confirmLabel="I wrote it down"
        icon="✓"
        onCancel={() => setCode(null)}
        onConfirm={() => {
          if (!code) return
          const r = actions.setRecoveryCode(code)
          setCode(null)
          if (r.ok) toast.success(hasCode ? 'New recovery code saved — the old one no longer works.' : 'Recovery code saved.', '🔑')
          else toast.error(r.message ?? 'Could not save the code.')
        }}
      >
        <p className="pz-recovery-code num">{code}</p>
        <p>
          Write it down and keep it away from the kids. It only works after you tap <b>I wrote it down</b>
          {hasCode ? ' (then the old code stops working)' : ''}.
        </p>
      </ConfirmModal>
    </Card>
  )
}

function InstallCard() {
  const standalone = isStandalone()
  const fresh = useAppData().profiles.every((p) => p.xp === 0)
  return (
    <Card padding="sm" className="pz-card">
      <h2 className="meta-section-title">📲 Install on iPad</h2>
      {standalone ? (
        <>
          <p className="pz-help">✅ Opening Quest is on the Home Screen — great! Still export a backup now and then.</p>
          {fresh && (
            <p className="pz-help">
              <b>Coming from Safari?</b> The Home Screen app has its own, separate storage: import the backup you exported there
              (Backup → Import backup).
            </p>
          )}
        </>
      ) : (
        <>
          <p className="pz-help">
            On the Home Screen the app opens full-screen and Safari won't clear the kids' progress. <b>But the Home Screen app has its
            own, separate storage</b> — progress made here in Safari does not appear there by itself. So:
          </p>
          <ol className="pz-steps">
            <li>
              <Button size="sm" variant="primary" icon="📤" onClick={() => void runExport(true)}>
                Export a backup
              </Button>
            </li>
            <li>
              In Safari tap <b>Share</b> → <b>Add to Home Screen</b>.
            </li>
            <li>Open the new icon, create a PIN, then Data → Backup → <b>Import backup</b>.</li>
          </ol>
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Change PIN
// ---------------------------------------------------------------------------

type PinStep = 'current' | 'new' | 'confirm'

function ChangePinModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<PinStep>('new')
  const [error, setError] = useState<string | null>(null)
  const current = useRef<string | undefined>(undefined)
  const first = useRef('')
  const timer = useRef(0)
  const [lockMs, refreshLock] = useLockout()

  useEffect(() => {
    if (!open) return
    current.current = undefined
    first.current = ''
    setError(null)
    setStep(actions.isParentUnlocked() ? 'new' : 'current')
  }, [open])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onComplete = (pin: string): boolean => {
    if (step === 'current') {
      if (actions.pinLockoutMs() > 0) {
        refreshLock()
        return false
      }
      if (actions.verifyPin(pin)) {
        current.current = pin
        setError(null)
        setStep('new')
        return true
      }
      refreshLock()
      setError("That's not the current PIN.")
      return false
    }
    if (step === 'new') {
      first.current = pin
      setError(null)
      setStep('confirm')
      return true
    }
    if (pin !== first.current) {
      setError("Those didn't match — type the new PIN again.")
      timer.current = window.setTimeout(() => setStep('new'), 500)
      return false
    }
    const r = actions.setPin(pin, current.current)
    if (r.ok) {
      toast.success('PIN changed! 🔐')
      onClose()
      return true
    }
    setError(r.message ?? 'Could not change the PIN.')
    timer.current = window.setTimeout(() => setStep('current'), 500)
    return false
  }

  const locked = step === 'current' && lockMs > 0
  return (
    <Modal open={open} onClose={onClose} title="Change PIN" size="sm">
      <PinPad
        key={step}
        title={step === 'current' ? 'Current PIN' : step === 'new' ? 'New PIN' : 'New PIN again'}
        subtitle={step === 'current' ? 'First, the PIN you use now.' : step === 'new' ? 'Pick 4 new digits.' : 'Just to be sure.'}
        error={locked ? lockoutText(lockMs) : error}
        disabled={locked}
        onComplete={onComplete}
        onCancel={onClose}
      />
    </Modal>
  )
}
