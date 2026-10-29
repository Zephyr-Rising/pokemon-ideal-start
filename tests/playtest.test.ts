import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { emptyGoal, type FieldGoal, type SlotGoal } from '../src/lib/board/goal'
import { analyze, type Condition } from '../src/lib/prob/analyze'
import { playtest } from '../src/lib/sim/playtest'
import { resolveDeck } from '../src/lib/resolve-cards'
import type { DeckCard } from '../src/lib/types'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const load = (name: string) => resolveDeck(readFileSync(resolve(FIXTURES, `${name}.txt`), 'utf8')).cards

const labelFor = (cards: DeckCard[]) => (key: string) =>
  cards.find((c) => c.key === key)?.label ?? key

const keyOf = (cards: DeckCard[], label: string): string => {
  const card = cards.find((c) => c.label === label)
  if (!card) throw new Error(`fixture missing card: ${label}`)
  return card.key
}

const slot = (id: string, cardKey: string, energy = 0): SlotGoal => ({
  id,
  cardKey,
  energy,
  energyType: null,
})

const goal = (over: Partial<FieldGoal> = {}): FieldGoal => ({ ...emptyGoal(), ...over })

describe('playtest basics', () => {
  const cards = load('mega-kangaskhan')

  it('reports a defined probability with a margin', () => {
    const g = goal({ active: slot('a', keyOf(cards, 'Mega Kangaskhan ex')) })
    const result = playtest(cards, g, labelFor(cards), { trials: 300, seed: 5 })

    expect(result.trials).toBe(300)
    expect(result.strict).toBeGreaterThan(0)
    expect(result.strict).toBeLessThanOrEqual(1)
    expect(result.margin).toBeGreaterThan(0)
    expect(result.closeness).toBeGreaterThanOrEqual(result.strict)
  })

  it('is reproducible for a given seed, and varies with the seed', () => {
    const g = goal({ benchMin: 3 })
    const a = playtest(cards, g, labelFor(cards), { trials: 200, seed: 11 })
    const b = playtest(cards, g, labelFor(cards), { trials: 200, seed: 11 })
    expect(a.strict).toBe(b.strict)

    const c = playtest(cards, g, labelFor(cards), { trials: 200, seed: 12 })
    // Different seeds should agree closely but not be bit-identical.
    expect(Math.abs(a.strict - c.strict)).toBeLessThan(0.15)
  })

  it('treats an empty goal as always reached', () => {
    const result = playtest(cards, emptyGoal(), labelFor(cards), { trials: 50 })
    expect(result.strict).toBe(1)
  })

  it('names the cards it cannot play', () => {
    const result = playtest(cards, goal({ benchMin: 1 }), labelFor(cards), { trials: 20 })
    // Boss's Orders only moves the opponent's Pokémon, so it is correctly inert.
    expect(result.ignored).toContain("Boss's Orders")
    // Ultra Ball is implemented, so it must not be listed.
    expect(result.ignored).not.toContain('Ultra Ball')
  })

  it('breaks the result down by part', () => {
    const g = goal({
      active: slot('a', keyOf(cards, 'Mega Kangaskhan ex')),
      benchMin: 4,
    })
    const result = playtest(cards, g, labelFor(cards), { trials: 200, seed: 3 })
    expect(result.parts).toHaveLength(2)
    // Every part is reached at least as often as the whole goal.
    for (const part of result.parts) {
      expect(part.metRate).toBeGreaterThanOrEqual(result.strict - 1e-9)
    }
  })
})

describe('monotonicity', () => {
  const cards = load('dragapult-munkidori')

  it('adding a requirement never raises the probability', () => {
    const dreepy = keyOf(cards, 'Dreepy')
    const small = goal({ active: slot('a', dreepy) })
    const large = goal({ active: slot('a', dreepy), benchMin: 4 })

    const a = playtest(cards, small, labelFor(cards), { trials: 300, seed: 21 })
    const b = playtest(cards, large, labelFor(cards), { trials: 300, seed: 21 })
    expect(b.strict).toBeLessThanOrEqual(a.strict + 1e-9)
  })

  it('scores zero for a board the deck cannot build', () => {
    const impossible = goal({ bench: [slot('b', 'id:does-not-exist')] })
    const result = playtest(cards, impossible, labelFor(cards), { trials: 50 })
    expect(result.strict).toBe(0)
  })
})

describe('agreement with the exact Phase 1 engine', () => {
  // The strongest check that the simulator has not drifted: a goal needing no
  // plays at all is pure hand contents, which Phase 1 computes exactly.
  const cards = load('mega-kangaskhan')

  it('matches the exact odds of simply holding a card', () => {
    const ultra = keyOf(cards, 'Ultra Ball')

    // "Still holding an Ultra Ball at end of turn" is reached by any opening
    // that contains one — the simulator can always choose not to play it.
    const g = goal({ inHand: [{ id: 'h', cardKey: ultra, count: 1 }] })
    const simulated = playtest(cards, g, labelFor(cards), { trials: 4000, seed: 31 })

    const condition: Condition = [
      {
        id: 'route',
        label: 'Route',
        requirements: [
          {
            id: 'r',
            label: 'Ultra Ball',
            options: [{ id: 'o', cardKeys: [ultra], op: 'atLeast', n: 1 }],
          },
        ],
      },
    ]
    const exact = analyze(cards, condition).firstLook!

    // Within the simulation's own stated margin, plus a little slack for the
    // margin being an estimate too.
    expect(Math.abs(simulated.strict - exact)).toBeLessThan(simulated.margin + 0.02)
  }, 30_000)

  it('matches the exact mulligan rate', () => {
    const result = playtest(cards, goal({ benchMin: 1 }), labelFor(cards), {
      trials: 4000,
      seed: 41,
    })
    const exact = analyze(cards, []).mulliganRate
    expect(Math.abs(result.mulliganRate - exact)).toBeLessThan(0.02)
  }, 30_000)
})

describe('the simulator actually plays cards', () => {
  const cards = load('mega-kangaskhan')

  it('benches more Pokémon than an opening hand alone would hold', () => {
    // Filling four bench slots usually needs Ultra Ball or Poffin to find more
    // Basics, so a materially better figure than the raw hand odds is evidence
    // the effects are firing.
    const g = goal({ benchMin: 4 })
    const result = playtest(cards, g, labelFor(cards), { trials: 600, seed: 51 })
    expect(result.strict).toBeGreaterThan(0.2)
  }, 30_000)

  it('reports an example line of play, in readable steps', () => {
    const g = goal({ active: slot('a', keyOf(cards, 'Mega Kangaskhan ex')), benchMin: 2 })
    const result = playtest(cards, g, labelFor(cards), { trials: 200, seed: 61 })

    expect(result.exampleSteps.length).toBeGreaterThan(0)
    expect(result.exampleReached).toBe(true)
    // Every step names a card and reads as an instruction, not an opcode.
    expect(result.exampleSteps[0]).toMatch(/^Start with Mega Kangaskhan ex in the Active Spot$/)
    for (const step of result.exampleSteps) expect(step).not.toMatch(/handIndex|undefined/)

    // The board shown is the one the line ended on, not the one it started from.
    expect(result.exampleBoard?.active?.label).toBe('Mega Kangaskhan ex')
    expect(result.exampleBoard!.bench.length).toBeGreaterThanOrEqual(2)
  })

  it('explains what a search card actually fetched', () => {
    // Descriptions are built by diffing the state either side of a play, so an
    // effect reports what it really did rather than repeating its card text.
    const g = goal({ benchMin: 5 })
    const result = playtest(cards, g, labelFor(cards), { trials: 400, seed: 71 })
    const joined = result.exampleSteps.join(' | ')
    expect(result.exampleSteps.length).toBeGreaterThan(0)
    // Reaching five benched needs a search card, and the step must say what it found.
    expect(joined).toMatch(/Play .+ — (benching|taking|drawing)/)
  })
})
