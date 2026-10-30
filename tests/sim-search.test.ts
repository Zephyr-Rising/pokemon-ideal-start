import { describe, expect, it } from 'vitest'

import { emptyGoal, type FieldGoal, type SlotGoal } from '../src/lib/board/goal'
import type { ActionContext } from '../src/lib/sim/actions'
import { buildContext } from '../src/lib/sim/context'
import { searchBestLine } from '../src/lib/sim/search'
import { legalActions } from '../src/lib/sim/actions'
import { useAbility } from '../src/lib/sim/abilities'
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
  energy: Array<string | null>(energyCount).fill(null),
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
    // Budew is already Active, so the only route is to bench Dreepy and
    // retreat into it.
    const s = state({ active: inPlay(basic('budew')), hand: [basic('dreepy')] })
    const result = run(s, goal({ active: slot('a', 'dreepy'), bench: [slot('b', 'budew')] }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toEqual(['bench', 'retreat'])
  })

  it('starts with the goal Pokémon rather than retreating into it', () => {
    // Either opening reaches the board; starting with Dreepy takes fewer plays.
    const s = state({ hand: [basic('budew'), basic('dreepy')] })
    const result = run(s, goal({ active: slot('a', 'dreepy'), bench: [slot('b', 'budew')] }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toEqual(['placeActive', 'bench'])
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

describe('moving Energy around', () => {
  const grass = (key: string) => card(key, ['energy', 'basic-energy'], { type: '{G}', name: 'Grass Energy' })
  const energySwitch = card('energy-switch', ['item'], { name: 'Energy Switch' })

  it('uses Energy Switch to move a Teal Dance Energy where the goal wants it', () => {
    // Two Energy on x needs Teal Dance's extra attachment, which only goes on
    // Ogerpon itself, so Energy Switch has to carry it across.
    const ogerpon = card('ogerpon', ['pokemon', 'basic', 'ex'], {
      name: 'Teal Mask Ogerpon ex',
      type: '{G}',
      retreat: 1,
    })
    const s = state({
      active: inPlay(ogerpon),
      hand: [basic('x', 1), grass('g1'), grass('g2'), energySwitch],
      deck: [card('d', ['item'])],
    })
    const result = run(s, goal({ bench: [{ ...slot('b', 'x'), energy: ['{G}', '{G}'] }] }))
    expect(result.score.strict).toBe(true)
    expect(result.steps.some((step) => step.includes('energy-switch'))).toBe(true)
  })

  it('attaches Energy to the Active to pay its retreat, even when the goal wants none', () => {
    const s = state({ active: inPlay(basic('a', 1)), hand: [basic('y', 1), grass('g1')] })
    const result = run(s, goal({ active: slot('t', 'y') }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toEqual(['bench', 'attachEnergy', 'retreat'])
  })
})

describe('the turn\'s Energy attachment', () => {
  const grass = (key: string) => card(key, ['energy', 'basic-energy'], { type: '{G}', name: 'Grass Energy' })

  it('is used even when the board asks for no Energy', () => {
    const s = state({ active: inPlay(basic('dreepy')), hand: [grass('g')] })
    const result = run(s, goal({ active: slot('a', 'dreepy') }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toEqual(['attachEnergy'])
    expect(result.finalState.active?.energy).toHaveLength(1)
    expect(result.steps).toEqual(['Attach g to dreepy'])
  })

  it('goes on the earlier stage of a Pokémon the board wants Energy on', () => {
    // Energy stays through evolution, so the Dreepy that becomes Dragapult ex
    // is where it belongs, even with another Pokémon Active.
    const dreepy = card('dreepy', ['pokemon', 'basic'], { name: 'Dreepy', retreat: 0 })
    const drakloak = card('drakloak', ['pokemon', 'stage1'], { name: 'Drakloak', prev: 'Dreepy' })
    const dragapult = card('dragapult', ['pokemon', 'stage2'], { name: 'Dragapult ex', prev: 'Drakloak' })
    const g = goal({ active: slot('a', 'dragapult'), bench: [] })
    g.active!.energy = ['{G}']
    const ctx: ActionContext = buildContext(g, () => 0.5, 1, [dreepy, drakloak, dragapult])
    const s = state({ active: inPlay(basic('budew')), bench: [inPlay(dreepy)], hand: [grass('g')] })
    const result = searchBestLine(s, g, ctx, label)
    expect(result.finalState.bench[0].energy).toHaveLength(1)
    expect(result.finalState.active?.energy).toHaveLength(0)
  })

  it('leaves an Energy the board wants kept in hand', () => {
    const s = state({ active: inPlay(basic('dreepy')), hand: [grass('g')] })
    const result = run(s, goal({ inHand: [{ id: 'h', cardKey: 'g', count: 1 }] }))
    expect(result.score.strict).toBe(true)
    expect(result.line).toEqual([])
  })
})

describe('Tools on the board', () => {
  it('attaches a Tool the board asks for', () => {
    const belt = tool('belt')
    const s = state({ active: inPlay(basic('dreepy')), hand: [belt] })
    const result = run(s, goal({ active: { ...slot('a', 'dreepy'), tools: ['belt'] } }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toEqual(['attachTool'])
  })

  it('fetches one with a search card', () => {
    const belt = tool('belt')
    const pad = card('secret-box', ['item'], { name: 'Secret Box' })
    const s = state({
      active: inPlay(basic('dreepy')),
      hand: [pad, basic('x'), basic('y'), basic('z')],
      deck: [belt, basic('filler')],
    })
    const result = run(s, goal({ active: { ...slot('a', 'dreepy'), tools: ['belt'] } }))
    expect(result.score.strict).toBe(true)
  })
})

describe('Telepathic Psychic Energy', () => {
  const telepathic = card('telepathic', ['energy', 'special-energy'], {
    name: 'Telepathic Psychic Energy',
    effect:
      'As long as this card is attached to a Pokémon, it provides {P} Energy. When you attach this card from your hand to a {P} Pokémon, search your deck for up to 2 Basic {P} Pokémon and put them onto your Bench. Then, shuffle your deck.',
  })
  const psychic = (key: string) => card(key, ['pokemon', 'basic'], { name: key, type: '{P}' })

  it('benches two Basic Psychic Pokémon when attached to a Psychic Pokémon', () => {
    // The goal wants no Energy at all: the attachment is worth it for the search.
    const s = state({
      active: inPlay(psychic('abra')),
      hand: [telepathic],
      deck: [psychic('ralts'), psychic('munna'), basic('filler')],
    })
    const result = run(s, goal({ bench: [slot('r', 'ralts'), slot('m', 'munna')] }))
    expect(result.score.strict).toBe(true)
    expect(result.line.map((a) => a.kind)).toEqual(['attachEnergy'])
    expect(result.steps[0]).toMatch(/benching/)
  })

  it('does nothing extra on a Pokémon that is not Psychic', () => {
    const s = state({
      active: inPlay(basic('grassy')),
      hand: [telepathic],
      deck: [psychic('ralts'), psychic('munna')],
    })
    const result = run(s, goal({ bench: [slot('r', 'ralts')] }))
    expect(result.score.strict).toBe(false)
  })
})

describe('cards in hand at the end of the turn', () => {
  const grass = (key: string) => card(key, ['energy', 'basic-energy'], { type: '{G}', name: 'Grass Energy' })

  it('keeps cards rather than spend them below the count', () => {
    // Four in hand meets "at least 4"; the turn's Energy would drop it to 3.
    const s = state({ active: inPlay(basic('dreepy')), hand: [grass('g'), basic('a'), basic('b'), basic('c')] })
    const result = run(s, goal({ active: slot('a', 'dreepy'), handMin: 4 }))
    expect(result.score.strict).toBe(true)
    expect(result.finalState.hand).toHaveLength(4)
  })

  it('draws to reach it', () => {
    const lillie = card('lillie', ['supporter'], { name: "Lillie's Determination" })
    const s = state({
      active: inPlay(basic('dreepy')),
      hand: [lillie],
      deck: Array.from({ length: 12 }, (_, i) => basic(`d${i}`)),
      prizes: Array.from({ length: 6 }, (_, i) => basic(`p${i}`)),
    })
    const result = run(s, goal({ active: slot('a', 'dreepy'), handMin: 6 }))
    expect(result.score.strict).toBe(true)
    expect(result.finalState.hand.length).toBeGreaterThanOrEqual(6)
  })
})

describe('Enriching Energy', () => {
  const enriching = card('enriching', ['energy', 'special-energy'], {
    name: 'Enriching Energy',
    effect:
      'As long as this card is attached to a Pokémon, it provides {C} Energy. When you attach this card from your hand to a Pokémon, draw 4 cards.',
  })

  it('draws 4 when attached, and is attached for the draw alone', () => {
    // The goal needs a Pokémon that is fifth from the top: only the draw finds it.
    const s = state({
      active: inPlay(basic('dreepy')),
      hand: [enriching],
      deck: [basic('a'), basic('b'), basic('c'), basic('target'), basic('e')],
    })
    const result = run(s, goal({ bench: [slot('t', 'target')] }))
    expect(result.score.strict).toBe(true)
    expect(result.steps[0]).toBe('Attach enriching to dreepy — drawing 4')
  })

  it('is offered on one Pokémon only when the draw is the only reason', () => {
    const s = state({
      active: inPlay(basic('x')),
      bench: [inPlay(basic('y')), inPlay(basic('z'))],
      hand: [enriching],
      deck: [basic('a'), basic('b')],
    })
    const ctx = buildContext(goal({ bench: [slot('t', 'nothing-here')] }), () => 0.5)
    const attaches = legalActions(s, ctx).filter((a) => a.kind === 'attachEnergy')
    expect(attaches).toHaveLength(1)
  })

  it('goes back into the deck with Dudunsparce, to be drawn again', () => {
    const dudunsparce = card('dudunsparce', ['pokemon', 'stage1'], { name: 'Dudunsparce', prev: 'Dunsparce' })
    const s = state({
      active: inPlay(basic('x')),
      bench: [{ ...inPlay(dudunsparce), energy: [enriching] }],
      deck: [basic('a'), basic('b'), basic('c'), basic('d')],
    })
    const [after] = useAbility(s, 0, buildContext(goal({}), () => 0.5))
    expect(after.deck.map((c) => c.key)).toContain('enriching')
    expect(after.deck.map((c) => c.key)).toContain('dudunsparce')
  })
})

describe("Ciphermaniac's Codebreaking", () => {
  const cipher = card('cipher', ['supporter'], { name: "Ciphermaniac's Codebreaking" })
  const kangaskhan = card('kanga', ['pokemon', 'basic', 'ex'], { name: 'Mega Kangaskhan ex', rule: 'Mega Pokémon ex' })
  // The two Pokémon the goal wants are deep in the deck.
  const deck = () => [...Array.from({ length: 8 }, (_, i) => card(`junk${i}`, ['item'], { name: `junk${i}` })), basic('x'), basic('y')]

  it('puts the two cards it finds on top of the deck', async () => {
    const { lookupEffect } = await import('../src/lib/sim/effects')
    const s = state({ deck: deck() })
    const results = lookupEffect(cipher)!(s, buildContext(goal({ bench: [slot('a', 'x'), slot('b', 'y')] }), () => 0.5))
    expect(results.some((r) => r.deck[0].key === 'x' && r.deck[1].key === 'y')).toBe(true)
    expect(results.every((r) => r.deck.length === 10)).toBe(true)
  })

  it('becomes a two-card search with a draw after it', () => {
    // Run Errand draws 2 from the Active Spot: Codebreaking stacks exactly them.
    const s = state({ active: inPlay(kangaskhan), hand: [cipher], deck: deck() })
    const result = run(s, goal({ bench: [slot('a', 'x'), slot('b', 'y')] }))
    expect(result.score.strict).toBe(true)
    const kinds = result.line.map((a) => a.kind)
    expect(kinds.slice(0, 2)).toEqual(['playSupporter', 'useAbility'])
  })

  it('is left out when nothing draws after it', () => {
    const s = state({ active: inPlay(basic('plain')), hand: [cipher], deck: deck() })
    const result = run(s, goal({ bench: [slot('a', 'x')] }))
    expect(result.line.map((a) => a.kind)).not.toContain('playSupporter')
  })
})
