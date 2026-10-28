#!/usr/bin/env node
/**
 * Refreshes the TCGdex card cache: `npm run fetch:cards`
 *
 * This is the ONLY script that touches the network, and it is run deliberately
 * — never as part of a build. It writes `data/tcgdex-cards.json`, which is
 * committed, so `build-card-db.mjs` and the whole pre-flight stay offline and
 * byte-for-byte reproducible.
 *
 * Scope: cards that are **currently Standard legal**, which TCGdex reports per
 * card as `legal.standard` (regulation marks H, I and J at the time of writing,
 * plus unmarked basic Energy). Sets are scanned rather than trusted — Stellar
 * Crown, for instance, carries a mix of G- and H-marked cards, so a set-level
 * decision would be wrong.
 *
 * The API has no bulk endpoint for full card data: a set request returns stubs
 * (id, name, localId, image) and each card must then be fetched individually.
 * That is why the result is cached rather than fetched live.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'data/tcgdex-cards.json')
const OVERRIDES = resolve(ROOT, 'data/standard-overrides.json')
// Gitignored response cache, so re-runs only hit the network for new cards.
// Pass --refresh to ignore it.
const CACHE_DIR = resolve(ROOT, '.cache/tcgdex')
const REFRESH = process.argv.includes('--refresh')
const API = 'https://api.tcgdex.net/v2/en'

/** Series that can contain Standard-legal cards. `tcgp` is Pokémon TCG Pocket,
 *  a different game, and is never included. */
const SERIES = new Set(['sv', 'me'])
/** Everything before this Scarlet & Violet set is regulation mark F or G, long
 *  rotated out. `legal.standard` is still the real filter; this only avoids
 *  thousands of pointless requests. */
const SV_CUTOFF = 'sv05'

const CONCURRENCY = 8
const RETRIES = 3

async function getJson(path, attempt = 1) {
  const cacheFile = resolve(CACHE_DIR, createHash('sha1').update(path).digest('hex') + '.json')
  if (!REFRESH && existsSync(cacheFile)) {
    try {
      return JSON.parse(readFileSync(cacheFile, 'utf8'))
    } catch {
      // Corrupt cache entry; fall through and refetch.
    }
  }
  try {
    const response = await fetch(`${API}${path}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(cacheFile, JSON.stringify(body), 'utf8')
    return body
  } catch (error) {
    if (attempt > RETRIES) throw new Error(`${path}: ${error.message}`, { cause: error })
    await new Promise((r) => setTimeout(r, 400 * attempt))
    return getJson(path, attempt + 1)
  }
}

/** Run `worker` over `items` with a bounded number in flight. */
async function pool(items, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

const progress = (done, total, label) => {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100)
  if (process.stdout.isTTY) {
    process.stdout.write(`\r  ${label.padEnd(30)} ${String(pct).padStart(3)}%  (${done}/${total})   `)
  } else if (done === total || done % 500 === 0) {
    // A carriage return does not collapse in a captured log, so when stdout is
    // not a terminal emit occasional milestones instead of 3,000 lines.
    console.log(`  ${label} ${pct}% (${done}/${total})`)
  }
}

// --- Which sets to scan -----------------------------------------------------

const overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8'))
const FORCE_INCLUDE = new Set(overrides.includeSets ?? [])
const FORCE_EXCLUDE = new Set(overrides.excludeSets ?? [])

console.log('fetch-tcgdex: listing sets…')
const allSets = await getJson('/sets')
const svIndex = allSets.findIndex((s) => s.id === SV_CUTOFF)

const candidates = []
for (const [index, stub] of allSets.entries()) {
  const full = await getJson(`/sets/${stub.id}`)
  const serie = full.serie?.id
  if (!SERIES.has(serie)) continue
  // Skip Scarlet & Violet sets released before the cutoff.
  if (serie === 'sv' && svIndex >= 0 && index < svIndex && stub.id !== 'sve') continue
  candidates.push({
    id: stub.id,
    name: full.name,
    abbreviation: full.abbreviation?.official ?? null,
    serie,
    cards: full.cards ?? [],
  })
}
console.log(`  ${candidates.length} candidate sets (series: ${[...SERIES].join(', ')})`)

// --- Fetch every card in those sets ----------------------------------------

const stubs = candidates.flatMap((set) =>
  set.cards.map((card) => ({ ...card, setId: set.id, abbreviation: set.abbreviation })),
)
console.log(`  ${stubs.length} cards to fetch`)

let done = 0
const fetched = await pool(stubs, async (stub) => {
  const card = await getJson(`/cards/${stub.id}`)
  progress(++done, stubs.length, 'fetching cards')
  return { stub, card }
})
process.stdout.write('\n')

// --- Shape the result -------------------------------------------------------

/**
 * Cards are stored once per distinct card, with a separate printings index.
 * A set's "total" exceeds its "official" count because of secret rares and
 * alternate arts, which are the same card at a different number — decklists may
 * cite any of them, so every printing must resolve, but the metadata is shared.
 */
const cards = new Map() // key -> card record
const printings = [] // { set, localId, key }
const nonStandard = new Set() // names, so the UI can say WHY a card is excluded

/**
 * Identity of a card across printings.
 *
 * Effect text is deliberately NOT part of the key: TCGdex carries the same
 * Trainer with no separator, a newline, or a blank line between its sentences
 * on different reprints, which split Ultra Ball into three separate cards - and
 * a deck running Ultra Ball from two sets would then have its copies counted as
 * two different cards.
 *
 * Pokemon still need distinguishing, because one name covers genuinely
 * different cards, so their key includes stage, HP and attack names.
 */
const identity = (card) => {
  if (card.category !== 'Pokemon') return card.name + '|' + card.category
  const attacks = (card.attacks ?? []).map((a) => a.name).sort().join(',')
  return [card.name, card.category, card.stage ?? '', card.hp ?? '', attacks].join('|')
}

/** How much a record tells us - used to keep the richest of several printings. */
const richness = (card) =>
  (card.effect ? card.effect.length : 0) +
  (card.abilities ?? []).length * 50 +
  (card.attacks ?? []).length * 50 +
  (card.image ? 10 : 0)

for (const { stub, card } of fetched) {
  const abbreviation = stub.abbreviation
  // Curated overrides win: TCGdex's legality flag lags for some sets.
  const isStandard = FORCE_EXCLUDE.has(stub.setId)
    ? false
    : FORCE_INCLUDE.has(stub.setId) || Boolean(card.legal?.standard)
  if (!isStandard) {
    nonStandard.add(card.name)
    continue
  }
  const key = identity(card)
  // Keep the most informative printing: some reprints omit effect text entirely.
  const existing = cards.get(key)
  if (!existing || richness(card) > existing._richness) {
    cards.set(key, {
      _richness: richness(card),
      name: card.name,
      category: card.category, // Pokemon | Trainer | Energy
      stage: card.stage ?? '', // Basic | Stage1 | Stage2
      trainerType: card.trainerType ?? '', // Item | Supporter | Tool | Stadium
      energyType: card.energyType ?? '', // Basic | Special
      suffix: card.suffix ?? '', // ex | EX | GX | V …
      // ACE SPEC is not exposed via `suffix`; its only marker is the rarity.
      // It matters because ACE SPEC cards are limited to 1 per deck.
      rarity: card.rarity ?? '',
      evolveFrom: card.evolveFrom ?? '',
      hp: card.hp ?? null,
      types: card.types ?? [],
      retreat: card.retreat ?? null,
      regulationMark: card.regulationMark ?? '',
      effect: card.effect ?? '',
      abilities: (card.abilities ?? []).map((a) => ({
        name: a.name,
        type: a.type ?? 'Ability',
        effect: a.effect ?? '',
      })),
      attacks: (card.attacks ?? []).map((a) => ({
        name: a.name,
        cost: a.cost ?? [],
        damage: a.damage ?? null,
        effect: a.effect ?? '',
      })),
      // Base URL; the app appends a quality/format such as `/low.webp`.
      image: card.image ?? '',
    })
  }
  if (abbreviation) printings.push({ set: abbreviation, localId: card.localId, key })
}

/**
 * Basic Energy carries no artwork in any Standard-legal set - all 32 printings
 * 404 - so borrow the image from the most recent Scarlet & Violet printing of
 * the same Energy. It is the same card face, and showing the real card beats
 * drawing a substitute.
 */
const BASIC_COLOURS = [
  'Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal',
]
const printingRank = (id) => (id.startsWith('sv') ? 0 : id.startsWith('swsh') ? 1 : 2)

let borrowed = 0
for (const colour of BASIC_COLOURS) {
  const card = [...cards.values()].find((c) => c.name === `${colour} Energy`)
  if (!card || card.image) continue

  const matches = await getJson(`/cards?name=${encodeURIComponent(colour + ' Energy')}`)
  const withArt = matches
    .filter(
      (m) => (m.name === `${colour} Energy` || m.name === `Basic ${colour} Energy`) && m.image,
    )
    .sort((a, b) => printingRank(a.id) - printingRank(b.id) || a.id.localeCompare(b.id))

  if (withArt[0]) {
    card.image = withArt[0].image
    borrowed++
  }
}
console.log(`  borrowed artwork for ${borrowed} basic Energy cards`)

// Stable ordering so the committed file only changes when the data does.
const keys = [...cards.keys()].sort()
const indexOf = new Map(keys.map((key, i) => [key, i]))

const out = {
  source: 'https://api.tcgdex.net/v2/en',
  fetchedSets: candidates
    .map((s) => ({ id: s.id, abbreviation: s.abbreviation, name: s.name }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  cards: keys.map((key) => {
    const { _richness, ...card } = cards.get(key)
    void _richness
    return card
  }),
  printings: printings
    .map((p) => ({ set: p.set, localId: p.localId, card: indexOf.get(p.key) }))
    .sort((a, b) => a.set.localeCompare(b.set) || a.localId.localeCompare(b.localId)),
  nonStandardNames: [...nonStandard].sort(),
}

const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
const next = JSON.stringify(out) + '\n'
writeFileSync(OUT, next, 'utf8')

console.log(`\nfetch-tcgdex: ${stubs.length} cards scanned`)
console.log(`  ${out.cards.length} distinct Standard-legal cards`)
console.log(`  ${out.printings.length} printings indexed`)
console.log(`  ${out.nonStandardNames.length} non-Standard names recorded`)
console.log(`  wrote data/tcgdex-cards.json (${(next.length / 1024).toFixed(0)} KB)`)
console.log(previous === next ? '  unchanged' : '  CHANGED — review and commit, then run build:cards')
