import { describe, expect, it } from 'vitest'

import {
  abilityAvailable,
  abilityOf,
  onBenchPlay,
  useAbility,
} from '../src/lib/sim/abilities'
import { applyAction, legalActions } from '../src/lib/sim/actions'
import { describeStep } from '../src/lib/sim/describe'
import { lookupEffect, type EffectContext } from '../src/lib/sim/effects'
import { ACTIVE_TARGET, inPlay, retreatCost, type SimState } from '../src/lib/sim/state'
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

/** A Pokémon whose canonical name drives the Ability lookup. */
const mon = (name: string, over: Partial<CardRecord> = {}) =>
  card(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ['pokemon', 'basic'], { name, ...over })

const energy = (type: string) =>
  card(`energy${type}`, ['energy', 'basic-energy'], { type, name: `${type} Energy` })

const supporter = (name: string) =>
  card(name.toLowerCase().replace(/\s+/g, '-'), ['supporter'], { name })

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

const deckOf = (n: number) => Array.from({ length: n }, (_, i) => card(`filler${i}`, ['item']))

describe('Run Errand (Mega Kangaskhan ex)', () => {
  const kang = mon('Mega Kangaskhan ex')

  it('draws 2 from the Active Spot', () => {
    const s = state({ active: inPlay(kang), deck: deckOf(5) })
    expect(abilityAvailable(s, ACTIVE_TARGET)).toBe(true)
    const [after] = useAbility(s, ACTIVE_TARGET, ctx())
    expect(after.hand).toHaveLength(2)
    expect(after.deck).toHaveLength(3)
  })

  it('does nothing from the bench', () => {
    const s = state({ active: inPlay(mon('Other')), bench: [inPlay(kang)], deck: deckOf(5) })
    expect(abilityAvailable(s, 0)).toBe(false)
  })

  it('is capped across copies, not per Pokémon', () => {
    // "You can't use more than 1 Run Errand Ability each turn" — a second copy
    // on the bench does not get its own use.
    const s = state({ active: inPlay(kang), bench: [inPlay(kang)], deck: deckOf(6) })
    const [after] = useAbility(s, ACTIVE_TARGET, ctx())
    expect(abilityAvailable(after, ACTIVE_TARGET)).toBe(false)
    expect(after.usedAbilities).toContain('mega kangaskhan ex')
  })

  it('draws fewer rather than failing on a near-empty deck', () => {
    const s = state({ active: inPlay(kang), deck: deckOf(1) })
    const [after] = useAbility(s, ACTIVE_TARGET, ctx())
    expect(after.hand).toHaveLength(1)
    expect(after.deck).toHaveLength(0)
  })
})

describe('Lunar Cycle (Lunatone)', () => {
  // Both halves of the pair are {F}: Lunatone discards a Basic {F} Energy, and
  // Solrock only has to be in play.
  const lunatone = mon('Lunatone', { type: '{F}' })
  const solrock = mon('Solrock', { type: '{F}' })

  it('needs Solrock in play', () => {
    const without = state({ active: inPlay(lunatone), hand: [energy('{F}')], deck: deckOf(5) })
    expect(abilityAvailable(without, ACTIVE_TARGET)).toBe(false)

    const withIt = state({
      active: inPlay(lunatone),
      bench: [inPlay(solrock)],
      hand: [energy('{F}')],
      deck: deckOf(5),
    })
    expect(abilityAvailable(withIt, ACTIVE_TARGET)).toBe(true)
  })

  it('needs a Basic {F} Energy in hand, not just any Energy', () => {
    const s = state({
      active: inPlay(lunatone),
      bench: [inPlay(solrock)],
      hand: [energy('{P}')],
      deck: deckOf(5),
    })
    expect(abilityAvailable(s, ACTIVE_TARGET)).toBe(false)
  })

  it('discards the Energy and draws 3', () => {
    const s = state({
      active: inPlay(lunatone),
      bench: [inPlay(solrock)],
      hand: [energy('{F}')],
      deck: deckOf(5),
    })
    const [after] = useAbility(s, ACTIVE_TARGET, ctx())
    expect(after.discard).toHaveLength(1)
    expect(after.hand).toHaveLength(3)
    expect(after.deck).toHaveLength(2)
  })

  it('gives Solrock no Ability of its own', () => {
    // The real card has only the Cosmic Beam attack. Its whole turn-1 job is
    // being on the board to switch Lunar Cycle on.
    expect(abilityOf(solrock)).toBeUndefined()
  })
})

describe('Teal Dance (Teal Mask Ogerpon ex)', () => {
  const ogerpon = mon('Teal Mask Ogerpon ex', { type: '{G}' })

  it('attaches a Grass Energy and draws, without using the turn attachment', () => {
    const s = state({ active: inPlay(ogerpon), hand: [energy('{G}')], deck: deckOf(3) })
    const [after] = useAbility(s, ACTIVE_TARGET, ctx())
    expect(after.active!.energy).toHaveLength(1)
    expect(after.hand).toHaveLength(1)
    // The manual attachment for the turn is still available.
    expect(after.usedEnergy).toBe(false)
  })

  it('needs a Grass Energy specifically', () => {
    const s = state({ active: inPlay(ogerpon), hand: [energy('{R}')], deck: deckOf(3) })
    expect(abilityAvailable(s, ACTIVE_TARGET)).toBe(false)
  })
})

describe('Abilities that fire when a Pokémon is benched', () => {
  it("Meowth ex's Last-Ditch Catch fetches a Supporter, and declining is offered too", () => {
    const meowth = mon('Meowth ex')
    const cyrano = supporter('Cyrano')
    const s = state({
      active: inPlay(mon('Other')),
      bench: [inPlay(meowth)],
      deck: [cyrano, ...deckOf(3)],
    })
    const boards = onBenchPlay(s, 0, ctx())
    // One board per Supporter it could take, plus the one where it declined.
    expect(boards).toHaveLength(2)
    expect(boards[0].hand.map((c) => c.key)).toContain('cyrano')
    expect(boards[1].hand).toHaveLength(0)
  })

  it("Iron Leaves ex's Rapid Vernier switches itself to the Active Spot", () => {
    const iron = mon('Iron Leaves ex')
    const other = mon('Other')
    const s = state({ active: inPlay(other), bench: [inPlay(iron)] })
    const boards = onBenchPlay(s, 0, ctx())
    expect(boards[0].active!.card.key).toBe(iron.key)
    expect(boards[0].bench[0].card.key).toBe(other.key)
    // Declining leaves the board as it was.
    expect(boards[1].active!.card.key).toBe(other.key)
  })

  it('is not offered as an at-will action', () => {
    const s = state({ active: inPlay(mon('Other')), bench: [inPlay(mon('Meowth ex'))] })
    expect(abilityAvailable(s, 0)).toBe(false)
  })
})

describe("Subjugating Chains (Pecharunt ex)", () => {
  const pecharunt = mon('Pecharunt ex', { type: '{D}' })

  it('switches in a benched Dark Pokémon, but never another Pecharunt ex', () => {
    const dark = mon('Darkrai', { type: '{D}' })
    const s = state({
      active: inPlay(pecharunt),
      bench: [inPlay(pecharunt), inPlay(dark)],
    })
    const boards = useAbility(s, ACTIVE_TARGET, ctx())
    expect(boards).toHaveLength(1)
    expect(boards[0].active!.card.key).toBe(dark.key)
  })

  it('is unusable with no Dark Pokémon to switch to', () => {
    const s = state({ active: inPlay(pecharunt), bench: [inPlay(mon('Grass', { type: '{G}' }))] })
    expect(abilityAvailable(s, ACTIVE_TARGET)).toBe(false)
  })
})

describe('Skyliner (Latias ex)', () => {
  it('makes every Basic retreat free while it is in play', () => {
    const heavy = inPlay(mon('Heavy', { retreat: 3 }))
    const without = state({ active: heavy, bench: [inPlay(mon('Light'))] })
    expect(retreatCost(without, heavy)).toBe(3)

    const withLatias = state({
      active: heavy,
      bench: [inPlay(mon('Latias ex', { type: '{C}' }))],
    })
    expect(retreatCost(withLatias, heavy)).toBe(0)
  })
})

describe('Fighting Gong', () => {
  const gong = card('fighting-gong', ['item'], { name: 'Fighting Gong' })

  it('can take either a Basic {F} Energy or a Basic {F} Pokémon', () => {
    // Both halves feed the same engine, so the choice has to be branched on
    // rather than resolved: the Energy is what Lunar Cycle discards, and the
    // Pokémon can be the Solrock that switches Lunar Cycle on.
    const fightingEnergy = energy('{F}')
    const solrock = mon('Solrock', { type: '{F}' })
    const s = state({ hand: [gong], deck: [fightingEnergy, solrock, ...deckOf(2)] })

    // Called directly, so the Gong is still in hand - the action layer is what
    // discards a played Item. What matters is what each branch fetched.
    const boards = lookupEffect(gong)!(s, ctx())
    const fetched = boards.flatMap((b) => b.hand.map((c) => c.key)).filter((k) => k !== gong.key)
    expect(fetched).toContain(fightingEnergy.key)
    expect(fetched).toContain(solrock.key)
  })

  it('ignores Energy and Pokémon of other types', () => {
    const s = state({
      hand: [gong],
      deck: [energy('{P}'), mon('Grass Mon', { type: '{G}' }), ...deckOf(2)],
    })
    const boards = lookupEffect(gong)!(s, ctx())
    // Nothing eligible, so the one outcome is the unchanged board.
    expect(boards).toHaveLength(1)
    expect(boards[0].hand.map((c) => c.key)).toEqual([gong.key])
  })
})

describe('describing a bench play', () => {
  const bench = { kind: 'bench' as const, handIndex: 0 }

  it('reports a switch only when the Active actually changes', () => {
    const iron = mon('Iron Leaves ex')
    const other = mon('Other')
    const s = state({ hand: [iron], active: inPlay(other) })
    const [switched] = applyAction(s, bench, ctx())
    expect(describeStep(s, switched, bench)).toContain('switching it to the Active Spot')
  })

  it('does not claim a switch when a second copy of the Active is benched', () => {
    // Copies share a card key, so a naive "is the arriving card now Active?"
    // test reads benching a duplicate as a switch. Nothing moved.
    const kang = mon('Mega Kangaskhan ex')
    const s = state({ hand: [kang], active: inPlay(kang) })
    const [after] = applyAction(s, bench, ctx())
    const step = describeStep(s, after, bench)
    expect(step).not.toContain('switching')
    expect(step).toBe(`Bench ${kang.label}`)
  })
})

describe('Attract Customers (Tatsugiri)', () => {
  const tatsugiri = mon('Tatsugiri', { type: '{N}' })
  const lillie = card("lillie's-determination", ['supporter'], { name: "Lillie's Determination" })

  it('only works from the Active Spot', () => {
    const s = state({ active: inPlay(mon('x')), bench: [inPlay(tatsugiri)], deck: [lillie] })
    expect(abilityAvailable(s, 0)).toBe(false)
    const active = state({ active: inPlay(tatsugiri), deck: [lillie] })
    expect(abilityAvailable(active, ACTIVE_TARGET)).toBe(true)
  })

  it('takes a Supporter from the top 6, and only the top 6', () => {
    const hit = state({ active: inPlay(tatsugiri), deck: [...deckOf(5), lillie] })
    expect(useAbility(hit, ACTIVE_TARGET, ctx()).map((r) => r.hand.map((c) => c.key))).toEqual([
      ["lillie's-determination"],
    ])

    const miss = state({ active: inPlay(tatsugiri), deck: [...deckOf(6), lillie] })
    expect(useAbility(miss, ACTIVE_TARGET, ctx()).map((r) => r.hand.length)).toEqual([0])
  })
})

describe('Abilities of evolved Pokémon', () => {
  const stage1 = (name: string, prev: string) =>
    card(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), ['pokemon', 'stage1'], { name, prev })

  it('Drakloak keeps one of the top two and bottoms the other, once per copy', () => {
    const drakloak = stage1('Drakloak', 'Dreepy')
    const [a, b] = deckOf(2)
    const s = state({
      active: { ...inPlay(drakloak), fresh: false },
      bench: [{ ...inPlay(drakloak), fresh: false }],
      deck: [a, b, ...deckOf(3).map((c) => ({ ...c, key: `${c.key}-rest` }))],
    })
    const results = useAbility(s, ACTIVE_TARGET, ctx())
    expect(results.map((r) => r.hand[0].key).sort()).toEqual([a.key, b.key].sort())
    for (const r of results) expect(r.deck[r.deck.length - 1].key).not.toBe(r.hand[0].key)
    // The benched copy can still use its own.
    expect(abilityAvailable(results[0], ACTIVE_TARGET)).toBe(false)
    expect(abilityAvailable(results[0], 0)).toBe(true)
  })

  it('Dudunsparce draws 3 and shuffles itself and its attachments away', () => {
    const dudunsparce = stage1('Dudunsparce', 'Dunsparce')
    const s = state({
      active: inPlay(mon('x')),
      bench: [{ ...inPlay(dudunsparce), energy: [energy('{G}')] }],
      deck: deckOf(5),
    })
    const [after] = useAbility(s, 0, ctx())
    expect(after.hand).toHaveLength(3)
    expect(after.bench).toHaveLength(0)
    // 5 - 3 drawn + Dudunsparce + its Energy.
    expect(after.deck).toHaveLength(4)
  })

  it('Dudunsparce in the Active Spot needs someone to take its place', () => {
    const dudunsparce = stage1('Dudunsparce', 'Dunsparce')
    const alone = state({ active: inPlay(dudunsparce), deck: deckOf(5) })
    expect(abilityAvailable(alone, ACTIVE_TARGET)).toBe(false)
    const withBench = state({ active: inPlay(dudunsparce), bench: [inPlay(mon('y'))], deck: deckOf(5) })
    const [after] = useAbility(withBench, ACTIVE_TARGET, ctx())
    expect(after.active?.card.key).toBe('y')
  })

  it("N's Zoroark ex discards one to draw two", () => {
    const zoroark = stage1("N's Zoroark ex", "N's Zorua")
    const s = state({ active: inPlay(zoroark), hand: [energy('{D}')], deck: deckOf(4) })
    const [after] = useAbility(s, ACTIVE_TARGET, ctx())
    expect(after.discard).toHaveLength(1)
    expect(after.hand).toHaveLength(2)
  })

  it('Psychic Draw fires as Kadabra and Alakazam are played to evolve, not at will', () => {
    const kadabra = stage1('Kadabra', 'Abra')
    const s = state({ active: inPlay(kadabra), deck: deckOf(5) })
    expect(abilityAvailable(s, ACTIVE_TARGET)).toBe(false)
  })
})

describe('Boom Boom Groove (Thwackey)', () => {
  const festivalLead = { name: '[Ability] Festival Lead', cost: '', damage: '', effect: '' }
  const dipplin = card('dipplin', ['pokemon', 'stage1'], { name: 'Dipplin', moves: [festivalLead] })
  const thwackey = card('thwackey', ['pokemon', 'stage1'], { name: 'Thwackey', prev: 'Grookey' })
  const target = card('target', ['item'], { name: 'target' })
  const wanted = ctx({ relevant: new Set(['target']) })

  it('needs a Festival Lead Pokémon in the Active Spot', () => {
    const without = state({ active: inPlay(mon('x')), bench: [inPlay(thwackey)], deck: [target] })
    expect(abilityAvailable(without, 0)).toBe(false)
    const withLead = state({ active: inPlay(dipplin), bench: [inPlay(thwackey)], deck: [target] })
    expect(abilityAvailable(withLead, 0)).toBe(true)
  })

  it('searches the whole deck for what the board wants, then shuffles', () => {
    const s = state({ active: inPlay(dipplin), bench: [inPlay(thwackey)], deck: [...deckOf(30), target] })
    const results = useAbility(s, 0, wanted)
    expect(results.map((r) => r.hand.map((c) => c.key))).toEqual([['target']])
    expect(results[0].deck).toHaveLength(30)
    expect(results[0].shuffles).toBe(1)
  })

  it('each Thwackey has its own', () => {
    const s = state({
      active: inPlay(dipplin),
      bench: [inPlay(thwackey), inPlay(thwackey)],
      deck: [target, target],
    })
    const [after] = useAbility(s, 0, wanted)
    expect(abilityAvailable(after, 0)).toBe(false)
    expect(abilityAvailable(after, 1)).toBe(true)
  })

  it('is not a play when there is nothing worth taking', () => {
    const s = state({ active: inPlay(dipplin), bench: [inPlay(thwackey)], deck: deckOf(5), usedSupporter: true })
    expect(useAbility(s, 0, ctx({ wantsAnyBench: false, wantsEnergy: false }))).toEqual([])
  })
})

describe('Traverse Time (Celebi), an attack that searches', () => {
  const traverse = { name: 'Traverse Time', cost: '{G}', damage: '', effect: '' }
  const celebi = mon('Celebi', { type: '{G}', moves: [traverse] })
  const grassMon = (name: string, prev = '') =>
    card(name.toLowerCase(), ['pokemon', prev ? 'stage1' : 'basic'], { name, type: '{G}', prev })
  const applin = grassMon('Applin')
  const dipplin = grassMon('Dipplin', 'Applin')
  const chikorita = grassMon('Chikorita')
  const fire = card('fire-mon', ['pokemon', 'basic'], { name: 'Fire Mon', type: '{R}' })
  const wanted = ctx({ relevant: new Set(['applin', 'dipplin', 'chikorita', 'fire-mon']) })
  const powered = () => ({ ...inPlay(celebi), energy: [energy('{G}')] })
  const legal = (s: SimState, c = wanted) =>
    legalActions(s, { ...c, wantsAnyBench: false } as never).map((a) => a.kind)

  it('needs its Energy cost on the Active Pokémon', () => {
    expect(legal(state({ active: inPlay(celebi), deck: [applin] }))).not.toContain('attack')
    expect(legal(state({ active: powered(), deck: [applin] }))).toContain('attack')
  })

  it('cannot be used by the player going first on their first turn', () => {
    expect(legal(state({ active: powered(), deck: [applin], cannotAttack: true }))).not.toContain('attack')
  })

  it('takes up to three Grass Pokémon, the next stage of a line in play first, and ends the turn', () => {
    const s = state({
      active: powered(),
      bench: [{ ...inPlay(applin), fresh: false }],
      deck: [fire, chikorita, dipplin, ...deckOf(3)],
    })
    const [after] = applyAction(s, { kind: 'attack' }, wanted as never)
    expect(after.hand.map((c) => c.key)).toEqual(['dipplin', 'chikorita'])
    expect(after.attacked).toBe(true)
    expect(legal(after)).toEqual(['end'])
  })
})

describe('Ripening Charge (Hydrapple ex) and Teal Dance per copy', () => {
  const hydrapple = mon('Hydrapple ex', { type: '{G}' })
  const ogerpon = mon('Teal Mask Ogerpon ex', { type: '{G}' })

  it('attaches a Grass Energy from hand to a Pokémon the goal wants it on', () => {
    const s = state({
      active: inPlay(hydrapple),
      bench: [inPlay(ogerpon)],
      hand: [energy('{G}')],
    })
    const c = ctx({ wantsEnergy: true, energyTargets: new Set([ogerpon.key]) })
    const results = useAbility(s, ACTIVE_TARGET, c)
    expect(results).toHaveLength(1)
    expect(results[0].bench[0].energy).toHaveLength(1)
    // On top of the turn's own attachment.
    expect(results[0].usedEnergy).toBe(false)
  })

  it('lets each Ogerpon use its own Teal Dance in the same turn', () => {
    const s = state({
      active: inPlay(ogerpon),
      bench: [inPlay(ogerpon)],
      hand: [energy('{G}'), energy('{G}')],
      deck: deckOf(4),
    })
    const [after] = useAbility(s, ACTIVE_TARGET, ctx())
    expect(abilityAvailable(after, ACTIVE_TARGET)).toBe(false)
    expect(abilityAvailable(after, 0)).toBe(true)
  })
})
