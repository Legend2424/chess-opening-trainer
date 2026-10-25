// Hoot's speech bubble in the trainer. Priority: live feedback > coach
// comment(s) of the moves just played > chapter intro at the start > a
// friendly prompt.
import type { ReactNode } from 'react'
import { SpeechBubble, type SpeechBubbleProps } from '../../components/ui/index.ts'
import { isBlunder, moveLabel, positionKey } from '../../chess/repertoire.ts'
import { mainAlternative } from '../../chess/lineTiers.ts'
import type { Repertoire, TrainerMode } from '../../types.ts'
import type { Feedback, TrainerState } from '../../trainer/trainerReducer.ts'
import type { MistakeInsight } from '../../trainer/useTrainer.ts'
import {
  PRAISE_LINES,
  SKIP_AHEAD_LINE,
  WRONG_LINES,
  YOUR_MOVE_LINES,
  insightText,
  lastOpponentMove,
  openingNorms,
  pickBy,
  recentNotes,
  tailNotes,
  type CoachNote,
} from './messages.ts'

/** The study has several good moves here and this line practises a less usual one. */
export interface ForkInfo {
  count: number
  /** Square glowing for free (the piece, or the target square when the same piece has another good move). */
  square: string
  target: boolean
}

export interface CoachBubbleProps {
  state: TrainerState
  feedback: Feedback | null
  insight: MistakeInsight | null
  learnMode: boolean
  /** Chapter intro (shown before the first move). */
  intro?: string
  rep?: Repertoire | null
  mode?: TrainerMode
  fork?: ForkInfo | null
  /** The line is complete and its "what happens next" tail is (about to be) shown. */
  tailShowing?: boolean
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
  /** Small extra line above the notes ("🌿 New branch! …"). */
  tag?: ReactNode
}

function notesKey(notes: CoachNote[]): string {
  return notes.map((n) => n.id).join(',')
}

/**
 * A line that starts differently from the opening's usual start (1.f4 / 1.d4 in
 * the Sicilian, or the kid's side answering 1.e4 with something else): say so.
 */
function surprise({ state, rep, mode }: CoachBubbleProps): ReactNode | null {
  if (!rep || state.phase !== 'userToMove') return null
  const u = state.config.userColor
  const norms = openingNorms(rep)
  const first = state.line.moves[0]
  const firstUserIdx = state.line.moves.findIndex((m) => m.color === u)
  // Only at the kid's FIRST move of the line.
  if (firstUserIdx < 0 || state.ply !== firstUserIdx) return null
  if (first && first.color !== u && norms.firstOpponent && first.uci !== norms.firstOpponent.uci) {
    return (
      <>
        Surprise! Your opponent didn't play <b className="coach__move">{moveLabel(norms.firstOpponent)}</b> — your coach has an answer for
        this too!
      </>
    )
  }
  // In Coach's Choice any of the coach's first moves is accepted, so nothing to warn about there.
  const exp = state.line.moves[firstUserIdx]
  const usual = norms.firstUser.get(positionKey(exp.fenBefore))
  if (mode !== 'random' && usual && usual.uci !== exp.uci) {
    const opp = lastOpponentMove(state)
    return opp ? (
      <>
        This time your coach answers <b className="coach__move">{moveLabel(opp)}</b> with <b className="coach__move">{moveLabel(exp)}</b>!
      </>
    ) : (
      <>
        This time your coach starts with <b className="coach__move">{moveLabel(exp)}</b>!
      </>
    )
  }
  return null
}

/**
 * The opponent just left the chapter's first choice (docs/practice-structure.md §2.6):
 * "🌿 New branch! Instead of 3.exd5 they play 3.e5." Not on the line's first opponent move
 * (surprise() covers that) and not for a move a branch start played for the kid.
 */
function newBranch({ state, rep }: CoachBubbleProps): ReactNode | null {
  if (!rep || state.phase !== 'userToMove' || state.ply <= state.startPly) return null
  const opp = lastOpponentMove(state)
  if (!opp) return null
  const u = state.config.userColor
  if (state.line.moves.findIndex((m) => m.color !== u) === state.ply - 1) return null
  const alt = mainAlternative(rep, opp)
  if (!alt) return null
  return (
    <>
      🌿 New branch! Instead of <b className="coach__move">{moveLabel(alt)}</b> they play <b className="coach__move">{moveLabel(opp)}</b>.
    </>
  )
}

function buildModel(props: CoachBubbleProps): Model {
  const m = buildBaseModel(props)
  // The new-branch tag rides along with Hoot's usual "your move" messages (not with a mistake,
  // a hint or the end of the line, which replace them).
  if (m.tone === 'error' || props.state.phase !== 'userToMove' || props.feedback?.kind === 'hint' || props.feedback?.kind === 'other-line') return m
  const tag = newBranch(props)
  return tag ? { ...m, tag } : m
}

function buildBaseModel(props: CoachBubbleProps): Model {
  const { state, feedback: fb, insight, learnMode, intro, fork, tailShowing } = props
  const notes = recentNotes(state)
  const opp = lastOpponentMove(state)

  if (state.phase === 'wrongMove') {
    if (fb?.kind === 'known-bad') {
      const r = fb.refutation
      const coach = fb.node?.comment
      // ?! = dubious, not losing: gentler, and no "your opponent can answer…".
      const severe = !!fb.node && (isBlunder(fb.node) || !!r)
      return {
        key: `kb${fb.id}`,
        tone: 'error',
        speaker: '🦉',
        headline: severe ? 'Oops! That move is a known mistake.' : 'Hmm — your coach knows a better move here.',
        body: (
          <>
            {coach && <span className="coach__insight">Coach says: “{coach}” </span>}
            {severe && r ? (
              <>
                Watch out — your opponent can answer <b className="coach__move">{moveLabel(r)}</b> (the red arrow). Take it back and find a
                better move!
              </>
            ) : (
              "Take it back and let's find the coach's move!"
            )}
          </>
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
    if (tailShowing && state.line.tail) {
      const shown = tailNotes(state)
      if (state.line.tailIsTrap) {
        const tail = state.line.tail
        const bad = tail.find((m) => m.color === state.config.userColor)
        const answer = bad ? tail[tail.indexOf(bad) + 1] : undefined
        return {
          key: `trap${state.tailPly}`,
          tone: 'gold',
          speaker: '🦉',
          headline: '🎉 Line complete! Now watch out for this trap:',
          body: bad ? (
            <>
              Don't play <b className="coach__move">{moveLabel(bad)}</b> here
              {answer ? (
                <>
                  {' '}
                  — <b className="coach__move">{moveLabel(answer)}</b> punishes it!
                </>
              ) : (
                ' — your coach marked it as a mistake!'
              )}
            </>
          ) : undefined,
          notes: shown,
        }
      }
      return {
        key: `tail${state.tailPly}`,
        tone: 'success',
        speaker: '🦉',
        headline: '🎉 Line complete! Here is how your coach goes on:',
        notes: shown,
      }
    }
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

  // Branch start (lap mode): the shared start was played for the kid; first move of the run.
  if (state.startPly > 0 && state.ply === state.startPly && state.phase === 'userToMove') {
    let body: ReactNode
    if (learnMode) body = '👀 Follow the yellow arrow — and try to remember it!'
    else if (fork && state.hintLevel === 0)
      body = (
        <span className="coach__tip">
          🔀 Your study has {fork.count} good moves here — {fork.target ? 'the glowing square shows where this line goes. ✨' : 'the glowing piece is the one this line moves. ✨'}
        </span>
      )
    else
      body = opp ? (
        <>
          Your opponent played <b className="coach__move">{moveLabel(opp)}</b>. What's your move? 🤔
        </>
      ) : (
        "Your move! What's next? 🤔"
      )
    return { key: `skip${state.line.id}${state.hintLevel}`, tone: 'info', speaker: '🦉', headline: SKIP_AHEAD_LINE, body, notes }
  }

  const surpriseText = surprise(props)
  if (surpriseText) {
    return { key: `sur${state.line.id}`, tone: 'gold', speaker: '🦉', headline: surpriseText, notes }
  }

  if (fork && state.phase === 'userToMove' && !learnMode && state.hintLevel === 0) {
    return {
      key: `fork${state.ply}${fork.square}`,
      tone: 'info',
      speaker: '🦉',
      headline: `🔀 Your study has ${fork.count} good moves here — this line practises a different one than usual.`,
      body: (
        <span className="coach__tip">
          {fork.target ? 'The glowing square shows where this line goes. ✨' : 'The glowing piece is the one this line moves. ✨'}
        </span>
      ),
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
      {m.tag && <div className="coach__tag">{m.tag}</div>}
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
