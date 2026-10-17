// Extracts only the chapters the app uses from a full Lichess study export and
// strips identifying headers, so the published site doesn't carry the kids'
// tournament prep, game chapters or other players' names.
//
// Usage: node scripts/extract-study.ts [input.pgn] [output.pgn]
//   default input:  data/studies/opening-lines-CZiXOjIp.raw.pgn  (gitignored)
//   default output: public/studies/opening-lines.pgn
import { readFileSync, writeFileSync } from 'node:fs'
import { OPENINGS } from '../src/data/openings.ts'

const input = process.argv[2] ?? 'data/studies/opening-lines-CZiXOjIp.raw.pgn'
const output = process.argv[3] ?? 'public/studies/opening-lines.pgn'

const KEEP_HEADERS = new Set(['ChapterName', 'ChapterURL', 'FEN', 'SetUp', 'Variant', 'ECO', 'Opening', 'Orientation', 'Result'])

const wanted = new Set<string>()
/** The app's own chapter titles: the published file never carries the study's chapter names (they can name people). */
const titles = new Map<string, string>()
for (const o of OPENINGS) {
  for (const c of [...o.chapters, ...o.extraChapters]) {
    wanted.add(c.id)
    titles.set(c.id, c.title)
  }
}

const text = readFileSync(input, 'utf8').replace(/\r\n/g, '\n')
const games = text.split(/\n\s*\n(?=\[Event )/)
const out: string[] = []
const found = new Set<string>()

for (const g of games) {
  const id = g.match(/\[ChapterURL "[^"]*\/([A-Za-z0-9]{8})"\]/)?.[1]
  if (!id || !wanted.has(id)) continue
  found.add(id)
  const lines = g.trim().split('\n')
  const headers: string[] = []
  let i = 0
  for (; i < lines.length && lines[i].startsWith('['); i++) {
    const key = lines[i].match(/^\[(\w+) /)?.[1]
    if (key === 'ChapterName') headers.push(`[ChapterName "${(titles.get(id) ?? id).replace(/["\\]/g, '')}"]`)
    else if (key && KEEP_HEADERS.has(key)) headers.push(lines[i])
  }
  // Lichess stores annotator handles in [%anno "..."] commands; drop them.
  const movetext = lines.slice(i).join('\n').trim().replace(/\[%anno [^\]]*\]/g, '').replace(/\{\s*\}/g, '')
  out.push(`${headers.join('\n')}\n\n${movetext}\n`)
}

const missing = [...wanted].filter((id) => !found.has(id))
if (missing.length) console.warn(`WARNING: chapters not found in ${input}: ${missing.join(', ')}`)
writeFileSync(output, out.join('\n'), 'utf8')
console.log(`Wrote ${out.length} chapters (${wanted.size} wanted) to ${output}`)
