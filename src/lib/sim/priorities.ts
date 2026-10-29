import type { Action, ActionContext } from './actions'
import { ACTIVE_TARGET, isBasicPokemon, type SimState } from './state'

/**
 * Move ordering, ported from the AI competition agent.
 *
 * The agent in the competition scored every legal action and simply took the
 * highest. Its code is bound to the Kaggle simulator's API, but the
 * architecture carries over, and `Lesson.md` distils the priorities:
 *
 *   - never end a turn with a bench you could have filled
 *   - do free setup before anything that ends the turn
 *   - play hand-shuffle effects last, after the cards worth keeping are used
 *   - attackers need only one Energy, so spread rather than stack
 *   - a negative score means "never"
 *
 * Here the tiers order the *search* instead of deciding outright, so an unusual
 * line is still found — just explored later. That is the difference between
 * asking "would this agent get there" and "can this hand get there", and the
 * second is the question the tool is answering.
 */

const TIER = {
  placeActive: 10_000,
  bench: 8_000,
  ability: 7_000,
  search: 6_000,
  draw: 5_000,
  energy: 4_000,
  stadium: 3_000,
  tool: 2_000,
  retreat: 1_000,
  handRefresh: 500,
  end: 0,
} as const

/** Bonus for touching a card the goal actually asked for. */
const RELEVANT = 900

const handCard = (state: SimState, action: Action) =>
  'handIndex' in action ? state.hand[action.handIndex] : undefined

export function actionPriority(state: SimState, action: Action, ctx: ActionContext): number {
  const card = handCard(state, action)
  const relevant = card && ctx.relevant.has(card.key) ? RELEVANT : 0

  switch (action.kind) {
    case 'placeActive':
      return TIER.placeActive + relevant

    case 'bench':
      // Filling the bench is the single highest-value setup action, and more so
      // when the goal named this Pokémon or simply wants more bodies.
      return TIER.bench + relevant + (ctx.wantsAnyBench ? 200 : 0)

    case 'useAbility': {
      // An Ability costs nothing and is capped at once per turn, so it is used
      // before spending cards from hand — drawing first makes the rest of the
      // turn better informed. It ranks below benching, because two of them only
      // come online once their partner is on the bench.
      const slot = action.target === ACTIVE_TARGET ? state.active : state.bench[action.target]
      return TIER.ability + (slot && ctx.relevant.has(slot.card.key) ? RELEVANT : 0)
    }

    case 'playItem':
    case 'playSupporter': {
      if (!card) return TIER.end
      // A card that shuffles the hand away is played last, once the cards worth
      // keeping have been used.
      if (card.tags.includes('hand-refresh')) return TIER.handRefresh + relevant
      if (card.tags.includes('poke-search') || card.tags.includes('search-to-hand')) {
        return TIER.search + relevant
      }
      if (card.tags.includes('draw')) return TIER.draw + relevant
      return TIER.draw - 500 + relevant
    }

    case 'attachEnergy': {
      // One Energy on an attacker is what matters; a second on the same
      // Pokémon is worth far less than the first elsewhere.
      const slot = action.target === ACTIVE_TARGET ? state.active : state.bench[action.target]
      const stacking = (slot?.energy.length ?? 0) > 0 ? -600 : 0
      const onGoalCard = slot && ctx.relevant.has(slot.card.key) ? RELEVANT : 0
      return TIER.energy + stacking + onGoalCard
    }

    case 'playStadium':
      return TIER.stadium + relevant

    case 'attachTool':
      return TIER.tool + relevant

    case 'retreat': {
      // Retreating matters when the goal names a specific Active; otherwise it
      // mostly burns Energy.
      const incoming = state.bench[action.benchIndex]
      return TIER.retreat + (incoming && ctx.relevant.has(incoming.card.key) ? RELEVANT : 0)
    }

    case 'end':
      return TIER.end
  }
}

/** Highest priority first; ties keep their generated order so runs are stable. */
export function orderActions(
  state: SimState,
  actions: Action[],
  ctx: ActionContext,
): Action[] {
  return actions
    .map((action, index) => ({ action, index, score: actionPriority(state, action, ctx) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.action)
}

/** Does the hand still hold a Basic that could be benched? Used by the UI copy. */
export const hasBenchableBasic = (state: SimState): boolean => state.hand.some(isBasicPokemon)
