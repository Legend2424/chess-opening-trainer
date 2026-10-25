// "Line complete!" — stars, coins counting up, reward chips, unlocked
// achievements, level-up / daily-goal / medal / lap banners and the equipped
// celebration. Main-line rounds use a compact card that goes on by itself
// (docs/practice-structure.md §2.2, §5.3) unless something special happened.
import { useEffect, useRef, useState } from 'react'
import type { LineStats, TrainerMode } from '../../types.ts'
import { Button, Chip, CountUp, Modal, Stars } from '../../components/ui/index.ts'
import { TIER_META } from '../../chess/lineTiers.ts'
import { MEDALS } from '../../store/mastery.ts'
import { celebrate } from '../../fx/celebrate.ts'
import { sfx } from '../../fx/sound.ts'
import type { LineOutcome } from '../../trainer/useTrainer.ts'
import { lineNameBesideTier, nextMedalText } from './practice.ts'

export interface LineCompleteModalProps {
  open: boolean
  outcome: LineOutcome | null
  /** Equipped celebration effect id. */
  effect: string
  /** Current daily streak (for the daily-goal banner). */
  streak: number
  /** In-order run wrapped around: "Start again" instead of "Next line". In a round: the next line (or the results). */
  onNext: () => void
  onRetry: () => void
  onPlayOn: () => void
  onHome: () => void
  onClose: () => void
  /** 'compact' = a small result card (main-line rounds); default 'full'. */
  variant?: 'full' | 'compact'
  /** Compact card: goes on by itself after this many ms (a tap goes on at once). */
  autoNextMs?: number
  /** The trainer mode. 'main' (a round): "Next ▶" and "End round" instead of Try again / Play on / Home. */
  mode?: TrainerMode
  /** Main-line round: "End round" was tapped (the trainer asks first). */
  onEndRound?: () => void
  /** The line's stats after this completion: "Rep #N" and the next medal (main lines). */
  stats?: LineStats
  /** Extra short line under the result (e.g. "Let's fix that one at the end 💪"). */
  note?: string
}

/** Something worth the full celebration happened (a round shows the full card instead of the compact one). */
export function needsFullCard(o: LineOutcome): boolean {
  const r = o.reward
  return r.newAchievements.length > 0 || !!r.medal || !!r.levelUp || r.dailyGoalJustMet || !!r.lap?.completed
}

function titleFor(o: LineOutcome): string {
  if (o.reward.farmed) return 'Practice makes perfect! 💪'
  if (o.learnMode) return 'Line learned! 📖'
  if (o.reward.stars === 3) return 'Perfect! 🌟'
  if (o.reward.stars === 2) return 'Great job! 🎉'
  return 'You did it! 💪'
}

const MEDAL_CHEER: Record<1 | 2 | 3, string> = {
  1: `${MEDALS[0].perfects} perfect runs — you're getting it!`,
  2: `${MEDALS[1].perfects} perfect runs on ${MEDALS[1].days} days — super!`,
  3: 'You know this line cold!',
}

export function LineCompleteModal({
  open,
  outcome,
  effect,
  streak,
  onNext,
  onRetry,
  onPlayOn,
  onHome,
  onClose,
  variant = 'full',
  autoNextMs,
  mode,
  onEndRound,
  stats,
  note,
}: LineCompleteModalProps) {
  const compact = variant === 'compact'
  // One-shot effects per completion (StrictMode-safe: the ref survives the double effect).
  const firedFor = useRef<number | null>(null)
  useEffect(() => {
    if (!open || !outcome || firedFor.current === outcome.id) return
    firedFor.current = outcome.id
    const timers: number[] = []
    void celebrate(effect, { intensity: compact ? 0.6 : outcome.perfect ? 1.2 : 0.8 })
    if (outcome.reward.coins > 0) timers.push(window.setTimeout(() => sfx.coin(), compact ? 250 : 500))
    if (outcome.reward.newAchievements.length > 0) timers.push(window.setTimeout(() => sfx.achievement(), 1300))
    if (outcome.reward.levelUp) timers.push(window.setTimeout(() => sfx.levelUp(), 1900))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [open, outcome, effect, compact])

  // Compact card: goes on by itself unless the kid paused it (End round) — once per completion.
  const [paused, setPaused] = useState<number | null>(null)
  const onNextRef = useRef(onNext)
  onNextRef.current = onNext
  const autoFor = useRef<number | null>(null)
  const auto = compact && !!autoNextMs && autoNextMs > 0 && !!outcome && paused !== outcome.id
  useEffect(() => {
    if (!open || !auto || !outcome || autoFor.current === outcome.id) return
    const id = outcome.id
    const t = window.setTimeout(() => {
      if (autoFor.current === id) return
      autoFor.current = id
      onNextRef.current()
    }, autoNextMs)
    return () => window.clearTimeout(t)
  }, [open, auto, outcome, autoNextMs])

  if (!outcome) return null
  const r = outcome.reward
  const inRound = mode === 'main'
  const next = () => {
    autoFor.current = outcome.id // a tap beats the timer: never twice
    onNext()
  }
  const chips = r.breakdown.filter((b) => !b.label.startsWith('🏅'))
  const achCoins = r.newAchievements.reduce((s, a) => s + a.coins, 0)
  // From combo x3 the reward breakdown already has a "Combo xN" chip (with its coins).
  const showComboChip = outcome.combo >= 2 && !r.farmed && !r.breakdown.some((b) => b.label.startsWith('Combo'))
  const tier = TIER_META[outcome.tier]
  // "Smith-Morra Gambit · ⭐ Main line", not "… · Main line ⭐ Main line".
  const shownName = lineNameBesideTier(outcome.line.name, outcome.tier)
  const lineTitle = (
    <div className="lcm__line">
      {outcome.line.chapterTitle}
      {shownName && <> · {shownName}</>}{' '}
      <Chip tone="violet" icon={tier.emoji} className="lcm__tier">
        {tier.name}
      </Chip>
    </div>
  )
  const isMain = outcome.tier === 'main'
  const reps = stats ? Math.max(0, Math.floor(stats.perfects) || 0) : 0
  const lap = r.lap
  const lapLine = mode === 'lap' && lap && !lap.completed ? `🌳 Lap ${lap.n}: ${lap.done}/${lap.total} ✓` : null
  const lapMissed = mode === 'lap' && !lap ? '🌳 This one comes back later in the lap — go for 2 ⭐!' : null

  const repRow = isMain && stats && (
    <div className="lcm__reps">
      <Chip tone="violet" icon="🔁">
        {outcome.perfect ? `Rep #${reps}` : `${reps} perfect ${reps === 1 ? 'rep' : 'reps'}`}
      </Chip>
      <span className="lcm__medal-next">{nextMedalText(stats)}</span>
    </div>
  )

  let footer
  if (inRound) {
    footer = (
      <div className="lcm__actions lcm__actions--row">
        <Button variant="primary" size="lg" shine icon={outcome.roundDone ? '🏁' : '▶'} className="lcm__grow" onClick={next} data-autofocus>
          {outcome.roundDone ? 'Round results' : 'Next'}
        </Button>
        {!outcome.roundDone && onEndRound && (
          <Button
            variant="secondary"
            size="lg"
            icon="🚪"
            onClick={() => {
              setPaused(outcome.id)
              onEndRound()
            }}
          >
            End round
          </Button>
        )}
      </div>
    )
  } else {
    footer = (
      <div className="lcm__actions">
        <Button variant="primary" size="lg" block shine icon="▶" onClick={next} data-autofocus>
          {outcome.wrapped ? 'Start again' : 'Next line'}
        </Button>
        <div className="lcm__secondary">
          <Button variant="secondary" size="sm" icon="↻" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="secondary" size="sm" icon="🤖" onClick={onPlayOn}>
            Play on
          </Button>
          <Button variant="secondary" size="sm" icon="🏠" onClick={onHome}>
            Home
          </Button>
        </div>
      </div>
    )
  }

  if (compact) {
    return (
      <Modal open={open} onClose={onClose} dismissible={false} ariaLabel="Line complete" size="sm" className="lcm lcm--compact" footerCenter footer={footer}>
        <div
          className="lcm__body"
          onClick={next}
          role="button"
          tabIndex={-1}
          aria-label="Tap to go on"
        >
          <Stars key={outcome.id} count={r.stars} size={44} />
          <h2 className="lcm__title">{titleFor(outcome)}</h2>
          {lineTitle}
          <div className="lcm__coins lcm__coins--sm" aria-label={`${r.coins} coins earned`}>
            <span className="lcm__coin" aria-hidden>
              🪙
            </span>
            <CountUp value={r.coins} from={0} delay={200} duration={700} prefix="+" />
          </div>
          {repRow}
          {note && <p className="lcm__note">{note}</p>}
          {auto && (
            <div className="lcm__auto" aria-hidden>
              <span className="lcm__auto-fill" key={outcome.id} style={{ animationDuration: `${autoNextMs}ms` }} />
            </div>
          )}
        </div>
      </Modal>
    )
  }

  const banners = r.levelUp || r.dailyGoalJustMet || outcome.wrapped || r.medal || lap?.completed

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={false}
      ariaLabel="Line complete"
      size="md"
      className="lcm"
      footerCenter
      footer={footer}
    >
      <div className="lcm__body">
        <Stars key={outcome.id} count={r.stars} size={64} />
        <h2 className="lcm__title">{titleFor(outcome)}</h2>
        {lineTitle}

        <div className="lcm__coins" aria-label={`${r.coins} coins earned`}>
          <span className="lcm__coin" aria-hidden>
            🪙
          </span>
          <CountUp value={r.coins} from={0} delay={450} duration={1100} prefix="+" />
        </div>

        {chips.length > 0 && (
          <div className="lcm__chips">
            {chips.map((b, i) => (
              <Chip key={`${b.label}${i}`} tone="gold" pop icon={b.emoji} style={{ ['--i' as string]: i + 3 }}>
                {b.label} <span className="lcm__chip-coins">+{b.coins}</span>
              </Chip>
            ))}
            {showComboChip && (
              <Chip tone="red" pop icon="⚡" style={{ ['--i' as string]: chips.length + 3 }}>
                Combo x{outcome.combo}
              </Chip>
            )}
            {r.lineMastered && (
              <Chip tone="green" pop icon="🧠" style={{ ['--i' as string]: chips.length + 4 }}>
                Line mastered!
              </Chip>
            )}
          </div>
        )}

        {repRow}
        {lapLine && <div className="lcm__lap">{lapLine}</div>}

        {banners && (
          <div className="lcm__banners">
            {r.medal && (
              <div className="lcm__banner lcm__banner--medal anim-bounce" style={{ animationDelay: '0.6s' }}>
                <span className="lcm__banner-emoji" aria-hidden>
                  {MEDALS[r.medal.level - 1].emoji}
                </span>
                <span>
                  <b>{MEDALS[r.medal.level - 1].name} medal!</b> {MEDAL_CHEER[r.medal.level]} <span className="lcm__chip-coins">+{r.medal.coins} 🪙</span>
                </span>
              </div>
            )}
            {lap?.completed && (
              <div className="lcm__banner lcm__banner--lap anim-bounce" style={{ animationDelay: '0.65s' }}>
                <span className="lcm__banner-emoji" aria-hidden>
                  🌳
                </span>
                <span>
                  <b>Lap {lap.n} complete!</b> Every line, one more time. <span className="lcm__chip-coins">+{lap.coins} 🪙</span>
                </span>
              </div>
            )}
            {r.levelUp && (
              <div className="lcm__banner lcm__banner--level anim-bounce" style={{ animationDelay: '0.9s' }}>
                <span className="lcm__banner-emoji" aria-hidden>
                  {r.levelUp.to.emoji}
                </span>
                <span>
                  <b>Level up!</b> You're now a {r.levelUp.to.name}!
                </span>
              </div>
            )}
            {r.dailyGoalJustMet && (
              <div className="lcm__banner lcm__banner--goal anim-bounce" style={{ animationDelay: '0.7s' }}>
                <span className="lcm__banner-emoji" aria-hidden>
                  🎯
                </span>
                <span>
                  <b>Daily goal reached!</b> {streak > 1 ? `🔥 ${streak}-day streak!` : 'Your streak has started! 🔥'}
                </span>
              </div>
            )}
            {outcome.wrapped && (
              <div className="lcm__banner lcm__banner--wrap anim-bounce" style={{ animationDelay: '0.5s' }}>
                <span className="lcm__banner-emoji" aria-hidden>
                  🏁
                </span>
                <span>
                  <b>You finished every line! 🎉</b> Next time we start again from line 1.
                </span>
              </div>
            )}
          </div>
        )}

        {r.newAchievements.length > 0 && (
          <div className="lcm__achievements">
            <div className="lcm__section-title">
              🏆 New {r.newAchievements.length > 1 ? 'badges' : 'badge'}! <span className="lcm__chip-coins">+{achCoins}</span>
            </div>
            {r.newAchievements.map((a, i) => (
              <div key={a.id} className="lcm__ach anim-pop anim-delay" style={{ ['--i' as string]: i + 8 }}>
                <span className="lcm__ach-emoji" aria-hidden>
                  {a.emoji}
                </span>
                <span className="lcm__ach-text">
                  <b>{a.name}</b>
                  <span>{a.description}</span>
                </span>
                <span className="lcm__chip-coins">+{a.coins}</span>
              </div>
            ))}
          </div>
        )}

        {note ? (
          <p className="lcm__note">{note}</p>
        ) : r.farmed ? (
          <p className="lcm__note">You just played this line — a different one earns more coins! 🪙</p>
        ) : outcome.learnMode ? (
          <p className="lcm__note">👀 You had the arrows on. Now play it without them — that run earns the ⭐ bonus coins!</p>
        ) : lapMissed ? (
          <p className="lcm__note">{lapMissed}</p>
        ) : outcome.carried && !outcome.perfect ? (
          <p className="lcm__note">↻ Your earlier try at this line counts too. Next time, go for ⭐ Perfect in one go!</p>
        ) : outcome.mistakes > 0 ? (
          <p className="lcm__note">
            You fixed {outcome.mistakes === 1 ? 'a mistake' : `${outcome.mistakes} mistakes`} — great job not giving up! 💪
          </p>
        ) : outcome.hintsUsed > 0 ? (
          <p className="lcm__note">Next time, try it without a hint for ⭐ Perfect!</p>
        ) : null}
      </div>
    </Modal>
  )
}

export default LineCompleteModal
