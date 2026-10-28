import { useState } from 'react'

import type { Condition } from '../lib/prob/analyze'
import { cardImageUrl, type SampledHand, type SampleMode } from '../lib/sample-hand'
import type { DeckCard } from '../lib/types'

interface Props {
  hand: SampledHand
  condition: Condition
  mode: SampleMode
  onModeChange: (mode: SampleMode) => void
  onReroll: () => void
}

export function SampleHand({ hand, condition, mode, onModeChange, onReroll }: Props) {
  const meets = mode === 'meets'

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">4 · What that looks like</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Which hands to show"
            className="flex overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700"
          >
            <Toggle active={meets} onClick={() => onModeChange('meets')}>
              A hand that hits
            </Toggle>
            <Toggle active={!meets} onClick={() => onModeChange('misses')}>
              One that misses
            </Toggle>
          </div>
          <button
            type="button"
            onClick={onReroll}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Draw another
          </button>
        </div>
      </header>

      {!hand.found ? (
        <p className="rounded-lg bg-amber-50 px-3 py-6 text-center text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          No hand that {meets ? 'meets' : 'misses'} this condition turned up in{' '}
          {hand.attempts.toLocaleString()} draws
          {meets
            ? ' — that start is too unlikely to illustrate. Loosen a requirement to see one.'
            : ' — this deck essentially always gets there.'}
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            A real hand, drawn at random from those that {meets ? 'meet' : 'miss'} your condition —
            not a hand-picked example. Found after{' '}
            {hand.attempts === 1 ? 'the first draw' : `${hand.attempts.toLocaleString()} draws`}.
          </p>

          <div className="flex flex-wrap items-start gap-3">
            {hand.opening.map((card, index) => (
              <CardTile key={`${card.key}-${index}`} card={card} />
            ))}

            {hand.drawn && (
              <>
                <div
                  aria-hidden
                  className="mx-1 self-stretch border-l border-dashed border-slate-300 dark:border-slate-700"
                />
                <CardTile card={hand.drawn} label="turn-1 draw" />
              </>
            )}
          </div>

          {condition.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-2 font-semibold">
                {meets ? 'How this hand gets there' : 'What this hand is missing'}
              </h3>
              <ul className="space-y-1.5">
                {condition.map((alternative) => (
                  <li key={alternative.id}>
                    <span
                      className={
                        hand.routesMet[alternative.id]
                          ? 'font-medium text-emerald-700 dark:text-emerald-400'
                          : 'font-medium text-slate-500'
                      }
                    >
                      {hand.routesMet[alternative.id] ? '✓' : '✗'} {alternative.label}
                    </span>
                    <ul className="mt-0.5 ml-4 flex flex-wrap gap-x-3 gap-y-0.5">
                      {alternative.requirements.map((row) => (
                        <li
                          key={row.id}
                          className={
                            hand.rowsMet[row.id]
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }
                        >
                          {hand.rowsMet[row.id] ? '✓' : '✗'} {row.label}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'bg-sky-600 px-2.5 py-1 text-white'
          : 'px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800'
      }
    >
      {children}
    </button>
  )
}

function CardTile({ card, label }: { card: DeckCard; label?: string }) {
  const src = cardImageUrl(card)
  const [failed, setFailed] = useState(false)

  return (
    <figure className="w-[104px] space-y-1">
      <div className="aspect-[245/342] overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
        {src && !failed ? (
          <img
            src={src}
            alt={card.resolvedName ?? card.label}
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          // Shown when a card has no artwork on file, or the image can't load
          // (offline, say) — the hand still reads correctly as text.
          <div className="flex h-full items-center justify-center p-2 text-center text-[11px] leading-tight font-medium text-slate-600 dark:text-slate-300">
            {card.label}
          </div>
        )}
      </div>
      <figcaption className="truncate text-center text-[11px] text-slate-500" title={card.label}>
        {label ? <span className="text-sky-600 dark:text-sky-400">{label}</span> : card.label}
      </figcaption>
    </figure>
  )
}
