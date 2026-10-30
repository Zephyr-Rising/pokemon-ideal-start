import { goalIsEmpty, type FieldGoal } from '../board/goal'
import type { DeckCard } from '../types'
import type { ActionContext } from './actions'
import { buildContext } from './context'
import { ignoredCards, physicalDeck, playDeal, type Deal } from './playtest'
import { mulberry32, shuffled } from './rng'
import { searchBestLine } from './search'
import { isBasicPokemon, startNextTurn, type SimState } from './state'

/**
 * How many turns a deck takes to build a board, rather than whether it does so
 * on turn 1.
 *
 * Each turn is searched for the best board it can reach, as on turn 1, and the
 * board it ends on is carried into the next: the once-per-turn plays come back,
 * a card is drawn, and from the second turn Pokémon can evolve. That is a
 * greedy plan — each turn plays its own best, it never holds back for a later
 * one — so a deck that wins by sandbagging is slightly understated. With no
 * opponent there is nothing to interrupt the plan either, so the figures are
 * best read as the deck's own pace.
 */

export const MAX_TURNS = 6

const DEFAULT_TRIALS = 500

export interface TurnsOptions {
  trials?: number
  seed?: number
  maxNodes?: number
  onProgress?: (done: number, total: number) => void
  progressEvery?: number
}

/** The figures for one turn order. */
export interface TurnsOrderResult {
  /** Share of games that first complete the board on each turn; [0] is turn 1. */
  byTurn: number[]
  /** Share of games that complete it within MAX_TURNS. */
  reached: number
  /**
   * The turn by which half of all games have it, or null when fewer than half
   * do within MAX_TURNS.
   */
  median: number | null
  /** Average turn, over the games that complete it within MAX_TURNS. */
  mean: number | null
}

export interface TurnsResult extends TurnsOrderResult {
  trials: number
  /** No Supporter on the first turn of the game. */
  goingFirst: TurnsOrderResult
  goingSecond: TurnsOrderResult
  mulliganRate: number
  ignored: string[]
  /** Games in which some turn's search hit its budget. */
  truncated: number
}

/** Plays one deal out over up to MAX_TURNS turns; the turn it got there, or null. */
function turnsToBuild(
  deal: Deal,
  goal: FieldGoal,
  ctx: ActionContext,
  labelFor: (cardKey: string) => string,
  maxNodes: number | undefined,
  goingFirst: boolean,
): { turn: number | null; hitBudget: boolean } {
  const first = playDeal(deal, goal, ctx, labelFor, maxNodes, goingFirst)
  let hitBudget = first.hitBudget
  if (first.score.strict) return { turn: 1, hitBudget }

  let state: SimState | null = first.finalState
  for (let turn = 2; turn <= MAX_TURNS && state; turn++) {
    // Drawing from an empty deck loses the game before the turn starts.
    if (state.deck.length === 0) break
    const started = startNextTurn(state)
    const result = searchBestLine(started, goal, ctx, labelFor, { maxNodes })
    if (!result.exhausted) hitBudget = true
    if (result.score.strict) return { turn, hitBudget }
    state = result.finalState
  }
  return { turn: null, hitBudget }
}

/** Running tally of the turn each game got there, for one order. */
class TurnTally {
  readonly counts: number[] = Array.from({ length: MAX_TURNS }, () => 0)

  add(turn: number | null): void {
    if (turn !== null) this.counts[turn - 1]++
  }

  result(trials: number): TurnsOrderResult {
    return summarise(this.counts.map((count) => count / trials))
  }
}

/** Median and mean from a distribution over turns; the rest never got there. */
export function summarise(byTurn: number[]): TurnsOrderResult {
  const reached = byTurn.reduce((sum, share) => sum + share, 0)
  let cumulative = 0
  let median: number | null = null
  for (let i = 0; i < byTurn.length; i++) {
    cumulative += byTurn[i]
    // A hair of tolerance, so an exact half from averaging two orders counts.
    if (cumulative >= 0.5 - 1e-12) {
      median = i + 1
      break
    }
  }
  const mean =
    reached > 0 ? byTurn.reduce((sum, share, i) => sum + share * (i + 1), 0) / reached : null
  return { byTurn, reached, median, mean }
}

export function turnsTest(
  cards: DeckCard[],
  goal: FieldGoal,
  labelFor: (cardKey: string) => string,
  options: TurnsOptions = {},
): TurnsResult {
  const trials = options.trials ?? DEFAULT_TRIALS
  const seed = options.seed ?? 1
  const deck = physicalDeck(cards)
  const ignored = ignoredCards(cards)

  const none = summarise(Array.from({ length: MAX_TURNS }, () => 0))
  const blank: TurnsResult = {
    ...none,
    trials: 0,
    goingFirst: none,
    goingSecond: none,
    mulliganRate: 0,
    ignored,
    truncated: 0,
  }
  if (deck.length < 13 || !deck.some(isBasicPokemon) || goalIsEmpty(goal)) return blank

  const first = new TurnTally()
  const second = new TurnTally()
  let mulligans = 0
  let deals = 0
  let truncated = 0

  for (let trial = 0; trial < trials; trial++) {
    const rng = mulberry32(seed + trial * 7919)
    let order = shuffled(deck, rng)
    deals++
    while (!order.slice(0, 7).some(isBasicPokemon)) {
      mulligans++
      deals++
      order = shuffled(deck, rng)
    }
    const deal: Deal = { hand: order.slice(0, 7), prizes: order.slice(7, 13), rest: order.slice(13) }
    const ctx: ActionContext = { ...buildContext(goal, rng, seed + trial, cards), multiTurn: true }

    const asFirst = turnsToBuild(deal, goal, ctx, labelFor, options.maxNodes, true)
    const asSecond = turnsToBuild(deal, goal, ctx, labelFor, options.maxNodes, false)
    first.add(asFirst.turn)
    second.add(asSecond.turn)
    if (asFirst.hitBudget || asSecond.hitBudget) truncated++

    if (options.onProgress && (trial + 1) % (options.progressEvery ?? 25) === 0) {
      options.onProgress(trial + 1, trials)
    }
  }

  const goingFirst = first.result(trials)
  const goingSecond = second.result(trials)
  // The fair-coin average: each turn's share is the mean of the two orders.
  const overall = summarise(
    goingFirst.byTurn.map((share, i) => (share + goingSecond.byTurn[i]) / 2),
  )
  return {
    ...overall,
    trials,
    goingFirst,
    goingSecond,
    mulliganRate: deals === 0 ? 0 : mulligans / deals,
    ignored,
    truncated,
  }
}
