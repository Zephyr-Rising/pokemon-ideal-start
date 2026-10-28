import { findBasicEnergyByName, findByName, findByPrinting, isNonStandard } from './card-db'
import { norm } from './normalize'
import { parseDecklist } from './parse-decklist'
import type { CardRecord, Deck, DeckCard, ResolvedEntry } from './types'

/**
 * Resolve a PTCG Live export into a deck.
 *
 * Resolution order:
 *   1. exact (set, number) match whose NAME also agrees
 *   2. basic-Energy colour map, for printings the data doesn't carry
 *   3. name match — the same card under a different printing
 *   4. printing conflict — the set/number is known but names a different card.
 *      Used with a loud warning rather than silently, because a set/number only
 *      locates a printing whereas the name identifies the card.
 *   5. known but not Standard legal — reported as such, which is far more
 *      useful than calling a real card "unknown"
 *   6. unresolved — but the copies are STILL counted, so every deck produces
 *      correct totals and correct probabilities. Only metadata-dependent
 *      features (tags, auto-seeding) skip these.
 *
 * Step 1's name check matters: a real export carried `Telepathic Psychic Energy
 * POR 88` while an older data source listed POR 88 as a different card entirely.
 * Matching on number alone silently substituted the wrong card.
 */
export function resolveDeck(text: string): Deck {
  const { lines, badLines } = parseDecklist(text)
  const entries: ResolvedEntry[] = []
  const warnings: string[] = []
  const conflicts: string[] = []
  const nonStandard: string[] = []

  for (const line of lines) {
    const printed = line.set !== '' ? `${line.set} ${line.num}` : ''
    const candidates: CardRecord[] = line.set !== '' ? findByPrinting(line.set, line.num) : []
    const named = candidates.find((card) => norm(card.name) === norm(line.name))

    if (named) {
      entries.push({ ...line, card: named, method: 'exact' })
      continue
    }

    const energy = findBasicEnergyByName(line.name)
    if (energy) {
      entries.push({ ...line, card: energy, method: 'basic-energy' })
      continue
    }

    const byName = findByName(line.name)
    if (byName) {
      const note = `${line.name}${printed ? ` ${printed}` : ''}: printing not in the card data; used another printing of the same card.`
      warnings.push(note)
      entries.push({ ...line, card: byName, method: 'name-fallback', note })
      continue
    }

    if (candidates.length > 0) {
      const found = candidates[0]
      const note = `${line.name} ${printed}: the card data lists ${printed} as "${found.name}". Using that card — check the set and number on this line.`
      conflicts.push(note)
      warnings.push(note)
      entries.push({ ...line, card: found, method: 'printing-conflict', note })
      continue
    }

    if (isNonStandard(line.name)) {
      const note = `${line.name}: not Standard legal, so it carries no card details here. Its copies still count toward the deck.`
      nonStandard.push(line.name)
      warnings.push(note)
      entries.push({ ...line, card: null, method: 'not-standard', note })
      continue
    }

    const note = `${line.raw}: not found in the card data. Copies are still counted, but this card has no details.`
    warnings.push(note)
    entries.push({ ...line, card: null, method: 'unresolved', note })
  }

  return {
    cards: aggregate(entries),
    totalCards: entries.reduce((sum, e) => sum + e.count, 0),
    unresolvedCards: entries
      .filter((e) => e.card === null)
      .reduce((sum, e) => sum + e.count, 0),
    entries,
    warnings,
    conflicts,
    nonStandard,
    badLines,
  }
}

/**
 * Collapse entries onto one DeckCard per distinct card, summing copies across
 * printings. Keyed on card index when resolved, so reprints merge; keyed on the
 * normalised name otherwise, so unknown cards still merge sensibly.
 */
function aggregate(entries: ResolvedEntry[]): DeckCard[] {
  const out = new Map<string, DeckCard>()

  for (const entry of entries) {
    const key = entry.card ? `id:${entry.card.index}` : `name:${norm(entry.name)}`
    const printing = entry.set !== '' ? `${entry.set} ${entry.num}` : entry.name

    const existing = out.get(key)
    if (existing) {
      existing.count += entry.count
      if (!existing.printings.includes(printing)) existing.printings.push(printing)
      continue
    }

    out.set(key, {
      key,
      // The name as the player wrote it reads better than the canonical one.
      label: entry.name,
      resolvedName: entry.card?.name ?? null,
      count: entry.count,
      card: entry.card,
      printings: [printing],
      tags: entry.card?.tags ?? [],
    })
  }

  return [...out.values()]
}
