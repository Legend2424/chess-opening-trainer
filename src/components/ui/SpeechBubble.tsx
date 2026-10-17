import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx.ts'

export interface SpeechBubbleProps {
  children?: ReactNode
  /** Who is talking (emoji). Default Hoot the owl 🦉. Pass null to hide. */
  speaker?: ReactNode | null
  /** Speaker size in px (default 52). */
  speakerSize?: number
  tone?: 'default' | 'success' | 'error' | 'info' | 'gold'
  /** Change this to replay the pop-in animation (e.g. the feedback id). */
  animateKey?: string | number
  /** Speaker bobs up and down (default true). */
  bob?: boolean
  className?: string
  style?: CSSProperties
}

/** Hoot's speech bubble for coach comments and feedback. */
export function SpeechBubble({
  children,
  speaker = '🦉',
  speakerSize = 52,
  tone = 'default',
  animateKey,
  bob = true,
  className,
  style,
}: SpeechBubbleProps) {
  return (
    <div className={cx('bubble-row', className)} style={style}>
      {speaker != null && (
        <span
          className={cx('bubble__speaker', bob && 'is-bobbing')}
          style={{ ['--speaker-size' as string]: `${speakerSize}px` }}
          aria-hidden
        >
          {speaker}
        </span>
      )}
      <div
        key={animateKey}
        className={cx('bubble', tone !== 'default' && `bubble--${tone}`, animateKey !== undefined && 'anim-pop')}
        role="status"
        aria-live="polite"
      >
        {children}
      </div>
    </div>
  )
}

export default SpeechBubble
