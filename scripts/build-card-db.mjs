#!/usr/bin/env node
// Offline generator: data/EN_Card_Data.csv -> src/data/cards.json
//
// Card-derived logic is baked here, at build time, and never inferred at runtime.
//
// The source CSV has ONE ROW PER ATTACK/ABILITY, not one row per card: 2,022 rows
// collapse to 1,267 unique Card IDs (e.g. Scrafty occupies two rows, "Nab 'n' Dash"
// and "High Jump Kick"). Rows are therefore grouped by Card ID and their moves
// collected into an array; a naive (set, number) index would silently drop moves.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_CSV = resolve(ROOT, 'data/EN_Card_Data.csv')
const OUT_JSON = resolve(ROOT, 'src/data/cards.json')
const OVERRIDES = resolve(ROOT, 'src/data/curated-tags.json')

/** Minimal RFC-4180 CSV parser. Effect text contains both commas and newlines
 *  inside quoted fields, so a line-splitting parser would corrupt the data. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '') // strip BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else { quoted = false }
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch !== '\r') field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

/** 'n/a' and '' both mean "absent" in this dataset. */
const clean = (v) => {
  const s = (v ?? '').trim()
  return s === 'n/a' ? '' : s
}
const num = (v) => {
  const s = clean(v)
  return s === '' ? null : Number.parseInt(s, 10)
}

const ENERGY_COLOURS = {
  '{G}': 'Grass', '{R}': 'Fire', '{W}': 'Water', '{L}': 'Lightning',
  '{P}': 'Psychic', '{F}': 'Fighting', '{D}': 'Darkness', '{M}': 'Metal',
}

/** Role tags, derived from kind/rule plus effect-text heuristics.
 *  Heuristics are imperfect by nature, so `curated-tags.json` can add or remove
 *  tags per Card ID; curation wins over inference. */
function deriveTags(card) {
  const t = new Set()
  const { kind, rule } = card
  const isPokemon = kind.includes('Pokémon') && !kind.includes('Tool')

  if (isPokemon) {
    t.add('pokemon')
    if (kind === 'Basic Pokémon') t.add('basic')
    if (kind === 'Stage 1 Pokémon') t.add('stage1')
    if (kind === 'Stage 2 Pokémon') t.add('stage2')
    // A card with no non-Ability move cannot attack (e.g. Mega Kangaskhan ex has
    // only the Run Errand Ability in this dataset).
    if (card.moves.some((m) => !m.name.startsWith('[Ability]'))) t.add('attacker')
    if (card.moves.some((m) => m.name.startsWith('[Ability]'))) t.add('ability')
  }
  if (kind === 'Item') t.add('item')
  if (kind === 'Supporter') t.add('supporter')
  if (kind === 'Pokémon Tool') t.add('tool')
  if (kind === 'Stadium') t.add('stadium')
  if (kind === 'Basic Energy') { t.add('energy'); t.add('basic-energy') }
  if (kind === 'Special Energy') { t.add('energy'); t.add('special-energy') }

  if (rule.includes('ex')) t.add('ex')
  if (rule === 'Mega Pokémon ex') t.add('mega')
  if (rule === 'ACE SPEC') t.add('ace-spec')

  // Effect-text heuristics run over every effect the card has (card-level for
  // Trainers/Energy, per-move for Pokémon).
  const text = [card.effect, ...card.moves.map((m) => m.effect)].join('\n')
  const has = (re) => re.test(text)

  if (has(/Search your deck for[^.]{0,80}Pok[eé]mon/i)) t.add('poke-search')
  if (has(/Search your deck for[^.]{0,80}Energy/i)) t.add('energy-search')
  // A deck search only helps the *hand* if it actually puts cards there.
  // Ciphermaniac's Codebreaking searches 2 cards onto TOP OF DECK, and Brilliant
  // Blender searches 5 cards and DISCARDS them — neither improves this hand, so
  // requiring "into your hand" keeps both out while catching Cassiopeia,
  // Call Bell and Boxed Order, which the old "a card" pattern missed.
  if (has(/Search your deck/i) && has(/into your hand/i)) t.add('search-to-hand')
  if (has(/\bDraw \d+ card|\bDraw cards|draw cards until you have|\bDraw a card/i)) t.add('draw')
  if (has(/Attach[^.]{0,90}Energy[^.]{0,60}from your (deck|discard pile|hand)/i)) t.add('energy-accel')
  if (has(/from your discard pile[^.]{0,60}(into your hand|onto your Bench)/i)) t.add('recovery')
  if (has(/Switch your Active/i)) t.add('switch')
  if (has(/Shuffle your hand into your deck|shuffles their hand/i)) t.add('hand-refresh')

  return [...t].sort()
}

// ---------------------------------------------------------------------------

const raw = readFileSync(SRC_CSV)
const sourceSha256 = createHash('sha256').update(raw).digest('hex')
const rows = parseCsv(raw.toString('utf8'))
const header = rows[0].map((h) => h.trim())
const col = (name) => {
  const i = header.findIndex((h) => h.startsWith(name))
  if (i < 0) throw new Error(`Column not found: ${name}`)
  return i
}

const C = {
  id: col('Card ID'), name: col('Card Name'), set: col('Expansion'), numv: col('Collection No.'),
  kind: col('Stage'), rule: col('Rule'), category: col('Category'), prev: col('Previous stage'),
  hp: col('HP'), type: col('Type'), weak: col('Weakness'), resist: col('Resistance'),
  retreat: col('Retreat'), move: col('Move Name'), cost: col('Cost'), damage: col('Damage'),
  effect: col('Effect Explanation'),
}

/** @type {Map<number, object>} */
const byId = new Map()
let dataRows = 0

for (const r of rows.slice(1)) {
  if (r.length < header.length || clean(r[C.id]) === '') continue
  dataRows++
  const id = Number.parseInt(r[C.id], 10)

  let card = byId.get(id)
  if (!card) {
    card = {
      id,
      name: clean(r[C.name]),
      set: clean(r[C.set]),
      num: clean(r[C.numv]),
      kind: clean(r[C.kind]),
      rule: clean(r[C.rule]),
      category: clean(r[C.category]),
      prev: clean(r[C.prev]),
      hp: num(r[C.hp]),
      type: clean(r[C.type]),
      weak: clean(r[C.weak]),
      resist: clean(r[C.resist]),
      retreat: num(r[C.retreat]),
      effect: '',
      moves: [],
    }
    byId.set(id, card)
  }

  const moveName = clean(r[C.move])
  const effect = clean(r[C.effect]) // 'n/a' means "no effect text", not literal text
  if (moveName === '') {
    // Card-level effect (Trainer / Energy). Keep the first non-empty one.
    if (card.effect === '' && effect !== '') card.effect = effect
  } else {
    card.moves.push({
      name: moveName,
      cost: clean(r[C.cost]),
      damage: clean(r[C.damage]),
      effect,
    })
  }
}

// Curated tag overrides: { "<cardId>": { "add": [...], "remove": [...] } }
let overrides
try {
  overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8'))
} catch {
  overrides = {} // the override file is optional
}

const cards = [...byId.values()].sort((a, b) => a.id - b.id)
for (const card of cards) {
  const tags = new Set(deriveTags(card))
  const o = overrides[String(card.id)]
  if (o) {
    for (const tag of o.add ?? []) tags.add(tag)
    for (const tag of o.remove ?? []) tags.delete(tag)
  }
  card.tags = [...tags].sort()
}

// Basic Energy, for resolving decklist lines like `6 Grass Energy MEE 9` whose
// printing is absent from this dataset. Emitted as (id, type, colour) so the TS
// side can build its lookup with its own norm() — no duplicated normalisation.
const basicEnergy = cards
  .filter((c) => c.kind === 'Basic Energy')
  .map((c) => {
    const colour = ENERGY_COLOURS[c.type]
    if (!colour) throw new Error(`Unmapped basic energy type ${c.type} on card ${c.id}`)
    return { id: c.id, type: c.type, colour }
  })

if (basicEnergy.length !== 8) {
  throw new Error(`Expected 8 basic energies, found ${basicEnergy.length}`)
}

const out = {
  generatedFrom: 'data/EN_Card_Data.csv',
  sourceSha256,
  sourceRows: dataRows,
  cardCount: cards.length,
  basicEnergy,
  cards,
}

mkdirSync(dirname(OUT_JSON), { recursive: true })
writeFileSync(OUT_JSON, JSON.stringify(out) + '\n', 'utf8')

const tagCounts = {}
for (const c of cards) for (const t of c.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1

console.log(`build-card-db: ${dataRows} rows -> ${cards.length} unique cards`)
console.log(`  wrote ${OUT_JSON} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`)
console.log(`  source sha256 ${sourceSha256.slice(0, 12)}`)
console.log(
  '  tags: ' +
    Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t}=${n}`)
      .join(' '),
)
