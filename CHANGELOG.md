# Changelog

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased] — 2026-08-26

### Added

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
- Two upstream traps are absorbed server-side in `edfPlantsFeed.js` and pinned
  against captured payloads: the hydro file publishes **`coordonnees_x_wgs` as
  the latitude** (read the usual way, Grand-Maison lands off Somalia) while the
  other two publish one `"lat, lon"` string, and
  `reserve_secondaire_maximale` is a **site figure repeated on every unit
  row**, so Cattenom offers 60 MW of reserve and not four times 60. 48 unit
  tests; `npm run qa:edf-plants` is the browser proof. Attribution registered
  in the Data attribution popover and DATA_SOURCES.md.

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
