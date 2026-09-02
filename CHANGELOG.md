# Changelog

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased] — 2026-09-02

### Added

- **Autorisations d'urbanisme — what has not been built yet.** Every other
  French register here draws what stands: the cadastre the ground, BD TOPO the
  roofs, DPE their energy, DVF what they last sold for. This one draws the
  permits — granted, under construction, and in three métropoles, **still being
  instructed at the counter this week**. Scan a block and the cranes on it are
  cyan for a file still open, amber for granted, hot orange for a chantier
  running, green for finished.
- **The national register only holds permits that were GRANTED, and that is the
  whole reason the layer reads two.** Sitadel's own SDES dictionary says it in
  as many words. There is no national open feed of applications under
  instruction — Plat'AU, where every dematerialised file transits, is closed to
  accredited actors. So the layer reads Sitadel for the country (3 020 749 rows
  across four datafiles, republished monthly, running about six weeks behind
  the counter) and the ADS portals of **Paris, Bordeaux Métropole and Nantes
  Métropole** for the half Sitadel cannot publish. Measured 2026-09-02: 2 296
  Paris dossiers under instruction, deposits two days old.
- **The two registers merge on the dossier number rather than layering.** Both
  number a file the same way underneath — département, commune, year, sequence
  — Sitadel closed up (`07510826V0143`), the portals spaced and prefixed
  (`DP 075 108 26 V0143`). So one card says *"en cours d'instruction, déposé le
  6 mars"* from the counter and *"12 logements, 940 m²"* from the State,
  instead of drawing the same permit twice. Measured on a 400 m Nantes scan:
  **107 of 116 dossiers carried both halves**.
- **Sitadel carries no coordinate at all, and the layer says how sure each dot
  is.** Rows are placed by address through one bulk BAN call per commune.
  Measured on 211 Nantes authorisations: 167 resolve to a house number, 33 only
  to a street, 11 not at all. A permit geocoded to the middle of a street says
  so on its card; one the BAN can place no better than its commune is **dropped
  rather than drawn at the centroid**, and the count travels with the answer.
- **Sitadel keys Paris, Lyon and Marseille at COMMUNE level — the exact inverse
  of DVF.** `COMM=eq:75113` answers *"Le fichier est vide"*, `75056` answers
  the whole of Paris. Both layers resolve a point through the same BAN reverse
  call and then bend the answer in opposite directions. Getting it backwards
  yields an empty layer over the three densest cities in France, with no error.
- **Paris spells "no coordinate" as Lambert-93 (0, 0), and Opendatasoft
  reprojects it faithfully.** 19 rows, measured — and their `geo_point_2d`
  comes back as a perfectly well-formed pair off São Tomé. Nothing about the
  WGS84 coordinate reveals it; only the published `x`/`y` do, so that is what
  the guard reads.
- **DiDo rate-limits concurrent requests, and the failure is silent.** Firing
  the four Sitadel families in parallel returned **HTTP 429 on three of four**
  for Nantes while the same URLs answered 200 one at a time — a 429 becomes a
  null becomes an empty family, so the layer drew a city with no housing
  permits rather than reporting an outage. The families are sequential, and a
  family that fails is reported as failed, never as empty.
- **The Sitadel number series are PER FAMILY, and two of the files share one.**
  A mixed operation — flats over a shop — is filed once and listed in BOTH
  permis-de-construire files: 151 such pairs over Paris in three years, plus 12
  dossiers listed twice inside the non-residential file alone. They are folded
  into the one operation they are. But `NUM_PA` and `NUM_PD` are their own
  counters, and **271 numbers collide across series at completely different
  addresses** — folding on the bare number would have glued 271 unrelated Paris
  dossiers together, each inheriting the other's address and dwellings. Identity
  is series + number, never the number alone.
- **Three rows claiming one entity id is a render Cesium abandons half-way.**
  Found in the browser, not in a unit test: twelve markers drawn and the layer
  then frozen — no payload, no scan centre, no clickable cards, and no error
  anyone would connect to a data shape. The browser harness that caught it now
  covers this layer, and its click probe verifies a marker owns its own pixel
  before aiming at it — with six point layers over one block, clicking a
  covered marker tested Cesium's stacking rather than the layer's handler.
- **A certificat d'urbanisme is not permission to build, so it is not drawn.**
  Only Bordeaux publishes them — 174 662 of its 309 094 rows — and keeping them
  would make one métropole look three times busier than Paris for a category no
  other source has. They are counted and reported, so the exclusion is a stated
  line rather than a missing number.
- **Bordeaux draws the ground, not a dot on it.** One ADS portal in France
  publishes the emprise of the parcels a dossier names, and the layer now
  clamps it onto the terrain under the crane. A permit stops being a point on a
  street and becomes the plot it is about: the shape was checked against the
  IGN cadastre, which returns the same ring to the seventh decimal for parcel
  `33063000KD0112` — where the row's own `superficie` column says 5 471 m² and
  both geometries say 45. Paris and Nantes publish no shape, and their scans
  report zero plots rather than letting the absence look like a failure.
- **The outline belongs to the plot, and one plot is drawn once.** Bordeaux
  repeats the same emprise once per dossier standing on it: 392 dossiers over
  **252 distinct plots** on a 400 m scan of place Pey-Berland, one plot
  carrying nine. Drawn per dossier, translucent fills ADD — nine copies paint
  that plot at 0.83 alpha where a single one reads 0.18, so the thickest FILE
  on the block would have looked like the biggest project on it. The plot is
  identified by its GEOMETRY and merely named by its parcel references, because
  the same file writes those in two spellings and occasionally repeats one,
  each of which would split one plot into two stacked washes.
- **And the outlines cost less than nothing.** The certificats were being
  downloaded — outlines and all — only to be discarded a function later. Moving
  that exclusion into the query and asking the portal to COUNT them instead
  turns a 400 m Bordeaux scan from 416 KB without any geometry into **391 KB
  with all of it**; the naive version would have been 1 338 KB. ODSQL has no
  `<>`, and the export endpoint answers a syntax error with HTTP 200 and a JSON
  error object, which reads as a short answer rather than as a failure.
- **A published polygon is not a valid one, and the publisher's own flag is not
  the test.** Bordeaux ships its emprises out of Oracle Spatial with the
  validation verdict attached: 428 rows are flagged, and 108 of those carry no
  geometry at all — those keep their point. Dropping the other 320 was measured
  and rejected: against each row's own stated area they draw at a median 0.997
  of it. What is repaired instead is what a renderer cannot take — every ring
  arrives closed and leaves open, and 45 rings across 134 413 rows write a
  vertex twice in a row. Requiring a hole to sit inside its outer ring was
  written, measured and removed: it would have silently filled in three genuine
  courtyards of 787, 754 and 249 m², none of them flagged by the publisher.

## [Unreleased] — 2026-09-01

### Added

- **Urbanisme (PLU) — it draws the block now, not the dot.** The layer answered
  one point, which is the wrong question: "could the car park opposite become
  twenty-five metres of construction?" is about the plot OPPOSITE. Below
  1 500 m the zoning half is asked for over a BOX around what the camera is
  looking at — clipped to the view, so nothing off screen is fetched — and each
  zone is drawn in its family's colour with **its code written on the ground**,
  the way the paper document does it. Above 1 500 m it falls back to the point
  answer, which is still correct and much cheaper. The enclaves that were blank
  islands are now named: the school reads `UE`, the industrial estate `UYc`.
- **The servitude half stays a point, and the measurement is why.** One 390 m
  box over Lyon's Presqu'île answers **210 easement features and 2.3 MB**. At
  the zoning ceiling a full-box regime cost 4 MB upstream, 1.8 MB on the wire
  and 1 182 entities, against the hybrid's 888 KB, 506 KB and 218 — four times
  the payload for the half of the answer a point already gets right.
- **It costs bytes, not frames.** Measured in the browser on the shipped build,
  both regimes, IGN ortho: median frame **0.6–1.4 ms**, worst frame after a
  redraw **1.4–2.2 ms**, and **zero frames over 16 ms** in either. Cesium
  batches ground fills by material and there are only eight zone colours.
  Upstream, the box costs +13% to +27% in a city (the easements already
  dominate) and 17× in a rural commune, where the point answer was 30 KB.
- **`zone-urba` truncates at 5 000 features, HTTP 200, silently — same trap as
  the cadastre.** Measured 2026-09-01: a 0.15° box over Paris returns 4 105 of
  4 105 whole; a 0.40° box returns **5 000 of 17 182**, and a 1.0°
  Île-de-France box **5 000 of 46 500**. A zoning map missing four fifths of
  itself is not visibly incomplete — it looks like a commune with genuinely
  mixed zoning — so a box over the ceiling is refused whole and the true count
  printed. At the layer's own 0.02° ceiling the densest measured box answers 55
  zones, so the refusal is the exception.
- **A label that might sit outside its own zone would be worse than no label.**
  Anchors are the midpoint of the longest interior chord, not the centroid: a
  PLU zone is routinely a meander along a village street or a ring around a
  hamlet, and the centroid of either lands on ground the rule does not cover.
  Verified against all 55 zones of a real answer — every anchor inside its own
  drawn shape. A zone too narrow to hold text is drawn and coloured but
  unlabelled; its card still names it.
- **Which zone you are standing in is decided by whoever was asked.** Under a
  point query APIcarto has already answered it, and re-deciding can only
  disagree; under a box query the layer decides, against the ring as PUBLISHED
  rather than the one it draws. That is not academic: Ustaritz's `UB` ring is
  521 vertices, decimated to 400 for drawing, and the coordinate APIcarto
  itself answers `UB` for falls OUTSIDE the decimated ring. The drawn shape is
  a simplification and must never decide which rule applies to a house.
- The card separates the block from the address: the zone under the marker, how
  many others are on screen, and — when two communes disagree at their shared
  limit — that several zonings claim the same ground. A neighbouring zone's own
  card says it is a neighbour.
- A scan now refetches when the QUESTION changes, not only when the scan centre
  moves 250 m. Zooming straight down through the box altitude moves the centre
  by nothing at all while changing the kind of answer that belongs on screen.
- `viewportBox.focusedViewBox` and a new `ringGeometry.js` hold the box
  derivation and the point-in-polygon the cadastre layer had already paid for;
  the cadastre keeps its own names and ceilings and delegates the arithmetic.

- **Urbanisme (PLU) — the zone is now a wash on the ground, with its enclaves
  cut out of it.** The layer drew bare outlines, and an operator asked the
  right question of them: how can one house be in two PLU zones at once? An
  outline has no inside. Nothing on screen said which side of a line the rule
  applied to, and a building between two lines belonged to both as far as the
  eye could tell. Each zone is now filled — ground-classified, so it drapes on
  IGN ortho, on Bing and on the photoreal tileset alike — with the stroke kept
  on top: the wash says where, the stroke says exactly where.
- **The enclaves were ours, and they are fixed.** The projection kept outer
  rings only, on the reasoning that a hole in an outline is invisible. It is —
  and it is the whole point of a fill. Measured at Ustaritz on 2026-09-01, the
  zone returned for the village centre is `UB`, one polygon, **two interior
  rings**: 6 646 m² the same PLU zones `UE` (the school) and 50 686 m² it
  zones `UYc` (the industrial estate). Filled without them, `UB` painted
  57 332 m² of ground with a rule that does not reach it — and across the
  commune, 14 rings and 299 441 m². Interior rings are now carried, spent out
  of the vertex budget *with* the ring they perforate so a hole can never be
  what a budget drops, and stroked in their own right.
- **A point really can be in two zones, and the layer now says so.** Sampled
  on a 35 m grid over a 9 × 6 km box around Ustaritz: **17 of 34 126 points
  (0,05 %) fall inside two zoning polygons, every one of them at a commune
  limit**. Seven urbanism documents overlap in that box across 73 polygon
  pairs and 5,3 ha — including 525 m² that Jatxou zones `UD` (urbaine) while
  Halsou zones the same ground `A` (agricole). Each commune digitises its own
  PLU against its own idea of where the limit runs, and the Géoportail stacks
  the documents without reconciling them. `zoneCount` is reported so the case
  reads as the register disagreeing with itself, not as a broken answer.
- **`typezone` has seven values, and the table had four — so the family this
  layer exists for was drawn in the unknown-value grey.** Measured across
  twelve APIcarto boxes (Paris, Lyon, Lille, Toulouse, Marseille, Rennes, five
  peri-urban boxes, Ustaritz): **4 216 zoning features and not one plain
  `AU`.** Every à-urbaniser zone published `AUc` or `AUs`. And that letter is
  the most decision-changing thing in the layer: **`AUc` is open** — the plot
  opposite can be built under the PLU as it stands — while **`AUs` is closed
  until the document is modified or revised**. Same magenta family, cooled and
  quieter. `Ah` and `Nh`, the built pockets inside the agricultural and
  natural zones, take their family's hue brightened.
- **The wash weights are measured, not felt.** The same polygon repainted at
  five alphas over an IGN orthophoto, each frame differenced against the
  unpainted one across the ~380 000 pixels the zone covers: **0.18 moved the
  picture by a mean of 3/255 in red and could not be seen at all**; 0.22 by 5,
  0.28 by 11, 0.33 by 17, 0.40 by 24. Shipped: `AUc` 0.42, the exceptions
  0.34, `U` 0.30, and `A`/`N` 0.22 — they are most of the country, and at the
  urban weight a natural zone washes a whole valley teal.
- **Servitudes stay lines, and the lines are dashed.** They are not zoning, and
  a solid stroke said they were. They are also the wrong size to fill: one
  measured `pm1` risk envelope is 759 polygons spanning kilometres, so a wash
  of it tints the view rather than a plot.
- Each zone card now names its family in words — *zone urbaine — déjà bâtie et
  équipée*, *zone à urbaniser OUVERTE* — and says how many enclaves were cut,
  so an unpainted island inside a painted zone reads as the register's, not as
  a gap in the draw.
- The five point-scan layers hand their renderer the viewer, and the urbanism
  layer redraws on a map-stack change. A ground-classification surface is read
  once, when the primitive is built, so a wash addressed to terrain drew
  nothing at all once the photoreal tileset hid the globe — the layer looked
  switched off. It rebuilds from the answer already in hand, with no refetch.

- Added the **Parcelles cadastrales** layer — the lines France taxes land
  along, keyless. IGN's **Api Carto** serves the DGFiP's *Plan Cadastral
  Informatisé* (PCI vecteur) under Licence Ouverte 2.0 with no key and no
  account: one polygon per parcel, with its section, its 14-character national
  `idu`, and the surface the tax administration has registered against it.
  Loaded per viewport, ground-clamped so it drapes on IGN ortho, on Bing and on
  the Google photoreal tileset alike.
- **A cadastral line is a fiscal line, not a legal one, and every card ends by
  saying so.** In France a property limit is fixed by *bornage* — a
  géomètre-expert's survey under article 646 of the Code civil — and the
  cadastre has no authority over it. A crisp polygon on a photorealistic globe
  is exactly the thing a reader takes for a surveyed limit.
- **How approximate each line is, is published, and nobody draws it.** Every
  parcel belongs to a *feuille*, and the feuille carries the scale of the plan
  it was drawn on. Measured across 673 sheets on 2026-09-01: **1:250** in
  central Strasbourg, **1:5000** over the Landes forest, a twentyfold spread
  with zero nulls. At the conventional 0,5 mm of drawn line that is ±0,13 m
  against ±2,5 m for the same word "boundary". Parcels are coloured by that
  band, and the card prints the figure with the assumption attached — a bare
  "±0,25 m" reads as a survey result.
- **The holes are the streets, and the row says how many.** The cadastre
  parcels private land, not the public domain, so a correct answer over a city
  centre is full of gaps. Clipped to the view and measured: **45,7 % of Lyon's
  Presqu'île** is cadastred, 32,7 % around the Champ-de-Mars, 80,9 % in the
  Marais — against 95,0 % of a Cantal block and 98,6 % of a Landes forest one.
  The layer reports the fraction so the gaps read as the public realm rather
  than as a broken feed.
- The service disagrees with itself in ways a naive read gets visibly wrong, so
  six of them are absorbed server-side and pinned against a captured answer:
  - **Api Carto caps every request at 5,000 features and says so only in
    `totalFeatures`.** `_limit=10000` over Paris returns exactly 5,000 of
    12,483, HTTP 200, no warning — and paging with `_start` walks an internal
    order that mixes arrondissements, so a truncated answer is a cadastre with
    *scattered* holes, which is precisely what a complete one looks like over
    the public domain. A box over the cap is refused whole and the true count
    is printed. At the layer's own 0.02° ceiling the densest French cities
    answer 2,100–2,400 parcels, so the refusal is the exception.
  - **A sheet is not identified by (commune, section, feuille).** Lyon
    publishes section `AL` feuille 1 in five arrondissements, and the 5e's copy
    is drawn at 1:1000 while the others are at 1:500 — a four-part join gives
    those parcels a coin-flipped tolerance. With `code_arr` in the key there
    were 0 collisions across 27,595 parcels and 450 sheets.
  - **`idu` does not start with `code_insee` for 38 % of urban France.** The
    first five characters are the *arrondissement* code: a Marais parcel is
    `75103000AP0045` while its `code_insee` is `75056`. Reassembling the key
    joins to nothing in DVF for Paris, Lyon and Marseille, so the published
    `idu` is carried verbatim and never rebuilt.
  - **`contenance` is a fiscal declaration, not a measurement of the polygon.**
    Mamoudzou publishes it as `null` and Ostwald as `0` — and `Number(null)` is
    `0`, which would turn "not published" into "declares zero square metres".
    Where both figures exist, 7,2 % of parcels differ by more than 5 % and
    1,0 % by more than 20 %. Both numbers are on the card and neither is
    averaged into the other.
  - **Courtyards are holes and a parcel can be in two pieces.** Dropping the
    Palais-Royal's interior ring moves its area from inside 1 % of the declared
    contenance to outside 5 %; a Marseille parcel is one identifier over two
    disjoint polygons.
  - **A section is not always letters.** Alsace-Moselle numbers its sections
    (`22`), Marseille prefixes with a digit (`0D`), and `com_abs` — the API's
    "commune absorbée" — runs 801–842 across Toulouse, a commune with no
    arrondissements at all. All are carried as opaque strings.

- Added the **Bornes IRVE** layer — every public EV charge point France has
- **Enseignement supérieur (FR) — the level the schools layer stops before.**
  The *Annuaire de l'éducation* ends at the baccalauréat: measured 2026-09-01,
  its `type_etablissement` has eight values and not one of them is a
  university, an IUT, an école d'ingénieurs, an école de commerce, an IFSI or a
  school of architecture. Joining the two registers on the UAI measures the
  hole — of the 6 509 establishments the ministry's Parcoursup cartography
  lists for the 2026 session, **3 492 appear nowhere in the Annuaire**. The new
  layer draws the MESR's own *Effectifs d'étudiants inscrits — détail par
  établissements* (Licence Ouverte 2.0, rentrée 2024): **6 294 establishments,
  6 914 sites, 2 960 012 students placed**, coloured by seven bands folded from
  the register's 14 published categories and sized by the students counted at
  that campus.
- **No thinning and no sampling, because the whole register fits.** Resolved to
  sites it is **0.62 MB gzipped with every name, band, roll, cycle mix, campus
  count, formation list and website on it** — what the `schools-fr` maillage
  costs (0.63 MB gzipped) while carrying no names at all. So there is no bbox endpoint,
  no ceiling and no spatial thinning: `/api/sup-fr/sites` hands the browser the
  register once and every zoom is answered from it. `/api/sup-fr/departements`
  is the ~30 KB national rollup built by the same sweep. Cold build, measured
  end to end against the live portal: **2.9 s**.
- **1 665 establishments have no coordinate, and the fix is a second register.**
  `geo` is null on 3 442 of the register's 22 068 rows — the Université de la
  Nouvelle-Calédonie and the Université de la Polynésie française among them.
  Nothing is placed at a commune centroid. The layer reads the ministry's
  *Cartographie des formations Parcoursup* (session 2026, 25 831 formations,
  every one geolocated) and borrows a coordinate ONLY where that file gives
  exactly one point for the UAI: **977 establishments and 82 200 students**,
  lifting placed enrolment from 95.69% to **98.41%**. The borrow was checked
  rather than assumed — where both files give one point, the median
  disagreement is **74 m** and 90% agree within 1 km. Polynésie is recovered
  this way; New Caledonia is not, so all 18 of its establishments are reported
  as unplaced instead of being invented into the Pacific. A borrowed coordinate
  says so on its card.
- **The choropleth counts students, not dots — and says why.** Counting sites,
  Paris (484) leads the Nord (292) by 1.66× and the top ten départements hold
  35%. Counting students, Paris (394 788) leads the Rhône (192 964) by 2.05×
  and the top ten hold **49.8%**. The site count is flatter because 2 800 of
  the 6 914 sites are lycées running a BTS — and a map of where BTS sections
  are is a map of where lycées are, which **Établissements scolaires** already
  draws. Those 2 800 shared addresses get their own legend band, and the two
  layers use deliberately different palettes (deep hues and a white dot outline
  here, pastels and a black one there) so a stacked dot reads as the overlap it
  is rather than as a duplicate.
- **The name on the globe is now a click surface.** Every label the shared
  overlay paints — the river gauge's name, the substation's, the power
  station's, the cable's — selects its object exactly as the dot does. It never
  did: labels are painted onto a `pointer-events: none` canvas stacked over the
  viewport, so `scene.pick()` under one returns the globe, and a click aimed at
  a name reached the terrain behind it and DISMISSED the selection instead. The
  name is what says which object this is, and it is five to twenty times the
  target area of the 5–15 px dot it floats above, so it is what people aim at.
  Wired into twelve layers — Hub'Eau, Réseau électrique, Réseau gaz, Production
  RTE, Petite hydro, Événements routiers, Écoles and Bornes IRVE (their
  département names at national altitude), Radio (station names only — a
  cluster badge names a count, not a station), Câbles sous-marins, the ISS
  label and the rocket-mission markers. The depth-tested primitive is still
  resolved first, so a name drawn across a NEIGHBOURING object can never steal
  that object's click, a pick a sibling layer owns is left alone, and a click on
  empty space still clears the selection. Proved in a real browser by
  `npm run qa:label-click`, which reads where the host painted a label,
  dispatches a real pointer event at its centre — nowhere near the dot — and
  asserts the layer's card starts painting.
- **Six French public registers, read from a coordinate.** Géorisques, DVF,
  the ADEME DPE register, the IGN isochrone service, the Géoportail de
  l'urbanisme and Île-de-France Mobilités are now integrated end to end —
  keyless, Licence Ouverte or ODbL, behind six new proxies with unit-tested
  projections. Five new layers scan around the ground point the camera is
  looking at: **Risques (Géorisques)**, **Ventes immobilières (DVF)**,
  **Performance énergétique (DPE)**, **Urbanisme (PLU & servitudes)** and
  **Réseau IDFM (Paris)**. Measured over avenue de France, Paris 13e: 30
  classified installations, 153 recorded sales with a median of **9 063 €/m²**,
  915 energy diagnostics within 200 m, a railway protection strip and two risk-
  prevention envelopes, and 36 transport stops including a métro entrance 30 m
  from the door.
- **Reachable area instead of a circle.** `/api/isochrone` serves IGN's Valhalla
  rings over BD TOPO®: a 15-minute walk from that address covers **2.16 km²**,
  a 15-minute drive **56.96 km²**. Only walking and driving exist — the service
  rejects `bicycle` with HTTP 400 and no cycling ring is modelled in its place.
- **The Paris transit blank is answered.** IDFM publishes no GTFS-Realtime
  vehicle positions at all, so the live-transit layer is empty over the city
  this fork opens on. The new IDFM layer draws the network OFFER — 37 956 stops,
  2 121 lines with their official liveries, step-free status where surveyed —
  and reports the live-vehicle absence in its own stats rather than looking
  broken.

### Fixed

- **A digue titled "Barrage" — the pack knew better than the card.** Reported
  from the map: a "Barrage · 159 m de long" at Octeville-sur-Mer where no
  barrage is visible. Checked against OpenStreetMap: `w860215522` carries the
  single tag `man_made=dyke`, four nodes, no water body within 250 m — an
  anti-ruissellement bund on the Rouelles watershed, not a dam. The 159 m was
  never wrong; it is `spanM`, measured off the drawn geometry, and it
  recomputes to 159 m from the raw nodes. The word was wrong. The pack has
  stored `kind` since the two-axis rebuild and colours digues ochre, but the
  card title fell through to the LAYER's name whenever a feature had none of
  its own — which titled **1 198 digues, 24 barrage-digues and 88 unclassified
  world features "Barrage"**, out of 5 948 nameless features in a pack of
  7 432. Nameless features are now titled by what they ARE, in the same words
  the chips and the legend already use: Barrage, Digue, Barrage-digue, or
  Ouvrage for the world half that has no `kind` left to read. The second
  reported sighting settles what these actually are: `w849340116` is the bund
  of `w849340115`, tagged `natural=water` + `water=basin` + `intermittent=yes`
  — the embankment of a dry retention basin.

- **"Sites militaires — Error loading" was one mirror refusing, and three
  healthy ones never asked.** Every viewport answered HTTP 503, and the layer
  was right to say so: `/api/military-installations` reads `status >= 400` as a
  failure. The failure was underneath it. `overpass-api.de` scores requests for
  abuse at its Apache front-end and was returning a bare **406 Not Acceptable**
  to the proxy's agent string — a plain HTML page matching neither the
  rate-limit nor the runtime-error sniffer. Measured 2026-09-01, same query,
  interleaved to control for server load: the old
  `gods-eye-view-overpass-proxy/1.0` drew a 406 on **8 of 11** attempts, an
  OSM-conventional `app/version (+contact)` agent on **0 of 11**. That alone was
  survivable; what made it fatal is that `fetchOverpassPayload` rotated to the
  next mirror only on 429/5xx, so a 4xx ended the chain at mirror 1 with three
  mirrors untried below it. A 4xx is a MIRROR verdict, not a query verdict, and
  now rotates — the same rule the mapped-camera and power-grid probes already
  applied, which is why those layers stayed up through the same outage. A
  genuinely malformed query still surfaces: every mirror rejects it, nothing
  outranks it, the caller gets the 4xx back. Third fault, and the one that would
  have outlived the other two: `/api/overpass` cached anything under `< 500`, so
  the refusal was written to memory AND to disk under a **7-to-30-day TTL** and
  re-served as a `HIT` without asking upstream again — one bad minute upstream
  taking every Overpass-backed layer down for a month. Success only, now, and a
  4xx joins 5xx in serving last-good from disk at any age. Measured back to back
  on the same server, fresh cache keys: Lyon, Marseille and Nantes went 503 →
  200 with 21, 23 and 4 installations; in the browser the layer reports `ready`
  with BA107 Villacoublay, le Mont-Valérien and le Fort de Rosny drawn. Six
  regression tests in `overpassProxy.test.mjs` pin the rotation. Worth knowing
  separately: the other three mirrors were all answering 502/504 that day, so
  `overpass-api.de` was the only healthy one — which is why this filter hit so
  hard.

- **"Bâti 3D could not start cleanly" was a camera, not a fault.** Turning the
  layer on from a wide view failed outright: the toggle flipped straight back
  to OFF under an error toast, with a perfectly healthy IGN feed behind it. Two
  faults, one symptom. The layer refuses a request box wider than **0.08°** and
  returned that refusal as `false` out of its first `update()` — which the data
  manager reads as the module REJECTING its lifecycle, so it tore the layer
  down and said so. A load that fetched nothing because it was asked for
  nothing is now not a failed load, in Bâti 3D, the mapped grid and Hub'Eau
  alike. And the guidance it replaces is now carried out instead of announced:
  an explicit enable **flies the camera to the view the layer needs** and loads
  it. Measured over France at 420 km: 420 000 m → 2 900 m, buildings drawn, no
  error published anywhere. The flight only answers explicit intent — a share
  link or a Context restore keeps its own camera — it zooms in and never out,
  it steepens a horizon-facing pitch (no altitude alone can shrink a view that
  reaches the horizon), and it refuses to fly at all when the coverage in shot
  is a sliver at the edge of a camera aimed somewhere else: 400 km over Berlin
  clipping Alsace stays over Berlin. New harness: `npm run qa:view-gate`.

- **A scan with no coordinates no longer answers about the Gulf of Guinea.**
  `searchParams.get('lon')` is `null` when absent, `Number(null)` is `0`, and
  `Number.isFinite(0)` is true, so `GET /api/gpu` with no query string returned
  HTTP 200 and an empty result for 0°N 0°E — indistinguishable from "there is
  nothing at your address". Now HTTP 400. Pinned by `addressProxy.test.mjs`.

- **The address markers were unclickable, and half of each one was eaten by the
  ground.** Two separate faults, both invisible to a unit test. The app runs
  with `infoBox: false`, so an entity's `description` displays nothing on its
  own — every layer must own a `LEFT_CLICK` handler, and these five did not, so
  clicking a marker did nothing at all. Separately, `disableDepthTestDistance`
  was a finite 2 500 m, which re-enables depth testing the moment the camera is
  further off than that: at city zoom the terrain clipped the lower half of
  every disc. Markers now draw always-on-top, own a click handler, and open the
  same world-overlay card as their sibling layers.
- **Five registers over one building, drawn as five identical dots.** Turn on
  Ventes immobilières and Performance énergétique together and both painted
  coloured discs over the same roofs, with nothing to say which register a dot
  came from. Size and hue were already spoken for — DVF spends its colour on
  the price against the local median, DPE on the official A–G scale — so SHAPE
  was the only channel left, and it is the right one anyway: it survives at
  16 px and it survives colour blindness. Each register now draws what it is
  about: a **€** for a sale, **the A–G letter in a frame** for a diagnostic (so
  the grade no longer needs a click), a **hazard triangle** for Géorisques, a
  **plan sheet** for the PLU, and **the mode's own pictogram** for an IDFM
  stop. Every glyph is white line-art over a dark halo and carries no hue of
  its own, so `billboard.color` still delivers each layer's value channel
  untouched.

- **The address markers slid across the city as you moved the camera.**
  `Cartesian3.fromDegrees(lon, lat)` puts a marker on the ELLIPSOID, at height
  0, and the globe draws avenue de France at **79 to 83 m** — so every DVF sale,
  every DPE diagnostic, every risk site and every IDFM stop stood eighty metres
  under the street it describes, painted anyway because depth testing is off.
  Under an oblique camera a vertical error is a HORIZONTAL error on screen, and
  it changes with every camera pose: measured at 700 m and a pitch of −35°, a
  DVF dot landed **83 px** from its own address, and turning the camera moved
  that error **62 px sideways**. The reported symptom was exactly that — the
  dots are not fixed, they move when you nudge the map. Markers are now placed
  at the height of the terrain the globe is actually rendering, and re-seated as
  terrain streams in and as the LOD refines. Measured after the fix: 0 px, from
  both poses, on all five layers.
- **The address layers only noticed you had moved every five minutes.** They
  are camera-driven, but their refresh cadence is the manager's tick — 5 to 15
  minutes, right for registers that change in weeks and useless for someone
  flying across a city. Navigating to a new address left the previous
  neighbourhood's answer on screen until the timer happened to fire, which reads
  exactly as "the layer has trouble refreshing". All five now listen to
  `camera.moveEnd` with a 450 ms settle, matching the BD TOPO layer, behind a
  single-flight guard so a fly-through queues one repeat rather than a request
  per frame. They also request a repaint explicitly: the render governor runs in
  `requestRenderMode`, so a redraw nobody asks to paint never reaches the screen.
- **`HeightReference.CLAMP_TO_GROUND` makes a point unpickable.** It reads like
  the right answer for an annotation that belongs to a building; measured in the
  running app it produced 30 drawn Géorisques points where `scene.pick` and
  `scene.drillPick` both returned nothing. No point layer in this repo uses it,
  and these no longer do either.
- **Zoning outlines are not click targets, and no longer pretend to be.**
  Clamped polylines render as ground primitives and are not pickable here — 62
  vertices of one easement ring on screen, `scene.pick` null at every one.
  Widening the stroke did not help. The urbanism layer now plants a marker at
  the point it scanned, carrying the zone, its approval date and the easements
  crossing it, because a zoning rule describes the ground under an address
  rather than a particular line on a map.

### Notes

- Every price per square metre this release computes is deliberately absent for
  multi-lot sales, swaps and auctions. One captured Paris mutation is
  €32 000 000 spread over **179 rows**: summing the column inflates the 2024
  edition of the 13ᵉ from €0.89 bn to €15.33 bn, and dividing the first row by
  its 25 m² flat gives €1.28 million per square metre. The register does not say
  how such a sale was split, so neither does the layer.
- Added the **Établissements scolaires** layer — every school France
  registers, keyless. The *Annuaire de l'éducation* is published by the
  Ministère de l'Éducation nationale on data.education.gouv.fr under Licence
  Ouverte 2.0 and rebuilt daily: 68,939 rows on 2026-09-01, of which 68,557 are
  open and **68,158 are open and carry a coordinate** — the set the layer
  draws. Three regimes by view span, as the IRVE layer: the 96 départements
  with the country in view, a spatially thinned *maillage* of real positions in
  between, and every establishment with its card over a city. Coloured by
  school level, sized by pupils.
- The register holds no roll, so the roll is a join, and its completeness is
  stated rather than assumed. Dot size comes from the ministry's four per-level
  *effectifs* datasets at rentrée 2025, joined on the UAI: **57,683 of the
  62,918 open, geolocated teaching establishments get one (91.7%)**,
  11,237,267 pupils in total. The 5,235 that do not are named — 2,212 are
  sub-UAI SEGPA and SEP *sections* whose pupils are already counted inside the
  collège or lycée at the same coordinate, and 455 are under the ministry of
  Agriculture. A school with no roll draws at the base size and its card says
  *effectif non publié*; it is never drawn as, or described as, a school with
  no pupils.
- The register's own uncertainties are surfaced instead of flattened:
  - `precision_localisation` is its account of its own geocoding, and it is not
    uniform — **2,159 rows are placed at their commune's centroid, not at the
    school**. Those cards say so. The 22 published spellings fold onto a
    four-step ladder, and an unrecognised one resolves to *unknown* rather than
    inheriting "exact address".
  - **399 open establishments have no coordinate at all**, and 332 of them are
    one place: French Polynesia's 311 and Wallis-et-Futuna's 21 are ungeocoded
    in their entirety. They are excluded at the query rather than placed at a
    commune centroid, and the shortfall is carried to the client.
  - A UAI is an administrative unit, not a building, so two dots can share one
    address. Every site carries its `etablissement_mere`, and the card names
    the parent.
  - `restauration`, `hebergement`, `ulis`, `segpa` and `apprentissage` publish
    1, 0 **and null**, where null means "not declared". The card lists what is
    declared present rather than denying what was never stated.
- The national choropleth is metropolitan and admits it. The bundled
  département polygons are 96 features with no overseas geometry, so **2,762
  open, geolocated schools cannot be painted** — La Réunion's 855, Guadeloupe's
  448, Martinique's 403 and the rest, plus 9 island schools the simplified
  outlines drop. They are counted, named, and reported on the national row
  line; the other two regimes draw positions and show all of them. Assignment
  is point-in-polygon and never a code join, because the register spells
  Corsica `02A` where the IGN outlines say `2A`.

- **The roads the State measures but never says where.** Bison Futé's counting-station
  referential publishes a position for 843 of its 1 367 stations. The other 525 are
  not positionless — 153 of them publish an ADDRESS, the point repère that the French
  road network is actually numbered by, and every kilometre post of the non-conceded
  network is published with its Lambert-93 coordinates in a second open dataset, the
  [Bornage du réseau routier national](https://www.data.gouv.fr/datasets/bornage-du-reseau-routier-national)
  (51 940 posts, Licence Ouverte 2.0, keyless). Joining the two recovers **all 115
  stations of DIR Ouest**, which had never been drawn, plus 26 of DIR Atlantique, 10 of
  DIR Centre-Est and 2 of DIR Est. The join is **calibrated on every build rather than
  trusted**: 831 stations publish an address *and* a coordinate, and resolving theirs
  disagrees with the DIRs' own answer by a **median of 3.8 m** (p90 7.2 m, max 64 m,
  99.8 % within 25 m) — because the DIRs derive the coordinates they publish from this
  very referential. The number is recomputed and stored in the committed index each
  run, so an edition that stopped agreeing would move it in the build log before it
  moved a station on screen.
- **Nantes, Rennes, Saint-Brieuc and Lorient–Vannes are on the map.** The four Breton
  traffic centres publish 619 live road states under identifiers that appear in no
  referential row — which is why the layer drew nothing over a quarter of Brittany.
  Those identifiers turned out to be point-repère addresses themselves:
  `35A0084T096_00D` is département 35, route A84, PR 96, abscissa 0, right-hand
  carriageway. **602 of them resolve**, four cities move from the layer's "state
  published, position withheld" table to its showcase list, and the committed geometry
  goes from **1 195 sites / 832 located** to **1 958 / 1 587**, 608 of them full
  segments over **975 km**. A site placed this way says so on its card — *"position
  resolved from its kilometre post (PR), median 4 m"* — because a derived position and
  a published one are not the same claim.
- **Segments follow the surveyed centre of their own carriageway.** The referential
  gives a counting station two endpoints and nothing in between, so every segment was
  drawn as a straight chord. Threading the kilometre posts between the two ends was the
  first answer and it could not carry the layer: **the median segment is 948 m long and
  the median post interval 1 000 m**, so 643 of 842 segments contained no post at all
  and stayed straight. The drawn line sat a median **56 m** from its own tarmac, 142 m
  at p90, **411 segments past 25 m** — on the Bordeaux rocade, a green line cutting the
  inside of every curve. The shape now comes from the dataset next door:
  [Liaisons du réseau routier national](https://www.data.gouv.fr/datasets/liaisons-du-reseau-routier-national)
  (DGITM, Licence Ouverte 2.0, keyless) publishes **56 205 polylines, 1.66 M vertices,
  one per point-repère interval, at a mean 26 m between vertices** — against the
  1 000 m the posts offered. **The join needs no geometry at all**: every section NAMES
  the two posts it runs between, in the address grammar this build already reads, so it
  is placed in the same cumulative-distance space the bornage is sorted by — and the
  coordinates are then free to be checked rather than trusted. Over 33 483 joined
  sections the polylines' own ends sit **0 m from the posts they name at p50, p90 and
  p99**: the two files are cut from the same survey. **589 of the 608 real segments
  trace** (96.9 %), simplified at 4 m — under the width of a traffic lane — for a
  committed file of 485 KB against 364 KB. The 19 that do not are slip roads and
  unnumbered axes the point-repère referential does not address; they keep the post
  threading, or the chord, exactly as before. Three guards refuse to shape rather than
  guess: a section drawn more than 50 m from the posts it names, an endpoint more than
  150 m from any post of the road it names, and a trace running more than three times
  the straight line between its ends — the ring-road case, where shaping would wrap a
  segment around the whole of Bordeaux.
- **Lille stays dark, and that is a measurement, not a gap.** DIR Nord's 357 site ids
  were tested against the bornage both ways they can be read: three digits as the PR
  fits 24 % of them, two digits fits 75 % — but the two-digit reading puts DIR Nord's
  A1 sensors at PR 12–30, which is département 95, inside Île-de-France and 150 km
  outside its territory. A grammar that has to be wrong to parse is not the grammar,
  so the empty-state sentence over Lille now reads "under site ids that are neither a
  referential row nor an address" and the city keeps its explanation.

### Changed

- The maillage thinning and the point-in-département lookup now live in
  `src/data/geoMeshThinning.js` and `src/data/franceDepartements.js`, shared by
  the charge-point and schools layers instead of duplicated. `irveMesh.js` and
  `irveDepartements.js` keep their full export surface and their measurements;
  their unchanged test suites are what prove the extraction was faithful.

- **The Data Layers panel is grouped and in French.** Thirty-four datasets no
  longer arrive as one flat list ordered by the accident of which PR merged
  first. They sit in **eight thematic groups** — *Air & espace, Défense,
  Maritime, Mobilité terrestre, Énergie, Risques & environnement, Réseaux &
  capteurs, Bâti & territoire* — each a collapsible section whose header carries
  its own tally (*"2/8 ON"*) and turns cyan while anything in it is live. Every
  group opens by default; a group you close is remembered, per group, across
  reloads.
- **Every row now reads in French.** *Live Flights* is **Vols en direct**, *Live
  AIS Vessels* is **Navires en direct**, *Mapped Installations* is **Sites
  militaires**, *Street Traffic* is **Trafic routier**, *Groupes de prod (FR)*
  is **Groupes de production**. The five `(FR)` suffixes are gone: a small
  **FR** / **US** / **VILLES** chip now says where a layer has data, once, on
  the sixteen rows where the answer is not "everywhere" — and nothing at all on
  a global layer, because a badge on every row is a badge on none. The panel
  widened from 280 to 320 px to hold the longer names on one line.- Added the **Bornes IRVE** layer — every public EV charge point France has
  declared, keyless. The *fichier consolidé des bornes de recharge pour
  véhicules électriques* is assembled daily by transport.data.gouv.fr from the
  operators' own filings and republished by **ODRÉ** under Licence Ouverte 2.0:
  231,079 points de charge, loaded per viewport, drawn as one dot per *site*,
  coloured by the highest power band installed there and sized by how many
  charge points are there. Clicking one gives the split by power, the
  connectors, the access conditions, the operators — and the span of that
  site's own declarations rather than the age of the poll.
- It is installed capacity, not availability, and says so. The register
  publishes where the charge points are, never whether any of them is free, so
  the layer draws no availability colour and prints no "libre" count.
- The register disagrees with itself in ways that a naive read gets visibly
  wrong, so seven of them are absorbed server-side and pinned against a
  captured payload:
  - `coordonneesxy` is **labelled backwards** — its `lon` key holds the
    latitude — on every row checked, and `geo_point_borne` is null on all
    231,079, so Opendatasoft's own geo filter matches nothing. Only the
    consolidated columns are read.
  - The station id fragments the station: Q-Park's Grande Arche car park
    publishes **127 station ids at one coordinate**, and 1,192 rows nationally
    publish the literal string `"Non concerné"`. The render unit is the
    coordinate, rounded to ~1.1 m.
  - 442 of 3,812 Île-de-France sites carry two "operators" publishing an
    **identical** power profile at the same point — 7.5% of the area's charge
    points, counted twice by any plain sum. Identical profiles collapse;
    overlapping ones never do; both totals travel to the client.
  - 3.0% of rows publish a power no charge point can have (771 rows at 7,360 —
    watts in a kilowatt column — and 5,315 at ≤ 0). Those are counted in an
    explicit *puissance non exploitable* band rather than rescaled by a guess
    that would turn a real 600 kW bank into 0.6 kW.
  - `consolidated_is_lon_lat_correct` is False for two different reasons. False
    with no verified commune (80,545 rows) means *unverifiable* and is kept;
    False with one (5,361 rows) means the position contradicts its own commune
    and is withheld and counted. Reading the flag as one thing would either
    discard a third of France or leave a Gironde site drawn south of Madagascar.
  - Booleans arrive in nine forms including `"False"`, which JavaScript coerces
    to `true` — that alone would report every paid site as free.
  - Some publishers ship Mac-Roman accents decoded as Latin-1, which would
    split one legend row into four.

- **Bornes IRVE** gained its middle regime — the *maillage*. The layer now
  answers at three scales instead of two: the 96 départements while the whole
  country is in view, real site positions thinned onto a 30 × 20 grid once
  France is cropped, and every site with full detail over a city. Only one is
  ever drawn, and each carries its own legend.
- The thinning is spatial, not by rank: every occupied grid cell gets a dot
  before any cell gets a second, so the Massif Central stays visible as sparse
  rather than vanishing. Taking the biggest N instead would have collapsed
  France to a dozen conurbations.
- And each cell is represented by its most common band rather than its biggest
  site. Picking the largest drew **46.2% of the dots as high-power DC when
  12.2% of the sites in view were** — the biggest site in a rural cell is the
  motorway bank — which made the map say France runs on 300 kW chargers when
  it runs on 22 kW ones. The modal rule brings that to 8.7% against 12.2%
  true. The residual (`normale` at ~46% against 36%) is stated in the legend
  rather than hidden.
- The national point set is served once (`/api/irve-fr/mesh`, 39 579 tuples,
  0.9 MB, cached a day) and picked in the client, so panning the maillage
  costs no round trip.
- The layer's share-link token is **`8`**, not the `l` this work was originally
  written against: `l` went to **Centrales EDF** while the branch sat unmerged,
  and two layers on one token is a share link that silently enables the wrong
  one. Links written before this lands never carried an IRVE token at all, so
  nothing in the wild changes meaning.

- **Clicking a parcel now answers what is on it, not only where it is.** The
  card leads with the **address** (Base Adresse Nationale, keyless, Licence
  Ouverte 2.0) and carries **what is built there** from IGN BD TOPO — the
  building count, their footprint, the share of the parcel they cover, the
  tallest, the storeys, the dwellings and the dominant use — plus the parcel's
  own longest dimension. `24 Rue Paul Valéry 75116 Paris · 1 bâtiment · 1 026 m²
  au sol · 83 % de la parcelle · R+7 · 25 logements`.
  - **Neither join is published, and both lines say so.** BD TOPO and the PCI
    are two products with two lineages and no key between them, so a building
    belongs to the parcel its footprint centre falls on — a stated rule the card
    names, wrong in both directions at a boundary. BAN answers with the NEAREST
    address point, so the distance it publishes is printed beside the address
    past 10 m and the answer is dropped entirely past 60 m: on a card whose
    subject is which piece of ground you are looking at, a confidently wrong
    address does more damage than a missing line.
  - **A building near a tile edge is in both tiles.** Measured over Paris 16e: a
    naive join of two z15 tiles reported 25 buildings on a parcel that has 14,
    with one identifier appearing three times at 2 983, 13 and 5 042 m². Vector
    tiles carry a buffer. Deduplicating on `cleabs` — present on 100% of the
    1 202 features in a sampled tile — is the difference between 89% built and
    56%.
  - Both lookups run only on a click, are memoised per parcel, and fail as
    absences: the cadastre's own card is complete and correct without either.

### Fixed

- **Clicking a parcel highlighted a shape somewhere else.** Selection asked
  Cesium what was under the cursor, and `scene.pick` against ground-
  classification geometry answers with whichever shadow volume the ray enters
  first — which at the grazing angles this globe is normally flown at is not
  reliably the parcel visible under the pointer. The polygons are already in
  memory, so a click is now resolved against them directly: exact, independent
  of the classification pass, and testable without WebGL. Clicking a courtyard
  or a street selects nothing, which is the honest answer — the gaps in this
  layer are the public domain, and answering with the nearest parcel would
  invent one where France publishes none.
- **A pan dropped the selection and left the card behind.** Rebuilding the
  records on a new viewport cleared `_selectedId` without clearing the overlay,
  so the card stayed on screen describing a parcel that was no longer drawn,
  no longer highlighted and no longer clickable. The selection is now matched
  back by IDU after a redraw, and cleared with the records when the parcel has
  genuinely left the box.
- **The layer would not load at street level on a tilted camera.** The viewport
  gate read the span of `computeViewRectangle`, which on a TILTED camera returns
  everything the lens can see down to the horizon — a statement about the pitch
  far more than about how close the operator is. Measured in the app at 240 m
  over Paris: 0.0038° of longitude looking straight down, 0.0084° at 45°, and
  **0.0397° at 25°** — the same altitude, a tenfold spread. This globe defaults
  to an oblique view, so the layer refused to draw while the operator stood in
  the street with the parcels in front of them, and the row told them to zoom in
  when they already had.
  - The gate is now the camera's **altitude** (≤ 1 500 m), which is stable under
    pitch, and the row says "Descends sous 1 500 m" rather than naming a span
    the operator cannot see.
  - The request is a ≤ 0.02° box anchored on the point the **middle of the
    screen** meets the globe, clipped to the view. Under a nadir camera the view
    is the smaller of the two and the box IS the view, so nothing off-screen is
    ever requested; under a tilt it is the near and middle ground around what is
    being looked at, and the far half of the screen — where a parcel is well
    under a pixel — is not asked for. Anchoring on the camera's own position
    instead would load the ground behind the operator's shoulder.
- **And the proxy then rejected its own client.** Because the anchored box is
  exactly the client ceiling on both axes above a few hundred metres,
  `snapBoxOutward` — which moves all four edges out by up to a full grid step —
  reliably pushed it past a proxy bound that only allowed one step of growth.
  The layer 400'd at 400 m, 800 m and 1 200 m over Paris while working at 240 m,
  which is the shape of a bug that a span-sized box had been hiding. The bound
  now allows two steps for the snap and a third for floating point.

Verified over Paris 16e on the oblique view that reported it: 2 393 parcelles at
239 m, 4 426 at 800 m, 3 736 at 1 400 m, and the guidance line above that.

- **The Événementiel-DIR road-events attribution was never rendered** — the
  same merge shape that erased the power grid's ODbL notice a week earlier.
  Two branches each appended a credit at the same point in `DATA_CREDITS`, and
  the three-way merge kept both bodies but lost the `},\n  {` between them, so
  `bison-fute-events` and `irve-charge-points` shared one object literal and the
  second `key`/`html` pair silently overwrote the first. The road events layer
  has been drawing Licence Ouverte data with no entry in the attribution
  popover. Both are now separate objects.
- **And the shape is now caught rather than found by accident.** Twice it took
  someone adding an unrelated credit next to it to notice, because every
  runtime invariant still holds: the array is well formed, every entry has a
  key, no key is duplicated — it is simply one entry shorter.
  `src/data/dataCredits.test.mjs` reads the source and asserts the number of
  `key:` and `html:` properties matches the array length, which is the only
  place the evidence survives.
### Fixed

- **234 road-status "segments" were points wearing a segment's shape.** Their
  referential row publishes a start equal to its end, and they were being written as
  four-number segments and handed to Cesium as zero-length ground polylines — geometry
  it cannot stroke. They are now written as single points, which is what makes the
  renderer draw them as the 25 m stub a positioned station with no extent deserves.
  The segment count falls from 842 to 608 and nothing is lost: the difference was never
  234 roads.
- **A rebuild of the road-status index reported Brittany as unlit.** The coverage table's
  `fromPointRepere` counted what a run had newly placed rather than what the file held,
  so the second build against an already-complete index reported zero for Nantes,
  Rennes, Saint-Brieuc and Lorient–Vannes on a day nothing about them had changed. It
  now counts from the committed record, and the assertion that guards those four cities
  survives a re-run.
- **One refused tile took the whole Bâti 3D layer down.** A city-sized viewport is 24–60
  separate requests to the Géoplateforme, a free service that rate-limits at 400 req/min
  and answers 5xx under load; they were gathered with `Promise.all`, so a single refusal
  rejected the entire load, blanked the buildings and put the layer into a 20 s→4 min
  backoff with fifty-nine good tiles in hand. This is why the layer failed to load on
  the hosted deployment and not on a laptop. A refusal is now per-tile: the squares that
  answered are drawn, the shortfall is counted, the row reads *"N tuiles BD TOPO refusées
  sur M — bâti incomplet, nouvelle tentative"*, and the layer asks again. Only every tile
  refusing is still a failure — there is nothing to draw then. A partial answer is marked
  DEGRADED and never passes as a whole city.
- **A school's name depended on how far you had zoomed.** The national *maillage* pack
  ships coordinates and not names on purpose — carrying them takes it from 1.66 MB to
  5.42 MB — so a dot clicked at region scale produced a card titled "Établissement" and
  an instruction to zoom in, while the same school two zoom steps closer was "Collège
  Jean Moulin". A click now asks the register for that one coordinate and the card
  becomes the full one, name included; the answer is remembered for the session, so
  re-clicking costs nothing. Where several UAIs share an address — 2,212 SEGPA and SEP
  sections nationally sit at their parent's coordinate — the dot's own level picks
  between them and the card says how many others are there.
- **DETECT described schools by their level or their roll, never by their name.** A
  callout read "412 élèves", which names nothing, or "École", of which a district has
  hundreds. It now reads the establishment's published name — "Collège Jean Moulin" —
  prefixed with its level only for the 2.6% of register names that do not already state
  one ("Lycée · Institution Saint-Pierre").

## [Unreleased] — 2026-08-31

### Added

- **Every live transit vehicle now carries the operator's own delay and
  disruption.** All 150 French vehicle-position feeds have a `TripUpdate`
  companion in their own dataset — and **63 of them ARE that companion**,
  publishing both in one protobuf body, so for those the delay is bytes already fetched rather than a
  second request. The dev-server proxy joins that prediction to the vehicle
  already on screen and sends four things with it: how far off the timetable the
  operator says the run is, whether the run has been **cancelled**, which of its
  remaining stops it will **skip**, and the operator's own sentence about its
  line from `Alert` (60 feeds carry them). The card reads *"🕘 9 min late"* and
  *"⚠ Bordeaux : travaux quai de Paludate (this line · detour)"*, the ambient
  contact label reads *"LN 15 +9m"*, and the control-panel row says *"1 network ·
  25 late"* without a click. Measured 2026-08-31 over the 30 largest live
  networks (1,865 vehicles): **67% of vehicles join a trip update** by `trip_id`,
  a further 2% only by vehicle id, and **38% end up with a deviation**. The gap
  is not a join failure — 17 of those 30 networks publish an absolute predicted
  `time` and never a `delay`, and converting one to the other needs the 223 MB
  `stop_times.txt` this project refuses to load. Those vehicles read *"run
  tracked · no delay published"* instead of showing zero, because a viewer must
  be able to tell "on time" from "nobody said".
- **A bus parked at its terminus is not fifty-six minutes early.** A vehicle
  waiting for a departure an hour away publishes a predicted arrival of "about
  now" against a scheduled arrival an hour ahead, and the deviation the operator
  computes is −3,361 s. Printed as punctuality that reads *56 minutes early*,
  which is not a thing a bus can be. `transitSchedule.awaitingDeparture` catches
  it — stopped at the first stop of its own run, ahead of schedule — and reports
  *"🕘 waiting to depart · due out 22:46"* instead. Over one Bordeaux viewport
  that is the difference between a summary claiming **28 early** and one saying
  **7 early, 13 waiting**. The rule is deliberately one-sided: a vehicle at its
  first stop running LATE has an overdue departure, which is real lateness.
- **Which resource carries a network's delays is now measured, not guessed.**
  The PAN catalog never says which trip-update resource pairs with which
  position feed, and a dataset can publish several of each — Astuce ships three
  position feeds and four trip-update feeds, one per operator, on interleaved
  ids. `scripts/build-pan-gtfs-rt-index.mjs` now probes the candidates and keeps
  the one whose trips actually **join this feed's own vehicles**, committing the
  measured join rate alongside. Adjacent resource ids are only the ranking hint:
  they pair TaM's urban and suburban feeds correctly and get Astuce wrong, where
  measurement scores the right body at 90%. Mean measured join rate across the
  79 networks with vehicles running at build time: **0.92**.
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

- **Click a live bus and see the line it is running.** Selecting a vehicle in
  **Transit FR** now draws its **route trace on the ground in the operator's own
  colour**, marks **every stop of the run it is on**, and adds to the card the
  line's public name, the stop it is heading for with a countdown and schedule
  deviation, and its terminus. Bordeaux's Lianes 35 draws as a 32 km loop with
  its 82 stops and reads *"▸ Avenue de l'Europe · due · 5 min late / ⇥ Gare
  Saint-Jean · 67 stops"*. Escape puts it all away again.
- **The two halves of that answer come from two feeds, and degrade separately.**
  The **trace, the line's name and its colour** come from the network's static
  GTFS — through the PAN's own **GeoJSON conversion** of it, so `shapes.txt`
  (36.7 MB compressed for Normandie) is never downloaded; the **ordered stops
  and their predicted times** come from the network's live **GTFS-RT
  TripUpdates** feed, which every one of the 142 datasets publishing vehicle
  positions also publishes. A network with no usable trip update still gets its
  line drawn, from `route_id` alone, and the card says the stops are not listed.
- **Which of a line's traces the run is on is measured, not guessed.** A French
  line publishes several shape variants and the conversion drops `shape_id`, so
  the layer picks the variant that carries **every one of the trip's own stops**
  — measured against all 897 of TBM's running trips on 2026-08-31, all 897
  matched at a median stop-to-trace offset of 3 m. When no variant fits, the
  **whole line** is drawn instead of one run of it and the card says so.
- **`npm run transit:static`** builds `config/pan_gtfs_static.json` (196 KB,
  URLs only): for each of the 148 queryable vehicle feeds, its TripUpdates
  sibling and its static GTFS's GeoJSON conversion. Geometry itself is fetched
  on demand and cached under `.gev-cache/pan-gtfs-geo/` — a first click on a
  network costs 0.87 s, every later one 18 ms.
- **A new layer: the State's own traffic sensors on the French national road
  network.** `Road Status FR` (`road-status-fr`) draws **830 segments, 918 km**
  of the non-conceded RRN, coloured every 60–360 s by the sixteen DIR
  traffic-management centres' own DATEX II `trafficStatusValue`, and carries the
  one measurement TomTom has no equivalent of at any price: a **vehicle count**
  — veh/h and average km/h per station, from Bison Futé's six-minute national
  snapshot. Keyless and Licence Ouverte 2.0, so on a build with no
  `TOMTOM_API_KEY` — where the traffic layer runs its simulation — this is the
  only measured congestion data on the globe. It is brightest exactly where
  `Transit FR` is dark: Marseille (186 segments), Toulouse (127), Lyon (106) and
  Saint-Étienne (100) publish no live bus at all.
- **The geometry is built offline, because the published referential is three
  traps.** `npm run road-status:index` commits
  `config/datex_traficolor_sites.json` (178 KB, 1 195 sites, 832 located).
  `refDir.csv` is in **Lambert-93**, so `scripts/lib/lambert93.mjs` reprojects
  it — deriving the projection constants from its defining parameters and
  asserting them against IGN's published NTG_71 values rather than pasting
  numbers a typo would turn into a silent kilometre. It is **regenerated every
  six-minute cycle with a moving row set** (1 197 stations in one cycle, 1 192
  in the next), so the build UNIONS successive cycles instead of trusting one.
  And it **declares twenty columns while publishing nineteen** on every row, so
  the parser reads positionally: a header-zipped read puts `nb_voies` in the
  easting and makes most of the network look unlocatable, which it is not.
- **Two different kinds of empty, kept apart.** Île-de-France has no publisher
  at all — the DIRIF appears in neither publication, verified three ways — while
  Lille, Nantes, Rennes, Saint-Brieuc, Lorient–Vannes and Nancy–Metz publish a
  live colour for **1 046 sites whose position nobody publishes**. A viewport
  over Lille now reads "357 live road states published under site ids that are
  in no national referential row" instead of a blank that looks like a bug, and
  `roadStatusCoverage.test.mjs` cross-checks every such claim against the built
  index so a DIR that starts publishing coordinates fails the suite rather than
  leaving a city wrongly dark.
- **Nothing is inferred from the count.** A located station no traffic centre
  watches stays grey and reads `Not reported` rather than being folded into free
  flow; where two centres report one site the WORSE state wins; flow and speed
  are labelled **6-min average**, never as an instantaneous reading; and a
  station that counted nothing says so instead of printing "0 km/h" — 114 of
  1 192 stations at 22:30 CEST, which is a fact about the hour, not a jam.
  Proven end-to-end by `npm run qa:road-status-fr` (18 checks) and 44 new unit
  tests.
- **Live French transit vehicles now say what they ARE.** GTFS-Realtime carries
  no vehicle class, so `npm run transit:route-types` joins each network's static
  GTFS `route_type` and commits `config/pan_route_types.json` — 147 feeds, 7,044
  routes, 195 KB. It reads **one member** out of each remote archive
  (`routes.txt`, 8.7 KB inside Bordeaux TBM's 26.7 MB / 250 MB-expanded feed)
  via HTTP range requests where the publisher allows them, so the national build
  transfers ~136 MB instead of ~1.5 GB. A Bordeaux viewport now separates its
  **67 trams and 3 Garonne river shuttles from its 358 buses**, coloured and
  labelled per class. Measured 2026-08-31 the join types **92.7% of the national
  live fleet**; the rest keep a neutral glyph and read `Type unknown` rather than
  borrowing their network's service class, which is a different question.
- **Transit vehicles are drawn as vehicles.** Each class now renders with its
  **Material Symbol** (Apache-2.0, vendored path by path under
  `licenses/material-symbols/`): a bus with a windscreen and headlights, a tram
  with its pantograph, a river shuttle as a boat, a métro, a funicular, a cable
  car. An earlier pass drew hand-made plan-view silhouettes and they were
  internally consistent and unrecognisable — recognition beats invention. The
  icons are FRONT views and so are never rotated; the operator's bearing is
  drawn instead as a small wedge that ORBITS the icon on its own billboard, so
  a bus stays a bus while still showing which way it is going. A vehicle whose
  feed publishes no bearing has no wedge, which is the same statement the bare
  disc used to make.
- **The road layer reaches metro altitude.** `trafficBounds.ROAD_FETCH_TIERS`
  replaces one fixed 0.05° fetch box with three altitude bands, the coarsest
  drawing arterials across a **0.30° (~33 km) box up to 30 km** — where it used
  to switch off at 8 km. Animated road traffic and the live transit fleet can
  finally share a frame over a whole French métropole: measured over Bordeaux,
  1,605 road dots and 356 live vehicles at once. The coarse band is cheaper than
  the street band it sits above (1,929 ways vs 3,701). Two new scene recipes,
  **Bordeaux Transport Pulse** and **France Transit Showcase**, are written
  against those bands.
- **The layer says where it has nothing, and why.** `src/data/transitCoverage.js`
  records the measured French coverage map — Paris intra-muros, Lyon, Marseille,
  Lille and Strasbourg had **zero** live vehicles at a Monday peak on 2026-08-31,
  because Île-de-France Mobilités publishes no GTFS-Realtime at all, Marseille
  publishes alerts only and Tisséo trip updates only. An empty viewport there now
  names the publisher and points at the nearest city that works, instead of
  reading "no PAN feed covers this view" and looking like a bug. A unit test
  cross-checks every "dark" claim against the shipped feed index, so an operator
  that starts publishing breaks the build.
- **The shipped PAN index deduplicates and quarantines itself.** Some networks
  publish one body under two resource ids — Kicéo's twin returned the same 59
  vehicles, drawn twice. `src/data/panFeedHealth.js` finds candidates by
  positional fingerprint and confirms them on a second probe **by roster only**,
  because the fleet moves between probes. A run of failed probes takes a feed out
  of viewport selection without deleting it, and any success revives it.
  `/api/transit-fr/feeds` now reports shipped and queryable counts side by side.

- **Événements routiers (FR): what the road operators themselves declared.** A
  new layer in **MOBILITÉ TERRESTRE**, keyless, Licence Ouverte 2.0, through a
  new `/api/bison-fute` proxy. It draws `Événementiel-DIR` — the national DATEX
  II aggregate every Direction interdépartementale des routes publishes its
  event log into. On the snapshot it was built against that was **286 situations
  holding 600 records**: nine accidents, one queue, 48 obstructions, 184
  roadworks orders, four closures and the diversions posted around them, across
  eight categories with their own legend.

  It is the companion to **Road Status FR**, which landed the same week and
  reads this publisher's OTHER product: that layer draws how the network is
  *flowing* (Traficolor status, veh/h, km/h), this one draws what has been
  *declared to have happened on it*. Neither reads the other's feed.

  Three decisions are the layer:

  - **One situation, one marker.** DATEX II nests up to twelve records inside a
    single situation — the accident, the two lanes it blocked, the four exits
    now closed. Drawing them all would put one crash on the map twelve times,
    so the CAUSE is drawn and the consequences are counted on its card
    (`+ 5 déviations`). An accident outranks the lane closure it caused; a
    diversion only wins when a situation is nothing but diversions.
  - **Planned is not happening.** 68 of the 286 had not started yet — works
    ordered for October. They are hidden by default, drawn dimmer and smaller
    under the `+ À venir` chip, and a globe that painted next month's roadworks
    over tonight's traffic would be saying something false about now.
  - **Ended means ended.** A rockfall opened on 31 January, cleared in March,
    and published with **no end time at all** — only the operator's lifecycle
    flag says it is over. Read on its validity window it has been blocking the
    N20 for seven months. The flag wins.

  The layer covers the **réseau routier national non concédé** and says so. The
  conceded motorways — the whole ASF/APRR/Sanef network — are not in this feed
  at all; Bison Futé serves them under the credentialed *Action b* / *Action c*
  licences, and their absence is a property of the source rather than a gap the
  layer hides. Two further caveats are stated rather than hidden: a `Linear`
  event publishes only its two endpoints, so a segment is the straight chord
  between them (median 1.77 km on the capture; the card says so past 10 km), and
  records the feed marks `probable` or `riskOf` are labelled unconfirmed.

  Under the hood: `bisonFuteFeed.js` holds a ~90-line DATEX II reader (no new
  dependency), the situation classifier and the primacy ordering, pinned by 17
  unit tests against a real captured document — including the rockfall with no
  end time and the situation whose internal operator notes must not reach a
  public globe. The proxy refreshes with `If-None-Match`: the origin serves ETag
  and gzip (3.3 MB → 165 KB) and answers a conditional GET with a 304, which is
  what makes a five-minute poll of a 3.3 MB document affordable.
  `npm run qa:bison-fute` proves the rest in a real browser.

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

### Fixed

- **The power grid's OpenStreetMap attribution was never rendered.** Its entry
  in `DATA_CREDITS` was missing its object boundary, so `power-grid-osm` and
  `rte-actual-generation` shared one object literal and the second `key`/`html`
  pair silently overwrote the first — the ODbL credit for a layer that draws
  volunteer-mapped geometry simply did not appear in the Data attribution
  popover. Both entries are now separate objects, and 42 credits are registered
  where 41 were. Found while adding the Bison Futé credit next to it.

- **`npm run qa:traffic` could not boot at all.** It waited on
  `window.__godsEyeView` with puppeteer's default animation-frame polling, and
  software-rendered headless WebGL stalls the rAF loop — so the harness timed
  out after 60 s on an app that had booted perfectly well, reporting `0 passed,
  0 failed`. It now polls on an interval, the way `qa-transit-fr.mjs` already
  documented, and its screenshots are best-effort: a lost frame capture used to
  abort a run whose assertions had all passed. The traffic proof runs end to
  end again — 11 assertions, live and keyless.

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
