// Where a game vs the robot can start: the normal start, the end of each
// opening's main line (first line of its first chapter), or a position handed
// over by the trainer ("Play on").
import { Chess } from 'chess.js'
import type { Color, Repertoire } from '../../types.ts'
import { movesLabel } from '../../chess/repertoire.ts'

export const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface StartOption {
  /** 'standard' | 'fen' | `opening:${id}` */
  id: string
  emoji: string
  title: string
  subtitle: string
  /** Optional second line (an opening's first moves). */
  detail?: string
  fen: string
  /** The colour that suits this start (an opening's side). */
  suggestedColor?: Color
  openingId?: string
  accent?: string
}

export function standardStart(): StartOption {
  return { id: 'standard', emoji: '♟️', title: 'Normal start', subtitle: 'Every piece at home', fen: STANDARD_FEN }
}

export function fenStart(fen: string, userColor?: Color): StartOption {
  return {
    id: 'fen',
    emoji: '📍',
    title: 'Continue from training position',
    subtitle: 'Play on from where your line ended',
    fen,
    suggestedColor: userColor,
  }
}

/** One option per opening: its main line, played to the end. */
export function openingStarts(reps: Repertoire[]): StartOption[] {
  const out: StartOption[] = []
  for (const rep of reps) {
    const firstChapter = rep.opening.chapters[0]?.id ?? rep.chapters[0]?.id
    const line = rep.lines.find((l) => l.chapterId === firstChapter) ?? rep.lines[0]
    const last = line?.moves[line.moves.length - 1]
    if (!line || !last || !isPlayableFen(last.fen)) continue
    const n = Math.ceil(line.moves.length / 2)
    const preview = movesLabel(line.moves.slice(0, 4))
    out.push({
      id: `opening:${rep.opening.id}`,
      emoji: rep.opening.emoji,
      title: rep.opening.name,
      subtitle: `Main line · ${n} move${n === 1 ? '' : 's'} deep`,
      detail: `${preview}${line.moves.length > 4 ? ' …' : ''}`,
      fen: last.fen,
      suggestedColor: rep.opening.side,
      openingId: rep.opening.id,
      accent: rep.opening.accent,
    })
  }
  return out
}

/** A legal position where the game is not already over. */
export function isPlayableFen(fen: string | undefined | null): fen is string {
  if (!fen) return false
  try {
    const c = new Chess(fen)
    return !c.isGameOver()
  } catch {
    return false
  }
}

export function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w'
}
