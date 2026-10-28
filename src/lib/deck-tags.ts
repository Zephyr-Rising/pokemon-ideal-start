import type { Deck, DeckCard } from './types'

export const hasTag = (card: DeckCard, tag: string): boolean => card.tags.includes(tag)

export interface DeckSummary {
  total: number
  pokemon: number
  trainer: number
  energy: number
  basics: number
  /** Copies whose card isn't in the database, so they have no category. */
  unknown: number
}

const TRAINER_TAGS = ['item', 'supporter', 'tool', 'stadium']

export function summarize(deck: Deck): DeckSummary {
  const summary: DeckSummary = {
    total: deck.totalCards,
    pokemon: 0,
    trainer: 0,
    energy: 0,
    basics: 0,
    unknown: 0,
  }

  for (const card of deck.cards) {
    if (hasTag(card, 'pokemon')) summary.pokemon += card.count
    else if (hasTag(card, 'energy')) summary.energy += card.count
    else if (TRAINER_TAGS.some((t) => hasTag(card, t))) summary.trainer += card.count
    else summary.unknown += card.count

    if (hasTag(card, 'basic')) summary.basics += card.count
  }

  return summary
}

/** Short human label for a card's role, for the deck list display. */
export function categoryOf(card: DeckCard): string {
  if (!card.card) return 'Unknown'
  if (hasTag(card, 'pokemon')) {
    if (hasTag(card, 'basic')) return 'Basic'
    if (hasTag(card, 'stage1')) return 'Stage 1'
    if (hasTag(card, 'stage2')) return 'Stage 2'
    return 'Pokémon'
  }
  if (hasTag(card, 'supporter')) return 'Supporter'
  if (hasTag(card, 'item')) return 'Item'
  if (hasTag(card, 'tool')) return 'Tool'
  if (hasTag(card, 'stadium')) return 'Stadium'
  if (hasTag(card, 'energy')) return 'Energy'
  return card.card.kind || 'Other'
}
