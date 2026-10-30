import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useState } from 'react'

import {
  clearActive,
  dropCard,
  removeBench,
  removeHand,
  removeTool,
  setBenchMin,
  removeSlotEnergy,
  setStadium,
  type DropZone,
} from '../../lib/board/edit'
import type { DropTarget, DroppedCard } from '../../lib/board/edit'
import { slotTarget } from '../../lib/board/edit'
import type { FieldGoal, SlotGoal } from '../../lib/board/goal'
import { findBasicEnergyByType } from '../../lib/card-db'
import { cardImageUrl, recordImageUrl } from '../../lib/sample-hand'
import type { DeckCard } from '../../lib/types'
import { WithAttached, type AttachedCard } from './Attached'

interface Props {
  cards: DeckCard[]
  goal: FieldGoal
  onChange: (goal: FieldGoal) => void
}

/**
 * "Any Energy": a goal Energy whose type does not matter. It is not a card in
 * the deck, so it is a stand-in the palette offers alongside the real ones.
 * Luminous Energy is drawn for it, as the card that famously counts as every
 * type. It is not in the simulator's card pool, so its art is linked directly.
 */
const ANY_ENERGY: DeckCard = {
  key: 'any-energy',
  label: 'Any Energy',
  resolvedName: null,
  count: 0,
  card: {
    index: -1,
    name: 'Any Energy',
    kind: 'Energy',
    rule: '',
    prev: '',
    hp: null,
    // Empty, so a drop asks for Energy of no particular type.
    type: '',
    retreat: null,
    regulationMark: '',
    effect: '',
    moves: [],
    tags: ['energy'],
    image: 'https://assets.tcgdex.net/en/sv/sv02/191',
  },
  printings: [],
  tags: ['energy'],
}

const isPokemon = (card: DeckCard) => card.tags.includes('pokemon')
const isStadiumCard = (card: DeckCard) => card.tags.includes('stadium')

const describeCard = (card: DeckCard): DroppedCard => ({
  key: card.key,
  isPokemon: isPokemon(card),
  isStadium: isStadiumCard(card),
  isEnergy: card.tags.includes('energy'),
  isTool: card.tags.includes('tool'),
  energyType: card.card?.type || null,
})

export function BoardEditor({ cards, goal, onChange }: Props) {
  // Click-to-place: pick a card, then pick a zone. Keeps the board usable on a
  // touch screen and by keyboard, where dragging is not an option.
  const [picked, setPicked] = useState<string | null>(null)
  const byKey = new Map([...cards, ANY_ENERGY].map((card) => [card.key, card]))

  /**
   * The Energy and Tools the goal asks for on one Pokémon, as cards to tuck
   * behind it. A typed Energy is drawn as this deck's copy when it runs one;
   * an untyped one is "any", which has no card to show, so it is a label.
   */
  const attachedTo = (slot: SlotGoal): AttachedCard[] => {
    const name = byKey.get(slot.cardKey)?.label ?? 'this Pokémon'
    const energy = slot.energy.map((type, index) => {
      const deckEnergy = type
        ? cards.find((card) => card.tags.includes('basic-energy') && card.card?.type === type)
        : undefined
      const record = type
        ? (deckEnergy?.card ?? findBasicEnergyByType(type))
        : ANY_ENERGY.card!
      const label = deckEnergy?.label ?? record?.name ?? ANY_ENERGY.label
      return {
        // Position-keyed: removing one shifts the rest, which is the honest
        // picture, since they are interchangeable copies.
        id: `energy-${index}`,
        label,
        src: record ? recordImageUrl(record) : null,
        // Luminous Energy's art says "Luminous", so the edge says what it means.
        badge: type ? undefined : 'Any',
        removeLabel: `Remove one ${label} from ${name}`,
        onRemove: () => onChange(removeSlotEnergy(goal, slot.id, index)),
      }
    })
    const tools = slot.tools.map((key) => {
      const card = byKey.get(key)
      const label = card?.label ?? key
      return {
        id: `tool-${key}`,
        label,
        src: card ? cardImageUrl(card) : null,
        removeLabel: `Remove ${label} from ${name}`,
        onRemove: () => onChange(removeTool(goal, slot.id, key)),
      }
    })
    return [...energy, ...tools]
  }

  const place = (target: DropTarget, cardKey: string) => {
    const card = byKey.get(cardKey)
    if (!card) return
    onChange(dropCard(goal, target, describeCard(card)))
    setPicked(null)
  }

  // Without an activation distance the pointer sensor starts a drag on
  // pointer-down and swallows the click, which breaks tap-to-place entirely.
  // A few pixels of movement separates a drag from a tap.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const onDragEnd = (event: DragEndEvent) => {
    const target = event.over?.id
    const cardKey = event.active.id
    if (typeof target === 'string' && typeof cardKey === 'string') {
      place(target as DropTarget, cardKey)
    }
  }

  const benchSlots = Math.max(goal.bench.length + 1, Math.min(goal.benchMin + 1, 8))

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <section className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">2 · Your board at the end of turn 1</h2>
          <p className="text-xs text-slate-500">
            Drag a card onto the board, or tap one and then tap where it goes. Everything you place
            becomes something the deck has to achieve by the end of its first turn.
          </p>
        </header>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <div className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Active
              </h3>
              <Zone id="active" picked={picked} onPick={place}>
                {goal.active ? (
                  <SlotDrop
                    slotId={goal.active.id}
                    name={byKey.get(goal.active.cardKey)?.label ?? 'this Pokémon'}
                    picked={picked}
                    onPlace={place}
                  >
                    <SlotCard
                      slot={goal.active}
                      card={byKey.get(goal.active.cardKey)}
                      attached={attachedTo(goal.active)}
                      onRemove={() => onChange(clearActive(goal))}
                    />
                  </SlotDrop>
                ) : (
                  <Empty label="Active" />
                )}
              </Zone>
            </div>

            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Bench
                </h3>
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  at least
                  <input
                    type="number"
                    min={0}
                    max={8}
                    value={goal.benchMin}
                    onChange={(e) => onChange(setBenchMin(goal, Number(e.target.value) || 0))}
                    aria-label="Minimum benched Pokémon"
                    className="tnum w-14 rounded-md border border-slate-300 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-950"
                  />
                  benched
                </label>
              </div>
              <Zone id="bench" picked={picked} onPick={place}>
                <div className="flex flex-wrap items-end gap-2">
                  {goal.bench.map((slot) => (
                    <SlotDrop
                      key={slot.id}
                      slotId={slot.id}
                      name={byKey.get(slot.cardKey)?.label ?? 'this Pokémon'}
                      picked={picked}
                      onPlace={place}
                    >
                      <SlotCard
                        slot={slot}
                        card={byKey.get(slot.cardKey)}
                        attached={attachedTo(slot)}
                        onRemove={() => onChange(removeBench(goal, slot.id))}
                      />
                    </SlotDrop>
                  ))}
                  {Array.from({ length: Math.max(0, benchSlots - goal.bench.length) }).map(
                    (_, i) => (
                      <Empty key={`empty-${i}`} label="Bench" />
                    ),
                  )}
                </div>
              </Zone>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Stadium
              </h3>
              <Zone id="stadium" picked={picked} onPick={place}>
                {goal.stadiumKey ? (
                  <SlotCard
                    card={byKey.get(goal.stadiumKey)}
                    onRemove={() => onChange(setStadium(goal, null))}
                  />
                ) : (
                  <Empty label="Stadium" />
                )}
              </Zone>
            </div>

            <div className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Still in hand
              </h3>
              <Zone id="hand" picked={picked} onPick={place}>
                <div className="flex flex-wrap gap-2">
                  {goal.inHand.map((want) => (
                    <SlotCard
                      key={want.id}
                      card={byKey.get(want.cardKey)}
                      count={want.count}
                      onRemove={() => onChange(removeHand(goal, want.id))}
                    />
                  ))}
                  {goal.inHand.length === 0 && <Empty label="Hand" />}
                </div>
              </Zone>
            </div>
          </div>
        </div>

        <Palette cards={cards} picked={picked} onPick={setPicked} />
      </section>
    </DndContext>
  )
}

const ZONE_LABEL: Record<DropZone, string> = {
  active: 'Active spot',
  bench: 'Bench',
  stadium: 'Stadium',
  hand: 'Still in hand',
}

function Zone({
  id,
  picked,
  onPick,
  children,
}: {
  id: DropZone
  picked: string | null
  onPick: (target: DropTarget, cardKey: string) => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const armed = picked !== null

  return (
    <div
      ref={setNodeRef}
      // When a card is picked, the whole zone becomes a button so the board can
      // be built entirely by tapping.
      onClick={armed ? () => onPick(id, picked) : undefined}
      role={armed ? 'button' : undefined}
      aria-label={armed ? `Place in ${ZONE_LABEL[id]}` : undefined}
      tabIndex={armed ? 0 : undefined}
      onKeyDown={
        armed
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onPick(id, picked)
              }
            }
          : undefined
      }
      className={[
        'min-h-[132px] rounded-lg border-2 border-dashed p-2 transition-colors',
        isOver
          ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40'
          : armed
            ? 'cursor-pointer border-sky-300 hover:bg-sky-50 dark:border-sky-800 dark:hover:bg-sky-950/30'
            : 'border-slate-200 dark:border-slate-800',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

/**
 * A Pokémon already on the board, as a drop target.
 *
 * Energy and Tools belong to a particular Pokémon rather than to the board, so
 * they are dropped onto the card itself. Tapping works the same way, which is
 * what makes this usable on a touch screen.
 */
function SlotDrop({
  slotId,
  name,
  picked,
  onPlace,
  children,
}: {
  slotId: string
  name: string
  picked: string | null
  onPlace: (target: DropTarget, cardKey: string) => void
  children: React.ReactNode
}) {
  const target = slotTarget(slotId)
  const { setNodeRef, isOver } = useDroppable({ id: target })
  const armed = picked !== null

  return (
    <div
      ref={setNodeRef}
      // The zone around this Pokémon is a tap target too. Letting the tap reach
      // it would apply a second drop built from the board as it was before this
      // one, silently undoing the attach.
      onClick={
        armed
          ? (event) => {
              event.stopPropagation()
              onPlace(target, picked)
            }
          : undefined
      }
      role={armed ? 'button' : undefined}
      aria-label={armed ? `Attach to ${name}` : undefined}
      tabIndex={armed ? 0 : undefined}
      onKeyDown={
        armed
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onPlace(target, picked)
              }
            }
          : undefined
      }
      className={isOver ? 'rounded-lg ring-2 ring-sky-500' : undefined}
    >
      {children}
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-[118px] w-[84px] items-center justify-center rounded-md border border-slate-200 text-[11px] text-slate-400 dark:border-slate-800">
      {label}
    </div>
  )
}

function SlotCard({
  slot,
  card,
  count,
  attached,
  onRemove,
}: {
  slot?: SlotGoal
  card: DeckCard | undefined
  count?: number
  /** Energy and Tools on a Pokémon in play; absent for other zones. */
  attached?: AttachedCard[]
  onRemove: () => void
}) {
  const src = card ? cardImageUrl(card) : null
  const name = card?.label ?? 'Unknown'

  const face = (
    <div className="relative aspect-[245/342] overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
      {src ? (
        <img src={src} alt={name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center p-1 text-center text-[10px] leading-tight">
          {name}
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-slate-900/70 text-xs leading-none text-white hover:bg-rose-600"
      >
        ×
      </button>
      {count !== undefined && count > 1 && (
        <span className="tnum absolute bottom-0.5 left-0.5 rounded bg-slate-900/70 px-1 text-[10px] text-white">
          ×{count}
        </span>
      )}
    </div>
  )

  return (
    <figure className="w-[84px] space-y-1">
      {slot ? (
        <WithAttached attached={attached ?? []} peek={14}>
          {face}
        </WithAttached>
      ) : (
        face
      )}
      {!slot && <figcaption className="truncate text-center text-[10px]">{name}</figcaption>}
    </figure>
  )
}

function Palette({
  cards,
  picked,
  onPick,
}: {
  cards: DeckCard[]
  picked: string | null
  onPick: (key: string | null) => void
}) {
  const placeable = cards.filter(
    (card) => isPokemon(card) || isStadiumCard(card) || card.card !== null,
  )

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Your deck {picked && <span className="text-sky-600">— now pick a spot</span>}
      </h3>
      <div className="flex flex-wrap gap-1.5" data-testid="card-palette">
        {[...placeable, ANY_ENERGY].map((card) => (
          <PaletteCard
            key={card.key}
            card={card}
            picked={picked === card.key}
            onPick={() => onPick(picked === card.key ? null : card.key)}
          />
        ))}
      </div>
    </div>
  )
}

function PaletteCard({
  card,
  picked,
  onPick,
}: {
  card: DeckCard
  picked: boolean
  onPick: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.key })
  const [failed, setFailed] = useState(false)
  const src = cardImageUrl(card)

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onPick}
      {...listeners}
      {...attributes}
      aria-label={`Pick ${card.label}`}
      aria-pressed={picked}
      title={card.count > 0 ? `${card.count}× ${card.label}` : card.label}
      className={[
        'relative w-[64px] shrink-0 overflow-hidden rounded-md border-2 transition',
        isDragging ? 'opacity-40' : '',
        picked
          ? 'border-sky-500 ring-2 ring-sky-400/60'
          : 'border-transparent hover:border-sky-400',
      ].join(' ')}
    >
      <span className="block aspect-[245/342] bg-slate-100 dark:bg-slate-800">
        {src && !failed ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          // Card art is hotlinked, so the name has to carry the tile when it
          // cannot load — the palette must stay usable offline.
          <span className="flex h-full items-center justify-center p-1 text-center text-[9px] leading-tight font-medium text-slate-600 dark:text-slate-300">
            {card.label}
          </span>
        )}
      </span>
      {card.count > 0 ? (
        <span className="tnum absolute bottom-0 left-0 rounded-tr bg-slate-900/75 px-1 text-[10px] text-white">
          ×{card.count}
        </span>
      ) : (
        <span className="absolute inset-x-0 bottom-0 bg-slate-900/75 text-center text-[10px] font-semibold text-white">
          Any type
        </span>
      )}
    </button>
  )
}
