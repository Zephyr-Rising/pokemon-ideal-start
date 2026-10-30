import { useState } from 'react'

import { goalIsEmpty, type FieldGoal } from '../../lib/board/goal'
import { pct, plural } from '../../lib/format'
import type { PartStat, PlaytestExample } from '../../lib/sim/playtest'
import type { DeckCard } from '../../lib/types'
import type { PlaytestState } from '../../lib/use-playtest'
import { Combinations } from './Combinations'
import { ReplayPlayer } from './ReplayPlayer'
import { SimulationProgress } from './SimulationProgress'

interface Props {
  goal: FieldGoal
  state: PlaytestState
  /** The resolved deck, for the card images the replay shows. */
  cards: DeckCard[]
  /** Switch to the smallest game count, offered when a run is slow. */
  onFewer?: () => void
}

export function PlaytestResults({ goal, state, cards, onFewer }: Props) {
  if (goalIsEmpty(goal)) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">3 · How often you get there</h2>
        <p className="rounded-lg bg-slate-100 px-3 py-6 text-center text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          Put something on the board above and this will work out how often your deck can build it
          by the end of turn 1.
        </p>
      </section>
    )
  }

  const { result, running, progress, total, startedAt, error } = state

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">3 · How often you get there</h2>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          The playtest failed: {error}
        </p>
      )}

      {running && (
        <SimulationProgress
          progress={progress}
          total={total}
          startedAt={startedAt}
          updating={result !== null}
          onFewer={onFewer}
        />
      )}

      {result && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <div
                  data-testid="playtest-probability"
                  className="tnum text-5xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400"
                >
                  {pct(result.strict)}
                </div>
                <div className="mt-1 text-sm font-medium">of games build this board</div>
                <div className="text-xs text-slate-500">
                  averaged over going first and going second
                </div>
                <div className="tnum text-xs text-slate-500">
                  ±{pct(result.margin, 1)} at 95% confidence, over{' '}
                  {result.trials.toLocaleString()} games
                  {running && ' · updating…'}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Going first</dt>
                  <dd data-testid="going-first" className="tnum text-xl font-semibold">
                    {pct(result.goingFirst.strict)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Going second</dt>
                  <dd data-testid="going-second" className="tnum text-xl font-semibold">
                    {pct(result.goingSecond.strict)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Average closeness</dt>
                  <dd className="tnum text-xl font-semibold">{pct(result.closeness)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Mulligan rate</dt>
                  <dd className="tnum text-xl font-semibold">{pct(result.mulliganRate)}</dd>
                </div>
              </dl>
            </div>

            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
              Unlike the opening-hand odds, this is a simulation rather than a closed form, so it
              carries a margin of error. It plays out the best line each hand can manage, choosing
              the opening Active, benching, attaching and retreating as needed — and it knows which
              cards are prized when it picks that opening, which a real player would not, so treat
              it as a mild upper bound. Going first, it plays no Supporter on turn 1, as the rules
              require; each game is played both ways from the same deal.
            </p>
          </div>

          {result.parts.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-sm font-semibold">Each part of the board</h3>
              <p className="mt-0.5 mb-3 text-xs text-slate-500">
                How often each piece comes together on its own. The part lowest down the list is
                what is costing you the whole board.
              </p>
              <ul className="space-y-2">
                {[...result.parts]
                  .sort((a, b) => b.metRate - a.metRate)
                  .map((part) => (
                    <li key={part.id} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate">{part.label}</span>
                        <span className="flex shrink-0 items-baseline gap-2">
                          <span className="tnum text-xs text-slate-500">
                            1st {pct(rateIn(result.goingFirst.parts, part.id))} · 2nd{' '}
                            {pct(rateIn(result.goingSecond.parts, part.id))}
                          </span>
                          <span className="tnum font-medium">{pct(part.metRate)}</span>
                        </span>
                      </div>
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                        role="presentation"
                      >
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${part.metRate * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
              </ul>
              <Combinations parts={result.parts} patterns={result.patterns} />
            </div>
          )}

          {result.examples.length > 0 && (
            <Routes
              // Remount on a fresh run so the shown route resets to the first.
              key={`${result.trials}-${result.examples.length}-${result.examples[0].steps[0] ?? ''}`}
              examples={result.examples}
              cards={cards}
            />
          )}

          {(result.ignored.length > 0 || result.truncated > 0) && (
            <div className="space-y-2">
              {result.ignored.length > 0 && (
                <details className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <summary className="cursor-pointer">
                    {plural(result.ignored.length, 'card')} in this deck are treated as doing
                    nothing
                  </summary>
                  <p className="mt-1">
                    Some genuinely cannot matter on turn 1 — Unfair Stamp needs one of your Pokémon
                    to have been Knocked Out, Boss's Orders only moves theirs. Others are simply not
                    implemented yet. Either way the simulator never guesses at a card's text, so
                    these results may understate a deck that leans on them.
                  </p>
                  <p className="mt-1 font-mono">{result.ignored.join(' · ')}</p>
                </details>
              )}

              {result.truncated > 0 && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  In {pct(result.truncated / result.trials)} of games the search hit its budget
                  before exploring every line. That can only miss a way through, never invent one,
                  so the real figure is at least this high.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

const rateIn = (parts: PartStat[], id: string): number =>
  parts.find((part) => part.id === id)?.metRate ?? 0

/**
 * The routes a deck took to the board, one at a time.
 *
 * A run collects several *distinct* successful lines — two that make the same
 * plays in a different order count as one — so stepping through them shows
 * genuinely different ways there rather than the same way reshuffled.
 */
function Routes({ examples, cards }: { examples: PlaytestExample[]; cards: DeckCard[] }) {
  const [index, setIndex] = useState(0)
  const example = examples[Math.min(index, examples.length - 1)]
  const more = examples.length > 1

  return (
    <div
      data-testid="example-line"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {example.reached ? 'How it gets there' : 'The closest it came'}
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {example.goingFirst ? 'going first' : 'going second'}
          </span>
        </h3>
        {more && (
          <div className="flex items-center gap-2">
            <span className="tnum text-xs text-slate-500">
              route {Math.min(index, examples.length - 1) + 1} of {examples.length}
            </span>
            <button
              type="button"
              onClick={() => setIndex((n) => (n + 1) % examples.length)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Another way
            </button>
          </div>
        )}
      </div>

      <p className="mt-0.5 mb-3 text-xs text-slate-500">
        {example.reached
          ? 'One real game, played out in full — the deal first, then every play in order.'
          : 'No game reached the whole board. This is the best any of them managed.'}
      </p>

      <ol className="space-y-1.5 text-sm">
        {example.steps.map((step, position) => (
          <li key={`${position}-${step}`} className="flex gap-2">
            <span className="tnum w-5 shrink-0 text-right text-xs text-slate-400">
              {position + 1}.
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {/* Keyed on the route, so picking another way rewinds to its first move. */}
      <ReplayPlayer key={index} frames={example.frames} cards={cards} />
    </div>
  )
}
