import { usedPriorities, type FieldGoal, type Priority } from '../../lib/board/goal'
import { pct } from '../../lib/format'
import { MAX_TURNS, type TurnsOrderResult } from '../../lib/sim/turns'

/**
 * What each priority level asks for, read cumulatively: a level is met when
 * every part at it or more important is in place. The least important level
 * the goal uses is the whole board.
 */
function levelLabel(level: Priority, isWhole: boolean): string {
  if (isWhole) return 'Whole board'
  return level === 1 ? 'Essential parts' : 'Essential and important parts'
}

/** The levels worth a row: every level the goal uses, if it uses more than one. */
function rows(goal: FieldGoal): { level: Priority; label: string }[] {
  const used = usedPriorities(goal)
  if (used.length < 2) return []
  return used.map((level, i) => ({ level, label: levelLabel(level, i === used.length - 1) }))
}

/** Turn 1: how often each level is reached. */
export function PartialSuccessRates({
  goal,
  tiers,
}: {
  goal: FieldGoal
  tiers: { priority: Priority; rate: number }[]
}) {
  const levels = rows(goal)
  if (levels.length === 0) return null
  return (
    <div data-testid="partial-success" className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Partial success</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {levels.map(({ level, label }) => (
          <li key={level} className="flex items-baseline justify-between gap-2">
            <span>{label}</span>
            <span className="tnum font-medium">
              {pct(tiers.find((tier) => tier.priority === level)?.rate ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Turns to build: when each level comes together. */
export function PartialSuccessTurns({
  goal,
  tiers,
}: {
  goal: FieldGoal
  tiers: (TurnsOrderResult & { priority: Priority })[]
}) {
  const levels = rows(goal)
  if (levels.length === 0) return null
  return (
    <table data-testid="partial-success" className="mt-4 w-full text-sm">
      <caption className="mb-1 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Partial success
      </caption>
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
        {levels.map(({ level, label }) => {
          const tier = tiers.find((t) => t.priority === level)
          return (
            <tr key={level} className="border-t border-slate-100 dark:border-slate-800">
              <th scope="row" className="py-1 text-left font-normal">
                {label}
              </th>
              <td className="py-1 text-right">
                {tier?.median == null ? `after turn ${MAX_TURNS}` : `turn ${tier.median}`}
              </td>
              <td className="py-1 text-right">{tier?.mean == null ? '—' : tier.mean.toFixed(1)}</td>
              <td className="py-1 text-right font-medium">{pct(tier?.reached ?? 0)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
