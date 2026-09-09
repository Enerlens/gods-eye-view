# Aéroports & aérodromes — OurAirports, and the IGN's ground

The open catalogue of the world's airports, aerodromes, heliports and water
landing areas, maintained by volunteer editors since 2007 — joined, for 418
French fields, onto the aerodrome boundary the IGN surveyed.

- **Source:** `https://davidmegginson.github.io/ourairports-data/` — the daily
  mirror of `https://ourairports.com/data/` (same files, stable URLs)
- **Files used:** `airports.csv`, `runways.csv`, `countries.csv`
- **Retrieved:** 2026-09-07 (12.7 MB `airports.csv`, 86,050 rows; 4.0 MB
  `runways.csv`, 48,230 rows)
- **License:** **dedicated to the public domain** by OurAirports —
  *"You may use it for any purpose, including commercial."* No attribution is
  legally required; we credit OurAirports and its editors anyway, in
  [`DATA_SOURCES.md`](../../../../DATA_SOURCES.md) and in the in-app
  "Data attribution" popover.
- **Runtime output:** `airports.geojsonl` (7,466 features, ~3.3 MB)
- **Build:** `npm run airports:pack` — deterministic; with no argument it
  downloads the three CSVs **and the IGN layer**, or pass a directory holding
  them. `--no-footprints` builds the OurAirports half alone.

### Second source — and the pack is no longer single-licence

- **Source:** `https://data.geopf.fr/wfs/ows` — `BDTOPO_V3:aerodrome`
- **Retrieved:** 2026-09-09 (1,370 objects, 1.9 MB GeoJSON)
- **License:** IGN, **BD TOPO® — [Licence Ouverte 2.0](https://github.com/etalab/licence-ouverte/blob/master/LO.md)**.
  Attribution is **required**, unlike the public-domain half: the credit is on
  the layer row, on the card line that prints the outline, and in the in-app
  attribution popover.
- **Coverage:** métropole + DROM. Polynésie and Nouvelle-Calédonie are absent
  from BD TOPO, so Tahiti-Fa'a'ā — 1.89 M passengers in 2025 — has no outline
  while a grass strip in the Aveyron does.

## This is a SELECTION, not the catalogue

7,466 of 86,060 rows ship. Shipped whole, the catalogue is roughly 25 MB of
committed JSON, 23,196 rows of it heliports — and in France almost every one of
those is a hospital landing pad with no ICAO code and no published status.

Four clauses decide what survives. They live in
[`src/data/airportsPack.js`](../../airportsPack.js), under unit test, because
the layer reads the same module back when it writes a card:

| # | Clause | Why |
|---|--------|-----|
| (a) | every `large_airport` and `medium_airport`, worldwide | the airports a reader means by the word |
| (b) | anything with scheduled service, worldwide, at any size | if a ticket is sold to it, it belongs on the globe — this is what keeps Monaco's heliport and the Greenland strips |
| (c) | France + territories: every `small_airport`, `seaplane_base`, `balloonport` | the French long tail, down to the grass strips |
| (d) | France + territories: a `heliport` **only** with an ICAO indicator | admits Issy-les-Moulineaux and Toulon; rejects 456 hospital pads carrying synthetic `FR-00xx` idents |

`closed` is refused before any clause runs: the type means the aerodrome no
longer exists, and 13,482 ghost fields would outweigh every other bundled pack
in the repo.

### What that means on screen

| | Count |
|---|------:|
| Total features | 7,466 |
| France + overseas territories | 1,337 (1,213 metropolitan) |
| Countries and territories represented | 239 |
| With a scheduled service | 4,327 |
| With an IATA code | 5,494 |
| With a measured runway length | 6,150 (82%) |
| With a classifiable runway surface | 5,795 (78%) |
| **With drawable runway geometry** | **4,790 (64%)** — 6,698 runways |
| **With a surveyed IGN footprint** | **418** — 213 of them with no runway geometry at all |

By type — worldwide, then the French share:

| Type | World | France + territories |
|------|------:|---------------------:|
| `medium_airport` | 4,108 | 157 |
| `small_airport` | 1,961 | 1,119 |
| `large_airport` | 1,173 | 27 |
| `seaplane_base` | 116 | 27 |
| `heliport` | 107 | 6 |
| `balloonport` | 1 | 1 |

The French heliports are Issy-les-Moulineaux (`LFPI`), Toulon Navy Air Base
(`LFTR`), the two Polynesian pads upstream added on 2026-09-08 (`NTHB` Pago and
`NTHD` Taiohae) and — via clause (b), with no ICAO code but a real scheduled
shuttle — Cannes Croisette and Île d'Yeu Port Joinville.

**The asymmetry is the point, and it is a limit.** Inside France the pack is the
long tail; outside it, the small strips are absent *by design*. A grass field in
Kansas is not missing because nobody mapped it — it is missing because it was
not selected. Do not read an empty area outside France as an empty sky.

## What the layer draws

Three marks, three questions, and each channel answers exactly one of them.

| Channel | Carries | Where it is decided |
|---|---|---|
| **Colour** of the pastille | the importance tier | `AIRPORT_TIERS` |
| **Diameter** of the pastille | the published runway length, in four classes | `AIRPORT_LENGTH_CLASSES` |
| **Hollow ring** instead of a disc | no runway length published at all — 1 314 fields | `airportRenderSpec` |
| **The drawn line** | the runway itself: its two thresholds, so its true length, bearing and width | `runwayGeometry` + `localGeojson.js` |
| **The drawn ground** | the aerodrome boundary the IGN surveyed — 418 French fields, one colour, clamped to the terrain | `attachAirportFootprints` + `localGeojson.js` |
| **Distance the mark appears at** | the tier, plus one per-feature override: 3 000 m of runway buys orbital range | `markerMaxDistance` |

### Importance: three tiers, one question

Seven thousand identical dots is a wall, not a map. The ladder that thins them
used to cross **two** axes — `type`, OurAirports' editorial size class, and
`scheduled`, the hard fact that a timetabled service calls — and it read size
first. Its four steps therefore changed subject as you descended them: size,
then service, then size again. It also seated Paris-Le Bourget, which sells no
scheduled seat at all, at the top of a ladder whose `LIGNES` chip promised
"terrains desservis par une ligne régulière". 22 fields worldwide made that
promise false.

The ladder asks **one** question now, and it is the hard one: *is a ticket sold
here?* The two steps under it are not a second axis sneaking back in — they are
the [selection policy](#the-selection-policy) made visible. Clause (a) admits
the world's large and medium airports; clause (c) admits the French long tail
and nothing else. So the unscheduled fields split exactly where the pack's own
**coverage** splits, and the reader sees the shape of the pack rather than a
second opinion about size.

| Tier | Rule | Colour | Mark from | Card from | World | France |
|------|------|--------|----------:|----------:|------:|-------:|
| **Aéroport de ligne** | `scheduled` | `#e6d8ff` | 14 000 km | 3 000 km | 4 327 | 119 |
| **Aéroport sans ligne** | `large_airport` or `medium_airport`, no scheduled service | `#a98ada` | 3 000 km | 1 200 km | 2 012 | 91 |
| **Aérodrome & aéroclub** | everything else | `#6d5a94` | 900 km | 200 km | 1 127 | 1 127 |

The bottom tier is the **complement** of the two worldwide classes, not a list
of long-tail types: a heliport is not an "aéroport sans ligne", and neither is
an absent or unrecognised `type` from a future upstream rebuild.

**Size is not on this ladder, and that is the point.** `type` is a *proxy* for
runway length — this file says so itself, two sections down: "driven mostly by
traffic and runway length" — and the shipped pack proves it. The median longest
runway is 3 048 m for `large_airport`, 2 050 m for `medium_airport` and 1 037 m
for `small_airport`, landing on the 3 000 / 1 800 / 1 000 m thresholds the size
channel already draws with. Colouring by the bucket while sizing by the
measurement was one fact on two channels, and the measurement is the better of
the two. Roissy still towers over the grass strip beside it — at 18 px against
6, in published metres.

**What the retired top tier did that size could not**, it now does per feature:
a runway of **3 000 m or more lifts its own card and mark to 14 000 km**, so
Roissy stays nameable from orbit without a size-shaped tier to carry it. 1 280
fields qualify against the 1 173 that were `large_airport`, and 268 of the
newcomers sell no seat — air bases and freight fields a globe had no honest
reason to hide while drawing a regional airport with a shorter strip.

An **`airfield` never qualifies**, whatever its runway: that tier is 100 %
French by selection, so lifting one of its fields to orbit would draw a density
belonging to the pack rather than to the world. Today the refusal costs nothing
— not one of the 1 126 is 3 000 m long — and it is there so that the day one is,
the globe does not quietly start lying.

**Card range is a channel of its own, and it is not decoration.** At 260 km over
Île-de-France the shared label grid was awarding fifteen cells to aéroclubs and
three to Roissy, Orly and Le Bourget — inverting, on the one surface a reader
actually reads, the ranking the marks had just established. Priority alone
cannot fix that: cells are awarded *locally*, so a grass strip with no
competition in its own cell always wins it. Range fixes it, because "come
closer to be told about this one" is the same statement as "this one matters
less".

**Marker range is the newer one, and it exists because the pack is asymmetric.**
The `airfield` tier is 100 % French — clause (c) is the only one that admits a
small field with no scheduled service, and it is France-only. Drawn from orbit,
those 1 126 marks report a French aerodrome density that belongs to the
*selection* and not to the world, right next to a Germany the pack deliberately
left empty. So the tier arrives at 900 km, which is not a taste: France spans
about 1 000 km, and a 1 000 km span fills a 1080 px viewport at ~870 km. The
aéroclubs appear exactly when France is the subject of the frame. Every range is
printed in the row legend, because nothing on screen can otherwise say it.

**`airfield` is entirely French, and that is the shape of the pack, not a bug.**
Clause (c) is the only one that admits a small field with no scheduled service,
and it is France-only — so the ladder ends up separating the world's airports
from France's flying clubs almost exactly.

### Length: the measurement, on the channel B1 reserves for it

`longestM` is the longest OPEN runway, on 6 150 of 7 464 features. Four frozen
classes, operational rather than statistical, so a reader can hold them — and
never recomputed from what is on screen:

| Class | Dot | World |
|---|----:|------:|
| 3 000 m and up — widebody | 18 px | 1 280 |
| 1 800 – 2 999 m — the A320 asks ~1 800 m | 13 px | 2 577 |
| 1 000 – 1 799 m — turboprop, business | 9 px | 1 690 |
| under 1 000 m — light aviation | 6 px | 603 |
| **not published** | **8 px hollow ring** | **1 314** |

The ring is 8 px, between the 6 and the 9, and hollow: a ring smaller than the
smallest disc would still read as "short", and "not published" is not a short
runway. No measured class can reach it.

### The runway itself

OurAirports publishes both thresholds of a runway and its width. That makes an
airport the one object in this app with a real oriented shape at true scale, and
the layer draws it — 6 698 runways over 4 790 fields.

**One mark, two floors, three regimes**, continuous at both crossings because a
floor that is already exceeded does nothing:

| Camera | Length | Stroke | What you read |
|---|---|---|---|
| far | floored to the pastille's own diameter | 3 px | an oriented tick, graded by class |
| mid | **true** | 3 px | the runway, at its place and its bearing |
| near | **true** | the runway's own published metre width | the runway, at its size |

Two rules bound it, both declared and both derived rather than chosen. A
**secondary** runway is drawn only once a pixel is under 45 m — the median
published width, so the point where strips stop being separable. And any runway
whose floor would stretch it past **twice** its true length is dropped entirely:
beyond that the mark is more symbol than measurement, and the pastille carries
the same class anyway. At 260 km that means Roissy shows one held tick and
Toussus-le-Noble shows none.

The segments are **not** clamped to the terrain: they stand at the field's
published elevation until a ground sample lands within 75 km, then on the
sampled surface. And the stroke is a screen width, so under a strongly oblique
camera it does not foreshorten the way a ground ribbon would — the *length* and
the *bearing* are always the published ones, which is what the mark claims.

**Two runway rows are refused**, and both refusals are consistency tests between
two independently published numbers rather than judgement calls:

| Refusal | Rule | Rows |
|---|---|----:|
| length disagreement | threshold-to-threshold distance more than 25 % from `length_ft` | 128 |
| anchor offset | runway midpoint more than 10 km from its own airport's point | 1 |

The second one is a bad join, not a long taxiway: measured offsets run 130 m
(median) to 2 170 m (p99), and then jump to 36 008 m.

**What is NOT refused** is the 440 m grass helicopter lane `08H/26H` that makes
Charles de Gaulle report `count: 5`. This file used to apologise for that number
in prose. Drawn to scale beside four strips of 2 700 to 4 215 m, it explains
itself.

**The asymmetry that shapes the whole design:** roughly three quarters of the
airports have a drawable shape, and **8 % of the aéroclubs** — 89 of 1 127, all French. The
French long tail is exactly the half upstream never georeferenced, so the runway
can never become this layer's primary sign; the pastille carries the
measurement for the fields that have none. `airportsPack.test.mjs` pins that
ratio under a third and says why. It is also the hole [the IGN
footprints](#the-ground-the-ign-surveyed) fill: 207 of those aéroclubs now have
a surveyed outline where upstream had no coordinates to give.

| Tier | With geometry | France |
|---|---|---|
| Aéroport sans ligne | 1 560 / 2 012 (78 %) | 91 / 91 |
| Aéroport de ligne | 3 141 / 4 327 (73 %) | 99 / 119 |
| Aérodrome & aéroclub | 89 / 1 127 (8 %) | 89 / 1 127 |
| **Total** | **4 790 / 7 466 (64 %)** | **279 / 1 337** |

## The ground the IGN surveyed

The asymmetry above is a hole with a shape, and one publisher has exactly what
fits in it. `BDTOPO_V3:aerodrome` is the IGN's own aerodrome layer: 1 370
objects, each a **surveyed polygon** rather than a point, and it carries
`code_icao`. So the join needs no geocoding and no fuzzy name matching.

| | Fields |
|---|------:|
| Joined on the published ICAO code | 377 |
| Joined because the field's point lies inside an unkeyed outline | 41 |
| **Total drawn** | **418** — 41 859 ha, median 39 ha, largest 2 832 ha (Roissy) |
| **…with no runway geometry at all before** | **213** |

By tier: 67 `airline` (5 of them shapeless before), 77 `airport` (1), and
**274 `airfield` — 207 of which had no shape at all**. The tier OurAirports
georeferenced at 8 % now has a drawn shape for a quarter of its fields, and
every one of those shapes was surveyed rather than volunteered.

### What BD TOPO is not

**61 % of its 1 370 objects are not outlines.** 830 are a 5.2 m × 5.2 m square —
a coordinate wearing a polygon's clothes — including 147 the file itself calls
`Aérodrome`. Of the 666 objects whose `nature` is `Aérodrome`, `Altiport` or
`Hydrobase`, 219 fall under one hectare and **205 of those are that square**.
The hectare floor removes them. It does not sit in a gap, though: the largest
refusal is 9 891 m² against a smallest admission of 10 208 m², so 14 real but
tiny outlines are the price of a round number.

**704 of the 1 370 are héliports** — hospital pads, fire stations, gendarmerie
yards, ski stations, 48 of them in Guyane. This pack admits a heliport only
with an ICAO code (clause (d)), so those outlines have almost nothing to attach
to and are not read at all. They are the best map of French helipads that
exists and they are not this layer's subject.

### The refusals, and what is left dark

| Refusal | Why | Count |
|---|---|---:|
| `nature` outside the three admitted | a helipad is not a landing surface this pack draws | 704 objects |
| under one hectare | BD TOPO's placeholder square | 219 objects |
| anchor offset over 5 km | a key that lands kilometres away is a bad join | 0 — worst kept is 1 382 m (LFOK) |
| an outline two fields both fall inside | "which of these owns this polygon" has no answer in the data | 0 |

**30 candidate outlines — 1 457 ha — attach to nothing**, and they are mostly
military. BD TOPO models the civil and the military side of one field as two
objects and puts the ICAO code on the civil one only. The largest is the **Base
d'Aéronautique Navale de Lann Bihoué, 767 ha**, sharing its runway with `LFRH`
Lorient-Bretagne Sud 579 m away. Attaching it would mean guessing that two
nearby polygons are one field. So Lorient draws its civil apron, the naval base
stays dark, and that is said here rather than papered over.

Three outlines land on a **foreign** field, and all three are correct: the
French slice of `LSGG` Genève and `LESO` San Sebastián, and the Brazilian bank
of the Oyapock facing Saint-Georges (`SBOI`), where BD TOPO maps across the
river. Coverage stops at the border; it also overlaps it, in both directions.

### On screen

The outline is drawn in **one colour for all 418**, never the tier's: Cesium
colours a batched ground primitive by each instance's bounding rectangle, and
Marseille-Provence's box overlaps the Berre seaplane base's — two tiers, one
box, a colour that would bleed. The tier is already on the pastille.

It has a **screen floor of its own**: under 8 px of ground extent it is not
drawn, and the mark reverts to being a dot. Ground extents run 203 m to
10 334 m (median 1 251 m), so on a 1 080 px canvas the smallest outline
disappears at 24 km, the median at 146 km and Roissy at 1 208 km. A 3 000 m
runway still buys its card and its pastille a 14 000 km range — a footprint
stops being a shape long before it stops being on screen.

And the anchor does **not** move onto it: the pastille stays on OurAirports'
published reference point, which is what every runway segment is measured
against. Centring it on the outline instead would shift 418 marks by 154 m at
the median and 1 382 m at the worst.

### The recall stem is capped here, and nowhere else

Every bundled local layer lifts its pastille on a stem held at a constant 65 px,
which makes the stem's height *in metres* `0,0695 × camera distance`: 695 m at
10 km, 3 475 m at 50 km, 13 900 m at 200 km. For a dam that is a recall device.
Over an airport it is a claim — the live-flight layers draw aircraft at their
real altitudes above the same runways, so an uncapped pastille floats at FL114
among traffic on approach. `stemMaxHeightM: 150` caps it under the 300 m
(1 000 ft AGL) traffic-pattern altitude, so it can never reach a height an
aircraft is flown at.

### Display floors

The layer row carries three chips. They are **runtime params, not share-link
state**: the pack always ships whole and `getStats().count` keeps reporting
7 464, so a floor hides markers without losing them. Same contract as the hydro
layer's `floorKw`.

| Chip | Keeps |
|------|-------|
| `TOUS` | everything — the default, because a visitor who turned the layer on asked to see the airports |
| `AÉROPORTS` | drops *Aérodrome & aéroclub* |
| `LIGNES` | only what a ticket is sold to |

There were four. `TOUS` and `LIGNES` asked about service, `AÉROPORTS` and
`GRANDS` asked about size — two axes on one strip of chips. `GRANDS` is the one
that went: it kept 1 173 fields, and the size channel answers the same question
without a filter, at a threshold the legend already prints. `LIGNES` is now
true, which it was not: it used to keep 22 fields that sell no seat.

The legend counts what is **drawn**, not what is loaded: under `AÉROPORTS` the
aéroclub row reads 0 and its tooltip says how many are hidden.

## Read this before trusting a value

**`runways.count` counts upstream runway RECORDS, including helicopter lanes.**
Charles de Gaulle reports `count: 5`, and four of those are its paved runways —
the fifth is `08H/26H`, a 1,444 ft grass helicopter strip that upstream files as
a runway row. The count is honest about the source; it is not the number a
controller would give you. `longestM` is unaffected: it is the longest *open*
runway, and closed runways are excluded from both fields. Since the layer draws
the geometry, the map now says this out loud: the fifth line is 443 m long and
30 m wide beside four of 2 700 to 4 215 m.

**`runways.geom` is drawn, never printed, and it is a SUBSET of `runways.count`.**
6 698 of the 8 418 open runway rows carry two usable thresholds and survive the
two refusals, so a field can report `count: 2` and ship one drawn runway. The
count is what upstream files; the geometry is what upstream placed. Neither is
wrong, and the card only ever quotes the first.

**The drawn length and `longestM` come from different columns.** The line is
drawn between the two published thresholds; the size class is read off the
published `length_ft`. They agree to 0.36 % at the median, and any row where
they disagree by more than 25 % is refused outright rather than reconciled —
picking a winner between two published numbers is not this pack's job.

**`type` is OurAirports' editorial SIZE bucket, not a legal category.**
`large_airport` / `medium_airport` / `small_airport` are driven mostly by traffic
and runway length by the site's own editors. They do **not** map onto the French
regulatory ladder (aérodrome d'intérêt national / régional / local), and the
French labels the layer renders — *Grand aéroport*, *Aéroport*, *Aérodrome* —
translate the bucket without upgrading it into a status.

**`runways.surface` is a FAMILY, not the source value.** Upstream is free text:
627 distinct spellings across 48,230 runways, from `ASP` and `ASPH-G` to
`PIÇARRA` and `ASPH/ CONC`. It is collapsed into `revêtue` / `non revêtue` /
`eau`, and a value the table cannot read yields no surface at all rather than a
guess. 22% of features carry no surface for exactly that reason.

**Positions and elevations are volunteer-maintained.** They are good enough to
put a marker on the right airfield and are not survey data. Nothing here is
usable for navigation.

## Transform

1. `longitude_deg` / `latitude_deg` → GeoJSON `Point [lon, lat]`, rounded to 5
   decimals (~1 m). Rows with a missing, non-finite, out-of-range or exactly
   `0,0` position are dropped. **On the 2026-09-07 retrieval, zero selected rows
   were dropped for position.**
2. ICAO indicator: `icao_code` when it is four letters, else `ident` when it is
   four letters *and* is not itself `local_code` — because `ident === local_code`
   is upstream saying "this is a national code, not an ICAO one". Upstream fills
   `icao_code` for only 10,823 of 86,050 rows, and Paris Issy is the case that
   decides the rule: empty `icao_code`, `ident` = `LFPI`, a real indicator.
3. `local_code` ships **only** when the row has neither an ICAO nor an IATA code
   — a national code beside an ICAO code is noise, but a row with neither is
   un-lookupable without it.
4. Runways are joined on the airport's numeric `id` (`airport_ref`), never on
   `airport_ident`: idents get reassigned upstream when an ICAO code changes, and
   a stale ident would silently attach one airport's runways to another.
5. `elevation_ft`, `length_ft` and `width_ft` → metres, rounded. Empty stays
   empty — an unpublished width is omitted from the segment rather than
   defaulted, so the renderer can never stroke a thickness nobody measured.
6. Runway thresholds → `runways.geom`, one `[lon1, lat1, lon2, lat2, widthM?]`
   per drawable runway, coordinates rounded to the same 5 decimals as the
   airport's own point, **longest first** — the layer draws index 0 alone at
   range. The order is computed on the ROUNDED coordinates, not the source
   ones: Kamina Air Base has two strips 2.4 cm apart, and rounding flips them.
7. Empty strings, `null` and `"unknown"` are omitted, never emitted.
8. Features sorted by ICAO → IATA → local code → name, for a stable diff.
