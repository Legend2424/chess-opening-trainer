// Screen 2 — Home (DESIGN.md §6.2)
// Greeting from Hoot, daily goal ring + streak, the three opening cards and the
// bottom bar (Shop · Trophies · Play · Switch player).

import { useState, type CSSProperties, type ReactNode } from 'react'
import type { OpeningDef, Redemption } from '../types.ts'
import { useNav } from '../app/nav.tsx'
import { actions, useActiveProfile, useParentSettings, useStorageStatus } from '../store/appStore.ts'
import { currentStreak, dailyGoalProgress } from '../store/profileOps.ts'
import { OPENINGS } from '../data/openings.ts'
import { useRepertoires } from '../chess/useRepertoires.ts'
import { openingProgress } from '../chess/scheduler.ts'
import { Button, Card, Chip, ProgressBar, ProgressRing, SpeechBubble, cx } from '../components/ui/index.ts'
import { Banner, PlayerTopBar, SaveErrorBanner, plural, useNow } from './meta/common.tsx'
import './Home.css'

const DAY_MS = 24 * 60 * 60 * 1000

// Answered requests the kid already tapped "OK" on (this device only; a
// convenience — if storage is unavailable the banner simply expires after a day).
const SEEN_KEY = 'opening-quest.home-seen-answers'

function readSeen(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeSeen(ids: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-40)))
  } catch {
    // best effort
  }
}

/** Remounting the screen retries loading the opening lines after a failure. */
export default function Home() {
  const [attempt, setAttempt] = useState(0)
  return <HomeView key={attempt} onRetry={() => setAttempt((a) => a + 1)} />
}

function HomeView({ onRetry }: { onRetry: () => void }) {
  const profile = useActiveProfile()
  const parent = useParentSettings()
  const nav = useNav()
  const now = useNow()
  const repState = useRepertoires()
  const storage = useStorageStatus()
  const [seen, setSeen] = useState<string[]>(readSeen)
  if (!profile) return null

  const goal = dailyGoalProgress(profile, now, parent.dailyGoalLines)
  const streak = currentStreak(profile, now)

  // Totals across openings for Hoot's message.
  let dueTotal = 0
  const progress: Record<string, ReturnType<typeof openingProgress> | undefined> = {}
  for (const rep of repState.reps) {
    const p = openingProgress(rep.lines, profile.lineStats, now)
    progress[rep.opening.id] = p
    dueTotal += p.due
  }

  const pending = profile.redemptions.filter((r) => r.status === 'pending')
  // Newest answer from the last day that the kid hasn't tapped "OK" on yet.
  const answer = profile.redemptions
    .filter((r) => r.status !== 'pending' && r.resolvedAt !== undefined && now - r.resolvedAt < DAY_MS && !seen.includes(r.id))
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))[0]

  const switchPlayer = () => {
    actions.signOut()
    nav.reset({ name: 'profiles' })
  }

  const dismissAnswer = (id: string) => {
    const next = [...seen.filter((x) => x !== id), id]
    setSeen(next)
    writeSeen(next)
  }

  // At most ONE banner, so the opening cards always fit: storage problem >
  // lines failed to load > a parent's answer (until "OK") > waiting requests.
  let notice: ReactNode = null
  if (storage.saveError || storage.loadIssue) notice = <SaveErrorBanner />
  else if (repState.status === 'error')
    notice = (
      <Banner
        tone="error"
        icon="😕"
        action={
          <Button size="sm" variant="primary" icon="🔄" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        The opening lines didn't load. Check the internet, then try again.
      </Banner>
    )
  else if (answer)
    notice = (
      <Banner
        key={answer.id}
        tone={answer.status === 'approved' ? 'success' : 'info'}
        icon={answer.status === 'approved' ? '🎉' : '↩️'}
        action={
          <Button size="sm" variant="secondary" onClick={() => dismissAnswer(answer.id)} aria-label="OK, got it">
            OK 👍
          </Button>
        }
      >
        {answer.status === 'approved' ? (
          <>
            <b>Yes!</b> A parent said yes to your {answer.emoji} {answer.rewardName}!
          </>
        ) : (
          <>
            Not this time for the {answer.rewardName} — your {answer.cost.toLocaleString()} coins are back in your pocket.
          </>
        )}
      </Banner>
    )
  else if (pending.length > 0)
    notice = (
      <Banner tone="gold" icon="⏳">
        Waiting for a parent to approve your {listNames(pending)}.
      </Banner>
    )

  return (
    <div className="screen game-ui meta-screen home">
      <PlayerTopBar
        profile={profile}
        onCoinsClick={() => nav.go({ name: 'shop' })}
        onProfileClick={() => nav.go({ name: 'trophies' })}
      />
      <div className="meta-scroll home__scroll">
        <div className={cx('home__inner', notice != null && 'has-notice')}>
          {notice}

          <section className="home__hero">
            <SpeechBubble className="home__hoot" speakerSize={64} animateKey={profile.id}>
              <span className="home__hello">{greeting(profile.name, new Date(now).getHours())}</span>
              <span className="home__nudge">{nudge(goal, dueTotal)}</span>
            </SpeechBubble>
            <GoalCard done={goal.done} goal={goal.goal} met={goal.met} streak={streak} />
          </section>

          <section className="home__openings" aria-label="Your openings">
            {OPENINGS.map((o, i) => (
              <OpeningCard
                key={o.id}
                opening={o}
                index={i}
                status={repState.status}
                progress={progress[o.id]}
                chapters={repState.byId[o.id]?.chapters.length}
                onOpen={() => nav.go({ name: 'opening', openingId: o.id })}
              />
            ))}
          </section>
        </div>
      </div>

      <nav className="home__bar" aria-label="More">
        <Button variant="gold" size="lg" icon="🛒" className="home__bar-btn" onClick={() => nav.go({ name: 'shop' })}>
          Shop
        </Button>
        <Button variant="secondary" size="lg" icon="🏆" className="home__bar-btn" onClick={() => nav.go({ name: 'trophies' })}>
          Trophies
        </Button>
        <Button variant="info" size="lg" icon="🤖" className="home__bar-btn" onClick={() => nav.go({ name: 'play' })}>
          Play
        </Button>
        <Button variant="ghost" size="lg" icon="🔄" className="home__bar-btn home__bar-btn--switch" onClick={() => switchPlayer()}>
          Switch player
        </Button>
      </nav>
    </div>
  )
}

// ---------------------------------------------------------------------------

function listNames(list: Redemption[]): string {
  const names = list.map((r) => r.rewardName)
  const unique = Array.from(new Set(names))
  if (unique.length === 1) return list.length > 1 ? `${list.length} × ${unique[0]}` : unique[0]
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
}

function greeting(name: string, hour: number): string {
  if (hour < 5) return `Hello, night owl ${name}! 🌙`
  if (hour < 12) return `Good morning, ${name}! ☀️`
  if (hour < 17) return `Good afternoon, ${name}! 👋`
  if (hour < 21) return `Good evening, ${name}! 🌆`
  return `Hello, night owl ${name}! 🌙`
}

function nudge(goal: { done: number; goal: number; met: boolean }, due: number): string {
  if (goal.met) return "You reached today's goal — amazing! Extra practice makes you even stronger. 💪"
  // The goal was lowered after these lines: the next NEW line claims it.
  if (goal.done >= goal.goal) return "Play 1 new line to claim today's goal bonus! 🎯"
  if (due > 0) return `${plural(due, 'line')} would love a quick review. Ready to practise?`
  if (goal.done > 0) return `Just ${plural(goal.goal - goal.done, 'more line')} to reach today's goal. You can do it!`
  return 'Ready to practise? Pick an opening below!'
}

function GoalCard({ done, goal, met, streak }: { done: number; goal: number; met: boolean; streak: number }) {
  return (
    <Card className="home-goal anim-pop" padding="sm">
      <ProgressRing
        value={goal > 0 ? done / goal : 0}
        size={92}
        color={met ? ['#4ade80', '#16a34a'] : ['#ffd24a', '#f59e0b']}
        trackColor="rgba(245, 158, 11, 0.16)"
        ariaLabel={`${done} of ${goal} lines today`}
      >
        <span className="home-goal__count">
          {met ? '🎯' : (
            <>
              {Math.min(done, goal)}
              <small>/{goal}</small>
            </>
          )}
        </span>
      </ProgressRing>
      <div className="home-goal__text">
        <span className="home-goal__label">Today's goal</span>
        <span className="home-goal__sub">
          {met ? 'Done! 🎉' : done >= goal ? 'Play 1 new line to claim it!' : `${done} of ${plural(goal, 'line')}`}
        </span>
        <span className={streak > 0 ? 'home-goal__streak' : 'home-goal__streak is-off'}>
          🔥 {streak > 0 ? `${streak}-day streak` : 'Start a streak!'}
        </span>
      </div>
    </Card>
  )
}

interface OpeningCardProps {
  opening: OpeningDef
  index: number
  status: 'loading' | 'ready' | 'error'
  progress?: { total: number; seen: number; mastered: number; due: number; percentMastered: number }
  chapters?: number
  onOpen: () => void
}

function OpeningCard({ opening, index, status, progress, chapters, onOpen }: OpeningCardProps) {
  const style = { '--op-accent': opening.accent, '--i': index } as CSSProperties
  const pct = progress?.percentMastered ?? 0
  const fresh = progress ? progress.total - progress.seen : 0
  const allDone = !!progress && progress.total > 0 && progress.mastered === progress.total
  // "You play Black against 1.e4" -> "against 1.e4" (the side is already on the chip).
  const tag = opening.tagline.replace(/^you play (white|black)\s*[:,-]?\s*/i, '').trim()
  return (
    <Card className="home-op anim-slide-up anim-delay" style={style} padding="none" onClick={onOpen} aria-label={`${opening.name}, ${pct}% mastered`}>
      <div className="home-op__band" aria-hidden>
        <span className="home-op__emoji">{opening.emoji}</span>
      </div>
      <div className="home-op__body">
        <div className="home-op__head">
          <h3 className="home-op__name">{opening.name}</h3>
          <span className={opening.side === 'white' ? 'home-op__side is-white' : 'home-op__side is-black'}>
            <span className="home-op__side-dot" aria-hidden />
            You play {opening.side === 'white' ? 'White' : 'Black'}
          </span>
          {tag && <span className="home-op__tag">{tag}</span>}
        </div>
        <div className="home-op__chips">
          {status === 'loading' && (
            <Chip tone="gray">
              <span className="meta-spinner" aria-hidden /> Loading lines…
            </Chip>
          )}
          {status === 'error' && <Chip tone="red" icon="😕">Lines didn't load</Chip>}
          {progress && progress.due > 0 && (
            <Chip tone="gold" icon="🧠">
              {progress.due} to review
            </Chip>
          )}
          {fresh > 0 && (
            <Chip tone="green" icon="✨">
              {fresh} new
            </Chip>
          )}
          {allDone && <Chip tone="solid" icon="🏆">All mastered!</Chip>}
        </div>
        {progress && progress.total > 0 && (
          <ProgressBar
            className="home-op__explored"
            value={progress.seen}
            max={progress.total}
            height={10}
            color={opening.accent}
            label="Lines explored"
            valueText={`${progress.seen} / ${progress.total}`}
          />
        )}
        <div className="home-op__foot">
          <span className="home-op__meta">
            {progress ? plural(progress.total, 'line') : ''}
            {progress && chapters ? ` · ${plural(chapters, 'chapter')}` : ''}
          </span>
          <span className="home-op__go" aria-hidden>
            Let's go ▶
          </span>
        </div>
      </div>
      <div className="home-op__ring">
        <ProgressRing value={pct / 100} size={86} color={opening.accent} trackColor="rgba(36, 31, 77, 0.08)" ariaLabel={`${pct}% mastered`}>
          <span className="home-op__pct">
            <span>
              {pct}
              <small>%</small>
            </span>
            <em>mastered</em>
          </span>
        </ProgressRing>
      </div>
    </Card>
  )
}

