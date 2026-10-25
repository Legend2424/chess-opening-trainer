// Group C: pure helpers of the practice-structure UI (src/screens/trainer/practice.ts)
// and layout guards on OpeningScreen.css (docs/practice-structure.md §5).
// Run: node scripts/test-practice-ui.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { LineStats } from '../src/types.ts'
import {
  bonusDots,
  formatClock,
  lapTierRows,
  lineNameBesideTier,
  linesWord,
  localDayKey,
  medalEmoji,
  nextMedalText,
  playedToday,
  shortChapterTitle,
  tierLabel,
  tierLine,
} from '../src/screens/trainer/practice.ts'

const base: LineStats = { attempts: 0, completions: 0, perfects: 0, box: 0, lastPracticed: 0, dueAt: 0, lastMistakes: 0 }
let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('practice UI helpers')

test('formatClock', () => {
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(41_999), '0:41')
  assert.equal(formatClock(252_000), '4:12')
  assert.equal(formatClock(725_000), '12:05')
  assert.equal(formatClock(3_723_000), '1:02:03')
  assert.equal(formatClock(-5), '0:00')
  assert.equal(formatClock(Number.NaN), '0:00')
})

test('medal and tier labels', () => {
  assert.equal(medalEmoji(0), '')
  assert.equal(medalEmoji(1), '🥉')
  assert.equal(medalEmoji(3), '🥇')
  assert.equal(medalEmoji(7), '')
  assert.equal(tierLabel('main'), '⭐ Main line')
  assert.equal(tierLabel('key'), '🔑 Key reply')
})

// Review finding 4: "Smith-Morra Gambit · Main line ⭐ Main line".
test('lineNameBesideTier drops a name that only repeats the tier chip', () => {
  assert.equal(lineNameBesideTier('Main line', 'main'), '')
  assert.equal(lineNameBesideTier('main line', 'main'), '')
  assert.equal(lineNameBesideTier(' Main line ', 'main'), '')
  // Any other name stays, and so does "Main line" beside another tier's chip.
  assert.equal(lineNameBesideTier('3.e5 d4 … 8.O-O', 'deep'), '3.e5 d4 … 8.O-O')
  assert.equal(lineNameBesideTier('2...d5', 'main'), '2...d5') // a main line promoted by the guard
  assert.equal(lineNameBesideTier('Main line', 'key'), 'Main line')
  assert.equal(lineNameBesideTier('Main line', undefined), 'Main line') // tier unknown -> 'deep'
  assert.equal(lineNameBesideTier('', 'main'), '')
})

test('nextMedalText', () => {
  assert.equal(nextMedalText(undefined), '🥉 in 5 more perfect runs · 1 more day')
  assert.equal(nextMedalText({ ...base, perfects: 12, box: 3, perfectDays: 2, medal: 1 }), '🥈 in 3 more perfect runs · 2 more days')
  assert.equal(nextMedalText({ ...base, perfects: 15, box: 3, perfectDays: 4, medal: 2 }), '🥇 in 15 more perfect runs · 4 more days')
  assert.equal(nextMedalText({ ...base, perfects: 30, box: 2, perfectDays: 9, medal: 2 }), '🥇 once this line is mastered ✅')
  assert.equal(nextMedalText({ ...base, perfects: 29, box: 2, perfectDays: 9, medal: 2 }), '🥇 in 1 more perfect run · and mastered ✅')
  assert.equal(nextMedalText({ ...base, perfects: 6, box: 2, perfectDays: 2 }), '🥉 comes with your next run!')
  assert.match(nextMedalText({ ...base, perfects: 40, box: 5, perfectDays: 10, medal: 3 }), /^🥇 Gold/)
})

test('bonusDots', () => {
  assert.equal(bonusDots(3), '●●●')
  assert.equal(bonusDots(1), '●○○')
  assert.equal(bonusDots(0), '○○○')
  assert.equal(bonusDots(-2), '○○○')
  assert.equal(bonusDots(7), '●●●')
})

test('shortChapterTitle', () => {
  assert.equal(shortChapterTitle('Alapin (2.c3)'), 'Alapin')
  assert.equal(shortChapterTitle('Delayed Alapin (2.Nf3 Nc6 3.c3)'), 'Delayed Alapin')
  assert.equal(shortChapterTitle('QGD: White plays 5.Bf4'), 'QGD: 5.Bf4')
  assert.equal(shortChapterTitle('Side lines'), 'Side lines')
  assert.equal(shortChapterTitle('(2.c3)'), '(2.c3)') // never empty
})

test('playedToday / localDayKey', () => {
  const now = new Date(2026, 9, 25, 15, 0).getTime()
  assert.equal(localDayKey(now), '2026-10-25')
  assert.equal(playedToday({ ...base, lastPracticed: new Date(2026, 9, 25, 0, 5).getTime() }, now), true)
  assert.equal(playedToday({ ...base, lastPracticed: new Date(2026, 9, 24, 23, 55).getTime() }, now), false)
  assert.equal(playedToday({ ...base, lastPracticed: 0 }, now), false)
  assert.equal(playedToday(undefined, now), false)
})

test('tierLine / lapTierRows / linesWord', () => {
  const L = (id: string, tier: 'main' | 'key' | 'deep' | 'planb') => ({ id, tier }) as never
  const lines = [L('a', 'main'), L('b', 'key'), L('c', 'key'), L('d', 'planb')]
  assert.equal(tierLine(lines), '⭐ · 🔑 2 · 🅱️ 1')
  assert.deepEqual(lapTierRows(lines, new Set(['a', 'c'])), [
    { tier: 'main', done: 1, total: 1 },
    { tier: 'key', done: 1, total: 2 },
    { tier: 'planb', done: 0, total: 1 },
  ])
  assert.equal(linesWord(1), '1 line')
  assert.equal(linesWord(6), '6 lines')
})

// Layout guards for the Opening screen (review findings 1–3). CSS can't be rendered here,
// so these check the rules that keep iPad layouts usable.
console.log('OpeningScreen.css guards')
const css = readFileSync(new URL('../src/screens/OpeningScreen.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The bodies of the @media blocks whose query matches `query`. */
function mediaBodies(query: RegExp): string[] {
  const out: string[] = []
  const re = /@media([^{]+)\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    if (!query.test(m[1])) continue
    let depth = 1
    let i = re.lastIndex
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
    }
    out.push(css.slice(re.lastIndex, i - 1))
  }
  return out
}

test('finding 1: the landscape left column scrolls instead of clipping its last row', () => {
  const blocks = mediaBodies(/orientation:\s*landscape/)
  assert.ok(
    blocks.some((b) => /\.opening__col--main\s*\{[^}]*overflow-y:\s*auto/.test(b)),
    'a landscape @media block must give .opening__col--main overflow-y: auto',
  )
  // ...and a compact variant exists for short landscape windows (browser toolbars).
  assert.ok(mediaBodies(/landscape[\s\S]*max-height:\s*800px/).length > 0, 'compact landscape block (max-height: 800px)')
})

test('finding 2: short portrait windows fall back to the scrolling page; iPad portrait puts the cards side by side', () => {
  assert.ok(
    mediaBodies(/portrait\)\s*and\s*\(max-height:\s*\d+px/).some((b) => /\.opening\s*\{[^}]*height:\s*auto/.test(b)),
    'short portrait windows use the scrolling page',
  )
  assert.ok(
    mediaBodies(/portrait\)\s*and\s*\(min-width:\s*641px/).some((b) => /\.opening__col--main\s*\{[^}]*grid-template-columns/.test(b)),
    'iPad portrait: Main Lines and lap cards side by side',
  )
})

test('finding 3: the learn-mode description ("half coins") is never hidden', () => {
  assert.ok(!/toggle__desc\s*\{[^}]*display:\s*none/.test(css), '.toggle__desc must not be display: none')
  const tsx = readFileSync(new URL('../src/screens/OpeningScreen.tsx', import.meta.url), 'utf8')
  assert.match(tsx, /opening__desc-long[\s\S]*half coins/)
  assert.match(tsx, /opening__desc-short[\s\S]*half coins/)
})

console.log(`\n${passed} passed`)
