import type { DeckCard } from '../types'
import { binom } from './binom'
import { countOf, handDistribution, type Bucket, type HandDist } from './hypergeom'

export type RequirementOp = 'atLeast' | 'atMost' | 'exactly'

/** One row of the ideal-start condition. Rows are ANDed; cards within a row are
 *  a union, so `atLeast 1` over three search Items means "any one of them". */
export interface Requirement {
  id: string
  label: string
  cardKeys: string[]
  op: RequirementOp
  n: number
}

export interface RequirementOutcome {
  id: string
  label: string
  /** P(this row alone is satisfied | legal hand), on the 8-card look. */
  probability: number | null
}

export interface Analysis {
  deckSize: number
  basicCount: number
  /** P(opening 7 contains no Basic Pokémon, forcing a redraw). */
  mulliganRate: number
  /** Expected redraws before keeping a hand. */
  expectedMulligans: number
  /** P(all rows met | legal kept hand) across the opening 7. */
  openingHand: number | null
  /** P(all rows met | legal kept hand) across the 8-card first look. */
  firstLook: number | null
  perRequirement: RequirementOutcome[]
  /** Set when no probability is defined — an empty deck, or one with no Basics. */
  impossible: boolean
  /**
   * Self-check surface. `legalOpening` and `legalFirstLook` are the two DP runs'
   * independently-derived probabilities of keeping a legal hand; both must equal
   * the closed form `1 - mulliganRate`. Tests assert all three agree, which is a
   * strong check that the bucketing and the designated-card weighting are right.
   */
  diagnostics: { legalOpening: number; legalFirstLook: number; legalClosedForm: number }
}

export const HAND_SIZE = 7
/** The opening 7 plus the turn-1 draw. Both players draw, so this is turn-order independent. */
export const FIRST_LOOK_SIZE = 8
export const PRIZE_COUNT = 6

/** Caps: how high each predicate's count must be tracked to answer its question. */
function capFor(req: Requirement): number {
  // `atLeast` only needs to know whether the threshold was reached; the others
  // must also distinguish "exceeded", hence n + 1.
  return req.op === 'atLeast' ? req.n : req.n + 1
}

/**
 * Partition the deck into buckets of cards that are indistinguishable for this
 * condition. The implicit final predicate is "is a Basic Pokémon", which drives
 * mulligan legality.
 */
export function buildBuckets(cards: DeckCard[], requirements: Requirement[]): Bucket[] {
  const basicBit = 1 << requirements.length
  const keyToBits = new Map<string, number>()

  requirements.forEach((req, index) => {
    for (const key of req.cardKeys) {
      keyToBits.set(key, (keyToBits.get(key) ?? 0) | (1 << index))
    }
  })

  const sizes = new Map<number, number>()
  for (const card of cards) {
    let mask = keyToBits.get(card.key) ?? 0
    // Unresolved cards have no tags, so they are never counted as Basics — we
    // genuinely don't know what they are. The UI flags this.
    if (card.tags.includes('basic')) mask |= basicBit
    sizes.set(mask, (sizes.get(mask) ?? 0) + card.count)
  }

  return [...sizes].map(([mask, size]) => ({ mask, size }))
}

function requirementsMet(
  dist: HandDist,
  state: number,
  requirements: Requirement[],
): boolean {
  for (let i = 0; i < requirements.length; i++) {
    const req = requirements[i]
    const count = countOf(dist, state, i)
    if (req.op === 'atLeast' && count < req.n) return false
    if (req.op === 'atMost' && count > req.n) return false
    if (req.op === 'exactly' && count !== req.n) return false
  }
  return true
}

export function analyze(cards: DeckCard[], requirements: Requirement[]): Analysis {
  const deckSize = cards.reduce((sum, c) => sum + c.count, 0)
  const basicCount = cards
    .filter((c) => c.tags.includes('basic'))
    .reduce((sum, c) => sum + c.count, 0)

  const empty: Analysis = {
    deckSize,
    basicCount,
    mulliganRate: basicCount === 0 && deckSize > 0 ? 1 : 0,
    expectedMulligans: Infinity,
    openingHand: null,
    firstLook: null,
    perRequirement: requirements.map((r) => ({ id: r.id, label: r.label, probability: null })),
    impossible: true,
    diagnostics: { legalOpening: 0, legalFirstLook: 0, legalClosedForm: 0 },
  }
  if (deckSize < FIRST_LOOK_SIZE || basicCount === 0) return empty

  const buckets = buildBuckets(cards, requirements)
  const basicIndex = requirements.length
  const reqCaps = requirements.map(capFor)

  // P(legal hand) has a closed form; computing it directly gives the two DP runs
  // an independent check (asserted in tests) rather than trusting them blindly.
  const legal = 1 - binom(deckSize - basicCount, HAND_SIZE) / binom(deckSize, HAND_SIZE)

  // --- Opening 7: Basic count only needs 0 vs >=1.
  const dist7 = handDistribution(buckets, [...reqCaps, 1], HAND_SIZE, deckSize)
  let legal7 = 0
  let met7 = 0
  for (let state = 0; state < dist7.stateCount; state++) {
    const p = dist7.probs[state]
    if (p === 0 || countOf(dist7, state, basicIndex) < 1) continue
    legal7 += p
    if (requirementsMet(dist7, state, requirements)) met7 += p
  }

  // --- First look of 8. Drawing 7 then 1 is equivalent to drawing an 8-card set
  // and designating one of its 8 cards as the drawn one. Legality depends on the
  // OTHER seven, so it collapses to a weight on the 8-set's Basic count:
  //   0 Basics -> never legal; 1 Basic -> legal unless it was the designated card
  //   (7/8); 2+ Basics -> always legal.
  const dist8 = handDistribution(buckets, [...reqCaps, 2], FIRST_LOOK_SIZE, deckSize)
  const weights = [0, HAND_SIZE / FIRST_LOOK_SIZE, 1]
  let legal8 = 0
  let met8 = 0
  const perRequirementMet = new Array<number>(requirements.length).fill(0)

  for (let state = 0; state < dist8.stateCount; state++) {
    const p = dist8.probs[state]
    if (p === 0) continue
    const weight = weights[countOf(dist8, state, basicIndex)]
    if (weight === 0) continue

    const weighted = p * weight
    legal8 += weighted

    // One pass serves both the combined condition and each row on its own:
    // every row is checked here, and `allMet` is their conjunction.
    let allMet = true
    for (let i = 0; i < requirements.length; i++) {
      const req = requirements[i]
      const count = countOf(dist8, state, i)
      const ok =
        req.op === 'atLeast'
          ? count >= req.n
          : req.op === 'atMost'
            ? count <= req.n
            : count === req.n
      if (ok) perRequirementMet[i] += weighted
      else allMet = false
    }
    if (allMet) met8 += weighted
  }

  return {
    deckSize,
    basicCount,
    mulliganRate: 1 - legal,
    expectedMulligans: legal > 0 ? (1 - legal) / legal : Infinity,
    openingHand: legal7 > 0 ? met7 / legal7 : null,
    firstLook: legal8 > 0 ? met8 / legal8 : null,
    perRequirement: requirements.map((req, i) => ({
      id: req.id,
      label: req.label,
      probability: legal8 > 0 ? perRequirementMet[i] / legal8 : null,
    })),
    impossible: false,
    diagnostics: { legalOpening: legal7, legalFirstLook: legal8, legalClosedForm: legal },
  }
}
