import type { BoardView } from '../board/goal'
import { norm } from '../normalize'
import type { DeckCard } from '../types'

/**
 * Turn-1 game state for one player.
 *
 * Copies of a card are interchangeable, so a card instance is just a shared
 * `DeckCard` reference — identity is its `key`. States are treated as
 * immutable: every action returns a new one with shallow-copied arrays, which
 * is what makes backtracking in the search safe and cheap.
 *
 * The opponent is not modelled. Nothing they do on their own turn changes the
 * board you are trying to build, and the cards that touch their side (Boss's
 * Orders, Crushing Hammer) cannot move your own field.
 */
export interface InPlay {
  card: DeckCard
  energy: DeckCard[]
  tools: DeckCard[]
}

export interface SimState {
  hand: DeckCard[]
  /** Remaining deck, in order; index 0 is the top. */
  deck: DeckCard[]
  discard: DeckCard[]
  /** Set aside and unreachable — searching cannot find a prized card. */
  prizes: DeckCard[]
  active: InPlay | null
  bench: InPlay[]
  stadium: DeckCard | null
  usedEnergy: boolean
  usedSupporter: boolean
  usedStadium: boolean
  usedRetreat: boolean
}

export const BASE_BENCH = 5
const EXPANDED_BENCH = 8
const AREA_ZERO = norm('Area Zero Underdepths')

export const inPlay = (card: DeckCard): InPlay => ({ card, energy: [], tools: [] })

/**
 * The card's canonical name.
 *
 * Effects and rules key on the name the card database holds, never the label
 * the player typed — a decklist may abbreviate or misspell, and the resolver
 * has already done the work of mapping it to a real card.
 */
export const cardName = (card: DeckCard): string =>
  card.card?.name ?? card.resolvedName ?? card.label

export const allInPlay = (state: SimState): InPlay[] =>
  state.active ? [state.active, ...state.bench] : [...state.bench]

/**
 * How many Pokémon may sit on the bench.
 *
 * Area Zero Underdepths raises it to 8, but only for a player who has a Tera
 * Pokémon in play. TCGdex carries no Tera marker — the word appears only in
 * card text — so the `tera` tag comes from the Kaggle CSV's Category column. A
 * Tera Pokémon too new to appear there is treated as non-Tera, which can
 * understate the cap rather than overstate it.
 */
export function benchCap(state: SimState): number {
  if (!state.stadium || norm(cardName(state.stadium)) !== AREA_ZERO) {
    return BASE_BENCH
  }
  const hasTera = allInPlay(state).some((slot) => slot.card.tags.includes('tera'))
  return hasTera ? EXPANDED_BENCH : BASE_BENCH
}

export const isBasicPokemon = (card: DeckCard): boolean => card.tags.includes('basic')
export const isEnergy = (card: DeckCard): boolean => card.tags.includes('energy')
export const isItem = (card: DeckCard): boolean => card.tags.includes('item')
export const isSupporter = (card: DeckCard): boolean => card.tags.includes('supporter')
export const isStadium = (card: DeckCard): boolean => card.tags.includes('stadium')
export const isTool = (card: DeckCard): boolean => card.tags.includes('tool')

/** Energy type symbol a card provides, e.g. '{G}'. */
export const energyType = (card: DeckCard): string => card.card?.type ?? ''

/** Retreat cost in Energy, after any Tool that reduces it. */
export function retreatCost(slot: InPlay): number {
  const base = slot.card.card?.retreat ?? 0
  // Air Balloon is the only retreat reducer in the current pool.
  const reduction = slot.tools.some((t) => norm(cardName(t)) === norm('Air Balloon')) ? 2 : 0
  return Math.max(0, base - reduction)
}

/** The goal layer's view of this state. */
export const toBoardView = (state: SimState): BoardView => ({
  active: state.active
    ? { cardKey: state.active.card.key, energy: state.active.energy.map(energyType) }
    : null,
  bench: state.bench.map((slot) => ({
    cardKey: slot.card.key,
    energy: slot.energy.map(energyType),
  })),
  stadiumKey: state.stadium?.key ?? null,
  hand: state.hand.map((card) => card.key),
})

/** Shallow clone — arrays are copied, card references shared. */
export function cloneState(state: SimState): SimState {
  return {
    hand: [...state.hand],
    deck: [...state.deck],
    discard: [...state.discard],
    prizes: state.prizes,
    active: state.active
      ? { card: state.active.card, energy: [...state.active.energy], tools: [...state.active.tools] }
      : null,
    bench: state.bench.map((slot) => ({
      card: slot.card,
      energy: [...slot.energy],
      tools: [...slot.tools],
    })),
    stadium: state.stadium,
    usedEnergy: state.usedEnergy,
    usedSupporter: state.usedSupporter,
    usedStadium: state.usedStadium,
    usedRetreat: state.usedRetreat,
  }
}

/**
 * A key identifying states the search can treat as equivalent.
 *
 * Hand and bench are order-insensitive, so two lines that reach the same board
 * by different routes collapse to one node. The deck's order matters, because
 * a later draw depends on it, but only the top few cards can still be reached
 * on this turn, so the whole order is not needed.
 */
export function signature(state: SimState): string {
  const slot = (s: InPlay) =>
    `${s.card.key}+${s.energy.map(energyType).sort().join('')}+${s.tools.map((t) => t.key).sort().join('')}`
  const flags = [state.usedEnergy, state.usedSupporter, state.usedStadium, state.usedRetreat]
    .map((f) => (f ? '1' : '0'))
    .join('')
  return [
    state.hand.map((c) => c.key).sort().join(','),
    state.active ? slot(state.active) : '-',
    state.bench.map(slot).sort().join(','),
    state.stadium?.key ?? '-',
    state.deck.slice(0, 8).map((c) => c.key).join(','),
    state.deck.length,
    flags,
  ].join('|')
}
