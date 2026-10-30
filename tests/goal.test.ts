import { describe, expect, it } from 'vitest'

import {
  energyPhrase,
  specialEnergyEntry,
  emptyGoal,
  goalIsEmpty,
  scoreBoard,
  type BoardPokemon,
  type BoardView,
  type FieldGoal,
  type SlotGoal,
} from '../src/lib/board/goal'

const label = (key: string) => key

const mon = (cardKey: string, ...energy: string[]): BoardPokemon => ({
  cardKey,
  energy,
  tools: [],
})

/** A Pokémon carrying Tools as well. */
const equipped = (cardKey: string, tools: string[], ...energy: string[]): BoardPokemon => ({
  cardKey,
  energy,
  tools,
})

const board = (over: Partial<BoardView> = {}): BoardView => ({
  active: null,
  bench: [],
  stadiumKey: null,
  hand: [],
  ...over,
})

const slot = (
  id: string,
  cardKey: string,
  energy = 0,
  energyType: string | null = null,
  tools: string[] = [],
): SlotGoal => ({ id, cardKey, energy: Array<string | null>(energy).fill(energyType), tools })

const goal = (over: Partial<FieldGoal> = {}): FieldGoal => ({ ...emptyGoal(), ...over })

describe('goalIsEmpty', () => {
  it('is true only before anything is placed', () => {
    expect(goalIsEmpty(emptyGoal())).toBe(true)
    expect(goalIsEmpty(goal({ benchMin: 1 }))).toBe(false)
    expect(goalIsEmpty(goal({ active: slot('a', 'dreepy') }))).toBe(false)
  })

  it('scores an empty goal as met, not as 0/0', () => {
    const score = scoreBoard(emptyGoal(), board(), label)
    expect(score.parts).toEqual([])
    expect(score.strict).toBe(true)
    expect(score.closeness).toBe(1)
  })
})

describe('active slot', () => {
  it('is met by the right card and missed by the wrong one', () => {
    const g = goal({ active: slot('a', 'dreepy') })
    expect(scoreBoard(g, board({ active: mon('dreepy') }), label).strict).toBe(true)
    expect(scoreBoard(g, board({ active: mon('budew') }), label).strict).toBe(false)
    expect(scoreBoard(g, board(), label).strict).toBe(false)
  })

  it('counts the Energy requirement as its own part', () => {
    const g = goal({ active: slot('a', 'dreepy', 2) })
    const score = scoreBoard(g, board({ active: mon('dreepy', '{P}') }), label)
    expect(score.parts.map((p) => p.met)).toEqual([true, false])
    expect(score.closeness).toBe(0.5)
    expect(scoreBoard(g, board({ active: mon('dreepy', '{P}', '{P}') }), label).strict).toBe(true)
  })

  it('does not credit Energy sitting on the wrong Active', () => {
    // The Energy part asks for Energy on the card the goal named — a different
    // Pokémon carrying it is not the board that was asked for.
    const g = goal({ active: slot('a', 'dreepy', 1) })
    const score = scoreBoard(g, board({ active: mon('budew', '{P}') }), label)
    expect(score.parts.every((p) => !p.met)).toBe(true)
  })

  it('honours a required Energy type', () => {
    const g = goal({ active: slot('a', 'dreepy', 1, '{R}') })
    expect(scoreBoard(g, board({ active: mon('dreepy', '{P}') }), label).strict).toBe(false)
    expect(scoreBoard(g, board({ active: mon('dreepy', '{R}') }), label).strict).toBe(true)
  })
})

describe('bench slots', () => {
  it('matches two copies of a card to two benched copies', () => {
    const g = goal({ bench: [slot('b1', 'dreepy'), slot('b2', 'dreepy')] })
    expect(scoreBoard(g, board({ bench: [mon('dreepy'), mon('dreepy')] }), label).strict).toBe(true)
    // One copy satisfies only one of the two slots.
    const half = scoreBoard(g, board({ bench: [mon('dreepy')] }), label)
    expect(half.strict).toBe(false)
    expect(half.closeness).toBe(0.5)
  })

  it('ignores bench order', () => {
    const g = goal({ bench: [slot('b1', 'dreepy'), slot('b2', 'budew')] })
    const score = scoreBoard(g, board({ bench: [mon('budew'), mon('dreepy')] }), label)
    expect(score.strict).toBe(true)
  })

  it('gives the Energy-hungry slot the Pokémon carrying the most', () => {
    // Two Dreepy are benched, one with Energy. The slot that asked for Energy
    // must be paired with that one, or a satisfiable board would score as a miss.
    const g = goal({ bench: [slot('b1', 'dreepy', 1), slot('b2', 'dreepy')] })
    const score = scoreBoard(g, board({ bench: [mon('dreepy'), mon('dreepy', '{P}')] }), label)
    expect(score.strict).toBe(true)
  })

  it('does not reuse one Pokémon for two slots', () => {
    const g = goal({ bench: [slot('b1', 'dreepy', 1), slot('b2', 'dreepy', 1)] })
    const score = scoreBoard(g, board({ bench: [mon('dreepy', '{P}')] }), label)
    // One card part met, one Energy part met, the other two missed.
    expect(score.parts.filter((p) => p.met)).toHaveLength(2)
    expect(score.strict).toBe(false)
  })
})

describe('tools', () => {
  it('is met only when the Tool is on the Pokémon that asked for it', () => {
    const g = goal({ active: slot('a', 'dreepy', 0, null, ['belt']) })
    expect(scoreBoard(g, board({ active: equipped('dreepy', ['belt']) }), label).strict).toBe(true)
    expect(scoreBoard(g, board({ active: equipped('dreepy', []) }), label).strict).toBe(false)
    // The right Tool on the wrong Pokémon is not the board that was asked for.
    expect(scoreBoard(g, board({ active: equipped('budew', ['belt']) }), label).strict).toBe(false)
  })

  it('counts each Tool as its own part', () => {
    const g = goal({ bench: [slot('b', 'dreepy', 0, null, ['belt', 'cape'])] })
    const score = scoreBoard(g, board({ bench: [equipped('dreepy', ['belt'])] }), label)
    // Card part met, one Tool met, one missed.
    expect(score.parts).toHaveLength(3)
    expect(score.parts.filter((p) => p.met)).toHaveLength(2)
  })

  it('pairs the Tool-hungry slot with the Pokémon actually carrying one', () => {
    const g = goal({ bench: [slot('b1', 'dreepy', 0, null, ['belt']), slot('b2', 'dreepy')] })
    const score = scoreBoard(
      g,
      board({ bench: [equipped('dreepy', []), equipped('dreepy', ['belt'])] }),
      label,
    )
    expect(score.strict).toBe(true)
  })
})

describe('bench size, stadium and hand', () => {
  it('counts a minimum bench size', () => {
    const g = goal({ benchMin: 3 })
    expect(scoreBoard(g, board({ bench: [mon('a'), mon('b')] }), label).strict).toBe(false)
    expect(scoreBoard(g, board({ bench: [mon('a'), mon('b'), mon('c')] }), label).strict).toBe(true)
  })

  it('checks the stadium in play', () => {
    const g = goal({ stadiumKey: 'area-zero' })
    expect(scoreBoard(g, board({ stadiumKey: 'area-zero' }), label).strict).toBe(true)
    expect(scoreBoard(g, board({ stadiumKey: 'other' }), label).strict).toBe(false)
  })

  it('checks cards still held at end of turn', () => {
    const g = goal({ inHand: [{ id: 'h1', cardKey: 'boss', count: 2 }] })
    expect(scoreBoard(g, board({ hand: ['boss'] }), label).strict).toBe(false)
    expect(scoreBoard(g, board({ hand: ['boss', 'boss', 'x'] }), label).strict).toBe(true)
  })
})

describe('closeness', () => {
  it('rises as more of the goal is reached', () => {
    const g = goal({
      active: slot('a', 'dreepy'),
      bench: [slot('b1', 'budew')],
      benchMin: 2,
    })
    const none = scoreBoard(g, board(), label).closeness
    const some = scoreBoard(g, board({ active: mon('dreepy') }), label).closeness
    const more = scoreBoard(
      g,
      board({ active: mon('dreepy'), bench: [mon('budew'), mon('x')] }),
      label,
    )
    expect(none).toBe(0)
    expect(some).toBeGreaterThan(none)
    expect(more.closeness).toBe(1)
    expect(more.strict).toBe(true)
  })

  it('is strict only when every part is met', () => {
    const g = goal({ active: slot('a', 'dreepy'), benchMin: 1 })
    const score = scoreBoard(g, board({ active: mon('dreepy') }), label)
    expect(score.closeness).toBe(0.5)
    expect(score.strict).toBe(false)
  })
})

describe('energyPhrase', () => {
  it('names the Energy type instead of only counting', () => {
    expect(energyPhrase({ energy: ['{G}'] })).toBe('Grass Energy')
    expect(energyPhrase({ energy: ['{P}', '{P}'] })).toBe('2 Psychic Energy')
  })

  it('says "any" when the type does not matter', () => {
    expect(energyPhrase({ energy: [null] })).toBe('Any Energy')
    expect(energyPhrase({ energy: [null, null, null] })).toBe('3 Energy of any type')
  })

  it('names a mix, typed Energy first', () => {
    expect(energyPhrase({ energy: [null, '{G}'] })).toBe('Grass + 1 any Energy')
    expect(energyPhrase({ energy: ['{G}', '{P}', '{P}', null, null] })).toBe(
      'Grass + 2 Psychic + 2 any Energy',
    )
  })
})

describe('mixed Energy needs', () => {
  const board = (energy: string[]): BoardView => ({
    active: { cardKey: 'dreepy', energy, tools: [] },
    bench: [],
    stadiumKey: null,
    hand: [],
  })
  const mix: SlotGoal = { id: 'a', cardKey: 'dreepy', energy: ['{G}', null], tools: [] }
  const met = (energy: string[]) =>
    scoreBoard(goal({ active: mix }), board(energy), (k) => k).parts.find((p) =>
      p.id.endsWith(':energy'),
    )!.met

  it('needs the typed one, and anything at all for the rest', () => {
    expect(met(['{G}', '{R}'])).toBe(true)
    expect(met(['{G}', '{G}'])).toBe(true)
    // Two Energy, but neither is Grass.
    expect(met(['{R}', '{R}'])).toBe(false)
    // The Grass alone cannot also count as the "any".
    expect(met(['{G}'])).toBe(false)
  })
})

describe('part labels', () => {
  it('tells repeated Pokémon apart, so no two parts read the same', () => {
    const g = goal({
      active: slot('a', 'dreepy', 1, null, ['belt']),
      bench: [
        slot('b1', 'dreepy', 1, '{P}', ['belt']),
        slot('b2', 'dreepy', 1, '{P}'),
        slot('b3', 'budew'),
      ],
    })
    const empty: BoardView = { active: null, bench: [], stadiumKey: null, hand: [] }
    const labels = scoreBoard(g, empty, (k) => k).parts.map((p) => p.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toContain('dreepy #1 benched')
    expect(labels).toContain('Psychic Energy on dreepy #2')
    expect(labels).toContain('belt on the Active')
    // A card benched once keeps its plain name.
    expect(labels).toContain('budew benched')
  })
})

describe('Special Energy', () => {
  // A Special Energy is asked for by its own card key, not as "any" Energy.
  const mist = 'id:mist'
  const labels = (key: string) => (key === mist ? 'Mist Energy' : key)
  const g = goal({ active: { id: 'a', cardKey: 'dreepy', energy: [mist], tools: [] } })
  const met = (energy: string[], goal = g) =>
    scoreBoard(goal, { active: { cardKey: 'dreepy', energy, tools: [] }, bench: [], stadiumKey: null, hand: [] }, labels)
      .parts.find((p) => p.id.endsWith(':energy'))!.met
  // Attached Special Energy reads as its card and the types it provides.
  const attachedMist = specialEnergyEntry(mist, ['{C}'])
  const telepathic = specialEnergyEntry('id:telepathic', ['{P}'])
  const prism = specialEnergyEntry('id:prism', ['*'])

  it('is met only by that card', () => {
    expect(met([attachedMist])).toBe(true)
    expect(met(['{P}'])).toBe(false)
  })

  it('meets a typed need when it provides that type', () => {
    const psychic = goal({ active: { id: 'a', cardKey: 'dreepy', energy: ['{P}'], tools: [] } })
    expect(met([telepathic], psychic)).toBe(true)
    expect(met([prism], psychic)).toBe(true)
    // Mist Energy only provides Colorless.
    expect(met([attachedMist], psychic)).toBe(false)
  })

  it('leaves a Basic Energy of the type for the need, and the Special for "any"', () => {
    const both = goal({ active: { id: 'a', cardKey: 'dreepy', energy: ['{P}', null], tools: [] } })
    expect(met(['{P}', telepathic], both)).toBe(true)
    expect(met([telepathic, attachedMist], both)).toBe(true)
    expect(met([attachedMist, attachedMist], both)).toBe(false)
  })

  it('is named after the card', () => {
    expect(energyPhrase({ energy: [mist] }, labels)).toBe('Mist Energy')
    expect(energyPhrase({ energy: [mist, mist] }, labels)).toBe('2 Mist Energy')
    expect(energyPhrase({ energy: ['{P}', mist, null] }, labels)).toBe(
      'Psychic Energy + Mist Energy + 1 Energy of any type',
    )
  })

  it('still counts toward an "any" requirement once attached', () => {
    const anyGoal = goal({ active: { id: 'a', cardKey: 'dreepy', energy: [null], tools: [] } })
    const score = scoreBoard(
      anyGoal,
      { active: { cardKey: 'dreepy', energy: [attachedMist], tools: [] }, bench: [], stadiumKey: null, hand: [] },
      labels,
    )
    expect(score.strict).toBe(true)
  })
})

describe('hand size', () => {
  it('is a part of its own, met by any cards at all', () => {
    const g = goal({ handMin: 3 })
    const view = (hand: string[]): BoardView => ({ active: null, bench: [], stadiumKey: null, hand })
    const score = (hand: string[]) => scoreBoard(g, view(hand), (k) => k)
    expect(score(['a', 'b']).strict).toBe(false)
    expect(score(['a', 'b', 'c']).strict).toBe(true)
    expect(score([]).parts[0].label).toBe('3 or more cards in hand')
  })
})
