/** A single attack or ability printed on a card. */
export interface CardMove {
  name: string
  cost: string
  damage: string
  effect: string
}

/** One unique card, as produced by scripts/build-card-db.mjs. */
export interface CardRecord {
  id: number
  name: string
  set: string
  num: string
  /** 'Basic Pokémon' | 'Stage 1 Pokémon' | 'Item' | 'Supporter' | 'Stadium' | … */
  kind: string
  /** 'Pokémon ex' | 'Mega Pokémon ex' | 'ACE SPEC' | '' */
  rule: string
  category: string
  /** Previous evolution stage, by name. */
  prev: string
  hp: number | null
  type: string
  weak: string
  resist: string
  retreat: number | null
  /** Card-level effect text (Trainers and Energy). */
  effect: string
  moves: CardMove[]
  /** Role tags derived offline by the generator. */
  tags: string[]
}

export interface BasicEnergyRef {
  id: number
  type: string
  colour: string
}

export interface CardDb {
  generatedFrom: string
  sourceSha256: string
  sourceRows: number
  cardCount: number
  basicEnergy: BasicEnergyRef[]
  cards: CardRecord[]
}

/** How a decklist line was matched to a card. */
export type ResolutionMethod =
  | 'exact'
  | 'basic-energy'
  /** Matched through a curated alias, for naming variants the data lacks. */
  | 'alias'
  | 'name-fallback'
  /** The set/number is known but names a different card; the name won. */
  | 'printing-conflict'
  | 'unresolved'

/** One parsed decklist line. */
export interface ParsedLine {
  count: number
  name: string
  set: string
  num: string
  /** The raw source line, for error reporting. */
  raw: string
}

/** A parsed line joined to the card it resolved to. */
export interface ResolvedEntry extends ParsedLine {
  card: CardRecord | null
  method: ResolutionMethod
  note?: string
}

/**
 * A deck card aggregated across printings — the unit conditions are keyed on.
 * Four `Ultra Ball MEG 131` plus one `Ultra Ball SVI 196` is one DeckCard with
 * count 5, because they are the same card for every probability question.
 */
export interface DeckCard {
  /** Stable identity: `id:<cardId>` when resolved, else `name:<normalised name>`. */
  key: string
  /** Display name, as written in the decklist. */
  label: string
  /** Canonical name from the card database, when resolved. */
  resolvedName: string | null
  count: number
  card: CardRecord | null
  /** Printings seen in the decklist, e.g. ['MEG 131', 'SVI 196']. */
  printings: string[]
  tags: string[]
}

export interface Deck {
  cards: DeckCard[]
  /** Total copies across every line, resolved or not. */
  totalCards: number
  /** Copies whose card could not be identified (still counted in the math). */
  unresolvedCards: number
  entries: ResolvedEntry[]
  warnings: string[]
  /** Subset of warnings worth showing prominently: the decklist's set/number
   *  disagrees with the card data, so the identity may be wrong. */
  conflicts: string[]
  /** Lines that looked like cards but could not be parsed at all. */
  badLines: string[]
}
