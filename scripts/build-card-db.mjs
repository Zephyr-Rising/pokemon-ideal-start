#!/usr/bin/env node
// Offline generator: data/tcgdex-cards.json + data/EN_Card_Data.csv -> src/data/cards.json
//
// Card-derived logic is baked here, at build time, and never inferred at runtime.
// This script touches no network: `npm run fetch:cards` refreshes the TCGdex
// cache deliberately, and this build is a pure function of the two committed
// data files, so pre-flight can assert it reproduces byte-for-byte.
//
// TCGdex is the primary source: it covers the current Standard pool, carries the
// printings decklists actually cite, and supplies card images. The Kaggle CSV is
// kept for its Card IDs, which the simulator phase needs - and as a fallback for
// rules TCGdex does not model (ACE SPEC shows only in rarity; Mega Pokemon ex is
// not distinguished from plain ex at all).

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_CSV = resolve(ROOT, 'data/EN_Card_Data.csv')
const SRC_TCGDEX = resolve(ROOT, 'data/tcgdex-cards.json')
const OUT_JSON = resolve(ROOT, 'src/data/cards.json')
const OVERRIDES = resolve(ROOT, 'src/data/curated-tags.json')

/** Mirrors src/lib/normalize.ts - keep the two in step. */
function norm(s) {
  return (s ?? '')
    .replace(/['‘’ʼ]/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Minimal RFC-4180 CSV parser. Effect text contains both commas and newlines
 *  inside quoted fields, so a line-splitting parser would corrupt the data. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')

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

const clean = (v) => {
  const s = (v ?? '').trim()
  return s === 'n/a' ? '' : s
}

const ENERGY_SYMBOL = {
  Grass: '{G}', Fire: '{R}', Water: '{W}', Lightning: '{L}',
  Psychic: '{P}', Fighting: '{F}', Darkness: '{D}', Metal: '{M}',
  Colorless: '{C}', Dragon: '{N}', Fairy: '{Y}',
}
const BASIC_COLOURS = [
  'Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal',
]
const BASIC_ENERGY_NAMES = new Set(BASIC_COLOURS.map((c) => norm(c + ' Energy')))
/** norm('Grass Energy') -> '{G}'. TCGdex only populates `types` on Pokemon, so a
 *  basic Energy card carries no type at all; its colour comes from its name. */
const BASIC_ENERGY_SYMBOL = new Map(
  BASIC_COLOURS.map((c) => [norm(c + ' Energy'), ENERGY_SYMBOL[c]]),
)

/** TCGdex shape -> the `kind` vocabulary the app already speaks. */
function kindOf(card) {
  if (card.category === 'Pokemon') {
    if (card.stage === 'Basic') return 'Basic Pokémon'
    if (card.stage === 'Stage1') return 'Stage 1 Pokémon'
    if (card.stage === 'Stage2') return 'Stage 2 Pokémon'
    return 'Pokémon'
  }
  if (card.category === 'Trainer') {
    if (card.trainerType === 'Tool') return 'Pokémon Tool'
    return card.trainerType || 'Item'
  }
  if (card.category === 'Energy') {
    // TCGdex reports energyType 'Normal' even for cards that are plainly Special
    // (Telepathic Psychic Energy, for one), so classify on the name instead:
    // the eight basic Energy cards are exactly the eight colours.
    return BASIC_ENERGY_NAMES.has(norm(card.name)) ? 'Basic Energy' : 'Special Energy'
  }
  return card.category || 'Other'
}

function ruleOf(card) {
  if (card.rarity === 'ACE SPEC Rare') return 'ACE SPEC'
  const suffix = (card.suffix || '').toLowerCase()
  if (suffix === 'ex') {
    // TCGdex does not distinguish Mega Pokemon ex from ex; the name does.
    return /^mega\s/i.test(card.name) ? 'Mega Pokémon ex' : 'Pokémon ex'
  }
  if (suffix) return 'Pokémon ' + card.suffix
  return ''
}

/** Abilities and attacks, in the single `moves` shape the tag rules read. */
function movesOf(card) {
  const moves = []
  for (const ability of card.abilities ?? []) {
    moves.push({
      name: '[' + (ability.type || 'Ability') + '] ' + ability.name,
      cost: '',
      damage: '',
      effect: ability.effect ?? '',
    })
  }
  for (const attack of card.attacks ?? []) {
    moves.push({
      name: attack.name,
      cost: (attack.cost ?? []).map((c) => ENERGY_SYMBOL[c] ?? '{' + c + '}').join(''),
      damage: attack.damage === null || attack.damage === undefined ? '' : String(attack.damage),
      effect: attack.effect ?? '',
    })
  }
  return moves
}

/** Role tags, from kind/rule plus effect-text heuristics. Imperfect by nature,
 *  so curated-tags.json can add or remove tags per card NAME - keyed on name
 *  rather than an index so curation survives a data refresh. */
function deriveTags(card) {
  const t = new Set()
  const { kind, rule } = card
  const isPokemon = kind.includes('Pokémon') && !kind.includes('Tool')

  if (isPokemon) {
    t.add('pokemon')
    if (kind === 'Basic Pokémon') t.add('basic')
    if (kind === 'Stage 1 Pokémon') t.add('stage1')
    if (kind === 'Stage 2 Pokémon') t.add('stage2')
    if (card.moves.some((m) => !m.name.startsWith('['))) t.add('attacker')
    if (card.moves.some((m) => m.name.startsWith('['))) t.add('ability')
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

  const text = [card.effect, ...card.moves.map((m) => m.effect)].join('\n')
  const has = (re) => re.test(text)

  if (has(/Search your deck for[^.]{0,80}Pok[eé]mon/i)) t.add('poke-search')
  if (has(/Search your deck for[^.]{0,80}Energy/i)) t.add('energy-search')
  // A deck search only helps the *hand* if it actually puts cards there.
  // Ciphermaniac's Codebreaking searches 2 cards onto TOP OF DECK and Brilliant
  // Blender searches 5 and DISCARDS them - neither improves this hand.
  if (has(/Search your deck/i) && has(/into your hand/i)) t.add('search-to-hand')
  if (has(/\bDraw \d+ card|\bDraw cards|draw cards until you have|\bDraw a card/i)) t.add('draw')
  if (has(/Attach[^.]{0,90}Energy[^.]{0,60}from your (deck|discard pile|hand)/i)) t.add('energy-accel')
  if (has(/from your discard pile[^.]{0,60}(into your hand|onto your Bench)/i)) t.add('recovery')
  if (has(/Switch your Active/i)) t.add('switch')
  if (has(/Shuffle your hand into your deck|shuffles their hand/i)) t.add('hand-refresh')

  return [...t].sort()
}

// ---------------------------------------------------------------------------

const csvRaw = readFileSync(SRC_CSV)
const tcgdexRaw = readFileSync(SRC_TCGDEX)
const tcgdex = JSON.parse(tcgdexRaw.toString('utf8'))

// Kaggle Card IDs, keyed by name, for the simulator phase.
const csvRows = parseCsv(csvRaw.toString('utf8'))
const csvHeader = csvRows[0].map((h) => h.trim())
const col = (name) => {
  const i = csvHeader.findIndex((h) => h.startsWith(name))
  if (i < 0) throw new Error('Column not found: ' + name)
  return i
}
const C = { id: col('Card ID'), name: col('Card Name'), rule: col('Rule') }

const kaggleByName = new Map()
for (const row of csvRows.slice(1)) {
  if (row.length < csvHeader.length || clean(row[C.id]) === '') continue
  const key = norm(row[C.name])
  if (!kaggleByName.has(key)) {
    kaggleByName.set(key, { id: Number.parseInt(row[C.id], 10), rule: clean(row[C.rule]) })
  }
}

const cards = tcgdex.cards.map((source) => {
  const card = {
    name: source.name,
    kind: kindOf(source),
    rule: ruleOf(source),
    prev: source.evolveFrom ?? '',
    hp: source.hp ?? null,
    type:
      BASIC_ENERGY_SYMBOL.get(norm(source.name)) ??
      (source.types ?? []).map((t) => ENERGY_SYMBOL[t] ?? '{' + t + '}').join(''),
    retreat: source.retreat ?? null,
    regulationMark: source.regulationMark ?? '',
    effect: source.effect ?? '',
    moves: movesOf(source),
    image: source.image ?? '',
  }
  const kaggle = kaggleByName.get(norm(card.name))
  if (kaggle) {
    card.kaggleId = kaggle.id
    // The CSV models rules TCGdex omits; trust it when TCGdex found nothing.
    if (card.rule === '' && kaggle.rule !== '') card.rule = kaggle.rule
  }
  return card
})

let overrides
try {
  overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8'))
} catch {
  overrides = {} // the override file is optional
}

for (const card of cards) {
  const tags = new Set(deriveTags(card))
  const o = overrides[norm(card.name)]
  if (o) {
    for (const tag of o.add ?? []) tags.add(tag)
    for (const tag of o.remove ?? []) tags.delete(tag)
  }
  card.tags = [...tags].sort()
}

// Printings index. Two sets can share an abbreviation (both 30th sets report
// "30C"), so one key may map to several cards; the resolver picks the candidate
// whose name matches the decklist.
const printings = tcgdex.printings.map((p) => ({
  set: p.set,
  num: String(p.localId).replace(/^0+(?=\d)/, ''),
  card: p.card,
}))

const basicEnergy = cards
  .map((card, index) => ({ card, index }))
  .filter((entry) => entry.card.kind === 'Basic Energy')
  .map((entry) => ({
    index: entry.index,
    type: entry.card.type,
    colour: entry.card.name.replace(/ Energy$/, ''),
  }))

if (basicEnergy.length !== 8) {
  throw new Error('Expected 8 basic Energy cards, found ' + basicEnergy.length)
}

const out = {
  generatedFrom: ['data/tcgdex-cards.json', 'data/EN_Card_Data.csv'],
  sourceSha256: {
    tcgdex: createHash('sha256').update(tcgdexRaw).digest('hex'),
    csv: createHash('sha256').update(csvRaw).digest('hex'),
  },
  cardCount: cards.length,
  printingCount: printings.length,
  cards,
  printings,
  basicEnergy,
  // Names excluded for not being Standard legal, so the UI can explain WHY a
  // decklist card is unrecognised instead of just calling it unknown.
  nonStandardNames: tcgdex.nonStandardNames ?? [],
}

mkdirSync(dirname(OUT_JSON), { recursive: true })
const json = JSON.stringify(out) + '\n'
writeFileSync(OUT_JSON, json, 'utf8')

const tagCounts = {}
for (const c of cards) for (const t of c.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1

console.log('build-card-db: ' + cards.length + ' Standard-legal cards, ' + printings.length + ' printings')
console.log('  ' + cards.filter((c) => c.kaggleId !== undefined).length + ' matched to a Kaggle Card ID')
console.log('  ' + cards.filter((c) => c.image).length + ' with images')
console.log('  wrote ' + OUT_JSON + ' (' + (json.length / 1024).toFixed(0) + ' KB)')
console.log(
  '  tags: ' +
    Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0] + '=' + e[1])
      .join(' '),
)
