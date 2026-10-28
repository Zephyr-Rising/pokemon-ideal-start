import type {
  Alternative,
  Condition,
  Requirement,
  RequirementOp,
  RequirementOption,
} from '../lib/prob/analyze'
import type { DeckCard } from '../lib/types'

const OPS: { value: RequirementOp; label: string }[] = [
  { value: 'atLeast', label: 'at least' },
  { value: 'atMost', label: 'at most' },
  { value: 'exactly', label: 'exactly' },
]

const ROUTE_NAMES = ['Main route', 'Second route', 'Third route', 'Fourth route']

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const blankOption = (): RequirementOption => ({
  id: newId('opt'),
  cardKeys: [],
  op: 'atLeast',
  n: 1,
})

interface Props {
  cards: DeckCard[]
  condition: Condition
  seeded: boolean
  onChange: (condition: Condition) => void
  onReseed: () => void
}

export function ConditionBuilder({ cards, condition, seeded, onChange, onReseed }: Props) {
  const byKey = new Map(cards.map((card) => [card.key, card]))

  const patchRoute = (routeId: string, patch: Partial<Alternative>) =>
    onChange(condition.map((r) => (r.id === routeId ? { ...r, ...patch } : r)))

  const patchRequirement = (routeId: string, reqId: string, patch: Partial<Requirement>) =>
    onChange(
      condition.map((route) =>
        route.id === routeId
          ? {
              ...route,
              requirements: route.requirements.map((req) =>
                req.id === reqId ? { ...req, ...patch } : req,
              ),
            }
          : route,
      ),
    )

  const patchOption = (
    routeId: string,
    reqId: string,
    optionId: string,
    patch: Partial<RequirementOption>,
  ) =>
    onChange(
      condition.map((route) =>
        route.id === routeId
          ? {
              ...route,
              requirements: route.requirements.map((req) =>
                req.id === reqId
                  ? {
                      ...req,
                      options: req.options.map((opt) =>
                        opt.id === optionId ? { ...opt, ...patch } : opt,
                      ),
                    }
                  : req,
              ),
            }
          : route,
      ),
    )

  const addRequirement = (routeId: string) => {
    const route = condition.find((r) => r.id === routeId)
    if (!route) return
    patchRoute(routeId, {
      requirements: [
        ...route.requirements,
        {
          id: newId('req'),
          label: `Requirement ${route.requirements.length + 1}`,
          options: [blankOption()],
        },
      ],
    })
  }

  const addRoute = () =>
    onChange([
      ...condition,
      {
        id: newId('route'),
        label: ROUTE_NAMES[condition.length] ?? `Route ${condition.length + 1}`,
        requirements: [{ id: newId('req'), label: 'Requirement 1', options: [blankOption()] }],
      },
    ])

  const manyRoutes = condition.length > 1

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
        Within a route, every requirement must hold, and <strong>any one route is enough</strong>.
        A requirement can be met more than one way: cards in the same line count together, while{' '}
        <em>or another way</em> adds a separate test — useful when the thresholds differ, like{' '}
        <em>1 Ultra Ball</em> or <em>2 Cyrano</em>.
        {seeded && ' These rows are a suggestion from your decklist — edit them freely.'}
      </p>

      <div className="space-y-2">
        {condition.map((route, routeIndex) => (
          <div key={route.id} className="space-y-2">
            {routeIndex > 0 && <Divider label="OR" />}

            <div
              className={
                manyRoutes
                  ? 'space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800'
                  : 'space-y-2'
              }
            >
              {manyRoutes && (
                <div className="flex items-center gap-2">
                  <input
                    value={route.label}
                    onChange={(e) => patchRoute(route.id, { label: e.target.value })}
                    aria-label="Route name"
                    className="rounded-md border border-slate-300 px-2 py-0.5 text-sm font-semibold focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    onClick={() => onChange(condition.filter((r) => r.id !== route.id))}
                    className="ml-auto rounded-md px-2 py-0.5 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                  >
                    Remove route
                  </button>
                </div>
              )}

              <ul className="space-y-2">
                {route.requirements.map((requirement) => (
                  <li
                    key={requirement.id}
                    className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                  >
                    {requirement.options.map((option, optionIndex) => {
                      const selected = option.cardKeys
                        .map((key) => byKey.get(key))
                        .filter((card): card is DeckCard => card !== undefined)
                      const copies = selected.reduce((sum, card) => sum + card.count, 0)
                      const unselected = cards.filter((c) => !option.cardKeys.includes(c.key))

                      return (
                        <div key={option.id} className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {optionIndex === 0 ? (
                              <input
                                value={requirement.label}
                                onChange={(e) =>
                                  patchRequirement(route.id, requirement.id, {
                                    label: e.target.value,
                                  })
                                }
                                aria-label="Requirement name"
                                className="min-w-40 grow rounded-md border border-slate-300 px-2 py-1 text-sm font-medium focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                              />
                            ) : (
                              <span className="min-w-40 grow text-xs font-semibold tracking-wide text-slate-500">
                                or
                              </span>
                            )}

                            <select
                              value={option.op}
                              onChange={(e) =>
                                patchOption(route.id, requirement.id, option.id, {
                                  op: e.target.value as RequirementOp,
                                })
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
                              value={option.n}
                              onChange={(e) =>
                                patchOption(route.id, requirement.id, option.id, {
                                  n: Math.max(0, Math.min(60, Number(e.target.value) || 0)),
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
                              onClick={() =>
                                requirement.options.length > 1
                                  ? patchRequirement(route.id, requirement.id, {
                                      options: requirement.options.filter(
                                        (o) => o.id !== option.id,
                                      ),
                                    })
                                  : patchRoute(route.id, {
                                      requirements: route.requirements.filter(
                                        (r) => r.id !== requirement.id,
                                      ),
                                    })
                              }
                              aria-label={
                                requirement.options.length > 1
                                  ? `Remove this way of meeting ${requirement.label}`
                                  : `Remove ${requirement.label}`
                              }
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
                                  patchOption(route.id, requirement.id, option.id, {
                                    cardKeys: option.cardKeys.filter((k) => k !== card.key),
                                  })
                                }
                                className="tnum group flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-900 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:border-rose-800 dark:hover:bg-rose-950/50 dark:hover:text-rose-200"
                                title="Remove from this line"
                              >
                                {card.count}× {card.label}
                                <span
                                  aria-hidden
                                  className="text-slate-400 group-hover:text-rose-500"
                                >
                                  ×
                                </span>
                              </button>
                            ))}

                            {selected.length === 0 && (
                              <span className="text-xs text-slate-400">
                                No cards yet — add one →
                              </span>
                            )}

                            <select
                              value=""
                              disabled={unselected.length === 0}
                              onChange={(e) => {
                                if (!e.target.value) return
                                patchOption(route.id, requirement.id, option.id, {
                                  cardKeys: [...option.cardKeys, e.target.value],
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
                        </div>
                      )
                    })}

                    <button
                      type="button"
                      onClick={() =>
                        patchRequirement(route.id, requirement.id, {
                          options: [...requirement.options, blankOption()],
                        })
                      }
                      className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      + or another way
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => addRequirement(route.id)}
                className="rounded-md border border-dashed border-slate-400 px-3 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
              >
                + Add requirement
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRoute}
        className="rounded-md border border-dashed border-slate-400 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      >
        + Add another route (OR)
      </button>
    </section>
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="h-px grow bg-slate-200 dark:bg-slate-800" />
      <span className="text-xs font-semibold tracking-wide text-slate-500">{label}</span>
      <div className="h-px grow bg-slate-200 dark:bg-slate-800" />
    </div>
  )
}
