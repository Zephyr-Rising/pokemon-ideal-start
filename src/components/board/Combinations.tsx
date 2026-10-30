import { pct } from '../../lib/format'
import type { PartStat, PatternStat } from '../../lib/sim/playtest'

/**
 * Two prototype views of how the parts of a board come together, both derived
 * from the same record: which exact set of parts every game ended with.
 *
 * - **Every combination**: for each group of two or more parts, how often all
 *   of them were met together (whatever happened to the rest).
 * - **Exact outcomes**: each hit-or-miss pattern across every part, so the rows
 *   add up to 100%.
 */

/** Past this many parts the combination list stops being readable. */
const MAX_COMBINATION_PARTS = 6
/** The long tail of rare outcomes is folded into one row. */
const MAX_OUTCOME_ROWS = 12

interface Props {
  parts: PartStat[]
  patterns: PatternStat[]
}

export function Combinations({ parts, patterns }: Props) {
  if (parts.length < 2) return null
  return (
    <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
      <EveryCombination parts={parts} patterns={patterns} />
      <ExactOutcomes parts={parts} patterns={patterns} />
    </div>
  )
}

const DETAILS =
  'rounded-md border border-slate-200 px-3 py-2 text-xs dark:border-slate-800 [&[open]>summary]:mb-2'
const SUMMARY = 'cursor-pointer text-sm font-medium'

function EveryCombination({ parts, patterns }: Props) {
  const shown = parts.slice(0, MAX_COMBINATION_PARTS)
  const groups = subsets(shown.map((part) => part.id)).filter((group) => group.length >= 2)
  const rateOf = (group: string[]) =>
    patterns
      .filter((pattern) => group.every((id) => pattern.met.includes(id)))
      .reduce((sum, pattern) => sum + pattern.rate, 0)
  const label = new Map(parts.map((part) => [part.id, part.label]))
  const rows = groups
    .map((group) => ({ group, rate: rateOf(group) }))
    // Smaller groups first, as they read as the building blocks of larger ones.
    .sort((a, b) => a.group.length - b.group.length || b.rate - a.rate)

  return (
    <details className={DETAILS} data-testid="combinations">
      <summary className={SUMMARY}>Every combination</summary>
      <p className="mb-2 text-slate-500">
        How often each group of parts came together, whatever happened to the others.
        {parts.length > MAX_COMBINATION_PARTS &&
          ` Only the first ${MAX_COMBINATION_PARTS} parts are combined, to keep the list readable.`}
      </p>
      <ul className="space-y-1">
        {rows.map(({ group, rate }) => (
          <li key={group.join('|')} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              {group.length === shown.length && shown.length === parts.length ? (
                <span className="font-medium">All {group.length} parts</span>
              ) : (
                group.map((id) => label.get(id)).join(' + ')
              )}
            </span>
            <span className="tnum shrink-0 font-medium">{pct(rate)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function ExactOutcomes({ parts, patterns }: Props) {
  const top = patterns.slice(0, MAX_OUTCOME_ROWS)
  const rest = patterns.slice(MAX_OUTCOME_ROWS).reduce((sum, pattern) => sum + pattern.rate, 0)

  return (
    <details className={DETAILS} data-testid="outcomes">
      <summary className={SUMMARY}>Exact outcomes</summary>
      <p className="mb-2 text-slate-500">
        Every game ends in exactly one of these, so they add up to 100%.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-slate-500">
              {parts.map((part) => (
                <th
                  key={part.id}
                  scope="col"
                  className="max-w-24 truncate px-1 pb-1 font-normal"
                  title={part.label}
                >
                  {part.label}
                </th>
              ))}
              <th scope="col" className="pb-1 text-right font-normal">
                Games
              </th>
            </tr>
          </thead>
          <tbody>
            {top.map((pattern) => (
              <tr
                key={pattern.met.join('|') || 'none'}
                className="border-t border-slate-100 dark:border-slate-800"
              >
                {parts.map((part) => {
                  const met = pattern.met.includes(part.id)
                  return (
                    <td
                      key={part.id}
                      className={`px-1 py-0.5 ${met ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}
                    >
                      <span aria-hidden>{met ? '✓' : '✗'}</span>
                      <span className="sr-only">{met ? 'met' : 'missed'}</span>
                    </td>
                  )
                })}
                <td className="tnum py-0.5 text-right font-medium">{pct(pattern.rate)}</td>
              </tr>
            ))}
            {rest > 0 && (
              <tr className="border-t border-slate-100 text-slate-500 dark:border-slate-800">
                <td colSpan={parts.length} className="px-1 py-0.5">
                  {patterns.length - MAX_OUTCOME_ROWS} rarer outcomes
                </td>
                <td className="tnum py-0.5 text-right">{pct(rest)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Every subset of a list, in order of first element. */
function subsets<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let mask = 1; mask < 1 << items.length; mask++) {
    out.push(items.filter((_, i) => mask & (1 << i)))
  }
  return out
}
