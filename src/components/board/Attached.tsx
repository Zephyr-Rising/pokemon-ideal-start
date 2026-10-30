import type { CSSProperties, ReactNode } from 'react'

/** A card attached to a Pokémon: an Energy or a Tool. */
export interface AttachedCard {
  /** Stable per copy, so a card already shown keeps its DOM between frames. */
  id: string
  label: string
  src: string | null
  /** A word shown on the visible edge, for a stand-in whose art says otherwise. */
  badge?: string
  /** When set, tapping the card's edge detaches it. */
  onRemove?: () => void
  removeLabel?: string
}

/**
 * A Pokémon with its Energy and Tools tucked behind it, the way they sit on a
 * real table: each attached card is a whole card behind the Pokémon, shifted
 * up so that only its top edge shows.
 *
 * The first card attached sits closest behind the Pokémon, and each later one
 * goes further back and further up, so the stack reads in the order it was
 * built. The Pokémon covers the rest of every card, which also means only the
 * visible edge can be tapped.
 */
export function WithAttached({
  attached,
  peek,
  children,
}: {
  attached: AttachedCard[]
  /** Height in px of each card's visible top edge. */
  peek: number
  children: ReactNode
}) {
  // A tall stack would push the row apart, so long ones tighten up.
  const edge = attached.length > 4 ? Math.round(peek * 0.7) : peek
  const count = attached.length

  return (
    <div className="relative" style={{ paddingTop: count * edge }}>
      {attached.map((card, i) => (
        <Edge
          key={card.id}
          card={card}
          style={{ top: (count - 1 - i) * edge, zIndex: count - i }}
        />
      ))}
      <div className="relative drop-shadow-sm" style={{ zIndex: count + 1 }}>
        {children}
      </div>
    </div>
  )
}

function Edge({ card, style }: { card: AttachedCard; style: CSSProperties }) {
  const badge = card.badge && (
    <span className="absolute top-0.5 left-1/2 -translate-x-1/2 rounded bg-slate-900/80 px-1 text-[8px] leading-3 font-semibold tracking-wide text-white uppercase">
      {card.badge}
    </span>
  )
  const face = card.src ? (
    <>
      <img src={card.src} alt="" loading="lazy" className="block w-full rounded-[4%]" />
      {badge}
    </>
  ) : (
    <span className="flex aspect-[63/88] w-full items-start justify-center rounded-md border border-slate-300 bg-slate-100 px-1 pt-0.5 text-[9px] leading-tight text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {card.label}
    </span>
  )
  const className = 'animate-deal absolute inset-x-0 block'

  return card.onRemove ? (
    <button
      type="button"
      onClick={(event) => {
        // The slot underneath is itself a tap target while a card is picked.
        event.stopPropagation()
        card.onRemove!()
      }}
      title={card.removeLabel ?? card.label}
      aria-label={card.removeLabel ?? card.label}
      className={`${className} rounded-md hover:ring-2 hover:ring-rose-500`}
      style={style}
    >
      {face}
    </button>
  ) : (
    <span title={card.label} className={className} style={style}>
      <span className="sr-only">{card.label}</span>
      {face}
    </span>
  )
}
