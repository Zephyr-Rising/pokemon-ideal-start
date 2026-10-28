import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  allOptions,
  analyze,
  type Condition, type Requirement,
  type RequirementOp,
} from '../src/lib/prob/analyze'
import { binom } from '../src/lib/prob/binom'
import { resolveDeck } from '../src/lib/resolve-cards'
import type { DeckCard } from '../src/lib/types'
import {
  bruteForceFirstLook,
  bruteForceOpening,
  expandMasks,
  hypergeomAtLeast,
  simulate,
} from './oracles'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const realDeck = () =>
  resolveDeck(readFileSync(resolve(FIXTURES, 'mega-kangaskhan.txt'), 'utf8')).cards

/** Synthetic deck card, for tests that need an exactly-known deck. */
function dc(key: string, count: number, tags: string[] = []): DeckCard {
  return { key, label: key, resolvedName: null, count, card: null, printings: [], tags }
}

function req(
  id: string,
  cardKeys: string[],
  n: number,
  op: RequirementOp = 'atLeast',
): Requirement {
  // A plain requirement with one option. `optionsOf` builds multi-option ones.
  return { id, label: id, options: [{ id: `${id}-o`, cardKeys, op, n }] }
}

/** Wrap rows as a single alternative - the common case of one route. */
const route = (requirements: Requirement[]): Condition => [
  { id: 'route', label: 'Route', requirements },
]

/** Oracle masks carry one bit per requirement option. */
const masksFor = (cards: DeckCard[], condition: Condition) =>
  expandMasks(cards, allOptions(condition))


const keyOf = (cards: DeckCard[], label: string): string => {
  const card = cards.find((c) => c.label === label)
  if (!card) throw new Error(`fixture missing card: ${label}`)
  return card.key
}

describe('binom', () => {
  it('matches known values', () => {
    expect(binom(60, 7)).toBe(386206920)
    expect(binom(60, 8)).toBe(2558620845)
    expect(binom(53, 6)).toBe(22957480)
    expect(binom(5, 0)).toBe(1)
    expect(binom(5, 5)).toBe(1)
    expect(binom(5, 6)).toBe(0)
    expect(binom(5, -1)).toBe(0)
  })

  it('refuses to return a rounded answer outside exact range', () => {
    expect(() => binom(60, 30)).toThrow(/exact integer range/)
  })
})

describe('mulligan rate', () => {
  it('matches the closed form for the example deck', () => {
    const cards = realDeck()
    const result = analyze(cards, [])
    expect(result.basicCount).toBe(21)
    // P(no Basic in 7) = C(39,7)/C(60,7)
    expect(result.mulliganRate).toBeCloseTo(binom(39, 7) / binom(60, 7), 12)
    expect(result.mulliganRate).toBeCloseTo(1 - hypergeomAtLeast(60, 21, 7, 1), 12)
    // 21 Basics in 60 gives C(39,7)/C(60,7) = 3.98%, a normal rate for a
    // competitive list. Pinned so a regression in Basic detection is loud.
    expect(result.mulliganRate).toBeCloseTo(0.039826, 5)
  })

  it('expected mulligans follows the geometric mean', () => {
    const result = analyze(realDeck(), [])
    const p = 1 - result.mulliganRate
    expect(result.expectedMulligans).toBeCloseTo(result.mulliganRate / p, 12)
  })
})

describe('DP agrees with the closed form', () => {
  it('reduces to plain hypergeometric when every card is a Basic', () => {
    // With no illegal hands, mulligan conditioning is vacuous, so the 8-card
    // number must equal the textbook unconditional probability.
    const cards = [dc('target', 4, ['basic']), dc('filler', 56, ['basic'])]
    const result = analyze(cards, route([req('r', ['target'], 1)]))

    expect(result.mulliganRate).toBe(0)
    expect(result.firstLook).toBeCloseTo(hypergeomAtLeast(60, 4, 8, 1), 12)
    expect(result.openingHand).toBeCloseTo(hypergeomAtLeast(60, 4, 7, 1), 12)
  })

  it('handles a threshold above 1', () => {
    const cards = [dc('target', 6, ['basic']), dc('filler', 54, ['basic'])]
    const result = analyze(cards, route([req('r', ['target'], 2)]))
    expect(result.firstLook).toBeCloseTo(hypergeomAtLeast(60, 6, 8, 2), 12)
  })
})

describe('DP agrees with exhaustive enumeration', () => {
  // A 14-card deck is small enough to enumerate every hand yet large enough to
  // exercise the real 7-card / 8-card path, with groups that deliberately overlap.
  const cards = [
    dc('a', 3, ['basic']), // group 1 only
    dc('b', 2, ['basic']), // groups 1 and 2
    dc('c', 2), //            group 2 only
    dc('d', 7), //            neither
  ]
  const requirements = [req('g1', ['a', 'b'], 1), req('g2', ['b', 'c'], 1)]
  const masks = masksFor(cards, route(requirements))

  it('matches on the opening 7', () => {
    const result = analyze(cards, route(requirements))
    expect(result.openingHand).toBeCloseTo(bruteForceOpening(masks, route(requirements), 7)!, 12)
  })

  it('matches on the 8-card first look', () => {
    const result = analyze(cards, route(requirements))
    expect(result.firstLook).toBeCloseTo(bruteForceFirstLook(masks, route(requirements), 7)!, 12)
  })

  it('matches for atMost and exactly', () => {
    const ops: RequirementOp[] = ['atMost', 'exactly']
    for (const op of ops) {
      const rs = [req('g1', ['a', 'b'], 1, op)]
      const m = masksFor(cards, route(rs))
      const result = analyze(cards, route(rs))
      expect(result.openingHand).toBeCloseTo(bruteForceOpening(m, route(rs), 7)!, 12)
      expect(result.firstLook).toBeCloseTo(bruteForceFirstLook(m, route(rs), 7)!, 12)
    }
  })

  it('matches with three overlapping groups', () => {
    const rs = [
      req('g1', ['a', 'b'], 1),
      req('g2', ['b', 'c'], 1),
      req('g3', ['a', 'c', 'd'], 2),
    ]
    const m = masksFor(cards, route(rs))
    const result = analyze(cards, route(rs))
    expect(result.openingHand).toBeCloseTo(bruteForceOpening(m, route(rs), 7)!, 12)
    expect(result.firstLook).toBeCloseTo(bruteForceFirstLook(m, route(rs), 7)!, 12)
  })
})

describe('DP agrees with simulation on a real 60-card deck', () => {
  it('matches a three-row ideal-start condition', () => {
    const cards = realDeck()
    const requirements = [
      req('attacker', [keyOf(cards, 'Mega Kangaskhan ex')], 1),
      req('search', [keyOf(cards, 'Ultra Ball'), keyOf(cards, 'Meowth ex')], 1),
      req('energy', [keyOf(cards, 'Grass Energy'), keyOf(cards, 'Psychic Energy')], 1),
    ]
    const masks = masksFor(cards, route(requirements))
    const result = analyze(cards, route(requirements))

    const sim7 = simulate(masks, route(requirements), { trials: 400_000, seed: 7, look: 7 })
    const sim8 = simulate(masks, route(requirements), { trials: 400_000, seed: 8, look: 8 })

    expect(result.openingHand).toBeCloseTo(sim7, 2)
    expect(result.firstLook).toBeCloseTo(sim8, 2)
    // The extra card must strictly help an all-atLeast condition.
    expect(result.firstLook!).toBeGreaterThan(result.openingHand!)
  })

  it('matches per-row probabilities', () => {
    const cards = realDeck()
    const requirements = [
      req('ultra', [keyOf(cards, 'Ultra Ball')], 1),
      req('kanga', [keyOf(cards, 'Mega Kangaskhan ex')], 2),
    ]
    const result = analyze(cards, route(requirements))

    for (const [i, row] of result.perRequirement.entries()) {
      const single = [requirements[i]]
      const sim = simulate(masksFor(cards, route(single)), route(single), {
        trials: 300_000,
        seed: 100 + i,
        look: 8,
      })
      expect(row.probability).toBeCloseTo(sim, 2)
    }
  })
})

describe('legal-hand self-check', () => {
  it('both DP runs reproduce the closed-form legal-hand rate', () => {
    const cards = realDeck()
    const conditions: Requirement[][] = [
      [],
      [req('a', [keyOf(cards, 'Ultra Ball')], 1)],
      [
        req('a', [keyOf(cards, 'Ultra Ball')], 2, 'atMost'),
        req('b', [keyOf(cards, 'Grass Energy')], 1, 'exactly'),
      ],
    ]
    for (const requirements of conditions) {
      const { diagnostics } = analyze(cards, route(requirements))
      expect(diagnostics.legalOpening).toBeCloseTo(diagnostics.legalClosedForm, 12)
      expect(diagnostics.legalFirstLook).toBeCloseTo(diagnostics.legalClosedForm, 12)
    }
  })
})

describe('degenerate inputs', () => {
  it('reports impossible for an empty deck', () => {
    const result = analyze([], [])
    expect(result).toMatchObject({ impossible: true, openingHand: null, firstLook: null })
  })

  it('reports impossible, not NaN, for a deck with no Basics', () => {
    const result = analyze([dc('x', 60)], route([req('r', ['x'], 1)]))
    expect(result.impossible).toBe(true)
    expect(result.mulliganRate).toBe(1)
    expect(result.openingHand).toBeNull()
    expect(result.firstLook).toBeNull()
  })

  it('reports impossible for a deck smaller than the first look', () => {
    expect(analyze([dc('x', 7, ['basic'])], []).impossible).toBe(true)
  })

  it('returns exactly 0 when a threshold exceeds the copies available', () => {
    const cards = [dc('target', 2, ['basic']), dc('filler', 58, ['basic'])]
    const result = analyze(cards, route([req('r', ['target'], 3)]))
    expect(result.firstLook).toBe(0)
    expect(result.openingHand).toBe(0)
  })

  it('treats an empty condition as always satisfied', () => {
    const result = analyze(realDeck(), [])
    expect(result.firstLook).toBe(1)
    expect(result.openingHand).toBe(1)
  })

  it('ignores requirement card keys that are not in the deck', () => {
    const cards = [dc('a', 10, ['basic']), dc('b', 50)]
    const withGhost = analyze(cards, route([req('r', ['a', 'ghost'], 1)]))
    const without = analyze(cards, route([req('r', ['a'], 1)]))
    expect(withGhost.firstLook).toBeCloseTo(without.firstLook!, 12)
  })

  it('never counts an unresolved card as a Basic', () => {
    const deck = resolveDeck('4 Totally Unknown Card ZZZ 1\n56 Mega Kangaskhan ex MEG 104')
    const result = analyze(deck.cards, [])
    expect(result.basicCount).toBe(56)
  })
})
