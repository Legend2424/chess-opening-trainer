import type { OpeningDef } from '../types.ts'

/** Bundled export of the Lichess study "Opening lines (For Minka and David)" (CZiXOjIp). */
export const STUDY_FILE = 'studies/opening-lines.pgn'
export const STUDY_URL = 'https://lichess.org/study/CZiXOjIp'

// Chapter ids come from each chapter's [ChapterURL] tag, so they survive the
// coach re-ordering or renaming chapters on Lichess.
export const OPENINGS: OpeningDef[] = [
  {
    id: 'sicilian',
    name: 'Sicilian Defence',
    tagline: 'You play Black against 1.e4',
    side: 'black',
    emoji: '🐉',
    accent: '#ef4444',
    chapters: [
      { id: 'hF97JQsY', title: 'Open Sicilian' },
      { id: '2qESM7D4', title: 'Alapin (2.c3)' },
      { id: 'meVSzWDe', title: 'Smith-Morra Gambit' },
      { id: 'Z2j8QKc3', title: 'Closed Sicilian (2.Nc3)' },
      { id: 'nUVPgBpK', title: 'Side lines' },
      { id: 'N0udImNg', title: "Minka's Sicilian" },
    ],
    extraChapters: [
      { id: 'Yvs9ytuY', title: 'Delayed Alapin' },
      { id: 'ZRsy3eED', title: 'More lines for Black' },
      { id: 'wZ0MHYZj', title: "Minka's openings" },
    ],
  },
  {
    id: 'london',
    name: 'London System',
    tagline: 'You play White: 1.d4 and Bf4',
    side: 'white',
    emoji: '🏰',
    accent: '#3b82f6',
    chapters: [
      { id: 'Eype8ZVY', title: 'All the variations' },
      { id: '9cf1LJTm', title: 'King-side castle' },
      { id: '56ZNaCUd', title: 'Against ...c5' },
      { id: 'ssTMaLdm', title: 'Old Benoni (1...c5)' },
      { id: 'B3WBQHeX', title: 'Queen-side castle' },
      { id: 'yzE9psyE', title: 'London lines' },
    ],
    extraChapters: [
      { id: 'YwJbmh0T', title: 'Doubled d-pawns' },
      { id: 'te3Psg4r', title: "Jobava vs King's Indian" },
      { id: 'WqxBP5xX', title: "Jobava vs King's Indian 2" },
      { id: 'euK9iQ26', title: 'More lines for White' },
      { id: 'QXnds8zd', title: "Minka's openings (White)" },
    ],
  },
  {
    id: 'vs-d4',
    name: 'Black vs 1.d4',
    tagline: "You play Black against the Queen's pawn",
    side: 'black',
    emoji: '🛡️',
    accent: '#22c55e',
    chapters: [
      { id: 'LF3nEQPS', title: "Queen's Gambit Declined" },
      { id: 'VgzbIFWd', title: "Queen's Gambit Accepted" },
    ],
    extraChapters: [{ id: 'wZChSNmU', title: 'English opening (1.c4)' }],
  },
]

/** Default line length cap (plies from the start). 30 = 15 moves each. 0 = no limit. */
export const DEFAULT_MAX_PLY = 30

export function openingById(id: string): OpeningDef | undefined {
  return OPENINGS.find((o) => o.id === id)
}
