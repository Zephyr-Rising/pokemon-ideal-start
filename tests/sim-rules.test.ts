import { describe, expect, it } from 'vitest'

import { ACTIVE_TARGET, applyAction, draw, legalActions, type ActionContext } from '../src/lib/sim/actions'
import {
  BASE_BENCH,
  benchCap,
  cloneState,
  inPlay,
  retreatCost,
  signature,
  toBoardView,
  type SimState,
} from '../src/lib/sim/state'
import type { CardRecord, DeckCard } from '../src/lib/types'

/** A deck card built to order, so the rules can be tested without real data. */
function card(
  key: string,
  tags: string[],
  over: Partial<CardRecord> = {},
): DeckCard {
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

const basic = (key: string, retreat = 0, tags: string[] = []) =>
  card(key, ['pokemon', 'basic', ...tags], { retreat, name: key })
const energy = (key: string, type = '{G}') =>
  card(key, ['energy', 'basic-energy'], { type, name: key })
const item = (key: string) => card(key, ['item'], { name: key })
const supporter = (key: string) => card(key, ['supporter'], { name: key })
const stadium = (key: string) => card(key, ['stadium'], { name: key })
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

/**
 * A context that asks for everything, so these tests exercise the rules rather
 * than the goal-driven pruning. Pruning has its own tests below.
 */
const ctx: ActionContext = {
  relevant: new Set<string>(['belt', 'cape', 'arena', 'new-arena', 'balloon']),
  wantsAnyBench: true,
  wantsEnergy: true,
  energyTypes: new Set<string>(),
  // Empty means "anywhere will do".
  energyTargets: new Set<string>(),
  activeKey: 'any',
  rng: () => 0.5,
  seed: 1,
}

const kinds = (s: SimState) => legalActions(s, ctx).map((a) => a.kind)
const only = (s: SimState, action: ReturnType<typeof legalActions>[number]) =>
  applyAction(s, action, ctx)[0]

describe('pre-game placement', () => {
  it('offers only Basics for the Active Spot, and nothing else until one is placed', () => {
    const s = state({ hand: [basic('dreepy'), item('ultra'), energy('grass')] })
    const actions = legalActions(s, ctx)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toEqual({ kind: 'placeActive', handIndex: 0 })
  })

  it('branches once per distinct Basic, not once per copy', () => {
    const s = state({ hand: [basic('dreepy'), basic('dreepy'), basic('budew')] })
    const actions = legalActions(s, ctx)
    expect(actions).toHaveLength(2)
  })

  it('has no legal play at all when the hand holds no Basic', () => {
    // Such a hand is a mulligan and never reaches the simulator, but the rules
    // must not invent a play for it.
    expect(legalActions(state({ hand: [item('ultra')] }), ctx)).toEqual([])
  })
})

describe('once-per-turn limits', () => {
  const base = () =>
    state({
      active: inPlay(basic('dreepy')),
      hand: [energy('grass'), energy('fire'), supporter('judge'), stadium('arena')],
    })

  it('allows only one Energy attachment', () => {
    const s = base()
    expect(kinds(s)).toContain('attachEnergy')
    const after = only(s, { kind: 'attachEnergy', handIndex: 0, target: ACTIVE_TARGET })
    expect(after.usedEnergy).toBe(true)
    expect(kinds(after)).not.toContain('attachEnergy')
  })

  it('allows only one Stadium', () => {
    const s = base()
    const after = only(s, { kind: 'playStadium', handIndex: 3 })
    expect(after.usedStadium).toBe(true)
    expect(kinds(after)).not.toContain('playStadium')
  })

  it('refuses a Stadium with the same name as the one already out', () => {
    const s = state({
      active: inPlay(basic('dreepy')),
      hand: [stadium('arena')],
      stadium: stadium('arena'),
      usedStadium: false,
    })
    expect(kinds(s)).not.toContain('playStadium')
  })

  it('discards the Stadium it replaces', () => {
    const s = state({
      active: inPlay(basic('dreepy')),
      hand: [stadium('new-arena')],
      stadium: stadium('old-arena'),
    })
    const after = only(s, { kind: 'playStadium', handIndex: 0 })
    expect(after.stadium?.key).toBe('new-arena')
    expect(after.discard.map((c) => c.key)).toEqual(['old-arena'])
  })
})

describe('bench', () => {
  it('caps at five without Area Zero Underdepths', () => {
    const s = state({
      active: inPlay(basic('dreepy')),
      bench: Array.from({ length: BASE_BENCH }, (_, i) => inPlay(basic(`b${i}`))),
      hand: [basic('extra')],
    })
    expect(benchCap(s)).toBe(BASE_BENCH)
    expect(kinds(s)).not.toContain('bench')
  })

  it('raises the cap to eight only with Area Zero Underdepths AND a Tera Pokémon', () => {
    const area = card('area', ['stadium'], { name: 'Area Zero Underdepths' })
    const withoutTera = state({ active: inPlay(basic('dreepy')), stadium: area })
    expect(benchCap(withoutTera)).toBe(BASE_BENCH)

    const withTera = state({
      active: inPlay(basic('ogerpon', 0, ['tera'])),
      stadium: area,
    })
    expect(benchCap(withTera)).toBe(8)
  })
})

describe('retreat', () => {
  it('is unavailable with an empty bench', () => {
    const s = state({ active: inPlay(basic('dreepy', 1)) })
    expect(kinds(s)).not.toContain('retreat')
  })

  it('is refused when the Energy cost cannot be paid', () => {
    const s = state({ active: inPlay(basic('heavy', 2)), bench: [inPlay(basic('light'))] })
    expect(kinds(s)).not.toContain('retreat')
  })

  it('pays the cost by discarding Energy, then swaps', () => {
    const active = inPlay(basic('heavy', 2))
    active.energy = [energy('e1'), energy('e2'), energy('e3')]
    const s = state({ active, bench: [inPlay(basic('light'))] })

    expect(kinds(s)).toContain('retreat')
    const after = only(s, { kind: 'retreat', benchIndex: 0 })
    expect(after.active?.card.key).toBe('light')
    expect(after.bench[0].card.key).toBe('heavy')
    // Two Energy paid, one left on the Pokémon that retreated.
    expect(after.bench[0].energy).toHaveLength(1)
    expect(after.discard).toHaveLength(2)
    expect(after.usedRetreat).toBe(true)
    expect(kinds(after)).not.toContain('retreat')
  })

  it('is free when a Tool cancels the cost', () => {
    const active = inPlay(basic('heavy', 2))
    active.tools = [card('balloon', ['tool'], { name: 'Air Balloon' })]
    const s = state({ active, bench: [inPlay(basic('light'))] })
    expect(retreatCost(s, active)).toBe(0)
    expect(kinds(s)).toContain('retreat')
  })
})

describe('tools', () => {
  it('allows one Tool per Pokémon', () => {
    const s = state({ active: inPlay(basic('dreepy')), hand: [tool('belt'), tool('cape')] })
    expect(kinds(s).filter((k) => k === 'attachTool').length).toBeGreaterThan(0)
    const after = only(s, { kind: 'attachTool', handIndex: 0, target: ACTIVE_TARGET })
    expect(after.active?.tools).toHaveLength(1)
    // The Active is now full, and with no bench there is nowhere else to put one.
    expect(kinds(after)).not.toContain('attachTool')
  })
})

describe('unimplemented Trainers', () => {
  it('are never offered as a play', () => {
    // Playing a card that does nothing can only lose it, so it is left out
    // rather than presented as a pointless option.
    const s = state({ active: inPlay(basic('dreepy')), hand: [item('mystery'), supporter('enigma')] })
    expect(kinds(s)).not.toContain('playItem')
    expect(kinds(s)).not.toContain('playSupporter')
  })
})

describe('goal-driven pruning', () => {
  // Plays that cannot bring the board closer to the goal are never generated.
  // This is what keeps the search tree small enough to be exhaustive in
  // practice, so it is worth pinning down.
  const narrow = (over: Partial<ActionContext>): ActionContext => ({
    relevant: new Set<string>(),
    wantsAnyBench: false,
    wantsEnergy: false,
    energyTypes: new Set<string>(),
    energyTargets: new Set<string>(),
    activeKey: null,
    rng: () => 0.5,
    seed: 1,
    ...over,
  })

  it('skips Energy attachment when the goal wants no Energy', () => {
    const s = state({ active: inPlay(basic('dreepy')), hand: [energy('grass')] })
    expect(legalActions(s, narrow({})).map((a) => a.kind)).not.toContain('attachEnergy')
    expect(
      legalActions(s, narrow({ wantsEnergy: true })).map((a) => a.kind),
    ).toContain('attachEnergy')
  })

  it('only attaches Energy to the Pokémon the goal named', () => {
    const s = state({
      active: inPlay(basic('wanted')),
      bench: [inPlay(basic('other'))],
      hand: [energy('grass')],
    })
    const actions = legalActions(
      s,
      narrow({ wantsEnergy: true, energyTargets: new Set(['wanted']) }),
    )
    const attaches = actions.filter((a) => a.kind === 'attachEnergy')
    expect(attaches).toHaveLength(1)
    expect(attaches[0]).toMatchObject({ target: ACTIVE_TARGET })
  })

  it('skips retreating when the goal does not name an Active', () => {
    const s = state({ active: inPlay(basic('a')), bench: [inPlay(basic('b'))] })
    expect(legalActions(s, narrow({})).map((a) => a.kind)).not.toContain('retreat')
    expect(legalActions(s, narrow({ activeKey: 'b' })).map((a) => a.kind)).toContain('retreat')
  })

  it('skips a Stadium the goal did not ask for', () => {
    const s = state({ active: inPlay(basic('a')), hand: [stadium('arena')] })
    expect(legalActions(s, narrow({})).map((a) => a.kind)).not.toContain('playStadium')
    expect(
      legalActions(s, narrow({ relevant: new Set(['arena']) })).map((a) => a.kind),
    ).toContain('playStadium')
  })

  it('treats bench space as a resource, benching only what a play needs', () => {
    const benched = (s: SimState, c: ActionContext) =>
      legalActions(s, c)
        .filter((a) => a.kind === 'bench')
        .map((a) => s.hand[(a as { handIndex: number }).handIndex].key)

    const s = state({ active: inPlay(basic('a')), hand: [basic('goal'), basic('spare')] })
    // Only the Pokémon the goal names...
    expect(benched(s, narrow({ relevant: new Set(['goal']) }))).toEqual(['goal'])
    // ...unless the goal wants bodies on the bench, when any Basic will do.
    expect(benched(s, narrow({ wantsAnyBench: true }))).toEqual(['goal', 'spare'])
  })

  it('benches a draw engine and its partner even when the goal names neither', () => {
    const lunatone = card('lunatone', ['pokemon', 'basic'], { name: 'Lunatone', type: '{F}' })
    const solrock = card('solrock', ['pokemon', 'basic'], { name: 'Solrock', type: '{F}' })
    const fighting = card('f', ['energy', 'basic-energy'], { name: 'f', type: '{F}' })
    const s = state({
      active: inPlay(basic('a')),
      hand: [lunatone, solrock, fighting, basic('spare')],
      deck: [basic('x'), basic('y'), basic('z')],
    })
    const kinds = legalActions(s, narrow({}))
      .filter((a) => a.kind === 'bench')
      .map((a) => s.hand[(a as { handIndex: number }).handIndex].key)
    expect(kinds).toEqual(['lunatone', 'solrock'])
  })

  it('still plays Area Zero Underdepths when the goal wants a big bench', () => {
    // It is the only way past five, so it matters even unnamed.
    const area = card('area', ['stadium'], { name: 'Area Zero Underdepths' })
    const s = state({ active: inPlay(basic('a')), hand: [area] })
    expect(
      legalActions(s, narrow({ wantsAnyBench: true })).map((a) => a.kind),
    ).toContain('playStadium')
  })
})

describe('evolution', () => {
  it('is never possible on turn 1', () => {
    // Everything in play was put there this turn, so no evolution card is
    // playable — the generator has no action for it at all.
    const s = state({
      active: inPlay(basic('dreepy')),
      hand: [card('drakloak', ['pokemon', 'stage1'], { prev: 'dreepy' })],
    })
    expect(kinds(s)).toEqual(['end'])
  })
})

describe('draw and board view', () => {
  it('draws off the top of the deck', () => {
    const s = state({ deck: [item('a'), item('b'), item('c')] })
    const after = draw(s, 2)
    expect(after.hand.map((c) => c.key)).toEqual(['a', 'b'])
    expect(after.deck.map((c) => c.key)).toEqual(['c'])
  })

  it('draws fewer rather than failing on an empty deck', () => {
    expect(draw(state({ deck: [item('a')] }), 5).hand).toHaveLength(1)
  })

  it('exposes the board in the shape the goal layer scores', () => {
    const active = inPlay(basic('dreepy'))
    active.energy = [energy('e', '{P}')]
    const s = state({ active, bench: [inPlay(basic('budew'))], hand: [item('x')] })
    expect(toBoardView(s)).toEqual({
      active: { cardKey: 'dreepy', energy: ['{P}'], tools: [] },
      bench: [{ cardKey: 'budew', energy: [], tools: [] }],
      stadiumKey: null,
      hand: ['x'],
    })
  })
})

describe('state identity', () => {
  it('treats hand and bench order as irrelevant', () => {
    const a = state({ hand: [item('x'), item('y')], bench: [inPlay(basic('p')), inPlay(basic('q'))] })
    const b = state({ hand: [item('y'), item('x')], bench: [inPlay(basic('q')), inPlay(basic('p'))] })
    expect(signature(a)).toBe(signature(b))
  })

  it('separates states that differ in what has been used', () => {
    const a = state({ active: inPlay(basic('p')) })
    const b = cloneState(a)
    b.usedSupporter = true
    expect(signature(a)).not.toBe(signature(b))
  })

  it('does not share mutable board arrays between clones', () => {
    const a = state({ active: inPlay(basic('p')) })
    const b = cloneState(a)
    b.active!.energy.push(energy('e'))
    expect(a.active!.energy).toHaveLength(0)
  })
})

describe('evolution from turn 2', () => {
  const evo = (key: string, prev: string, type = '', stage = 'stage1') =>
    card(key, ['pokemon', stage], { name: key, prev, type })
  const relevantTo = (...keys: string[]): ActionContext => ({ ...ctx, relevant: new Set(keys) })
  const evolves = (s: SimState, c: ActionContext) =>
    legalActions(s, c).filter((a) => a.kind === 'evolve').length

  it('needs a Pokémon that has been in play since an earlier turn', () => {
    const dreepy = basic('dreepy')
    const drakloak = evo('drakloak', 'dreepy')
    const settled = { ...inPlay(dreepy), fresh: false }
    // Turn 1: never.
    expect(evolves(state({ active: settled, hand: [drakloak] }), relevantTo('drakloak'))).toBe(0)
    // Turn 2, but the Dreepy only just arrived: still no.
    expect(evolves(state({ active: inPlay(dreepy), hand: [drakloak], turn: 2 }), relevantTo('drakloak'))).toBe(0)
    // Turn 2, a Dreepy from last turn: yes.
    expect(evolves(state({ active: settled, hand: [drakloak], turn: 2 }), relevantTo('drakloak'))).toBe(1)
  })

  it('lets Forest of Vitality evolve a Grass Pokémon the turn it arrives', () => {
    const forest = card('forest', ['stadium'], { name: 'Forest of Vitality' })
    const sprout = card('sprout', ['pokemon', 'basic'], { name: 'sprout', type: '{G}' })
    const bloom = evo('bloom', 'sprout', '{G}')
    const s = state({ active: inPlay(sprout), hand: [bloom], turn: 2, stadium: forest })
    expect(evolves(s, relevantTo('bloom'))).toBe(1)
    // ...but never on a first turn.
    expect(evolves({ ...s, turn: 1 }, relevantTo('bloom'))).toBe(0)
    // ...and only Grass into Grass.
    const fire = card('ember', ['pokemon', 'basic'], { name: 'ember', type: '{R}' })
    const blaze = evo('blaze', 'ember', '{R}')
    expect(evolves(state({ active: inPlay(fire), hand: [blaze], turn: 2, stadium: forest }), relevantTo('blaze'))).toBe(0)
  })

  it('evolves into a draw engine even when the goal does not name it', () => {
    const settled = { ...inPlay(basic('Dreepy')), fresh: false }
    const drakloak = evo('drakloak', 'Dreepy')
    drakloak.card!.name = 'Drakloak'
    const s = state({ active: settled, hand: [drakloak], turn: 2 })
    expect(evolves(s, relevantTo())).toBe(1)
  })
})
