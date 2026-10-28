import { signedPct } from '../lib/format'
import type { SensitivityRow } from '../lib/prob/sensitivity'

export function SensitivityTable({ rows }: { rows: SensitivityRow[] }) {
  if (rows.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">4 · What each copy is worth</h2>
      <p className="text-xs text-slate-500">
        Change in the 8-card figure from running one more or one fewer copy, holding the deck at
        its current size by trading against a <strong>neutral card</strong> — one in no requirement
        row and not a Basic Pokémon. Cards that cannot move the number are left out. Biggest movers
        first.
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table data-testid="sensitivity-table" className="w-full text-sm">
          <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Card
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Copies
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Cut one
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Add one
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="px-3 py-1.5">{row.label}</td>
                <td className="tnum px-3 py-1.5 text-right text-slate-500">{row.count}</td>
                <td className="tnum px-3 py-1.5 text-right">
                  <Delta value={row.minusOne} />
                </td>
                <td className="tnum px-3 py-1.5 text-right">
                  {row.plusOne === null ? (
                    <span
                      className="cursor-help text-xs text-slate-400"
                      title={row.plusOneBlocked}
                    >
                      —
                    </span>
                  ) : (
                    <Delta value={row.plusOne} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>
  const tone =
    Math.abs(value) < 5e-5
      ? 'text-slate-400'
      : value > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-rose-600 dark:text-rose-400'
  return <span className={tone}>{signedPct(value)}</span>
}
