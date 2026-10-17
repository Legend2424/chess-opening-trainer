// Screen 1 — "Who's playing?" (DESIGN.md §6.1)
// Two huge player cards; tapping one signs that player in and goes home.

import type { CSSProperties } from 'react'
import type { Profile } from '../types.ts'
import { useNav } from '../app/nav.tsx'
import { actions, useAppData, useStorageStatus } from '../store/appStore.ts'
import { currentStreak, pendingRedemptions } from '../store/profileOps.ts'
import { titleText } from '../store/catalog.ts'
import { levelForXp, levelProgress } from '../store/levels.ts'
import { Avatar, CoinBadge, ProgressBar, SpeechBubble, cx } from '../components/ui/index.ts'
import { setMuted, sfx } from '../fx/sound.ts'
import { Banner, useNow } from './meta/common.tsx'
import './ProfileSelect.css'

export default function ProfileSelect() {
  const data = useAppData()
  const nav = useNav()
  const { loadIssue } = useStorageStatus()
  const now = useNow()
  const waiting = pendingRedemptions(data).length

  const pick = (p: Profile) => {
    setMuted(p.settings.sound === false)
    sfx.pop()
    actions.selectProfile(p.id)
    nav.reset({ name: 'home' })
  }

  return (
    <div className="screen game-ui meta-screen ps">
      <div className="meta-scroll">
        <div className="ps__inner">
          <header className="ps__header anim-fade">
            <h1 className="ps__title on-bg">Who's playing?</h1>
            <SpeechBubble className="ps__hoot" speakerSize={48}>
              Hoo-hoo! Tap your card and let's practise some openings! ♟️
            </SpeechBubble>
          </header>

          {loadIssue && (
            <Banner tone="warn" icon="💾" className="ps__banner">
              <b>Saved progress couldn't be read.</b> A parent can fix this in the Parent zone.
            </Banner>
          )}

          <div className={cx('ps__cards', data.profiles.length > 2 && 'ps__cards--many')}>
            {data.profiles.map((p, i) => (
              <PlayerCard key={p.id} profile={p} index={i} now={now} onPick={() => pick(p)} />
            ))}
          </div>

          <button
            type="button"
            className="ps__parent"
            onPointerDown={() => sfx.click()}
            onClick={() => nav.go({ name: 'parent' })}
          >
            <span>Parent zone 🔒</span>
            {waiting > 0 && (
              <span className="ps__parent-badge" aria-label={`${waiting} reward requests waiting`}>
                {waiting} waiting
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function PlayerCard({ profile, index, now, onPick }: { profile: Profile; index: number; now: number; onPick: () => void }) {
  const level = levelForXp(profile.xp)
  const streak = currentStreak(profile, now)
  const style = {
    '--pc-accent': profile.color,
    '--i': index,
  } as CSSProperties
  return (
    <button
      type="button"
      className="ps-card anim-bounce anim-delay"
      style={style}
      onPointerDown={() => sfx.click()}
      onClick={onPick}
      aria-label={`Play as ${profile.name}`}
    >
      <span className="ps-card__glow" aria-hidden />
      <span className="ps-card__top">
        <Avatar emoji={profile.avatar} color={profile.color} size={120} ring float badge={level.emoji} className="ps-card__avatar" />
      </span>
      <span className="ps-card__body">
        <span className="ps-card__name">{profile.name}</span>
        <span className="ps-card__title">{titleText(profile.equipped.title)}</span>
        <span className="ps-card__level">
          <span className="ps-card__level-text">
            {level.emoji} {level.name}
          </span>
          <ProgressBar value={levelProgress(profile.xp)} height={8} className="ps-card__level-bar" />
        </span>
        <span className="ps-card__stats">
          <CoinBadge value={profile.coins} size="lg" animate={false} showDelta={false} />
          {streak > 0 && (
            <span className="streak" title={`${streak} day streak`}>
              <span aria-hidden>🔥</span>
              <span className="num">{streak}</span>
            </span>
          )}
        </span>
        <span className="ps-card__go">Tap to play ▶</span>
      </span>
    </button>
  )
}
