import { norm } from '../normalize'
import type { DeckCard } from '../types'
import {
  abilityAvailable,
  abilityOf,
  drawsWhileActive,
  engineBenches,
  onBenchPlay,
  onEvolve,
  useAbility,
} from './abilities'
import { attack, attackAvailable, attackOf, costPaid } from './attacks'
import {
  attachTriggers,
  lookupEffect,
  onAttachFromHand,
  retreatStuck,
  worthSwitching,
  type EffectContext,
} from './effects'
import {
  allInPlay,
  ACTIVE_TARGET,
  benchCap,
  nameOf,
  cloneState,
  energyFits,
  energyType,
  evolveSlot,
  freesRetreat,
  inPlay,
  isEvolutionCard,
  isBasicPokemon,
  isEnergy,
  isItem,
  isStadium,
  isSupporter,
  isTool,
  mayEvolve,
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
  | { kind: 'useAbility'; target: number }
  | { kind: 'evolve'; handIndex: number; target: number }
  | { kind: 'attack' }
  | { kind: 'retreat'; benchIndex: number }
  | { kind: 'end' }

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
const stadiumWorthPlaying = (card: DeckCard, ctx: ActionContext, state: SimState): boolean =>
  ctx.relevant.has(card.key) ||
  (ctx.wantsAnyBench && nameOf(card) === AREA_ZERO) ||
  // Forest of Vitality only matters from turn 2, and only for a goal that
  // wants a Grass Pokémon evolved.
  (nameOf(card) === FOREST && (state.turn ?? 1) >= 2 && ctx.wantsGrassEvolution === true)

const FOREST = norm('Forest of Vitality')

/**
 * Is benching this Pokémon worth a bench slot?
 *
 * Bench space is a resource: a Pokémon benched for nothing is a slot the deck
 * cannot use later, and in the line of play it reads as a mistake. So a Basic
 * is only benched when the goal wants it (by name, or any body for a bench
 * count), or when a play needs it there to continue — a draw engine and its
 * partner, or a Pokémon whose Ability can switch the goal's Active in.
 */
function benchWorthwhile(state: SimState, ctx: ActionContext): (card: DeckCard) => boolean {
  const forEngine = engineBenches(state)
  const room = benchRoom(state, ctx)
  return (card) => {
    // Any body will do for a bench count.
    if (ctx.wantsAnyBench) return true
    // A Pokémon of a line the goal still needs fills a slot it asked for.
    const line = ctx.goalLines?.find((l) => l.keys.has(card.key))
    if (line) {
      if (countInPlay(state, line.keys) < line.needed) return true
    } else if (ctx.handOnly?.has(card.key)) {
      // Wanted in hand: benching it would undo that. Only a bench count
      // (handled above) can still call for it.
      return false
    } else if (ctx.relevant.has(card.key)) {
      return true
    }
    // Anything else — a third Ogerpon, an engine, a spare — only into a slot
    // the goal does not need: bench space is a resource, and one filled now
    // can leave no room for the Pokémon the board is built around.
    if (room.spare <= 0) return false
    return (
      line !== undefined ||
      forEngine(card) ||
      // Looking past this turn, a Basic that evolves into a draw engine is a
      // play in progress (Dunsparce, N's Zorua).
      (ctx.multiTurn === true && ctx.drawEvolutionBases?.has(nameOf(card)) === true) ||
      (ctx.activeKey !== null && abilityOf(card)?.switchesActive === true) ||
      // Looking past this turn, a Pokémon that draws from the Active Spot,
      // benched ready to be promoted (Mega Kangaskhan ex).
      (ctx.multiTurn === true && drawsWhileActive(card)) ||
      // Latias ex, to make a retreat the Active cannot pay for free.
      (freesRetreat(card) && retreatStuck(state, ctx)) ||
      // When Energy counts on any Pokémon (a total-Energy condition), each
      // accelerator is more Energy: a second Teal Mask Ogerpon ex dances too.
      (ctx.wantsEnergy && ctx.energyTargets.size === 0 && abilityOf(card)?.accelerates === true) ||
      // A Pokémon whose attack searches the deck, ready to step up.
      attackOf(card) !== undefined
    )
  }
}

/** How many of these cards are in play. */
const countInPlay = (state: SimState, keys: Set<string>): number =>
  allInPlay(state).filter((slot) => keys.has(slot.card.key)).length

/**
 * Bench slots left over once every Pokémon the goal still needs has a place.
 *
 * The goal's lines that are not yet in play each claim a slot (the Active's
 * line too, since it often starts on the Bench); what remains is free for
 * anything else.
 */
function benchRoom(state: SimState, ctx: ActionContext): { spare: number } {
  const free = benchCap(state) - state.bench.length
  let claimed = 0
  for (const line of ctx.goalLines ?? []) {
    claimed += Math.max(0, line.needed - countInPlay(state, line.keys))
  }
  return { spare: free - claimed }
}

/** Does this Energy's attach trigger depend on which Pokémon it goes on? */
const isPokemonSpecific = (card: DeckCard): boolean => nameOf(card) === norm('Telepathic Psychic Energy')

/** Is the Active's searching attack usable but for its Energy cost? */
function attackNeedsEnergy(state: SimState): boolean {
  const active = state.active
  if (!active || state.attacked || state.cannotAttack) return false
  const found = attackOf(active.card)
  return found !== undefined && !costPaid(found.cost, active)
}

/**
 * Does the Active still need Energy to retreat into the goal's Active? Only
 * then is Energy worth putting on a Pokémon the goal never mentioned.
 */
function needsRetreatEnergy(state: SimState, ctx: ActionContext): boolean {
  const active = state.active
  if (!active || state.usedRetreat) return false
  const into = state.bench.filter((slot) => worthSwitching(state, slot.card, ctx))
  // Without a goal Active, only promoting a drawer (Mega Kangaskhan ex) counts.
  if (ctx.activeKey === null && !into.some((slot) => drawsWhileActive(slot.card))) return false
  if (into.length === 0) return false
  return active.energy.length < retreatCost(state, active)
}

/**
 * Every play available right now.
 *
 * Nothing evolves on a player's first turn. From turn 2 a Pokémon in play since
 * an earlier turn may evolve (see `mayEvolve`), and Rare Candy works too.
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

  // An attack ends the turn; nothing can follow it.
  if (state.attacked) return [{ kind: 'end' }]

  const seenBench = new Set<string>()
  const room = benchCap(state) - state.bench.length
  const worthBenching = benchWorthwhile(state, ctx)
  state.hand.forEach((card, handIndex) => {
    // Copies of a card are interchangeable, so only the first is branched on.
    if (room > 0 && isBasicPokemon(card) && !seenBench.has(card.key) && worthBenching(card)) {
      seenBench.add(card.key)
      actions.push({ kind: 'bench', handIndex })
    }
  })

  // Abilities are free and capped at once per turn, so they are offered
  // wherever they are usable. The only one worth pruning is a switch, which
  // cannot help a goal that does not name an Active.
  for (const target of targets(state)) {
    if (!abilityAvailable(state, target)) continue
    const def = abilityOf(slotAt(state, target)!.card)!
    if (def.switchesActive && ctx.activeKey === null) continue
    actions.push({ kind: 'useAbility', target })
  }

  // This is the once-per-turn manual attachment only. Spending it on a
  // Pokémon the goal never asked Energy for cannot bring the board closer, and
  // it is the single biggest source of pointless branching — except to pay a
  // retreat, since Energy on the current Active is what lets it step aside for
  // the Pokémon the goal wants there, whatever its type.
  //
  // Attachments on top of this one are not limited here: Teal Dance attaches to
  // Ogerpon itself and Crispin to any Pokémon, because that Energy can still be
  // carried to where the goal wants it by Energy Switch.
  const payingRetreat = needsRetreatEnergy(state, ctx)
  const searchesOnAttach = state.hand.some(
    (card) =>
      isEnergy(card) &&
      targets(state).some((t) => attachTriggers(state, card, slotAt(state, t)!.card, ctx)),
  )
  if (
    !state.usedEnergy &&
    (ctx.wantsEnergy || payingRetreat || attackNeedsEnergy(state) || searchesOnAttach)
  ) {
    const seenEnergy = new Set<string>()
    state.hand.forEach((card, handIndex) => {
      if (!isEnergy(card) || seenEnergy.has(card.key)) return
      seenEnergy.add(card.key)
      const rightType = energyFits(card, ctx.energyTypes)
      // Two benched Pokémon that are the same card carrying the same Energy
      // give the same board either way, so only one is tried.
      const seenSlot = new Set<string>()
      // Energy already offered somewhere just for a trigger that ignores where.
      const anywhere = new Set<string>()
      for (const target of targets(state)) {
        const slot = slotAt(state, target)!
        const same = `${target === ACTIVE_TARGET ? 'A' : 'B'}${slot.card.key}+${slot.energy.length}`
        if (seenSlot.has(same)) continue
        seenSlot.add(same)
        // Onto the Pokémon the goal wants Energy on, when it named any.
        const forGoal =
          ctx.wantsEnergy &&
          rightType &&
          (ctx.energyTargets.size === 0 || ctx.energyTargets.has(slot.card.key))
        const forRetreat = payingRetreat && target === ACTIVE_TARGET
        // Or onto an Active whose searching attack still needs it paid.
        const forAttack = target === ACTIVE_TARGET && attackNeedsEnergy(state)
        // Or wherever the attachment itself does something: Telepathic Psychic
        // Energy on a Psychic Pokémon benches Basic Psychic Pokémon; Enriching
        // Energy draws 4 on any. When that is the only reason, one Pokémon is
        // offered for an Energy whose trigger does not care which.
        let forTrigger = attachTriggers(state, card, slot.card, ctx)
        if (forTrigger && !(forGoal || forRetreat || forAttack) && anywhere.has(card.key)) {
          forTrigger = false
        }
        if (forTrigger && !isPokemonSpecific(card)) anywhere.add(card.key)
        if (forGoal || forRetreat || forAttack || forTrigger) {
          actions.push({ kind: 'attachEnergy', handIndex, target })
        }
      }
    })
  }

  // Evolving is worth it into a card the goal names, or one on the way to it
  // (the goal's lineage is already folded into `relevant`), or into a Pokémon
  // whose Ability draws, which is how a deck digs for the rest.
  const seenEvolve = new Set<string>()
  state.hand.forEach((card, handIndex) => {
    if (!isEvolutionCard(card)) return
    const def = abilityOf(card)
    // An Energy accelerator, too, when the goal wants Energy.
    if (!ctx.relevant.has(card.key) && !def?.draws && !(ctx.wantsEnergy && def?.accelerates)) return
    for (const target of targets(state)) {
      const slot = slotAt(state, target)!
      const key = `${card.key}>${slot.card.key}${slot.fresh ? '*' : ''}`
      if (seenEvolve.has(key) || !mayEvolve(state, slot, card)) continue
      seenEvolve.add(key)
      actions.push({ kind: 'evolve', handIndex, target })
    }
  })

  const seenTool = new Set<string>()
  state.hand.forEach((card, handIndex) => {
    if (!isTool(card) || seenTool.has(card.key)) return
    // A Tool is only worth attaching if the goal asked for it, or if it frees a
    // retreat the goal needs.
    const freesRetreat = ctx.activeKey !== null && nameOf(card) === norm('Air Balloon')
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
    } else if (isStadium(card) && !state.usedStadium && stadiumWorthPlaying(card, ctx, state)) {
      // A Stadium with the same name as the one already out cannot be played.
      const sameName = state.stadium !== null && nameOf(state.stadium) === nameOf(card)
      if (!sameName) {
        seenPlay.add(card.key)
        actions.push({ kind: 'playStadium', handIndex })
      }
    }
  })

  // Retreating only changes which Pokémon is Active, so it is only worth it
  // into one further along the goal Active's evolution line.
  if (!state.usedRetreat && state.bench.length > 0 && state.active) {
    const cost = retreatCost(state, state.active)
    if (state.active.energy.length >= cost) {
      const seenTarget = new Set<string>()
      state.bench.forEach((slot, benchIndex) => {
        if (seenTarget.has(slot.card.key) || !worthSwitching(state, slot.card, ctx)) return
        seenTarget.add(slot.card.key)
        actions.push({ kind: 'retreat', benchIndex })
      })
    }
  }

  // An attack that searches the deck builds the board; it ends the turn, so it
  // is ordered last among the plays.
  if (attackAvailable(state)) actions.push({ kind: 'attack' })

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
      // Meowth ex and Iron Leaves ex trigger as they arrive, so benching can
      // lead to several boards.
      return onBenchPlay(next, next.bench.length - 1, ctx)
    }

    case 'useAbility':
      return useAbility(state, action.target, ctx)

    case 'attack':
      return attack(state, ctx)

    case 'evolve': {
      const { card, next } = take(state, action.handIndex)
      if (action.target === ACTIVE_TARGET) next.active = evolveSlot(next.active!, card)
      else next.bench[action.target] = evolveSlot(next.bench[action.target], card)
      // Psychic Draw fires as the Pokémon is played to evolve.
      return onEvolve(next, action.target, ctx)
    }

    case 'attachEnergy': {
      const { card, next } = take(state, action.handIndex)
      const slot = action.target === ACTIVE_TARGET ? next.active! : next.bench[action.target]
      slot.energy.push(card)
      next.usedEnergy = true
      // Some Energy does something as it is attached from hand.
      return onAttachFromHand(next, card, slot.card, ctx)
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
      // A card whose effect changed nothing was spent for nothing; that is not
      // a play, so it leads nowhere.
      return effect ? effect(base, ctx).filter((next) => next !== base) : []
    }

    case 'retreat': {
      const next = cloneState(state)
      const active = next.active!
      const cost = retreatCost(state, active)
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

export { ACTIVE_TARGET, energyType }
