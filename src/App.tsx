import { useDeferredValue, useMemo, useState } from 'react'

import { BoardEditor } from './components/board/BoardEditor'
import { PlaytestResults } from './components/board/PlaytestResults'
import { TurnsResults } from './components/board/TurnsResults'
import { ConditionBuilder } from './components/ConditionBuilder'
import { DeckImport } from './components/DeckImport'
import { PrizeRisk } from './components/PrizeRisk'
import { ResultsPanel } from './components/ResultsPanel'
import { SampleHand } from './components/SampleHand'
import { SensitivityTable } from './components/SensitivityTable'
import { emptyGoal, type FieldGoal } from './lib/board/goal'
import { cardDbMeta } from './lib/card-db'
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

type Tab = 'hand' | 'board' | 'turns'

const TRIAL_CHOICES = [500, 1500, 4000] as const
/** Each game plays up to six turns, so fewer games keep a run quick. */
const TURN_TRIAL_CHOICES = [100, 300, 1000] as const

export default function App() {
  const [text, setText] = useState('')
  const [condition, setCondition] = useState<Condition>([])
  const [goal, setGoal] = useState<FieldGoal>(emptyGoal())
  const [edited, setEdited] = useState(false)
  const [tab, setTab] = useState<Tab>('hand')
  const [trials, setTrials] = useState<number>(1500)
  const [turnTrials, setTurnTrials] = useState<number>(300)

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

  // The turn-1 playtest is far too slow for the main thread, so it runs in a
  // worker and streams progress.
  // Each runs only while its tab is open.
  const playtest = usePlaytest(deck.cards, goal, trials, 1, tab === 'board')
  const turns = useTurns(deck.cards, goal, turnTrials, 1, tab === 'turns')

  const hasDeck = deck.cards.length > 0

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Ideal Start</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Paste a PTCG Live export, then ask either question: what is in my opening hand, or what
          board can I actually build by the end of turn 1.
        </p>
      </header>

      <main className="space-y-10">
        <DeckImport text={text} deck={deck} onChange={setText} onAdjust={adjust} />

        {hasDeck && (
          <>
            <div
              role="tablist"
              aria-label="What to analyse"
              className="flex gap-1 border-b border-slate-200 dark:border-slate-800"
            >
              <Tab id="hand" active={tab} onSelect={setTab}>
                Opening hand
              </Tab>
              <Tab id="board" active={tab} onSelect={setTab}>
                Turn 1 board
              </Tab>
              <Tab id="turns" active={tab} onSelect={setTab}>
                Turns to build
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
                <TurnsResults
                  goal={goal}
                  state={turns}
                  cards={deck.cards}
                  onFewer={
                    turnTrials > TURN_TRIAL_CHOICES[0]
                      ? () => setTurnTrials(TURN_TRIAL_CHOICES[0])
                      : undefined
                  }
                />
                <TrialPicker
                  value={turnTrials}
                  choices={TURN_TRIAL_CHOICES}
                  onChange={setTurnTrials}
                />
              </div>
            ) : (
              <div role="tabpanel" className="space-y-10">
                <BoardEditor cards={deck.cards} goal={goal} onChange={setGoal} />
                <PlaytestResults
                  goal={goal}
                  state={playtest}
                  cards={deck.cards}
                  onFewer={trials > TRIAL_CHOICES[0] ? () => setTrials(TRIAL_CHOICES[0]) : undefined}
                />
                <TrialPicker value={trials} choices={TRIAL_CHOICES} onChange={setTrials} />
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
  )
}

function TrialPicker({
  value,
  choices,
  onChange,
}: {
  value: number
  choices: readonly number[]
  onChange: (trials: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      Games played:
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
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
