import { norm } from '../normalize'
import type { DeckCard } from '../types'
import { distinctCards } from './deck-look'
import { benchFromDeck, isPlayableSupporter, type EffectContext } from './effects'
import {
  benchCap,
  cloneState,
  energyProvides,
  fairShuffle,
  isBasicPokemon,
  isStadium,
  nameOf,
  shufflesAfter,
  allInPlay,
  type InPlay,
  type SimState,
} from './state'

/**
 * Attacks that build your own board: the ones that search the deck.
 *
 * Damage does not matter here — there is no opponent — but an attack like
 * Celebi's Traverse Time is how some decks find their Stage 2 lines, and
 * leaving it out made those decks look turns slower than they are. An attack
 * ends the turn, needs its Energy cost on the Active Pokémon, and the player
 * going first cannot attack on their first turn.
 *
 * Keyed on the attack's printed name, so it applies to whichever printing
 * carries it; the cost is read from the card.
 */

export interface AttackDef {
  /** Every board the attack can lead to. */
  apply: (state: SimState, ctx: EffectContext) => SimState[]
  /**
   * "If you go first, you can use this attack during your first turn." (Quick
   * Gift, Precocious Evolution, Quick Sign)
   */
  firstTurn?: boolean
}

const ATTACKS = new Map<string, AttackDef>()

/**
 * Attacks keyed on their exact printed text rather than their name: many
 * attacks share a name with different wording ("Call Sign" fetches one Pokémon
 * on Cryogonal and three on Kirlia), so each wording is registered on its own
 * and anything else stays inert.
 */
const BY_TEXT = new Map<string, AttackDef>()

const textKey = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Register an attack by its exact printed text. */
export function registerAttackText(text: string, def: AttackDef): void {
  BY_TEXT.set(textKey(text), def)
}

/** Every text registered, for the test that each matches a printed card. */
export const registeredAttackTexts = (): string[] => [...BY_TEXT.keys()]

/** Per card, since the search asks millions of times. */
const attackCache = new WeakMap<
  DeckCard,
  { name: string; cost: string; def: AttackDef } | null
>()

/** The searching attack this Pokémon has, with its printed cost, if any. */
export function attackOf(card: DeckCard): { name: string; cost: string; def: AttackDef } | undefined {
  const cached = attackCache.get(card)
  if (cached !== undefined) return cached ?? undefined
  let found: { name: string; cost: string; def: AttackDef } | undefined
  for (const move of card.card?.moves ?? []) {
    const def = ATTACKS.get(move.name) ?? BY_TEXT.get(textKey(move.effect ?? ''))
    if (def) {
      found = { name: move.name, cost: move.cost, def }
      break
    }
  }
  attackCache.set(card, found ?? null)
  return found
}

/**
 * The turn's attack is not ruled out: not made yet, and not the first turn of
 * the player going first — unless this attack says it may be.
 */
export function mayAttack(state: SimState): boolean {
  if (state.attacked || !state.active) return false
  if (!state.cannotAttack) return true
  return attackOf(state.active.card)?.def.firstTurn === true
}

/** Can the Active Pokémon attack with it right now? */
export function attackAvailable(state: SimState): boolean {
  if (!mayAttack(state)) return false
  const attack = attackOf(state.active!.card)
  return attack !== undefined && costPaid(attack.cost, state.active!)
}

/**
 * Is the cost paid by the Energy attached? Each typed symbol needs Energy of
 * that type (or a Special Energy, which is not modelled as typed and so is
 * not counted for it); `{C}` takes anything left over.
 */
export function costPaid(cost: string, slot: InPlay): boolean {
  const symbols = cost.match(/\{[A-Z]\}/g) ?? []
  // What each attached Energy provides on this Pokémon.
  const pool = slot.energy.map((energy) => energyProvides(energy, slot.card))
  for (const symbol of symbols.filter((s) => s !== '{C}')) {
    const at = pool.findIndex((types) => types.includes(symbol) || types.includes('*'))
    if (at < 0) return false
    pool.splice(at, 1)
  }
  return pool.length >= symbols.filter((s) => s === '{C}').length
}

export function attack(state: SimState, ctx: EffectContext): SimState[] {
  const found = state.active && attackOf(state.active.card)
  if (!found) return []
  return found.def.apply(state, ctx).map((next) => {
    const done = next === state ? cloneState(state) : next
    done.attacked = true
    return done
  })
}

// "Search your deck for up to 3 in any combination of {G} Pokémon and Stadium
// cards, reveal them, and put them into your hand. Then, shuffle your deck."
ATTACKS.set('Traverse Time', {
  apply: (state, ctx) => {
    const isGrass = (card: DeckCard) => (card.card?.type ?? '').includes('{G}')
    const eligible = state.deck.filter(
      (card) => (card.tags.includes('pokemon') && isGrass(card)) || isStadium(card),
    )
    const picks = bestThree(state, eligible, ctx)
    if (picks.length === 0) return []
    const next = cloneState(state)
    for (const pick of picks) {
      next.deck.splice(
        next.deck.findIndex((card) => card === pick),
        1,
      )
      next.hand.push(pick)
    }
    next.deck = fairShuffle(state, next.deck, ctx.seed)
    next.shuffles = shufflesAfter(state)
    return [next]
  },
})

/** The printed text of the Active's attack of this name. */
const printedText = (state: SimState, attack: string): string =>
  (state.active?.card.card?.moves ?? []).find((move) => move.name === attack)?.effect ?? ''

// "Search your deck for a Basic Pokémon and put it onto your Bench." (Eevee,
// Litwick, ...) or "...for up to 2 Basic Pokémon and put them onto your
// Bench." (Drilbur, Oricorio, ...). Then, shuffle your deck. Any other wording
// is not this attack, and does nothing rather than guess.
ATTACKS.set('Call for Family', {
  apply: (state, ctx) => {
    const text = printedText(state, 'Call for Family')
    const max = text.startsWith('Search your deck for up to 2 Basic Pokémon and put them onto your Bench')
      ? 2
      : text.startsWith('Search your deck for a Basic Pokémon and put it onto your Bench')
        ? 1
        : 0
    if (max === 0 || state.bench.length >= benchCap(state)) return []
    const boards = benchFromDeck(state, ctx, max, () => true)
    // Benching nothing is not worth an attack.
    return boards.filter((board) => board.bench.length > state.bench.length)
  },
})

// "Search your deck for a Supporter card, reveal it, and put it into your
// hand. Then, shuffle your deck." (Piplup) Any Supporter worth having: one the
// goal names, else one the simulator can play — next turn, since this attack
// ends this one.
ATTACKS.set('Call for Support', {
  apply: (state, ctx) => {
    const supporters = state.deck.filter((card) => card.tags.includes('supporter'))
    const wanted = supporters.filter((card) => ctx.relevant.has(card.key))
    const found = distinctCards(wanted.length > 0 ? wanted : supporters.filter(isPlayableSupporter))
    return found.map((card) => {
      const next = cloneState(state)
      next.deck.splice(next.deck.indexOf(card), 1)
      next.hand.push(card)
      next.deck = fairShuffle(next, next.deck, ctx.seed)
      next.shuffles = shufflesAfter(next)
      return next
    })
  },
})

/**
 * Three cards to take, chosen the way a player would rather than branched on:
 * first the next stage of a line already in play (it evolves next turn), then
 * the Basic that starts a line not yet begun, then a Stadium, then anything
 * else the goal names. Three different cards, one of each piece.
 */
function bestThree(state: SimState, eligible: DeckCard[], ctx: EffectContext): DeckCard[] {
  const inPlayNames = new Set(allInPlay(state).map((slot) => nameOf(slot.card)))

  const worth = (card: DeckCard): number => {
    if (!ctx.relevant.has(card.key)) return 0
    const prev = card.card?.prev
    if (prev && inPlayNames.has(norm(prev))) return 4
    if (isBasicPokemon(card) && !inPlayNames.has(nameOf(card))) return 3
    if (isStadium(card)) return 2
    return 1
  }
  const ranked = eligible
    .map((card, order) => ({ card, order, worth: worth(card) }))
    .filter((entry) => entry.worth > 0)
    .sort((a, b) => b.worth - a.worth || a.order - b.order)

  // Three different cards: one of each piece is what moves the lines along.
  const picks: DeckCard[] = []
  for (const { card } of ranked) {
    if (picks.length === 3) break
    if (!picks.some((pick) => pick.key === card.key)) picks.push(card)
  }
  return picks
}
