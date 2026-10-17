// Shop catalogue (DESIGN.md §5). Pure data + lookups; runs under plain node.
//
// Item ids are `${kind}:${refId}`:
//   board:<BoardThemeId>  pieces:<PieceSetId>  effect:<EffectId>
//   avatar:<emoji>        trophy:<key>         title:<key>
// Items with cost 0 are free and owned by every profile from the start.

import { BOARD_THEME_IDS, EFFECT_IDS, PIECE_SET_IDS } from '../types.ts'
import type { BoardThemeId, CatalogItem, EffectId, ItemKind, PieceSetId } from '../types.ts'

type Rarity = CatalogItem['rarity']

interface Spec {
  name: string
  description: string
  cost: number
  emoji: string
  minLevel?: number
}

/** Rarity follows price so the shop sorts/colours itself sensibly. */
export function rarityForCost(cost: number): Rarity {
  if (cost >= 1500) return 'legendary'
  if (cost >= 600) return 'epic'
  if (cost >= 200) return 'rare'
  return 'common'
}

export function itemId(kind: ItemKind, refId: string): string {
  return `${kind}:${refId}`
}

function make(kind: ItemKind, refId: string, s: Spec): CatalogItem {
  const item: CatalogItem = {
    id: itemId(kind, refId),
    kind,
    refId,
    name: s.name,
    description: s.description,
    cost: s.cost,
    emoji: s.emoji,
    rarity: rarityForCost(s.cost),
  }
  if (s.minLevel !== undefined) item.minLevel = s.minLevel
  return item
}

// Record<Id, Spec> makes TypeScript insist that every theme/piece/effect id in
// src/types.ts has exactly one catalogue entry.
const BOARDS: Record<BoardThemeId, Spec> = {
  green: { name: 'Classic Green', description: 'The tournament classic.', cost: 0, emoji: '🟩' },
  brown: { name: 'Wooden Brown', description: 'Like a real wooden board.', cost: 0, emoji: '🟫' },
  ocean: { name: 'Ocean Waves', description: 'Cool blues from the deep sea.', cost: 150, emoji: '🌊' },
  candy: { name: 'Candy Land', description: 'Sweet pinks and minty greens.', cost: 250, emoji: '🍬' },
  forest: { name: 'Enchanted Forest', description: 'Mossy greens from a magic wood.', cost: 300, emoji: '🌲' },
  ice: { name: 'Ice Palace', description: 'Frosty and sparkly.', cost: 400, emoji: '🧊' },
  sunset: { name: 'Sunset Glow', description: 'Warm oranges at golden hour.', cost: 500, emoji: '🌅' },
  marble: { name: 'Marble Hall', description: 'Fancy polished stone.', cost: 600, emoji: '🏛️' },
  lava: { name: 'Lava Lake', description: 'Hot, hot, hot!', cost: 700, emoji: '🌋' },
  'royal-wood': { name: 'Royal Wood', description: 'A board fit for a king.', cost: 800, emoji: '🪵' },
  galaxy: { name: 'Galaxy', description: 'Play among the stars.', cost: 1000, emoji: '🌌' },
  gold: { name: 'Solid Gold', description: 'Shiny gold for champions.', cost: 1500, emoji: '🪙', minLevel: 4 },
  rainbow: { name: 'Rainbow', description: 'Every colour at once!', cost: 2000, emoji: '🌈', minLevel: 5 },
}

const PIECES: Record<PieceSetId, Spec> = {
  cburnett: { name: 'Classic', description: 'The pieces everyone knows.', cost: 0, emoji: '♟️' },
  merida: { name: 'Merida', description: 'Elegant tournament pieces.', cost: 0, emoji: '♞' },
  alpha: { name: 'Alpha', description: 'Bold and clear.', cost: 300, emoji: '♜' },
  california: { name: 'California', description: 'Smooth and sunny.', cost: 400, emoji: '🌴' },
  cardinal: { name: 'Cardinal', description: 'Old-school storybook style.', cost: 500, emoji: '📜' },
  staunty: { name: 'Staunty', description: 'Chunky classic shapes.', cost: 600, emoji: '♛' },
  fantasy: { name: 'Fantasy', description: 'Pieces from a fairy tale.', cost: 700, emoji: '🧚' },
  spatial: { name: 'Spatial', description: 'Sleek and futuristic.', cost: 800, emoji: '🚀' },
  pixel: { name: 'Pixel', description: 'Retro video-game pieces.', cost: 1000, emoji: '👾' },
  horsey: { name: 'Horsey', description: 'Everything is a little bit horse.', cost: 1200, emoji: '🐴' },
  anarcandy: { name: 'Anarcandy', description: 'Wild candy-coloured pieces.', cost: 1500, emoji: '🍭', minLevel: 4 },
  emoji: { name: 'Emoji Army', description: 'Your army, but make it emoji!', cost: 1800, emoji: '😎', minLevel: 5 },
}

const EFFECTS: Record<EffectId, Spec> = {
  confetti: { name: 'Confetti', description: 'A happy burst of confetti.', cost: 0, emoji: '🎉' },
  stars: { name: 'Starburst', description: 'Shooting stars when you finish.', cost: 200, emoji: '⭐' },
  fireworks: { name: 'Fireworks', description: 'Boom! Crackle! Wow!', cost: 400, emoji: '🎆' },
  'emoji-rain': { name: 'Emoji Rain', description: 'It rains happy faces.', cost: 500, emoji: '😄' },
  'coin-shower': { name: 'Coin Shower', description: 'Make it rain coins.', cost: 600, emoji: '🪙' },
  rainbow: { name: 'Rainbow Blast', description: 'A rainbow explosion.', cost: 800, emoji: '🌈' },
}

/** Avatars: refId is the emoji itself. */
const AVATARS: Array<[string, string, number]> = [
  ['🦉', 'Owl', 0],
  ['♞', 'Knight', 0],
  ['🐱', 'Cat', 0],
  ['🐶', 'Puppy', 0],
  ['🦊', 'Fox', 100],
  ['🐼', 'Panda', 100],
  ['🦁', 'Lion', 150],
  ['🐯', 'Tiger', 150],
  ['🐸', 'Frog', 150],
  ['🐙', 'Octopus', 200],
  ['🦄', 'Unicorn', 250],
  ['🐲', 'Dragon Face', 300],
  ['🦖', 'T-Rex', 300],
  ['🤖', 'Robot', 350],
  ['🧙', 'Wizard', 400],
  ['🥷', 'Ninja', 400],
  ['👑', 'Royal Crown', 600],
  ['🐉', 'Great Dragon', 800],
]

/** Decorative trophies for the shelf. refId = key. */
const TROPHIES: Array<[string, string, string, number, string]> = [
  ['bronze', '🥉', 'Bronze cup', 200, 'A shiny start to your shelf.'],
  ['silver', '🥈', 'Silver cup', 500, 'Polished and proud.'],
  ['gold', '🥇', 'Gold cup', 1000, 'Pure gold!'],
  ['champion', '🏆', 'Champion trophy', 1500, 'For true champions.'],
  ['crown', '👑', 'Golden crown', 2500, 'Royalty of the openings.'],
  ['dragon', '🐉', 'Dragon statue', 3000, 'A legendary dragon guards your shelf.'],
  ['diamond', '💎', 'Diamond', 5000, 'The rarest treasure of all.'],
]

/** Titles: refId = key; `name` is the text shown under the player's name. */
const TITLES: Array<[string, string, number, string, string]> = [
  ['rookie', 'Rookie', 0, '🌱', 'Everyone starts somewhere!'],
  ['explorer', 'Opening Explorer', 150, '🧭', 'Always discovering new lines.'],
  ['dragon', 'Sicilian Dragon', 300, '🐉', 'Breathes fire against 1.e4.'],
  ['bigben', 'London Bridge', 300, '🏰', 'Builds the London System brick by brick.'],
  ['gatekeeper', "Queen's Pawn Crusher", 300, '🛡️', 'Nobody gets past your defence.'],
  ['wizard', 'Tactics Wizard', 400, '🧙', 'Sees tricks before they happen.'],
  ['gm', 'Grandmaster in Training', 800, '🎓', 'On the road to the top!'],
]

function buildCatalog(): CatalogItem[] {
  const out: CatalogItem[] = []
  for (const id of BOARD_THEME_IDS) out.push(make('board', id, BOARDS[id]))
  for (const id of PIECE_SET_IDS) out.push(make('pieces', id, PIECES[id]))
  for (const [emoji, name, cost] of AVATARS) {
    out.push(make('avatar', emoji, { name, description: cost === 0 ? 'A free starter avatar.' : `Be the ${name.toLowerCase()}!`, cost, emoji }))
  }
  for (const [key, emoji, name, cost, description] of TROPHIES) out.push(make('trophy', key, { name, description, cost, emoji }))
  for (const id of EFFECT_IDS) out.push(make('effect', id, EFFECTS[id]))
  for (const [key, name, cost, emoji, description] of TITLES) out.push(make('title', key, { name, description, cost, emoji }))
  return out
}

export const CATALOG: CatalogItem[] = buildCatalog()

const BY_ID: Map<string, CatalogItem> = new Map(CATALOG.map((i) => [i.id, i]))

export function itemById(id: string): CatalogItem | undefined {
  return BY_ID.get(id)
}

export function findItem(kind: ItemKind, refId: string): CatalogItem | undefined {
  return BY_ID.get(itemId(kind, refId))
}

export function itemsOfKind(kind: ItemKind): CatalogItem[] {
  return CATALOG.filter((i) => i.kind === kind)
}

/** Ids of every free item (owned by default). */
export const FREE_ITEM_IDS: string[] = CATALOG.filter((i) => i.cost === 0).map((i) => i.id)

/** Default equipped refIds for a new profile (all free). */
export const DEFAULT_EQUIPPED: { board: string; pieces: string; effect: string; title: string } = {
  board: 'green',
  pieces: 'cburnett',
  effect: 'confetti',
  title: 'rookie',
}

/** Text of a title refId (falls back to the key). */
export function titleText(refId: string): string {
  return findItem('title', refId)?.name ?? refId
}

/** Kinds that can be equipped (trophies are shelf decorations, always "on display"). */
export const EQUIPPABLE_KINDS: ItemKind[] = ['board', 'pieces', 'effect', 'title', 'avatar']
