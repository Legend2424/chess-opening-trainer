# Practice structure: main lines first, every line many times

Implementation spec, final. It answers the parent's request: the kids should know the **main lines**
cold and play them many times, a line that branches several times deep down should count for less than
the main lines, and they should still **go through every line again and again**.

Everything here was measured on the real study ("Opening lines for Tournaments", 13 chapters) with the
project's own `buildRepertoire` at the default cap of 30 plies (128 lines). The probe scripts are in
`C:\Users\cscon\AppData\Local\Temp\claude\oq-design-final\` (`classify.ts [maxPly] [-v] [--sim]`,
`conflicts.ts`). Run them with `export PATH="$PATH:/c/Claude/tools/node"`.

## 0. The design in one screen

| What the kid sees | What it does | Answers |
|---|---|---|
| **▶ Coach's Choice** (stays the big button) | Spaced repetition, now split by **tier**: about 35% main lines, 40% key replies, 25% deeper lines. It also follows the line it picked. | "know the main lines well" |
| **⭐ Main Lines** card → *Round* | Every main line of the opening once, shuffled, from move 1. A line with a mistake comes back once at the end. Timer, personal best, and 🥉🥈🥇 medals per main line. | "a section with fewer main lines they can practise many times over" |
| **🌳 All Lines · Lap N** card | Goes through **every** line of the opening once, in the order main → key replies → deeper → Plan B. Deep and Plan B lines start where they branch off. When every line is done, Lap N+1 starts. | "continue to practise all the lines multiple times" and "then sub-lines" |
| **🎯 Pick a chapter** (unchanged) | One chapter, in order, from move 1. | |
| Ring **🏆 Tournament ready %** | Half from the main-line medals, half from mastered key replies. | "know the main lines well" |

The tiers are computed from the move tree. The coach's first move at every branch (`children[0]`) is
"the main move".

---

## 1. Line classification

### 1.1 Rules (exact)

For each line, walk its moves. At index `k` the siblings are `k === 0 ? chapter.roots : moves[k-1].children`.
A **deviation** is a move with `siblings[0] !== moves[k]` (compared as objects). It is a **kid deviation**
when `moves[k].color === userColor`, otherwise an **opponent deviation**.

| Tier | Rule | Meaning for the kid |
|---|---|---|
| `main` ⭐ | 0 deviations | The coach's main line of the chapter |
| `key` 🔑 | exactly 1 deviation, by the opponent | "If they play X, you play Y" |
| `deep` 🌿 | 2 or more deviations, all by the opponent | They try something else again later |
| `planb` 🅱️ | at least 1 kid deviation (whoever deviated first) | The coach's second-choice move for the kid. Optional: the kid can always play the first choice. |

There is no ply limit on key replies, and the tier never depends on the move cap: main is always 13 and
key always 31 (see 1.4).

**Guard:** if a chapter that has lines ends up with no `main` line (for example, its main path was
dropped as a duplicate of another chapter's line), its `indexInChapter === 0` line becomes `main`. That
doesn't happen in the current study, but a study re-import could cause it.

### 1.2 Derived fields per line

- **`parentLineId` / `branchPly`**: the parent is the *earlier* line of the same chapter (lower
  `indexInChapter`) that shares the longest start with this line. The first one wins a tie.
  - `branchPly` = the number of plies shared with the parent.
  - The main line (index 0) has `branchPly = 0` and no parent.
  - Because lines are ordered main-first by DFS, an earlier line can never be one of this line's own
    sub-branches, so the parent is always "the line it branches off".
  - Measured: `branchPly` equals the index of the last deviation for 113 of 115 non-main lines. The 2
    exceptions (Alapin 6...Nc6 7.O-O and Alapin 6...cxd4 … 9.Bd2) branch off an earlier point because
    the exact parent line was cut. Their start is simply earlier, which is harmless.
- **`ownUserMoves`**: the kid moves at index `>= branchPly`, the part only this line teaches.
- **`startPly`**: where a branch-start run begins. It is the index of the kid's last move before
  `branchPly`, so the kid plays one known move to get his bearings, then meets the new part.
  - It is `0` for main lines and when there is no kid move before `branchPly`.
  - Verified: it always points at a kid move or is 0.
  - At a kid deviation (Plan B), the kid plays his previous move, the opponent replies, and then the
    existing fork notice glows the Plan B move.
- **`deviations`**: kept for tests and debugging.

Parent tiers, as measured: key ← main always; deep ← key or deep; Plan B ← any tier.

### 1.3 Result on the real data (maxPly 30)

"Lap kid moves" = main and key lines from move 1, deep and Plan B lines from `startPly` (with every
parent line mastered).

| Opening | Chapter | Lines | ⭐ | 🔑 | 🌿 | 🅱️ | Kid moves from move 1 | Lap kid moves |
|---|---|---|---|---|---|---|---|---|
| Sicilian | Open Sicilian | 6 | 1 | 2 | 2 | 1 | 72 | 52 |
| | Alapin (2.c3) | 17 | 1 | 4 | 2 | 10 | 184 | 111 |
| | Delayed Alapin | 4 | 1 | 0 | 0 | 3 | 47 | 32 |
| | Smith-Morra | 4 | 1 | 1 | 0 | 2 | 40 | 34 |
| | Closed (2.Nc3) | 13 | 1 | 4 | 3 | 5 | 108 | 80 |
| | Side lines | 10 | 1 | 3 | 2 | 4 | 91 | 79 |
| | **total** | **54** | **6** | **14** | **9** | **25** | **542** | **388** |
| London | All the variations | 20 | 1 | 4 | 11 | 4 | 182 | 122 |
| | Against ...c5 | 12 | 1 | 7 | 1 | 3 | 125 | 110 |
| | Old Benoni | 16 | 1 | 3 | 3 | 9 | 123 | 90 |
| | Jobava | 7 | 1 | 1 | 1 | 4 | 74 | 44 |
| | **total** | **55** | **4** | **15** | **16** | **20** | **504** | **366** |
| Black vs 1.d4 | QGD 5.Bg5 | 4 | 1 | 1 | 1 | 1 | 48 | 33 |
| | QGD 5.Bf4 | 14 | 1 | 1 | 0 | 12 | 153 | 82 |
| | QGD Exchange | 1 | 1 | 0 | 0 | 0 | 11 | 11 |
| | **total** | **19** | **3** | **2** | **1** | **13** | **212** | **126** |
| **All** | | **128** | **13** | **31** | **26** | **58** | **1,258** | **880** |

- **Must-know** (main + key + deep) is 70 lines: Sicilian 29, London 35, QGD 6.
- **Plan B** is 58 lines: the kid can always avoid these by playing the coach's first choice.
- Short lines: 40 non-main lines have 2 or fewer own kid moves. 5 lines have 3 or fewer kid moves in
  total; all of them are Plan B (Side lines 3...a6, and the Old Benoni stubs 2.c3 / 2.e3 / 2.dxc5 / 2.Bf4).
  They get no separate mode. Branch starts and pay per kid move played (section 4) take care of them.

### 1.4 Stability across move caps

| maxPly | main | key | deep | Plan B |
|---|---|---|---|---|
| 0 (no cap) | 13 | 31 | 28 | 59 |
| 20 | 13 | 31 | 24 | 56 |
| 30 (default) | 13 | 31 | 26 | 58 |
| 40 | 13 | 31 | 26 | 58 |

### 1.5 Cross-chapter conflicts (reported to the parent, not resolved)

These are positions where two chapters' **first-choice** kid moves differ, usually reached by
transposition:

- Sicilian, Closed (2.Nc3) **5...Nh6** vs Side lines **5...Bd7**.
- Sicilian, Closed (2.Nc3) **6...c4** vs Side lines **6...Nf6**.
- London, All the variations **5.c3** vs Against ...c5 **5.Be2**.
- London, All the variations **5.c4** vs Against ...c5 **5.Nc3**.

How the app behaves:
- In fixed-target modes (Main round, Lap, Chapter), the other chapter's move gets the existing
  "other-line" reply: it is not played, it is not a mistake, and the right piece glows.
- In Coach's Choice, the line switches to the other chapter (`book-alt`), exactly as today.
- The Parent zone lists the four conflicts so the parent can ask the coach (section 5.5).

### 1.6 Known judgement calls (shown in the Parent zone, not overridden in code)

- **QGD 5.Bf4**: the main line is 5...O-O. 12 of its 14 lines start with the kid's alternative
  5...c5, so they are Plan B.
- **Side lines**: the main line is 2.Bc4, because it is listed first. 2.c4, 2.f4 and 2.b3 are key replies.
- **Alapin**: 6...cxd4 (Plan B) carries 6 lines; the main move 6...e6 carries 2.

If the coach wants another move to be the main one, she moves that variation first on Lichess and the
parent re-imports the study. Tiers are recomputed on every build. Line ids hash the moves, not the
order, so **no progress is lost**.

---

## 2. Practice modes

`TrainerMode` becomes `'random' | 'inorder' | 'chapter' | 'main' | 'lap'`. `main` and `lap` are
**fixed-target** modes: the reducer already treats every mode other than `'random'` that way. The
opponent follows the target line, and a kid's other good study move gets "other-line" (not played, not
a mistake, free glow). Plan B lines therefore really get played in these modes, and the existing fork
notice ("Your study has 2 good moves here…") appears before the Plan B move. **The reducer's
random-mode logic is not touched.**

### 2.1 ▶ Coach's Choice (`random`)

These steps run in `useTrainer.chooseLine` and the `ctx.pick` callback only.

1. **Pool**: the lines of the opening minus `planb`. Plan B is never picked here, because random mode
   accepts the kid's first-choice move as `book-alt` and would switch away from it anyway. A kid who
   plays a Plan B move on purpose still switches into that line, as today.
2. **Trunk first, silently.** A line is eligible if any of these holds:
   - it is `main`;
   - its own `box >= 1`;
   - its parent line's `box >= 1`.

   A fresh profile therefore gets only main lines at first. Key replies open up once their main line has
   had one good run, and deeper lines once their key reply has. Nothing is shown as locked. On existing
   profiles, every line already learned (`box >= 1`) and its sub-lines stay eligible.
3. **Tier shares.** Base weights are main 35, key 40, deep 25.
   - Once **every** main line of the opening has a gold medal, the main weight becomes 20.
   - **Per-line cap**: let `n_t` be the number of eligible lines in tier t and `w_t = quota_t / n_t`.
     For key and deep, `w_t = min(w_t, w_main)`, so no key or deep line is picked more often than a
     main line.
   - Each tier's share is proportional to `n_t * w_t`. Tiers with no eligible lines drop out.
   - Result with everything eligible: Sicilian 35/40/25, London 35/40/25, QGD 50/33/17 (each of the 6
     QGD lines gets about 16.7%).
4. **Choose a tier** by share (rng), then the line with the existing
   `pickLineBalanced(tierLines, stats, now, { avoidLineId, rng })`. That keeps chapter balancing and the
   spaced-repetition weights inside the tier.
5. **Pin the picked line.** In `startLine`, set `pinnedLineRef.current = line.id` when mode is `random`.
   Today it is set to `null`; the "Try again" pin mechanism already exists. The opponent's re-picks then
   keep the picked line, and a kid's `book-alt` still switches line as today.
   - Today the opponent re-picks at every move in proportion to the lines below, so busy subtrees win.
     Only 80 of 3,000 simulated Sicilian runs ended on the line that was picked first.

Simulation with the real reducer, 3,000 runs per opening, every line equally urgent, the kid always
playing the expected move ("per main line" = runs per 100):

| Opening | Today: main share (per main line) | Today: Plan B share | New: main / key / deep (per main line) | Picked line reached |
|---|---|---|---|---|
| Sicilian | 15.2% (1.0–4.3) | 45.1% | 35.6 / 39.8 / 24.7% (5.0–6.3) | 3000/3000 |
| London | 7.3% (1.3–2.2) | 35.4% | 35.3 / 40.3 / 24.4% (8.5–9.2) | 3000/3000 |
| QGD | 44.4% (2.6–33.8) | 36.8% | 49.4 / 33.0 / 17.6% (16.0–16.9) | 3000/3000 |

**Review counts:** the "N to review" text on the Coach's Choice button, the opening header chip and the
Home card count only non-Plan-B lines, because Coach's Choice never serves Plan B lines.

**Maximum review gap per tier** (`updateLineStats`): main 7 days, key 12, deep and Plan B 16 (as
today). The cap is applied when a review is written, so saved due dates stay as they are until each
line's next review. A main line at box 4 or 5 therefore comes back as a review every week.

### 2.2 ⭐ Main Lines round (`main`)

- **Queue**: the opening's `main` lines, shuffled with Fisher-Yates (`mainRoundQueue`), frozen in a ref
  when the round starts.
  - Sicilian: 6 lines, 66 kid moves, about 5 min.
  - London: 4 lines, 43 kid moves, about 3.5 min.
  - Black vs 1.d4: 3 lines, 36 kid moves, about 3 min.
- Always **from move 1**. The opponent plays the main moves. A Plan B or other-chapter move gets
  "other-line".
- **Re-queue**: a line finished non-perfect on its first try in this round goes to the end of the queue
  once ("Let's fix that one at the end 💪"). A second failure doesn't re-queue it again.
- **Clean round**: every line was perfect on its first try. Learn mode makes a line non-perfect.
- **Timer**: it starts when the first line is set up and stops at the last completion; time spent in the
  tail and the modals is included. The **personal best** is kept per opening, for clean rounds only.
- After each line, a **compact result card** shows stars, coins and "Rep #N". It continues by itself
  after 2.5 s, or on a tap. The full modal is shown instead when something special happened:
  achievement, medal, level-up or daily goal.
  - Buttons: "Next ▶" and "End round". There is no "Try again" or "Play on" during a round.
- **Round end**: the hook calls `actions.applyMainRound(...)` once (section 4.4) and shows
  `RoundCompleteModal` with the time, the best time, clean sweep, coins and bonuses left today.
  - Buttons: "▶ Another round" (primary) and "Back to the opening".
- Leaving mid-round abandons the round: lines already finished still count, there is no round bonus,
  and the next visit starts a new round.

### 2.3 🌳 Laps (`lap`)

This replaces the "📚 All lines in order" card. The `inorder` mode stays in the code but has no button.

- **Lap lines** (`lapLines`): every line of the opening, without Plan B when the parent has switched
  Plan B off (`ParentSettings.includePlanB === false`; absent means on).
  - Order: tier (main, key, deep, Plan B), then `line.index`, which is chapter order and then tree order
    within the chapter, so sibling branches come one after another.
  - Sizes:

    | Opening | Lines | From move 1 | With branch starts | Must-know only (Plan B off) |
    |---|---|---|---|---|
    | Sicilian | 54 | ≈ 44 min | ≈ 33 min | 29 lines, ≈ 22 min |
    | London | 55 | ≈ 41 min | ≈ 31 min | 35 lines, ≈ 24 min |
    | Black vs 1.d4 | 19 | ≈ 17 min | ≈ 11 min | 6 lines, ≈ 5 min |

    Times assume 3.5 s per kid move, 0.8 s per opponent move and 6 s per line. At 10–15 minutes a day,
    one lap takes about a week.
- **What counts toward the lap**: any completion **in any mode** with `stars >= 2` that is not
  learn-like, of a line in the current lap set. Farmed quick repeats count too. Each line counts once
  per lap, so this can't be farmed.
- **Lap record**: `profile.laps[openingId] = { n, done }`. Absent means `{ n: 1, done: [] }`.
  - Lap 1 starts empty for everyone. Old progress is not pre-credited: the point is to go through
    everything again.
  - Ids in `done` that are no longer in the lap set (after a study re-import or a Plan B toggle) are
    ignored.
- **Rollover**: inside `applyLineResult`, after adding the line, the lap is complete if every lap-set id
  is in `done`. Then `n + 1`, `done = []`, `totals.laps + 1`, and the lap bonus is paid (section 4).
- **Picking the next line**: `nextLapLine(ordered, doneSet, skipSet)` returns the first line not done
  and not in `skipSet`.
  - `skipSet` holds the lines tried in this session whose completion didn't count (1 star or learn
    mode). They come back once nothing else is left, so a failed line returns at the end of the lap.
  - If everything is done, take `ordered[0]`. The store rolls the lap over on the next counted completion.
- **Start ply**: `branchStartPly(line, stats)` (section 2.5).
- The trainer header shows "🌳 Lap 2 · 38/54". The completion modal adds a line: "🌳 Lap 2: 39/54 ✓".
  On lap completion it shows a banner: "🌳 Lap 2 complete! +108 🪙".

### 2.4 🎯 Chapter mode, in-order mode

- Chapter mode is unchanged: all lines of the chapter in order, from move 1, Plan B included.
- In-order mode is unchanged but has no button any more. Its `inOrderIndex` entries are kept.

### 2.5 Starting sub-lines at the branch point: decided

A run starts at `line.startPly` only when **all** of these hold. Otherwise it starts from move 1.

1. The mode is `lap`. Coach's Choice, Main round and Chapter mode always start at move 1.
2. The tier is `deep` or `planb`. Main and key lines always start from move 1: key replies branch early,
   and their first moves are main-line practice (109 of 325 key-line kid moves).
3. `line.startPly > 0` and the parent line has `box >= 3` (mastered).
4. `(stats[line.id]?.completions ?? 0) % 3 !== 2`, so every 3rd completion plays the whole line.

The rule is `branchStartPly(line, stats)`.

- **Set-up is instant**: the reducer replays the shared moves with no animation.
- The move list shows the skipped moves in grey and the progress dots show only the moves to play.
- Hoot says: "⏩ Skipped ahead! You know how this starts — the grey moves were played for you."
- Saving per lap (Plan B on): Sicilian 542 → 388 kid moves, London 504 → 366, QGD 212 → 126.

### 2.6 Hoot's "new branch" note (all modes)

When the opponent's last move is a deviation (`mainAlternative(rep, node)` returns the chapter's first
choice) and it isn't the line's first opponent move (the existing `surprise()` already covers that),
Hoot adds a tag line: **"🌿 New branch! Instead of 3.exd5 they play 3.e5."** The node's own coach
comment still shows. This teaches the kid where lines split.

---

## 3. Mastery and progress

### 3.1 Per line (all tiers): unchanged definitions

- **New**: never completed outside learn mode.
- **Learning**: box 1–2.
- **Mastered ✅**: box ≥ 3 (`isMastered`, unchanged).

### 3.2 Main-line medals (main tier only; earned once, never lost)

"Perfect runs" means `LineStats.perfects`: lifetime perfect, non-learn completions in any mode,
quick repeats included. That field already exists and already counts them. "Days" means
`perfectDays`: distinct local days with a perfect run.

| Medal | Needs | Coins (once) |
|---|---|---|
| 🥉 Bronze | 5 perfect runs | 10 |
| 🥈 Silver | 15 perfect runs on ≥ 4 different days | 25 |
| 🥇 Gold | 30 perfect runs on ≥ 8 different days, and box ≥ 3 | 50 |

- The medal is stored as `LineStats.medal`. It is evaluated in `applyLineResult` for `main` lines. When
  a line jumps two levels, both are paid.
- The total over all 13 main lines is 1,105 coins. Gold needs at least 8 practice days; realistically
  it takes 2–4 weeks.
- A medal stays even if the box later drops, or if the line stops being main after a re-import.
- The UI shows "Rep #N" (= `perfects`) and the next medal's progress, for example
  "🥈 in 3 more perfect runs · 2 more days".

### 3.3 Per tier (per opening)

`tierProgress(lines, stats, now)` gives total / seen / mastered / due for each tier. It is shown as
"🔑 9/14 mastered" and so on.

### 3.4 🏆 Tournament ready (per opening; the ring on Home and the Opening screen)

```
mainPart = average over main lines of (medal / 3)
keyPart  = average over key lines of (min(box, 3) / 3)
percent  = floor(100 * (keys ? 0.5 * mainPart + 0.5 * keyPart : mainPart)), at least 1 when > 0
ready    = percent === 100   // every main line gold, every key reply mastered
```

- The items are 20 for the Sicilian, 19 for the London and 5 for Black vs 1.d4.
- This replaces "% of all lines mastered" as the ring. "N mastered of 54" stays as a small count.
- Deep and Plan B lines show up through laps and chapter bars, not in the ring.

### 3.5 Existing saved progress (no data loss)

- **Line ids do not change.** Tiers are computed on every build and never stored or hashed. Every
  `lineStats` entry keeps applying, and `LINE_ID_MIGRATIONS` is untouched.
- `perfectDays` is missing on old stats. It is read as `min(perfects, box)` (each box promotion happens
  on its own day) until the next perfect run writes the real value.
- **Medals** are not filled in on load. They are evaluated at each main line's next completion, so a kid
  with many reps gets "🥉 Bronze medal! +10" (or Silver) on the next run of that line. Gold still needs
  box ≥ 3 and 8 days.
- **Laps** start at Lap 1, empty.
- The 7- and 12-day review caps apply from each line's next review; saved `dueAt` values are not
  rewritten.
- `inOrderIndex`, all achievements, totals, the streak and the daily state are unchanged. New optional
  fields default to absent. Old backups import fine, and new backups keep the new fields (section 6.3,
  storage allowlists).

---

## 4. Rewards and anti-farming

### 4.1 Unchanged

- The coins for a full-line run.
- The 60-minute rule: a repeat within 60 minutes that isn't due pays a flat 2 coins and counts for no
  totals, goal or combo.
- Boxes only go up when a line is due.
- The one-quick-retry rule, the learn-mode rules, and the daily goal and streak.

### 4.2 Branch-start runs (lap mode, `userMovesPlayed < line.userMoveCount`)

Let `n = max(1, userMovesPlayed)`.

| Chip | Full run (today) | Branch-start run |
|---|---|---|
| Line complete | 5 + min(kid moves, 15) | **2 + min(n, 15)** |
| Learned a line (learn-like) | half of base | half of base (n-based) |
| Perfect / New line | 10 / 10 | **min(10, n)** each |
| Remembered / Combo / Punished a blunder | 5 / 5–10 / 5 | **capped at n** each |
| Daily goal / streak | unchanged | unchanged |

- Learn-like threshold: `arrow && hints >= max(1, n)`.
- Example: a 2-move Plan B stub pays at most 4 + 2 + 2 + 2 + 2 = 12 coins, against 37+ for a full new
  line. A branch run is about 2.5 coins per kid move, the same rate as a full line.
- The box and due date update exactly as for a full run; the shared prefix belongs to a mastered parent.

### 4.3 Medals: see 3.2

The medal coins are added to that line's reward as a chip: "🥉 Bronze medal +10".

### 4.4 Main-line round bonus (`applyMainRound`)

- The **bonus** is 2 coins per distinct main line in the round, plus 10 for a clean round:
  - Sicilian: 12, or 22 if clean.
  - London: 8, or 18 if clean.
  - Black vs 1.d4: 6, or 16 if clean.
- It is paid for the **first 3 rounds per day per player** (`daily.roundsRewarded`), across all
  openings. After that a round still counts (`totals.rounds`, best time) but pays nothing extra.
- **Per-line coins inside a round follow the normal rules.**
  - The first round of a session usually pays in full, about 30 coins a minute.
  - A repeat round within the hour pays 2 per line plus the bonus, for example
    12 + 22 = 34 for the Sicilian. It mostly earns medal progress and a best time.
  - This is deliberate: spaced practice is rewarded more than cramming.
- A new personal best gets no coins, only a 🏁 banner.
- Double-submit guard: `appStore` remembers `${profileId}|${openingId}|${roundId}` (the `roundId` is
  the round's `startedAt`), the way it does for engine games.

### 4.5 Lap bonus

On lap completion the bonus is +2 coins per line in the lap: Sicilian 108, London 110, QGD 38 (58, 70
and 12 with Plan B off). It appears as a chip on the completing line's reward, "🌳 Lap 2 complete +108".
It can't be farmed, because each line counts once per lap.

### 4.6 New achievements (`achievements.ts`)

| Id | Name | Emoji | Coins | Unlocks when |
|---|---|---|---|---|
| `round-1` | Warmed Up | 🏃 | 20 | `totals.rounds >= 1` |
| `clean-round` | Clean Sweep | 🧹 | 50 | `totals.cleanRounds >= 1` |
| `gold-sicilian` | Golden Dragon | 🥇 | 100 | every main line of the Sicilian has a gold medal |
| `gold-london` | Golden Tower | 🥇 | 100 | same, London |
| `gold-vs-d4` | Golden Gate | 🥇 | 100 | same, Black vs 1.d4 |
| `ready-sicilian` / `ready-london` / `ready-vs-d4` | Tournament Ready | 🏆 | 200 each | `readiness(...).ready` for that opening; the description names the opening |
| `lap-1` | Tree Climber | 🌳 | 75 | `totals.laps >= 1` |
| `lap-3` | Evergreen | 🌲 | 150 | some opening has `laps[o].n >= 4` (3 laps finished) |

- The gold and ready rules need the repertoire (`ctx.rep` / `ctx.reps`), like the mastery rules already
  do.
- `applyMainRound` runs the achievement check with the repertoire too.
- Existing achievements are unchanged. Repeats in the 60-minute window still don't count toward
  totals-based achievements.

---

## 5. UI per screen (iPad first; touch targets ≥ 48 px; short, warm copy)

### 5.1 Opening screen (`OpeningScreen.tsx` + `.css`)

**Header ring**: 🏆 Ready % (section 3.4).
- Below it: "⭐ 2/6 🥇 · 🔑 9/14 ✅ · 41/54 mastered".
- The "to review" chip counts non-Plan-B lines only.

**Left column, top to bottom:**

1. **▶ Coach's Choice**: unchanged look. Its subtitle uses the non-Plan-B due count.
2. **⭐ Main Lines** card (new):
   - One token per chapter: short chapter title, a medal emoji (or an empty circle), "×N" reps, and a
     ✓ if played today. They wrap on narrow screens.
   - Button: **"▶ Round · 6 lines · ~5 min"**.
   - Small text: "Best 4:12 · Bonuses today ●●○" (from `roundBonusesLeft`).
3. **🌳 All Lines · Lap N** card (new; replaces "All lines in order"):
   - Progress bar: done/total.
   - Per-tier row for this lap: "⭐ 6/6 · 🔑 9/14 · 🌿 2/9 · 🅱️ 0/25". The 🅱️ part is hidden when Plan
     B is off.
   - "Next: Closed (2.Nc3) · 🔑 3.f4 …", using `displayLineName(line, 0, false, userColor)` so the
     kid's moves stay hidden.
   - Button: **"▶ Continue lap"**, or **"▶ Start lap"** when nothing is done yet.
4. "👀 Show me the moves" toggle and "🤖 Play vs computer": unchanged.

**Right column: chapter list**, unchanged, plus a tier line per row: "⭐ · 🔑 4 · 🌿 2 · 🅱️ 10". The
mastery bar stays.

### 5.2 Home (`Home.tsx`)

- The opening card ring shows 🏆 Ready % (label "ready"), not "mastered".
- The "to review" chip counts non-Plan-B lines.
- Nothing else changes; the daily goal is unchanged.

### 5.3 Trainer (`Trainer.tsx`, `trainer/*`)

- **Mode label**:
  - `main`: "⭐ Main lines · 3/6" plus a small "⏱ 2:41". On a re-queued line: "⭐ Fix-up · 7/7".
  - `lap`: "🌳 Lap 2 · 38/54".
- **Tier chip** after the line name: ⭐ Main line / 🔑 Key reply / 🌿 Deeper / 🅱️ Plan B. In Coach's
  Choice it stays hidden until the line is complete (the existing "mystery" rule).
- **Branch start**:
  - `ProgressDots` gets only the non-`'skip'` marks; `current` is shifted by the number skipped.
  - The count shows played moves only.
  - `MoveList` greys the moves with `skipped: true`.
  - `CoachBubble` shows the ⏩ message while `state.ply === state.startPly`.
- **New branch note** (section 2.6) in `CoachBubble`.
- **Leave dialog** in `main` mode: "Leave the round? Lines you finished still count — the round bonus
  needs the whole round."
- **Completion modal** (`LineCompleteModal`):
  - Shows the tier chip.
  - `main` mode: compact variant, with "Rep #N" and the next-medal progress line; a medal banner when a
    medal was just earned.
  - `lap` mode: the "🌳 Lap 2: 39/54 ✓" line, and the lap-complete banner.
- **`RoundCompleteModal`** (new): "⭐ Round complete!", the time and best (🏁 New best!), a clean-sweep
  badge, the coin breakdown, bonuses left today, and the buttons from section 2.2.

### 5.4 Trophies

No code change: the new achievements appear from `ACHIEVEMENTS`.

### 5.5 Parent zone (`meta/ParentSections.tsx`, Training section)

- New toggle: **"🅱️ Plan B lines in laps"**, with the description "The coach's second-choice moves.
  Off = laps cover only the lines your child must know." On by default (`actions.setIncludePlanB`).
- New read-only card: **"Practice structure"**, one block per opening:
  - Tier counts as in the table in 1.3.
  - The main line of each chapter (`movesLabel` of its first 8 moves).
  - **Ask the coach**: the conflicts from `findMoveConflicts`, and every chapter where Plan B is more
    than half of its lines (today QGD 5.Bf4 12/14, Alapin 10/17, Delayed Alapin 3/4, Old Benoni 9/16
    and Jobava 4/7).
  - A note: "The first move in each Lichess chapter is treated as the main move. To change it, move the
    variation first on Lichess and import the study again — progress is kept."

---

## 6. Build plan: 3 engineers in parallel

### 6.1 Step 0 (lead, before the groups start): apply this `src/types.ts` patch verbatim

All the new fields are optional, so the project still compiles.

```ts
// near the Line interface
/** Practice tier (docs/practice-structure.md §1). */
export type LineTier = 'main' | 'key' | 'deep' | 'planb'

export interface Line {
  // ...existing fields...
  /** Computed on every build by classifyLines(); never stored, never part of the id. */
  tier?: LineTier
  /** Moves that are not the chapter tree's first choice (children[0]). */
  deviations?: number
  /** Plies shared with parentLineId; 0 for the chapter main line. */
  branchPly?: number
  /** The earlier line of the same chapter this one branches off (longest shared start). */
  parentLineId?: string
  /** Kid moves from branchPly to the end. */
  ownUserMoves?: number
  /** Where a branch-start run begins (index of the kid's last move before branchPly); 0 = move 1. */
  startPly?: number
}

export interface LineStats {
  // ...existing fields...
  /** Distinct local days with a perfect (non-learn) run. Absent on old saves: read via perfectDaysOf(). */
  perfectDays?: number
  /** Local 'YYYY-MM-DD' of the last perfect run. */
  lastPerfectDay?: string
  /** Main-line medal earned (1 bronze, 2 silver, 3 gold); paid once each, never lost. */
  medal?: 1 | 2 | 3
}

export interface LapRecord {
  /** Current lap number (1-based). */
  n: number
  /** Line ids finished (2+ stars, not learn mode) in the current lap. */
  done: string[]
}

export interface Profile {
  // ...existing fields...
  totals: {
    lines: number; perfects: number; mistakesFixed: number; engineWins: number; blundersPunished: number
    /** Main-line rounds finished / clean ones / laps finished (all openings). */
    rounds?: number; cleanRounds?: number; laps?: number
  }
  /** Per opening id. Absent = lap 1, nothing done. */
  laps?: Record<string, LapRecord>
  /** Fastest clean main-line round per opening id (ms). */
  mainRoundBest?: Record<string, number>
}

export interface ParentSettings {
  // ...existing fields...
  /** Plan B lines are part of laps. Absent = true. */
  includePlanB?: boolean
}

export type TrainerMode = 'random' | 'inorder' | 'chapter' | 'main' | 'lap'

export interface LineResultInput {
  // ...existing fields...
  /** Kid moves actually played (a branch-start run skips some). Absent = the whole line. */
  userMovesPlayed?: number
}

export interface LapResult {
  openingId: string
  /** The lap this completion counted toward. */
  n: number
  done: number
  total: number
  /** This completion finished lap n (the profile is now on lap n + 1). */
  completed: boolean
  /** Lap bonus paid with this completion (0 unless completed). */
  coins: number
}

export interface Reward {
  // ...existing fields...
  /** A main-line medal was earned with this completion. */
  medal?: { level: 1 | 2 | 3; coins: number }
  /** Present when this completion counted toward a lap. */
  lap?: LapResult
}
```

`DailyStateX` (in `src/store/defaults.ts`, group B) gains `roundsRewarded?: number`.

### 6.2 Shared contracts: exact exported signatures

**Group A, `src/chess/lineTiers.ts` (new).** It has **type-only imports** (no runtime import from
`repertoire.ts`, which imports it). It defines its own one-line `positionKey` and move-label helpers.

```ts
export const TIER_ORDER: readonly LineTier[]                       // ['main','key','deep','planb']
export const TIER_META: Record<LineTier, { emoji: string; name: string; plural: string; hint: string }>
//   main  ⭐ 'Main line'   / 'Main lines'   / "Your coach's main line"
//   key   🔑 'Key reply'   / 'Key replies'  / 'When they try something else early'
//   deep  🌿 'Deeper line' / 'Deeper lines' / 'They try something else again later'
//   planb 🅱️ 'Plan B'      / 'Plan B lines' / "Your coach's second-choice move"
export function classifyLines(chapters: Chapter[], lines: Line[], userColor: 'w' | 'b'): void // sets the 6 optional fields (§1)
export function tierOf(line: Line): LineTier                        // line.tier ?? 'deep'
export function tierCounts(lines: readonly Line[]): Record<LineTier, number>
export function lapLines(lines: readonly Line[], includePlanB: boolean): Line[] // §2.3 order
export function nextLapLine(ordered: readonly Line[], done: ReadonlySet<string>, skip?: ReadonlySet<string>): Line | null
export function mainRoundQueue(lines: readonly Line[], rng: () => number): Line[] // main tier, Fisher-Yates
export const BRANCH_START_PARENT_BOX = 3
export function branchStartPly(line: Line, stats: Readonly<Record<string, LineStats>>): number // §2.5 rules 2–4
export function mainAlternative(rep: Repertoire, node: MoveNode): MoveNode | null // children[0] at node's point if node isn't it
export interface MoveConflict { fenBefore: string; moves: Array<{ chapterId: string; chapterTitle: string; label: string }> }
export function findMoveConflicts(rep: Repertoire): MoveConflict[] // §1.5: 2 / 2 / 0 today
export function estimateMinutes(lines: readonly Line[], userColor: 'w' | 'b', startPlyOf?: (l: Line) => number): number
//   3.5 s per kid move + 0.8 s per opponent move + 6 s per line, rounded to whole minutes (min 1)
```

**Group A, `src/chess/scheduler.ts` (additions).**

```ts
export const MAX_INTERVAL_DAYS: Record<LineTier, number>            // { main: 7, key: 12, deep: 16, planb: 16 }
export function maxIntervalDaysFor(tier: LineTier | undefined): number // undefined -> 16
export function updateLineStats(prev: LineStats | undefined, r: LineResult, now: number, maxIntervalDays?: number): LineStats
//   interval = min(BOX_INTERVAL_DAYS[box], maxIntervalDays) days; the default 16 keeps every existing result identical
export type CoachTier = 'main' | 'key' | 'deep'
export const COACH_QUOTA: Record<CoachTier, number>                 // { main: 35, key: 40, deep: 25 }
export const COACH_QUOTA_MAIN_ALL_GOLD = 20
export function coachEligible(lines: readonly Line[], stats: Readonly<Record<string, LineStats>>): Line[] // §2.1 steps 1–2
export function coachTierShares(eligible: readonly Line[], allMainsGold: boolean): Record<CoachTier, number> // sums to 1
export function pickCoachLine(lines: Line[], stats: Record<string, LineStats>, now: number,
  opts?: { avoidLineId?: string; rng?: () => number }): Line
//   allMainsGold = there is a main line and every main line in `lines` has stats.medal === 3
```

**Group A, `src/trainer/trainerReducer.ts` (changes).**

```ts
export type UserMoveMark = 'pending' | 'clean' | 'fixed' | 'skip'
// PlayedMove gains:  skipped?: boolean   (auto-played by a branch start)
// TrainerState: userMoveMarks: UserMoveMark[]; startPly: number  (restart returns here)
export function initTrainer(line: Line, config: TrainerConfig, ctx: TrainerContext, startPly?: number): TrainerState
//   startPly is used only if mode !== 'random', it is an integer in (0, moves.length), moves[startPly] is a
//   kid move, and every prefix move replays with chess.js; otherwise 0. The prefix goes into history
//   (skipped: true), 'skip' marks, ply = fen = lastMove set; history.length === ply + tailPly holds.
export function skippedUserMoves(state: TrainerState): number
```

**Group A, `src/trainer/useTrainer.ts` (TrainerApi additions).**

```ts
export interface MainRoundView {
  order: string[]          // play order incl. re-queued ids
  pos: number              // index in order of the current line
  size: number             // distinct main lines
  requeued: string[]
  firstTryPerfect: string[]
  startedAt: number
  /** Set once after the last line. */
  result: null | { ms: number; clean: boolean; outcome: Omit<MainRoundOutcome, 'data'> }
}
export interface LapView { n: number; done: number; total: number; includesPlanB: boolean; justCompleted: LapResult | null }
// TrainerApi gains:
round: MainRoundView | null      // mode 'main' only
lap: LapView | null              // mode 'lap' only
skippedUserMoves: number         // 0 = from move 1
newRound: () => void             // mode 'main': reshuffle, new startedAt
// LineOutcome gains: tier: LineTier; userMovesPlayed: number; roundDone: boolean
```

**Group B, `src/store/mastery.ts` (new, pure).**

```ts
export const MEDALS: ReadonlyArray<{ level: 1 | 2 | 3; name: 'Bronze' | 'Silver' | 'Gold'; emoji: string;
  perfects: number; days: number; box: number; coins: number }>   // 5/1/0/10 · 15/4/0/25 · 30/8/3/50
export function perfectDaysOf(s: LineStats | undefined): number    // s.perfectDays ?? min(perfects, box)
export function medalOf(s: LineStats | undefined): 0 | 1 | 2 | 3 // stored medal
export function qualifiedMedal(s: LineStats | undefined): 0 | 1 | 2 | 3
export function medalProgress(s: LineStats | undefined): { level: 0 | 1 | 2 | 3; next: (typeof MEDALS)[number] | null;
  perfects: number; days: number; box: number }
export interface TierCount { total: number; seen: number; mastered: number; due: number }
export function tierProgress(lines: readonly Line[], stats: Readonly<Record<string, LineStats>>, now: number): Record<LineTier, TierCount>
export interface Readiness { percent: number; ready: boolean; mains: number; mainsByMedal: [number, number, number];
  keys: number; keysMastered: number }                             // mainsByMedal = lines with >= bronze / silver / gold
export function readiness(lines: readonly Line[], stats: Readonly<Record<string, LineStats>>): Readiness
export const LAP_COINS_PER_LINE = 2
export function inLap(line: Line, includePlanB: boolean): boolean  // includePlanB || line.tier !== 'planb'
export function lapOf(p: Profile, openingId: string): LapRecord    // absent -> { n: 1, done: [] }
export function lapProgress(p: Profile, openingId: string, lapLineIds: readonly string[]):
  { n: number; done: number; total: number; doneIds: Set<string> }
export const ROUND_BONUS_PER_LINE = 2
export const ROUND_CLEAN_BONUS = 10
export const ROUND_BONUSES_PER_DAY = 3
export function roundBonusesLeft(p: Profile, now: number): number
```

**Group B, `src/store/profileOps.ts` / `appStore.ts`.**

```ts
export interface MainRoundInput { openingId: string; roundId: number; lineIds: string[]; clean: boolean; ms: number; now: number }
export interface MainRoundOutcome {
  data: AppData; ok: boolean
  coins: number; breakdown: RewardLine[]
  bonusPaid: boolean            // false once 3 round bonuses were paid today
  roundsLeftToday: number
  newBest: boolean; bestMs: number | null
  newAchievements: AchievementDef[]
  levelUp: { from: LevelInfo; to: LevelInfo } | null
}
export function applyMainRound(data: AppData, profileId: string, input: MainRoundInput, rep?: Repertoire | null): MainRoundOutcome
export function setIncludePlanB(data: AppData, on: boolean): OpResult
// appStore.actions:
applyMainRound(input: MainRoundInput, rep?: Repertoire | null): Omit<MainRoundOutcome, 'data'>  // dedupes by profile|opening|roundId
setIncludePlanB(on: boolean): SimpleResult                                                      // touchParent() like setDailyGoal
// applyLineResult(data, profileId, input, rep) keeps its signature; the Reward may now carry medal / lap
```

Group B imports `maxIntervalDaysFor` from `scheduler.ts` (A). Group A imports `actions.applyMainRound`
and the `MainRoundOutcome` / `LapResult` types (B, types.ts). Group C imports from both. Code against
these signatures; stub locally until the other group merges.

### 6.3 File-by-file change list

**Group A: classification, scheduler, trainer core**

| File | Change |
|---|---|
| `src/chess/lineTiers.ts` | **New.** Everything in 6.2. `classifyLines` follows §1.1–1.2 exactly, including the main-line guard. |
| `src/chess/repertoire.ts` | Call `classifyLines(chapters, lines, userColor)` after names are de-duplicated, before `linesByNode`. Nothing else changes (ids, index, name). |
| `src/chess/scheduler.ts` | `updateLineStats` `maxIntervalDays` (also caps the learn-mode `now + interval` branch); `MAX_INTERVAL_DAYS`, `maxIntervalDaysFor`; `COACH_QUOTA`, `coachEligible`, `coachTierShares`, `pickCoachLine`. `pickLine` / `pickLineBalanced` are unchanged. |
| `src/trainer/trainerReducer.ts` | `startPly` (6.2): `fresh()` takes a start ply, `restart` keeps `state.startPly`, `'skip'` marks, `skipped` history entries, `skippedUserMoves()`. The random-mode code paths are untouched. |
| `src/trainer/useTrainer.ts` | See the list below. |
| `scripts/test-tiers.ts` | **New** (section 7). |
| `scripts/test-scheduler.ts`, `scripts/test-trainer.ts`, `scripts/test-repertoire.ts` | Additions (section 7). |
| `package.json` | Add `node scripts/test-tiers.ts` to `test`. |

`useTrainer.ts` changes:
- **pool**: `main` → main-tier lines; `lap` → `lapLines(rep.lines, includePlanB)`, where `includePlanB`
  is `getAppData().parent.includePlanB !== false`.
- **`chooseLine`**:
  - `random` → `pickCoachLine(...)`.
  - `main` → the round queue.
  - `lap` → `nextLapLine(...)` with `profile.laps?.[openingId]` and `skipRef`.
- **`startLine`** takes a start ply and passes it to `initTrainer`:
  - In `lap`, the start ply is `branchStartPly(line, stats)`; in every other mode it is 0.
  - **Pin the line in `random` mode.**
- **`complete()`**:
  - Pass `userMovesPlayed` (marks other than `'skip'`).
  - **Write `inOrderIndex` only for `inorder` and `chapter`** (today it writes it for every mode other
    than `random`, which would let `main`/`lap` overwrite the in-order position).
  - `main`: re-queue a non-perfect first try; on the last line call `actions.applyMainRound`.
  - `lap`: if `reward.lap` is absent, add the line to `skipRef`; if `reward.lap.completed`, clear `skipRef`.
- Expose `round`, `lap`, `skippedUserMoves`, `newRound`, and the `LineOutcome` additions.
- Session key: already includes the mode, so no change.

**Group B: store, rewards, achievements**

| File | Change |
|---|---|
| `src/store/mastery.ts` | **New.** Everything in 6.2. |
| `src/store/rewards.ts` | `computeLineReward`: branch-start pay (§4.2) when `input.userMovesPlayed` is a number below `line.userMoveCount`. `nextLineStats(prev, r, now, maxIntervalDays?)` passes the cap through. |
| `src/store/profileOps.ts` | See the list below. |
| `src/store/achievements.ts` | The rules in §4.6. The `AchievementContext` stays the same, using `ctx.rep` / `ctx.reps`. |
| `src/store/storage.ts` | **Allowlists (mandatory, or the new fields are silently dropped on every load and import):** `normLineStats` keeps `perfectDays` (int ≥ 0), `lastPerfectDay` (date key) and `medal` (1–3). `normDaily` keeps `roundsRewarded`. `normProfile` keeps `laps` (per key: `n` int ≥ 1, `done` a unique string array capped at 1,000), `mainRoundBest` (finite > 0) and `totals.rounds/cleanRounds/laps`. `normParent` keeps `includePlanB` when it is a boolean. |
| `src/store/defaults.ts` | `DailyStateX.roundsRewarded?`; `emptyDaily` unchanged (absent = 0). |
| `src/store/appStore.ts` | `actions.applyMainRound` (dedupe map like `engineGames`), `actions.setIncludePlanB`. |
| `scripts/test-store.ts` | Additions (section 7). |

`profileOps.ts` changes:
- **`applyLineResult`**:
  - Pass `maxIntervalDaysFor(line.tier)`.
  - **Carry `perfectDays`, `lastPerfectDay` and `medal` forward from the previous stats.**
    `updateLineStats` builds a fresh object, the same way `learnCompletions` is carried forward today.
  - Perfect-day update: on a perfect non-learn run, if `lastPerfectDay !== today`, then
    `perfectDays = perfectDaysOf(prev) + 1`.
  - Medal evaluation and pay for `tier === 'main'`, including on farmed runs.
  - Lap update and rollover (§2.3), using `inLap` and `data.parent.includePlanB`. Without `rep`, record
    `done` but never roll over.
  - Medal and lap chips go into the breakdown and `reward.coins`.
- **`applyMainRound`** (§4.4): history reason "⭐ Main-line round · {opening name}".
- **`setIncludePlanB`**.

**Group C: screens**

| File | Change |
|---|---|
| `src/screens/OpeningScreen.tsx` + `.css` | §5.1. Remove the "All lines in order" card. Add the Main Lines card and the Lap card (`train('main')`, `train('lap')`), the Ready ring and the tier rows. |
| `src/screens/Home.tsx` + `.css` | §5.2: the ring shows `readiness`, the review chip counts non-Plan-B lines. |
| `src/screens/Trainer.tsx` + `.css` | §5.3: mode labels, timer, tier chip, skip-aware dots and count, leave text, `RoundCompleteModal` wiring. |
| `src/screens/trainer/CoachBubble.tsx` | ⏩ branch-start message; 🌿 new-branch tag (`mainAlternative`). |
| `src/screens/trainer/ProgressDots.tsx` | Accepts only the non-skip marks (no visual change). |
| `src/screens/trainer/MoveList.tsx` | Grey styling for `skipped` moves. |
| `src/screens/trainer/LineCompleteModal.tsx` | Tier chip; `variant: 'full' \| 'compact'`; `autoNextMs`; Rep #N and medal progress; medal and lap banners; main-mode buttons. |
| `src/screens/trainer/RoundCompleteModal.tsx` | **New** (§2.2, §5.3). |
| `src/screens/trainer/messages.ts` | Copy for the new messages. |
| `src/screens/meta/ParentSections.tsx` + `meta.css` | §5.5: Plan B toggle and the "Practice structure" card. |
| `src/dev/UiGallery.tsx` | Gallery states for the new cards and modals (round complete, compact modal, lap banner). |

**Lead (after merge):** add a short "Practice structure" section to `DESIGN.md` that links here, then
run `npx tsc -b`, `npm test` and `npm run build`.

No file is touched by two groups. `src/types.ts` is changed only in Step 0.

---

## 7. Test plan

**`scripts/test-tiers.ts` (A, new; real study)**
- **Snapshot at maxPly 30**: the per-chapter counts in the table in 1.3; totals 13 / 31 / 26 / 58.
- At maxPly 0 / 20 / 40: main 13 and key 31.
- Every chapter with lines has exactly one `main` line, and it is `indexInChapter === 0`.
- For every non-main line:
  - the parent is an earlier line of the same chapter;
  - the first `branchPly` moves are identical (same node objects);
  - the move at `branchPly` differs from the parent's, or the parent ends there.
- Every key line's `branchPly` is the index of its single deviation.
- `startPly` is 0 or the index of a kid move below `branchPly`, with no kid move between `startPly` and
  `branchPly`.
- `classifyLines` is idempotent and leaves `id`, `index`, `indexInChapter`, `name` and `moves` unchanged.
- Line ids before and after: compare with a build that skips classification.
- `lapLines`:
  - tier order is non-decreasing and `index` ascends within a tier;
  - with Plan B off there are no Plan B lines;
  - sizes are 54/55/19 with Plan B on and 29/35/6 with it off.
- `nextLapLine`: honours done and skip; falls back to skipped lines; returns null when everything is done.
- `branchStartPly` rule table:
  - main or key → 0;
  - parent box 2 → 0;
  - parent box 3 with completions 0, 1 or 3 → `startPly`;
  - completions 2 or 5 → 0.
- `mainRoundQueue`: deterministic with `seededRng`, and each main line appears exactly once.
- `findMoveConflicts`: 2 / 2 / 0 at maxPly 30, including Closed 5...Nh6 vs Side lines 5...Bd7.
- **Guard**: a synthetic repertoire whose main path was removed promotes index 0 to `main`.

**`scripts/test-scheduler.ts` (A)**
- `updateLineStats` with the default cap gives identical results to today; with cap 7 a box-5 promotion
  gives `dueAt = now + 7 d`; the learn-mode branch is capped too.
- `coachEligible`:
  - fresh stats → only main lines;
  - a parent with `box 1` unlocks its child;
  - a line's own `box 1` unlocks it;
  - Plan B is never eligible.
- `coachTierShares` on the real study, everything eligible:
  - Sicilian 0.35/0.40/0.25;
  - QGD 0.50/0.333/0.167;
  - with `allMainsGold`, the Sicilian main share is 20/85.
- `pickCoachLine`: 20,000 seeded picks fall within ±1.5 points of the shares; `avoidLineId` is
  respected when the tier has more than one line.
- Existing `pickLine` / `pickLineBalanced` tests are unchanged.

**`scripts/test-trainer.ts` (A)**
- `initTrainer` with `startPly` on a real deep line:
  - `history.length === ply === startPly` and every entry is `skipped`;
  - `fen === moves[startPly-1].fen` and `lastMove` is set;
  - the number of `'skip'` marks equals the kid moves before `startPly`;
  - `phase === 'userToMove'`.
- Play to the end: the other marks are `'clean'` and the phase is complete.
- `restart` returns to `startPly` with the same skips.
- A wrong move then `takeBack` restores the position after the last skipped move.
- `startPly` is ignored in `random` mode; an invalid `startPly` (an opponent move, out of range) → 0.
- A Plan B line from its `startPly` in `lap` mode: playing the first-choice move gives `'other-line'`
  with no mistake; playing the Plan B move advances.
- **Pinned Coach's Choice**: 500 runs per opening with a pinned `pick`, the kid playing the expected
  move → the completed line is the picked line every time.

**`scripts/test-store.ts` (B)**
- Branch-start pay:
  - `userMovesPlayed` 2 of 12 → base 4, Perfect 2, New 2, Combo capped at 2;
  - `userMovesPlayed` absent or ≥ `userMoveCount` → identical to today (regression);
  - the learn-like threshold uses n.
- The interval cap is passed for main lines: a box 4→5 run gives `dueAt = now + 7 d`.
- `perfectDays`:
  - two perfect runs on the same day give +1, the next day another +1;
  - old stats without the field read as `min(perfects, box)`;
  - the fields survive the `updateLineStats` rebuild.
- Medals:
  - the 5th perfect run of a main line → medal 1 and a +10 chip;
  - a jump from 0 to 2 pays 35;
  - Gold needs box ≥ 3 and 8 days;
  - non-main lines never get a medal;
  - a medal is never paid twice and stays after a failed run;
  - a farmed perfect run still counts toward the medal and pays 2 + medal.
- Laps:
  - 2★ adds to the lap; 1★ or learn mode doesn't; farmed runs count;
  - the last line rolls the lap over (n+1, `done` emptied, `totals.laps+1`, +2 per line);
  - with `includePlanB: false` the total excludes Plan B and Plan B completions don't count;
  - stale ids in `done` are ignored;
  - without `rep` there is no rollover.
- `applyMainRound`:
  - 2 per line, +10 when clean;
  - the 4th round of the day → `bonusPaid: false` and 0 coins, while `totals.rounds` still increases;
  - the best time is updated only by a clean, faster round;
  - the appStore dedupe on `roundId` holds;
  - the achievements `round-1` and `clean-round` unlock.
- Achievements: `lap-1`, `lap-3`, `gold-*` and `ready-*` (with a repertoire), and none without one.
- `readiness`:
  - all main lines gold and all key lines at box 3 → 100 and ready;
  - partial values are floored, and anything above 0 shows at least 1%.
- **Storage**:
  - `normLineStats` / `normDaily` / `normProfile` / `normParent` keep every new field;
  - invalid values are dropped (medal 4, `n` 0, negative best time);
  - a backup export/import round-trip keeps them;
  - a v1 save from before this change loads unchanged.

**Manual (C, after merge).** Use iPad landscape 1180×820, portrait 820×1180, and 375×812.
- **Opening screen**: the cards don't overflow and the tokens wrap.
- **A main round** with one deliberate mistake: the line is re-queued, the compact cards continue by
  themselves, the round-complete modal and the best time show, and the 4th round of the day shows no
  bonus.
- **A lap**: load a test backup where the Alapin main line and "3.e5 d4" are at box 3, then play
  "3.e5 … 8.O-O". The board starts at the branch, the skipped moves are grey, the dots count only the
  played moves, and the ⏩ message shows.
- **Plan B fork notice**: the glow appears; playing the first-choice move gives "other-line".
- **Parent zone**: the Plan B toggle changes the lap total; the structure card lists the 4 conflicts.
- **Coach's Choice** still hides the line name until the end.

---

## 8. Deliberately left out (and why)

- **Plan B lines in Coach's Choice.** Random mode accepts the kid's first-choice move and switches
  line, so enforcing Plan B would mean changing the most fragile reducer code. Plan B is practised in
  laps and chapter mode, where the fork notice already works.
- **Branch starts outside laps, and an animated replay of the skipped moves.** Branch starts stay in
  one fixed-target mode only. They are instant, and the move list shows the path.
- **Per-line tier overrides in the Parent zone.** The coach reorders variations on Lichess instead.
  Ids are stable, and the structure card explains how.
- **A branching tree view.** The chapter rows and the lap tier row show the structure. A tree is a
  candidate for stage 2.
- **Grand Marathon** (all 13 main lines, switching colours).
- **A separate Quick-check mode** for short lines. Branch starts and pay per kid move cover them.
- **Separate Key-reply and Deeper drill cards.** Coach's Choice and the lap cover them, which keeps the
  screen to three choices.
- **Extra pay for repeats inside the 60-minute window** (per-move rep pay, a daily drill cap). Repeats
  still pay 2, and the reasons to repeat are the medals, the round bonus (3 per day) and best times.
- **Coins for a personal best.**
- **A Daily Quest that redefines the streak.** The daily goal and the streak are unchanged.
- **Lap colours, lock icons, and pre-crediting lap 1 with lines already mastered.**
- **Resolving the cross-chapter conflicts in code.** They are reported to the parent and coach;
  the trainer's existing "other-line" / `book-alt` handling stays.
- **Changes to the Trophies stats panel.** The new achievements appear on their own.
