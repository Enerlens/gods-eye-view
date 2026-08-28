# Test fixtures

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
