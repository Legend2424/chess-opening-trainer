# Opening Quest ♞⭐

A gamified chess **opening trainer** for David and Minka, built for iPad (works in any browser).
Pick who's playing, pick an opening, and play through your coach's lines. Every line earns
coins; perfect lines earn bonus coins. Spend coins on new boards, piece sets, avatars and
trophies, or save up and ask a parent to redeem them for a Pokémon pack.

## Openings

All lines come from the Lichess study **"Opening lines (For Minka and David)"**:

| Opening | You play | Chapters |
| --- | --- | --- |
| 🐉 Sicilian Defence | Black | Open Sicilian, Alapin, Smith-Morra, Closed, Side lines, Minka's Sicilian |
| 🏰 London System | White | All the variations, King-side castle, vs ...c5, Old Benoni, Queen-side castle, London lines |
| 🛡️ Black vs 1.d4 | Black | Queen's Gambit Declined, Queen's Gambit Accepted |

More chapters (Delayed Alapin, Jobava London vs King's Indian, English, etc.) can be switched on
in the Parent zone.

## Updating the lines when the coach changes the study

The study is private, so the app ships its own copy. Two ways to update it:

1. **On the iPad (no computer needed):** on Lichess open the study → *Share* → *Download PGN*
   (all chapters). In Opening Quest go to *Parent zone → Study data → Import PGN* and pick the file.
2. **In the project:** save the full export as `data/studies/opening-lines-CZiXOjIp.raw.pgn`, run
   `node scripts/extract-study.ts` (keeps only the chapters listed in `src/data/openings.ts` and strips
   names/dates), then commit and push. New chapters need an entry in `src/data/openings.ts`.

## Development

Node lives at `C:\Claude\tools\node` (`export PATH="$PATH:/c/Claude/tools/node"`).

```bash
npm install
npm run dev          # http://localhost:5174 (via .claude/launch.json) or vite's default port
npm run build        # typecheck + production build into dist/
node scripts/test-repertoire.ts   # parse the study and print line statistics
```

See `DESIGN.md` for the full spec (trainer rules, rewards, shop catalogue, architecture).

## Saving progress

Progress, coins and purchases are stored on each device (browser storage). On iPad, use
**Share → Add to Home Screen** so Safari never clears it, and use *Parent zone → Backup* now and
then to export a backup file.
