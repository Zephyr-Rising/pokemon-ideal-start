import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { emptyGoal, type FieldGoal, type SlotGoal } from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import { MAX_TURNS, summarise, turnsTest } from '../src/lib/sim/turns'
import type { DeckCard } from '../src/lib/types'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const load = (name: string) => resolveDeck(readFileSync(resolve(FIXTURES, `${name}.txt`), 'utf8')).cards
const labelFor = (cards: DeckCard[]) => (key: string) => cards.find((c) => c.key === key)?.label ?? key
const keyOf = (cards: DeckCard[], label: string) => cards.find((c) => c.label === label)!.key
const slot = (id: string, cardKey: string): SlotGoal => ({ id, cardKey, energy: [], tools: [] })
const goal = (over: Partial<FieldGoal>): FieldGoal => ({ ...emptyGoal(), ...over })

describe('summarise', () => {
  it('finds the turn by which half the games have it', () => {
    expect(summarise([0.2, 0.2, 0.2, 0, 0, 0]).median).toBe(3)
    // Exactly half by turn 2 counts as turn 2.
    expect(summarise([0.25, 0.25, 0, 0, 0, 0]).median).toBe(2)
  })

  it('has no median when fewer than half ever get there', () => {
    expect(summarise([0.1, 0.1, 0.1, 0, 0, 0]).median).toBeNull()
  })

  it('averages over the games that get there', () => {
    const r = summarise([0.5, 0, 0.5, 0, 0, 0])
    expect(r.mean).toBeCloseTo(2, 10)
    expect(r.reached).toBeCloseTo(1, 10)
    expect(summarise([0, 0, 0, 0, 0, 0]).mean).toBeNull()
  })
})

describe('turnsTest', () => {
  const cards = load('dragapult-munkidori')

  it('never builds an evolved board on turn 1, and does build it later', () => {
    const g = goal({ active: slot('a', keyOf(cards, 'Drakloak')) })
    const result = turnsTest(cards, g, labelFor(cards), { trials: 60, seed: 4 })
    expect(result.byTurn).toHaveLength(MAX_TURNS)
    expect(result.byTurn[0]).toBe(0)
    expect(result.reached).toBeGreaterThan(0.5)
    expect(result.median).not.toBeNull()
    expect(result.median!).toBeGreaterThanOrEqual(2)
  }, 120_000)

  it('reports the average of both orders, and going first is never faster overall', () => {
    const g = goal({ active: slot('a', keyOf(cards, 'Dreepy')), bench: [slot('b', keyOf(cards, 'Munkidori'))] })
    const result = turnsTest(cards, g, labelFor(cards), { trials: 60, seed: 9 })
    result.byTurn.forEach((share, i) => {
      expect(share).toBeCloseTo((result.goingFirst.byTurn[i] + result.goingSecond.byTurn[i]) / 2, 10)
    })
    // By turn 1 specifically, going second has the Supporter going first lacks.
    expect(result.goingSecond.byTurn[0]).toBeGreaterThanOrEqual(result.goingFirst.byTurn[0])
  }, 120_000)
})

describe('each part of the board', () => {
  const cards = load('dragapult-munkidori')
  const g = goal({
    active: slot('a', keyOf(cards, 'Drakloak')),
    bench: [slot('b', keyOf(cards, 'Munkidori'))],
  })
  const result = turnsTest(cards, g, labelFor(cards), { trials: 40, seed: 5 })

  it('reports every part, for each order and overall', () => {
    expect(result.parts.map((p) => p.label)).toEqual(['Drakloak Active', 'Munkidori benched'])
    expect(result.goingFirst.parts).toHaveLength(2)
    expect(result.goingSecond.parts).toHaveLength(2)
  })

  it('never has a part come together later than the whole board', () => {
    for (const order of [result, result.goingFirst, result.goingSecond]) {
      for (const part of order.parts) {
        expect(part.reached).toBeGreaterThanOrEqual(order.reached - 1e-9)
        // By every turn, at least as many games have the part as the board.
        let partSoFar = 0
        let wholeSoFar = 0
        part.byTurn.forEach((share, i) => {
          partSoFar += share
          wholeSoFar += order.byTurn[i]
          expect(partSoFar).toBeGreaterThanOrEqual(wholeSoFar - 1e-9)
        })
      }
    }
  })

  it('averages the two orders for each part', () => {
    for (const part of result.parts) {
      const first = result.goingFirst.parts.find((p) => p.id === part.id)!
      const second = result.goingSecond.parts.find((p) => p.id === part.id)!
      part.byTurn.forEach((share, i) => {
        expect(share).toBeCloseTo((first.byTurn[i] + second.byTurn[i]) / 2, 10)
      })
    }
  })
}, 120_000)

describe('example games', () => {
  const cards = load('dragapult-munkidori')
  const g = goal({ active: slot('a', keyOf(cards, 'Drakloak')) })
  const result = turnsTest(cards, g, labelFor(cards), { trials: 60, seed: 4 })

  it('lists them fastest first', () => {
    const turns = result.examples.map((e) => e.turn)
    expect(turns).toEqual([...turns].sort((a, b) => a - b))
    expect(result.examples.length).toBeGreaterThan(0)
  })

  it('has one for every turn, and order, that some game built the board on', () => {
    for (const [order, goingFirst] of [
      [result.goingFirst, true],
      [result.goingSecond, false],
    ] as const) {
      order.byTurn.forEach((share, i) => {
        const shown = result.examples.filter((e) => e.turn === i + 1 && e.goingFirst === goingFirst)
        expect(shown).toHaveLength(share > 0 ? 1 : 0)
      })
    }
  })

  it('plays each one turn by turn up to the turn it got there', () => {
    for (const example of result.examples) {
      expect(example.turns.map((t) => t.turn)).toEqual(
        Array.from({ length: example.turn }, (_, i) => i + 1),
      )
      // Each later turn opens with its draw, and every step has a frame.
      for (const turn of example.turns) {
        expect(turn.frames.length).toBeGreaterThan(0)
        if (turn.turn > 1) expect(turn.steps[0]).toBe(`Turn ${turn.turn}: draw a card`)
      }
      // Evolving is how a Drakloak board is built.
      const all = example.turns.flatMap((t) => t.steps).join('\n')
      expect(all).toMatch(/Evolve .+ into Drakloak|evolving .+ into Drakloak/)
    }
  })
}, 120_000)

describe('luck', () => {
  const cards = load('dragapult-munkidori')
  const g = goal({ active: slot('a', keyOf(cards, 'Drakloak')) })
  const result = turnsTest(cards, g, labelFor(cards), { trials: 40, seed: 6 })

  it('puts the typical game at the median', () => {
    const typical = result.luck.percentiles.find((p) => p.share === 0.5)!.turn
    expect(typical).toBe(result.median)
  })

  it('accounts for every game in each grouping', () => {
    for (const factor of result.luck.factors) {
      const total = factor.buckets.reduce((sum, b) => sum + b.share, 0)
      expect(total).toBeCloseTo(1, 10)
    }
  })
}, 120_000)
