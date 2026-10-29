import type { FieldGoal, SlotGoal } from './goal'

/**
 * Edits to the ideal field.
 *
 * Every helper returns a new goal, so the board editor stays a plain controlled
 * component and undo would be trivial to add later.
 */

let counter = 0
const nextId = (prefix: string) => `${prefix}-${++counter}`

/** Reset between tests so generated ids are predictable. */
export const resetIds = () => {
  counter = 0
}

export const placeActive = (goal: FieldGoal, cardKey: string): FieldGoal => ({
  ...goal,
  active: { id: goal.active?.id ?? nextId('active'), cardKey, energy: 0, energyType: null },
})

export const clearActive = (goal: FieldGoal): FieldGoal => ({ ...goal, active: null })

export const addBench = (goal: FieldGoal, cardKey: string): FieldGoal => ({
  ...goal,
  bench: [...goal.bench, { id: nextId('bench'), cardKey, energy: 0, energyType: null }],
})

export const removeBench = (goal: FieldGoal, id: string): FieldGoal => ({
  ...goal,
  bench: goal.bench.filter((slot) => slot.id !== id),
})

/** Change a slot's Energy requirement, whether it is the Active or a bench slot. */
export function setSlotEnergy(goal: FieldGoal, id: string, energy: number): FieldGoal {
  const clamped = Math.max(0, Math.min(6, energy))
  const update = (slot: SlotGoal): SlotGoal =>
    slot.id === id ? { ...slot, energy: clamped } : slot
  return {
    ...goal,
    active: goal.active ? update(goal.active) : null,
    bench: goal.bench.map(update),
  }
}

export function setSlotEnergyType(goal: FieldGoal, id: string, energyType: string | null): FieldGoal {
  const update = (slot: SlotGoal): SlotGoal =>
    slot.id === id ? { ...slot, energyType } : slot
  return {
    ...goal,
    active: goal.active ? update(goal.active) : null,
    bench: goal.bench.map(update),
  }
}

export const setBenchMin = (goal: FieldGoal, benchMin: number): FieldGoal => ({
  ...goal,
  // Eight is the most the game allows, with Area Zero Underdepths out.
  benchMin: Math.max(0, Math.min(8, benchMin)),
})

export const setStadium = (goal: FieldGoal, stadiumKey: string | null): FieldGoal => ({
  ...goal,
  stadiumKey,
})

export function addHand(goal: FieldGoal, cardKey: string): FieldGoal {
  const existing = goal.inHand.find((want) => want.cardKey === cardKey)
  if (existing) {
    // Dragging the same card in again asks for another copy.
    return {
      ...goal,
      inHand: goal.inHand.map((want) =>
        want.cardKey === cardKey ? { ...want, count: Math.min(4, want.count + 1) } : want,
      ),
    }
  }
  return { ...goal, inHand: [...goal.inHand, { id: nextId('hand'), cardKey, count: 1 }] }
}

export const removeHand = (goal: FieldGoal, id: string): FieldGoal => ({
  ...goal,
  inHand: goal.inHand.filter((want) => want.id !== id),
})

/** Where a dragged card was dropped. */
export type DropZone = 'active' | 'bench' | 'stadium' | 'hand'

/** Apply a drop, ignoring one that makes no sense for the card. */
export function dropCard(
  goal: FieldGoal,
  zone: DropZone,
  cardKey: string,
  isPokemon: boolean,
  isStadium: boolean,
): FieldGoal {
  switch (zone) {
    case 'active':
      return isPokemon ? placeActive(goal, cardKey) : goal
    case 'bench':
      return isPokemon ? addBench(goal, cardKey) : goal
    case 'stadium':
      return isStadium ? setStadium(goal, cardKey) : goal
    case 'hand':
      return addHand(goal, cardKey)
  }
}
