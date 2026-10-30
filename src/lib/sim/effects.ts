import { norm } from '../normalize'
import type { DeckCard } from '../types'
import { hashString, mulberry32, shuffled } from './rng'
import { engineWants } from './abilities'
import {
  benchCap,
  cardName,
  cloneState,
  energyType,
  inPlay,
  isBasicPokemon,
  isEnergy,
  signature,
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
 * Nothing evolves either, so Rare Candy is dead. Ciphermaniac's Codebreaking
 * stacks the top of the deck, which changes next turn's draw, not this board.
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
  /** The card the goal wants Active, if any. */
  activeKey: string | null
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
  return EFFECTS.get(norm(cardName(card)))
}

export const isImplemented = (card: DeckCard): boolean => lookupEffect(card) !== undefined

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

/** Does the goal have any use for this card at all? */
const useful = (card: DeckCard, ctx: EffectContext): boolean => keepRank(card, ctx) > 0

/**
 * Distinct cards worth fetching from a pool.
 *
 * Copies are interchangeable, so only one of each is offered. Anything the goal
 * has no use for is skipped entirely: it cannot bring the board closer, and
 * branching on it would blow up the tree for nothing.
 */
function choices(
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
 * Which cards to pitch is a judgement call rather than a branch: discarding the
 * least useful cards is always at least as good, so this resolves to one
 * outcome instead of multiplying the search.
 */
function payDiscard(state: SimState, count: number, ctx: EffectContext): SimState | null {
  if (state.hand.length < count) return null
  const next = cloneState(state)
  const ranked = next.hand
    .map((card, index) => ({ card, index, keep: keepRank(card, ctx) }))
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
  return found.length > 0 ? found.map((card) => fetchToHand(paid, card)) : [paid]
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
  if (wanted.length === 0) return [paid]
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
 * The shuffle is seeded from the trial plus the state it happens in, not from a
 * running stream. That makes a branch resolve the same way every time it is
 * reached, so the search can backtrack through a shuffle without the outcome
 * shifting underneath it — and the whole run stays reproducible.
 */
function refreshHand(state: SimState, count: number, ctx: EffectContext): SimState {
  const next = cloneState(state)
  const rng = mulberry32(ctx.seed ^ hashString(signature(state)))
  next.deck = shuffled([...next.deck, ...next.hand], rng)
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

/** Attach a Basic Energy from the discard to a benched Pokémon matching a filter. */
function patchFromDiscard(
  state: SimState,
  energyOk: (card: DeckCard) => boolean,
  targetOk: (card: DeckCard) => boolean,
  max: number,
): SimState[] {
  const out: SimState[] = []
  const sources = state.discard.filter((c) => isBasicEnergy(c) && energyOk(c))
  if (sources.length === 0) return [state]

  const targets = state.bench
    .map((slot, index) => ({ slot, index }))
    .filter((entry) => targetOk(entry.slot.card))
  if (targets.length === 0) return [state]

  for (const target of targets.slice(0, max)) {
    const next = cloneState(state)
    const source = next.discard.find((c) => isBasicEnergy(c) && energyOk(c))
    if (!source) continue
    removeFirst(next.discard, source)
    next.bench[target.index].energy.push(source)
    out.push(next)
  }
  return out.length > 0 ? out : [state]
}

registerEffect('Wondrous Patch', (state) =>
  patchFromDiscard(
    state,
    (card) => energyType(card) === '{P}',
    (card) => (card.card?.type ?? '').includes('{P}'),
    1,
  ),
)

registerEffect("N's PP Up", (state) =>
  patchFromDiscard(
    state,
    () => true,
    (card) => cardName(card).startsWith("N's"),
    1,
  ),
)

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

registerEffect('Switch', (state) => {
  if (!state.active || state.bench.length === 0) return [state]
  const seen = new Set<string>()
  const out: SimState[] = []
  state.bench.forEach((slot, index) => {
    if (seen.has(slot.card.key)) return
    seen.add(slot.card.key)
    const next = cloneState(state)
    const active = next.active!
    next.active = next.bench[index]
    next.bench[index] = active
    out.push(next)
  })
  return out
})

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
