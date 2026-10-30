/**
 * Search-speed benchmark: a fixed set of real decks and boards, timed.
 *
 * Every run is seeded, so the same code gives the same results and the timings
 * are comparable from one change to the next. The results are printed next to
 * the timings on purpose: a speed-up that changes what the search finds is a
 * behaviour change, not an optimisation, and should be visible as one.
 *
 *   npm run bench            all cases
 *   npm run bench -- dragapult   only cases whose name contains "dragapult"
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { emptyGoal, type FieldGoal, type SlotGoal } from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import { playtest } from '../src/lib/sim/playtest'
import { turnsTest } from '../src/lib/sim/turns'
import type { DeckCard } from '../src/lib/types'

const load = (name: string) =>
  resolveDeck(readFileSync(resolve('tests/fixtures', `${name}.txt`), 'utf8')).cards

const keyOf = (cards: DeckCard[], label: string) => {
  const card = cards.find((c) => c.label === label)
  if (!card) throw new Error(`missing ${label}`)
  return card.key
}
let ids = 0
const slot = (cardKey: string, energy: (string | null)[] = []): SlotGoal => ({
  id: `s${ids++}`,
  cardKey,
  energy,
  tools: [],
})
const goal = (over: Partial<FieldGoal>): FieldGoal => ({ ...emptyGoal(), ...over })

interface Case {
  name: string
  deck: string
  build: (cards: DeckCard[]) => FieldGoal
  mode: 'board' | 'turns'
  trials: number
}

const CASES: Case[] = [
  {
    name: 'kangaskhan: Kangaskhan Active + Wellspring benched',
    deck: 'mega-kangaskhan',
    mode: 'board',
    trials: 200,
    build: (c) =>
      goal({
        active: slot(keyOf(c, 'Mega Kangaskhan ex')),
        bench: [slot(keyOf(c, 'Wellspring Mask Ogerpon ex'))],
      }),
  },
  {
    name: 'kangaskhan: Teal Ogerpon Active with 2 Grass',
    deck: 'mega-kangaskhan',
    mode: 'board',
    trials: 200,
    build: (c) => goal({ active: slot(keyOf(c, 'Teal Mask Ogerpon ex'), ['{G}', '{G}']) }),
  },
  {
    name: 'dragapult: Dreepy Active + Munkidori + Fezandipiti',
    deck: 'dragapult-munkidori',
    mode: 'board',
    trials: 200,
    build: (c) =>
      goal({
        active: slot(keyOf(c, 'Dreepy')),
        bench: [slot(keyOf(c, 'Munkidori')), slot(keyOf(c, 'Fezandipiti ex'))],
      }),
  },
  {
    name: 'dragapult turns: Dragapult ex + Psychic, Munkidori benched',
    deck: 'dragapult-munkidori',
    mode: 'turns',
    trials: 60,
    build: (c) =>
      goal({
        active: slot(keyOf(c, 'Dragapult ex'), ['{P}']),
        bench: [slot(keyOf(c, 'Munkidori'))],
      }),
  },
  {
    name: 'festival turns: Dipplin Active, Thwackey + Lilligant benched',
    deck: 'festival-lead',
    mode: 'turns',
    trials: 60,
    build: (c) =>
      goal({
        active: slot(keyOf(c, 'Dipplin')),
        bench: [slot(keyOf(c, 'Thwackey')), slot(keyOf(c, 'Lilligant'))],
      }),
  },
]

const filter = process.argv[2]?.toLowerCase()
let total = 0
for (const c of CASES) {
  if (filter && !c.name.toLowerCase().includes(filter)) continue
  const cards = load(c.deck)
  const g = c.build(cards)
  const label = (key: string) => cards.find((card) => card.key === key)?.label ?? key
  const start = performance.now()
  let summary: string
  if (c.mode === 'board') {
    const r = playtest(cards, g, label, { trials: c.trials, seed: 11 })
    summary = `strict ${(r.strict * 100).toFixed(1)}% (1st ${(r.goingFirst.strict * 100).toFixed(1)} / 2nd ${(r.goingSecond.strict * 100).toFixed(1)}) truncated ${r.truncated}/${r.trials}`
  } else {
    const r = turnsTest(cards, g, label, { trials: c.trials, seed: 11 })
    summary = `median ${r.median} mean ${r.mean?.toFixed(2)} reached ${(r.reached * 100).toFixed(1)}% truncated ${r.truncated}/${r.trials} games, ${r.turnsTruncated}/${r.turnsPlayed} turns`
  }
  const ms = performance.now() - start
  total += ms
  console.log(`${(ms / 1000).toFixed(1).padStart(6)}s  ${c.name}\n         ${summary}`)
}
console.log(`${(total / 1000).toFixed(1).padStart(6)}s  total`)
