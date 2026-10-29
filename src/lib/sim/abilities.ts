import { norm } from '../normalize'
import type { DeckCard } from '../types'
import type { EffectContext } from './effects'
import { ACTIVE_TARGET, cardName, cloneState, energyType, type InPlay, type SimState } from './state'

/**
 * Pokémon Abilities that can change your own board on turn 1.
 *
 * Only Basic Pokémon are ever in play on turn 1, so an Ability on an evolution
 * — Dudunsparce's Run Away Draw, Alakazam's Psychic Draw, N's Zoroark ex's
 * Trade — simply cannot fire, and is absent by design rather than by omission.
 * Fezandipiti ex needs one of your Pokémon to have been Knocked Out, which also
 * cannot have happened yet.
 *
 * Across the whole Standard pool only five Basics have a draw or search Ability
 * that works on turn 1, and all five are here. The rest of the file covers the
 * Abilities that move Pokémon around, which matter just as much for reaching a
 * particular board. Latias ex's Skyliner is a passive, so it lives in `state.ts`
 * beside the retreat cost it changes.
 */

export interface AbilityDef {
  /** The Ability's own name, for the readable line of play. */
  ability: string
  /** Usable only from the Active Spot. */
  activeOnly?: boolean
  /** Fires as the Pokémon is benched, rather than at will. */
  onBenchPlay?: boolean
  /** Changes which Pokémon is Active, so it is pointless without an Active goal. */
  switchesActive?: boolean
  /** Extra conditions beyond position and once-per-turn. */
  usable?: (state: SimState, slot: InPlay) => boolean
  /** Every board this Ability can produce. */
  apply: (state: SimState, target: number, ctx: EffectContext) => SimState[]
}

const ABILITIES = new Map<string, AbilityDef>()

const register = (pokemon: string, def: AbilityDef) => ABILITIES.set(norm(pokemon), def)

export const abilityOf = (card: DeckCard): AbilityDef | undefined =>
  ABILITIES.get(norm(cardName(card)))

/** Names of every Pokémon whose Ability the simulator knows how to use. */
export const implementedAbilities = (): string[] => [...ABILITIES.keys()].sort()

// --- helpers ---------------------------------------------------------------

const slotAt = (state: SimState, target: number): InPlay | undefined =>
  target === ACTIVE_TARGET ? (state.active ?? undefined) : state.bench[target]

/** Draw from the top of the deck; running out simply draws fewer. */
function drawInto(state: SimState, count: number): SimState {
  const next = cloneState(state)
  next.hand.push(...next.deck.splice(0, count))
  return next
}

const isBasicEnergy = (card: DeckCard) => card.tags.includes('basic-energy')

const inPlayCards = (state: SimState): InPlay[] =>
  state.active ? [state.active, ...state.bench] : state.bench

const hasInPlay = (state: SimState, name: string) =>
  inPlayCards(state).some((slot) => norm(cardName(slot.card)) === norm(name))

const holdsEnergy = (state: SimState, type: string) =>
  state.hand.some((card) => isBasicEnergy(card) && energyType(card) === type)

/** Mark an Ability as spent for the turn. */
function spend(state: SimState, card: DeckCard): SimState {
  const next = cloneState(state)
  next.usedAbilities = [...next.usedAbilities, norm(cardName(card))]
  return next
}

const spent = (state: SimState, card: DeckCard) =>
  state.usedAbilities.includes(norm(cardName(card)))

/** Pull one named card out of the deck and into hand. */
function fetch(state: SimState, card: DeckCard): SimState {
  const next = cloneState(state)
  next.deck.splice(
    next.deck.findIndex((c) => c.key === card.key),
    1,
  )
  next.hand.push(card)
  return next
}

/** Distinct cards, so interchangeable copies are branched on once. */
function distinct(cards: DeckCard[]): DeckCard[] {
  const seen = new Set<string>()
  return cards.filter((card) => !seen.has(card.key) && seen.add(card.key))
}

/** Swap a benched Pokémon with the Active. */
function switchIn(state: SimState, benchIndex: number): SimState {
  const next = cloneState(state)
  const active = next.active!
  next.active = next.bench[benchIndex]
  next.bench[benchIndex] = active
  return next
}

/**
 * Is this Ability usable right now?
 *
 * Every Ability here reads "once during your turn", and the ones that spell it
 * out ("You can't use more than 1 Run Errand Ability each turn") cap across
 * copies, which is why the record is keyed on the Ability rather than on the
 * Pokémon using it.
 */
export function abilityAvailable(state: SimState, target: number): boolean {
  const slot = slotAt(state, target)
  if (!slot) return false
  const def = abilityOf(slot.card)
  // An on-bench-play Ability is not a move the player chooses to make.
  if (!def || def.onBenchPlay) return false
  if (def.activeOnly && target !== ACTIVE_TARGET) return false
  if (spent(state, slot.card)) return false
  return def.usable ? def.usable(state, slot) : true
}

export function useAbility(state: SimState, target: number, ctx: EffectContext): SimState[] {
  const slot = slotAt(state, target)
  const def = slot && abilityOf(slot.card)
  if (!slot || !def) return [state]
  return def.apply(spend(state, slot.card), target, ctx)
}

/**
 * Abilities that fire when a Pokémon is benched, applied as it arrives.
 *
 * Each is optional ("you may"), so the board where it was declined comes back
 * alongside the ones where it fired — declining is occasionally right, and the
 * search should be able to see both.
 */
export function onBenchPlay(state: SimState, benchIndex: number, ctx: EffectContext): SimState[] {
  const slot = state.bench[benchIndex]
  const def = slot && abilityOf(slot.card)
  if (!slot || !def?.onBenchPlay || spent(state, slot.card)) return [state]
  if (def.usable && !def.usable(state, slot)) return [state]
  return [...def.apply(spend(state, slot.card), benchIndex, ctx), state]
}

// --- draw and search -------------------------------------------------------

// "Once during your turn, if this Pokemon is in the Active Spot, draw 2 cards."
register('Mega Kangaskhan ex', {
  ability: 'Run Errand',
  activeOnly: true,
  apply: (state) => [drawInto(state, 2)],
})

// "When you play this Pokemon from your hand onto your Bench, search your deck
// for a Supporter card and put it into your hand."
register('Meowth ex', {
  ability: 'Last-Ditch Catch',
  onBenchPlay: true,
  apply: (state, _target, ctx) => {
    const supporters = state.deck.filter((card) => card.tags.includes('supporter'))
    const wanted = supporters.filter((card) => ctx.relevant.has(card.key))
    // With no Supporter the goal names, any will do — a Supporter in hand is
    // what this Ability is for, and the line may still find a use for it.
    const found = distinct(wanted.length > 0 ? wanted : supporters)
    if (found.length === 0) return [state]
    return found.map((card) => fetch(state, card))
  },
})

// "Once during your turn, you may attach a Basic {G} Energy from your hand to
// this Pokemon. If you do, draw a card." An extra attachment: it does not use
// your one attachment for the turn.
register('Teal Mask Ogerpon ex', {
  ability: 'Teal Dance',
  usable: (state) => holdsEnergy(state, '{G}'),
  apply: (state, target) => {
    const next = cloneState(state)
    const at = next.hand.findIndex((card) => isBasicEnergy(card) && energyType(card) === '{G}')
    if (at < 0) return [state]
    const [energy] = next.hand.splice(at, 1)
    slotAt(next, target)!.energy.push(energy)
    return [drawInto(next, 1)]
  },
})

// "Once during your turn, if you have Solrock in play, you may discard a Basic
// {F} Energy card from your hand in order to use this Ability. Draw 3 cards."
//
// Solrock itself has no Ability -- only the Cosmic Beam attack -- so its entire
// turn-1 job is being on the board to switch this on. Both halves are {F}.
register('Lunatone', {
  ability: 'Lunar Cycle',
  usable: (state) => hasInPlay(state, 'Solrock') && holdsEnergy(state, '{F}'),
  apply: (state) => {
    const next = cloneState(state)
    const at = next.hand.findIndex((card) => isBasicEnergy(card) && energyType(card) === '{F}')
    if (at < 0) return [state]
    next.discard.push(...next.hand.splice(at, 1))
    return [drawInto(next, 3)]
  },
})

// "Once during your turn, you may search your deck for an Erika's Pokemon and
// put it into your hand."
register("Erika's Tangela", {
  ability: 'Gathering of Blossoms',
  apply: (state, _target, ctx) => {
    const erikas = state.deck.filter(
      (card) => card.tags.includes('pokemon') && norm(cardName(card)).startsWith('erikas '),
    )
    const wanted = erikas.filter((card) => ctx.relevant.has(card.key))
    const found = distinct(wanted.length > 0 ? wanted : erikas)
    if (found.length === 0) return [state]
    return found.map((card) => fetch(state, card))
  },
})

// --- moving Pokémon around -------------------------------------------------

// "When you play this Pokemon from your hand onto your Bench, you may switch it
// with your Active Pokemon."
register('Iron Leaves ex', {
  ability: 'Rapid Vernier',
  onBenchPlay: true,
  usable: (state) => state.active !== null,
  apply: (state, benchIndex) => [switchIn(state, benchIndex)],
})

// "Once during your turn, you may switch 1 of your Benched {D} Pokemon, except
// any Pecharunt ex, with your Active Pokemon."
register('Pecharunt ex', {
  ability: 'Subjugating Chains',
  switchesActive: true,
  usable: (state) => state.bench.some(isDarkSwitchTarget),
  apply: (state) => {
    const seen = new Set<string>()
    const boards: SimState[] = []
    state.bench.forEach((slot, benchIndex) => {
      if (!isDarkSwitchTarget(slot) || seen.has(slot.card.key)) return
      seen.add(slot.card.key)
      boards.push(switchIn(state, benchIndex))
    })
    return boards.length > 0 ? boards : [state]
  },
})

/** A benched {D} Pokémon that Subjugating Chains may switch in. */
function isDarkSwitchTarget(slot: InPlay): boolean {
  return (
    (slot.card.card?.type ?? '').includes('{D}') &&
    norm(cardName(slot.card)) !== norm('Pecharunt ex')
  )
}
