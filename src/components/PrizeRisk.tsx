import { pct } from '../lib/format'
import type { PrizeRiskRow } from '../lib/prob/prizes'

interface Props {
  cards: PrizeRiskRow[]
  groups: PrizeRiskRow[]
}

export function PrizeRisk({ cards, groups }: Props) {
  if (cards.length === 0 && groups.length === 0) return null
  const both = cards.length > 0 && groups.length > 0

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">6 · Prize-zone risk</h2>
      <p className="text-xs text-slate-500">
        Six cards are set aside face down before the game starts, where nothing can search them
        out. These are the odds that <em>every</em> copy ends up there. Cards with more than six
        copies are omitted, since losing all of them is impossible.
      </p>

      {/* Only split into columns when there is genuinely something in both,
          otherwise a lone table would sit beside an empty half. */}
      <div className={both ? 'grid gap-3 md:grid-cols-2' : 'grid gap-3'}>
        {groups.length > 0 && <RiskTable title="By requirement row" rows={groups} unit="copies" />}
        {cards.length > 0 && <RiskTable title="By card" rows={cards} unit="copies" />}
      </div>
    </section>
  )
}

function RiskTable({
  title,
  rows,
  unit,
}: {
  title: string
  rows: PrizeRiskRow[]
  unit: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <h3 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-800">
        {title}
      </h3>
      <table className="w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Name</th>
            <th scope="col">{unit}</th>
            <th scope="col">All copies prized</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-3 py-1.5">{row.label}</td>
              <td className="tnum px-3 py-1.5 text-right text-slate-500">{row.count}×</td>
              <td className="tnum px-3 py-1.5 text-right font-medium">
                {pct(row.probability, 2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
