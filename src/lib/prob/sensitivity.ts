import type { DeckCard } from '../types'
import { allOptions, analyze, type Condition } from './analyze'

export interface SensitivityRow {
  key: string
  label: string
  count: number
  /** Change in the 8-card probability from cutting one copy for a neutral card. */
  minusOne: number | null
  /** Change from adding one copy in place of a neutral card. */
  plusOne: number | null
  /** Why `plusOne` is unavailable, when it is. */
  plusOneBlocked?: string
}

/** A card that contributes to nothing: in no requirement group and not a Basic. */
const NEUTRAL_KEY = '__neutral_filler'

function neutralCard(count: number): DeckCard {
  return {
    key: NEUTRAL_KEY,
    label: 'Neutral card',
    resolvedName: null,
    count,
    card: null,
    printings: [],
    tags: [],
  }
}

/** Deck-legal maximum copies of a card. */
function copyLimit(card: DeckCard): { limit: number; reason: string } {
  if (card.tags.includes('basic-energy')) return { limit: Infinity, reason: '' }
  if (card.tags.includes('ace-spec')) {
    return { limit: 1, reason: 'ACE SPEC cards are limited to 1 per deck' }
  }
  return { limit: 4, reason: 'limited to 4 copies per deck' }
}

function withCount(cards: DeckCard[], key: string, delta: number): DeckCard[] {
  return cards
    .map((c) => (c.key === key ? { ...c, count: c.count + delta } : c))
    .filter((c) => c.count > 0)
}

/**
 * The marginal value of every card count, as a change in the 8-card probability.
 *
 * Both directions hold the deck at 60 by trading against a *neutral* card — one
 * in no requirement group and not a Basic Pokémon. That makes each delta the
 * answer to a real deckbuilding question ("what does cutting this copy cost
 * me?") rather than a comparison between decks of different sizes. Cards in
 * bucket-mask zero are interchangeable by construction, so it doesn't matter
 * which neutral card is traded.
 *
 * Changing a count also moves the Basic count and therefore the mulligan rate;
 * that is captured automatically, because Basic is one of the tracked predicates.
 */
export function sensitivity(cards: DeckCard[], condition: Condition): SensitivityRow[] {
  const baseline = analyze(cards, condition)
  if (baseline.firstLook === null) return []

  const grouped = new Set(allOptions(condition).flatMap((o) => o.cardKeys))
  // Real cards that contribute to nothing — the source of an added copy.
  const neutralDonor = cards.find(
    (c) => !grouped.has(c.key) && !c.tags.includes('basic') && c.count > 0,
  )

  const rows: SensitivityRow[] = []

  for (const card of cards) {
    // A card outside every group that isn't a Basic cannot move the number, so
    // computing its delta is wasted work — and reporting it as a row is noise.
    const isNeutral = !grouped.has(card.key) && !card.tags.includes('basic')
    if (isNeutral) continue

    // Cut one copy, backfilling the slot with a neutral card.
    const cutDeck = [...withCount(cards, card.key, -1), neutralCard(1)]
    const cut = analyze(cutDeck, condition)
    const minusOne = cut.firstLook === null ? null : cut.firstLook - baseline.firstLook

    // Add one copy, taking the slot from a neutral card.
    let plusOne: number | null = null
    let plusOneBlocked: string | undefined
    const { limit, reason } = copyLimit(card)

    if (card.count + 1 > limit) {
      plusOneBlocked = `Already at the maximum — ${reason}`
    } else if (!neutralDonor) {
      plusOneBlocked = 'No neutral card left to cut for it'
    } else {
      const addDeck = withCount(
        withCount(cards, card.key, 1),
        neutralDonor.key,
        -1,
      )
      const added = analyze(addDeck, condition)
      plusOne = added.firstLook === null ? null : added.firstLook - baseline.firstLook
    }

    rows.push({
      key: card.key,
      label: card.label,
      count: card.count,
      minusOne,
      plusOne,
      ...(plusOneBlocked ? { plusOneBlocked } : {}),
    })
  }

  const impact = (r: SensitivityRow) =>
    Math.max(Math.abs(r.minusOne ?? 0), Math.abs(r.plusOne ?? 0))
  return rows.sort((a, b) => impact(b) - impact(a))
}
