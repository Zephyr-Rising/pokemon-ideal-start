import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { addChoice, removeChoice, toggleAlternative } from '../src/lib/board/edit'
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

describe('either/or across zones', () => {
  // "Ciphermaniac in hand, or Academy at Night as the Stadium and Kyurem in hand."
  let g: FieldGoal = {
    ...emptyGoal(),
    active: slot('a', 'dreepy'),
    stadiumKey: 'academy',
    inHand: [
      { id: 'c', cardKey: 'cipher', count: 1 },
      { id: 'k', cardKey: 'kyurem', count: 1 },
    ],
  }
  g = addChoice(g, [['c:hand'], ['stadium', 'k:hand']])
  const score = (hand: string[], stadium: string | null) => scoreBoard(g, view('dreepy', [], hand, stadium), label)

  it('is met by either option in full', () => {
    expect(score(['cipher'], null).strict).toBe(true)
    expect(score(['kyurem'], 'academy').strict).toBe(true)
  })

  it('is not met by half of an option', () => {
    expect(score(['kyurem'], null).strict).toBe(false)
    expect(score([], 'academy').strict).toBe(false)
  })

  it('folds its cards into one part, with its own label', () => {
    const parts = score([], null).parts
    expect(parts.map((p) => p.kind)).toEqual(['active', 'choice'])
    expect(parts[1].label).toBe('cipher still in hand, or academy in play and kyurem still in hand')
  })

  it('needs two options to be a choice', () => {
    expect(addChoice(emptyGoal(), [['x'], []]).choices).toBeUndefined()
    expect(removeChoice(g, g.choices![0].id).choices).toEqual([])
  })
})

describe('a Pokémon wanted in hand', () => {
  it('is kept in hand, not benched', async () => {
    const { searchBestLine } = await import('../src/lib/sim/search')
    const { buildContext } = await import('../src/lib/sim/context')
    const { legalActions } = await import('../src/lib/sim/actions')
    const { inPlay } = await import('../src/lib/sim/state')
    const mon = (k: string) => ({ key: k, label: k, resolvedName: k, count: 1, printings: [], tags: ['pokemon', 'basic'], card: { index: 0, name: k, kind: '', rule: '', prev: '', hp: 70, type: '{W}', retreat: 1, regulationMark: '', effect: '', moves: [], tags: ['pokemon', 'basic'], image: '' } })
    const kyurem = mon('kyurem')
    const g: FieldGoal = {
      ...emptyGoal(),
      active: slot('a', 'slowpoke'),
      inHand: [{ id: 'k', cardKey: 'kyurem', count: 1 }],
    }
    const ctx = buildContext(g, () => 0.5, 1, [kyurem as never])
    const s = { hand: [kyurem], deck: [], discard: [], prizes: [], active: inPlay(mon('slowpoke') as never), bench: [], stadium: null, usedEnergy: false, usedSupporter: false, usedStadium: false, usedRetreat: false, usedAbilities: [] }
    expect(legalActions(s as never, ctx).map((a) => a.kind)).not.toContain('bench')
    // Even across turns, where Pokémon in play add to the setup score.
    const multi = { ...ctx, multiTurn: true }
    const result = searchBestLine(s as never, g, multi, (k) => k)
    expect(result.finalState.hand.map((c) => c.key)).toContain('kyurem')
  })
})
