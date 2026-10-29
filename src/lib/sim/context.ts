import type { FieldGoal } from '../board/goal'
import type { ActionContext } from './actions'

/**
 * What the goal cares about, so effect choices can be narrowed.
 *
 * A search card could fetch any of sixty cards, which would make the tree
 * unusable. Fetching something the goal neither names nor needs cannot bring
 * the board closer, so the candidates are limited to cards the goal actually
 * asked for, plus Basics when it only wants more bodies and Energy when it
 * wants Energy. That keeps the branching small without losing any line that
 * could have reached the goal.
 */
export function buildContext(goal: FieldGoal, rng: () => number, seed = 1): ActionContext {
  const relevant = new Set<string>()
  if (goal.active) relevant.add(goal.active.cardKey)
  for (const slot of goal.bench) relevant.add(slot.cardKey)
  if (goal.stadiumKey) relevant.add(goal.stadiumKey)
  for (const want of goal.inHand) relevant.add(want.cardKey)

  const energySlots = [...(goal.active ? [goal.active] : []), ...goal.bench].filter(
    (slot) => slot.energy > 0,
  )
  const energyTypes = new Set<string>()
  for (const slot of energySlots) {
    if (slot.energyType) energyTypes.add(slot.energyType)
  }

  // Which Pokémon the goal wants Energy on. Attaching anywhere else cannot
  // bring the board closer, so those plays are never generated.
  const energyTargets = new Set(energySlots.map((slot) => slot.cardKey))

  return {
    relevant,
    wantsAnyBench: goal.benchMin > 0,
    wantsEnergy: energySlots.length > 0,
    // Empty means "any type will do".
    energyTypes,
    energyTargets,
    activeKey: goal.active?.cardKey ?? null,
    rng,
    seed,
  }
}
