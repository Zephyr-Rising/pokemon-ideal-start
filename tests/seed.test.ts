import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { summarize } from '../src/lib/deck-tags'
import { analyze } from '../src/lib/prob/analyze'
import { sensitivity } from '../src/lib/prob/sensitivity'
import { resolveDeck } from '../src/lib/resolve-cards'
import { seedCondition } from '../src/lib/seed-condition'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const load = (name: string) => resolveDeck(readFileSync(resolve(FIXTURES, `${name}.txt`), 'utf8'))

/** Every real decklist on hand. */
const ALL_DECKS = [
  'mega-kangaskhan',
  'festival-lead',
  'dragapult-blaziken',
  'slowking',
  'dragapult-munkidori',
  'slowking-metagross',
  'ns-zoroark',
  'alakazam',
]

/** Display labels of the cards in a seeded row. */
function rowCards(deckName: string, index = 0): string[] {
  const deck = load(deckName)
  const row = seedCondition(deck.cards)[index]
  return row.cardKeys.map((key) => deck.cards.find((c) => c.key === key)!.label)
}

describe('seedCondition', () => {
  it('builds sensible rows for the example deck', () => {
    const deck = load('mega-kangaskhan')
    const rows = seedCondition(deck.cards)
    const labels = rows.map((r) => r.label)

    expect(labels).toContain('Main starter')
    expect(labels).toContain('Pokémon search')
    expect(labels).toContain('Energy')
    expect(rows.every((r) => r.op === 'atLeast' && r.n === 1)).toBe(true)
    expect(rows.every((r) => r.cardKeys.length > 0)).toBe(true)
  })

  // The main line is inferred from copy count, NOT from whether the payoff is a
  // Pokémon ex: a list commits its slots to what it means to start with. An
  // ex-gated rule missed Abra for Alakazam and Slowpoke for Slowking entirely.
  it.each([
    ['mega-kangaskhan', ['Mega Kangaskhan ex']], // Basic attacker, no evolution line
    ['ns-zoroark', ["N's Zorua"]], //               Stage 1 ex payoff
    ['dragapult-munkidori', ['Dreepy']], //         Stage 2 ex payoff, two steps back
    ['alakazam', ['Abra']], //                      Stage 2, NOT an ex
    ['slowking', ['Slowpoke']], //                  Stage 1, NOT an ex
    ['festival-lead', ['Grookey', 'Applin']], //    two lines tied on copies, no ex at all
    ['slowking-metagross', ['Slowpoke', 'Mega Kangaskhan ex']],
  ])('picks the main starter for %s', (deck, expected) => {
    expect(rowCards(deck).sort()).toEqual([...expected].sort())
  })

  it('names the Basic, never an evolution that cannot be played turn one', () => {
    expect(rowCards('ns-zoroark')).not.toContain("N's Zoroark ex")
    expect(rowCards('dragapult-munkidori')).not.toContain('Drakloak')
    expect(rowCards('dragapult-munkidori')).not.toContain('Dragapult ex')
    expect(rowCards('alakazam')).not.toContain('Alakazam')
  })

  it('never seeds a row whose group is empty', () => {
    for (const name of ALL_DECKS) {
      const deck = load(name)
      for (const row of seedCondition(deck.cards)) {
        expect(row.cardKeys.length).toBeGreaterThan(0)
      }
    }
  })

  it('produces a plausible, defined probability on every fixture deck', () => {
    for (const name of ALL_DECKS) {
      const deck = load(name)
      const result = analyze(deck.cards, seedCondition(deck.cards))

      expect(result.impossible).toBe(false)
      expect(result.firstLook).not.toBeNull()
      expect(result.firstLook!).toBeGreaterThan(0)
      expect(result.firstLook!).toBeLessThanOrEqual(1)
      // More cards seen can only help an all-"at least" condition.
      expect(result.firstLook!).toBeGreaterThanOrEqual(result.openingHand!)
    }
  })
})

describe('deck summary', () => {
  it('categorises the example deck to its printed section counts', () => {
    const deck = load('mega-kangaskhan')
    const summary = summarize(deck)
    // The export declares Pokémon: 21, Trainer: 24, Energy: 15.
    expect(summary).toMatchObject({
      total: 60,
      pokemon: 21,
      trainer: 24,
      energy: 15,
      basics: 21,
      unknown: 0,
    })
  })

  it('accounts for all 60 cards in every fixture deck', () => {
    for (const name of ALL_DECKS) {
      const summary = summarize(load(name))
      expect(summary.total).toBe(60)
      // Unrecognised cards are still counted, so the categories plus the
      // unknowns must always reconcile to the full deck.
      expect(summary.pokemon + summary.trainer + summary.energy + summary.unknown).toBe(60)
    }
  })
})

describe('end-to-end shape', () => {
  it('produces a ranked sensitivity table for the example deck', () => {
    const deck = load('mega-kangaskhan')
    const requirements = seedCondition(deck.cards)
    const rows = sensitivity(deck.cards, requirements)

    expect(rows.length).toBeGreaterThan(0)
    // Every row must belong to a requirement group or be a Basic Pokémon.
    const grouped = new Set(requirements.flatMap((r) => r.cardKeys))
    for (const row of rows) {
      const card = deck.cards.find((c) => c.key === row.key)!
      expect(grouped.has(row.key) || card.tags.includes('basic')).toBe(true)
    }
  })
})
