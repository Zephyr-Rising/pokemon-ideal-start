import { norm } from '../normalize'
import type { DeckCard } from '../types'
import { registerAbility } from './abilities'
import { registerAttackText } from './attacks'
import {
  benchFromDeck,
  benchPrefixes,
  choices,
  handFromDeck,
  isPlayableSupporter,
  payDiscard,
  registerEffect,
  stackOnTop,
  topCandidates,
  type EffectContext,
} from './effects'
import {
  ACTIVE_TARGET,
  allInPlay,
  benchCap,
  cardName,
  cloneState,
  energyFits,
  energyType,
  evolveSlot,
  fairShuffle,
  flipCoin,
  isBasicPokemon,
  nameOf,
  shufflesAfter,
  type InPlay,
  type SimState,
} from './state'

/**
 * The cards that "search your deck", one entry each.
 *
 * Every entry is written against the card's printed text, and the attacks are
 * registered by that exact text (see `registerAttackText`), so a printing
 * worded differently stays inert rather than borrowing a near neighbour's
 * effect. What each entry does is the shared helpers below; what an entry adds
 * is which cards, how many, and where they go.
 *
 * Left out on purpose, and so inert: searches that need an opponent (Love Ball,
 * and the Abilities that trigger on being damaged or Knocked Out: Pecharunt,
 * Team Rocket's Koffing, Amulet of Hope, Pidove), searches keyed on data the
 * card database does not hold (Fletchling's {F} Resistance), Perrin and
 * Eldegoss (which put cards back first), Brilliant Blender (it only discards),
 * Drilbur's Dig Dig Dig (likewise), and the Abilities with a trigger the
 * simulator does not model (Palafin, Yanmega ex, Heliolisk's Frilled Generator).
 */

// --- shared ----------------------------------------------------------------

const isPokemon = (card: DeckCard) => card.tags.includes('pokemon')
const isEvolution = (card: DeckCard) =>
  card.tags.includes('stage1') || card.tags.includes('stage2')
const isBasicEnergy = (card: DeckCard) => card.tags.includes('basic-energy')
const isEnergyCard = (card: DeckCard) => card.tags.includes('energy')
const ofType = (type: string) => (card: DeckCard) => (card.card?.type ?? '').includes(type)
const named = (...names: string[]) => {
  const wanted = new Set(names.map(norm))
  return (card: DeckCard) => wanted.has(nameOf(card))
}
const nameHas = (part: string) => (card: DeckCard) => nameOf(card).includes(norm(part))
const nameStarts = (owner: string) => (card: DeckCard) => nameOf(card).startsWith(`${norm(owner)} `)
const both =
  (...tests: ((card: DeckCard) => boolean)[]) =>
  (card: DeckCard) =>
    tests.every((test) => test(card))
const hp = (card: DeckCard) => card.card?.hp ?? 0
const isTool = (card: DeckCard) => card.tags.includes('tool')
const isItem = (card: DeckCard) => card.tags.includes('item')
const isSupporter = (card: DeckCard) => card.tags.includes('supporter')
const isStadium = (card: DeckCard) => card.tags.includes('stadium')
const isTrainer = (card: DeckCard) => isItem(card) || isSupporter(card) || isStadium(card) || isTool(card)
// The card database marks Tera and Mega Pokémon; Future Pokémon it does not,
// so they are known by name: every Iron Pokémon, and Miraidon.
const isTera = (card: DeckCard) => card.tags.includes('tera')
const isMegaEx = (card: DeckCard) => card.tags.includes('mega') && card.tags.includes('ex')
const isFuture = (card: DeckCard) =>
  isPokemon(card) && (nameOf(card).startsWith('iron ') || nameOf(card).startsWith('miraidon'))

const slotAt = (state: SimState, at: number): InPlay | undefined =>
  at === ACTIVE_TARGET ? (state.active ?? undefined) : state.bench[at]

/** Every Pokémon in play, by position: ACTIVE_TARGET, then bench indices. */
const positions = (state: SimState): number[] => [
  ...(state.active ? [ACTIVE_TARGET] : []),
  ...state.bench.map((_, i) => i),
]

const removeFirst = (pile: DeckCard[], card: DeckCard): void => {
  const at = pile.indexOf(card) >= 0 ? pile.indexOf(card) : pile.findIndex((c) => c.key === card.key)
  if (at >= 0) pile.splice(at, 1)
}

/** Shuffle the deck after a search, fairly (see `fairShuffle`). */
function shuffleDeck(next: SimState, before: SimState, ctx: EffectContext): SimState {
  next.deck = fairShuffle(before, next.deck, ctx.seed)
  next.shuffles = shufflesAfter(before)
  return next
}

/** Drop boards that are the board it started from: a search that found nothing. */
const changed = (state: SimState, boards: SimState[]) => boards.filter((board) => board !== state)

// --- into the hand ---------------------------------------------------------

/**
 * Up to `max` cards worth having into hand. One or two go through
 * `handFromDeck`, which tries every pick; more are taken in one go, one of each
 * first and then further copies, since taking the most is never worse.
 */
function toHand(
  state: SimState,
  ctx: EffectContext,
  max: number,
  allowed: (card: DeckCard) => boolean,
): SimState[] {
  if (max <= 2) return handFromDeck(state, ctx, max as 1 | 2, allowed)
  const picks = pickUpTo(state, ctx, max, allowed)
  if (picks.length === 0) return []
  const next = cloneState(state)
  for (const pick of picks) {
    removeFirst(next.deck, pick)
    next.hand.push(pick)
  }
  return [shuffleDeck(next, state, ctx)]
}

/** Up to `max` cards worth having from the deck: one of each, then copies. */
function pickUpTo(
  state: SimState,
  ctx: EffectContext,
  max: number,
  allowed: (card: DeckCard) => boolean,
  pool: DeckCard[] = state.deck,
): DeckCard[] {
  const found = choices(state, pool, allowed, ctx)
  const left = [...pool]
  const picks: DeckCard[] = []
  for (let added = true; added && picks.length < max; ) {
    added = false
    for (const card of found) {
      if (picks.length >= max) break
      const at = left.findIndex((c) => c.key === card.key)
      if (at < 0) continue
      picks.push(left[at])
      left.splice(at, 1)
      added = true
    }
  }
  return picks
}

/** One card of each type, as "Basic Energy cards of different types" asks. */
const oneOfEachType = (cards: DeckCard[]): DeckCard[] => {
  const seen = new Set<string>()
  return cards.filter((card) => {
    const type = energyType(card)
    if (seen.has(type)) return false
    seen.add(type)
    return true
  })
}

/** Up to `max` Basic Energy of different types into hand. */
function energyOfDifferentTypes(state: SimState, ctx: EffectContext, max: number): SimState[] {
  const picks = oneOfEachType(choices(state, state.deck, isBasicEnergy, ctx)).slice(0, max)
  if (picks.length === 0) return []
  const next = cloneState(state)
  for (const pick of picks) {
    removeFirst(next.deck, pick)
    next.hand.push(pick)
  }
  return [shuffleDeck(next, state, ctx)]
}

/**
 * A Supporter into hand: one the goal names, else one the simulator can play.
 * (Piplup's Call for Support works the same way.)
 */
function supporterToHand(state: SimState, ctx: EffectContext): SimState[] {
  const supporters = state.deck.filter(isSupporter)
  const wanted = supporters.filter((card) => ctx.relevant.has(card.key))
  const pool = wanted.length > 0 ? wanted : supporters.filter(isPlayableSupporter)
  const seen = new Set<string>()
  return pool
    .filter((card) => !seen.has(card.key) && seen.add(card.key))
    .map((card) => {
      const next = cloneState(state)
      removeFirst(next.deck, card)
      next.hand.push(card)
      return shuffleDeck(next, state, ctx)
    })
}

/**
 * Any card at all, `max` of them: what the goal wants or an engine needs (see
 * `choices`), else a Supporter still to be played.
 */
function anyCards(state: SimState, ctx: EffectContext, max: number): SimState[] {
  const boards = toHand(state, ctx, max, () => true)
  return boards.length > 0 ? boards : supporterToHand(state, ctx)
}

// --- onto the Bench --------------------------------------------------------

/** Up to `max` onto the Bench. None found, or no room, no boards. */
function toBench(
  state: SimState,
  ctx: EffectContext,
  max: number,
  allowed: (card: DeckCard) => boolean,
  basicOnly = true,
): SimState[] {
  if (state.bench.length >= benchCap(state)) return []
  const eligible = basicOnly ? both(isBasicPokemon, allowed) : allowed
  const boards =
    max <= 2
      ? benchFromDeck(state, ctx, max as 1 | 2, eligible, basicOnly).map((board) =>
          board === state ? board : shuffleDeck(board, state, ctx),
        )
      : benchPrefixes(state, ctx, max, eligible)
  return changed(state, boards)
}

// --- Energy from the deck, attached ----------------------------------------

/** Where an accelerator's Energy goes. */
type Where =
  /** Onto the Pokémon using it. */
  | 'self'
  /** All onto 1 of your Pokémon. */
  | 'one'
  /** "In any way you like". */
  | 'any'

interface AttachSpec {
  /** Which Energy, best first, up to the card's count. */
  pick: (state: SimState, ctx: EffectContext) => DeckCard[]
  where: Where
  /** Which Pokémon may take it, beyond `where`. */
  target?: (slot: InPlay, at: number) => boolean
}

/**
 * Up to `max` of the deck's Energy that pass `test`, the types the goal asks
 * for first. Taking the most is never worse: Energy on a Pokémon only helps.
 */
const energies =
  (max: number, test: (card: DeckCard) => boolean, { differentTypes = false } = {}) =>
  (state: SimState, ctx: EffectContext): DeckCard[] => {
    const all = state.deck.filter(test)
    const wanted = ctx.energyTypes.size > 0 ? all.filter((card) => energyFits(card, ctx.energyTypes)) : []
    const ordered = [...wanted, ...all.filter((card) => !wanted.includes(card))]
    return (differentTypes ? oneOfEachType(ordered) : ordered).slice(0, max)
  }

/** Several pickers' Energy together: Joltik's {G} and {L}. */
const together =
  (...pickers: ((state: SimState, ctx: EffectContext) => DeckCard[])[]) =>
  (state: SimState, ctx: EffectContext) =>
    pickers.flatMap((pick) => pick(state, ctx))

/**
 * Pokémon the Energy counts on, as `attachFrom` judges it: one the goal wants
 * Energy on (or an earlier stage of one), else any the goal names. One position
 * per identical Pokémon carrying the same Energy.
 */
function countingPositions(state: SimState, ctx: EffectContext, ok: (slot: InPlay, at: number) => boolean): number[] {
  const wants = ctx.energyLineage ?? ctx.energyTargets
  const counts = (slot: InPlay) =>
    ctx.wantsEnergy ? wants.size === 0 || wants.has(slot.card.key) : ctx.relevant.has(slot.card.key)
  const seen = new Set<string>()
  return positions(state).filter((at) => {
    const slot = slotAt(state, at)!
    const same = `${at === ACTIVE_TARGET ? 'A' : 'B'}${slot.card.key}+${slot.energy.length}`
    if (!ok(slot, at) || !counts(slot) || seen.has(same)) return false
    seen.add(same)
    return true
  })
}

/**
 * Search the deck for Energy and attach it.
 *
 * Every way of sharing it out is too many boards, so a few a player would
 * choose between are offered: everything on one Pokémon (each that it counts
 * on), and, where the card allows it, one each in turn across them. Nowhere it
 * counts, no boards — except onto the Pokémon itself, which has no choice.
 */
function attachSearch(state: SimState, ctx: EffectContext, self: number | null, spec: AttachSpec): SimState[] {
  const found = spec.pick(state, ctx)
  if (found.length === 0) return []
  const ok = spec.target ?? (() => true)
  const targets =
    spec.where === 'self'
      ? self !== null && slotAt(state, self)
        ? [self]
        : []
      : countingPositions(state, ctx, ok)
  if (targets.length === 0) return []

  const deal = (to: (i: number) => number): SimState => {
    const next = cloneState(state)
    found.forEach((energy, i) => {
      removeFirst(next.deck, energy)
      slotAt(next, to(i))!.energy.push(energy)
    })
    return shuffleDeck(next, state, ctx)
  }
  const boards = targets.map((at) => deal(() => at))
  if (spec.where === 'any' && targets.length > 1 && found.length > 1) {
    boards.push(deal((i) => targets[i % targets.length]))
  }
  return boards
}

const benched = (_slot: InPlay, at: number) => at !== ACTIVE_TARGET

// --- evolving straight from the deck ---------------------------------------

/** The deck's cards that evolve from this Pokémon and are worth having. */
const evolutionsFor = (state: SimState, ctx: EffectContext, slot: InPlay, extra: (card: DeckCard) => boolean = () => true) =>
  choices(state, state.deck, (card) => card.card?.prev === cardName(slot.card) && extra(card), ctx)

/**
 * Evolve one Pokémon from the deck: each position given, each evolution worth
 * having. Card effects evolve whenever they say, including a Pokémon that came
 * into play this turn — the "not this turn" rule is for evolving from hand.
 */
function evolveOne(
  state: SimState,
  ctx: EffectContext,
  at: number[],
  extra?: (card: DeckCard) => boolean,
): SimState[] {
  const out: SimState[] = []
  const seen = new Set<string>()
  for (const position of at) {
    const slot = slotAt(state, position)
    if (!slot || seen.has(slot.card.key)) continue
    seen.add(slot.card.key)
    for (const evolution of evolutionsFor(state, ctx, slot, extra)) {
      const next = cloneState(state)
      removeFirst(next.deck, evolution)
      if (position === ACTIVE_TARGET) next.active = evolveSlot(next.active!, evolution)
      else next.bench[position] = evolveSlot(next.bench[position], evolution)
      out.push(shuffleDeck(next, state, ctx))
    }
  }
  return out
}

/**
 * Evolve every Pokémon given (up to `max`), each into the evolution worth most
 * to it: Vivillon's Evo-Powder, Reuniclus's Cellular Ascension.
 */
function evolveEach(state: SimState, ctx: EffectContext, at: number[], max = Infinity): SimState[] {
  const next = cloneState(state)
  let evolved = 0
  for (const position of at) {
    if (evolved >= max) break
    const slot = slotAt(next, position)
    if (!slot) continue
    const [evolution] = evolutionsFor(next, ctx, slot)
    if (!evolution) continue
    removeFirst(next.deck, evolution)
    if (position === ACTIVE_TARGET) next.active = evolveSlot(next.active!, evolution)
    else next.bench[position] = evolveSlot(next.bench[position], evolution)
    evolved++
  }
  return evolved > 0 ? [shuffleDeck(next, state, ctx)] : []
}

/** "Your turn ends": nothing more is played after it. */
const endsTurn = (boards: SimState[]): SimState[] =>
  boards.map((board) => {
    board.attacked = true
    return board
  })

// --- coins -----------------------------------------------------------------

/** Flip until tails; how many heads. Counts each flip on `state`. */
function headsUntilTails(state: SimState, ctx: EffectContext): number {
  let heads = 0
  while (flipCoin(state, ctx.seed)) heads++
  return heads
}

// ===========================================================================
// 1. Energy from the deck, attached
// ===========================================================================

const attackAttach = (text: string, spec: AttachSpec) =>
  registerAttackText(text, { apply: (state, ctx) => attachSearch(state, ctx, ACTIVE_TARGET, spec) })

// Altaria, Houndoom
attackAttach(
  'Search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.',
  { pick: energies(2, isBasicEnergy), where: 'any' },
)
// Whimsicott ex
attackAttach(
  'Search your deck for up to 3 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.',
  { pick: energies(3, isBasicEnergy), where: 'any' },
)
// Articuno
attackAttach(
  'Search your deck for up to 2 Basic {W} Energy cards and attach them to this Pokémon. Then, shuffle your deck.',
  { pick: energies(2, both(isBasicEnergy, ofType('{W}'))), where: 'self' },
)
// Cresselia, Deoxys
attackAttach(
  'Search your deck for up to 2 Basic {P} Energy cards and attach them to this Pokémon. Then, shuffle your deck.',
  { pick: energies(2, both(isBasicEnergy, ofType('{P}'))), where: 'self' },
)
// Okidogi ex (the Poison does nothing here)
attackAttach(
  'Search your deck for up to 2 Basic {D} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.',
  { pick: energies(2, both(isBasicEnergy, ofType('{D}'))), where: 'self' },
)
// Bewear
attackAttach(
  'Search your deck for a Basic Energy card and attach it to this Pokémon. Then, shuffle your deck.',
  { pick: energies(1, isBasicEnergy), where: 'self' },
)
// Exeggcute, Quilladin
attackAttach(
  'Search your deck for a Basic {G} Energy card and attach it to this Pokémon. Then, shuffle your deck.',
  { pick: energies(1, both(isBasicEnergy, ofType('{G}'))), where: 'self' },
)
// Thundurus
attackAttach(
  'Search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.',
  { pick: energies(1, both(isBasicEnergy, ofType('{L}'))), where: 'self' },
)
// Boltund
attackAttach(
  'Search your deck for up to 2 Basic {L} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.',
  { pick: energies(2, both(isBasicEnergy, ofType('{L}'))), where: 'any', target: benched },
)
// Cinderace
attackAttach(
  'Search your deck for up to 3 Basic Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.',
  { pick: energies(3, isBasicEnergy), where: 'any', target: benched },
)
// Mega Floette ex
attackAttach(
  'Search your deck for up to 4 Basic {P} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.',
  { pick: energies(4, both(isBasicEnergy, ofType('{P}'))), where: 'any', target: benched },
)
// The Ogerpon Kaguras: Cornerstone, Hearthflame, Teal, Wellspring
for (const type of ['{F}', '{R}', '{G}', '{W}']) {
  attackAttach(
    `Search your deck for a Basic ${type} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.`,
    { pick: energies(1, both(isBasicEnergy, ofType(type))), where: 'one' },
  )
}
// Flareon ex
attackAttach(
  'Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.',
  { pick: energies(2, isBasicEnergy), where: 'one' },
)
// Joltik
attackAttach(
  'Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.',
  {
    pick: together(energies(2, both(isBasicEnergy, ofType('{G}'))), energies(2, both(isBasicEnergy, ofType('{L}')))),
    where: 'any',
  },
)
// Miraidon
attackAttach(
  'Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.',
  { pick: energies(2, isBasicEnergy), where: 'any', target: (slot) => isFuture(slot.card) },
)
// Terapagos
attackAttach(
  'Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.',
  { pick: energies(3, isBasicEnergy, { differentTypes: true }), where: 'any', target: (slot) => isTera(slot.card) },
)
// Shaymin: any Energy card, Special included
attackAttach(
  'Search your deck for an Energy card and attach it to 1 of your Benched {G} Pokémon. Then, shuffle your deck.',
  { pick: energies(1, isEnergyCard), where: 'one', target: (slot, at) => benched(slot, at) && ofType('{G}')(slot.card) },
)
// Smoochum
attackAttach(
  'Search your deck for up to 2 Basic {P} Energy cards and attach them to 1 of your Benched Pokémon. Then, shuffle your deck.',
  { pick: energies(2, both(isBasicEnergy, ofType('{P}'))), where: 'one', target: benched },
)

// Mega Gardevoir ex: "For each of your Benched Pokémon, search your deck for a
// Basic {P} Energy card and attach it to that Pokémon."
registerAttackText(
  'For each of your Benched Pokémon, search your deck for a Basic {P} Energy card and attach it to that Pokémon. Then, shuffle your deck.',
  {
    apply: (state, ctx) => {
      const found = energies(state.bench.length, both(isBasicEnergy, ofType('{P}')))(state, ctx)
      if (found.length === 0) return []
      const next = cloneState(state)
      found.forEach((energy, i) => {
        removeFirst(next.deck, energy)
        next.bench[i].energy.push(energy)
      })
      return [shuffleDeck(next, state, ctx)]
    },
  },
)

// "Search your deck for up to 4 Basic {W} Energy cards and attach them to 1 of
// your Pokémon. Then, shuffle your deck. Your turn ends."
registerEffect("Misty's Vitality", (state, ctx) =>
  endsTurn(attachSearch(state, ctx, null, { pick: energies(4, both(isBasicEnergy, ofType('{W}'))), where: 'one' })),
)

// "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your
// deck for a Basic {D} Energy card and attach it to that Pokémon." The Poison
// does nothing here. The two that the Energy counts on most.
registerEffect("Janine's Secret Art", (state, ctx) => {
  const targets = countingPositions(state, ctx, (slot) => ofType('{D}')(slot.card)).slice(0, 2)
  const found = energies(targets.length, both(isBasicEnergy, ofType('{D}')))(state, ctx)
  if (found.length === 0) return []
  const next = cloneState(state)
  found.forEach((energy, i) => {
    removeFirst(next.deck, energy)
    slotAt(next, targets[i])!.energy.push(energy)
  })
  return [shuffleDeck(next, state, ctx)]
})

// "When you play this Pokémon from your hand to evolve 1 of your Pokémon during
// your turn, you may search your deck for up to 5 Basic {D} Energy cards and
// attach them to your Marnie's Pokémon in any way you like."
registerAbility("Marnie's Grimmsnarl ex", {
  ability: 'Punk Up',
  onEvolve: true,
  perCopy: true,
  accelerates: true,
  apply: (state, _target, ctx) =>
    attachSearch(state, ctx, null, {
      pick: energies(5, both(isBasicEnergy, ofType('{D}'))),
      where: 'any',
      target: (slot) => nameStarts("Marnie's")(slot.card),
    }),
})

// "Once during your turn, you may search your deck for a Basic {P} Energy card,
// a Basic {M} Energy card, or 1 of each and attach them to your {P} Pokémon and
// {M} Pokémon in any way you like." Each to the first Pokémon of its type that
// the Energy counts on.
registerAbility("Steven's Metagross ex", {
  ability: 'X-Boot',
  accelerates: true,
  apply: (state, _target, ctx) => {
    const next = cloneState(state)
    let attached = 0
    for (const type of ['{P}', '{M}']) {
      const [energy] = energies(1, both(isBasicEnergy, ofType(type)))(next, ctx)
      const [at] = countingPositions(next, ctx, (slot) => ofType(type)(slot.card))
      if (!energy || at === undefined) continue
      removeFirst(next.deck, energy)
      slotAt(next, at)!.energy.push(energy)
      attached++
    }
    return attached > 0 ? [shuffleDeck(next, state, ctx)] : [state]
  },
})

// "When you play this Pokémon from your hand onto your Bench during your turn,
// you may search your deck for a Pokémon Tool card and attach it to this
// Pokémon." Only a Tool the goal names.
registerAbility("Farfetch'd", {
  ability: 'Impromptu Carrier',
  onBenchPlay: true,
  apply: (state, benchIndex, ctx) => {
    const tools = state.deck.filter((card) => isTool(card) && ctx.relevant.has(card.key))
    const seen = new Set<string>()
    return tools
      .filter((card) => !seen.has(card.key) && seen.add(card.key))
      .map((tool) => {
        const next = cloneState(state)
        removeFirst(next.deck, tool)
        next.bench[benchIndex].tools.push(tool)
        return shuffleDeck(next, state, ctx)
      })
  },
})

// ===========================================================================
// 2. Pokémon into the hand
// ===========================================================================

const attackToHand = (text: string, max: number, allowed: (card: DeckCard) => boolean) =>
  registerAttackText(text, { apply: (state, ctx) => toHand(state, ctx, max, allowed) })

// Applin, Togedemaru, Rowlet (Find a Friend); Cryogonal (Call Sign)
attackToHand('Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.', 1, isPokemon)
// Kirlia (Call Sign), Seadra, Frogadier
attackToHand('Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.', 3, isPokemon)
// Tapu Koko
attackToHand(
  'Search your deck for up to 2 {L} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.',
  2,
  both(isPokemon, ofType('{L}')),
)
// Purrloin
attackToHand(
  'Search your deck for up to 3 {D} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.',
  3,
  both(isPokemon, ofType('{D}')),
)
// Misty's Lapras
attackToHand(
  "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
  3,
  both(isPokemon, nameStarts("Misty's")),
)
// Alcremie: Pokémon of any type of Basic Energy attached to it.
registerAttackText(
  'Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.',
  {
    apply: (state, ctx) => {
      const types = new Set(state.active!.energy.filter(isBasicEnergy).map(energyType))
      return toHand(state, ctx, 5, (card) => isPokemon(card) && [...types].some((type) => ofType(type)(card)))
    },
  },
)

// "Search your deck for a Pokémon, reveal it, and put it into your hand."
registerEffect('Master Ball', (state, ctx) => toHand(state, ctx, 1, isPokemon))
// "Search your deck for a Mega Evolution Pokémon ex..."
registerEffect('Mega Signal', (state, ctx) => toHand(state, ctx, 1, isMegaEx))
// "Search your deck for a Tera Pokémon..."
registerEffect('Tera Orb', (state, ctx) => toHand(state, ctx, 1, both(isPokemon, isTera)))
// "Search your deck for up to 3 Stage 1 Pokémon..."
registerEffect('Hyper Aroma', (state, ctx) => toHand(state, ctx, 3, (card) => card.tags.includes('stage1')))
// "You can use this card only if you discard another card from your hand.
// Search your deck for up to 4 {L} Pokémon..."
registerEffect('Canari', (state, ctx) => {
  const paid = payDiscard(state, 1, ctx)
  return paid ? toHand(paid, ctx, 4, both(isPokemon, ofType('{L}'))) : []
})
// "If you go first, you may use this card during your first turn. Search your
// deck for up to 3 Basic Team Rocket's Pokémon..." Played as any Supporter:
// the first-turn exception is not modelled.
registerEffect("Team Rocket's Proton", (state, ctx) =>
  toHand(state, ctx, 3, both(isBasicPokemon, nameStarts("Team Rocket's"))),
)

// "Once during your turn, you may search your deck for a Cynthia's Pokémon..."
registerAbility("Cynthia's Gabite", {
  ability: "Champion's Call",
  perCopy: true,
  draws: true,
  apply: (state, _target, ctx) => orUnchanged(state, toHand(state, ctx, 1, both(isPokemon, nameStarts("Cynthia's")))),
})
// "Once during your turn, you may search your deck for a Pokémon..."
registerAbility('Mamoswine ex', {
  ability: 'Mammoth Hauler',
  perCopy: true,
  draws: true,
  apply: (state, _target, ctx) => orUnchanged(state, toHand(state, ctx, 1, isPokemon)),
})
// "Once during your turn, if this Pokémon has any Energy attached, you may use
// this Ability. Search your deck for an Evolution Pokémon..."
registerAbility('Dragonair', {
  ability: 'Evolutionary Guidance',
  perCopy: true,
  draws: true,
  usable: (_state, slot) => slot.energy.length > 0,
  apply: (state, _target, ctx) => orUnchanged(state, toHand(state, ctx, 1, isEvolution)),
})
// "Once during your first turn, you may search your deck for up to 3 {C}
// Pokémon with 100 HP or less... You can't use more than 1 Fan Call Ability
// during your turn."
registerAbility('Fan Rotom', {
  ability: 'Fan Call',
  draws: true,
  usable: (state) => (state.turn ?? 1) === 1,
  apply: (state, _target, ctx) =>
    orUnchanged(state, toHand(state, ctx, 3, (card) => isPokemon(card) && ofType('{C}')(card) && hp(card) <= 100)),
})

/** An Ability that found nothing is still used up. */
const orUnchanged = (state: SimState, boards: SimState[]) => (boards.length > 0 ? boards : [state])

// ===========================================================================
// 3. Pokémon onto the Bench
// ===========================================================================

const attackToBench = (text: string, max: number, allowed: (card: DeckCard) => boolean, basicOnly = true, firstTurn = false) =>
  registerAttackText(text, { firstTurn, apply: (state, ctx) => toBench(state, ctx, max, allowed, basicOnly) })

// Chatot
attackToBench('Search your deck for up to 3 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.', 3, () => true)
// Falinks (and the other two-Basic attacks not named Call for Family)
attackToBench('Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.', 2, () => true)
// Fidough (and the other one-Basic attacks not named Call for Family)
attackToBench('Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.', 1, () => true)
// Volbeat
attackToBench(
  'If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.',
  2,
  () => true,
  true,
  true,
)
// Froakie, Grubbin
for (const name of ['Froakie', 'Grubbin']) {
  attackToBench(`Search your deck for up to 2 ${name} and put them onto your Bench. Then, shuffle your deck.`, 2, named(name))
}
// Steven's Baltoy
attackToBench(
  "Search your deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then, shuffle your deck.",
  2,
  nameStarts("Steven's"),
)
// Xerneas
attackToBench(
  'Search your deck for up to 3 Basic {P} Pokémon and put them onto your Bench. Then, shuffle your deck.',
  3,
  ofType('{P}'),
)
// Lillie's Comfey
attackToBench(
  "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
  Infinity,
  nameStarts("Lillie's"),
)
// Rotom
attackToBench(
  'You may search your deck for any number of Pokémon that have "Rotom" in their name and put them onto your Bench. Then, shuffle your deck.',
  Infinity,
  nameHas('Rotom'),
)
// Charjabug, Lampent: Stage 1s straight onto the Bench, as the card says.
attackToBench('Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck.', 3, named('Charjabug'), false)
attackToBench('Search your deck for up to 3 Lampent and put them onto your Bench. Then, shuffle your deck.', 3, named('Lampent'), false)
// Maushold
attackToBench(
  'Search your deck for up to 2 in any combination of Maushold and Maushold ex and put them onto your Bench. Then, shuffle your deck.',
  2,
  named('Maushold', 'Maushold ex'),
  false,
)
// Jynx: one Basic, then an Energy moves from Jynx onto it.
registerAttackText(
  'Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck. If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon.',
  {
    apply: (state, ctx) =>
      toBench(state, ctx, 1, () => true).map((board) => {
        const energy = board.active!.energy.pop()
        if (energy) board.bench[board.bench.length - 1].energy.push(energy)
        return board
      }),
  },
)

// "Search your deck for up to 2 Basic Hop's Pokémon and put them onto your Bench."
registerEffect("Hop's Bag", (state, ctx) => toBench(state, ctx, 2, nameStarts("Hop's")))

// "...when you play this Pokémon from your hand to evolve 1 of your Pokémon,
// you may use this Ability. Search your deck for a Shedinja and put it onto
// your Bench." (Ninjask) "...for a Silcoon or a Cascoon..." (Silcoon)
registerAbility('Ninjask', {
  ability: 'Cast-Off Shell',
  onEvolve: true,
  perCopy: true,
  apply: (state, _target, ctx) => orUnchanged(state, toBench(state, ctx, 1, named('Shedinja'), false)),
})
registerAbility('Silcoon', {
  ability: 'Multiplying Cocoon',
  onEvolve: true,
  perCopy: true,
  apply: (state, _target, ctx) => orUnchanged(state, toBench(state, ctx, 1, named('Silcoon', 'Cascoon'), false)),
})

// ===========================================================================
// 4. Trainers into the hand
// ===========================================================================

// Meltan, Noibat
attackToHand('Search your deck for a Pokémon Tool card, reveal it, and put it into your hand. Then, shuffle your deck.', 1, isTool)
// Wiglett, Patrat, Team Rocket's Mareep, Inkay
attackToHand('Search your deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck.', 1, isItem)
// Hop's Silicobra
attackToHand('Search your deck for a Stadium card, reveal it, and put it into your hand. Then, shuffle your deck.', 1, isStadium)
// Sudowoodo
attackToHand(
  'Search your deck for up to 2 Transformation Tome cards, reveal them, and put them into your hand. Then, shuffle your deck.',
  2,
  named('Transformation Tome'),
)
// Musharna
attackToHand(
  'You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck.',
  Infinity,
  named('Fennel'),
)
// Zubat, Team Rocket's Murkrow (Piplup's Call for Support reads the same)
registerAttackText(
  'Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.',
  { apply: supporterToHand },
)

// "Search your deck for up to 2 Item cards... Your turn ends."
registerEffect('Boxed Order', (state, ctx) => endsTurn(toHand(state, ctx, 2, isItem)))
// "Search your deck for up to 3 Pokémon Tool cards that have "Technical
// Machine" in their name..."
registerEffect('TM Machine', (state, ctx) => toHand(state, ctx, 3, both(isTool, nameHas('Technical Machine'))))
// "Search your deck for up to 5 Pokémon Tool cards..."
registerEffect('Treasure Tracker', (state, ctx) => toHand(state, ctx, 5, isTool))
// "You can use this card only if you go second, and only during your first
// turn. Search your deck for a Supporter card..." Going second, turn 1 is the
// one turn the player may attack on from the start.
registerEffect('Call Bell', (state, ctx) =>
  (state.turn ?? 1) === 1 && !state.cannotAttack ? supporterToHand(state, ctx) : [],
)

// "Once during your turn, you may search your deck for a Stadium card..."
registerAbility('Sawsbuck', {
  ability: 'Changing Seasons',
  perCopy: true,
  apply: (state, _target, ctx) => orUnchanged(state, toHand(state, ctx, 1, isStadium)),
})
// "Once during your turn, you may search your deck for an Ethan's Adventure card..."
registerAbility("Ethan's Quilava", {
  ability: 'Bonded by the Journey',
  perCopy: true,
  apply: (state, _target, ctx) => orUnchanged(state, toHand(state, ctx, 1, named("Ethan's Adventure"))),
})
// "Once during your turn, if you have no cards in your hand, you may use this
// Ability. Search your deck for a Supporter card..."
registerAbility('Silvally', {
  ability: 'Call a Buddy',
  perCopy: true,
  draws: true,
  usable: (state) => state.hand.length === 0,
  apply: (state, _target, ctx) => orUnchanged(state, supporterToHand(state, ctx)),
})
// "...when you play this Pokémon from your hand to evolve 1 of your Pokémon, if
// you have any Tera Pokémon in play, you may search your deck for up to 2
// Trainer cards..."
registerAbility('Noctowl', {
  ability: 'Jewel Seeker',
  onEvolve: true,
  perCopy: true,
  draws: true,
  usable: (state) => allInPlay(state).some((slot) => isTera(slot.card)),
  apply: (state, _target, ctx) => orUnchanged(state, toHand(state, ctx, 2, isTrainer)),
})

// ===========================================================================
// 5. Conditional: coins, and cards with a condition to meet
// ===========================================================================

// "Flip a coin. If heads, search your deck for a Pokémon..."
registerEffect('Poké Ball', (state, ctx) => {
  const flipped = cloneState(state)
  if (!flipCoin(flipped, ctx.seed)) return [flipped]
  const boards = toHand(flipped, ctx, 1, isPokemon)
  return boards.length > 0 ? boards : [flipped]
})

// "Flip a coin. If heads, search your deck for an Evolution Team Rocket's
// Pokémon... If tails, ... for a Basic Team Rocket's Pokémon..."
registerEffect("Team Rocket's Great Ball", (state, ctx) => {
  const flipped = cloneState(state)
  const heads = flipCoin(flipped, ctx.seed)
  const boards = toHand(flipped, ctx, 1, both(isPokemon, nameStarts("Team Rocket's"), heads ? isEvolution : isBasicPokemon))
  return boards.length > 0 ? boards : [flipped]
})

// "Flip 2 coins. If both of them are heads, search your deck for a Basic
// Energy card and attach it to 1 of your Pokémon."
registerEffect('Energy Coin', (state, ctx) => {
  const flipped = cloneState(state)
  const heads = [flipCoin(flipped, ctx.seed), flipCoin(flipped, ctx.seed)].every(Boolean)
  if (!heads) return [flipped]
  const boards = attachSearch(flipped, ctx, null, { pick: energies(1, isBasicEnergy), where: 'one' })
  return boards.length > 0 ? boards : [flipped]
})

// Bombirdier: "Flip 2 coins. If both of them are heads, search your deck for a
// Pokémon and put it onto your Bench."
registerAttackText(
  'Flip 2 coins. If both of them are heads, search your deck for a Pokémon and put it onto your Bench. Then, shuffle your deck.',
  {
    apply: (state, ctx) => {
      const flipped = cloneState(state)
      const heads = [flipCoin(flipped, ctx.seed), flipCoin(flipped, ctx.seed)].every(Boolean)
      const boards = heads ? toBench(flipped, ctx, 1, () => true) : []
      return boards.length > 0 ? boards : [flipped]
    },
  },
)

// Gholdengo: "Flip a coin until you get tails. Search your deck for a number
// of cards up to the number of heads..."
registerAttackText(
  'Flip a coin until you get tails. Search your deck for a number of cards up to the number of heads and put them into your hand. Then, shuffle your deck.',
  {
    apply: (state, ctx) => {
      const flipped = cloneState(state)
      const heads = headsUntilTails(flipped, ctx)
      const boards = heads > 0 ? anyCards(flipped, ctx, heads) : []
      return boards.length > 0 ? boards : [flipped]
    },
  },
)

// Snorlax: "Flip a coin until you get tails. Search your deck for an amount of
// Basic Energy up to the number of heads and attach it to this Pokémon."
registerAttackText(
  'Flip a coin until you get tails. Search your deck for an amount of Basic Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck.',
  {
    apply: (state, ctx) => {
      const flipped = cloneState(state)
      const heads = headsUntilTails(flipped, ctx)
      const boards = heads > 0 ? attachSearch(flipped, ctx, ACTIVE_TARGET, { pick: energies(heads, isBasicEnergy), where: 'self' }) : []
      return boards.length > 0 ? boards : [flipped]
    },
  },
)

// Mega Audino ex: "Flip 3 coins. For each heads, search your deck for up to 2
// Basic Energy cards and attach them to your Pokémon in any way you like."
registerAttackText(
  'Flip 3 coins. For each heads, search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.',
  {
    apply: (state, ctx) => {
      const flipped = cloneState(state)
      const heads = [0, 1, 2].filter(() => flipCoin(flipped, ctx.seed)).length
      const boards = heads > 0 ? attachSearch(flipped, ctx, ACTIVE_TARGET, { pick: energies(heads * 2, isBasicEnergy), where: 'any' }) : []
      return boards.length > 0 ? boards : [flipped]
    },
  },
)

// "You can use this card only when it is the last card in your hand. Search
// your deck for up to 2 cards..." The card has already left the hand.
registerEffect('Cassiopeia', (state, ctx) => (state.hand.length === 0 ? anyCards(state, ctx, 2) : []))

// ===========================================================================
// 6. Energy into the hand
// ===========================================================================

// Gimmighoul, Axew, Charcadet, Emolga, Larry's Starly, Teal Mask Ogerpon
attackToHand(
  'Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.',
  2,
  isBasicEnergy,
)
// Ponyta
attackToHand('Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck.', 1, isBasicEnergy)
// Floette
attackToHand('Search your deck for up to 3 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.', 3, isBasicEnergy)
// Heliolisk: any Energy, Special included
attackToHand('Search your deck for up to 4 Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.', 4, isEnergyCard)
// Eevee
registerAttackText(
  'Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.',
  { apply: (state, ctx) => energyOfDifferentTypes(state, ctx, 3) },
)
// Heatmor
attackToHand(
  'Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.',
  3,
  (card) => ofType('{R}')(card) && (isPokemon(card) || isBasicEnergy(card)),
)

// "Search your deck for a Basic Energy card..."
registerEffect('Energy Search', (state, ctx) => toHand(state, ctx, 1, isBasicEnergy))
// "Search your deck for any number of Basic Energy cards of different types..."
registerEffect('Energy Search Pro', (state, ctx) => energyOfDifferentTypes(state, ctx, Infinity))
// "Search your deck for up to 7 Basic {R} Energy cards..."
registerEffect('Firebreather', (state, ctx) => toHand(state, ctx, 7, both(isBasicEnergy, ofType('{R}'))))
// "Search your deck for up to 3 in any combination of Ethan's Pokémon and
// Basic {R} Energy cards..."
registerEffect("Ethan's Adventure", (state, ctx) =>
  toHand(state, ctx, 3, (card) => (isPokemon(card) && nameStarts("Ethan's")(card)) || both(isBasicEnergy, ofType('{R}'))(card)),
)
// "Search your deck for a Stadium card and an Energy card..." Each found if it
// is worth having.
registerEffect("Colress's Tenacity", (state, ctx) => {
  const [stadium] = pickUpTo(state, ctx, 1, isStadium)
  const [energy] = pickUpTo(state, ctx, 1, isEnergyCard)
  const picks = [stadium, energy].filter((card): card is DeckCard => card !== undefined)
  if (picks.length === 0) return []
  const next = cloneState(state)
  for (const pick of picks) {
    removeFirst(next.deck, pick)
    next.hand.push(pick)
  }
  return [shuffleDeck(next, state, ctx)]
})
// "Discard your hand and search your deck for a Pokémon, a Supporter card, and
// a Basic Energy card..." The hand goes even if the deck has none of them.
registerEffect("Larry's Skill", (state, ctx) => {
  const next = cloneState(state)
  next.discard.push(...next.hand)
  next.hand = []
  const picks = [
    pickUpTo(next, ctx, 1, isPokemon)[0],
    // The turn's Supporter is spent; one for next turn is what it is for.
    next.deck.find((card) => isSupporter(card) && (ctx.relevant.has(card.key) || isPlayableSupporter(card))),
    pickUpTo(next, ctx, 1, isBasicEnergy)[0],
  ].filter((card): card is DeckCard => card !== undefined)
  for (const pick of picks) {
    removeFirst(next.deck, pick)
    next.hand.push(pick)
  }
  return [shuffleDeck(next, state, ctx)]
})

// "Once during your turn, you may use this Ability. Search your deck for up to
// 2 Basic {P} Energy cards..."
registerAbility('Aromatisse', {
  ability: 'Scent Collection',
  perCopy: true,
  apply: (state, _target, ctx) => orUnchanged(state, toHand(state, ctx, 2, both(isBasicEnergy, ofType('{P}')))),
})

// ===========================================================================
// 7. Evolving straight from the deck
// ===========================================================================

// Dwebble, Misdreavus, Eevee (Ascension); Team Rocket's Pupitar
registerAttackText(
  'Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.',
  { apply: (state, ctx) => evolveOne(state, ctx, [ACTIVE_TARGET]) },
)
// Exeggcute
registerAttackText(
  'If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.',
  { firstTurn: true, apply: (state, ctx) => evolveOne(state, ctx, [ACTIVE_TARGET]) },
)
// Duosion
registerAttackText(
  'Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.',
  { apply: (state, ctx) => evolveOne(state, ctx, positions(state)) },
)
// Reuniclus, Vivillon
for (const text of [
  'For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.',
]) {
  registerAttackText(text, { apply: (state, ctx) => evolveEach(state, ctx, state.bench.map((_, i) => i)) })
}
// Team Rocket's Nidorina: up to 2 of your {D} Pokémon.
registerAttackText(
  'Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.',
  {
    apply: (state, ctx) =>
      evolveEach(
        state,
        ctx,
        positions(state).filter((at) => ofType('{D}')(slotAt(state, at)!.card)),
        2,
      ),
  },
)
// "Search your deck for a card that has no Abilities and evolves from 1 of
// your Pokémon, and put it onto that Pokémon to evolve it... You can use this
// card on a Pokémon you put down when you were setting up to play or on a
// Pokémon that was put into play this turn."
registerEffect('Salvatore', (state, ctx) =>
  evolveOne(state, ctx, positions(state), (card) => !(card.card?.moves ?? []).some((move) => move.name.startsWith('[Ability]'))),
)

// ===========================================================================
// 8. Any card into the hand, or onto the top of the deck
// ===========================================================================

// Delibird
registerAttackText(
  'If you go first, you can use this attack during your first turn. Search your deck for a card and put it into your hand. Then, shuffle your deck.',
  { firstTurn: true, apply: (state, ctx) => anyCards(state, ctx, 1) },
)
// Banette, Greninja ex
registerAttackText('You may search your deck for a card and put it into your hand. Then, shuffle your deck.', {
  apply: (state, ctx) => anyCards(state, ctx, 1),
})
// Noctowl (Talon Hunt)
registerAttackText('You may search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.', {
  apply: (state, ctx) => anyCards(state, ctx, 2),
})
// Salazzle ex
registerAttackText('Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.', {
  apply: (state, ctx) => anyCards(state, ctx, 2),
})
// Serperior ex
registerAttackText('You may search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.', {
  apply: (state, ctx) => anyCards(state, ctx, 3),
})
// Dialga: "Search your deck for 2 cards, shuffle your deck, then put those
// cards on top of it in any order." For next turn's draw.
registerAttackText(
  'Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order.',
  { apply: (state, ctx) => stackOnTop(state, ctx, topCandidates(state, ctx, 4), 2) },
)
// "Once during your turn, if this Pokémon is in the Active Spot, you may use
// this Ability. Search your deck for a card. Shuffle your deck, then put that
// card on top of it."
registerAbility('Crobat', {
  ability: 'Nighttime Maneuvers',
  activeOnly: true,
  apply: (state, _target, ctx) => orUnchanged(state, stackOnTop(state, ctx, topCandidates(state, ctx, 4), 1)),
})
