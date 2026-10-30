import { useEffect, useState } from 'react'

/** Past this, a run is slow enough to explain and to offer a quicker one. */
const SLOW_MS = 10_000

interface Props {
  /** Games played so far, and how many the run will play. */
  progress: number
  total: number
  /** When the run started, from `performance.now()`. */
  startedAt: number | null
  /** Shown when a previous result is still on screen while this one runs. */
  updating: boolean
  /** Switch to the smallest game count; absent when already there. */
  onFewer?: () => void
}

const seconds = (ms: number): string => {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/**
 * How far a long simulation has got, and roughly how long is left.
 *
 * The estimate is the pace so far carried forward, which is honest for these
 * runs: every game is the same kind of work, so the rate barely drifts. Until
 * a few games are in, it says nothing rather than guessing.
 */
export function SimulationProgress({ progress, total, startedAt, updating, onFewer }: Props) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 500)
    return () => window.clearInterval(id)
  }, [])

  const elapsed = startedAt === null ? 0 : now - startedAt
  const share = total > 0 ? Math.min(1, progress / total) : 0
  const remaining = progress > 0 && share < 1 ? (elapsed / progress) * (total - progress) : null
  const slow = elapsed > SLOW_MS

  return (
    <div
      data-testid="simulation-progress"
      className="space-y-2 rounded-lg bg-slate-100 px-4 py-4 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          {updating ? 'Updating' : 'Playing out'} {total.toLocaleString()} games…{' '}
          <span className="tnum">{progress.toLocaleString()}</span> done
        </span>
        <span className="tnum text-xs">
          {seconds(elapsed)} so far
          {remaining !== null && ` · about ${seconds(remaining)} left`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Games played"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={progress}
        className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <div
          className="h-full rounded-full bg-sky-500 transition-[width] duration-300"
          style={{ width: `${share * 100}%` }}
        />
      </div>
      {slow && (
        <p className="text-xs">
          This board is taking a while: each game searches every line of play, and a board that
          needs many cards to line up has a lot of them. It is still going.
          {onFewer && (
            <>
              {' '}
              For a quicker, rougher answer,{' '}
              <button
                type="button"
                onClick={onFewer}
                className="font-medium text-sky-700 underline hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300"
              >
                play fewer games
              </button>
              .
            </>
          )}
        </p>
      )}
    </div>
  )
}
