import { describe, expect, it } from 'vitest'

import { abilityOf, useAbility } from '../src/lib/sim/abilities'
import { attack, attackOf } from '../src/lib/sim/attacks'
import { summarizeStep } from '../src/lib/sim/describe'
import { lookupEffect, type EffectContext } from '../src/lib/sim/effects'
import { ACTIVE_TARGET, inPlay, type SimState } from '../src/lib/sim/state'
import type { CardRecord, DeckCard } from '../src/lib/types'

// The search cards added for a Metal deck — Genesect ex, Metang, Brock's
// Scouting, Drilbur and Piplup — and the replay's picture of each play.

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
const metalStage1 = (key: string) => card(key, ['pokemon', 'stage1'], { name: key, type: '{M}' })
const metal = () => card('metal', ['energy', 'basic-energy'], { name: 'Metal Energy', type: '{M}' })
const filler = (i: number) => card(`filler${i}`, ['item'], { name: `filler${i}` })

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
const move = (name: string, effect = '') => ({ name, cost: '{C}', damage: '', effect })

describe('Abilities belong to the printings that have them', () => {
  it('ignores a Metang without Metal Maker', () => {
    const withIt = basic('Metang', { moves: [move('[Ability] Metal Maker')] })
    const without = basic('Metang', { moves: [move('Metal Claw')] })
    expect(abilityOf(withIt)?.ability).toBe('Metal Maker')
    expect(abilityOf(without)).toBeUndefined()
  })
})

describe("Genesect ex's Metallic Signal", () => {
  it('takes two Evolution {M} Pokémon, copies included, and nothing else', () => {
    const s = state({
      active: inPlay(basic('Genesect ex')),
      deck: [metalStage1('metang'), metalStage1('metang'), basic('beldum', { type: '{M}' })],
    })
    const boards = useAbility(s, ACTIVE_TARGET, ctx({ relevant: new Set(['metang', 'beldum']) }))
    expect(boards.map((b) => keys(b.hand))).toEqual([['metang', 'metang']])
  })
})

describe("Metang's Metal Maker", () => {
  const metang = basic('Metang')

  it('attaches the Metal Energy among the top four and sends the rest to the bottom', () => {
    const s = state({
      active: inPlay(metang),
      deck: [metal(), filler(1), metal(), filler(2), filler(3)],
    })
    const c = ctx({ wantsEnergy: true, energyTargets: new Set(['Metang']) })
    const [board] = useAbility(s, ACTIVE_TARGET, c)
    expect(board.active!.energy).toHaveLength(2)
    expect(board.deck.map((card) => card.key)).toEqual(['filler3', 'filler1', 'filler2'])
    // What it saw, and what it took, for the replay.
    expect(board.look?.seen).toHaveLength(4)
    expect(board.look?.chosen).toHaveLength(2)
  })

  it('takes nothing when the Energy counts nowhere, and still digs', () => {
    const s = state({
      active: inPlay(metang),
      deck: [metal(), filler(1), filler(2), filler(3), filler(4)],
    })
    const [board] = useAbility(s, ACTIVE_TARGET, ctx())
    expect(board.active!.energy).toHaveLength(0)
    expect(board.deck[0].key).toBe('filler4')
    expect(board.look?.chosen).toEqual([])
  })
})

describe("Brock's Scouting", () => {
  it('takes two Basics, or one Evolution, never both', () => {
    const effect = lookupEffect(card('brocks', ['supporter'], { name: "Brock's Scouting" }))!
    const s = state({ deck: [basic('beldum'), basic('drilbur'), metalStage1('metang')] })
    const c = ctx({ relevant: new Set(['beldum', 'drilbur', 'metang']) })
    const hands = effect(s, c).map((b) => keys(b.hand))
    expect(hands).toContainEqual(['beldum', 'drilbur'])
    expect(hands).toContainEqual(['metang'])
    expect(hands.some((hand) => hand.includes('metang') && hand.length > 1)).toBe(false)
  })
})

describe('Call for Family', () => {
  it('benches up to two, as Drilbur prints it', () => {
    const drilbur = basic('Drilbur', {
      moves: [
        move(
          'Call for Family',
          'Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.',
        ),
      ],
    })
    expect(attackOf(drilbur)?.name).toBe('Call for Family')
    const s = state({ active: inPlay(drilbur), deck: [basic('a'), basic('b')] })
    const boards = attack(s, ctx({ relevant: new Set(['a', 'b']) }))
    expect(Math.max(...boards.map((b) => b.bench.length))).toBe(2)
    expect(boards.every((b) => b.attacked)).toBe(true)
  })

  it('benches one, as Eevee prints it', () => {
    const eevee = basic('Eevee', {
      moves: [
        move(
          'Call for Family',
          'Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.',
        ),
      ],
    })
    const s = state({ active: inPlay(eevee), deck: [basic('a'), basic('b')] })
    const boards = attack(s, ctx({ relevant: new Set(['a', 'b']) }))
    expect(Math.max(...boards.map((b) => b.bench.length))).toBe(1)
  })
})

describe('Call for Support', () => {
  it('takes a Supporter the simulator can play', () => {
    const piplup = basic('Piplup', { moves: [move('Call for Support')] })
    const petrel = card('petrel', ['supporter'], { name: "Team Rocket's Petrel" })
    const boss = card('boss', ['supporter'], { name: "Boss's Orders" })
    const s = state({ active: inPlay(piplup), deck: [boss, petrel] })
    expect(attack(s, ctx()).map((b) => keys(b.hand))).toEqual([['petrel']])
  })
})

describe('step summaries', () => {
  it('show the card played and what it brought', () => {
    const ball = card('ball', ['item'], { name: 'Ultra Ball' })
    const before = state({ hand: [ball] })
    const after = state({ hand: [basic('metang')], discard: [ball] })
    const summary = summarizeStep(before, after, { kind: 'playItem', handIndex: 0 })
    expect(summary.actor?.cardKey).toBe('ball')
    expect(summary.result.map((c) => c.cardKey)).toEqual(['metang'])
    expect(summary.looked).toBeUndefined()
  })

  it('show every card a look saw, with the ones taken flagged', () => {
    const before = state({
      active: inPlay(basic('Metang')),
      deck: [metal(), filler(1), metal(), filler(2), filler(3)],
    })
    const c = ctx({ wantsEnergy: true, energyTargets: new Set(['Metang']) })
    const [after] = useAbility(before, ACTIVE_TARGET, c)
    const summary = summarizeStep(before, after, { kind: 'useAbility', target: ACTIVE_TARGET })
    expect(summary.actor?.cardKey).toBe('Metang')
    expect(summary.result.map((c) => c.cardKey)).toEqual(['metal', 'metal'])
    expect(summary.looked?.map((entry) => entry.chosen)).toEqual([true, false, true, false])
  })
})
