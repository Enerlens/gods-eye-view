# Barrages

Bundled dam pack behind the `local-dams` layer. **6 189 features**, rebuilt
2026-09-01 with `npm run dams:pack`
([scripts/build-osm-dams.mjs](../../../../scripts/build-osm-dams.mjs)).

Two halves, one shape:

| Half | Features | Source | Geometry |
|---|---|---|---|
| France — métropole + outre-mer | 5 529 | OpenStreetMap, extracted directly via the Overpass API on 2026-09-01 | dam structures |
| Rest of the world | 660 | the older Open Infrastructure Map / PostGIS snapshot the pack shipped before | power-station outlines carrying a dam tag |

The French half is why this file exists. The pack used to be 704 features for
the entire planet, and **44** of them were in France — so in a France fork
"Barrages" was a row you switched on to watch nothing happen. France is now
extracted completely; the world half is carried over feature for feature rather
than re-extracted, because `waterway=dam` worldwide is tens of megabytes of
committed geometry for a fork whose subject is France. The taxonomy says so:
`coverage: 'fr'`.

## Selection

`waterway=dam`, `man_made=dam` or `building=dam`, anywhere inside
`ISO3166-1=FR` — which in Overpass is the whole French Republic, so Réunion,
Guyane, the Antilles, Mayotte, Nouvelle-Calédonie and Polynésie are in. The
query is the whole selection policy and it lives in
[`src/data/damsPack.js`](../../damsPack.js) beside the code that reads the
result back.

This is OpenStreetMap's idea of a dam — a volunteer's judgement about a
structure, not a national register. France's own ROE register lists ~100 000
obstacles à l'écoulement and is an order of magnitude larger.

## Shape of what ships

| | |
|---|---|
| Grand barrage | 1 060 (≥ 15 m high, or hydroelectric, or named and ≥ 300 m long) |
| Barrage nommé | 550 |
| Seuil & petit ouvrage | 4 579 |
| Named | 1 439 (23%) |
| Hydroelectric | 972 (16%) |
| With a height | 148 (2%) |
| With a measured span | 4 254 (69%) |
| Footprint polygons / points | 1 792 / 4 393 |

Geometry, and why most dams ship as a point: nodes and closed ways keep what
OSM has (Point, Polygon); an **open** way ships as a Point at the middle of its
crest, because the layer draws its stem, marker and card off one position per
feature and that stem would overwrite the LineString's own polyline — a crest
line would render as a blue thread with no name and no card.

## Properties

An allowlist, and that is also the privacy transform: `contact:*`,
`operator:phone`, `note`, `description` and every other free-text field a mapper
may have pasted an address into never reach the file.

`name` · `osm` (`w123456`) · `operator` · `river` (world half only — OSM does
not tag the watercourse on the dam itself) · `heightM` · `spanM` (longest
straight-line dimension of the mapped structure, ≥ 25 m) · `material` (family,
not the raw free-text value) · `builtYear` · `outputMw` · `hydro` · `abandoned`.

Nothing is emitted empty: an absent field is absent, so the card omits a line
rather than printing a placeholder.

## Rebuilding

```sh
npm run dams:pack                       # queries Overpass (~90 s)
node scripts/build-osm-dams.mjs raw.json  # replays a saved Overpass answer
```

Idempotent and deterministic: the world half is read back out of the file the
script writes, features are emitted in code-point order of their OSM id, and
coordinates are rounded to 6 decimals — two runs over the same Overpass answer
produce the same bytes on any machine.

`dams.geojson` is the human-readable twin of the runtime `dams.geojsonl`; both
carry the same features.

## Licence

Open Database License (**ODbL 1.0**). Keep the OpenStreetMap contributor
attribution — and the Open Infrastructure Map credit for the world half — when
redistributing this derived database. See `DATA_SOURCES.md`.
