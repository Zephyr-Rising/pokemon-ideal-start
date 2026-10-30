import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { toggleAlternative } from '../src/lib/board/edit'
import { emptyGoal, scoreBoard, type BoardView, type FieldGoal } from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import { playtest } from '../src/lib/sim/playtest'
import { boardRequirements, prizeLocks } from '../src/lib/sim/prizes'

const slot = (id: string, cardKey: string, alternatives?: string[]) => ({ id, cardKey, energy: [], tools: [], alternatives })
const view = (active: string | null, bench: string[], hand: string[] = [], stadiumKey: string | null = null): BoardView => ({
  active: active ? { cardKey: active, energy: [], tools: [] } : null,
  bench: bench.map((cardKey) => ({ cardKey, energy: [], tools: [] })),
  stadiumKey,
  hand,
})
const label = (k: string) => k

describe('either/or on the board', () => {
  it('meets a slot with any of its cards, and says so', () => {
    const g: FieldGoal = { ...emptyGoal(), active: slot('a', 'dragapult', ['drakloak']) }
    expect(scoreBoard(g, view('drakloak', []), label).strict).toBe(true)
    expect(scoreBoard(g, view('dreepy', []), label).strict).toBe(false)
    expect(scoreBoard(g, view(null, []), label).parts[0].label).toBe('dragapult or drakloak Active')
  })

  it('pairs the Bench so a flexible slot does not take what a strict one needs', () => {
    // One Munkidori, one Fezandipiti: "munki or fez" must not take the Munkidori.
    const g: FieldGoal = { ...emptyGoal(), bench: [slot('b1', 'munki', ['fez']), slot('b2', 'munki')] }
    expect(scoreBoard(g, view(null, ['munki', 'fez']), label).strict).toBe(true)
  })

  it('works for the Stadium and cards kept in hand', () => {
    const g: FieldGoal = {
      ...emptyGoal(),
      stadiumKey: 'forest',
      stadiumAlternatives: ['zero'],
      inHand: [{ id: 'h', cardKey: 'lillie', count: 1, alternatives: ['judge'] }],
    }
    expect(scoreBoard(g, view(null, [], ['judge'], 'zero'), label).strict).toBe(true)
    expect(scoreBoard(g, view(null, [], ['ultra'], 'zero'), label).strict).toBe(false)
  })

  it('toggles alternatives on and off', () => {
    let g: FieldGoal = { ...emptyGoal(), active: slot('a', 'x'), inHand: [{ id: 'h', cardKey: 'l', count: 1 }] }
    g = toggleAlternative(g, 'a', 'y')
    expect(g.active?.alternatives).toEqual(['y'])
    g = toggleAlternative(g, 'h', 'j')
    expect(g.inHand[0].alternatives).toEqual(['j'])
    g = toggleAlternative(g, 'a', 'y')
    expect(g.active?.alternatives).toEqual([])
  })
})

describe('either/or in the simulator', () => {
  const cards = resolveDeck(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dragapult-munkidori.txt'), 'utf8'),
  ).cards
  const key = (l: string) => cards.find((c) => c.label === l)!.key
  const lab = (k: string) => cards.find((c) => c.key === k)?.label ?? k
  const deck = cards.flatMap((c) => Array.from({ length: c.count }, () => c))
  const fez = cards.find((c) => c.label === 'Fezandipiti ex')!

  it('is only prize-locked when every alternative is', () => {
    const g: FieldGoal = { ...emptyGoal(), bench: [slot('f', key('Fezandipiti ex'), [key('Munkidori')])] }
    expect(prizeLocks(boardRequirements(g, cards, lab), deck, [fez])).toEqual([])
  })

  it('builds a board with an alternative at least as often as with one card', () => {
    const one: FieldGoal = { ...emptyGoal(), bench: [slot('f', key('Fezandipiti ex'))] }
    const either: FieldGoal = { ...emptyGoal(), bench: [slot('f', key('Fezandipiti ex'), [key('Munkidori')])] }
    const a = playtest(cards, one, lab, { trials: 150, seed: 2 }).strict
    const b = playtest(cards, either, lab, { trials: 150, seed: 2 }).strict
    expect(b).toBeGreaterThan(a)
  })
})
