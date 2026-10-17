// Board themes for Opening Quest.
//
// Every theme is applied to react-chessboard through:
//   - customLightSquareStyle / customDarkSquareStyle  -> `light` / `dark` (outer square div)
//   - customBoardStyle                                -> `boardStyle` (+ rounded corners & shadow)
//   - customSquareStyles                              -> `squareStyle(square, isDark)` (inner square div)
// Highlights (last move, selection, legal-move dots, wrong move, hint, check)
// are composed by ChessBoard as extra `backgroundImage` layers on the inner
// square div, ON TOP of whatever `squareStyle` returns, so themes never hide
// highlights. Rules for theme authors:
//   - `light`/`dark` must set `backgroundColor` (a 6-digit hex, or 'transparent'
//     for textured boards); the promotion dialog reuses it.
//   - `squareStyle` may only return `backgroundColor` and/or `backgroundImage`
//     (gradients) - no size/position lists.
//   - textured boards put the image in `boardStyle` and make squares transparent.

import type { CSSProperties } from 'react'
import { BOARD_THEME_IDS, type BoardThemeId } from '../types.ts'

/** Resolve a file in /public against Vite's base URL (works under a GitHub Pages sub-path). */
export function assetUrl(path: string): string {
  let base = '/'
  try {
    base = import.meta.env?.BASE_URL ?? '/'
  } catch {
    base = '/'
  }
  if (!base.endsWith('/')) base += '/'
  return base + path.replace(/^\/+/, '')
}

export interface BoardHighlightColors {
  /** Tint for the from/to squares of the last move. */
  lastMove?: string
  /** Tint for the selected (tapped) piece's square. */
  selected?: string
  /** Colour of legal-move dots / capture rings. */
  dot?: string
}

export interface BoardTheme {
  id: BoardThemeId
  name: string
  /** Small emoji used in pickers / chips. */
  emoji: string
  /** Outer style of light squares (must contain backgroundColor). */
  light: CSSProperties
  /** Outer style of dark squares (must contain backgroundColor). */
  dark: CSSProperties
  /** Extra board style (textures, gradients). Merged into customBoardStyle. */
  boardStyle?: CSSProperties
  /**
   * Coordinate label colours: `light` = colour of labels drawn ON light squares,
   * `dark` = colour of labels drawn ON dark squares.
   */
  notation?: { light: string; dark: string }
  /** Per-square base style (inner square div). Only backgroundColor / backgroundImage. */
  squareStyle?: (square: string, isDark: boolean) => CSSProperties
  /** Colour of the rim drawn around the board. */
  frame: string
  /** Per-theme highlight overrides (defaults in DEFAULT_HIGHLIGHTS). */
  highlight?: BoardHighlightColors
  /** Representative swatch colours [light, dark] for small UI chips. */
  swatch: [string, string]
}

export const DEFAULT_HIGHLIGHTS: Required<BoardHighlightColors> = {
  lastMove: 'rgba(255, 214, 10, 0.45)',
  selected: 'rgba(108, 75, 244, 0.5)',
  dot: 'rgba(24, 20, 60, 0.3)',
}

const FILES = 'abcdefgh'

/** a1 is dark. */
export function isDarkSquare(square: string): boolean {
  const f = FILES.indexOf(square[0])
  const r = Number(square[1]) - 1
  return (f + r) % 2 === 0
}

function stars(): string {
  // A sprinkle of tiny stars; used on galaxy dark squares.
  return [
    'radial-gradient(1.2px 1.2px at 22% 28%, rgba(255,255,255,0.95), transparent)',
    'radial-gradient(1px 1px at 68% 18%, rgba(255,255,255,0.8), transparent)',
    'radial-gradient(1.6px 1.6px at 78% 66%, rgba(255,255,255,0.9), transparent)',
    'radial-gradient(1px 1px at 36% 78%, rgba(255,255,255,0.7), transparent)',
    'linear-gradient(135deg, #8576ea 0%, #5d49c9 100%)',
  ].join(', ')
}

function rainbowSquare(square: string, isDark: boolean): CSSProperties {
  const f = FILES.indexOf(square[0])
  const r = Number(square[1]) - 1
  // Diagonal rainbow: hue walks from the a1 corner to h8.
  const hue = Math.round(((f + r) / 14) * 300)
  return {
    backgroundColor: isDark ? `hsl(${hue}, 72%, 64%)` : `hsl(${hue}, 92%, 89%)`,
  }
}

export const BOARD_THEMES: Record<BoardThemeId, BoardTheme> = {
  green: {
    id: 'green',
    name: 'Classic Green',
    emoji: '🟩',
    light: { backgroundColor: '#eeeed2' },
    dark: { backgroundColor: '#769656' },
    notation: { light: '#5f7d45', dark: '#f4f4dc' },
    frame: '#56733d',
    swatch: ['#eeeed2', '#769656'],
  },
  brown: {
    id: 'brown',
    name: 'Classic Wood',
    emoji: '🟫',
    light: { backgroundColor: '#f0d9b5' },
    dark: { backgroundColor: '#b58863' },
    notation: { light: '#946b49', dark: '#f6e5c8' },
    frame: '#86603f',
    swatch: ['#f0d9b5', '#b58863'],
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    emoji: '🌊',
    light: { backgroundColor: '#dcefff' },
    dark: {
      backgroundColor: '#5b9fd8',
      backgroundImage: 'linear-gradient(160deg, #6aaee4 0%, #4f8fcd 100%)',
    },
    notation: { light: '#3f7fb9', dark: '#0f3d6e' },
    frame: '#2c6aa6',
    highlight: { selected: 'rgba(255, 120, 60, 0.5)' },
    swatch: ['#dcefff', '#5b9fd8'],
  },
  candy: {
    id: 'candy',
    name: 'Candy',
    emoji: '🍬',
    light: { backgroundColor: '#fff0f7' },
    dark: {
      backgroundColor: '#f28dc0',
      backgroundImage: 'linear-gradient(135deg, #f7a1cc 0%, #ec78b3 100%)',
    },
    notation: { light: '#d9599a', dark: '#8c1d5a' },
    frame: '#d94f93',
    swatch: ['#fff0f7', '#f28dc0'],
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    emoji: '🌲',
    light: { backgroundColor: '#d8e8bd' },
    dark: {
      backgroundColor: '#3f7f52',
      backgroundImage: 'linear-gradient(160deg, #4b8c5c 0%, #356f46 100%)',
    },
    notation: { light: '#3f7f52', dark: '#e3f0cc' },
    frame: '#5a3d24',
    swatch: ['#d8e8bd', '#3f7f52'],
  },
  ice: {
    id: 'ice',
    name: 'Ice Palace',
    emoji: '🧊',
    light: {
      backgroundColor: '#f5fbff',
      backgroundImage: 'linear-gradient(135deg, #ffffff 0%, #eaf6fd 100%)',
    },
    dark: {
      backgroundColor: '#9fd0ec',
      backgroundImage:
        'linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 45%), linear-gradient(160deg, #b0daf1 0%, #86c1e3 100%)',
    },
    // Dark ink on both: ice dark squares carry a white sheen under the rank labels.
    notation: { light: '#3b7fae', dark: '#1d5480' },
    frame: '#6fb0d8',
    highlight: { lastMove: 'rgba(255, 196, 0, 0.5)' },
    swatch: ['#f5fbff', '#9fd0ec'],
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    emoji: '🌅',
    light: {
      backgroundColor: '#ffeccf',
      backgroundImage: 'linear-gradient(135deg, #fff3dc 0%, #ffe1c4 100%)',
    },
    dark: {
      backgroundColor: '#ef8a5f',
      backgroundImage: 'linear-gradient(135deg, #f6a457 0%, #e76f86 100%)',
    },
    notation: { light: '#c2566a', dark: '#7a2140' },
    frame: '#c0457a',
    highlight: { lastMove: 'rgba(124, 58, 237, 0.32)', selected: 'rgba(59, 130, 246, 0.5)' },
    swatch: ['#ffeccf', '#ef8a5f'],
  },
  marble: {
    id: 'marble',
    name: 'Marble',
    emoji: '🏛️',
    light: { backgroundColor: 'transparent' },
    dark: { backgroundColor: 'transparent' },
    boardStyle: {
      backgroundColor: '#c9ccd6',
      backgroundImage: `url("${assetUrl('boards/blue-marble.jpg')}")`,
      backgroundSize: '100% 100%',
    },
    notation: { light: '#6f7c96', dark: '#f4efe6' },
    frame: '#5c6680',
    swatch: ['#efe7da', '#8494b3'],
  },
  lava: {
    id: 'lava',
    name: 'Lava',
    emoji: '🌋',
    light: {
      backgroundColor: '#ffe3c7',
      backgroundImage: 'linear-gradient(135deg, #fff0dc 0%, #ffd5b0 100%)',
    },
    dark: {
      backgroundColor: '#dc4b2a',
      backgroundImage:
        'radial-gradient(circle at 30% 30%, rgba(255,190,60,0.55) 0%, rgba(255,190,60,0) 55%), linear-gradient(135deg, #f0612f 0%, #c2341c 60%, #9a2a12 100%)',
    },
    notation: { light: '#c2411c', dark: '#ffe9cf' },
    frame: '#3b1d10',
    highlight: { lastMove: 'rgba(255, 230, 0, 0.5)', selected: 'rgba(59, 130, 246, 0.55)' },
    swatch: ['#ffe3c7', '#dc4b2a'],
  },
  'royal-wood': {
    id: 'royal-wood',
    name: 'Royal Wood',
    emoji: '🪵',
    light: { backgroundColor: 'transparent' },
    dark: { backgroundColor: 'transparent' },
    boardStyle: {
      backgroundColor: '#b88a5a',
      backgroundImage: `url("${assetUrl('boards/wood4.jpg')}")`,
      backgroundSize: '100% 100%',
    },
    notation: { light: '#8a5a2e', dark: '#f3dfbd' },
    frame: '#4a2b12',
    swatch: ['#dcb886', '#8f5a2f'],
  },
  galaxy: {
    id: 'galaxy',
    name: 'Galaxy',
    emoji: '🌌',
    light: {
      backgroundColor: '#e9e4ff',
      backgroundImage: 'linear-gradient(135deg, #f3f0ff 0%, #ddd5ff 100%)',
    },
    dark: { backgroundColor: '#6b59d3', backgroundImage: stars() },
    notation: { light: '#6b59d3', dark: '#f1edff' },
    frame: '#1e1b4b',
    highlight: { lastMove: 'rgba(255, 214, 10, 0.5)', selected: 'rgba(236, 72, 153, 0.5)' },
    swatch: ['#e9e4ff', '#6b59d3'],
  },
  gold: {
    id: 'gold',
    name: 'Solid Gold',
    emoji: '🥇',
    light: {
      backgroundColor: '#fff6d6',
      backgroundImage: 'linear-gradient(135deg, #fffbea 0%, #fdecb2 100%)',
    },
    dark: {
      backgroundColor: '#d9a520',
      backgroundImage:
        'linear-gradient(135deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 40%), linear-gradient(135deg, #f1c84b 0%, #d29b17 60%, #b9820c 100%)',
    },
    // Dark ink on dark squares: their white sheen sits under the rank labels.
    notation: { light: '#a57410', dark: '#4a3000' },
    frame: '#7a5a12',
    highlight: { lastMove: 'rgba(108, 75, 244, 0.32)', selected: 'rgba(34, 197, 94, 0.5)' },
    swatch: ['#fff6d6', '#d9a520'],
  },
  rainbow: {
    id: 'rainbow',
    name: 'Rainbow',
    emoji: '🌈',
    light: { backgroundColor: '#fdf2ff' },
    dark: { backgroundColor: '#b9a4f5' },
    squareStyle: rainbowSquare,
    // Dark ink everywhere: rainbow dark squares range from blue to yellow.
    notation: { light: '#5b4a80', dark: '#241c52' },
    frame: '#7c3aed',
    // A white tint vanished on the pastel squares; saturated gold reads on every hue.
    highlight: { lastMove: 'rgba(255, 214, 10, 0.6)', selected: 'rgba(30, 27, 75, 0.5)' },
    swatch: ['#ffd6e8', '#7cc6ff'],
  },
}

export const BOARD_THEME_LIST: BoardTheme[] = BOARD_THEME_IDS.map((id) => BOARD_THEMES[id])

/**
 * Theme by id, falling back to 'green' for unknown ids (old saves, hand-edited
 * backups). Own keys only, so 'constructor' / '__proto__' / 'toString' also
 * fall back instead of returning Object.prototype members.
 */
export function boardThemeById(id: string | null | undefined): BoardTheme {
  if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(BOARD_THEMES, id)) {
    return BOARD_THEMES[id as BoardThemeId]
  }
  return BOARD_THEMES.green
}

/** Relative luminance (0..1) of a #rgb / #rrggbb colour; 0.5 for anything else. */
function hexLuminance(color: string): number {
  let h = color.trim().replace(/^#/, '')
  if (h.length === 3) h = h.replace(/./g, (c) => c + c)
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 0.5
  const ch = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4)
}

/**
 * A soft halo (CSS text-shadow) for a coordinate label of colour `ink`: dark
 * behind light ink, light behind dark ink. Keeps labels legible where a
 * gradient, sheen or texture runs under them.
 */
export function coordinateHalo(ink: string): string {
  return hexLuminance(ink) > 0.4 ? '0 1px 2px rgba(20, 12, 40, 0.55)' : '0 0 3px rgba(255, 255, 255, 0.7)'
}

export function highlightColors(theme: BoardTheme): Required<BoardHighlightColors> {
  return { ...DEFAULT_HIGHLIGHTS, ...theme.highlight }
}

/** Notation colours with sensible defaults. */
export function notationColors(theme: BoardTheme): { light: string; dark: string } {
  if (theme.notation) return theme.notation
  const l = String(theme.light.backgroundColor ?? '#eeeeee')
  const d = String(theme.dark.backgroundColor ?? '#777777')
  return { light: d, dark: l }
}

/**
 * The full static style of one square (outer + per-square base) - used by
 * MiniBoard previews, which do not go through react-chessboard.
 */
export function squareBaseStyle(theme: BoardTheme, square: string): CSSProperties {
  const dark = isDarkSquare(square)
  const outer = dark ? theme.dark : theme.light
  const inner = theme.squareStyle ? theme.squareStyle(square, dark) : {}
  return { ...outer, ...inner }
}
