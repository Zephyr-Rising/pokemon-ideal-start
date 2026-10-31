import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { emptyGoal, type FieldGoal } from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import { cardDataVersion, decodeShare, encodeShare, type SharePayload } from '../src/lib/share'
import { playtest } from '../src/lib/sim/playtest'
import { turnsTest } from '../src/lib/sim/turns'

// Share codes: a setup, or one seeded game of it, as a string.

const text = readFileSync(resolve('tests/fixtures/mega-kangaskhan.txt'), 'utf8')
const cards = resolveDeck(text).cards
const key = (label: string) => cards.find((c) => c.label === label)!.key
const label = (k: string) => cards.find((c) => c.key === k)?.label ?? k
const goal: FieldGoal = {
  ...emptyGoal(),
  active: { id: 'a', cardKey: key('Raging Bolt ex'), energy: ['{L}', '{F}'], tools: [] },
}

describe('share codes', () => {
  it('round-trip a setup and a game', async () => {
    const payload: SharePayload = {
      v: 1,
      db: cardDataVersion(),
      deck: text,
      goal,
      tab: 'turns',
      games: 200,
      seed: 1,
      game: { trial: 17, goingFirst: false },
    }
    const code = await encodeShare(payload)
    expect(code.startsWith('IS1-')).toBe(true)
    // Compressed: short enough to paste into a chat message.
    expect(code.length).toBeLessThan(2000)
    expect(await decodeShare(code)).toEqual(payload)
  })

  it('refuse what is not a code', async () => {
    await expect(decodeShare('hello')).rejects.toThrow('not an Ideal Start code')
  })
})

describe('a shared game replays exactly', () => {
  it('in Turns to build', () => {
    const full = turnsTest(cards, goal, label, { trials: 15, seed: 1 })
    const game = full.examples[full.examples.length - 1]
    const again = turnsTest(cards, goal, label, { trials: 15, seed: 1, onlyTrials: new Set([game.trial]) })
    const replayed = again.examples.find((e) => e.trial === game.trial && e.goingFirst === game.goingFirst)
    expect(replayed?.turns.map((t) => t.steps)).toEqual(game.turns.map((t) => t.steps))
    // Its figures count the one deal it played, not the whole run.
    expect(again.trials).toBe(1)
  }, 20_000)

  it('on the Turn 1 board', () => {
    const full = playtest(cards, goal, label, { trials: 60, seed: 1 })
    const game = full.examples[0]
    const again = playtest(cards, goal, label, { trials: 60, seed: 1, onlyTrials: new Set([game.trial]) })
    const replayed = again.examples.find((e) => e.trial === game.trial && e.goingFirst === game.goingFirst)
    expect(replayed?.steps).toEqual(game.steps)
  })
})
