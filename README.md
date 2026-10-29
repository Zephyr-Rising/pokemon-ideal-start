# Ideal Start

Two questions about a Pokémon TCG deck, from one pasted PTCG Live export:

- **Opening hand** — what is in your first 8 cards, computed **exactly**.
- **Turn 1 board** — what you can actually *build* by the end of your first turn, by dragging the
  board you want onto a playing field and letting the deck try to reach it.

Everything runs in the browser. No backend.

**The two tabs differ in kind, and the app never blurs them.** Opening-hand odds are a closed form:
exact, with no sampling error. The turn-1 playtest is a simulation — once a search card digs and
shuffles, the state space explodes — so it reports a 95% margin of error alongside every figure.

## What it tells you

- **Ideal-start probability** across your first 8 cards — the opening 7 plus your turn-1 draw.
  Both players draw on their first turn, so this figure is the same going first or second.
- **Opening 7 on its own**, and your **mulligan rate**.
- **Each requirement and each route in isolation**, so you can see what is actually failing.
- **A real example hand** — one that hits your condition, or one that misses it, drawn at random
  from the hands that actually do so, with the card images and a breakdown of what it is missing.
- **What each copy is worth**: the change in the headline figure from running one more or one fewer
  copy of every card, ranked by impact. Adjust counts in place with the ± controls on the deck list.
- **Prize-zone risk**: the chance every copy of a card is among the six prizes, where nothing can
  search it out.

#### Turn 1 board

Drag cards from your deck onto an Active spot, a bench, a Stadium slot and a "still in hand" zone,
set how much Energy each Pokémon should be carrying, and the simulator plays out thousands of games
trying to build it. Every drop target is also reachable by tapping and by keyboard, so the board
works on a phone.

For each hand it **searches the possible lines of play** rather than following one fixed policy —
choosing which Basic takes the Active Spot, what to bench, where to attach, when to retreat — so it
answers whether a hand *can* reach the board, not whether one particular agent found it. The move
ordering comes from the competition agent's scoring tiers (`src/lib/sim/priorities.ts`), so the
sensible line is explored first without being the only one.

You get the strict probability, an average *closeness* score, and a per-part breakdown naming which
piece of the board is actually costing you.

Two honest caveats the UI states plainly:

- The search knows which cards are prized when it picks the opening placement; a real player does
  not. Mid-turn this is realistic — a whiffed search is how you find out — so the figure is a mild
  upper bound.
- When the node budget stops a search early, that can only *miss* a way through, never invent one,
  so the reported figure is a floor.

### Routes (OR)

A condition is a set of **routes**. Within a route every row must hold; **any one route is enough**.
That matters because decks reach the same start by different paths — a hand with Cyrano is as good
as one holding the Meowth ex that fetches it, or the Ultra Ball that fetches the Meowth ex. Put
interchangeable cards in one row, and genuinely different plans in separate routes.

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
| Exhaustive subset enumeration | Overlapping groups and routes, `atMost` and `exactly`, to 12 dp |
| Monte Carlo simulation | A real 60-card deck, simulating the literal shuffle-draw-mulligan loop |

The example hand is drawn by rejection sampling over that same procedure, so it is a uniform sample
from the distribution the headline describes — an example of the real thing, not an illustration.
A test pins this: among sampled hands meeting "at least 1 X", the share also holding two must equal
`P(>=2) / P(>=1)` from the exact maths.

The DP also recomputes the legal-hand rate two different ways, both asserted against the closed form
`1 − C(60−B,7)/C(60,7)`.

## Card data

Cards come from [TCGdex](https://tcgdex.dev), scoped to what is **currently Standard legal**, plus
card images. The pipeline is two deliberate steps:

```
npm run fetch:cards   # network: TCGdex -> data/tcgdex-cards.json  (committed)
npm run build:cards   # offline:  that + the CSV -> src/data/cards.json
```

Only `fetch:cards` touches the network, and it is never part of a build. Pre-flight regenerates
`cards.json` and fails if the committed copy doesn't match byte-for-byte, so the shipped data is
always reproducible from its sources. Responses are cached under `.cache/` (gitignored), so a
re-run is near-instant; pass `--refresh` to bypass it.

`data/EN_Card_Data.csv` is kept for the Kaggle simulator's Card IDs, which the next phase needs, and
as a fallback for rules TCGdex does not model.

Details worth knowing:

- **Standard legality is decided per card, not per set.** Stellar Crown carries a mix of G- and
  H-marked cards, so a set-level decision would be wrong. `data/standard-overrides.json` corrects
  the API where its legality data lags.
- **Identity ignores effect-text formatting.** TCGdex prints the same Trainer with no separator, a
  newline, or a blank line between its sentences across reprints; keying on that split Ultra Ball
  into three cards, which would have silently miscounted any deck running two printings.
- **Two sets can share an abbreviation** (both 30th sets report `30C`), so a printing key may map to
  several cards and the resolver picks the one whose name matches the decklist.
- **A set/number never overrides a disagreeing name.** A number locates a printing; the name
  identifies the card. Mismatches are reported, not silently applied.
- **Cards outside the pool still count** toward the deck and toward every probability. They carry no
  details, and the UI says whether a card is simply unknown or merely not Standard legal.
- **Basic Energy has no artwork in any Standard-legal set** — all 32 printings 404 — so the fetch
  step borrows the image from the most recent Scarlet & Violet printing of the same Energy. It is
  the same card face, and showing the real card beats drawing a substitute.

Role tags (`basic`, `attacker`, `poke-search`, `draw`, …) are derived offline by the generator from
card kind plus effect text. Heuristics are imperfect, so `src/data/curated-tags.json` can add or
remove tags per card, keyed on the card's normalised name so curation survives a data refresh.
Curation always wins over inference.

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
| `fetch:cards` | Refresh the TCGdex cache (the only networked script) |
| `build:cards` | Regenerate the card database from the cached sources |
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

## The turn-1 simulator

`src/lib/sim/` models the turn exactly: one Energy, one Supporter, one Stadium and one retreat;
retreat paid by discarding Energy; the bench capped at five, or eight only with Area Zero
Underdepths **and** a Tera Pokémon in play. Nothing evolves, because everything in play arrived this
turn — so Rare Candy and every evolution card are correctly dead.

Within a single deal the search is **deterministic**: searching your own deck is a choice, not a
roll. The only randomness is the shuffle, and shuffle-and-draw effects (Lillie's Determination,
Judge) seed themselves from the trial plus the state they happen in, so a branch always resolves the
same way and backtracking stays sound.

`effects.ts` implements the ~20 cards that can change your own board on turn 1. **An unimplemented
card is inert, never a guess** — effect text is far too irregular to derive behaviour from, and a
silent misread would corrupt the numbers rather than merely omit a card. The result names every card
it ignored. Cards that genuinely cannot matter on turn 1 are deliberately absent: Unfair Stamp needs
one of your Pokémon to have been Knocked Out, Special Red Card needs the opponent down to three
Prizes, and Boss's Orders only moves theirs.

Plays that cannot bring the board closer to your goal are never generated at all. That pruning made
the search both faster and *more accurate*, because results now converge at a far smaller node
budget.

Tera comes from the Kaggle CSV's `Category` column — TCGdex has no Tera marker at all, the word
appears only in free text — so a Tera Pokémon too new for that CSV is treated as non-Tera, which can
understate the bench cap rather than overstate it.

## Roadmap

The groundwork for going further is here: the card
compute layer is pure and serializable.
