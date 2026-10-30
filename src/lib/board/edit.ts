import type { FieldGoal, Priority, SlotGoal } from './goal'

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
  active: {
    id: goal.active?.id ?? nextId('active'),
    cardKey,
    energy: [],
    tools: [],
  },
})

export const clearActive = (goal: FieldGoal): FieldGoal => ({ ...goal, active: null })

export const addBench = (goal: FieldGoal, cardKey: string): FieldGoal => ({
  ...goal,
  bench: [
    ...goal.bench,
    { id: nextId('bench'), cardKey, energy: [], tools: [] },
  ],
})

export const removeBench = (goal: FieldGoal, id: string): FieldGoal => ({
  ...goal,
  bench: goal.bench.filter((slot) => slot.id !== id),
})

/** Change a slot's Energy requirement, whether it is the Active or a bench slot. */
/** Take one Energy off a slot, by its position in the slot's list. */
export function removeSlotEnergy(goal: FieldGoal, id: string, index: number): FieldGoal {
  return mapSlot(goal, id, (slot) => ({
    ...slot,
    energy: slot.energy.filter((_, i) => i !== index),
  }))
}

/** Map a slot id onto its slot, wherever it sits. */
function mapSlot(goal: FieldGoal, id: string, update: (slot: SlotGoal) => SlotGoal): FieldGoal {
  const apply = (slot: SlotGoal) => (slot.id === id ? update(slot) : slot)
  return {
    ...goal,
    active: goal.active ? apply(goal.active) : null,
    bench: goal.bench.map(apply),
  }
}

/** More Energy than this on one Pokémon is not a realistic turn-1 board. */
const MAX_ENERGY = 6

/**
 * Drop an Energy card onto a Pokémon.
 *
 * Each drop asks for one more Energy of the type dropped — dragging a Grass
 * Energy onto a Pokémon plainly means Grass — and Energy already asked for
 * keeps its own type, so a mix stays a mix.
 */
export const attachEnergyCard = (goal: FieldGoal, id: string, energyType: string | null) =>
  mapSlot(goal, id, (slot) =>
    slot.energy.length >= MAX_ENERGY ? slot : { ...slot, energy: [...slot.energy, energyType] },
  )

export const attachTool = (goal: FieldGoal, id: string, toolKey: string) =>
  mapSlot(goal, id, (slot) =>
    slot.tools.includes(toolKey) ? slot : { ...slot, tools: [...slot.tools, toolKey] },
  )

export const removeTool = (goal: FieldGoal, id: string, toolKey: string) =>
  mapSlot(goal, id, (slot) => ({ ...slot, tools: slot.tools.filter((t) => t !== toolKey) }))

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

/**
 * Where a card was dropped: one of the board zones, or a specific Pokémon
 * already on the board (`slot:<id>`), which is how Energy and Tools get
 * attached to a particular Pokémon rather than to the board at large.
 */
export type DropZone = 'active' | 'bench' | 'stadium' | 'hand'
export type DropTarget = DropZone | `slot:${string}`

export const slotTarget = (id: string): DropTarget => `slot:${id}`

/** What a dropped card is, as far as the board cares. */
export interface DroppedCard {
  key: string
  isPokemon: boolean
  isStadium: boolean
  isEnergy: boolean
  isTool: boolean
  /** Energy type symbol, for an Energy card. */
  energyType: string | null
}

/** Apply a drop, ignoring one that makes no sense for the card. */
export function dropCard(goal: FieldGoal, target: DropTarget, card: DroppedCard): FieldGoal {
  // Dropped onto a Pokémon already on the board: Energy and Tools attach to it,
  // nothing else belongs there.
  if (target.startsWith('slot:')) {
    const id = target.slice('slot:'.length)
    if (card.isEnergy) return attachEnergyCard(goal, id, card.energyType)
    if (card.isTool) return attachTool(goal, id, card.key)
    return goal
  }

  switch (target) {
    case 'active':
      return card.isPokemon ? placeActive(goal, card.key) : goal
    case 'bench':
      return card.isPokemon ? addBench(goal, card.key) : goal
    case 'stadium':
      return card.isStadium ? setStadium(goal, card.key) : goal
    case 'hand':
      return addHand(goal, card.key)
    default:
      // A target this function does not know about changes nothing.
      return goal
  }
}

/** Set how much one part of the board matters (1 essential, 3 nice to have). */
export function setPartPriority(goal: FieldGoal, partId: string, priority: Priority): FieldGoal {
  const priorities = { ...goal.priorities }
  // Essential is the default, so it is not stored.
  if (priority === 1) delete priorities[partId]
  else priorities[partId] = priority
  return { ...goal, priorities }
}
