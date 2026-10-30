import { goalIsEmpty, type FieldGoal } from '../../lib/board/goal'
import { pct, plural } from '../../lib/format'
import { MAX_TURNS, type TurnsOrderResult } from '../../lib/sim/turns'
import type { TurnsState } from '../../lib/use-playtest'

interface Props {
  goal: FieldGoal
  state: TurnsState
  trials: number
}

/** "Turn 3", or a plain statement when fewer than half the games get there. */
const medianText = (order: TurnsOrderResult): string =>
  order.median === null ? `after turn ${MAX_TURNS}` : `turn ${order.median}`

const meanText = (order: TurnsOrderResult): string =>
  order.mean === null ? '—' : order.mean.toFixed(1)

export function TurnsResults({ goal, state, trials }: Props) {
  if (goalIsEmpty(goal)) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">3 · How many turns it takes</h2>
        <p className="rounded-lg bg-slate-100 px-3 py-6 text-center text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          Put something on the board above and this will work out which turn your deck usually
          builds it by.
        </p>
      </section>
    )
  }

  const { result, running, progress, error } = state

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">3 · How many turns it takes</h2>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          The simulation failed: {error}
        </p>
      )}

      {!result && running && (
        <p className="rounded-lg bg-slate-100 px-3 py-6 text-center text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          Playing out {trials.toLocaleString()} games, up to {MAX_TURNS} turns each…{' '}
          {progress.toLocaleString()} done
        </p>
      )}

      {result && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <div
                  data-testid="turns-median"
                  className="tnum text-5xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400"
                >
                  {result.median === null ? `${MAX_TURNS}+` : result.median}
                </div>
                <div className="mt-1 text-sm font-medium">
                  median turn to build this board
                </div>
                <div className="tnum text-xs text-slate-500">
                  averaged over going first and going second · {result.trials.toLocaleString()}{' '}
                  games
                  {running && ' · updating…'}
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Average turn</dt>
                  <dd data-testid="turns-mean" className="tnum text-xl font-semibold">
                    {meanText(result)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Built by turn {MAX_TURNS}</dt>
                  <dd className="tnum text-xl font-semibold">{pct(result.reached)}</dd>
                </div>
              </dl>
            </div>

            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th scope="col" className="pb-1 font-normal" />
                  <th scope="col" className="pb-1 text-right font-normal">
                    Median
                  </th>
                  <th scope="col" className="pb-1 text-right font-normal">
                    Average
                  </th>
                  <th scope="col" className="pb-1 text-right font-normal">
                    By turn {MAX_TURNS}
                  </th>
                </tr>
              </thead>
              <tbody className="tnum">
                {(
                  [
                    ['Going first', result.goingFirst, 'turns-first'],
                    ['Going second', result.goingSecond, 'turns-second'],
                  ] as const
                ).map(([name, order, testId]) => (
                  <tr key={name} data-testid={testId} className="border-t border-slate-100 dark:border-slate-800">
                    <th scope="row" className="py-1 text-left font-normal">
                      {name}
                    </th>
                    <td className="py-1 text-right">{medianText(order)}</td>
                    <td className="py-1 text-right">{meanText(order)}</td>
                    <td className="py-1 text-right">{pct(order.reached)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
              Each game is played turn by turn, drawing a card each turn and evolving from the
              second, with each turn making the best progress it can toward the board. It never
              holds back for a later turn and there is no opponent to interrupt it, so read this as
              the deck's own pace. The average counts only the games that get there by turn{' '}
              {MAX_TURNS}.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold">The turn it comes together</h3>
            <p className="mt-0.5 mb-3 text-xs text-slate-500">
              How often the board is first complete on each turn, and how often by then.
            </p>
            <Distribution result={result} />
          </div>

          {(result.ignored.length > 0 || result.truncated > 0) && (
            <div className="space-y-2 text-xs">
              {result.ignored.length > 0 && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {plural(result.ignored.length, 'card')} in this deck are treated as doing nothing:{' '}
                  <span className="font-mono">{result.ignored.join(' · ')}</span>
                </p>
              )}
              {result.truncated > 0 && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  In {pct(result.truncated / result.trials)} of games some turn's search hit its
                  budget before exploring every line. That can only make a game slower, never
                  faster, so the real pace is at least this good.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Distribution({ result }: { result: TurnsOrderResult & { goingFirst: TurnsOrderResult; goingSecond: TurnsOrderResult } }) {
  const peak = Math.max(...result.byTurn, 1 - result.reached, 0.0001)
  const rows = result.byTurn.map((share, i) => ({
    label: `Turn ${i + 1}`,
    share,
    // Share of games that have it by the end of this turn.
    cumulative: result.byTurn.slice(0, i + 1).reduce((sum, s) => sum + s, 0),
    first: result.goingFirst.byTurn[i],
    second: result.goingSecond.byTurn[i],
  }))

  return (
    <table className="w-full text-sm" data-testid="turns-distribution">
      <thead>
        <tr className="text-left text-xs text-slate-500">
          <th scope="col" className="pb-1 font-normal" />
          <th scope="col" className="pb-1 font-normal" />
          <th scope="col" className="pb-1 text-right font-normal">
            That turn
          </th>
          <th scope="col" className="pb-1 text-right font-normal">
            By then
          </th>
          <th scope="col" className="hidden pb-1 text-right font-normal sm:table-cell">
            1st · 2nd
          </th>
        </tr>
      </thead>
      <tbody className="tnum">
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-slate-100 dark:border-slate-800">
            <th scope="row" className="w-16 py-1 text-left font-normal whitespace-nowrap">
              {row.label}
            </th>
            <td className="w-full px-2 py-1">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="presentation">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(row.share / peak) * 100}%` }} />
              </div>
            </td>
            <td className="py-1 text-right font-medium">{pct(row.share)}</td>
            <td className="py-1 pl-3 text-right text-slate-500">{pct(row.cumulative)}</td>
            <td className="hidden py-1 pl-3 text-right text-xs whitespace-nowrap text-slate-500 sm:table-cell">
              {pct(row.first)} · {pct(row.second)}
            </td>
          </tr>
        ))}
        <tr className="border-t border-slate-100 text-slate-500 dark:border-slate-800">
          <th scope="row" className="py-1 text-left font-normal whitespace-nowrap">
            Later
          </th>
          <td className="px-2 py-1">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="presentation">
              <div className="h-full rounded-full bg-slate-400" style={{ width: `${((1 - result.reached) / peak) * 100}%` }} />
            </div>
          </td>
          <td className="py-1 text-right">{pct(1 - result.reached)}</td>
          <td className="py-1 pl-3 text-right" />
          <td className="hidden py-1 pl-3 text-right text-xs whitespace-nowrap sm:table-cell">
            {pct(1 - result.goingFirst.reached)} · {pct(1 - result.goingSecond.reached)}
          </td>
        </tr>
      </tbody>
    </table>
  )
}
