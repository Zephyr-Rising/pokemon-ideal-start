import { goalIsEmpty, scoreBoard, type FieldGoal, type GoalScore } from '../board/goal'
import type { DeckCard } from '../types'
import { draw, type ActionContext } from './actions'
import { buildContext } from './context'
import { isImplemented } from './effects'
import { mulberry32, shuffled } from './rng'
import { searchBestLine, setupScore } from './search'
import { cardName, inPlay, isBasicPokemon, type SimState } from './state'

export interface PlaytestOptions {
  trials?: number
  seed?: number
  /** Search budget per opening placement. */
  maxNodes?: number
  /** Called every `progressEvery` trials so a long run can report in. */
  onProgress?: (done: number, total: number) => void
  progressEvery?: number
}

export interface PartStat {
  id: string
  label: string
  /** Share of trials in which this part of the goal was reached. */
  metRate: number
}

/**
 * One exact outcome across the goal's parts: which were met, the rest missed.
 * Every trial lands in exactly one pattern, so the rates sum to 1.
 */
export interface PatternStat {
  /** Ids of the parts met. */
  met: string[]
  rate: number
}

/** The figures for one turn order. */
export interface OrderResult {
  /** P(the whole goal is reached). */
  strict: number
  /** 95% margin of error on `strict`. */
  margin: number
  /** Mean share of goal parts reached. */
  closeness: number
  parts: PartStat[]
  patterns: PatternStat[]
}

/**
 * Overall figures are the average of going first and going second, as if the
 * coin flip were fair. Each deal is played both ways, so the two orders are
 * compared on the same hands rather than on different luck.
 */
export interface PlaytestResult extends OrderResult {
  trials: number
  /** No Supporter on the first turn of the game. */
  goingFirst: OrderResult
  goingSecond: OrderResult
  /** P(the opening 7 holds no Basic and is reshuffled). */
  mulliganRate: number
  /** Cards in the deck the simulator cannot play, by name. */
  ignored: string[]
  /** Trials where the node budget stopped the search early. */
  truncated: number
  /**
   * Several distinct routes to the board, so you can see more than one way the
   * deck gets there. Successful ones only, unless nothing ever succeeded — then
   * it holds the single closest attempt.
   */
  examples: PlaytestExample[]
}

export interface PlaytestExample {
  /** The line of play, as readable text. Parallel to `frames` after the first. */
  steps: string[]
  /**
   * The hand and board at every point in the line, for replaying it a move at
   * a time. `frames[0]` is the opening hand before anything is played, so
   * `frames[i + 1]` is the board after `steps[i]`.
   */
  frames: ExampleFrame[]
  /** The board it ended on, trimmed to what the UI shows. */
  board: ExampleBoard | null
  /** Whether it reached the whole goal. */
  reached: boolean
  /** Played going first, so without a Supporter. */
  goingFirst: boolean
}

/** One moment in the line: what was just done, and the resulting table. */
export interface ExampleFrame {
  /** The play that produced this board; the first frame is the deal itself. */
  step: string
  board: ExampleBoard
  /** The cards held at this point, in hand order. */
  hand: ExampleCard[]
}

export interface ExampleCard {
  cardKey: string
  label: string
}

/** A board, reduced to what the results panel renders. */
export interface ExampleBoard {
  active: ExampleSlot | null
  bench: ExampleSlot[]
  stadium: string | null
  handCount: number
}

export interface ExampleSlot {
  cardKey: string
  label: string
  /** Energy then Tools attached, in the order they went on. */
  attached: ExampleCard[]
}

const DEFAULT_TRIALS = 1_500
/** Enough different routes to be interesting, few enough to stay quick. */
const MAX_EXAMPLES = 6

/** One entry per physical copy — the deck as it is actually shuffled. */
export function physicalDeck(cards: DeckCard[]): DeckCard[] {
  const out: DeckCard[] = []
  for (const card of cards) {
    for (let copy = 0; copy < card.count; copy++) out.push(card)
  }
  return out
}

/** Trainers in the deck with no implemented effect — the UI names these. */
export function ignoredCards(cards: DeckCard[]): string[] {
  const names = new Set<string>()
  for (const card of cards) {
    const playable =
      card.tags.includes('item') || card.tags.includes('supporter')
    if (playable && !isImplemented(card)) names.add(cardName(card))
  }
  return [...names].sort()
}

/**
 * How often this deck can build the goal board by the end of turn 1.
 *
 * Each trial deals a legal opening hand, then tries every Basic that could take
 * the Active Spot. The Active must come from the opening seven — placement
 * happens before the turn-1 draw — so it is enumerated here rather than left to
 * the search, which runs from each placement once the card has been drawn.
 *
 * Unlike Phase 1 this is a simulation, not a closed form, so the result carries
 * a margin of error.
 */
export function playtest(
  cards: DeckCard[],
  goal: FieldGoal,
  labelFor: (cardKey: string) => string,
  options: PlaytestOptions = {},
): PlaytestResult {
  const trials = options.trials ?? DEFAULT_TRIALS
  const seed = options.seed ?? 1
  const deck = physicalDeck(cards)
  const ignored = ignoredCards(cards)

  const noOrder: OrderResult = { strict: 0, margin: 0, closeness: 0, parts: [], patterns: [] }
  const blank: PlaytestResult = {
    ...noOrder,
    trials: 0,
    goingFirst: noOrder,
    goingSecond: noOrder,
    mulliganRate: 0,
    ignored,
    truncated: 0,
    examples: [],
  }
  if (deck.length < 13 || !deck.some(isBasicPokemon)) return blank
  // An empty goal is met by every board; running trials would say nothing.
  if (goalIsEmpty(goal)) {
    const always: OrderResult = { ...noOrder, strict: 1, closeness: 1 }
    return { ...blank, ...always, trials, goingFirst: always, goingSecond: always }
  }

  const first = new OrderTally()
  const second = new OrderTally()
  let mulligans = 0
  let deals = 0
  let truncated = 0

  // Distinct successful routes per turn order, keyed so two lines that make the
  // same plays in a different order collapse into one - otherwise "another
  // way" would keep showing the same way reshuffled.
  const firstRoutes = new Map<string, PlaytestExample>()
  const secondRoutes = new Map<string, PlaytestExample>()
  // A deal that worked going first, kept in case no game needed going second
  // to succeed: it is replayed going second at the end so both orders can be
  // shown.
  let replayAsSecond: { deal: Deal; ctx: ActionContext } | null = null
  let closest: PlaytestExample | null = null
  let closestScore = -1

  for (let trial = 0; trial < trials; trial++) {
    const rng = mulberry32(seed + trial * 7919)

    // Deal a legal opening hand, reshuffling while it holds no Basic.
    let order = shuffled(deck, rng)
    deals++
    while (!order.slice(0, 7).some(isBasicPokemon)) {
      mulligans++
      deals++
      order = shuffled(deck, rng)
    }

    const deal: Deal = { hand: order.slice(0, 7), prizes: order.slice(7, 13), rest: order.slice(13) }
    const ctx = buildContext(goal, rng, seed + trial, cards)

    // Going second allows every play going first does, plus a Supporter, so a
    // deal that works going first works going second too and need not be
    // searched again.
    const asFirst = playDeal(deal, goal, ctx, labelFor, options.maxNodes, true)
    const asSecond = asFirst.score.strict
      ? asFirst
      : playDeal(deal, goal, ctx, labelFor, options.maxNodes, false)

    first.add(asFirst.score)
    second.add(asSecond.score)
    if (asFirst.hitBudget || asSecond.hitBudget) truncated++

    if (asFirst.score.strict) {
      addRoute(firstRoutes, toExample(asFirst, true))
      replayAsSecond ??= { deal, ctx }
    } else if (asSecond.score.strict) {
      addRoute(secondRoutes, toExample(asSecond, false))
    } else if (asSecond.score.closeness > closestScore) {
      closestScore = asSecond.score.closeness
      closest = toExample(asSecond, false)
    }

    if (options.onProgress && (trial + 1) % (options.progressEvery ?? 25) === 0) {
      options.onProgress(trial + 1, trials)
    }
  }

  if (secondRoutes.size === 0 && replayAsSecond) {
    const { deal, ctx } = replayAsSecond
    const asSecond = playDeal(deal, goal, ctx, labelFor, options.maxNodes, false)
    if (asSecond.score.strict) addRoute(secondRoutes, toExample(asSecond, false))
  }

  return {
    ...averageOrders(first, second, trials),
    trials,
    goingFirst: first.result(trials),
    goingSecond: second.result(trials),
    mulliganRate: deals === 0 ? 0 : mulligans / deals,
    ignored,
    truncated,
    // Nothing succeeded anywhere? Then the closest attempt is the only thing
    // worth showing.
    examples:
      firstRoutes.size + secondRoutes.size > 0
        ? interleave([...firstRoutes.values()], [...secondRoutes.values()]).slice(0, MAX_EXAMPLES)
        : closest
          ? [closest]
          : [],
  }
}

function addRoute(routes: Map<string, PlaytestExample>, example: PlaytestExample): void {
  const key = [...example.steps].sort().join('|')
  if (routes.size < MAX_EXAMPLES && !routes.has(key)) routes.set(key, example)
}

/** Alternate two lists, so the first few entries show both. */
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

export const toHand = (cards: DeckCard[]): ExampleCard[] =>
  cards.map((card) => ({ cardKey: card.key, label: card.label }))

/** The table before anything is placed. */
const emptyBoard = (handCount: number): ExampleBoard => ({
  active: null,
  bench: [],
  stadium: null,
  handCount,
})

/** Trim a finished state to the handful of fields the results panel renders. */
export function toExampleBoard(state: SimState): ExampleBoard {
  const slot = (entry: SimState['bench'][number]): ExampleSlot => ({
    cardKey: entry.card.key,
    label: entry.card.label,
    attached: toHand([...entry.energy, ...entry.tools]),
  })
  return {
    active: state.active ? slot(state.active) : null,
    bench: state.bench.map(slot),
    stadium: state.stadium ? cardName(state.stadium) : null,
    handCount: state.hand.length,
  }
}

export interface Deal {
  hand: DeckCard[]
  prizes: DeckCard[]
  rest: DeckCard[]
}

export interface DealOutcome {
  score: GoalScore
  frames: ExampleFrame[]
  finalState: SimState | null
  hitBudget: boolean
}

/**
 * Play one deal in one turn order: try each distinct Basic in the opening hand
 * as the Active and keep the best board.
 *
 * The Active must come from the opening seven, because placement happens before
 * the turn-1 draw, so it is enumerated here rather than left to the search.
 * Going first, the Supporter for the turn is simply already spent: as far as a
 * board is concerned, that is the whole of the rule.
 */
export function playDeal(
  deal: Deal,
  goal: FieldGoal,
  ctx: ActionContext,
  labelFor: (cardKey: string) => string,
  maxNodes: number | undefined,
  goingFirst: boolean,
): DealOutcome {
  const { hand, prizes, rest } = deal
  const starters = new Map<string, number>()
  hand.forEach((card, index) => {
    if (isBasicPokemon(card) && !starters.has(card.key)) starters.set(card.key, index)
  })

  let best = scoreBoard(goal, { active: null, bench: [], stadiumKey: null, hand: [] }, labelFor)
  let frames: ExampleFrame[] = []
  let finalState: SimState | null = null
  let hitBudget = false

  for (const handIndex of starters.values()) {
    const placed: SimState = {
      hand: hand.filter((_, i) => i !== handIndex),
      deck: rest,
      discard: [],
      prizes,
      active: inPlay(hand[handIndex]),
      bench: [],
      stadium: null,
      usedEnergy: false,
      usedSupporter: goingFirst,
      usedStadium: false,
      usedRetreat: false,
      usedAbilities: [],
    }
    // The turn begins: both players draw, including the one going first.
    const started = draw(placed, 1)

    const result = searchBestLine(started, goal, ctx, labelFor, { maxNodes })
    if (!result.exhausted) hitBudget = true
    if (
      // Keep the first attempt even when it reaches nothing, so there is always
      // an end-of-turn board to carry into the next turn.
      finalState === null ||
      (result.score.strict !== best.strict
        ? result.score.strict
        : result.score.closeness > best.closeness ||
          // Playing on past this turn, the better-set-up opening wins a tie.
          (ctx.multiTurn === true &&
            result.score.closeness === best.closeness &&
            setupScore(result.finalState, ctx) > setupScore(finalState, ctx)))
    ) {
      best = result.score
      // The setup happens either side of the search, so the deal, the
      // placement and the turn's draw are stitched back on at the head of the
      // line - the placement is the decision most worth seeing, and the draw
      // is where the eighth card visibly comes from.
      frames = [
        { step: 'Draw your opening hand', board: emptyBoard(7), hand: toHand(hand) },
        {
          step: `Start with ${hand[handIndex].label} in the Active Spot`,
          board: toExampleBoard(placed),
          hand: toHand(placed.hand),
        },
        {
          step: 'Draw a card to start the turn',
          board: toExampleBoard(started),
          hand: toHand(started.hand),
        },
        ...result.frames.map((state, i) => ({
          step: result.steps[i],
          board: toExampleBoard(state),
          hand: toHand(state.hand),
        })),
      ]
      finalState = result.finalState
    }
    if (best.strict) break
  }
  return { score: best, frames, finalState, hitBudget }
}

function toExample(outcome: DealOutcome, goingFirst: boolean): PlaytestExample {
  return {
    // The text list is derived from the frames, so the two can never drift.
    steps: outcome.frames.slice(1).map((frame) => frame.step),
    frames: outcome.frames,
    board: outcome.finalState ? toExampleBoard(outcome.finalState) : null,
    reached: outcome.score.strict,
    goingFirst,
  }
}

/** Joins part ids into one pattern key; ids never contain it. */
const SEP = '\u0000'

/** Running totals for one turn order. */
class OrderTally {
  strictHits = 0
  closenessTotal = 0
  /** Part ids in first-seen order. */
  readonly parts = new Map<string, { label: string; hits: number }>()
  /** How many trials ended in each exact pattern, keyed by the met part ids. */
  readonly patterns = new Map<string, number>()
  /** Per trial: 1 if the whole goal was reached, else 0. */
  readonly outcomes: number[] = []

  add(score: GoalScore): void {
    if (score.strict) this.strictHits++
    this.closenessTotal += score.closeness
    this.outcomes.push(score.strict ? 1 : 0)
    for (const part of score.parts) {
      const entry = this.parts.get(part.id) ?? { label: part.label, hits: 0 }
      if (part.met) entry.hits++
      this.parts.set(part.id, entry)
    }
    const key = score.parts
      .filter((part) => part.met)
      .map((part) => part.id)
      .join(SEP)
    this.patterns.set(key, (this.patterns.get(key) ?? 0) + 1)
  }

  result(trials: number): OrderResult {
    const strict = this.strictHits / trials
    return {
      strict,
      // 95% margin on a proportion.
      margin: 1.96 * Math.sqrt(Math.max(strict * (1 - strict), 0) / trials),
      closeness: this.closenessTotal / trials,
      parts: [...this.parts].map(([id, entry]) => ({
        id,
        label: entry.label,
        metRate: entry.hits / trials,
      })),
      patterns: patternStats(this.patterns, trials),
    }
  }
}

const patternStats = (counts: Map<string, number>, trials: number): PatternStat[] =>
  [...counts]
    .map(([key, count]) => ({ met: key === '' ? [] : key.split(SEP), rate: count / trials }))
    .sort((a, b) => b.rate - a.rate)

/**
 * The fair-coin average of both orders. Each deal was played both ways, so its
 * outcome is the mean of the two (0, a half, or 1), and the margin comes from
 * the spread of those per-deal means rather than from treating the two orders
 * as independent samples.
 */
function averageOrders(first: OrderTally, second: OrderTally, trials: number): OrderResult {
  const a = first.result(trials)
  const b = second.result(trials)
  const strict = (a.strict + b.strict) / 2
  const means = first.outcomes.map((x, i) => (x + second.outcomes[i]) / 2)
  const variance =
    means.reduce((sum, m) => sum + (m - strict) ** 2, 0) / Math.max(trials - 1, 1)

  const combined = new Map<string, number>()
  for (const tally of [first, second]) {
    for (const [key, count] of tally.patterns) {
      combined.set(key, (combined.get(key) ?? 0) + count / 2)
    }
  }
  const secondRate = new Map(b.parts.map((part) => [part.id, part.metRate]))
  return {
    strict,
    margin: 1.96 * Math.sqrt(variance / trials),
    closeness: (a.closeness + b.closeness) / 2,
    parts: a.parts.map((part) => ({
      ...part,
      metRate: (part.metRate + (secondRate.get(part.id) ?? 0)) / 2,
    })),
    patterns: patternStats(combined, trials),
  }
}
