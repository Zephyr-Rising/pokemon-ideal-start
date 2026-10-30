import { norm } from '../normalize'
import type { DeckCard } from '../types'
import { supporterChoices, takeFromTop } from './deck-look'
import { choices, isPlayableSupporter, payDiscard, type EffectContext } from './effects'
import {
  ACTIVE_TARGET,
  benchCap,
  nameOf,
  cloneState,
  energyType,
  fairShuffle,
  shufflesAfter,
  type InPlay,
  type SimState,
} from './state'

/**
 * Pokémon Abilities that can change your own board.
 *
 * On turn 1 only Basic Pokémon are in play, and across the whole Standard pool
 * only five Basics have a draw or search Ability that works then; all five are
 * here. From turn 2 Pokémon evolve, so the draw Abilities of evolutions —
 * Drakloak, Dudunsparce, N's Zoroark ex, Kadabra and Alakazam — come online
 * too. Fezandipiti ex needs one of your Pokémon to have been Knocked Out, which
 * cannot happen without an opponent, so it stays out.
 *
 * The rest of the file covers the Abilities that move Pokémon around, which
 * matter just as much for reaching a particular board. Latias ex's Skyliner is
 * a passive, so it lives in `state.ts` beside the retreat cost it changes.
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
  /**
   * Each copy may use it once a turn, rather than once a turn across copies.
   * Tracked on the Pokémon itself instead of by name.
   */
  perCopy?: boolean
  /** Fires as the Pokémon is played from hand to evolve, rather than at will. */
  onEvolve?: boolean
  /** Draws or searches, so evolving into it is worth it even unnamed. */
  draws?: boolean
  /** Extra conditions beyond position and once-per-turn. */
  usable?: (state: SimState, slot: InPlay) => boolean
  /** Every board this Ability can produce. */
  apply: (state: SimState, target: number, ctx: EffectContext) => SimState[]
  /**
   * Set on draw and search Abilities: what else the Ability needs, so that a
   * search card can fetch the missing piece even when the goal never names it.
   */
  engine?: EnginePieces
}

export interface EnginePieces {
  /** Another Pokémon that must be in play, as Solrock is for Lunar Cycle. */
  partner?: string
  /** A card the Ability spends from hand, such as the Energy it discards. */
  fuel?: (card: DeckCard) => boolean
  /** Anything else that decides whether the Ability would do anything now. */
  worthIt?: (state: SimState) => boolean
}

const ABILITIES = new Map<string, AbilityDef>()

const register = (pokemon: string, def: AbilityDef) => ABILITIES.set(norm(pokemon), def)

export const abilityOf = (card: DeckCard): AbilityDef | undefined =>
  ABILITIES.get(nameOf(card))

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
  inPlayCards(state).some((slot) => nameOf(slot.card) === norm(name))

const holdsEnergy = (state: SimState, type: string) =>
  state.hand.some((card) => isBasicEnergy(card) && energyType(card) === type)

/** Mark an Ability as spent for the turn. */
function spend(state: SimState, target: number): SimState {
  const next = cloneState(state)
  const slot = slotAt(next, target)!
  if (abilityOf(slot.card)?.perCopy) slot.usedAbility = true
  else next.usedAbilities = [...next.usedAbilities, nameOf(slot.card)]
  return next
}

const spent = (state: SimState, slot: InPlay) =>
  abilityOf(slot.card)?.perCopy
    ? slot.usedAbility === true
    : state.usedAbilities.includes(nameOf(slot.card))

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
  // Abilities that trigger on a play are not moves the player chooses to make.
  if (!def || def.onBenchPlay || def.onEvolve) return false
  if (def.activeOnly && target !== ACTIVE_TARGET) return false
  if (spent(state, slot)) return false
  return def.usable ? def.usable(state, slot) : true
}

export function useAbility(state: SimState, target: number, ctx: EffectContext): SimState[] {
  const slot = slotAt(state, target)
  const def = slot && abilityOf(slot.card)
  if (!slot || !def) return [state]
  return def.apply(spend(state, target), target, ctx)
}

/**
 * Abilities that fire as a Pokémon is played from hand to evolve — Kadabra and
 * Alakazam's Psychic Draw. Rare Candy counts: it plays the Stage 2 from hand.
 * Optional, so the declined board comes back too.
 */
export function onEvolve(state: SimState, target: number, ctx: EffectContext): SimState[] {
  const slot = slotAt(state, target)
  const def = slot && abilityOf(slot.card)
  if (!slot || !def?.onEvolve || spent(state, slot)) return [state]
  if (def.usable && !def.usable(state, slot)) return [state]
  return [...def.apply(spend(state, target), target, ctx), state]
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
  if (!slot || !def?.onBenchPlay || spent(state, slot)) return [state]
  if (def.usable && !def.usable(state, slot)) return [state]
  return [...def.apply(spend(state, benchIndex), benchIndex, ctx), state]
}

/** One card a draw engine needs, and where it stands. */
interface EnginePiece {
  is: (card: DeckCard) => boolean
  /** In play, or in hand. Fuel only counts in hand, since it is spent from there. */
  held: boolean
  /** Held only because it is in hand, so discarding it would lose it. */
  onlyInHand: boolean
  /** A Pokémon that still has to be benched before the engine runs. */
  needsBench: boolean
}

/**
 * The draw engines worth building this turn, piece by piece.
 *
 * Pieces are the Pokémon, its partner, then its fuel. An engine with several
 * pieces counts only once one of them is already held (in play, or in hand
 * where a Basic can still be benched), so a deck is not dragged into building
 * an engine it has shown no sign of using. Abilities that only work from the
 * Active Spot are left out: getting one there costs a switch on top of the
 * fetch, which a draw of 2 does not repay.
 */
function liveEngines(state: SimState): EnginePiece[][] {
  const named = (name: string) => {
    const wanted = norm(name)
    return (card: DeckCard) => nameOf(card) === wanted
  }
  const pokemonPiece = (name: string): EnginePiece => {
    const is = named(name)
    const inPlayNow = inPlayCards(state).some((slot) => is(slot.card))
    const inHand = state.hand.some(is)
    return { is, held: inPlayNow || inHand, onlyInHand: !inPlayNow && inHand, needsBench: !inPlayNow }
  }
  const fuelPiece = (is: (card: DeckCard) => boolean): EnginePiece => {
    const inHand = state.hand.some(is)
    return { is, held: inHand, onlyInHand: inHand, needsBench: false }
  }
  const free = benchCap(state) - state.bench.length
  const engines: EnginePiece[][] = []

  for (const [pokemon, def] of ABILITIES) {
    const engine = def.engine
    if (!engine || def.activeOnly) continue
    if (state.usedAbilities.includes(pokemon)) continue
    if (engine.worthIt && !engine.worthIt(state)) continue

    const pieces = [
      pokemonPiece(pokemon),
      ...(engine.partner ? [pokemonPiece(engine.partner)] : []),
      ...(engine.fuel ? [fuelPiece(engine.fuel)] : []),
    ]
    if (pieces.length > 1 && pieces.every((piece) => !piece.held)) continue
    // A missing piece has to be somewhere a card can fetch it from, or holding
    // a Grass Energy would keep Teal Dance alive in a deck with no Ogerpon.
    const reachable = (piece: EnginePiece) =>
      state.deck.some(piece.is) || state.discard.some(piece.is)
    if (pieces.some((piece) => !piece.held && !reachable(piece))) continue
    // Every Pokémon not yet in play needs a bench slot, held or not.
    if (pieces.filter((piece) => piece.needsBench).length > free) continue
    engines.push(pieces)
  }
  return engines
}

/**
 * Deck or discard cards worth fetching because they finish a draw engine.
 *
 * The goal names the board you want, not the engine that digs for it, so
 * without this a search card could never fetch Solrock or the Energy Lunar
 * Cycle discards. Only the **first** missing piece is offered: the Energy is
 * worthless while Solrock is still in the deck, and offering everything would
 * multiply the search.
 */
export function engineWants(state: SimState): (card: DeckCard) => boolean {
  const wanted = liveEngines(state)
    .map((pieces) => pieces.find((piece) => !piece.held))
    .filter((piece): piece is EnginePiece => piece !== undefined)
  return (card) => wanted.some((piece) => piece.is(card))
}

/**
 * Pokémon a draw engine needs on the Bench this turn: the engine Pokémon or
 * its partner, while that engine can still run. Benching one of these spends a
 * bench slot on a play that is going somewhere.
 */
export function engineBenches(state: SimState): (card: DeckCard) => boolean {
  const pieces = liveEngines(state)
    .flat()
    .filter((piece) => piece.needsBench)
  return (card) => pieces.some((piece) => piece.is(card))
}

/**
 * Indices of hand cards that a draw engine is counting on, so a discard cost
 * pitches something else first. One copy per piece: a second {F} Energy is
 * not needed for Lunar Cycle, so it is as expendable as any other card.
 */
export function engineKeeps(state: SimState): Set<number> {
  const keep = new Set<number>()
  for (const pieces of liveEngines(state)) {
    for (const piece of pieces) {
      if (!piece.onlyInHand) continue
      const at = state.hand.findIndex((card, index) => piece.is(card) && !keep.has(index))
      if (at >= 0) keep.add(at)
    }
  }
  return keep
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
  engine: {
    worthIt: (state) => !state.usedSupporter && state.deck.some(isPlayableSupporter),
  },
  apply: (state, _target, ctx) => {
    const supporters = state.deck.filter((card) => card.tags.includes('supporter'))
    const wanted = supporters.filter((card) => ctx.relevant.has(card.key))
    // With no Supporter the goal names, any the simulator can play will do — a
    // Supporter in hand is what this Ability is for.
    const found = distinct(wanted.length > 0 ? wanted : supporters.filter(isPlayableSupporter))
    if (found.length === 0) return [state]
    return found.map((card) => fetch(state, card))
  },
})

// "Once during your turn, you may attach a Basic {G} Energy from your hand to
// this Pokemon. If you do, draw a card." An extra attachment: it does not use
// your one attachment for the turn.
register('Teal Mask Ogerpon ex', {
  ability: 'Teal Dance',
  // Each Ogerpon has its own; nothing on the card caps it across copies.
  perCopy: true,
  engine: { fuel: (card) => isBasicEnergy(card) && energyType(card) === '{G}' },
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
  engine: {
    partner: 'Solrock',
    fuel: (card) => isBasicEnergy(card) && energyType(card) === '{F}',
  },
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
      (card) => card.tags.includes('pokemon') && nameOf(card).startsWith('erikas '),
    )
    const wanted = erikas.filter((card) => ctx.relevant.has(card.key))
    const found = distinct(wanted.length > 0 ? wanted : erikas)
    if (found.length === 0) return [state]
    return found.map((card) => fetch(state, card))
  },
})

// "Once during your turn, if this Pokémon is in the Active Spot, you may look at
// the top 6 cards of your deck, reveal a Supporter card you find there, and put
// it into your hand. Shuffle the other cards back into your deck."
register('Tatsugiri', {
  ability: 'Attract Customers',
  activeOnly: true,
  apply: (state, _target, ctx) => {
    const found = supporterChoices(state, 6, ctx)
    if (found.length === 0) return [takeFromTop(state, 6, [], ctx)]
    return found.map((card) => takeFromTop(state, 6, [card], ctx))
  },
})

// --- evolutions (turn 2 onward) -------------------------------------------

// "Once during your turn, you may look at the top 2 cards of your deck and put
// 1 of them into your hand. Put the other card on the bottom of your deck."
register('Drakloak', {
  ability: 'Recon Directive',
  perCopy: true,
  draws: true,
  usable: (state) => state.deck.length > 0,
  apply: (state) => {
    const top = distinct(state.deck.slice(0, 2))
    return top.map((card) => {
      const next = cloneState(state)
      const [a, b] = next.deck.splice(0, 2)
      const kept = a.key === card.key ? a : b
      const other = kept === a ? b : a
      next.hand.push(kept)
      if (other) next.deck.push(other)
      return next
    })
  },
})

// "Once during your turn, you may draw 3 cards. If you drew any cards in this
// way, shuffle this Pokémon and all attached cards into your deck."
register('Dudunsparce', {
  ability: 'Run Away Draw',
  draws: true,
  usable: (state, slot) =>
    state.deck.length > 0 &&
    // An Active that leaves needs a benched Pokémon to take its place.
    (slot !== state.active || state.bench.length > 0),
  apply: (state, target, ctx) => {
    const drawn = drawInto(state, 3)
    const leaving = slotAt(drawn, target)!
    const returned = [leaving.card, ...leaving.energy, ...leaving.tools]
    const shuffleBack = (next: SimState) => {
      next.deck = fairShuffle(state, [...next.deck, ...returned], ctx.seed)
      next.shuffles = shufflesAfter(state)
      return next
    }
    if (target !== ACTIVE_TARGET) {
      const next = cloneState(drawn)
      next.bench.splice(target, 1)
      return [shuffleBack(next)]
    }
    // Leaving the Active Spot: each distinct benched Pokémon could step up.
    const seen = new Set<string>()
    const out: SimState[] = []
    drawn.bench.forEach((slot, benchIndex) => {
      if (seen.has(slot.card.key)) return
      seen.add(slot.card.key)
      const next = cloneState(drawn)
      next.active = next.bench[benchIndex]
      next.bench.splice(benchIndex, 1)
      out.push(shuffleBack(next))
    })
    return out
  },
})

// "You must discard a card from your hand in order to use this Ability. Once
// during your turn, you may draw 2 cards."
register("N's Zoroark ex", {
  ability: 'Trade',
  perCopy: true,
  draws: true,
  usable: (state) => state.hand.length > 0 && state.deck.length > 0,
  apply: (state, _target, ctx) => {
    const paid = payDiscard(state, 1, ctx)
    return paid ? [drawInto(paid, 2)] : [state]
  },
})

// "Once during your turn, you may attach a Basic {G} Energy card from your hand
// to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, heal
// 30 damage from that Pokémon." An attachment on top of the turn's own.
register('Hydrapple ex', {
  ability: 'Ripening Charge',
  perCopy: true,
  usable: (state) => holdsEnergy(state, '{G}'),
  apply: (state, _target, ctx) => {
    const at = state.hand.findIndex((card) => isBasicEnergy(card) && energyType(card) === '{G}')
    if (at < 0) return []
    // Where it helps: a Pokémon the goal wants Energy on (or an earlier stage
    // of one), else anywhere the goal names. Identical Pokémon tried once.
    const wants = ctx.energyLineage ?? ctx.energyTargets
    const slots = [
      ...(state.active ? [{ slot: state.active, target: ACTIVE_TARGET }] : []),
      ...state.bench.map((slot, target) => ({ slot, target })),
    ]
    const useful = slots.filter(({ slot }) =>
      ctx.wantsEnergy ? wants.size === 0 || wants.has(slot.card.key) : ctx.relevant.has(slot.card.key),
    )
    const seen = new Set<string>()
    const out: SimState[] = []
    for (const { slot, target } of useful) {
      const same = `${target === ACTIVE_TARGET ? 'A' : 'B'}${slot.card.key}+${slot.energy.length}`
      if (seen.has(same)) continue
      seen.add(same)
      const next = cloneState(state)
      const [energy] = next.hand.splice(at, 1)
      slotAt(next, target)!.energy.push(energy)
      out.push(next)
    }
    return out
  },
})

// "Once during your turn, if your Active Pokémon has the Festival Lead Ability,
// you may search your deck for a card and put it into your hand. Then, shuffle
// your deck." Dipplin, Seaking, Goldeen and Swirlix carry Festival Lead.
register('Thwackey', {
  ability: 'Boom Boom Groove',
  perCopy: true,
  draws: true,
  usable: (state) =>
    state.active !== null && hasAbilityNamed(state.active.card, 'Festival Lead') && state.deck.length > 0,
  apply: (state, _target, ctx) => {
    // Any card at all, so the choice is narrowed the way every search is: what
    // the goal wants or an engine needs, else a Supporter still to be played.
    let found = choices(state, state.deck, () => true, ctx)
    if (found.length === 0 && !state.usedSupporter) {
      found = distinct(state.deck.filter(isPlayableSupporter))
    }
    // Searching for nothing is not a play.
    return found.map((card) => {
      const next = fetch(state, card)
      next.deck = fairShuffle(next, next.deck, ctx.seed)
      next.shuffles = shufflesAfter(next)
      return next
    })
  },
})

/** Does this card carry an Ability of this name, by its printed text? */
const hasAbilityNamed = (card: DeckCard, name: string): boolean =>
  (card.card?.moves ?? []).some((move) => move.name === `[Ability] ${name}`)

// "Once during your turn, when you play this Pokémon from your hand to evolve 1
// of your Pokémon, you may use this Ability. Draw 2 cards." (Kadabra) and
// "...Draw 3 cards." (Alakazam). Kadabra and Alakazam share the Ability's name,
// but each is once per Pokémon played, so it is tracked per copy.
register('Kadabra', {
  ability: 'Psychic Draw',
  onEvolve: true,
  perCopy: true,
  draws: true,
  apply: (state) => [drawInto(state, 2)],
})
register('Alakazam', {
  ability: 'Psychic Draw',
  onEvolve: true,
  perCopy: true,
  draws: true,
  apply: (state) => [drawInto(state, 3)],
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
    nameOf(slot.card) !== norm('Pecharunt ex')
  )
}
