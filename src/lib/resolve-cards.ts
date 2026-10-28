import { findBasicEnergyByName, findByAlias, findByName, findByPrinting } from './card-db'
import { norm } from './normalize'
import { parseDecklist } from './parse-decklist'
import type { Deck, DeckCard, ResolvedEntry } from './types'

/**
 * Resolve a PTCG Live export into a deck.
 *
 * Resolution order, extending `Decklist Transformer.ipynb` Cell 5:
 *   1. exact (Expansion, Collection No.) match whose NAME also agrees
 *   2. basic-Energy colour map, for printings absent from the dataset
 *   3. name match — same card, a different printing (recorded as a warning)
 *   4. curated alias, for naming variants the dataset lacks entirely
 *   5. printing conflict — the set/number is known but names a different card.
 *      Used with a loud warning rather than silently, because a set/number only
 *      locates a printing whereas the name identifies the card.
 *   6. unresolved — unknown to the database, but its copies are STILL counted,
 *      so every deck produces correct totals and correct probabilities. Only
 *      metadata-dependent features (tags, auto-seeding) skip these.
 *
 * Step 1's name check matters: a real export carried `Telepathic Psychic Energy
 * POR 88` while POR 88 in this dataset is `Rock Fighting Energy`. Matching on
 * number alone silently substituted an unrelated card.
 */
export function resolveDeck(text: string): Deck {
  const { lines, badLines } = parseDecklist(text)
  const entries: ResolvedEntry[] = []
  const warnings: string[] = []
  const conflicts: string[] = []

  for (const line of lines) {
    const printed = line.set !== '' ? `${line.set} ${line.num}` : ''
    const byPrinting = line.set !== '' ? findByPrinting(line.set, line.num) : undefined

    if (byPrinting && norm(byPrinting.name) === norm(line.name)) {
      entries.push({ ...line, card: byPrinting, method: 'exact' })
      continue
    }

    const energy = findBasicEnergyByName(line.name)
    if (energy) {
      entries.push({ ...line, card: energy, method: 'basic-energy' })
      continue
    }

    const byName = findByName(line.name)
    if (byName) {
      const note = `${line.name}${printed ? ` ${printed}` : ''}: printing not in the card data; used ${byName.set} ${byName.num}.`
      warnings.push(note)
      entries.push({ ...line, card: byName, method: 'name-fallback', note })
      continue
    }

    const alias = findByAlias(line.name)
    if (alias) {
      const note = `${line.name}${printed ? ` ${printed}` : ''}: matched to "${alias.name}" (${alias.set} ${alias.num}) through a curated name alias.`
      warnings.push(note)
      entries.push({ ...line, card: alias, method: 'alias', note })
      continue
    }

    if (byPrinting) {
      const note = `${line.name} ${printed}: the card data lists ${printed} as "${byPrinting.name}". Using that card — check the set and number on this line.`
      conflicts.push(note)
      warnings.push(note)
      entries.push({ ...line, card: byPrinting, method: 'printing-conflict', note })
      continue
    }

    const note = `${line.raw}: not found in the card data. Copies are still counted, but this card has no metadata.`
    warnings.push(note)
    entries.push({ ...line, card: null, method: 'unresolved', note })
  }

  return {
    cards: aggregate(entries),
    totalCards: entries.reduce((sum, e) => sum + e.count, 0),
    unresolvedCards: entries
      .filter((e) => e.method === 'unresolved')
      .reduce((sum, e) => sum + e.count, 0),
    entries,
    warnings,
    conflicts,
    badLines,
  }
}

/**
 * Collapse entries onto one DeckCard per distinct card, summing copies across
 * printings. Keyed on card ID when resolved, so reprints merge; keyed on the
 * normalised name otherwise, so unknown cards still merge sensibly.
 */
function aggregate(entries: ResolvedEntry[]): DeckCard[] {
  const out = new Map<string, DeckCard>()

  for (const entry of entries) {
    const key = entry.card ? `id:${entry.card.id}` : `name:${norm(entry.name)}`
    const printing = entry.set !== '' ? `${entry.set} ${entry.num}` : entry.name

    const existing = out.get(key)
    if (existing) {
      existing.count += entry.count
      if (!existing.printings.includes(printing)) existing.printings.push(printing)
      continue
    }

    out.set(key, {
      key,
      // The name as the player wrote it reads better than the canonical one
      // ('Grass Energy' rather than 'Basic {G} Energy').
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
