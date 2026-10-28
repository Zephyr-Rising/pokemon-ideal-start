import { HAND_SIZE, PRIZE_COUNT } from './analyze'
import { binom } from './binom'

export interface PrizeQuery {
  deckSize: number
  /** Total copies of the card (or group) in question. */
  groupSize: number
  /** How many of those copies are Basic Pokémon. */
  groupBasics: number
  /** Total Basic Pokémon in the deck. */
  deckBasics: number
}

/**
 * P(every copy sits in the prize zone | the opening hand was legal).
 *
 * Prizes are dealt from the 53 cards left after the opening 7, so they never
 * affect what's in hand — but a card buried in prizes cannot be searched for,
 * which is the real consistency trap for 1-ofs and 2-ofs.
 *
 * Counting ordered (hand, prizes) pairs: if all `c` copies are prized then none
 * are in hand, so the hand is a 7-subset of the other `deckSize - c` cards and
 * must still contain a Basic. The prizes then take all `c` copies plus
 * `PRIZE_COUNT - c` of the remaining cards. Dividing by the same count over all
 * legal hands gives:
 *
 *   [ C(D-c, 7) - C(D-c-Bnt, 7) ] * C(D-7-c, 6-c)
 *   ---------------------------------------------
 *        [ C(D, 7) - C(D-B, 7) ] * C(D-7, 6)
 *
 * where Bnt is the number of Basics outside the group.
 *
 * Returns null when the probability is undefined (no legal hand exists).
 */
export function allCopiesPrized({
  deckSize,
  groupSize,
  groupBasics,
  deckBasics,
}: PrizeQuery): number | null {
  if (groupSize <= 0 || groupSize > PRIZE_COUNT) return groupSize > PRIZE_COUNT ? 0 : null
  if (deckSize < HAND_SIZE + PRIZE_COUNT) return null

  const basicsOutside = deckBasics - groupBasics
  const legalHands = binom(deckSize, HAND_SIZE) - binom(deckSize - deckBasics, HAND_SIZE)
  if (legalHands <= 0) return null

  const handsAvoidingGroup =
    binom(deckSize - groupSize, HAND_SIZE) -
    binom(deckSize - groupSize - basicsOutside, HAND_SIZE)

  const prizeWays = binom(deckSize - HAND_SIZE - groupSize, PRIZE_COUNT - groupSize)
  const allPrizeWays = binom(deckSize - HAND_SIZE, PRIZE_COUNT)

  return (handsAvoidingGroup * prizeWays) / (legalHands * allPrizeWays)
}

/**
 * Below this a row renders as "0.00%" and tells the reader nothing — a six-copy
 * group being entirely prized is about one game in a hundred million. Such rows
 * are dropped rather than listed as zero.
 */
const DISPLAY_FLOOR = 0.00005

export interface PrizeRiskRow {
  key: string
  label: string
  /** Copies of the card, or total copies across the requirement row. */
  count: number
  probability: number
}

/**
 * Prize risk for every card and requirement row that could realistically be
 * buried: anything with more copies than there are prizes is impossible to lose
 * entirely, so it is omitted rather than listed as 0%.
 */
export function prizeRiskRows(
  cards: { key: string; label: string; count: number; tags: string[] }[],
  rows: { id: string; label: string; cardKeys: string[] }[],
): { cards: PrizeRiskRow[]; groups: PrizeRiskRow[] } {
  const deckSize = cards.reduce((sum, c) => sum + c.count, 0)
  const deckBasics = cards
    .filter((c) => c.tags.includes('basic'))
    .reduce((sum, c) => sum + c.count, 0)

  const risk = (groupSize: number, groupBasics: number): number | null =>
    allCopiesPrized({ deckSize, groupSize, groupBasics, deckBasics })

  const cardRows: PrizeRiskRow[] = []
  for (const card of cards) {
    if (card.count > PRIZE_COUNT) continue
    const p = risk(card.count, card.tags.includes('basic') ? card.count : 0)
    if (p === null || p < DISPLAY_FLOOR) continue
    cardRows.push({ key: card.key, label: card.label, count: card.count, probability: p })
  }

  const byKey = new Map(cards.map((c) => [c.key, c]))
  const groupRows: PrizeRiskRow[] = []
  for (const requirement of rows) {
    const members = requirement.cardKeys
      .map((k) => byKey.get(k))
      .filter((c): c is (typeof cards)[number] => c !== undefined)
    const groupSize = members.reduce((sum, c) => sum + c.count, 0)
    if (groupSize === 0 || groupSize > PRIZE_COUNT) continue
    const groupBasics = members
      .filter((c) => c.tags.includes('basic'))
      .reduce((sum, c) => sum + c.count, 0)
    const p = risk(groupSize, groupBasics)
    if (p === null || p < DISPLAY_FLOOR) continue
    groupRows.push({
      key: requirement.id,
      label: requirement.label,
      count: groupSize,
      probability: p,
    })
  }

  const byRisk = (a: PrizeRiskRow, b: PrizeRiskRow) => b.probability - a.probability
  return { cards: cardRows.sort(byRisk), groups: groupRows.sort(byRisk) }
}
