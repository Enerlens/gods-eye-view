# Test fixtures

- `schools-annuaire-sample.json` — 15 real rows from
  `data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education`,
  captured 2026-09-01 with the projection's own field selection. Chosen so that
  each row is awkward in a different way: two REP+ écoles, a lycée under the
  ministry of Agriculture, an EREA, a médico-social, a service administratif
  with a parent UAI, two rows geocoded only to `Ville` (the commune centroid),
  two sub-UAI SECTIONS (SEGPA and SEP) that share a coordinate with their
  parent, a La Réunion maternelle the metropolitan polygons cannot hold, and
  one row with no `type_etablissement` at all. Used by `schoolsFeed.test.mjs`
  and `schoolsDepartements.test.mjs`; a synthetic fixture would have none of
  those and would pass regardless of what the modules do. Licence Ouverte 2.0.

- `tomtom-flow-austin-12-935-1686.pbf` — one real TomTom traffic-flow vector
  tile (Mapbox Vector Tile protobuf, layer `"Traffic flow"`), downtown Austin
  z12 x935 y1686, captured 2026-07-16 from
  `api.tomtom.com/traffic/map/4/tile/flow/relative/12/935/1686.pbf`
  (22,980 bytes). Used ONLY by `src/data/flowTiles.test.mjs` to pin MVT
  decoding offline — it is a point-in-time congestion snapshot, not a bundled
  data layer, and is never served to the app. © TomTom.

- `vigicrues-infovigicru-sample.geojson` — three real reaches from
  `vigicrues.gouv.fr/services/InfoVigiCru.geojson`, captured 2026-08-26 with
  the collection-level `RefInfoVigiCru` / `DtHrInfoVigiCru` stamps intact and
  each line part truncated to four vertices. Pins the upstream feed shape for
  `vigicruesFeed.test.mjs`; `vigicrues.test.mjs` runs the real projection over
  it to build the proxy payloads it tests against. Licence Ouverte 2.0.

- `hubeau-observations-tr-sample.json` — four real rows from
  `hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr`, captured
  2026-08-26. Deliberately includes one producer-flagged *Douteuse* reading and
  one null-`code_station` site-level row that exactly duplicates a station row
  — the ~49% duplication that silently double-counts a discharge network.
  Licence Ouverte.

- `meteofrance-cartevigilance-sample.json` — the `CDP_CARTE_EXTERNE` vigilance
  product of 2026-08-26T04:00:28Z, trimmed to six domains (the national `FRA`
  roll-up, an orange, a yellow and a green département, a `dd10` coastal strip
  and Corsica) across both échéances. Keeps the product's real type
  inconsistencies — a string `global_max_color_id` beside integer colour
  fields — which is the point. Licence Ouverte 2.0, Météo-France.

- `eco2mix-national-tr-sample.json` / `eco2mix-regional-tr-sample.json` — the
  newest three national rows and 24 regional rows of ODRÉ's `eco2mix-*-tr`
  datasets, captured 2026-08-27 at 07:45Z through the same
  `where=consommation IS NOT NULL` filter the proxy uses. Kept as the raw
  Opendatasoft envelope (`{total_count, results}`) so the projection under test
  reads exactly what the proxy reads. They preserve the product's real type
  inconsistency — `pompage` is an integer nationally and the string `"0"`
  regionally — and an export hour whose commercial balances (−2 893 MW) do not
  sum to its physical one (−3 633 MW), which is the point. Licence Ouverte 2.0,
  RTE via ODRÉ.

- `gas-fr-network-sample.json` — 5 NaTran and 4 Teréga rows of the two ODRÉ
  transmission traces, captured 2026-08-27 through the same `exports/json`
  endpoint the proxy uses, kept as raw rows so the projection under test reads
  exactly what the proxy reads. Every trap in it is real and is the point: two
  Moselle segments that share an endpoint exactly (so chaining is provable), a
  3.5 mm "line" published to 15 decimals, a row with no département at all, and
  from Teréga a `geo_shape: null` row that still carries a `geo_point_2d`, a
  `MultiLineString` in a file that is otherwise all `LineString`, and a Béarn
  line whose third ordinate reaches −705.5 m. Licence Ouverte 2.0, NaTran and
  Teréga via ODRÉ.

- `gas-fr-sites-sample.json` — all 7 annual editions of 2 of the 14 centralised
  gas-fired power stations, and 10 renewable-methane injection points, captured
  2026-08-27. Landivisiau is in there because it is `En projet` in the 2019 and
  2020 editions and `En service` from 2021: it is the row that proves "take the
  first row per site" is a coin flip. The injection slice holds all 3 closed
  sites from a file titled *en service* (each with `site_ouvert: "False"`, the
  string JavaScript coerces to `true`), the one site that publishes no
  coordinates, both network tiers, and both spellings of the planned-increase
  flag. Licence Ouverte 2.0, NaTran / Teréga via ODRÉ.
- `edf-plants-{hydraulique,nucleaire,thermique}-sample.json` — 19 of the 126
  rows of EDF Open Data's three generating-fleet datasets, captured
  2026-08-27 from the portal's `data-fair/api/v1/datasets/{slug}/lines`
  route. Kept as the raw envelope (`{total, results}`) so the projection under
  test reads exactly what the proxy reads; `total` is restated to the trimmed
  row count so the completeness check still sees a whole page. The rows are
  chosen to hold every trap the projection exists for: all six GRAVELINES
  reactor rows (one site, 5 460 MW, one coordinate and one 40 MW reserve
  repeated six times), SAINTE-CROIX's fractional 132.27 MW, GRANDVAL below the
  file's own 100 MW threshold, RANCE with no région at all, KEMBS from 1932,
  and MONTEREAU's single `Gaz naturel/Fioul Domestique` string for two fuels.
  Licence Ouverte 2.0, EDF SA.
- `edf-plants-{hydraulique,nucleaire,thermique}-dataset.json` — the matching
  dataset DESCRIPTORS from the same API, trimmed to the top-level keys the
  projection reads plus their context (`title`, `description`, `license`,
  `temporal`, `spatial`, `bbox`, `count`, `frequency`, `dataUpdatedAt`,
  `page`); the platform bookkeeping around them (permissions, storage, file
  digests, publication sites, and the ~10 KB `schema` array) is removed. They
  preserve the fact the layer is built around — nuclear is a vision consolidée
  au **31/12/2025** while the other two are au **31/12/2023**, so the three
  files are three vintages. Licence Ouverte 2.0, EDF SA.

- `power-grid-osm-sample.json` — a real Overpass answer for the Saclay plateau
  (48.66,2.12 → 48.76,2.26), captured 2026-08-27, trimmed to one way per
  distinct `power`/`voltage` combination plus every substation in the box and a
  spread of pylons. It is kept as a raw Overpass response so the projection
  under test reads exactly what the proxy reads. Every oddity in it is real and
  is the point: the `voltage` tag arrives as a `;` list carrying junk
  (`225000;0`, `63000;0`, `225000;225000;225000;63000`, `400000;225000;90000`),
  RTE's own 225 kV Villeras yard is tagged `substation=industrial` and its 90 kV
  Provence yard carries no `substation` tag at all, an Enedis yard is literally
  named "Poste source Enedis", an SNCF `traction` substation steps 225 kV to
  25 kV, and the Haute-Borne yard is a **multipolygon relation with no `lat`/`lon`
  of its own** — only Overpass's computed `center`. © OpenStreetMap
  contributors, ODbL 1.0.
- `rte-registre-units-sample.json` — 16 real rows of ODRÉ's *Registre national
  des installations de production et de stockage d'électricité* (edition
  30/06/2026), captured 2026-08-28 through the same `records` endpoint
  `scripts/build-rte-units-registry.mjs` pages, kept as the raw Opendatasoft
  envelope. Every trap in it is real and is the point: `puismaxinstallee` is in
  **kilowatts** (1 310 000 for a 1 310 MW reactor) and carries three decimals
  where one plant is split across two groups (Brommat 180 357.261 + 225 642.739
  = 406 000 exactly); a 132 MW **photovoltaic** farm at Ajaccio is filed under
  `filiere: "Thermique non renouvelable"`, so classifying on the filière alone
  paints a solar farm as a thermal station; the Rance **tidal** barrage is named
  `CENTRALE HYDRAULIQUE DE RANCE`; six overseas and Corsican units publish the
  literal name `Confidentiel` with no `postesource`; Brommat and Sarrans are two
  different plants in the SAME commune with two different `postesource` codes;
  Émile-Huchet is one `postesource` holding both coal and gas groups; and the
  names arrive in four grammars, with the article parked at the end
  (`TRICASTIN (LE)`, `AIGLE (L )`, `MORANDES (LES)`), a group ordinal glued to
  the site (`BROMMAT-7`), an accented `FERME ÉOLIENNE`, and a `STOCKAGE N0 01`
  that hides its ordinal inside the introducer. Licence Ouverte 2.0, ODRÉ.

- `rte-actual-generation-sample.json` — a **real capture** of RTE's
  `actual_generations_per_unit` v1.1, taken 2026-08-28 through a free account,
  trimmed to 8 of the 152 published units and to the last six published hours of
  each. Every field and every value is verbatim. It replaced a fixture written
  by hand against the contract, and the swap corrected the record: the live
  resource sends **no nulls at all** (0 of 6 992 rows — it simply stops at the
  last published hour, all units in lockstep) and **no `installed_capacity`**
  (0 of 152), so two documented "traps" were reclassified as defensive guards.
  The eight units kept are each one thing the projection exists for: **CHOOZ 1
  at −58 MW** — a shut-down REACTOR buying back its own coolant pumps, which is
  what the negative readings actually are and not the pumped storage the
  hand-written fixture assumed; **GRAVELINES 5 at exactly 0 MW**, an outage and
  the reading `value || 0` erases; **PALUEL 4** at full output; **GRAND MAISON
  10 and 11**, two of the twelve turbine groups RTE publishes inside a plant the
  register carries as one row with a different EIC entirely (trap 9, which cost
  36% of the fleet before it was found); **EMILE HUCHET 6**, joined by EIC like
  every nuclear and thermal unit; **CERNAY**, a grid battery published as
  `production_type: OTHER`; and **DIRINON 1**, a unit the register has never
  heard of by code or by name. RTE, free account required.

- `bdtopo-batiment-sample.json` — three real IGN BD TOPO vector tiles at z15
  (Fourvière `15/16823/11688`, Montmartre `15/16597/11268`, La Défense
  `15/16587/11268`), captured 2026-08-31 from
  `data.geopf.fr/tms/1.0.0/BDTOPO` and trimmed to one feature per distinct
  (`usage_1`, altimetric method, has-roof-altitude, no-Z) combination — 66
  buildings out of 3,240 — with each tile's FULL counts kept beside them. The
  counts are the point: Fourvière publishes `altitude_maximale_toit` for 1,143
  of 1,173 buildings and Paris for 0 of 2,067, which is the asymmetry every
  seating rule in `bdtopoBuildingsFeed.js` exists to handle. Used by
  `src/data/bdtopoBuildingsFeed.test.mjs`. © IGN, Licence Ouverte 2.0.

- `georisques-{rapport,icpe,radon}-sample.json` — three real answers for one
  Paris 13e point (2.3760,48.8300), captured 2026-09-01. The report is verbatim;
  the ICPE page keeps 5 of its 30 rows with `results: 30` left honest, so the
  truncation path is exercised. The trap they hold is the one the layer is built
  on: the hazard families are **objects keyed by hazard, not arrays**, and each
  hazard carries TWO verdicts — `libelleStatutCommune` and
  `libelleStatutAdresse` — which on this point DISAGREE for ICPE ("Risque
  Concerne" against "Risque non Concerne"). A projection that collapsed them
  would manufacture a certainty the source declined to make. The report also
  echoes `codeInsee: "75056"` — Paris whole, not the arrondissement — which is
  the code that breaks DVF. Licence Ouverte 2.0, BRGM.

- `dvf-75113-2024-sample.csv` — 194 of the 3,975 rows of the 2024 Paris 13e
  edition (752,768 bytes whole), captured 2026-09-01. Every trap in it is real
  and is the point. It keeps mutation `2024-1225294` **entire — all 179 rows**,
  one building sold for €32,000,000 with the price restated on every row: the
  naive column sum inflates the fixture more than ninefold and the full edition
  from €0.89 bn to €15.33 bn, and dividing the first row's price by its 25 m²
  flat gives €1.28 million per square metre. Beside it are a mutation with no
  coordinate, one with no `valeur_fonciere`, three ordinary Appartement +
  Dépendance sales (the case that must stay comparable — requiring a bare
  dwelling drops 35 comparables to 10), a flat sold with a shop (which must
  not), two Maisons, and an **Echange declared at €2,295** that divides to
  66 €/m² and would drag any thin-radius median through the floor. Licence
  Ouverte, DGFiP via Etalab.

- `ademe-dpe-existant-sample.json` — 6 rows of `dpe03existant` (15,476,290 rows
  whole), captured 2026-09-01 through the exact URL `buildDpeUrl()` produces, so
  the projection under test reads what the proxy reads. `total: 2805` is kept
  against 6 served rows, which is the gap the layer exists to be honest about.
  Two upstream behaviours are pinned by it: `_geopoint` is `"lat,lon"` — the
  inverse of the `geo_distance` argument order — and data-fair **omits null
  columns entirely** rather than sending null, so the absent `annee_construction`
  is data, not a schema change. Licence Ouverte, ADEME.

- `ign-isochrone-{pedestrian,car}-sample.json` — two rings from the same point
  and the same 600 seconds, captured 2026-09-01. The PAIR is the fixture: 0.97 km²
  on foot against 16 km² by car, 24 vertices against 437. `resourceVersion` is
  deliberately not asserted on — it moved between two probes on the same day
  (2026-08-26, then 2026-08-25). Licence Ouverte 2.0, IGN.

- `gpu-{zone-urba,assiette-sup-s}-sample.json` — one APIcarto answer per
  endpoint for the same Paris 13e point, captured 2026-09-01. Inner rings are
  dropped (the projection reads outer rings only) and the largest easement is
  trimmed from 759 polygons to 30, which still exceeds the 24-ring per-feature
  budget so both simplification paths stay exercised. The live figures they
  stand for: 1,396,720 bytes for ONE point, of which a single `pm1` feature is
  50,669 vertices across 759 polygons published to 8 decimal places — a
  millimetre. They also pin that a servitude has **no `categorie` field**; the
  type is `suptype` (`ac1`, `t1`, `pm1`, `t5`…). Licence Ouverte 2.0, IGN.

- `idfm-{arrets,lignes}-sample.json` — 12 of 43 stops from a box around the same
  point, and 12 of 2,121 lines, captured 2026-09-01. The stops keep all four
  published accessibility values (`true`, `false`, `partial`, `unknown`), which
  all appeared inside that one box; `unknown` must project to null, because a
  stop nobody surveyed is not a stop known to be inaccessible. They also pin
  that `arrgeopoint` is an **object** `{lon, lat}` (unlike the ADEME string) and
  that the arrondissement INSEE code lives in `arrpostalregion` (`"75113"`) —
  the code DVF needs and that every commune-level source answers 75056 for. The
  lines carry their **official liveries**: metro 5 is `#ff5a00` with black text.
  ODbL 1.0, Île-de-France Mobilités.
- `bison-fute-evenementiel-sample.xml` — 9 real situations (16 records) of the
  national DATEX II road-event aggregate
  `tipi.bison-fute.gouv.fr/.../Evenementiel-DIR/grt/RRN/content.xml`, captured
  2026-08-31 at its own `publicationTime` of 21:13:26.825+02:00, with the SOAP
  envelope and publication header kept verbatim so the projection under test
  reads exactly what the proxy reads. Nine of 286, chosen to hold every trap
  and seven of the eight drawn categories. Each is one thing the projection
  exists for: **260830-002035**, an accident on the N94 that also publishes the
  lane closure it caused — the situation that proves one incident must not be
  drawn twice; **260131-000090**, a rockfall opened on 31 January whose validity
  window has **no end time at all** and which only `lifeCycleManagement/end`
  closes, so reading the window alone leaves a landslide on the N20 for seven
  months; **260122-001698**, roadworks ordered for **1 October** that carry a
  closure and a diversion of their own; **260722-001613**, a `roadClosed`
  segment, which is the only way to tell a closure from a restriction inside
  one DATEX II class; **260113-001342**, a situation that is nothing but
  diversions *and* publishes an `internalNote` comment — the operator's message
  to their own district, which the projection reads and drops; plus a queue at
  Calais, snow closing the col du Glandon, a landslide cutting the D21, and
  live roadworks. Licence Ouverte 2.0, DIR via Bison Futé / Tipi.
- `irve-bornes-grouped-sample.json` — 31 grouped rows of ODRÉ's `bornes-irve`,
  captured 2026-08-27 through the same `group_by` the proxy uses, holding 311
  real points de charge across 12 coordinates. Kept as the raw Opendatasoft
  envelope (`{total_count, results}`) so the projection under test reads exactly
  what the proxy reads. Every trap in it is real and is the point: Q-Park's
  Grande Arche car park (224 charge points on one coordinate), the same Belib'
  and ENGIE Vianeo sites published twice under a second operator name, a
  Brétigny-sur-Orge site published at six decimals by one feed and seven by
  another, `puissance_nominale` of 7 360 in a kilowatt column, a 0 kW row at
  exactly (0, 0), a QOVOLTIS site whose verified commune is Le Porge but whose
  coordinate is south of Madagascar, Mac-Roman mojibake in `condition_acces`,
  and four spellings of a boolean in one file. Licence Ouverte 2.0,
  transport.data.gouv.fr via ODRÉ.
