import { beforeEach, describe, expect, it } from 'vitest'

import {
  addBench,
  addHand,
  clearActive,
  dropCard,
  placeActive,
  removeBench,
  removeHand,
  resetIds,
  setBenchMin,
  setSlotEnergy,
  setStadium,
} from '../src/lib/board/edit'
import { emptyGoal, goalIsEmpty } from '../src/lib/board/goal'

beforeEach(resetIds)

describe('placing cards', () => {
  it('replaces the Active rather than stacking them, keeping the slot', () => {
    const first = placeActive(emptyGoal(), 'a')
    const withEnergy = setSlotEnergy(first, first.active!.id, 2)
    const replaced = placeActive(withEnergy, 'b')

    expect(replaced.active?.cardKey).toBe('b')
    // The slot id is kept, so an Energy requirement set on it survives a swap.
    expect(replaced.active?.id).toBe(first.active!.id)
    expect(setSlotEnergy(replaced, replaced.active!.id, 2).active?.energy).toBe(2)
  })

  it('adds a bench slot per placement, including duplicates', () => {
    const goal = addBench(addBench(emptyGoal(), 'dreepy'), 'dreepy')
    expect(goal.bench).toHaveLength(2)
    expect(goal.bench.every((slot) => slot.cardKey === 'dreepy')).toBe(true)
  })

  it('removes by id, leaving the other copy', () => {
    const goal = addBench(addBench(emptyGoal(), 'dreepy'), 'budew')
    const after = removeBench(goal, goal.bench[0].id)
    expect(after.bench).toHaveLength(1)
    expect(after.bench[0].cardKey).toBe('budew')
  })

  it('counts a repeated hand card rather than duplicating the row', () => {
    const goal = addHand(addHand(emptyGoal(), 'boss'), 'boss')
    expect(goal.inHand).toHaveLength(1)
    expect(goal.inHand[0].count).toBe(2)
  })

  it('clears what it is asked to clear', () => {
    let goal = placeActive(emptyGoal(), 'a')
    goal = setStadium(goal, 'arena')
    goal = addHand(goal, 'boss')
    goal = clearActive(goal)
    goal = setStadium(goal, null)
    goal = removeHand(goal, goal.inHand[0].id)
    expect(goalIsEmpty(goal)).toBe(true)
  })
})

describe('limits', () => {
  it('keeps Energy within a sane range', () => {
    const goal = placeActive(emptyGoal(), 'a')
    const id = goal.active!.id
    expect(setSlotEnergy(goal, id, -3).active?.energy).toBe(0)
    expect(setSlotEnergy(goal, id, 99).active?.energy).toBe(6)
  })

  it('caps the bench minimum at the eight the game allows', () => {
    expect(setBenchMin(emptyGoal(), 99).benchMin).toBe(8)
    expect(setBenchMin(emptyGoal(), -1).benchMin).toBe(0)
  })

  it('sets Energy on a bench slot without touching the Active', () => {
    let goal = placeActive(emptyGoal(), 'a')
    goal = addBench(goal, 'b')
    goal = setSlotEnergy(goal, goal.bench[0].id, 2)
    expect(goal.bench[0].energy).toBe(2)
    expect(goal.active?.energy).toBe(0)
  })
})

describe('drops', () => {
  it('ignores a card that makes no sense in the zone', () => {
    // A Stadium is not a Pokémon, so it cannot take the Active Spot.
    const goal = dropCard(emptyGoal(), 'active', 'arena', false, true)
    expect(goal.active).toBeNull()
    // ...and a Pokémon is not a Stadium.
    expect(dropCard(emptyGoal(), 'stadium', 'dreepy', true, false).stadiumKey).toBeNull()
  })

  it('accepts anything into the hand zone', () => {
    // Holding a card at end of turn has no type restriction.
    expect(dropCard(emptyGoal(), 'hand', 'arena', false, true).inHand).toHaveLength(1)
  })

  it('routes a Pokémon to the zone it was dropped in', () => {
    expect(dropCard(emptyGoal(), 'active', 'dreepy', true, false).active?.cardKey).toBe('dreepy')
    expect(dropCard(emptyGoal(), 'bench', 'dreepy', true, false).bench).toHaveLength(1)
  })
})
