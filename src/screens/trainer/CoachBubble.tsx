// Hoot's speech bubble in the trainer. Priority: live feedback > coach
// comment(s) of the moves just played > chapter intro at the start > a
// friendly prompt.
import type { ReactNode } from 'react'
import { SpeechBubble, type SpeechBubbleProps } from '../../components/ui/index.ts'
import { moveLabel } from '../../chess/repertoire.ts'
import type { Feedback, TrainerState } from '../../trainer/trainerReducer.ts'
import type { MistakeInsight } from '../../trainer/useTrainer.ts'
import {
  PRAISE_LINES,
  WRONG_LINES,
  YOUR_MOVE_LINES,
  insightText,
  lastOpponentMove,
  pickBy,
  recentNotes,
  type CoachNote,
} from './messages.ts'

export interface CoachBubbleProps {
  state: TrainerState
  feedback: Feedback | null
  insight: MistakeInsight | null
  learnMode: boolean
  /** Chapter intro (shown before the first move). */
  intro?: string
  className?: string
}

type Tone = NonNullable<SpeechBubbleProps['tone']>

interface Model {
  key: string
  tone: Tone
  speaker: string
  headline?: ReactNode
  body?: ReactNode
  notes?: CoachNote[]
}

function notesKey(notes: CoachNote[]): string {
  return notes.map((n) => n.id).join(',')
}

function buildModel({ state, feedback: fb, insight, learnMode, intro }: CoachBubbleProps): Model {
  const notes = recentNotes(state)
  const opp = lastOpponentMove(state)

  if (state.phase === 'wrongMove') {
    if (fb?.kind === 'known-bad') {
      const r = fb.refutation
      return {
        key: `kb${fb.id}`,
        tone: 'error',
        speaker: '🦉',
        headline: 'Oops! Your coach marked this move as a mistake.',
        body: r ? (
          <>
            Watch out — your opponent can answer <b className="coach__move">{moveLabel(r)}</b> (the red arrow). Take it back and find a
            better move!
          </>
        ) : (
          "Take it back and let's find a better move!"
        ),
      }
    }
    const id = fb?.id ?? 0
    let extra: ReactNode = null
    if (insight?.status === 'pending') extra = <span className="coach__checking">🔍 Hoot is checking that move…</span>
    else if (insight?.status === 'done' && insight.verdict) extra = <span className="coach__insight">{insightText(insight.verdict)}</span>
    return {
      key: `w${id}`,
      tone: 'error',
      speaker: '🦉',
      headline: pickBy(WRONG_LINES, id),
      body: (
        <>
          {extra}
          {extra && ' '}
          <span className="coach__tip">Tap “↩ Take it back” to try again.</span>
        </>
      ),
    }
  }

  if (state.phase === 'complete') {
    return { key: `done${fb?.id ?? 0}`, tone: 'success', speaker: '🦉', headline: '🎉 You did it — line complete!', notes }
  }

  if (fb?.kind === 'other-line') {
    return {
      key: `ol${fb.id}`,
      tone: 'info',
      speaker: '🦉',
      headline: "👍 That's in your study too — but this line goes a different way. Try another move!",
      body: <span className="coach__tip">Look at the glowing piece. ✨</span>,
    }
  }

  if (fb?.kind === 'opponent-blunder') {
    return {
      key: `ob${fb.id}`,
      tone: 'gold',
      speaker: '😮',
      headline: 'Your opponent blundered! Can you punish it?',
      notes,
    }
  }

  if (fb?.kind === 'hint' && state.phase === 'userToMove') {
    return {
      key: `h${fb.id}`,
      tone: 'info',
      speaker: '🦉',
      headline:
        state.hintLevel >= 2
          ? '💡 Follow the yellow arrow!'
          : '💡 Here’s a clue: the glowing piece is the one to move. Where does it go?',
      notes,
    }
  }

  const headline = fb?.kind === 'book-alt' ? '✅ Also in your study — nice!' : undefined
  const tone: Tone = fb?.kind === 'book-alt' ? 'success' : 'default'
  const base = `${fb?.kind === 'book-alt' ? `ba${fb.id}` : ''}`

  if (notes.length > 0) return { key: `${base}n${notesKey(notes)}`, tone, speaker: '🦉', headline, notes }

  if (state.ply === 0 && intro) return { key: `${base}intro`, tone, speaker: '🦉', headline, body: intro }

  // Friendly prompts.
  if (state.phase === 'opponentToMove') {
    if (state.ply === 0) return { key: 'start-opp', tone, speaker: '🦉', body: 'Get ready — your opponent moves first! 👀' }
    if (headline) return { key: `${base}wait`, tone, speaker: '🦉', headline }
    return { key: `ok${state.ply}`, tone: 'success', speaker: '🦉', body: pickBy(PRAISE_LINES, state.ply + (fb?.id ?? 0)) }
  }

  if (learnMode) {
    return {
      key: `${base}learn${state.ply}`,
      tone,
      speaker: '🦉',
      headline,
      body: (
        <>
          {opp && (
            <>
              Your opponent played <b className="coach__move">{moveLabel(opp)}</b>.{' '}
            </>
          )}
          👀 Follow the yellow arrow — and try to remember it!
        </>
      ),
    }
  }

  if (state.ply === 0) {
    return { key: `${base}start`, tone, speaker: '🦉', headline, body: "Let's go! Play your first move from the study. ♟️" }
  }

  return {
    key: `${base}p${state.ply}`,
    tone,
    speaker: '🦉',
    headline,
    body: opp ? (
      <>
        Your opponent played <b className="coach__move">{moveLabel(opp)}</b>. What's your move? 🤔
      </>
    ) : (
      pickBy(YOUR_MOVE_LINES, state.ply)
    ),
  }
}

export function CoachBubble(props: CoachBubbleProps) {
  const m = buildModel(props)
  return (
    <SpeechBubble tone={m.tone} speaker={m.speaker} animateKey={m.key} speakerSize={46} className={props.className}>
      {m.headline && <div className="coach__headline">{m.headline}</div>}
      {m.notes && m.notes.length > 0 && (
        <ul className="coach__notes">
          {m.notes.map((n) => (
            <li key={n.id}>
              <b className="coach__move">{n.label}</b> {n.text}
            </li>
          ))}
        </ul>
      )}
      {m.body && <div className="coach__body">{m.body}</div>}
    </SpeechBubble>
  )
}

export default CoachBubble
