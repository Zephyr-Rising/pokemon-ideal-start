import type { FieldGoal } from '../board/goal'
import { norm } from '../normalize'
import type { DeckCard } from '../types'
import { abilityOf } from './abilities'
import { nameOf } from './state'
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
 *
 * The one exception is a draw engine, which reaches the goal indirectly. That
 * depends on what is already on the board, so it is worked out per state by
 * `engineWants` in `abilities.ts` rather than fixed here.
 */
export function buildContext(
  goal: FieldGoal,
  rng: () => number,
  seed = 1,
  cards: DeckCard[] = [],
): ActionContext {
  const relevant = new Set<string>()
  if (goal.active) relevant.add(goal.active.cardKey)
  for (const slot of goal.bench) relevant.add(slot.cardKey)
  if (goal.stadiumKey) relevant.add(goal.stadiumKey)
  for (const want of goal.inHand) relevant.add(want.cardKey)

  // A goal Pokémon that evolves is reached through its earlier stages, so they
  // matter too: Dragapult ex on the board makes Dreepy and Drakloak worth
  // benching, fetching and evolving.
  const prevOf = new Map<string, string>()
  for (const card of cards) {
    if (card.card?.prev) prevOf.set(nameOf(card), norm(card.card.prev))
  }
  const byName = new Map<string, DeckCard[]>()
  for (const card of cards) {
    const name = nameOf(card)
    byName.set(name, [...(byName.get(name) ?? []), card])
  }
  // Basics that grow into a draw engine — worth benching when the game runs
  // long enough for them to evolve.
  const drawEvolutionBases = new Set<string>()
  const wantsAnyEnergy = [...(goal.active ? [goal.active] : []), ...goal.bench].some(
    (slot) => slot.energy.length > 0,
  )
  for (const card of cards) {
    const def = abilityOf(card)
    // Draw engines, and Energy accelerators when the goal wants Energy.
    if (!card.card?.prev || !(def?.draws || (wantsAnyEnergy && def?.accelerates))) continue
    let base: string | undefined = norm(card.card.prev)
    for (let depth = 0; base && prevOf.has(base) && depth < 2; depth++) base = prevOf.get(base)
    if (base) drawEvolutionBases.add(base)
  }

  // The goal's Active and its earlier stages, by how many evolutions short of
  // it each is: 0 for the card itself. Retreating only ever moves along this.
  const activeLineage = new Map<string, number>()
  if (goal.active) {
    activeLineage.set(goal.active.cardKey, 0)
    const top = cards.find((c) => c.key === goal.active!.cardKey)
    let prev = top?.card?.prev ? norm(top.card.prev) : null
    for (let steps = 1; prev && steps <= 2; steps++) {
      for (const earlier of byName.get(prev) ?? []) activeLineage.set(earlier.key, steps)
      prev = prevOf.get(prev) ?? null
    }
  }

  // Each Pokémon the goal places, grouped by evolution line: the line's cards
  // (the goal card and its earlier stages) and how many of it the goal wants.
  // Two Ogerpon slots are one line wanting two.
  const lineOfKey = (key: string): Set<string> => {
    const line = new Set([key])
    const top = cards.find((c) => c.key === key)
    let prev = top?.card?.prev ? norm(top.card.prev) : null
    for (let depth = 0; prev && depth < 2; depth++) {
      for (const earlier of byName.get(prev) ?? []) line.add(earlier.key)
      prev = prevOf.get(prev) ?? null
    }
    return line
  }
  const goalLines = new Map<string, { keys: Set<string>; needed: number }>()
  for (const slot of [...(goal.active ? [goal.active] : []), ...goal.bench]) {
    const entry = goalLines.get(slot.cardKey) ?? { keys: lineOfKey(slot.cardKey), needed: 0 }
    entry.needed++
    goalLines.set(slot.cardKey, entry)
  }

  let wantsGrassEvolution = false
  for (const key of [...relevant]) {
    const card = cards.find((c) => c.key === key)
    if (!card) continue
    if (card.card?.prev && (card.card.type ?? '').includes('{G}')) wantsGrassEvolution = true
    let prev = card.card?.prev ? norm(card.card.prev) : null
    // Bounded, in case a malformed chain ever loops.
    for (let depth = 0; prev && depth < 3; depth++) {
      for (const earlier of byName.get(prev) ?? []) relevant.add(earlier.key)
      prev = prevOf.get(prev) ?? null
    }
  }

  const energySlots = [...(goal.active ? [goal.active] : []), ...goal.bench].filter(
    (slot) => slot.energy.length > 0,
  )
  // Any slot happy with any type means any Energy can help, so the type
  // filter is lifted entirely rather than narrowed.
  const needs = energySlots.flatMap((slot) => slot.energy)
  const energyTypes = new Set<string>(
    needs.includes(null) ? [] : needs.filter((type): type is string => type !== null),
  )

  // Which Pokémon the goal wants Energy on. Attaching anywhere else cannot
  // bring the board closer this turn, so those plays are never generated.
  const energyTargets = new Set(energySlots.map((slot) => slot.cardKey))
  // ...and their earlier stages, since Energy stays attached through
  // evolution: Psychic for a Dragapult ex belongs on the Dreepy that becomes
  // it. Kept apart from the search's targets on purpose — within a turn,
  // attaching after evolving lands on the same Pokémon, so trying the earlier
  // stage too only doubles the search. The end-of-turn attachment uses these.
  const energyLineage = new Set(energyTargets)
  for (const key of energyTargets) {
    const card = cards.find((c) => c.key === key)
    let prev = card?.card?.prev ? norm(card.card.prev) : null
    for (let depth = 0; prev && depth < 2; depth++) {
      for (const earlier of byName.get(prev) ?? []) energyLineage.add(earlier.key)
      prev = prevOf.get(prev) ?? null
    }
  }

  return {
    relevant,
    wantsAnyBench: goal.benchMin > 0,
    wantsEnergy: energySlots.length > 0,
    // Empty means "any type will do".
    energyTypes,
    energyTargets,
    energyLineage,
    activeKey: goal.active?.cardKey ?? null,
    prevOf,
    activeLineage,
    goalLines: [...goalLines.values()],
    wantsGrassEvolution,
    drawEvolutionBases,
    rng,
    seed,
  }
}
