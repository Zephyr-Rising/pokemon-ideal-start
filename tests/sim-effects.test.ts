import { describe, expect, it } from 'vitest'

import { lookupEffect, type EffectContext } from '../src/lib/sim/effects'
import { inPlay, type SimState } from '../src/lib/sim/state'
import type { CardRecord, DeckCard } from '../src/lib/types'

function card(key: string, tags: string[], over: Partial<CardRecord> = {}): DeckCard {
  const record: CardRecord = {
    index: 0,
    name: key,
    kind: '',
    rule: '',
    prev: '',
    hp: null,
    type: '',
    retreat: null,
    regulationMark: '',
    effect: '',
    moves: [],
    tags,
    image: '',
    ...over,
  }
  return { key, label: key, resolvedName: over.name ?? key, count: 1, card: record, printings: [], tags }
}

/** A Trainer whose canonical name drives the effect lookup. */
const trainer = (name: string, kind: 'item' | 'supporter') =>
  card(name.toLowerCase().replace(/\s+/g, '-'), [kind], { name })

const basic = (key: string, hp = 60, over: Partial<CardRecord> = {}) =>
  card(key, ['pokemon', 'basic'], { hp, name: key, ...over })
const stage1 = (key: string) => card(key, ['pokemon', 'stage1'], { name: key })
const stage2 = (key: string) => card(key, ['pokemon', 'stage2'], { name: key })
const exMon = (key: string, hp = 200) =>
  card(key, ['pokemon', 'basic', 'ex'], { hp, name: key, rule: 'Pokémon ex' })
const energy = (key: string, type = '{G}') =>
  card(key, ['energy', 'basic-energy'], { type, name: key })

const state = (over: Partial<SimState> = {}): SimState => ({
  hand: [],
  deck: [],
  discard: [],
  prizes: [],
  active: null,
  bench: [],
  stadium: null,
  usedEnergy: false,
  usedSupporter: false,
  usedStadium: false,
  usedRetreat: false,
  usedAbilities: [],
  ...over,
})

/** Effects only fetch what the goal has a use for, so tests say what that is. */
function ctx(over: Partial<EffectContext> = {}): EffectContext {
  return {
    relevant: new Set<string>(),
    wantsAnyBench: true,
    wantsEnergy: true,
    energyTypes: new Set<string>(),
    energyTargets: new Set<string>(),
    activeKey: null,
    rng: () => 0.5,
    seed: 1,
    ...over,
  }
}

const play = (name: string, s: SimState, c: EffectContext = ctx()) => {
  const effect = lookupEffect(trainer(name, 'item'))
  expect(effect, `${name} should be implemented`).toBeDefined()
  return effect!(s, c)
}

const keys = (cards: DeckCard[]) => cards.map((c) => c.key)

describe('Buddy-Buddy Poffin', () => {
  it('benches up to two Basics of 70 HP or less', () => {
    const s = state({ deck: [basic('a', 60), basic('b', 70), basic('big', 220)] })
    const results = play('Buddy-Buddy Poffin', s)
    const best = results.reduce((a, b) => (a.bench.length >= b.bench.length ? a : b))
    expect(best.bench).toHaveLength(2)
    expect(keys(best.bench.map((slot) => slot.card)).sort()).toEqual(['a', 'b'])
  })

  it('never benches a Pokémon over 70 HP', () => {
    const s = state({ deck: [basic('big', 220)] })
    const results = play('Buddy-Buddy Poffin', s)
    expect(results.every((r) => r.bench.length === 0)).toBe(true)
  })

  it('stops at the bench cap', () => {
    const s = state({
      active: inPlay(basic('x')),
      bench: Array.from({ length: 5 }, (_, i) => inPlay(basic(`b${i}`))),
      deck: [basic('a'), basic('b')],
    })
    const results = play('Buddy-Buddy Poffin', s)
    expect(results.every((r) => r.bench.length === 5)).toBe(true)
  })
})

describe('Ultra Ball', () => {
  it('discards two cards and fetches any Pokémon', () => {
    const s = state({ hand: [energy('e1'), energy('e2')], deck: [exMon('target')] })
    const results = play('Ultra Ball', s, ctx({ relevant: new Set(['target']) }))
    const found = results.find((r) => keys(r.hand).includes('target'))
    expect(found).toBeDefined()
    expect(found!.discard).toHaveLength(2)
  })

  it('does nothing when the hand cannot pay the discard', () => {
    const s = state({ hand: [energy('e1')], deck: [exMon('target')] })
    const results = play('Ultra Ball', s, ctx({ relevant: new Set(['target']) }))
    expect(results).toHaveLength(1)
    expect(keys(results[0].hand)).not.toContain('target')
  })

  it('keeps cards the goal asked for and pitches the rest', () => {
    const s = state({
      hand: [card('keep', ['item'], { name: 'keep' }), energy('e1'), energy('e2')],
      deck: [exMon('target')],
    })
    const results = play('Ultra Ball', s, ctx({ relevant: new Set(['target', 'keep']) }))
    const found = results.find((r) => keys(r.hand).includes('target'))!
    expect(keys(found.hand)).toContain('keep')
  })
})

describe('Poké Pad', () => {
  it('fetches only Pokémon without a Rule Box', () => {
    const s = state({ deck: [exMon('ruled'), basic('plain')] })
    const results = play('Poké Pad', s, ctx({ relevant: new Set(['ruled', 'plain']) }))
    const fetched = results.flatMap((r) => keys(r.hand))
    expect(fetched).toContain('plain')
    expect(fetched).not.toContain('ruled')
  })
})

describe('Cyrano', () => {
  it('takes up to three Pokémon ex', () => {
    const s = state({ deck: [exMon('a'), exMon('b'), exMon('c'), exMon('d'), basic('plain')] })
    const results = play('Cyrano', s, ctx({ relevant: new Set(['a', 'b', 'c', 'd']) }))
    expect(results[0].hand).toHaveLength(3)
    expect(keys(results[0].hand)).not.toContain('plain')
  })
})

describe('Dawn', () => {
  it('takes one of each stage', () => {
    const s = state({ deck: [basic('b'), stage1('s1'), stage2('s2'), basic('b2')] })
    const results = play('Dawn', s, ctx({ relevant: new Set(['b', 's1', 's2', 'b2']) }))
    expect(keys(results[0].hand).sort()).toEqual(['b', 's1', 's2'])
  })
})

describe('Hilda', () => {
  it('takes an Evolution Pokémon and an Energy', () => {
    const s = state({ deck: [basic('b'), stage1('s1'), energy('e')] })
    const results = play('Hilda', s, ctx({ relevant: new Set(['s1']) }))
    expect(keys(results[0].hand).sort()).toEqual(['e', 's1'])
  })
})

describe('Secret Box', () => {
  it('discards three, then takes one of each Trainer kind', () => {
    const s = state({
      hand: [energy('x1'), energy('x2'), energy('x3')],
      deck: [
        card('i', ['item'], { name: 'i' }),
        card('t', ['tool'], { name: 't' }),
        card('sup', ['supporter'], { name: 'sup' }),
        card('stad', ['stadium'], { name: 'stad' }),
      ],
    })
    const relevant = new Set(['i', 't', 'sup', 'stad'])
    const results = play('Secret Box', s, ctx({ relevant }))
    expect(keys(results[0].hand).sort()).toEqual(['i', 'stad', 'sup', 't'])
    expect(results[0].discard).toHaveLength(3)
  })
})

describe('hand refresh', () => {
  it("Lillie's Determination draws 8 on turn 1, not 6", () => {
    // "Draw 6; if you have exactly 6 Prize cards remaining, draw 8 instead."
    // Nobody has taken a Prize on turn 1, so it is always the 8.
    const s = state({
      hand: [energy('a'), energy('b')],
      deck: Array.from({ length: 20 }, (_, i) => energy(`d${i}`)),
      prizes: Array.from({ length: 6 }, (_, i) => energy(`p${i}`)),
    })
    const [after] = play("Lillie's Determination", s)
    expect(after.hand).toHaveLength(8)
    // The old hand went back into the deck rather than the discard.
    expect(after.discard).toHaveLength(0)
    expect(after.deck).toHaveLength(14)
  })

  it('Judge draws four', () => {
    const s = state({
      hand: [energy('a'), energy('b'), energy('c')],
      deck: Array.from({ length: 20 }, (_, i) => energy(`d${i}`)),
      prizes: Array.from({ length: 6 }, (_, i) => energy(`p${i}`)),
    })
    const [after] = play('Judge', s)
    expect(after.hand).toHaveLength(4)
  })
})

describe('energy', () => {
  it('Crispin attaches one Basic Energy and puts another in hand', () => {
    const s = state({
      active: inPlay(basic('mon')),
      deck: [energy('grass', '{G}'), energy('fire', '{R}')],
    })
    const results = play('Crispin', s)
    const attached = results.find((r) => r.active!.energy.length === 1)
    expect(attached).toBeDefined()
    // Different types: one attached, the other to hand.
    expect(attached!.hand).toHaveLength(1)
  })

  it('Wondrous Patch moves a Psychic Energy from the discard to a benched Psychic Pokémon', () => {
    const s = state({
      bench: [inPlay(basic('psy', 60, { type: '{P}' }))],
      discard: [energy('p', '{P}')],
    })
    const [after] = play('Wondrous Patch', s)
    expect(after.bench[0].energy).toHaveLength(1)
    expect(after.discard).toHaveLength(0)
  })

  it('Wondrous Patch does nothing without a Psychic target', () => {
    const s = state({ bench: [inPlay(basic('grassy', 60, { type: '{G}' }))], discard: [energy('p', '{P}')] })
    const [after] = play('Wondrous Patch', s)
    expect(after.bench[0].energy).toHaveLength(0)
  })

  it("N's PP Up only targets N's Pokémon", () => {
    const withN = state({
      bench: [inPlay(basic("N's Zorua"))],
      discard: [energy('d', '{D}')],
    })
    expect(play("N's PP Up", withN)[0].bench[0].energy).toHaveLength(1)

    const without = state({ bench: [inPlay(basic('Dreepy'))], discard: [energy('d', '{D}')] })
    expect(play("N's PP Up", without)[0].bench[0].energy).toHaveLength(0)
  })

  it('Energy Switch moves Energy between your Pokémon', () => {
    const active = inPlay(basic('a'))
    active.energy = [energy('e')]
    const s = state({ active, bench: [inPlay(basic('b'))] })
    const results = play('Energy Switch', s)
    const moved = results.find((r) => r.bench[0].energy.length === 1)
    expect(moved).toBeDefined()
    expect(moved!.active!.energy).toHaveLength(0)
  })
})

describe('switching and recovery', () => {
  it('Switch swaps the Active with a benched Pokémon, free of cost', () => {
    const s = state({ active: inPlay(basic('heavy', 60, { retreat: 4 })), bench: [inPlay(basic('x'))] })
    const results = play('Switch', s)
    expect(results[0].active!.card.key).toBe('x')
    expect(results[0].bench[0].card.key).toBe('heavy')
  })

  it('Night Stretcher takes a Pokémon or Basic Energy back from the discard', () => {
    const s = state({ discard: [basic('mon'), energy('e'), card('item', ['item'], { name: 'item' })] })
    const results = play('Night Stretcher', s, ctx({ relevant: new Set(['mon']) }))
    const fetched = results.flatMap((r) => keys(r.hand))
    expect(fetched).toContain('mon')
    expect(fetched).not.toContain('item')
  })

  it("Lana's Aid takes up to three, and never a Pokémon with a Rule Box", () => {
    const s = state({ discard: [basic('a'), basic('b'), basic('c'), basic('d'), exMon('ruled')] })
    const results = play("Lana's Aid", s)
    expect(results[0].hand).toHaveLength(3)
    expect(keys(results[0].hand)).not.toContain('ruled')
  })
})

describe('cards that cannot matter on turn 1', () => {
  it.each(['Unfair Stamp', 'Special Red Card', "Boss's Orders", 'Rare Candy', "Ciphermaniac's Codebreaking"])(
    '%s is deliberately not implemented',
    (name) => {
      // Each is impossible or pointless on turn 1 — being inert is correct, not
      // a gap. Implementing them would be wrong, not merely unnecessary.
      expect(lookupEffect(trainer(name, 'item'))).toBeUndefined()
    },
  )
})
