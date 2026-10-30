import { goalIsEmpty, type FieldGoal, type GoalScore } from '../board/goal'
import type { DeckCard } from '../types'
import type { ActionContext } from './actions'
import { buildContext } from './context'
import {
  ignoredCards,
  physicalDeck,
  playDeal,
  toExampleBoard,
  toHand,
  type Deal,
  type ExampleFrame,
} from './playtest'
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

/**
 * Per-turn search budget. Lower than turn 1's on purpose: measured on the
 * benchmark, quadrupling it moved the average by about a tenth of a turn while
 * nearly tripling the time. The extra lines go to turns that cannot finish the
 * board anyway.
 */
const TURN_MAX_NODES = 1_500

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

/** One turn of an example game: the readable steps, and frames to replay. */
export interface TurnsExampleTurn {
  turn: number
  steps: string[]
  frames: ExampleFrame[]
}

/** One game played out turn by turn, to the turn it built the board. */
export interface TurnsExample {
  /** The turn the board came together. */
  turn: number
  goingFirst: boolean
  turns: TurnsExampleTurn[]
}

/** The same figures for one part of the board on its own. */
export interface TurnsPartStat extends TurnsOrderResult {
  id: string
  label: string
}

/** One turn order's figures, for the whole board and each part of it. */
export interface TurnsOrderDetail extends TurnsOrderResult {
  parts: TurnsPartStat[]
}

export interface TurnsResult extends TurnsOrderDetail {
  trials: number
  /** No Supporter on the first turn of the game. */
  goingFirst: TurnsOrderDetail
  goingSecond: TurnsOrderDetail
  mulliganRate: number
  ignored: string[]
  /** Games in which some turn's search hit its budget. */
  truncated: number
  /**
   * Example games, fastest first: one for every turn some game built the board
   * on, from each turn order where both managed it.
   */
  examples: TurnsExample[]
}

/** Plays one deal out over up to MAX_TURNS turns; the turn it got there, or null. */
function turnsToBuild(
  deal: Deal,
  goal: FieldGoal,
  ctx: ActionContext,
  labelFor: (cardKey: string) => string,
  maxNodes: number | undefined,
  goingFirst: boolean,
): GameOutcome {
  // The first turn each part of the board was in place at the end of a turn.
  const parts = new Map<string, { label: string; turn: number | null }>()
  const record = (score: GoalScore, turn: number) => {
    for (const part of score.parts) {
      const entry = parts.get(part.id) ?? { label: part.label, turn: null }
      if (part.met && entry.turn === null) entry.turn = turn
      parts.set(part.id, entry)
    }
  }

  const first = playDeal(deal, goal, ctx, labelFor, maxNodes, goingFirst)
  let hitBudget = first.hitBudget
  record(first.score, 1)
  // Kept as the search left it; turned into readable frames only if this game
  // becomes an example, which most never do.
  const later: LaterTurn[] = []
  if (first.score.strict) return { turn: 1, hitBudget, parts, first: first.frames, later }

  let state: SimState | null = first.finalState
  for (let turn = 2; turn <= MAX_TURNS && state; turn++) {
    // Drawing from an empty deck loses the game before the turn starts.
    if (state.deck.length === 0) break
    const started = startNextTurn(state)
    const result = searchBestLine(started, goal, ctx, labelFor, { maxNodes })
    if (!result.exhausted) hitBudget = true
    record(result.score, turn)
    later.push({ turn, started, steps: result.steps, frames: result.frames })
    if (result.score.strict) return { turn, hitBudget, parts, first: first.frames, later }
    state = result.finalState
  }
  return { turn: null, hitBudget, parts, first: first.frames, later }
}

/** A turn after the first, as the search left it. */
interface LaterTurn {
  turn: number
  /** The board once the turn's card is drawn. */
  started: SimState
  steps: string[]
  frames: SimState[]
}

/** Turn a game's history into an example: steps grouped by turn, plus frames. */
function toTurnsExample(game: GameOutcome, goingFirst: boolean): TurnsExample {
  const turns: TurnsExampleTurn[] = [
    {
      turn: 1,
      // The first frame is the deal itself, which has no step of its own.
      steps: game.first.slice(1).map((frame) => frame.step),
      frames: game.first,
    },
  ]
  for (const later of game.later) {
    const draw: ExampleFrame = {
      step: `Turn ${later.turn}: draw a card`,
      board: toExampleBoard(later.started),
      hand: toHand(later.started.hand),
    }
    const plays = later.frames.map((state, i) => ({
      step: later.steps[i],
      board: toExampleBoard(state),
      hand: toHand(state.hand),
    }))
    turns.push({
      turn: later.turn,
      steps: [draw.step, ...plays.map((frame) => frame.step)],
      frames: [draw, ...plays],
    })
  }
  return { turn: game.turn!, goingFirst, turns }
}

interface GameOutcome {
  /** The turn the whole board came together, or null. */
  turn: number | null
  hitBudget: boolean
  /** The turn each part first came together, or null. */
  parts: Map<string, { label: string; turn: number | null }>
  /** Turn 1's frames, deal first. */
  first: ExampleFrame[]
  later: LaterTurn[]
}

/** Running tally of the turn each game got there, for one order. */
class TurnTally {
  readonly counts: number[] = emptyCounts()
  /** Per part, in first-seen order: how many games first had it on each turn. */
  readonly parts = new Map<string, { label: string; counts: number[] }>()

  add(game: GameOutcome): void {
    if (game.turn !== null) this.counts[game.turn - 1]++
    for (const [id, part] of game.parts) {
      const entry = this.parts.get(id) ?? { label: part.label, counts: emptyCounts() }
      if (part.turn !== null) entry.counts[part.turn - 1]++
      this.parts.set(id, entry)
    }
  }

  result(trials: number): TurnsOrderDetail {
    return {
      ...summarise(this.counts.map((count) => count / trials)),
      parts: [...this.parts].map(([id, part]) => ({
        id,
        label: part.label,
        ...summarise(part.counts.map((count) => count / trials)),
      })),
    }
  }
}

const emptyCounts = () => Array.from({ length: MAX_TURNS }, () => 0)

/** The fair-coin average of two distributions over turns. */
const averageTurns = (a: number[], b: number[]) => a.map((share, i) => (share + b[i]) / 2)

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

  const none: TurnsOrderDetail = { ...summarise(emptyCounts()), parts: [] }
  const blank: TurnsResult = {
    ...none,
    trials: 0,
    goingFirst: none,
    goingSecond: none,
    mulliganRate: 0,
    ignored,
    truncated: 0,
    examples: [],
  }
  if (deck.length < 13 || !deck.some(isBasicPokemon) || goalIsEmpty(goal)) return blank

  const first = new TurnTally()
  const second = new TurnTally()
  const examples = new Map<string, TurnsExample>()
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

    const maxNodes = options.maxNodes ?? TURN_MAX_NODES
    const asFirst = turnsToBuild(deal, goal, ctx, labelFor, maxNodes, true)
    const asSecond = turnsToBuild(deal, goal, ctx, labelFor, maxNodes, false)
    first.add(asFirst)
    second.add(asSecond)
    // One example per turn the board came together on, per turn order.
    for (const [game, goingFirst] of [
      [asFirst, true],
      [asSecond, false],
    ] as const) {
      if (game.turn === null) continue
      const key = `${game.turn}|${goingFirst}`
      if (!examples.has(key)) examples.set(key, toTurnsExample(game, goingFirst))
    }
    if (asFirst.hitBudget || asSecond.hitBudget) truncated++

    if (options.onProgress && (trial + 1) % (options.progressEvery ?? 5) === 0) {
      options.onProgress(trial + 1, trials)
    }
  }

  const goingFirst = first.result(trials)
  const goingSecond = second.result(trials)
  // The fair-coin average: each turn's share is the mean of the two orders.
  const secondParts = new Map(goingSecond.parts.map((part) => [part.id, part]))
  const overall: TurnsOrderDetail = {
    ...summarise(averageTurns(goingFirst.byTurn, goingSecond.byTurn)),
    parts: goingFirst.parts.map((part) => ({
      id: part.id,
      label: part.label,
      ...summarise(averageTurns(part.byTurn, secondParts.get(part.id)?.byTurn ?? emptyCounts())),
    })),
  }
  return {
    ...overall,
    trials,
    goingFirst,
    goingSecond,
    mulliganRate: deals === 0 ? 0 : mulligans / deals,
    ignored,
    truncated,
    // Fastest first; going first before going second within a turn.
    examples: [...examples.values()].sort(
      (a, b) => a.turn - b.turn || Number(b.goingFirst) - Number(a.goingFirst),
    ),
  }
}
