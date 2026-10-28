# Ideal Start

Exact opening-hand odds for a Pokémon TCG deck. Paste a PTCG Live export, describe what your ideal
start looks like, and see how often the deck actually delivers it — plus what every card count is
worth and what the prize zone costs you.

Everything is computed in the browser, exactly. No backend, no simulation, no sampling error.

## What it tells you

- **Ideal-start probability** across your first 8 cards — the opening 7 plus your turn-1 draw.
  Both players draw on their first turn, so this figure is the same going first or second.
- **Opening 7 on its own**, and your **mulligan rate**.
- **Each requirement in isolation**, so you can see which one is actually failing.
- **What each copy is worth**: the change in the headline figure from running one more or one fewer
  copy of every card, ranked by impact.
- **Prize-zone risk**: the chance every copy of a card is among the six prizes, where nothing can
  search it out.

Probabilities are **conditioned on a hand you keep**. Hands with no Basic Pokémon get reshuffled at
the table, so they are excluded rather than counted as failures.

## How it's computed

Each requirement row is a predicate over the deck, plus an implicit "is a Basic Pokémon" predicate
for mulligan legality. Every card gets a bitmask of the predicates it satisfies, and cards sharing a
mask collapse into one bucket. Because the buckets are disjoint, overlapping requirement groups come
out exact with no inclusion–exclusion by hand. A dynamic program then walks the buckets to build the
exact multivariate hypergeometric distribution over saturated predicate counts.

Drawing 7 and then 1 is equivalent to drawing an 8-card set and designating one of its 8 cards as
the drawn one. Legality depends only on the *other* seven, so it reduces to a weight on the 8-set's
Basic count: 0 Basics is never legal, 1 Basic is legal unless that Basic was the designated card
(7/8), and 2 or more is always legal. That makes the headline a single DP run.

Correctness is pinned by three independent oracles in `tests/`, none sharing code with the engine:

| Oracle | What it checks |
| --- | --- |
| Closed-form hypergeometric | Single-group cases, to 12 decimal places |
| Exhaustive subset enumeration | Overlapping groups, `atMost` and `exactly`, to 12 decimal places |
| Monte Carlo simulation | A real 60-card deck, simulating the literal shuffle-draw-mulligan loop |

The DP also recomputes the legal-hand rate two different ways, both asserted against the closed form
`1 − C(60−B,7)/C(60,7)`.

## Card data

`src/data/cards.json` is generated from `data/EN_Card_Data.csv` by `scripts/build-card-db.mjs` and
committed. Pre-flight regenerates it and fails if the committed copy doesn't match byte-for-byte, so
the data asset is always reproducible from its source.

Two details worth knowing:

- The CSV holds **one row per attack/ability**, not per card — 2,022 rows collapse to 1,267 unique
  cards. The generator groups by Card ID and collects moves into an array.
- Cards outside this pool (newer sets than the data) **still count toward the deck** and toward every
  probability. They just carry no metadata, and the UI says so. The one thing they cannot do is be
  recognised as Basic Pokémon, which would understate the mulligan rate — hence the warning.

Role tags (`basic`, `attacker`, `poke-search`, `draw`, …) are derived offline by the generator from
card kind plus effect text. Heuristics are imperfect, so `src/data/curated-tags.json` can add or
remove tags per card and `src/data/curated-aliases.json` maps decklist name variants onto the right
card. Curation always wins over inference.

## Development

```bash
npm install
npm run dev          # local dev server
npm run preflight    # the full gate: typecheck, lint, tests, build, browser smoke
npm run preflight -- --fast   # skips the build and browser stages
```

`npm run preflight` is exactly what CI runs before deploying, so a green local run and a green
deploy mean the same thing.

| Script | Purpose |
| --- | --- |
| `dev` | Vite dev server |
| `build:pages` | Production build on the GitHub Pages subpath |
| `preview:pages` | Serve that build on the same subpath |
| `build:cards` | Regenerate the card database from the CSV |
| `test` / `test:watch` | Unit tests |
| `e2e` | Browser smoke test against the production build |

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via `.github/workflows/deploy.yml`, but only
if the full pre-flight passes.

Two things to set up once:

1. **Settings → Pages → Source = GitHub Actions.** The workflow cannot set this itself.
2. If you rename the repository, update `PAGES_BASE` in **`pages.config.ts`** — it is the single
   source of truth for the subpath, read by the build, the preview server and the smoke test. A
   project page is served from `https://<user>.github.io/<repo>/`, so a mismatch breaks every asset
   URL. The browser smoke test runs against that exact subpath specifically to catch this.

## Roadmap

This answers "what's in my hand". The next phase is a **turn-1 playtest**: simulating actually
*playing* the first turn — resolving Ultra Ball, Poffin and draw Supporters — and scoring the board
states that are reachable, rather than only the cards drawn. The groundwork is already here: the card
database ships effect text and moves, the deck model carries the simulator's card IDs, and the
compute layer is pure and serializable.
