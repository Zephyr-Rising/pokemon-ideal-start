import type { ReactNode } from 'react'

/**
 * One player's side of the table, laid out as a real game is: the Active Spot
 * in the middle with the Stadium beside it, the Bench in a row below, Prizes
 * to the left of the Bench and the Deck and discard pile to the right, and the
 * hand along the bottom edge.
 *
 * Shared by the board editor and the replay, so a board built in one reads the
 * same way when it is played out in the other. Each zone is a label and its
 * content; the zones themselves decide what goes in them.
 */

export interface MatZone {
  label: ReactNode
  content: ReactNode
}

interface Props {
  active: MatZone
  bench: MatZone
  stadium: MatZone
  hand: MatZone
  /** Left of the Bench. */
  prizes?: MatZone
  /** Right of the Bench. */
  deck?: MatZone
  /** Below the Bench, above the hand: conditions that span the whole field. */
  footer?: ReactNode
  /** Top right, beside the Active Spot: the replay's summary of the last play. */
  aside?: ReactNode
  /** Top left: which turn the replay is on. */
  corner?: ReactNode
}

function Zone({ zone, className = '' }: { zone: MatZone; className?: string }) {
  return (
    <div className={`min-w-0 space-y-1 ${className}`}>
      <div className="text-[0.65rem] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {zone.label}
      </div>
      {zone.content}
    </div>
  )
}

export function Playmat({ active, bench, stadium, hand, prizes, deck, footer, aside, corner }: Props) {
  return (
    <div className="playmat rounded-xl border border-slate-200 p-3 sm:p-4 dark:border-slate-800">
      {/* Stadium | Active | aside. The outer columns share the spare width,
          so the Active Spot stays centred over the Bench. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 items-start justify-between gap-2 self-stretch">
          <div className="min-w-0">{corner}</div>
          <Zone zone={stadium} className="self-center" />
        </div>
        <Zone zone={active} className="text-center [&>*:last-child]:mx-auto" />
        <div className="min-w-0 justify-self-end">{aside}</div>
      </div>

      {/* Prizes | Bench | Deck. On a phone the Bench takes the full row, and
          Prizes and Deck sit side by side under it. */}
      <div className="mt-4 grid grid-cols-2 items-end gap-3 sm:grid-cols-[auto_1fr_auto]">
        <Zone zone={bench} className="col-span-2 text-center sm:col-span-1 sm:col-start-2 sm:row-start-1" />
        {prizes && <Zone zone={prizes} className="sm:col-start-1 sm:row-start-1" />}
        {deck && (
          <Zone
            zone={deck}
            className="col-start-2 justify-self-end text-right sm:col-start-3 sm:row-start-1"
          />
        )}
      </div>

      {footer && <div className="mt-2">{footer}</div>}

      <Zone zone={hand} className="mt-4 border-t text-center border-slate-300/70 pt-3 dark:border-slate-700/70" />
    </div>
  )
}

const OPEN_SPOT =
  'aspect-[63/88] rounded-[6%] border border-dashed border-slate-300 dark:border-slate-700'

/** An open spot on the mat. */
export function OpenSpot({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`${OPEN_SPOT} ${className}`} />
}

/** A face-down card: Prizes and the Deck. */
export function CardBack({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`card-back aspect-[63/88] rounded-[6%] ${className}`} />
}

/** A count on the foot of a pile. */
export function PileCount({ count }: { count: number }) {
  return (
    <span className="tnum absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-1.5 text-[10px] font-semibold text-white">
      {count}
    </span>
  )
}

/** A face-down pile, with how many cards are in it. */
export function Pile({ count, label }: { count: number; label: string }) {
  return (
    <div className="relative w-12" role="img" aria-label={`${label}: ${count}`}>
      {count > 0 ? (
        <>
          {count > 1 && (
            <CardBack className="absolute inset-0 translate-x-0.5 translate-y-0.5 opacity-70" />
          )}
          <CardBack className="relative" />
        </>
      ) : (
        <OpenSpot />
      )}
      <PileCount count={count} />
    </div>
  )
}

/**
 * Prizes as they lie on a mat: two across, face down. Before they are set
 * (the opening hand) the six spots are empty.
 */
export function PrizeGrid({ count, spots = 6 }: { count: number; spots?: number }) {
  return (
    // Three across on a phone, where height is short; two across, as on a
    // mat, where there is room.
    <div
      className="grid w-[5.25rem] grid-cols-3 gap-1 sm:w-[4.25rem] sm:grid-cols-2"
      role="img"
      aria-label={`Prizes: ${count}`}
    >
      {Array.from({ length: spots }).map((_, i) =>
        i < count ? <CardBack key={i} /> : <OpenSpot key={i} />,
      )}
    </div>
  )
}
