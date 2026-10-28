import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { norm } from '../src/lib/normalize'
import { parseDecklist } from '../src/lib/parse-decklist'
import { resolveDeck } from '../src/lib/resolve-cards'
import { cardDbMeta } from '../src/lib/card-db'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name: string) => readFileSync(resolve(FIXTURES, `${name}.txt`), 'utf8')

describe('norm', () => {
  it('deletes straight and curly apostrophes alike', () => {
    // The whole point: the card data uses curly, PTCG Live uses straight.
    expect(norm("Ciphermaniac's Codebreaking")).toBe('ciphermaniacs codebreaking')
    expect(norm('Ciphermaniac’s Codebreaking')).toBe('ciphermaniacs codebreaking')
    expect(norm("Boss's Orders")).toBe('bosss orders')
  })

  it('ASCII-folds accented characters', () => {
    expect(norm('Poké Pad')).toBe('poke pad')
    expect(norm('Pokémon')).toBe('pokemon')
  })

  it('collapses punctuation and whitespace to single spaces', () => {
    expect(norm('Buddy-Buddy  Poffin')).toBe('buddy buddy poffin')
    expect(norm('Basic {G} Energy')).toBe('basic g energy')
  })
})

describe('parseDecklist', () => {
  it('skips section headers and blank lines', () => {
    const { lines, badLines } = parseDecklist(fixture('mega-kangaskhan'))
    expect(badLines).toEqual([])
    expect(lines).toHaveLength(27)
  })

  it('parses count, name, set and number', () => {
    const { lines } = parseDecklist('4 Mega Kangaskhan ex MEG 104')
    expect(lines[0]).toMatchObject({ count: 4, name: 'Mega Kangaskhan ex', set: 'MEG', num: '104' })
  })

  it('keeps multi-word names with apostrophes intact', () => {
    const { lines } = parseDecklist("1 Ciphermaniac's Codebreaking TEF 145")
    expect(lines[0]).toMatchObject({ count: 1, name: "Ciphermaniac's Codebreaking", set: 'TEF' })
  })

  it('accepts a line with no printing', () => {
    const { lines, badLines } = parseDecklist("4 Professor's Research")
    expect(badLines).toEqual([])
    expect(lines[0]).toMatchObject({ count: 4, name: "Professor's Research", set: '', num: '' })
  })

  it('reports lines it cannot parse at all', () => {
    const { lines, badLines } = parseDecklist('Pokémon: 21\n\nnot a card line\n4 Ultra Ball MEG 131')
    expect(lines).toHaveLength(1)
    expect(badLines).toEqual(['not a card line'])
  })
})

describe('resolveDeck', () => {
  it('resolves the example deck to a legal 60 with 21 Basics', () => {
    const deck = resolveDeck(fixture('mega-kangaskhan'))

    expect(deck.totalCards).toBe(60)
    expect(deck.unresolvedCards).toBe(0)
    expect(deck.badLines).toEqual([])

    const basics = deck.cards
      .filter((c) => c.tags.includes('basic'))
      .reduce((sum, c) => sum + c.count, 0)
    expect(basics).toBe(21)
  })

  // Eight real decklists. Since the card data comes from TCGdex's Standard pool,
  // every card in every deck resolves by its exact printing.
  it.each([
    'mega-kangaskhan',
    'festival-lead',
    'dragapult-blaziken',
    'slowking',
    'dragapult-munkidori',
    'slowking-metagross',
    'ns-zoroark',
    'alakazam',
  ])('resolves every card in %s', (name) => {
    const deck = resolveDeck(fixture(name))
    expect(deck.totalCards).toBe(60)
    expect(deck.badLines).toEqual([])
    expect(deck.unresolvedCards).toBe(0)
    // A set/number that names a different card is never accepted silently.
    expect(deck.conflicts).toEqual([])
    // Only the basic-Energy colour map may fall back; nothing guesses by name.
    for (const entry of deck.entries) {
      expect(['exact', 'basic-energy']).toContain(entry.method)
    }
  })

  it('parses a set code that starts with a digit', () => {
    // `Mew ex 30C 66` — the original [A-Z]{2,4} pattern swallowed '30C' into
    // the card name, which lost both the printing and the card's identity.
    const { lines } = parseDecklist('1 Mew ex 30C 66')
    expect(lines[0]).toMatchObject({ count: 1, name: 'Mew ex', set: '30C', num: '66' })
  })

  it('resolves a card an older data source had wrong', () => {
    // Two real decklists carry `Telepathic Psychic Energy POR 88`. An earlier
    // CSV listed POR 88 as a different card under a different name; TCGdex has
    // the real one, so this now matches exactly with no alias needed.
    const deck = resolveDeck('4 Telepathic Psychic Energy POR 88')
    expect(deck.entries[0].method).toBe('exact')
    expect(deck.cards[0].resolvedName).toBe('Telepathic Psychic Energy')
    expect(deck.cards[0].tags).toContain('special-energy')
    expect(deck.conflicts).toEqual([])
  })

  it('does not accept a printing whose name disagrees', () => {
    // Matching on number alone would silently substitute an unrelated card.
    const mismatch = resolveDeck('1 Some Nonexistent Card POR 88')
    expect(mismatch.entries[0].method).toBe('printing-conflict')
    expect(mismatch.conflicts).toHaveLength(1)
  })

  it('reports a real card that is not Standard legal', () => {
    // Far more useful than calling a card nobody mistyped "unknown".
    const deck = resolveDeck('1 Iron Hands ex PAR 70')
    expect(deck.entries[0].method).toBe('not-standard')
    expect(deck.nonStandard).toEqual(['Iron Hands ex'])
    expect(deck.totalCards).toBe(1) // still counted
  })

  it('maps basic Energy printed under an absent set via the colour map', () => {
    const deck = resolveDeck('6 Grass Energy MEE 9')
    const [card] = deck.cards
    expect(card.count).toBe(6)
    expect(card.resolvedName).toBe('Grass Energy')
    expect(deck.entries[0].method).toBe('basic-energy')
    // Display keeps what the player wrote.
    expect(card.label).toBe('Grass Energy')
  })

  it('does not mistake a special Energy for a basic one', () => {
    // 'Growing Grass Energy' contains 'Grass Energy' but is a different card,
    // and its exact printing must win over the colour map.
    const deck = resolveDeck('1 Growing Grass Energy POR 86')
    expect(deck.entries[0].method).toBe('exact')
    expect(deck.cards[0].resolvedName).toBe('Growing Grass Energy')
    expect(deck.cards[0].tags).toContain('special-energy')
  })

  it('merges reprints of the same card into one DeckCard', () => {
    // Ultra Ball is printed in several sets with trivially different effect-text
    // formatting. If those counted as different cards, a deck running two
    // printings would split its copies and every Ultra Ball probability would
    // be wrong.
    const deck = resolveDeck('4 Ultra Ball MEG 131\n1 Ultra Ball ASC 213')
    expect(deck.cards).toHaveLength(1)
    expect(deck.cards[0].count).toBe(5)
    expect(deck.cards[0].printings).toEqual(['MEG 131', 'ASC 213'])
  })

  it('falls back to another printing by name, with a warning', () => {
    // SVI has rotated out of Standard so that printing is absent, but the card
    // is still legal under a newer one.
    const deck = resolveDeck('1 Ultra Ball SVI 196')
    expect(deck.entries[0].method).toBe('name-fallback')
    expect(deck.cards[0].resolvedName).toBe('Ultra Ball')
    expect(deck.warnings).toHaveLength(1)
  })


  it('counts unknown cards even though they carry no metadata', () => {
    const deck = resolveDeck('3 Totally Made Up Card XYZ 99\n4 Ultra Ball MEG 131')
    expect(deck.totalCards).toBe(7)
    expect(deck.unresolvedCards).toBe(3)
    const unknown = deck.cards.find((c) => c.label === 'Totally Made Up Card')
    expect(unknown).toMatchObject({ count: 3, card: null, tags: [] })
  })
})

describe('card database', () => {
  it('is the generated artefact we expect', () => {
    // Guards against a stale or truncated cards.json reaching the bundle.
    expect(cardDbMeta.cardCount).toBeGreaterThan(1400)
    expect(cardDbMeta.printingCount).toBeGreaterThan(3000)
    expect(cardDbMeta.sourceSha256.tcgdex).toMatch(/^[0-9a-f]{64}$/)
    expect(cardDbMeta.sourceSha256.csv).toMatch(/^[0-9a-f]{64}$/)
  })
})
