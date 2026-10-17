// "Line complete!" — stars, coins counting up, reward chips, unlocked
// achievements, level-up / daily-goal banners and the equipped celebration.
import { useEffect, useRef } from 'react'
import { Button, Chip, CountUp, Modal, Stars } from '../../components/ui/index.ts'
import { celebrate } from '../../fx/celebrate.ts'
import { sfx } from '../../fx/sound.ts'
import type { LineOutcome } from '../../trainer/useTrainer.ts'

export interface LineCompleteModalProps {
  open: boolean
  outcome: LineOutcome | null
  /** Equipped celebration effect id. */
  effect: string
  /** Current daily streak (for the daily-goal banner). */
  streak: number
  /** In-order run wrapped around: "Start again" instead of "Next line". */
  onNext: () => void
  onRetry: () => void
  onPlayOn: () => void
  onHome: () => void
  onClose: () => void
}

function titleFor(o: LineOutcome): string {
  if (o.reward.farmed) return 'Practice makes perfect! 💪'
  if (o.learnMode) return 'Line learned! 📖'
  if (o.reward.stars === 3) return 'Perfect! 🌟'
  if (o.reward.stars === 2) return 'Great job! 🎉'
  return 'You did it! 💪'
}

export function LineCompleteModal({ open, outcome, effect, streak, onNext, onRetry, onPlayOn, onHome, onClose }: LineCompleteModalProps) {
  // One-shot effects per completion (StrictMode-safe: the ref survives the double effect).
  const firedFor = useRef<number | null>(null)
  useEffect(() => {
    if (!open || !outcome || firedFor.current === outcome.id) return
    firedFor.current = outcome.id
    const timers: number[] = []
    void celebrate(effect, { intensity: outcome.perfect ? 1.2 : 0.8 })
    if (outcome.reward.coins > 0) timers.push(window.setTimeout(() => sfx.coin(), 500))
    if (outcome.reward.newAchievements.length > 0) timers.push(window.setTimeout(() => sfx.achievement(), 1300))
    if (outcome.reward.levelUp) timers.push(window.setTimeout(() => sfx.levelUp(), 1900))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [open, outcome, effect])

  if (!outcome) return null
  const r = outcome.reward
  const chips = r.breakdown.filter((b) => !b.label.startsWith('🏅'))
  const achCoins = r.newAchievements.reduce((s, a) => s + a.coins, 0)
  // From combo x3 the reward breakdown already has a "Combo xN" chip (with its coins).
  const showComboChip = outcome.combo >= 2 && !r.farmed && !r.breakdown.some((b) => b.label.startsWith('Combo'))

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={false}
      ariaLabel="Line complete"
      size="md"
      className="lcm"
      footerCenter
      footer={
        <div className="lcm__actions">
          <Button variant="primary" size="lg" block shine icon="▶" onClick={onNext} data-autofocus>
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
      }
    >
      <div className="lcm__body">
        <Stars key={outcome.id} count={r.stars} size={64} />
        <h2 className="lcm__title">{titleFor(outcome)}</h2>
        <div className="lcm__line">
          {outcome.line.chapterTitle} · {outcome.line.name}
        </div>

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

        {(r.levelUp || r.dailyGoalJustMet || outcome.wrapped) && (
          <div className="lcm__banners">
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

        {r.farmed ? (
          <p className="lcm__note">You just played this line — a different one earns more coins! 🪙</p>
        ) : outcome.learnMode ? (
          <p className="lcm__note">👀 You had the arrows on. Now play it without them — that run earns the ⭐ bonus coins!</p>
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
