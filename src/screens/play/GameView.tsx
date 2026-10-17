import { useEffect, useRef, useState, type ReactNode } from 'react'
import ChessBoard from '../../components/ChessBoard.tsx'
import { Button, Modal, SpeechBubble, toast } from '../../components/ui/index.ts'
import { actions } from '../../store/appStore.ts'
import { celebrate } from '../../fx/celebrate.ts'
import { sfx } from '../../fx/sound.ts'
import type { Arrow, BoardThemeId, PieceSetId, Profile } from '../../types.ts'
import { MoveList } from './MoveList.tsx'
import { PlayerRow } from './PlayerRow.tsx'
import { ResultModal, resultText, type GameOutcome } from './ResultModal.tsx'
import { bandFor } from './strength.ts'
import { restartApp, useComputerGame, useEngineLoadSlow, useEngineStatus, type GameSetup } from './useComputerGame.ts'

export interface GameViewProps {
  setup: GameSetup
  profile: Profile | null
  boardTheme: BoardThemeId
  pieceSet: PieceSetId
  /** Same settings, fresh game. */
  onPlayAgain: () => void
  /** Back to the setup panel. */
  onSetup: () => void
  /** Told whether an unfinished game the player has moved in is on the board (so leaving asks first). */
  onInProgress?: (inProgress: boolean) => void
}

/** Delay before the result pops up, so the last move can land first. */
const RESULT_DELAY_MS = 900

export function GameView({ setup, profile, boardTheme, pieceSet, onPlayAgain, onSetup, onInProgress }: GameViewProps) {
  const g = useComputerGame(setup)
  const engine = useEngineStatus()
  const loadSlow = useEngineLoadSlow(engine)

  const inProgress = !g.end && g.userMoved
  useEffect(() => {
    onInProgress?.(inProgress)
  }, [inProgress, onInProgress])
  useEffect(() => () => onInProgress?.(false), [onInProgress])
  const { userColor, rating } = setup
  const band = bandFor(rating)
  const robotSide = userColor === 'w' ? 'b' : 'w'

  const [outcome, setOutcome] = useState<GameOutcome | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [confirm, setConfirm] = useState<'resign' | 'new' | null>(null)
  const rewarded = useRef(false)

  // ---- game over: reward once, celebrate, show the result -----------------
  const end = g.end
  useEffect(() => {
    if (!end || rewarded.current) return
    rewarded.current = true
    setConfirm(null)
    let out: GameOutcome | null = null
    if (g.userMoved) {
      // Hints come from the full-strength engine and undo erases blunders, so an
      // assisted game pays the beginner rate whatever the slider says.
      const assisted = g.hintsUsed > 0 || g.undos > 0
      const r = actions.applyEngineGame(end.result, assisted ? Math.min(rating, 400) : rating, setup.id)
      out = r.ok ? r : null
    }
    setOutcome(out)
    if (end.result === 'win') sfx.complete()
    else if (end.result === 'draw') sfx.correct()
    const timer = window.setTimeout(() => {
      setShowResult(true)
      if (end.result === 'win') void celebrate(profile?.equipped.effect ?? 'confetti')
      if (out && out.coins > 0) sfx.coin()
      if (out?.levelUp) sfx.levelUp()
      out?.newAchievements.forEach((a) => toast.achievement(a.name, a.description, a.emoji))
    }, RESULT_DELAY_MS)
    return () => window.clearTimeout(timer)
    // Only the end of the game matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end])

  // ---- what the robot says ------------------------------------------------
  let bubbleTone: 'default' | 'success' | 'error' | 'info' | 'gold' = 'default'
  let bubble: ReactNode
  let bubbleKey = `m${g.moves.length}`
  if (end) {
    const t = resultText(end)
    bubble = `${t.emoji} ${t.title}`
    bubbleTone = end.result === 'win' ? 'gold' : end.result === 'draw' ? 'info' : 'default'
    bubbleKey = 'end'
  } else if (g.engineTurn && g.engineFailed) {
    bubbleTone = 'error'
    bubbleKey = 'fail'
    bubble = (
      <span className="play-bubble-row">
        <span>😴 The robot couldn't wake up.</span>
        <Button size="sm" variant="primary" icon="🔁" onClick={g.retryEngine}>
          Try again
        </Button>
      </span>
    )
  } else if (g.engineTurn && engine === 'loading' && loadSlow) {
    // The engine never finished loading (offline, worker crashed): only a reload helps.
    bubbleTone = 'error'
    bubbleKey = 'load-slow'
    bubble = (
      <span className="play-bubble-row">
        <span>😴 The robot is a real sleepyhead today. Check the Wi-Fi, then restart.</span>
        <Button size="sm" variant="primary" icon="🔄" onClick={restartApp}>
          Restart app
        </Button>
      </span>
    )
  } else if (g.engineTurn && g.stalled && g.stalls >= 2) {
    bubbleTone = 'error'
    bubbleKey = 'stall-deep'
    bubble = (
      <span className="play-bubble-row">
        <span>😴 The robot is fast asleep!</span>
        <Button size="sm" variant="primary" icon="🔄" onClick={restartApp}>
          Restart app
        </Button>
        <Button size="sm" variant="secondary" icon="⏰" onClick={g.retryEngine}>
          Try again
        </Button>
      </span>
    )
  } else if (g.engineTurn && g.stalled) {
    bubbleTone = 'error'
    bubbleKey = 'stall'
    bubble = (
      <span className="play-bubble-row">
        <span>💤 The robot dozed off…</span>
        <Button size="sm" variant="primary" icon="⏰" onClick={g.retryEngine}>
          Wake it up
        </Button>
      </span>
    )
  } else if (g.engineTurn && engine !== 'ready') {
    bubbleKey = 'loading'
    bubble = (
      <span>
        Waking up the robot… <span className="play-muted">(first time can take a few seconds)</span>
      </span>
    )
  } else if (g.engineTurn) {
    bubbleKey = 'think'
    bubble = (
      <span className="play-thinking">
        🤖 thinking<span className="play-dots" aria-hidden><i>.</i><i>.</i><i>.</i></span>
      </span>
    )
  } else if (g.hintBusy) {
    bubbleTone = 'gold'
    bubbleKey = 'hint-busy'
    bubble = '💡 Looking for a good move…'
  } else if (g.hint) {
    bubbleTone = 'gold'
    bubbleKey = `hint-${g.hint.san}`
    bubble = (
      <span>
        💡 Try <b>{g.hint.san}</b> — follow the yellow arrow!
      </span>
    )
  } else if (g.hintFailed) {
    bubbleTone = 'info'
    bubbleKey = 'hint-none'
    bubble = "💡 Hmm, I couldn't find a hint — try again!"
  } else if (g.inCheck) {
    bubbleTone = 'error'
    bubble = 'Check! Keep your king safe 👑'
  } else if (g.lastMove && g.lastMove.color !== userColor) {
    bubble = (
      <span>
        I played <b>{g.lastMove.san}</b>. Your move!
      </span>
    )
  } else {
    bubble = g.moves.length === 0 ? 'You go first — make your move! ♟️' : 'Your move!'
  }

  const arrows: Arrow[] = g.hint ? [{ from: g.hint.from, to: g.hint.to, color: 'yellow' }] : []
  const userTurn = !end && !g.engineTurn
  const hintDisabled = !userTurn || g.hintBusy || !!g.hint || engine !== 'ready'

  const startNew = () => {
    if (!end && g.userMoved) setConfirm('new')
    else onSetup()
  }

  return (
    <div className="layout-train play-game">
      <div className="layout-train__board">
        <ChessBoard
          fen={g.fen}
          orientation={userColor === 'w' ? 'white' : 'black'}
          interactive={userTurn}
          onMove={g.userMove}
          lastMove={g.lastMove ? [g.lastMove.from, g.lastMove.to] : null}
          arrows={arrows}
          hintSquare={g.hint?.from ?? null}
          boardTheme={boardTheme}
          pieceSet={pieceSet}
        />
      </div>

      <div className="layout-train__panel play-panel">
        <PlayerRow
          className="play-player--robot"
          avatar="🤖"
          name="Robot"
          sub={
            <>
              {band.emoji} {band.name} · <span className="num">{rating}</span>
            </>
          }
          side={robotSide}
          startFen={setup.startFen}
          moves={g.moves}
          fen={g.fen}
          pieceSet={pieceSet}
          active={g.engineTurn}
          status={
            g.engineTurn && !g.engineFailed && !g.stalled && !(engine === 'loading' && loadSlow) ? (
              <span className="play-think-chip">thinking…</span>
            ) : null
          }
          accent="#64748b"
        />

        <SpeechBubble className="play-bubble" speaker="🤖" speakerSize={40} tone={bubbleTone} animateKey={bubbleKey} bob={g.engineTurn}>
          {bubble}
        </SpeechBubble>

        <MoveList className="play-panel__moves" startFen={setup.startFen} moves={g.moves} />

        <PlayerRow
          className="play-player--you"
          avatar={profile?.avatar ?? '🙂'}
          name={profile?.name ?? 'You'}
          sub={userColor === 'w' ? 'You play White' : 'You play Black'}
          side={userColor}
          startFen={setup.startFen}
          moves={g.moves}
          fen={g.fen}
          pieceSet={pieceSet}
          active={userTurn}
          accent={profile?.color}
        />

        {end ? (
          <div className="play-actions play-actions--over">
            <Button variant="primary" icon="▶" onClick={onPlayAgain} shine>
              Play again
            </Button>
            <Button variant="secondary" icon="🏁" onClick={() => setShowResult(true)}>
              Result
            </Button>
            <Button variant="secondary" icon="⚙️" onClick={onSetup}>
              New game
            </Button>
          </div>
        ) : (
          <div className="play-actions">
            <Button variant="info" icon={g.hintBusy ? <span className="anim-spin play-spin">⏳</span> : '💡'} onClick={() => void g.requestHint()} disabled={hintDisabled}>
              Hint
            </Button>
            <Button variant="secondary" icon="↩" onClick={g.undo} disabled={!g.canUndo}>
              Undo
            </Button>
            <Button variant="secondary" icon="🏳️" onClick={() => setConfirm('resign')} disabled={!!end}>
              Resign
            </Button>
            <Button variant="secondary" icon="✨" onClick={startNew}>
              New game
            </Button>
          </div>
        )}
      </div>

      <ResultModal
        open={showResult && !!end}
        end={end}
        outcome={outcome}
        userMoved={g.userMoved}
        hintsUsed={g.hintsUsed}
        undos={g.undos}
        onPlayAgain={onPlayAgain}
        onChangeSettings={onSetup}
        onClose={() => setShowResult(false)}
      />

      <Modal
        open={confirm === 'resign' && !end}
        onClose={() => setConfirm(null)}
        size="sm"
        title="Give up this game? 🏳️"
        footerCenter
        footer={
          <>
            <Button variant="primary" icon="💪" onClick={() => setConfirm(null)} data-autofocus>
              Keep playing
            </Button>
            <Button
              variant="danger"
              icon="🏳️"
              onClick={() => {
                setConfirm(null)
                g.resign()
              }}
            >
              Yes, resign
            </Button>
          </>
        }
      >
        <p className="play-confirm">The robot wins this one — but you can always play again!</p>
      </Modal>

      <Modal
        open={confirm === 'new' && !end}
        onClose={() => setConfirm(null)}
        size="sm"
        title="Start a new game? ✨"
        footerCenter
        footer={
          <>
            <Button variant="primary" icon="♟️" onClick={() => setConfirm(null)} data-autofocus>
              Keep playing
            </Button>
            <Button
              variant="secondary"
              icon="✨"
              onClick={() => {
                setConfirm(null)
                onSetup()
              }}
            >
              New game
            </Button>
          </>
        }
      >
        <p className="play-confirm">This game will stop here (no coins for unfinished games).</p>
      </Modal>
    </div>
  )
}

export default GameView
