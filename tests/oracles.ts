/**
 * Independent oracles for the probability engine.
 *
 * These deliberately share no code with `src/lib/prob`: the DP is checked against
 * exhaustive subset enumeration, a textbook closed form, and a simulation of the
 * literal shuffle-draw-mulligan procedure. They live under tests/ so the Monte
 * Carlo path cannot reach the shipped bundle — the app's numbers are always exact.
 */
import type { Condition, Requirement } from '../src/lib/prob/analyze'
import type { DeckCard } from '../src/lib/types'

/** One bitmask per *physical* card — expanded per copy, not bucketed. */
export function expandMasks(cards: DeckCard[], requirements: Requirement[]): number[] {
  const basicBit = 1 << requirements.length
  const masks: number[] = []
  for (const card of cards) {
    let mask = 0
    requirements.forEach((req, i) => {
      if (req.cardKeys.includes(card.key)) mask |= 1 << i
    })
    if (card.tags.includes('basic')) mask |= basicBit
    for (let copy = 0; copy < card.count; copy++) masks.push(mask)
  }
  return masks
}

function met(counts: number[], requirements: Requirement[]): boolean {
  return requirements.every((req, i) => {
    const c = counts[i]
    if (req.op === 'atLeast') return c >= req.n
    if (req.op === 'atMost') return c <= req.n
    return c === req.n
  })
}

function countsOf(hand: number[], requirementCount: number): { counts: number[]; basics: number } {
  const counts = new Array<number>(requirementCount).fill(0)
  let basics = 0
  const basicBit = 1 << requirementCount
  for (const mask of hand) {
    for (let i = 0; i < requirementCount; i++) if (mask & (1 << i)) counts[i]++
    if (mask & basicBit) basics++
  }
  return { counts, basics }
}

/** Every k-subset of [0, n), by index. */
function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i)
  if (k > n) return
  for (;;) {
    yield idx
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

/**
 * Exhaustive enumeration of the opening hand:
 * P(all requirements met | hand holds at least one Basic).
 */
export function bruteForceOpening(
  masks: number[],
  requirements: Requirement[],
  handSize: number,
): number | null {
  let legal = 0
  let good = 0
  for (const combo of combinations(masks.length, handSize)) {
    const { counts, basics } = countsOf(
      combo.map((i) => masks[i]),
      requirements.length,
    )
    if (basics === 0) continue
    legal++
    if (met(counts, requirements)) good++
  }
  return legal === 0 ? null : good / legal
}

/**
 * Exhaustive enumeration of the 8-card first look: every (opening 7, drawn card)
 * pair, keeping only those whose opening 7 was legal. This checks the DP's
 * designated-card weighting without using it.
 */
export function bruteForceFirstLook(
  masks: number[],
  requirements: Requirement[],
  handSize: number,
): number | null {
  let legal = 0
  let good = 0
  for (const combo of combinations(masks.length, handSize)) {
    const inHand = new Set(combo)
    const { counts, basics } = countsOf(
      combo.map((i) => masks[i]),
      requirements.length,
    )
    if (basics === 0) continue

    for (let drawn = 0; drawn < masks.length; drawn++) {
      if (inHand.has(drawn)) continue
      legal++
      const withDraw = counts.slice()
      for (let i = 0; i < requirements.length; i++) {
        if (masks[drawn] & (1 << i)) withDraw[i]++
      }
      if (met(withDraw, requirements)) good++
    }
  }
  return legal === 0 ? null : good / legal
}

/** Closed form: P(at least k successes in a handSize hand). */
export function hypergeomAtLeast(
  deckSize: number,
  successes: number,
  handSize: number,
  k: number,
): number {
  const c = (n: number, r: number): number => {
    if (r < 0 || r > n) return 0
    let out = 1
    for (let i = 0; i < Math.min(r, n - r); i++) out = (out * (n - i)) / (i + 1)
    return Math.round(out)
  }
  let p = 0
  for (let i = k; i <= Math.min(successes, handSize); i++) {
    p += (c(successes, i) * c(deckSize - successes, handSize - i)) / c(deckSize, handSize)
  }
  return p
}

/** Deterministic PRNG, so simulation-based tests never flake. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SimOptions {
  trials: number
  seed?: number
  /** 7 for the opening hand, 8 to include the turn-1 draw. */
  look: 7 | 8
}

/**
 * Simulates the literal procedure: shuffle, draw 7, redraw while the hand holds
 * no Basic, then (for look = 8) draw one more. No conditioning shortcuts.
 */
export function simulate(
  masks: number[],
  requirements: Requirement[],
  { trials, seed = 1, look }: SimOptions,
): number {
  const rng = mulberry32(seed)
  const deck = masks.slice()
  const basicBit = 1 << requirements.length
  let good = 0

  for (let trial = 0; trial < trials; trial++) {
    let drawn: number[]
    // Mulligan loop: a fresh shuffle each time, exactly as at the table.
    for (;;) {
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
      drawn = deck.slice(0, 7)
      if (drawn.some((m) => m & basicBit)) break
    }
    if (look === 8) drawn.push(deck[7])

    const { counts } = countsOf(drawn, requirements.length)
    if (met(counts, requirements)) good++
  }

  return good / trials
}

/**
 * Simulates dealing a hand and prize zone: shuffle, draw 7, redraw while the
 * hand holds no Basic, then deal 6 prizes. Returns the share of trials in which
 * every target copy ended up prized.
 */
export function simulatePrized(
  cards: { basic: boolean; target: boolean }[],
  { trials, seed = 1 }: { trials: number; seed?: number },
): number {
  const rng = mulberry32(seed)
  const deck = cards.slice()
  const targetTotal = deck.filter((c) => c.target).length
  let hits = 0

  for (let trial = 0; trial < trials; trial++) {
    let hand: typeof deck
    for (;;) {
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
      hand = deck.slice(0, 7)
      if (hand.some((c) => c.basic)) break
    }
    const prizes = deck.slice(7, 13)
    if (prizes.filter((c) => c.target).length === targetTotal) hits++
  }

  return hits / trials
}

/**
 * Exhaustive enumeration for a full condition: alternatives are ORed and the
 * rows inside one are ANDed. Masks must come from expandMasks() over
 * allRequirements(condition), so row i is bit i.
 */
export function bruteForceConditionFirstLook(
  masks: number[],
  condition: Condition,
  rows: Requirement[],
  handSize: number,
): number | null {
  const indexOf = new Map(rows.map((row, i) => [row.id, i]))
  const holds = (counts: number[], row: Requirement): boolean => {
    const c = counts[indexOf.get(row.id)!]
    if (row.op === 'atLeast') return c >= row.n
    if (row.op === 'atMost') return c <= row.n
    return c === row.n
  }

  let legal = 0
  let good = 0
  for (const combo of combinations(masks.length, handSize)) {
    const inHand = new Set(combo)
    const { counts, basics } = countsOf(
      combo.map((i) => masks[i]),
      rows.length,
    )
    if (basics === 0) continue

    for (let drawn = 0; drawn < masks.length; drawn++) {
      if (inHand.has(drawn)) continue
      legal++
      const withDraw = counts.slice()
      for (let i = 0; i < rows.length; i++) {
        if (masks[drawn] & (1 << i)) withDraw[i]++
      }
      if (condition.some((alt) => alt.requirements.every((row) => holds(withDraw, row)))) good++
    }
  }
  return legal === 0 ? null : good / legal
}
