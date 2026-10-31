import { useState } from 'react'

import { MAX_TURNS } from '../../lib/sim/turns'
import type { ProgressPreview } from '../../lib/sim/preview'

/**
 * How a run's result is shaping up while it plays: for Turns to build, the
 * share of games so far that built the board on each turn; for the turn-1
 * board, the running success rate with its margin narrowing as games come in.
 *
 * A preview, and labelled as one: early on a handful of games decide it.
 */
export function PreviewChart({ preview, done }: { preview: ProgressPreview | null; done: number }) {
  if (!preview || done === 0) return null
  return preview.kind === 'turns' ? (
    <TurnBars first={preview.first} second={preview.second} done={done} />
  ) : (
    <RateLine first={preview.first} second={preview.second} done={done} />
  )
}

const pct = (share: number) => `${(share * 100).toFixed(share >= 0.995 || share === 0 ? 0 : 1)}%`

/** One bar per turn, plus the games not built by the last: the shape so far. */
function TurnBars({ first, second, done }: { first: number[]; second: number[]; done: number }) {
  // The fair-coin average of the two turn orders, as the headline uses.
  const shares = first.map((count, i) => (count + second[i]) / (2 * done))
  const never = Math.max(0, 1 - shares.reduce((sum, share) => sum + share, 0))
  const bars = [
    ...shares.map((share, i) => ({ label: `T${i + 1}`, share, never: false })),
    // Not built by the last turn played.
    { label: `After T${MAX_TURNS}`, share: never, never: true },
  ]
  const tallest = Math.max(...bars.map((bar) => bar.share), 0.01)
  return (
    <figure data-testid="progress-preview" className="pt-1">
      <figcaption className="mb-1 text-[0.65rem] font-semibold tracking-wide text-slate-500 uppercase">
        So far · the turn it comes together
      </figcaption>
      <div className="flex gap-1.5" role="img" aria-label="Share of games so far by the turn the board came together">
        {bars.map((bar) => (
          <div key={bar.label} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
            <span className="tnum text-[0.6rem] text-slate-500">{pct(bar.share)}</span>
            {/* A track of its own, so the bar's height is its share and nothing else. */}
            <div className="flex h-16 w-full items-end">
              <div
                className={`w-full rounded-t-sm transition-[height] duration-300 ${
                  bar.never ? 'bg-slate-300 dark:bg-slate-700' : 'bg-sky-500'
                }`}
                style={{ height: `${(bar.share / tallest) * 100}%`, minHeight: bar.share > 0 ? 2 : 0 }}
              />
            </div>
            <span className="text-[0.6rem] text-slate-500">{bar.label}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}

/** The running success rate, game by game, inside its 95% margin. */
function RateLine({ first, second, done }: { first: number; second: number; done: number }) {
  const rate = (first + second) / (2 * done)
  // The history is kept here, a point per report, and starts over with a run.
  const [points, setPoints] = useState<{ done: number; rate: number }[]>([])
  const last = points[points.length - 1]
  if (!last || last.done !== done) {
    setPoints(last && done > last.done ? [...points, { done, rate }] : [{ done, rate }])
  }
  // A normal approximation, over the two orders' games together.
  const margin = 1.96 * Math.sqrt((rate * (1 - rate)) / Math.max(2 * done, 1))

  const W = 300
  const H = 64
  const total = Math.max(...points.map((p) => p.done), 1)
  const x = (n: number) => (n / total) * W
  const y = (r: number) => H - r * H
  const line = points.map((p) => `${x(p.done).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ')
  const band = points.map((p) => {
    const m = 1.96 * Math.sqrt((p.rate * (1 - p.rate)) / Math.max(2 * p.done, 1))
    return { x: x(p.done), hi: y(Math.min(1, p.rate + m)), lo: y(Math.max(0, p.rate - m)) }
  })
  const area =
    band.length > 1
      ? `M${band.map((b) => `${b.x.toFixed(1)},${b.hi.toFixed(1)}`).join(' L')} L${[...band]
          .reverse()
          .map((b) => `${b.x.toFixed(1)},${b.lo.toFixed(1)}`)
          .join(' L')} Z`
      : ''

  return (
    <figure data-testid="progress-preview" className="pt-1">
      <figcaption className="mb-1 flex items-baseline justify-between text-[0.65rem] font-semibold tracking-wide text-slate-500 uppercase">
        <span>So far · how often it builds</span>
        <span className="tnum text-xs font-semibold text-slate-700 normal-case dark:text-slate-200">
          {pct(rate)} ± {(margin * 100).toFixed(1)}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full overflow-visible"
        role="img"
        aria-label={`Running success rate: ${pct(rate)} after ${done} games`}
      >
        {[0.25, 0.5, 0.75].map((r) => (
          <line key={r} x1={0} x2={W} y1={y(r)} y2={y(r)} className="stroke-slate-300 dark:stroke-slate-700" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        ))}
        {area && <path d={area} className="fill-sky-500/15" />}
        <polyline points={line} fill="none" className="stroke-sky-600 dark:stroke-sky-400" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  )
}
