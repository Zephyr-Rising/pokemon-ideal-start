import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { removeSlotEnergy, setPartPriority } from '../src/lib/board/edit'
import {
  emptyGoal,
  energyPriorityId,
  scoreBoard,
  usedPriorities,
  type BoardView,
  type FieldGoal,
} from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import { playtest } from '../src/lib/sim/playtest'
import { boardRequirements, prizeLocks } from '../src/lib/sim/prizes'
import { turnsTest } from '../src/lib/sim/turns'

const slot = (id: string, cardKey: string) => ({ id, cardKey, energy: [], tools: [] })
const board = (active: string | null, bench: string[]): BoardView => ({
  active: active ? { cardKey: active, energy: [], tools: [] } : null,
  bench: bench.map((cardKey) => ({ cardKey, energy: [], tools: [] })),
  stadiumKey: null,
  hand: [],
})

// Dreepy Active is essential, Budew benched important, Munkidori nice to have.
let g: FieldGoal = { ...emptyGoal(), active: slot('a', 'dreepy'), bench: [slot('b', 'budew'), slot('c', 'munki')] }
g = setPartPriority(g, 'b:card', 2)
g = setPartPriority(g, 'c:card', 3)

describe('priority levels', () => {
  const tier = (view: BoardView) => scoreBoard(g, view, (k) => k).tier

  it('is the highest level with every part at or above it in place', () => {
    expect(tier(board(null, ['budew', 'munki']))).toBe(0)
    expect(tier(board('dreepy', []))).toBe(1)
    expect(tier(board('dreepy', ['munki']))).toBe(1)
    expect(tier(board('dreepy', ['budew']))).toBe(2)
    expect(tier(board('dreepy', ['budew', 'munki']))).toBe(3)
  })

  it('lists the levels a goal uses', () => {
    expect(usedPriorities(g)).toEqual([1, 2, 3])
    expect(usedPriorities({ ...emptyGoal(), active: slot('a', 'dreepy') })).toEqual([1])
  })

  it('stores only what differs from essential', () => {
    expect(setPartPriority(g, 'b:card', 1).priorities).toEqual({ 'c:card': 3 })
  })
})

describe('priorities and the prizes', () => {
  const cards = resolveDeck(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dragapult-munkidori.txt'), 'utf8'),
  ).cards
  const key = (l: string) => cards.find((c) => c.label === l)!.key
  const fez = cards.find((c) => c.label === 'Fezandipiti ex')!
  const lab = (k: string) => cards.find((c) => c.key === k)?.label ?? k
  const deck = cards.flatMap((c) => Array.from({ length: c.count }, () => c))

  it('only rules a game out when an essential part is impossible', () => {
    let goal: FieldGoal = { ...emptyGoal(), active: slot('a', key('Dreepy')), bench: [slot('f', key('Fezandipiti ex'))] }
    expect(prizeLocks(boardRequirements(goal, cards, lab, 1), deck, [fez])).toEqual(['Fezandipiti ex'])
    goal = setPartPriority(goal, 'f:card', 3)
    // Fezandipiti prized is now only a lost "nice to have".
    expect(prizeLocks(boardRequirements(goal, cards, lab, 1), deck, [fez])).toEqual([])
    expect(prizeLocks(boardRequirements(goal, cards, lab), deck, [fez])).toEqual(['Fezandipiti ex'])
  })

  it('reports each level, the essential level at least as often as the whole board', () => {
    let goal: FieldGoal = {
      ...emptyGoal(),
      active: slot('a', key('Dreepy')),
      bench: [slot('m', key('Munkidori')), slot('f', key('Fezandipiti ex'))],
    }
    goal = setPartPriority(goal, 'f:card', 3)
    const result = playtest(cards, goal, lab, { trials: 150, seed: 4 })
    const essential = result.tiers.find((t) => t.priority === 1)!.rate
    const whole = result.tiers.find((t) => t.priority === 3)!.rate
    expect(whole).toBeCloseTo(result.strict, 10)
    expect(essential).toBeGreaterThan(whole)
  })

  it('reports each level over turns too', () => {
    let goal: FieldGoal = { ...emptyGoal(), active: slot('a', key('Drakloak')), bench: [slot('f', key('Fezandipiti ex'))] }
    goal = setPartPriority(goal, 'f:card', 3)
    const result = turnsTest(cards, goal, lab, { trials: 30, seed: 3 })
    const essential = result.tiers.find((t) => t.priority === 1)!
    const whole = result.tiers.find((t) => t.priority === 3)!
    expect(whole.reached).toBeCloseTo(result.reached, 10)
    expect(essential.reached).toBeGreaterThanOrEqual(whole.reached)
  }, 120_000)
})

describe('priorities for individual Energy', () => {
  // Three Grass on Ogerpon: two essential, the third nice to have.
  let g: FieldGoal = {
    ...emptyGoal(),
    active: { id: 'a', cardKey: 'oger', energy: ['{G}', '{G}', '{G}'], tools: [] },
  }
  g = setPartPriority(g, energyPriorityId('a', 2), 3)
  const withEnergy = (n: number): BoardView => ({
    active: { cardKey: 'oger', energy: Array.from({ length: n }, () => '{G}'), tools: [] },
    bench: [],
    stadiumKey: null,
    hand: [],
  })
  const score = (n: number) => scoreBoard(g, withEnergy(n), (k) => k)

  it('scores each level cumulatively', () => {
    const parts = score(0).parts.filter((p) => p.kind === 'activeEnergy')
    expect(parts.map((p) => [p.label, p.priority])).toEqual([
      ['2 Grass Energy on the Active', 1],
      ['3 Grass Energy on the Active', 3],
    ])
    expect(score(1).tier).toBe(0)
    expect(score(2).tier).toBe(2)
    expect(score(3).tier).toBe(3)
  })

  it('keeps an older whole-Energy priority as the default', () => {
    const old = { ...emptyGoal(), active: { id: 'a', cardKey: 'oger', energy: ['{G}'], tools: [] }, priorities: { 'a:energy': 2 as const } }
    expect(scoreBoard(old, withEnergy(0), (k) => k).parts.find((p) => p.kind === 'activeEnergy')!.priority).toBe(2)
  })

  it('moves each Energy\'s priority down when an earlier one is removed', () => {
    const after = removeSlotEnergy(g, 'a', 0)
    expect(after.priorities?.[energyPriorityId('a', 1)]).toBe(3)
    expect(after.priorities?.[energyPriorityId('a', 2)]).toBeUndefined()
  })
})
