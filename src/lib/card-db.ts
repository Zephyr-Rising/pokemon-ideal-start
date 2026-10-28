import aliasesJson from '../data/curated-aliases.json'
import cardsJson from '../data/cards.json'
import { norm } from './normalize'
import type { CardDb, CardRecord } from './types'

// Cast through `unknown`: the generated JSON is large, and letting TypeScript
// infer its full literal type would cost more than it's worth. The generator
// and `CardDb` are the contract; tests assert the shape holds.
const db = cardsJson as unknown as CardDb

const byId = new Map<number, CardRecord>()
const byPrinting = new Map<string, CardRecord>()
const byNormName = new Map<string, CardRecord[]>()

const printingKey = (set: string, num: string) => `${set}|${num}`

for (const card of db.cards) {
  byId.set(card.id, card)
  // 8 cards carry no expansion/number; they'd all collide on the same key, so
  // they are reachable by name only.
  if (card.set !== '' && card.num !== '') {
    byPrinting.set(printingKey(card.set, card.num), card)
  }
  const key = norm(card.name)
  const list = byNormName.get(key)
  if (list) list.push(card)
  else byNormName.set(key, [card])
}

// Decklists print basic Energy under sets this dataset doesn't carry
// (e.g. `6 Grass Energy MEE 9`), so they are matched by colour name instead.
// Keys are built here with our own norm(), so there is no normalisation logic
// duplicated in the generator.
const basicEnergyByName = new Map<string, CardRecord>()
for (const energy of db.basicEnergy) {
  const card = byId.get(energy.id)
  if (card) basicEnergyByName.set(norm(`${energy.colour} Energy`), card)
}

// Curated aliases for naming variants the dataset lacks. Two real decklists
// carried `Telepathic Psychic Energy POR 88`, while the data holds the same card
// as `Telepath Psychic Energy POR 87` — and POR 88 as an unrelated card. Without
// an alias the choice is between dropping the card's metadata and silently
// substituting the wrong card; neither is acceptable.
const aliasToCard = new Map<string, CardRecord>()
for (const [name, id] of Object.entries(aliasesJson as Record<string, unknown>)) {
  if (typeof id !== 'number') continue // skips the `_readme` entry
  const card = byId.get(id)
  if (card) aliasToCard.set(norm(name), card)
}

export function findByAlias(name: string): CardRecord | undefined {
  return aliasToCard.get(norm(name))
}

export function findByPrinting(set: string, num: string): CardRecord | undefined {
  return byPrinting.get(printingKey(set, num))
}

export function findBasicEnergyByName(name: string): CardRecord | undefined {
  return basicEnergyByName.get(norm(name))
}

/** Lowest card ID wins, so resolution is deterministic across reprints. */
export function findByName(name: string): CardRecord | undefined {
  const matches = byNormName.get(norm(name))
  if (!matches || matches.length === 0) return undefined
  return matches.reduce((best, c) => (c.id < best.id ? c : best))
}

export function findById(id: number): CardRecord | undefined {
  return byId.get(id)
}

export const cardDbMeta = {
  sourceSha256: db.sourceSha256,
  sourceRows: db.sourceRows,
  cardCount: db.cardCount,
} as const
