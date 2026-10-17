// Screen 7 — Parent zone (DESIGN.md §6.7)
// Always opens on the PIN pad; locks again on leave, on "Lock" and after a few
// minutes without a touch. Sections: requests, rewards, coins, training,
// players, data (study, backup, PIN, install tip).

import { useEffect, useRef, useState } from 'react'
import { useNav } from '../app/nav.tsx'
import { actions, useAppData } from '../store/appStore.ts'
import { pendingRedemptions } from '../store/profileOps.ts'
import { Button, Tabs, TopBar, toast, type TabItem } from '../components/ui/index.ts'
import { ParentGate } from './meta/ParentGate.tsx'
import { CoinsSection, PlayersSection, RequestsSection, RewardsSection, TrainingSection } from './meta/ParentSections.tsx'
import { DataSection, StorageIssueCard } from './meta/ParentData.tsx'
import { Banner } from './meta/common.tsx'
import './meta/meta.css'
import './Parent.css'

type ParentTab = 'requests' | 'rewards' | 'coins' | 'training' | 'players' | 'data'

/** Re-lock the parent zone after this long without a touch or key press. */
const IDLE_LOCK_MS = 4 * 60 * 1000

export default function Parent() {
  const nav = useNav()
  const data = useAppData()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ParentTab>('requests')
  const scrollRef = useRef<HTMLDivElement>(null)
  const pending = pendingRedemptions(data).length

  // Every tab starts at its top (the scroll area is shared by all tabs).
  const changeTab = (t: ParentTab) => {
    setTab(t)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  // Never leave the parent session open behind us.
  useEffect(() => () => actions.lockParent(), [])

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
          <div className="pz-tabs">
            <Tabs<ParentTab> tabs={tabs} value={tab} onChange={changeTab} ariaLabel="Parent zone sections" />
          </div>
          <div className="meta-scroll" ref={scrollRef}>
            <div className="meta-page pz-page">
              <StorageIssueCard />
              {tab === 'requests' && <PinResetNotice at={data.parent.pinResetAt} />}
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

/** Shown for 30 days after "Forgot the PIN?" was used, so a sneaky reset doesn't go unnoticed. */
function PinResetNotice({ at }: { at?: number }) {
  if (!at || Date.now() - at > 30 * 24 * 60 * 60 * 1000) return null
  const when = new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <Banner tone="warn" icon="🔐">
      <b>The PIN was reset with "Forgot the PIN?" on {when}.</b> If that wasn't you, check the coin history and change the PIN in Data.
    </Banner>
  )
}
