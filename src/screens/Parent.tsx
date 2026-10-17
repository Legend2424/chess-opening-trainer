// Screen 7 — Parent zone (DESIGN.md §6.7)
// Always opens on the PIN pad; locks again on leave, on "Lock" and after a few
// minutes without a touch. Sections: requests, rewards, coins, training,
// players, data (study, backup, PIN, install tip). Safety notices (PIN resets,
// a pending "Forgot the PIN?" request, the clock being moved, install tip) sit
// above every tab.

import { useEffect, useRef, useState } from 'react'
import type { AppData } from '../types.ts'
import { useNav } from '../app/nav.tsx'
import { actions, useAppData } from '../store/appStore.ts'
import { latestPinReset, pendingRedemptions, pinResetReadyAt, resetCooldownUntil } from '../store/profileOps.ts'
import { Button, Tabs, TopBar, toast, type TabItem } from '../components/ui/index.ts'
import { ParentGate } from './meta/ParentGate.tsx'
import { CoinsSection, PlayersSection, RequestsSection, RewardsSection, TrainingSection } from './meta/ParentSections.tsx'
import { DataSection, StorageIssueCard } from './meta/ParentData.tsx'
import { Banner, plural } from './meta/common.tsx'
import { IS_IOS, isStandalone, whenText } from './meta/device.ts'
import './meta/meta.css'
import './Parent.css'

type ParentTab = 'requests' | 'rewards' | 'coins' | 'training' | 'players' | 'data'

/** Re-lock the parent zone after this long without a touch or key press. */
const IDLE_LOCK_MS = 4 * 60 * 1000
const NOTICE_MS = 30 * 24 * 60 * 60 * 1000
const INSTALL_TIP_KEY = 'opening-quest.install-tip-dismissed'

export default function Parent() {
  const nav = useNav()
  const data = useAppData()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ParentTab>('requests')
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const pending = pendingRedemptions(data).length

  // Every tab starts at its top (the scroll area is shared by all tabs).
  const changeTab = (t: ParentTab) => {
    setTab(t)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  // Never leave the parent session open behind us.
  useEffect(() => () => actions.lockParent(), [])

  // Toasts below the tab row while the zone is open (else they cover the middle tabs).
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const place = () => {
      const el = tabsRef.current
      if (el) root.style.setProperty('--toast-top', `${Math.round(el.getBoundingClientRect().bottom + 8)}px`)
    }
    place()
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
      root.style.removeProperty('--toast-top')
    }
  }, [open])

  // Idle auto-lock (an iPad left in the parent zone shouldn't stay open for the kids).
  useEffect(() => {
    if (!open) return
    let last = Date.now()
    const bump = () => {
      last = Date.now()
    }
    window.addEventListener('pointerdown', bump, true)
    window.addEventListener('keydown', bump, true)
    const t = window.setInterval(() => {
      if (Date.now() - last > IDLE_LOCK_MS || document.visibilityState === 'hidden') {
        actions.lockParent()
        setOpen(false)
        toast.info('Parent zone locked.', '🔒')
      }
    }, 5_000)
    return () => {
      window.removeEventListener('pointerdown', bump, true)
      window.removeEventListener('keydown', bump, true)
      window.clearInterval(t)
    }
  }, [open])

  const lock = () => {
    actions.lockParent()
    setOpen(false)
  }

  const tabs: TabItem<ParentTab>[] = [
    { id: 'requests', label: 'Requests', icon: '📬', badge: pending || undefined },
    { id: 'rewards', label: 'Rewards', icon: '🎁' },
    { id: 'coins', label: 'Coins', icon: '🪙' },
    { id: 'training', label: 'Training', icon: '📚' },
    { id: 'players', label: 'Players', icon: '👧' },
    { id: 'data', label: 'Data', icon: '💾' },
  ]

  return (
    <div className="screen game-ui meta-screen parent">
      <TopBar
        onBack={() => nav.back()}
        backLabel="Leave the parent zone"
        center="🔒 Parent zone"
        right={
          open ? (
            <Button size="sm" variant="secondary" icon="🔒" onClick={lock} className="pz-lock">
              Lock
            </Button>
          ) : undefined
        }
      />
      {open ? (
        <>
          <div className="pz-tabs" ref={tabsRef}>
            <Tabs<ParentTab> tabs={tabs} value={tab} onChange={changeTab} ariaLabel="Parent zone sections" />
          </div>
          <div className="meta-scroll" ref={scrollRef}>
            <div className="meta-page pz-page">
              <StorageIssueCard />
              <ParentNotices data={data} onGoTo={changeTab} />
              {tab === 'requests' && <RequestsSection />}
              {tab === 'rewards' && <RewardsSection />}
              {tab === 'coins' && <CoinsSection />}
              {tab === 'training' && <TrainingSection />}
              {tab === 'players' && <PlayersSection />}
              {tab === 'data' && <DataSection />}
            </div>
          </div>
        </>
      ) : (
        <ParentGate onUnlock={() => setOpen(true)} onCancel={() => nav.back()} />
      )}
    </div>
  )
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_TIP_KEY) === '1'
  } catch {
    return false
  }
}

/** Safety notices shown above every tab. */
function ParentNotices({ data, onGoTo }: { data: AppData; onGoTo: (t: ParentTab) => void }) {
  const now = Date.now()
  const parent = data.parent
  const [tipGone, setTipGone] = useState(readDismissed)
  const out = []

  // A "Forgot the PIN?" request is waiting (made WITHOUT the recovery code).
  const ready = pinResetReadyAt(parent)
  if (ready !== null) {
    out.push(
      <Banner
        key="req"
        tone="warn"
        icon="⏳"
        action={
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              actions.cancelPinResetRequest()
              toast.success('The PIN reset request was cancelled.', '🔐')
            }}
          >
            Cancel it
          </Button>
        }
      >
        <b>Someone tapped “Forgot the PIN?” on {whenText(parent.pinResetRequestedAt ?? now)}.</b> Without the recovery code a new PIN can be
        set from {whenText(ready)}. If that wasn't you, cancel it.
      </Banner>,
    )
  }

  // A recent PIN reset the parent hasn't acknowledged.
  const lastReset = latestPinReset(parent)
  if (lastReset !== undefined && now - lastReset < NOTICE_MS && !((parent.pinResetAckAt ?? 0) >= lastReset)) {
    const approved = data.profiles.flatMap((p) =>
      p.redemptions.filter((r) => r.status === 'approved' && (r.resolvedAt ?? 0) >= lastReset).map((r) => ({ p, r })),
    )
    const gifts = data.profiles.flatMap((p) => p.history.filter((h) => h.delta > 0 && h.reason.startsWith('🎁') && h.at >= lastReset).map((h) => ({ p, h })))
    out.push(
      <Banner
        key="reset"
        tone="warn"
        icon="🔐"
        action={
          <Button size="sm" variant="secondary" onClick={() => actions.ackPinReset()}>
            That was me
          </Button>
        }
      >
        <b>The PIN was reset with “Forgot the PIN?” on {whenText(lastReset)}.</b>{' '}
        {approved.length === 0 && gifts.length === 0 ? (
          'Since then no reward was approved and no coins were gifted.'
        ) : (
          <>
            Since then:
            <ul className="pz-since">
              {approved.map(({ p, r }) => (
                <li key={r.id}>
                  ✅ {p.name}: {r.emoji} {r.rewardName} approved {whenText(r.resolvedAt ?? 0)}
                </li>
              ))}
              {gifts.map(({ p, h }) => (
                <li key={`${p.id}${h.at}`}>
                  🎁 {p.name}: +{plural(h.delta, 'coin')} gifted {whenText(h.at)}
                </li>
              ))}
            </ul>
          </>
        )}{' '}
        If it wasn't you, change the PIN in{' '}
        <button type="button" className="pz-link" onClick={() => onGoTo('data')}>
          Data
        </button>{' '}
        and check{' '}
        <button type="button" className="pz-link" onClick={() => onGoTo('coins')}>
          Coins → Recent coins
        </button>
        .
      </Banner>,
    )
  }

  const cooldown = resetCooldownUntil(parent)
  if (now < cooldown) {
    out.push(
      <Banner key="cool" tone="info" icon="🛡️">
        For safety, <b>approving rewards and gifting coins are paused until {whenText(cooldown)}</b> (the PIN was reset without the
        recovery code).
      </Banner>,
    )
  }

  // The device clock was turned back (daily limits and the 60-minute rule trust it).
  const jumps = (parent.clockJumps ?? []).filter((j) => now - j.to < NOTICE_MS)
  if (jumps.length > 0) {
    const j = jumps[jumps.length - 1]
    out.push(
      <Banner
        key="clock"
        tone="warn"
        icon="🕰️"
        action={
          <Button size="sm" variant="secondary" onClick={() => actions.clearClockJumps()}>
            OK
          </Button>
        }
      >
        <b>The iPad's clock was turned back</b>
        {jumps.length > 1 ? ` (${jumps.length} times)` : ''} — last on {whenText(j.to)}, from {whenText(j.from)}. Daily coin limits rely on the
        clock; Screen Time can lock the date setting.
      </Banner>,
    )
  }

  if (!parent.recoveryHash && parent.pin !== null) {
    out.push(
      <Banner
        key="code"
        tone="info"
        icon="🔑"
        action={
          <Button size="sm" variant="secondary" onClick={() => onGoTo('data')}>
            Set it up
          </Button>
        }
      >
        <b>No recovery code yet.</b> With one, a forgotten PIN can be reset right away — without it there is a 24-hour wait.
      </Banner>,
    )
  }

  if (IS_IOS && !isStandalone() && !tipGone) {
    out.push(
      <Banner
        key="install"
        tone="info"
        icon="📲"
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setTipGone(true)
              try {
                localStorage.setItem(INSTALL_TIP_KEY, '1')
              } catch {
                // just hide it for now
              }
            }}
          >
            Got it
          </Button>
        }
      >
        <b>Put Opening Quest on the Home Screen</b> so Safari never clears the kids' progress. The Home Screen app keeps its own,
        separate progress: export a backup here first and import it there —{' '}
        <button type="button" className="pz-link" onClick={() => onGoTo('data')}>
          steps in Data
        </button>
        .
      </Banner>,
    )
  }

  if (out.length === 0) return null
  return <div className="pz-notices">{out}</div>
}
