import { scoreBoard, type FieldGoal, type GoalScore } from '../board/goal'
import { applyAction, legalActions, type Action, type ActionContext } from './actions'
import { orderActions } from './priorities'
import { signature, toBoardView, type SimState } from './state'

export interface SearchResult {
  /** The best board this hand could reach. */
  score: GoalScore
  /** The plays that reached it, in order. */
  line: Action[]
  /** States expanded. */
  nodes: number
  /** False when the node budget stopped the search before it finished. */
  exhausted: boolean
}

export interface SearchOptions {
  /** Expansion budget. Reached only by unusually open hands. */
  maxNodes?: number
}

const DEFAULT_MAX_NODES = 1_500

/** Strict beats non-strict; otherwise more of the goal met wins. */
function better(candidate: GoalScore, incumbent: GoalScore): boolean {
  if (candidate.strict !== incumbent.strict) return candidate.strict
  return candidate.closeness > incumbent.closeness
}

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
  let bestLine: Action[] = []
  let nodes = 0
  let exhausted = true

  const visit = (state: SimState, line: Action[]): void => {
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
    if (better(score, best)) {
      best = score
      bestLine = line
    }
    // Nothing further can improve on a board that already meets the goal.
    if (score.strict) return

    for (const action of orderActions(state, legalActions(state, ctx), ctx)) {
      // Ending the turn adds no board; this state has already been scored.
      if (action.kind === 'end') continue
      for (const next of applyAction(state, action, ctx)) {
        visit(next, [...line, action])
        if (best.strict) return
      }
    }
  }

  visit(start, [])
  return { score: best, line: bestLine, nodes, exhausted }
}
