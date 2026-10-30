import { pct } from '../../lib/format'
import type { PrizeLockStat } from '../../lib/sim/prizes'

/** How many of the most common prized cards to name. */
const SHOWN_REASONS = 3

/**
 * Games the prizes made impossible before a card was played: how often, which
 * cards, and what the result looks like over the games that were possible.
 */
export function PrizeNote({
  locked,
  reached,
  what,
}: {
  locked: PrizeLockStat
  /** The headline share of all games. */
  reached: number
  /** What `reached` measures, e.g. "build this board" or "build it by turn 6". */
  what: string
}) {
  if (locked.games === 0) return null
  const possible = 1 - locked.rate
  const reasons = locked.reasons.slice(0, SHOWN_REASONS)

  return (
    <p
      data-testid="prize-note"
      className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
    >
      In <span className="tnum font-medium">{pct(locked.rate)}</span> of games a card the board
      needs was prized, so it could never be built — most often{' '}
      {reasons.map((reason, i) => (
        <span key={reason.label}>
          {i > 0 && (i === reasons.length - 1 ? ' or ' : ', ')}
          {reason.label} (<span className="tnum">{pct(reason.rate)}</span>)
        </span>
      ))}
      . Those count as misses above. Of the games where it was possible,{' '}
      <span className="tnum font-medium">{pct(possible > 0 ? reached / possible : 0)}</span> {what}.
    </p>
  )
}
