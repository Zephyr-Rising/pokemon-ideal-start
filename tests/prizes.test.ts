import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { emptyGoal, type FieldGoal, type SlotGoal } from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import { playtest } from '../src/lib/sim/playtest'
import { boardRequirements, prizeLocks } from '../src/lib/sim/prizes'
import type { CardRecord, DeckCard } from '../src/lib/types'

function card(key: string, tags: string[], over: Partial<CardRecord> = {}, count = 1): DeckCard {
  const record = { index: 0, name: key, kind: '', rule: '', prev: '', hp: null, type: '', retreat: null, regulationMark: '', effect: '', moves: [], tags, image: '', ...over } as CardRecord
  return { key, label: over.name ?? key, resolvedName: key, count, card: record, printings: [], tags }
}
const copies = (c: DeckCard) => Array.from({ length: c.count }, () => c)
const slot = (cardKey: string, energy: (string | null)[] = []): SlotGoal => ({ id: cardKey + Math.random(), cardKey, energy, tools: [] })
const goal = (over: Partial<FieldGoal>): FieldGoal => ({ ...emptyGoal(), ...over })
const label = (k: string) => k

// A 2-2-2 Stage 2 line, Rare Candy, a 4-of Basic and Energy.
const chik = card('chik', ['pokemon', 'basic'], { name: 'Chikorita' }, 2)
const bay = card('bay', ['pokemon', 'stage1'], { name: 'Bayleef', prev: 'Chikorita' }, 2)
const meg = card('meg', ['pokemon', 'stage2'], { name: 'Meganium', prev: 'Bayleef' }, 2)
const candy = card('candy', ['item'], { name: 'Rare Candy' }, 1)
const oger = card('oger', ['pokemon', 'basic'], { name: 'Ogerpon' }, 4)
const grass = card('grass', ['energy', 'basic-energy'], { name: 'Grass Energy', type: '{G}' }, 6)
const cards = [chik, bay, meg, candy, oger, grass]
const deck = cards.flatMap(copies)

const locks = (g: FieldGoal, prizes: DeckCard[]) => prizeLocks(boardRequirements(g, cards, label), deck, prizes)

describe('prize locks', () => {
  const megBoard = goal({ bench: [slot('meg')] })

  it('catches a Stage 2 with every copy prized', () => {
    expect(locks(megBoard, [meg, meg])).toEqual(['meg'])
  })

  it('is fine with one copy of two prized', () => {
    expect(locks(megBoard, [meg, chik])).toEqual([])
  })

  it('lets Rare Candy outside the prizes stand in for a prized Stage 1', () => {
    expect(locks(megBoard, [bay, bay])).toEqual([])
    // ...but not when the Rare Candy is prized too.
    expect(locks(megBoard, [bay, bay, candy])).toEqual(['Bayleef'])
  })

  it('never lets Rare Candy skip the Basic', () => {
    expect(locks(megBoard, [chik, chik])).toEqual(['Chikorita'])
  })

  it('counts how many of a Pokémon the board wants', () => {
    const two = goal({ bench: [slot('oger'), slot('oger')] })
    expect(locks(two, [oger, oger])).toEqual([])
    expect(locks(two, [oger, oger, oger])).toEqual(['oger'])
  })

  it('counts the Energy the board needs', () => {
    const four = goal({ bench: [slot('oger', ['{G}', '{G}']), slot('oger', ['{G}', '{G}'])] })
    expect(locks(four, [grass, grass])).toEqual([])
    expect(locks(four, [grass, grass, grass])).toEqual(['Grass Energy', 'Energy'])
  })

  it('does not blame the prizes when the deck simply runs too few', () => {
    const five = goal({ bench: Array.from({ length: 5 }, () => slot('oger')) })
    expect(locks(five, [])).toEqual([])
    expect(locks(five, [oger])).toEqual([])
  })
})

describe('prize-locked games in a run', () => {
  const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
  const real = resolveDeck(readFileSync(resolve(FIXTURES, 'dragapult-munkidori.txt'), 'utf8')).cards
  const key = (l: string) => real.find((c) => c.label === l)!.key
  const lab = (k: string) => real.find((c) => c.key === k)?.label ?? k
  // Fezandipiti ex is a 1-of, so roughly one game in ten has it prized.
  const g = goal({ bench: [slot(key('Fezandipiti ex'))] })
  const result = playtest(real, g, lab, { trials: 300, seed: 9 })

  it('logs the games the prizes made impossible, and why', () => {
    expect(result.prizeLocked.rate).toBeGreaterThan(0.04)
    expect(result.prizeLocked.rate).toBeLessThan(0.18)
    expect(result.prizeLocked.reasons[0].label).toBe('Fezandipiti ex')
  })

  it('counts them as misses', () => {
    expect(result.strict).toBeLessThanOrEqual(1 - result.prizeLocked.rate + 1e-9)
  })
})
