# Hjemby

A synthetic city generator with a deep, simulated history. Browser-first,
GIS-realistic, deterministic.

> **Stage 1 only.** Right now Hjemby generates and renders procedural terrain
> — a heightmap anchored to a real lat/lon, with a sinuous river, asymmetric
> bluffs, and standard hillshade. No city, no parcels, no agents, no time yet.
> See [AGENTS.md](AGENTS.md) for what comes later and why we're not building
> it now.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Pick a city (or type `lat,lon`), set a seed, click **Generate**. The terrain
takes ~1s to compute and renders as a hillshaded layer over MapLibre.

Click **Export** to download a `.zip` bundle:

| File              | Format               | CRS              |
|-------------------|----------------------|------------------|
| `extent.geojson`  | FeatureCollection    | EPSG:4326        |
| `water.geojson`   | FeatureCollection    | EPSG:4326        |
| `contours.geojson`| FeatureCollection    | EPSG:4326        |
| `dem.tif`         | GeoTIFF (float32)    | local UTM zone   |
| `README.txt`      | text                 | -                |

Drop the .zip into QGIS or ArcGIS to verify the artifacts.

## Scripts

```bash
npm run dev          # dev server with COOP/COEP headers for SharedArrayBuffer
npm run build        # type-check + production build
npm run preview      # serve the production build
npm test             # vitest run
npm run typecheck    # tsc --noEmit
```

## What's in here

```
src/
  core/              # headless sim — no DOM, no MapLibre
    prng/            # sfc32 with named substreams
    geo/             # UTM zone calc + proj4 wrappers
    terrain/         # Midwestern river-city heightmap algorithm
      vectorize.ts   # marching squares → contours, water polygons
    io/              # GeoJSON + GeoTIFF exporters
  worker/            # sim Web Worker + main-thread client
  render/            # MapLibre custom WebGL layer (hillshade + hypsometric)
  ui/                # vanilla TS sidebar, cities datalist, export workflow
  main.ts            # bootstrap
```

The hard rule from [AGENTS.md](AGENTS.md): `src/core/` is browser-free. Any
DOM, MapLibre, or `window` reference belongs in a frontend (`render/`, `ui/`,
`worker/`).

## Determinism

Every run is reproducible from `(seed, anchor, config)`. The PRNG is sfc32
with named substreams: `terrain.macro`, `terrain.texture`, `terrain.river`,
`terrain.bluff`. Re-rolling one substream's name (e.g., to change the river
without disturbing the underlying topography) is possible without touching
others.

## License

MIT — see [LICENSE](LICENSE).
