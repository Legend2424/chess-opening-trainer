import type { CSSProperties } from 'react'
import ChessBoard from '../../components/ChessBoard.tsx'
import { Button, Card, Chip, cx } from '../../components/ui/index.ts'
import { PieceImage } from '../../theme/pieces.tsx'
import type { BoardThemeId, PieceSetId } from '../../types.ts'
import type { EngineStatus } from '../../engine/engineService.ts'
import {
  bandFor,
  MAX_RATING,
  MIN_RATING,
  RATING_STEP,
  STRENGTH_BANDS,
  winCoins,
  type ColorChoice,
} from './strength.ts'
import { STANDARD_FEN, type StartOption } from './startPositions.ts'
import { restartApp } from './useComputerGame.ts'

export interface SetupViewProps {
  boardTheme: BoardThemeId
  pieceSet: PieceSetId
  rating: number
  onRating: (r: number) => void
  color: ColorChoice
  onColor: (c: ColorChoice) => void
  options: StartOption[]
  /** Openings still loading (show placeholders). */
  openingsLoading: boolean
  startId: string
  onStart: (id: string) => void
  engine: EngineStatus
  /** The engine has been loading for a suspiciously long time. */
  engineSlow?: boolean
  onRetryEngine: () => void
  rewardsLeft: number
  rewardsCap: number
  onPlay: () => void
}

const COLORS: { id: ColorChoice; label: string }[] = [
  { id: 'white', label: 'White' },
  { id: 'black', label: 'Black' },
  { id: 'random', label: 'Surprise me' },
]

const noMove = () => false

export function SetupView(props: SetupViewProps) {
  const {
    boardTheme,
    pieceSet,
    rating,
    onRating,
    color,
    onColor,
    options,
    openingsLoading,
    startId,
    onStart,
    engine,
    engineSlow,
    onRetryEngine,
    rewardsLeft,
    rewardsCap,
    onPlay,
  } = props
  const band = bandFor(rating)
  // The robot can't load: its chip grows a 48px button, so the rewards line makes room.
  const engineIssue = engine === 'error' || (engine === 'loading' && !!engineSlow)
  const selected = options.find((o) => o.id === startId)
  const pct = ((rating - MIN_RATING) / (MAX_RATING - MIN_RATING)) * 100
  const step = (d: number) => onRating(Math.max(MIN_RATING, Math.min(MAX_RATING, rating + d * RATING_STEP)))

  return (
    <div className={cx('play-setup', options.some((o) => o.id === 'fen') && 'play-setup--fen', engineIssue && 'play-setup--issue')}>
      <div className="play-setup__board">
        <ChessBoard
          fen={selected?.fen ?? STANDARD_FEN}
          orientation={color === 'black' ? 'black' : 'white'}
          interactive={false}
          onMove={noMove}
          boardTheme={boardTheme}
          pieceSet={pieceSet}
          ariaLabel="Preview of the start position"
        />
      </div>

      <Card className="play-setup__card" padding="lg">
        <section className="play-setup__section" aria-labelledby="play-color-h">
          <h3 id="play-color-h" className="play-setup__h">Your pieces</h3>
          <div className="play-choices" role="radiogroup" aria-labelledby="play-color-h">
            {COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={color === c.id}
                className={cx('play-choice', color === c.id && 'is-selected')}
                onClick={() => onColor(c.id)}
              >
                <span className="play-choice__icon" aria-hidden>
                  {c.id === 'random' ? (
                    <span className="play-choice__dice">🎲</span>
                  ) : (
                    <PieceImage setId={pieceSet} piece={c.id === 'white' ? 'wK' : 'bK'} size={38} />
                  )}
                </span>
                <span className="play-choice__label">{c.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="play-setup__section" aria-labelledby="play-strength-h">
          <div className="play-strength__head">
            <h3 id="play-strength-h" className="play-setup__h">
              Robot strength
            </h3>
            {rewardsLeft > 0 ? (
              <Chip tone="gold" icon="🪙">
                Win = {winCoins(rating)}
              </Chip>
            ) : (
              <Chip tone="gray" icon="🎈">
                Just for fun
              </Chip>
            )}
          </div>
          <div className="play-strength__now">
            <span className="play-strength__emoji anim-pop" key={band.id} aria-hidden>
              {band.emoji}
            </span>
            <div className="play-strength__text">
              <div className="play-strength__name">
                {band.name} <span className="num">{rating}</span>
              </div>
              <div className="play-strength__blurb">{band.blurb}</div>
            </div>
          </div>
          <div className="play-strength__slider">
            <button type="button" className="play-step" aria-label="Easier robot" onClick={() => step(-1)} disabled={rating <= MIN_RATING}>
              −
            </button>
            <div className="play-range">
              <input
                type="range"
                min={MIN_RATING}
                max={MAX_RATING}
                step={RATING_STEP}
                value={rating}
                onChange={(e) => onRating(Number(e.target.value))}
                aria-label="Robot strength"
                aria-valuetext={`${band.name}, ${rating}`}
                style={{ ['--pct' as string]: `${pct}%` } as CSSProperties}
              />
              <div className="play-range__bands" aria-hidden>
                {STRENGTH_BANDS.map((b, i) => {
                  const lo = i === 0 ? MIN_RATING : (STRENGTH_BANDS[i - 1].max + b.min) / 2
                  const hi = i === STRENGTH_BANDS.length - 1 ? MAX_RATING : (b.max + STRENGTH_BANDS[i + 1].min) / 2
                  return (
                    <span key={b.id} className={cx('play-range__band', b.id === band.id && 'is-on')} style={{ flexGrow: hi - lo }}>
                      {b.emoji}
                    </span>
                  )
                })}
              </div>
            </div>
            <button type="button" className="play-step" aria-label="Stronger robot" onClick={() => step(1)} disabled={rating >= MAX_RATING}>
              +
            </button>
          </div>
        </section>

        <section className="play-setup__section" aria-labelledby="play-start-h">
          <h3 id="play-start-h" className="play-setup__h">Start from</h3>
          <div className="play-starts" role="radiogroup" aria-labelledby="play-start-h">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={o.id === selected?.id}
                className={cx('play-start', o.id === selected?.id && 'is-selected', o.id === 'fen' && 'play-start--fen')}
                style={o.accent ? ({ ['--start-accent' as string]: o.accent } as CSSProperties) : undefined}
                onClick={() => onStart(o.id)}
              >
                <span className="play-start__emoji" aria-hidden>
                  {o.emoji}
                </span>
                <span className="play-start__text">
                  <span className="play-start__title">{o.title}</span>
                  <span className="play-start__sub">{o.subtitle}</span>
                  {o.detail && <span className="play-start__sub play-start__detail">{o.detail}</span>}
                </span>
              </button>
            ))}
            {openingsLoading && (
              <div className="play-start play-start--loading" aria-live="polite">
                <span className="play-start__emoji anim-spin" aria-hidden>
                  ⏳
                </span>
                <span className="play-start__text">
                  <span className="play-start__title">Loading your openings…</span>
                </span>
              </div>
            )}
          </div>
        </section>

        <div className="play-setup__footer">
          <div className="play-setup__info">
            <EngineChip engine={engine} slow={!!engineSlow} onRetry={onRetryEngine} />
            {!engineIssue && (
              <span className={cx('play-setup__rewards', rewardsLeft <= 0 && 'is-out')}>
                {rewardsLeft > 0
                  ? `🪙 Robot rewards left today: ${rewardsLeft} of ${rewardsCap}`
                  : '🎈 Robot rewards used up today — play for fun!'}
              </span>
            )}
          </div>
          <Button variant="primary" size="lg" icon="▶" shine block onClick={onPlay} disabled={!selected}>
            Play!
          </Button>
        </div>
      </Card>
    </div>
  )
}

function EngineChip({ engine, slow, onRetry }: { engine: EngineStatus; slow: boolean; onRetry: () => void }) {
  if (engine === 'error') {
    return (
      <span className="play-engine-chip is-error">
        😴 The robot couldn't wake up.
        <button type="button" className="play-link" onClick={onRetry}>
          Try again
        </button>
      </span>
    )
  }
  if (engine === 'loading' && slow) {
    return (
      <span className="play-engine-chip is-error">
        😴 The robot won't wake up. Wi-Fi on?
        <button type="button" className="play-link" onClick={restartApp}>
          Restart app
        </button>
      </span>
    )
  }
  if (engine === 'ready') return <span className="play-engine-chip is-ready">🤖 Robot is ready!</span>
  return <span className="play-engine-chip">⏳ Waking up the robot…</span>
}

export default SetupView
