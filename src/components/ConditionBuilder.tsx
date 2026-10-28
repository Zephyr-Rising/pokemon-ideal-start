import type { Requirement, RequirementOp } from '../lib/prob/analyze'
import type { DeckCard } from '../lib/types'

const OPS: { value: RequirementOp; label: string }[] = [
  { value: 'atLeast', label: 'at least' },
  { value: 'atMost', label: 'at most' },
  { value: 'exactly', label: 'exactly' },
]

interface Props {
  cards: DeckCard[]
  requirements: Requirement[]
  seeded: boolean
  onChange: (requirements: Requirement[]) => void
  onReseed: () => void
}

export function ConditionBuilder({ cards, requirements, seeded, onChange, onReseed }: Props) {
  const byKey = new Map(cards.map((card) => [card.key, card]))

  const update = (id: string, patch: Partial<Requirement>) =>
    onChange(requirements.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const addRow = () =>
    onChange([
      ...requirements,
      {
        id: `row-${Date.now()}`,
        label: `Requirement ${requirements.length + 1}`,
        cardKeys: [],
        op: 'atLeast',
        n: 1,
      },
    ])

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">2 · What counts as an ideal start?</h2>
        <button
          type="button"
          onClick={onReseed}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Reset to suggested
        </button>
      </header>

      <p className="text-xs text-slate-500">
        Every row must be satisfied. Cards within a row count together, so{' '}
        <em>at least 1</em> across three search Items means “any one of them”.
        {seeded && ' These rows are a suggestion from your decklist — edit them freely.'}
      </p>

      <ul className="space-y-3">
        {requirements.map((requirement) => {
          const selected = requirement.cardKeys
            .map((key) => byKey.get(key))
            .filter((card): card is DeckCard => card !== undefined)
          const copies = selected.reduce((sum, card) => sum + card.count, 0)
          const unselected = cards.filter((card) => !requirement.cardKeys.includes(card.key))

          return (
            <li
              key={requirement.id}
              className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={requirement.label}
                  onChange={(event) => update(requirement.id, { label: event.target.value })}
                  aria-label="Requirement name"
                  className="min-w-40 grow rounded-md border border-slate-300 px-2 py-1 text-sm font-medium focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                />
                <select
                  value={requirement.op}
                  onChange={(event) =>
                    update(requirement.id, { op: event.target.value as RequirementOp })
                  }
                  aria-label="Comparison"
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  {OPS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={requirement.n}
                  onChange={(event) =>
                    update(requirement.id, {
                      n: Math.max(0, Math.min(60, Number(event.target.value) || 0)),
                    })
                  }
                  aria-label="How many copies"
                  className="tnum w-16 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                <span className="tnum text-xs text-slate-500">
                  of {copies} {copies === 1 ? 'copy' : 'copies'}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(requirements.filter((r) => r.id !== requirement.id))}
                  aria-label={`Remove ${requirement.label}`}
                  className="ml-auto rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                >
                  Remove
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {selected.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() =>
                      update(requirement.id, {
                        cardKeys: requirement.cardKeys.filter((key) => key !== card.key),
                      })
                    }
                    className="tnum group flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-900 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:border-rose-800 dark:hover:bg-rose-950/50 dark:hover:text-rose-200"
                    title="Remove from this row"
                  >
                    {card.count}× {card.label}
                    <span aria-hidden className="text-slate-400 group-hover:text-rose-500">
                      ×
                    </span>
                  </button>
                ))}

                {selected.length === 0 && (
                  <span className="text-xs text-slate-400">No cards yet — add one →</span>
                )}

                <select
                  value=""
                  disabled={unselected.length === 0}
                  onChange={(event) => {
                    if (!event.target.value) return
                    update(requirement.id, {
                      cardKeys: [...requirement.cardKeys, event.target.value],
                    })
                  }}
                  aria-label={`Add a card to ${requirement.label}`}
                  className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">+ add card</option>
                  {unselected.map((card) => (
                    <option key={card.key} value={card.key}>
                      {card.count}× {card.label}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={addRow}
        className="rounded-md border border-dashed border-slate-400 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      >
        + Add requirement
      </button>
    </section>
  )
}
