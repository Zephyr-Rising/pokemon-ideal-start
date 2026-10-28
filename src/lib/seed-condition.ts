import { hasTag } from './deck-tags'
import { norm } from './normalize'
import type { Condition } from './prob/analyze'
import type { DeckCard } from './types'

const SEARCH_TAGS = ['poke-search', 'energy-search', 'search-to-hand']

/** Does some card in this deck evolve from this one? */
function evolvesInDeck(card: DeckCard, cards: DeckCard[]): boolean {
  if (!card.card) return false
  const name = norm(card.card.name)
  return cards.some((other) => other.card && other.card.prev !== '' && norm(other.card.prev) === name)
}

/**
 * The Basic Pokémon the deck most wants to open with.
 *
 * You cannot play a Stage 1 or Stage 2 on turn one, so what matters in the
 * opening hand is the Basic at the bottom of the line, not the payoff card.
 * Which line is "the main one" is inferred from **copy count**: the Basics a
 * list commits the most slots to are the ones it intends to start with. That
 * holds whether or not the payoff is a Pokémon ex — Abra for Alakazam and
 * Slowpoke for Slowking matter exactly as much as Dreepy does for Dragapult ex.
 *
 * Candidates are Basics that either attack themselves or evolve into something
 * in the deck, which keeps pure utility Basics out of the row.
 */
function mainStarters(cards: DeckCard[]): string[] {
  const candidates = cards.filter(
    (card) => hasTag(card, 'basic') && (hasTag(card, 'attacker') || evolvesInDeck(card, cards)),
  )
  if (candidates.length === 0) return []

  const most = Math.max(...candidates.map((card) => card.count))
  return candidates.filter((card) => card.count === most).map((card) => card.key)
}

/**
 * Propose a starting ideal-start condition from the decklist's role tags.
 *
 * This is a suggestion, not a claim about the deck's real game plan — the UI
 * labels it as such and every row is editable. Rows whose group would be empty
 * are dropped, so a deck with no draw Supporter simply doesn't get that row.
 *
 * Deliberately omitted: a bare "at least 1 Basic Pokémon" row. Post-mulligan
 * that is true by definition (it IS the mulligan rule), so it would always read
 * 100% and teach nothing.
 */
export function seedCondition(cards: DeckCard[]): Condition {
  const keysOf = (predicate: (card: DeckCard) => boolean): string[] =>
    cards.filter(predicate).map((c) => c.key)

  const starters = mainStarters(cards)
  const pokeSearch = keysOf((c) => hasTag(c, 'poke-search'))
  const drawSupporter = keysOf(
    (c) => hasTag(c, 'supporter') && (hasTag(c, 'draw') || SEARCH_TAGS.some((t) => hasTag(c, t))),
  )
  const energy = keysOf((c) => hasTag(c, 'energy'))

  const candidates: { label: string; cardKeys: string[] }[] = [
    { label: 'Main starter', cardKeys: starters },
    { label: 'Pokémon search', cardKeys: pokeSearch },
    { label: 'Draw or search Supporter', cardKeys: drawSupporter },
    { label: 'Energy', cardKeys: energy },
  ]

  const rows = candidates
    .filter((c) => c.cardKeys.length > 0)
    .map((c, index) => ({
      id: `seed-${index}`,
      label: c.label,
      cardKeys: c.cardKeys,
      op: 'atLeast' as const,
      n: 1,
    }))

  // A single alternative: one route, every row required. Add more in the UI to
  // describe other ways the deck reaches the same start.
  return rows.length > 0 ? [{ id: 'seed-a', label: 'Main route', requirements: rows }] : []
}
