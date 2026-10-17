// Loads the study PGN (bundled file, or the parent's imported override), parses
// it once, and builds one Repertoire per opening using the parent's training
// settings (line length cap, extra chapters). Shared by every screen.
import { useEffect, useMemo, useState } from 'react'
import { parsePgnFile, type PgnGame } from './pgn.ts'
import { buildRepertoire, chapterIdOf } from './repertoire.ts'
import { DEFAULT_MAX_PLY, OPENINGS, STUDY_FILE } from '../data/openings.ts'
import { useAppData } from '../store/appStore.ts'
import { assetUrl } from '../util/assetUrl.ts'
import type { OpeningDef, Repertoire } from '../types.ts'

export interface RepertoireState {
  status: 'loading' | 'ready' | 'error'
  reps: Repertoire[]
  byId: Record<string, Repertoire>
  source: 'bundled' | 'imported'
  error?: string
  /** The study text in use (for previews of other settings in the Parent zone). */
  text?: string
}

let bundledText: Promise<string> | null = null
/** The bundled text once loaded: later mounts start "ready" (no loading flash / extra render). */
let bundledResolved: string | null = null

function fetchBundled(): Promise<string> {
  if (!bundledText) {
    bundledText = fetch(assetUrl(STUDY_FILE)).then((r) => {
      if (!r.ok) throw new Error(`Could not load the opening lines (HTTP ${r.status})`)
      return r.text().then((t) => {
        bundledResolved = t
        return t
      })
    })
    // Allow a retry after a failure (e.g. offline on first launch).
    bundledText.catch(() => {
      bundledText = null
    })
  }
  return bundledText
}

// Parsing is cheap (~10 ms) but repertoire building is ~40–80 ms, so cache both.
const gamesCache = new Map<string, PgnGame[]>()
function gamesFor(text: string): PgnGame[] {
  let g = gamesCache.get(text)
  if (!g) {
    g = parsePgnFile(text)
    if (gamesCache.size > 2) gamesCache.clear()
    gamesCache.set(text, g)
  }
  return g
}

const repsCache = new Map<string, Repertoire[]>()
function buildAll(text: string, maxPly: Record<string, number>, extras: string[]): Repertoire[] {
  const key = `${text.length}:${hashText(text)}|${JSON.stringify(maxPly)}|${[...extras].sort().join(',')}`
  let reps = repsCache.get(key)
  if (!reps) {
    const games = gamesFor(text)
    reps = OPENINGS.map((def) =>
      buildRepertoire(def, games, { maxPly: maxPly[def.id] ?? DEFAULT_MAX_PLY, enabledExtras: extras }),
    )
    if (repsCache.size > 4) repsCache.clear()
    repsCache.set(key, reps)
  }
  return reps
}

// The study text rarely changes: hash it once (an imported study can be MBs).
let lastHashText = ''
let lastHash = ''
function hashText(s: string): string {
  if (s === lastHashText) return lastHash
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  lastHashText = s
  lastHash = (h >>> 0).toString(36)
  return lastHash
}

/**
 * One opening built from `text` with other settings, without touching the app
 * (the Parent zone's "what would change?" previews). Pure; uses the parse cache.
 */
export function previewRepertoire(text: string, def: OpeningDef, maxPly: number, extras: string[]): Repertoire {
  return buildRepertoire(def, gamesFor(text), { maxPly, enabledExtras: extras })
}

/** Every opening built from a PGN the parent is about to import (pure; nothing is applied). */
export function previewStudy(text: string, maxPly: Record<string, number>, extras: string[]): Repertoire[] {
  const games = parsePgnFile(text)
  return OPENINGS.map((def) => buildRepertoire(def, games, { maxPly: maxPly[def.id] ?? DEFAULT_MAX_PLY, enabledExtras: extras }))
}

/** Chapter ids ([ChapterURL]) in a PGN text. */
export function chapterIdsIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const g of parsePgnFile(text)) {
    const id = chapterIdOf(g)
    if (id) out.add(id)
  }
  return out
}

export function useRepertoires(): RepertoireState {
  const data = useAppData()
  const override = data.studyOverride?.pgn
  const { maxPly, enabledExtras } = data.parent

  const [bundled, setBundled] = useState<string | null>(() => bundledResolved)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (override || bundled) return
    let alive = true
    fetchBundled()
      .then((t) => alive && setBundled(t))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [override, bundled])

  const text = override ?? bundled
  const maxPlyKey = JSON.stringify(maxPly)
  const extrasKey = enabledExtras.join(',')

  return useMemo<RepertoireState>(() => {
    const source = override ? 'imported' : 'bundled'
    if (!text) {
      return { status: error ? 'error' : 'loading', reps: [], byId: {}, source, error }
    }
    try {
      const reps = buildAll(text, maxPly, enabledExtras)
      const byId: Record<string, Repertoire> = {}
      for (const r of reps) byId[r.opening.id] = r
      return { status: 'ready', reps, byId, source, text }
    } catch (e) {
      return { status: 'error', reps: [], byId: {}, source, error: e instanceof Error ? e.message : String(e) }
    }
    // maxPly/enabledExtras are tracked via their string keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, error, override, maxPlyKey, extrasKey])
}

/** Convenience: one opening's repertoire. */
export function useRepertoire(openingId: string): { status: RepertoireState['status']; rep: Repertoire | null; error?: string } {
  const s = useRepertoires()
  return { status: s.status, rep: s.byId[openingId] ?? null, error: s.error }
}
