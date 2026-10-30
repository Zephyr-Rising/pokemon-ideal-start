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

describe('Fighting Gong', () => {
  // A goal that names neither half of the Lunar Cycle engine, nor any Energy.
  const goalOnly = ctx({ relevant: new Set(['target']), wantsAnyBench: false, wantsEnergy: false })
  const lunatone = basic('Lunatone', 110, { type: '{F}' })
  const solrock = basic('Solrock', 110, { type: '{F}' })
  const fighting = energy('fighting', '{F}')
  const fetched = (results: SimState[]) => results.flatMap((r) => keys(r.hand))

  it('fetches a Basic {F} Pokémon or Energy the goal asks for', () => {
    const s = state({ deck: [basic('target', 60, { type: '{F}' }), basic('other', 60, { type: '{F}' })] })
    expect(fetched(play('Fighting Gong', s, goalOnly))).toEqual(['target'])
  })

  it('ignores cards that are not {F}', () => {
    const s = state({ deck: [basic('target', 60, { type: '{G}' }), energy('grass', '{G}')] })
    expect(play('Fighting Gong', s, goalOnly)).toEqual([s])
  })

  it('fetches the Energy that Lunar Cycle discards, even when the goal never names it', () => {
    const s = state({ active: inPlay(lunatone), bench: [inPlay(solrock)], deck: [fighting] })
    expect(fetched(play('Fighting Gong', s, goalOnly))).toEqual(['fighting'])
  })

  it('fetches Solrock to switch Lunar Cycle on, before the Energy', () => {
    const s = state({ active: inPlay(lunatone), deck: [solrock, fighting] })
    expect(fetched(play('Fighting Gong', s, goalOnly))).toEqual(['Solrock'])
  })

  it('fetches Lunatone when Solrock is already held', () => {
    const s = state({ hand: [solrock], active: inPlay(basic('x')), deck: [lunatone, fighting] })
    expect(fetched(play('Fighting Gong', s, goalOnly))).toEqual(['Solrock', 'Lunatone'])
  })

  it('leaves the engine alone once Lunar Cycle is fuelled or spent', () => {
    const fuelled = state({
      active: inPlay(lunatone),
      bench: [inPlay(solrock)],
      hand: [energy('spare', '{F}')],
      deck: [fighting],
    })
    expect(play('Fighting Gong', fuelled, goalOnly)).toEqual([fuelled])

    const spent = state({
      active: inPlay(lunatone),
      bench: [inPlay(solrock)],
      deck: [fighting],
      usedAbilities: ['lunatone'],
    })
    expect(play('Fighting Gong', spent, goalOnly)).toEqual([spent])
  })
})

describe('draw engines', () => {
  // Nothing here is named by the goal; each fetch is justified by an engine.
  const goalOnly = ctx({ relevant: new Set(['target']), wantsAnyBench: false, wantsEnergy: false })
  const fetched = (results: SimState[], before: SimState) =>
    results.flatMap((r) => keys(r.hand).filter((k) => !keys(before.hand).includes(k)))
  const meowth = exMon('Meowth ex', 170)
  const ogerpon = exMon('Teal Mask Ogerpon ex', 210)
  const kangaskhan = exMon('Mega Kangaskhan ex', 300)
  const supporter = trainer("Lillie's Determination", 'supporter')

  it('Ultra Ball fetches Meowth ex while a Supporter is still to be found and played', () => {
    const s = state({ hand: [energy('a'), energy('b')], deck: [meowth, supporter] })
    expect(fetched(play('Ultra Ball', s, goalOnly), s)).toEqual(['Meowth ex'])
  })

  it('leaves Meowth ex alone once the Supporter for the turn is played', () => {
    const s = state({
      hand: [energy('a'), energy('b')],
      deck: [meowth, supporter],
      usedSupporter: true,
    })
    expect(fetched(play('Ultra Ball', s, goalOnly), s)).toEqual([])
  })

  it('fetches the Grass Energy that Teal Dance needs once Ogerpon is in play', () => {
    const s = state({ active: inPlay(ogerpon), deck: [energy('fire', '{R}'), energy('grass', '{G}')] })
    expect(fetched(play('Hilda', s, goalOnly), s)).toEqual(['grass'])
  })

  it('does not start an engine the board shows no sign of', () => {
    // Lunatone needs Solrock and an {F} Energy; holding none of the three,
    // fetching one would just be a card the goal cannot use.
    const s = state({ hand: [energy('a'), energy('b')], deck: [basic('Lunatone', 110, { type: '{F}' })] })
    expect(fetched(play('Ultra Ball', s, goalOnly), s)).toEqual([])
  })

  it('skips Abilities that only work from the Active Spot', () => {
    const s = state({ hand: [energy('a'), energy('b')], deck: [kangaskhan] })
    expect(fetched(play('Ultra Ball', s, goalOnly), s)).toEqual([])
  })

  it('Ultra Ball keeps the Energy Lunar Cycle is about to discard', () => {
    const lunatone = basic('Lunatone', 110, { type: '{F}' })
    const solrock = basic('Solrock', 110, { type: '{F}' })
    // Something worth fetching, or Ultra Ball would not be played at all.
    const board = { active: inPlay(lunatone), bench: [inPlay(solrock)], deck: [basic('target')] }
    // The {F} Energy is first in hand, so index order alone would pitch it.
    const s = state({ ...board, hand: [energy('fighting', '{F}'), energy('a'), energy('b')] })
    const [after] = play('Ultra Ball', s, goalOnly)
    expect(keys(after.hand)).toEqual(['fighting', 'target'])

    // Once Lunar Cycle is spent the Energy is just another card.
    const spent = state({ ...s, usedAbilities: ['lunatone'] })
    const [afterSpent] = play('Ultra Ball', spent, goalOnly)
    expect(keys(afterSpent.hand)).toEqual(['b', 'target'])
  })

  it('keeps only one copy of an engine piece', () => {
    const lunatone = basic('Lunatone', 110, { type: '{F}' })
    const solrock = basic('Solrock', 110, { type: '{F}' })
    const s = state({
      active: inPlay(lunatone),
      bench: [inPlay(solrock)],
      hand: [energy('f1', '{F}'), energy('f2', '{F}'), energy('a')],
      deck: [basic('target')],
    })
    const [after] = play('Ultra Ball', s, goalOnly)
    expect(keys(after.hand)).toEqual(['f1', 'target'])
  })

  it('only protects a piece when the rest of its engine can still be found', () => {
    // A Grass Energy is Teal Dance fuel, but only in a deck that runs Ogerpon.
    const hand = [energy('grass', '{G}'), energy('fire', '{R}'), energy('water', '{W}')]
    const without = state({ active: inPlay(basic('x')), hand, deck: [basic('target')] })
    expect(keys(play('Ultra Ball', without, goalOnly)[0].hand)).toEqual(['water', 'target'])

    const withOgerpon = state({ active: inPlay(basic('x')), hand, deck: [ogerpon] })
    const results = play('Ultra Ball', withOgerpon, goalOnly)
    expect(results.every((r) => keys(r.hand).includes('grass'))).toBe(true)
  })

  it('gives up on an engine whose Pokémon cannot fit on the bench', () => {
    // Lunatone is in hand but the bench is full, so Lunar Cycle can never run
    // and its Energy is not worth a search.
    const s = state({
      active: inPlay(basic('Solrock', 110, { type: '{F}' })),
      bench: Array.from({ length: 5 }, (_, i) => inPlay(basic(`b${i}`))),
      hand: [basic('Lunatone', 110, { type: '{F}' })],
      deck: [energy('fighting', '{F}')],
    })
    expect(fetched(play('Fighting Gong', s, goalOnly), s)).toEqual([])
  })

  it('still prefers the goal card when the effect only takes one', () => {
    const s = state({ hand: [], deck: [meowth, exMon('target')] })
    const results = play('Poké Pad', s, goalOnly)
    // Poké Pad cannot take a Rule Box Pokémon, so neither is offered...
    expect(fetched(results, s)).toEqual([])
    // ...but Cyrano can, and the goal's card comes first.
    const cyrano = play('Cyrano', state({ deck: [meowth, exMon('target'), supporter] }), goalOnly)
    expect(keys(cyrano[0].hand)).toEqual(['target', 'Meowth ex'])
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
    // Only worth playing to bring in the goal's Active.
    const results = play('Switch', s, ctx({ activeKey: 'x' }))
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
  it.each(['Unfair Stamp', 'Special Red Card', "Boss's Orders", "Ciphermaniac's Codebreaking"])(
    '%s is deliberately not implemented',
    (name) => {
      // Each is impossible or pointless on turn 1 — being inert is correct, not
      // a gap. Implementing them would be wrong, not merely unnecessary.
      expect(lookupEffect(trainer(name, 'item'))).toBeUndefined()
    },
  )
})

describe('searching only the top of the deck', () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => trainer(`filler ${i}`, 'item'))
  const lillie = trainer("Lillie's Determination", 'supporter')
  const handKeys = (results: SimState[]) => results.map((r) => keys(r.hand))

  it('Pokégear 3.0 takes a Supporter from the top 7', () => {
    const s = state({ deck: [...filler(6), lillie, ...filler(5)] })
    const results = play('Pokégear 3.0', s)
    expect(handKeys(results)).toEqual([["lillie's-determination"]])
    // The rest is shuffled back, so nothing else is lost.
    expect(results[0].deck).toHaveLength(11)
  })

  it('Pokégear 3.0 misses a Supporter sitting eighth', () => {
    const s = state({ deck: [...filler(7), lillie] })
    const results = play('Pokégear 3.0', s)
    expect(handKeys(results)).toEqual([[]])
    expect(results[0].deck).toHaveLength(8)
  })

  it('Pokégear 3.0 leaves an unwanted Supporter once the turn has had one', () => {
    const s = state({ deck: [lillie, ...filler(6)], usedSupporter: true })
    expect(handKeys(play('Pokégear 3.0', s))).toEqual([[]])
    // ...unless the goal wants it in hand.
    const wanted = ctx({ relevant: new Set(["lillie's-determination"]) })
    expect(handKeys(play('Pokégear 3.0', s, wanted))).toEqual([["lillie's-determination"]])
  })

  it('Bug Catching Set takes up to 2 Grass Pokémon or Grass Energy from the top 7', () => {
    const s = state({
      deck: [
        basic('bud', 60, { type: '{G}' }),
        basic('fire', 60, { type: '{R}' }),
        energy('grass', '{G}'),
        energy('grass', '{G}'),
        ...filler(3),
        basic('late', 60, { type: '{G}' }),
      ],
    })
    const taken = handKeys(play('Bug Catching Set', s)).map((hand) => [...hand].sort().join('+'))
    expect(taken).toEqual(
      expect.arrayContaining(['bud', 'grass', 'bud+grass', 'grass+grass']),
    )
    // Never a Fire Pokémon, and never the Grass Pokémon below the top 7.
    expect(taken.some((t) => t.includes('fire') || t.includes('late'))).toBe(false)
  })

  it('Bug Catching Set never takes two of a card the top holds only once', () => {
    const s = state({ deck: [basic('bud', 60, { type: '{G}' }), ...filler(6)] })
    expect(handKeys(play('Bug Catching Set', s))).toEqual([['bud']])
  })
})

describe('Roto-Stick', () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => trainer(`filler ${i}`, 'item'))
  const lillie = trainer("Lillie's Determination", 'supporter')
  const judge = trainer('Judge', 'supporter')

  it('takes every Supporter in the top 4, and nothing below', () => {
    const s = state({ deck: [lillie, ...filler(2), judge, trainer('Boss', 'supporter')] })
    const [after] = play('Roto-Stick', s)
    expect(keys(after.hand).sort()).toEqual(['judge', "lillie's-determination"])
    expect(after.deck).toHaveLength(3)
  })
})

describe('Rare Candy', () => {
  const dreepy = basic('Dreepy', 70, { type: '{P}' })
  const dragapult = card('Dragapult ex', ['pokemon', 'stage2', 'ex'], {
    name: 'Dragapult ex',
    prev: 'Drakloak',
    rule: 'Pokémon ex',
  })
  const lines = ctx({
    relevant: new Set(['Dragapult ex']),
    prevOf: new Map([
      ['drakloak', 'dreepy'],
      ['dragapult ex', 'drakloak'],
    ]),
  })
  const settled = { ...inPlay(dreepy), fresh: false }

  it('does nothing on a first turn', () => {
    const s = state({ active: settled, hand: [dragapult] })
    expect(play('Rare Candy', s, lines)).toEqual([s])
  })

  it('evolves a Basic straight to its Stage 2 from turn 2', () => {
    const s = state({ active: settled, hand: [dragapult], turn: 2 })
    const [after] = play('Rare Candy', s, lines)
    expect(after.active?.card.key).toBe('Dragapult ex')
    expect(after.hand).toHaveLength(0)
  })

  it('cannot touch a Basic put into play this turn', () => {
    const s = state({ active: inPlay(dreepy), hand: [dragapult], turn: 2 })
    expect(play('Rare Candy', s, lines)).toEqual([s])
  })
})

describe('fetching a Supporter nobody named', () => {
  it('takes one the simulator can play, never a card that would do nothing', () => {
    const s = state({ deck: [trainer("Boss's Orders", 'supporter'), trainer('Judge', 'supporter'), ...Array.from({ length: 5 }, (_, i) => trainer(`f${i}`, 'item'))] })
    const results = play('Pokégear 3.0', s, ctx({ wantsAnyBench: false, wantsEnergy: false }))
    expect(results.map((r) => keys(r.hand))).toEqual([['judge']])
  })
})
