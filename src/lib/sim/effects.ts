import { norm } from '../normalize'
import type { DeckCard } from '../types'
import { abilityOf, engineKeeps, engineWants, onEvolve } from './abilities'
import { attackOf } from './attacks'
import { distinctCards, supporterChoices, takeFromTop, topOf } from './deck-look'
import {
  benchCap,
  cardName,
  nameOf,
  cloneState,
  energyFits,
  energyType,
  evolveSlot,
  fairShuffle,
  inPlay,
  isBasicPokemon,
  isEnergy,
  shufflesAfter,
  type InPlay,
  type SimState,
} from './state'

/**
 * Hand-written card effects, keyed on normalised card name.
 *
 * Only cards that can change your own board on turn 1 are here. Effect text is
 * far too irregular to derive behaviour from automatically, and a silent
 * misread would corrupt the numbers rather than merely omit a card — so an
 * unimplemented card is **inert, never a guess**, and the UI names every one it
 * ignored.
 *
 * Cards that genuinely cannot matter on turn 1 are correctly absent: Unfair
 * Stamp needs one of your Pokémon to have been Knocked Out, Special Red Card
 * needs the opponent down to three Prizes, Rosa's Encouragement needs more
 * Prizes remaining than they have, and Boss's Orders only moves their Pokémon.
 * Ciphermaniac's Codebreaking stacks the top of the deck, which changes next
 * turn's draw, not this board. Rare Candy is here for turn 2 onward, and does
 * nothing on a player's first turn, as the card itself says.
 */
export interface EffectContext {
  /** Card keys the goal mentions — effect choices are narrowed to these. */
  relevant: Set<string>
  /** The goal wants more bench bodies, whichever they are. */
  wantsAnyBench: boolean
  /** The goal asks for Energy somewhere. */
  wantsEnergy: boolean
  /** Specific Energy types asked for; empty means any type. */
  energyTypes: Set<string>
  /** Card keys the goal wants Energy on; empty means nowhere in particular. */
  energyTargets: Set<string>
  /** The same, plus each target's earlier stages; for the end-of-turn attachment. */
  energyLineage?: Set<string>
  /** The card the goal wants Active, if any. */
  activeKey: string | null
  /**
   * Evolution lines in this deck, as normalised name to the name it evolves
   * from. Rare Candy needs it to see through the Stage 1 it skips.
   */
  prevOf?: Map<string, string>
  /** The goal wants a Grass evolution, which is what Forest of Vitality helps. */
  wantsGrassEvolution?: boolean
  /**
   * The goal's Active and its earlier stages, keyed by card, valued by how many
   * evolutions short of the goal each is (0 for the goal card itself).
   */
  activeLineage?: Map<string, number>
  /**
   * The Pokémon the goal places, by evolution line: the line's card keys and
   * how many of that line the goal wants in play. Bench space is kept for them.
   */
  goalLines?: { keys: Set<string>; needed: number }[]
  /** Basics in this deck that evolve into a Pokémon with a draw Ability. */
  drawEvolutionBases?: Set<string>
  /** Playing over several turns, so setting up for a later turn counts. */
  multiTurn?: boolean
  /** Deterministic randomness for anything that needs a roll. */
  rng: () => number
  /** This trial's seed. Shuffle effects derive their own stream from it. */
  seed: number
}

/** Returns every state the effect can lead to; several when it involves a choice. */
export type CardEffect = (state: SimState, ctx: EffectContext) => SimState[]

const EFFECTS = new Map<string, CardEffect>()

export function registerEffect(name: string, effect: CardEffect): void {
  EFFECTS.set(norm(name), effect)
}

export function lookupEffect(card: DeckCard): CardEffect | undefined {
  return EFFECTS.get(nameOf(card))
}

export const isImplemented = (card: DeckCard): boolean => lookupEffect(card) !== undefined

/**
 * A Supporter worth fetching when none is named: one whose effect the
 * simulator can play. Fetching Boss's Orders "for later" is a fetch spent on a
 * card that will never do anything here.
 */
export const isPlayableSupporter = (card: DeckCard): boolean =>
  card.tags.includes('supporter') && isImplemented(card)

/** Normalised names of every card the simulator knows how to play. */
export const implementedCardNames = (): string[] => [...EFFECTS.keys()].sort()

// --- shared helpers --------------------------------------------------------

const hasRuleBox = (card: DeckCard): boolean => (card.card?.rule ?? '') !== ''
const isPokemon = (card: DeckCard): boolean => card.tags.includes('pokemon')
const isEvolution = (card: DeckCard): boolean =>
  card.tags.includes('stage1') || card.tags.includes('stage2')
const isBasicEnergy = (card: DeckCard): boolean => card.tags.includes('basic-energy')
const hp = (card: DeckCard): number => card.card?.hp ?? 0

/**
 * How much the goal wants this card, as a rank rather than a flag.
 *
 * A card the goal named outranks one that is merely the right sort of card,
 * which matters when paying a discard cost: pitching the Pokémon the goal asked
 * for to keep a generic Energy would be exactly backwards.
 */
function keepRank(card: DeckCard, ctx: EffectContext): number {
  if (ctx.relevant.has(card.key)) return 2
  if (ctx.wantsAnyBench && isBasicPokemon(card)) return 1
  if (ctx.wantsEnergy && isEnergy(card)) {
    const rightType = ctx.energyTypes.size === 0 || ctx.energyTypes.has(energyType(card))
    return rightType ? 1 : 0
  }
  return 0
}

/**
 * How much a card in hand is worth keeping when a cost makes you discard,
 * lowest pitched first.
 *
 * Measured on the benchmark boards, Ultra Ball used to pitch Lillie's
 * Determination and Forest of Vitality more than anything, because every card
 * the goal did not name ranked the same. A real player pitches the dead cards
 * and keeps the outs — the cards that turn a bad hand around:
 *
 *   -1  a Trainer the simulator cannot play (Boss's Orders, Crushing Hammer)
 *    0  anything else
 *  0.5  Energy a ready accelerator can put straight back into play
 *    1  what the goal generally wants (its Energy, Basics for a bench count)
 *  1.5  outs: a playable Supporter or Item (Rare Candy too), a Stadium that
 *       helps, a Pokémon that draws, searches or accelerates, an engine piece
 *    2  a card the goal names
 *
 * On turn 1 alone an out ranks 0.75 instead, below the goal's generic cards,
 * and only counts if it can still be played this turn (a second Supporter is
 * dead there). Across turns, everything playable later is an out.
 */
function discardRank(
  card: DeckCard,
  state: SimState,
  ctx: EffectContext,
  recovers: (card: DeckCard) => boolean,
  enginePiece: boolean,
): number {
  if (ctx.relevant.has(card.key)) return 2
  // Across turns an out outranks generic goal cards: it is what turns a bad
  // hand around next turn. Within turn 1 the search can play an out before
  // paying the cost anyway, so there it only beats cards the goal cannot use.
  if (enginePiece || isOut(card, state, ctx)) return ctx.multiTurn ? 1.5 : 0.75
  const goal = keepRank(card, ctx)
  if (goal > 0) return recovers(card) ? 0.5 : goal
  if (recovers(card)) return 0.5
  const trainer = ['item', 'supporter', 'stadium', 'tool'].some((tag) => card.tags.includes(tag))
  return trainer && !isImplemented(card) ? -1 : 0
}

/** A card that can still turn the game: see `discardRank`. */
function isOut(card: DeckCard, state: SimState, ctx: EffectContext): boolean {
  const later = ctx.multiTurn === true
  if (card.tags.includes('supporter')) return isImplemented(card) && (later || !state.usedSupporter)
  if (card.tags.includes('item')) return isImplemented(card)
  if (card.tags.includes('stadium')) {
    const name = nameOf(card)
    const helps =
      (name === norm('Forest of Vitality') && ctx.wantsGrassEvolution === true) ||
      (name === norm('Area Zero Underdepths') && ctx.wantsAnyBench)
    return helps && (later || !state.usedStadium)
  }
  if (card.tags.includes('pokemon')) {
    const def = abilityOf(card)
    return (
      def?.draws === true ||
      def?.engine !== undefined ||
      (ctx.wantsEnergy && def?.accelerates === true) ||
      attackOf(card) !== undefined
    )
  }
  return false
}

/** Does the goal have any use for this card at all? */
const useful = (card: DeckCard, ctx: EffectContext): boolean => keepRank(card, ctx) > 0

/**
 * Distinct cards worth fetching from a pool.
 *
 * Copies are interchangeable, so only one of each is offered. Anything the goal
 * has no use for is skipped entirely: it cannot bring the board closer, and
 * branching on it would blow up the tree for nothing.
 */
export function choices(
  state: SimState,
  pool: DeckCard[],
  allowed: (card: DeckCard) => boolean,
  ctx: EffectContext,
) {
  const seen = new Map<string, DeckCard>()
  for (const card of pool) {
    if (allowed(card) && useful(card, ctx) && !seen.has(card.key)) seen.set(card.key, card)
  }
  // Engine pieces come after the goal's own cards, so a single-pick effect
  // still takes what the goal asked for when it can.
  const finishesEngine = engineWants(state)
  for (const card of pool) {
    if (allowed(card) && finishesEngine(card) && !seen.has(card.key)) seen.set(card.key, card)
  }
  return [...seen.values()]
}

const removeFirst = (pool: DeckCard[], card: DeckCard): void => {
  const index = pool.findIndex((c) => c.key === card.key)
  if (index >= 0) pool.splice(index, 1)
}

/**
 * Pay a discard cost from hand, keeping whatever the goal needs.
 *
 * A piece a draw engine is counting on is kept like a card the goal wants in
 * general: pitching Lunar Cycle's only {F} Energy to Ultra Ball would throw
 * away the draw 3 the line is building toward.
 *
 * Which cards to pitch is a judgement call rather than a branch: discarding the
 * least useful cards is always at least as good, so this resolves to one
 * outcome instead of multiplying the search.
 */
export function payDiscard(
  state: SimState,
  count: number,
  ctx: EffectContext,
): SimState | null {
  if (state.hand.length < count) return null
  const next = cloneState(state)
  const engine = engineKeeps(state)
  const recovers = recoverable(state)
  const ranked = next.hand
    .map((card, index) => ({
      card,
      index,
      keep: discardRank(card, state, ctx, recovers, engine.has(index)),
    }))
    .sort((a, b) => a.keep - b.keep || a.index - b.index)
  for (const entry of ranked.slice(0, count)) next.discard.push(entry.card)
  const dropped = new Set(ranked.slice(0, count).map((e) => e.index))
  next.hand = next.hand.filter((_, index) => !dropped.has(index))
  return next
}

/** Fetch `card` from the deck into hand. */
function fetchToHand(state: SimState, card: DeckCard): SimState {
  const next = cloneState(state)
  removeFirst(next.deck, card)
  next.hand.push(card)
  return next
}

// --- search to bench -------------------------------------------------------

registerEffect('Buddy-Buddy Poffin', (state, ctx) => {
  // "Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them
  // onto your Bench."
  const eligible = (card: DeckCard) => isBasicPokemon(card) && hp(card) <= 70
  const out: SimState[] = []
  const first = choices(state, state.deck, eligible, ctx)

  for (const a of first) {
    const afterFirst = cloneState(state)
    if (afterFirst.bench.length >= benchCap(afterFirst)) break
    removeFirst(afterFirst.deck, a)
    afterFirst.bench.push(inPlay(a))
    out.push(afterFirst)

    for (const b of choices(afterFirst, afterFirst.deck, eligible, ctx)) {
      if (afterFirst.bench.length >= benchCap(afterFirst)) break
      const afterSecond = cloneState(afterFirst)
      removeFirst(afterSecond.deck, b)
      afterSecond.bench.push(inPlay(b))
      out.push(afterSecond)
    }
  }
  // "Up to 2" includes benching nothing, which is all that is left if the deck
  // holds nothing the goal wants.
  return out.length > 0 ? out : [state]
})

// --- search to hand --------------------------------------------------------

registerEffect('Ultra Ball', (state, ctx) => {
  const paid = payDiscard(state, 2, ctx)
  if (!paid) return [state]
  const found = choices(paid, paid.deck, isPokemon, ctx)
  // Discarding two to fetch nothing is not a play anyone makes.
  return found.length > 0 ? found.map((card) => fetchToHand(paid, card)) : [state]
})

registerEffect('Fighting Gong', (state, ctx) => {
  // "Search your deck for a Basic {F} Energy card or a Basic {F} Pokémon,
  // reveal it, and put it into your hand."
  //
  // Both halves feed the same engine, which is why the choice is branched on
  // rather than resolved: the Energy is what Lunatone's Lunar Cycle discards to
  // draw 3, and the Pokémon can be the Solrock that switches Lunar Cycle on.
  const fighting = (card: DeckCard) =>
    (isBasicEnergy(card) || isBasicPokemon(card)) && energyType(card) === '{F}'
  const found = choices(state, state.deck, fighting, ctx)
  return found.length > 0 ? found.map((card) => fetchToHand(state, card)) : [state]
})

// --- evolution ---------------------------------------------------------------

registerEffect('Rare Candy', (state, ctx) => {
  // "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your
  // hand that evolves from that Pokémon, put that card onto the Basic Pokémon
  // to evolve it, skipping the Stage 1. You can't use this card during your
  // first turn or on a Basic Pokémon that was put into play this turn."
  //
  // Forest of Vitality does not loosen this: Rare Candy carries its own rule.
  if ((state.turn ?? 1) < 2) return [state]
  const stage2s = distinctCards(
    state.hand.filter((card) => card.tags.includes('stage2') && ctx.relevant.has(card.key)),
  )
  const out: SimState[] = []
  const slots = [
    ...(state.active ? [{ slot: state.active, target: -1 }] : []),
    ...state.bench.map((slot, target) => ({ slot, target })),
  ]
  for (const stage2 of stage2s) {
    const stage1 = norm(stage2.card?.prev ?? '')
    const basic = ctx.prevOf?.get(stage1)
    if (!basic) continue
    const seen = new Set<string>()
    for (const { slot, target } of slots) {
      if (slot.fresh || !isBasicPokemon(slot.card) || seen.has(slot.card.key)) continue
      if (nameOf(slot.card) !== basic) continue
      seen.add(slot.card.key)
      const next = cloneState(state)
      removeFirst(next.hand, stage2)
      if (target === -1) next.active = evolveSlot(next.active!, stage2)
      else next.bench[target] = evolveSlot(next.bench[target], stage2)
      out.push(...onEvolve(next, target, ctx))
    }
  }
  return out.length > 0 ? out : [state]
})

// --- search the top of the deck ---------------------------------------------

registerEffect('Pokégear 3.0', (state, ctx) => {
  // "Look at the top 7 cards of your deck. You may reveal a Supporter card you
  // find there and put it into your hand. Shuffle the other cards back."
  const found = supporterChoices(state, 7, ctx)
  // Finding nothing still shuffles the deck, which changes the next draw.
  if (found.length === 0) return [takeFromTop(state, 7, [], ctx)]
  return found.map((card) => takeFromTop(state, 7, [card], ctx))
})

registerEffect('Roto-Stick', (state, ctx) => {
  // "Look at the top 4 cards of your deck. You may reveal any number of
  // Supporter cards you find there and put them into your hand. Shuffle the
  // other cards back." Taking every one is never worse than taking fewer, so
  // this is one outcome rather than a branch per subset.
  const supporters = topOf(state, 4).filter((card) => card.tags.includes('supporter'))
  return [takeFromTop(state, 4, supporters, ctx)]
})

registerEffect('Bug Catching Set', (state, ctx) => {
  // "Look at the top 7 cards of your deck. You may reveal up to 2 in any
  // combination of {G} Pokémon and Basic {G} Energy cards you find there and
  // put them into your hand. Shuffle the other cards back."
  const grass = (card: DeckCard) =>
    (isPokemon(card) || isBasicEnergy(card)) && energyType(card) === '{G}'
  const top = topOf(state, 7)
  const found = choices(state, top, grass, ctx)
  if (found.length === 0) return [takeFromTop(state, 7, [], ctx)]

  // Up to 2: each single pick, and each pair the top actually holds (a pair of
  // the same card needs two copies there).
  const out: SimState[] = []
  found.forEach((a, i) => {
    out.push(takeFromTop(state, 7, [a], ctx))
    for (const b of found.slice(i)) {
      const copies = top.filter((card) => card.key === b.key).length
      if (b.key === a.key && copies < 2) continue
      out.push(takeFromTop(state, 7, [a, b], ctx))
    }
  })
  return out
})

// "Search your deck for a Trainer card, reveal it, and put it into your hand.
// Then, shuffle your deck." Petrel is itself the turn's Supporter, so another
// Supporter is only worth fetching if the goal wants it in hand; otherwise the
// choice is a Trainer the goal names, an Item the simulator can play, or a
// Stadium that helps (Forest of Vitality, Area Zero Underdepths).
registerEffect("Team Rocket's Petrel", (state, ctx) => {
  const isTrainer = (card: DeckCard) =>
    ['item', 'supporter', 'stadium', 'tool'].some((tag) => card.tags.includes(tag))
  const worth = (card: DeckCard) => {
    if (ctx.relevant.has(card.key)) return true
    if (card.tags.includes('item')) return isImplemented(card)
    const name = nameOf(card)
    if (name === norm('Forest of Vitality')) return ctx.wantsGrassEvolution === true
    if (name === norm('Area Zero Underdepths')) return ctx.wantsAnyBench
    return false
  }
  const found = distinctCards(state.deck.filter((card) => isTrainer(card) && worth(card)))
  return found.map((card) => {
    const next = fetchToHand(state, card)
    next.deck = fairShuffle(next, next.deck, ctx.seed)
    next.shuffles = shufflesAfter(next)
    return next
  })
})

registerEffect('Poké Pad', (state, ctx) => {
  const found = choices(state, state.deck, (c) => isPokemon(c) && !hasRuleBox(c), ctx)
  return found.length > 0 ? found.map((card) => fetchToHand(state, card)) : [state]
})

registerEffect('Cyrano', (state, ctx) => {
  // "Up to 3 Pokémon ex" — taking the ones the goal wants is never worse.
  const found = choices(state, state.deck, (c) => isPokemon(c) && hasRuleBox(c), ctx).slice(0, 3)
  if (found.length === 0) return [state]
  const next = cloneState(state)
  for (const card of found) {
    removeFirst(next.deck, card)
    next.hand.push(card)
  }
  return [next]
})

registerEffect('Dawn', (state, ctx) => {
  // One Basic, one Stage 1 and one Stage 2 — independent picks, so take the
  // most useful of each rather than branching on all combinations.
  const pick = (allowed: (c: DeckCard) => boolean) => choices(state, state.deck, allowed, ctx)[0]
  const wanted = [
    pick((c) => isBasicPokemon(c)),
    pick((c) => c.tags.includes('stage1')),
    pick((c) => c.tags.includes('stage2')),
  ].filter((c): c is DeckCard => c !== undefined)
  if (wanted.length === 0) return [state]
  const next = cloneState(state)
  for (const card of wanted) {
    removeFirst(next.deck, card)
    next.hand.push(card)
  }
  return [next]
})

registerEffect('Hilda', (state, ctx) => {
  const evolution = choices(state, state.deck, isEvolution, ctx)[0]
  const energy = choices(state, state.deck, isEnergy, ctx)[0]
  const wanted = [evolution, energy].filter((c): c is DeckCard => c !== undefined)
  if (wanted.length === 0) return [state]
  const next = cloneState(state)
  for (const card of wanted) {
    removeFirst(next.deck, card)
    next.hand.push(card)
  }
  return [next]
})

registerEffect('Secret Box', (state, ctx) => {
  const paid = payDiscard(state, 3, ctx)
  if (!paid) return [state]
  const pick = (allowed: (c: DeckCard) => boolean) => choices(paid, paid.deck, allowed, ctx)[0]
  const wanted = [
    pick((c) => c.tags.includes('item')),
    pick((c) => c.tags.includes('tool')),
    pick((c) => c.tags.includes('supporter')),
    pick((c) => c.tags.includes('stadium')),
  ].filter((c): c is DeckCard => c !== undefined)
  if (wanted.length === 0) return [state]
  const next = cloneState(paid)
  for (const card of wanted) {
    removeFirst(next.deck, card)
    next.hand.push(card)
  }
  return [next]
})

// --- draw and refresh ------------------------------------------------------

/**
 * Shuffle the hand back and draw a fresh one.
 *
 * A fair shuffle (see `fairShuffle`): it resolves the same way every time the
 * search reaches it, so the search can backtrack through it, but the search
 * cannot re-roll it by changing something unrelated first.
 */
function refreshHand(state: SimState, count: number, ctx: EffectContext): SimState {
  const next = cloneState(state)
  next.deck = fairShuffle(state, [...next.deck, ...next.hand], ctx.seed)
  next.shuffles = shufflesAfter(state)
  next.hand = next.deck.splice(0, count)
  return next
}

registerEffect("Lillie's Determination", (state, ctx) => {
  // "Draw 6; if you have exactly 6 Prize cards remaining, draw 8 instead."
  // On turn 1 nobody has taken a Prize, so it is always the 8.
  const draws = state.prizes.length === 6 ? 8 : 6
  return [refreshHand(state, draws, ctx)]
})

registerEffect('Judge', (state, ctx) => [refreshHand(state, 4, ctx)])

// --- energy ----------------------------------------------------------------

registerEffect('Crispin', (state, ctx) => {
  // Two Basic Energy of different types: one to hand, one attached.
  const basics = choices(state, state.deck, isBasicEnergy, ctx)
  if (basics.length === 0) return [state]

  const out: SimState[] = []
  for (const attached of basics) {
    const others = basics.filter((c) => energyType(c) !== energyType(attached))
    const toHand = others[0]
    const slots = [
      ...(state.active ? [{ active: true, index: -1 }] : []),
      ...state.bench.map((_, index) => ({ active: false, index })),
    ]
    for (const target of slots) {
      const next = cloneState(state)
      removeFirst(next.deck, attached)
      if (toHand) {
        removeFirst(next.deck, toHand)
        next.hand.push(toHand)
      }
      const slot = target.active ? next.active! : next.bench[target.index]
      slot.energy.push(attached)
      out.push(next)
    }
  }
  return out.length > 0 ? out : [state]
})

/** A Pokémon in play and where it sits: ACTIVE_TARGET or its bench index. */
interface Placed {
  slot: InPlay
  target: number
}

/**
 * Attach one Basic Energy from hand, discard or deck to a Pokémon — the move
 * every Energy accelerator makes, whatever its source.
 *
 * Only where the Energy counts: on a Pokémon the goal wants Energy on (or an
 * earlier stage of one), else on any Pokémon the goal names. Identical
 * Pokémon carrying the same Energy are tried once. A type the goal asks for is
 * attached first. Returns each board with where the Energy went; none when
 * there is no Energy to move or nowhere it helps.
 */
export function attachFrom(
  state: SimState,
  ctx: EffectContext,
  source: 'hand' | 'discard' | 'deck',
  energyOk: (card: DeckCard) => boolean,
  targetOk: (placed: Placed) => boolean,
): { state: SimState; target: number }[] {
  const pool = state[source]
  const candidates = pool.filter((card) => isBasicEnergy(card) && energyOk(card))
  if (candidates.length === 0) return []
  const energy =
    (ctx.energyTypes.size > 0 && candidates.find((card) => energyFits(card, ctx.energyTypes))) ||
    candidates[0]

  const wants = ctx.energyLineage ?? ctx.energyTargets
  const counts = (slot: InPlay) =>
    ctx.wantsEnergy ? wants.size === 0 || wants.has(slot.card.key) : ctx.relevant.has(slot.card.key)
  const placed: Placed[] = [
    ...(state.active ? [{ slot: state.active, target: -1 }] : []),
    ...state.bench.map((slot, target) => ({ slot, target })),
  ]
  const seen = new Set<string>()
  const out: { state: SimState; target: number }[] = []
  for (const entry of placed) {
    if (!targetOk(entry) || !counts(entry.slot)) continue
    const same = `${entry.target === -1 ? 'A' : 'B'}${entry.slot.card.key}+${entry.slot.energy.length}`
    if (seen.has(same)) continue
    seen.add(same)
    const next = cloneState(state)
    removeFirst(next[source], energy)
    const slot = entry.target === -1 ? next.active! : next.bench[entry.target]
    slot.energy.push(energy)
    if (source === 'deck') {
      next.deck = fairShuffle(state, next.deck, ctx.seed)
      next.shuffles = shufflesAfter(state)
    }
    if (source === 'hand') {
      for (const after of onAttachFromHand(next, energy, slot.card, ctx)) {
        out.push({ state: after, target: entry.target })
      }
      continue
    }
    out.push({ state: next, target: entry.target })
  }
  return out
}

const TELEPATHIC = norm('Telepathic Psychic Energy')

/** A Pokémon of this type, by its printed type. */
const isPokemonOfType = (card: DeckCard, type: string) =>
  card.tags.includes('pokemon') && (card.card?.type ?? '').includes(type)

/**
 * Would attaching this Energy from hand to this Pokémon set off a search?
 * Telepathic Psychic Energy does, onto a Psychic Pokémon — and is only worth
 * it while a Basic Psychic the goal can use is in the deck, with room for it.
 */
export function attachSearches(
  state: SimState,
  energy: DeckCard,
  holder: DeckCard,
  ctx: EffectContext,
): boolean {
  if (nameOf(energy) !== TELEPATHIC || !isPokemonOfType(holder, '{P}')) return false
  if (state.bench.length >= benchCap(state)) return false
  return choices(state, state.deck, (card) => isBasicPokemon(card) && isPokemonOfType(card, '{P}'), ctx).length > 0
}

/**
 * What happens as an Energy is attached from hand: usually nothing more.
 * Telepathic Psychic Energy on a Psychic Pokémon: "search your deck for up to
 * 2 Basic {P} Pokémon and put them onto your Bench. Then, shuffle your deck."
 * Branches like Buddy-Buddy Poffin — each Pokémon worth benching, each pair
 * the deck can supply, and none — and every branch shuffles.
 */
export function onAttachFromHand(
  state: SimState,
  energy: DeckCard,
  holder: DeckCard,
  ctx: EffectContext,
): SimState[] {
  if (nameOf(energy) !== TELEPATHIC || !isPokemonOfType(holder, '{P}')) return [state]
  const psychic = (card: DeckCard) => isBasicPokemon(card) && isPokemonOfType(card, '{P}')
  const shuffle = (next: SimState) => {
    next.deck = fairShuffle(state, next.deck, ctx.seed)
    next.shuffles = shufflesAfter(state)
    return next
  }
  const out: SimState[] = [shuffle(cloneState(state))]
  const first = choices(state, state.deck, psychic, ctx)
  for (const [i, a] of first.entries()) {
    if (state.bench.length >= benchCap(state)) break
    const one = cloneState(state)
    removeFirst(one.deck, a)
    one.bench.push(inPlay(a))
    out.push(shuffle(cloneState(one)))
    if (one.bench.length >= benchCap(one)) continue
    // The second from the same or a later choice, so each pair comes once.
    for (const b of choices(one, one.deck, psychic, ctx).filter((card) => first.indexOf(card) >= i || !first.includes(card))) {
      const two = cloneState(one)
      removeFirst(two.deck, b)
      two.bench.push(inPlay(b))
      out.push(shuffle(two))
    }
  }
  return out
}

const benched = ({ target }: Placed) => target !== -1
const ofType = (type: string) => (card: DeckCard) => (card.card?.type ?? '').includes(type)

// "Attach a Basic {P} Energy card from your discard pile to 1 of your Benched
// {P} Pokémon."
registerEffect('Wondrous Patch', (state, ctx) =>
  attachFrom(
    state,
    ctx,
    'discard',
    (card) => energyType(card) === '{P}',
    (placed) => benched(placed) && ofType('{P}')(placed.slot.card),
  ).map((moved) => moved.state),
)

// "Attach a Basic Energy card from your discard pile to 1 of your Benched N's
// Pokémon."
registerEffect("N's PP Up", (state, ctx) =>
  attachFrom(
    state,
    ctx,
    'discard',
    () => true,
    (placed) => benched(placed) && cardName(placed.slot.card).startsWith("N's"),
  ).map((moved) => moved.state),
)

// "You can use this card only if you have any Tera Pokémon in play. Choose up
// to 2 of your Benched {C} Pokémon and attach a Basic Energy card from your
// discard pile to each of them."
registerEffect('Glass Trumpet', (state, ctx) => {
  const tera = [...(state.active ? [state.active] : []), ...state.bench].some((slot) =>
    slot.card.tags.includes('tera'),
  )
  if (!tera) return []
  const colorless = (placed: Placed) => benched(placed) && ofType('{C}')(placed.slot.card)
  const out: SimState[] = []
  for (const first of attachFrom(state, ctx, 'discard', () => true, colorless)) {
    out.push(first.state)
    // A second, to a different Pokémon.
    const second = attachFrom(
      first.state,
      ctx,
      'discard',
      () => true,
      (placed) => colorless(placed) && placed.target !== first.target,
    )
    out.push(...second.map((moved) => moved.state))
  }
  return out
})

/**
 * Basic Energy a discard-pile accelerator ready to use could put straight
 * back into play — Blaziken ex or Eelektrik in play, or Wondrous Patch,
 * N's PP Up or Glass Trumpet in hand. Discarding such Energy to a cost loses
 * nothing, so a cost should take it before a card the goal needs.
 */
function recoverable(state: SimState): (card: DeckCard) => boolean {
  const checks: ((card: DeckCard) => boolean)[] = []
  for (const slot of [...(state.active ? [state.active] : []), ...state.bench]) {
    const recovers = abilityOf(slot.card)?.recoversEnergy
    if (recovers) checks.push(recovers)
  }
  for (const card of state.hand) {
    const name = nameOf(card)
    if (name === norm('Wondrous Patch')) checks.push((c) => energyType(c) === '{P}')
    if (name === norm("N's PP Up") || name === norm('Glass Trumpet')) checks.push(() => true)
  }
  return (card) => isBasicEnergy(card) && checks.some((check) => check(card))
}

registerEffect('Energy Switch', (state) => {
  // Move one Basic Energy between your own Pokémon.
  const slots = [
    ...(state.active ? [{ index: -1 }] : []),
    ...state.bench.map((_, index) => ({ index })),
  ]
  const out: SimState[] = []
  for (const from of slots) {
    for (const to of slots) {
      if (from.index === to.index) continue
      const next = cloneState(state)
      const source = from.index === -1 ? next.active! : next.bench[from.index]
      const destination = to.index === -1 ? next.active! : next.bench[to.index]
      const moved = source.energy.findIndex(isBasicEnergy)
      if (moved < 0) continue
      destination.energy.push(...source.energy.splice(moved, 1))
      out.push(next)
    }
  }
  return out.length > 0 ? out : [state]
})

// --- switching -------------------------------------------------------------

registerEffect('Switch', (state, ctx) => {
  if (!state.active || state.bench.length === 0) return [state]
  const seen = new Set<string>()
  const out: SimState[] = []
  state.bench.forEach((slot, index) => {
    if (seen.has(slot.card.key) || !worthSwitching(state, slot.card, ctx)) return
    seen.add(slot.card.key)
    const next = cloneState(state)
    const active = next.active!
    next.active = next.bench[index]
    next.bench[index] = active
    out.push(next)
  })
  return out.length > 0 ? out : [state]
})

/**
 * Is bringing this Pokémon Active a step toward the goal's Active?
 *
 * Only a Pokémon on the goal Active's own evolution line is worth switching
 * in, and only one further along it than what is Active now: switching away
 * from a Dreepy that will become the goal's Dragapult ex, or between two
 * identical Drakloak, does nothing a player would do.
 */
export function worthSwitching(state: SimState, incoming: DeckCard, ctx: EffectContext): boolean {
  if (!state.active) return false
  // A Pokémon whose attack searches the deck is worth bringing in to use it,
  // goal or no goal — Celebi stepping up to find the Stage 2 lines.
  if (!state.attacked && !state.cannotAttack && attackOf(incoming) && !attackOf(state.active.card)) {
    return true
  }
  if (ctx.activeKey === null) return false
  // Without the deck's evolution lines to hand, the goal's Active is the line.
  const lineage = ctx.activeLineage?.size ? ctx.activeLineage : new Map([[ctx.activeKey, 0]])
  const to = lineage.get(incoming.key)
  if (to === undefined) return false
  const from = lineage.get(state.active.card.key)
  return from === undefined || to < from
}

// --- recovery --------------------------------------------------------------

registerEffect('Night Stretcher', (state, ctx) => {
  const found = choices(state, state.discard, (c) => isPokemon(c) || isBasicEnergy(c), ctx)
  if (found.length === 0) return [state]
  return found.map((card) => {
    const next = cloneState(state)
    removeFirst(next.discard, card)
    next.hand.push(card)
    return next
  })
})

registerEffect("Lana's Aid", (state, ctx) => {
  // Up to 3 Pokémon without a Rule Box and/or Basic Energy.
  const found = choices(
    state,
    state.discard,
    (c) => (isPokemon(c) && !hasRuleBox(c)) || isBasicEnergy(c),
    ctx,
  ).slice(0, 3)
  if (found.length === 0) return [state]
  const next = cloneState(state)
  for (const card of found) {
    removeFirst(next.discard, card)
    next.hand.push(card)
  }
  return [next]
})
