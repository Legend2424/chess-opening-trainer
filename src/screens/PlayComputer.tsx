// DESIGN.md §6 screen 8 — Play vs computer.
// Setup (colour, robot strength, start position) -> game vs Stockfish with
// hint / undo / resign / new game -> result + engine-game rewards.
// params: { fen?, userColor?, openingId? }. With a playable `fen` the game
// starts right away ("Play on" from the trainer).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNav } from '../app/nav.tsx'
import { Button, Modal, TopBar, toast } from '../components/ui/index.ts'
import { useRepertoires } from '../chess/useRepertoires.ts'
import { openingById } from '../data/openings.ts'
import { preloadEngine, stopEngine } from '../engine/engineService.ts'
import { stopCelebration } from '../fx/celebrate.ts'
import { setMuted, sfx } from '../fx/sound.ts'
import { actions, useActiveProfile } from '../store/appStore.ts'
import { DEFAULT_EQUIPPED, titleText } from '../store/catalog.ts'
import { levelForXp } from '../store/levels.ts'
import { currentDaily, currentStreak } from '../store/profileOps.ts'
import { ENGINE_DAILY_CAP } from '../store/rewards.ts'
import { BOARD_THEME_IDS, PIECE_SET_IDS, type BoardThemeId, type Color, type PieceSetId, type Profile, type Screen } from '../types.ts'
import { GameView } from './play/GameView.tsx'
import { SetupView } from './play/SetupView.tsx'
import { fenStart, isPlayableFen, openingStarts, sideToMove, standardStart, type StartOption } from './play/startPositions.ts'
import { loadPlayPrefs, savePlayPrefs, type ColorChoice } from './play/strength.ts'
import { useEngineLoadSlow, useEngineStatus, type GameSetup, type Side } from './play/useComputerGame.ts'
import './PlayComputer.css'

type PlayParams = Extract<Screen, { name: 'play' }>

function toSide(c: Color): Side {
  return c === 'black' ? 'b' : 'w'
}

function boardThemeOf(p: Profile | null): BoardThemeId {
  const id = p?.equipped.board ?? DEFAULT_EQUIPPED.board
  return ((BOARD_THEME_IDS as readonly string[]).includes(id) ? id : DEFAULT_EQUIPPED.board) as BoardThemeId
}

function pieceSetOf(p: Profile | null): PieceSetId {
  const id = p?.equipped.pieces ?? DEFAULT_EQUIPPED.pieces
  return ((PIECE_SET_IDS as readonly string[]).includes(id) ? id : DEFAULT_EQUIPPED.pieces) as PieceSetId
}

export default function PlayComputer({ params }: { params: PlayParams }) {
  const nav = useNav()
  const profile = useActiveProfile()
  const reps = useRepertoires()
  const engine = useEngineStatus()
  const engineSlow = useEngineLoadSlow(engine)

  // ---- what the screen was opened with --------------------------------------
  const paramOpening = params.openingId ? openingById(params.openingId) : undefined
  const fenOk = isPlayableFen(params.fen)
  const fenColor: Color =
    params.userColor ?? paramOpening?.side ?? (fenOk && sideToMove(params.fen as string) === 'b' ? 'black' : 'white')

  const [initialPrefs] = useState(() => loadPlayPrefs(profile?.id))
  const [rating, setRating] = useState(initialPrefs.rating)
  const [color, setColor] = useState<ColorChoice>(() => (fenOk ? fenColor : paramOpening ? paramOpening.side : initialPrefs.color))
  const [startId, setStartId] = useState(() => (fenOk ? 'fen' : paramOpening ? `opening:${paramOpening.id}` : 'standard'))
  const [game, setGame] = useState<GameSetup | null>(() =>
    fenOk ? { id: Date.now(), startFen: params.fen as string, userColor: toSide(fenColor), rating: initialPrefs.rating } : null,
  )

  // Warm the engine up while the player chooses; stop it when leaving.
  useEffect(() => {
    preloadEngine()
    return () => {
      stopEngine()
      stopCelebration()
    }
  }, [])

  // A "Play on" position that can't be played (bad FEN / game already over).
  const warned = useRef(false)
  useEffect(() => {
    if (warned.current || !params.fen || fenOk) return
    warned.current = true
    toast.info("That position can't be played — pick a start below.", '🤔')
  }, [params.fen, fenOk])

  // ---- start positions ---------------------------------------------------------
  const options: StartOption[] = useMemo(() => {
    const list: StartOption[] = []
    if (fenOk) list.push(fenStart(params.fen as string, fenColor))
    list.push(standardStart())
    list.push(...openingStarts(reps.reps))
    return list
  }, [fenOk, params.fen, fenColor, reps.reps])

  const openingsLoading = reps.status === 'loading'
  // A preselected opening that can't load falls back to the normal start.
  useEffect(() => {
    if (!openingsLoading && !options.some((o) => o.id === startId)) setStartId('standard')
  }, [openingsLoading, options, startId])

  // ---- actions -------------------------------------------------------------------
  const changeRating = useCallback(
    (r: number) => {
      setRating(r)
      savePlayPrefs(profile?.id, { rating: r, color })
    },
    [profile?.id, color],
  )

  const changeStart = useCallback(
    (id: string) => {
      setStartId(id)
      const o = options.find((x) => x.id === id)
      if (o?.suggestedColor) setColor(o.suggestedColor)
    },
    [options],
  )

  const pickSide = (c: ColorChoice): Side => (c === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : toSide(c))

  const startGame = useCallback(() => {
    const opt = options.find((o) => o.id === startId)
    if (!opt) return
    savePlayPrefs(profile?.id, { rating, color })
    stopCelebration()
    setGame({ id: Date.now(), startFen: opt.fen, userColor: pickSide(color), rating })
  }, [options, startId, profile?.id, rating, color])

  const playAgain = useCallback(() => {
    stopCelebration()
    setGame((g) => (g ? { ...g, id: Math.max(Date.now(), g.id + 1), userColor: color === 'random' ? pickSide('random') : g.userColor } : g))
  }, [color])

  const toSetup = useCallback(() => {
    stopEngine()
    stopCelebration()
    setGame(null)
  }, [])

  // ---- leaving mid-game asks first (same as "New game") ---------------------------
  const [inProgress, setInProgress] = useState(false)
  const [askLeave, setAskLeave] = useState(false)
  const goBack = () => {
    if (game && inProgress) setAskLeave(true)
    else nav.back()
  }

  // ---- daily robot rewards ------------------------------------------------------
  const now = Date.now()
  const used = profile ? currentDaily(profile, now).engineGamesRewarded || 0 : 0
  const rewardsLeft = Math.max(0, ENGINE_DAILY_CAP - used)

  const boardTheme = boardThemeOf(profile)
  const pieceSet = pieceSetOf(profile)

  return (
    <div className="screen game-ui play-screen">
      <PlayTopBar profile={profile} onBack={goBack} center={game ? '🤖 Robot match' : '🤖 Play the robot'} />
      {game ? (
        <GameView
          key={game.id}
          setup={game}
          profile={profile}
          boardTheme={boardTheme}
          pieceSet={pieceSet}
          onPlayAgain={playAgain}
          onSetup={toSetup}
          onInProgress={setInProgress}
        />
      ) : (
        <SetupView
          boardTheme={boardTheme}
          pieceSet={pieceSet}
          rating={rating}
          onRating={changeRating}
          color={color}
          onColor={setColor}
          options={options}
          openingsLoading={openingsLoading}
          startId={startId}
          onStart={changeStart}
          engine={engine}
          engineSlow={engineSlow}
          onRetryEngine={preloadEngine}
          rewardsLeft={rewardsLeft}
          rewardsCap={ENGINE_DAILY_CAP}
          onPlay={startGame}
        />
      )}

      <Modal
        open={askLeave && !!game && inProgress}
        onClose={() => setAskLeave(false)}
        size="sm"
        title="Leave this game? 🚪"
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
        <p className="play-confirm">This game will stop here (no coins for unfinished games).</p>
      </Modal>
    </div>
  )
}

/** The player's TopBar (same contents as the other screens' player bar). */
function PlayTopBar({ profile, onBack, center }: { profile: Profile | null; onBack: () => void; center: string }) {
  const sound = profile?.settings.sound !== false
  useEffect(() => {
    if (profile) setMuted(!sound)
  }, [profile, sound])
  if (!profile) return <TopBar onBack={onBack} center={center} />
  return (
    <TopBar
      avatar={profile.avatar}
      name={profile.name}
      color={profile.color}
      title={titleText(profile.equipped.title)}
      level={levelForXp(profile.xp)}
      xp={profile.xp}
      coins={profile.coins}
      streak={currentStreak(profile, Date.now())}
      muted={!sound}
      onToggleMute={() => {
        const next = !sound
        setMuted(!next)
        actions.setSetting('sound', next)
        if (next) sfx.pop()
      }}
      onBack={onBack}
      center={center}
    />
  )
}
