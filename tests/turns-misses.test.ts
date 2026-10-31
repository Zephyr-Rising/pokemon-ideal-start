import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { emptyGoal, type FieldGoal } from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import { turnsTest } from '../src/lib/sim/turns'

// The breakdown of games that never built the board must account for every
// one of them: the prizes, or how far a game played out got.

describe('games not built by the last turn', () => {
  const cards = resolveDeck(readFileSync(resolve('tests/fixtures/mega-kangaskhan.txt'), 'utf8')).cards
  const key = (label: string) => cards.find((c) => c.label === label)!.key
  // One copy of Raging Bolt ex: often prized, so both kinds of miss show up.
  const goal: FieldGoal = {
    ...emptyGoal(),
    active: { id: 'a', cardKey: key('Raging Bolt ex'), energy: ['{L}', '{F}'], tools: [] },
  }
  const label = (k: string) => cards.find((c) => c.key === k)?.label ?? k
  const result = turnsTest(cards, goal, label, { trials: 40, seed: 3 })
  const { misses } = result

  it('are every game that was not built', () => {
    expect(misses.share).toBeCloseTo(1 - result.reached, 10)
    expect(misses.games).toBeGreaterThan(0)
  })

  it('split into prized and played-out games with nothing left over', () => {
    const playedOut = misses.completion.reduce((sum, level) => sum + level.share, 0)
    expect(misses.prized + playedOut).toBeCloseTo(1, 10)
    expect(misses.prized).toBeGreaterThan(0)
  })

  it('name the prized card among the outcomes', () => {
    expect(misses.shortfalls.some((s) => s.prized && s.missing.includes('Raging Bolt ex'))).toBe(true)
  })
})
