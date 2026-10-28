import { pct } from '../lib/format'
import type { Analysis } from '../lib/prob/analyze'

export function ResultsPanel({ analysis }: { analysis: Analysis }) {
  if (analysis.impossible) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">3 · Odds</h2>
        <p className="rounded-lg bg-rose-50 px-3 py-6 text-center text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {analysis.deckSize === 0
            ? 'Paste a decklist to see the odds.'
            : analysis.basicCount === 0
              ? 'This deck has no Basic Pokémon, so no legal opening hand exists.'
              : `Only ${analysis.deckSize} cards — at least 8 are needed for an opening hand and a draw.`}
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">3 · Odds</h2>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <div
              data-testid="headline-probability"
              className="tnum text-5xl font-bold tracking-tight text-sky-600 dark:text-sky-400"
            >
              {pct(analysis.firstLook)}
            </div>
            <div className="mt-1 text-sm font-medium">of games hit your ideal start</div>
            <div className="text-xs text-slate-500">
              across your first 8 cards — the opening 7 plus your turn-1 draw
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Stat label="Opening 7 only" value={pct(analysis.openingHand)} />
            <Stat label="Mulligan rate" value={pct(analysis.mulliganRate)} />
            <Stat
              label="Basic Pokémon"
              value={String(analysis.basicCount)}
              hint={`of ${analysis.deckSize}`}
            />
          </dl>
        </div>

        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
          Conditioned on a hand you actually keep: hands with no Basic Pokémon are reshuffled, so
          they are excluded rather than counted as failures. Both players draw on their first turn,
          so this figure is the same going first or second.
        </p>
      </div>

      {analysis.perAlternative.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold">Each route on its own</h3>
          <p className="mt-0.5 mb-3 text-xs text-slate-500">
            Any one route is enough, so the headline is at least as high as the best of these —
            and lower than their sum, because hands often satisfy more than one.
          </p>
          <Bars rows={analysis.perAlternative} tone="bg-emerald-500" />
        </div>
      )}

      {analysis.perRequirement.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-sm font-semibold">Each requirement on its own</h3>
          <p className="mt-0.5 mb-3 text-xs text-slate-500">
            How often each row is met individually. The headline above needs all of them at once,
            so it is lower than any single row.
          </p>
          <Bars rows={analysis.perRequirement} tone="bg-sky-500" />
        </div>
      )}
    </section>
  )
}

function Bars({
  rows,
  tone,
}: {
  rows: { id: string; label: string; probability: number | null }[]
  tone: string
}) {
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{row.label}</span>
            <span className="tnum shrink-0 font-medium">{pct(row.probability)}</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
            role="presentation"
          >
            <div
              className={`h-full rounded-full ${tone}`}
              style={{ width: `${(row.probability ?? 0) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tnum text-xl font-semibold">
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-slate-500">{hint}</span>}
      </dd>
    </div>
  )
}
