// Carries line progress over when the study changes (pure; runs under plain node).
//
// Line ids hash the opening, chapter and moves (src/chess/repertoire.ts), so a
// new study gives every line a new id even where the moves are identical. The
// generated map in src/data/lineMigrations.ts says "old id -> id of the same
// moves now"; this renames saved line stats accordingly. It runs while saved
// data / backups are validated (storage.ts), so old backups migrate too.

import type { LineStats } from '../types.ts'

/** Which of two stats for the same line to keep: the more learned one, then the more recent. */
function better(a: LineStats, b: LineStats): LineStats {
  if (a.box !== b.box) return a.box > b.box ? a : b
  return a.lastPracticed >= b.lastPracticed ? a : b
}

/**
 * Rename old line ids to their current ids. Returns the same object when
 * nothing changed. Several old ids can point at one new id (the same moves were
 * in two old chapters): the better stats win. An existing entry under the new id
 * is kept unless the migrated one is better.
 */
export function migrateLineStats(
  stats: Record<string, LineStats>,
  map: Readonly<Record<string, string>>,
): Record<string, LineStats> {
  let out: Record<string, LineStats> | null = null
  for (const oldId of Object.keys(stats)) {
    const newId = Object.prototype.hasOwnProperty.call(map, oldId) ? map[oldId] : undefined
    if (!newId || newId === oldId) continue
    if (!out) out = { ...stats }
    const moved = out[oldId]
    delete out[oldId]
    const existing = Object.prototype.hasOwnProperty.call(out, newId) ? out[newId] : undefined
    out[newId] = existing ? better(existing, moved) : moved
  }
  return out ?? stats
}
