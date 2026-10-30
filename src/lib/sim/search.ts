import { scoreBoard, type FieldGoal, type GoalScore } from '../board/goal'
import { applyAction, legalActions, type Action, type ActionContext } from './actions'
import { describeStep } from './describe'
import { orderActions } from './priorities'
import { abilityOf, engineKeeps } from './abilities'
import {
  ACTIVE_TARGET,
  allInPlay,
  energyType,
  signature,
  toBoardView,
  type InPlay,
  type SimState,
} from './state'

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
 * Extra boards to look at, once the goal is met, for a shorter way to meet it.
 * The first winning line found is often padded with plays that did nothing for
 * it — benching a spare, retreating and back — and a player would not make them.
 */
const REFINE_NODES = 400

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

/**
 * The turn's manual Energy attachment, when the line left it unused.
 *
 * Inside the search an attachment that completes no part this turn ties with
 * not attaching, and the shorter line wins — so on its own the search would
 * end turns holding Energy a player would have put down. The attachment is
 * therefore made here, after the search, as the turn's last play: it costs no
 * search time, and in a longer game the Energy is there for later turns.
 *
 * It goes where it will count most: on a Pokémon the goal wants Energy on (or
 * an earlier stage of one), else on the goal Active's line, else on any
 * Pokémon the goal names, else on the Active. Energy a draw engine is about to
 * spend (Lunar Cycle, Teal Dance) is never used for it.
 */
function closingAttachment(
  state: SimState,
  ctx: ActionContext,
): { action: Action; next: SimState } | null {
  if (state.usedEnergy || !state.active) return null
  const keep = engineKeeps(state)
  const choices = state.hand
    .map((card, handIndex) => ({ card, handIndex }))
    .filter(({ card, handIndex }) => card.tags.includes('basic-energy') && !keep.has(handIndex))
  if (choices.length === 0) return null
  // A type the goal asks for, when it asks for one.
  const energy =
    choices.find(({ card }) => ctx.energyTypes.has(energyType(card))) ?? choices[0]

  const worth = (slot: InPlay): number => {
    const key = slot.card.key
    if (ctx.wantsEnergy && ctx.energyTargets.has(key)) return 4
    if (ctx.activeLineage?.has(key)) return 3
    if (ctx.relevant.has(key)) return 2
    return slot === state.active ? 1 : 0
  }
  const slots = [
    { slot: state.active, target: ACTIVE_TARGET },
    ...state.bench.map((slot, target) => ({ slot, target })),
  ]
  // Ties go to the earliest, which puts the Active first.
  const best = slots.reduce((a, b) => (worth(b.slot) > worth(a.slot) ? b : a))
  const action: Action = { kind: 'attachEnergy', handIndex: energy.handIndex, target: best.target }
  const [next] = applyAction(state, action, ctx)
  return next ? { action, next } : null
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
  // The fewest plays each board has been reached in, so a shorter way to a
  // board already seen can still be followed.
  const seen = new Map<string, number>()

  let best = scoreBoard(goal, toBoardView(start), labelFor)
  let bestSetup = ctx.multiTurn ? setupScore(start, ctx) : 0
  // Assigned inside `visit`, which TypeScript cannot see from here.
  let bestNode = null as Step | null
  let bestState = start
  let bestDepth = 0
  let nodes = 0
  let exhausted = true
  // Once the goal is met, the search spends a little more looking for a
  // shorter way to meet it, and stops there. Null until then.
  let refineUntil: number | null = null

  // Each visited board remembers only the play that made it and the board it
  // came from. The line, its readable steps and its frames are rebuilt for the
  // winning board alone once the search is over: describing every play the
  // search merely tried was a sizeable share of its time.
  const done = () => refineUntil !== null && nodes >= refineUntil

  const visit = (state: SimState, step: Step | null, depth: number): void => {
    if (done()) return
    // With the goal met, only a strictly shorter line is worth finding.
    if (best.strict && depth >= bestDepth) return
    if (nodes >= maxNodes && !best.strict) {
      exhausted = false
      return
    }

    const key = signature(state)
    const reached = seen.get(key)
    if (reached !== undefined && reached <= depth) return
    seen.set(key, depth)
    nodes++

    const score = scoreBoard(goal, toBoardView(state), labelFor)
    const setup = ctx.multiTurn ? setupScore(state, ctx) : 0
    const tie = ties(score, best) && (!ctx.multiTurn || setup === bestSetup)
    if (
      better(score, best) ||
      (ctx.multiTurn && ties(score, best) && setup > bestSetup) ||
      // As good, in fewer plays: the line a player would actually choose.
      (tie && depth < bestDepth)
    ) {
      // Refining may run past the budget: the budget bounds finding the goal,
      // and a line padded with pointless plays is worth the small extra.
      if (score.strict && !best.strict) refineUntil = nodes + REFINE_NODES
      best = score
      bestSetup = setup
      bestNode = step
      bestState = state
      bestDepth = depth
    }
    // Nothing further can improve on a board that already meets the goal.
    if (score.strict) return

    for (const action of orderActions(state, legalActions(state, ctx), ctx)) {
      // Ending the turn adds no board; this state has already been scored.
      if (action.kind === 'end') continue
      for (const next of applyAction(state, action, ctx)) {
        visit(next, { action, before: state, after: next, previous: step }, depth + 1)
        if (done()) return
      }
    }
  }

  visit(start, null, 0)

  // A player never ends a turn holding an Energy they could have attached.
  const closing = closingAttachment(bestState, ctx)
  if (closing) {
    const after = scoreBoard(goal, toBoardView(closing.next), labelFor)
    // Only if it costs the board nothing — an Energy the goal wants kept in
    // hand stays there.
    if (after.strict === best.strict && after.closeness >= best.closeness) {
      bestNode = { action: closing.action, before: bestState, after: closing.next, previous: bestNode }
      bestState = closing.next
      best = after
    }
  }

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
