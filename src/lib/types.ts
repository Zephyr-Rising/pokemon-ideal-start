/** A single attack or ability printed on a card. */
export interface CardMove {
  name: string
  cost: string
  damage: string
  effect: string
}

/** One unique card, as produced by scripts/build-card-db.mjs. */
export interface CardRecord {
  /** Position in the card array — the card's stable identity within a build. */
  index: number
  name: string
  /** 'Basic Pokémon' | 'Stage 1 Pokémon' | 'Item' | 'Supporter' | 'Stadium' | … */
  kind: string
  /** 'Pokémon ex' | 'Mega Pokémon ex' | 'ACE SPEC' | '' */
  rule: string
  /** Previous evolution stage, by name. */
  prev: string
  hp: number | null
  type: string
  retreat: number | null
  /** Standard rotation marker: H, I, J … (blank for basic Energy). */
  regulationMark: string
  /** Card-level effect text (Trainers and Energy). */
  effect: string
  moves: CardMove[]
  /** Role tags derived offline by the generator. */
  tags: string[]
  /** TCGdex image base URL; append a quality such as `/low.webp`. */
  image: string
  /** Card ID in the Kaggle simulator's dataset, where one exists. */
  kaggleId?: number
}

/** One printed appearance of a card: `set` is the PTCG Live code. */
export interface Printing {
  set: string
  num: string
  card: number
}

export interface BasicEnergyRef {
  index: number
  type: string
  colour: string
}

export interface CardDb {
  generatedFrom: string[]
  sourceSha256: { tcgdex: string; csv: string }
  cardCount: number
  printingCount: number
  cards: CardRecord[]
  printings: Printing[]
  basicEnergy: BasicEnergyRef[]
  /** Cards excluded for not being Standard legal, so the UI can say why. */
  nonStandardNames: string[]
}

/** How a decklist line was matched to a card. */
export type ResolutionMethod =
  | 'exact'
  | 'basic-energy'
  | 'name-fallback'
  /** The set/number is known but names a different card; the name won. */
  | 'printing-conflict'
  /** Known card, but not Standard legal — excluded from the database. */
  | 'not-standard'
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
  /** Stable identity: `id:<index>` when resolved, else `name:<normalised name>`. */
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
  /** Cards recognised but not Standard legal. */
  nonStandard: string[]
  /** Lines that looked like cards but could not be parsed at all. */
  badLines: string[]
}
