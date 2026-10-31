import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { BoardEditor } from './components/board/BoardEditor'
import { PlaytestResults } from './components/board/PlaytestResults'
import { TurnsResults } from './components/board/TurnsResults'
import { ConditionBuilder } from './components/ConditionBuilder'
import { DeckImport } from './components/DeckImport'
import { PrizeRisk } from './components/PrizeRisk'
import { ResultsPanel } from './components/ResultsPanel'
import { SampleHand } from './components/SampleHand'
import { SensitivityTable } from './components/SensitivityTable'
import { emptyGoal, goalIsEmpty, type FieldGoal } from './lib/board/goal'
import { cardDbMeta } from './lib/card-db'
import { applyDesign, DESIGNS, savedDesign, type Design } from './lib/design'
import { adjustLineCount } from './lib/edit-decklist'
import {
  allRequirements,
  analyze,
  requirementCardKeys,
  type Condition,
} from './lib/prob/analyze'
import { prizeRiskRows } from './lib/prob/prizes'
import { sensitivity } from './lib/prob/sensitivity'
import { resolveDeck } from './lib/resolve-cards'
import { sampleHand, type SampleMode } from './lib/sample-hand'
import { seedCondition } from './lib/seed-condition'
import { usePlaytest, useTurns } from './lib/use-playtest'

/** Identity of the deck's card set, ignoring copy counts. */
const cardSignature = (keys: string[]): string => [...keys].sort().join('|')

type Tab = 'turns' | 'board' | 'hand'

const TRIAL_CHOICES = [500, 1500, 4000] as const
/**
 * Each game plays up to six turns, carrying several boards from each into the
 * next, so a game costs far more than on turn 1 and fewer keep a run quick.
 */
const TURN_TRIAL_CHOICES = [100, 200, 500] as const

export default function App() {
  const [text, setText] = useState('')
  const [condition, setCondition] = useState<Condition>([])
  const [goal, setGoal] = useState<FieldGoal>(emptyGoal())
  const [edited, setEdited] = useState(false)
  const [tab, setTab] = useState<Tab>('turns')
  const [design, setDesign] = useState<Design>(savedDesign)
  useEffect(() => applyDesign(design), [design])
  const [trials, setTrials] = useState<number>(1500)
  const [turnTrials, setTurnTrials] = useState<number>(200)

  const deck = useMemo(() => resolveDeck(text), [text])

  // Re-seed when the *set* of cards changes — a genuinely different deck — but
  // not when only copy counts change, so tweaking a count never discards the
  // condition or board you just built.
  // Held in state rather than a ref: this is React's documented
  // "adjust state when the input changes" pattern, and it stays correct under
  // StrictMode's double-invoked render, where a ref write would be skipped.
  const signature = cardSignature(deck.cards.map((c) => c.key))
  const [lastSignature, setLastSignature] = useState<string | null>(null)
  if (lastSignature !== signature) {
    setLastSignature(signature)
    setCondition(seedCondition(deck.cards))
    setGoal(emptyGoal())
    setEdited(false)
  }

  const editCondition = (next: Condition) => {
    setCondition(next)
    setEdited(true)
  }

  const reseed = () => {
    setCondition(seedCondition(deck.cards))
    setEdited(false)
  }

  const adjust = (rawLine: string, delta: number) =>
    setText((current) => adjustLineCount(current, rawLine, delta))

  const analysis = useMemo(() => analyze(deck.cards, condition), [deck, condition])

  // Re-sampled whenever the deck, the condition or the mode changes, and on demand.
  const [reroll, setReroll] = useState(0)
  const [sampleMode, setSampleMode] = useState<SampleMode>('meets')
  const hand = useMemo(
    () => sampleHand(deck.cards, condition, { mode: sampleMode }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reroll` is the trigger
    [deck, condition, sampleMode, reroll],
  )

  // Sensitivity is the heavy part (tens of milliseconds). Deferring it keeps
  // typing in the decklist and condition fields responsive; it is still
  // synchronous and exact, just allowed to lag a frame behind.
  const deferred = useDeferredValue({ cards: deck.cards, condition })
  const sensitivityRows = useMemo(
    () => sensitivity(deferred.cards, deferred.condition),
    [deferred],
  )
  const prizes = useMemo(
    () =>
      prizeRiskRows(
        deferred.cards,
        allRequirements(deferred.condition).map((r) => ({
          id: r.id,
          label: r.label,
          cardKeys: requirementCardKeys(r),
        })),
      ),
    [deferred],
  )

  // The simulations are far too slow for the main thread, so each runs in a
  // worker and streams progress — when its Search button is pressed.
  const playtest = usePlaytest(deck.cards, goal, trials, 1)
  const turns = useTurns(deck.cards, goal, turnTrials, 1)

  const hasDeck = deck.cards.length > 0

  return (
    <div className="min-h-screen">
      <header className="app-header">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <h1 className="text-3xl leading-none font-bold tracking-tight">Ideal Start</h1>
              <p className="tagline mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                How fast does your deck set up? Paste a PTCG Live list and find out.
              </p>
            </div>
          </div>
          <DesignSwitch value={design} onChange={setDesign} />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <main className="app-main space-y-10">
        <DeckImport text={text} deck={deck} onChange={setText} onAdjust={adjust} />

        {hasDeck && (
          <>
            <div
              role="tablist"
              aria-label="What to analyse"
              className="app-tabs flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
            >
              <Tab id="turns" active={tab} onSelect={setTab}>
                Turns to build
              </Tab>
              <Tab id="board" active={tab} onSelect={setTab}>
                Turn 1 board
              </Tab>
              <Tab id="hand" active={tab} onSelect={setTab}>
                Opening hand
              </Tab>
            </div>

            {tab === 'hand' ? (
              <div role="tabpanel" className="space-y-10">
                <ConditionBuilder
                  cards={deck.cards}
                  condition={condition}
                  seeded={!edited}
                  onChange={editCondition}
                  onReseed={reseed}
                />
                <ResultsPanel analysis={analysis} />
                <SampleHand
                  hand={hand}
                  condition={condition}
                  mode={sampleMode}
                  onModeChange={setSampleMode}
                  onReroll={() => setReroll((n) => n + 1)}
                />
                <SensitivityTable rows={sensitivityRows} />
                <PrizeRisk cards={prizes.cards} groups={prizes.groups} />
              </div>
            ) : tab === 'turns' ? (
              <div role="tabpanel" className="space-y-10">
                <BoardEditor cards={deck.cards} goal={goal} onChange={setGoal} horizon="turns" />
                <SearchBar
                  state={turns}
                  empty={goalIsEmpty(goal)}
                  trials={turnTrials}
                  choices={TURN_TRIAL_CHOICES}
                  onTrials={setTurnTrials}
                />
                <TurnsResults
                  goal={goal}
                  state={turns}
                  cards={deck.cards}
                  onFewer={
                    turnTrials > TURN_TRIAL_CHOICES[0]
                      ? () => {
                          setTurnTrials(TURN_TRIAL_CHOICES[0])
                          turns.search({ trials: TURN_TRIAL_CHOICES[0] })
                        }
                      : undefined
                  }
                />
              </div>
            ) : (
              <div role="tabpanel" className="space-y-10">
                <BoardEditor cards={deck.cards} goal={goal} onChange={setGoal} />
                <SearchBar
                  state={playtest}
                  empty={goalIsEmpty(goal)}
                  trials={trials}
                  choices={TRIAL_CHOICES}
                  onTrials={setTrials}
                />
                <PlaytestResults
                  goal={goal}
                  state={playtest}
                  cards={deck.cards}
                  onFewer={
                    trials > TRIAL_CHOICES[0]
                      ? () => {
                          setTrials(TRIAL_CHOICES[0])
                          playtest.search({ trials: TRIAL_CHOICES[0] })
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </>
        )}
      </main>

      <footer className="mt-12 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800">
        <p>
          Opening-hand figures are computed exactly from the deck's composition — no simulation, no
          sampling error. Turn-1 board figures are simulated and carry a stated margin. Card data
          covers {cardDbMeta.cardCount.toLocaleString()} Standard-legal cards; anything outside it
          still counts toward the deck but carries no card details.
        </p>
      </footer>
      </div>
    </div>
  )
}

/** A hand of three fanned cards: the opening hand the tool is about. */
function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className="brand-mark h-10 w-10 shrink-0">
      <rect x="5" y="9" width="16" height="23" rx="2.5" fill="currentColor" opacity="0.35" transform="rotate(-14 13 20)" />
      <rect x="12" y="7" width="16" height="23" rx="2.5" fill="currentColor" opacity="0.65" />
      <rect x="19" y="9" width="16" height="23" rx="2.5" fill="currentColor" transform="rotate(14 27 20)" />
    </svg>
  )
}

/** Which of the three designs the site wears. */
function DesignSwitch({ value, onChange }: { value: Design; onChange: (design: Design) => void }) {
  return (
    <div
      role="group"
      aria-label="Design"
      className="design-switch flex rounded-lg border border-slate-300 p-0.5 text-xs dark:border-slate-700"
    >
      {DESIGNS.map((design) => (
        <button
          key={design.id}
          type="button"
          aria-pressed={value === design.id}
          onClick={() => onChange(design.id)}
          className="rounded-md px-2.5 py-1 font-medium text-slate-600 transition-colors dark:text-slate-300"
        >
          {design.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Starts the search, with how many games it plays. Nothing runs until it is
 * pressed; after an edit it says the figures below describe the board as it
 * was.
 */
function SearchBar({
  state,
  empty,
  trials,
  choices,
  onTrials,
}: {
  state: { running: boolean; result: unknown; stale: boolean; search: () => void }
  empty: boolean
  trials: number
  choices: readonly number[]
  onTrials: (trials: number) => void
}) {
  const { running, result, stale, search } = state
  const label = running ? 'Restart search' : result ? 'Search again' : 'Search'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        onClick={() => search()}
        disabled={empty}
        className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {label}
      </button>
      <label className="flex items-center gap-2 text-xs text-slate-500">
        Games:
        <select
          value={trials}
          onChange={(e) => onTrials(Number(e.target.value))}
          className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
        >
          {choices.map((count) => (
            <option key={count} value={count}>
              {count.toLocaleString()}
            </option>
          ))}
        </select>
        more games narrows the margin of error
      </label>
      {empty ? (
        <p className="w-full text-xs text-slate-500">Put something on the board to search it.</p>
      ) : stale && !running ? (
        <p data-testid="search-stale" className="w-full text-xs font-medium text-amber-700 dark:text-amber-400">
          The board has changed since these results. Search again to update them.
        </p>
      ) : null}
    </div>
  )
}

function Tab({
  id,
  active,
  onSelect,
  children,
}: {
  id: Tab
  active: Tab
  onSelect: (tab: Tab) => void
  children: React.ReactNode
}) {
  const selected = active === id
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className={[
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        selected
          ? 'border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300'
          : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
