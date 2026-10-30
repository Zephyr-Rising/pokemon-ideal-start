import { useState } from 'react'

import { goalIsEmpty, type FieldGoal } from '../../lib/board/goal'
import { pct, plural } from '../../lib/format'
import type { LuckStat } from '../../lib/sim/luck'
import { priorityRows, type Priority } from '../../lib/board/goal'
import {
  MAX_TURNS,
  type TurnsExample,
  type TurnsOrderResult,
  type TurnsResult,
} from '../../lib/sim/turns'
import type { DeckCard } from '../../lib/types'
import type { TurnsState } from '../../lib/use-playtest'
import { PartialSuccessTurns } from './PartialSuccess'
import { PrizeNote } from './PrizeNote'
import { ReplayPlayer } from './ReplayPlayer'
import { SimulationProgress } from './SimulationProgress'

interface Props {
  goal: FieldGoal
  state: TurnsState
  /** The resolved deck, for the card images the replay shows. */
  cards: DeckCard[]
  /** Switch to the smallest game count, offered when a run is slow. */
  onFewer?: () => void
}

/** "Turn 3", or a plain statement when fewer than half the games get there. */
const medianText = (order: TurnsOrderResult): string =>
  order.median === null ? `after turn ${MAX_TURNS}` : `turn ${order.median}`

const meanText = (order: TurnsOrderResult): string =>
  order.mean === null ? '—' : order.mean.toFixed(1)

export function TurnsResults({ goal, state, cards, onFewer }: Props) {
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

  const { result, running, progress, total, startedAt, error } = state

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">3 · How many turns it takes</h2>

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          The simulation failed: {error}
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
              second. Several of the most promising boards are carried from each turn into the
              next, so a turn can set up for the one after rather than only making its own best
              progress. There is no opponent to interrupt it, so read this as the deck's own pace.
              The average counts only the games that get there by turn {MAX_TURNS}.
            </p>
            <PartialSuccessTurns goal={goal} tiers={result.tiers} />
            <PrizeNote
              locked={result.prizeLocked}
              reached={result.reached}
              what={`build it by turn ${MAX_TURNS}`}
            />
          </div>

          {result.parts.length > 1 && <PartTurns result={result} />}

          <TurnItComesTogether goal={goal} result={result} />

          {result.luck.factors.length > 0 && <Luck luck={result.luck} />}

          {result.examples.length > 0 && (
            <TurnExamples
              // Remount on a fresh run so the shown game resets to the fastest.
              key={`${result.trials}-${result.examples.map((e) => `${e.turn}${e.goingFirst}`).join('')}`}
              examples={result.examples}
              cards={cards}
            />
          )}

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
                  {pct(result.turnsTruncated / Math.max(result.turnsPlayed, 1))} of turns played (
                  {result.turnsTruncated.toLocaleString()} of {result.turnsPlayed.toLocaleString()},
                  in {pct(result.truncated / result.trials)} of games) hit the search budget before
                  exploring every line. That can only make a game slower, never faster, so the
                  real pace is at least this good.
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

/**
 * Each part of the board on its own: which turn it usually comes together,
 * and how often it has by the last turn played. Slowest first, since that is
 * the part holding the whole board back.
 */
function PartTurns({ result }: { result: TurnsResult }) {
  const order = (id: string, side: TurnsResult['goingFirst']) =>
    side.parts.find((part) => part.id === id)
  // A part with no median is slower than any that has one.
  const pace = (part: TurnsOrderResult) => part.median ?? MAX_TURNS + 1
  const parts = [...result.parts].sort(
    (a, b) => pace(b) - pace(a) || (b.mean ?? 0) - (a.mean ?? 0) || a.reached - b.reached,
  )

  return (
    <div
      data-testid="turns-parts"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h3 className="text-sm font-semibold">Each part of the board</h3>
      <p className="mt-0.5 mb-3 text-xs text-slate-500">
        The turn each piece usually comes together on its own
        {result.prizeLocked.games > 0 && ', in the games where the board was possible'}. The part
        at the top is the one holding the whole board back. The bar is how often it is in place by
        turn {MAX_TURNS}.
      </p>
      <ul className="space-y-2">
        {parts.map((part) => {
          const first = order(part.id, result.goingFirst)
          const second = order(part.id, result.goingSecond)
          return (
            <li key={part.id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{part.label}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="tnum text-xs text-slate-500">
                    1st {first ? medianText(first) : '—'} · 2nd {second ? medianText(second) : '—'}
                  </span>
                  <span className="tnum font-medium">
                    {medianText(part)}
                    {part.mean !== null && (
                      <span className="font-normal text-slate-500"> · avg {part.mean.toFixed(1)}</span>
                    )}
                  </span>
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                role="presentation"
              >
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${part.reached * 100}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Real games played out turn by turn, fastest first, with one for every turn
 * any game built the board on, so the slow routes can be seen as well as the
 * quick ones.
 */
function TurnExamples({ examples, cards }: { examples: TurnsExample[]; cards: DeckCard[] }) {
  const [index, setIndex] = useState(0)
  const example = examples[Math.min(index, examples.length - 1)]

  return (
    <div
      data-testid="turns-examples"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h3 className="text-sm font-semibold">How games get there</h3>
      <p className="mt-0.5 mb-3 text-xs text-slate-500">
        Real games from this run, fastest first: one for every turn a game built the board on, from
        each turn order, and one that never got there, to show what held it back.
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Example games">
        {examples.map((option, i) => (
          <button
            key={`${option.turn}-${option.goingFirst}`}
            type="button"
            onClick={() => setIndex(i)}
            aria-pressed={i === index}
            className={[
              'rounded-md border px-2.5 py-1 text-xs',
              i === index
                ? 'border-sky-500 bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'
                : 'border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800',
            ].join(' ')}
          >
            {option.turn === null ? 'Later' : `Turn ${option.turn}`} ·{' '}
            {option.goingFirst ? 'going first' : 'going second'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {example.turns.map((turn) => (
          <div key={turn.turn}>
            <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Turn {turn.turn}
              {turn.turn === example.turn && ' · board complete'}
              {example.turn === null &&
                turn.turn === example.turns[example.turns.length - 1].turn &&
                ` · not built by turn ${MAX_TURNS}`}
            </h4>
            <ol className="mt-1 space-y-1 text-sm">
              {turn.steps.map((step, position) => (
                <li key={`${position}-${step}`} className="flex gap-2">
                  <span className="tnum w-5 shrink-0 text-right text-xs text-slate-400">
                    {position + 1}.
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {/* Keyed on the game, so picking another rewinds to its deal. */}
      <ReplayPlayer
        key={index}
        frames={example.turns.flatMap((turn) => turn.frames)}
        cards={cards}
      />
    </div>
  )
}

const PERCENTILE_LABELS: Record<number, string> = {
  0.1: 'Luckiest 10%',
  0.25: 'Luckiest quarter',
  0.5: 'Typical game',
  0.75: 'Unluckiest quarter',
  0.9: 'Unluckiest 10%',
}

/**
 * How far luck alone moves the turn, and which luck: the spread across every
 * game, then the games grouped by what the deal gave them before a card was
 * played.
 */
function Luck({ luck }: { luck: LuckStat }) {
  return (
    <div
      data-testid="turns-luck"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h3 className="text-sm font-semibold">How luck changes it</h3>
      <p className="mt-0.5 mb-3 text-xs text-slate-500">
        The same deck and the same plan, dealt different hands. Each figure is the turn by which
        that share of games has the board.
      </p>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {luck.percentiles.map(({ share, turn }) => (
          <li
            key={share}
            className={[
              'rounded-lg px-3 py-2',
              share === 0.5
                ? 'bg-emerald-50 dark:bg-emerald-950/40'
                : 'bg-slate-50 dark:bg-slate-800/60',
            ].join(' ')}
          >
            <div className="text-xs text-slate-500">{PERCENTILE_LABELS[share]}</div>
            <div className="tnum text-lg font-semibold">
              {turn === null ? `after turn ${MAX_TURNS}` : `turn ${turn}`}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4 space-y-4">
        {luck.factors.map((factor) => (
          <table key={factor.name} className="w-full text-sm">
            <caption className="mb-1 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {factor.name}
            </caption>
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th scope="col" className="pb-1 font-normal" />
                <th scope="col" className="pb-1 text-right font-normal">
                  Games
                </th>
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
              {factor.buckets.map((bucket) => (
                <tr key={bucket.label} className="border-t border-slate-100 dark:border-slate-800">
                  <th scope="row" className="py-1 text-left font-normal">
                    {bucket.label}
                  </th>
                  <td className="py-1 text-right text-slate-500">{pct(bucket.share)}</td>
                  <td className="py-1 text-right">{medianText(bucket)}</td>
                  <td className="py-1 text-right">{meanText(bucket)}</td>
                  <td className="py-1 text-right font-medium">{pct(bucket.reached)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  )
}

/**
 * When the board comes together, turn by turn. With priorities in use, a
 * toggle shows the same for each level — when the essential parts come
 * together, then the important ones, then the whole board.
 */
function TurnItComesTogether({ goal, result }: { goal: FieldGoal; result: TurnsResult }) {
  const levels = priorityRows(goal)
  const whole = levels[levels.length - 1]?.level
  const [shown, setShown] = useState<Priority | null>(null)
  // The whole board unless a level was picked (and is still in use).
  const level = shown !== null && levels.some((l) => l.level === shown) ? shown : whole

  const tierOf = (side: TurnsResult | TurnsResult['goingFirst']) =>
    side.tiers.find((tier) => tier.priority === level)
  const overall = level !== undefined && level !== whole ? tierOf(result) : undefined
  const view =
    overall && tierOf(result.goingFirst) && tierOf(result.goingSecond)
      ? { ...overall, goingFirst: tierOf(result.goingFirst)!, goingSecond: tierOf(result.goingSecond)! }
      : result
  const what = levels.find((l) => l.level === level)?.label.toLowerCase() ?? 'the board'

  return (
    <div
      data-testid="turns-distribution-card"
      className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">The turn it comes together</h3>
        {levels.length > 1 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Priority level shown">
            {levels.map(({ level: option, label }) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === level}
                onClick={() => setShown(option)}
                className={[
                  'rounded-md border px-2 py-0.5 text-xs',
                  option === level
                    ? 'border-sky-500 bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-0.5 mb-3 text-xs text-slate-500">
        How often {levels.length > 1 ? what : 'the board'} first {levels.length > 1 && what.endsWith('parts') ? 'come' : 'comes'}{' '}
        together on each turn, and how often by then.
      </p>
      <Distribution result={view} />
    </div>
  )
}
