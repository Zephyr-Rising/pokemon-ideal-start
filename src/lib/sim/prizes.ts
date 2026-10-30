import { acceptedKeys, type FieldGoal, type Priority } from '../board/goal'
import { norm } from '../normalize'
import type { DeckCard } from '../types'
import { energyFits, nameOf } from './state'

/**
 * Is the board impossible before a card is played, because something it needs
 * is in the prizes?
 *
 * Prize cards are set aside for the whole game here (nothing takes them), so a
 * board that needs more copies of a card than the deck has outside its prizes
 * can never be built, however well the game is played. Checking that up front
 * reports those games for what they are, and skips searching games that can
 * only ever miss — the most expensive kind, since they never finish early.
 */

/** One thing the board needs, and how many copies of it. */
interface Requirement {
  /** How it reads in the results: a card name, or e.g. "Grass Energy". */
  label: string
  needed: number
  /** Which cards satisfy it. */
  matches: (card: DeckCard) => boolean
  /**
   * A Stage 1 a Stage 2 goal can skip with Rare Candy: a shortfall here can be
   * made up by Rare Candy outside the prizes.
   */
  candySkippable?: boolean
}

const RARE_CANDY = norm('Rare Candy')

const ENERGY_NAMES: Record<string, string> = {
  '{G}': 'Grass',
  '{R}': 'Fire',
  '{W}': 'Water',
  '{L}': 'Lightning',
  '{P}': 'Psychic',
  '{F}': 'Fighting',
  '{D}': 'Darkness',
  '{M}': 'Metal',
}

/** Everything the board needs, worked out once per run. */
export function boardRequirements(
  goal: FieldGoal,
  cards: DeckCard[],
  labelFor: (cardKey: string) => string,
  /** Only the parts at this priority or more important (1 is essential). */
  upTo: Priority = 3,
): Requirement[] {
  const counts = (partId: string) => (goal.priorities?.[partId] ?? 1) <= upTo
  const byKey = new Map(cards.map((card) => [card.key, card]))
  const requirements = new Map<string, Requirement>()
  const need = (id: string, make: () => Omit<Requirement, 'needed'>, count = 1) => {
    const existing = requirements.get(id)
    if (existing) existing.needed += count
    else requirements.set(id, { ...make(), needed: count })
  }

  const slots = [...(goal.active ? [goal.active] : []), ...goal.bench]
  for (const slot of slots) {
    if (!counts(`${slot.id}:card`)) continue
    // With alternatives, any of them will do. Only the cards themselves are
    // checked, not each one's earlier stages: that can miss an impossible
    // game, but never calls a possible one impossible.
    if (slot.alternatives?.length) {
      const accepted = acceptedKeys(slot.cardKey, slot.alternatives)
      need(`either:${[...accepted].sort().join('|')}`, () => ({
        label: accepted.map(labelFor).join(' or '),
        matches: (card) => accepted.includes(card.key),
      }))
      continue
    }
    // The goal card itself, by its exact printing — that is what is scored.
    need(`card:${slot.cardKey}`, () => ({
      label: labelFor(slot.cardKey),
      matches: (card) => card.key === slot.cardKey,
    }))
    // Its earlier stages, by name: any printing evolves the same way.
    const top = byKey.get(slot.cardKey)
    const stage2 = top?.tags.includes('stage2') ?? false
    let prev = top?.card?.prev ? norm(top.card.prev) : null
    for (let depth = 0; prev && depth < 2; depth++) {
      const name = prev
      const label = cards.find((card) => nameOf(card) === name)?.label ?? name
      need(`name:${name}`, () => ({
        label,
        matches: (card) => nameOf(card) === name,
        // Rare Candy skips the Stage 1 (the first step back from a Stage 2).
        candySkippable: stage2 && depth === 0,
      }))
      const earlier = cards.find((card) => nameOf(card) === name)
      prev = earlier?.card?.prev ? norm(earlier.card.prev) : null
    }
  }
  for (const slot of slots) {
    if (!counts(`${slot.id}:energy`)) continue
    for (const kind of slot.energy) {
      if (kind === null) continue
      const special = byKey.get(kind)
      need(`energy:${kind}`, () => ({
        label: special ? special.label : `${ENERGY_NAMES[kind] ?? kind} Energy`,
        // A Special Energy that provides the type counts too.
        matches: (card) => card.tags.includes('energy') && energyFits(card, new Set([kind])),
      }))
    }
  }
  for (const slot of slots) {
    for (const toolKey of slot.tools) {
      if (!counts(`${slot.id}:tool:${toolKey}`)) continue
      need(`card:${toolKey}`, () => ({
        label: labelFor(toolKey),
        matches: (card) => card.key === toolKey,
      }))
    }
  }

  // All the Energy the board asks for, of any kind.
  const totalEnergy = slots
    .filter((slot) => counts(`${slot.id}:energy`))
    .reduce((sum, slot) => sum + slot.energy.length, 0)
  if (totalEnergy > 0) {
    need('energy:total', () => ({ label: 'Energy', matches: (card) => card.tags.includes('energy') }), totalEnergy)
  }
  if (goal.stadiumKey && counts('stadium')) {
    const accepted = acceptedKeys(goal.stadiumKey, goal.stadiumAlternatives)
    need(`either:${[...accepted].sort().join('|')}`, () => ({
      label: accepted.map(labelFor).join(' or '),
      matches: (card) => accepted.includes(card.key),
    }))
  }
  for (const want of goal.inHand) {
    if (!counts(`${want.id}:hand`)) continue
    const accepted = acceptedKeys(want.cardKey, want.alternatives)
    need(
      `either:${[...accepted].sort().join('|')}`,
      () => ({
        label: accepted.map(labelFor).join(' or '),
        matches: (card) => accepted.includes(card.key),
      }),
      want.count,
    )
  }
  return [...requirements.values()]
}

/**
 * The requirements these prizes make impossible, by label; empty when the
 * board can still be built. `deck` is every physical card, prizes included.
 */
export function prizeLocks(requirements: Requirement[], deck: DeckCard[], prizes: DeckCard[]): string[] {
  const outside = (matches: (card: DeckCard) => boolean) =>
    deck.filter(matches).length - prizes.filter(matches).length
  let candy = outside((card) => nameOf(card) === RARE_CANDY)
  const locked: string[] = []
  for (const requirement of requirements) {
    const short = requirement.needed - outside(requirement.matches)
    if (short <= 0) continue
    // Rare Candy outside the prizes can stand in for a missing Stage 1.
    if (requirement.candySkippable && candy >= short) {
      candy -= short
      continue
    }
    // Only the prizes can make it impossible; a deck simply too thin to build
    // the board is the board's problem, not this deal's.
    if (deck.filter(requirement.matches).length >= requirement.needed) locked.push(requirement.label)
  }
  return locked
}

/** How often prizes alone made the board impossible, and what was prized. */
export interface PrizeLockStat {
  /** Share of games that could never build the board. */
  rate: number
  games: number
  /** What the prizes took, most often first: share of all games for each. */
  reasons: { label: string; rate: number }[]
}

export class PrizeLockTally {
  games = 0
  private readonly reasons = new Map<string, number>()

  add(labels: string[]): void {
    this.games++
    for (const label of labels) this.reasons.set(label, (this.reasons.get(label) ?? 0) + 1)
  }

  stat(trials: number): PrizeLockStat {
    return {
      rate: trials === 0 ? 0 : this.games / trials,
      games: this.games,
      reasons: [...this.reasons]
        .map(([label, count]) => ({ label, rate: count / trials }))
        .sort((a, b) => b.rate - a.rate),
    }
  }
}
