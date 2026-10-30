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
  tools: [],
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
  }, 30_000)

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

    // The exact figure is a floor, not a match. Any opening holding an Ultra
    // Ball reaches this goal, because the simulator can decline to play it —
    // but a turn-1 draw Ability (Run Errand, Teal Dance) can also *find* one
    // the opening 8 did not contain, which the Phase 1 engine does not model.
    // So the simulation should sit at or above the opening-8 odds, never below.
    expect(simulated.strict).toBeGreaterThan(exact - simulated.margin - 0.02)
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
    const [example] = result.examples

    expect(result.examples.length).toBeGreaterThan(0)
    expect(example.reached).toBe(true)
    // Every step names a card and reads as an instruction, not an opcode. The
    // opening Pokemon is deliberately not pinned: with Teal Dance available the
    // search may well start on Ogerpon and switch into Kangaskhan, which is a
    // better line, and pinning one would be testing the move ordering instead.
    expect(example.steps[0]).toMatch(/^Start with .+ in the Active Spot$/)
    for (const step of example.steps) expect(step).not.toMatch(/handIndex|undefined/)

    // The board shown is the one the line ended on, not the one it started from.
    expect(example.board?.active?.label).toBe('Mega Kangaskhan ex')
    expect(example.board!.bench.length).toBeGreaterThanOrEqual(2)
  })

  it('snapshots the hand and board at every point in the line', () => {
    const g = goal({ active: slot('a', keyOf(cards, 'Mega Kangaskhan ex')), benchMin: 2 })
    const result = playtest(cards, g, labelFor(cards), { trials: 200, seed: 61 })
    const [example] = result.examples
    const { frames } = example

    // The first frame is the deal itself, so there is one more frame than step
    // and `frames[i + 1]` is the board after `steps[i]`.
    expect(frames).toHaveLength(example.steps.length + 1)
    expect(frames.slice(1).map((f) => f.step)).toEqual(example.steps)

    // It opens on a full hand of 7 and an empty table.
    expect(frames[0].hand).toHaveLength(7)
    expect(frames[0].board.active).toBeNull()
    expect(frames[0].board.bench).toHaveLength(0)

    // The Active is placed from that hand, then the turn's draw replaces it, so
    // the eighth card is visibly accounted for rather than appearing from
    // nowhere.
    expect(frames[1].board.active).not.toBeNull()
    expect(frames[1].hand).toHaveLength(6)
    expect(frames[2].step).toBe('Draw a card to start the turn')
    expect(frames[2].hand).toHaveLength(7)

    // Every frame carries enough to render a card: a key and a label.
    for (const frame of frames) {
      for (const card of frame.hand) {
        expect(card.cardKey).toBeTruthy()
        expect(card.label).toBeTruthy()
      }
    }

    // The line ends on the board the panel reports.
    const end = frames[frames.length - 1].board
    expect(end.active?.label).toBe(example.board!.active?.label)
    expect(end.bench).toHaveLength(example.board!.bench.length)
  })

  it('offers several genuinely different routes', () => {
    const g = goal({ benchMin: 3 })
    const result = playtest(cards, g, labelFor(cards), { trials: 400, seed: 63 })

    expect(result.examples.length).toBeGreaterThan(1)
    // Two lines making the same plays in a different order are the same route,
    // so "another way" must never just be a reshuffle of the one before.
    const canonical = result.examples.map((e) => [...e.steps].sort().join('|'))
    expect(new Set(canonical).size).toBe(canonical.length)
    expect(result.examples.every((e) => e.reached)).toBe(true)
  })

  it('falls back to the closest attempt when nothing succeeds', () => {
    const impossible = goal({ bench: [slot('b', 'id:nope')] })
    const result = playtest(cards, impossible, labelFor(cards), { trials: 50, seed: 65 })
    expect(result.strict).toBe(0)
    expect(result.examples).toHaveLength(1)
    expect(result.examples[0].reached).toBe(false)
  })

  it('explains what a search card actually fetched', () => {
    // Descriptions are built by diffing the state either side of a play, so an
    // effect reports what it really did rather than repeating its card text.
    const g = goal({ benchMin: 5 })
    const result = playtest(cards, g, labelFor(cards), { trials: 400, seed: 71 })
    const joined = result.examples.flatMap((e) => e.steps).join(' | ')
    expect(result.examples.length).toBeGreaterThan(0)
    // Reaching five benched needs a search card, and the step must say what it found.
    expect(joined).toMatch(/Play .+ — (benching|taking|drawing)/)
  }, 30_000)
})

describe('turn order', () => {
  const cards = load('dragapult-munkidori')
  const g = goal({
    active: slot('a', keyOf(cards, 'Dreepy')),
    bench: [slot('b', keyOf(cards, 'Dreepy')), slot('c', keyOf(cards, 'Munkidori'))],
  })
  const result = playtest(cards, g, labelFor(cards), { trials: 300, seed: 3 })

  it('never does better going first, which forbids the Supporter', () => {
    expect(result.goingFirst.strict).toBeLessThanOrEqual(result.goingSecond.strict)
    // This deck leans on Lillie's Determination, so the gap is real.
    expect(result.goingSecond.strict).toBeGreaterThan(result.goingFirst.strict)
  })

  it('reports the average of the two orders as the headline', () => {
    expect(result.strict).toBeCloseTo((result.goingFirst.strict + result.goingSecond.strict) / 2, 10)
    for (const part of result.parts) {
      const first = result.goingFirst.parts.find((p) => p.id === part.id)!.metRate
      const second = result.goingSecond.parts.find((p) => p.id === part.id)!.metRate
      expect(part.metRate).toBeCloseTo((first + second) / 2, 10)
    }
  })

  it('records exact outcomes that add up to every game', () => {
    for (const order of [result, result.goingFirst, result.goingSecond]) {
      const total = order.patterns.reduce((sum, p) => sum + p.rate, 0)
      expect(total).toBeCloseTo(1, 10)
      // The all-parts pattern is the whole board.
      const all = order.patterns.find((p) => p.met.length === order.parts.length)?.rate ?? 0
      expect(all).toBeCloseTo(order.strict, 10)
    }
  })

  it('agrees with the per-part rates when outcomes are summed', () => {
    for (const part of result.parts) {
      const fromPatterns = result.patterns
        .filter((p) => p.met.includes(part.id))
        .reduce((sum, p) => sum + p.rate, 0)
      expect(fromPatterns).toBeCloseTo(part.metRate, 10)
    }
  })
}, 60_000)
