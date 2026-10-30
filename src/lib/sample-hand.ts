import {
  allOptions,
  allRequirements,
  FIRST_LOOK_SIZE,
  HAND_SIZE,
  type Condition,
  type Requirement,
} from './prob/analyze'
import type { CardRecord, DeckCard } from './types'

/** Whether to look for a hand that meets the condition, or one that misses it. */
export type SampleMode = 'meets' | 'misses'

export interface SampledHand {
  /** The seven cards kept after any mulligans. */
  opening: DeckCard[]
  /** The card drawn at the start of the turn, or null if the deck is too small. */
  drawn: DeckCard | null
  /** How many legal hands were drawn before one qualified. */
  attempts: number
  /** False when nothing qualifying turned up within the attempt budget. */
  found: boolean
  mode: SampleMode
  /** Which rows this hand satisfies, by row id — drives the miss explanation. */
  rowsMet: Record<string, boolean>
  /** Which routes this hand satisfies, by alternative id. */
  routesMet: Record<string, boolean>
}

export interface SampleOptions {
  mode?: SampleMode
  rng?: () => number
  maxAttempts?: number
}

/**
 * Draw a random opening hand that either meets the condition or misses it.
 *
 * Uses rejection sampling over the real procedure — shuffle, keep redrawing
 * while the opening seven hold no Basic Pokémon, then draw for turn — and
 * returns the first hand that qualifies. Because both the mulligan rule and the
 * condition are applied as rejections on an otherwise uniform draw, the result
 * is a genuinely uniform sample from the same conditional distribution the
 * headline probability describes. It is an example of the real thing, not a
 * hand-picked illustration — which is exactly what makes a *miss* worth
 * showing: it is a typical failure, not a contrived worst case.
 *
 * The attempt budget bounds the work when one side is very unlikely; the caller
 * is told when nothing was found rather than being shown a near-miss.
 */
export function sampleHand(
  cards: DeckCard[],
  condition: Condition,
  { mode = 'meets', rng = Math.random, maxAttempts = 20_000 }: SampleOptions = {},
): SampledHand {
  // One entry per physical copy.
  const deck: DeckCard[] = []
  for (const card of cards) {
    for (let copy = 0; copy < card.count; copy++) deck.push(card)
  }

  const blank: SampledHand = {
    opening: [],
    drawn: null,
    attempts: 0,
    found: false,
    mode,
    rowsMet: {},
    routesMet: {},
  }
  if (deck.length < HAND_SIZE) return blank

  const rows = allRequirements(condition)
  const inGroup = new Map(allOptions(condition).map((o) => [o.id, new Set(o.cardKeys)]))
  const isBasic = (card: DeckCard) => card.tags.includes('basic')

  // A requirement holds when any one of its options does.
  const rowHolds = (hand: DeckCard[], row: Requirement): boolean =>
    row.options.some((option) => {
      const group = inGroup.get(option.id)!
      let count = 0
      for (const card of hand) if (group.has(card.key)) count++
      if (option.op === 'atLeast') return count >= option.n
      if (option.op === 'atMost') return count <= option.n
      return count === option.n
    })

  const look = Math.min(FIRST_LOOK_SIZE, deck.length)
  let attempts = 0

  while (attempts < maxAttempts) {
    // Partial Fisher–Yates: only the first `look` positions need shuffling.
    for (let i = 0; i < look; i++) {
      const j = i + Math.floor(rng() * (deck.length - i))
      const swap = deck[i]
      deck[i] = deck[j]
      deck[j] = swap
    }

    const opening = deck.slice(0, HAND_SIZE)
    // No Basic Pokémon means this hand is reshuffled at the table — it is not a
    // failed attempt, it simply never happened.
    if (!opening.some(isBasic)) continue

    attempts++
    const drawn = look > HAND_SIZE ? deck[HAND_SIZE] : null
    const hand = drawn ? [...opening, drawn] : opening

    const rowsMet: Record<string, boolean> = {}
    for (const row of rows) rowsMet[row.id] = rowHolds(hand, row)

    const routesMet: Record<string, boolean> = {}
    for (const alternative of condition) {
      routesMet[alternative.id] = alternative.requirements.every((row) => rowsMet[row.id])
    }

    // Any one route is enough; an empty condition is met by definition.
    const met = condition.length === 0 || Object.values(routesMet).some(Boolean)
    if (met === (mode === 'meets')) {
      return { opening, drawn, attempts, found: true, mode, rowsMet, routesMet }
    }
  }

  return { ...blank, attempts }
}

/** TCGdex serves several sizes; `low` is ~15 KB and plenty for a hand view. */
export function cardImageUrl(card: DeckCard, quality: 'low' | 'high' = 'low'): string | null {
  return card.card ? recordImageUrl(card.card, quality) : null
}

export function recordImageUrl(record: CardRecord, quality: 'low' | 'high' = 'low'): string | null {
  return record.image ? `${record.image}/${quality}.webp` : null
}
