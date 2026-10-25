// Corrections applied on top of the coach's Lichess study when the repertoire
// is built (src/chess/repertoire.ts). The study often shows "what goes wrong"
// as a plain side-line with no ?/?? mark, so without these the kids would be
// DRILLED on the losing move. Every entry below was checked with Stockfish 16
// (depth 18 or deeper; the note gives the depth) during the October 2026 reviews;
// numbers are from the kid's side, before → after the move. Overrides apply to an
// imported study too; a path that no longer exists (the coach changed the line)
// is skipped with a warning.
//
// path: SAN moves from the chapter start, space-separated, no move numbers
//       (check signs and !/? glyphs are optional).
// action:
//   'nag'     add an annotation (2 = ?, 4 = ??, 6 = ?!). A kid move marked ?/??/?!
//             is never taught; the line stops before it and (for ?/??) shows it
//             as a trap with its refutation after the line is complete. The mark
//             is copied to EVERY study node with the same position + move, so a
//             transposition can't sneak it back in as "also in your study".
//             `reply` (optional): the engine's refutation, made the first answer.
//   'cut'     drop the move and everything after it (e.g. a contrast note).
//   'comment' replace the move's comment text (arrows are kept).

export interface StudyOverride {
  chapterId: string
  path: string
  action: 'nag' | 'cut' | 'comment'
  nag?: 2 | 4 | 6
  reply?: string
  text?: string
  /** Why (engine numbers), for whoever maintains this list. */
  note?: string
}

export const STUDY_OVERRIDES: StudyOverride[] = [
  // ===========================================================================
  // Sicilian (the kid plays Black)
  // ===========================================================================

  // Carried over from the October 2026 engine review of the previous study (same moves,
  // re-keyed to the chapters of "Opening lines for Tournaments"), re-checked at depth 22 + 26.
  {
    chapterId: 'lLUYmS1O', // Alapin
    path: 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Bg4 Be2 Nf6 d4 cxd4 cxd4 e6 Nc3 Qa5 Bd2 Qb6 O-O Qxb2',
    action: 'nag',
    nag: 4,
    note: '10...Qxb2?? -0.3 → -4.9 (11.Rb1!, as in the study). SF16 d26 (d22: -0.3 → -4.55).',
  },
  {
    chapterId: '4zm0izkT', // Smith-Morra
    path: 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 g6 Bc4 Bg7 O-O Nf6 h3 e6 e5 Nd5',
    action: 'nag',
    nag: 2,
    reply: 'Bxd5',
    note: '9...Nd5? -0.8 → -2.2 (three white pieces hit d5; 10.Bxd5! exd5 11.Bg5, a full pawn better than 10.Nxd5). 9...Nh5 or 9...Ng8 were best. SF16 d26 (d22: -0.7 → -2.0).',
  },
  {
    chapterId: 'nlQ9e14g', // Open Sicilian
    path: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Qd2 O-O f3 d5 exd5 Nxd5 O-O-O',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 10.O-O-O?? -0.3 → -3.2 for White. Re-checked: +0.45 → +3.3 for Black, SF16 d26 (d22: +0.35 → +3.2); 10...Nxe3 is the only good reply.',
  },

  // October 2026 engine review of "Opening lines for Tournaments" (Stockfish 16 classical, d22 + d26).
  {
    chapterId: 'nlQ9e14g', // Open Sicilian
    path: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Qd2 O-O f3 d5 exd5 Nxd5 Nxc6 bxc6 O-O-O',
    action: 'nag',
    nag: 2,
    note: 'Opponent blunder, unmarked: 11.O-O-O? +0.3 → +2.4 for Black (11...Bxc3! 12.bxc3 Qa5, as in the study, is the only punishment; 11.Nxd5 was equal). SF16 d26 (d22: +0.35 → +2.1).',
  },
  {
    chapterId: 'nlQ9e14g', // Open Sicilian
    path: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Qd2 O-O O-O-O Ng4',
    action: 'comment',
    text: 'When white bishop is on e3 always look at the Ng4 idea in any opening!!',
    note: "Typo fix only (\"un any opening\"); the coach's wording is kept.",
  },
  {
    chapterId: 'lLUYmS1O', // Alapin
    path: 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Bg4 Be2 Nf6 d4 cxd4 cxd4 e6 Nc3 Qa5 Bd2 Qb6 O-O Bxf3 Bxf3 Bd6 Be3 Qc7 Nb5 Qd7',
    action: 'nag',
    nag: 4,
    note: '13...Qd7?? -1.8 → -5.1 (14.Nxd6+ Qxd6 15.Bxb7 wins the a8 rook); only 13...Bxh2+ 14.Kh1 Qd7 holds. SF16 d26 (d22: -1.4 → -4.6).',
  },
  {
    chapterId: 'lLUYmS1O', // Alapin
    path: 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Bg4 Be2 Nf6 d4 Nc6 O-O e6 dxc5 Bxc5 Qxd5 exd5 Bf4 O-O Nbd2 Rae8 Rfe1 a6 Nb3 Bb6 Rad1 Re7 h3 Bf5 Nfd4 Rfe8 Kf1 g6 Nxf5 gxf5 Bg5 Ne4 Bxe7 Rxe7 Bd3 d4',
    action: 'nag',
    nag: 2,
    note: '21...d4? -1.1 → -2.9 (22.cxd4 as in the study, within 0.4 of the best 22.Bxe4); 21...Nxf2 or 21...Bxf2 was best. The game then goes 22...Bxd4?? and drops a piece. SF16 d26 (d22: -1.0 → -2.6).',
  },
  {
    chapterId: 'lLUYmS1O', // Alapin
    path: 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Bg4 Be2 Nf6 d4 e6 c4 Qd7 dxc5 Bxc5 Nc3 O-O O-O Qc7 h3 Bh5 Bg5 Nbd7 Qb3 Rad8 Rad1 h6 Bh4 g5 Bg3',
    action: 'nag',
    nag: 2,
    note: 'Opponent blunder, unmarked: 16.Bg3? +1.3 → +3.1 for Black. 16...Qxg3 wins a piece because the Bc5 pins f2; 16.Nxg5 hxg5 17.Bxg5 was best. SF16 d26 (d22: +1.35 → +3.0). The engine gift is 1.85, under the 2.0 bar; kept because it hangs a whole piece and 16...Qxg3 is the only good reply.',
  },

  // ===========================================================================
  // London System (the kid plays White)
  // ===========================================================================

  // Carried over from the October 2026 engine review of the previous study.
  {
    chapterId: 'Ytr9pGwj', // All the variations
    path: 'd4 d5 Bf4 e6 Nf3 Nf6 e3 Bd6 Bxd6',
    action: 'comment',
    text: '5.Bg3 and 5.c3 are good moves here too.',
  },
  {
    chapterId: 'Ytr9pGwj',
    path: 'd4 d5 Bf4 e6 Nf3 Nf6 e3 Bd6 Bg3',
    action: 'comment',
    text: 'Another good move here.',
  },
  {
    chapterId: 'Ytr9pGwj',
    path: 'd4 d5 Bf4 e6 Nf3 Nf6 e3 Bd6 c3',
    action: 'comment',
    text: 'Another good move here.',
  },
  {
    chapterId: 'pnEu6Nzo', // Jobava vs King's Indian
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O c6 h4 b5 f3 b4 Nce2 Qa5 Bh6',
    action: 'nag',
    nag: 2,
    note: '10.Bh6? 0.1 → -1.6 (10...Qxa2).',
  },

  // October 2026 engine review of "Opening lines for Tournaments" (Stockfish 16 classical, d22 + d26).
  {
    chapterId: 'Ytr9pGwj', // All the variations — within 30 (ply 24)
    path: 'd4 d5 Bf4 Nf6 Nf3 c5 e3 Qb6 c4 Qxb2 Nbd2 Nc6 cxd5 Nxd5 Rb1 Qa3 Bb5 Nxf4 exf4 Bf5 Ne5 Bxb1 Qxb1 Rc8',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 12...Rc8?? +2.2 → mate in 7 (d22 and d26). Best 12...O-O-O. 13.Bxc6+ Rxc6 14.Qxb7 (study) is the mating line.',
  },
  {
    chapterId: 'Ytr9pGwj', // within 30 (ply 22)
    path: 'd4 d5 Bf4 Nc6 e3 Nf6 Nf3 Nh5 Bg3 Nxg3 hxg3 Bg4 Bb5 e6 c4 Bd6 Bxc6+ bxc6 Qa4 Qd7 c5 Be7',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 11...Be7?? +0.9 → +3.7 (d26; d22 +0.7 → +3.6). Best 11...Bxf3. 12.Ne5 (study, $18) Qc8 13.Qxc6+ Kf8 14.Nxg4 wins a piece.',
  },
  {
    chapterId: 'Lq0E0yS0', // Against ...c5 — within 30 (ply 8)
    path: 'd4 d5 Bf4 c5 e3 Qb6 Nc3 Qxb2',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 4...Qxb2?? +0.5 → +3.4 (d22 and d26). Best 4...e6. 5.Nxd5 (study) Nf6 6.Bb5+ Bd7 and Nc7+ wins the a8 rook. The coach marks the other ...Qxb2 grabs ?? too.',
  },
  {
    chapterId: 'Lq0E0yS0', // within 30 (ply 12)
    path: 'd4 d5 Bf4 c5 e3 Nc6 Nf3 Nf6 Be2 Qb6 Nc3 e6',
    action: 'nag',
    nag: 2,
    note: 'Opponent blunder, unmarked: 6...e6? +0.0 → +2.4 (d26; d22 +0.1 → +2.1), as bad as the coach-marked 6...Qxb2??. Best 6...Bg4. 7.Nb5 (study) threatens Nc7+: 7...e5 8.Nxe5 Nh5 9.dxc5 Bxc5 10.Nc4 and White is a pawn up and on top.',
  },
  {
    chapterId: '6rVXRCjB', // Old Benoni (1...c5) — within 30 (ply 11)
    path: 'd4 Nf6 Bf4 e6 Nf3 c5 e3 Qb6 Na3 Qxb2 Nc4',
    action: 'nag',
    nag: 2,
    reply: 'Qc3+',
    note: '6.Nc4? +1.1 → -0.6 (d26; d22 +1.2 → -0.9). Best 6.Nb5 (coach arrow). 6...Qc3+ 7.Ncd2 Nc6 and Black keeps the pawn.',
  },
  {
    chapterId: 'pnEu6Nzo', // Jobava vs King's Indian — within 30 (ply 15)
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O c6 h4 b5 Bh6',
    action: 'nag',
    nag: 2,
    note: '8.Bh6? 0.0 → -1.5 (d26; d22 -1.3). Best 8.f3. The study refutes it itself: 8...b4! 9.Nce2 Nxe4 (coach arrows b5b4, f6e4). Same mistake as 10.Bh6?.',
  },
  {
    chapterId: 'pnEu6Nzo', // within 30 (ply 24)
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O c6 h4 b5 f3 b4 Nce2 a5 Bh6 Na6 h5 Nxh5 Rxh5 gxh5',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 12...gxh5?? +2.8 → mate in 2 (d22 and d26). Best 12...Bxh6/Bf6. 13.Qg5 (study) pins Bg7 and 14.Qxg7#.',
  },
  {
    chapterId: 'pnEu6Nzo', // within 30 (blunder ply 28, punish ply 29)
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O Nbd7 Bh6 Bxh6 Qxh6 c6 h4 Qa5 h5 Nxh5 g4 Nhf6 g5 Nh5 Be2 Re8 Bxh5 gxh5',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 14...gxh5?? +2.9 → +7.2 (d26; d22 +2.6 → +6.7). Best 14...Nf8. 15.Rxh5 (study).',
  },
  {
    chapterId: 'pnEu6Nzo', // NOT within 30 (ply 32)
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O Nbd7 Bh6 Bxh6 Qxh6 c6 h4 Qa5 h5 Nxh5 g4 Nhf6 g5 Nh5 Be2 Re8 Bxh5 gxh5 Rxh5 Nf8 g6 Qb6',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 16...Qb6?? +6.9 → mate in 4 (d22 and d26). Best 16...fxg6. 17.gxh7+ Kh8 18.Qg7+ Kxg7 19.h8=Q+ Kg6 20.Qh6# (study).',
  },
  {
    chapterId: 'pnEu6Nzo', // NOT within 30 (ply 48)
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O c6 h4 b5 f3 b4 Nce2 Qa5 Kb1 Be6 Nc1 Nbd7 Bh6 Rfc8 h5 Nxh5 Bxg7 Kxg7 g4 Nhf6 Qh6+ Kg8 g5 Nh5 f4 Bg4 Be2 Bxe2 Ngxe2 e6 Rxh5 gxh5 Rh1 Nf8 f5 exf5 Ng3 fxe4',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 24...fxe4?? +5.2 → mate in 4 (d26 +5.2; d22 after 25.Nxh5 M4). Best 24...Rc7. 25.Nxh5 (study, $18).',
  },
  {
    chapterId: 'pnEu6Nzo', // NOT within 30 (ply 48)
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O c6 h4 b5 f3 b4 Nce2 Qa5 Kb1 Be6 Nc1 Nbd7 Bh6 Rfc8 h5 Nxh5 Bxg7 Kxg7 g4 Nhf6 Qh6+ Kg8 g5 Nh5 f4 Bg4 Be2 Bxe2 Ngxe2 e6 f5 exf5 Rxh5 gxh5 Rh1 Qd8 Rxh5 Qf8',
    action: 'nag',
    nag: 4,
    reply: 'Qxh7#',
    note: 'Opponent blunder, unmarked: 24...Qf8?? +4.2 → mate in 1 (d26). Best 24...Nf8. The study stops here; the coach arrow h6-h7 gives 25.Qxh7#.',
  },
  {
    chapterId: 'pnEu6Nzo', // NOT within 30 (ply 50)
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O c6 h4 b5 f3 b4 Nce2 Qa5 Kb1 Be6 Nc1 Nbd7 Bh6 Rfc8 h5 Nxh5 Bxg7 Kxg7 g4 Nhf6 Qh6+ Kg8 g5 Nh5 f4 Bg4 Be2 Bxe2 Ngxe2 e6 f5 exf5 Rxh5 gxh5 Rh1 Qd8 Rxh5 Nf8 exf5 Qd7',
    action: 'nag',
    nag: 4,
    reply: 'f6',
    note: 'Opponent blunder, unmarked: 25...Qd7?? +4.1 → mate in 3 (d26). Best 25...f6. 26.f6 (engine best, coach arrow f5-f6) Ne6 27.Qxh7+ Kf8 28.Qh8#. The study stops here.',
  },
  {
    chapterId: 'pnEu6Nzo', // NOT within 30 (ply 52)
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O c6 h4 b5 f3 b4 Nce2 Qa5 Kb1 Be6 Nc1 Nbd7 Bh6 Rfc8 h5 Nxh5 Bxg7 Kxg7 g4 Nhf6 Qh6+ Kg8 g5 Nh5 f4 Bg4 Be2 Bxe2 Ngxe2 e6 f5 exf5 Rxh5 gxh5 Rh1 Qd8 Rxh5 Nf8 exf5 f6 gxf6 Qc7',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 26...Qc7?? +4.1 → forced mate (d26 M9; d22 +3.7 → M10). Best 26...Rc7. After 27.Nf4 (study) the mate is still forced.',
  },

  // ===========================================================================
  // Black vs 1.d4 — Queen's Gambit Declined (the kid plays Black)
  // ===========================================================================

  // Carried over from the October 2026 engine review of the previous study. Since 8...f6 is
  // marked below, no drilled line reaches this move any more; kept for imported studies.
  {
    chapterId: 'uZSAaAkT', // QGD 5.Bf4
    path: 'd4 d5 c4 e6 Nc3 Be7 Nf3 Nf6 Bf4 c6 e3 O-O Bd3 Nh5 Be5 f6 Ng5 fxe5',
    action: 'nag',
    nag: 2,
    note: '9...fxe5? -1.4 → -2.2 (SF16 d30/d32; 9...h6 best) — 10.Bxh7+ Kh8 11.Nf7+ Rxf7 12.Qxh5.',
  },

  // October 2026 engine review of "Opening lines for Tournaments" (Stockfish 16 classical, d26–d34).
  {
    chapterId: 'uZSAaAkT', // QGD 5.Bf4
    path: 'd4 d5 c4 e6 Nc3 Be7 Nf3 Nf6 Bf4 O-O e3 b6 cxd5 Nxd5 e4',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 8.e4?? leaves Bf4 unguarded (the e-pawn left e3); -0.1 → +2.6 for Black (SF16 d26: best 8.Nxd5 -0.08, after 8.e4 +2.64; 8...Nxf4 +2.62 vs 8...Nxc3 0.00). The study’s 8...Nxf4 is the engine’s move.',
  },
  {
    chapterId: 'uZSAaAkT', // QGD 5.Bf4
    path: 'd4 d5 c4 e6 Nc3 Be7 Nf3 Nf6 Bf4 c6 e3 O-O Bd3 Nh5 Be5 f6',
    action: 'nag',
    nag: 6,
    note: '8...f6?! -0.2 → -1.45 (SF16 d34; d32: 8...Nd7 -0.26, 8...dxc4 -0.22; 8...f6 -1.48 at d33): 9.Ng5! (d28 +1.08 for White vs 9.Qc2 +0.40) and only a precise defence (9...h6 10.Qxh5 fxe5 11.Qg6 Bxg5 12.Qh7+ Kf7, or 9...Qe8) holds. Shallow search understates it (d28: -0.94).',
  },
]
