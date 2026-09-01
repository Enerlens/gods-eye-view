# France's hydro fleet, all of it

`plants.json` is the register the **Petite hydro (FR)** layer draws: every
hydroelectric installation in ODRÉ's *Registre national des installations de
production et de stockage d'électricité*, and the best position anyone
publishes for each one.

It exists because of a hole found by looking for one place. There are **nine
hydroelectric plants in the commune of Laruns**, in the Pyrénées-Atlantiques —
Miégebat 74 MW, Le Hourat 46,9 MW, Pont-de-Camps 39,4 MW, Artouste 25 MW, Bious
14 MW, Geteu 9,9 MW, Fabrèges 9 MW, Espalungue 3,7 MW, Artouste-Lac 2 MW,
**223,9 MW in one valley** — and none of them was on this globe. The *Centrales
EDF* layer draws EDF SA's own fleet, and those nine are SHEM's. The *Groupes de
prod (FR)* layer stops at 100 MW, because that is RTE's publication floor. Two
correct layers, and a whole valley between them.

Rebuild it with:

```
npm run hydro:registry                     # writes this file
npm run hydro:registry -- --report         # and prints the coverage audit
npm run hydro:registry -- --refresh-osm    # re-query Overpass instead of the cache
npm run hydro:registry -- --floor-kw=1000  # only plants ≥ 1 MW
```

The country-wide Overpass query is cached under `.gev-cache/` because public
mirrors are unreliable — on 2026-08-31 three of the four returned 429, 500, 502
and 504 across eleven attempts in twenty minutes and only
`overpass.openstreetmap.fr` answered. A run that cannot reach OpenStreetMap
**fails** rather than writing a registry with almost every plant in France
demoted to a commune roll-up; pass `--allow-partial` to accept that deliberately.
The same refusal covers geo.api.gouv.fr, for a reason measured the hard way: two
consecutive runs resolved 1 819 and 1 802 commune centres, and the 17-commune
difference silently deleted 27 plants from the output.

## What is in it

Measured on the edition of 30/06/2026:

- **2 742 installations, 26,02 GW.** The register's own hydraulic filière,
  entire, down to a 40 kW mill at Monteils.
- `plants[]` — **998 installations placed where they physically are**, 24,31 GW.
  One record per register row, with everything the register publishes about it
  plus the position, WHICH OBJECT that position is, and the evidence for it.
  **589 of them sit on a building footprint surveyed by IGN.**
- `clusters[]` — **1 744 installations that no source places, rolled up into
  1 147 commune markers**, 1,71 GW. One record per commune.
- `excluded` — what the register holds and this file does not: 15 rows named
  *Agrégation des installations de moins de 36KW*, 24,3 MW, published per REGION
  with no commune. There is nowhere honest to draw them.

## Why some plants are rings instead of dots

**A hollow ring is a commune, not a plant.** The register publishes an INSEE
code and nothing spatial, so for the 1 744 installations no other source places,
the commune centre is the only coordinate that exists. Drawing them there as
plants would be wrong twice:

- **Wrong about where.** Measured across the 998 plants that *do* get a real
  position, the commune centre sits a **median 2,5 km** from the actual
  powerhouse, **p90 7,5 km**. In an Alpine or Pyrenean valley that is routinely
  the wrong side of a ridge, on a different river.
- **Wrong about how many.** 1 744 installations share 1 147 communes. Drawn
  individually they stack up to a dozen markers on one pixel, each claiming a
  position none of them has.

So they are drawn as one marker per commune that claims only what the register
actually says: this commune contains N installations totalling X kW.

## Where the positions come from

Two independent facts travel with every position, and conflating them is what
caused this build's worst bug. **`placement` + `matchedBy` say how the plant was
IDENTIFIED. `geometry` says WHICH OBJECT the coordinate is.**

| `matchedBy` | count | how the plant was identified |
|---|---:|---|
| `name` | 325 | an OpenStreetMap `power=plant` whose name is the register's, token for token |
| `power` | 232 | the only OSM candidate in the commune whose published megawatts match |
| `insee-sole` | 214 | the only IGN `Centrale électrique` in a commune holding only one register row |
| `sole` | 93 | the only plant mapped in a commune holding only one register row |
| `name-partial` | 66 | an OSM name that is a subset of the register's — **weaker, and the card says so** |
| `postesource` | 53 | the substation whose `ref:FR:RTE` **is** this row's `postesource` |
| `toponyme` | 15 | the IGN footprint whose toponym is the register's name |
| *(none)* | 1 744 | rolled up into a commune ring |

| `placement` / `geometry` | count | which object the dot actually is |
|---|---:|---|
| `ign-bdtopo` / `ign-footprint` | 589 | **IGN's surveyed building footprint** — median span 32 m, with IGN's own `precision_planimetrique` on the card |
| `osm-plant` / `outline` | 314 | the mapped OSM outline of the plant, **≤ 500 m across** |
| `osm-plant` / `generators` | 57 | the `power=generator` elements inside a scheme too large to be a position — the generating hall |
| `edf-published` / `published-point` | 22 | the operator's own point |
| `rte-switchyard` / `switchyard` | 16 | the connection yard. **Not the machines**, and the card says so outright |

Every candidate is searched only within **12 km of the commune centre** the
register names — re-tested on the FINAL position, after any snap — and each
OpenStreetMap element can be claimed once. Rows are placed **largest first**, so
a 74 MW plant takes an outline before a 0,4 MW one can match it on a shared
token. Nothing is ever averaged between two anchors: an average of two published
positions is a third, unpublished one.

### Why IGN BD TOPO leads

The Plan IGN draws France's power stations, and it draws them from **BD TOPO**,
whose `zone_d_activite_ou_d_interet` layer carries 4 318 features tagged
`nature = 'Centrale électrique'`. Three properties make it the best positional
evidence in this build:

- **It is the building.** Median footprint span **32 m**, p90 184 m — against an
  OpenStreetMap `type=site` relation that can be twelve kilometres wide.
- **It publishes its own error bar.** `precision_planimetrique` is on every
  feature: 3 m or better on 242 of the positions used here, 20 m on 333. The
  card prints it, so the reader gets the accuracy instead of an implied one.
- **The join needs no guessing.** BD TOPO publishes `insee_commune`, which is
  the same INSEE code ODRÉ prints on every register row.

What BD TOPO does **not** carry is power, operator or filière. It can say where
a plant is and never which plant it is, so it is used in two passes and never as
an identity of first resort:

1. **Refine.** A plant another tier has already identified is snapped onto the
   footprint nearest to it in the same commune, within **250 m**. 360 positions
   moved, a **median of 12 m** and at most 227 m. The 250 m radius is read off
   the measured distribution, not chosen: of the placed plants with an IGN
   footprint in their commune, 47 % were already within 25 m, 67 % within 100 m,
   72 % within 250 m — and then the curve flattens, with 12 more arriving by
   500 m. Agreement clusters tight; past a couple of hundred metres it is a
   different object.
2. **Place.** A row nothing else could position takes a footprint when the
   toponym matches (15) or when the commune holds exactly one register row and
   exactly one free footprint (214). **229 plants that were rings are now
   dots** — and coverage below 4,5 MW roughly doubled.

The honest caveat, on the card as well as here: **86 of those 229 sit on a
`Centrale électrique` whose `nature_detaillee` IGN leaves blank.** The filter is
a deny-list (photovoltaic, wind, thermal, geothermal are excluded) rather than
an allow-list, because 501 of the 4 318 features state no kind at all — and at
Laruns those unlabelled ones are the Baralet, Borce, Estaens, Geteu and
Artouste-Lac powerhouses. An allow-list would have thrown away exactly what this
tier exists to find. Where IGN did not say "hydroélectrique", the card says so.

### When the register contradicts itself

Both the commune and the source substation are codes the register publishes, and
OpenStreetMap publishes the substation code too as `ref:FR:RTE`. Across the 378
RTE-connected rows whose substation OSM carries, the distance between the two
has a median of 2,4 km and a p90 of 5,4 km. **The largest legitimate one is
11 km — and the next four are 6 717, 6 864, 7 263 and 8 945 km.**

All four are metropolitan hydro plants filed under an overseas commune whose
INSEE code begins 97:

| plant | the register says | its own substation says |
|---|---|---|
| Lac d'Oô, 30 MW | Montsinéry-Tonnegrande, **Guyane** | Luchon, Haute-Garonne |
| Luz, 71,7 MW | La Trinité, **Martinique** | Hautes-Pyrénées |
| Motz, 33,6 MW | Terre-de-Bas, **Guadeloupe** | Savoie |
| Pont-du-Loup, 8,2 MW | Saint-André, **La Réunion** | Alpes-Maritimes |

For those four the commune is simply the wrong field: every commune-based tier
would place them on the wrong continent, and the commune ring would file them
there too. The substation wins, because `postesource` ↔ `ref:FR:RTE` is a code
match on both sides and the commune is a code that agrees with nothing. **The
register's own commune is kept verbatim on the record** and the card shows both
claims — the reader is owed the contradiction, not a quiet edit.

### The bug this table exists to prevent

Overpass's `out center` on a relation returns the centre of its **bounding
box**, and OSM maps a large hydro scheme as a `type=site` relation covering the
intake, the headrace, the penstock, the powerhouse and the tailrace. The centre
of that box is a point on **no object at all**.

The first build of this registry used it. Measured on that output: **167 of 722
OSM-positioned plants (23 %) sat at the centre of an object more than 500 m
across, and 99 of them more than 3 km across** — Grand-Maison's relation spans
12,1 km, Montpezat's 22,8 km. The Centrale du Hourat at Laruns was drawn
**2,7 km up the mountain, mid-forest, halfway along its own penstock**, while
the powerhouse stands in the middle of the village 47 m from 4 rue de Gerp,
beside the Arriussé.

The fix is three lines of policy: ask Overpass for `bb` rather than `center` so
the build can SEE the span; refuse any object wider than **500 m** as a
position; and snap those to the `power=generator` elements inside them. **127
plants moved, a median of 1,3 km and up to 7,5 km.** Anything that could not be
resolved is not drawn at a guess — it goes to its commune ring.

## Coverage, honestly

```
tranche        total  placées   taux      GW  GW placés  anonymes
≥ 100 MW          56       55    98%   15.03      14.91         1
10–100 MW        241      224    93%    8.38       7.85        15
4,5–10 MW        136      118    87%    0.95       0.84        29
1–4,5 MW         507      251    50%    1.07       0.56       242
< 1 MW          1802      350    19%    0.59       0.15      1072
```

Read it as one sentence: **the bigger a plant is, the more likely the world has
written down where it is.** Above 4,5 MW, nine in ten are placed. Below 1 MW,
one in five — and three in five have no published name either. That is not a
defect of this build, it is the shape of what France publishes about its own
micro-hydro, and it is why the two marker kinds exist.

## What a card can show when the register withholds the name

**1 359 of the 2 742 installations publish `Confidentiel` where a name belongs**
— small private plants whose operator is a person. They are neither dropped nor
labelled "Confidentiel". Measured across those 1 359, what survives the
anonymisation is:

| field | present |
|---|---:|
| commune, département, région | 100 % |
| installed power | 100 % |
| connection voltage (BT / HTA / 63–400 kV) | 100 % |
| grid operator (Enedis, RTE, EDF-SEI, régies) | 100 % |
| commissioning and connection dates | 100 % |
| EIC code | 100 % |
| technology (fil de l'eau, éclusée, lac, …) | 96 % |
| source substation | 95 % |
| **energy actually injected, 12 rolling months** | **90 %** |
| head, in metres | 10 % |
| number of turbine groups | 3 % |

The last one in bold is the interesting one: it is the only *measurement* in the
whole register, and it gives a capacity factor. A card for an unnamed 3,9 MW
plant at Licq-Athérey reads *3,9 MW installés · 3,9 GWh injectés sur 12 mois
glissants (12 %) · Fil de l'eau · HTA, poste L.ATH, Enedis · en service depuis
le 15/11/2007*. An anonymous plant is a full card missing one line.

## Traps the build absorbs

1. **The register publishes no coordinates.** Not one column. Every position in
   this file is a join.
2. **`Confidentiel` is not a name.** It is carried as `name: null` +
   `anonymous: true`, so no consumer can print it as one by accident.
3. **Published zeros mean "not declared".** `hauteurchute`, `productible`,
   `capacitereservoir` and `energiestockable` are `0.0` on rows that simply do
   not declare them, and **`debitmaximal` is zero on every single row in
   France** — it is not read at all.
4. **26 hydro plants are published as photovoltaic.** 25 of them Corsican and
   real hydro — Rizzanese 55 MW, Lugo-di-Nazza 43 MW, Castirla 28,5 MW, Tolla,
   Calacuccia, Ocana, Asco. The filière is right and the technology is wrong, so
   the rows are kept, the published string is preserved verbatim on the card,
   and `techKey` is null so the layer will not colour or count them as a hydro
   technology.
5. **`coordonnees_x_wgs` is the LATITUDE** in EDF's hydro file. Read the usual
   way, Grand-Maison plots off the coast of Somalia.
6. **Paris, Lyon and Marseille arrondissement codes are not commune codes.**
   `geo.api.gouv.fr/communes?code=13214` answers with an empty array, which
   would have dropped two Canal de Marseille turbines.
7. **Overpass `center` on a relation is the bounding-box centre**, which for a
   `type=site` hydro scheme is a point on no object — see the section above.
9. **The register can contradict itself about the commune** — four rows by
   thousands of kilometres. See the section above.
8. **A prefix-shaped first word is not decoration.** The register writes
   `MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3`, so an early version stripped any
   4–6 uppercase characters followed by a hyphen. `GRAND` is five uppercase
   characters followed by a hyphen: `GRAND-MAISON` became `MAISON`, and France's
   largest hydro plant lost its join to EDF's own published coordinate. The
   decoration is now recognised only as a PAIR — prefix *and* trailing `-n` —
   which also spares the real names `HYDR-AUZENE` and `COLY-LAMALETTE`.

## A position is not a rendering

Everything above is about getting the coordinate right. Drawing it is a separate
problem with its own way of being wrong, and this layer got it wrong first:
markers were drawn at **ellipsoidal height 0** while the ground under Espalungue
is at 556 m and under Grand-Maison at 840 m.

A marker below the surface does not look low — it looks **displaced**, by
`depth × tan(angle between the view ray and the local vertical)`: zero at the
centre of a nadir view, about 320 m at the rim of a 60° field of view. Because
that angle depends on where the marker sits on screen, panning the camera makes
the dot slide across a map that is standing still. It reads exactly like bad
data, and it is not.

`frHydroPlants.js` clamps every marker onto the terrain. The cache read is
synchronous and free; the terrain fetch is bounded to what is on screen, capped
at 250 markers, and skipped above 200 km of camera height where the offset is
under two pixels.

## Sources and licences

- **ODRÉ**, *Registre national des installations de production et de stockage
  d'électricité* (edition of 30/06/2026) — Licence Ouverte 2.0.
- **EDF Open Data**, *Centrales de production hydraulique de EDF SA* — Licence
  Ouverte 2.0. Read from the portal's native data-fair routes; opendata.edf.fr
  has migrated to Koumoul and the `/api/v1/datasets` route most links still
  point at answers the SPA's HTML 404.
- **OpenStreetMap** contributors, `power=plant` + `plant:source=hydro`,
  `power=generator` + `generator:source=hydro`, and `power=substation` with
  `ref:FR:RTE` — ODbL 1.0. **722 of the 765 positions in this file come from
  OpenStreetMap, so the share-alike travels with it: keep the contributor
  attribution when redistributing this derived database.**
- **IGN**, *BD TOPO®*, `zone_d_activite_ou_d_interet` filtered to
  `nature = 'Centrale électrique'`, read from the Géoplateforme WFS
  (`data.geopf.fr`) — Licence Ouverte 2.0. This is the data behind the Plan IGN
  raster, and it supplies 589 of the 998 positions in this file.
- **geo.api.gouv.fr**, commune centres — Licence Ouverte.

## What this file is not

It is **not live output**. `energyKwh` is a trailing twelve-month total from the
register, not a meter reading; the *Groupes de prod (FR)* layer owns live
generation and cannot see a single one of these plants, because RTE publishes
nothing below 100 MW.

It is **not de-duplicated against the sibling layers**. The 56 plants above
100 MW appear here, in `rte_production_units/units.json`, and in EDF Open Data.
Turning on two layers draws the same station twice, sometimes a few hundred
metres apart, and that disagreement between publishers is a fact worth seeing
rather than one worth hiding.
