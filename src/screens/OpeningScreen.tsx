// Screen 3 — one opening (DESIGN.md §6.3): mastery overview and the ways to
// practise it (Coach's Choice, all lines in order, one chapter, vs computer).
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import type { Line, Screen, TrainerMode } from '../types.ts'
import { useNav } from '../app/nav.tsx'
import { useRepertoire } from '../chess/useRepertoires.ts'
import { openingProgress } from '../chess/scheduler.ts'
import { openingById } from '../data/openings.ts'
import { actions, useActiveProfile } from '../store/appStore.ts'
import { currentStreak } from '../store/profileOps.ts'
import { levelForXp } from '../store/levels.ts'
import { titleText } from '../store/catalog.ts'
import { setMuted } from '../fx/sound.ts'
import { Button, Card, Chip, ProgressBar, ProgressRing, Toggle, TopBar, cx } from '../components/ui/index.ts'
import { inOrderKey } from '../trainer/useTrainer.ts'
import './OpeningScreen.css'

type OpeningParams = Extract<Screen, { name: 'opening' }>

function linesWord(n: number): string {
  return n === 1 ? '1 line' : `${n} lines`
}

export default function OpeningScreen({ params }: { params: OpeningParams }) {
  const nav = useNav()
  const profile = useActiveProfile()
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
  const prog = openingProgress(lines, stats, now)
  const newCount = prog.total - prog.seen
  const orderKey = inOrderKey(def.id, 'inorder')
  const orderIdx = lines.length ? ((profile.inOrderIndex[orderKey] ?? 0) % lines.length + lines.length) % lines.length : 0
  const nextInOrder = lines[orderIdx]
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
                {newCount > 0 && prog.due > 0
                  ? `New lines + ${prog.due} to review`
                  : prog.due > 0
                    ? `${prog.due} ${prog.due === 1 ? 'line' : 'lines'} to review`
                    : newCount > 0
                      ? 'Learn new lines'
                      : 'Keep your lines sharp'}
              </small>
            </span>
          </Button>

          <Card className="opening__order" padding="sm">
            <div className="opening__order-head">
              <span className="opening__order-icon" aria-hidden>
                📚
              </span>
              <div className="opening__order-text">
                <div className="opening__card-title">All lines in order</div>
                <div className="opening__order-sub">
                  Line <b className="num">{orderIdx + 1}</b> of <b className="num">{lines.length}</b>
                  {nextInOrder && (
                    <span className="opening__order-next">
                      {' '}
                      · {nextInOrder.chapterTitle}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <ProgressBar value={orderIdx} max={lines.length} height={10} />
            <div className="opening__order-actions">
              <Button variant="info" size="md" icon="▶" className="opening__grow" onClick={() => train('inorder')}>
                {orderIdx === 0 ? 'Start' : 'Continue'}
              </Button>
              {orderIdx > 0 && (
                <Button
                  variant="secondary"
                  size="md"
                  icon="⏮"
                  onClick={() => {
                    actions.setInOrderIndex(orderKey, 0)
                    train('inorder')
                  }}
                >
                  Start over
                </Button>
              )}
            </div>
          </Card>

          <div className="opening__extras">
            <Toggle
              className="opening__learn"
              checked={learnMode}
              onChange={(v) => actions.setSetting('learnMode', v)}
              label="👀 Show me the moves"
              description={learnMode ? 'Arrows show every move (half coins)' : 'Turn on to see an arrow for every move'}
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
              {rep && prog.due > 0 && (
                <Chip tone="blue" icon="🧠">
                  {prog.due} to review
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
                value={prog.total ? prog.mastered / prog.total : 0}
                size={92}
                color={['#fff3b0', '#ffc21a']}
                trackColor="rgba(255,255,255,0.3)"
                ariaLabel={`${prog.percentMastered}% mastered`}
              >
                <span className="opening__ring-pct">{prog.percentMastered}%</span>
              </ProgressRing>
              <div className="opening__counts">
                <span>
                  <b className="num">{prog.mastered}</b> mastered
                </span>
                <span>
                  <b className="num">{prog.seen}</b> seen
                </span>
                <span>
                  <b className="num">{prog.total}</b> lines
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
