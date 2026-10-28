import type { DeckCard } from '../types'
import { binom } from './binom'
import { countOf, handDistribution, type Bucket, type HandDist } from './hypergeom'

export type RequirementOp = 'atLeast' | 'atMost' | 'exactly'

/** One row of a condition. Cards within a row count together, so `atLeast 1`
 *  over three search Items means "any one of them". */
export interface Requirement {
  id: string
  label: string
  cardKeys: string[]
  op: RequirementOp
  n: number
}

/**
 * One route to an ideal start: every row in it must hold.
 *
 * Several alternatives express the ways a deck can get there — a hand with
 * Cyrano is as good as one with the Meowth ex that fetches it, or the Ultra Ball
 * that fetches the Meowth ex. Any one alternative holding is enough.
 */
export interface Alternative {
  id: string
  label: string
  requirements: Requirement[]
}

/** The whole ideal-start condition: alternatives are ORed, rows within one ANDed. */
export type Condition = Alternative[]

export const allRequirements = (condition: Condition): Requirement[] =>
  condition.flatMap((alternative) => alternative.requirements)

export interface Outcome {
  id: string
  label: string
  /** P(satisfied on its own | legal hand), across the 8-card look. */
  probability: number | null
}

export interface Analysis {
  deckSize: number
  basicCount: number
  /** P(opening 7 contains no Basic Pokémon, forcing a redraw). */
  mulliganRate: number
  /** Expected redraws before keeping a hand. */
  expectedMulligans: number
  /** P(condition met | legal kept hand) across the opening 7. */
  openingHand: number | null
  /** P(condition met | legal kept hand) across the 8-card first look. */
  firstLook: number | null
  /** Each row on its own. */
  perRequirement: Outcome[]
  /** Each alternative on its own — all of its rows, none of the others. */
  perAlternative: Outcome[]
  /** Set when no probability is defined — an empty deck, or one with no Basics. */
  impossible: boolean
  /** Set when the condition has too many rows to evaluate exactly. */
  tooComplex: boolean
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
/** The DP enumerates every saturated count vector, so the state space must stay
 *  bounded. Far above any hand-built condition; a guard, not a limit in practice. */
const MAX_STATES = 2_000_000

/** Caps: how high each predicate's count must be tracked to answer its question. */
function capFor(req: Requirement): number {
  // `atLeast` only needs to know whether the threshold was reached; the others
  // must also distinguish "exceeded", hence n + 1.
  return req.op === 'atLeast' ? req.n : req.n + 1
}

function satisfied(count: number, req: Requirement): boolean {
  if (req.op === 'atLeast') return count >= req.n
  if (req.op === 'atMost') return count <= req.n
  return count === req.n
}

/**
 * Partition the deck into buckets of cards indistinguishable for this condition.
 * The implicit final predicate is "is a Basic Pokémon", which drives mulligan
 * legality.
 */
export function buildBuckets(cards: DeckCard[], rows: Requirement[]): Bucket[] {
  const basicBit = 1 << rows.length
  const keyToBits = new Map<string, number>()

  rows.forEach((row, index) => {
    for (const key of row.cardKeys) {
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

export function analyze(cards: DeckCard[], condition: Condition): Analysis {
  const rows = allRequirements(condition)
  const rowIndex = new Map(rows.map((row, i) => [row.id, i]))

  const deckSize = cards.reduce((sum, c) => sum + c.count, 0)
  const basicCount = cards
    .filter((c) => c.tags.includes('basic'))
    .reduce((sum, c) => sum + c.count, 0)

  const blank = (tooComplex: boolean): Analysis => ({
    deckSize,
    basicCount,
    mulliganRate: basicCount === 0 && deckSize > 0 ? 1 : 0,
    expectedMulligans: Infinity,
    openingHand: null,
    firstLook: null,
    perRequirement: rows.map((r) => ({ id: r.id, label: r.label, probability: null })),
    perAlternative: condition.map((a) => ({ id: a.id, label: a.label, probability: null })),
    impossible: true,
    tooComplex,
    diagnostics: { legalOpening: 0, legalFirstLook: 0, legalClosedForm: 0 },
  })

  if (deckSize < FIRST_LOOK_SIZE || basicCount === 0) return blank(false)

  const reqCaps = rows.map(capFor)
  const stateCount = reqCaps.reduce((n, cap) => n * (cap + 1), 3)
  if (stateCount > MAX_STATES) return blank(true)

  const buckets = buildBuckets(cards, rows)
  const basicIndex = rows.length

  // P(legal hand) has a closed form; computing it directly gives the two DP runs
  // an independent check (asserted in tests) rather than trusting them blindly.
  const legal = 1 - binom(deckSize - basicCount, HAND_SIZE) / binom(deckSize, HAND_SIZE)

  /** Any one alternative holding is enough — this is where OR lives, and the DP
   *  does not care: it evaluates whatever predicate it is handed per state. */
  const conditionMet = (dist: HandDist, state: number): boolean =>
    condition.length === 0 ||
    condition.some((alternative) =>
      alternative.requirements.every((row) =>
        satisfied(countOf(dist, state, rowIndex.get(row.id)!), row),
      ),
    )

  // --- Opening 7: the Basic count only needs 0 vs >=1.
  const dist7 = handDistribution(buckets, [...reqCaps, 1], HAND_SIZE, deckSize)
  let legal7 = 0
  let met7 = 0
  for (let state = 0; state < dist7.stateCount; state++) {
    const p = dist7.probs[state]
    if (p === 0 || countOf(dist7, state, basicIndex) < 1) continue
    legal7 += p
    if (conditionMet(dist7, state)) met7 += p
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
  const rowMet = new Array<number>(rows.length).fill(0)
  const altMet = new Array<number>(condition.length).fill(0)

  for (let state = 0; state < dist8.stateCount; state++) {
    const p = dist8.probs[state]
    if (p === 0) continue
    const weight = weights[countOf(dist8, state, basicIndex)]
    if (weight === 0) continue

    const weighted = p * weight
    legal8 += weighted

    // One pass serves the whole condition, each alternative, and each row.
    const rowOk = rows.map((row, i) => satisfied(countOf(dist8, state, i), row))
    rows.forEach((_, i) => {
      if (rowOk[i]) rowMet[i] += weighted
    })

    let any = condition.length === 0
    condition.forEach((alternative, a) => {
      const ok = alternative.requirements.every((row) => rowOk[rowIndex.get(row.id)!])
      if (ok) {
        altMet[a] += weighted
        any = true
      }
    })
    if (any) met8 += weighted
  }

  const share = (value: number) => (legal8 > 0 ? value / legal8 : null)

  return {
    deckSize,
    basicCount,
    mulliganRate: 1 - legal,
    expectedMulligans: legal > 0 ? (1 - legal) / legal : Infinity,
    openingHand: legal7 > 0 ? met7 / legal7 : null,
    firstLook: share(met8),
    perRequirement: rows.map((row, i) => ({
      id: row.id,
      label: row.label,
      probability: share(rowMet[i]),
    })),
    perAlternative: condition.map((alternative, a) => ({
      id: alternative.id,
      label: alternative.label,
      probability: share(altMet[a]),
    })),
    impossible: false,
    tooComplex: false,
    diagnostics: { legalOpening: legal7, legalFirstLook: legal8, legalClosedForm: legal },
  }
}
