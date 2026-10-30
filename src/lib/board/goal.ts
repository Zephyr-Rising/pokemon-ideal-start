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
  /**
   * Energy required on this Pokémon, one entry per Energy in the order it was
   * asked for: a type symbol such as `{G}`, or null for any type. Empty means
   * "don't care". A list rather than a count and a type, so "a Grass and one
   * more of anything" stays exactly that.
   */
  energy: (string | null)[]
  /** Tools that must be attached to this Pokémon. */
  tools: string[]
  /**
   * Other Pokémon that would do instead: the slot is met by `cardKey` or any of
   * these. Its Energy and Tools go on whichever one fills it.
   */
  alternatives?: string[]
}

export interface HandGoal {
  id: string
  cardKey: string
  count: number
  /** Other cards that would do instead; any mix of them counts. */
  alternatives?: string[]
}

export interface FieldGoal {
  active: SlotGoal | null
  bench: SlotGoal[]
  /** "At least this many benched", whatever they are. 0 disables it. */
  benchMin: number
  /**
   * "At least this many cards in hand" at the end of the turn, whatever they
   * are. 0 (or absent) disables it.
   */
  handMin?: number
  stadiumKey: string | null
  /** Other Stadiums that would do instead. */
  stadiumAlternatives?: string[]
  inHand: HandGoal[]
  /**
   * How much each part of the board matters, by part id: 1 is essential, 3 is
   * nice to have. A part not listed is essential. A board missing only its
   * less important parts still counts as a partial success.
   */
  priorities?: Record<string, Priority>
  /**
   * Either/or across the board: each choice is met when every part of any one
   * of its options is. The parts in a choice stop counting on their own.
   */
  choices?: BoardChoice[]
}

/**
 * "Ciphermaniac's Codebreaking in hand, or Academy at Night in play and Kyurem
 * in hand": options of part ids, each option met only when all of its parts
 * are.
 */
export interface BoardChoice {
  id: string
  options: string[][]
}

export type Priority = 1 | 2 | 3

/** Every card that fills a place on the board: the card itself, then any alternatives. */
export const acceptedKeys = (cardKey: string, alternatives?: string[]): string[] => [
  cardKey,
  ...(alternatives ?? []),
]

/** "Munkidori or Fezandipiti ex". */
const eitherOr = (keys: string[], labelFor: (cardKey: string) => string): string =>
  keys.map(labelFor).join(' or ')

export const PRIORITY_LEVELS: { level: Priority; label: string }[] = [
  { level: 1, label: 'Essential' },
  { level: 2, label: 'Important' },
  { level: 3, label: 'Nice to have' },
]

const LEAST_IMPORTANT: Priority = 3

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
  | 'handMin'
  | 'stadium'
  | 'hand'
  | 'choice'

/** One scorable piece of the goal. Both scores are built from these. */
export interface GoalPart {
  id: string
  kind: PartKind
  label: string
  met: boolean
  /** 1 essential, 2 important, 3 nice to have. */
  priority: Priority
}

export interface GoalScore {
  parts: GoalPart[]
  /** Every part met. */
  strict: boolean
  /**
   * The highest priority level fully met: every part at that level or more
   * important is in place. 0 when an essential part is missing; 3 when the
   * whole board is.
   */
  tier: number
  /** Share of parts met, 1 when the goal is empty. */
  closeness: number
}

/**
 * The goal's either/or choices that still apply, with options reduced to the
 * parts that exist (a card removed from the board drops out of its option).
 * A choice needs at least two non-empty options to be a choice at all.
 */
export function liveChoices(goal: FieldGoal, partIds: Set<string>): BoardChoice[] {
  return (goal.choices ?? [])
    .map((choice) => ({
      ...choice,
      options: choice.options
        .map((option) => option.filter((id) => partIds.has(id)))
        .filter((option) => option.length > 0),
    }))
    .filter((choice) => choice.options.length >= 2)
}

/** Every part id that sits inside a live choice. */
export function choiceMembers(goal: FieldGoal, partIds: Set<string>): Set<string> {
  return new Set(liveChoices(goal, partIds).flatMap((choice) => choice.options.flat()))
}

function foldChoices(parts: GoalPart[], goal: FieldGoal): GoalPart[] {
  const byId = new Map(parts.map((part) => [part.id, part]))
  const choices = liveChoices(goal, new Set(byId.keys()))
  if (choices.length === 0) return parts
  const members = new Set(choices.flatMap((choice) => choice.options.flat()))
  const folded = choices.map((choice): GoalPart => {
    const id = `choice:${choice.id}`
    return {
      id,
      kind: 'choice',
      label: choice.options
        .map((option) => option.map((partId) => byId.get(partId)!.label).join(' and '))
        .join(', or '),
      met: choice.options.some((option) => option.every((partId) => byId.get(partId)!.met)),
      priority: goal.priorities?.[id] ?? 1,
    }
  })
  return [...parts.filter((part) => !members.has(part.id)), ...folded]
}

/** The priority levels a goal actually uses, most important first. */
export function usedPriorities(goal: FieldGoal): Priority[] {
  const levels = new Set<Priority>()
  const empty: BoardView = { active: null, bench: [], stadiumKey: null, hand: [] }
  for (const part of scoreBoard(goal, empty, (key) => key).parts) levels.add(part.priority)
  return [...levels].sort((a, b) => a - b)
}

export const goalIsEmpty = (goal: FieldGoal): boolean =>
  goal.active === null &&
  goal.bench.length === 0 &&
  goal.benchMin === 0 &&
  (goal.handMin ?? 0) === 0 &&
  goal.stadiumKey === null &&
  goal.inHand.length === 0

/** Is this Tool attached to the Pokémon the slot was paired with? */
const toolMet = (pokemon: BoardPokemon | undefined, toolKey: string): boolean =>
  pokemon !== undefined && pokemon.tools.includes(toolKey)

/** Does this Pokémon carry the Energy a slot asks for? */
/**
 * How a Special Energy reads on the board: its card key, then the types it
 * provides on the Pokémon it is attached to (`*` for every type). A Basic
 * Energy is just its type.
 */
export const specialEnergyEntry = (cardKey: string, provides: string[]): string =>
  `${cardKey}#${provides.join(',')}`

function parseEntry(entry: string): { key: string; basic: boolean; provides: string[] } {
  const at = entry.indexOf('#')
  if (at < 0) return { key: entry, basic: true, provides: [entry] }
  return { key: entry.slice(0, at), basic: false, provides: entry.slice(at + 1).split(',') }
}

/** Does this attached Energy meet a typed need (`{P}`) or a specific card's? */
function entryMeets(entry: string, need: string): boolean {
  const { key, basic, provides } = parseEntry(entry)
  if (!need.startsWith('{')) return !basic && key === need
  return provides.includes(need) || provides.includes('*')
}

function energyMet(pokemon: BoardPokemon | undefined, slot: SlotGoal): boolean {
  if (slot.energy.length === 0) return true
  if (!pokemon) return false
  const spare = [...pokemon.energy]
  const claim = (need: string, ok: (entry: string) => boolean): boolean => {
    const at = spare.findIndex((entry) => ok(entry) && entryMeets(entry, need))
    if (at < 0) return false
    spare.splice(at, 1)
    return true
  }
  const needs = slot.energy.filter((kind): kind is string => kind !== null)
  // Most specific first, so nothing a later need depends on is used up: a
  // named Special Energy; then each type, from a Basic Energy of it if there
  // is one, else from a Special Energy that provides it (Telepathic Psychic
  // Energy for Psychic). Whatever is left stands in for the "any" needs.
  for (const need of needs.filter((kind) => !kind.startsWith('{'))) {
    if (!claim(need, () => true)) return false
  }
  for (const need of needs.filter((kind) => kind.startsWith('{'))) {
    if (!claim(need, (entry) => parseEntry(entry).basic) && !claim(need, () => true)) return false
  }
  return spare.length >= slot.energy.filter((kind) => kind === null).length
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
  // Best-equipped first, so the fussiest slot gets the Pokémon most likely to
  // satisfy it.
  const available = [...bench].sort(
    (a, b) => b.energy.length + b.tools.length - (a.energy.length + a.tools.length),
  )
  const paired = new Map<string, BoardPokemon | undefined>()
  // Slots with fewer alternatives choose first, so a slot that would take
  // either of two Pokémon does not use up the only one a stricter slot can;
  // then the most demanding.
  const order = [...goals].sort(
    (a, b) =>
      (a.alternatives?.length ?? 0) - (b.alternatives?.length ?? 0) ||
      b.energy.length + b.tools.length - (a.energy.length + a.tools.length),
  )
  for (const goal of order) {
    const accepted = acceptedKeys(goal.cardKey, goal.alternatives)
    const at = available.findIndex((pokemon) => accepted.includes(pokemon.cardKey))
    paired.set(goal.id, at < 0 ? undefined : available.splice(at, 1)[0])
  }
  return paired
}

const ENERGY_NAMES: Record<string, string> = {
  '{G}': 'Grass',
  '{R}': 'Fire',
  '{W}': 'Water',
  '{L}': 'Lightning',
  '{P}': 'Psychic',
  '{F}': 'Fighting',
  '{D}': 'Darkness',
  '{M}': 'Metal',
}

/**
 * The Energy a slot asks for, in words: "Grass Energy", "2 Psychic Energy",
 * "Any Energy", or for a mix, "Grass + 2 any Energy". A lone count of 1 is
 * dropped where it can be, as "1 Grass Energy" reads worse than the card's own
 * name.
 */
export function energyPhrase(
  slot: Pick<SlotGoal, 'energy'>,
  labelFor: (cardKey: string) => string = (key) => key,
): string {
  const counts = new Map<string, number>()
  const special = new Set<string>()
  for (const type of slot.energy) {
    // A Special Energy is stored as its card key and named after the card.
    const basic = type === null ? 'any' : ENERGY_NAMES[type]
    const name = basic ?? labelFor(type!)
    if (!basic) special.add(name)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  if (special.size > 0) {
    // Special Energy names already end in "Energy", so each part says so.
    return [...counts]
      .sort(([a], [b]) => Number(a === 'any') - Number(b === 'any'))
      .map(([name, n]) => {
        const named = special.has(name) ? name : name === 'any' ? 'Energy of any type' : `${name} Energy`
        return n === 1 && name !== 'any' ? named : `${n} ${named}`
      })
      .join(' + ')
  }
  // Typed Energy first, "any" last, as it is the leftover.
  const groups = [...counts].sort(([a], [b]) => Number(a === 'any') - Number(b === 'any'))
  if (groups.length === 1) {
    const [name, n] = groups[0]
    if (name === 'any') return n === 1 ? 'Any Energy' : `${n} Energy of any type`
    return n === 1 ? `${name} Energy` : `${n} ${name} Energy`
  }
  return `${groups.map(([name, n]) => (n === 1 && name !== 'any' ? name : `${n} ${name}`)).join(' + ')} Energy`
}

/**
 * Score a board against the goal.
 *
 * `labelFor` turns a card key into a display name; it is passed in so this
 * module stays independent of the deck model.
 */
/**
 * What to call each benched Pokémon in a part's label. Two of the same card
 * would otherwise give two parts that read identically ("Dreepy benched"
 * twice), so repeats are numbered in the order they were placed: "Dreepy #1",
 * "Dreepy #2". A card benched once keeps its plain name.
 */
function benchNames(
  bench: SlotGoal[],
  labelFor: (cardKey: string) => string,
): Map<string, string> {
  const labelOf = (slot: SlotGoal) => eitherOr(acceptedKeys(slot.cardKey, slot.alternatives), labelFor)
  const total = new Map<string, number>()
  for (const slot of bench) total.set(labelOf(slot), (total.get(labelOf(slot)) ?? 0) + 1)
  const seen = new Map<string, number>()
  const names = new Map<string, string>()
  for (const slot of bench) {
    const label = labelOf(slot)
    const nth = (seen.get(label) ?? 0) + 1
    seen.set(label, nth)
    names.set(slot.id, total.get(label)! > 1 ? `${label} #${nth}` : label)
  }
  return names
}

export function scoreBoard(
  goal: FieldGoal,
  board: BoardView,
  labelFor: (cardKey: string) => string,
): GoalScore {
  const parts: GoalPart[] = []

  if (goal.active) {
    const accepted = acceptedKeys(goal.active.cardKey, goal.active.alternatives)
    const matches = board.active !== null && accepted.includes(board.active.cardKey)
    parts.push({
      id: `${goal.active.id}:card`,
      kind: 'active',
      label: `${eitherOr(accepted, labelFor)} Active`,
      met: matches,
      priority: 1,
    })
    if (goal.active.energy.length > 0) {
      parts.push({
        id: `${goal.active.id}:energy`,
        kind: 'activeEnergy',
        label: `${energyPhrase(goal.active, labelFor)} on the Active`,
        // Energy only counts on the Pokémon the goal actually asked for.
        met: matches && energyMet(board.active ?? undefined, goal.active),
        priority: 1,
      })
    }
    for (const toolKey of goal.active.tools) {
      parts.push({
        id: `${goal.active.id}:tool:${toolKey}`,
        kind: 'activeTool',
        // "the Active", so it cannot read the same as a Tool on a benched copy.
        label: `${labelFor(toolKey)} on the Active`,
        met: matches && toolMet(board.active ?? undefined, toolKey),
        priority: 1,
      })
    }
  }

  const paired = pairBench(goal.bench, board.bench)
  const benchName = benchNames(goal.bench, labelFor)
  for (const slot of goal.bench) {
    const pokemon = paired.get(slot.id)
    const name = benchName.get(slot.id)!
    parts.push({
      id: `${slot.id}:card`,
      kind: 'bench',
      label: `${name} benched`,
      met: pokemon !== undefined,
      priority: 1,
    })
    if (slot.energy.length > 0) {
      parts.push({
        id: `${slot.id}:energy`,
        kind: 'benchEnergy',
        label: `${energyPhrase(slot, labelFor)} on ${name}`,
        met: energyMet(pokemon, slot),
        priority: 1,
      })
    }
    for (const toolKey of slot.tools) {
      parts.push({
        id: `${slot.id}:tool:${toolKey}`,
        kind: 'benchTool',
        label: `${labelFor(toolKey)} on ${name}`,
        met: toolMet(pokemon, toolKey),
        priority: 1,
      })
    }
  }

  if (goal.benchMin > 0) {
    parts.push({
      id: 'benchMin',
      kind: 'benchMin',
      label: `${goal.benchMin} or more benched`,
      met: board.bench.length >= goal.benchMin,
      priority: 1,
    })
  }

  if ((goal.handMin ?? 0) > 0) {
    parts.push({
      id: 'handMin',
      kind: 'handMin',
      label: `${goal.handMin} or more cards in hand`,
      met: board.hand.length >= goal.handMin!,
      priority: 1,
    })
  }

  if (goal.stadiumKey) {
    parts.push({
      id: 'stadium',
      kind: 'stadium',
      label: `${eitherOr(acceptedKeys(goal.stadiumKey, goal.stadiumAlternatives), labelFor)} in play`,
      met:
        board.stadiumKey !== null &&
        acceptedKeys(goal.stadiumKey, goal.stadiumAlternatives).includes(board.stadiumKey),
      priority: 1,
    })
  }

  for (const want of goal.inHand) {
    const accepted = acceptedKeys(want.cardKey, want.alternatives)
    const held = board.hand.filter((key) => accepted.includes(key)).length
    parts.push({
      id: `${want.id}:hand`,
      kind: 'hand',
      label:
        want.count === 1
          ? `${eitherOr(accepted, labelFor)} still in hand`
          : `${want.count}× ${eitherOr(accepted, labelFor)} still in hand`,
      met: held >= want.count,
      priority: 1,
    })
  }

  for (const part of parts) part.priority = goal.priorities?.[part.id] ?? 1
  // Fold the parts of each either/or choice into one part for the choice.
  const folded = foldChoices(parts, goal)
  parts.splice(0, parts.length, ...folded)
  const metCount = parts.filter((part) => part.met).length
  const missing = parts.filter((part) => !part.met).map((part) => part.priority)
  return {
    parts,
    strict: missing.length === 0,
    // Everything more important than the most important part missing.
    tier: missing.length === 0 ? LEAST_IMPORTANT : Math.min(...missing) - 1,
    // An empty goal is trivially met, which keeps the score defined rather
    // than 0/0 before the user has placed anything.
    closeness: parts.length === 0 ? 1 : metCount / parts.length,
  }
}
