import { describe, expect, it } from 'vitest'

import { applyAction } from '../src/lib/sim/actions'
import { lookupEffect, type EffectContext } from '../src/lib/sim/effects'
import { describeStep } from '../src/lib/sim/describe'
import { ACTIVE_TARGET, inPlay, type SimState } from '../src/lib/sim/state'
import type { CardRecord, DeckCard } from '../src/lib/types'

function card(key: string, tags: string[], over: Partial<CardRecord> = {}): DeckCard {
  const record = { index: 0, name: key, kind: '', rule: '', prev: '', hp: null, type: '', retreat: null, regulationMark: '', effect: '', moves: [], tags, image: '', ...over } as CardRecord
  return { key, label: over.name ?? key, resolvedName: key, count: 1, card: record, printings: [], tags }
}
const abra = card('abra', ['pokemon', 'basic'], { name: 'Abra', type: '{P}' })
const kadabra = card('kadabra', ['pokemon', 'stage1'], { name: 'Kadabra', prev: 'Abra', type: '{P}' })
const alakazam = card('alakazam', ['pokemon', 'stage2'], { name: 'Alakazam', prev: 'Kadabra', type: '{P}' })
const candy = card('candy', ['item'], { name: 'Rare Candy' })
const deckOf = (n: number) => Array.from({ length: n }, (_, i) => card(`d${i}`, ['item'], { name: `d${i}` }))
const settled = (c: DeckCard) => ({ ...inPlay(c), fresh: false })
const state = (over: Partial<SimState>): SimState => ({ hand: [], deck: deckOf(10), discard: [], prizes: [], active: null, bench: [], stadium: null, usedEnergy: false, usedSupporter: false, usedStadium: false, usedRetreat: false, usedAbilities: [], turn: 2, ...over })
const ctx = {
  relevant: new Set(['abra', 'kadabra', 'alakazam']),
  wantsAnyBench: false, wantsEnergy: false, energyTypes: new Set<string>(), energyTargets: new Set<string>(),
  activeKey: null, rng: () => 0.5, seed: 1,
  prevOf: new Map([['kadabra', 'abra'], ['alakazam', 'kadabra']]),
} as EffectContext & { relevant: Set<string>; wantsAnyBench: boolean }

const handSizes = (results: SimState[]) => results.map((r) => r.hand.length).sort()

describe('Psychic Draw', () => {
  for (const [where, target] of [['Active', ACTIVE_TARGET], ['Benched', 0]] as const) {
    const place = (pokemon: DeckCard, hand: DeckCard[]) =>
      target === ACTIVE_TARGET
        ? state({ active: settled(pokemon), hand })
        : state({ active: settled(card('x', ['pokemon', 'basic'])), bench: [settled(pokemon)], hand })

    it(`fires evolving a ${where} Abra into Kadabra (draw 2)`, () => {
      const results = applyAction(place(abra, [kadabra]), { kind: 'evolve', handIndex: 0, target }, ctx as never)
      // Always used: drawing never makes a board worse.
      expect(handSizes(results)).toEqual([2])
    })

    it(`fires evolving a ${where} Kadabra into Alakazam (draw 3)`, () => {
      const results = applyAction(place(kadabra, [alakazam]), { kind: 'evolve', handIndex: 0, target }, ctx as never)
      expect(handSizes(results)).toEqual([3])
    })

    it(`fires when Rare Candy evolves a ${where} Abra into Alakazam (draw 3)`, () => {
      const s = place(abra, [alakazam])
      const results = lookupEffect(candy)!({ ...s }, ctx)
      expect(handSizes(results)).toEqual([3])
    })
  }

  it('says it drew, in the line of play', () => {
    const s = state({ active: settled(abra), hand: [kadabra] })
    const [drew] = applyAction(s, { kind: 'evolve', handIndex: 0, target: ACTIVE_TARGET }, ctx as never)
    expect(describeStep(s, drew, { kind: 'evolve', handIndex: 0, target: ACTIVE_TARGET })).toBe(
      "Evolve Abra into Kadabra — using Kadabra's Psychic Draw, drawing 2",
    )
  })

  it('says Rare Candy evolved it and Psychic Draw drew, not that Rare Candy took the cards', () => {
    const s = state({ active: settled(abra), hand: [alakazam] })
    const [after] = lookupEffect(candy)!({ ...s }, ctx)
    expect(describeStep({ ...s, hand: [candy, alakazam] }, after, { kind: 'playItem', handIndex: 0 })).toBe(
      "Play Rare Candy — evolving Abra into Alakazam, using Alakazam's Psychic Draw, drawing 3",
    )
  })

  it('does not fire with nothing left to draw', () => {
    const s = state({ active: settled(abra), hand: [kadabra], deck: [] })
    const results = applyAction(s, { kind: 'evolve', handIndex: 0, target: ACTIVE_TARGET }, ctx as never)
    expect(handSizes(results)).toEqual([0])
  })
})
