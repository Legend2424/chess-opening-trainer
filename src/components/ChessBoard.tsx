// The one chess board used everywhere in Opening Quest.
//
// - Tap-to-move (tap piece -> legal-move dots -> tap target) AND drag & drop.
//   react-chessboard picks a TouchBackend automatically on touch devices.
// - Only the side to move can be selected/dragged, and only when `interactive`.
// - Wrong move: red from/to squares + a ✗ badge on `to`. Hint: glowing pulse.
// - Coach arrows and circles are drawn in our own SVG overlay (unique per
//   board, nicer than react-chessboard's arrows, and colour-mapped).
// - Sizes itself to its container width (ResizeObserver), integer multiple of 8 px.
// - Board themes are applied through customLight/DarkSquareStyle,
//   customBoardStyle and customSquareStyles; highlights are layered on top as
//   extra backgroundImage layers so no theme can hide them.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess, type Square as ChessSquare } from 'chess.js'
import type { AnnotationColor, Arrow, BoardThemeId, Color, Highlight, PieceSetId } from '../types.ts'
import { boardThemeById, coordinateHalo, highlightColors, isDarkSquare, notationColors } from '../theme/boards.ts'
import { buildCustomPieces } from '../theme/pieces.tsx'

type RcProps = ComponentProps<typeof Chessboard>
type RcSquare = Parameters<NonNullable<RcProps['onSquareClick']>>[0]
type RcPiece = Parameters<NonNullable<RcProps['onPieceDrop']>>[2]
type RcPromotionPiece = Parameters<NonNullable<RcProps['onPromotionPieceSelect']>>[0]
type SquareStyles = NonNullable<RcProps['customSquareStyles']>

export interface ChessBoardProps {
  fen: string
  orientation: Color
  interactive: boolean
  /** Return true if the move was accepted (the parent will then update `fen`). */
  onMove: (from: string, to: string, promotion?: string) => boolean
  lastMove?: [string, string] | null
  /** Red squares + ✗ badge on `to`. */
  wrongMove?: { from: string; to: string } | null
  /** Glowing pulse on the piece to move. */
  hintSquare?: string | null
  /** Coach arrows + hint arrow. */
  arrows?: Arrow[]
  /** Coach circles. */
  highlights?: Highlight[]
  /** Increment to trigger a shake. */
  shake?: number
  boardTheme: BoardThemeId
  pieceSet: PieceSetId
  /** px cap; otherwise fills its container's width. */
  maxSize?: number
  /** Show a–h / 1–8 labels (default true). */
  showCoordinates?: boolean
  /** Red glow on a king in check (default true). */
  showCheck?: boolean
  /** Piece slide duration in ms (default 200). */
  animationMs?: number
  className?: string
  style?: CSSProperties
  /** Accessible label (default describes the orientation). */
  ariaLabel?: string
}

/** Nice, readable colours for study annotations (arrows & circles). */
export const ANNOTATION_COLORS: Record<AnnotationColor, string> = {
  green: 'rgba(22, 163, 74, 0.82)',
  red: 'rgba(226, 46, 46, 0.82)',
  blue: 'rgba(37, 110, 235, 0.82)',
  yellow: 'rgba(245, 170, 0, 0.88)',
}

const FILES = 'abcdefgh'
const WRONG_TO = 'rgba(239, 68, 68, 0.62)'
const WRONG_FROM = 'rgba(239, 68, 68, 0.3)'

function tint(color: string): string {
  return `linear-gradient(${color}, ${color})`
}

function isSquare(s: string | null | undefined): s is string {
  return !!s && /^[a-h][1-8]$/.test(s)
}

/** Display position (0..7 col/row from the top-left) of a square for an orientation. */
function squareXY(square: string, orientation: Color): { x: number; y: number } {
  const f = FILES.indexOf(square[0])
  const r = Number(square[1]) - 1
  return orientation === 'white' ? { x: f, y: 7 - r } : { x: 7 - f, y: r }
}

function safeChess(fen: string): Chess | null {
  try {
    return new Chess(fen)
  } catch {
    return null
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

export function ChessBoard(props: ChessBoardProps) {
  const {
    fen,
    orientation,
    interactive,
    onMove,
    lastMove,
    wrongMove,
    hintSquare,
    arrows,
    highlights,
    shake,
    boardTheme,
    pieceSet,
    maxSize,
    showCoordinates = true,
    showCheck = true,
    animationMs = 200,
    className,
    style,
    ariaLabel,
  } = props

  const reactId = useId()
  const boardId = useMemo(() => 'cb' + reactId.replace(/[^a-zA-Z0-9]/g, ''), [reactId])
  const theme = boardThemeById(boardTheme)
  const hl = useMemo(() => highlightColors(theme), [theme])
  const customPieces = useMemo(() => buildCustomPieces(pieceSet), [pieceSet])

  // ---- sizing --------------------------------------------------------------
  const rootRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  // `avail` = the root's full width (border-box, so it includes the frame padding).
  const [avail, setAvail] = useState(0)

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setAvail(Math.max(0, Math.floor(el.clientWidth)))
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const outer = Math.min(avail, maxSize ?? Infinity)
  const frame = Math.max(3, Math.round(outer * 0.012))
  const size = Math.max(64, Math.floor((outer - 2 * frame) / 8) * 8)
  const sq = size / 8

  // ---- position & selection -----------------------------------------------
  const game = useMemo(() => safeChess(fen), [fen])
  const turn = game?.turn() ?? null
  const [selected, setSelected] = useState<string | null>(null)
  const [pendingPromo, setPendingPromo] = useState<{ from: string; to: string } | null>(null)
  const [dragPromo, setDragPromo] = useState(false)
  const draggingRef = useRef(false)

  useEffect(() => {
    setSelected(null)
    setPendingPromo(null)
    setDragPromo(false)
  }, [fen])

  useEffect(() => {
    if (!interactive) {
      setSelected(null)
      setPendingPromo(null)
    }
  }, [interactive])

  const canSelect = useCallback(
    (square: string): boolean => {
      if (!interactive || !game) return false
      const p = game.get(square as ChessSquare)
      return !!p && p.color === turn
    },
    [interactive, game, turn],
  )

  const legalFrom = useCallback(
    (square: string) => {
      if (!game) return []
      try {
        return game.moves({ square: square as ChessSquare, verbose: true })
      } catch {
        return []
      }
    },
    [game],
  )

  const selectedMoves = useMemo(() => (selected ? legalFrom(selected) : []), [selected, legalFrom])

  const doMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      let ok = false
      try {
        ok = onMove(from, to, promotion)
      } catch (e) {
        console.error('ChessBoard onMove failed', e)
        ok = false
      }
      setSelected(null)
      return ok
    },
    [onMove],
  )

  const onSquareClick = useCallback(
    (square: RcSquare) => {
      if (!interactive || !game) return
      if (selected) {
        if (square === selected) {
          setSelected(null)
          return
        }
        const moves = selectedMoves.filter((m) => m.to === square)
        if (moves.length > 0) {
          if (moves.some((m) => m.promotion)) {
            setPendingPromo({ from: selected, to: square })
            return
          }
          doMove(selected, square)
          return
        }
      }
      setSelected(canSelect(square) ? square : null)
    },
    [interactive, game, selected, selectedMoves, canSelect, doMove],
  )

  const isDraggablePiece = useCallback(
    ({ piece }: { piece: RcPiece }) => interactive && !!game && piece[0] === turn,
    [interactive, game, turn],
  )

  // ---- dragged-piece position fix -------------------------------------------
  // react-chessboard draws the dragged piece in a `position: fixed; left: 0;
  // top: 0` layer. Any ancestor with a transform / filter / backdrop-filter
  // (an entrance animation, a glass card, a modal, our own shake) becomes that
  // layer's containing block, and the piece would float away from the finger.
  // A probe with the same containing block measures where "fixed 0,0" really
  // is; CSS (.cb-board div[style*='position: fixed']) shifts the layer back by
  // --cb-fix-x/y. Measured on pointerdown, at drag start and every frame of a drag.
  const fixProbeRef = useRef<HTMLSpanElement>(null)
  const fixLast = useRef({ x: 0, y: 0 })
  const dragRaf = useRef(0)

  const syncFixedOrigin = useCallback(() => {
    const probe = fixProbeRef.current
    const board = boardRef.current
    if (!probe || !board) return
    const r = probe.getBoundingClientRect()
    const x = Math.round(r.left * 10) / 10
    const y = Math.round(r.top * 10) / 10
    if (x === fixLast.current.x && y === fixLast.current.y) return
    fixLast.current = { x, y }
    board.style.setProperty('--cb-fix-x', `${-x}px`)
    board.style.setProperty('--cb-fix-y', `${-y}px`)
  }, [])

  useEffect(() => () => cancelAnimationFrame(dragRaf.current), [])

  const onPieceDragBegin = useCallback(
    (_piece: RcPiece, square: RcSquare) => {
      draggingRef.current = true
      syncFixedOrigin()
      cancelAnimationFrame(dragRaf.current)
      const follow = () => {
        if (!draggingRef.current) return
        syncFixedOrigin()
        dragRaf.current = requestAnimationFrame(follow)
      }
      dragRaf.current = requestAnimationFrame(follow)
      if (canSelect(square)) setSelected(square)
    },
    [canSelect, syncFixedOrigin],
  )

  const onPieceDragEnd = useCallback(() => {
    draggingRef.current = false
    cancelAnimationFrame(dragRaf.current)
  }, [])

  const onPieceDrop = useCallback(
    (source: RcSquare, target: RcSquare, piece: RcPiece): boolean => {
      if (!interactive || !game || !source || !target) return false
      const moves = legalFrom(source).filter((m) => m.to === target)
      if (moves.length === 0) return false
      const isPromo = moves.some((m) => m.promotion)
      const promotion = isPromo ? (piece?.[1] ?? 'Q').toLowerCase() : undefined
      setDragPromo(false)
      return doMove(source, target, promotion)
    },
    [interactive, game, legalFrom, doMove],
  )

  const onPromotionCheck = useCallback(
    (source: RcSquare, target: RcSquare): boolean => {
      if (!game) return false
      const promo = legalFrom(source).some((m) => m.to === target && !!m.promotion)
      // Only flag the overlay while a real drop is happening (this callback is
      // also used by react-chessboard's animation code).
      if (promo && draggingRef.current) setDragPromo(true)
      return promo
    },
    [game, legalFrom],
  )

  const onPromotionPieceSelect = useCallback(
    (piece?: RcPromotionPiece): boolean => {
      const tap = pendingPromo
      setPendingPromo(null)
      setDragPromo(false)
      if (tap) {
        // Tap-to-move promotion: we make the move ourselves.
        if (piece) doMove(tap.from, tap.to, piece[1].toLowerCase())
        else setSelected(null)
        return false
      }
      // Drag promotion: let react-chessboard call onPieceDrop with the chosen piece.
      return !!piece
    },
    [pendingPromo, doMove],
  )

  // ---- shake -----------------------------------------------------------------
  const lastShake = useRef(shake ?? 0)
  useEffect(() => {
    const n = shake ?? 0
    if (n === lastShake.current) return
    lastShake.current = n
    const el = boardRef.current
    if (!el || typeof el.animate !== 'function') return
    const a = prefersReducedMotion() ? 2 : Math.max(6, Math.round(size * 0.016))
    el.animate(
      [
        { transform: 'translateX(0)' },
        { transform: `translateX(${-a}px) rotate(-0.6deg)` },
        { transform: `translateX(${a}px) rotate(0.6deg)` },
        { transform: `translateX(${-a * 0.7}px)` },
        { transform: `translateX(${a * 0.7}px)` },
        { transform: `translateX(${-a * 0.3}px)` },
        { transform: 'translateX(0)' },
      ],
      { duration: 420, easing: 'ease-in-out' },
    )
  }, [shake, size])

  // ---- square styles (theme base + highlight layers) ------------------------
  const checkSquare = useMemo(() => {
    if (!showCheck || !game) return null
    try {
      if (!game.inCheck()) return null
      const kings = game.findPiece({ type: 'k', color: game.turn() })
      return kings[0] ?? null
    } catch {
      return null
    }
  }, [game, showCheck])

  const squareStyles = useMemo(() => {
    const layers: Record<string, string[]> = {}
    const add = (s: string | null | undefined, layer: string) => {
      if (!isSquare(s)) return
      ;(layers[s] ??= []).push(layer)
    }
    // Top-most first.
    if (selected && interactive) {
      for (const m of selectedMoves) {
        const capture = m.isCapture()
        add(
          m.to,
          capture
            ? `radial-gradient(circle closest-side, transparent 0%, transparent 80%, ${hl.dot} 82%)`
            : `radial-gradient(circle closest-side, ${hl.dot} 0%, ${hl.dot} 30%, transparent 33%)`,
        )
      }
    }
    if (checkSquare) {
      add(checkSquare, 'radial-gradient(circle closest-side, rgba(255,40,40,0.95) 0%, rgba(231,0,0,0.55) 50%, rgba(231,0,0,0) 100%)')
    }
    if (hintSquare) {
      add(hintSquare, 'radial-gradient(circle closest-side, rgba(255,226,60,0.95) 0%, rgba(255,184,0,0.55) 60%, rgba(255,184,0,0) 100%)')
    }
    if (wrongMove) {
      add(wrongMove.to, tint(WRONG_TO))
      add(wrongMove.from, tint(WRONG_FROM))
    }
    if (selected) add(selected, tint(hl.selected))
    if (lastMove && !wrongMove) {
      add(lastMove[0], tint(hl.lastMove))
      add(lastMove[1], tint(hl.lastMove))
    }

    const out: SquareStyles = {}
    const squares: string[] = theme.squareStyle
      ? Array.from({ length: 64 }, (_, i) => FILES[i % 8] + (Math.floor(i / 8) + 1))
      : Object.keys(layers)
    for (const s of squares) {
      const base: CSSProperties = theme.squareStyle ? theme.squareStyle(s, isDarkSquare(s)) : {}
      const imgs = [...(layers[s] ?? [])]
      if (base.backgroundImage) imgs.push(String(base.backgroundImage))
      const st: Record<string, string> = {}
      if (base.backgroundColor) st.backgroundColor = String(base.backgroundColor)
      if (imgs.length) st.backgroundImage = imgs.join(', ')
      out[s as RcSquare] = st
    }
    return out
  }, [selected, interactive, selectedMoves, game, checkSquare, hintSquare, wrongMove, lastMove, theme, hl])

  // ---- react-chessboard style props ------------------------------------------
  const radius = Math.max(6, Math.round(size * 0.018))
  const boardStyle = useMemo<Record<string, string | number>>(
    () => ({
      borderRadius: `${radius}px`,
      overflow: 'hidden',
      ...(theme.boardStyle as Record<string, string | number> | undefined),
    }),
    [radius, theme],
  )
  const lightStyle = theme.light as unknown as Record<string, string>
  const darkStyle = theme.dark as unknown as Record<string, string>
  const dropStyle = useMemo(() => ({ boxShadow: 'inset 0 0 0 4px rgba(255,255,255,0.85)' }), [])

  // ---- overlay (arrows, circles, badges, coordinates) ---------------------------
  const promoting = !!pendingPromo || dragPromo
  const validArrows = (arrows ?? []).filter((a) => isSquare(a.from) && isSquare(a.to) && a.from !== a.to)
  const validCircles = (highlights ?? []).filter((h) => isSquare(h.square))
  const notation = useMemo(() => notationColors(theme), [theme])

  const overlay = (
    <div className="cb-overlay" aria-hidden style={{ visibility: promoting ? 'hidden' : 'visible' }}>
      {showCoordinates && size >= 160 && (
        <Coordinates orientation={orientation} sq={sq} colors={notation} />
      )}
      {isSquare(hintSquare) && <SquareMark square={hintSquare} orientation={orientation} className="cb-hint" />}
      {(validArrows.length > 0 || validCircles.length > 0) && (
        <svg className="cb-svg" viewBox="0 0 8 8" width={size} height={size}>
          {validCircles.map((h, i) => {
            const { x, y } = squareXY(h.square, orientation)
            return (
              <circle
                key={`c${i}-${h.square}`}
                className="cb-circle"
                cx={x + 0.5}
                cy={y + 0.5}
                r={0.44}
                fill="none"
                stroke={ANNOTATION_COLORS[h.color] ?? ANNOTATION_COLORS.green}
                strokeWidth={0.075}
              />
            )
          })}
          {validArrows.map((a, i) => (
            <ArrowShape key={`a${i}-${a.from}${a.to}`} arrow={a} orientation={orientation} />
          ))}
        </svg>
      )}
      {wrongMove && isSquare(wrongMove.to) && (
        <SquareMark square={wrongMove.to} orientation={orientation} className="cb-badge-slot">
          <span className="cb-badge cb-badge--wrong" style={{ fontSize: Math.max(11, Math.round(sq * 0.26)) }}>
            ✗
          </span>
        </SquareMark>
      )}
    </div>
  )

  const label =
    ariaLabel ?? `Chess board. ${orientation === 'white' ? 'White' : 'Black'} at the bottom.${interactive ? ' Your move.' : ''}`

  return (
    <div
      ref={rootRef}
      className={['cb-root', interactive ? 'cb-root--interactive' : '', className].filter(Boolean).join(' ')}
      style={{ padding: frame, maxWidth: maxSize, ...style }}
      onPointerDownCapture={interactive ? syncFixedOrigin : undefined}
    >
      {avail > 0 && (
        <div
          ref={boardRef}
          className="cb-board"
          role="group"
          aria-label={label}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            boxShadow: `0 0 0 ${frame}px ${theme.frame}, 0 ${Math.round(frame * 2.5)}px ${Math.round(frame * 6)}px rgba(30, 20, 80, 0.35)`,
          }}
        >
          <Chessboard
            id={boardId}
            position={fen}
            boardOrientation={orientation}
            boardWidth={size}
            animationDuration={animationMs}
            arePiecesDraggable={interactive}
            isDraggablePiece={isDraggablePiece}
            areArrowsAllowed={false}
            arePremovesAllowed={false}
            showBoardNotation={false}
            customPieces={customPieces}
            customBoardStyle={boardStyle}
            customLightSquareStyle={lightStyle}
            customDarkSquareStyle={darkStyle}
            customSquareStyles={squareStyles}
            customDropSquareStyle={dropStyle}
            onSquareClick={onSquareClick}
            onPieceDragBegin={onPieceDragBegin}
            onPieceDragEnd={onPieceDragEnd}
            onPieceDrop={onPieceDrop}
            onPromotionCheck={onPromotionCheck}
            onPromotionPieceSelect={onPromotionPieceSelect}
            showPromotionDialog={!!pendingPromo}
            promotionToSquare={(pendingPromo?.to as RcSquare | undefined) ?? null}
            promotionDialogVariant="modal"
          />
          {overlay}
          <span ref={fixProbeRef} className="cb-fixed-probe" aria-hidden />
        </div>
      )}
    </div>
  )
}

function SquareMark({
  square,
  orientation,
  className,
  children,
}: {
  square: string
  orientation: Color
  className: string
  children?: ReactNode
}) {
  const { x, y } = squareXY(square, orientation)
  return (
    <div className={className} style={{ left: `${x * 12.5}%`, top: `${y * 12.5}%`, width: '12.5%', height: '12.5%' }}>
      {children}
    </div>
  )
}

function ArrowShape({ arrow, orientation }: { arrow: Arrow; orientation: Color }) {
  const a = squareXY(arrow.from, orientation)
  const b = squareXY(arrow.to, orientation)
  const x1 = a.x + 0.5
  const y1 = a.y + 0.5
  const x2 = b.x + 0.5
  const y2 = b.y + 0.5
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const shaft = 0.085 // half-width of the shaft (square units)
  const headW = 0.24 // half-width of the head
  const headL = 0.36
  const start = 0.18 // start a bit away from the centre of the from-square
  const tip = len - 0.12
  const neck = tip - headL
  const P = (d: number, n: number) => `${(x1 + ux * d + nx * n).toFixed(3)},${(y1 + uy * d + ny * n).toFixed(3)}`
  const points = [
    P(start, shaft),
    P(neck, shaft),
    P(neck, headW),
    P(tip, 0),
    P(neck, -headW),
    P(neck, -shaft),
    P(start, -shaft),
  ].join(' ')
  const color = ANNOTATION_COLORS[arrow.color] ?? ANNOTATION_COLORS.green
  return (
    <polygon
      className="cb-arrow"
      points={points}
      fill={color}
      stroke={color}
      strokeWidth={0.04}
      strokeLinejoin="round"
    />
  )
}

function Coordinates({ orientation, sq, colors }: { orientation: Color; sq: number; colors: { light: string; dark: string } }) {
  const fontSize = Math.max(9, Math.round(sq * 0.19))
  const pad = Math.max(2, Math.round(sq * 0.05))
  const ink = (square: string): CSSProperties => {
    const color = isDarkSquare(square) ? colors.dark : colors.light
    return { color, textShadow: coordinateHalo(color) }
  }
  const items: ReactNode[] = []
  for (let i = 0; i < 8; i++) {
    // Rank labels down the left edge.
    const rankSquare = orientation === 'white' ? `a${8 - i}` : `h${i + 1}`
    items.push(
      <span
        key={`r${i}`}
        className="cb-coord"
        style={{
          left: pad,
          top: `calc(${i * 12.5}% + ${pad * 0.5}px)`,
          fontSize,
          ...ink(rankSquare),
        }}
      >
        {rankSquare[1]}
      </span>,
    )
    // File labels along the bottom edge.
    const fileSquare = orientation === 'white' ? `${FILES[i]}1` : `${FILES[7 - i]}8`
    items.push(
      <span
        key={`f${i}`}
        className="cb-coord"
        style={{
          left: `calc(${(i + 1) * 12.5}% - ${pad + fontSize * 0.6}px)`,
          bottom: pad * 0.3,
          fontSize,
          ...ink(fileSquare),
        }}
      >
        {fileSquare[0]}
      </span>,
    )
  }
  return <>{items}</>
}

export default ChessBoard
