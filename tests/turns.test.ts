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
