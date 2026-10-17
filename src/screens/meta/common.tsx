// Shared bits for the "meta" screens (profile picker, home, shop, trophies,
// parent zone): a ticking clock, date formatting, the player's TopBar, a
// confirm dialog and the storage warning banner.

import { useEffect, useState, type ReactNode } from 'react'
import type { Profile } from '../../types.ts'
import { Button, Modal, TopBar, cx, type ButtonVariant } from '../../components/ui/index.ts'
import { actions, useStorageStatus } from '../../store/appStore.ts'
import { currentStreak, OP_ERROR_MESSAGES, type OpError } from '../../store/profileOps.ts'
import { titleText } from '../../store/catalog.ts'
import { levelForXp } from '../../store/levels.ts'
import { setMuted, sfx } from '../../fx/sound.ts'
import './meta.css'

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Date.now(), refreshed every `intervalMs` and whenever the app comes back to the front. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const t = window.setInterval(tick, intervalMs)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs])
  return now
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/** "12 Oct" (adds the year when it isn't this year). */
export function shortDate(at: number, now: number = Date.now()): string {
  const d = new Date(at)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric'
  try {
    return d.toLocaleDateString(undefined, opts)
  } catch {
    return d.toDateString()
  }
}

export function clockTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Friendly relative time: "just now", "5 min ago", "3 h ago", "yesterday", "12 Oct". */
export function timeAgo(at: number, now: number = Date.now()): string {
  const diff = now - at
  if (diff < MIN) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`
  if (diff < DAY && sameLocalDay(at, now)) return `${Math.floor(diff / HOUR)} h ago`
  if (sameLocalDay(at, now - DAY)) return 'yesterday'
  if (diff < 7 * DAY) return `${Math.max(2, Math.round(diff / DAY))} days ago`
  return shortDate(at, now)
}

/** Kid-friendly message for a failed store action (OP_ERROR_MESSAGES). */
export function opMessage(r: { error?: string; message?: string }): string {
  if (r.message) return r.message
  if (r.error && Object.prototype.hasOwnProperty.call(OP_ERROR_MESSAGES, r.error)) return OP_ERROR_MESSAGES[r.error as OpError]
  return OP_ERROR_MESSAGES.invalid
}

export function plural(n: number, one: string, many?: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : (many ?? `${one}s`)}`
}

// ---------------------------------------------------------------------------
// The player's TopBar (avatar, name, title, level + xp, coins, streak, mute)
// ---------------------------------------------------------------------------

export interface PlayerTopBarProps {
  profile: Profile
  onBack?: () => void
  center?: ReactNode
  right?: ReactNode
  onCoinsClick?: () => void
  onProfileClick?: () => void
}

export function PlayerTopBar({ profile, onBack, center, right, onCoinsClick, onProfileClick }: PlayerTopBarProps) {
  const now = useNow()
  const sound = profile.settings.sound !== false
  // Keep the global sound switch in step with the player's saved setting.
  useEffect(() => {
    setMuted(!sound)
  }, [sound])
  return (
    <TopBar
      avatar={profile.avatar}
      name={profile.name}
      color={profile.color}
      title={titleText(profile.equipped.title)}
      level={levelForXp(profile.xp)}
      xp={profile.xp}
      coins={profile.coins}
      streak={currentStreak(profile, now)}
      muted={!sound}
      onToggleMute={() => {
        const next = !sound
        setMuted(!next)
        actions.setSetting('sound', next)
        if (next) sfx.pop()
      }}
      onBack={onBack}
      center={center}
      right={right}
      onCoinsClick={onCoinsClick}
      onProfileClick={onProfileClick}
    />
  )
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

export interface BannerProps {
  tone?: 'info' | 'warn' | 'error' | 'success' | 'gold'
  icon?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}

export function Banner({ tone = 'info', icon, children, action, className }: BannerProps) {
  return (
    <div className={cx('meta-banner', `meta-banner--${tone}`, action != null && 'meta-banner--action', 'anim-slide-up', className)} role="status">
      {icon != null && (
        <span className="meta-banner__icon" aria-hidden>
          {icon}
        </span>
      )}
      <div className="meta-banner__text">{children}</div>
      {action}
    </div>
  )
}

/** Small warning shown when saving progress fails (e.g. Safari private mode / storage full). */
export function SaveErrorBanner() {
  const { saveError, loadIssue } = useStorageStatus()
  if (!saveError && !loadIssue) return null
  return (
    <Banner tone="warn" icon="💾">
      <b>Progress isn't being saved right now.</b> Ask a parent to open the Parent zone.
    </Banner>
  )
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

export interface ConfirmModalProps {
  open: boolean
  title: ReactNode
  children?: ReactNode
  confirmLabel: ReactNode
  cancelLabel?: ReactNode
  variant?: ButtonVariant
  icon?: ReactNode
  onConfirm: () => void
  onCancel: () => void
  size?: 'sm' | 'md' | 'lg'
}

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'primary',
  icon,
  onConfirm,
  onCancel,
  size = 'sm',
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {/* Never pre-focus a destructive button (a stray Enter must not confirm it). */}
          <Button variant={variant} icon={icon} onClick={onConfirm} data-autofocus={variant === 'danger' ? undefined : true}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="meta-confirm">{children}</div>
    </Modal>
  )
}
