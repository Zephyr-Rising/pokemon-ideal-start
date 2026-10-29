/**
 * The board you are aiming for at the end of turn 1, and how closely a real
 * board matches it.
 *
 * This module knows nothing about the simulator: it scores a plain `BoardView`,
 * so it can be tested against hand-built boards and reused by the UI preview.
 */

/** One Pokémon in play, reduced to what a goal can ask about. */
export interface BoardPokemon {
  cardKey: string
  /** Energy type symbols attached, e.g. ['{G}', '{G}']. */
  energy: string[]
  /** Card keys of Tools attached. */
  tools: string[]
}

/** A board at the end of turn 1 — whatever produced it. */
export interface BoardView {
  active: BoardPokemon | null
  bench: BoardPokemon[]
  stadiumKey: string | null
  /** Card keys still in hand. */
  hand: string[]
}

/** A required Pokémon, and the Energy it should be carrying. */
export interface SlotGoal {
  id: string
  cardKey: string
  /** Energy required on this Pokémon; 0 means "don't care". */
  energy: number
  /** Required Energy type, or null for any type. */
  energyType: string | null
  /** Tools that must be attached to this Pokémon. */
  tools: string[]
}

export interface HandGoal {
  id: string
  cardKey: string
  count: number
}

export interface FieldGoal {
  active: SlotGoal | null
  bench: SlotGoal[]
  /** "At least this many benched", whatever they are. 0 disables it. */
  benchMin: number
  stadiumKey: string | null
  inHand: HandGoal[]
}

export const emptyGoal = (): FieldGoal => ({
  active: null,
  bench: [],
  benchMin: 0,
  stadiumKey: null,
  inHand: [],
})

export type PartKind =
  | 'active'
  | 'activeEnergy'
  | 'activeTool'
  | 'bench'
  | 'benchEnergy'
  | 'benchTool'
  | 'benchMin'
  | 'stadium'
  | 'hand'

/** One scorable piece of the goal. Both scores are built from these. */
export interface GoalPart {
  id: string
  kind: PartKind
  label: string
  met: boolean
}

export interface GoalScore {
  parts: GoalPart[]
  /** Every part met. */
  strict: boolean
  /** Share of parts met, 1 when the goal is empty. */
  closeness: number
}

export const goalIsEmpty = (goal: FieldGoal): boolean =>
  goal.active === null &&
  goal.bench.length === 0 &&
  goal.benchMin === 0 &&
  goal.stadiumKey === null &&
  goal.inHand.length === 0

/** Is this Tool attached to the Pokémon the slot was paired with? */
const toolMet = (pokemon: BoardPokemon | undefined, toolKey: string): boolean =>
  pokemon !== undefined && pokemon.tools.includes(toolKey)

/** Does this Pokémon carry the Energy a slot asks for? */
function energyMet(pokemon: BoardPokemon | undefined, slot: SlotGoal): boolean {
  if (slot.energy === 0) return true
  if (!pokemon) return false
  const matching = slot.energyType
    ? pokemon.energy.filter((type) => type === slot.energyType)
    : pokemon.energy
  return matching.length >= slot.energy
}

/**
 * Pair bench goals with benched Pokémon so that as many parts as possible are
 * met.
 *
 * Every bench goal names a specific card, so this is a multiset comparison
 * rather than a general matching problem: a goal for two Dreepy is met by any
 * two Dreepy in play. Within a card, the Pokémon carrying the most Energy are
 * assigned to the slots demanding the most, which is the assignment that
 * satisfies the greatest number of Energy parts.
 */
function pairBench(goals: SlotGoal[], bench: BoardPokemon[]): Map<string, BoardPokemon | undefined> {
  const available = new Map<string, BoardPokemon[]>()
  for (const pokemon of bench) {
    const list = available.get(pokemon.cardKey)
    if (list) list.push(pokemon)
    else available.set(pokemon.cardKey, [pokemon])
  }
  // Best-equipped first, so the fussiest slot gets the Pokémon most likely to
  // satisfy it.
  for (const list of available.values()) {
    list.sort((a, b) => b.energy.length + b.tools.length - (a.energy.length + a.tools.length))
  }

  const paired = new Map<string, BoardPokemon | undefined>()
  const byDemand = [...goals].sort((a, b) => b.energy + b.tools.length - (a.energy + a.tools.length))
  for (const goal of byDemand) {
    paired.set(goal.id, available.get(goal.cardKey)?.shift())
  }
  return paired
}

/**
 * Score a board against the goal.
 *
 * `labelFor` turns a card key into a display name; it is passed in so this
 * module stays independent of the deck model.
 */
export function scoreBoard(
  goal: FieldGoal,
  board: BoardView,
  labelFor: (cardKey: string) => string,
): GoalScore {
  const parts: GoalPart[] = []

  if (goal.active) {
    const matches = board.active?.cardKey === goal.active.cardKey
    parts.push({
      id: `${goal.active.id}:card`,
      kind: 'active',
      label: `${labelFor(goal.active.cardKey)} Active`,
      met: matches,
    })
    if (goal.active.energy > 0) {
      parts.push({
        id: `${goal.active.id}:energy`,
        kind: 'activeEnergy',
        label: `${goal.active.energy} Energy on the Active`,
        // Energy only counts on the Pokémon the goal actually asked for.
        met: matches && energyMet(board.active ?? undefined, goal.active),
      })
    }
    for (const toolKey of goal.active.tools) {
      parts.push({
        id: `${goal.active.id}:tool:${toolKey}`,
        kind: 'activeTool',
        label: `${labelFor(toolKey)} on ${labelFor(goal.active.cardKey)}`,
        met: matches && toolMet(board.active ?? undefined, toolKey),
      })
    }
  }

  const paired = pairBench(goal.bench, board.bench)
  for (const slot of goal.bench) {
    const pokemon = paired.get(slot.id)
    parts.push({
      id: `${slot.id}:card`,
      kind: 'bench',
      label: `${labelFor(slot.cardKey)} benched`,
      met: pokemon !== undefined,
    })
    if (slot.energy > 0) {
      parts.push({
        id: `${slot.id}:energy`,
        kind: 'benchEnergy',
        label: `${slot.energy} Energy on ${labelFor(slot.cardKey)}`,
        met: energyMet(pokemon, slot),
      })
    }
    for (const toolKey of slot.tools) {
      parts.push({
        id: `${slot.id}:tool:${toolKey}`,
        kind: 'benchTool',
        label: `${labelFor(toolKey)} on ${labelFor(slot.cardKey)}`,
        met: toolMet(pokemon, toolKey),
      })
    }
  }

  if (goal.benchMin > 0) {
    parts.push({
      id: 'benchMin',
      kind: 'benchMin',
      label: `${goal.benchMin} or more benched`,
      met: board.bench.length >= goal.benchMin,
    })
  }

  if (goal.stadiumKey) {
    parts.push({
      id: 'stadium',
      kind: 'stadium',
      label: `${labelFor(goal.stadiumKey)} in play`,
      met: board.stadiumKey === goal.stadiumKey,
    })
  }

  for (const want of goal.inHand) {
    const held = board.hand.filter((key) => key === want.cardKey).length
    parts.push({
      id: `${want.id}:hand`,
      kind: 'hand',
      label:
        want.count === 1
          ? `${labelFor(want.cardKey)} still in hand`
          : `${want.count}× ${labelFor(want.cardKey)} still in hand`,
      met: held >= want.count,
    })
  }

  const metCount = parts.filter((part) => part.met).length
  return {
    parts,
    strict: parts.every((part) => part.met),
    // An empty goal is trivially met, which keeps the score defined rather
    // than 0/0 before the user has placed anything.
    closeness: parts.length === 0 ? 1 : metCount / parts.length,
  }
}
