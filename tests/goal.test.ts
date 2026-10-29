import { describe, expect, it } from 'vitest'

import {
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
): SlotGoal => ({ id, cardKey, energy, energyType, tools })

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
