import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { addChoice, setSupporterFree } from '../src/lib/board/edit'
import { emptyGoal, goalIsEmpty, scoreBoard, type FieldGoal } from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import { playtest } from '../src/lib/sim/playtest'

// "Supporter still free": the board counts only with the turn's Supporter unplayed.

const view = (supporterUsed: boolean) => ({ active: null, bench: [], stadiumKey: null, hand: [], supporterUsed })

describe('the Supporter-still-free condition', () => {
  const goal = setSupporterFree(emptyGoal(), true)

  it('is a part of its own, met only while the Supporter is unplayed', () => {
    expect(goalIsEmpty(goal)).toBe(false)
    expect(scoreBoard(goal, view(false), (k) => k).strict).toBe(true)
    expect(scoreBoard(goal, view(true), (k) => k).strict).toBe(false)
    expect(goalIsEmpty(setSupporterFree(goal, false))).toBe(true)
  })

  it('takes a priority like any other condition', () => {
    const relaxed: FieldGoal = { ...goal, benchMin: 1, priorities: { supporterFree: 3 } }
    const score = scoreBoard(relaxed, { ...view(true), bench: [{ cardKey: 'x', energy: [], tools: [] }] }, (k) => k)
    expect(score.strict).toBe(false)
    // Every essential part is met; only the nice-to-have Supporter is missing.
    expect(score.tier).toBe(2)
  })

  it('can be one side of an either/or', () => {
    const either = addChoice({ ...goal, handMin: 9 }, [['supporterFree'], ['handMin']])
    expect(scoreBoard(either, { ...view(true), hand: Array(9).fill('c') }, (k) => k).strict).toBe(true)
    expect(scoreBoard(either, view(false), (k) => k).strict).toBe(true)
    expect(scoreBoard(either, view(true), (k) => k).strict).toBe(false)
  })

  it('is never met going first on turn 1, when no Supporter can be played anyway', () => {
    const cards = resolveDeck(readFileSync(resolve('tests/fixtures/mega-kangaskhan.txt'), 'utf8')).cards
    const kangaskhan = cards.find((c) => c.label === 'Mega Kangaskhan ex')!.key
    const board: FieldGoal = {
      ...goal,
      active: { id: 'a', cardKey: kangaskhan, energy: [], tools: [] },
    }
    const result = playtest(cards, board, (k) => k, { trials: 60, seed: 5 })
    expect(result.goingFirst.strict).toBe(0)
    // Going second it is often met: the Kangaskhan without spending the Supporter.
    expect(result.goingSecond.strict).toBeGreaterThan(0.3)
  })
})
