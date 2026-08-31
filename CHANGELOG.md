# Changelog

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased] — 2026-08-31

### Added

- **Aéroports: 7 464 places to land, France in full.** A new bundled layer
  draws the world's airports and aerodromes from **OurAirports**, the open
  catalogue its volunteer editors dedicate to the public domain. Cards carry the
  **ICAO and IATA codes**, the class, the **longest open runway** in metres with
  its surface family, and the commune — Roissy at 4 215 m of asphalt, an 82 m
  strip at La Tour-du-Pin, and 7 462 more in between. Bundled with the build, so
  it draws with **no key and no network**.

  The pack is a **selection, and the selection is asymmetric on purpose**:
  worldwide it is every large and medium airport plus everything that sells a
  scheduled seat (which is what keeps Monaco's heliport and the Greenland
  shuttles), while **France and the overseas territories carry the whole long
  tail** — 1 335 fields, altiports, hydrobases and one balloon field included.
  Shipped whole, the catalogue is 86 002 rows and roughly 25 MB of committed
  JSON, 23 196 of them heliports, and in France almost every one of those is a
  hospital landing pad with no ICAO code. The four clauses that decide what
  survives live in `src/data/airportsPack.js` — the same module the layer reads
  back when it writes a card, so the build and the globe cannot disagree about a
  field — and `airports/README.md` states the limit plainly: a small airfield
  missing outside France was **not selected**, and is not evidence of an empty
  sky.

  **Importance is a map channel, not a footnote.** Seven thousand identical dots
  is a wall, and this pack is the opposite of uniform. Two independent fields
  decide how much an airfield matters — OurAirports' editorial **size** class,
  and the hard fact of whether a **timetabled service** calls there — so
  crossing them gives four tiers: **Grand aéroport** (1 172), **Aéroport de
  ligne** (3 175), **Aéroport sans ligne** (1 991) and **Aérodrome & aéroclub**
  (1 126, all of them French, because the clause that admits them is). The tier
  is decided once and then drives everything: the dot size (14 → 6 px), the
  colour ramp, the label ladder, the legend, and **how far out the card stays
  readable** (14 000 km → 200 km). That last channel is the one that fixed the
  real problem: over Île-de-France the shared label grid was awarding fifteen
  cells to aéroclubs and three to Roissy, Orly and Le Bourget, because cells are
  awarded *locally* and a grass strip with no competition always wins its own.
  Priority cannot fix that; range can. The marker is always drawn — only its
  name waits until you come closer.

  Four chips on the layer row cut to the tier you want — `TOUS`, `AÉROPORTS`
  (drops the aéroclubs), `LIGNES` (only what a ticket is sold to), `GRANDS`.
  They are runtime params, **not** share-link state, and the layer keeps
  reporting all 7 464 features while a floor is on: a chip hides markers without
  losing them, the same contract the hydro layer's `floorKw` already follows.
  The legend counts what is **drawn**, not what is loaded, so a hidden tier
  reads 0 and says how many it is holding back rather than quietly overstating
  the picture. The grading itself is generic — `createLocalGeoJsonLayer` now
  takes an optional group/style/filter/legend contract, and the three other
  bundled packs are untouched by it.

  Three values in the pack are easy to misread and are labelled rather than
  cleaned up. `runways.count` counts upstream runway *records*, helicopter lanes
  included — Charles de Gaulle reports 5, of which four are its paved runways.
  `type` is OurAirports' editorial **size** bucket and does **not** map onto the
  French regulatory ladder. And `runways.surface` is a three-value family
  (`revêtue` / `non revêtue` / `eau`) collapsed from 557 free-text spellings
  across 48 203 runways; 22% of features carry no surface at all rather than a
  guess.

- **Every data layer now knows what it is.** A new `src/data/layerTaxonomy.js`
  gives all 28 registered layers a category — **AIR & ESPACE**, **DÉFENSE**,
  **MARITIME**, **MOBILITÉ TERRESTRE**, **ÉNERGIE**, **RISQUES &
  ENVIRONNEMENT**, **RÉSEAUX & CAPTEURS** — plus three facets: coverage
  (`global` / `fr` / `us` / `cities`), auth (`none` / `free-key` / `metered`)
  and cadence (`live` / `periodic` / `static`). The table is cross-checked
  against the registered layer set in BOTH directions at import, so adding a
  layer without categorizing it is a boot failure rather than a row that
  quietly lands in whatever group it was appended next to.
  `DataLayerManager.getAll()` now reports `category`, `kind` and `tags`, and
  the one registered layer that loads nothing of its own — the CONTACTS
  coordinator — is marked `kind: 'coordinator'` so it can never occupy a row or
  inflate a group count. **Nothing changes on screen yet**: the DATA LAYERS
  panel still renders its flat list. This is the data the grouped panel reads.
- **Seven more French cities on the LOCATION tray**, five landmarks each —
  Marseille (Notre-Dame de la Garde, Vieux-Port, MuCEM, Château d'If,
  Vélodrome), Lyon (Fourvière, Bellecour, Confluences, Part-Dieu, Saint-Jean),
  Toulouse (Capitole, Saint-Sernin, Pont Neuf, Jacobins, Cité de l'Espace),
  Nice, Nantes, Montpellier and Strasbourg (cathédrale, Petite France,
  Parlement européen).

### Changed

- **The globe opens on Paris.** A visit carrying no share link now starts over
  the Eiffel Tower at 600 m, framed toward the Trocadéro, instead of Austin.
  The LOCATION tray offers the eight largest French communes by population —
  Paris, Marseille, Lyon, Toulouse, Nice, Nantes, Montpellier, Strasbourg — in
  that order. The cities that left the tray did **not** leave the app: Austin,
  San Francisco, New York, Tokyo, London, Dubai and Washington stay reachable
  by search and by voice. Deleting them would have stranded the seeded CCTV
  cameras, which anchor to a city plus a landmark *index* — a regression test
  now walks that seed table and fails if any camera loses the landmark it was
  calibrated against.

## [Unreleased] — 2026-08-28

### Added

- **Petite hydro: the markers were half a kilometre underground, and it showed
  as drift.** Reported from the map: pan the camera and the dots appeared to
  slide over a map that was standing still — the Espalungue marker would not sit
  on its building, and the offset changed direction between two screenshots of
  the same place.

  It was not a data error. Espalungue's coordinate is **6 m** from IGN's
  building footprint. The markers were being drawn at **ellipsoidal height 0**
  while the ground in the Ossau valley is at **556 m**, so every dot was 556 m
  below the terrain it was meant to stand on — 840 m at Grand-Maison. A point
  under the surface is not merely low: its screen position is offset from the
  surface point above it by `depth × tan(angle between the view ray and the
  local vertical)`, which is zero at the centre of a nadir view and reaches
  about **320 m** at the rim of a 60° field of view. That angle changes as the
  camera moves, so the marker slides.

  Markers are now clamped onto the terrain, the way `rteGeneration.js` already
  clamps its station rings. The synchronous half — reading a floor already in
  cache — is free and always applies; the terrain fetch is bounded to the
  markers actually on screen, capped at 250, and skipped entirely above 200 km
  of camera height where the offset is under two pixels. Positions are updated
  in place on the existing primitives rather than by repainting 2 742 points.

  The clamp follows **both** `camera.moveEnd` and `camera.changed`, because
  neither covers the other: `moveEnd` does not fire when the camera is placed
  programmatically, which is exactly what a share link does, so on its own it
  would have left a link that opens straight into a valley with every marker
  still buried.

### Fixed

- **Bâti 3D no longer floats over Lyon's hillsides.** Reported from a
  Croix-Rousse view where whole blocks hung in the air while the next block sat
  correctly on the ground — and that pattern was the diagnosis. The layer
  re-anchors IGN's surveyed floor altitudes onto the surface the globe draws by
  taking the median difference between the two over a ~1.1 km cell, but it
  sampled that surface **once per cell, at the cell centre**, and differenced
  that single height against each building's own floor. On flat ground the
  result is the datum error, which is what the correction is for. On a slope it
  is the *relief between the cell centre and the building* — 30 to 60 m across a
  0.01° cell on the Croix-Rousse — and every building in the cell was lifted by
  it, uniformly, which is why the artefact came in cell-shaped blocks.
  The surface is now measured under each building with `globe.getHeight` — the
  terrain triangles already resident on screen, one synchronous read per volume
  and no network at all. The per-building sampling the first version priced as
  unaffordable (6 400 DEM lookups per viewport) costs nothing, because it never
  touches the DEM; the coarse grid is now only consulted when the camera has
  teleported and no terrain is resident yet. Two smaller corrections came with
  it: the surveyed ground compared against that height is now the middle of the
  footprint (`altitude_minimale_sol` is its LOW corner, and IGN publishes
  `altitude_maximale_sol` beside it — median drop 1.9 m, up to 13 m), which
  stops half of each building's own slope being read as terrain error; and what
  the cell median still cannot fix is absorbed by GROWING each volume — base
  down where the mesh is low, roof up where it is high, capped at 60 m.
  **The correction only ever lengthens a volume, never moves it**, so the floor
  altitude on every card is still the one IGN published. The layer also reports
  the residual it had to absorb (median and worst 5%) rather than averaging it
  out of sight, and `npm run qa:bdtopo` now asserts that residual over
  Fourvière — a hill, chosen because the old sampling could not pass there.

- `qa-fr-hydro.mjs` now probes `/api/terrain/heights` and reports which checks a
  target cannot run, instead of failing them. `vite preview` serves `dist`
  without the dev-server API middlewares, so the ground clamp and the overlay
  paint checks are only meaningful against `npm run dev` — where they pass. An
  earlier note in this harness blamed SwiftShader for the empty overlay
  diagnostics; that was wrong, and the cause was the preview target.

- **Petite hydro now reads the Plan IGN, and 229 more plants have a place on
  the map.** Asked for better precision, and the suggestion was the right one:
  the Plan IGN draws France's power stations, and it draws them from **BD
  TOPO**, whose `zone_d_activite_ou_d_interet` layer carries 4 318 features
  tagged `nature = 'Centrale électrique'`. Three things make it the best
  positional evidence available. It is **the building** — median footprint span
  **32 m**, against an OpenStreetMap `type=site` relation that can be twelve
  kilometres wide. It **publishes its own error bar**, `precision_planimetrique`,
  3 m or better on 242 of the positions used here, and the card now prints it.
  And the join needs no guessing at all: BD TOPO publishes `insee_commune`, the
  same INSEE code ODRÉ prints on every register row.

  Used in two passes. **Refine:** a plant another tier had already identified is
  snapped onto the nearest footprint in its commune within 250 m — **360
  positions moved, a median of 12 m.** The radius is read off the measured
  distribution rather than chosen: agreement clusters tight below 250 m and the
  curve flattens after it. **Place:** a row nothing else could position takes a
  footprint when the toponym matches, or when the commune holds exactly one
  register row and exactly one free footprint. **765 → 998 plants placed**, and
  coverage below 4,5 MW roughly doubled — 50 % of the 1–4,5 MW band (was 38 %)
  and 19 % below 1 MW (was 11 %). The honest caveat is on the card: 86 of the
  229 new placements sit on a `Centrale électrique` whose kind IGN leaves blank,
  and where IGN did not say "hydroélectrique", the card says so.

- **Four plants were on the wrong continent, and the register said so itself.**
  Both the commune and the source substation are codes ODRÉ publishes, and
  OpenStreetMap publishes the substation code too as `ref:FR:RTE`. Across the
  378 RTE-connected rows OSM can check, the two agree to a median of 2,4 km and
  a p90 of 5,4 km; **the largest legitimate gap is 11 km, and then the next four
  are 6 717, 6 864, 7 263 and 8 945 km.** All four are metropolitan hydro plants
  filed under an overseas commune: the 30 MW **Lac d'Oô** — Luchon,
  Haute-Garonne — is published in **Guyane**, **Luz** in Martinique, **Motz** in
  Guadeloupe and **Pont-du-Loup** at La Réunion. For those the commune is simply
  the wrong field, so the substation wins and the plant is drawn where its own
  yard is. The register's commune is kept verbatim on the record and the card
  prints both claims: the reader is owed the contradiction, not a quiet edit.

- **Petite hydro: 167 plants were in the wrong place, including one in a
  forest.** Reported from the map: the Centrale du Hourat at Laruns was drawn
  2,7 km up the mountain, mid-forest, when it stands in the middle of the
  village beside the Arriussé. Two independent bugs, both mine, both now
  measured and pinned:

  **Overpass `center` on a relation is the centre of its BOUNDING BOX.**
  OpenStreetMap maps a large hydro scheme as one `type=site` relation covering
  the intake, the headrace tunnel, the penstock, the powerhouse and the
  tailrace — the Hourat's spans 6,0 km, Grand-Maison's 12,1 km, Montpezat's
  22,8 km — and the centre of that box is a point on **no object at all**.
  Measured on the first build: **167 of 722 OSM-positioned plants (23 %) sat at
  the centre of an object more than 500 m across, 99 of them more than 3 km.**
  The build now asks for `bb` instead of `center` so it can see the span,
  refuses anything wider than 500 m as a position, and snaps those to the
  `power=generator` elements inside — the generating hall. **127 plants moved,
  a median of 1,3 km and up to 7,5 km.** The Hourat now lands 47 m from 4 rue
  de Gerp, 64440 Laruns. What cannot be resolved is not guessed: it goes to its
  commune ring.

  **A prefix-shaped first word is not decoration.** The register writes
  `MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3`, so the build stripped any four to
  six uppercase characters followed by a hyphen. `GRAND` is five uppercase
  characters followed by a hyphen: **`GRAND-MAISON` became `MAISON`**, and
  France's largest hydro plant lost its join to EDF's own published coordinate.
  The decoration is now recognised only as a pair — prefix *and* trailing `-n` —
  which also spares the real register names `HYDR-AUZENE` and `COLY-LAMALETTE`.

  Three consequences worth naming. Cards now say **which object** the dot is —
  a published point, a mapped outline, a generating hall, or a connection yard —
  alongside how the plant was identified, and print how far a snapped position
  moved. A new last-resort tier places 49 plants on the **RTE switchyard whose
  `ref:FR:RTE` is the register's own `postesource`**, applied only to
  RTE-connected rows because on an Enedis row that substation serves a whole
  area and would stack a dozen producers on one pixel. And the 12 km commune
  ring is now re-tested on the FINAL position rather than on the candidate that
  was about to be thrown away. Coverage rose with the accuracy: **765 plants
  placed (was 761), 98 % of the fleet above 100 MW and 90 % of the 10–100 MW
  band.**

- **Petite hydro (FR): the other 2 686 hydroelectric plants.** A user went
  looking for the hydro installation at **Laruns**, in the
  Pyrénées-Atlantiques, and could not find it. Nothing was broken — there are
  *nine* plants in that commune (Miégebat 74 MW, Le Hourat 46,9 MW,
  Pont-de-Camps 39,4 MW, Artouste, Bious, Geteu, Fabrèges, Espalungue,
  Artouste-Lac, **223,9 MW between them**) and this globe could draw none of
  them: *Centrales EDF* covers EDF SA's own fleet and those nine are **SHEM's**,
  while *Groupes de prod* stops at 100 MW because that is RTE's publication
  floor. Two correct layers, and a whole valley in the gap. Measured against
  ODRÉ's national register, that gap is **2 742 installations and 26,02 GW**, of
  which the two existing layers between them reach 56.

  The new layer draws the register whole, down to a **40 kW mill at Monteils**,
  keyless, from a file shipped in the repo. It carries two kinds of marker and
  the difference between them is the point:

  - **A filled disc is a plant, where it is** — 761 of them, 23,4 GW, coloured
    by the register's own technology vocabulary (fil de l'eau, éclusée, lac,
    pompage-turbinage, hydrolien fluvial) and sized by installed power on a
    fourth-root ramp, because this fleet spans 40 kW to 1,69 GW and a
    square-root scale over that range either drowns the mills or paints
    Grand-Maison over a département.
  - **A hollow ring is a COMMUNE, not a plant** — 1 368 of them, standing for
    the 1 981 installations no source places. **The register publishes no
    coordinates at all**, only an INSEE code, and measured across the plants
    that *do* get a real position the commune centre sits a **median 3,0 km**
    from the actual powerhouse (p90 9,0 km) — in a Pyrenean valley, routinely a
    different river. So they are not pinned somewhere false; the ring says how
    many and how much, and never where.

  **Half the register is anonymised, and those cards are still full.** 1 357
  rows publish `Confidentiel` where a name belongs — small private plants whose
  operator is a person. They are neither dropped nor labelled "Confidentiel":
  the card leads with what the publisher *does* give, which for those rows is
  commune, installed power, technology, commissioning date, connection voltage,
  source substation, grid operator and EIC code at 95–100 %, plus — on 90 % of
  them — **the energy actually injected over the trailing twelve months**, which
  yields a capacity factor. An unnamed 3,9 MW plant at Licq-Athérey reads *3,9
  MW installés · 3,9 GWh injectés sur 12 mois glissants (12 %) · Fil de l'eau ·
  HTA, poste L.ATH, Enedis · en service depuis le 15/11/2007*.

  Three chips (**TOUT / ≥ 1 MW / ≥ 10 MW**) hide markers at runtime without
  touching the register behind them — the totals in the stats line stay put, and
  a ring clears a floor on its largest member, never on its commune total.
  Ambient labels follow the camera rather than the national capacity ranking, so
  zooming into the Ossau valley names Miégebat and Le Hourat instead of holding
  the label budget for Grand-Maison four hundred kilometres away.

  Four upstream traps are absorbed and documented rather than smoothed over:
  the register's **published zeros that mean "not declared"** (`debitmaximal` is
  zero on every single row in France, so it is not read at all); its internal
  name decoration (`MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3` is a poste-source
  code, a name and a revision number); **26 hydro plants published as
  `Photovoltaïque`**, 25 of them Corsica's real hydro fleet — Rizzanese 55 MW,
  Lugo-di-Nazza 43 MW, Castirla 28,5 MW, Tolla, Calacuccia, Ocana, Asco — which
  keep their disc and their published string on the card but are refused a hydro
  colour; and EDF's hydro file, where **`coordonnees_x_wgs` is the latitude**.
  Sources: ODRÉ (Licence Ouverte 2.0), EDF Open Data (Licence Ouverte 2.0),
  OpenStreetMap (**ODbL 1.0 — the share-alike travels with the shipped file**),
  geo.api.gouv.fr. Rebuild with `npm run hydro:registry -- --report`; browser
  proof in `npm run qa:fr-hydro`.

- **The app now starts with no key at all.** `git clone && npm i && npm run dev`
  boots to a working globe. Previously `src/main.js` threw before the viewer
  existed if `GOOGLE_MAPS_API_KEY` was missing, so a fresh checkout without a
  billed Google account produced a dead page — even though the whole fallback
  path already existed downstream. The key is now optional and, when absent, is
  never published to the page: `Cesium.GoogleMaps.defaultApiKey` and
  `window.__GOOGLE_MAPS_API_KEY__` stay unset, so no request is fired with an
  undefined key. Google 3D reports **"Google Maps API key required for Google
  3D"** rather than a generic failure, and the Google-only viewport-places
  endpoint is not called at all. `scripts/dev-fresh.sh` warns and continues
  instead of exiting.
- **The search box works without a Google key.** Type a place, land on it — no
  credential involved. A keyless build now geocodes through `/api/geocode`,
  which answers from **OpenStreetMap (Nominatim)** worldwide and from the **IGN
  Géoplateforme** (BAN addresses and the IGN POI index) for the French
  addresses OSM has not mapped. Cities, régions, parks, streets and buildings
  are framed exactly as before — the camera work is unchanged, only the
  geocoder is new. Searching biases to what you are looking at, so "sixth
  street" over Austin is East 6th Street rather than a village in Uganda,
  while a place the whole world knows by that name still wins: "Toulouse" typed
  over Austin is the city in France, not the bistro down the road. Results are
  cached and the OpenStreetMap usage policy's one-request-per-second limit is
  respected for the whole app, so a search can take a couple of seconds the
  first time and is instant afterwards.
- **Two keyless France basemaps, from the IGN Géoplateforme.** **IGN Ortho**
  (BD ORTHO®, 20 cm aerial, z0-19) and **Plan IGN** (Plan IGN v2, z0-19) join
  the MAP SOURCE row, which is now six tiles on two rows. No key, no token, no
  account — `data.geopf.fr` serves WMTS with `access-control-allow-origin: *`,
  and IGN documents the WMTS endpoints as not rate-limited. Licence Ouverte
  2.0; the attribution popover names both products with their `cartes.gouv.fr`
  records and links IGN's table of aerial-survey dates, because an orthophoto
  mosaic has no single update date.
- Coverage is **metropolitan France and Corsica**, and the tray says so before
  you click: both tiles carry "IGN Ortho — metropolitan France only" in their
  tooltip and accessible name. Each IGN stack composites **over an OSM base
  layer** rather than replacing it, so the rest of the planet stays present —
  a rectangle-limited layer at index 0 would be Cesium's base layer, and Cesium
  smears a base layer's edge pixels across every tile outside its bounds.

- **Groupes de prod (FR) now draws the hydro fleet, and says what a negative
  reading really is.** The layer shipped in #14 against a hand-written fixture,
  because no RTE account was available to build it with. Run against the live
  resource for the first time, three of its claims turned out to be wrong and
  one gap turned out to be large.
  - **36% of the fleet was invisible.** RTE and the ODRÉ register cut the fleet
    at different granularities: the register carries one row per hydro PLANT,
    RTE publishes its turbine GROUPS under entirely different EIC codes. 55 of
    152 units — 1 914 MW — had no register code, so Grand'Maison, La Bâthie,
    Montézic, Revin, Super-Bissorte and thirteen more read as "RTE published
    nothing" while RTE was publishing them by the dozen. Those units now reach
    their station through a name match, which is weaker evidence than a
    published code and is labelled as such on the card. 148 of 152 units place;
    the four that do not are still counted and reported. Live stations went from
    43 to 60 of 108.
  - **A negative reading is usually a stopped unit, not a pump.** 24 units read
    negative and **fourteen were reactors** — Chooz 1 at −58 MW, Paluel 3 at
    −49. A shut-down reactor still runs its coolant pumps and instruments and
    buys that power off the grid: a stopped 1 500 MW machine is a ~50 MW load.
    Not one of the 28 pumped-storage units was pumping at that hour. The card
    and the legend say so now.
  - **RTE sends no installed capacity** (0 of 152 units), so the register's
    figure is the denominator behind every load percentage — and **no nulls**
    (0 of 6 992 rows), so the future-padding guard is defensive rather than
    observed. The module now marks each of its nine traps as MEASURED or
    DEFENSIVE instead of implying all were seen.
  - The test fixture is a **real capture** now, not a contract sketch.

- Added the **Groupes de prod (FR)** layer — France's power stations, unit by
  unit, at the output RTE last published for each one. 171 generating units of
  100 MW or more across 108 stations: 57 reactors for 63.0 GW, 56 hydro
  machines, 44 thermal groups, 9 offshore wind units, the Rance tidal barrage
  and two grid batteries. It completes the sentence the Réseau gaz layer's card
  has been leaving open — what those stations are producing *right now*, which
  éCO2mix only publishes as a national filière total.
  - **A ring is what a station can do; a disc is what it is doing.** The ring is
    sized by installed power on a √ ramp so area tracks megawatts, and the disc
    fills it at full load. A **faint empty ring** is a station RTE published
    nothing for. A **crisp empty ring** is one measured at zero — a reactor in
    outage, which is the most interesting state a reactor has and the one a
    `value || 0` guard silently erases. A **magenta disc** is a machine
    *consuming* the grid: Grand'Maison pumping 1 690 MW back up its mountain, or
    a battery charging.
  - **Click a station and the card is its units.** Each group with its own
    megawatts against its own nameplate, and a day of hourly history as a
    sparkline — where `·` is a published gap, `▁` is a measured zero, and `▽` is
    consumption. Not a smoothed line: the gaps are real and stay visible.
  - **It draws with no key at all.** The fleet is a shipped file built from
    ODRÉ's national register and positioned from EDF Open Data, OpenStreetMap
    and geo.api.gouv.fr, so a `git clone` puts all 108 stations, their names,
    their filières and 93.5 GW of installed capacity on the globe with zero
    credentials. A free RTE account (`RTE_CLIENT_ID` / `RTE_CLIENT_SECRET`
    from data.rte-france.com) only ever adds the number that moves — and the
    layer says so, in the readout and in the first legend row, instead of
    reporting zero.

- Four things the Groupes de prod layer refuses to do, each stated on screen:
  - **Draw a reactor.** Nobody publishes where an individual reactor building
    is — OpenStreetMap has zero `power=generator` + `generator:source=nuclear`
    elements over the whole of France — so Gravelines is one ring with six
    groups on its card, not six discs invented from a site outline.
  - **Hide where a ring came from.** RTE publishes no coordinate for any unit,
    so every position is derived from four published anchors and every card
    names its own: 69 stations sit on **EDF's own published coordinate for its
    own station**, 11 on an OpenStreetMap `power=plant` outline, 13 on the
    `ref:FR:RTE` switchyard their register entry names, and 15 at the centre of
    their commune — including four offshore wind farms whose rings are therefore
    on the beach, because nothing open publishes their footprint. A candidate
    more than 30 km from the commune centre is refused, and two anchors are
    never averaged into a third position nobody published. EDF outranks
    OpenStreetMap because the two agree to within 300 m on every reactor and
    every thermal site and diverge by up to 9.5 km on hydro, where a
    powerhouse, an intake and a dam share a name across a valley; every
    `edf-published` row records `supersededOsmKm` so that choice is auditable
    per station rather than asserted.
  - **Reconcile two capacities.** RTE's `installed_capacity` and the register's
    `puismaxinstallee` are different administrative numbers for the same
    machine; when they differ by a megawatt or more the card prints both.
  - **Quietly drop a unit.** A unit RTE reports that the shipped register has
    never heard of is counted in the readout with its megawatts, as *unplaced* —
    because there is nowhere honest to draw it.

- Eight upstream traps absorbed in the projection and pinned in the tests:
  **zero is a reading, not a gap** (`value || null` erases every reactor in
  outage and reads the fleet as 100% available); **the last row is the future**
  (the window is padded with unpublished `null` hours, so `values.at(-1)` reads
  the whole country as 0 MW — the same shape as éCO2mix's `prevision_j1`
  padding); **negative is pumping, not corruption**; `values` arrive out of
  chronological order; **one EIC code arrives in two envelopes** when the window
  spans a day boundary, so last-one-wins throws away half the history; RTE
  republishes an hour with a newer `updated_date`; the two installed capacities
  disagree; and RTE's fleet drifts from ODRÉ's register. On the register side:
  `puismaxinstallee` is published in **kilowatts** to three decimals, a 132 MW
  photovoltaic farm at Ajaccio is filed under `filiere: "Thermique non
  renouvelable"`, the Rance tidal barrage is named `CENTRALE HYDRAULIQUE`, and
  unit names arrive in four grammars with the article parked at the end
  (`TRICASTIN (LE)`).

- Added the **Centrales EDF** layer — where French electricity is physically
  made, from EDF's own three open datasets (hydraulic, nuclear, thermal),
  keyless under Licence Ouverte 2.0. 79 generating sites carrying 80 094 MW:
  18 nuclear sites (61 370 MW), 51 hydraulic plants (13 779 MW) and 10
  fossil-fired sites (4 945 MW). Each site is one disc whose **area** — not its
  radius — is its installed capacity, coloured by filière and labelled with
  what the object actually is in the publisher's own vocabulary:
  `GRAVELINES · 5 460 MW · 6 × REP 900`, `GRAND-MAISON · 1 714 MW ·
  Pompage mixte`, `CORDEMAIS · 1 160 MW · 2 × Charbon`. This is the structural
  half of the question **Mix élec** answers live: that layer says what is
  flowing right now, this one says what is built, and where.
- The layer is built around what these files do and do not say. **It is EDF's
  fleet, not France's** — the hydro file carries 51 of the 400+ installations
  EDF operates (those above 100 MW, plus those whose secondary reserve reaches
  20 MW), no CNR or SHEM hydro and no Engie or TotalEnergies CCGT; only nuclear
  is complete for the country. **There is no single "as of"**: nuclear is a
  vision consolidée au 31/12/2025 and the other two au 31/12/2023, so every
  site is stamped with its own file's date and the layer reports the range
  rather than presenting a total that never existed at one instant. **Installed
  capacity is not production**, and it is named that way everywhere. **A row is
  not a site**: the nuclear and thermal files publish one row per unit with the
  site's coordinate repeated on each, so six Gravelines reactors draw one
  marker and not six stacked on a pixel, while a hydro plant — published one
  row per plant, with no turbine count — reports no unit count rather than "1".
- **Five of these sites are also drawn by the Réseau gaz layer, and both are
  right.** That layer draws ODRÉ's register of the 14 centralised gas-fired
  stations whoever runs them; this one draws EDF's own fossil-fired file
  whatever it burns. The overlap is exactly the five EDF gas sites — Martigues,
  Bouchain, Blénod, Montereau, Gennevilliers — where the two publishers
  disagree slightly on capacity (585 against 575 MW at Bouchain). Nothing is
  de-duplicated: neither set contains the other, and hiding one figure would
  hide that they disagree.
- Two upstream traps are absorbed server-side in `edfPlantsFeed.js` and pinned
  against captured payloads: the hydro file publishes **`coordonnees_x_wgs` as
  the latitude** (read the usual way, Grand-Maison lands off Somalia) while the
  other two publish one `"lat, lon"` string, and
  `reserve_secondaire_maximale` is a **site figure repeated on every unit
  row**, so Cattenom offers 60 MW of reserve and not four times 60. 49 unit
  tests; `npm run qa:edf-plants` is the browser proof. Attribution registered
  in the Data attribution popover and DATA_SOURCES.md.

- Added the **Power Grid** layer — the wires themselves, from OpenStreetMap,
  keyless, loaded for the viewport you are looking at. The Mix élec and Réseau
  gaz layers came from ODRÉ; the electricity network's own geometry is the one
  part RTE publishes nothing for, so this is community mapping and the layer
  says so everywhere it can.
  - **Routes by voltage band** — a 400 kV backbone stroke is thicker and hotter
    than a 63 kV one, and the four bands (≥ 300 / 180–299 / 100–179 / 50–99 kV)
    are generic rather than French, so the same palette reads correctly on the
    British 400/275/132 and German 380/220/110 grids. Verified live against
    central London.
  - **The substations they land in**, sized by the same band, named on the globe
    when OSM names them — "Poste électrique de Villejust", 400/225/90 kV, RTE —
    and captioned with what OSM calls them: a poste source, a traction feed, or
    a role it never stated.
  - **The pylons**, but only below 0.25° of view, where a pylon is a thing
    rather than a dot. There are 11,670 of them in a 1.2° × 1.6° box; at that
    range they cost more bandwidth than the entire network they carry.
  - **Underground cable is dashed.** In Île-de-France a quarter of the mapped
    high-voltage network is `power=cable`, and drawing it like an overhead line
    would claim pylons that are not there.

- Four things the Power Grid layer refuses to do, each stated on screen:
  - **Draw a line at conductor height.** The wire hangs tens of metres up and
    OSM records that for a minority of pylons and for no line at all, so every
    route is a ground-clamped stroke of the mapped ROUTE — and every legend row
    says so, rather than lifting the network to a plausible-looking catenary.
  - **Guess a voltage.** Voltage is the filter because voltage is the evidence:
    a feature OSM has not given one is absent, not demoted. That filter is also
    what turns 619 raw "substations" in one Paris viewport — 404 of them
    street-corner cabinets and cadastre-imported building footprints — into the
    209 real high-voltage yards worth drawing.
  - **Call a stroke a line.** OSM splits one named liaison across dozens of
    ways, so the readout reports both: 1,386 strokes for 304 mapped routes, over
    Île-de-France.
  - **Imply a truncated view is a complete one.** Each class has its own element
    cap and reports its own truncation, and the readout says which one was cut
    and to zoom in. Above 0.8° of view the layer asks for nothing at all and
    says "zoom in" instead of drawing a partial grid that looks whole.

- Six upstream traps absorbed server-side and pinned against a captured Overpass
  response: **one shared element cap starves whatever Overpass emits last** (899
  pylons erased every line and substation in a Paris box, so each class now gets
  its own bounded output); `voltage` arrives as a `;` list carrying junk
  (`225000;0`, `225000;225000;225000;63000`) that `Number()` turns into NaN;
  `power=line` is not a synonym for high voltage (one is tagged 400 **volts**);
  RTE's own 225 kV yards are tagged `substation=industrial`, so the subtype is a
  caption and never a filter; a multipolygon substation carries no `lat`/`lon`
  at all, only a computed centre; and `power=cable` is the same network
  underground.


- **Shared mobility now says what an object is and who runs it, at the same
  time.** Two independent facts get two independent channels. **Shape** answers
  *what*: a bike, an e-bike, a kick scooter, a moped, a shared car and an
  unknown form factor each draw their own silhouette, so a Paris street stops
  being one undifferentiated cloud of dots. **Colour** answers *who*: every
  operator has its own hue, held nationwide — Lime is the same green in Lille
  as in Marseille, and Vélib', Voi, Dott, Pony, Bird, Citiz, Clem', YEGO,
  Cityscoot, Tier and Leo&Go are pinned so that no two of them can ever
  collide. The row legend now carries both keys: the silhouettes actually
  drawn, then the operators actually in view, named and counted.
- A **station keeps its fill for availability** — the one reading a person acts
  on — and wears its operator on the RING instead. The Bikeshare layer does the
  same, from the same registry, so over Paris a Vélib' dock and a Dott dock are
  tellable apart even though two different layers draw them. Bikeshare station
  dots grew from 4–12 px to 7–14 px so the ring cannot eat the fill.
- No French GBFS feed publishes a brand colour, and the layer does not pretend
  otherwise: the ~15 operators that run several French systems are pinned by
  hand, and every other network's hue is derived from its published title and
  labelled as derived in the legend tooltip. Two municipal networks can land on
  the same hue; the legend names them, and the names are what settle it. A
  selected vehicle's card now leads with its operator ("Lime E-bike"), and the
  detection readout says "PONY SCOOTER" rather than just "SCOOTER".

- Added the **Réseau gaz** layer — the French gas system, keyless. Three ODRÉ
  products drawn together because they only make sense next to each other: the
  **pipes**, the **inlets** and the **outlets**.
  - **36,106 km of high-pressure transmission trace**, clamped to the ground —
    NaTran (ex-GRTgaz) 31,420 km in violet, Teréga 4,686 km in orchid. Two
    companies, two colours, two length figures; a stroke of one is never
    chained onto a stroke of the other.
  - **850 renewable-methane injection points**, sized by the capacity each
    declares (16.3 TWh/an in total), and **14 centralised gas-fired power
    stations** sized by nameplate power (7,196 MW) — which is where a good part
    of that gas leaves the system as the `gaz` filière of the Mix élec layer.
  - It is a **published simplification, not a pipeline location**. Both
    operators publish their trace at about 250 m; nothing is densified,
    smoothed or re-routed, and every card says so.
  - It is **installed capacity, not live output**, and it says that too. What
    those 14 machines are producing right now is a national figure RTE does not
    break down per station without an API account.
  - **741 of the 850 injection points feed a network this layer does not
    draw** — the local distribution grid. They are drawn dimmer, counted on
    their own legend row, and no connector is ever drawn between a site and a
    pipe, because none of these files publishes that link.
- Six upstream traps are absorbed server-side and pinned against captured
  payloads:
  - The power-station file is **seven annual editions stacked in one table** —
    98 rows are 14 sites × 2019…2025. Summing the column reports 50,372 MW for
    a 7,196 MW fleet and stacks seven dots on each of 14 coordinates.
  - **The editions disagree**, and no endpoint promises an order. Landivisiau
    is `En projet` in 2019 and 2020 and `En service` from 2021; the export
    answers 2025 first, the records API answered 2023, 2022, 2025, 2021, 2024,
    2019, 2020. Newest edition wins, and the card names what the older ones
    claimed.
  - **Teréga's third ordinate is not a height** — it runs −705.5 m to
    +1,809.4 m over ground that is 0–1,500 m. Dropped, and the arity is checked
    per vertex because a flat lon/lat reader fed 3-tuples does not throw, it
    silently mis-plots the network.
  - One `geo_shape: null` row (which still carries a `geo_point_2d`) and eight
    `MultiLineString` rows in a file that is otherwise all `LineString`.
  - **Fifteen decimals on a ±250 m product.** Rounded to 5 (~1.1 m), which also
    reveals 165 published "lines" whose vertices are all one point.
  - **`site_ouvert` is the string `"False"`**, which JavaScript coerces to
    `true` — that alone would draw three closed sites, at zero size, out of a
    file titled *en service*.
- A pipeline drawn in any blue renders perfectly and reads as a river. The
  first version of this layer did exactly that — measured against the OSM
  basemap, its steel blue sat within 14/255 of the basemap's own water colour
  on every channel — so the two networks are violet and orchid, a unit test
  keeps all four channels apart, and the browser harness now counts the
  operator's own pixels with the trace shown against the same view with it
  hidden. Every structural check can pass while nobody can see the layer.

- Added the **Shared Mobility FR** layer — every French shared vehicle the
  Bikeshare layer does not already draw. From the same national access point as
  the transit layer, but its GBFS half: ~40,600 free-floating bikes, e-bikes,
  scooters and mopeds plus ~15,500 operator dock stations, across 135 systems,
  keyless, under per-operator Licence Ouverte 2.0 / ODbL 1.0. Loaded per
  viewport, coloured by vehicle kind with a live legend, and clicking one gives
  its battery range, its operator, and the age of that vehicle's own last
  report rather than the age of the poll.
- It is an inventory, not a track, and says so: GBFS never publishes a vehicle
  during a rental, so a vehicle being ridden is invisible and nothing is
  interpolated between two sightings. Freshness is uneven across operators
  (Lime ~50 s, Dott a median 8 minutes with a long tail) and is shown per
  object.
- Three redundancies are resolved before anything is drawn, each measured
  rather than assumed: the catalog's 165 resources collapse to 135 distinct
  systems (identity is the set of places a system reports, which catches
  Vélo'v published from two different domains where a URL comparison cannot);
  the four systems already in Bikeshare are excluded against that layer's live
  registry; and the 32,783 municipal parking-bay rows that free-floating
  operators republish as their own "stations" are merged out instead of being
  drawn once per operator. Every verdict is recorded in
  `config/gbfs_fr_systems.json` rather than silently applied.

- Added the **Mix élec** layer — France's live electricity mix, keyless. RTE's
  éCO2mix, republished by **ODRÉ** under Licence Ouverte 2.0 and refreshed every
  15 minutes, answers the question a national consumption gauge never can:
  *which regions power France, and which draw on it.* The 12 métropolitaines are
  painted by their own consumption-minus-generation balance — teal where a
  region produces a surplus, amber where it runs a deficit, opacity ramped by
  how large that imbalance is against the region's own load — so Auvergne-Rhône-
  Alpes and Normandie exporting hard while Île-de-France imports nearly its
  whole load is legible at a glance. The five commercial border balances are
  drawn as raised arcs whose arrow points the way the power travels, with the
  direction repeated in words on the label; a border at 0 MW is drawn as no arc
  at all. National load, gCO₂/kWh, low-carbon share and the net export figure
  are reported on the layer's row.
- The layer is built around what this dataset does and does not say. `ech_comm_*`
  is a **commercial nomination between market areas, not a cable**, so the arcs
  are anchored on country reference points rather than interconnection sites,
  and Allemagne + Belgique — published as one field — stays one arc labelled
  with both. The commercial balances do **not** sum to the physical one
  (measured: −2 893 against −3 633 MW), so both are reported, separately named.
  éCO2mix régional covers 12 regions: **Corse runs on its own system and is
  absent upstream**, so it is never painted rather than inheriting a neighbour's
  colour. RTE publishes no regional carbon content, so none is drawn.
  Attribution to éCO2mix / RTE via ODRÉ, with the dataset's own 15-minute
  timestamp, is registered in the Data attribution popover.
- Added the **Transit FR** layer — the first thing on this globe that moves on
  the ground. Live GTFS-Realtime vehicle positions from the French Point d'Accès
  National (`transport.data.gouv.fr`): buses, trams, metros and interurban
  coaches across ~150 networks, keyless, under per-feed Licence Ouverte 2.0 /
  ODbL 1.0. Vehicles are loaded for the viewport you are looking at (never
  nationally), colour-coded by the network's declared service class with a live
  legend, and clicking one raises its line, speed, bearing, stop status,
  occupancy and the age of the operator's own last fix. Glyphs **glide between
  two consecutive reported fixes** rather than jumping, so the scene renders up
  to one poll interval behind live and never extrapolates past what a feed
  actually said; a vehicle reporting no bearing is drawn as a disc, not a
  chevron pointing somewhere plausible. Above ~300 km the layer fetches nothing
  and says so.
- Coverage is honest about its own gaps: France's largest networks —
  Île-de-France, Lyon, Marseille, Strasbourg, Lille — publish no live vehicle
  positions at all (their SIRI feeds carry next-departure and disruption data,
  not coordinates), so a camera over central Paris reads "no PAN feed covers
  this view" instead of an empty map.
  Feed footprints are OBSERVED — the catalog publishes coverage as a name and
  never as geometry — and shipped in `config/pan_gtfs_rt_feeds.json`
  (`node scripts/build-pan-gtfs-rt-index.mjs` rebuilds it), so a cold start
  costs no probe sweep. Attribution to transport.data.gouv.fr and each
  publishing transport authority is registered in the Data attribution popover.
- Added a **Ports** layer: the NGA **World Port Index** (Pub. 150), 2,951 ports
  worldwide, bundled and keyless. Each port carries its country, region,
  UN/LOCODE, harbour size and type, shelter rating and water body. The
  publication is a U.S. Government work and therefore public domain, so unlike
  the TeleGeography cables it carries no commercial-use carve-out. Two traps in
  the source are handled rather than passed through: harbour depths are WPI
  *range bins*, not surveyed soundings, so they render as `~11 m channel
  (approx.)` and must not be used for navigation; and the size code `V` means
  *very small*, not "very large" — inverting that scale would promote three
  thousand fishing harbours to container terminals. Fields that are "unknown"
  for ~99% of rows (port security, VTS, TSS) and the max-vessel dimensions
  (present for 3% of rows, with impossible values) are dropped rather than
  rendered as data.
- Added a **Marine Buoys** layer: live sea state from the NOAA **National Data
  Buoy Center**, keyless, through the new `/api/ndbc` proxy (10-minute cache,
  disk-backed, serve-stale). One upstream fetch covers the globe. Buoys are
  colored on the WMO sea-state ladder by significant wave height, with period,
  direction, sea temperature and wind on the card. **The network is sparse and
  the layer shows it instead of papering over it:** only about a fifth of
  reporting stations carry a wave sensor, and one that does not renders neutral
  grey with the line omitted — never as a calm sea. A genuine `0.0 m` reading
  stays visually distinct from an absent one, and the control chip carries the
  measured/total split. Observations older than 12 hours are dropped, and an
  upstream outage notice is rejected rather than cached as an empty ocean.
- Added an opt-in **OpenStreetMap mapped-camera** source
  (`CCTV_OSM_CAMERAS_ENABLED=1`): publicly mapped surveillance-camera positions
  are loaded for the viewport you are looking at — plus a snapped margin, so
  panning re-uses the cached answer — and merged into the CCTV layer, anywhere
  in the world OSM has them. OSM maps where a camera is, never what it sees, so
  these cameras carry no feed and show a labeled Street View or
  `NO UPSTREAM CONFIGURED` frame, with tag-derived poses (bearing, tilt, mount
  height) marked `RAW PRIOR` and © OpenStreetMap contributors (ODbL)
  attribution registered the moment positions appear on the globe.
- Added the Métropole de Lyon "Caméras Web Criter" pack to the CCTV layer: the
  city's public traffic cameras, keyless, with their frames served live from the
  Grand Lyon open-data host. Cameras whose frames stop refreshing drop out of the
  catalog. Attribution to the Métropole de Lyon (Licence Ouverte 2.0) is
  registered in the Data attribution popover; `CCTV_LYON_ENABLED=0` disables the
  pack.
- Clicking the CCTV panel preview (or pressing Enter on it) now opens the frame
  full-screen at the publisher's own resolution — most public cameras publish
  1920x1080 into a 360px rail. Escape or the close button returns. The bar prints
  the frame's true pixel size, so an upscaled low-resolution camera never implies
  detail it does not have. Enlarging costs no extra request: the decoded frame is
  moved, not re-fetched.
- Lyon camera headings are now hand-derived from OpenStreetMap road geometry plus
  the published frames, and served as `CAL · CURATED`, instead of the arbitrary
  id-hash fallback the catalog's missing bearing would otherwise force. The 3D
  monitor plane now lands a median 6 m from the carriageway the camera watches,
  against 30 m for the hash it replaces. One camera keeps the fallback because it
  publishes a placeholder image, not a frame.
- Added three French national alert layers, all keyless: **Vigicrues** (337
  monitored river reaches coloured by the state's 4-level flood vigilance),
  **Hub'Eau Gauges** (the live river-sensor mesh beneath it, up to ~4,000
  stations sized by discharge) and **Météo-France Vigilance** (the 4-colour
  départemental weather warning across 9 phenomena). All three are Licence
  Ouverte.
- Added the `/api/vigicrues` and `/api/vigilance` dev-server proxies. Vigicrues
  publishes 2.2 MB with no gzip, no ETag and no Last-Modified against a map
  that changes twice a day, so the proxy splits it into a geometry document
  fetched once per session and a ~3 KB level document that is polled. The
  vigilance proxy prefers Météo-France's own keyless data.gouv.fr mirror and
  uses the authenticated API only when `METEOFRANCE_API_KEY` is set.
- Bundled the 96 metropolitan French département polygons (IGN ADMIN EXPRESS
  via france-geojson, Licence Ouverte) — the vigilance product carries colours
  but no geometry.
- Added honest aircraft identity narration: callsign, operator, registration,
  type, and route come only from selected-contact context, and missing operator,
  route, or type enrichment is named explicitly.
- Added local, publication-compatible copies of the two README PNGs, with source
  records and third-party-license boundaries in `docs/media/README.md`.
- Added regression coverage for aircraft identity narration and optional-key
  loading feedback.
- Added `scripts/lib/qa-first-run.mjs`: the QA fleet's shared handling of the
  first-run mission card. Every headless harness is a fresh browser session, so
  the card — which returns every fresh session by design — used to land on top
  of each new dataset's QA run, swallowing the clicks and pixels the harness was
  measuring, and each harness solved it again, differently. All 40 harnesses
  that drive the app now open their page with `newQaPage(browser)`, and
  `npm test` audits the fleet for it (`src/qaFirstRunSuppression.test.mjs`) so a
  new harness cannot forget. `scripts/qa-firstrun.mjs` is the one exemption —
  the card is what it tests. For QA by hand, `?welcome=0` on the app URL does
  the same thing, and `dev-fresh.sh` now prints that URL on startup.

### Changed

- First-run presentation now opens with Detection `DENSE` at 75%, `ELASTIC`
  allocation, Fade 7%, Outside 1%, scope feather 11%, and aircraft 3D models in
  `PROXIMITY`. Stored state and share links still override these baselines.
- The 17 selected README GIFs remain unchanged and are documented separately
  from the two owner-published PNGs.
- Bundled datacenter and dam snapshots now omit contact-oriented fields and
  note values containing email or phone identifiers. Feature geometry, names,
  operator/capacity/river metadata, counts, and ODbL terms are unchanged.
- Public documentation and the L9 release matrix no longer reference non-public
  planning material or repository history.
- Camera frames are now polled at the publisher's own cadence where it is known.
  The Grand Lyon feed republishes once a minute, so the active-camera poll drops
  from every 10 s to every 60 s — five of every six requests were re-fetching a
  picture the client already had. Packs that do not declare a cadence are
  unchanged.
- A provider "image unavailable" placeholder is no longer reported as a healthy
  snapshot. It is recognised by content hash, routed into the existing Street
  View / synthetic fallback chain, and named in the health line.
- An incomplete camera frame — a JPEG that ends before its scan data, which a
  browser paints as a thin strip of the top of the image — is likewise no longer
  reported as a healthy snapshot. It takes the same fallback chain, and the
  health line says the frame was incomplete.

### Fixed

- A retired or corrupted `map=` share parameter no longer raises a credential
  error about a source nobody asked for. An unrecognized id now resolves to the
  build's own default stack (`photoreal` when it is available, otherwise the
  first source that is), instead of unconditionally to `photoreal`.
- The `set_map_stack` voice tool and its toast quoted a hard-coded "requires a
  Cesium ion token" for **every** unavailable stack. They now quote the
  controller's own reason, so a keyless build stops sending operators after the
  wrong credential.
- The Data attribution popover listed the French transit source twice: a
  three-way merge of two branches that had each added it once left the entry
  duplicated verbatim. Credits are now registered by key, so that class of
  merge accident cannot reach the popover again.
- The full-resolution CCTV viewer no longer boxes every frame at 16:9. Its
  geometry rule was losing on CSS specificity to the panel's own `#cctv-frame`
  rule, so a camera with a different aspect ratio was letterboxed inside a shape
  it does not have.
- A missing optional FIRMS key no longer turns the complete Environmental
  mission into `LOAD FAILED`. The FIRMS row still reports `KEY REQUIRED`, while
  earthquakes continue to load. Real lifecycle and fetch failures retain
  failure priority.
- The mapped-installations layer retries after an unavailable request when it is
  enabled or the camera settles.
- Aircraft trails attach to the rendered aircraft transform and remain near the
  rear center across headings. Parked aircraft do not draw a moving head
  segment.
- Grounded aircraft keep validated floor evidence through temporary terrain
  outages and wait for measured photoreal-surface evidence before a 3D model
  takes over from its billboard.
- Cockpit altitude uses aviation MSL data rather than Cesium render height.

### Security

- Production transitive dependencies resolve to patched DOMPurify and
  protobufjs releases without changing the Cesium version or application APIs.
- Production dependency audit reports no known advisories; remaining audit
  findings are confined to development and QA tooling.

## [Unreleased] — 2026-08-23

### Added

- Added a first-run mission launcher for Contacts, Space Missions,
  Environmental, and manual exploration.
- Added terrain-validity gating and bounded last-known placement for grounded
  aircraft models.

### Changed

- Environmental consistently presents both earthquakes and NASA FIRMS fires,
  with honest optional-key degradation.
- The tracked aircraft trail acceptance bar is visual: roughly rear-center,
  stable across headings, with minor hull overlap allowed and no conspicuous
  top, bottom, or lateral projection.

## [Unreleased] — 2026-08-18 to 2026-08-22

### Added

- Added the four-source Map Source tray, share-link v2 state, cockpit/context
  voice parity, MSL altitude readouts, and close-range tracked aircraft models.
- Added the L9 release-candidate matrix, AIS feed watchdog, voice cost controls,
  satellite classes, and the shared world-overlay host.
- Added deterministic first-run, map-source, floor, overlay, tracking, and
  aircraft-model regression harnesses.

### Changed

- Consolidated world labels, cards, tracked readouts, CCTV thumbnails, cable
  labels, mission labels, and detection presentation under shared allocation and
  lifecycle rules.
- Reduced idle rendering through the render governor and explicit scope mask.
- Improved cockpit layout, context restoration, keyless feed honesty, and
  aircraft 2D/3D handoffs.

### Fixed

- Fixed degenerate depth picks, map-source restore states, route-camera motion,
  bright-ground label readability, grounded display flooring, and cross-layer
  tracking cleanup.
- Fixed stale overlay callbacks, parked-idle render leaks, cable-label sweep
  starvation, and several share-link state conflicts.

## [Unreleased] — 2026-08-02 to 2026-08-16

### Added

- Added Global Context modes, Cockpit briefing surfaces, Radio context,
  satellite mission replay, and real per-class aircraft models with adjacent
  provenance records.
- Added a shared screen-space overlay system with bounded allocation for labels,
  cards, callouts, detection brackets, and selected-object presentation.

### Changed

- Unified right-side product controls and responsive cockpit/map layouts.
- Migrated public-safe neighborhood geometry to DataSF and tightened safe local
  development defaults.
- Improved proxy resilience, annotation outline bounds, CCTV enable pacing,
  contact de-emphasis, and deterministic visual stacking.

## [Unreleased] — July 2026

### Added

- Added live NASA FIRMS fires, optional live TomTom traffic, Caltrans and TfL
  CCTV packs, CCTV viewsheds and direct-manipulation calibration, citywide CCTV
  cards, Natural Earth regions, analyst queries, and voice routing QA.
- Added the end-to-end vertical-datum system for aircraft, vessels, CCTV,
  annotations, trails, and terrain-aware rendering.
- Added aircraft class silhouettes, path-derived display heading, ADSBDB
  enrichment, cached CelesTrak TLE lookup, and next-ISS-pass prediction.

### Fixed

- Fixed elevated-airport aircraft placement, vessel sea-surface placement,
  close-zoom FIRMS anchors, antimeridian region framing, annotation resolution,
  cross-layer tracking ownership, and CCTV projection lifecycle issues.

## [Unreleased] — June 2026

### Added

- Added OpenAI Realtime voice control, scene-aware entity context, viewport image
  grounding, the AI HUD summary, live AIS vessels, infrastructure layers, map
  source switching, free-text navigation, and server-side data proxies.
- Added hybrid map annotations, 3D aircraft, panoptic detection, tracking
  harnesses, and public data attribution.
- Added MIT source licensing, security guidance, contribution guidance, data
  source notices, and third-party asset boundaries.

### Changed

- Removed the experimental AI video-edit style and retained seven deterministic
  visual styles.
- Moved Realtime text-history trimming to the server-side retention policy while
  keeping only the latest viewport image in conversation context.

## [0.7.0] — 2026-02-18

- Added the Bikeshare Pulse layer and panoptic label improvements.
- Improved tracked-item boxes, post-render alignment, and CCTV projection
  quality.
- Removed the experimental shift-drag CCTV calibration interaction.

## [0.6.0] — 2026-02-10

- Added the initial multi-layer 3D globe experience, visual styles, live
  aircraft, satellites, earthquakes, CCTV, traffic, FIRMS, infrastructure, and
  performance controls.
- Added entity inspection, tracking, scenes, keyboard controls, and shareable
  views.

## [0.1.0] — 2026-02-09

- Initial project version.
