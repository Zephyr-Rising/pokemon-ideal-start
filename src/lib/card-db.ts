import cardsJson from '../data/cards.json'
import { norm } from './normalize'
import type { CardDb, CardRecord } from './types'

// Cast through `unknown`: the generated JSON is large, and letting TypeScript
// infer its full literal type would cost more than it's worth. The generator
// and `CardDb` are the contract; tests assert the shape holds.
const db = cardsJson as unknown as CardDb

// `index` is the card's identity within a build. It is assigned here rather than
// stored, so the shipped JSON carries no redundant field.
const cards: CardRecord[] = db.cards.map((card, index) => ({ ...card, index }))

const byNormName = new Map<string, CardRecord[]>()
for (const card of cards) {
  const key = norm(card.name)
  const list = byNormName.get(key)
  if (list) list.push(card)
  else byNormName.set(key, [card])
}

// A printing key can name more than one card: both 30th Celebration and 30th
// Classic Collection report the abbreviation "30C", so their numbering overlaps.
// Candidates are kept and the caller disambiguates by name.
const byPrinting = new Map<string, CardRecord[]>()
const printingKey = (set: string, num: string) =>
  `${set.toUpperCase()}|${num.replace(/^0+(?=\d)/, '')}`

for (const printing of db.printings) {
  const card = cards[printing.card]
  if (!card) continue
  const key = printingKey(printing.set, printing.num)
  const list = byPrinting.get(key)
  if (list) {
    if (!list.includes(card)) list.push(card)
  } else byPrinting.set(key, [card])
}

// Decklists print basic Energy under sets the card data may not carry
// (`6 Grass Energy MEE 9`), so they are also matched by colour name. Keys are
// built with our own norm(), so no normalisation logic is duplicated in the
// generator.
const basicEnergyByName = new Map<string, CardRecord>()
const basicEnergyByType = new Map<string, CardRecord>()
for (const energy of db.basicEnergy) {
  const card = cards[energy.index]
  if (!card) continue
  basicEnergyByName.set(norm(`${energy.colour} Energy`), card)
  basicEnergyByType.set(energy.type, card)
}

const nonStandard = new Set(db.nonStandardNames.map(norm))

/** Every card printed at this set and number — usually one. */
export function findByPrinting(set: string, num: string): CardRecord[] {
  return byPrinting.get(printingKey(set, num)) ?? []
}

export function findBasicEnergyByName(name: string): CardRecord | undefined {
  return basicEnergyByName.get(norm(name))
}

/** The Basic Energy of a type symbol such as `{G}`, for drawing a goal's Energy. */
export function findBasicEnergyByType(type: string): CardRecord | undefined {
  return basicEnergyByType.get(type)
}

/** Lowest index wins, so resolution is deterministic across reprints. */
export function findByName(name: string): CardRecord | undefined {
  const matches = byNormName.get(norm(name))
  if (!matches || matches.length === 0) return undefined
  return matches.reduce((best, c) => (c.index < best.index ? c : best))
}

/** Is this a real card that was excluded for not being Standard legal? */
export function isNonStandard(name: string): boolean {
  return nonStandard.has(norm(name))
}

export function findByIndex(index: number): CardRecord | undefined {
  return cards[index]
}

export const cardDbMeta = {
  cardCount: db.cardCount,
  printingCount: db.printingCount,
  sourceSha256: db.sourceSha256,
} as const
