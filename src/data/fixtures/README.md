# Test fixtures

- `sitadel-12202-sample.json` — real rows from the SDES's DiDo API for Rodez
  (INSEE 12202), captured 2026-09-02 with the projection's own per-file column
  selection. Two families, deliberately: six `logements` rows chosen so that
  all four `ETAT_DAU` values appear (2 autorisé, 4 annulé, 5 commencé,
  6 terminé) alongside a row with no house number, a row with no parcel
  reference and a row carrying two, plus three `demolir` rows — which exist to
  pin the trap that the four Sitadel files DO NOT share their key column names
  (`NUM_PD`/`ETAT_PD` here, and no site-progress columns at all). Used by
  `adsFeed.test.mjs`; a synthetic fixture would agree with whatever the module
  assumed. Licence Ouverte.

- `cadastre-64547-lineage-sample.json` — the real division this chain was
  written from: Ustaritz (INSEE 64547), parcel **AN 221**, captured 2026-09-02
  from `cadastre.data.gouv.fr`. Carries the parent as the 2021-02-01 edition
  published it, today's AN 511 / 512 / 513 that came out of it, and — this is
  the part a synthetic fixture would get wrong — **five neighbours that must
  NOT be collected**: AN 222, AN 224, AN 514, AN 515 and AN 516 sit metres away
  and every one of them is caught by a polygon-intersection test, because the
  archived outline and the current one share no vertices. Also the buildings of
  both editions over those three lots (two before, three after: AN 512 goes
  from zero to one) and the commune's BAL numbers for the impasse, which is
  where `18 → AN 0512` comes from. 7,5 KB. Used by `cadastreLineage.test.mjs`.
  Licence Ouverte.

- `ads-portals-sample.json` — real rows from the three métropole ADS portals,
  captured 2026-09-02, each chosen for a different way of being awkward. Paris:
  a dossier published at Lambert-93 `(0, 0)` — whose `geo_point_2d` reprojects
  to a well-formed coordinate off São Tomé — plus one under instruction, one
  refused, one accorded and one modificatif. Nantes: a row with `<br/>` inside
  a plain-text field, one under instruction, one decided — and an INTEGER
  commune code.

  Seven of the eight **Bordeaux** rows carry `geo_shape`, the only published
  geometry in this layer, and each is a different way for a polygon to be
  awkward: a clean single-parcel PC and a PD; a *certificat d'urbanisme* whose
  outline must never be drawn because the projection excludes the kind; the
  three dossiers `DP 033 281 24 Z0785`, `DP 033 281 26 00295` and its `M01`,
  which name the same three parcels and publish **byte-identical geometry** —
  they are the deduplication test, and they each carry a second ring of
  11 cm² (`ORA-13349`) that the sanitiser deliberately KEEPS, because it is
  genuinely inside the parcel and no rule here throws away a shape for being
  small; `PC 033 119 22 Z1055` (`ORA-13356`), which writes four of its fourteen
  vertices twice in a row; and `PC 033 063 24 Z0140`, flagged and published
  with **no geometry at all but a valid point**, which is the fallback. Their
  `refcad` is array-valued as only this portal's is, and none carries a
  decision column because the file has none.

  Used by `adsFeed.test.mjs`, `adsUrbanisme.test.mjs` and
  `ringGeometry.test.mjs`. Paris rows are **ODbL 1.0**; the other two are
  Licence Ouverte.

- `ban-geocode-12202-sample.csv` — the real answer the BAN's bulk
  `search/csv/` endpoint returned for the nine `sitadel-12202-sample.json`
  addresses, captured 2026-09-02: three `housenumber`, four `street`, two
  `not-found`, and a quoted `result_context` containing commas — which is what
  makes it a test of the quote-aware parser rather than of `split(',')`. Its
  `ref` column carries the SERIES-qualified ids (`sitadel:DAU:…`,
  `sitadel:PD:…`) the projection actually sends, so the join it pins is the one
  the proxy performs. Licence Ouverte.

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

- `geoapi-communes-75-epci-sample.json` / `geoapi-arrondissements-75-sample.json`
  — the two halves of the one case that breaks a naive commune join, captured
  2026-09-02 from `geo.api.gouv.fr`. The first is Paris as
  `/departements/75/communes` answers it: ONE polygon, carrying `codeEpci`
  (200054781, the Métropole du Grand Paris), its 532-vertex ring kept every
  twelfth point and closed. The second is `?type=arrondissement-municipal`,
  which is a SEPARATE request and the only way the arrondissements exist at
  all — with their real 55- and 40-vertex rings and, crucially, **no
  `codeEpci` at all**, which is why `projectPeTerritoires` has to lend them
  their parent's. Used by `petiteEnfanceFeed.test.mjs`. Licence Ouverte 2.0.

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

- `gpu-zone-urba-enclaves-sample.json` — the WHOLE, untrimmed `zone-urba`
  answer for one point in the centre of Ustaritz (64547), captured 2026-09-01
  (19,999 bytes). One feature, zone `UB`, one polygon, and **two interior
  rings** — 6,646 m² that the same PLU zones `UE` (the school) and 50,686 m²
  that it zones `UYc` (the industrial estate). It is here because the two Paris
  fixtures above were captured with their inner rings STRIPPED, back when the
  projection read outer rings only: they cannot fail if holes are dropped
  again, and this one can. It is the answer behind the operator's question —
  "how can one house be in two PLU zones at once?" — which was this layer
  filling both enclaves with a rule that does not apply to them. Licence
  Ouverte 2.0, IGN.

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

- `cadastre-parcelle-sample.json` — nine real parcels and the nine cadastral
  sheets they sit on, captured 2026-09-01 from `apicarto.ign.fr/api/cadastre`
  (`parcelle` and `feuille`), kept as the two raw FeatureCollections the proxy
  itself fetches so the projection under test reads exactly what the proxy
  reads; each envelope's totals are restated to the trimmed feature count so the
  truncation check still sees a whole answer. Geometry is verbatim — it is the
  thing under test. Every parcel is one trap and each is real. **`69382000AL0005`
  and `69385000AL0005`** are the pair the whole sheet join exists for: same
  commune (Lyon, 69123), same section `AL`, same feuille `1`, different
  arrondissement — and one is drawn at **1:500** while the other is at
  **1:1000**, so a four-part join gives them a coin-flipped tolerance.
  **`75103000AP0045`** is prefixed `75103` while its `code_insee` is `75056` —
  the arrondissement-coded IDU that 38% of urban France carries.
  **`75101000AJ0002`** is the Palais-Royal, whose interior ring is the
  difference between matching its declared contenance inside 1% and missing it
  by more than 5%. **`132038120D0037`** is one identifier over two disjoint
  polygons, with a digit-prefixed section and a non-zero préfixe.
  **`97611000AY1015`** publishes `contenance: null` and **`67365000220739`** an
  Alsace-Moselle numeric section `22` with `contenance: 0` over a real 0,109 m²
  spike — the two values `Number(null) === 0` would make indistinguishable.
  **`31555815AB0207`** draws 494 m² against 153 m² declared, and
  **`401340000D0049`** is 26,7 ha of Landes forest on a 1:5000 sheet, the
  coarse end of a twentyfold spread. Used by `src/data/cadastreFeed.test.mjs`
  and `src/data/cadastreParcels.test.mjs`. PCI vecteur © DGFiP via IGN Api
  Carto, Licence Ouverte 2.0.

- `comptages-hour-geojson-sample.json`, `comptages-profil-semaine-sample.json`,
  `comptages-profil-weekend-sample.json`, `comptages-etat-barre-sample.json`,
  `comptages-arcs-sans-filtre-sample.json` — thirteen real Paris counting arcs of
  the week 2026-08-24 → 2026-08-30, captured 2026-09-01 through the exact URLs
  `comptagesParisProxy()` builds against
  `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents`
  (the GeoJSON export pinned to the week's closing hour, the two
  `group_by=iu_ac,hour(t_1h)` profiles, and the `group_by=iu_ac,etat_barre`
  roll-up), kept in the raw Opendatasoft envelope with totals restated to the
  trimmed row count. Every arc is a distinct trap: **8 counted** (5298 busier at
  the weekend than on a weekday, so the two sparklines must share one scale;
  5266 the longest geometry at 12 vertices; 525 carrying both an unmeasured hour
  and a measured zero in the same 24; **7279 and 5201 counting with
  `"geometry": null`**, the case that must be reported rather than placed),
  **1 occupancy-only** (arc 1, which publishes `k` and never `q` — the state
  that must not be given a flow band), and **4 silent** (25, 284 and 5 declared
  *Invalide*, 257 silent *and* unplaced). `comptages-arcs-sans-filtre-sample.json`
  additionally carries the literal `iu_ac: "*"` junk group that
  `group_by=iu_ac` returns, so the phantom filter is tested against the real
  thing. Used by `src/data/comptagesFeed.test.mjs`,
  `src/data/comptagesRhythm.test.mjs` and `src/data/comptagesParis.test.mjs`.
  © Ville de Paris, Open Database License (ODbL).

- `ssmsi-communes-sample.csv`, `ssmsi-departements-sample.csv`, `ssmsi-dataset-sample.json`, `geoapi-communes-75-sample.json` and `geoapi-communes-2b-sample.json` — the SSMSI recorded-crime bases and the contours they are joined to, captured 2026-09-02 through the exact URLs `delinquanceFranceProxy()` builds. **`ssmsi-communes-sample.csv`** is 300 real rows (36,201 B) of the 5,238,000-row commune base, kept in the raw upstream envelope — `;`-delimited, decimal comma, `NA` nulls, header `CODGEO_2026` verbatim, no BOM — over 18 communes: **01071 Cessy across 2023-2025**, which published 16 *Vols de véhicule* in 2023 and is withheld in 2024 and 2025 and so refutes the « entre 1 et 5 faits » gloss on its own; **2B242 Poggio-Mezzana**, one of the 7 communes in France with all fifteen indicators withheld; **55039 Beaumont-en-Verdunois**, a *village détruit* with `insee_pop = 0` whose published zeros carry `taux_pour_mille = NA`; **75056 Paris (393 *Vols avec armes*) with 75104 (withheld, departmental mean 4.5) and 75108 (18)**, the subtraction trap; **13055 Marseille with 13002 and three withheld arrondissements (13204, 13207, 13216)**, the only département-indicator pair in the fixture carrying two distinct departmental means (1.2096774 against 11.0); **93015 Le Bourget**, whose withheld *Usage de stupéfiants (AFD)* cell carries a departmental mean of 22.33; and **2A004 / 97101** for the Corsican and overseas département-code slices. Folded to 2025 it yields 184 published, 26 zero and 60 withheld cells. **`ssmsi-departements-sample.csv`** is 504 rows (55,803 B) with the UTF-8 BOM intact, 14 départements × 18 indicators × 2024-2025, carrying the Cher (the rate-not-count argument), four published zeros, Corsica as `2A`/`2B`, and four overseas codes with no metropolitan polygon. **`ssmsi-dataset-sample.json`** is the data.gouv.fr envelope with the resources trimmed from 11 to the 4 that matter and the upstream count restated. **`geoapi-communes-75-sample.json`** is the complete untrimmed Paris response (11,236 B, one 532-vertex ring, 20 SSMSI arrondissements with no contour). **`geoapi-communes-2b-sample.json`** is five Haute-Corse communes including Galéria's 2,897-vertex outline, L'Île-Rousse's five parts and Calenzana's enclave ring. Read by `delinquanceFeed.test.mjs`, `delinquanceDepartements.test.mjs` and `delinquanceFrance.test.mjs`. Licence Ouverte 2.0 (SSMSI, ministère de l'Intérieur; IGN/Etalab for the contours).

- `anfr-observatoire-sample.json`, `anfr-catalogue-sample.json`, `anfr-nature-sample.json`, `anfr-das-sample.json`, `anfr-cartoradio-sample.json` — ANFR, captured 2026-09-01 through the exact URLs `anfrFranceProxy()` builds, Licence Ouverte 2.0. **observatoire**: 216 verbatim CSV rows (with the UTF-8 BOM and the LF-only line endings) cut from the 181,988,412-byte `20260827182212_observatoireod_20260827.csv`, restated as `rows: 216` beside the upstream's own `upstreamRows: 826418`. Its 15 supports are each a distinct trap — 278838 is `Projet approuvé` on all 8 rows (a project that must never be coloured as a generation), 325857 publishes a height of `0`, 241823/1017893/2883667 carry French decimal commas in `sup_nm_haut`, 449714 mixes `Techniquement opérationnel` 5G over `En service` 2G/3G/4G and has a project re-filed on a band already on the air, 506104 is the one support in France with five operators, 26969 is Corsican (`02B`), and 22132/52850/628433/506104 are Nouvelle-Calédonie, La Réunion, Wallis-et-Futuna and Saint-Barthélemy — the DOM/COM a `sta_nm_dpt` code join loses. **catalogue**: 3 of the portal's 9 datasets with their full `extras`, including the weekly `file_csv` URL, `records_count` `{"88ef0887-…":"0000826418"}`, and the DAS entry whose advertised `1232` contradicts its own datastore's `1230`. **nature**: the verbatim 785-byte `SUP_NATURE.txt` member of the 4,805-byte reference archive, 38 CRLF rows including the placeholders `0;Sans nature`, `51;XXX` and `999999999;Support non décrit`. **das**: 8 of the 1,230 SAR rows, chosen for the null head/trunk values, the decimal-comma `3,01` and the literal `"< 2W/kg(**)"`, with `upstreamTotal`/`upstreamConforme`/`upstreamNonConforme` recorded beside them. **cartoradio**: the full site, antennas, 300 m measurement list, the 2009 report (0.0 V/m, protocol ANFR/DR 15-2.1) and a 2024 one (0.55 V/m) for support 449714 — the pair that proves the *predates the equipment* flag fires and clears. Read by `anfrFeed.test.mjs`, `anfrMesh.test.mjs` and `anfrFrance.test.mjs`.

- `fraicheur-espaces-verts-sample.json`, `fraicheur-equipements-sample.json`, `fraicheur-fontaines-sample.json` and `fraicheur-arbres-sample.json` — 21 + 21 + 20 + 18 real rows captured 2026-09-01 through the exact `exports/geojson` URLs `fraicheurParisProxy()` builds against `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/{ilots-de-fraicheur-espaces-verts-frais,ilots-de-fraicheur-equipements-activites,fontaines-a-boire,les-arbres}`, kept in the raw GeoJSON `FeatureCollection` envelope the export returns and carrying no geo field in the properties (the export emits the geometry regardless, and naming it doubles the wire). Every row is a distinct trap. **Green spaces**: both geometry branches (Polygon and MultiPolygon, one of 32 parts and one with interior rings), `canicule_ouverture = "Oui"` with `indice_veget_sup8m_2024 = 0` and `surf_veget_sup8m_2024 = null` (the heatwave-open planter with no canopy), `indice` null (the grey band), `surf` a published `0` that is NOT null, `type` null, two rows sharing `identifiant: ID1598` and two publishing none, two sharing `nsq_espace_vert: 10132`, the expired `du 01/05/26 au 31/08/26` window on 11 rows, a one-day window `du 14/07/26 au 14/07/26`, a prose `horaires_periode`, and one sliver ring that falls below a triangle at 1 m. **Equipment**: `MU75` used twice for two different museums, the dataset's 50-character prose disclaimer sitting in `horaires_lundi`, the colon format `09:00 - 18:00`, `8h - 11h30` and `10h - 17h30` without closing minutes, `du 01/01/20 au 01/01/32`, `à partir du 01/02/26`, an expired `du 05/07/25 au 31/08/25`, `statut_ouverture: "Eteint"` and `"Ouvert"` on two brumisateurs, `payant` null, and at least one row from each of the five mechanism families. **Fountains**: all four truncated `type_objet` codes (`FONTNE_WALLACE`, `FTNE_PETILLANTE`, `FTNE_POING_EAU`, `FTNE_MILLENAIRE`), the three misting `modele` values, `modele` null, an outage whose `fin_ind` is already past (`APP SANS EAU`, out since 2023-12-20), an outage still inside its window, `fin_ind` null, and four rows outside Paris (Pantin, Thiais, Saint-Ouen). **Trees**: `hauteurenm = 0` with `circonferenceencm = 0`, height 0 with a girth of 12, `libellefrancais` null, `espece` null, `remarquable` OUI / NON / null, three rows carrying the concatenated `"Jeune (arbre)Adulte"` stage, and eight of the ten `domanialite` codes. Used by `src/data/fraicheurFeed.test.mjs`, `src/data/fraicheurTrees.test.mjs` and `src/data/fraicheurParis.test.mjs`. © Ville de Paris and © Eau de Paris, Open Database License (ODbL).

- `sitadel-logements-44109-sample.json` (10 rows, 6 358 B), `sitadel-demolir-44109-sample.json` (4 rows, 1 726 B), `sitadel-logements-75056-sample.json` (4 rows, 2 536 B) and `sitadel-logements-31555-sample.json` (3 rows, 1 955 B) — real DiDo `/json` answers captured 2026-09-02 through the exact URLs `sitadelDatafileUrl()` builds (`…/datafiles/8b35affb-55fc-4c1f-915b-7750f974446a/json?COMM=eq:44109&columns=…` and the demolition rid `1a9a2f0c-56fe-4e69-84a7-fbbda2121f02`), trimmed from 2 049 / 1 587 / 3 595 / 3 846 rows. The envelope is a bare JSON array, which is what DiDo returns. Each row is one trap: `0441091200392` two references on one permit (27 dwellings, 2 demolished); `0441091200498` a 2013 permit with DOC and DAACT whose three parcels are gone from today's cadastre; `04410917A0172` no cadastral reference at all with `SUPERFICIE_TERRAIN` 0; `0441091200686` a declared terrain of 17 m² against a 700 m² parcel, so the area audit must print DISCORDANT (ratio 41,24); `0441091400483` the commune's largest permit at 553 dwellings — and unplaceable; `0441092600876` a DP creating zero dwellings with a DAACT and no DOC; `0441091200506` `ETAT_DAU` 5; `0441091200600` `ETAT_DAU` 4; `0441092500325` the double-encoded street name; `04410918A0168` three references in one section. Demolitions: `0441092600086` has `NUM_CADASTRE1` as a JSON **number** and `SUPERFICIE_TERRAIN` as a JSON **string** (the inverse of the housing file); `04410921A0030` is `ETAT_PD` 6 and must still colour as a demolition; `0441092500139` has no reference and terrain `"0"`; `04410914A0001` has a single-character section `"Z"` with a numeric numéro. Paris: `07510523V0019` is COMM 75056 with the arrondissement only in `NUM_DAU` (075105), three references across two sections and 583 dwellings; `07511611V0039` resolves through postal code 75016 → 75116; `07512012V0029` proves the expansion is not Paris-5-only; `07510312V0013` has no reference and no address. Toulouse: `03155513C0484` names section AB numéro 69, which 34 different parcels answer to — it must be reported ambiguous, never placed; `03155512C0210` and `03155513C0343` place. Licence Ouverte (SDES/CGDD). Read by `sitadelFeed.test.mjs` and `sitadelFrance.test.mjs`.
- `sitadel-cadastre-44109-sample.json` (14 parcels, 17 555 B), `sitadel-cadastre-75056-sample.json` (5 parcels, 4 506 B) and `sitadel-cadastre-31555-sample.json` (42 parcels, 41 439 B) — real Etalab `FeatureCollection`s captured 2026-09-02 from `https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/<dd>/<insee>/cadastre-<insee>-parcelles.json.gz` (edition 2026-06-01, resolved from the `latest` 302), trimmed from 58 099 / 78 154 / 91 938 features to exactly the parcels the permit fixtures reference. The Toulouse file is the big one on purpose: 34 of its 42 features share the key `31555AB0069`, which is the préfixe ambiguity in a form a test can assert on. The Paris file holds parcels keyed `75105`, `75116` and `75120` — never `75056`, which is the only code Sitadel publishes. Licence Ouverte (DGFiP). Read by both test files.
- `sitadel-dido-dataset-sample.json` (14 172 B) — DiDo's dataset record for `6513f0189d7d312c80ec5b5b`, captured 2026-09-02 from `https://data.statistiques.developpement-durable.gouv.fr/dido/api/v1/datasets/6513f0189d7d312c80ec5b5b` (143 422 B upstream, trimmed by dropping the four `millesimes[].columns` arrays of 94/93/36/33 entries; every `rows` count is intact and they sum to 3 020 749). It is what `discoverSitadelRid` and `newestMillesime` are driven against: four datafiles, `license: "fr-lo"`, `frequency: "monthly"`, `frequency_date: "2026-09-29"`, millésime `2026-08`. Licence Ouverte (SDES/CGDD). Read by `sitadelFeed.test.mjs`.
- `sitadel-commune-44109-sample.json` (38 673 B) — the `geo.api.gouv.fr` answer for the point under central Nantes, captured 2026-09-02 through the exact URL `geoCommuneUrl(47.2184, -1.5536)` builds (`/communes?lat=&lon=&fields=nom,code,departement,region,population,contour&format=json`). One commune, with the 804-vertex `contour` the layer draws as the scope of its answer. The `contour` field is also the input guard: an out-of-range latitude on this URL answers HTTP 400 rather than the whole 34 945-commune list. Licence Ouverte (Etalab / INSEE / IGN). Read by both test files.

- `idfm-frequence-identite-sample.json`, `idfm-frequence-profil-04-09-sample.json`, `idfm-frequence-profil-10-15-sample.json`, `idfm-frequence-profil-16-21-sample.json`, `idfm-frequence-profil-22-27-sample.json` — one viewport of `offre_hebdomadaire_moyenne_hors_vacances`, captured 2026-09-02 through the exact URLs `buildIdentityUrl` and `buildProfileUrl` build for the box `48.8270,2.3160 → 48.8330,2.3280` (Alésia, Paris 14e): the identity call and its four band windows. Trimmed from 24 identity rows / 480 profile rows to **7 identity rows over 6 stops and 28 + 36 + 36 + 27 profile rows**, with `total_count` restated to the trimmed count; every kept stop holds a distinct trap. **23613** publishes TWO names — "Alésia - Général Leclerc" and "Les Plantes" — at a byte-identical coordinate, so a fold keyed on the name would draw one stop twice with part of its service each; **23611** is a DIFFERENT stop 88 m away that is ALSO signed "Les Plantes", so a fold that merged on the name would delete it; **22154** and **463118** are the two "Alésia" métro entries 9.1 m apart with different service (22 bands ending at 25 against 21 ending at 24), and 22154 carries a rate of **0.1** courses in band 26 on a Monday, which whole-number rounding would turn into "nothing runs"; **36547** runs through band 27 (03:00–03:59), proving the operating day is not 0..23; and **23997** publishes only 19 of the 24 bands and stops at 23. Read by `idfmFrequencyFeed.test.mjs` and `idfmFrequency.test.mjs`. Licence Ouverte v2.0 (Etalab) — Île-de-France Mobilités.
- `idfm-frequence-region-sample.json` — the whole-région aggregate from `buildRegionBandsUrl`, captured 2026-09-02, trimmed from 356 rows (73,723 bytes, all 17 `code_departement` buckets) to **96 rows: 75 (the densest), 77 (the widest), 60 (a fringe département with 87 stops) and the NULL bucket**, 24 bands each, `total_count` restated. The NULL rows are the trap: the portal's own facet UI shows them as "None" and `where=code_departement="None"` returns HTTP 200 with zero rows, so the fold must key `null` and `"None"` to one bucket or lose 549 stops silently. Read by `idfmFrequencyDepartements.test.mjs` and `idfmFrequency.test.mjs`. Licence Ouverte v2.0 (Etalab).
- `idfm-frequence-arrets-60-sample.json` — the COMPLETE, untrimmed stop enumeration for `code_departement="60"` from `buildRegionStopsUrl`, captured 2026-09-02: **87 rows, 87 distinct stops, 8,675 bytes**. Untrimmed because the count IS the datum — it is the divisor of that département's rate and the number that keeps it below the 1,000-stop paint threshold. One of the 87 falls inside the Val-d'Oise IGN outline rather than the Oise's, reproducing the region-wide 1.51 % code/geometry disagreement in a single fixture. Read by `idfmFrequencyDepartements.test.mjs`. Licence Ouverte v2.0 (Etalab).
- `idfm-frequence-sans-coordonnees-sample.json` — the null-`code_departement` bucket from `buildRegionStopsUrl({ code: null })`, captured 2026-09-02, trimmed from **549 rows to 8** (the first six in id order plus the last two, so the slice still spans the bucket), `total_count` restated. Every row has `latitude_arret` and `longitude_arret` null — 549 of 549 do upstream — which is the trap: these stops are counted and named and must never be placed. Read by `idfmFrequencyDepartements.test.mjs`, `idfmFrequencyFeed.test.mjs` and `idfmFrequency.test.mjs`. Licence Ouverte v2.0 (Etalab).

- `bruit-peb-lfpz-sample.json` (6 214 B, 4 features), `bruit-peb-lebourget-sample.json` (15 041 B, 2), `bruit-peb-lfmd-sample.json` (4 605 B, 2), `bruit-peb-lfna-sample.json` (1 007 B, 1), `bruit-peb-lfdc-sample.json` (1 333 B, 1), `bruit-peb-empty-sample.json` (137 B, 0) and `bruit-pgs-lfpg-sample.json` (7 393 B, 1) — raw Géoplateforme WMS-V `GetFeatureInfo` responses captured 2026-09-02 through the exact URL `buildBruitProbeUrl()` builds (`https://data.geopf.fr/wms-v/ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=dgac_peb_plan_wmsv&…&CRS=EPSG:4326&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=application/json&FEATURE_COUNT=24`), untrimmed. One trap each: **LFPZ** at 48,81025 / 2,07712 is the winner rule — zone A and zone B of ONE plan both containing the point, each published TWICE (id_map 649/652 and 650/653) with the duplicates disagreeing about `producteur` (DSAC N vs ADP) and `date_maj` (null vs 2017-05-23Z), all four on a 1985 arrêté so the values 89/96 are *indice psophique* and not decibels. **LFPB** is two AIRPORTS at one point (LFPB zone A arrêté 2017 + LFPG zone D arrêté 2007) and the heaviest response in the register, 664 vertices in zone D alone. **LFMD** publishes both its bands INVERTED (`indldenext` 70 over `indldenint` 65, and 65 over 57) and has zone B under the probe with zone C beside it. **LFNA** is the stale date: `date_arret` 1985-07-01 against `ref_doc` `PEB_LFNA_11_04_2017.pdf`, so the unit is Lden and not psophique. **LFDC** is the one `ref_doc` in 298 carrying a literal space, `PEB_LFDC_ 28_07_1986.pdf`. **empty** is Toussus-le-Noble's 137-byte empty FeatureCollection — an arrêté with no polygon at any scale. **PGS** is the sibling schema: `indice_lde` 55 as an INTEGER, `indice_l_1`, `date_arrete` (not `date_arret`), zone "3". Plus `bruit-arrete-index-sample.json` (3 759 B) — the `dgac_peb_arrete_wfs` register from `buildPebArreteIndexUrl()`, trimmed from 224 rows to 12 with `totalFeatures`, `numberMatched` and `numberReturned` restated to 12 so the projection reports it `short: true`: LFMI (oldest, 22/08/1974), LFSN (newest, 20/06/2022), LFPG, LFPB, LFPZ, LFPN (arrêté, no polygon), LFNA, LFDC, LFMD, LFSB (the `nom` echo “LFSB - BALE”), FMEE (55,5°E) and SOCA (−52,4°W). Read by `src/data/bruitFeed.test.mjs`, `src/data/bruitArretes.test.mjs` and `src/data/bruitFrance.test.mjs`. Licence: `<Fees>none</Fees>` under the cartes.gouv.fr CGU; © DGAC, diffusion Géoplateforme/IGN.

- `amenities-bpe25-sample.csv` / `amenities-finess-sample.csv` — 26 + 17 lignes réelles capturées le 2026-09-02, dans l'enveloppe brute des deux amonts (point-virgule, 95 et 35 colonnes, en-tête verbatim). BPE : `https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.zip` (142 884 474 octets, membre unique `BPE25.csv` de 1 515 251 530 octets, 2 921 770 lignes) ; FINESS : `https://data-pipeline-open.s3.sbg.io.cloud.ovh.net/finess/finess_etablissements.csv` (44 053 043 octets, 103 032 lignes). Chaque ligne porte un piège distinct. Côté BPE : les quatre modalités de `QUALITE_GEOLOC` (11, 12, 21, 22) plus **33 « position aléatoire dans la commune » refusée**, une gendarmerie antillaise en `_Z` partout, un bassin de natation en `QUALITE_XY = _U`, une ligne de **Mayotte sans aucune coordonnée mais avec `EPSG=4471`**, un médecin réunionnais, et un exemplaire de chacun des six codes refusés (B326 irve-fr, C108 schools-fr, C501 sup-fr, D307 FINESS, D106 doublon d'hôpital, E107 transit-fr) plus A504 hors brief — et **trois médecins à la coordonnée identique 48,83801 / 2,34276**, qui est le cas que le repliage par adresse existe pour traiter. Côté FINESS : les cinq CRS EPSG (2154, 5490, 2975, 2972, 4471), les **deux jetons sans préfixe `EPSG:`** (Saint-Pierre UTM 21N, Wallis UTM 1S avec le géocodeur `MAPS 06-11-2024` et un score `.`), une officine géocodée à la commune (refusée), un établissement sans `sourcecoordet`, un CH avec `numuai`, une officine à score < 80, plus un EHPAD et un CHS hors des deux familles. Licence Ouverte (Insee) et Licence Ouverte 2.0 (FINESS). Lus par `src/data/amenitiesFeed.test.mjs`.

- `ips-rentrees-sample.json`, `ips-ecoles-sample.json`, `ips-colleges-sample.json`, `ips-lycees-sample.json`, `ips-erea-sample.json` — the DEPP's *indice de position sociale*, captured 2026-09-02 through the exact URLs the schools-fr proxy builds (`https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/<id>/records?group_by=rentree_scolaire&…` for the discovery and `…/exports/json?select=<ipsSelectFields(spec)>&where=rentree_scolaire="<year>"&limit=-1` for the exports), Licence Ouverte v2.0 (Etalab), publisher « DEPP – Ministère chargé de l'éducation nationale ». **`ips-rentrees-sample.json`** (2 449 B) holds the four datasets' verbatim, untrimmed `{total_count, results}` envelopes side by side with the URL each came from — that is the fixture for the trap, because they DISAGREE: `fr-en-ips-ecoles-ap2022` newest is **2024-2025 (32 494 rows)** where `fr-en-ips-colleges-ap2023` (7 089), `fr-en-ips-lycees-ap2023` (3 662) and `fr-en-ips-erea-ap2022` (77) all reach **2025-2026**, so a single global `max()` returns 2025-2026 and drops every école. The four export fixtures are bare JSON arrays (what `exports/json` returns), trimmed from 32 494 / 7 089 / 3 662 / 77 rows to 4 / 4 / 6 / 2, one distinct trap each. **écoles**: `0010108M` publishes the literal string `"NS"` — the secrecy sentinel on 2 504 rows that `Number() || 0` would draw as an IPS of 0; `0930327A` (Bondy) publishes `"72"`, an integer as TEXT, 22.9 points under its Seine-Saint-Denis reference of 94.9; `0010093W` is a plain `"119.5"`; `0070945P` is in IPS and **absent from the Annuaire**. **collèges**: `0010018P` publishes `ips` as a NUMBER (96.3) where the écoles file publishes text; `0752954D` carries an `ecart_type_de_l_ips` of **7.9**, below the index's own plausibility floor of 20, which is the row that proves the dispersion needs its own window (162 published écarts-types nationally are under 20); `9750025D` (Saint-Pierre-et-Miquelon) publishes `ips: null` AND `ips_national: null` — a row that exists with an empty index and no baseline; `9830313Y` is New Caledonian, absent from the Annuaire, and has a départemental reference but no national one. **lycées** (no `ips` column exists at all): `0312746S` is the widest LPO in France, GT 140.1 against pro 92.4 inside one `ips_etab` of 126.3; `0010099C` is an LP with `ips_voie_gt: null`; `0020031Y` is a LEGT whose `ips_etab` (95.4) is NOT its only voie (GT 97.4) because post-bac is folded in; `0132922F` is a LEGT whose only published voie figure is post-bac; `0754089M` publishes every IPS column null; `1300023U` is the Lycée Comte de Foix in **Andorra la Vella**, in IPS and absent from the Annuaire. **EREA**: both rows carry `nom_de_l_etablissment` (no second 'e') and NOT `nom_de_l_etablissement` — the misspelling that makes a shared `select` list an HTTP 400 rather than a null column — and both have a départemental reference exactly equal to their own index, because there is at most one EREA per département. Read by `src/data/ipsFeed.test.mjs`.
## `meteo-stations-fr-sample.json` — 13 stations from the shipped network

One station for every trap the *Stations météo (FR)* layer is built around, cut
from `local_data/meteo_stations_fr/stations.json`. **TOULOUSE-BLAGNAC** is a
complete synoptic station and **VERIZIEU** is the majority case — temperature
and rain, no wind, no pressure. **ALBA LA ROMAINE** appears in Météo-France's
real-time list and in no metadata file at all, so its `fam` is `null` rather
than `[]`; **MARSILLARGUES** was closed on 2026-01-01 and is still in that same
list. **BOULOGNE-SEM** publishes an open hourly observation and is absent from
Météo-France's SYNOP station list, while **CAP CEPET** is named on that list and
has written nothing all year — the pair that forces `synop` and `live` to stay
separate fields. **AIGUILLE DU MIDI** at 3 845 m and **LA MEIJE-NIVOSE** at
3 093 m are the terrain-clamp cases, **BREIL SUR ROYA** is a rain-only poste,
and **AJACCIO** carries a Corsican `NUM_POSTE` on département `20`. Used by
`src/data/meteoStationsFrFeed.test.mjs`. © Météo-France, Licence Ouverte 2.0.

## `meteo-synop-archive-sample.csv` — 12 rows of the SYNOP archive

Header plus three observations each for four stations, **interleaved** so
"newest wins" cannot pass by accidentally keeping the last row of the file. The
column set is the real one (60+ fields), and the units are the trap: every
temperature is in **kelvin** (`t = 277.05`) and pressure is in **pascals**
(`pmer = 102010`), so a card that printed the published number would be exactly
correct and unreadable. `NOUVELLE AMSTERDAM` is in the sample because the
archive is not metropolitan-only. Used by
`src/data/meteoStationsFrFeed.test.mjs`. © Météo-France, Licence Ouverte 2.0.

## `meteo-ficheclim-31069001-sample.data` — one fiche climatologique

Toulouse-Blagnac's, verbatim. It is a **human-readable French report, not a data
product**: semicolon-padded columns under prose headings, `.` where a month has
no value, and a date row under each record row whose last cell — the annual
column, the one that is read — is a bare year while the twelve monthly cells
carry `DD-YYYY`. The two facts extracted are the records (**42,4 °C in 2023,
−19,2 °C in 1956**) and the window they stand in (**since 1947**), because
without the window the same number means something different at a station opened
in 2004. Used by `src/data/meteoStationsFrFeed.test.mjs`. © Météo-France,
Licence Ouverte 2.0.
