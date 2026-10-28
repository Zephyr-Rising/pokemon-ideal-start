import { describe, expect, it } from 'vitest'

import { analyze, type Requirement } from '../src/lib/prob/analyze'
import { allCopiesPrized, prizeRiskRows } from '../src/lib/prob/prizes'
import { sensitivity } from '../src/lib/prob/sensitivity'
import type { DeckCard } from '../src/lib/types'
import { simulatePrized } from './oracles'

function dc(key: string, count: number, tags: string[] = []): DeckCard {
  return { key, label: key, resolvedName: null, count, card: null, printings: [], tags }
}

function req(
  id: string,
  cardKeys: string[],
  n: number,
  op: Requirement['op'] = 'atLeast',
): Requirement {
  return { id, label: id, cardKeys, op, n }
}

/** Build a 60-card deck description for the prize simulator. */
function prizeDeck(targetCopies: number, targetIsBasic: boolean, basics: number) {
  const cards: { basic: boolean; target: boolean }[] = []
  for (let i = 0; i < targetCopies; i++) cards.push({ basic: targetIsBasic, target: true })
  const remainingBasics = basics - (targetIsBasic ? targetCopies : 0)
  for (let i = 0; i < remainingBasics; i++) cards.push({ basic: true, target: false })
  while (cards.length < 60) cards.push({ basic: false, target: false })
  return cards
}

describe('allCopiesPrized', () => {
  it.each([
    [1, false, 21],
    [2, false, 21],
    [4, false, 21],
    [2, true, 21],
    [1, true, 8],
  ])(
    'matches simulation for %i copies (basic=%s, %i deck Basics)',
    (copies, isBasic, basics) => {
      const exact = allCopiesPrized({
        deckSize: 60,
        groupSize: copies,
        groupBasics: isBasic ? copies : 0,
        deckBasics: basics,
      })
      const sim = simulatePrized(prizeDeck(copies, isBasic, basics), {
        trials: 400_000,
        seed: 42 + copies,
      })
      expect(exact).not.toBeNull()
      expect(exact!).toBeCloseTo(sim, 3)
    },
  )

  it('is about 10% for a single copy', () => {
    // 6 of 60 cards are prized, so a lone copy is prized roughly 1 in 10 games.
    const p = allCopiesPrized({ deckSize: 60, groupSize: 1, groupBasics: 0, deckBasics: 21 })
    expect(p!).toBeGreaterThan(0.09)
    expect(p!).toBeLessThan(0.11)
  })

  it('is impossible to prize more copies than there are prizes', () => {
    expect(allCopiesPrized({ deckSize: 60, groupSize: 7, groupBasics: 0, deckBasics: 21 })).toBe(0)
  })

  it('is impossible to prize every Basic, since the kept hand needs one', () => {
    // If the group is all of the deck's Basics, prizing all of them contradicts
    // the hand being legal.
    expect(
      allCopiesPrized({ deckSize: 60, groupSize: 3, groupBasics: 3, deckBasics: 3 }),
    ).toBe(0)
  })

  it('returns null when no legal hand exists', () => {
    expect(allCopiesPrized({ deckSize: 60, groupSize: 1, groupBasics: 0, deckBasics: 0 })).toBeNull()
  })
})

describe('sensitivity', () => {
  const cards = [
    dc('attacker', 4, ['basic']),
    dc('search', 4, ['item']),
    dc('energy', 8, ['basic-energy', 'energy']),
    dc('ace', 1, ['ace-spec', 'item']),
    dc('filler', 43, ['item']),
  ]
  const requirements = [req('r1', ['attacker'], 1), req('r2', ['search'], 1)]

  it('omits cards that cannot move the number', () => {
    const rows = sensitivity(cards, requirements)
    // 'filler' and 'energy' are in no group; only 'energy' is excluded too since
    // neither is a Basic Pokémon. 'ace' likewise.
    expect(rows.map((r) => r.key).sort()).toEqual(['attacker', 'search'])
  })

  it('includes a Basic Pokémon even when it is in no group, via the mulligan rate', () => {
    const withBasic = [...cards, dc('spare-basic', 2, ['basic'])]
    const rows = sensitivity(withBasic, requirements)
    expect(rows.map((r) => r.key)).toContain('spare-basic')
  })

  it('cutting a required card lowers the probability, adding one raises it', () => {
    const rows = sensitivity(cards, requirements)
    const search = rows.find((r) => r.key === 'search')!
    expect(search.minusOne!).toBeLessThan(0)
    // 'search' is already at 4, so +1 is blocked by the copy limit.
    expect(search.plusOne).toBeNull()
    expect(search.plusOneBlocked).toMatch(/4 copies/)
  })

  it('matches a hand-built recomputation exactly', () => {
    const threeCopies = [
      dc('attacker', 4, ['basic']),
      dc('search', 3, ['item']),
      dc('filler', 53, ['item']),
    ]
    const rows = sensitivity(threeCopies, requirements)
    const search = rows.find((r) => r.key === 'search')!

    const baseline = analyze(threeCopies, requirements).firstLook!
    const cut = analyze(
      [dc('attacker', 4, ['basic']), dc('search', 2, ['item']), dc('filler', 54, ['item'])],
      requirements,
    ).firstLook!
    const added = analyze(
      [dc('attacker', 4, ['basic']), dc('search', 4, ['item']), dc('filler', 52, ['item'])],
      requirements,
    ).firstLook!

    expect(search.minusOne!).toBeCloseTo(cut - baseline, 12)
    expect(search.plusOne!).toBeCloseTo(added - baseline, 12)
  })

  it('blocks a second ACE SPEC', () => {
    const rows = sensitivity(cards, [req('r', ['ace'], 1)])
    const ace = rows.find((r) => r.key === 'ace')!
    expect(ace.plusOne).toBeNull()
    expect(ace.plusOneBlocked).toMatch(/ACE SPEC/)
  })

  it('lets basic Energy exceed four copies', () => {
    const rows = sensitivity(cards, [req('r', ['energy'], 2)])
    const energy = rows.find((r) => r.key === 'energy')!
    expect(energy.plusOne).not.toBeNull()
    expect(energy.plusOneBlocked).toBeUndefined()
  })

  it('blocks adding when there is no neutral card to cut', () => {
    // Uses basic Energy so the copy limit cannot be what blocks it: every card
    // here is either a Basic Pokémon or in the requirement group, so no neutral
    // card exists to trade the slot from.
    const noFiller = [dc('attacker', 20, ['basic']), dc('energy', 40, ['basic-energy', 'energy'])]
    const rows = sensitivity(noFiller, [req('r', ['energy'], 1)])
    const energy = rows.find((r) => r.key === 'energy')!
    expect(energy.plusOne).toBeNull()
    expect(energy.plusOneBlocked).toMatch(/neutral card/)
  })

  it('ranks the biggest mover first', () => {
    const rows = sensitivity(cards, requirements)
    const impact = (r: (typeof rows)[number]) =>
      Math.max(Math.abs(r.minusOne ?? 0), Math.abs(r.plusOne ?? 0))
    for (let i = 1; i < rows.length; i++) {
      expect(impact(rows[i - 1])).toBeGreaterThanOrEqual(impact(rows[i]))
    }
  })

  it('returns nothing when no probability is defined', () => {
    expect(sensitivity([dc('x', 60)], [req('r', ['x'], 1)])).toEqual([])
  })
})

describe('prizeRiskRows', () => {
  const cards = [
    { key: 'solo', label: 'Solo', count: 1, tags: ['item'] },
    { key: 'pair', label: 'Pair', count: 2, tags: ['basic'] },
    { key: 'four', label: 'Four', count: 4, tags: ['item'] },
    { key: 'many', label: 'Many', count: 20, tags: ['basic'] },
    { key: 'rest', label: 'Rest', count: 33, tags: ['item'] },
  ]

  it('ranks the riskiest card first and omits what cannot be lost', () => {
    const { cards: rows } = prizeRiskRows(cards, [])
    expect(rows.map((r) => r.key)).toEqual(['solo', 'pair'])
    // A 1-of is prized about 1 game in 10.
    expect(rows[0].probability).toBeGreaterThan(0.09)
    expect(rows[0].probability).toBeLessThan(0.11)
  })

  it('drops rows that would render as 0.00%', () => {
    // 'four' is a real but negligible risk; listing it as 0.00% is noise.
    const { cards: rows } = prizeRiskRows(cards, [])
    expect(rows.map((r) => r.key)).not.toContain('four')
    // 'many' has more copies than there are prizes, so it is impossible.
    expect(rows.map((r) => r.key)).not.toContain('many')
  })

  it('reports a requirement group only when the whole group could be buried', () => {
    const { groups } = prizeRiskRows(cards, [
      { id: 'small', label: 'Small', cardKeys: ['solo', 'pair'] },
      { id: 'big', label: 'Big', cardKeys: ['many'] },
    ])
    expect(groups.map((g) => g.key)).toEqual(['small'])
    expect(groups[0].count).toBe(3)
  })
})
