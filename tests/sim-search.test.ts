import { describe, expect, it } from 'vitest'

import { emptyGoal, type FieldGoal, type SlotGoal } from '../src/lib/board/goal'
import type { ActionContext } from '../src/lib/sim/actions'
import { buildContext } from '../src/lib/sim/context'
import { searchBestLine } from '../src/lib/sim/search'
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
  return { key, label: key, resolvedName: key, count: 1, card: record, printings: [], tags }
}

const basic = (key: string, retreat = 0) =>
  card(key, ['pokemon', 'basic'], { retreat, name: key })
const energy = (key: string, type = '{G}') =>
  card(key, ['energy', 'basic-energy'], { type, name: key })
const tool = (key: string) => card(key, ['tool'], { name: key })

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

const slot = (id: string, cardKey: string, energyCount = 0): SlotGoal => ({
  id,
  cardKey,
  energy: energyCount,
  energyType: null,
  tools: [],
})

const goal = (over: Partial<FieldGoal> = {}): FieldGoal => ({ ...emptyGoal(), ...over })

const label = (key: string) => key

function run(s: SimState, g: FieldGoal, over: Partial<ActionContext> = {}) {
  const ctx: ActionContext = { ...buildContext(g, () => 0.5), ...over }
  return searchBestLine(s, g, ctx, label)
}

describe('reachability', () => {
  it('reaches a goal the hand can plainly make', () => {
    const s = state({ hand: [basic('dreepy'), basic('budew')] })
    const result = run(s, goal({ active: slot('a', 'dreepy'), bench: [slot('b', 'budew')] }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toEqual(['placeActive', 'bench'])
  })

  it('picks the right Basic for the Active Spot', () => {
    // Both are Basics; only one satisfies the goal, so the search must not
    // simply take the first.
    const s = state({ hand: [basic('budew'), basic('dreepy')] })
    const result = run(s, goal({ active: slot('a', 'dreepy') }))
    expect(result.score.strict).toBe(true)
  })

  it('scores zero when the cards simply are not there', () => {
    const s = state({ hand: [basic('budew')] })
    const result = run(s, goal({ active: slot('a', 'dreepy') }))
    expect(result.score.strict).toBe(false)
    expect(result.score.closeness).toBe(0)
  })

  it('retreats to put the goal Pokémon in the Active Spot', () => {
    // Dreepy must start on the bench (budew is the only other Basic), so the
    // only route is to bench dreepy and retreat into it.
    const s = state({ hand: [basic('budew'), basic('dreepy')] })
    const result = run(s, goal({ active: slot('a', 'dreepy'), bench: [slot('b', 'budew')] }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toContain('retreat')
  })

  it('cannot swap the Active when the retreat cost is unpayable', () => {
    // Already mid-turn with 'heavy' Active and no Energy on it, so the only
    // route to a dreepy Active is a retreat it cannot pay for.
    const stuck = state({ active: inPlay(basic('heavy', 3)), bench: [inPlay(basic('dreepy'))] })
    expect(run(stuck, goal({ active: slot('a', 'dreepy') })).score.strict).toBe(false)
  })

  it('swaps the Active when the retreat is free', () => {
    const free = state({ active: inPlay(basic('light', 0)), bench: [inPlay(basic('dreepy'))] })
    const result = run(free, goal({ active: slot('a', 'dreepy') }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toEqual(['retreat'])
  })

  it('attaches Energy where the goal asked for it', () => {
    const s = state({ hand: [basic('dreepy'), energy('e')] })
    const result = run(s, goal({ active: slot('a', 'dreepy', 1) }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toContain('attachEnergy')
  })

  it('cannot attach two Energy in one turn', () => {
    const s = state({ hand: [basic('dreepy'), energy('e1'), energy('e2')] })
    const result = run(s, goal({ active: slot('a', 'dreepy', 2) }))
    expect(result.score.strict).toBe(false)
    // The Pokémon part is still met — only the Energy part fails.
    expect(result.score.parts.filter((p) => p.met)).toHaveLength(1)
  })
})

describe('hand goals', () => {
  it('is met by simply not playing the card', () => {
    const s = state({ hand: [basic('dreepy'), tool('belt')] })
    const result = run(
      s,
      goal({ active: slot('a', 'dreepy'), inHand: [{ id: 'h', cardKey: 'belt', count: 1 }] }),
    )
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).not.toContain('attachTool')
  })
})

describe('monotonicity', () => {
  it('adding a part can never make the goal easier', () => {
    const s = state({ hand: [basic('dreepy'), basic('budew'), energy('e')] })
    const small = run(s, goal({ active: slot('a', 'dreepy') }))
    const large = run(
      s,
      goal({ active: slot('a', 'dreepy'), bench: [slot('b', 'missing')] }),
    )
    expect(small.score.strict).toBe(true)
    expect(large.score.strict).toBe(false)
  })

  it('an empty goal is met by any board', () => {
    const result = run(state({ hand: [basic('dreepy')] }), emptyGoal())
    expect(result.score.strict).toBe(true)
    expect(result.line).toEqual([])
  })
})

describe('budget', () => {
  it('reports when the budget cut the search short', () => {
    const s = state({
      hand: [basic('a'), basic('b'), basic('c'), basic('d'), energy('e1'), energy('e2')],
    })
    const g = goal({ active: slot('x', 'nothing') })
    const ctx: ActionContext = { ...buildContext(g, () => 0.5), wantsAnyBench: true }
    const tiny = searchBestLine(s, g, ctx, label, { maxNodes: 3 })
    expect(tiny.exhausted).toBe(false)
    expect(tiny.nodes).toBeLessThanOrEqual(3)
  })

  it('stops as soon as the goal is fully met', () => {
    const s = state({ hand: [basic('dreepy'), basic('x'), basic('y'), energy('e')] })
    const result = run(s, goal({ active: slot('a', 'dreepy') }))
    expect(result.score.strict).toBe(true)
    // It should not have wandered through the whole tree to find a one-move goal.
    expect(result.nodes).toBeLessThan(10)
  })

  it('collapses lines that reach the same board', () => {
    // Benching b then c reaches the same board as c then b; the signature must
    // make that one node rather than two subtrees.
    const s = state({ hand: [basic('a'), basic('b'), basic('c')] })
    const result = run(s, goal({ active: slot('x', 'nothing') }))
    expect(result.exhausted).toBe(true)
    expect(result.nodes).toBeLessThan(40)
  })
})

describe('engine plays', () => {
  it('uses Fighting Gong to fuel Lunar Cycle when the goal names neither', () => {
    // The goal Pokémon is only reachable through Lunar Cycle's draw 3, and the
    // only Basic {F} Energy for it to discard is in the deck.
    const lunatone = card('lunatone', ['pokemon', 'basic'], { name: 'Lunatone', type: '{F}' })
    const solrock = card('solrock', ['pokemon', 'basic'], { name: 'Solrock', type: '{F}' })
    const gong = card('fighting-gong', ['item'], { name: 'Fighting Gong' })
    const s = state({
      hand: [lunatone, solrock, gong],
      deck: [basic('filler1'), energy('fighting', '{F}'), basic('filler2'), basic('target')],
    })
    const result = run(s, goal({ bench: [slot('t', 'target')] }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toContain('useAbility')
  })
})
