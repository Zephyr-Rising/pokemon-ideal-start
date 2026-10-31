import { describe, expect, it } from 'vitest'

import cardDb from '../src/data/cards.json'
import '../src/lib/sim/actions'
import { abilityOf, useAbility } from '../src/lib/sim/abilities'
import { attack, attackAvailable, registeredAttackTexts } from '../src/lib/sim/attacks'
import { lookupEffect, type EffectContext } from '../src/lib/sim/effects'
import { ACTIVE_TARGET, inPlay, type SimState } from '../src/lib/sim/state'
import type { CardRecord, DeckCard } from '../src/lib/types'

// The table of "search your deck" cards (src/lib/sim/searches.ts).

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

const basic = (key: string, over: Partial<CardRecord> = {}) =>
  card(key, ['pokemon', 'basic'], { name: key, ...over })
const energy = (type: string) =>
  card(`energy${type}`, ['energy', 'basic-energy'], { type, name: `${type} Energy` })
const trainer = (name: string, kind: string) => card(name, [kind], { name })
const attacker = (name: string, text: string, cost = '{C}', over: Partial<CardRecord> = {}) =>
  basic(name, { moves: [{ name: 'Search', cost, damage: '', effect: text }], ...over })

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
    wantsAnyBench: false,
    wantsEnergy: false,
    energyTypes: new Set<string>(),
    energyTargets: new Set<string>(),
    activeKey: null,
    rng: () => 0.5,
    seed: 1,
    ...over,
  }
}

const keys = (cards: DeckCard[]) => cards.map((c) => c.key).sort()
const play = (name: string, kind: string, s: SimState, c: EffectContext) =>
  lookupEffect(trainer(name, kind))!(s, c)

describe('the table', () => {
  it('registers only texts that a real card prints, word for word', () => {
    const printed = new Set(
      cardDb.cards.flatMap((c) =>
        (c.moves ?? []).map((move) => move.effect.replace(/\s+/g, ' ').trim()),
      ),
    )
    const missing = registeredAttackTexts().filter((text) => !printed.has(text))
    expect(missing).toEqual([])
  })
})

describe('Energy from the deck, attached', () => {
  const kagura =
    'Search your deck for a Basic {G} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.'

  it('puts it on a Pokémon it counts on, not just the attacker', () => {
    const ogerpon = attacker('Teal Mask Ogerpon', kagura)
    const s = state({ active: inPlay(ogerpon), bench: [inPlay(basic('target'))], deck: [energy('{G}')] })
    const boards = attack(s, ctx({ wantsEnergy: true, energyTargets: new Set(['target']) }))
    expect(boards).toHaveLength(1)
    expect(boards[0].bench[0].energy).toHaveLength(1)
    expect(boards[0].attacked).toBe(true)
  })

  it('takes the type the goal asks for first', () => {
    const altaria = attacker(
      'Altaria',
      'Search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.',
    )
    const s = state({ active: inPlay(altaria), deck: [energy('{R}'), energy('{R}'), energy('{W}')] })
    const [board] = attack(s, ctx({ wantsEnergy: true, energyTypes: new Set(['{W}']) }))
    expect(keys(board.active!.energy)).toEqual(['energy{R}', 'energy{W}'])
  })

  it("Misty's Vitality ends the turn", () => {
    const s = state({ active: inPlay(basic('a')), deck: [energy('{W}'), energy('{W}')] })
    const boards = play("Misty's Vitality", 'supporter', s, ctx({ wantsEnergy: true }))
    expect(boards[0].active!.energy).toHaveLength(2)
    expect(boards[0].attacked).toBe(true)
  })
})

describe('Pokémon and Trainers into the hand', () => {
  it('Master Ball takes a Pokémon the goal names', () => {
    const s = state({ deck: [basic('wanted'), basic('other')] })
    const boards = play('Master Ball', 'item', s, ctx({ relevant: new Set(['wanted']) }))
    expect(boards.map((b) => keys(b.hand))).toEqual([['wanted']])
  })

  it('an attack for up to 3 Pokémon takes three different ones first', () => {
    const kirlia = attacker(
      'Kirlia',
      'Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.',
    )
    const s = state({ active: inPlay(kirlia), deck: [basic('a'), basic('a'), basic('b'), basic('c')] })
    const [board] = attack(s, ctx({ relevant: new Set(['a', 'b', 'c']) }))
    expect(keys(board.hand)).toEqual(['a', 'b', 'c'])
  })

  it('Call Bell works only going second, on the first turn', () => {
    const deck = [trainer("Team Rocket's Petrel", 'supporter')]
    expect(play('Call Bell', 'item', state({ deck, turn: 1 }), ctx())).toHaveLength(1)
    expect(play('Call Bell', 'item', state({ deck, turn: 1, cannotAttack: true }), ctx())).toEqual([])
    expect(play('Call Bell', 'item', state({ deck, turn: 2 }), ctx())).toEqual([])
  })
})

describe('Pokémon onto the Bench', () => {
  it('up to 3 offers each stopping point', () => {
    const chatot = attacker(
      'Chatot',
      'Search your deck for up to 3 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.',
    )
    const s = state({ active: inPlay(chatot), deck: [basic('a'), basic('b'), basic('c')] })
    const boards = attack(s, ctx({ relevant: new Set(['a', 'b', 'c']) }))
    expect(boards.map((b) => b.bench.length)).toEqual([1, 2, 3])
  })

  it('a first-turn attack may be used going first', () => {
    const volbeat = attacker(
      'Volbeat',
      'If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.',
    )
    const plain = attacker(
      'Falinks',
      'Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.',
    )
    const first = { turn: 1, cannotAttack: true }
    // Each with its {C} paid.
    const ready = (pokemon: DeckCard) => ({ ...inPlay(pokemon), energy: [energy('{G}')] })
    expect(attackAvailable(state({ ...first, active: ready(volbeat) }))).toBe(true)
    expect(attackAvailable(state({ ...first, active: ready(plain) }))).toBe(false)
  })
})

describe('evolving from the deck', () => {
  it('Ascension evolves the attacker, even one played this turn', () => {
    const dwebble = attacker(
      'Dwebble',
      'Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.',
    )
    const crustle = card('Crustle', ['pokemon', 'stage1'], { name: 'Crustle', prev: 'Dwebble' })
    const s = state({ active: { ...inPlay(dwebble), fresh: true }, deck: [crustle] })
    const [board] = attack(s, ctx({ relevant: new Set(['Crustle']) }))
    expect(board.active!.card.key).toBe('Crustle')
  })
})

describe('coin flips', () => {
  it('are fair: the same game and flip count give the same result', () => {
    const s = state({ deck: [basic('wanted')] })
    const c = ctx({ relevant: new Set(['wanted']) })
    const once = play('Poké Ball', 'item', s, c).map((b) => keys(b.hand))
    const again = play('Poké Ball', 'item', s, c).map((b) => keys(b.hand))
    expect(again).toEqual(once)
    // The flip is counted, so the next one is a fresh flip.
    expect(play('Poké Ball', 'item', s, c)[0].coins).toBe(1)
  })
})

describe('Abilities from the table', () => {
  it("Mamoswine ex's Mammoth Hauler takes a Pokémon", () => {
    const mamoswine = basic('Mamoswine ex', {
      moves: [{ name: '[Ability] Mammoth Hauler', cost: '', damage: '', effect: '' }],
    })
    expect(abilityOf(mamoswine)?.ability).toBe('Mammoth Hauler')
    const s = state({ active: inPlay(mamoswine), deck: [basic('wanted')] })
    const boards = useAbility(s, ACTIVE_TARGET, ctx({ relevant: new Set(['wanted']) }))
    expect(boards.map((b) => keys(b.hand))).toEqual([['wanted']])
  })
})
