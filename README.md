# Opening Quest ♞⭐

A gamified chess **opening trainer** for David and Minka, built for iPad (works in any browser).
Pick who's playing, pick an opening, and play through your coach's lines. Every line earns
coins; perfect lines earn bonus coins. Spend coins on new boards, piece sets, avatars and
trophies, or save up and ask a parent to redeem them for a Pokémon pack.

## Openings

All lines come from the coach's Lichess study **"Opening lines for Tournaments"** (every chapter,
side lines included; it replaced "Opening lines (For Minka and David)" in October 2026):

| Opening | You play | Chapters |
| --- | --- | --- |
| 🐉 Sicilian Defence | Black | Open Sicilian, Alapin, Delayed Alapin, Smith-Morra, Closed Sicilian, Side lines |
| 🏰 London System | White | All the variations, vs ...c5, Old Benoni, Jobava London vs King's Indian |
| 🛡️ Black vs 1.d4 | Black | Queen's Gambit Declined: 5.Bg5, 5.Bf4 and the Exchange variation |

## Updating the lines when the coach changes the study

The study is private, so the app ships its own copy. Two ways to update it:

1. **On the iPad (no computer needed):** on Lichess open the study → *Share* → *Download PGN*
   (all chapters). In Opening Quest go to *Parent zone → Data → Import PGN* and pick the file.
2. **In the project:** save the full export as `data/studies/opening-lines-tournaments-phFA64zi.raw.pgn`,
   run `node scripts/extract-study.ts` (keeps only the chapters listed in `src/data/openings.ts` and strips
   names/dates), then commit and push. New chapters need an entry in `src/data/openings.ts`.

When the study changes, line ids change too. `node scripts/build-line-migrations.ts` maps every old line
to the line with exactly the same moves now (`src/data/lineMigrations.ts`), so the kids keep their
progress on lines that didn't change. Engine-checked corrections to the study live in
`src/data/studyOverrides.ts`.

## Development

Node lives at `C:\Claude\tools\node` (`export PATH="$PATH:/c/Claude/tools/node"`).

```bash
npm install
npm run dev          # http://localhost:5174 (via .claude/launch.json) or vite's default port
npm run build        # typecheck + production build into dist/
node scripts/test-repertoire.ts   # parse the study and print line statistics
npm test             # all six test scripts (needs Node 22.18+ for .ts)
```

Corrections on top of the coach's study (moves the engine shows are mistakes, contrast notes that
should not be drilled) live in `src/data/studyOverrides.ts`.

See `DESIGN.md` for the full spec (trainer rules, rewards, shop catalogue, architecture).

## Deploying (GitHub Pages)

1. Create the GitHub repo `Legend2424/chess-opening-trainer` and push `main`.
2. In the repo: *Settings → Pages → Source: GitHub Actions*. Every push to `main` then runs the
   tests, builds with the right sub-path and publishes (`.github/workflows/deploy.yml`).
3. Try the Pages build locally first: `npm run build:pages && npx vite preview --base=/chess-opening-trainer/`.
   In Git Bash, don't pass a path like `DEPLOY_BASE=/chess-opening-trainer/` yourself: MSYS rewrites it to
   `C:/Program Files/Git/...` (use `npm run build:pages`, or prefix the command with `MSYS_NO_PATHCONV=1`).

## Saving progress

Progress, coins and purchases are stored on each device (browser storage). On iPad, use
**Share → Add to Home Screen** so Safari never clears it, and use *Parent zone → Backup* now and
then to export a backup file. Note: the Home Screen app has its **own, separate storage** — progress
made in a Safari tab does not show up there. Export a backup in Safari first and import it in the
Home Screen app (the Parent zone's Data tab walks you through it).

When the first parent PIN is created, the app shows a **recovery code** once: write it down. With it a
forgotten PIN can be replaced right away; without it "Forgot the PIN?" makes you wait 24 hours (so the
kids can't simply change it).

## Time on the app

Each player's **active** time is counted (Home goal card, Trophies, Parent zone → Players).
Every tap, move or key press adds the time since the previous one, but at most **1 minute**
(**2 minutes** when playing the robot, where real thinking takes longer). So an iPad left open on
the table stops adding time. Nothing is counted while the app is in the background or the iPad is
locked, on the "Who's playing?" screen, or in the Parent zone. Logic: `src/store/activityClock.ts`
and `src/app/activityTracker.ts`; storage: `src/store/timeSpent.ts`. "Reset progress" keeps it.
