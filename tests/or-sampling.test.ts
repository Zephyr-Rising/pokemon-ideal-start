import { describe, expect, it } from 'vitest'

import {
  allOptions,
  analyze,
  type Condition,
  type Requirement,
  type RequirementOption,
  type RequirementOp,
} from '../src/lib/prob/analyze'
import { adjustLineCount } from '../src/lib/edit-decklist'
import { sampleHand } from '../src/lib/sample-hand'
import type { DeckCard } from '../src/lib/types'
import { bruteForceFirstLook, expandMasks, mulberry32 } from './oracles'

function dc(key: string, count: number, tags: string[] = []): DeckCard {
  return { key, label: key, resolvedName: null, count, card: null, printings: [], tags }
}

function req(
  id: string,
  cardKeys: string[],
  n: number,
  op: RequirementOp = 'atLeast',
): Requirement {
  // A plain requirement with one option. `optionsOf` builds multi-option ones.
  return { id, label: id, options: [{ id: `${id}-o`, cardKeys, op, n }] }
}

const alt = (id: string, ...requirements: Requirement[]) => ({ id, label: id, requirements })

/** A requirement satisfied by ANY of several differently-shaped tests. */
function anyOf(id: string, ...options: Omit<RequirementOption, 'id'>[]): Requirement {
  return {
    id,
    label: id,
    options: options.map((option, i) => ({ ...option, id: `${id}-o${i}` })),
  }
}

describe('OR conditions', () => {
  // Small enough to enumerate every hand, with routes that deliberately overlap.
  const cards = [dc('a', 3, ['basic']), dc('b', 2, ['basic']), dc('c', 2), dc('d', 7)]

  it('matches exhaustive enumeration for two routes', () => {
    const condition: Condition = [
      alt('route1', req('r1', ['a'], 1), req('r2', ['c'], 1)),
      alt('route2', req('r3', ['b'], 2)),
    ]
    const masks = expandMasks(cards, allOptions(condition))
    const result = analyze(cards, condition)
    expect(result.firstLook).toBeCloseTo(bruteForceFirstLook(masks, condition, 7)!, 12)
  })

  it('matches enumeration when routes share a card', () => {
    const condition: Condition = [
      alt('route1', req('r1', ['a', 'b'], 2)),
      alt('route2', req('r2', ['b', 'c'], 1), req('r3', ['d'], 1)),
    ]
    const masks = expandMasks(cards, allOptions(condition))
    expect(analyze(cards, condition).firstLook).toBeCloseTo(
      bruteForceFirstLook(masks, condition, 7)!,
      12,
    )
  })

  it('sits between the best single route and the sum of routes', () => {
    const condition: Condition = [
      alt('route1', req('r1', ['a'], 2)),
      alt('route2', req('r2', ['c'], 1)),
    ]
    const result = analyze(cards, condition)
    const best = Math.max(...result.perAlternative.map((a) => a.probability ?? 0))
    const sum = result.perAlternative.reduce((total, a) => total + (a.probability ?? 0), 0)
    expect(result.firstLook!).toBeGreaterThanOrEqual(best - 1e-12)
    // Strictly below the sum, because some hands satisfy both routes.
    expect(result.firstLook!).toBeLessThanOrEqual(sum + 1e-12)
  })

  it('is unchanged by adding a route that duplicates an existing one', () => {
    const one: Condition = [alt('x', req('r', ['a'], 1))]
    const twice: Condition = [alt('x', req('r', ['a'], 1)), alt('y', req('r2', ['a'], 1))]
    expect(analyze(cards, twice).firstLook).toBeCloseTo(analyze(cards, one).firstLook!, 12)
  })

  it('matches enumeration for an OR inside a requirement', () => {
    // "1 of a" or "2 of c" cannot be folded into one card group: the thresholds
    // differ. This is the case options exist for.
    const condition: Condition = [
      alt(
        'route',
        anyOf('either', { cardKeys: ['a'], op: 'atLeast', n: 1 }, { cardKeys: ['c'], op: 'atLeast', n: 2 }),
      ),
    ]
    const masks = expandMasks(cards, allOptions(condition))
    expect(analyze(cards, condition).firstLook).toBeCloseTo(
      bruteForceFirstLook(masks, condition, 7)!,
      12,
    )
  })

  it('an extra option can only make a requirement easier', () => {
    const narrow: Condition = [alt('r', req('x', ['a'], 2))]
    const wider: Condition = [
      alt('r', anyOf('x', { cardKeys: ['a'], op: 'atLeast', n: 2 }, { cardKeys: ['c'], op: 'atLeast', n: 1 })),
    ]
    expect(analyze(cards, wider).firstLook!).toBeGreaterThan(analyze(cards, narrow).firstLook!)
  })

  it('options and routes agree when they express the same thing', () => {
    // One requirement with two options == two routes each holding one of them,
    // as long as nothing else is required.
    const viaOptions: Condition = [
      alt('r', anyOf('x', { cardKeys: ['a'], op: 'atLeast', n: 1 }, { cardKeys: ['c'], op: 'atLeast', n: 2 })),
    ]
    const viaRoutes: Condition = [
      alt('r1', req('x1', ['a'], 1)),
      alt('r2', req('x2', ['c'], 2)),
    ]
    expect(analyze(cards, viaOptions).firstLook).toBeCloseTo(
      analyze(cards, viaRoutes).firstLook!,
      12,
    )
  })

  it('treats an empty condition as satisfied by any legal hand', () => {
    expect(analyze(cards, []).firstLook).toBe(1)
  })

  it('still reproduces the closed-form legal-hand rate across routes', () => {
    const condition: Condition = [
      alt('route1', req('r1', ['a'], 1)),
      alt('route2', req('r2', ['c'], 2, 'atMost')),
    ]
    const { diagnostics } = analyze(cards, condition)
    expect(diagnostics.legalOpening).toBeCloseTo(diagnostics.legalClosedForm, 12)
    expect(diagnostics.legalFirstLook).toBeCloseTo(diagnostics.legalClosedForm, 12)
  })
})

describe('sampleIdealHand', () => {
  const cards = [dc('target', 6, ['basic']), dc('filler', 54, ['basic'])]
  const condition: Condition = [alt('route', req('r', ['target'], 1))]

  it('returns a legal hand that meets the condition', () => {
    const hand = sampleHand(cards, condition, { rng: mulberry32(3) })
    expect(hand.found).toBe(true)
    expect(hand.opening).toHaveLength(7)
    expect(hand.drawn).not.toBeNull()
    expect(hand.opening.some((c) => c.tags.includes('basic'))).toBe(true)
    expect([...hand.opening, hand.drawn!].some((c) => c.key === 'target')).toBe(true)
  })

  it('samples uniformly from the conditional distribution', () => {
    // If hands are drawn uniformly from those meeting "at least 1 target", the
    // share that also holds 2+ must equal P(>=2) / P(>=1) from the exact maths.
    // A hand-picked or biased sampler would not land on that ratio.
    const rng = mulberry32(99)
    let two = 0
    const trials = 25_000
    for (let i = 0; i < trials; i++) {
      const hand = sampleHand(cards, condition, { rng })
      const all = [...hand.opening, ...(hand.drawn ? [hand.drawn] : [])]
      if (all.filter((c) => c.key === 'target').length >= 2) two++
    }
    const atLeastOne = analyze(cards, condition).firstLook!
    const atLeastTwo = analyze(cards, [alt('route', req('r', ['target'], 2))]).firstLook!
    expect(two / trials).toBeCloseTo(atLeastTwo / atLeastOne, 2)
  })

  it('satisfies a multi-route condition through either route', () => {
    const either: Condition = [
      alt('a', req('r1', ['target'], 3)),
      alt('b', req('r2', ['filler'], 7)),
    ]
    const hand = sampleHand(cards, either, { rng: mulberry32(11) })
    expect(hand.found).toBe(true)
    const all = [...hand.opening, ...(hand.drawn ? [hand.drawn] : [])]
    const targets = all.filter((c) => c.key === 'target').length
    const fillers = all.filter((c) => c.key === 'filler').length
    expect(targets >= 3 || fillers >= 7).toBe(true)
  })

  it('reports failure rather than a near miss when the start is unreachable', () => {
    const impossible: Condition = [alt('route', req('r', ['target'], 7))]
    const hand = sampleHand(cards, impossible, { rng: mulberry32(1), maxAttempts: 300 })
    expect(hand.found).toBe(false)
    expect(hand.opening).toEqual([])
  })
})

describe('adjustLineCount', () => {
  const deck = [
    'Pokémon: 6',
    '4 Dreepy TWM 128',
    '2 Budew ASC 16',
    '',
    'Trainer: 3',
    '3 Ultra Ball MEG 131',
  ].join('\n')

  it('increments and decrements a line', () => {
    expect(adjustLineCount(deck, '4 Dreepy TWM 128', 1)).toContain('5 Dreepy TWM 128')
    expect(adjustLineCount(deck, '4 Dreepy TWM 128', -1)).toContain('3 Dreepy TWM 128')
  })

  it('removes the line when the count reaches zero', () => {
    // The line's own text changes as its count drops, so follow it down.
    let text = adjustLineCount(deck, '2 Budew ASC 16', -1)
    expect(text).toContain('1 Budew ASC 16')
    text = adjustLineCount(text, '1 Budew ASC 16', -1)
    expect(text).not.toContain('Budew')
    expect(text).toContain('Dreepy')
  })

  it('keeps section headers in step', () => {
    // A stale "Pokémon: 6" after an edit is worse than no header at all.
    const text = adjustLineCount(deck, '4 Dreepy TWM 128', 1)
    expect(text).toContain('Pokémon: 7')
    expect(text).toContain('Trainer: 3')
  })

  it('leaves everything else untouched', () => {
    const text = adjustLineCount(deck, '3 Ultra Ball MEG 131', 1)
    expect(text).toContain('4 Dreepy TWM 128')
    expect(text).toContain('2 Budew ASC 16')
    expect(text).toContain('4 Ultra Ball MEG 131')
    expect(text).toContain('Trainer: 4')
  })

  it('leaves the text alone when the line is not found', () => {
    expect(adjustLineCount(deck, '4 Nonexistent ZZZ 1', 1)).toBe(deck)
  })
})
