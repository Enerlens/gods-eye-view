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
