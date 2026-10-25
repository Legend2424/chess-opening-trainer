// Screen 4 — the trainer (DESIGN.md §6.4): big board + Hoot's panel.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Arrow, BoardThemeId, Highlight, Line, PieceSetId, Screen } from '../types.ts'
import { useNav } from '../app/nav.tsx'
import { useRepertoire } from '../chess/useRepertoires.ts'
import { bookMovesAt, isDubious } from '../chess/repertoire.ts'
import { isDue } from '../chess/scheduler.ts'
import { openingById } from '../data/openings.ts'
import { actions, useActiveProfile } from '../store/appStore.ts'
import { currentStreak } from '../store/profileOps.ts'
import { levelForXp } from '../store/levels.ts'
import { titleText } from '../store/catalog.ts'
import { setMuted } from '../fx/sound.ts'
import { ChessBoard } from '../components/ChessBoard.tsx'
import { Button, Chip, Modal, TopBar, cx } from '../components/ui/index.ts'
import { expectedNode, shownNode, tailPending, userMoveIndex } from '../trainer/trainerReducer.ts'
import { useTrainer } from '../trainer/useTrainer.ts'
import { TIER_META } from '../chess/lineTiers.ts'
import { CoachBubble, type ForkInfo } from './trainer/CoachBubble.tsx'
import { ProgressDots, playedMarks } from './trainer/ProgressDots.tsx'
import { MoveList } from './trainer/MoveList.tsx'
import { LineCompleteModal, needsFullCard } from './trainer/LineCompleteModal.tsx'
import { RoundCompleteModal } from './trainer/RoundCompleteModal.tsx'
import { LEAVE_ROUND_LINE, REQUEUE_LINE, displayLineName } from './trainer/messages.ts'
import { formatClock, lineNameBesideTier } from './trainer/practice.ts'
import './Trainer.css'

type TrainParams = Extract<Screen, { name: 'train' }>

const NO_ARROWS: Arrow[] = []
const NO_HIGHLIGHTS: Highlight[] = []
/** From this many of the kid's own moves played, Restart asks for a second tap. */
const RESTART_CONFIRM_FROM = 2
/** Main-line round: the compact result card goes on by itself after this long. */
const ROUND_AUTO_NEXT_MS = 2500

/** "⏱ 2:41" — ticks once a second on its own (the board doesn't re-render with it). */
function RoundClock({ startedAt, doneMs }: { startedAt: number; doneMs: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (doneMs !== null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [doneMs])
  const ms = doneMs ?? Math.max(0, now - startedAt)
  return (
    <span className="trainer__clock num" role="timer" aria-label={`Round time ${formatClock(ms)}`}>
      ⏱ {formatClock(ms)}
    </span>
  )
}

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
    const node = shownNode(state)
    const coach = node ? node.arrows : state.ply === 0 ? (chapter?.introArrows ?? []) : []
    // Never let a coach arrow give away the user's next move (unless they asked for it).
    let secret: { from: string; to: string }[] = []
    if (!reveal) {
      if (state.phase === 'userToMove') secret = bookMovesAt(rep, state.fen).filter((n) => n.color === t.userColor)
      else if (state.phase === 'opponentToMove') {
        const up = state.line.moves[state.ply + 1]
        if (up && up.color === t.userColor) secret = [up]
      }
    } else if (expected) {
      // The answer is shown (yellow): other study moves drawn green next to it would only confuse.
      secret = bookMovesAt(rep, state.fen).filter((n) => n.color === t.userColor && n.uci !== expected.uci)
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
    const node = shownNode(state)
    if (node) return node.highlights
    return state.ply === 0 ? (chapter?.introHighlights ?? NO_HIGHLIGHTS) : NO_HIGHLIGHTS
  }, [state, chapter])

  // In-order / chapter practice where the study has 2+ good moves and this line wants the
  // less usual one: say so BEFORE the move (and glow it for free), instead of refusing the
  // other good move as "a different line" afterwards.
  const fork = useMemo<ForkInfo | null>(() => {
    if (!state || !rep || !expected || state.phase !== 'userToMove' || params.mode === 'random') return null
    const good = bookMovesAt(rep, state.fen).filter((n) => n.color === t.userColor && !isDubious(n))
    if (good.length < 2 || good[0].uci === expected.uci || !good.some((n) => n.uci === expected.uci)) return null
    // Same piece, other square: glow the target square, else the piece.
    const samePiece = good.some((n) => n.uci !== expected.uci && n.from === expected.from)
    return { count: good.length, square: samePiece ? expected.to : expected.from, target: samePiece }
  }, [state, rep, expected, params.mode, t.userColor])

  let hintSquare: string | null = null
  if (state && state.phase === 'userToMove' && expected && !t.learnMode) {
    if (state.hintLevel >= 1) hintSquare = expected.from
    else if (fork) hintSquare = fork.square
  }

  // Coach's Choice: which chapters the opponent may still steer into.
  const lineById = useMemo(() => new Map<string, Line>((rep?.lines ?? []).map((l) => [l.id, l])), [rep])

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
  // The kid's own moves played in this run (a branch start's skipped moves don't count).
  const movesPlayed = state ? userMoveIndex(state) - t.skippedUserMoves : 0
  const onRestartTile = () => {
    if (!state) return
    if (movesPlayed < RESTART_CONFIRM_FROM || restartArmed) {
      setArmedFor(null)
      t.restart()
    } else setArmedFor(restartKey)
  }

  // ---- main-line round ---------------------------------------------------------------
  const round = t.round
  const inRound = params.mode === 'main'
  const [roundOpen, setRoundOpen] = useState(false)
  // Coins the lines of the current round earned (for the round-complete card).
  const roundCoins = useRef<{ roundId: number; coins: number; seen: number }>({ roundId: -1, coins: 0, seen: -1 })
  useEffect(() => {
    const o = t.outcome
    if (!inRound || !o || !round) return
    const rc = roundCoins.current
    if (rc.seen === o.id) return
    const base = rc.roundId === round.startedAt ? rc.coins : 0
    roundCoins.current = { roundId: round.startedAt, coins: base + Math.max(0, o.reward.coins), seen: o.id }
  }, [inRound, t.outcome, round])
  /** Leaving now would abandon a round that is under way (finished lines still count). */
  const roundUnderWay = inRound && !!round && !round.result && !!state && (round.pos > 0 || state.phase === 'complete' || movesPlayed >= 1)

  // ---- navigation ------------------------------------------------------------------
  // Leaving a few moves into a line (or a round under way) asks first.
  const [askLeave, setAskLeave] = useState(false)
  const exit = () => {
    if (roundUnderWay) setAskLeave(true)
    else if (state && state.phase !== 'complete' && movesPlayed >= RESTART_CONFIRM_FROM) setAskLeave(true)
    else nav.back()
  }
  /** "Next": in a round, the last line opens the round results instead. */
  const onNext = () => {
    if (inRound && t.outcome?.roundDone && round?.result) {
      t.closeComplete()
      setRoundOpen(true)
      return
    }
    t.nextLine()
  }
  const anotherRound = () => {
    setRoundOpen(false)
    t.newRound()
  }
  const playOn = () => {
    if (!def) return
    const fen = t.outcome?.fen ?? state?.fen
    // Replace (not push): "Back" from the game then goes to the opening, not to a
    // trainer that has already moved on to its next line.
    nav.replace({ name: 'play', fen, userColor: def.side, openingId: def.id })
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
  // Stats as they were when this run started: finishing the line mustn't flip NEW → Review.
  const stats = t.runStats[line.id]
  // "New" until the first run without learn mode (that run still earns the New-line bonus).
  const isNew = !stats || stats.completions - (stats.learnCompletions ?? 0) <= 0
  const isReview = !isNew && isDue(stats, now)
  // Coach's Choice hides where the robot is heading: the chapter only once it is certain,
  // no line name and no total until the very end.
  const mystery = params.mode === 'random' && phase !== 'complete'
  let chapterTitle = line.chapterTitle
  let lineName = displayLineName(line, state.ply, phase === 'complete', t.userColor)
  if (mystery) {
    const chapters = new Set(state.candidates.map((id) => lineById.get(id)?.chapterId ?? line.chapterId))
    chapterTitle = chapters.size <= 1 ? line.chapterTitle : 'Mystery line ❓'
    lineName = ''
  }
  // A branch start played the first moves for the kid: dots and count show only the moves to play.
  const marks = playedMarks(state.userMoveMarks)
  const current = phase === 'complete' ? -1 : userMoveIndex(state) - t.skippedUserMoves
  const doneMoves = marks.filter((m) => m !== 'pending').length
  const showTotal = !mystery || state.candidates.length <= 1
  const tier = TIER_META[line.tier ?? 'deep']
  // Beside the tier chip, "Main line" would just repeat it ("… · Main line ⭐ Main line").
  if (!mystery) lineName = lineNameBesideTier(lineName, line.tier)

  let modeLabel: string
  if (params.mode === 'random') modeLabel = "🎲 Coach's Choice"
  else if (params.mode === 'main') {
    modeLabel = round
      ? `⭐ ${round.pos >= round.size ? 'Fix-up' : 'Main lines'} · ${Math.min(round.pos + 1, round.order.length)}/${round.order.length}`
      : '⭐ Main lines'
  } else if (params.mode === 'lap') modeLabel = t.lap ? `🌳 Lap ${t.lap.n} · ${t.lap.done}/${t.lap.total}` : '🌳 Lap'
  else if (t.lineIndex >= 0) modeLabel = `${params.mode === 'chapter' ? '🎯' : '📚'} Line ${t.lineIndex + 1} of ${t.pool.length}`
  else modeLabel = params.mode === 'chapter' ? '🎯 Chapter' : '📚 In order'

  // Main-line round: the compact card, unless something special happened; a line that
  // goes to the end of the round says so.
  const outcome = t.outcome
  const lineVariant = inRound && outcome && !needsFullCard(outcome) ? 'compact' : 'full'
  let lineNote: string | undefined
  if (inRound && outcome && round && !outcome.perfect && round.requeued.includes(outcome.line.id) && round.order.indexOf(outcome.line.id) === round.pos) {
    lineNote = REQUEUE_LINE
  }

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
  } else if (phase === 'complete' && inRound) {
    // No "Try again" or "Play on" during a round.
    controls = (
      <div className="trainer__controls trainer__controls--tiles trainer__controls--two">
        {t.outcome?.roundDone ? (
          <Button variant="primary" size="md" shine icon="🏁" onClick={onNext}>
            Results
          </Button>
        ) : (
          <Button variant="primary" size="md" shine icon="▶" onClick={onNext}>
            Next
          </Button>
        )}
        {t.outcome?.roundDone ? (
          <Button variant="secondary" size="md" icon="←" onClick={() => nav.back()}>
            Back
          </Button>
        ) : (
          <Button variant="secondary" size="md" icon="🚪" onClick={() => setAskLeave(true)}>
            End round
          </Button>
        )}
      </div>
    )
  } else if (phase === 'complete') {
    controls = (
      // Three tiles like Hint / Restart / Learn, so "Next line" never gets squeezed.
      <div className="trainer__controls trainer__controls--tiles">
        <Button variant="primary" size="md" shine icon="▶" onClick={t.nextLine}>
          {t.outcome?.wrapped ? 'Start again' : 'Next line'}
        </Button>
        <Button variant="secondary" size="md" icon="↻" onClick={t.restart}>
          Try again
        </Button>
        <Button variant="secondary" size="md" icon="🤖" onClick={playOn} aria-label="Play on against the robot">
          Play on
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
              {inRound && round && <RoundClock key={round.startedAt} startedAt={round.startedAt} doneMs={round.result ? round.result.ms : null} />}
              <span className="spacer" />
              {/* ⚡ for the combo: 🔥 is the daily streak (top bar). */}
              <span
                className={cx('trainer__combo', t.combo >= 3 && 'is-hot', t.combo === 0 && 'is-off')}
                title="Perfect lines in a row"
                role="img"
                aria-label={`Combo: ${t.combo} perfect lines in a row`}
                key={`combo${t.combo}`}
              >
                <span aria-hidden>⚡</span>x{t.combo}
              </span>
              {t.sessionCoins > 0 && (
                <span className="trainer__session" title="Coins earned this session">
                  🪙 +{t.sessionCoins}
                </span>
              )}
            </div>
            <div className="trainer__title">
              <span className="trainer__chapter">{chapterTitle}</span>
              {lineName && (
                <>
                  <span className="trainer__sep" aria-hidden>
                    ·
                  </span>
                  <span className="trainer__line-name">{lineName}</span>
                </>
              )}
              {/* Coach's Choice keeps the tier a mystery too, until the line is complete. */}
              {!mystery && (
                <Chip tone="violet" icon={tier.emoji} className="trainer__badge trainer__tier">
                  {tier.name}
                </Chip>
              )}
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
              {/* While the robot can still pick a longer or shorter line, don't show how many moves are left. */}
              <ProgressDots marks={showTotal ? marks : marks.slice(0, doneMoves + 1)} current={current} />
              <span className="trainer__count num">{showTotal ? `${doneMoves}/${marks.length}` : `${doneMoves} ✓`}</span>
            </div>
          </div>

          <div className="trainer__talk">
            <CoachBubble
              state={state}
              feedback={t.feedback}
              insight={t.insight}
              learnMode={t.learnMode}
              intro={chapter?.intro}
              rep={rep}
              mode={params.mode}
              fork={fork}
              tailShowing={state.tailPly > 0 || tailPending(state)}
            />
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
        onNext={onNext}
        onRetry={t.restart}
        onPlayOn={playOn}
        onHome={goHome}
        onClose={t.closeComplete}
        variant={lineVariant}
        autoNextMs={lineVariant === 'compact' ? ROUND_AUTO_NEXT_MS : undefined}
        mode={params.mode}
        onEndRound={() => setAskLeave(true)}
        stats={outcome ? profile.lineStats[outcome.line.id] : undefined}
        note={lineNote}
      />

      <RoundCompleteModal
        open={inRound && roundOpen && !!round?.result}
        round={round}
        lineCoins={round && roundCoins.current.roundId === round.startedAt ? roundCoins.current.coins : 0}
        effect={profile.equipped.effect}
        onAgain={anotherRound}
        onBack={() => nav.back()}
      />

      <Modal
        open={askLeave}
        onClose={() => setAskLeave(false)}
        size="sm"
        title={roundUnderWay ? 'Leave the round? 🚪' : 'Leave this line? 🚪'}
        footerCenter
        footer={
          <>
            <Button variant="primary" icon="♟️" onClick={() => setAskLeave(false)} data-autofocus>
              Keep playing
            </Button>
            <Button
              variant="secondary"
              icon="🚪"
              onClick={() => {
                setAskLeave(false)
                nav.back()
              }}
            >
              Leave
            </Button>
          </>
        }
      >
        <p className="trainer__confirm">
          {roundUnderWay
            ? LEAVE_ROUND_LINE
            : params.mode === 'random'
              ? 'This line stops here — next time Hoot picks a line for you again.'
              : params.mode === 'lap'
                ? "You'll start this line again next time."
                : "You'll start this line again from move 1 next time."}
        </p>
      </Modal>
    </div>
  )
}
