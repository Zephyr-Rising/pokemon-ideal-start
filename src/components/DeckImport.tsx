import { categoryOf, summarize } from '../lib/deck-tags'
import { plural } from '../lib/format'
import type { Deck } from '../lib/types'

const EXAMPLE = `Pokémon: 21
4 Mega Kangaskhan ex MEG 104
3 Meowth ex POR 62
2 Teal Mask Ogerpon ex TWM 25
2 Wellspring Mask Ogerpon ex TWM 64
2 Latias ex SSP 76
2 Lillie's Clefairy ex JTG 56
1 Raging Bolt ex TEF 123
1 Chien-Pao SSP 56
1 Iron Crown ex TEF 81
1 Passimian SSP 111
1 Fezandipiti ex ASC 142
1 Iron Leaves ex TEF 25

Trainer: 24
4 Crispin SCR 133
2 Cyrano SSP 170
2 Boss's Orders MEG 114
1 Ciphermaniac's Codebreaking TEF 145
4 Energy Switch MEG 115
4 Ultra Ball MEG 131
2 Night Stretcher ASC 196
1 Unfair Stamp TWM 165
1 Glass Trumpet SCR 135
3 Area Zero Underdepths SCR 131

Energy: 15
6 Grass Energy MEE 9
3 Psychic Energy MEE 13
2 Lightning Energy MEE 12
2 Fighting Energy MEE 14
2 Water Energy MEE 11`

interface Props {
  text: string
  deck: Deck
  onChange: (text: string) => void
}

export function DeckImport({ text, deck, onChange }: Props) {
  const summary = summarize(deck)
  const hasText = text.trim() !== ''

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">1 · Decklist</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(EXAMPLE)}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Load example
          </button>
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={!hasText}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Clear
          </button>
        </div>
      </header>

      <label htmlFor="decklist" className="sr-only">
        Paste a PTCG Live decklist export
      </label>
      <textarea
        id="decklist"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        rows={10}
        placeholder={'Paste a PTCG Live export, e.g.\n\n4 Ultra Ball SVI 196\n2 Boss’s Orders PAL 172'}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs leading-relaxed shadow-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
      />

      {hasText && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Chip
              tone={summary.total === 60 ? 'good' : 'warn'}
              label={`${summary.total}/60 cards`}
            />
            <Chip label={`${summary.pokemon} Pokémon`} />
            <Chip label={`${summary.trainer} Trainer`} />
            <Chip label={`${summary.energy} Energy`} />
            <Chip
              tone={summary.basics === 0 ? 'bad' : 'plain'}
              label={`${summary.basics} Basic${summary.basics === 1 ? '' : 's'}`}
            />
            {summary.unknown > 0 && (
              <Chip tone="warn" label={`${summary.unknown} unrecognised`} />
            )}
          </div>

          {summary.total !== 60 && (
            <Notice tone="warn">
              A standard deck is 60 cards. The maths below uses the {summary.total} card
              {summary.total === 1 ? '' : 's'} actually listed.
            </Notice>
          )}

          {summary.unknown > 0 && (
            <Notice tone="warn">
              {plural(summary.unknown, 'copy')} could not be identified. They still count toward
              the deck, but cannot be recognised as Basic Pokémon — so the mulligan rate may be
              understated.
            </Notice>
          )}

          {deck.conflicts.length > 0 && (
            <Notice tone="bad">
              {plural(deck.conflicts.length, 'line')} name a set and number that the card data
              lists under a different card. The card named on the line was used — check those
              lines.
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {deck.conflicts.map((conflict) => (
                  <li key={conflict}>{conflict}</li>
                ))}
              </ul>
            </Notice>
          )}

          {deck.badLines.length > 0 && (
            <Notice tone="warn">
              Could not read {plural(deck.badLines.length, 'line')}:{' '}
              <span className="font-mono">{deck.badLines.slice(0, 3).join(' · ')}</span>
              {deck.badLines.length > 3 && ` and ${deck.badLines.length - 3} more`}
            </Notice>
          )}

          {deck.cards.length > 0 && (
            <details className="rounded-lg border border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-900">
              <summary className="cursor-pointer px-3 py-2 font-medium">
                Resolved {plural(deck.cards.length, 'card')}
              </summary>
              <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto px-3 pb-2 dark:divide-slate-800">
                {deck.cards.map((card) => (
                  <li key={card.key} className="flex items-baseline gap-2 py-1 text-xs">
                    <span className="tnum w-6 shrink-0 text-right text-slate-500">
                      {card.count}
                    </span>
                    <span className="grow">{card.label}</span>
                    <span className="shrink-0 text-slate-500">{categoryOf(card)}</span>
                    <span className="w-24 shrink-0 truncate text-right text-slate-400">
                      {card.printings.join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {deck.warnings.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">
                {plural(deck.warnings.length, 'resolution note')}
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {deck.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

type Tone = 'plain' | 'good' | 'warn' | 'bad'

const TONES: Record<Tone, string> = {
  plain: 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300',
  good: 'border-emerald-400 text-emerald-700 dark:border-emerald-600 dark:text-emerald-400',
  warn: 'border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400',
  bad: 'border-rose-400 text-rose-700 dark:border-rose-600 dark:text-rose-400',
}

function Chip({ label, tone = 'plain' }: { label: string; tone?: Tone }) {
  return <span className={`tnum rounded-full border px-2 py-0.5 ${TONES[tone]}`}>{label}</span>
}

// A div, not a p: callers nest lists inside it, which a <p> may not contain.
export function Notice({ children, tone = 'warn' }: { children: React.ReactNode; tone?: Tone }) {
  const bg =
    tone === 'bad'
      ? 'bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200'
      : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
  return <div className={`rounded-md px-3 py-2 text-xs ${bg}`}>{children}</div>
}
