import { useEffect, useMemo, useState } from 'react'

import { cardImageUrl } from '../../lib/sample-hand'
import { WithAttached, type AttachedCard } from './Attached'
import type { ExampleCard, ExampleFrame, ExampleSlot } from '../../lib/sim/playtest'
import type { DeckCard } from '../../lib/types'

/**
 * Replay one line of play, a move at a time.
 *
 * The animation is deliberately built on **mounting** rather than on diffing
 * frames: every card is keyed by what it is and which copy it is, so a card
 * already on the table keeps its DOM and sits still, while a card that has just
 * arrived mounts and plays its deal-in. That means nothing has to work out what
 * changed between two frames — React's reconciliation already knows.
 */

const STEP_MS = 1_100

interface Props {
  frames: ExampleFrame[]
  cards: DeckCard[]
}

/** A stable key per rendered card: what it is, plus which copy of it. */
function keyed<T>(items: T[], keyOf: (item: T) => string): { item: T; key: string }[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const base = keyOf(item)
    const nth = seen.get(base) ?? 0
    seen.set(base, nth + 1)
    return { item, key: `${base}#${nth}` }
  })
}

function CardFace({
  card,
  src,
  className = '',
}: {
  card: { label: string }
  src: string | null
  className?: string
}) {
  return src ? (
    <img
      src={src}
      alt={card.label}
      loading="lazy"
      className={`animate-deal w-full rounded-[4%] shadow-sm ${className}`}
    />
  ) : (
    <span
      className={`animate-deal flex aspect-[63/88] w-full items-center justify-center rounded-md border border-slate-300 bg-slate-50 p-1 text-center text-[0.6rem] leading-tight text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 ${className}`}
    >
      {card.label}
    </span>
  )
}

export function ReplayPlayer({ frames, cards }: Props) {
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)

  const imageFor = useMemo(() => {
    const byKey = new Map(cards.map((card) => [card.key, card]))
    return (cardKey: string) => {
      const card = byKey.get(cardKey)
      return card ? cardImageUrl(card) : null
    }
  }, [cards])

  const attachedTo = (slot: ExampleSlot): AttachedCard[] =>
    keyed(slot.attached, (card) => card.cardKey).map(({ item, key }) => ({
      id: key,
      label: item.label,
      src: imageFor(item.cardKey),
    }))

  const last = frames.length - 1
  const position = Math.min(at, last)
  const frame = frames[position]

  // Playback advances one frame per tick, and stops itself on the last one.
  // Both updates happen in the timeout, never in the effect body, so switching
  // routes or scrubbing cancels cleanly instead of fighting the playhead.
  useEffect(() => {
    if (!playing || position >= last) return
    const id = window.setTimeout(() => {
      setAt(position + 1)
      if (position + 1 >= last) setPlaying(false)
    }, STEP_MS)
    return () => window.clearTimeout(id)
  }, [playing, position, last])

  if (!frame) return null

  const atEnd = position >= last
  const hand = keyed<ExampleCard>(frame.hand, (card) => card.cardKey)
  const bench = keyed<ExampleSlot>(frame.board.bench, (slot) => slot.cardKey)

  return (
    <div data-testid="replay" className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Played out, move by move
        </h4>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAt((n) => Math.max(0, Math.min(n, last) - 1))}
            disabled={position === 0}
            aria-label="Previous move"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-40 hover:enabled:bg-slate-100 dark:border-slate-700 dark:hover:enabled:bg-slate-800"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => {
              if (atEnd) setAt(0)
              setPlaying((on) => !on)
            }}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => setAt((n) => Math.min(last, n + 1))}
            disabled={atEnd}
            aria-label="Next move"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-40 hover:enabled:bg-slate-100 dark:border-slate-700 dark:hover:enabled:bg-slate-800"
          >
            ›
          </button>
        </div>
      </div>

      {/* The scrubber doubles as the progress read-out. */}
      <label className="mt-2 flex items-center gap-2">
        <span className="sr-only">Move</span>
        <input
          type="range"
          min={0}
          max={last}
          value={position}
          onChange={(e) => {
            setPlaying(false)
            setAt(Number(e.target.value))
          }}
          className="h-1 grow accent-sky-600"
        />
        <span className="tnum shrink-0 text-xs text-slate-500">
          {position + 1} / {frames.length}
        </span>
      </label>

      <p
        key={position}
        className="animate-step mt-2 text-sm font-medium text-slate-800 dark:text-slate-100"
      >
        {frame.step}
      </p>

      <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950/60">
        <div>
          <p className="mb-1 text-[0.65rem] tracking-wide text-slate-500 uppercase">
            Active{frame.board.stadium ? ` · ${frame.board.stadium}` : ''}
          </p>
          {frame.board.active ? (
            <div className="w-20">
              <WithAttached attached={attachedTo(frame.board.active)} peek={12}>
                <CardFace
                  key={frame.board.active.cardKey}
                  card={frame.board.active}
                  src={imageFor(frame.board.active.cardKey)}
                />
              </WithAttached>
            </div>
          ) : (
            <p className="text-xs text-slate-400">nothing yet</p>
          )}
        </div>

        <div>
          <p className="mb-1 text-[0.65rem] tracking-wide text-slate-500 uppercase">
            Bench ({bench.length})
          </p>
          {bench.length > 0 ? (
            <div className="flex flex-wrap items-end gap-1.5">
              {bench.map(({ item, key }) => (
                <div key={key} className="w-14">
                  <WithAttached attached={attachedTo(item)} peek={9}>
                    <CardFace card={item} src={imageFor(item.cardKey)} />
                  </WithAttached>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">empty</p>
          )}
        </div>

        <div>
          <p className="mb-1 text-[0.65rem] tracking-wide text-slate-500 uppercase">
            Hand ({hand.length})
          </p>
          {hand.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {hand.map(({ item, key }) => (
                <div key={key} className="w-12">
                  <CardFace card={item} src={imageFor(item.cardKey)} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">empty</p>
          )}
        </div>
      </div>
    </div>
  )
}
