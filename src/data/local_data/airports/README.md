# Aéroports & aérodromes — OurAirports

The open catalogue of the world's airports, aerodromes, heliports and water
landing areas, maintained by volunteer editors since 2007.

- **Source:** `https://davidmegginson.github.io/ourairports-data/` — the daily
  mirror of `https://ourairports.com/data/` (same files, stable URLs)
- **Files used:** `airports.csv`, `runways.csv`, `countries.csv`
- **Retrieved:** 2026-08-31 (12.7 MB `airports.csv`, 86,002 rows; 4.0 MB
  `runways.csv`, 48,203 rows)
- **License:** **dedicated to the public domain** by OurAirports —
  *"You may use it for any purpose, including commercial."* No attribution is
  legally required; we credit OurAirports and its editors anyway, in
  [`DATA_SOURCES.md`](../../../../DATA_SOURCES.md) and in the in-app
  "Data attribution" popover.
- **Runtime output:** `airports.geojsonl` (7,464 features, ~2.4 MB)
- **Build:** `npm run airports:pack` — deterministic; with no argument it
  downloads the three CSVs, or pass a directory holding them.

## This is a SELECTION, not the catalogue

7,464 of 86,002 rows ship. Shipped whole, the catalogue is roughly 25 MB of
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
| Total features | 7,464 |
| France + overseas territories | 1,335 (1,213 metropolitan) |
| Countries and territories represented | 239 |
| With a scheduled service | 4,325 |
| With an IATA code | 5,494 |
| With a measured runway length | 6,150 (82%) |
| With a classifiable runway surface | 5,795 (78%) |

By type — worldwide, then the French share:

| Type | World | France + territories |
|------|------:|---------------------:|
| `medium_airport` | 4,109 | 157 |
| `small_airport` | 1,961 | 1,119 |
| `large_airport` | 1,172 | 27 |
| `seaplane_base` | 116 | 27 |
| `heliport` | 105 | 4 |
| `balloonport` | 1 | 1 |

The four French heliports are Issy-les-Moulineaux (`LFPI`), Toulon Navy Air Base
(`LFTR`), and — via clause (b), with no ICAO code but a real scheduled shuttle —
Cannes Croisette and Île d'Yeu Port Joinville.

**The asymmetry is the point, and it is a limit.** Inside France the pack is the
long tail; outside it, the small strips are absent *by design*. A grass field in
Kansas is not missing because nobody mapped it — it is missing because it was
not selected. Do not read an empty area outside France as an empty sky.

## Importance: four tiers, one ladder

Seven thousand identical dots is a wall, not a map. Two fields in the pack decide
how much an airfield matters, and they are independent of each other: `type` is
OurAirports' editorial **size** class, `scheduled` is the hard fact that a
timetabled service calls there. Crossing them gives four tiers, defined once in
[`airportsPack.js`](../../airportsPack.js) and read by everything downstream —
the dot size, the colour, the label ladder, the legend and the display floors.
One classification, so they cannot drift apart.

| Tier | Rule | Dot | Card range | World | France |
|------|------|----:|-----------:|------:|-------:|
| **Grand aéroport** | `large_airport` | 14 px | 14 000 km | 1 172 | 27 |
| **Aéroport de ligne** | anything else with `scheduled` | 10,5 px | 3 000 km | 3 175 | 92 |
| **Aéroport sans ligne** | `medium_airport`, no scheduled service | 8 px | 1 200 km | 1 991 | 90 |
| **Aérodrome & aéroclub** | everything else | 6 px | 200 km | 1 126 | 1 126 |

Size is read **before** scheduled service, so Roissy — which is both — stays a
*Grand aéroport*. Taking the scheduled branch first would empty the top tier of
every airport that also sells seats, which is all of them.

**Card range is the second channel, and it is not decoration.** At 260 km over
Île-de-France the shared label grid was awarding fifteen cells to aéroclubs and
three to Roissy, Orly and Le Bourget — inverting, on the one surface a reader
actually reads, the ranking the dot sizes had just established. Priority alone
cannot fix that: cells are awarded *locally*, so a grass strip with no
competition in its own cell always wins it. Range fixes it, because "come
closer to be told about this one" is the same statement as "this one matters
less". The marker is always drawn; only its card waits.

**`airfield` is entirely French, and that is the shape of the pack, not a bug.**
Clause (c) is the only one that admits a small field with no scheduled service,
and it is France-only — so the ladder ends up separating the world's airports
from France's flying clubs almost exactly.

### Display floors

The layer row carries four chips. They are **runtime params, not share-link
state**: the pack always ships whole and `getStats().count` keeps reporting
7 464, so a floor hides markers without losing them. Same contract as the hydro
layer's `floorKw`.

| Chip | Keeps |
|------|-------|
| `TOUS` | everything — the default, because a visitor who turned the layer on asked to see the airports |
| `AÉROPORTS` | drops *Aérodrome & aéroclub* |
| `LIGNES` | only what a ticket is sold to |
| `GRANDS` | only *Grand aéroport* |

The legend counts what is **drawn**, not what is loaded: under `AÉROPORTS` the
aéroclub row reads 0 and its tooltip says how many are hidden.

## Read this before trusting a value

**`runways.count` counts upstream runway RECORDS, including helicopter lanes.**
Charles de Gaulle reports `count: 5`, and four of those are its paved runways —
the fifth is `08H/26H`, a 1,444 ft grass helicopter strip that upstream files as
a runway row. The count is honest about the source; it is not the number a
controller would give you. `longestM` is unaffected: it is the longest *open*
runway, and closed runways are excluded from both fields.

**`type` is OurAirports' editorial SIZE bucket, not a legal category.**
`large_airport` / `medium_airport` / `small_airport` are driven mostly by traffic
and runway length by the site's own editors. They do **not** map onto the French
regulatory ladder (aérodrome d'intérêt national / régional / local), and the
French labels the layer renders — *Grand aéroport*, *Aéroport*, *Aérodrome* —
translate the bucket without upgrading it into a status.

**`runways.surface` is a FAMILY, not the source value.** Upstream is free text:
557 distinct spellings across 48,203 runways, from `ASP` and `ASPH-G` to
`PIÇARRA` and `ASPH/ CONC`. It is collapsed into `revêtue` / `non revêtue` /
`eau`, and a value the table cannot read yields no surface at all rather than a
guess. 22% of features carry no surface for exactly that reason.

**Positions and elevations are volunteer-maintained.** They are good enough to
put a marker on the right airfield and are not survey data. Nothing here is
usable for navigation.

## Transform

1. `longitude_deg` / `latitude_deg` → GeoJSON `Point [lon, lat]`, rounded to 5
   decimals (~1 m). Rows with a missing, non-finite, out-of-range or exactly
   `0,0` position are dropped. **On the 2026-08-31 retrieval, zero selected rows
   were dropped for position.**
2. ICAO indicator: `icao_code` when it is four letters, else `ident` when it is
   four letters *and* is not itself `local_code` — because `ident === local_code`
   is upstream saying "this is a national code, not an ICAO one". Upstream fills
   `icao_code` for only 10,473 of 86,002 rows, and Paris Issy is the case that
   decides the rule: empty `icao_code`, `ident` = `LFPI`, a real indicator.
3. `local_code` ships **only** when the row has neither an ICAO nor an IATA code
   — a national code beside an ICAO code is noise, but a row with neither is
   un-lookupable without it.
4. Runways are joined on the airport's numeric `id` (`airport_ref`), never on
   `airport_ident`: idents get reassigned upstream when an ICAO code changes, and
   a stale ident would silently attach one airport's runways to another.
5. `elevation_ft` and `length_ft` → metres, rounded. Empty stays empty.
6. Empty strings, `null` and `"unknown"` are omitted, never emitted.
7. Features sorted by ICAO → IATA → local code → name, for a stable diff.
