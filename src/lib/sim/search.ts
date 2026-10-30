import { scoreBoard, type FieldGoal, type GoalScore } from '../board/goal'
import { applyAction, legalActions, type Action, type ActionContext } from './actions'
import { describeStep } from './describe'
import { orderActions } from './priorities'
import { abilityOf } from './abilities'
import { allInPlay, signature, toBoardView, type SimState } from './state'

export interface SearchResult {
  /** The best board this hand could reach. */
  score: GoalScore
  /** The plays that reached it, in order. */
  line: Action[]
  /** The same plays, as readable text. */
  steps: string[]
  /**
   * The board after each play, parallel to `steps`.
   *
   * Kept so the UI can replay the line a move at a time. These are references
   * to states the search already allocated, so the chain costs one pointer per
   * step rather than a copy.
   */
  frames: SimState[]
  /** The board those plays ended on. */
  finalState: SimState
  /** States expanded. */
  nodes: number
  /** False when the node budget stopped the search before it finished. */
  exhausted: boolean
}

export interface SearchOptions {
  /** Expansion budget. Reached only by unusually open hands. */
  maxNodes?: number
}

/**
 * Measured on the benchmark (`npm run bench`): at 3,000 a turn-1 search almost
 * never runs out, and turn-1 results are identical from 1,500 to 6,000.
 */
const DEFAULT_MAX_NODES = 3_000

/**
 * How far a board is set up toward a goal it has not met yet, for breaking
 * ties when play continues past this turn.
 *
 * Within one turn two boards that meet the same share of the goal are equally
 * good. Across turns they are not: a Dreepy on the bench is a Drakloak next
 * turn, and a Drakloak is a Dragapult ex the turn after. So each Pokémon in
 * play from one of the goal's evolution lines counts, more the further along
 * it is; a Pokémon whose Ability draws counts too, as it keeps digging; and
 * cards in hand count a little, so a turn does not spend resources for
 * nothing.
 */
export function setupScore(state: SimState, ctx: ActionContext): number {
  let score = 0
  for (const slot of allInPlay(state)) {
    const tags = slot.card.tags
    if (ctx.relevant.has(slot.card.key)) {
      score += tags.includes('stage2') ? 30 : tags.includes('stage1') ? 20 : 10
    }
    if (abilityOf(slot.card)?.draws || abilityOf(slot.card)?.engine) score += 4
  }
  return score + state.hand.length * 0.5
}

/** One play in a line: what was done, and the boards either side of it. */
interface Step {
  action: Action
  before: SimState
  after: SimState
  /** The play before it, or null for the first. */
  previous: Step | null
}

/** Strict beats non-strict; otherwise more of the goal met wins. */
function better(candidate: GoalScore, incumbent: GoalScore): boolean {
  if (candidate.strict !== incumbent.strict) return candidate.strict
  return candidate.closeness > incumbent.closeness
}

const ties = (a: GoalScore, b: GoalScore): boolean =>
  a.strict === b.strict && a.closeness === b.closeness

/**
 * Find the best board this hand can reach by the end of turn 1.
 *
 * Within a single deal the search is **deterministic**: searching your own deck
 * is a choice, not a roll, so every branch is a real decision the player could
 * make. The only randomness is the shuffle, which is fixed before the search
 * starts, and shuffle-and-draw effects, which draw from the context's seeded
 * RNG so a branch always resolves the same way.
 *
 * Every state is scored, not just the ones after an explicit end-of-turn:
 * stopping early is itself a legal choice, and it matters when the goal asks
 * for cards still in hand.
 */
export function searchBestLine(
  start: SimState,
  goal: FieldGoal,
  ctx: ActionContext,
  labelFor: (cardKey: string) => string,
  options: SearchOptions = {},
): SearchResult {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
  const seen = new Set<string>()

  let best = scoreBoard(goal, toBoardView(start), labelFor)
  let bestSetup = ctx.multiTurn ? setupScore(start, ctx) : 0
  // Assigned inside `visit`, which TypeScript cannot see from here.
  let bestNode = null as Step | null
  let bestState = start
  let nodes = 0
  let exhausted = true

  // Each visited board remembers only the play that made it and the board it
  // came from. The line, its readable steps and its frames are rebuilt for the
  // winning board alone once the search is over: describing every play the
  // search merely tried was a sizeable share of its time.
  const visit = (state: SimState, step: Step | null): void => {
    if (best.strict) return
    if (nodes >= maxNodes) {
      exhausted = false
      return
    }

    const key = signature(state)
    if (seen.has(key)) return
    seen.add(key)
    nodes++

    const score = scoreBoard(goal, toBoardView(state), labelFor)
    const setup = ctx.multiTurn ? setupScore(state, ctx) : 0
    if (better(score, best) || (ctx.multiTurn && ties(score, best) && setup > bestSetup)) {
      best = score
      bestSetup = setup
      bestNode = step
      bestState = state
    }
    // Nothing further can improve on a board that already meets the goal.
    if (score.strict) return

    for (const action of orderActions(state, legalActions(state, ctx), ctx)) {
      // Ending the turn adds no board; this state has already been scored.
      if (action.kind === 'end') continue
      for (const next of applyAction(state, action, ctx)) {
        visit(next, { action, before: state, after: next, previous: step })
        if (best.strict) return
      }
    }
  }

  visit(start, null)

  const chain: Step[] = []
  for (let step: Step | null = bestNode; step; step = step.previous) chain.unshift(step)
  return {
    score: best,
    line: chain.map((step) => step.action),
    steps: chain.map((step) => describeStep(step.before, step.after, step.action)),
    frames: chain.map((step) => step.after),
    finalState: bestState,
    nodes,
    exhausted,
  }
}
