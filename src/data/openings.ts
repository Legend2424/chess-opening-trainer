import type { OpeningDef } from '../types.ts'

/**
 * Bundled export of the Lichess study "Opening lines for Tournaments" (phFA64zi),
 * the coach's tournament-preparation study. It replaced "Opening lines (For Minka
 * and David)" (CZiXOjIp) in October 2026; progress on lines that are still the
 * same carries over (src/data/lineMigrations.ts).
 */
export const STUDY_FILE = 'studies/opening-lines.pgn'
export const STUDY_URL = 'https://lichess.org/study/phFA64zi'

// Chapter ids come from each chapter's [ChapterURL] tag, so they survive the
// coach re-ordering or renaming chapters on Lichess. Every chapter of the study
// is a core chapter (side lines included); the side is the chapter's
// [Orientation] on Lichess.
export const OPENINGS: OpeningDef[] = [
  {
    id: 'sicilian',
    name: 'Sicilian Defence',
    tagline: 'You play Black against 1.e4',
    side: 'black',
    emoji: '🐉',
    accent: '#ef4444',
    chapters: [
      { id: 'nlQ9e14g', title: 'Open Sicilian' },
      { id: 'lLUYmS1O', title: 'Alapin (2.c3)' },
      { id: 'mFhr4g8J', title: 'Delayed Alapin (2.Nf3 Nc6 3.c3)' },
      { id: '4zm0izkT', title: 'Smith-Morra Gambit' },
      { id: 'n8PqQYEr', title: 'Closed Sicilian (2.Nc3)' },
      { id: 'L3QbzELB', title: 'Side lines' },
    ],
    extraChapters: [],
  },
  {
    id: 'london',
    name: 'London System',
    tagline: 'You play White: 1.d4 and Bf4',
    side: 'white',
    emoji: '🏰',
    accent: '#3b82f6',
    chapters: [
      { id: 'Ytr9pGwj', title: 'All the variations' },
      { id: 'Lq0E0yS0', title: 'Against ...c5' },
      { id: '6rVXRCjB', title: 'Old Benoni (1...c5)' },
      { id: 'pnEu6Nzo', title: "Jobava vs King's Indian" },
    ],
    extraChapters: [],
  },
  {
    id: 'vs-d4',
    name: 'Black vs 1.d4',
    tagline: "You play Black: the Queen's Gambit Declined",
    side: 'black',
    emoji: '🛡️',
    accent: '#22c55e',
    chapters: [
      { id: '2WiWtA7F', title: "QGD: White plays 5.Bg5" },
      { id: 'uZSAaAkT', title: "QGD: White plays 5.Bf4" },
      { id: 'HZy0SmYx', title: 'QGD: Exchange variation' },
    ],
    extraChapters: [],
  },
]

/** Default line length cap (plies from the start). 30 = 15 moves each. 0 = no limit. */
export const DEFAULT_MAX_PLY = 30

export function openingById(id: string): OpeningDef | undefined {
  return OPENINGS.find((o) => o.id === id)
}
