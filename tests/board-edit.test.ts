import { beforeEach, describe, expect, it } from 'vitest'

import {
  addBench,
  attachEnergyCard,
  addHand,
  clearActive,
  dropCard,
  placeActive,
  removeBench,
  removeHand,
  resetIds,
  setBenchMin,
  removeSlotEnergy,
  setStadium,
  slotTarget,
} from '../src/lib/board/edit'
import { emptyGoal, goalIsEmpty } from '../src/lib/board/goal'

beforeEach(resetIds)

describe('placing cards', () => {
  it('replaces the Active rather than stacking them, keeping the slot', () => {
    const first = placeActive(emptyGoal(), 'a')
    const withEnergy = attachEnergyCard(first, first.active!.id, '{G}')
    const replaced = placeActive(withEnergy, 'b')

    expect(replaced.active?.cardKey).toBe('b')
    // The slot id is kept, so Energy can still be attached to it after a swap;
    // the new Pokémon starts clean rather than inheriting the old one's Energy.
    expect(replaced.active?.id).toBe(first.active!.id)
    expect(replaced.active?.energy).toEqual([])
    expect(attachEnergyCard(replaced, replaced.active!.id, '{G}').active?.energy).toEqual(['{G}'])
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
    let goal = placeActive(emptyGoal(), 'a')
    const id = goal.active!.id
    for (let i = 0; i < 10; i++) goal = attachEnergyCard(goal, id, null)
    expect(goal.active?.energy).toHaveLength(6)
    // Removing past empty is harmless.
    expect(removeSlotEnergy(placeActive(emptyGoal(), 'a'), id, 0).active?.energy).toEqual([])
  })

  it('caps the bench minimum at the eight the game allows', () => {
    expect(setBenchMin(emptyGoal(), 99).benchMin).toBe(8)
    expect(setBenchMin(emptyGoal(), -1).benchMin).toBe(0)
  })

  it('sets Energy on a bench slot without touching the Active', () => {
    let goal = placeActive(emptyGoal(), 'a')
    goal = addBench(goal, 'b')
    goal = attachEnergyCard(goal, goal.bench[0].id, '{G}')
    expect(goal.bench[0].energy).toEqual(['{G}'])
    expect(goal.active?.energy).toEqual([])
  })
})

describe('drops', () => {
  const pokemon = (key: string) => ({
    key,
    isPokemon: true,
    isStadium: false,
    isEnergy: false,
    isTool: false,
    energyType: null,
  })
  const stadium = (key: string) => ({ ...pokemon(key), isPokemon: false, isStadium: true })
  const energy = (key: string, energyType: string | null) => ({
    ...pokemon(key),
    isPokemon: false,
    isEnergy: true,
    energyType,
  })
  const tool = (key: string) => ({ ...pokemon(key), isPokemon: false, isTool: true })

  it('ignores a card that makes no sense in the zone', () => {
    // A Stadium is not a Pokémon, so it cannot take the Active Spot.
    expect(dropCard(emptyGoal(), 'active', stadium('arena')).active).toBeNull()
    // ...and a Pokémon is not a Stadium.
    expect(dropCard(emptyGoal(), 'stadium', pokemon('dreepy')).stadiumKey).toBeNull()
  })

  it('accepts anything into the hand zone', () => {
    // Holding a card at end of turn has no type restriction.
    expect(dropCard(emptyGoal(), 'hand', stadium('arena')).inHand).toHaveLength(1)
  })

  it('routes a Pokémon to the zone it was dropped in', () => {
    expect(dropCard(emptyGoal(), 'active', pokemon('dreepy')).active?.cardKey).toBe('dreepy')
    expect(dropCard(emptyGoal(), 'bench', pokemon('dreepy')).bench).toHaveLength(1)
  })

  it('attaches Energy to the Pokémon it was dropped on, pinning the type', () => {
    const placed = placeActive(emptyGoal(), 'dreepy')
    const target = slotTarget(placed.active!.id)
    const once = dropCard(placed, target, energy('psychic', '{P}'))
    expect(once.active?.energy).toEqual(['{P}'])

    // A second of the same type asks for two of it.
    const twice = dropCard(once, target, energy('psychic', '{P}'))
    expect(twice.active?.energy).toEqual(['{P}', '{P}'])
  })

  it('keeps each type when different Energy is dropped on one Pokémon', () => {
    // A typed Energy then an "any" one is a Grass plus one more of anything,
    // not two of anything.
    const placed = placeActive(emptyGoal(), 'dreepy')
    const target = slotTarget(placed.active!.id)
    const mixed = dropCard(dropCard(placed, target, energy('g', '{G}')), target, energy('any', null))
    expect(mixed.active?.energy).toEqual(['{G}', null])

    const twoTypes = dropCard(mixed, target, energy('r', '{R}'))
    expect(twoTypes.active?.energy).toEqual(['{G}', null, '{R}'])
  })

  it('removes exactly the Energy asked for', () => {
    const placed = placeActive(emptyGoal(), 'dreepy')
    const id = placed.active!.id
    const mixed = attachEnergyCard(attachEnergyCard(placed, id, '{G}'), id, null)
    expect(removeSlotEnergy(mixed, id, 0).active?.energy).toEqual([null])
    expect(removeSlotEnergy(mixed, id, 1).active?.energy).toEqual(['{G}'])
  })

  it('attaches a Tool to the Pokémon it was dropped on, once', () => {
    const placed = addBench(emptyGoal(), 'dreepy')
    const target = slotTarget(placed.bench[0].id)
    const once = dropCard(placed, target, tool('belt'))
    expect(once.bench[0].tools).toEqual(['belt'])
    // The same Tool twice is still one Tool.
    expect(dropCard(once, target, tool('belt')).bench[0].tools).toEqual(['belt'])
  })

  it('ignores a Pokémon dropped onto another Pokémon', () => {
    const placed = placeActive(emptyGoal(), 'dreepy')
    const target = slotTarget(placed.active!.id)
    expect(dropCard(placed, target, pokemon('budew'))).toEqual(placed)
  })
})
