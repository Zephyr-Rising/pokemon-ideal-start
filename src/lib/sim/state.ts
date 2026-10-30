import type { BoardView } from '../board/goal'
import { norm } from '../normalize'
import type { DeckCard } from '../types'
import { hashString, mulberry32, shuffled } from './rng'

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
  /**
   * Put into play or evolved this turn. Such a Pokémon cannot evolve again
   * this turn, except Grass into Grass under Forest of Vitality.
   */
  fresh?: boolean
  /**
   * This Pokémon's own once-per-turn Ability is spent. Used by Abilities each
   * copy may use separately (Drakloak, N's Zoroark ex); evolving makes it a
   * new Pokémon, so the flag starts clear again.
   */
  usedAbility?: boolean
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
  /** Normalised names of Abilities already used this turn. */
  usedAbilities: string[]
  /**
   * This player's turn number, from 1. Absent means turn 1, which is all the
   * turn-1 playtest ever runs. Nothing evolves on a player's first turn.
   */
  turn?: number
  /** Shuffles so far this game, which picks the next shuffle's order. */
  shuffles?: number
}

/** Target index convention: -1 is the Active Spot, 0+ indexes the bench. */
export const ACTIVE_TARGET = -1

export const BASE_BENCH = 5
const EXPANDED_BENCH = 8
const AREA_ZERO = norm('Area Zero Underdepths')

export const inPlay = (card: DeckCard): InPlay => ({ card, energy: [], tools: [], fresh: true })

/**
 * The card's canonical name.
 *
 * Effects and rules key on the name the card database holds, never the label
 * the player typed — a decklist may abbreviate or misspell, and the resolver
 * has already done the work of mapping it to a real card.
 */
export const cardName = (card: DeckCard): string =>
  card.card?.name ?? card.resolvedName ?? card.label

/**
 * The card's canonical name, normalised for matching, cached on the card.
 *
 * Rules and effects compare names constantly — every Ability lookup, every
 * engine check scanning the deck — so normalising on each comparison was a
 * large share of a search. Copies of a card share one object, so the cache
 * almost always hits.
 */
export function nameOf(card: DeckCard): string {
  let name = namesByCard.get(card)
  if (name === undefined) {
    name = norm(cardName(card))
    namesByCard.set(card, name)
  }
  return name
}

const namesByCard = new WeakMap<DeckCard, string>()

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
  if (!state.stadium || nameOf(state.stadium) !== AREA_ZERO) {
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

/**
 * What an Energy card counts as, for matching against a goal: a Basic Energy
 * is its type (`{G}`), interchangeable with any other Grass; a Special Energy
 * is that card itself, since the card data gives it no type and its effects
 * are its own — Jet Energy is not "any" Energy, it is Jet Energy.
 */
export const energyKind = (card: DeckCard): string =>
  card.tags.includes('basic-energy') ? energyType(card) : card.key

const SKYLINER = norm('Latias ex')

/**
 * Retreat cost in Energy, after everything that reduces it.
 *
 * Latias ex's Skyliner ("Your Basic Pokemon in play have no Retreat Cost") is a
 * passive, so it is read when retreat is priced rather than used as an action.
 * Only Basics are ever in play on turn 1, so with Latias ex out every retreat
 * this turn is free — which is often the whole reason a deck can reach the
 * Active it wants.
 */
export function retreatCost(state: SimState, slot: InPlay): number {
  if (isBasicPokemon(slot.card) && allInPlay(state).some((s) => nameOf(s.card) === SKYLINER)) {
    return 0
  }
  const base = slot.card.card?.retreat ?? 0
  // Air Balloon is the only retreat reducer in the current pool.
  const reduction = slot.tools.some((t) => nameOf(t) === norm('Air Balloon')) ? 2 : 0
  return Math.max(0, base - reduction)
}

/** The goal layer's view of this state. */
export const toBoardView = (state: SimState): BoardView => ({
  active: state.active
    ? {
        cardKey: state.active.card.key,
        energy: state.active.energy.map(energyKind),
        tools: state.active.tools.map((tool) => tool.key),
      }
    : null,
  bench: state.bench.map((slot) => ({
    cardKey: slot.card.key,
    energy: slot.energy.map(energyKind),
    tools: slot.tools.map((tool) => tool.key),
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
      ? {
          card: state.active.card,
          energy: [...state.active.energy],
          tools: [...state.active.tools],
          fresh: state.active.fresh,
          usedAbility: state.active.usedAbility,
        }
      : null,
    bench: state.bench.map((slot) => ({
      card: slot.card,
      energy: [...slot.energy],
      tools: [...slot.tools],
      fresh: slot.fresh,
      usedAbility: slot.usedAbility,
    })),
    stadium: state.stadium,
    usedEnergy: state.usedEnergy,
    usedSupporter: state.usedSupporter,
    usedStadium: state.usedStadium,
    usedRetreat: state.usedRetreat,
    usedAbilities: state.usedAbilities,
    turn: state.turn,
    shuffles: state.shuffles,
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
    `${idOf(s.card)}+${s.energy.map(energyKind).sort().join('')}+${sortedIds(s.tools)}${s.fresh ? '*' : ''}${s.usedAbility ? '!' : ''}`
  const flags =
    (state.usedEnergy ? 1 : 0) |
    (state.usedSupporter ? 2 : 0) |
    (state.usedStadium ? 4 : 0) |
    (state.usedRetreat ? 8 : 0)
  let top = ''
  for (let i = 0; i < 8 && i < state.deck.length; i++) top += `${idOf(state.deck[i])},`
  return [
    sortedIds(state.hand),
    state.active ? slot(state.active) : '-',
    state.bench.map(slot).sort().join(','),
    state.stadium ? idOf(state.stadium) : '-',
    top,
    state.deck.length,
    flags,
    state.usedAbilities.length > 1 ? [...state.usedAbilities].sort().join(',') : state.usedAbilities.join(''),
    state.turn ?? 1,
    state.shuffles ?? 0,
  ].join('|')
}

/**
 * Shuffle a pile of cards the way a fair game would: the order that comes out
 * depends on the trial, on which shuffle of the game this is, and on which
 * cards went in — and on nothing else.
 *
 * It used to be seeded from the whole board, which let the search re-roll a
 * shuffle: benching in a different order, or playing a card that did nothing,
 * gave Lillie's Determination a fresh draw, and across thousands of lines the
 * search kept whichever drew best. A player gets one shuffle. Sorting the pile
 * first means the same cards in give the same order out, however they got
 * there, so the only choice left to the search is the real one: what to put
 * into the pile.
 *
 * Callers record the shuffle with `next.shuffles = shufflesAfter(state)`.
 */
export function fairShuffle(state: SimState, pile: DeckCard[], seed: number): DeckCard[] {
  // Sorted by the card's own key, which never changes. Not by `idOf`: those
  // numbers are handed out in the order cards are first seen, so the result
  // would depend on what else had run in the same session.
  const sorted = [...pile].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const rng = mulberry32(seed ^ hashString(`${state.turn ?? 1}:${state.shuffles ?? 0}`))
  return shuffled(sorted, rng)
}

export const shufflesAfter = (state: SimState): number => (state.shuffles ?? 0) + 1

/**
 * A small number per distinct card, for building signatures quickly.
 *
 * Signatures are built for every board the search visits, and sorting and
 * joining card-key strings was the largest single cost left in a search.
 * Copies of a card share one `DeckCard` object, so the object lookup almost
 * always hits; the key lookup behind it keeps two objects for the same card
 * on the same number.
 */
const idsByCard = new WeakMap<DeckCard, number>()
const idsByKey = new Map<string, number>()

function idOf(card: DeckCard): number {
  let id = idsByCard.get(card)
  if (id === undefined) {
    id = idsByKey.get(card.key)
    if (id === undefined) {
      id = idsByKey.size
      idsByKey.set(card.key, id)
    }
    idsByCard.set(card, id)
  }
  return id
}

/** Card ids in ascending order, joined: an order-insensitive key for a pile. */
function sortedIds(cards: DeckCard[]): string {
  if (cards.length === 0) return ''
  if (cards.length === 1) return String(idOf(cards[0]))
  const ids = new Int32Array(cards.length)
  for (let i = 0; i < cards.length; i++) ids[i] = idOf(cards[i])
  return ids.sort().join(',')
}

// --- turns and evolution -----------------------------------------------------

const FOREST_OF_VITALITY = norm('Forest of Vitality')

/** Does `evolution` evolve from the Pokémon `from`, by the card's own text? */
export const evolvesFrom = (evolution: DeckCard, from: DeckCard): boolean =>
  (evolution.card?.prev ?? '') !== '' && norm(evolution.card!.prev) === nameOf(from)

export const isEvolutionCard = (card: DeckCard): boolean =>
  card.tags.includes('stage1') || card.tags.includes('stage2')

const isGrass = (card: DeckCard) => (card.card?.type ?? '').includes('{G}')

/**
 * May this Pokémon evolve into `evolution` right now?
 *
 * Never on a player's first turn. Otherwise only a Pokémon that has been in
 * play since an earlier turn — unless Forest of Vitality is out, which lets a
 * Grass Pokémon put into play (or evolved) this turn evolve into a Grass one.
 */
export function mayEvolve(state: SimState, slot: InPlay, evolution: DeckCard): boolean {
  if ((state.turn ?? 1) < 2) return false
  if (!evolvesFrom(evolution, slot.card)) return false
  if (!slot.fresh) return true
  const forest = state.stadium !== null && nameOf(state.stadium) === FOREST_OF_VITALITY
  return forest && isGrass(slot.card) && isGrass(evolution)
}

/** Put an evolution card onto a Pokémon, keeping what is attached to it. */
export const evolveSlot = (slot: InPlay, evolution: DeckCard): InPlay => ({
  card: evolution,
  energy: slot.energy,
  tools: slot.tools,
  fresh: true,
})

/**
 * Begin the player's next turn: once-per-turn plays come back, nothing in play
 * is fresh any more, and the turn's card is drawn.
 */
export function startNextTurn(state: SimState): SimState {
  const next = cloneState(state)
  next.turn = (state.turn ?? 1) + 1
  next.usedEnergy = false
  next.usedSupporter = false
  next.usedStadium = false
  next.usedRetreat = false
  next.usedAbilities = []
  for (const slot of [...(next.active ? [next.active] : []), ...next.bench]) {
    slot.fresh = false
    slot.usedAbility = false
  }
  next.hand.push(...next.deck.splice(0, 1))
  return next
}
