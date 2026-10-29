import type { DeckCard } from '../types'
import { ACTIVE_TARGET, type Action } from './actions'
import { cardName, energyType, type SimState } from './state'

/**
 * Turn a play into a line of readable text.
 *
 * The description is built by **diffing the state either side of the play**
 * rather than from per-card wording. That way an effect explains itself — Ultra
 * Ball reports what it actually fetched, Poffin what it actually benched —
 * without a second description to keep in step with the effect itself. A card
 * added later is readable the day it is added.
 */

const label = (card: DeckCard): string => card.label || cardName(card)

const countBy = (cards: DeckCard[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const card of cards) counts.set(card.key, (counts.get(card.key) ?? 0) + 1)
  return counts
}

/** Cards in `after` that were not in `before`, as display names. */
function gained(before: DeckCard[], after: DeckCard[]): string[] {
  const had = countBy(before)
  const names: string[] = []
  for (const card of after) {
    const remaining = had.get(card.key) ?? 0
    if (remaining > 0) had.set(card.key, remaining - 1)
    else names.push(label(card))
  }
  return names
}

const list = (names: string[]): string => {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Energy totals per Pokémon, keyed by card. */
function energyByCard(state: SimState): Map<string, number> {
  const totals = new Map<string, number>()
  const slots = state.active ? [state.active, ...state.bench] : state.bench
  for (const slot of slots) {
    totals.set(slot.card.key, (totals.get(slot.card.key) ?? 0) + slot.energy.length)
  }
  return totals
}

/** Pokémon that gained Energy, as display names. */
function energised(before: SimState, after: SimState): string[] {
  const was = energyByCard(before)
  const names: string[] = []
  const slots = after.active ? [after.active, ...after.bench] : after.bench
  const seen = new Set<string>()
  for (const slot of slots) {
    if (seen.has(slot.card.key)) continue
    seen.add(slot.card.key)
    const now = energyByCard(after).get(slot.card.key) ?? 0
    if (now > (was.get(slot.card.key) ?? 0)) names.push(label(slot.card))
  }
  return names
}

/** One step of the line, as the player would describe it. */
export function describeStep(before: SimState, after: SimState, action: Action): string {
  const benched = gained(
    before.bench.map((slot) => slot.card),
    after.bench.map((slot) => slot.card),
  )
  const drawn = gained(before.hand, after.hand)

  switch (action.kind) {
    case 'placeActive':
      return `Start with ${label(after.active!.card)} in the Active Spot`

    case 'bench':
      return `Bench ${benched[0] ?? 'a Pokémon'}`

    case 'attachEnergy': {
      const card = before.hand[action.handIndex]
      const target =
        action.target === ACTIVE_TARGET ? after.active! : after.bench[action.target]
      return `Attach ${label(card)} to ${label(target.card)}`
    }

    case 'attachTool': {
      const card = before.hand[action.handIndex]
      const target =
        action.target === ACTIVE_TARGET ? after.active! : after.bench[action.target]
      return `Attach ${label(card)} to ${label(target.card)}`
    }

    case 'playStadium':
      return `Play ${label(before.hand[action.handIndex])}`

    case 'playItem':
    case 'playSupporter': {
      const card = before.hand[action.handIndex]
      const outcome: string[] = []
      if (benched.length > 0) outcome.push(`benching ${list(benched)}`)

      // A hand refresh replaces the hand wholesale; listing every card drawn
      // would be noise, so report the size instead.
      const refreshed = before.hand.length > 1 && drawn.length >= 4
      if (refreshed) outcome.push(`drawing ${after.hand.length}`)
      else if (drawn.length > 0) outcome.push(`taking ${list(drawn)}`)

      const energyTargets = energised(before, after)
      if (energyTargets.length > 0) outcome.push(`attaching to ${list(energyTargets)}`)

      const discarded = after.discard.length - before.discard.length - 1
      if (discarded > 0) outcome.push(`discarding ${discarded}`)

      return outcome.length > 0
        ? `Play ${label(card)} — ${outcome.join(', ')}`
        : `Play ${label(card)}`
    }

    case 'retreat':
      return `Retreat into ${label(after.active!.card)}`

    case 'end':
      return 'End the turn'
  }
}

/** The Energy a Pokémon ended the turn carrying, for the board summary. */
export const energySummary = (energy: DeckCard[]): string =>
  energy.map((card) => energyType(card) || '●').join(' ')
