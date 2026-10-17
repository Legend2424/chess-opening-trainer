// Dev-only showcase of the UI kit. Open /gallery.html with the Vite dev server.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Chess } from 'chess.js'
import {
  BOARD_THEME_IDS,
  EFFECT_IDS,
  PIECE_SET_IDS,
  type Arrow,
  type BoardThemeId,
  type Color,
  type Highlight,
  type LevelInfo,
  type PieceSetId,
} from '../types.ts'
import ChessBoard from '../components/ChessBoard.tsx'
import {
  Avatar,
  Button,
  Card,
  Chip,
  CoinBadge,
  CountUp,
  MiniBoard,
  Modal,
  PinPad,
  ProgressBar,
  ProgressRing,
  SpeechBubble,
  Stars,
  Tabs,
  Toggle,
  TopBar,
  toast,
} from '../components/ui/index.ts'
import { BOARD_THEMES } from '../theme/boards.ts'
import { PIECE_SET_NAMES, PiecePreview } from '../theme/pieces.tsx'
import { isMuted, setMuted, sfx, type SfxName } from '../fx/sound.ts'
import { celebrate, EFFECT_NAMES } from '../fx/celebrate.ts'

type Section = 'components' | 'board' | 'themes' | 'fx' | 'layout' | 'selftest'

const LEVEL: LevelInfo = { level: 3, name: 'Bishop', emoji: '♝', minXp: 600, nextXp: 1200 }
const START = new Chess().fen()

export default function UiGallery() {
  const [section, setSection] = useState<Section>(() => {
    const s = new URLSearchParams(window.location.search).get('s')
    return (['components', 'board', 'themes', 'fx', 'layout', 'selftest'] as string[]).includes(s ?? '') ? (s as Section) : 'components'
  })
  const [theme, setTheme] = useState<BoardThemeId>('green')
  const [pieces, setPieces] = useState<PieceSetId>('cburnett')
  const [coins, setCoins] = useState(1234)
  const [muted, setMutedState] = useState(isMuted())

  const go = (s: Section) => {
    setSection(s)
    const url = new URL(window.location.href)
    url.searchParams.set('s', s)
    window.history.replaceState(null, '', url)
  }

  return (
    <div className="screen game-ui">
      <TopBar
        avatar="🦉"
        name="Minka"
        color="#ec4899"
        level={LEVEL}
        xp={950}
        title="Opening Explorer"
        coins={coins}
        streak={4}
        muted={muted}
        onToggleMute={() => {
          setMuted(!muted)
          setMutedState(!muted)
        }}
        onBack={() => toast.info('Back pressed')}
        center="UI Gallery"
      />
      {section === 'layout' ? (
        <TrainerLayoutDemo
          theme={theme}
          pieces={pieces}
          nav={<Tabs<Section> value={section} onChange={go} tabs={SECTION_TABS} />}
        />
      ) : (
        <div className="page">
          <Tabs<Section> value={section} onChange={go} tabs={SECTION_TABS} />
          {section === 'components' && <ComponentsSection coins={coins} setCoins={setCoins} />}
          {section === 'board' && <BoardSection theme={theme} pieces={pieces} setTheme={setTheme} setPieces={setPieces} />}
          {section === 'themes' && <ThemesSection theme={theme} pieces={pieces} setTheme={setTheme} setPieces={setPieces} />}
          {section === 'fx' && <FxSection />}
          {section === 'selftest' && <SelfTestSection />}
        </div>
      )}
    </div>
  )
}

const SECTION_TABS = [
  { id: 'components' as const, label: 'Components', icon: '🧩' },
  { id: 'board' as const, label: 'Board', icon: '♟️' },
  { id: 'themes' as const, label: 'Themes & pieces', icon: '🎨' },
  { id: 'fx' as const, label: 'Sound & effects', icon: '🎉' },
  { id: 'layout' as const, label: 'Trainer layout', icon: '📐' },
  { id: 'selftest' as const, label: 'Self-test', icon: '🧪' },
]

function H({ children }: { children: ReactNode }) {
  return <h2 className="h3 on-bg">{children}</h2>
}

// ---------------------------------------------------------------------------
function ComponentsSection({ coins, setCoins }: { coins: number; setCoins: (fn: (c: number) => number) => void }) {
  const [modal, setModal] = useState(false)
  const [stars, setStars] = useState(3)
  const [starsKey, setStarsKey] = useState(0)
  const [toggleA, setToggleA] = useState(true)
  const [toggleB, setToggleB] = useState(false)
  const [tab, setTab] = useState('boards')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pct, setPct] = useState(0.6)
  const [reward, setReward] = useState(0)

  return (
    <>
      <H>Buttons</H>
      <Card>
        <div className="stack">
          <div className="row row--wrap">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon="✕">
              Danger
            </Button>
            <Button variant="gold" icon="🪙">
              Gold
            </Button>
            <Button variant="success" icon="✓">
              Success
            </Button>
            <Button variant="info" icon="💡">
              Info
            </Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="row row--wrap" style={{ alignItems: 'flex-end' }}>
            <Button size="sm" icon="💡">
              Small
            </Button>
            <Button size="md" icon="↻">
              Medium
            </Button>
            <Button size="lg" icon="▶">
              Large
            </Button>
            <Button size="xl" icon="▶" shine>
              Coach's Choice
            </Button>
          </div>
          <div className="row row--wrap">
            <Button variant="danger" size="lg" pulse icon="↩">
              Take it back
            </Button>
            <Button variant="secondary" icon="🔊" round aria-label="Sound" />
            <Button variant="primary" icon="🏠" aria-label="Home" />
            <Button variant="gold" round iconRight="▶">
              Next line
            </Button>
          </div>
          <Button variant="primary" size="lg" block icon="📚">
            All lines in order (block)
          </Button>
        </div>
      </Card>

      <H>Cards</H>
      <div className="grid-auto">
        <Card title="Plain card">White, rounded, soft shadow.</Card>
        <Card title="Accent card" accent="#ef4444">
          🐉 Sicilian Defence — accent top border.
        </Card>
        <Card title="Pressable card" onClick={() => toast.info('Card tapped!')}>
          Tap me — I squish.
        </Card>
        <Card title="Flat card" flat>
          Outlined, no shadow.
        </Card>
        <Card title="Glass card" glass>
          Frosted on the gradient.
        </Card>
        <Card title="Disabled card" disabled onClick={() => {}}>
          🔒 Locked
        </Card>
      </div>

      <H>Coins, chips, stars</H>
      <Card>
        <div className="stack" style={{ ['--stack-gap' as string]: '18px' }}>
          <div className="row row--wrap">
            <CoinBadge value={coins} size="sm" />
            <CoinBadge value={coins} />
            <CoinBadge value={coins} size="lg" />
            <CoinBadge value={coins} size="xl" />
            <Button size="sm" variant="gold" onClick={() => setCoins((c) => c + 25)}>
              +25
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCoins((c) => Math.max(0, c - 150))}>
              −150
            </Button>
          </div>
          <div className="row row--wrap">
            <span className="h2 num" style={{ color: 'var(--c-gold-ink)' }}>
              🪙 <CountUp value={reward} />
            </span>
            <Button size="sm" onClick={() => setReward((r) => (r === 0 ? 47 : 0))}>
              Count up
            </Button>
          </div>
          <div className="row row--wrap">
            <Chip icon="🧠">3 lines to review</Chip>
            <Chip tone="gold" icon="✨">
              NEW lines
            </Chip>
            <Chip tone="green" icon="✓">
              Mastered
            </Chip>
            <Chip tone="red" icon="⚔️">
              Trap!
            </Chip>
            <Chip tone="blue">You play Black</Chip>
            <Chip tone="gray">Locked · Level 4</Chip>
            <Chip tone="white" icon="🔥">
              Combo x3
            </Chip>
            <Chip tone="solid">Equipped</Chip>
            <Chip tone="gold" size="lg" icon="⭐">
              +10 Perfect!
            </Chip>
          </div>
          <div className="row row--wrap">
            {[1, 2, 3].map((n, i) => (
              <Chip key={n} tone="gold" pop style={{ ['--i' as string]: i }} icon="🪙">
                +{n * 5} breakdown chip
              </Chip>
            ))}
          </div>
          <div className="row row--wrap" style={{ gap: 30 }}>
            <Stars key={`a${starsKey}`} count={stars} size={56} />
            <Stars key={`b${starsKey}`} count={2} size={32} arc={false} />
            <Stars key={`c${starsKey}`} count={1} size={24} animate={false} />
            <div className="row">
              {[1, 2, 3].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={stars === n ? 'primary' : 'secondary'}
                  onClick={() => {
                    setStars(n)
                    setStarsKey((k) => k + 1)
                  }}
                >
                  {n}★
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <H>Progress & avatars</H>
      <Card>
        <div className="stack" style={{ ['--stack-gap' as string]: '18px' }}>
          <ProgressBar value={pct} />
          <ProgressBar value={3} max={5} label="Daily goal 🎯" valueText="3 / 5" color="linear-gradient(90deg,#4ade80,#16a34a)" height={18} />
          <ProgressBar value={pct} label="Mastery" valueText striped color="linear-gradient(90deg,#ffd24a,#ffb800)" />
          <div className="row row--wrap" style={{ gap: 24 }}>
            <ProgressRing value={pct} />
            <ProgressRing value={0.35} size={96} color="#22c55e">
              <div>
                <div className="num" style={{ fontSize: 22 }}>
                  3/5
                </div>
                <div style={{ fontSize: 11 }} className="muted">
                  lines
                </div>
              </div>
            </ProgressRing>
            <ProgressRing value={1} size={64} color={['#ffd24a', '#f59e0b']}>
              🏆
            </ProgressRing>
            <ProgressRing value={0} size={56} />
            <Button size="sm" variant="secondary" onClick={() => setPct((p) => (p >= 1 ? 0 : Math.min(1, p + 0.2)))}>
              Change
            </Button>
          </div>
          <div className="row row--wrap" style={{ gap: 18 }}>
            <Avatar emoji="🦉" color="#3b82f6" size="xs" />
            <Avatar emoji="🐱" color="#ec4899" size="sm" />
            <Avatar emoji="🦊" color="#f97316" size="md" badge="♞" />
            <Avatar emoji="🐲" color="#22c55e" size="lg" ring />
            <Avatar emoji="🦄" color="#a855f7" size="xl" float onClick={() => toast.info('Avatar tapped')} label="Unicorn" />
          </div>
        </div>
      </Card>

      <H>Tabs, toggles, modal, toasts</H>
      <Card>
        <div className="stack" style={{ ['--stack-gap' as string]: '16px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            ariaLabel="Shop"
            tabs={[
              { id: 'boards', label: 'Boards', icon: '🎨' },
              { id: 'pieces', label: 'Pieces', icon: '♞' },
              { id: 'avatars', label: 'Avatars', icon: '🦊' },
              { id: 'trophies', label: 'Trophies', icon: '🏆' },
              { id: 'effects', label: 'Effects', icon: '🎉' },
              { id: 'titles', label: 'Titles', icon: '🏷️' },
              { id: 'rewards', label: 'Rewards', icon: '🎁', badge: 2 },
            ]}
          />
          <Tabs
            value={tab === 'pieces' ? 'pieces' : 'boards'}
            onChange={setTab}
            stretch
            tabs={[
              { id: 'boards', label: 'Stretch A' },
              { id: 'pieces', label: 'Stretch B' },
            ]}
          />
          <div style={{ maxWidth: 520 }}>
            <Toggle checked={toggleA} onChange={setToggleA} label="👀 Show me the moves" description="Learn mode — arrows show every move (fewer coins)." />
            <Toggle checked={toggleB} onChange={setToggleB} label="🔊 Sound" onIcon="🔊" offIcon="🔇" />
            <Toggle checked={false} onChange={() => {}} label="Disabled toggle" disabled />
          </div>
          <div className="row row--wrap">
            <Button onClick={() => setModal(true)} icon="🪟">
              Open modal
            </Button>
            <Button variant="success" onClick={() => toast.success('Great move!')}>
              Toast success
            </Button>
            <Button variant="danger" onClick={() => toast.error("Oops! That's not the move from your study.")}>
              Toast error
            </Button>
            <Button variant="gold" onClick={() => toast.coin(25, 'Line complete')}>
              Toast coin
            </Button>
            <Button variant="secondary" onClick={() => toast.achievement('Dragon Tamer', 'Master the whole Sicilian', '🐉')}>
              Toast achievement
            </Button>
          </div>
        </div>
      </Card>

      <H>PIN pad (correct PIN: 1234)</H>
      <Card style={{ display: 'grid', placeItems: 'center' }}>
        <PinPad
          title="Parent zone 🔒"
          subtitle="Enter your 4-digit PIN"
          error={pinError}
          onCancel={() => toast.info('Cancelled')}
          onComplete={(pin) => {
            if (pin === '1234') {
              setPinError(null)
              toast.success('Unlocked!', '🔓')
              return true
            }
            setPinError("That's not it — try again")
            return false
          }}
        />
      </Card>

      <H>Speech bubbles</H>
      <Card>
        <div className="stack">
          <SpeechBubble>Ready to practise, Minka? Let's play the Sicilian! 🐉</SpeechBubble>
          <SpeechBubble tone="success" animateKey={1}>
            Yes! That's the move. ✨
          </SpeechBubble>
          <SpeechBubble tone="error">Oops! That's not the move from your study. Take it back and try again.</SpeechBubble>
          <SpeechBubble tone="info" speaker="🤖" bob={false}>
            Hmm, that gives your opponent the better game.
          </SpeechBubble>
          <SpeechBubble tone="gold" speaker="😮">
            Your opponent blundered! Punish it!
          </SpeechBubble>
        </div>
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Line complete! 🎉"
        footerCenter
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)} icon="↻">
              Try again
            </Button>
            <Button variant="primary" shine onClick={() => setModal(false)} iconRight="▶" data-autofocus>
              Next line
            </Button>
          </>
        }
      >
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <Stars count={3} size={64} />
          <div className="h1 num" style={{ color: 'var(--c-gold-ink)' }}>
            🪙 <CountUp value={42} from={0} delay={500} />
          </div>
          <div className="row row--wrap row--center">
            <Chip tone="gold" pop icon="✅">
              +12 Line complete
            </Chip>
            <Chip tone="gold" pop style={{ ['--i' as string]: 1 }} icon="⭐">
              +10 Perfect!
            </Chip>
            <Chip tone="gold" pop style={{ ['--i' as string]: 2 }} icon="✨">
              +10 New line
            </Chip>
            <Chip tone="gold" pop style={{ ['--i' as string]: 3 }} icon="🔥">
              +10 Combo x6
            </Chip>
          </div>
          <p className="muted">Tap outside, press Escape or ✕ to close. Tab stays inside.</p>
        </div>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
const DEMO_ARROWS: Arrow[] = [
  { from: 'e2', to: 'e4', color: 'green' },
  { from: 'd7', to: 'd5', color: 'red' },
  { from: 'g1', to: 'f3', color: 'blue' },
  { from: 'f1', to: 'c4', color: 'yellow' },
]
const DEMO_CIRCLES: Highlight[] = [
  { square: 'd4', color: 'green' },
  { square: 'e5', color: 'red' },
  { square: 'f7', color: 'yellow' },
  { square: 'c6', color: 'blue' },
]

function BoardSection({
  theme,
  pieces,
  setTheme,
  setPieces,
}: {
  theme: BoardThemeId
  pieces: PieceSetId
  setTheme: (t: BoardThemeId) => void
  setPieces: (p: PieceSetId) => void
}) {
  const [fen, setFen] = useState(START)
  const [lastMove, setLastMove] = useState<[string, string] | null>(null)
  const [wrong, setWrong] = useState<{ from: string; to: string } | null>(null)
  const [orientation, setOrientation] = useState<Color>('white')
  const [hint, setHint] = useState(false)
  const [arrows, setArrows] = useState(true)
  const [circles, setCircles] = useState(false)
  const [interactive, setInteractive] = useState(true)
  const [shake, setShake] = useState(0)
  const [moves, setMoves] = useState<string[]>([])

  const onMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      const g = new Chess(fen)
      try {
        const m = g.move({ from, to, promotion })
        setFen(g.fen())
        setLastMove([from, to])
        setWrong(null)
        setMoves((ms) => [...ms, m.san])
        if (m.isCapture()) sfx.capture()
        else sfx.move()
        if (g.inCheck()) sfx.check()
        return true
      } catch {
        return false
      }
    },
    [fen],
  )

  const showWrong = () => {
    // 1.e4 then Black "wrongly" plays ...f6 (the study wanted ...c5)
    const g = new Chess()
    g.move('e4')
    g.move('f6')
    setFen(g.fen())
    setLastMove(['f7', 'f6'])
    setWrong({ from: 'f7', to: 'f6' })
    setMoves(['e4', 'f6?'])
    setShake((s) => s + 1)
    sfx.wrong()
  }

  const reset = () => {
    setFen(START)
    setLastMove(null)
    setWrong(null)
    setMoves([])
  }

  const promoPosition = () => {
    setFen('8/4P1k1/8/8/8/8/5K2/8 w - - 0 1')
    setLastMove(null)
    setWrong(null)
    setMoves([])
  }

  const turn = new Chess(fen).turn()
  const hintSquare = hint ? (turn === 'w' ? 'g1' : 'g8') : null

  return (
    <>
      <H>ChessBoard</H>
      <div className="layout-train" style={{ padding: 0, height: 'auto' }}>
        <div className="layout-train__board">
          <ChessBoard
            fen={fen}
            orientation={orientation}
            interactive={interactive}
            onMove={onMove}
            lastMove={lastMove}
            wrongMove={wrong}
            hintSquare={hintSquare}
            arrows={arrows ? DEMO_ARROWS : []}
            highlights={circles ? DEMO_CIRCLES : []}
            shake={shake}
            boardTheme={theme}
            pieceSet={pieces}
          />
        </div>
        <div className="layout-train__panel">
          <Card>
            <div className="stack">
              <div className="row row--wrap">
                <Button size="sm" variant="danger" onClick={showWrong} icon="✗">
                  Wrong move
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setShake((s) => s + 1)} icon="〰️">
                  Shake
                </Button>
                <Button size="sm" variant="secondary" onClick={reset} icon="↻">
                  Reset
                </Button>
                <Button size="sm" variant="secondary" onClick={promoPosition} icon="♛">
                  Promotion test
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} icon="🔄">
                  Flip
                </Button>
              </div>
              <Toggle checked={interactive} onChange={setInteractive} label="Interactive" />
              <Toggle checked={hint} onChange={setHint} label="💡 Hint glow (knight)" />
              <Toggle checked={arrows} onChange={setArrows} label="➡️ Coach arrows (G/R/B/Y)" />
              <Toggle checked={circles} onChange={setCircles} label="⭕ Coach circles" />
              <div className="row row--wrap">
                <label className="muted" style={{ fontWeight: 800 }}>
                  Theme{' '}
                  <select value={theme} onChange={(e) => setTheme(e.target.value as BoardThemeId)} style={{ fontSize: 16, padding: 6, borderRadius: 10 }}>
                    {BOARD_THEME_IDS.map((id) => (
                      <option key={id} value={id}>
                        {BOARD_THEMES[id].name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="muted" style={{ fontWeight: 800 }}>
                  Pieces{' '}
                  <select value={pieces} onChange={(e) => setPieces(e.target.value as PieceSetId)} style={{ fontSize: 16, padding: 6, borderRadius: 10 }}>
                    {PIECE_SET_IDS.map((id) => (
                      <option key={id} value={id}>
                        {PIECE_SET_NAMES[id]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="muted" style={{ fontWeight: 700 }}>
                Moves: {moves.length ? moves.join(' ') : '—'}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <H>Small boards (maxSize)</H>
      <div className="row row--wrap" style={{ alignItems: 'flex-start' }}>
        <div style={{ width: 240 }}>
          <ChessBoard fen={START} orientation="black" interactive={false} onMove={() => false} boardTheme="candy" pieceSet="anarcandy" maxSize={240} lastMove={['e2', 'e4']} />
        </div>
        <div style={{ width: 200 }}>
          <ChessBoard
            fen="r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
            orientation="white"
            interactive
            onMove={() => false}
            boardTheme="marble"
            pieceSet="emoji"
            maxSize={200}
          />
        </div>
        <div style={{ width: 150 }}>
          <ChessBoard fen={START} orientation="white" interactive={false} onMove={() => false} boardTheme="royal-wood" pieceSet="merida" maxSize={150} />
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
function ThemesSection({
  theme,
  pieces,
  setTheme,
  setPieces,
}: {
  theme: BoardThemeId
  pieces: PieceSetId
  setTheme: (t: BoardThemeId) => void
  setPieces: (p: PieceSetId) => void
}) {
  const [matrix, setMatrix] = useState(false)
  return (
    <>
      <H>Board themes (with {PIECE_SET_NAMES[pieces]} pieces)</H>
      <div className="grid-auto" style={{ ['--grid-min' as string]: '190px' }}>
        {BOARD_THEME_IDS.map((id) => (
          <Card key={id} padding="sm" onClick={() => setTheme(id)} accent={id === theme ? '#6c4bf4' : undefined}>
            <div className="stack" style={{ alignItems: 'center' }}>
              <MiniBoard boardTheme={id} pieceSet={pieces} size={160} lastMove={['c3', 'd4']} />
              <div style={{ fontWeight: 800 }}>
                {BOARD_THEMES[id].emoji} {BOARD_THEMES[id].name}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <H>Piece sets (on {BOARD_THEMES[theme].name})</H>
      <div className="grid-auto" style={{ ['--grid-min' as string]: '200px' }}>
        {PIECE_SET_IDS.map((id) => (
          <Card key={id} padding="sm" onClick={() => setPieces(id)} accent={id === pieces ? '#6c4bf4' : undefined}>
            <div className="stack" style={{ alignItems: 'center' }}>
              <PiecePreview setId={id} size={48} />
              <MiniBoard boardTheme={theme} pieceSet={id} size={120} fen="start" />
              <div style={{ fontWeight: 800 }}>{PIECE_SET_NAMES[id]}</div>
            </div>
          </Card>
        ))}
      </div>

      <H>Every theme × every piece set</H>
      <Card>
        <Toggle checked={matrix} onChange={setMatrix} label="Show the full matrix" description={`${BOARD_THEME_IDS.length} themes × ${PIECE_SET_IDS.length} sets`} />
        {matrix && <Matrix />}
      </Card>
    </>
  )
}

function Matrix() {
  return (
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 8 }}>
        <thead>
          <tr>
            <th />
            {PIECE_SET_IDS.map((p) => (
              <th key={p} style={{ fontSize: 12, fontWeight: 800 }}>
                {PIECE_SET_NAMES[p]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BOARD_THEME_IDS.map((t) => (
            <tr key={t}>
              <th style={{ fontSize: 12, fontWeight: 800, textAlign: 'right', whiteSpace: 'nowrap' }}>{BOARD_THEMES[t].name}</th>
              {PIECE_SET_IDS.map((p) => (
                <td key={p}>
                  <MiniBoard boardTheme={t} pieceSet={p} size={96} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
const SFX_LIST: { name: SfxName; label: string; emoji: string }[] = [
  { name: 'move', label: 'Move', emoji: '♟️' },
  { name: 'capture', label: 'Capture', emoji: '⚔️' },
  { name: 'correct', label: 'Correct', emoji: '✅' },
  { name: 'wrong', label: 'Wrong', emoji: '🙈' },
  { name: 'complete', label: 'Complete', emoji: '🏁' },
  { name: 'coin', label: 'Coin', emoji: '🪙' },
  { name: 'levelUp', label: 'Level up', emoji: '⬆️' },
  { name: 'purchase', label: 'Purchase', emoji: '🛒' },
  { name: 'click', label: 'Click', emoji: '👆' },
  { name: 'hint', label: 'Hint', emoji: '💡' },
  { name: 'achievement', label: 'Achievement', emoji: '🏆' },
  { name: 'pop', label: 'Pop', emoji: '🫧' },
  { name: 'check', label: 'Check', emoji: '👑' },
]

function FxSection() {
  const [intensity, setIntensity] = useState(1)
  const effects = useMemo(() => EFFECT_IDS, [])
  return (
    <>
      <H>Sounds (WebAudio, no files)</H>
      <Card>
        <div className="row row--wrap">
          {SFX_LIST.map((s) => (
            <Button key={s.name} size="sm" variant="secondary" icon={s.emoji} clickSound={false} onClick={() => sfx[s.name]()}>
              {s.label}
            </Button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Mute with the 🔊 button in the top bar.
        </p>
      </Card>

      <H>Celebrations</H>
      <Card>
        <div className="stack">
          <div className="row row--wrap">
            {effects.map((e) => (
              <Button key={e} variant="gold" onClick={() => void celebrate(e, { intensity, force: true })}>
                {EFFECT_NAMES[e]}
              </Button>
            ))}
          </div>
          <div className="row row--wrap">
            <span className="muted" style={{ fontWeight: 800 }}>
              Intensity
            </span>
            {[0.5, 1, 1.5].map((k) => (
              <Button key={k} size="sm" variant={intensity === k ? 'primary' : 'secondary'} onClick={() => setIntensity(k)}>
                {k === 0.5 ? 'Small' : k === 1 ? 'Normal' : 'Big'}
              </Button>
            ))}
          </div>
        </div>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
function TrainerLayoutDemo({ theme, pieces, nav }: { theme: BoardThemeId; pieces: PieceSetId; nav: ReactNode }) {
  const [fen, setFen] = useState(START)
  const [last, setLast] = useState<[string, string] | null>(null)
  const onMove = (from: string, to: string, promotion?: string) => {
    const g = new Chess(fen)
    try {
      g.move({ from, to, promotion })
      setFen(g.fen())
      setLast([from, to])
      sfx.move()
      return true
    } catch {
      return false
    }
  }
  return (
    <div className="layout-train">
      <div className="layout-train__board">
        <ChessBoard
          fen={fen}
          orientation="white"
          interactive
          onMove={onMove}
          lastMove={last}
          arrows={[{ from: 'd2', to: 'd4', color: 'green' }]}
          boardTheme={theme}
          pieceSet={pieces}
        />
      </div>
      <div className="layout-train__panel">
        {nav}
        <Card>
          <div className="row row--between">
            <div>
              <div className="h4">🏰 London System</div>
              <div className="muted" style={{ fontWeight: 700 }}>
                All the variations · Main line
              </div>
            </div>
            <Chip tone="gold" icon="✨">
              NEW
            </Chip>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <ProgressBar value={2} max={7} label="Your moves" valueText="2 / 7" />
          </div>
        </Card>
        <SpeechBubble>Start with 1.d4 — then bring the bishop out to f4!</SpeechBubble>
        <div className="row row--wrap">
          <Button variant="info" icon="💡">
            Hint
          </Button>
          <Button variant="secondary" icon="↻" onClick={() => { setFen(START); setLast(null) }}>
            Restart
          </Button>
          <Button variant="ghost" icon="✕">
            Exit
          </Button>
        </div>
        <p className="on-bg" style={{ fontWeight: 700, fontSize: 14 }}>
          Resize the window: landscape puts the panel on the right, portrait stacks it below.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// In-browser regression self-test (/gallery.html?s=selftest). Covers the DOM
// behaviour that scripts/test-uikit.ts cannot reach under plain node. Results
// are listed on the page and published as window.__uiSelfTest.

interface SelfTestResult {
  name: string
  ok: boolean
  detail: string
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
async function settle(n = 2): Promise<void> {
  for (let i = 0; i < n; i++) await nextFrame()
}

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

/**
 * Jump finite CSS animations under `root` to their end. Background or occluded
 * windows barely render frames, so waiting on the clock is not enough; finish()
 * gives the same end state a real run would (including any retained fill).
 */
function finishAnimations(root: Element): void {
  for (const a of root.getAnimations({ subtree: true })) {
    try {
      if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish()
    } catch {
      /* ignore */
    }
  }
}

interface Mounted {
  el: HTMLDivElement
  render: (node: ReactNode) => void
  unmount: () => void
}

/** Mount a node in its own fixed-position root (on screen, above the gallery). */
function mountTest(node: ReactNode, pos: { left?: number; top?: number; width?: number } = {}): Mounted {
  const el = document.createElement('div')
  el.className = 'selftest-host'
  Object.assign(el.style, {
    position: 'fixed',
    left: `${pos.left ?? 40}px`,
    top: `${pos.top ?? 150}px`,
    width: `${pos.width ?? 420}px`,
    zIndex: '900',
    background: '#fff',
  })
  document.body.appendChild(el)
  const root = createRoot(el)
  const render = (n: ReactNode) => flushSync(() => root.render(n))
  render(node)
  return {
    el,
    render,
    unmount: () => {
      flushSync(() => root.unmount())
      el.remove()
    },
  }
}

function pressEscape(): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  document.body.dispatchEvent(ev)
  return ev
}

function ModalPair({ a, b, log, bDismissible = true }: { a: boolean; b: boolean; log: string[]; bDismissible?: boolean }) {
  return (
    <>
      <Modal open={a} onClose={() => log.push('closeA')} title="Modal A">
        <button type="button">a1</button>
      </Modal>
      <Modal open={b} onClose={() => log.push('closeB')} dismissible={bDismissible} title="Modal B">
        <button type="button">b1</button>
      </Modal>
    </>
  )
}

type DragHost = 'glass' | 'slide' | 'modal'
const DRAG_HOST_LABEL: Record<DragHost, string> = {
  glass: 'a .card--glass',
  slide: 'an .anim-slide-up wrapper',
  modal: 'a Modal',
}

const SELF_TESTS: { name: string; run: () => Promise<string> }[] = [
  {
    name: 'Modal: one Escape closes only the top modal (review #1)',
    run: async () => {
      const log: string[] = []
      const m = mountTest(<ModalPair a b log={log} />)
      try {
        await settle()
        pressEscape()
        check(log.join() === 'closeB', `closed: [${log.join()}]`)
        log.length = 0
        m.render(<ModalPair a b log={log} bDismissible={false} />)
        pressEscape()
        check(log.length === 0, `non-dismissible top modal let Escape through: [${log.join()}]`)
        return 'Escape -> [closeB]; a non-dismissible top modal swallows it'
      } finally {
        m.unmount()
      }
    },
  },
  {
    name: 'Modal: scroll lock released whatever order stacked modals close in (review #1)',
    run: async () => {
      const original = document.body.style.overflow
      const log: string[] = []
      const m = mountTest(<ModalPair a b log={log} />)
      try {
        await settle()
        check(document.body.style.overflow === 'hidden', 'not locked while open')
        m.render(<ModalPair a={false} b log={log} />) // the lower one closes first
        check(document.body.style.overflow === 'hidden', 'unlocked while B is still open')
        m.render(<ModalPair a={false} b={false} log={log} />)
        check(document.body.style.overflow === original, `left "${document.body.style.overflow}" after both closed`)
        m.render(<ModalPair a b log={log} />)
        await settle()
      } finally {
        m.unmount() // the whole screen unmounts with two modals open: React cleans A up before B
      }
      check(document.body.style.overflow === original, `left "${document.body.style.overflow}" after unmount`)
      return `body overflow back to "${original}" both ways`
    },
  },
  {
    name: 'Card: Enter on a button inside a pressable Card stays with the button (review #8)',
    run: async () => {
      const log: string[] = []
      const m = mountTest(
        <Card onClick={() => log.push('card')}>
          <Button size="sm" onClick={() => log.push('button')}>
            Inner
          </Button>
        </Card>,
      )
      try {
        await settle()
        const btn = m.el.querySelector('button')!
        btn.focus()
        const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        btn.dispatchEvent(ev)
        check(!log.includes('card'), 'the card swallowed the Enter')
        check(!ev.defaultPrevented, 'Enter was preventDefault-ed, so the button would not click')
        const card = m.el.querySelector<HTMLElement>('.card')!
        card.focus()
        card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        check(log.includes('card'), 'Enter on the card itself did nothing')
        return 'inner Enter untouched; Enter on the card still presses it'
      } finally {
        m.unmount()
      }
    },
  },
  {
    name: 'PinPad: red error look clears on the next key (review #3)',
    run: async () => {
      let accept = false
      const m = mountTest(<PinPad title="PIN" onComplete={() => accept} />)
      const key = (d: string) =>
        Array.from(m.el.querySelectorAll<HTMLButtonElement>('.pinpad__key')).find((b) => b.textContent === d)!
      const dots = () => m.el.querySelector('.pinpad__dots')!
      const filled = () => m.el.querySelectorAll('.pinpad__dot.is-filled').length
      try {
        await settle()
        for (const d of '1234') key(d).click()
        await sleep(220)
        check(dots().classList.contains('is-error'), 'no error look after a rejected PIN')
        key('5').click() // inside the clear window: ignored (and not wiped later)
        await sleep(420)
        check(filled() === 0, `dots not cleared (${filled()})`)
        key('1').click()
        await settle()
        check(!dots().classList.contains('is-error'), 'still red after the next key press')
        check(filled() === 1, `expected 1 dot, got ${filled()}`)
        accept = true
        for (const d of '234') key(d).click()
        await sleep(220)
        check(!dots().classList.contains('is-error'), 'the correct PIN is shown as an error')
        check(filled() === 4, `expected 4 dots, got ${filled()}`)
        return 'rejected -> red + cleared -> next key normal -> accepted PIN normal'
      } finally {
        m.unmount()
      }
    },
  },
  {
    name: 'TopBar: bought title shows next to the level (review #4)',
    run: async () => {
      const m = mountTest(<TopBar avatar="🦉" name="Minka" level={LEVEL} xp={950} title="Opening Explorer" coins={10} />, {
        width: 760,
      })
      try {
        await settle()
        const sub = m.el.querySelector('.topbar__sub')
        check(sub, 'no sub line')
        const text = sub.textContent ?? ''
        check(text.includes('Bishop') && text.includes('Opening Explorer'), `sub line: "${text}"`)
        if (window.innerWidth > 560) {
          const t = m.el.querySelector('.topbar__title')!.getBoundingClientRect()
          check(t.width > 20, `title squeezed to ${t.width}px`)
        }
        m.render(<TopBar avatar="🦉" name="Minka" title="Rookie" />)
        check((m.el.querySelector('.topbar__sub')?.textContent ?? '').includes('Rookie'), 'title without a level is missing')
        return `"${text}"`
      } finally {
        m.unmount()
      }
    },
  },
  {
    name: 'Tap targets: small button, coin badge, xs avatar, TopBar player >= 48px (review #6)',
    run: async () => {
      const m = mountTest(
        <div className="stack" style={{ padding: 40 }}>
          <div>
            <Button size="sm">Small</Button>
          </div>
          <div>
            <CoinBadge value={42} onClick={() => {}} />
          </div>
          <div>
            <Avatar emoji="🦊" size="xs" onClick={() => {}} />
          </div>
          <TopBar avatar="🦉" name="Minka" onProfileClick={() => {}} />
        </div>,
        { top: 120 },
      )
      try {
        await settle()
        const out: string[] = []
        const btn = m.el.querySelector('.btn')!.getBoundingClientRect()
        check(btn.height >= 47.5, `.btn--sm is ${btn.height}px`) // sub-pixel rounding at non-100% zoom
        out.push(`btn--sm ${btn.height}px`)
        // Hit-test 23px above the centre: inside a 48px band, outside the visible element.
        for (const sel of ['button.coin-badge', 'button.avatar']) {
          const el = m.el.querySelector<HTMLElement>(sel)!
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 - 23)
          check(hit && el.contains(hit), `${sel} (${Math.round(r.height)}px) not hit 23px above its centre`)
          out.push(`${sel} ${Math.round(r.height)}px + hit area`)
        }
        const who = m.el.querySelector('button.topbar__who')!.getBoundingClientRect()
        check(who.height >= 47.5, `topbar__who is ${who.height}px`)
        out.push(`topbar__who ${who.height}px`)
        return out.join('; ')
      } finally {
        m.unmount()
      }
    },
  },
  {
    name: 'Toasts appear below the TopBar (review #11)',
    run: async () => {
      const id = toast.show({ message: 'Self-test toast', sound: false, duration: 0 })
      try {
        await settle()
        const vp = document.querySelector('.toast-viewport')!.getBoundingClientRect()
        const topbarH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'))
        check(vp.top >= topbarH, `toast stack top ${vp.top}px < TopBar ${topbarH}px`)
        return `toast stack top ${Math.round(vp.top)}px (TopBar ${topbarH}px)`
      } finally {
        toast.dismiss(id)
      }
    },
  },
  ...(['glass', 'slide', 'modal'] as const).map((where: DragHost) => ({
    name: `Dragged-piece layer lands at the viewport origin with the board in ${DRAG_HOST_LABEL[where]} (review #10)`,
    run: async () => {
      const board = (
        <div style={{ width: 280 }}>
          <ChessBoard fen={START} orientation="white" interactive onMove={() => true} boardTheme="green" pieceSet="cburnett" />
        </div>
      )
      const node =
        where === 'glass' ? (
          <div style={{ padding: 24 }}>
            <Card glass>{board}</Card>
          </div>
        ) : where === 'slide' ? (
          <div className="anim-slide-up" style={{ padding: 24 }}>
            {board}
          </div>
        ) : (
          <Modal open title="Board in a modal">
            {board}
          </Modal>
        )
      const m = mountTest(node, { left: 57, top: 133 })
      let fake: HTMLDivElement | null = null
      try {
        await settle()
        const scope: Element = where === 'modal' ? document.querySelector('.modal-backdrop')! : m.el
        finishAnimations(scope) // entrance animations end as in real use
        await settle()
        const cbRoot = scope.querySelector<HTMLElement>('.cb-root')!
        const probe = cbRoot.querySelector('.cb-fixed-probe')!.getBoundingClientRect()
        // Same parent as react-chessboard's own `position: fixed` drag layer.
        const host = cbRoot.querySelector<HTMLElement>('.cb-board > div:not(.cb-overlay)')!
        cbRoot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
        fake = document.createElement('div')
        fake.setAttribute('style', 'position: fixed; pointer-events: none; z-index: 10; left: 0px; top: 0px; width: 8px; height: 8px;')
        host.appendChild(fake)
        const r = fake.getBoundingClientRect()
        check(Math.abs(r.left) < 1 && Math.abs(r.top) < 1, `layer origin at (${r.left}, ${r.top})`)
        if (where === 'glass') {
          check(probe.left > 1 || probe.top > 1, 'the glass card should be a containing block (test not exercising the fix)')
        } else {
          check(Math.abs(probe.left) < 1 && Math.abs(probe.top) < 1, `a transform was left behind: fixed origin at (${probe.left}, ${probe.top})`)
        }
        return `fixed origin (${Math.round(probe.left)}, ${Math.round(probe.top)}) -> drag layer at (${Math.round(r.left)}, ${Math.round(r.top)})`
      } finally {
        fake?.remove()
        m.unmount()
      }
    },
  })),
]

async function runSelfTests(): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = []
  for (const t of SELF_TESTS) {
    try {
      results.push({ name: t.name, ok: true, detail: await t.run() })
    } catch (e) {
      results.push({ name: t.name, ok: false, detail: e instanceof Error ? e.message : String(e) })
    }
  }
  return results
}

function SelfTestSection() {
  const [results, setResults] = useState<SelfTestResult[] | null>(null)
  const running = useRef(false)
  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    setResults(null)
    const w = window as unknown as { __uiSelfTest?: unknown }
    w.__uiSelfTest = { done: false }
    const r = await runSelfTests()
    const failed = r.filter((x) => !x.ok).length
    w.__uiSelfTest = { done: true, passed: r.length - failed, failed, results: r }
    setResults(r)
    running.current = false
  }, [])
  useEffect(() => {
    // Start outside React's commit phase: the tests mount roots with flushSync.
    const t = window.setTimeout(() => void run(), 0)
    return () => window.clearTimeout(t)
  }, [run])
  const failed = results?.filter((r) => !r.ok).length ?? 0
  return (
    <>
      <H>Self-test</H>
      <Card>
        <div className="row row--between" style={{ marginBottom: 12 }}>
          <strong>{results ? (failed ? `❌ ${failed} of ${results.length} failed` : `✅ All ${results.length} passed`) : 'Running…'}</strong>
          <Button size="sm" variant="secondary" onClick={() => void run()}>
            Run again
          </Button>
        </div>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
          {(results ?? []).map((r) => (
            <li key={r.name} style={{ color: r.ok ? 'var(--c-success-700)' : 'var(--c-error-700)' }}>
              <strong>
                {r.ok ? '✓' : '✗'} {r.name}
              </strong>
              <div className="muted" style={{ fontSize: 14 }}>
                {r.detail}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
