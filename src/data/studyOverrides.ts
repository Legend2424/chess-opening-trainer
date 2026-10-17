// Corrections applied on top of the coach's Lichess study when the repertoire
// is built (src/chess/repertoire.ts). The study often shows "what goes wrong"
// as a plain side-line with no ?/?? mark, so without these the kids would be
// DRILLED on the losing move. Every entry below was checked with Stockfish 16
// (depth 18) during the October 2026 review; numbers are from the kid's side,
// before → after the move. Overrides apply to an imported study too; a path
// that no longer exists (the coach changed the line) is skipped with a warning.
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
  // ---------------------------------------------------------------- Sicilian
  {
    chapterId: '2qESM7D4', // Alapin
    path: 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Nf6 d4 Bg4 Be2 e6 c4 Bxf3',
    action: 'nag',
    nag: 2,
    reply: 'cxd5',
    note: '7...Bxf3? 0.0 → -3.9: 8.cxd5 wins the queen (the study continues 8.Bxf3?). 7...Qd7 is the move.',
  },
  {
    chapterId: '2qESM7D4',
    path: 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Nf6 d4 Bg4 Be2 e6 c4 Bxf3 Bxf3 Qd7 dxc5 Nc6 Qxd7+ Nxd7 Nc3 Bxc5 O-O O-O Bf4 Rad8 Rad1 Nf6 Rxd8 Re8',
    action: 'nag',
    nag: 4,
    note: '15...Re8?? 0.0 → -5.5 (15...Rxd8 recaptures).',
  },
  {
    chapterId: '2qESM7D4',
    path: 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Bg4 Be2 Nf6 d4 cxd4 cxd4 e6 Nc3 Qa5 Bd2 Qb6 O-O Qxb2',
    action: 'nag',
    nag: 2,
    note: '10...Qxb2? -0.3 → -3.4.',
  },
  {
    chapterId: '2qESM7D4',
    path: 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Nf6 d4 c4 Nbd2 b5 Be2 Bg4 O-O Nc6 h3 Bh5 Re1 e5 Nxe5 Nxe5',
    action: 'nag',
    nag: 2,
    note: '5...c4 tree, 10...e5 branch: 11...Nxe5? -2.2 → -5.0 (the line ends at -6.3).',
  },
  {
    chapterId: '2qESM7D4',
    path: 'e4 c5 c3 d5 exd5 Qxd5 Nf3 Nf6 d4 c4 Nbd2 b5 Be2 Bg4 O-O Nc6 h3 Bh5 Re1 e6 Ne5 Nxe5 Bxh5 Nxh5',
    action: 'nag',
    nag: 2,
    note: '5...c4 tree, 10...e6 branch: 12...Nxh5? -1.6 → -3.5 (12...Nd3 / 12...Nc6 stay).',
  },
  {
    chapterId: '2qESM7D4',
    path: 'e4 c5 c3 Nf6 e5 Ne4',
    action: 'nag',
    nag: 6,
    note: '3...Ne4?! -0.1 → -1.5; 3...Nd5 is the main move.',
  },
  {
    chapterId: '2qESM7D4',
    path: 'e4 d5',
    action: 'cut',
    note: 'A Scandinavian contrast note (1...d5 2.exd5 Qxd5 3.Nc3), not Sicilian practice.',
  },
  {
    chapterId: 'N0udImNg', // Minka's Sicilian
    path: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Be3 Bg7 Nc3 d6 Qd2 Nf6 f3 O-O O-O-O d5 exd5 Nxd5 Nxc6 bxc6 Nxd5 c5',
    action: 'nag',
    nag: 4,
    reply: 'Nxe7+',
    note: '12...c5?? -0.1 → -5.7 (13.Nxe7+ uncovers the d-file on the queen). 12...cxd5 is the move.',
  },
  {
    chapterId: 'N0udImNg',
    path: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nxc6 bxc6 Bc4 Bg7 Qf3 e6 Nc3 Ne7 Bg5 O-O Bf6 Bxf6 Qxf6 d5 exd5 cxd5 Bd3 Qb6 O-O Qxb2 Nxd5 Nxd5',
    action: 'nag',
    nag: 4,
    note: '15...Nxd5?? 0.1 → -4.4 (the study itself shows 16.Qxb2); 15...Qxf6 is the move.',
  },
  {
    chapterId: 'Z2j8QKc3', // Closed Sicilian
    path: 'e4 c5 Nc3 Nc6 Nf3 d6 d4 cxd4 Nxd4 Nf6 Bc4 e6 Be3 a6 Qe2 Qc7 O-O-O b5 Nxc6 Qxc6 Nxb5 axb5',
    action: 'nag',
    nag: 2,
    note: '11...axb5? -0.4 → -2.8 (12.Bxb5 pins the queen).',
  },
  {
    chapterId: 'Z2j8QKc3',
    path: 'e4 c5 Nc3 Nc6 Nf3 d6 d4 cxd4 Nxd4 Nf6 Be3 Ng4 Bf4 Qb6 Nb3',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 8.Nb3?? allows 8...Qxf2# — punish it!',
  },
  {
    chapterId: 'meVSzWDe', // Smith-Morra
    path: 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 g6 Bc4 Bg7 O-O Nf6 h3 e6 e5 Nd5',
    action: 'nag',
    nag: 6,
    note: '9...Nd5?! -0.8 → -1.7 (three white pieces hit d5).',
  },
  {
    chapterId: 'hF97JQsY', // Open Sicilian
    path: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 c4 Bg7 Be3 e6 Nb5 Bxb2 N1c3 Bxa1 Qxa1 d6',
    action: 'nag',
    nag: 6,
    note: '5.c4 sideline: 9...d6?! -0.3 → -1.5.',
  },
  {
    chapterId: 'hF97JQsY',
    path: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 c4 Bg7 Be3 e6 Nb5 Bxb2 N1c3 Bxa1 Qxa1 d6 Nd5 exd5 Qxh8 Qa5+',
    action: 'nag',
    nag: 2,
    note: '11...Qa5+? -1.8 → -4.7.',
  },
  {
    chapterId: 'hF97JQsY',
    path: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Qd2 O-O f3 d5 exd5 Nxd5 O-O-O',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 10.O-O-O?? -0.3 → -3.2 for White.',
  },
  {
    chapterId: 'hF97JQsY',
    path: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Qd2 O-O f3 d5 exd5 Nxd5 Nxc6 bxc6 O-O-O Qa5 Nxd5 Qxa2 Nc3',
    action: 'nag',
    nag: 4,
    note: 'Opponent blunder, unmarked: 13.Nc3?? allows mate in 2 (13...Qa1+ 14.Nb1 Bxb2#).',
  },
  {
    chapterId: 'Yvs9ytuY', // Delayed Alapin (extra)
    path: 'e4 d5',
    action: 'cut',
    note: 'Scandinavian contrast note.',
  },
  {
    chapterId: 'Yvs9ytuY',
    path: 'e4 c5 Nf3 d5',
    action: 'cut',
    note: 'Contrast note (2...d5 3.exd5 Qxd5), not this opening.',
  },

  // ----------------------------------------------------------------- London
  {
    chapterId: '9cf1LJTm', // King-side castle
    path: 'd4 d5 Nf3 Nf6 Bf4 Bg4 e3 e6 Ne5',
    action: 'nag',
    nag: 4,
    reply: 'Bxd1',
    note: '5.Ne5?? 0.1 → -5.2: 5...Bxd1 takes the queen.',
  },
  {
    chapterId: '9cf1LJTm',
    path: 'd4 d5 Nf3 Nf6 Bf4 Bf5 e3 e6 Nc3 c5 Bd3 c4 Be2 Qa5 Qd2 Nc6 O-O-O',
    action: 'nag',
    nag: 2,
    note: '9.O-O-O? -0.1 → -2.6.',
  },
  {
    chapterId: '9cf1LJTm',
    path: 'd4 d5 Bf4 Nf6 Nf3 Bf5 Nc3 e6 e3 Bb4 Qd2 O-O O-O-O',
    action: 'nag',
    nag: 2,
    note: '7.O-O-O? -0.1 → -1.4 (and the line hides 10...Qa3).',
  },
  {
    chapterId: 'ssTMaLdm', // Old Benoni
    path: 'd4 c5 d5 Nf6 Nf3 e6 c4 exd5 cxd5 d6 e4 Be7 Bd3 O-O O-O Bg4 Bd2 Nbd7 Nc3 a6 a4 Ne5 h3',
    action: 'nag',
    nag: 2,
    note: '12.h3? 0.2 → -2.6 (the coach\'s arrows show why); 12.Be2 is the move.',
  },
  {
    chapterId: 'B3WBQHeX', // Queen-side castle
    path: 'd4 d5 Nf3 Nf6 Bf4 Bf5 e3 e6 Nc3 Nc6 Bd3 Bb4 Qd2 Ne4 Bxe4 Bxe4 Ne5 Nxe5 Bxe5 O-O f3 Bg6 O-O-O Rc8 h4 h6 h5 Bh7 f4',
    action: 'nag',
    nag: 2,
    note: '15.f4? -0.3 → -2.6; past it the study shows six 23rd moves that all get mated.',
  },
  {
    chapterId: 'Eype8ZVY', // All the variations
    path: 'd4 d5 Bf4 e6 Nf3 Nf6 e3 Bd6 Bxd6',
    action: 'comment',
    text: '5.Bg3 and 5.c3 are good moves here too.',
  },
  {
    chapterId: 'Eype8ZVY',
    path: 'd4 d5 Bf4 e6 Nf3 Nf6 e3 Bd6 Bg3',
    action: 'comment',
    text: 'Another good move here.',
  },
  {
    chapterId: 'Eype8ZVY',
    path: 'd4 d5 Bf4 e6 Nf3 Nf6 e3 Bd6 c3',
    action: 'comment',
    text: 'Another good move here.',
  },
  {
    chapterId: 'te3Psg4r', // Jobava vs King's Indian (extra)
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O c6 h4 b5 f3 b4 Nce2 Qa5 Kb1 Be6 Nc1 Nbd7 Bh6 Rfc8 h5 Nxh5 Bxg7 Kxg7 Qg5',
    action: 'nag',
    nag: 4,
    note: '15.Qg5?? 0.8 → -7.7.',
  },
  {
    chapterId: 'te3Psg4r',
    path: 'd4 Nf6 Bf4 g6 Nc3 Bg7 e4 d6 Qd2 O-O O-O-O c6 h4 b5 f3 b4 Nce2 Qa5 Bh6',
    action: 'nag',
    nag: 2,
    note: '10.Bh6? 0.1 → -1.6 (10...Qxa2).',
  },
  {
    chapterId: 'euK9iQ26', // More lines for White (extra)
    path: 'd4 Nf6 Bf4 g6 Nf3 Bg7 e3 d6 Be2 O-O O-O Nbd7 Nbd2 Re8 c4 e5 Bg3 e4 Ng5 h6 Nh3 g5 Qc2 Qe7 f3',
    action: 'nag',
    nag: 2,
    note: '13.f3? -0.2 → -1.7 (-2.4 by 15.Rxf6).',
  },

  // ----------------------------------------------------------- Black vs 1.d4
  {
    chapterId: 'VgzbIFWd', // Queen's Gambit Accepted
    path: 'd4 d5 c4 dxc4 e4 b5 a4 c6 axb5 cxb5 Nc3 Qb6 b3 b4',
    action: 'nag',
    nag: 2,
    note: '7...b4? -0.6 → -2.5 (8.Nd5). 7...cxb3 is the move.',
  },
  {
    chapterId: 'VgzbIFWd',
    path: 'd4 d5 c4 dxc4 e4 b5 a4 c6 axb5 cxb5 Nc3 Qb6 b3 b4 Nd5 Qb7 Bf4 Na6',
    action: 'nag',
    nag: 4,
    note: '9...Na6?? -2.6 → -5.3 (10.Rxa6).',
  },
  {
    chapterId: 'VgzbIFWd',
    path: 'd4 d5 c4 dxc4 e4 b5 a4 c6 axb5 cxb5 Nc3 Qb6 b3 cxb3 Bxb5+ Bd7 Qxb3 Bxb5',
    action: 'nag',
    nag: 2,
    note: '9...Bxb5? -1.3 → -2.5.',
  },
  {
    chapterId: 'LF3nEQPS', // Queen's Gambit Declined
    path: 'd4 d5 c4 e6 Nc3 Be7 Nf3 Nf6 Bf4 c6 e3 O-O Bd3 Nh5 Be5 f6 Ng5 fxe5',
    action: 'nag',
    nag: 2,
    note: '9...fxe5? -1.0 → -2.1 (10.Bxh7+ Kh8 11.Nf7+ Rxf7 12.Qxh5).',
  },
]
