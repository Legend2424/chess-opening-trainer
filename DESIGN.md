# Opening Quest — design spec

A fun, iPad-first chess **opening trainer** for two kids, **David** and **Minka**.
They practise the opening lines their coach (WFM Ana Kuchava) put in the Lichess
study *"Opening lines (For Minka and David)"*, earn **coins** for every line, and
spend them on board themes, piece sets, avatars, trophies — or save up and
redeem them for real **Pokémon packs** (parent-approved).

Stack (reused from `C:\Claude\chess-endgame-trainer`): React 18 + Vite 5 + TS 5.9,
`react-chessboard` 4.7 (auto TouchBackend on iPad), `chess.js` 1.4, Stockfish 16
NNUE WASM in `public/engine/` (lazy-loaded, only for "Play vs computer" and smart
mistake feedback), `canvas-confetti`, `@fontsource/fredoka` (headings) +
`@fontsource/nunito` (body). Static site → GitHub Pages. All state in
`localStorage` (+ backup export/import). No backend.

Node 24 is at `C:\Claude\tools\node` (prepend to PATH: `export PATH="$PATH:/c/Claude/tools/node"`).
Typecheck: `npx tsc -b` (or `npx tsc --noEmit -p .`). Build: `npm run build`.

## 0. Ground rules for every module

- Shared types live in `src/types.ts` — **do not change them** without a very good
  reason; if you must add a field, add it as optional and mention it in your report.
- Opening/chapter catalogue: `src/data/openings.ts` (`OPENINGS`, `STUDY_FILE`, `DEFAULT_MAX_PLY`).
- Pure logic (`src/chess/*`, `src/trainer/trainerReducer.ts`, `src/store/rewards.ts`,
  `src/store/catalog.ts`, `src/store/achievements.ts`, `src/store/profileOps.ts`) must
  run under plain `node` (Node 24 strips types): `import type` for types, `.ts`
  extensions on relative imports, no enums/namespaces/parameter properties, no DOM.
- Tests are plain Node scripts in `scripts/` (e.g. `node scripts/test-repertoire.ts`)
  using `node:assert`. They must exit non-zero on failure.
- Kid-friendly copy: short, warm, encouraging. Never shame. Emoji welcome.
- Touch first: every tap target ≥ 48px; no hover-only affordances.

## 1. Data: the study PGN → repertoires

`public/studies/opening-lines.pgn` is the full Lichess export (53 chapters; only the
chapters listed in `OPENINGS` are used). Real-world quirks to handle:

- Multiple games separated by blank lines; headers `[Key "Value"]`; `[ChapterURL ".../CZiXOjIp/<chapterId>"]`.
- Movetext: move numbers (`1.` / `1...`), nested variations `( ... )`, comments `{ ... }`
  (possibly several in a row, possibly multi-line), NAGs `$1..$255`, suffix glyphs
  (`Qxb2??`, `a3!`, `Rb2!!`, `e6?!`), result tokens (`*`, `1-0`, ...), check/mate `+ #`,
  castling `O-O`/`O-O-O`, promotions `e8=Q`.
- Embedded commands inside comments: `[%cal Gd2d4,Rg8f6]` (arrows; first letter
  G/R/B/Y = green/red/blue/yellow), `[%csl Gc4,Bd5]` (square highlights), `[%clk 0:10:00]`,
  `[%eval ...]`, `[%anno "BigCeej", bigceej]` — strip all from text; keep cal/csl as data.
- A comment **before the first move** = chapter intro. A comment after a move belongs to that move.
- Some chapters start from a `[FEN "..."]` position. Some chapters are empty (`*`).
- Bad SAN must not crash the app: skip the rest of that branch and `console.warn`.

### `src/chess/pgn.ts`
```ts
export interface PgnNode { san: string; comments: string[]; nags: number[]; children: PgnNode[] }
export interface PgnGame { headers: Record<string, string>; intro: string[]; roots: PgnNode[] }
export function parsePgnFile(text: string): PgnGame[]
export function parseCommentCommands(raw: string): { text: string; arrows: Arrow[]; highlights: Highlight[] }
```

### `src/chess/repertoire.ts`
```ts
export function positionKey(fen: string): string            // first 4 FEN fields
export function chapterIdOf(game: PgnGame): string | null    // from ChapterURL
export interface BuildOptions { maxPly: number /*0 = no cap*/; enabledExtras: string[] }
export function buildRepertoire(def: OpeningDef, games: PgnGame[], opts: BuildOptions): Repertoire
export function bookMovesAt(rep: Repertoire, fen: string): MoveNode[]   // = rep.movesByPosition.get(positionKey(fen)) ?? []
export function isDubious(node: MoveNode): boolean           // nags include 2 (?), 4 (??) or 6 (?!)
export function isBlunder(node: MoveNode): boolean           // nags include 2 or 4
export function userColorOf(def: OpeningDef): 'w' | 'b'
```
Line extraction rules (in this order):
1. Walk every root→leaf path of every included chapter (core chapters in `OpeningDef.chapters`
   order, then enabled extras). Children order = main line first.
2. **Never teach a bad user move**: a path stops *before* the first user-side move that
   `isDubious`. (Opponent dubious moves stay — they are traps to punish.)
3. Truncate to `maxPly` plies (if > 0).
4. Trim trailing opponent moves so every line ends with a **user** move. Drop lines with 0 user moves.
5. Dedupe identical paths (same uci sequence + chapter), and drop any line whose move list
   is a strict prefix of another line in the same chapter.
6. `name`: "Main line" if the path is the chapter's main line; otherwise the move where it first
   leaves the chapter main line plus the next move, in SAN with move numbers, e.g. `4.c4 Qd6`
   or `2...e5 3.Nf3`.
7. `id`: short stable hash (e.g. FNV-1a base36) of `openingId|chapterId|uci uci uci...`.
8. `index`: running order across the opening; `indexInChapter` within its chapter.
Also fill `nodesById`, `movesByPosition` (from every node's `fenBefore`, de-duplicated by
uci, keeping the main-line node first) and `linesByNode`.

### `src/chess/scheduler.ts` (spaced repetition, Leitner boxes)
```ts
export const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 8, 16]
export function isMastered(s?: LineStats): boolean                 // box >= 3
export function isDue(s: LineStats | undefined, now: number): boolean   // unseen counts as due
export function updateLineStats(prev: LineStats | undefined,
  r: { mistakes: number; hintsUsed: number; usedArrowHint: boolean; learnMode: boolean }, now: number): LineStats
export function lineWeight(s: LineStats | undefined, now: number): number
export function pickLine(lines: Line[], stats: Record<string, LineStats>, now: number,
  opts?: { avoidLineId?: string; rng?: () => number }): Line
export function openingProgress(lines: Line[], stats: Record<string, LineStats>, now: number):
  { total: number; seen: number; mastered: number; due: number; percentMastered: number }
```
Update rule: learn mode → box unchanged (min 0), dueAt = now + 1 day if box 0. Perfect (0 mistakes, 0 hints)
→ box+1 (max 5). 1 mistake and no arrow hint → box unchanged (min 1). Otherwise → box = 0.
`dueAt = now + BOX_INTERVAL_DAYS[box] days` (box 0 → due now). Weights: unseen 4, overdue
`3 + daysOverdue (cap 10)`, not due `0.3 / (box + 1)`. Avoid `avoidLineId` unless it is the only line.

## 2. Trainer (pure reducer) — `src/trainer/trainerReducer.ts`

The heart of the app. Pure, serialisable-ish state; the React hook adds timers/sounds/engine.

```ts
export type Phase = 'opponentToMove' | 'userToMove' | 'wrongMove' | 'complete'
export type FeedbackKind = 'correct' | 'book-alt' | 'other-line' | 'wrong' | 'known-bad'
  | 'opponent-blunder' | 'hint' | 'complete'
export interface Feedback { kind: FeedbackKind; node?: MoveNode; refutation?: MoveNode; id: number }
export interface PlayedMove { san: string; uci: string; from: string; to: string; fen: string; by: 'user' | 'opponent'; nodeId: string | null }
export interface TrainerConfig { mode: TrainerMode; learnMode: boolean; userColor: 'w' | 'b' }
export interface TrainerState {
  config: TrainerConfig
  line: Line                 // current target line
  candidates: string[]       // random mode: ids of lines still consistent with the moves played
  ply: number                // plies played along `line.moves`
  fen: string
  history: PlayedMove[]
  lastMove: [string, string] | null
  phase: Phase
  wrong: PlayedMove | null   // the wrong move currently shown on the board
  mistakes: number
  mistakesHere: number       // at the current user move
  hintLevel: 0 | 1 | 2       // at the current user move: 1 = highlight piece, 2 = arrow
  hintsUsed: number
  usedArrowHint: boolean
  userMoveMarks: ('pending' | 'clean' | 'fixed')[]   // one per user move in line.moves
  opponentBlundered: boolean
  feedback: Feedback | null
}
export interface TrainerContext { rep: Repertoire; pick: (lines: Line[]) => Line }
export type TrainerAction =
  | { type: 'opponentMove'; ctx: TrainerContext }
  | { type: 'userMove'; from: string; to: string; promotion?: string; ctx: TrainerContext }
  | { type: 'takeBack' }
  | { type: 'hint' }
  | { type: 'restart' }
export function initTrainer(line: Line, config: TrainerConfig, ctx: TrainerContext): TrainerState
export function trainerReducer(state: TrainerState, action: TrainerAction): TrainerState
export function expectedNode(state: TrainerState): MoveNode | null   // line.moves[ply] when it is the user's turn
export function currentNode(state: TrainerState): MoveNode | null    // last played study node (for comment/arrows)
export function userMoveIndex(state: TrainerState): number           // which user move (0-based) is next
```
Rules:
- Start: `phase = userToMove` if `line.moves[0].color === userColor` else `opponentToMove`.
- `opponentMove` (only in `opponentToMove`): play `line.moves[ply]`. In **random** mode, first
  re-pick the target among `candidates` via `ctx.pick` (so the opponent varies its replies);
  then filter candidates to lines whose `moves[ply].uci` equals the played move. If the move
  `isBlunder` → `opponentBlundered = true`, feedback `opponent-blunder`.
- `userMove` (only in `userToMove`): illegal → state unchanged. Then classify:
  1. equals `expectedNode` → **correct**: advance, mark user move `clean` (or `fixed` if
     `mistakesHere > 0` or hints used here), reset `mistakesHere/hintLevel`.
  2. matches a non-dubious book move from this position (`bookMovesAt`) but not the expected one:
     - **random** mode → accept: retarget to a candidate line through that move (consistent with
       the moves played; fall back to `rep.linesByNode` for transpositions), feedback `book-alt`.
     - **inorder/chapter** mode → feedback `other-line`, the move is NOT played, no mistake counted,
       and `hintLevel` is raised to at least 1 for free (piece highlight).
  3. matches a **dubious** book move → `known-bad`: show it like a wrong move (phase `wrongMove`),
     include `refutation` = that node's children[0] if any. Counts as a mistake.
  4. otherwise → `wrong`: phase `wrongMove`, `wrong` = the move (board shows it), mistakes++ and
     mistakesHere++.
- `takeBack` (only in `wrongMove`): remove the wrong move, back to `userToMove`. Escalation after
  take-back: mistakesHere ≥ 2 → hintLevel ≥ 1; mistakesHere ≥ 3 → hintLevel 2.
- `hint` (userToMove): hintLevel += 1 (max 2), hintsUsed++, level 2 sets `usedArrowHint`.
- In learn mode the UI always shows the arrow; the reducer does not count that as a hint.
- After a user move, if `ply === line.moves.length` → `phase = complete`, feedback `complete`.
  Otherwise next phase = opponentToMove.
- `restart`: re-init on the same line (keeps config).
Test script `scripts/test-trainer.ts` must replay every line of every opening perfectly
(user plays expected, opponent auto) and assert completion; plus wrong-move/take-back,
known-bad, other-line and random-mode book-alt cases.

## 3. Store — `src/store/`

- `storage.ts`: load/save `AppData` under localStorage key `opening-quest.v1` (debounced 300 ms,
  try/catch — never crash), `navigator.storage?.persist?.()`, migrations, `exportBackup(): string`,
  `importBackup(json): { ok: boolean; error?: string }`.
- `defaults.ts`: `createDefaultAppData()` → profiles **David** (🦉… pick a fun default avatar,
  accent blue) and **Minka** (accent pink), each owning all free items; parent settings
  `{ pin: null, rewards: [{ id: 'pokemon-pack', name: 'Pokémon booster pack', emoji: '🎴',
  cost: 1500, enabled: true, maxPerWeek: 2 }], maxPly: { sicilian: 30, london: 30, 'vs-d4': 30 },
  enabledExtras: [], dailyGoalLines: 5 }`.
- `catalog.ts`: `CATALOG: CatalogItem[]` (see §5), `itemById()`.
- `levels.ts`: `levelForXp(xp): LevelInfo` — Pawn 0 ♟️, Knight 250 ♞, Bishop 600 ♝, Rook 1200 ♜,
  Queen 2500 ♛, King 5000 ♚, Grandmaster 10000 🏆, then "Grandmaster ★N" every +5000.
- `rewards.ts` (pure): `computeLineReward(input: LineResultInput, profile: Profile, dailyGoalLines: number): { coins; breakdown; stars }`
  - Line complete: `5 + min(userMoveCount, 15)` 🪙 (learn mode: half, rounded up, and nothing else below except daily goal)
  - Perfect (0 mistakes, 0 hints): **+10** ⭐; stars: 3 perfect · 2 if ≤1 mistake and no arrow hint · else 1
  - First completion of this line ever: **+10** ✨ "New line"
  - Line was due (seen before, dueAt ≤ now) and perfect: **+5** 🧠 "Remembered it!"
  - Combo ≥ 3 (consecutive perfect lines this session): **+5** 🔥 "Combo xN" (≥ 6: +10)
  - Opponent blunder punished (perfect line with an opponent ?/?? move): **+5** ⚔️
  - Daily goal reached by this line (distinct lines today == dailyGoalLines): **+30** 🎯, plus streak bonus
    `5 * min(streakDays, 7)` 📅
  - **Anti-farming**: if this same line was completed less than 60 minutes ago (lineStats.lastPracticed)
    and it was not due, award a flat **2** 🪙 "Practice makes perfect" and no other bonuses; it still
    updates line stats. The daily goal counts **distinct** lines per day (add optional
    `distinctLineIds?: string[]` to `DailyState` if you need it — optional field only).
- `achievements.ts`: `ACHIEVEMENTS: AchievementDef[]` + `checkAchievements(profile, ctx): AchievementDef[]`
  (newly unlocked only). At least: first line, first perfect, 10/50/100 perfect, 10/50/200/500 lines,
  combo 5 / combo 10, 3/7/30-day streak, punish a blunder, master a whole chapter, master a whole
  opening (one per opening: "Dragon Tamer" Sicilian, "Big Ben" London, "Gatekeeper" vs-d4),
  practise all 3 openings in one day ("Triple Threat"), early bird (<8am) / night owl (≥8pm),
  "Never give up" (complete a line after 3+ mistakes on one move), first purchase, own 10 items,
  first reward redeemed, beat the computer. Each grants 20–200 coins.
- `profileOps.ts` (pure, immutable updates): `applyLineResult(data, profileId, input, rep): { data, reward: Reward }`,
  `applyEngineGame(data, profileId, result, rating, now)`, `buyItem`, `equipItem`, `requestRedemption`,
  `resolveRedemption`, `adjustCoins`, daily rollover (`ensureDaily(profile, now)` resets `daily` on a new
  local date; streak continues if lastGoalDate was yesterday), history capping.
  Engine games: win 10 + (rating ≥ 1200 ? 10 : 0) + (rating ≥ 1600 ? 10 : 0), draw 5, max 3 rewarded games/day.
- `appStore.ts` (React): module-level store with `useSyncExternalStore`:
  `useAppData()`, `useActiveProfile()`, and an `actions` object wrapping profileOps +
  `selectProfile`, `signOut`, parent ops (`verifyPin`, `setPin`, `setReward`, `addReward`,
  `removeReward`, `setMaxPly`, `toggleExtra`, `setDailyGoal`, `renameProfile`, `setAvatar`,
  `resetProfile`, `importStudyPgn(text, name)`, `clearStudyOverride()`), `setSetting(key, value)`,
  `setInOrderIndex(key, idx)`.

## 4. Visual system & board — `src/theme/`, `src/components/`, `src/fx/`, `src/styles/`

Look & feel: bright, playful, rounded ("game app", not "spreadsheet"). Fredoka for headings/
numbers, Nunito for body. Sky→violet gradient background; white cards (radius 20–24px, soft
shadow); primary violet `#6c4bf4`, coin gold `#ffb800`, success `#22c55e`, error `#ef4444`,
info `#3b82f6`. Chunky buttons with a bottom "3D" shadow that squishes on press. Animations:
pop-in, shake, coin fly, pulse/glow, count-up numbers. Respect `prefers-reduced-motion`.

- `src/theme/boards.ts`: `BOARD_THEMES: Record<BoardThemeId, BoardTheme>` with
  `{ id, name, light: CSSProperties, dark: CSSProperties, boardStyle?: CSSProperties,
  notation?: { light: string; dark: string }, squareStyle?: (square, isDark) => CSSProperties }`
  ('rainbow' uses squareStyle; 'marble'/'royal-wood' may use Lichess board textures downloaded
  to `public/boards/` as a full-board background with transparent squares). All must keep pieces
  clearly visible and highlights readable.
- `src/theme/pieces.tsx`: `buildCustomPieces(setId: PieceSetId)` → react-chessboard `customPieces`
  map rendering `<img src={BASE_URL + 'pieces/<set>/<wK>.svg'}>` (Lichess sets downloaded from
  `https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/<set>/<wK|wQ|wR|wB|wN|wP|bK|...>.svg`
  into `public/pieces/<set>/`), and an `'emoji'` set rendered as big emoji on coloured discs.
  `PIECE_SET_NAMES`, and a `PiecePreview` component (shows K, Q, N of a set) for the shop.
  Write `public/pieces/LICENSES.md` with each set's author/licence (see lila COPYING.md).
- `src/components/ChessBoard.tsx` — the one board used everywhere:
  ```ts
  interface ChessBoardProps {
    fen: string; orientation: Color; interactive: boolean
    onMove: (from: string, to: string, promotion?: string) => boolean
    lastMove?: [string, string] | null
    wrongMove?: { from: string; to: string } | null     // red squares + ✗ badge on `to`
    hintSquare?: string | null                          // glowing pulse on the piece to move
    arrows?: Arrow[]                                    // coach arrows + hint arrow
    highlights?: Highlight[]                            // coach circles
    shake?: number                                      // increment to trigger a shake
    boardTheme: BoardThemeId; pieceSet: PieceSetId
    maxSize?: number                                    // px cap; otherwise fills its container
  }
  ```
  Tap-to-move (tap piece → legal-move dots → tap target) AND drag; selection clears on fen
  change; only the side to move can be selected. Sizes itself to its container with
  ResizeObserver (square, integer multiple of 8 px). Promotion: react-chessboard dialog.
  Badges/glow rendered with `customSquare` or absolutely positioned overlays.
- `src/components/ui/`: `Button` (variants primary/secondary/ghost/danger/gold, sizes, icon),
  `Card`, `Modal` (focus-safe, tap-outside optional), `CoinBadge` (animated count-up),
  `ProgressBar`, `ProgressRing`, `Avatar`, `Toast` (`useToast()`), `TopBar` (avatar + name + level
  + coins + streak + mute + back), `Stars` (1–3 animated), `Tabs`, `Toggle`, `PinPad` (4-digit keypad).
- `src/fx/sound.ts`: WebAudio-synthesised SFX (no audio files): `sfx.move()`, `capture()`,
  `correct()`, `wrong()` (soft, not scary), `complete()`, `coin()`, `levelUp()`, `purchase()`,
  `click()`; `setMuted()`; resume AudioContext on first touch (iOS).
- `src/fx/celebrate.ts`: `celebrate(effect: EffectId, opts?)` using canvas-confetti (stars,
  fireworks, emoji-rain via `confetti.shapeFromText`, coin-shower, rainbow); respects reduced motion.

## 5. Shop catalogue (ids must match `src/types.ts` lists)

Boards: green 0, brown 0, ocean 150, candy 250, forest 300, ice 400, sunset 500, marble 600,
lava 700, royal-wood 800, galaxy 1000, gold 1500 (minLevel 4), rainbow 2000 (minLevel 5).
Pieces: cburnett 0, merida 0, alpha 300, california 400, cardinal 500, staunty 600, fantasy 700,
spatial 800, pixel 1000, horsey 1200, anarcandy 1500 (minLevel 4), emoji 1800 (minLevel 5).
Avatars (refId = the emoji): free 🦉 ♞ 🐱 🐶; 🦊 100, 🐼 100, 🦁 150, 🐯 150, 🐸 150, 🐙 200,
🦄 250, 🐲 300, 🦖 300, 🧙 400, 🥷 400, 🤖 350, 👑 600, 🐉 800.
Trophies (decorative shelf): 🥉 Bronze cup 200, 🥈 Silver cup 500, 🥇 Gold cup 1000,
🏆 Champion trophy 1500, 👑 Golden crown 2500, 🐉 Dragon statue 3000, 💎 Diamond 5000.
Effects: confetti 0, stars 200, fireworks 400, emoji-rain 500, coin-shower 600, rainbow 800.
Titles (refId = key, name shown under the player name): rookie 0 "Rookie", explorer 150
"Opening Explorer", dragon 300 "Sicilian Dragon", bigben 300 "London Bridge", gatekeeper 300
"Queen's Pawn Crusher", wizard 400 "Tactics Wizard", gm 800 "Grandmaster in Training".
Real rewards (Pokémon pack etc.) are `ParentSettings.rewards` — shown on a "Rewards" shop tab with
"Ask a parent" flow; coins are deducted on request and refunded if declined.

## 6. Screens (wave 2)

Navigation is a tiny state machine (`Screen` in types.ts) via `src/app/nav.tsx`
(`NavProvider`, `useNav(): { screen, go(s), back() }`); no router library.

1. **ProfileSelect** — "Who's playing?" Two huge cards (avatar, name, title, level, coins).
   Small "Parent zone 🔒" link.
2. **Home** — TopBar; greeting from Hoot the owl 🦉 ("Ready to practise, Minka?"); daily goal ring
   (3/5 lines) + streak 🔥; three big opening cards (emoji, name, "You play Black/White", mastery
   ring %, "N lines to review" chip, "NEW lines" chip). Bottom bar: Shop 🛒 · Trophies 🏆 · Play 🤖 · Switch player.
3. **Opening** — header with opening colours; primary **"▶ Coach's Choice"** (random/spaced
   repetition — default); **"📚 All lines in order"** (shows "Line 7 of 42 · Continue / Start over");
   **"🎯 Pick a chapter"** list (each with mastery bar, lines count; tap → that chapter in order);
   toggle **"👀 Show me the moves"** (learn mode, fewer coins); "🤖 Play this opening vs computer".
4. **Trainer** — big board + side panel (landscape) / panel under board (portrait):
   chapter + line name (+ ✨NEW / 🧠 review badge), progress dots for the user's moves
   (pending/clean ✓/fixed), Hoot's speech bubble with the coach comment of the current node
   (and the chapter intro at start), feedback messages, buttons: 💡 Hint, ↻ Restart, ✕ Exit.
   - Opponent moves play automatically after ~600 ms (animated). Opponent blunder: "😮 Your
     opponent blundered! Punish it!".
   - **Mistake UX**: the wrong move stays on the board; destination square turns red with a ✗
     badge, the board does a small shake, soft "bonk". Hoot says something kind ("Oops! That's
     not the move from your study."). A big pulsing **"↩ Take it back"** button. Optional
     engine insight (if Stockfish loads): compare eval of the wrong move vs the study move —
     "⚠️ That move loses material!" / "Hmm, that gives your opponent the better game." /
     "Not bad — but your coach's plan is different." After take-back the hint escalation
     kicks in (glow piece → arrow).
   - Other-line (in-order mode): "👍 That's in your study too — but this line goes a different way. Try another move!"
   - Coach arrows/circles from the study are drawn for the current node EXCEPT any arrow that
     would give away the expected user move (unless learn mode / hint level 2).
   - **Complete**: modal with 1–3 stars, coin count-up with breakdown chips, achievements unlocked,
     level-up banner, equipped celebration effect. Buttons: **Next line ▶** (primary), Try again,
     Play on vs 🤖 (opens Play screen at this position), Home.
   - Session combo meter 🔥 for consecutive perfect lines.
5. **Shop** — tabs Boards / Pieces / Avatars / Trophies / Effects / Titles / 🎁 Rewards; item cards
   with live previews (mini board for boards & pieces), price, Buy / Equip / Equipped,
   locked by level badge. Purchase confirm modal; celebration on buy.
6. **Trophies** — achievements grid (unlocked colourful with date; locked grey with hint),
   trophy shelf (bought trophies), stats (lines, perfect lines, best combo, streak, per-opening
   mastery), recent coin history.
7. **Parent zone** — PIN pad (set a PIN on first visit; 4 digits). Sections: Pending reward
   requests (Approve / Decline), Rewards editor (Pokémon pack cost, max per week, add custom
   rewards like "30 min screen time"), Coins (gift / remove with note), Training settings (line
   length per opening: 10/15/20/25 moves or full; extra chapters on/off; daily goal), Profiles
   (rename, avatar, reset), Study data (import an updated PGN from Lichess; revert to bundled),
   Backup (export file / share, import), change PIN.
8. **Play vs computer** — board vs Stockfish (reuse `src/engine/stockfish.ts`, lazy single
   instance via `src/engine/engineService.ts`), strength slider 400–2000 with friendly labels,
   choose colour, start from: standard position / an opening's main line / a given FEN (from
   "Play on"). Undo, 💡 best-move hint, new game, resign; game-over detection; rewards via
   `applyEngineGame` (daily cap).

## 7. iPad / PWA

`index.html`: viewport `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no,
viewport-fit=cover`; `apple-mobile-web-app-capable`, status bar `black-translucent`, title
"Opening Quest", `apple-touch-icon` (180 px PNG), `manifest.webmanifest` (standalone, icons
192/512, theme colour). CSS: `overscroll-behavior: none`, no text selection / callouts on game
UI, `touch-action: manipulation`, safe-area insets. Layout: landscape = board left (as large as
fits: min(viewport height − top bar, 62vw)), panel right; portrait = board on top full-width,
panel below. Test at 1180×820, 820×1180, 1366×1024 and 375×812.

## 8. File ownership (waves)

Wave 1 (parallel): **core** → `src/chess/*`, `src/trainer/trainerReducer.ts`, `scripts/test-*.ts`
for those; **store** → `src/store/*`, `scripts/test-store.ts`; **ui-kit** → `src/theme/*`,
`src/components/*`, `src/fx/*`, `src/styles/*`, `public/pieces/*`, `public/boards/*`.
Wave 2 (parallel): **train** → `src/trainer/useTrainer.ts`, `src/screens/Trainer.tsx`,
`src/screens/OpeningScreen.tsx`, `src/chess/useRepertoires.ts`, `src/engine/engineService.ts`;
**meta** → `src/screens/ProfileSelect.tsx`, `Home.tsx`, `Shop.tsx`, `Trophies.tsx`, `Parent.tsx`;
**play** → `src/screens/PlayComputer.tsx`.
Wave 3: **integrate** → `src/App.tsx`, `src/main.tsx`, `src/app/nav.tsx`, `index.html`,
`public/manifest.webmanifest`, `public/icons/*`.
