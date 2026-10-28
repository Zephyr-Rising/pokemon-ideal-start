import { binom } from './binom'

/**
 * A group of deck cards that are interchangeable for the question being asked.
 * `mask` is a bitmask of which predicates every card in the bucket satisfies.
 */
export interface Bucket {
  mask: number
  size: number
}

/**
 * The distribution of a random hand, expressed over *saturated* predicate-count
 * vectors: each predicate's count is tracked only up to its cap, because no
 * question distinguishes "7 copies" from "8 copies" once the cap is passed.
 */
export interface HandDist {
  caps: number[]
  strides: number[]
  /** Probability of each encoded state; indexed by the mixed-radix encoding. */
  probs: Float64Array
  handSize: number
  deckSize: number
  stateCount: number
}

/** Mixed-radix strides, so a count vector packs into one integer. */
function makeStrides(caps: number[]): { strides: number[]; stateCount: number } {
  const strides: number[] = []
  let stride = 1
  for (const cap of caps) {
    strides.push(stride)
    stride *= cap + 1
  }
  return { strides, stateCount: stride }
}

export function countOf(dist: HandDist, state: number, predicate: number): number {
  return Math.floor(state / dist.strides[predicate]) % (dist.caps[predicate] + 1)
}

/**
 * Exact multivariate hypergeometric distribution of a `handSize` hand drawn from
 * buckets that partition the deck.
 *
 * Buckets are disjoint by construction, which is what makes overlapping
 * requirement groups exact with no inclusion–exclusion: a card belonging to
 * three groups simply lands in the bucket whose mask has those three bits.
 *
 * Counts are accumulated as exact integer "ways" and divided by C(deck, hand)
 * once at the end, so there is no compounding floating-point error.
 */
export function handDistribution(
  buckets: Bucket[],
  caps: number[],
  handSize: number,
  deckSize: number,
): HandDist {
  const { strides, stateCount } = makeStrides(caps)
  const predicateCount = caps.length

  // ways[k][state] — number of ways to have drawn k cards reaching `state`.
  let ways: Float64Array[] = Array.from({ length: handSize + 1 }, () => new Float64Array(stateCount))
  ways[0][0] = 1

  for (const bucket of buckets) {
    if (bucket.size === 0) continue
    const next: Float64Array[] = Array.from(
      { length: handSize + 1 },
      () => new Float64Array(stateCount),
    )

    // Which predicates this bucket's cards advance, and by how much per card.
    const advanced: number[] = []
    for (let p = 0; p < predicateCount; p++) {
      if (bucket.mask & (1 << p)) advanced.push(p)
    }

    for (let k = 0; k <= handSize; k++) {
      const row = ways[k]
      for (let state = 0; state < stateCount; state++) {
        const w = row[state]
        if (w === 0) continue
        const maxTake = Math.min(bucket.size, handSize - k)
        for (let take = 0; take <= maxTake; take++) {
          let target = state
          for (const p of advanced) {
            const current = Math.floor(state / strides[p]) % (caps[p] + 1)
            const saturated = Math.min(current + take, caps[p])
            target += (saturated - current) * strides[p]
          }
          next[k + take][target] += w * binom(bucket.size, take)
        }
      }
    }
    ways = next
  }

  const total = binom(deckSize, handSize)
  const probs = new Float64Array(stateCount)
  if (total > 0) {
    const final = ways[handSize]
    for (let state = 0; state < stateCount; state++) {
      if (final[state] !== 0) probs[state] = final[state] / total
    }
  }

  return { caps, strides, probs, handSize, deckSize, stateCount }
}
