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
  setEnergyMin,
  setHandMin,
  removeSlotEnergy,
  addChoice,
  removeChoice,
  setPartPriority,
  toggleAlternative,
  setStadium,
  type DropZone,
} from '../../lib/board/edit'
import type { DropTarget, DroppedCard } from '../../lib/board/edit'
import { slotTarget } from '../../lib/board/edit'
import {
  PRIORITY_LEVELS,
  energyPhrase,
  energyPriority,
  energyPriorityId,
  scoreBoard,
  type FieldGoal,
  type GoalPart,
  type Priority,
  type SlotGoal,
} from '../../lib/board/goal'
import { findBasicEnergyByType } from '../../lib/card-db'
import { cardImageUrl, recordImageUrl } from '../../lib/sample-hand'
import type { DeckCard } from '../../lib/types'
import { WithAttached, type AttachedCard } from './Attached'

interface Props {
  cards: DeckCard[]
  goal: FieldGoal
  onChange: (goal: FieldGoal) => void
  /** Building it by the end of turn 1, or by whichever turn it takes. */
  horizon?: 'turn1' | 'turns'
}

/**
 * "Any Energy": a goal Energy whose type does not matter. It is not a card in
 * the deck, so it is a stand-in the palette offers alongside the real ones.
 * Luminous Energy is drawn for it, as the card that famously counts as every
 * type. It is not in the simulator's card pool, so its art is linked directly.
 */
const ANY_ENERGY_KEY = 'any-energy'

/** How an attached Energy below essential is marked on its edge. */
const EDGE_PRIORITY: Record<Priority, string | null> = { 1: null, 2: 'Important', 3: 'Nice' }

const ANY_ENERGY: DeckCard = {
  key: ANY_ENERGY_KEY,
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
  // A Basic Energy asks for its type; a Special Energy for that very card.
  energyType: card.tags.includes('basic-energy')
    ? card.card?.type || null
    : card.tags.includes('energy') && card.key !== ANY_ENERGY_KEY
      ? card.key
      : null,
})

export function BoardEditor({ cards, goal, onChange, horizon = 'turn1' }: Props) {
  // Click-to-place: pick a card, then pick a zone. Keeps the board usable on a
  // touch screen and by keyboard, where dragging is not an option.
  const [picked, setPicked] = useState<string | null>(null)
  // The card whose priorities are open, by the id its parts start with.
  const [selected, setSelected] = useState<string | null>(null)
  const byKey = new Map([...cards, ANY_ENERGY].map((card) => [card.key, card]))

  const labelFor = (key: string) => byKey.get(key)?.label ?? key
  const parts = scoreBoard(
    { ...goal, choices: [] },
    { active: null, bench: [], stadiumKey: null, hand: [] },
    labelFor,
  ).parts
  // An either/or choice being built: options of part ids, and which is open.
  const [grouping, setGrouping] = useState<{ options: string[][]; current: number } | null>(null)
  /** The part a card on the board stands for in a choice. */
  const ownPart = (id: string) =>
    id === 'stadium' ? 'stadium' : goal.inHand.some((want) => want.id === id) ? `${id}:hand` : `${id}:card`
  const toggleInOption = (partId: string) =>
    setGrouping((g) => {
      if (!g) return g
      const options = g.options.map((option, i) =>
        i !== g.current
          ? option.filter((id) => id !== partId)
          : option.includes(partId)
            ? option.filter((id) => id !== partId)
            : [...option, partId],
      )
      return { ...g, options }
    })
  /** What a card on the board needs to offer its priorities. */
  /**
   * The rows a card's popover offers: the card itself and its Tools as board
   * parts, and each Energy on its own — Energy is scored per priority level,
   * but set one Energy at a time.
   */
  const cardParts = (id: string): GoalPart[] => {
    const own = parts.filter(
      (part) =>
        (part.id === id || part.id.startsWith(`${id}:`)) &&
        part.kind !== 'activeEnergy' &&
        part.kind !== 'benchEnergy',
    )
    const slot = [...(goal.active ? [goal.active] : []), ...goal.bench].find((s) => s.id === id)
    if (!slot) return own
    const energy = slot.energy.map(
      (kind, index): GoalPart => ({
        id: energyPriorityId(slot.id, index),
        kind: slot === goal.active ? 'activeEnergy' : 'benchEnergy',
        label: `${energyPhrase({ energy: [kind] }, labelFor)} ${index + 1}`,
        met: false,
        priority: energyPriority(goal, slot, index),
      }),
    )
    // The Pokémon first, then its Energy, then its Tools.
    return [own[0], ...energy, ...own.slice(1)].filter((part): part is GoalPart => part !== undefined)
  }

  const priorityProps = (id: string) => ({
    // A card is its parts: the Pokémon, its Energy and Tools; or the Stadium;
    // or a card kept in hand.
    parts: cardParts(id),
    open: grouping === null && selected === id,
    // While building an either/or, a tap puts the card in the open option.
    // Otherwise it opens the card's priorities — only when no card from the
    // deck is waiting to be placed; then a tap attaches, as before.
    onToggle:
      grouping !== null
        ? () => toggleInOption(ownPart(id))
        : picked === null
          ? () => setSelected(selected === id ? null : id)
          : undefined,
    group: groupState(id),
    onPriority: (partId: string, level: Priority) =>
      onChange(setPartPriority(goal, partId, level)),
    either: eitherFor(id),
  })

  /** Whether this card is in the option being built, or in another one. */
  const groupState = (id: string): 'current' | 'other' | undefined => {
    if (!grouping) return undefined
    const part = ownPart(id)
    if (grouping.options[grouping.current]?.includes(part)) return 'current'
    return grouping.options.some((option) => option.includes(part)) ? 'other' : undefined
  }

  /**
   * The cards that could stand in for the one at `id`: other Pokémon for a
   * Pokémon, other Stadiums for the Stadium, any other card for one kept in
   * hand — and which of them already do.
   */
  const eitherFor = (id: string): EitherOr => {
    const slot = [...(goal.active ? [goal.active] : []), ...goal.bench].find((s) => s.id === id)
    const want = goal.inHand.find((w) => w.id === id)
    const [own, chosen, fits]: [string | null, string[], (card: DeckCard) => boolean] = slot
      ? [slot.cardKey, slot.alternatives ?? [], isPokemon]
      : id === 'stadium'
        ? [goal.stadiumKey, goal.stadiumAlternatives ?? [], isStadiumCard]
        : want
          ? [want.cardKey, want.alternatives ?? [], (card) => card.key !== ANY_ENERGY_KEY]
          : [null, [], () => false]
    return {
      candidates: cards.filter((card) => card.key !== own && fits(card)),
      chosen,
      labelFor: (key) => byKey.get(key)?.label ?? key,
      onToggle: (cardKey) => onChange(toggleAlternative(goal, id, cardKey)),
    }
  }

  /**
   * The Energy and Tools the goal asks for on one Pokémon, as cards to tuck
   * behind it. A typed Energy is drawn as this deck's copy when it runs one;
   * an untyped one is "any", which has no card to show, so it is a label.
   */
  const attachedTo = (slot: SlotGoal): AttachedCard[] => {
    const name = byKey.get(slot.cardKey)?.label ?? 'this Pokémon'
    const energy = slot.energy.map((type, index) => {
      // A Special Energy is stored as its own card key.
      const special = type ? byKey.get(type) : undefined
      const deckEnergy =
        special ??
        (type
          ? cards.find((card) => card.tags.includes('basic-energy') && card.card?.type === type)
          : undefined)
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
        // Luminous Energy's art says "Luminous", so the edge says what it
        // means; and an Energy below essential says so too.
        badge:
          [type ? null : 'Any', EDGE_PRIORITY[energyPriority(goal, slot, index)]]
            .filter(Boolean)
            .join(' · ') || undefined,
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
          <h2 className="text-lg font-semibold">
            {horizon === 'turn1' ? '2 · Your board at the end of turn 1' : '2 · The board to build'}
          </h2>
          <p className="text-xs text-slate-500">
            Drag a card onto the board, or tap one and then tap where it goes. Everything you place
            becomes something the deck has to achieve
            {horizon === 'turn1'
              ? ' by the end of its first turn.'
              : ', and evolved Pokémon count — this is the board shared with the Turn 1 tab.'}
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
                      {...priorityProps(goal.active.id)}
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
                {goal.benchMin > 0 && (
                  <ConditionPriority
                    label={`${goal.benchMin} or more benched`}
                    priority={goal.priorities?.benchMin ?? 1}
                    onPriority={(level) => onChange(setPartPriority(goal, 'benchMin', level))}
                  />
                )}
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
                        {...priorityProps(slot.id)}
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
              {/* A total across every Pokémon, whatever the Energy. */}
              <div className="flex items-baseline justify-end gap-2 pt-1">
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  at least
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={goal.energyMin ?? 0}
                    onChange={(e) => onChange(setEnergyMin(goal, Number(e.target.value) || 0))}
                    aria-label="Minimum Energy attached in total"
                    className="tnum w-14 rounded-md border border-slate-300 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-950"
                  />
                  Energy attached in total
                </label>
                {(goal.energyMin ?? 0) > 0 && (
                  <ConditionPriority
                    label={`${goal.energyMin} or more Energy attached`}
                    priority={goal.priorities?.energyMin ?? 1}
                    onPriority={(level) => onChange(setPartPriority(goal, 'energyMin', level))}
                  />
                )}
              </div>
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
                    {...priorityProps('stadium')}
                  />
                ) : (
                  <Empty label="Stadium" />
                )}
              </Zone>
            </div>

            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Still in hand
                </h3>
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  at least
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={goal.handMin ?? 0}
                    onChange={(e) => onChange(setHandMin(goal, Number(e.target.value) || 0))}
                    aria-label="Minimum cards in hand"
                    className="tnum w-14 rounded-md border border-slate-300 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-950"
                  />
                  cards
                </label>
                {(goal.handMin ?? 0) > 0 && (
                  <ConditionPriority
                    label={`${goal.handMin} or more cards in hand`}
                    priority={goal.priorities?.handMin ?? 1}
                    onPriority={(level) => onChange(setPartPriority(goal, 'handMin', level))}
                  />
                )}
              </div>
              <Zone id="hand" picked={picked} onPick={place}>
                <div className="flex flex-wrap gap-2">
                  {goal.inHand.map((want) => (
                    <SlotCard
                      key={want.id}
                      card={byKey.get(want.cardKey)}
                      count={want.count}
                      onRemove={() => onChange(removeHand(goal, want.id))}
                      {...priorityProps(want.id)}
                    />
                  ))}
                  {goal.inHand.length === 0 && <Empty label="Hand" />}
                </div>
              </Zone>
            </div>
          </div>
        </div>

        <Choices
          goal={goal}
          labelFor={labelFor}
          grouping={grouping}
          onGrouping={(next) => {
            setSelected(null)
            setGrouping(next)
          }}
          onChange={onChange}
        />

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
  parts,
  open,
  onToggle,
  onPriority,
  either,
  group,
}: {
  slot?: SlotGoal
  card: DeckCard | undefined
  count?: number
  /** Energy and Tools on a Pokémon in play; absent for other zones. */
  attached?: AttachedCard[]
  onRemove: () => void
  /** The parts of the board this card stands for, with their priorities. */
  parts: GoalPart[]
  /** Its priority options are showing. */
  open: boolean
  /** Tapping the card opens or closes them; absent while placing a card. */
  onToggle?: () => void
  onPriority: (partId: string, level: Priority) => void
  either: EitherOr
  /** In the either/or option being built, or in another of its options. */
  group?: 'current' | 'other'
}) {
  const src = card ? cardImageUrl(card) : null
  const name = card?.label ?? 'Unknown'
  // The card's own part (the Pokémon, the Stadium, the card in hand) sets
  // the badge; its Energy and Tools have their own rows when opened.
  const own = parts[0]
  const badge = own && own.priority > 1 ? PRIORITY_LEVELS[own.priority - 1].label : null

  const face = (
    <div
      className={[
        'relative aspect-[245/342] overflow-hidden rounded-md border bg-slate-100 dark:bg-slate-800',
        group === 'current'
          ? 'border-amber-500 ring-2 ring-amber-400/70'
          : group === 'other'
            ? 'border-dashed border-amber-500'
            : open
              ? 'border-sky-500 ring-2 ring-sky-400/60'
              : 'border-slate-200 dark:border-slate-700',
        onToggle ? 'cursor-pointer' : '',
      ].join(' ')}
      role={onToggle ? 'button' : undefined}
      tabIndex={onToggle ? 0 : undefined}
      aria-label={onToggle ? `Set priority for ${name}` : undefined}
      aria-expanded={onToggle ? open : undefined}
      onClick={onToggle}
      onKeyDown={
        onToggle
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggle()
              }
            }
          : undefined
      }
    >
      {src ? (
        <img src={src} alt={name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center p-1 text-center text-[10px] leading-tight">
          {name}
        </div>
      )}
      <button
        type="button"
        onClick={(event) => {
          // Not also a tap on the card underneath.
          event.stopPropagation()
          onRemove()
        }}
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
      {badge && (
        <span className="absolute inset-x-0 bottom-0 bg-amber-500/90 text-center text-[9px] font-semibold text-white">
          {badge}
        </span>
      )}
    </div>
  )

  return (
    <figure className="relative w-[84px] space-y-1">
      {slot ? (
        <WithAttached attached={attached ?? []} peek={14}>
          {face}
        </WithAttached>
      ) : (
        face
      )}
      {!slot && <figcaption className="truncate text-center text-[10px]">{name}</figcaption>}
      {either.chosen.length > 0 && (
        <p
          className="truncate text-center text-[10px] text-sky-700 dark:text-sky-400"
          title={`or ${either.chosen.map(either.labelFor).join(' or ')}`}
        >
          or {either.chosen.map(either.labelFor).join(' or ')}
        </p>
      )}
      {open && parts.length > 0 && (
        <PriorityPopover
          name={name}
          parts={parts}
          onPriority={onPriority}
          onClose={onToggle}
          either={either}
        />
      )}
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

/**
 * The priority options for one card on the board, opened by tapping it: how
 * much the card matters, and its Energy and Tools each on their own row. A
 * game with every part at a level, and every more important one, counts as a
 * partial success at that level.
 */
function PriorityPopover({
  name,
  parts,
  onPriority,
  onClose,
  either,
}: {
  name: string
  parts: GoalPart[]
  onPriority: (partId: string, level: Priority) => void
  onClose?: () => void
  either: EitherOr
}) {
  return (
    <div
      data-testid="priority-popover"
      role="dialog"
      aria-label={`Priorities for ${name}`}
      // Taps inside are choices, not taps on the board around it.
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose?.()
      }}
      className="absolute top-full left-0 z-30 mt-1 w-64 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">Priority</span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          Done
        </button>
      </div>
      {parts.map((part) => (
        <div key={part.id} className="space-y-1">
          <div className="truncate text-slate-600 dark:text-slate-300" title={part.label}>
            {part.label}
          </div>
          <div className="flex gap-1" role="group" aria-label={`Priority of ${part.label}`}>
            {PRIORITY_LEVELS.map(({ level, label }) => (
              <button
                key={level}
                type="button"
                aria-pressed={part.priority === level}
                onClick={() => onPriority(part.id, level)}
                className={[
                  'flex-1 rounded-md border px-1.5 py-0.5',
                  part.priority === level
                    ? 'border-sky-500 bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-slate-500">
        A game that has every part at a level, and every more important one, counts as a partial
        success at that level.
      </p>
      {either.candidates.length > 0 && (
        <div className="space-y-1 border-t border-slate-100 pt-2 dark:border-slate-800">
          <div className="font-semibold">Either/or</div>
          <p className="text-slate-500">Also a success with any of these instead of {name}:</p>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto" role="group" aria-label={`Either/or for ${name}`}>
            {either.candidates.map((card) => {
              const on = either.chosen.includes(card.key)
              return (
                <button
                  key={card.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => either.onToggle(card.key)}
                  className={[
                    'rounded-md border px-1.5 py-0.5',
                    on
                      ? 'border-sky-500 bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                  ].join(' ')}
                >
                  {card.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** The cards that could stand in for one on the board, and which already do. */
interface EitherOr {
  candidates: DeckCard[]
  chosen: string[]
  labelFor: (cardKey: string) => string
  onToggle: (cardKey: string) => void
}

/**
 * Either/or across the board — "Ciphermaniac's Codebreaking in hand, or
 * Academy at Night in play and Kyurem in hand". Built by tapping: each option
 * is the cards tapped while it is open, and the choice is met when every card
 * of any one option is.
 */
function Choices({
  goal,
  labelFor,
  grouping,
  onGrouping,
  onChange,
}: {
  goal: FieldGoal
  labelFor: (cardKey: string) => string
  grouping: { options: string[][]; current: number } | null
  onGrouping: (next: { options: string[][]; current: number } | null) => void
  onChange: (goal: FieldGoal) => void
}) {
  const empty = { active: null, bench: [], stadiumKey: null, hand: [] }
  const parts = scoreBoard({ ...goal, choices: [] }, empty, labelFor).parts
  const label = (partId: string) => parts.find((part) => part.id === partId)?.label ?? partId
  const folded = scoreBoard(goal, empty, labelFor).parts.filter((part) => part.kind === 'choice')
  const optionText = (option: string[]) => option.map(label).join(' and ')

  if (parts.length < 2 && folded.length === 0) return null

  return (
    <div
      data-testid="choices"
      className="space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900"
    >
      {folded.map((part) => (
        <div key={part.id} className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <span>
              <span className="font-medium">Either </span>
              {part.label}
            </span>
            <button
              type="button"
              onClick={() => onChange(removeChoice(goal, part.id.slice('choice:'.length)))}
              className="shrink-0 text-xs text-slate-500 hover:text-rose-600"
            >
              Remove
            </button>
          </div>
          <div className="flex gap-1" role="group" aria-label={`Priority of ${part.label}`}>
            {PRIORITY_LEVELS.map(({ level, label: name }) => (
              <button
                key={level}
                type="button"
                aria-pressed={part.priority === level}
                onClick={() => onChange(setPartPriority(goal, part.id, level))}
                className={[
                  'rounded-md border px-1.5 py-0.5 text-xs',
                  part.priority === level
                    ? 'border-sky-500 bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                ].join(' ')}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ))}

      {grouping === null ? (
        <button
          type="button"
          onClick={() => onGrouping({ options: [[]], current: 0 })}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Either/or across zones
        </button>
      ) : (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
          <p>
            Tap the cards on the board for option {grouping.current + 1}. Each option is met when
            all of its cards are; the choice when any option is.
          </p>
          <ol className="space-y-1">
            {grouping.options.map((option, i) => (
              <li key={i} className={i === grouping.current ? 'font-medium' : 'text-slate-500'}>
                {i > 0 && 'or '}
                {option.length > 0 ? optionText(option) : '(tap cards on the board)'}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={(grouping.options[grouping.current]?.length ?? 0) === 0}
              onClick={() =>
                onGrouping({ options: [...grouping.options, []], current: grouping.options.length })
              }
              className="rounded-md border border-slate-300 px-2 py-0.5 disabled:opacity-40 dark:border-slate-700"
            >
              Or…
            </button>
            <button
              type="button"
              disabled={grouping.options.filter((option) => option.length > 0).length < 2}
              onClick={() => {
                onChange(addChoice(goal, grouping.options))
                onGrouping(null)
              }}
              className="rounded-md border border-sky-500 bg-sky-50 px-2 py-0.5 font-medium text-sky-800 disabled:opacity-40 dark:bg-sky-950/40 dark:text-sky-200"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => onGrouping(null)}
              className="rounded-md px-2 py-0.5 text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The priority of a condition that has no card to tap — "at least N benched",
 * "at least N cards in hand": a small button naming the current level, which
 * opens the same three options a card's popover offers.
 */
function ConditionPriority({
  label,
  priority,
  onPriority,
}: {
  label: string
  priority: Priority
  onPriority: (level: Priority) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Priority of ${label}`}
        onClick={() => setOpen((on) => !on)}
        className={[
          'rounded-md border px-1.5 py-0.5 text-xs',
          priority > 1
            ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
            : 'border-slate-300 text-slate-500 dark:border-slate-700',
        ].join(' ')}
      >
        {PRIORITY_LEVELS[priority - 1].label}
      </button>
      {open && (
        <span
          role="group"
          aria-label={`Choose the priority of ${label}`}
          className="absolute top-full right-0 z-30 mt-1 flex gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {PRIORITY_LEVELS.map(({ level, label: name }) => (
            <button
              key={level}
              type="button"
              aria-pressed={priority === level}
              onClick={() => {
                onPriority(level)
                setOpen(false)
              }}
              className={[
                'rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap',
                priority === level
                  ? 'border-sky-500 bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
              ].join(' ')}
            >
              {name}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
