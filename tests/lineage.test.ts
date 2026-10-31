import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { emptyGoal, type FieldGoal } from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import '../src/lib/sim/actions'
import { buildContext } from '../src/lib/sim/context'
import { lookupEffect } from '../src/lib/sim/effects'
import { boardRequirements } from '../src/lib/sim/prizes'
import { inPlay, type SimState } from '../src/lib/sim/state'

// A Stage 2 whose Stage 1 the deck does not run — Empoleon ex, played with Rare
// Candy onto Piplup, with no Prinplup in the list.

const cards = resolveDeck(readFileSync(resolve('tests/fixtures/metal-petrel.txt'), 'utf8')).cards
const byLabel = (label: string) => cards.find((card) => card.label === label)!
const empoleon = byLabel('Empoleon ex')
const piplup = byLabel('Piplup')
const candy = byLabel('Rare Candy')
const goal: FieldGoal = { ...emptyGoal(), active: { id: 'a', cardKey: empoleon.key, energy: [], tools: [] } }

describe('an evolution line with a stage the deck does not run', () => {
  it('knows its earlier stages from the card database', () => {
    expect(empoleon.lineage).toEqual(['Prinplup', 'Piplup'])
  })

  it('lets Rare Candy evolve the Basic straight into the Stage 2', () => {
    const state: SimState = {
      hand: [empoleon],
      deck: [],
      discard: [],
      prizes: [],
      active: { ...inPlay(piplup), fresh: false },
      bench: [],
      stadium: null,
      usedEnergy: false,
      usedSupporter: false,
      usedStadium: false,
      usedRetreat: false,
      usedAbilities: [],
      turn: 2,
    }
    const ctx = buildContext(goal, () => 0.5, 1, cards)
    const boards = lookupEffect(candy)!(state, ctx)
    expect(boards.some((board) => board.active?.card.key === empoleon.key)).toBe(true)
  })

  it('needs the Basic underneath for the board to be possible', () => {
    const labels = boardRequirements(goal, cards, (k) => k).map((r) => r.label)
    expect(labels).toContain('Piplup')
  })
})
