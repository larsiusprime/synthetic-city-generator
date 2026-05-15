# Hjemby

A synthetic city generator with a deep, simulated history.

The name is Norwegian (*hjem* "home" + *by* "city/town"). It also reads like
"YIMBY," which is the right vibe.

## What Hjemby is for

Hjemby produces fully synthetic but GIS-realistic city datasets — parcel
cadastres, building inventories, sales history, rental rolls — by simulating
a small region's development across ~100 years of annual ticks.
Outputs are intended for:

- Stress-testing mass-appraisal pipelines on data with real spatial and
  temporal structure.
- GIS visualization demos and teaching material.
- Economic-simulation research where reproducible, knowable-ground-truth
  data is more useful than messy real-world records.

The inspiration is Dwarf Fortress's worldgen: the present state of the city
is an artifact of its history, not a static layout. Sale prices, age
distributions, redevelopment patterns, and neighborhood character all emerge
from simulated decisions made by simulated actors over simulated decades.

---

## Prime directive: Gall's Law

> *"A complex system that works is invariably found to have evolved from
> a simple system that worked. A complex system designed from scratch never
> works and cannot be patched up to make it work."* — John Gall

**We build the smallest viable thing, get one thing working, then evolve.**
Every stage must run end-to-end. We do not build a half-finished version of
the eventual architecture; we build a complete version of a simpler system,
then complicate it.

When in doubt: cut scope, not corners.

---

## Stage 1 — the only thing we are building right now

**Render a procedurally-generated terrain heightmap on a MapLibre map at a
user-chosen real-world lat/lon anchor, exported as GeoJSON.**

That's it. No city yet. No parcels, no streets, no agents, no time.

This stage forces us to commit to and validate:

- Vite + TypeScript project setup
- MapLibre-GL integration
- The Web Worker boundary for the sim
- The `SharedArrayBuffer` / typed-array data path from sim → render
- A custom WebGL MapLibre layer reading directly from a shared buffer
- The local-UTM ↔ WGS84 projection (proj4js)
- Seeded deterministic PRNG with named substreams
- GeoJSON export of a generated artifact (here: terrain contours or a
  water polygon)
- The headless-core / browser-frontend split (see below)

Done = open the app, choose lat/lon + seed, click Generate, see hillshaded
terrain on the map at the correct geographic location, export it.

Everything below this section describes the eventual system. **Do not
implement any of it during Stage 1.** Stage 2+ are TBD; they emerge from
what we learn building Stage 1.

---

## Architecture (eventual)

### Headless core, swappable frontends

The simulation core is a pure TypeScript library with **zero DOM, zero
MapLibre, zero browser-only API dependencies**. It can run in:

- a **Web Worker** driven by the studio UI (primary frontend)
- a **Node CLI** that takes a config file and writes export bundles
- a **bid-rent lab page** — a separate static HTML page in this repo that
  imports the bid-rent submodule directly with its own minimal harness

This is non-negotiable. Any time a piece of "sim" code reaches for `window`,
`document`, `fetch`, or a MapLibre type, it belongs in a frontend, not the
core.

### Single package layout

```
hjemby/
├── AGENTS.md                 # this file
├── LICENSE                   # MIT
├── README.md
├── index.html                # studio UI entry
├── lab/
│   └── bid-rent.html         # standalone playground for the bid-rent engine
├── bin/
│   └── hjemby.ts             # CLI entry (Node)
├── src/
│   ├── core/                 # headless sim — no DOM, no MapLibre
│   │   ├── prng/             # seeded PRNG + named substreams
│   │   ├── geo/              # CRS, projections, geometry primitives
│   │   ├── terrain/          # heightmap, water, amenity layers
│   │   ├── survey/           # ghost grid, blocks, parcels, streets
│   │   ├── time/             # tick loop, event log, snapshot store
│   │   ├── macro/            # economic cycles + exogenous shocks
│   │   ├── agents/           # households, developers, owners, municipality
│   │   ├── bid-rent/         # *** isolated, prototyped in the lab first ***
│   │   ├── develop/          # subdivide, build, demolish, remodel
│   │   ├── market/           # sales + rental clearing
│   │   └── io/               # serializers (GeoJSON, GPKG, GeoParquet, CSV)
│   ├── worker/               # Web Worker glue around core
│   ├── render/               # MapLibre custom layer(s), shaders
│   ├── ui/                   # studio UI: panels, observable, native HTML
│   └── lab/                  # bid-rent lab harness
├── public/                   # static assets (icons, no basemap tiles)
└── package.json
```

`bin/hjemby.ts` and `src/worker/` are both thin adapters around `src/core/`.

### Tech stack (locked in for Stage 1+)

- **Language**: TypeScript, strict mode
- **Build**: Vite
- **UI**: Vanilla TS + native HTML. No framework. Tiny custom observable
  (~30 lines) for cross-panel reactive state. Each panel is a plain TS
  module owning its DOM subtree. CSS organized by panel in plain `.css`
  files; discipline over scoping magic.
- **Map**: MapLibre-GL, with a custom WebGL layer for live sim data.
  PMTiles + vector tiles for historical snapshots (eventually).
- **Concurrency**: Web Worker for the sim. `SharedArrayBuffer` for zero-copy
  state sharing with the render layer. Requires COOP/COEP headers; we'll
  use a service-worker fallback for static hosting (GitHub Pages).
- **State**: Struct-of-arrays columnar typed arrays for all entity tables.
  Cache-friendly, zero-copy to Arrow on export, indexable.
- **Spatial index**: the ghost grid itself for coarse queries; `rbush`
  R-tree for fine queries when needed.
- **PRNG**: `sfc32`, seedable, with named substreams per module so
  re-rolling one module doesn't disturb the others.
- **CRS**: `proj4js`. Internal sim math in local UTM meters (zone derived
  from anchor). Display in Web Mercator (MapLibre handles it). Export in
  EPSG:4326 by default, with UTM available.
- **Exports**: GeoJSON (always available, no extra weight); GeoPackage via
  `wa-sqlite` (lazy-loaded); GeoParquet via `parquet-wasm` + `apache-arrow`
  (lazy-loaded); CSV for tabular data.
- **Persistence**: IndexedDB for saved runs; single-file downloadable bundle
  for portability.
- **No network requests at runtime.** Everything ships with the app.

### Conventions

- **Units**: meters and square meters internally. Display can convert to
  feet/sqft per user preference. Years are integers; intra-year timing
  uses a `[0, 1)` float when needed.
- **IDs**: stable numeric IDs (uint32) for entities. No UUIDs.
- **Determinism**: every run is reproducible from `(seed, config)`. Any code
  path that uses randomness pulls from a named substream
  (`prng.terrain.float()`, `prng.market.int(0, n)`, etc.).
- **Time**: the sim has a single canonical "current year." Annual ticks.
  All events are timestamped with year + intra-year fraction.
- **Coordinates**: never mix CRSes implicitly. Functions that take/return
  geometry declare their CRS in the name or signature.
- **No `any`.** No `// @ts-ignore` without an explanation comment.
- **No comments unless the *why* is non-obvious.** Names carry the *what*.

### The bid-rent engine

Flagged as the most important sub-module to get right. Prices that "mean
something" depend on it.

- Lives in `src/core/bid-rent/`. Pure functions. No I/O, no DOM, no time.
- Prototyped first in `lab/bid-rent.html` against synthetic toy scenarios
  — small populations of typed agents bidding on a handful of parcels —
  until its emergent behavior is signed off.
- Only then integrated into the main sim loop in `src/core/market/`.
- Agents are "light": small structs with utility weights, budget, BATNA,
  life-stage timer. Spawned and retired as needed; not a persistent
  population (at least not initially).

### What we are explicitly not building

- A real-time-rendered 3D view. 2D top-down only.
- A user-editable city (intervene-and-watch). Hjemby is a *generator*, not
  a city-builder game. The user configures and seeds; the simulation runs.
- An ML/heuristic-trained model of any kind. Everything is hand-modeled.
- A street-grid-only mode for fast prototyping. The ghost grid is core to
  the design from Stage 2 onward.
- Anything multiplayer, account-based, or cloud-synced.

---

## Working agreements for agents (human and AI)

- Read this file before proposing structural changes.
- If you find yourself designing something that does not serve the current
  stage, stop and write down what stage it belongs to instead.
- Prefer deleting code over generalizing it. We will generalize later, with
  more information.
- When a module's responsibility is unclear, look at the directory layout
  above. If your code does not fit any of those directories, raise it —
  don't invent a new top-level directory casually.
- The bid-rent engine is special. Changes to it go through the lab page
  first.
- The headless-core / frontend split is a hard wall. No DOM imports in
  `src/core/`. Ever.
