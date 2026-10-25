// "⭐ Round complete!" after the last line of a main-line round
// (docs/practice-structure.md §2.2, §4.4, §5.3): the time and the best time,
// a clean-sweep badge, the coins (lines + round bonus), bonuses left today,
// new badges, and "Another round" / "Back to the opening".
import { useEffect, useRef } from 'react'
import { Button, Chip, CountUp, Modal } from '../../components/ui/index.ts'
import { celebrate } from '../../fx/celebrate.ts'
import { sfx } from '../../fx/sound.ts'
import { ROUND_BONUSES_PER_DAY } from '../../store/mastery.ts'
import type { MainRoundView } from '../../trainer/useTrainer.ts'
import { bonusDots, formatClock, linesWord } from './practice.ts'

export interface RoundCompleteModalProps {
  open: boolean
  /** The finished round (`round.result` set); nothing is shown without a result. */
  round: MainRoundView | null
  /** Coins the round's lines earned (shown next to the round bonus). */
  lineCoins: number
  /** Equipped celebration effect id. */
  effect: string
  onAgain: () => void
  onBack: () => void
}

export function RoundCompleteModal({ open, round, lineCoins, effect, onAgain, onBack }: RoundCompleteModalProps) {
  const result = round?.result ?? null
  const firedFor = useRef<number | null>(null)
  useEffect(() => {
    if (!open || !round || !result || firedFor.current === round.startedAt) return
    firedFor.current = round.startedAt
    const timers: number[] = []
    void celebrate(effect, { intensity: result.clean ? 1.4 : 1 })
    timers.push(window.setTimeout(() => sfx.coin(), 500))
    if (result.outcome.newAchievements.length > 0) timers.push(window.setTimeout(() => sfx.achievement(), 1300))
    if (result.outcome.levelUp) timers.push(window.setTimeout(() => sfx.levelUp(), 1900))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [open, round, result, effect])

  if (!round || !result) return null
  const o = result.outcome
  const chips = o.breakdown.filter((b) => !b.label.startsWith('🏅'))
  const achCoins = o.newAchievements.reduce((s, a) => s + a.coins, 0)
  const total = Math.max(0, lineCoins) + Math.max(0, o.coins)
  const fixed = round.requeued.length

  return (
    <Modal
      open={open}
      dismissible={false}
      ariaLabel="Round complete"
      size="md"
      className="lcm rcm"
      footerCenter
      footer={
        <div className="lcm__actions lcm__actions--row">
          <Button variant="primary" size="lg" shine icon="▶" className="lcm__grow" onClick={onAgain} data-autofocus>
            Another round
          </Button>
          <Button variant="secondary" size="lg" icon="←" onClick={onBack}>
            Back to the opening
          </Button>
        </div>
      }
    >
      <div className="lcm__body">
        <div className="rcm__badge" aria-hidden>
          ⭐
        </div>
        <h2 className="lcm__title">Round complete!</h2>
        <div className="lcm__line">{linesWord(round.size)} · every main line once</div>

        <div className="rcm__time">
          <span className="rcm__clock num" aria-label={`Time ${formatClock(result.ms)}`}>
            ⏱ {formatClock(result.ms)}
          </span>
          {o.newBest ? (
            <span className="rcm__best is-new anim-bounce">🏁 New best!</span>
          ) : o.bestMs ? (
            <span className="rcm__best">🏁 Best {formatClock(o.bestMs)}</span>
          ) : (
            <span className="rcm__best is-hint">🏁 A clean round sets your best time!</span>
          )}
        </div>

        {result.clean ? (
          <Chip tone="green" size="lg" icon="🧹" className="anim-pop">
            Clean sweep! Every line perfect first time
          </Chip>
        ) : (
          <Chip tone="gold" size="lg" icon="💪">
            {fixed > 0 ? `You fixed ${linesWord(fixed)} at the end` : 'Round done — go for a clean sweep next time!'}
          </Chip>
        )}

        <div className="lcm__coins" aria-label={`${total} coins earned in this round`}>
          <span className="lcm__coin" aria-hidden>
            🪙
          </span>
          <CountUp value={total} from={0} delay={450} duration={1100} prefix="+" />
        </div>

        <div className="lcm__chips">
          {lineCoins > 0 && (
            <Chip tone="gold" pop icon="🎓" style={{ ['--i' as string]: 3 }}>
              Lines <span className="lcm__chip-coins">+{lineCoins}</span>
            </Chip>
          )}
          {chips.map((b, i) => (
            <Chip key={`${b.label}${i}`} tone="gold" pop icon={b.emoji} style={{ ['--i' as string]: i + 4 }}>
              {b.label} <span className="lcm__chip-coins">+{b.coins}</span>
            </Chip>
          ))}
        </div>

        {!o.bonusPaid && (
          <p className="lcm__note">
            Today's {ROUND_BONUSES_PER_DAY} round bonuses are used up — this round still counts for your medals and best time! 💪
          </p>
        )}
        <div className="rcm__left" aria-label={`${o.roundsLeftToday} round bonuses left today`}>
          Round bonuses left today <span className="rcm__dots">{bonusDots(o.roundsLeftToday)}</span>
        </div>

        {o.levelUp && (
          <div className="lcm__banners">
            <div className="lcm__banner lcm__banner--level anim-bounce" style={{ animationDelay: '0.9s' }}>
              <span className="lcm__banner-emoji" aria-hidden>
                {o.levelUp.to.emoji}
              </span>
              <span>
                <b>Level up!</b> You're now a {o.levelUp.to.name}!
              </span>
            </div>
          </div>
        )}

        {o.newAchievements.length > 0 && (
          <div className="lcm__achievements">
            <div className="lcm__section-title">
              🏆 New {o.newAchievements.length > 1 ? 'badges' : 'badge'}! <span className="lcm__chip-coins">+{achCoins}</span>
            </div>
            {o.newAchievements.map((a, i) => (
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
      </div>
    </Modal>
  )
}

export default RoundCompleteModal
