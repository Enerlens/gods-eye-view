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
