// Screen 6 — Trophies (DESIGN.md §6.6)
// Trophy shelf, stats, achievements grid, per-opening mastery and coin history.

import type { CSSProperties } from 'react'
import type { AchievementDef, CoinEvent, Profile } from '../types.ts'
import { useNav } from '../app/nav.tsx'
import { useActiveProfile } from '../store/appStore.ts'
import { currentStreak } from '../store/profileOps.ts'
import { ACHIEVEMENTS } from '../store/achievements.ts'
import { itemsOfKind } from '../store/catalog.ts'
import { levelForXp, levelProgress } from '../store/levels.ts'
import { OPENINGS } from '../data/openings.ts'
import { useRepertoires } from '../chess/useRepertoires.ts'
import { openingProgress } from '../chess/scheduler.ts'
import { Avatar, Button, Card, Chip, CountUp, ProgressBar, cx } from '../components/ui/index.ts'
import { PlayerTopBar, SaveErrorBanner, plural, shortDate, timeAgo, useNow } from './meta/common.tsx'
import './Trophies.css'

export default function Trophies() {
  const profile = useActiveProfile()
  const nav = useNav()
  const now = useNow()
  if (!profile) return null

  const unlocked = ACHIEVEMENTS.filter((a) => profile.achievements[a.id] !== undefined).length

  return (
    <div className="screen game-ui meta-screen trophies">
      <PlayerTopBar profile={profile} onBack={() => nav.back()} center="🏆 Trophies" onCoinsClick={() => nav.go({ name: 'shop' })} />
      <div className="meta-scroll">
        <div className="meta-page trophies__page">
          <SaveErrorBanner />
          <div className="trophies__top">
            <HeroCard profile={profile} unlocked={unlocked} />
            <StatsGrid profile={profile} now={now} />
          </div>
          <Shelf profile={profile} onShop={() => nav.go({ name: 'shop', tab: 'trophy' })} />
          <section className="trophies__section">
            <h2 className="meta-section-title on-bg">
              🏅 Achievements
              <Chip tone="white">
                {unlocked} / {ACHIEVEMENTS.length}
              </Chip>
            </h2>
            <div className="ach-grid">
              {ACHIEVEMENTS.map((a, i) => (
                <AchievementTile key={a.id} def={a} at={profile.achievements[a.id]} index={i} now={now} />
              ))}
            </div>
          </section>
          <div className="trophies__bottom">
            <MasteryCard profile={profile} now={now} />
            <HistoryCard history={profile.history} now={now} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function HeroCard({ profile, unlocked }: { profile: Profile; unlocked: number }) {
  const level = levelForXp(profile.xp)
  const toNext = level.nextXp !== null ? Math.max(0, level.nextXp - profile.xp) : 0
  return (
    <Card className="tr-hero anim-pop" padding="none" style={{ '--accent': profile.color } as CSSProperties}>
      <div className="tr-hero__band">
        <Avatar emoji={profile.avatar} color={profile.color} size={92} ring float badge={level.emoji} />
      </div>
      <div className="tr-hero__body">
        <h2 className="tr-hero__name">{profile.name}</h2>
        <span className="tr-hero__level">
          {level.emoji} Level {level.level} · {level.name}
        </span>
        <ProgressBar
          value={levelProgress(profile.xp)}
          height={12}
          label="Next level"
          valueText={level.nextXp !== null ? `${toNext.toLocaleString()} XP to go` : 'Max!'}
        />
        <span className="tr-hero__ach">
          🏅 {unlocked} of {ACHIEVEMENTS.length} achievements
        </span>
      </div>
    </Card>
  )
}

function StatsGrid({ profile, now }: { profile: Profile; now: number }) {
  const t = profile.totals
  const stats: Array<{ icon: string; label: string; value: number; tone: string }> = [
    { icon: '📚', label: 'Lines finished', value: t.lines, tone: '#6c4bf4' },
    { icon: '⭐', label: 'Perfect lines', value: t.perfects, tone: '#f59e0b' },
    { icon: '🔥', label: 'Best combo', value: profile.bestCombo, tone: '#f97316' },
    { icon: '📅', label: 'Day streak', value: currentStreak(profile, now), tone: '#ef4444' },
    { icon: '🤖', label: 'Computer wins', value: t.engineWins, tone: '#3b82f6' },
    { icon: '⚔️', label: 'Blunders punished', value: t.blundersPunished, tone: '#22c55e' },
  ]
  return (
    <div className="tr-stats">
      {stats.map((s, i) => (
        <div key={s.label} className="tr-stat anim-pop anim-delay" style={{ '--i': i, '--tone': s.tone } as CSSProperties}>
          <span className="tr-stat__icon" aria-hidden>
            {s.icon}
          </span>
          <CountUp className="tr-stat__value" value={s.value} from={0} duration={900} delay={150 + i * 60} />
          <span className="tr-stat__label">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

function Shelf({ profile, onShop }: { profile: Profile; onShop: () => void }) {
  const all = itemsOfKind('trophy')
  const owned = all.filter((it) => profile.owned.includes(it.id))
  return (
    <section className="tr-shelf" aria-label="Trophy shelf">
      <div className="tr-shelf__head">
        <h2 className="meta-section-title">🪵 My trophy shelf</h2>
        <span className="tr-shelf__count">
          {owned.length} / {all.length}
        </span>
        <Button size="sm" variant="gold" icon="🛒" onClick={onShop} className="tr-shelf__shop">
          {owned.length === 0 ? 'Get your first trophy' : 'More trophies'}
        </Button>
      </div>
      <div className="tr-shelf__board">
        <div className="tr-shelf__row">
          {all.map((it, i) => {
            const has = profile.owned.includes(it.id)
            return (
              <span
                key={it.id}
                className={cx('tr-shelf__item', has ? 'is-owned anim-bounce anim-delay' : 'is-missing')}
                style={{ '--i': i } as CSSProperties}
                title={has ? it.name : `${it.name} — in the shop`}
              >
                <span className="tr-shelf__emoji" aria-hidden>
                  {it.emoji}
                </span>
                <span className="tr-shelf__label">{has ? it.name : '???'}</span>
              </span>
            )
          })}
        </div>
        <div className="tr-shelf__plank" aria-hidden />
      </div>
      {owned.length === 0 && <p className="tr-shelf__hint">Your shelf is waiting! Buy trophies in the shop to show them off here.</p>}
    </section>
  )
}

function AchievementTile({ def, at, index, now }: { def: AchievementDef; at: number | undefined; index: number; now: number }) {
  const got = at !== undefined
  const hidden = !got && !!def.secret
  return (
    <div
      className={cx('ach', got ? 'ach--got anim-pop anim-delay' : 'ach--locked', hidden && 'ach--secret')}
      style={{ '--i': Math.min(index, 14) } as CSSProperties}
    >
      <span className="ach__badge" aria-hidden>
        {hidden ? '❓' : def.emoji}
      </span>
      <span className="ach__text">
        <span className="ach__name">{hidden ? '???' : def.name}</span>
        <span className="ach__desc">{hidden ? 'A secret achievement — keep playing to find it!' : def.description}</span>
        {got ? (
          <span className="ach__date">✓ Unlocked {shortDate(at, now)}</span>
        ) : (
          <span className="ach__coins">🪙 +{def.coins}</span>
        )}
      </span>
      {!got && (
        <span className="ach__lock" aria-label="Locked">
          🔒
        </span>
      )}
    </div>
  )
}

function MasteryCard({ profile, now }: { profile: Profile; now: number }) {
  const reps = useRepertoires()
  return (
    <Card className="tr-mastery" padding="sm">
      <h3 className="meta-section-title tr-card-title">🎓 Opening mastery</h3>
      <div className="tr-mastery__list">
        {OPENINGS.map((o) => {
          const rep = reps.byId[o.id]
          const p = rep ? openingProgress(rep.lines, profile.lineStats, now) : null
          return (
            <div key={o.id} className="tr-mastery__row">
              <span className="tr-mastery__emoji" style={{ background: o.accent }} aria-hidden>
                {o.emoji}
              </span>
              <div className="tr-mastery__body">
                <ProgressBar
                  value={p ? p.mastered : 0}
                  max={p && p.total > 0 ? p.total : 1}
                  color={o.accent}
                  height={12}
                  label={o.name}
                  valueText={p ? `${p.percentMastered}%` : reps.status === 'loading' ? '…' : '–'}
                />
                <span className="tr-mastery__meta">
                  {p
                    ? `${p.mastered} mastered · ${p.seen} seen · ${plural(p.total, 'line')}`
                    : reps.status === 'error'
                      ? "Lines didn't load"
                      : 'Loading lines…'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function HistoryCard({ history, now }: { history: CoinEvent[]; now: number }) {
  const recent = history.slice(0, 30)
  return (
    <Card className="tr-history" padding="sm">
      <h3 className="meta-section-title tr-card-title">🪙 Recent coins</h3>
      {recent.length === 0 ? (
        <div className="meta-empty">
          <span className="meta-empty__icon">🪙</span>
          No coins yet — finish a line to earn some!
        </div>
      ) : (
        <ul className="tr-history__list">
          {recent.map((ev, i) => (
            <li key={`${ev.at}-${i}`} className="tr-history__row">
              <span className="tr-history__reason">{ev.reason}</span>
              <span className="tr-history__when">{timeAgo(ev.at, now)}</span>
              <span className={cx('tr-history__delta', ev.delta < 0 && 'is-neg')}>
                {ev.delta > 0 ? `+${ev.delta.toLocaleString()}` : ev.delta.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
