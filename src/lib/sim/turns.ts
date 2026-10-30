import { goalIsEmpty, type FieldGoal, type GoalScore } from '../board/goal'
import type { DeckCard } from '../types'
import { draw, type ActionContext } from './actions'
import { buildContext } from './context'
import {
  emptyBoard,
  ignoredCards,
  physicalDeck,
  toExampleBoard,
  toHand,
  type Deal,
  type ExampleFrame,
} from './playtest'
import { mulberry32, shuffled } from './rng'
import { luckCounters, summariseLuck, type LuckRecord, type LuckStat } from './luck'
import { boardRequirements, PrizeLockTally, prizeLocks, type PrizeLockStat } from './prizes'
import { lineOf, outranks, searchBestLine, type Alternative } from './search'
import { inPlay, isBasicPokemon, signature, startNextTurn, type SimState } from './state'

/**
 * How many turns a deck takes to build a board, rather than whether it does so
 * on turn 1.
 *
 * Each turn is searched for the boards it can reach, as on turn 1, and the best
 * few are carried into the next: the once-per-turn plays come back, a card is
 * drawn, and from the second turn Pokémon can evolve. Carrying several boards
 * rather than one lets a turn set up for the next instead of only scoring its
 * own best. With no opponent there is nothing to interrupt the plan, so the
 * figures are best read as the deck's own pace.
 */

export const MAX_TURNS = 6

const DEFAULT_TRIALS = 500

/**
 * Per-turn search budget, measured on the benchmark (`npm run bench`). Most
 * turns finish well inside it; it is the backstop for big hands. At 6,000 no
 * Dragapult game runs out and it costs no time there, while the Festival Lead
 * deck's largest hands take about twice as long as at 1,500 for the same
 * figures — a fair price for searching them properly.
 */
const TURN_MAX_NODES = 6_000

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
  /**
   * Games the prizes made impossible before a card was played. They count as
   * never built in `byTurn`; per-part figures leave them out.
   */
  prizeLocked: PrizeLockStat
  /** How much the luck of the deal moves the turn, and which luck. */
  luck: LuckStat
  mulliganRate: number
  ignored: string[]
  /** Games in which some turn's search hit its budget. */
  truncated: number
  /** Turns played across every game and order, and how many hit the budget. */
  turnsPlayed: number
  turnsTruncated: number
  /**
   * Example games, fastest first: one for every turn some game built the board
   * on, from each turn order where both managed it.
   */
  examples: TurnsExample[]
}

/**
 * How many end-of-turn boards are carried into the next turn.
 *
 * Playing each turn for its own best board and carrying only that one forward
 * finishes boards well after a real player would: the board that scores best
 * now is often not the best start for the next turn. Carrying the best few
 * and continuing each one fixes most of it. Measured on the benchmark boards,
 * going from 1 to 8 raised "built by turn 3" from 55% to 75% (Dragapult) and
 * from 25% to 55% (Festival Lead); beyond 8 the gains were a point or two.
 */
const BEAM_WIDTH = 8

/** One board being carried forward, and how the game got there. */
interface Branch {
  state: SimState
  score: GoalScore
  setup: number
  history: BranchTurn[]
}

/** One turn of a branch's game. */
interface BranchTurn {
  turn: number
  /** The board once the turn's card is drawn. */
  started: SimState
  /** Turn 1 only: the opening hand and the placement before the draw. */
  opening?: { hand: DeckCard[]; placed: SimState }
  /** The turn's line, as the search left it. */
  line: Alternative
}

/** Best first, one per distinct board, at most BEAM_WIDTH. */
function strongest(branches: Branch[]): Branch[] {
  const seen = new Set<string>()
  return branches
    .sort((a, b) => (outranks(a, b) ? -1 : outranks(b, a) ? 1 : 0))
    .filter((branch) => {
      const key = signature(branch.state)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, BEAM_WIDTH)
}

/**
 * Plays one deal out over up to MAX_TURNS turns; the turn it got there, or null.
 *
 * Each turn is searched from every board carried forward, and the best few
 * boards any of them can end on are carried into the next turn (see
 * `BEAM_WIDTH`). The game ends the first time any of them builds the board.
 */
function turnsToBuild(
  deal: Deal,
  goal: FieldGoal,
  ctx: ActionContext,
  labelFor: (cardKey: string) => string,
  maxNodes: number | undefined,
  goingFirst: boolean,
): GameOutcome {
  let searches = 0
  let truncatedSearches = 0
  const search = (started: SimState) => {
    const result = searchBestLine(started, goal, ctx, labelFor, { maxNodes, keep: BEAM_WIDTH })
    searches++
    if (!result.exhausted) truncatedSearches++
    return result
  }
  const finish = (branch: Branch | undefined, turn: number | null) =>
    gameOutcome(branch, turn, searches, truncatedSearches)

  // Turn 1: every distinct Basic that could start Active, the goal's own first.
  const { hand, prizes, rest } = deal
  const starters = new Map<string, number>()
  hand.forEach((card, index) => {
    if (isBasicPokemon(card) && !starters.has(card.key)) starters.set(card.key, index)
  })
  const rank = (index: number) => ctx.activeLineage?.get(hand[index].key) ?? Infinity
  let frontier: Branch[] = []
  for (const index of [...starters.values()].sort((a, b) => rank(a) - rank(b))) {
    const placed: SimState = {
      hand: hand.filter((_, i) => i !== index),
      deck: rest,
      discard: [],
      prizes,
      active: inPlay(hand[index]),
      bench: [],
      stadium: null,
      usedEnergy: false,
      // Going first, the turn's Supporter is simply already spent.
      usedSupporter: goingFirst,
      cannotAttack: goingFirst,
      usedStadium: false,
      usedRetreat: false,
      usedAbilities: [],
    }
    // Both players draw on their first turn, including the one going first.
    const started = draw(placed, 1)
    const result = search(started)
    const branches = result.alternatives.map((line) => ({
      ...line,
      history: [{ turn: 1, started, opening: { hand, placed }, line }],
    }))
    if (result.score.strict) return finish(branches[0], 1)
    frontier.push(...branches)
  }
  frontier = strongest(frontier)

  for (let turn = 2; turn <= MAX_TURNS; turn++) {
    const next: Branch[] = []
    for (const branch of frontier) {
      // Drawing from an empty deck loses the game before the turn starts.
      if (branch.state.deck.length === 0) continue
      const started = startNextTurn(branch.state)
      const result = search(started)
      const continued = result.alternatives.map((line) => ({
        ...line,
        history: [...branch.history, { turn, started, line }],
      }))
      if (result.score.strict) return finish(continued[0], turn)
      next.push(...continued)
    }
    if (next.length === 0) break
    frontier = strongest(next)
  }
  return finish(frontier[0], null)
}

/**
 * Everything kept about one game: the turn it got there, its search counts,
 * when each part came together, and its turns as lines to show.
 *
 * Parts and the shown game follow the winning branch, or for a game that never
 * got there, the strongest branch at the end.
 */
function gameOutcome(
  branch: Branch | undefined,
  turn: number | null,
  searches: number,
  truncatedSearches: number,
): GameOutcome {
  const parts = new Map<string, { label: string; turn: number | null }>()
  for (const step of branch?.history ?? []) {
    for (const part of step.line.score.parts) {
      const entry = parts.get(part.id) ?? { label: part.label, turn: null }
      if (part.met && entry.turn === null) entry.turn = step.turn
      parts.set(part.id, entry)
    }
  }
  return {
    turn,
    hitBudget: truncatedSearches > 0,
    searches,
    truncatedSearches,
    parts,
    history: branch?.history ?? [],
  }
}

/** Turn a game's history into an example: steps grouped by turn, plus frames. */
function toTurnsExample(game: GameOutcome, goingFirst: boolean): TurnsExample {
  const turns = game.history.map((step): TurnsExampleTurn => {
    const { steps, frames } = lineOf(step.line)
    const plays = frames.map((state, i) => ({
      step: steps[i],
      board: toExampleBoard(state),
      hand: toHand(state.hand),
    }))
    const draw: ExampleFrame = {
      step: step.turn === 1 ? 'Draw a card to start the turn' : `Turn ${step.turn}: draw a card`,
      board: toExampleBoard(step.started),
      hand: toHand(step.started.hand),
    }
    const opening: ExampleFrame[] = step.opening
      ? [
          { step: 'Draw your opening hand', board: emptyBoard(7), hand: toHand(step.opening.hand) },
          {
            step: `Start with ${step.opening.placed.active!.card.label} in the Active Spot`,
            board: toExampleBoard(step.opening.placed),
            hand: toHand(step.opening.placed.hand),
          },
        ]
      : []
    const all = [...opening, draw, ...plays]
    // The deal itself is a frame with no step of its own.
    return { turn: step.turn, steps: all.slice(step.opening ? 1 : 0).map((f) => f.step), frames: all }
  })
  return { turn: game.turn!, goingFirst, turns }
}

interface GameOutcome {
  /** The turn the whole board came together, or null. */
  turn: number | null
  hitBudget: boolean
  /** Turn searches run, and how many hit the budget. */
  searches: number
  truncatedSearches: number
  /** The turn each part first came together, or null. */
  parts: Map<string, { label: string; turn: number | null }>
  /** The shown game's turns, as the search left them. */
  history: BranchTurn[]
}

/** Running tally of the turn each game got there, for one order. */
class TurnTally {
  readonly counts: number[] = emptyCounts()
  /** Per part, in first-seen order: how many games first had it on each turn. */
  readonly parts = new Map<string, { label: string; counts: number[] }>()
  /** Games the prizes made impossible: never built, and not played. */
  locked = 0

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
      // Each part is over the games that were played.
      parts: [...this.parts].map(([id, part]) => ({
        id,
        label: part.label,
        ...summarise(part.counts.map((count) => count / Math.max(trials - this.locked, 1))),
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
    prizeLocked: new PrizeLockTally().stat(0),
    luck: summariseLuck([]),
    mulliganRate: 0,
    ignored,
    truncated: 0,
    turnsPlayed: 0,
    turnsTruncated: 0,
    examples: [],
  }
  if (deck.length < 13 || !deck.some(isBasicPokemon) || goalIsEmpty(goal)) return blank

  const first = new TurnTally()
  const second = new TurnTally()
  const requirements = boardRequirements(goal, cards, labelFor)
  const locked = new PrizeLockTally()
  const examples = new Map<string, TurnsExample>()
  // The goal's pieces never change between deals, so they are worked out once.
  const luck = luckCounters(buildContext(goal, () => 0, seed, cards).relevant)
  const luckRecords: LuckRecord[] = []
  let mulligans = 0
  let deals = 0
  let truncated = 0
  let turnsPlayed = 0
  let turnsTruncated = 0

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

    // A board the prizes have already made impossible is logged as such and
    // not played — it could only ever run all six turns and miss.
    const locks = prizeLocks(requirements, deck, deal.prizes)
    if (locks.length > 0) {
      locked.add(locks)
      first.locked++
      second.locked++
      // Never built, in either turn order.
      luckRecords.push(luck.record(deal.hand, deal.prizes, null), luck.record(deal.hand, deal.prizes, null))
      if (options.onProgress && (trial + 1) % (options.progressEvery ?? 5) === 0) {
        options.onProgress(trial + 1, trials)
      }
      continue
    }
    const ctx: ActionContext = { ...buildContext(goal, rng, seed + trial, cards), multiTurn: true }

    const maxNodes = options.maxNodes ?? TURN_MAX_NODES
    const asFirst = turnsToBuild(deal, goal, ctx, labelFor, maxNodes, true)
    const asSecond = turnsToBuild(deal, goal, ctx, labelFor, maxNodes, false)
    first.add(asFirst)
    second.add(asSecond)
    luckRecords.push(
      luck.record(deal.hand, deal.prizes, asFirst.turn),
      luck.record(deal.hand, deal.prizes, asSecond.turn),
    )
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
    turnsPlayed += asFirst.searches + asSecond.searches
    turnsTruncated += asFirst.truncatedSearches + asSecond.truncatedSearches

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
    prizeLocked: locked.stat(trials),
    luck: summariseLuck(luckRecords),
    mulliganRate: deals === 0 ? 0 : mulligans / deals,
    ignored,
    truncated,
    turnsPlayed,
    turnsTruncated,
    // Fastest first; going first before going second within a turn.
    examples: [...examples.values()].sort(
      (a, b) => a.turn - b.turn || Number(b.goingFirst) - Number(a.goingFirst),
    ),
  }
}
