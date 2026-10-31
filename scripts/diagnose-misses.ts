/**
 * Why games miss: not enough resources, or the simulator misusing them.
 *
 * For a set of real decks, each with a simple, a medium and a complex board,
 * every game not built by the last turn is put in one of four classes:
 *
 *   prizes     a card the board needs was prized (a lack of resources)
 *   search     the same deal, replayed with a much wider search (STRONG_*),
 *              does build it: the normal search misused what it had
 *   assembly   even the wider search misses, yet every card the board needs
 *              left the deck by the end — in hand, in play or discarded.
 *              Likely misuse by the play rules; some are genuinely blocked
 *              (bench space, one attachment a turn)
 *   draws      some card the board needs never left the deck (a lack of
 *              resources: draws and searches did not reach it)
 *
 *   npm run diagnose                     every case
 *   npm run diagnose -- kangaskhan       only cases whose name contains it
 *   npm run diagnose -- --json out.json  also write the rows as JSON
 *
 * Seeded, so the same code gives the same figures.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { emptyGoal, type FieldGoal, type SlotGoal } from '../src/lib/board/goal'
import { resolveDeck } from '../src/lib/resolve-cards'
import { boardRequirements } from '../src/lib/sim/prizes'
import { allInPlay, isBasicPokemon, type SimState } from '../src/lib/sim/state'
import { turnsTest, type GameReport } from '../src/lib/sim/turns'
import type { DeckCard } from '../src/lib/types'

const TRIALS = 40
const SEED = 11
/** The wider search a missed deal is replayed with: 4x the boards, 4x the budget. */
const STRONG_BEAM = 32
const STRONG_NODES = 24_000

const load = (name: string) =>
  resolveDeck(readFileSync(resolve('tests/fixtures', `${name}.txt`), 'utf8')).cards

let ids = 0
type Cards = DeckCard[]
const keyOf = (cards: Cards, label: string) => {
  const card = cards.find((c) => c.label === label)
  if (!card) throw new Error(`missing ${label}`)
  return card.key
}
const slot = (cards: Cards, label: string, energy: (string | null)[] = []): SlotGoal => ({
  id: `s${ids++}`,
  cardKey: keyOf(cards, label),
  energy,
  tools: [],
})
const goal = (over: Partial<FieldGoal>): FieldGoal => ({ ...emptyGoal(), ...over })

interface Case {
  deck: string
  level: 'simple' | 'medium' | 'complex'
  build: (c: Cards) => FieldGoal
}

const CASES: Case[] = [
  { deck: 'alakazam', level: 'simple', build: (c) => goal({ active: slot(c, 'Alakazam') }) },
  {
    deck: 'alakazam',
    level: 'medium',
    build: (c) => goal({ active: slot(c, 'Alakazam'), bench: [slot(c, 'Kadabra'), slot(c, 'Dudunsparce')] }),
  },
  {
    deck: 'alakazam',
    level: 'complex',
    build: (c) =>
      goal({
        active: slot(c, 'Alakazam', ['{P}']),
        bench: [slot(c, 'Kadabra'), slot(c, 'Dudunsparce'), slot(c, "Lillie's Clefairy ex")],
      }),
  },
  { deck: 'dragapult-blaziken', level: 'simple', build: (c) => goal({ active: slot(c, 'Dragapult ex') }) },
  {
    deck: 'dragapult-blaziken',
    level: 'medium',
    build: (c) => goal({ active: slot(c, 'Dragapult ex'), bench: [slot(c, 'Blaziken ex')] }),
  },
  {
    deck: 'dragapult-blaziken',
    level: 'complex',
    build: (c) =>
      goal({
        active: slot(c, 'Dragapult ex', ['{R}', '{P}']),
        bench: [slot(c, 'Blaziken ex'), slot(c, 'Drakloak')],
      }),
  },
  { deck: 'dragapult-munkidori', level: 'simple', build: (c) => goal({ active: slot(c, 'Dragapult ex') }) },
  {
    deck: 'dragapult-munkidori',
    level: 'medium',
    build: (c) => goal({ active: slot(c, 'Dragapult ex'), bench: [slot(c, 'Munkidori')] }),
  },
  {
    deck: 'dragapult-munkidori',
    level: 'complex',
    build: (c) =>
      goal({
        active: slot(c, 'Dragapult ex', ['{R}', '{P}']),
        bench: [slot(c, 'Munkidori', ['{D}']), slot(c, 'Drakloak')],
      }),
  },
  { deck: 'festival-lead', level: 'simple', build: (c) => goal({ active: slot(c, 'Dipplin') }) },
  {
    deck: 'festival-lead',
    level: 'medium',
    build: (c) => goal({ active: slot(c, 'Dipplin'), bench: [slot(c, 'Thwackey'), slot(c, 'Lilligant')] }),
  },
  {
    deck: 'festival-lead',
    level: 'complex',
    build: (c) =>
      goal({
        active: slot(c, 'Dipplin'),
        bench: [slot(c, 'Thwackey'), slot(c, 'Thwackey'), slot(c, 'Lilligant'), slot(c, 'Rabsca')],
      }),
  },
  { deck: 'hydrapple', level: 'simple', build: (c) => goal({ active: slot(c, 'Hydrapple ex') }) },
  {
    deck: 'hydrapple',
    level: 'medium',
    build: (c) => goal({ active: slot(c, 'Hydrapple ex'), bench: [slot(c, 'Meganium')] }),
  },
  {
    deck: 'hydrapple',
    level: 'complex',
    build: (c) =>
      goal({
        active: slot(c, 'Hydrapple ex', ['{G}']),
        bench: [
          slot(c, 'Teal Mask Ogerpon ex', ['{G}', '{G}']),
          slot(c, 'Teal Mask Ogerpon ex', ['{G}', '{G}']),
          slot(c, 'Meganium'),
        ],
      }),
  },
  { deck: 'mega-kangaskhan', level: 'simple', build: (c) => goal({ active: slot(c, 'Mega Kangaskhan ex') }) },
  {
    deck: 'mega-kangaskhan',
    level: 'medium',
    build: (c) => goal({ active: slot(c, 'Raging Bolt ex', ['{L}', '{F}']) }),
  },
  {
    deck: 'mega-kangaskhan',
    level: 'complex',
    build: (c) => goal({ active: slot(c, "Lillie's Clefairy ex", ['{P}', null]), benchMin: 8 }),
  },
  { deck: 'metal-petrel', level: 'simple', build: (c) => goal({ active: slot(c, 'Mega Excadrill ex') }) },
  {
    deck: 'metal-petrel',
    level: 'medium',
    build: (c) => goal({ active: slot(c, 'Mega Excadrill ex'), bench: [slot(c, 'Metang')] }),
  },
  {
    deck: 'metal-petrel',
    level: 'complex',
    build: (c) =>
      goal({
        active: slot(c, 'Mega Excadrill ex', ['{M}', '{M}', '{M}']),
        bench: [slot(c, 'Metang'), slot(c, 'Genesect ex'), slot(c, 'Empoleon ex')],
      }),
  },
  { deck: 'ns-zoroark', level: 'simple', build: (c) => goal({ active: slot(c, "N's Zoroark ex") }) },
  {
    deck: 'ns-zoroark',
    level: 'medium',
    build: (c) => goal({ active: slot(c, "N's Zoroark ex"), bench: [slot(c, 'Munkidori')] }),
  },
  {
    deck: 'ns-zoroark',
    level: 'complex',
    build: (c) =>
      goal({
        active: slot(c, "N's Zoroark ex", ['{D}']),
        bench: [slot(c, 'Munkidori', ['{D}']), slot(c, "N's Zekrom")],
      }),
  },
  { deck: 'slowking', level: 'simple', build: (c) => goal({ active: slot(c, 'Slowking') }) },
  {
    deck: 'slowking',
    level: 'medium',
    build: (c) => goal({ active: slot(c, 'Slowking'), bench: [slot(c, 'Dudunsparce')] }),
  },
  {
    deck: 'slowking',
    level: 'complex',
    build: (c) =>
      goal({
        active: slot(c, 'Slowking', ['{P}']),
        bench: [slot(c, 'Kyurem'), slot(c, 'Dudunsparce'), slot(c, "Lillie's Clefairy ex")],
      }),
  },
]

/** Every card that has left the deck by the end: in hand, in play, discarded. */
function outOfDeck(state: SimState): DeckCard[] {
  return [
    ...state.hand,
    ...state.discard,
    ...(state.stadium ? [state.stadium] : []),
    ...allInPlay(state).flatMap((slot) => [slot.card, ...slot.energy, ...slot.tools]),
  ]
}

/** Did every card the board needs leave the deck? */
function hadThePieces(state: SimState, g: FieldGoal, cards: Cards, labelFor: (k: string) => string): boolean {
  const out = outOfDeck(state)
  const count = (matches: (card: DeckCard) => boolean) => out.filter(matches).length
  let candy = count((card) => card.card?.name === 'Rare Candy')
  for (const requirement of boardRequirements(g, cards, labelFor)) {
    const short = requirement.needed - count(requirement.matches)
    if (short <= 0) continue
    if (requirement.candySkippable && candy >= short) {
      candy -= short
      continue
    }
    return false
  }
  // Counts the requirements leave out: bench bodies, untyped and total Energy.
  const slots = [...(g.active ? [g.active] : []), ...g.bench]
  const energyNeeded = Math.max(
    slots.reduce((sum, s) => sum + s.energy.length, 0),
    g.energyMin ?? 0,
  )
  if (count((card) => card.tags.includes('energy')) < energyNeeded) return false
  if (g.benchMin > 0 && count(isBasicPokemon) < g.benchMin + 1) return false
  return true
}

type Cause = 'prizes' | 'search' | 'assembly' | 'draws'

interface Row {
  deck: string
  level: string
  games: number
  built: number
  causes: Record<Cause, number>
  seconds: number
}

function runCase(c: Case): Row {
  const cards = load(c.deck)
  const g = c.build(cards)
  const labelFor = (key: string) => cards.find((card) => card.key === key)?.label ?? key
  const start = performance.now()

  const missed: GameReport[] = []
  let games = 0
  let built = 0
  turnsTest(cards, g, labelFor, {
    trials: TRIALS,
    seed: SEED,
    onGame: (game) => {
      games++
      if (game.turn !== null) built++
      else missed.push(game)
    },
  })

  const causes: Record<Cause, number> = { prizes: 0, search: 0, assembly: 0, draws: 0 }
  const replay = missed.filter((game) => game.prized.length === 0)
  causes.prizes = missed.length - replay.length

  // The same deals with the wider search; each game keyed by deal and order.
  const strong = new Map<string, GameReport>()
  if (replay.length > 0) {
    turnsTest(cards, g, labelFor, {
      trials: TRIALS,
      seed: SEED,
      beamWidth: STRONG_BEAM,
      maxNodes: STRONG_NODES,
      onlyTrials: new Set(replay.map((game) => game.trial)),
      onGame: (game) => strong.set(`${game.trial}|${game.goingFirst}`, game),
    })
  }
  for (const game of replay) {
    const again = strong.get(`${game.trial}|${game.goingFirst}`)
    if (again && again.turn !== null) causes.search++
    else if (again?.final && hadThePieces(again.final, g, cards, labelFor)) causes.assembly++
    else causes.draws++
  }

  return {
    deck: c.deck,
    level: c.level,
    games,
    built,
    causes,
    seconds: (performance.now() - start) / 1000,
  }
}

const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined
const filter = args.find((arg, i) => !arg.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1))?.toLowerCase()

const pct = (n: number, of: number) => (of === 0 ? '   -' : `${((n / of) * 100).toFixed(1).padStart(5)}%`)
const rows: Row[] = []
console.log(
  'deck                 level     built   missed  | prizes  draws   | search  assembly | time',
)
for (const c of CASES) {
  if (filter && !`${c.deck} ${c.level}`.includes(filter)) continue
  const row = runCase(c)
  rows.push(row)
  const missed = row.games - row.built
  console.log(
    `${row.deck.padEnd(20)} ${row.level.padEnd(8)} ${pct(row.built, row.games)} ${pct(missed, row.games)}  | ` +
      `${pct(row.causes.prizes, row.games)} ${pct(row.causes.draws, row.games)} | ` +
      `${pct(row.causes.search, row.games)} ${pct(row.causes.assembly, row.games)}  | ${row.seconds.toFixed(0)}s`,
  )
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2))
