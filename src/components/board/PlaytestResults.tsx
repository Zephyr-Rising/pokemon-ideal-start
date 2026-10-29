import { goalIsEmpty, type FieldGoal } from '../../lib/board/goal'
import { pct, plural } from '../../lib/format'
import type { PlaytestState } from '../../lib/use-playtest'

interface Props {
  goal: FieldGoal
  state: PlaytestState
  trials: number
}

export function PlaytestResults({ goal, state, trials }: Props) {
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

  const { result, running, progress, error } = state

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">3 · How often you get there</h2>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          The playtest failed: {error}
        </p>
      )}

      {!result && running && (
        <p className="rounded-lg bg-slate-100 px-3 py-6 text-center text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          Playing out {trials.toLocaleString()} games… {progress.toLocaleString()} done
        </p>
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
                <div className="tnum text-xs text-slate-500">
                  ±{pct(result.margin, 1)} at 95% confidence, over{' '}
                  {result.trials.toLocaleString()} games
                  {running && ' · updating…'}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
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
              it as a mild upper bound.
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
                        <span className="tnum shrink-0 font-medium">{pct(part.metRate)}</span>
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
            </div>
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
