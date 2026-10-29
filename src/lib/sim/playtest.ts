import { goalIsEmpty, scoreBoard, type FieldGoal } from '../board/goal'
import type { DeckCard } from '../types'
import { draw } from './actions'
import { buildContext } from './context'
import { isImplemented } from './effects'
import { mulberry32, shuffled } from './rng'
import { searchBestLine } from './search'
import { cardName, energyType, inPlay, isBasicPokemon, type SimState } from './state'

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

export interface PlaytestResult {
  trials: number
  /** P(the whole goal is reached). */
  strict: number
  /** 95% margin of error on `strict`. */
  margin: number
  /** Mean share of goal parts reached. */
  closeness: number
  parts: PartStat[]
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
  /** Energy type symbols attached. */
  energy: string[]
}

const DEFAULT_TRIALS = 1_500
/** Enough different routes to be interesting, few enough to stay quick. */
const MAX_EXAMPLES = 6

/** One entry per physical copy — the deck as it is actually shuffled. */
function physicalDeck(cards: DeckCard[]): DeckCard[] {
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

  const blank: PlaytestResult = {
    trials: 0,
    strict: 0,
    margin: 0,
    closeness: 0,
    parts: [],
    mulliganRate: 0,
    ignored,
    truncated: 0,
    examples: [],
  }
  if (deck.length < 13 || !deck.some(isBasicPokemon)) return blank
  // An empty goal is met by every board; running trials would say nothing.
  if (goalIsEmpty(goal)) return { ...blank, trials, strict: 1, closeness: 1 }

  let strictHits = 0
  let closenessTotal = 0
  let mulligans = 0
  let deals = 0
  let truncated = 0
  const partHits = new Map<string, { label: string; hits: number }>()

  // Distinct successful routes, keyed so two lines that make the same plays in
  // a different order collapse into one - otherwise "another way" would keep
  // showing the same way reshuffled.
  const routes = new Map<string, PlaytestExample>()
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

    const hand = order.slice(0, 7)
    const prizes = order.slice(7, 13)
    const rest = order.slice(13)

    const ctx = buildContext(goal, rng, seed + trial)

    // Try each distinct Basic in the opening hand as the Active.
    const starters = new Map<string, number>()
    hand.forEach((card, index) => {
      if (isBasicPokemon(card) && !starters.has(card.key)) starters.set(card.key, index)
    })

    let best = scoreBoard(goal, { active: null, bench: [], stadiumKey: null, hand: [] }, labelFor)
    let bestFrames: ExampleFrame[] = []
    let bestState: SimState | null = null
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
        usedSupporter: false,
        usedStadium: false,
        usedRetreat: false,
        usedAbilities: [],
      }
      // The turn begins: both players draw, including the one going first.
      const started = draw(placed, 1)

      const result = searchBestLine(started, goal, ctx, labelFor, { maxNodes: options.maxNodes })
      if (!result.exhausted) hitBudget = true
      if (
        result.score.strict !== best.strict
          ? result.score.strict
          : result.score.closeness > best.closeness
      ) {
        best = result.score
        // The setup happens either side of the search, so the deal, the
        // placement and the turn's draw are stitched back on at the head of the
        // line - the placement is the decision most worth seeing, and the draw
        // is where the eighth card visibly comes from.
        bestFrames = [
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
        bestState = result.finalState
      }
      if (best.strict) break
    }

    if (hitBudget) truncated++
    if (best.strict) strictHits++
    closenessTotal += best.closeness
    for (const part of best.parts) {
      const entry = partHits.get(part.id) ?? { label: part.label, hits: 0 }
      if (part.met) entry.hits++
      partHits.set(part.id, entry)
    }

    // The text list is derived from the frames, so the two can never drift.
    const bestSteps = bestFrames.slice(1).map((frame) => frame.step)
    const example: PlaytestExample = {
      steps: bestSteps,
      frames: bestFrames,
      board: bestState ? toExampleBoard(bestState) : null,
      reached: best.strict,
    }
    if (best.strict) {
      const key = [...bestSteps].sort().join('|')
      if (routes.size < MAX_EXAMPLES && !routes.has(key)) routes.set(key, example)
    } else if (best.closeness > closestScore) {
      closestScore = best.closeness
      closest = example
    }

    if (options.onProgress && (trial + 1) % (options.progressEvery ?? 100) === 0) {
      options.onProgress(trial + 1, trials)
    }
  }

  const strict = strictHits / trials
  return {
    trials,
    strict,
    // 95% margin on a proportion.
    margin: 1.96 * Math.sqrt(Math.max(strict * (1 - strict), 0) / trials),
    closeness: closenessTotal / trials,
    parts: [...partHits].map(([id, entry]) => ({
      id,
      label: entry.label,
      metRate: entry.hits / trials,
    })),
    mulliganRate: deals === 0 ? 0 : mulligans / deals,
    ignored,
    truncated,
    // Nothing succeeded anywhere? Then the closest attempt is the only thing
    // worth showing.
    examples: routes.size > 0 ? [...routes.values()] : closest ? [closest] : [],
  }
}

const toHand = (cards: DeckCard[]): ExampleCard[] =>
  cards.map((card) => ({ cardKey: card.key, label: card.label }))

/** The table before anything is placed. */
const emptyBoard = (handCount: number): ExampleBoard => ({
  active: null,
  bench: [],
  stadium: null,
  handCount,
})

/** Trim a finished state to the handful of fields the results panel renders. */
function toExampleBoard(state: SimState): ExampleBoard {
  const slot = (entry: SimState['bench'][number]): ExampleSlot => ({
    cardKey: entry.card.key,
    label: entry.card.label,
    energy: entry.energy.map(energyType),
  })
  return {
    active: state.active ? slot(state.active) : null,
    bench: state.bench.map(slot),
    stadium: state.stadium ? cardName(state.stadium) : null,
    handCount: state.hand.length,
  }
}
