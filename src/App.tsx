import { useDeferredValue, useMemo, useState } from 'react'

import { ConditionBuilder } from './components/ConditionBuilder'
import { DeckImport } from './components/DeckImport'
import { PrizeRisk } from './components/PrizeRisk'
import { ResultsPanel } from './components/ResultsPanel'
import { SensitivityTable } from './components/SensitivityTable'
import { cardDbMeta } from './lib/card-db'
import { analyze, type Requirement } from './lib/prob/analyze'
import { prizeRiskRows } from './lib/prob/prizes'
import { sensitivity } from './lib/prob/sensitivity'
import { resolveDeck } from './lib/resolve-cards'
import { seedCondition } from './lib/seed-condition'

/** Identity of the deck's card set, ignoring copy counts. */
const cardSignature = (keys: string[]): string => [...keys].sort().join('|')

export default function App() {
  const [text, setText] = useState('')
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [edited, setEdited] = useState(false)

  const deck = useMemo(() => resolveDeck(text), [text])

  // Re-seed when the *set* of cards changes — a genuinely different deck — but
  // not when only copy counts change, so tweaking a count never discards the
  // condition you just built.
  // Held in state rather than a ref: this is React's documented
  // "adjust state when the input changes" pattern, and it stays correct under
  // StrictMode's double-invoked render, where a ref write would be skipped.
  const signature = cardSignature(deck.cards.map((c) => c.key))
  const [lastSignature, setLastSignature] = useState<string | null>(null)
  if (lastSignature !== signature) {
    setLastSignature(signature)
    setRequirements(seedCondition(deck.cards))
    setEdited(false)
  }

  const editRequirements = (next: Requirement[]) => {
    setRequirements(next)
    setEdited(true)
  }

  const reseed = () => {
    setRequirements(seedCondition(deck.cards))
    setEdited(false)
  }

  const analysis = useMemo(() => analyze(deck.cards, requirements), [deck, requirements])

  // Sensitivity is the heavy part (tens of milliseconds). Deferring it keeps
  // typing in the decklist and condition fields responsive; it is still
  // synchronous and exact, just allowed to lag a frame behind.
  const deferred = useDeferredValue({ cards: deck.cards, requirements })
  const sensitivityRows = useMemo(
    () => sensitivity(deferred.cards, deferred.requirements),
    [deferred],
  )
  const prizes = useMemo(
    () => prizeRiskRows(deferred.cards, deferred.requirements),
    [deferred],
  )

  const hasDeck = deck.cards.length > 0

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Ideal Start</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Exact opening-hand odds for a Pokémon TCG decklist. Paste a PTCG Live export, say what
          your ideal start looks like, and see how often the deck delivers it.
        </p>
      </header>

      <main className="space-y-10">
        <DeckImport text={text} deck={deck} onChange={setText} />

        {hasDeck && (
          <>
            <ConditionBuilder
              cards={deck.cards}
              requirements={requirements}
              seeded={!edited}
              onChange={editRequirements}
              onReseed={reseed}
            />
            <ResultsPanel analysis={analysis} />
            <SensitivityTable rows={sensitivityRows} />
            <PrizeRisk cards={prizes.cards} groups={prizes.groups} />
          </>
        )}
      </main>

      <footer className="mt-12 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800">
        <p>
          Every figure is computed exactly from the deck's composition — no simulation, no sampling
          error. Card data covers {cardDbMeta.cardCount.toLocaleString()} cards; anything outside
          it still counts toward the deck but carries no card details.
        </p>
      </footer>
    </div>
  )
}
