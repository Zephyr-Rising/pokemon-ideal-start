import { norm } from '../normalize'
import type { DeckCard } from '../types'
import type { EffectContext } from './effects'
import {
  cloneState,
  energyKind,
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
}

const ATTACKS = new Map<string, AttackDef>()

/** The searching attack this Pokémon has, with its printed cost, if any. */
export function attackOf(card: DeckCard): { name: string; cost: string; def: AttackDef } | undefined {
  for (const move of card.card?.moves ?? []) {
    const def = ATTACKS.get(move.name)
    if (def) return { name: move.name, cost: move.cost, def }
  }
  return undefined
}

/** Can the Active Pokémon attack with it right now? */
export function attackAvailable(state: SimState): boolean {
  if (state.attacked || state.cannotAttack || !state.active) return false
  const attack = attackOf(state.active.card)
  return attack !== undefined && costPaid(attack.cost, state.active)
}

/**
 * Is the cost paid by the Energy attached? Each typed symbol needs Energy of
 * that type (or a Special Energy, which is not modelled as typed and so is
 * not counted for it); `{C}` takes anything left over.
 */
export function costPaid(cost: string, slot: InPlay): boolean {
  const symbols = cost.match(/\{[A-Z]\}/g) ?? []
  const pool = slot.energy.map(energyKind)
  for (const symbol of symbols.filter((s) => s !== '{C}')) {
    const at = pool.indexOf(symbol)
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
