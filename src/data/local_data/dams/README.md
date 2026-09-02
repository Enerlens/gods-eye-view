# Barrages

Bundled dam pack behind the `local-dams` layer. **7 432 features**, rebuilt
2026-09-01 with `npm run dams:pack`
([scripts/build-osm-dams.mjs](../../../../scripts/build-osm-dams.mjs)).

Two halves, one shape:

| Half | Features | Source | Geometry |
|---|---|---|---|
| France — métropole + outre-mer | 6 771 | OpenStreetMap, extracted directly via the Overpass API on 2026-09-01 | dam AND dyke structures |
| Rest of the world | 661 | the older Open Infrastructure Map / PostGIS snapshot the pack shipped before | power-station outlines carrying a dam tag |

The French half is why this file exists. The pack used to be 704 features for
the entire planet, and **44** of them were in France — so in a France fork
"Barrages" was a row you switched on to watch nothing happen. France is now
extracted completely; the world half is carried over feature for feature rather
than re-extracted, because `waterway=dam` worldwide is tens of megabytes of
committed geometry for a fork whose subject is France. The taxonomy says so:
`coverage: 'fr'`.

## Selection

`waterway=dam`, `man_made=dam`, `building=dam`, `man_made=dyke` or
`embankment=dyke`, anywhere inside `ISO3166-1=FR` — which in Overpass is the
whole French Republic, so Réunion, Guyane, the Antilles, Mayotte,
Nouvelle-Calédonie and Polynésie are in. The filters live in
[`src/data/damsPack.js`](../../damsPack.js) beside the code that reads the
result back; the build adds exactly one exclusion, documented below.

### A digue is not a barrage

The pack used to hold both and could not say which was which. Every feature now
carries `kind`:

| `kind` | Features | What it is |
|---|---|---|
| `dam` | 5 504 | a barrier ACROSS the watercourse, holding it back |
| `dyke` | 1 243 | an embankment ALONGSIDE the water, containing it |
| `dam+dyke` | 24 | tagged both in OSM — the mapper did not choose, and neither does this pack |
| *absent* | 661 | the carried-over world half, whose raw tags are long gone |

An **absent** `kind` means unclassified, never "dam". Defaulting it would
recreate the exact conflation the field exists to end, outside France where
nobody would notice.

`kind` also writes the TITLE of the 5 948 features OpenStreetMap never named —
80% of the pack, so this is what most cards and globe labels actually say.
Colouring a digue ochre and then titling its card "Barrage" loses the
distinction on the one surface a reader reads: `w860215522` is a 159 m
anti-ruissellement bund at Octeville-sur-Mer with no water body within 250 m,
and it read as a 159 m barrage. Nameless features are titled **Barrage**,
**Digue**, **Barrage-digue** — the same words the chips and the legend use — or
**Ouvrage** for the world half, which has no `kind` left to read.

**Weirs are deliberately out.** France has 7 704 `waterway=weir` against 5 519
`waterway=dam`; adding them would more than double a layer called "Barrages"
with objects most readers would not call one, and the dam-versus-weir boundary
is a mapper's judgement about overtopping rather than a survey. Separate
decision, separate rebuild.

**Road-carrying dykes are excluded**, and the cost is real. Half of France's
`man_made=dyke` — 1 428 of 2 661 elements — also carries `highway=*`, and the
OSM wiki is explicit that a road on a dyke belongs on the highway as
`embankment=dyke`. Importing them would draw the D-road along the Loire as a
barrage. Where a levée is mapped ONLY as a road, this pack therefore does not
hold it: 49 ways of the Levée de la Loire are absent for that reason.

**What OSM cannot say.** There is no tag anywhere that separates a digue de
protection contre les inondations from a digue d'étang — `dyke:type` has one
use worldwide. The register that does cover French flood dykes is SIOUH
(décret n° 2015-526, classes A/B/C, ~9 000 km), and it is not open bulk data.
The layer's own legend says so rather than implying a distinction it cannot
make.

This is OpenStreetMap's idea of a dam — a volunteer's judgement about a
structure, not a national register. France's own ROE register lists ~100 000
obstacles à l'écoulement and is an order of magnitude larger.

## Shape of what ships

| | |
|---|---|
Two independent axes. **Colour says what the structure is, size says how much
it matters** — a 1 106 m dyke and a 1 106 m barrage draw the same size, in
different colours, because they are the same size and different objects.

| Importance | | |
|---|---|---|
| Grand barrage | 1 086 | ≥ 15 m high, or hydroelectric, or named and ≥ 300 m long |
| Barrage nommé | 570 | |
| Petit ouvrage | 5 776 | no name, no height, no operator |

The bottom tier used to be called *"Seuil & petit ouvrage"*. It never contained
a single OSM-tagged weir — `waterway=weir` has never been in the filters — so
the label named a thing the pack does not hold. It names the rule instead.

| | |
|---|---|
| Named | 1 484 (20%) |
| Hydroelectric | 972 (13%) |
| With a height | 171 (2%) |
| With a measured span | 5 328 (72%) |
| Footprint polygons / points | 1 845 / 5 583 |

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
