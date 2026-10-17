// Screen 4 — the trainer (DESIGN.md §6.4): big board + Hoot's panel.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Arrow, BoardThemeId, Highlight, PieceSetId, Screen } from '../types.ts'
import { useNav } from '../app/nav.tsx'
import { useRepertoire } from '../chess/useRepertoires.ts'
import { bookMovesAt } from '../chess/repertoire.ts'
import { isDue } from '../chess/scheduler.ts'
import { openingById } from '../data/openings.ts'
import { actions, useActiveProfile } from '../store/appStore.ts'
import { currentStreak } from '../store/profileOps.ts'
import { levelForXp } from '../store/levels.ts'
import { titleText } from '../store/catalog.ts'
import { setMuted } from '../fx/sound.ts'
import { ChessBoard } from '../components/ChessBoard.tsx'
import { Button, Chip, TopBar, cx } from '../components/ui/index.ts'
import { currentNode, expectedNode, userMoveIndex } from '../trainer/trainerReducer.ts'
import { useTrainer } from '../trainer/useTrainer.ts'
import { CoachBubble } from './trainer/CoachBubble.tsx'
import { ProgressDots } from './trainer/ProgressDots.tsx'
import { MoveList } from './trainer/MoveList.tsx'
import { LineCompleteModal } from './trainer/LineCompleteModal.tsx'
import { displayLineName } from './trainer/messages.ts'
import './Trainer.css'

type TrainParams = Extract<Screen, { name: 'train' }>

const NO_ARROWS: Arrow[] = []
const NO_HIGHLIGHTS: Highlight[] = []
/** From this many of the kid's own moves played, Restart asks for a second tap. */
const RESTART_CONFIRM_FROM = 2

export default function Trainer({ params }: { params: TrainParams }) {
  const nav = useNav()
  const profile = useActiveProfile()
  const def = openingById(params.openingId)
  const { status: repStatus, rep, error } = useRepertoire(params.openingId)
  const t = useTrainer(rep, { mode: params.mode, chapterId: params.chapterId, learnMode: params.learnMode })
  const { state } = t

  // The profile's sound setting is the source of truth for the global mute.
  const soundOn = profile?.settings.sound ?? true
  useEffect(() => {
    setMuted(!soundOn)
  }, [soundOn])

  const chapter = useMemo(() => (rep && state ? rep.chapters.find((c) => c.id === state.line.chapterId) : undefined), [rep, state])
  const chapterForMode = rep && params.chapterId ? rep.chapters.find((c) => c.id === params.chapterId) : undefined

  // ---- board decorations ---------------------------------------------------------
  const expected = state ? expectedNode(state) : null
  const reveal = !!state && state.phase === 'userToMove' && (t.learnMode || state.hintLevel >= 2)

  const arrows = useMemo<Arrow[]>(() => {
    if (!state || !rep) return NO_ARROWS
    if (state.phase === 'wrongMove') {
      const r = state.feedback?.kind === 'known-bad' ? state.feedback.refutation : undefined
      return r ? [{ from: r.from, to: r.to, color: 'red' }] : NO_ARROWS
    }
    const node = currentNode(state)
    const coach = node ? node.arrows : state.ply === 0 ? (chapter?.introArrows ?? []) : []
    // Never let a coach arrow give away the user's next move (unless they asked for it).
    let secret: { from: string; to: string }[] = []
    if (!reveal) {
      if (state.phase === 'userToMove') secret = bookMovesAt(rep, state.fen).filter((n) => n.color === t.userColor)
      else if (state.phase === 'opponentToMove') {
        const up = state.line.moves[state.ply + 1]
        if (up && up.color === t.userColor) secret = [up]
      }
    }
    const out: Arrow[] = []
    for (const a of coach) {
      if (secret.some((s) => s.from === a.from && s.to === a.to)) continue
      if (reveal && expected && a.from === expected.from && a.to === expected.to) continue
      out.push(a)
    }
    if (reveal && expected) out.push({ from: expected.from, to: expected.to, color: 'yellow' })
    return out
  }, [state, rep, chapter, reveal, expected, t.userColor])

  const highlights = useMemo<Highlight[]>(() => {
    if (!state || state.phase === 'wrongMove') return NO_HIGHLIGHTS
    const node = currentNode(state)
    if (node) return node.highlights
    return state.ply === 0 ? (chapter?.introHighlights ?? NO_HIGHLIGHTS) : NO_HIGHLIGHTS
  }, [state, chapter])

  const hintSquare = state && state.phase === 'userToMove' && state.hintLevel >= 1 && expected && !t.learnMode ? expected.from : null

  // Tapping the board while a wrong move is shown takes it back (ignoring the
  // tail of the tap/drag that made the move).
  const wrongShownAt = useRef(0)
  useEffect(() => {
    if (state?.phase === 'wrongMove') wrongShownAt.current = Date.now()
  }, [state?.phase, state?.feedback?.id])

  // Restart once a few moves are in: the first tap asks "Sure?", the second
  // restarts. Disarms after 3 s or when the kid does anything else (new feedback).
  const restartKey = state ? `${state.line.id}|${state.feedbackSeq}` : ''
  const [armedFor, setArmedFor] = useState<string | null>(null)
  const restartArmed = armedFor !== null && armedFor === restartKey
  useEffect(() => {
    if (armedFor === null) return
    const tm = window.setTimeout(() => setArmedFor(null), 3000)
    return () => window.clearTimeout(tm)
  }, [armedFor])
  const onRestartTile = () => {
    if (!state) return
    if (userMoveIndex(state) < RESTART_CONFIRM_FROM || restartArmed) {
      setArmedFor(null)
      t.restart()
    } else setArmedFor(restartKey)
  }

  // ---- navigation ------------------------------------------------------------------
  const exit = () => nav.back()
  const playOn = () => {
    if (!def) return
    const fen = t.outcome?.fen ?? state?.fen
    nav.go({ name: 'play', fen, userColor: def.side, openingId: def.id })
  }
  const goHome = () => nav.reset({ name: 'home' })

  if (!profile) return null

  const now = Date.now()
  const topBar = (
    <TopBar
      onBack={exit}
      backLabel="Back to the opening"
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
      center={def ? <span className="trainer__topbar-title">{def.emoji} {def.name}</span> : undefined}
    />
  )

  // ---- loading / error / empty states ------------------------------------------------
  if (!def || repStatus === 'error' || t.status !== 'ready' || !state || !rep) {
    let body: ReactNode
    if (!def) {
      body = (
        <>
          <div className="trainer-msg__emoji">🤷</div>
          <h2>Hmm, I can't find that opening.</h2>
          <Button size="lg" icon="🏠" onClick={goHome}>
            Home
          </Button>
        </>
      )
    } else if (repStatus === 'error') {
      body = (
        <>
          <div className="trainer-msg__emoji">😵</div>
          <h2>Oh no! I couldn't load the opening lines.</h2>
          {error && <p className="muted">{error}</p>}
          <div className="row row--center row--wrap">
            <Button size="lg" icon="↻" onClick={() => window.location.reload()}>
              Try again
            </Button>
            <Button size="lg" variant="secondary" icon="←" onClick={exit}>
              Back
            </Button>
          </div>
        </>
      )
    } else if (t.status === 'empty') {
      body = (
        <>
          <div className="trainer-msg__emoji">📭</div>
          <h2>{chapterForMode ? `“${chapterForMode.title}” has no lines yet.` : 'There are no lines to practise here yet.'}</h2>
          <p className="muted">Ask a grown-up to check the training settings in the Parent zone.</p>
          <Button size="lg" icon="←" onClick={exit}>
            Back
          </Button>
        </>
      )
    } else {
      body = (
        <>
          <div className="trainer-msg__emoji anim-float">🦉</div>
          <h2>Setting up the board…</h2>
          <div className="trainer-msg__spinner anim-spin" aria-hidden />
        </>
      )
    }
    return (
      <div className="screen trainer game-ui">
        {topBar}
        <div className="trainer-msg card">{body}</div>
      </div>
    )
  }

  // ---- ready ----------------------------------------------------------------------
  const { phase } = state
  const line = state.line
  const stats = profile.lineStats[line.id]
  const isNew = !stats || stats.completions === 0
  const isReview = !isNew && isDue(stats, now)
  const lineName = displayLineName(line, state.ply, phase === 'complete', t.userColor)
  const current = phase === 'complete' ? -1 : userMoveIndex(state)
  const doneMoves = state.userMoveMarks.filter((m) => m !== 'pending').length

  let modeLabel: string
  if (params.mode === 'random') modeLabel = "🎲 Coach's Choice"
  else if (t.lineIndex >= 0) modeLabel = `${params.mode === 'chapter' ? '🎯' : '📚'} Line ${t.lineIndex + 1} of ${t.pool.length}`
  else modeLabel = params.mode === 'chapter' ? '🎯 Chapter' : '📚 In order'

  const hintPips = (
    <span className="trainer__pips" aria-hidden>
      <span className={cx('trainer__pip', state.hintLevel >= 1 && 'is-on')} />
      <span className={cx('trainer__pip', state.hintLevel >= 2 && 'is-on')} />
    </span>
  )

  const learnBtn = (
    <Button
      variant={t.learnMode ? 'success' : 'secondary'}
      size="md"
      icon="👀"
      className={cx('trainer__learn', t.learnMode && 'is-on')}
      aria-pressed={t.learnMode}
      aria-label={t.learnMode ? 'Show me the moves: on' : 'Show me the moves: off'}
      title="Show me the moves"
      onClick={() => t.setLearnMode(!t.learnMode)}
    >
      Learn <span className="trainer__learn-state">{t.learnMode ? 'ON' : 'OFF'}</span>
    </Button>
  )

  let controls: ReactNode
  if (phase === 'wrongMove') {
    controls = (
      <div className="trainer__controls trainer__controls--wrong">
        {/* No Restart here: "Take it back" is THE action, and a look-alike ↻ next to it is an easy mis-tap. */}
        <Button variant="primary" size="lg" pulse icon="↩" className="trainer__takeback" onClick={t.takeBack}>
          Take it back
        </Button>
      </div>
    )
  } else if (phase === 'complete') {
    controls = (
      <div className="trainer__controls">
        <Button variant="primary" size="lg" shine icon="▶" className="trainer__grow" onClick={t.nextLine}>
          {t.outcome?.wrapped ? 'Start again' : 'Next line'}
        </Button>
        <Button variant="secondary" size="md" icon="↻" onClick={t.restart}>
          <span className="trainer__btn-text">Try again</span>
        </Button>
      </div>
    )
  } else {
    controls = (
      <div className="trainer__controls trainer__controls--tiles">
        <Button
          variant="gold"
          size="md"
          icon="💡"
          disabled={phase !== 'userToMove' || state.hintLevel >= 2 || t.learnMode}
          onClick={t.hint}
          aria-label={`Hint (${state.hintLevel} of 2 used)`}
        >
          {state.hintLevel === 1 ? 'More' : 'Hint'}
          {hintPips}
        </Button>
        <Button
          variant={restartArmed ? 'danger' : 'secondary'}
          size="md"
          icon="↻"
          className={cx('trainer__restart', restartArmed && 'is-armed')}
          onClick={onRestartTile}
          aria-label={restartArmed ? 'Tap again to restart this line from the start' : 'Restart this line'}
        >
          {restartArmed ? 'Sure?' : 'Restart'}
        </Button>
        {learnBtn}
      </div>
    )
  }

  return (
    <div className={cx('screen trainer game-ui', `trainer--${phase}`)} style={{ ['--opening-accent' as string]: def.accent }}>
      {topBar}
      <div className="layout-train trainer__layout">
        <div className="layout-train__board trainer__board">
          <ChessBoard
            fen={state.fen}
            orientation={def.side}
            interactive={phase === 'userToMove' && !t.showComplete}
            onMove={t.userMove}
            lastMove={state.lastMove}
            wrongMove={state.wrong ? { from: state.wrong.from, to: state.wrong.to } : null}
            hintSquare={hintSquare}
            arrows={arrows}
            highlights={highlights}
            shake={t.shake}
            boardTheme={profile.equipped.board as BoardThemeId}
            pieceSet={profile.equipped.pieces as PieceSetId}
            ariaLabel={`Chess board, you play ${def.side}.${phase === 'userToMove' ? ' Your move.' : ''}`}
          />
          {phase === 'wrongMove' && (
            <button
              type="button"
              className="trainer__board-tap"
              aria-label="Take the wrong move back"
              onClick={() => {
                if (Date.now() - wrongShownAt.current > 350) t.takeBack()
              }}
            />
          )}
        </div>

        <div className="layout-train__panel trainer__panel">
          <div className="trainer__head">
            <div className="trainer__head-top">
              <span className="trainer__mode">{modeLabel}</span>
              <span className="spacer" />
              <span
                className={cx('trainer__combo', t.combo >= 3 && 'is-hot', t.combo === 0 && 'is-off')}
                title="Perfect lines in a row"
                aria-label={`Combo: ${t.combo} perfect lines in a row`}
                key={`combo${t.combo}`}
              >
                <span aria-hidden>🔥</span>x{t.combo}
              </span>
              {t.sessionCoins > 0 && (
                <span className="trainer__session" title="Coins earned this session">
                  🪙 +{t.sessionCoins}
                </span>
              )}
            </div>
            <div className="trainer__title">
              <span className="trainer__chapter">{line.chapterTitle}</span>
              <span className="trainer__sep" aria-hidden>
                ·
              </span>
              <span className="trainer__line-name">{lineName}</span>
              {isNew && (
                <Chip tone="gold" icon="✨" className="trainer__badge">
                  NEW
                </Chip>
              )}
              {isReview && (
                <Chip tone="blue" icon="🧠" className="trainer__badge">
                  Review
                </Chip>
              )}
              {t.lineIsLearn && phase !== 'complete' && (
                <Chip tone="green" icon="👀" className="trainer__badge">
                  Learning
                </Chip>
              )}
            </div>
            <div className="trainer__progress">
              <ProgressDots marks={state.userMoveMarks} current={current} />
              <span className="trainer__count num">
                {doneMoves}/{state.userMoveMarks.length}
              </span>
            </div>
          </div>

          <div className="trainer__talk">
            <CoachBubble state={state} feedback={t.feedback} insight={t.insight} learnMode={t.learnMode} intro={chapter?.intro} />
          </div>

          <MoveList
            className="trainer__moves"
            startFen={line.startFen}
            history={state.history}
            wrong={state.wrong}
            userColor={t.userColor}
          />

          {controls}
        </div>
      </div>

      <LineCompleteModal
        open={t.showComplete}
        outcome={t.outcome}
        effect={profile.equipped.effect}
        streak={currentStreak(profile, now)}
        onNext={t.nextLine}
        onRetry={t.restart}
        onPlayOn={playOn}
        onHome={goHome}
        onClose={t.closeComplete}
      />
    </div>
  )
}
