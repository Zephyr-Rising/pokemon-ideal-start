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

  // Eight real decklists. `unresolved` records cards genuinely outside this
  // card pool (newer sets such as CRI and 30C); they must still count toward 60.
  it.each([
    ['mega-kangaskhan', 0],
    ['festival-lead', 0],
    ['dragapult-blaziken', 0],
    ['slowking', 0],
    ['dragapult-munkidori', 0],
    ['slowking-metagross', 1], // Mew ex 30C 66
    ['ns-zoroark', 1], //         Special Red Card CRI 82
    ['alakazam', 1], //           Special Red Card CRI 82
  ])('resolves %s to a parseable 60 with %i unresolved', (name, unresolved) => {
    const deck = resolveDeck(fixture(name))
    expect(deck.totalCards).toBe(60)
    expect(deck.badLines).toEqual([])
    expect(deck.unresolvedCards).toBe(unresolved)
    // A set/number that names a different card is never accepted silently.
    expect(deck.conflicts).toEqual([])
  })

  it('parses a set code that starts with a digit', () => {
    // `Mew ex 30C 66` — the original [A-Z]{2,4} pattern swallowed '30C' into
    // the card name, which lost both the printing and the card's identity.
    const { lines } = parseDecklist('1 Mew ex 30C 66')
    expect(lines[0]).toMatchObject({ count: 1, name: 'Mew ex', set: '30C', num: '66' })
  })

  it('does not accept a printing whose name disagrees', () => {
    // POR 88 is 'Rock Fighting Energy' in the card data. Matching on number
    // alone would silently substitute an unrelated card.
    const deck = resolveDeck('1 Rock Fighting Energy POR 88')
    expect(deck.entries[0].method).toBe('exact')

    const mismatch = resolveDeck('1 Some Nonexistent Card POR 88')
    expect(mismatch.entries[0].method).toBe('printing-conflict')
    expect(mismatch.conflicts).toHaveLength(1)
  })

  it('resolves a curated name alias', () => {
    // Two real decklists carry this spelling; the data holds it as
    // 'Telepath Psychic Energy POR 87'.
    const deck = resolveDeck('4 Telepathic Psychic Energy POR 88')
    expect(deck.entries[0].method).toBe('alias')
    expect(deck.cards[0].resolvedName).toBe('Telepath Psychic Energy')
    expect(deck.cards[0].tags).toContain('energy')
    expect(deck.conflicts).toEqual([])
  })

  it('maps basic Energy printed under an absent set via the colour map', () => {
    const deck = resolveDeck('6 Grass Energy MEE 9')
    const [card] = deck.cards
    expect(card.count).toBe(6)
    expect(card.resolvedName).toBe('Basic {G} Energy')
    expect(deck.entries[0].method).toBe('basic-energy')
    // Display keeps what the player wrote.
    expect(card.label).toBe('Grass Energy')
  })

  it('does not mistake a special Energy for a basic one', () => {
    // 'Grow Grass Energy' contains 'Grass Energy' but is a different card, and
    // its exact printing must win.
    const deck = resolveDeck('1 Grow Grass Energy POR 86')
    expect(deck.entries[0].method).toBe('exact')
    expect(deck.cards[0].resolvedName).toBe('Grow Grass Energy')
    expect(deck.cards[0].tags).toContain('special-energy')
  })

  it('merges reprints of the same card into one DeckCard', () => {
    const deck = resolveDeck('4 Ultra Ball MEG 131\n1 Ultra Ball SVI 196')
    expect(deck.cards).toHaveLength(1)
    expect(deck.cards[0].count).toBe(5)
    expect(deck.cards[0].printings).toEqual(['MEG 131', 'SVI 196'])
  })

  it('falls back to another printing by name, with a warning', () => {
    // Fezandipiti ex ASC 142 is not a printing this dataset carries.
    const deck = resolveDeck('1 Fezandipiti ex ASC 142')
    expect(deck.entries[0].method).toBe('name-fallback')
    expect(deck.cards[0].resolvedName).toBe('Fezandipiti ex')
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
    expect(cardDbMeta.cardCount).toBe(1267)
    expect(cardDbMeta.sourceRows).toBe(2022)
    expect(cardDbMeta.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
