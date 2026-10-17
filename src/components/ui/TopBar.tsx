import type { ReactNode } from 'react'
import type { LevelInfo } from '../../types.ts'
import { sfx } from '../../fx/sound.ts'
import { Avatar } from './Avatar.tsx'
import { CoinBadge } from './CoinBadge.tsx'
import { ProgressBar } from './ProgressBar.tsx'
import { cx } from './cx.ts'

export interface TopBarProps {
  /** Avatar emoji. Omit to hide the player block. */
  avatar?: string
  name?: string
  /** Player accent colour. */
  color?: string
  /**
   * Title shown under the name (e.g. "Opening Explorer"), after the level when
   * both are given: "♝ Bishop ▬▬ · Opening Explorer" (ellipsised if long).
   */
  title?: string
  level?: LevelInfo
  /** Lifetime xp - with `level` draws a tiny progress bar to the next level. */
  xp?: number
  coins?: number
  /** Daily-goal streak in days (shows 🔥N; greyed at 0). */
  streak?: number
  /** Sound state; with onToggleMute shows a 🔊/🔇 button. */
  muted?: boolean
  onToggleMute?: () => void
  /** Shows a ← back button. */
  onBack?: () => void
  backLabel?: string
  onProfileClick?: () => void
  onCoinsClick?: () => void
  /** Screen title in the middle. */
  center?: ReactNode
  /** Extra actions on the right (before coins). */
  right?: ReactNode
  className?: string
}

export function TopBar({
  avatar,
  name,
  color,
  title,
  level,
  xp,
  coins,
  streak,
  muted,
  onToggleMute,
  onBack,
  backLabel = 'Back',
  onProfileClick,
  onCoinsClick,
  center,
  right,
  className,
}: TopBarProps) {
  const progress =
    level && xp !== undefined && level.nextXp !== null && level.nextXp > level.minXp
      ? (xp - level.minXp) / (level.nextXp - level.minXp)
      : undefined

  const who =
    avatar || name ? (
      <>
        {avatar && <Avatar emoji={avatar} color={color} size="sm" />}
        <div className="topbar__names">
          {name && <span className="topbar__name">{name}</span>}
          {(level || title) && (
            <span className="topbar__sub">
              {level && (
                <span className="topbar__level">
                  {level.emoji} {level.name}
                </span>
              )}
              {progress !== undefined && <ProgressBar className="topbar__level-bar" value={progress} height={7} />}
              {title && <span className={cx('topbar__title', level && 'topbar__title--after')}>{title}</span>}
            </span>
          )}
        </div>
      </>
    ) : null

  return (
    <header className={cx('topbar', 'game-ui', className)}>
      {onBack && (
        <button
          type="button"
          className="topbar__icon-btn"
          onClick={onBack}
          onPointerDown={() => sfx.click()}
          aria-label={backLabel}
          title={backLabel}
        >
          ←
        </button>
      )}
      {who &&
        (onProfileClick ? (
          <button type="button" className="topbar__who" onClick={onProfileClick} onPointerDown={() => sfx.click()}>
            {who}
          </button>
        ) : (
          <div className="topbar__who">{who}</div>
        ))}
      <div className="topbar__center">{center}</div>
      <div className="topbar__right">
        {right}
        {streak !== undefined && (
          <span className={cx('streak', streak <= 0 && 'streak--off')} title={`${streak} day streak`} aria-label={`${streak} day streak`}>
            <span aria-hidden>🔥</span>
            <span className="num">{streak}</span>
          </span>
        )}
        {coins !== undefined && <CoinBadge value={coins} onClick={onCoinsClick} />}
        {onToggleMute && (
          <button
            type="button"
            className="topbar__icon-btn"
            onClick={onToggleMute}
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            aria-pressed={!muted}
            title={muted ? 'Sound off' : 'Sound on'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        )}
      </div>
    </header>
  )
}

export default TopBar
