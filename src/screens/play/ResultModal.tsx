import type { ReactNode } from 'react'
import { Button, Chip, CountUp, Modal } from '../../components/ui/index.ts'
import type { AchievementDef, LevelInfo } from '../../types.ts'
import type { GameEnd } from './useComputerGame.ts'

/** What applyEngineGame returned (or null when nothing was recorded). */
export interface GameOutcome {
  ok: boolean
  coins: number
  capped: boolean
  newAchievements: AchievementDef[]
  levelUp: { from: LevelInfo; to: LevelInfo } | null
}

const DRAW_REASON: Record<string, string> = {
  stalemate: 'Stalemate — no legal moves, but no check either.',
  threefold: 'The same position came up three times.',
  insufficient: 'Not enough pieces left for anyone to checkmate.',
  fifty: '50 moves in a row with no capture and no pawn move.',
}

export function resultText(end: GameEnd): { emoji: string; title: string; line: string } {
  if (end.result === 'win') return { emoji: '🏆', title: 'You beat the robot!', line: 'Checkmate! What a finish! 🎉' }
  if (end.reason === 'resign') return { emoji: '🏳️', title: 'You resigned', line: 'Good try! Shake it off and play again.' }
  if (end.result === 'loss') return { emoji: '🤖', title: 'The robot won this time', line: 'Checkmate. Every game makes you stronger! 💪' }
  return { emoji: '🤝', title: "It's a draw!", line: DRAW_REASON[end.reason] ?? 'Nobody wins this one.' }
}

export interface ResultModalProps {
  open: boolean
  end: GameEnd | null
  outcome: GameOutcome | null
  userMoved: boolean
  hintsUsed: number
  /** Undos used this game (hints or undos make it a helped game: beginner-rate coins). */
  undos?: number
  /** Coins a win/draw WITHOUT help would have added at this robot level (0 = help cost nothing). */
  helpCost?: number
  onPlayAgain: () => void
  onChangeSettings: () => void
  onClose: () => void
}

export function ResultModal({
  open,
  end,
  outcome,
  userMoved,
  hintsUsed,
  undos = 0,
  helpCost = 0,
  onPlayAgain,
  onChangeSettings,
  onClose,
}: ResultModalProps) {
  if (!end) return null
  const t = resultText(end)
  const tone = end.result === 'win' ? 'win' : end.result === 'draw' ? 'draw' : 'loss'

  let coinsLine: ReactNode
  if (outcome && outcome.coins > 0) {
    coinsLine = (
      <div className="play-result__coins anim-pop">
        <span aria-hidden>🪙</span>
        <CountUp value={outcome.coins} prefix="+" className="num" />
        <span className="play-result__coins-label">coins!</span>
      </div>
    )
  } else if (outcome?.capped) {
    coinsLine = <p className="play-result__note">Daily robot rewards used up — play for fun! 🎈</p>
  } else if (end.result === 'loss') {
    coinsLine = <p className="play-result__note">Win or draw a game to earn coins 🪙</p>
  } else if (!userMoved) {
    coinsLine = <p className="play-result__note">Make a move next time to earn coins 🪙</p>
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      hideClose
      size="sm"
      ariaLabel={t.title}
      className={`play-result play-result--${tone}`}
      footerCenter
      footer={
        <>
          <Button variant={end.result === 'win' ? 'gold' : 'primary'} size="lg" icon="▶" onClick={onPlayAgain} shine={end.result === 'win'} data-autofocus>
            Play again
          </Button>
          <Button variant="secondary" icon="⚙️" onClick={onChangeSettings}>
            Change robot
          </Button>
          <Button variant="secondary" icon="👀" onClick={onClose}>
            See the board
          </Button>
        </>
      }
    >
      <div className="play-result__body">
        <div className="play-result__emoji anim-bounce" aria-hidden>
          {t.emoji}
        </div>
        <h2 className="play-result__title">{t.title}</h2>
        <p className="play-result__line">{t.line}</p>
        {coinsLine}
        {outcome?.levelUp && (
          <div className="play-result__levelup anim-pop">
            ⬆️ Level up! You're now a {outcome.levelUp.to.emoji} {outcome.levelUp.to.name}
          </div>
        )}
        {outcome && outcome.newAchievements.length > 0 && (
          <div className="play-result__chips">
            {outcome.newAchievements.map((a, i) => (
              <Chip key={a.id} tone="gold" size="lg" pop icon={a.emoji} style={{ ['--i' as string]: i }}>
                {a.name}
                {a.coins > 0 ? ` +${a.coins}` : ''}
              </Chip>
            ))}
          </div>
        )}
        {(hintsUsed > 0 || undos > 0) && end.result !== 'loss' && helpCost > 0 && (
          <p className="play-result__small">
            💡 Helped game (hints or undo) — a great way to learn! Win without help for +{helpCost} more coins.
          </p>
        )}
      </div>
    </Modal>
  )
}

export default ResultModal
