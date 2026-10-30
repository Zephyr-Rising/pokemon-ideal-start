import type { DeckCard } from '../types'
import type { EffectContext } from './effects'
import { hashString, mulberry32, shuffled } from './rng'
import { cloneState, signature, type SimState } from './state'

/**
 * Cards that look at only the top of the deck — Pokégear 3.0, Bug Catching
 * Set, Tatsugiri's Attract Customers — rather than searching all of it.
 *
 * The deck order of a trial is fixed before the search starts, so the top N
 * really is the top N a player would see: these cards can whiff, exactly as
 * they do at the table, and the odds reflect it.
 */

/** The top `count` cards, without removing them. */
export const topOf = (state: SimState, count: number): DeckCard[] => state.deck.slice(0, count)

/** One of each distinct card, since copies are interchangeable. */
export function distinctCards(cards: DeckCard[]): DeckCard[] {
  const seen = new Set<string>()
  return cards.filter((card) => !seen.has(card.key) && seen.add(card.key))
}

/**
 * Put the chosen cards from the top `count` into hand and shuffle the deck.
 *
 * The shuffle is seeded from the trial and the state it happens in, like every
 * other shuffle in the simulator, so a branch resolves the same way each time
 * the search reaches it.
 */
export function takeFromTop(
  state: SimState,
  count: number,
  picks: DeckCard[],
  ctx: EffectContext,
): SimState {
  const next = cloneState(state)
  const top = next.deck.slice(0, count)
  for (const pick of picks) {
    const at = top.findIndex((card) => card.key === pick.key)
    if (at < 0) continue
    next.hand.push(top[at])
    top.splice(at, 1)
  }
  const rng = mulberry32(ctx.seed ^ hashString(signature(state)))
  next.deck = shuffled([...top, ...next.deck.slice(count)], rng)
  return next
}

/**
 * Which Supporter to take from the top of the deck, as distinct choices.
 *
 * One the goal names comes first. Without one, any Supporter is worth taking
 * only while the turn's Supporter is still unplayed — going first, or after one
 * has been played, a Supporter nobody asked for is just a card in hand.
 */
export function supporterChoices(
  state: SimState,
  count: number,
  ctx: EffectContext,
): DeckCard[] {
  const supporters = distinctCards(topOf(state, count).filter((card) => card.tags.includes('supporter')))
  const wanted = supporters.filter((card) => ctx.relevant.has(card.key))
  if (wanted.length > 0) return wanted
  return state.usedSupporter ? [] : supporters
}
