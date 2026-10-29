import { norm } from '../normalize'
import type { DeckCard } from '../types'
import { lookupEffect, type EffectContext } from './effects'
import {
  benchCap,
  cardName,
  cloneState,
  energyType,
  inPlay,
  isBasicPokemon,
  isEnergy,
  isItem,
  isStadium,
  isSupporter,
  isTool,
  retreatCost,
  type SimState,
} from './state'

/**
 * A legal turn-1 play.
 *
 * `placeActive` is the pre-game placement; everything else happens during the
 * turn. Benching during setup and benching during the turn put the same card in
 * the same place from the same hand, so they are modelled as one action rather
 * than two phases.
 */
export type Action =
  | { kind: 'placeActive'; handIndex: number }
  | { kind: 'bench'; handIndex: number }
  | { kind: 'attachEnergy'; handIndex: number; target: number }
  | { kind: 'attachTool'; handIndex: number; target: number }
  | { kind: 'playItem'; handIndex: number }
  | { kind: 'playSupporter'; handIndex: number }
  | { kind: 'playStadium'; handIndex: number }
  | { kind: 'retreat'; benchIndex: number }
  | { kind: 'end' }

/** Target index convention: -1 is the Active, 0+ indexes the bench. */
export const ACTIVE_TARGET = -1

export interface ActionContext extends EffectContext {
  /** Card keys the goal mentions — used to bound effect choices. */
  relevant: Set<string>
  /** The goal wants more bench bodies, whichever they are. */
  wantsAnyBench: boolean
}

const targets = (state: SimState): number[] => [
  ...(state.active ? [ACTIVE_TARGET] : []),
  ...state.bench.map((_, i) => i),
]

const slotAt = (state: SimState, target: number) =>
  target === ACTIVE_TARGET ? state.active : state.bench[target]

const AREA_ZERO = norm('Area Zero Underdepths')

/**
 * A Stadium is worth playing only if the goal asked for it, or if it is Area
 * Zero Underdepths and the goal wants a bench bigger than five.
 */
const stadiumWorthPlaying = (card: DeckCard, ctx: ActionContext): boolean =>
  ctx.relevant.has(card.key) || (ctx.wantsAnyBench && norm(cardName(card)) === AREA_ZERO)

/**
 * Every play available right now.
 *
 * Nothing evolves: each Pokémon in play was put there this turn, so evolution
 * cards (and Rare Candy) are simply not playable on turn 1 and never appear.
 */
export function legalActions(state: SimState, ctx: ActionContext): Action[] {
  const actions: Action[] = []

  // Pre-game: a Basic must take the Active Spot before anything else.
  if (!state.active) {
    const seen = new Set<string>()
    state.hand.forEach((card, handIndex) => {
      if (!isBasicPokemon(card) || seen.has(card.key)) return
      seen.add(card.key)
      actions.push({ kind: 'placeActive', handIndex })
    })
    return actions
  }

  const seenBench = new Set<string>()
  const room = benchCap(state) - state.bench.length
  state.hand.forEach((card, handIndex) => {
    // Copies of a card are interchangeable, so only the first is branched on.
    if (room > 0 && isBasicPokemon(card) && !seenBench.has(card.key)) {
      seenBench.add(card.key)
      actions.push({ kind: 'bench', handIndex })
    }
  })

  // Attaching Energy the goal never asked for cannot bring the board closer,
  // and it is the single biggest source of pointless branching.
  if (!state.usedEnergy && ctx.wantsEnergy) {
    const seenEnergy = new Set<string>()
    state.hand.forEach((card, handIndex) => {
      if (!isEnergy(card) || seenEnergy.has(card.key)) return
      if (ctx.energyTypes.size > 0 && !ctx.energyTypes.has(energyType(card))) return
      seenEnergy.add(card.key)
      for (const target of targets(state)) {
        const slot = slotAt(state, target)!
        // Only onto the Pokémon the goal wants Energy on, when it named any.
        if (ctx.energyTargets.size > 0 && !ctx.energyTargets.has(slot.card.key)) continue
        actions.push({ kind: 'attachEnergy', handIndex, target })
      }
    })
  }

  const seenTool = new Set<string>()
  state.hand.forEach((card, handIndex) => {
    if (!isTool(card) || seenTool.has(card.key)) return
    // A Tool is only worth attaching if the goal asked for it, or if it frees a
    // retreat the goal needs.
    const freesRetreat = ctx.activeKey !== null && norm(cardName(card)) === norm('Air Balloon')
    if (!ctx.relevant.has(card.key) && !freesRetreat) return
    seenTool.add(card.key)
    for (const target of targets(state)) {
      // One Tool per Pokémon.
      if (slotAt(state, target)!.tools.length === 0) {
        actions.push({ kind: 'attachTool', handIndex, target })
      }
    }
  })

  const seenPlay = new Set<string>()
  state.hand.forEach((card, handIndex) => {
    if (seenPlay.has(card.key)) return
    const effect = lookupEffect(card)
    // An unimplemented Trainer does nothing, so playing it can only lose a
    // card. It is left out rather than offered as a pointless move.
    if (isItem(card) && effect) {
      seenPlay.add(card.key)
      actions.push({ kind: 'playItem', handIndex })
    } else if (isSupporter(card) && effect && !state.usedSupporter) {
      seenPlay.add(card.key)
      actions.push({ kind: 'playSupporter', handIndex })
    } else if (isStadium(card) && !state.usedStadium && stadiumWorthPlaying(card, ctx)) {
      // A Stadium with the same name as the one already out cannot be played.
      const sameName = state.stadium !== null && norm(cardName(state.stadium)) === norm(cardName(card))
      if (!sameName) {
        seenPlay.add(card.key)
        actions.push({ kind: 'playStadium', handIndex })
      }
    }
  })

  // Retreating only changes which Pokémon is Active, so it is pointless unless
  // the goal names one.
  if (ctx.activeKey !== null && !state.usedRetreat && state.bench.length > 0 && state.active) {
    const cost = retreatCost(state.active)
    if (state.active.energy.length >= cost) {
      const seenTarget = new Set<string>()
      state.bench.forEach((slot, benchIndex) => {
        if (seenTarget.has(slot.card.key)) return
        seenTarget.add(slot.card.key)
        actions.push({ kind: 'retreat', benchIndex })
      })
    }
  }

  actions.push({ kind: 'end' })
  return actions
}

const take = (state: SimState, handIndex: number) => {
  const card = state.hand[handIndex]
  const next = cloneState(state)
  next.hand.splice(handIndex, 1)
  return { card, next }
}

/**
 * Apply an action, returning every state it can lead to.
 *
 * Most plays have exactly one outcome. Card effects that involve a choice —
 * which Pokémon Ultra Ball fetches, which cards it discards — return several,
 * and the search explores them.
 */
export function applyAction(state: SimState, action: Action, ctx: ActionContext): SimState[] {
  switch (action.kind) {
    case 'placeActive': {
      const { card, next } = take(state, action.handIndex)
      next.active = inPlay(card)
      return [next]
    }

    case 'bench': {
      const { card, next } = take(state, action.handIndex)
      next.bench.push(inPlay(card))
      return [next]
    }

    case 'attachEnergy': {
      const { card, next } = take(state, action.handIndex)
      const slot = action.target === ACTIVE_TARGET ? next.active! : next.bench[action.target]
      slot.energy.push(card)
      next.usedEnergy = true
      return [next]
    }

    case 'attachTool': {
      const { card, next } = take(state, action.handIndex)
      const slot = action.target === ACTIVE_TARGET ? next.active! : next.bench[action.target]
      slot.tools.push(card)
      return [next]
    }

    case 'playStadium': {
      const { card, next } = take(state, action.handIndex)
      // The stadium it replaces goes to the discard.
      if (next.stadium) next.discard.push(next.stadium)
      next.stadium = card
      next.usedStadium = true
      return [next]
    }

    case 'playItem':
    case 'playSupporter': {
      const card = state.hand[action.handIndex]
      const effect = lookupEffect(card)
      const base = cloneState(state)
      base.hand.splice(action.handIndex, 1)
      base.discard.push(card)
      if (action.kind === 'playSupporter') base.usedSupporter = true
      return effect ? effect(base, ctx) : [base]
    }

    case 'retreat': {
      const next = cloneState(state)
      const active = next.active!
      const cost = retreatCost(active)
      // Paying the cost discards that much Energy from the retreating Pokémon.
      for (let i = 0; i < cost; i++) {
        const paid = active.energy.pop()
        if (paid) next.discard.push(paid)
      }
      next.active = next.bench[action.benchIndex]
      next.bench[action.benchIndex] = active
      next.usedRetreat = true
      return [next]
    }

    case 'end':
      return [state]
  }
}

/** Draw `count` cards off the top. Running out simply draws fewer. */
export function draw(state: SimState, count: number): SimState {
  const next = cloneState(state)
  const taken = next.deck.splice(0, count)
  next.hand.push(...taken)
  return next
}

export { energyType }
