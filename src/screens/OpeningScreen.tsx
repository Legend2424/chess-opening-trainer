// Screen 3 — one opening (DESIGN.md §6.3, docs/practice-structure.md §5.1): the
// 🏆 Tournament-ready ring and the ways to practise it — Coach's Choice, a ⭐ Main
// Lines round, the 🌳 All Lines lap, one chapter, vs computer.
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import type { Line, LineTier, Screen, TrainerMode } from '../types.ts'
import { useNav } from '../app/nav.tsx'
import { useRepertoire } from '../chess/useRepertoires.ts'
import { openingProgress } from '../chess/scheduler.ts'
import { userColorOf } from '../chess/repertoire.ts'
import { TIER_META, estimateMinutes, lapLines, nextLapLine, tierOf } from '../chess/lineTiers.ts'
import { openingById } from '../data/openings.ts'
import { actions, useActiveProfile, useParentSettings } from '../store/appStore.ts'
import { currentStreak } from '../store/profileOps.ts'
import { lapProgress, medalOf, readiness, roundBonusesLeft, ROUND_BONUSES_PER_DAY } from '../store/mastery.ts'
import { levelForXp } from '../store/levels.ts'
import { titleText } from '../store/catalog.ts'
import { setMuted } from '../fx/sound.ts'
import { Button, Card, Chip, ProgressBar, ProgressRing, Toggle, TopBar, cx } from '../components/ui/index.ts'
import { inOrderKey } from '../trainer/useTrainer.ts'
import { displayLineName } from './trainer/messages.ts'
import {
  bonusDots,
  formatClock,
  lapTierRows,
  linesWord,
  medalEmoji,
  MEDAL_NAME,
  playedToday,
  shortChapterTitle,
  tierLine,
} from './trainer/practice.ts'
import './OpeningScreen.css'

type OpeningParams = Extract<Screen, { name: 'opening' }>

// ---------------------------------------------------------------------------
// ⭐ Main Lines card and 🌳 lap card (also shown in the UI gallery)
// ---------------------------------------------------------------------------

/** One main line (one per chapter) on the Main Lines card. */
export interface MainToken {
  id: string
  /** Short chapter title. */
  title: string
  medal: 0 | 1 | 2 | 3
  /** Perfect runs ("Rep #N"). */
  reps: number
  /** Completed today. */
  today: boolean
}

export interface MainLinesCardProps {
  tokens: MainToken[]
  /** Rough round time in minutes. */
  minutes: number
  /** Fastest clean round (ms), or null. */
  bestMs: number | null
  /** Round bonuses still paid today. */
  bonusesLeft: number
  onPlay: () => void
  className?: string
}

export function MainLinesCard({ tokens, minutes, bestMs, bonusesLeft, onPlay, className }: MainLinesCardProps) {
  return (
    <Card className={cx('oq-pcard oq-main', className)} padding="none">
      <div className="oq-pcard__head">
        <span className="oq-pcard__icon" aria-hidden>
          ⭐
        </span>
        <span className="opening__card-title">Main Lines</span>
        <span className="oq-pcard__aside">
          <span>{bestMs ? `🏁 Best ${formatClock(bestMs)}` : '🏁 No best yet'}</span>
          <span className="oq-main__bonus" aria-label={`${bonusesLeft} of ${ROUND_BONUSES_PER_DAY} round bonuses left today`}>
            Bonuses <b aria-hidden>{bonusDots(bonusesLeft)}</b>
          </span>
        </span>
      </div>
      <ul className="oq-tokens" aria-label="Your main lines">
        {tokens.map((t) => (
          <li
            key={t.id}
            className={cx('oq-token', t.medal > 0 && `oq-token--m${t.medal}`, t.today && 'is-today')}
            aria-label={`${t.title}: ${t.medal ? `${MEDAL_NAME[t.medal]} medal` : 'no medal yet'}, ${t.reps} perfect runs${t.today ? ', played today' : ''}`}
          >
            <span className="oq-token__title">{t.title}</span>
            <span className="oq-token__medal" aria-hidden>
              {medalEmoji(t.medal) || '○'}
            </span>
            <span className="oq-token__reps num" aria-hidden>
              ×{t.reps}
            </span>
            {t.today && (
              <span className="oq-token__today" aria-hidden>
                ✓
              </span>
            )}
          </li>
        ))}
      </ul>
      <Button variant="gold" size="md" block icon="▶" className="oq-pcard__go" onClick={onPlay}>
        Round · {linesWord(tokens.length)} · ~{minutes} min
      </Button>
    </Card>
  )
}

export interface LapCardProps {
  n: number
  done: number
  total: number
  tiers: Array<{ tier: LineTier; done: number; total: number }>
  /** The next line of the lap (kid moves hidden), or null. */
  next: { chapter: string; tier: LineTier; name: string } | null
  onPlay: () => void
  className?: string
}

export function LapCard({ n, done, total, tiers, next, onPlay, className }: LapCardProps) {
  return (
    <Card className={cx('oq-pcard oq-lap', className)} padding="none">
      <div className="oq-pcard__head">
        <span className="oq-pcard__icon" aria-hidden>
          🌳
        </span>
        <span className="opening__card-title">
          All Lines · Lap <span className="num">{n}</span>
        </span>
        <span className="oq-pcard__aside oq-lap__count num">
          {done}/{total}
        </span>
      </div>
      <ProgressBar value={done} max={total} height={10} color="linear-gradient(90deg, #4ade80, #16a34a)" />
      <div className="oq-lap__tiers" aria-label="This lap by kind of line">
        {tiers.map((r) => (
          <span key={r.tier} className={cx('oq-lap__tier', r.total > 0 && r.done >= r.total && 'is-done')} title={TIER_META[r.tier].plural}>
            {TIER_META[r.tier].emoji} <span className="num">{r.done}/{r.total}</span>
          </span>
        ))}
      </div>
      <div className="oq-pcard__foot">
        <span className="oq-lap__next">
          {next ? (
            <>
              Next: <b>{next.chapter}</b> · {TIER_META[next.tier].emoji} {next.name}
            </>
          ) : (
            'Every line, one after another'
          )}
        </span>
        <Button variant="success" size="md" icon="▶" className="oq-pcard__go" onClick={onPlay}>
          {done === 0 ? 'Start lap' : 'Continue lap'}
        </Button>
      </div>
    </Card>
  )
}

export default function OpeningScreen({ params }: { params: OpeningParams }) {
  const nav = useNav()
  const profile = useActiveProfile()
  const parent = useParentSettings()
  const def = openingById(params.openingId)
  const { status, rep, error } = useRepertoire(params.openingId)

  const soundOn = profile?.settings.sound ?? true
  useEffect(() => {
    setMuted(!soundOn)
  }, [soundOn])

  if (!profile) return null
  const now = Date.now()
  const learnMode = profile.settings.learnMode

  const topBar = (
    <TopBar
      onBack={() => nav.back()}
      backLabel="Home"
      avatar={profile.avatar}
      name={profile.name}
      color={profile.color}
      level={levelForXp(profile.xp)}
      xp={profile.xp}
      title={titleText(profile.equipped.title)}
      coins={profile.coins}
      streak={currentStreak(profile, now)}
      muted={!soundOn}
      onToggleMute={() => actions.setSetting('sound', !soundOn)}
    />
  )

  if (!def) {
    return (
      <div className="screen opening game-ui">
        {topBar}
        <div className="opening-msg">
          <div className="opening-msg__emoji">🤷</div>
          <h2>Hmm, I can't find that opening.</h2>
          <Button size="lg" icon="🏠" onClick={() => nav.reset({ name: 'home' })}>
            Home
          </Button>
        </div>
      </div>
    )
  }

  const train = (mode: TrainerMode, chapterId?: string) => {
    const s: Screen = chapterId
      ? { name: 'train', openingId: def.id, mode, chapterId, learnMode }
      : { name: 'train', openingId: def.id, mode, learnMode }
    nav.go(s)
  }

  const stats = profile.lineStats
  const lines: Line[] = rep?.lines ?? []
  const userColor = userColorOf(def)
  const prog = openingProgress(lines, stats, now)
  const newCount = prog.total - prog.seen
  // Coach's Choice never serves Plan B lines: its "to review" / "new" counts leave them out.
  const coachProg = openingProgress(
    lines.filter((l) => tierOf(l) !== 'planb'),
    stats,
    now,
  )
  const coachNew = coachProg.total - coachProg.seen
  const ready = readiness(lines, stats)

  // ⭐ Main Lines: one token per chapter's main line.
  const mainLines = lines.filter((l) => tierOf(l) === 'main')
  const tokens: MainToken[] = mainLines.map((l) => {
    const s = stats[l.id]
    return {
      id: l.id,
      title: shortChapterTitle(l.chapterTitle),
      medal: medalOf(s),
      reps: s ? Math.max(0, Math.floor(s.perfects) || 0) : 0,
      today: playedToday(s, now),
    }
  })
  const bestMs = profile.mainRoundBest?.[def.id] ?? null

  // 🌳 Lap: every line (Plan B only when the parent has it on), in lap order.
  const includePlanB = parent.includePlanB !== false
  const lapSet = lapLines(lines, includePlanB)
  const lap = lapProgress(
    profile,
    def.id,
    lapSet.map((l) => l.id),
  )
  const nextLap = nextLapLine(lapSet, lap.doneIds) ?? lapSet[0] ?? null
  const sideLabel = def.side === 'white' ? 'White' : 'Black'
  // The side is already on the chip: "You play Black against 1.e4" -> "Against 1.e4".
  const tagRest = def.tagline.replace(/^you play (white|black)[:,]?\s*/i, '')
  const tagline = tagRest ? tagRest[0].toUpperCase() + tagRest.slice(1) : ''

  const accentStyle = { ['--opening-accent' as string]: def.accent } as CSSProperties

  let main: ReactNode
  if (status === 'error') {
    main = (
      <div className="opening-msg">
        <div className="opening-msg__emoji">😵</div>
        <h2>Oh no! I couldn't load the opening lines.</h2>
        {error && <p className="muted">{error}</p>}
        <Button size="lg" icon="↻" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    )
  } else if (status === 'loading' || !rep) {
    main = (
      <div className="opening-msg">
        <div className="opening-msg__emoji anim-float">🦉</div>
        <h2>Hoot is getting your lines ready…</h2>
        <div className="opening-msg__spinner anim-spin" aria-hidden />
      </div>
    )
  } else if (rep.lines.length === 0) {
    main = (
      <div className="opening-msg">
        <div className="opening-msg__emoji">📭</div>
        <h2>No lines to practise here yet.</h2>
        <p className="muted">Ask a grown-up to check the training settings in the Parent zone.</p>
      </div>
    )
  } else {
    main = (
      <div className="opening__grid">
        <div className="opening__col opening__col--main">
          <Button
            variant="primary"
            size="xl"
            block
            shine
            icon="▶"
            className="opening__coach"
            onClick={() => train('random')}
          >
            <span className="opening__coach-text">
              <span>Coach's Choice</span>
              <small>
                {coachNew > 0 && coachProg.due > 0
                  ? `New lines + ${coachProg.due} to review`
                  : coachProg.due > 0
                    ? `${coachProg.due} ${coachProg.due === 1 ? 'line' : 'lines'} to review`
                    : coachNew > 0
                      ? 'Learn new lines'
                      : 'Keep your lines sharp'}
              </small>
            </span>
          </Button>

          {mainLines.length > 0 && (
            <MainLinesCard
              className="opening__anim2"
              tokens={tokens}
              minutes={estimateMinutes(mainLines, userColor)}
              bestMs={bestMs}
              bonusesLeft={roundBonusesLeft(profile, now)}
              onPlay={() => train('main')}
            />
          )}

          {lapSet.length > 0 && (
            <LapCard
              className="opening__anim3"
              n={lap.n}
              done={lap.done}
              total={lap.total}
              tiers={lapTierRows(lapSet, lap.doneIds)}
              next={
                nextLap
                  ? {
                      chapter: shortChapterTitle(nextLap.chapterTitle),
                      tier: tierOf(nextLap),
                      name: displayLineName(nextLap, 0, false, userColor),
                    }
                  : null
              }
              onPlay={() => train('lap')}
            />
          )}

          <div className="opening__extras">
            <Toggle
              className="opening__learn"
              checked={learnMode}
              onChange={(v) => actions.setSetting('learnMode', v)}
              label="👀 Show me the moves"
              description={
                // iPad landscape has room for one short line only; the half-coins warning stays.
                <>
                  <span className="opening__desc-long">
                    {learnMode ? 'Arrows show every move (half coins)' : 'Turn on to see an arrow for every move'}
                  </span>
                  <span className="opening__desc-short">{learnMode ? 'Arrows on · half coins' : 'An arrow for every move'}</span>
                </>
              }
              onIcon="👀"
            />

            <Button
              variant="secondary"
              size="md"
              block
              icon="🤖"
              className="opening__play"
              onClick={() => nav.go({ name: 'play', openingId: def.id })}
            >
              <span className="opening__long">Play this opening vs computer</span>
              <span className="opening__short">Play vs computer</span>
            </Button>
          </div>
        </div>

        <Card className="opening__chapters" padding="none">
          <div className="opening__chapters-head">
            <span className="opening__card-title">🎯 Pick a chapter</span>
            <span className="muted opening__chapters-count">{rep.chapters.length} chapters</span>
          </div>
          <ul className="opening__chapter-list">
            {rep.chapters.map((ch) => {
              const chLines = lines.filter((l) => l.chapterId === ch.id)
              const p = openingProgress(chLines, stats, now)
              const fresh = p.total - p.seen
              const empty = chLines.length === 0
              const key = inOrderKey(def.id, 'chapter', ch.id)
              const idx = chLines.length ? (profile.inOrderIndex[key] ?? 0) % chLines.length : 0
              return (
                <li key={ch.id}>
                  <button
                    type="button"
                    className={cx('chapter-row', empty && 'is-empty')}
                    disabled={empty}
                    onClick={() => train('chapter', ch.id)}
                    aria-label={`${ch.title}: ${linesWord(chLines.length)}, ${p.percentMastered}% mastered`}
                  >
                    <span className="chapter-row__main">
                      <span className="chapter-row__title">
                        {ch.title}
                        {ch.isExtra && (
                          <Chip tone="gray" className="chapter-row__chip">
                            Extra
                          </Chip>
                        )}
                      </span>
                      {!empty && (
                        <span className="chapter-row__tiers" aria-label="Kinds of lines">
                          {tierLine(chLines)}
                        </span>
                      )}
                      <span className="chapter-row__meta">
                        {empty ? (
                          'No lines yet'
                        ) : (
                          <>
                            {linesWord(chLines.length)}
                            {idx > 0 && <> · next: line {idx + 1}</>}
                            {fresh > 0 && <span className="chapter-row__new"> · ✨ {fresh} new</span>}
                            {p.due > 0 && <span className="chapter-row__due"> · 🧠 {p.due} to review</span>}
                          </>
                        )}
                      </span>
                      {!empty && (
                        <ProgressBar
                          className="chapter-row__bar"
                          value={p.mastered}
                          max={p.total}
                          height={8}
                          color="linear-gradient(90deg, #4ade80, #16a34a)"
                        />
                      )}
                    </span>
                    <span className="chapter-row__pct num">{empty ? '' : `${p.percentMastered}%`}</span>
                    <span className="chapter-row__go" aria-hidden>
                      ›
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
    )
  }

  return (
    <div className="screen opening game-ui" style={accentStyle}>
      {topBar}
      <div className="opening__page">
        <header className="opening__hero">
          <span className="opening__emoji" aria-hidden>
            {def.emoji}
          </span>
          <div className="opening__hero-text">
            <h1 className="opening__name">{def.name}</h1>
            <div className="opening__hero-chips">
              <span className={cx('opening__side', def.side === 'white' ? 'is-white' : 'is-black')}>
                <span className="opening__side-dot" aria-hidden />
                You play {sideLabel}
              </span>
              {rep && coachProg.due > 0 && (
                <Chip tone="blue" icon="🧠">
                  {coachProg.due} to review
                </Chip>
              )}
              {rep && newCount > 0 && (
                <Chip tone="gold" icon="✨">
                  {newCount} new
                </Chip>
              )}
            </div>
            {tagline && <p className="opening__tagline">{tagline}</p>}
          </div>
          {rep && (
            <div className="opening__mastery">
              <ProgressRing
                value={ready.percent / 100}
                size={92}
                color={['#fff3b0', '#ffc21a']}
                trackColor="rgba(255,255,255,0.3)"
                ariaLabel={`Tournament ready: ${ready.percent}%`}
              >
                <span className="opening__ring-pct">
                  {ready.percent}%<small>{ready.ready ? '🏆 ready!' : '🏆 ready'}</small>
                </span>
              </ProgressRing>
              <div className="opening__counts">
                {ready.mains > 0 && (
                  <span title="Main lines with a gold medal">
                    ⭐ <b className="num">{ready.mainsByMedal[2]}</b>/{ready.mains} 🥇
                  </span>
                )}
                {ready.keys > 0 && (
                  <span title="Key replies mastered">
                    🔑 <b className="num">{ready.keysMastered}</b>/{ready.keys} ✅
                  </span>
                )}
                <span>
                  <b className="num">{prog.mastered}</b>/{prog.total} mastered
                </span>
              </div>
            </div>
          )}
        </header>
        {main}
      </div>
    </div>
  )
}
