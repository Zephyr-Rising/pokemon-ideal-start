import { scoreBoard, type FieldGoal, type GoalScore } from '../board/goal'
import { norm } from '../normalize'
import {
  applyAction,
  attackNeedsEnergy,
  legalActions,
  needsRetreatEnergy,
  type Action,
  type ActionContext,
} from './actions'
import { describeStep, summarizeStep, type StepSummary } from './describe'
import { lookupEffect } from './effects'
import { orderActions } from './priorities'
import { abilityAvailable, abilityOf, drawsWhileActive, engineKeeps } from './abilities'
import {
  ACTIVE_TARGET,
  allInPlay,
  BASE_BENCH,
  benchCap,
  energyFits,
  freesRetreat,
  nameOf,
  isBasicPokemon,
  retreatCost,
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
  /** The same plays, as pictures for the replay. */
  summaries: StepSummary[]
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
  /**
   * With `keep` set: the best few distinct boards the turn could end on, best
   * first, each with its own end-of-turn attachment made. For planning across
   * turns, where this turn's best is not always the best start for the next.
   */
  alternatives: Alternative[]
}

export interface Alternative {
  state: SimState
  score: GoalScore
  setup: number
  /** Playing on, the score it ranks by when that differs (see `outlook`). */
  ahead?: GoalScore
  /** The last play of the line that reached it; null when no play was made. */
  step: Step | null
}

/** The plays and boards of an alternative's line, rebuilt on demand. */
export function lineOf(alt: Alternative): {
  steps: string[]
  frames: SimState[]
  summaries: StepSummary[]
} {
  const chain: Step[] = []
  for (let step = alt.step; step; step = step.previous) chain.unshift(step)
  return {
    steps: chain.map((step) => describeStep(step.before, step.after, step.action)),
    frames: chain.map((step) => step.after),
    summaries: chain.map((step) => summarizeStep(step.before, step.after, step.action)),
  }
}

export interface SearchOptions {
  /** Expansion budget. Reached only by unusually open hands. */
  maxNodes?: number
  /** How many of the best end-of-turn boards to return as `alternatives`. */
  keep?: number
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
 *
 * A line counts in full only as many times as the goal wants it: a third
 * Slowpoke is a spare, worth a little as a backup but far less than the
 * Dunsparce the board still needs a slot for. And the pieces the goal names
 * count in hand too, so a hand refresh that finds them is worth playing.
 */
export function setupScore(state: SimState, ctx: ActionContext): number {
  let score = 0
  const stageWorth = (tags: string[]) => (tags.includes('stage2') ? 30 : tags.includes('stage1') ? 20 : 10)
  // Furthest along first, so the copies that count in full are the best ones.
  const inPlay = [...allInPlay(state)].sort((a, b) => stageWorth(b.card.tags) - stageWorth(a.card.tags))
  const used = new Map<{ keys: Set<string>; needed: number }, number>()
  for (const slot of inPlay) {
    const tags = slot.card.tags
    // A Pokémon the goal wants in hand earns nothing for being in play.
    if (ctx.relevant.has(slot.card.key) && !ctx.handOnly?.has(slot.card.key)) {
      const line = ctx.goalLines?.find((l) => l.keys.has(slot.card.key))
      const count = line ? (used.get(line) ?? 0) : 0
      if (line) used.set(line, count + 1)
      score += line && count >= line.needed ? SPARE_WORTH : stageWorth(tags)
    }
    const def = abilityOf(slot.card)
    if (def?.draws || def?.engine || (ctx.wantsEnergy && def?.accelerates)) score += 4
  }
  // A Pokémon drawing from the Active Spot keeps drawing every turn it stays
  // there (Mega Kangaskhan ex).
  if (state.active && drawsWhileActive(state.active.card)) score += 6
  // A count is met all at once, so on its own it rewards no step toward it:
  // four benched of eight scores as nothing. Across turns each step counts.
  if ((ctx.benchMin ?? 0) > 0) score += Math.min(state.bench.length, ctx.benchMin!) * COUNT_STEP_WORTH
  if ((ctx.energyMin ?? 0) > 0) {
    const attached = allInPlay(state).reduce((sum, slot) => sum + slot.energy.length, 0)
    score += Math.min(attached, ctx.energyMin!) * COUNT_STEP_WORTH
  }
  // Area Zero Underdepths in play is the room a bench of more than five needs.
  if (ctx.expandsBench && benchCap(state) > BASE_BENCH) score += COUNT_STEP_WORTH * 2
  const pieces = new Set(state.hand.filter((card) => ctx.relevant.has(card.key)).map((card) => card.key))
  return score + pieces.size * PIECE_IN_HAND_WORTH + state.hand.length * 0.5
}

/** Each step toward a count the goal asks for: one more benched, one more Energy. */
const COUNT_STEP_WORTH = 4

/** A copy of a goal line beyond what the goal wants: a backup, not progress. */
const SPARE_WORTH = 2
/** Each distinct card the goal names, held in hand for a later turn. */
const PIECE_IN_HAND_WORTH = 2

/** One play in a line: what was done, and the boards either side of it. */
export interface Step {
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
 * It goes where it will count most: on an Active that needs it to retreat into
 * the goal's Pokémon, else on a Pokémon the goal wants Energy on (or an earlier
 * stage of one), else on the goal Active's line, else on any Pokémon the goal
 * names, else on an Active whose searching attack is short of its cost — and
 * nowhere else: with no such Pokémon it stays in hand. Energy a draw engine is
 * about to spend (Lunar Cycle, Teal Dance) is never used for it.
 */
function closingAttachment(
  state: SimState,
  ctx: ActionContext,
): { action: Action; next: SimState } | null {
  // Nothing follows an attack; the search attaches before attacking instead.
  if (state.usedEnergy || state.attacked || !state.active) return null
  const keep = engineKeeps(state)
  const choices = state.hand
    .map((card, handIndex) => ({ card, handIndex }))
    .filter(({ card, handIndex }) => card.tags.includes('basic-energy') && !keep.has(handIndex))
  if (choices.length === 0) return null
  // A type the goal asks for, when it asks for one.
  const energy =
    (ctx.energyTypes.size > 0 && choices.find(({ card }) => energyFits(card, ctx.energyTypes))) ||
    choices[0]

  // An Active stuck short of the retreat into the goal's Pokémon comes first:
  // Energy on the Pokémon it evolves into helps nothing while that one is
  // benched. Unless the hand already holds a way out that costs no Energy — in
  // a deck with few Energy, every attachment matters.
  const retreatShort = needsRetreatEnergy(state, ctx) && !freeWayOut(state)
  const wants = ctx.energyLineage ?? ctx.energyTargets
  const worth = (slot: InPlay): number => {
    const key = slot.card.key
    if (retreatShort && slot === state.active) return 5
    // A total-Energy goal (no Pokémon named) counts Energy on any Pokémon.
    if (ctx.wantsEnergy && (wants.size === 0 || wants.has(key))) return 4
    if (ctx.activeLineage?.has(key)) return 3
    if (ctx.relevant.has(key)) return 2
    // The Active's searching attack still short of its cost.
    if (slot === state.active && attackNeedsEnergy(state)) return 1
    return 0
  }
  const slots = [
    { slot: state.active, target: ACTIVE_TARGET },
    ...state.bench.map((slot, target) => ({ slot, target })),
  ]
  // Ties go to the earliest, which puts the Active first.
  const best = slots.reduce((a, b) => (worth(b.slot) > worth(a.slot) ? b : a))
  // Nowhere it does anything: the Energy stays in hand for a Pokémon that will
  // need it, rather than going on one that never does (a Budew that retreats
  // for free). In a deck with few Energy, each one matters.
  if (worth(best.slot) === 0) return null
  const action: Action = { kind: 'attachEnergy', handIndex: energy.handIndex, target: best.target }
  const [next] = applyAction(state, action, ctx)
  return next ? { action, next } : null
}

/**
 * A way out of the Active Spot in hand that costs no Energy: an Air Balloon
 * that covers the retreat, a Switch-type card the simulator can play, or Latias
 * ex (Skyliner) for a Basic Active with room on the Bench.
 */
function freeWayOut(state: SimState): boolean {
  const active = state.active
  if (!active) return false
  const cost = retreatCost(state, active)
  const balloon =
    active.tools.length === 0 &&
    state.hand.some((card) => nameOf(card) === norm('Air Balloon')) &&
    Math.max(0, cost - 2) <= active.energy.length
  const switcher = state.hand.some((card) => card.tags.includes('switch') && lookupEffect(card) !== undefined)
  const latias =
    isBasicPokemon(active.card) &&
    state.bench.length < benchCap(state) &&
    state.hand.some(freesRetreat)
  return balloon || switcher || latias
}

/**
 * Run Errand left unused at the end of a turn: Mega Kangaskhan ex in the
 * Active Spot with its draw still available. Drawing two can only help.
 */
function closingDraw(state: SimState, ctx: ActionContext): { action: Action; next: SimState } | null {
  if (state.attacked || !state.active || state.deck.length === 0) return null
  if (!drawsWhileActive(state.active.card) || !abilityAvailable(state, ACTIVE_TARGET)) return null
  const action: Action = { kind: 'useAbility', target: ACTIVE_TARGET }
  const [next] = applyAction(state, action, ctx)
  return next ? { action, next } : null
}

/**
 * Strict beats non-strict; then more priority levels fully met (every
 * essential part beats more parts overall); then more of the goal met.
 */
function better(candidate: GoalScore, incumbent: GoalScore): boolean {
  if (candidate.strict !== incumbent.strict) return candidate.strict
  if (candidate.tier !== incumbent.tier) return candidate.tier > incumbent.tier
  return candidate.closeness > incumbent.closeness
}

const ties = (a: GoalScore, b: GoalScore): boolean =>
  a.strict === b.strict && a.tier === b.tier && a.closeness === b.closeness

/**
 * Playing on, how far along an unfinished board is from next turn's start.
 *
 * A Pokémon that draws from the Active Spot (Mega Kangaskhan ex) holding it,
 * with the goal's Active benched behind and a retreat it can pay by next turn
 * (see `retreatPayableSoon`), is a goal Active one retreat away — and it draws again
 * first. Scored only as the goal Active, such a board would lose to promoting
 * the goal's Pokémon early, after which nothing draws and the game stalls. So
 * it ranks as if the swap were made; the board's real score is unchanged.
 */
/**
 * Can the Active's retreat be paid by next turn: already, with the turn's
 * attachment from an Energy in hand, or for free once Latias ex is benched
 * (in hand or still in the deck, for a Basic Active)?
 */
function retreatPayableSoon(state: SimState, active: InPlay): boolean {
  const cost = retreatCost(state, active)
  if (active.energy.length >= cost) return true
  if (active.energy.length + 1 >= cost && state.hand.some((card) => card.tags.includes('basic-energy'))) return true
  return isBasicPokemon(active.card) && [...state.hand, ...state.deck].some(freesRetreat)
}

function outlook(
  state: SimState,
  score: GoalScore,
  goal: FieldGoal,
  ctx: ActionContext,
  labelFor: (cardKey: string) => string,
): GoalScore {
  if (!ctx.multiTurn || score.strict) return score
  // The turn's Supporter comes back next turn, so one used now costs a
  // "Supporter still free" board nothing.
  const fresh = goal.supporterFree === true && state.usedSupporter
  const view = (board: SimState) => ({ ...toBoardView(board), ...(fresh ? { supporterUsed: false } : {}) })
  let best = score
  if (fresh) {
    const again = scoreBoard(goal, view(state), labelFor)
    if (better(again, best)) best = { ...again, strict: false }
  }
  const active = state.active
  if (!active || !drawsWhileActive(active.card)) return best
  if (!retreatPayableSoon(state, active)) return best
  const index = state.bench.findIndex((slot) => ctx.activeLineage?.get(slot.card.key) === 0)
  if (index < 0) return best
  const swapped: SimState = {
    ...state,
    active: state.bench[index],
    bench: state.bench.map((slot, i) => (i === index ? active : slot)),
  }
  const ahead = scoreBoard(goal, view(swapped), labelFor)
  return better(ahead, best) ? { ...ahead, strict: false } : best
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
  const keep = options.keep ?? 1
  // The best few boards seen, best first; only kept when asked for.
  const kept: Alternative[] = []
  const remember = (candidate: Alternative) => {
    if (kept.length === keep && !outranks(candidate, kept[kept.length - 1])) return
    kept.push(candidate)
    kept.sort((a, b) => (outranks(a, b) ? -1 : outranks(b, a) ? 1 : 0))
    if (kept.length > keep) kept.pop()
  }
  // The fewest plays each board has been reached in, so a shorter way to a
  // board already seen can still be followed.
  const seen = new Map<string, number>()

  let best = scoreBoard(goal, toBoardView(start), labelFor)
  let bestSetup = ctx.multiTurn ? setupScore(start, ctx) : 0
  // What the best board ranks by (see `outlook`); `best` stays its real score.
  let bestAhead = outlook(start, best, goal, ctx, labelFor)
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
    const ahead = outlook(state, score, goal, ctx, labelFor)
    if (keep > 1) remember({ state, score, setup, ahead, step })
    const tie = ties(ahead, bestAhead) && (!ctx.multiTurn || setup === bestSetup)
    if (
      better(ahead, bestAhead) ||
      (ctx.multiTurn && ties(ahead, bestAhead) && setup > bestSetup) ||
      // As good, in fewer plays: the line a player would actually choose.
      (tie && depth < bestDepth)
    ) {
      // Refining may run past the budget: the budget bounds finding the goal,
      // and a line padded with pointless plays is worth the small extra.
      if (score.strict && !best.strict) refineUntil = nodes + REFINE_NODES
      best = score
      bestAhead = ahead
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
      // An attack ends the turn, so the turn's Energy goes down first.
      let from = state
      let lead = step
      if (action.kind === 'attack') {
        const closing = closingAttachment(state, ctx)
        if (closing) {
          lead = { action: closing.action, before: state, after: closing.next, previous: step }
          from = closing.next
        }
      }
      for (const next of applyAction(from, action, ctx)) {
        visit(next, { action, before: from, after: next, previous: lead }, depth + 1)
        if (done()) return
      }
    }
  }

  visit(start, null, 0)

  /**
   * The plays a turn always ends with when they are there to make: a free draw
   * from the Active Spot (Run Errand) — which the search can leave unused when
   * the cards change nothing this turn — then the turn's Energy attachment,
   * which can be one just drawn. Each only if it costs the board nothing: an
   * Energy the goal wants kept in hand stays there.
   */
  const close = (alt: Alternative): Alternative => {
    let current = alt
    for (const closing of [closingDraw, closingAttachment]) {
      const play = closing(current.state, ctx)
      if (!play) continue
      const score = scoreBoard(goal, toBoardView(play.next), labelFor)
      if (
        score.strict !== current.score.strict ||
        score.tier < current.score.tier ||
        score.closeness < current.score.closeness
      ) {
        continue
      }
      current = {
        state: play.next,
        score,
        setup: ctx.multiTurn ? setupScore(play.next, ctx) : 0,
        ahead: outlook(play.next, score, goal, ctx, labelFor),
        step: { action: play.action, before: current.state, after: play.next, previous: current.step },
      }
    }
    return current
  }

  const closed = close({ state: bestState, score: best, setup: bestSetup, ahead: bestAhead, step: bestNode })
  bestState = closed.state
  best = closed.score
  bestSetup = closed.setup
  bestAhead = closed.ahead ?? closed.score
  bestNode = closed.step

  const alternatives = kept.map(close)
  // With only the best asked for, it stands in as the single alternative.
  if (alternatives.length === 0) {
    alternatives.push({
      state: bestState,
      score: best,
      setup: bestSetup,
      ahead: bestAhead,
      step: bestNode,
    })
  }

  const chain: Step[] = []
  for (let step: Step | null = bestNode; step; step = step.previous) chain.unshift(step)
  return {
    score: best,
    line: chain.map((step) => step.action),
    steps: chain.map((step) => describeStep(step.before, step.after, step.action)),
    summaries: chain.map((step) => summarizeStep(step.before, step.after, step.action)),
    frames: chain.map((step) => step.after),
    finalState: bestState,
    nodes,
    exhausted,
    alternatives,
  }
}

/** Does `a` rank above `b` as a board to end the turn on? */
export function outranks(
  a: Pick<Alternative, 'score' | 'setup' | 'ahead'>,
  b: Pick<Alternative, 'score' | 'setup' | 'ahead'>,
): boolean {
  const as = a.ahead ?? a.score
  const bs = b.ahead ?? b.score
  if (as.strict !== bs.strict) return as.strict
  if (as.tier !== bs.tier) return as.tier > bs.tier
  if (as.closeness !== bs.closeness) return as.closeness > bs.closeness
  return a.setup > b.setup
}
