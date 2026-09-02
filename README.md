<div align="center">

# 🌐 God's Eye View

### A spy-satellite simulator in your browser — then you realize the sources are public and the data is real.

Photorealistic 3D globe. Live aircraft, ships, satellites, earthquakes, traffic, and public cameras, with clearly labeled modeled views where a live feed is unavailable. Hands-free voice control powered by a realtime AI agent.

*No place left behind.*

![Orbital HUD, a tracked live globe, FLIR terrain — then OPEN SOURCED](docs/media/hero-open-source-reveal.gif)

<a href="https://www.youtube.com/@bilawalsidhu">
  <img src="docs/media/youtube-popular-videos.png" alt="The God's Eye View video series on YouTube" width="100%">
</a>

▶️ **From the project behind the viral God's Eye View series** *(formerly WorldView)* — [5M+ on YouTube](https://youtube.com/playlist?list=PL6qSg2I-7_koPbDnSMo0QeeHX_RknA2uv&si=nBGYMoHWQw41v93Q)

</div>

---

<div align="center">

**[Quick Start](#-quick-start) · [First Five Minutes](#-the-first-five-minutes) · [Talk to It](#-talk-to-it) · [What's Live](#-whats-on-the-globe) · [Under the Hood](#-under-the-hood) · [Keys & Costs](#-api-keys)**

</div>

---

## 🌍 Why This Exists

**You asked, so it's happening.** God's Eye View is open source. Track the world live. Talk to it. Break it. Extend it.

Most open-source intelligence is a pile of browser tabs. The signals are abundant, but the *interface* is the bottleneck. God's Eye View turns those signals into a **place**: the world is already broadcasting — flight transponders, ship beacons, orbital elements, seismographs, public cameras — and this makes it visible on a photorealistic 3D Earth in real time. No classified clearance required; it's public signal all the way down, and the interface runs in your browser, under your control.

> Half the magic is that it looks like a forbidden cockpit. The other half is that every line of code is inspectable.

The live layers are grounded in public feeds: the airliner crossing your screen is reporting telemetry, the camera is installed at a published location, and the ISS position is propagated from current orbital elements. The client deliberately renders flights one polling interval behind real time so it can interpolate smoothly. Some experiences are modeled rather than live: keyless traffic is labeled as a simulation, camera poses are estimated until calibrated, and launch ascent playback is marked `RECONSTRUCTED ESTIMATE`. Each layer keeps its source and freshness state visible, including partial, delayed, simulated, and unavailable states.

---

## 🎛️ What This Thing Does

- **🛩️ Cockpit view:** Ride inside a tracked flight — the camera holds the terrain under you all the way down.
- **📡 Contacts:** A 250 km roster of everything near your target — step through live aircraft and drop into any cockpit.
- **🎯 Click-to-track anything:** Camera locks on, draws a fading trail, surfaces full metadata — and a tracked fire or vessel hands you off to the nearest live camera in one click.
- **🖊️ Voice whiteboard:** Speak annotations onto the world — real boundary polygons, marks, and routes.
- **🛫 3D hangar:** Real per-class aircraft models — 787, ATR-72, Citation, Bell 206, MQ-9 — and a tracked contact swaps from glyph to 3D model as you close in.
- **🎨 Reskin reality:** GLSL sensor looks over the normal globe — CRT, NVG, FLIR/thermal, Noir, Snow.
- **🟩 Detection overlay:** Screen-space bounding boxes and IDs on everything in view.
- **🎖️ Military HUD:** Tactical heads-up display with intelligence-style telemetry.
- **🌐 Global Context:** Stage the full situational picture with one switch — and get your exact view back when you leave.
- **🎥 Scene director:** Capture cinematic camera tours for clips and demos.
- **🔗 Share Links:** Camera, style, layers, and even one tracked target serialize into a URL — a live target is a handoff, not a bookmark.
- **🏠 Reset Globe:** One control — or one sentence — back to the full Earth.

---

## ⚡ Quick Start

Requires Node.js 24.14.x or 26.x (enforced by `package.json`).

```bash
npm install
npm run dev -- --host localhost --port 4173
```

Open **`http://localhost:4173`**. **No key, no `.env`, no signup.** Cold start settles in under two seconds on a recent laptop (median 1.86 s in a point-in-time M5/Chrome capture — [docs/PERFORMANCE.md](docs/PERFORMANCE.md); a comparison baseline, not a hardware requirement). A first-run card offers to stage a mission for you — **Live Contacts**, **Space Missions**, **Environmental** — or leaves you to explore manually.

Keyless you get the globe on **OSM** worldwide, and over France the **IGN Géoplateforme** basemaps — BD ORTHO® at 20 cm and Plan IGN — plus every 🟢 data layer, which is most of them. Pick a source in the **MAP SOURCE** row of the Visual Presets tray.

To add the photorealistic 3D planet, copy `.env.example` → `.env` and set `GOOGLE_MAPS_API_KEY`. Everything in this README is color-coded — 🟢 needs nothing · 🟡 free key · 🔴 metered — and Google Maps is the only 🔴 that changes what the planet looks like. Full map in [Keys & Costs](#-api-keys).

The dev server binds to **localhost** — your keys stay on your machine. Sharing on a LAN and the cost rails live in [Keys & Costs](#-api-keys) and [SECURITY.md](SECURITY.md).

**macOS shortcut:** `./scripts/dev-fresh.sh` clears the Vite cache and pulls your keys straight from the Keychain. It runs keyless too, with a warning.

---

## 🕐 The First Five Minutes

No account, no signup. The first-run card will offer to stage a mission for you — or run this gauntlet yourself. Somewhere in these five minutes it stops feeling like a demo:

1. **Light up the sky.** Take the **Live Contacts** mission (or turn on **Flights** yourself) — thousands of live aircraft, gliding on real telemetry, detection mesh already reading the scene. Click one: the camera locks on, a trail draws behind it, and its live telemetry card comes up.
2. **Take the controls.** Hit **COCKPIT** on your tracked plane and ride it down, switching sensors mid-flight: NVG into Ironbow FLIR.

![Riding with a live aircraft in cockpit view while switching sensor modes](docs/media/06-cockpit-ar.gif)

3. **Drop into a busy airport.** Search one and descend to the taxiways with **3D** aircraft on — grounded contacts, taxi trails, the whole apron working in real time.

![Moving from a full airport overhead down to close taxiway inspection with 3D flight models](docs/media/start-here/airport-ground-traffic-google-3d.gif)

4. **Look through a public camera.** Turn on **CCTV** over Austin, London, California, or Lyon. The feeds aren't webcam embeds — they project *into* the 3D city. Click the panel preview to blow the frame up full-screen at the publisher's own resolution (most cameras send 1920×1080 into a 360px rail; the bar always prints the real pixel size). Cycle coverage to **VIEWSHED** and every camera draws its estimated coverage volume — where it reaches, and where it goes blind.

![Diving into an Austin intersection with a live public camera projected into the 3D scene](docs/media/03-austin-cctv.gif)

5. **Track something in orbit.** Turn on **Satellites** and click the ISS — you ride along at orbital distance, orbit ring and all.

![Tracking the ISS along its orbital path as it crosses over Ukraine](docs/media/14-iss-over-ukraine.gif)

6. **Switch the optics.** Tap `1`–`7` — CRT, NVG, FLIR — and the whole live planet re-renders through a different sensor.

![Cycling a dense live globe through CRT, FLIR, and NVG in one continuous view](docs/media/01-style-sweep.gif)

7. **Talk to it** *(needs an OpenAI key)*: *"Take me to LAX and select the nearest airborne aircraft."*
8. **Come home.** Hit **Reset Globe** — or just say *"zoom out to a globe view."*

**Keyboard:** `1`–`7` visual styles · `H` HUD · `D` detection · `C` cockpit · `Esc` out.

---

## 🛩️ The Cockpit

> Every plane should let you do this.

Real-time cockpit mode, built from live flight data: the camera rides your contact with real terrain holding underneath, all the way down — sensor styles come along for the ride, and **Contacts** keeps the 250 km roster one click away: jump plane to plane and fall straight into the next cockpit.

![Jumping between live aircraft and falling straight into a cockpit view](docs/media/12-switch-aircraft-cockpit.gif)

The cockpit even carries its own briefing strip: nearby live signals, regional headlines, and real local weather — with an opt-in **WX** mode that renders volumetric clouds from actual observations around your aircraft.

![A live military contact ridden through Normal, NVG, and Ironbow FLIR with dense detection](docs/media/start-here/military-cockpit-dense-google-3d.gif)

*Why cockpit mode exists: you're riding a real aircraft over real terrain — and you get to pick which sensor you see the world through.*

---

## 🎙️ Talk to It

> Voice needs an **OpenAI key**. Without one the entire app still runs — the mic button just reports voice is unavailable. The same key drives the **AI HUD summary**: a terse, five-word intelligence-style readout of the current view that regenerates as you move.

Click **GEV MIC**, grant the microphone, and just talk. This is more than a voice-controlled remote:

- **🧠 It knows what it's looking at.** The agent pulls live scene context before answering — including coordinates, street names, active layers, and view scale. Ask *"what city is this?"* mid-flight and it knows.
- **🎯 Entity Q&A.** Click any plane, ship, or datacenter and ask *"what's this?"* It answers using the object's live telemetry.
- **👁️ Visual grounding.** At street level, it reads a viewport screenshot to identify legible signage and building names, and is instructed never to hallucinate labels.
- **🎬 Cinematic framing.** *"Show me the planes overhead"* pulls the camera back, angles it, and frames the live traffic like a director.
- **🔒 Honest and secure.** The agent only confirms actions that succeeded. Your `OPENAI_API_KEY` never touches the browser; the client only gets a short-lived session token.

Twenty-eight tools, four jobs — the commands below come straight from the product's voice test suite and tool playbook:

**🎥 Direct it** — drone-operator camera verbs:
> 🗣️ *"Take me to Tokyo."* · *"Orbit around this area slowly."* · *"Draw the walking route from the Capitol to Zilker Park."* → *"Fly the route we just drew."* · *"Zoom out to a globe view."*

**🖊️ Annotate it** — a whiteboard over the real world:
> 🗣️ *"Outline the state of Texas."* · *"Annotate the Texas State Capitol and its grounds"* — it draws the **actual enclosing boundary**, not a circle. · *"How far is the Eiffel Tower from the Louvre?"* — a connector arrow appears and it speaks the distance. Everything persists until you say *"clear the map."*

![Zilker Park and Lady Bird Lake drawing onto the 3D city as persistent vector annotations, by voice](docs/media/01-voice-annotate-zilker.gif)

![A spoken distance measurement spanning an airport, inspected from orbit](docs/media/04-airport-distance.gif)

**🔎 Interrogate it** — analyst queries against the live layers:
> 🗣️ *"How many flights are over Texas right now?"* · *"Which ships are headed to Oakland?"* · *"What is the biggest fire near Los Angeles?"* · *"Is anything flying above forty thousand feet?"* · *"When does the ISS pass over next?"*

**🎛️ Operate it** — the whole console, hands-free:
> 🗣️ *"Switch to night vision and turn on the flights layer."* · *"Turn on the camera viewsheds."* · *"Play a news radio station near Austin."* · *"Track that plane."* → *"Enter Cockpit."*

**And the rapid-fire tier** — one sentence each:
> 🗣️ *"Show me global infrastructure."* (stages the layers and pulls back to the globe) · *"Play Orbital Watch."* (a full cinematic scene) · *"Set detection density to fifty percent."* · *"Next contact — helicopters only."* (mid-cockpit) · *"Show me space missions."* · *"Switch to Bing aerial."* · *"Sharpen the image a touch."* · *"Switch to the tactical layout."* · *"What's turned on right now?"*

![The globe populating with the world's radio stations as another live layer](docs/media/15-global-radio-layer.gif)

*Ask for radio near anywhere and the globe starts broadcasting — every station is a real place you can fly to.*

---

## 🛰️ What's on the Globe

Fifty-two live layers. **Forty-nine of them need nothing at all** — no key, no account, no signup. Exactly three want a free key: Navires en direct, Groupes de production and Feux actifs (FIRMS). Every layer added since is keyless, including the eight newest — road counts, recorded crime, mobile masts, cool refuges, building permits, transport frequency, aircraft noise and everyday amenities. (🟢 nothing · 🟡 free key · 🔴 metered.)

| Layer | What you get | Source | Auth |
|-------|--------------|--------|------|
| 🗺️ **Map Stack** | Google Photorealistic 3D, Bing aerial, OSM | Google / Ion / OSM | 🔴 Google (required) · 🟡 ion for Bing · 🟢 OSM |
| ✈️ **Live Flights** | Thousands of live aircraft + route history | OpenSky + adsb.lol | 🟢 (🟡 optional for more polling credits) |
| 🎖️ **Military Flights** | ADS-B military traffic in amber | adsb.lol | 🟢 |
| ✈ **Aéroports** | Where everything above actually lands — **7 464 aéroports et aérodromes**, from Roissy's 4 215 m of asphalt to an 82 m strip at La Tour-du-Pin. Worldwide it draws every large and medium airport plus **everything that sells a scheduled seat**, down to Monaco's heliport and the Greenland shuttles; **in France it draws the whole long tail** — 1 335 fields across the métropole and the outre-mer, altiports, hydrobases and one balloon field included. Each card carries the ICAO and IATA codes, the class, the longest **open** runway with its surface, and the commune. **Importance is on the map, not just in the text:** four tiers — *Grand aéroport*, *Aéroport de ligne*, *Aéroport sans ligne*, *Aérodrome & aéroclub* — set the dot size, the colour and how far out the card is readable, so an aéroclub stops taking a label cell from Roissy. Four chips on the row cut straight to the tier you want. Bundled with the build, so it draws with no key and no network | OurAirports (domaine public) | 🟢 |
| 🚢 **Live Vessels** | Thousands of ships worldwide | AISStream | 🟡 |
| 🛰️ **Satellites** | A roughly 840-object core catalog, color-coded by class with a live legend — the **DENSE** chip drops in the whole Starlink shell | CelesTrak | 🟢 |
| 🌍 **Earthquakes** | Global seismic activity, last 24h | USGS | 🟢 |
| ⬡ **Marine Buoys** | Live sea state from the NOAA buoy network — wave height, period, sea temperature and wind, colored on the WMO sea-state ladder. Coverage is sparse and labeled that way: only about a fifth of reporting stations carry a wave sensor, and one without one renders neutral rather than calm | NOAA NDBC | 🟢 |
| 🚗 **Traffic** | Live congestion driving per-vehicle flow at street level — dive below ~8 km and the dots color to real jams. Keyless it's an approximate simulation | TomTom + OSM | 🟢 (🟡 TomTom makes it real — get one) |
| ⚠ **Événements routiers** 🇫🇷 | What the road operators have actually declared — every accident, rockfall, closure, roadworks order and diversion the **Directions interdépartementales des routes** publish on the national network, in DATEX II. One marker per *situation*, not per record: an accident and the two lanes it blocked are one incident, with the consequences counted on its card. Yellow roadworks are two thirds of it, which is the honest shape of a road network on an ordinary evening. **Planned is not happening** — the 68 closures ordered for next month are hidden by default and drawn as ghosts when you ask for them — and an event the operator has closed stops being drawn even when its published window never ends. RRN **non concédé** only: the conceded motorways are behind a credentialed licence and their absence is stated, not hidden. No key | Bison Futé / DIR (DATEX II) | 🟢 |
| 📹 **CCTV Mesh** | ~815 public cameras projected *into* the 3D space — Austin · California (Caltrans) · London (TfL) · Lyon (Métropole de Lyon). Positions are published; poses are estimated priors **you calibrate by dragging a gizmo on the camera itself**. Opt-in `CCTV_OSM_CAMERAS_ENABLED=1` adds OpenStreetMap's mapped camera *positions* for whatever you are looking at (viewport-loaded, worldwide) — no feed, shown as a labeled Street View or placeholder frame | City APIs · OSM | 🟢 |
| 📻 **Radio** | Geolocated world radio with an **analog tuner** — drag the needle across up to 750 stations and the globe flies to each broadcaster | Radio Browser / broadcasters | 🟢 |
| 🚲 **Bikeshare** | Live station availability — 32 US systems plus Vélib', Vélo'v, vélÔToulouse and Le Vélo (TBM). Each dot is filled by how full the station is and **ringed in its operator's colour**, the same colour that operator wears on the Shared Mobility layer | GBFS | 🟢 |
| 🛴 **Shared Mobility FR** | Every *other* French shared vehicle: ~40,600 free-floating bikes, e-bikes, scooters and mopeds plus ~15,500 dock stations, across 135 operators. **Shape says what it is** — bike, e-bike, trottinette, scooter, car each draw their own silhouette — and **colour says who runs it**, one hue per operator nationwide, so Vélib', Lime, Voi and Dott are tellable apart in the same street. Loaded per viewport, de-duplicated against Bikeshare and against the catalog's own copies of itself | transport.data.gouv.fr (GBFS) | 🟢 |
| 🚌 **Transit FR** | The first thing on this globe that moves *on the ground*: live buses, trams and coaches across ~150 French networks, gliding between real fixes with line, speed, occupancy and stop status — each one carrying the operator's own **delay, cancellation, skipped stops and line disruption** for the run it is on. **Click one and its line draws** — the route trace in the operator's own colour, every stop of the run, and when it is due at each. Loaded for the viewport you are looking at | transport.data.gouv.fr (GTFS-RT + GTFS) | 🟢 |
| 🛣 **Road Status FR** 🇫🇷 | The State's own loop detectors on the national road network — **1 587 sites, 608 segments, 975 km**, coloured by the sixteen DIR traffic centres' live `freeFlow`/`heavy`/`congested` and carrying the one thing TomTom never gives you: a **measured vehicle count**, veh/h and km/h per station. Keyless, so it is the only real congestion data on a build with no TomTom key. **743 of those positions are not published anywhere** — the DIR give an address, a kilometre post, and the layer resolves it against the State's own bornage, which agrees with the coordinates that ARE published to a median of 3.8 m. And every segment is drawn along the **surveyed centre of its own carriageway** — the State's own 26 m-resolution survey of the network, joined by the posts each section names — instead of as the chord between its two ends: 411 segments strayed over 25 m from their road, a median 56 m, now 589 of 608 follow the tarmac. That is what lit Nantes, Rennes, Saint-Brieuc and Lorient–Vannes, and all 115 stations of DIR Ouest. Brightest exactly where Transit FR is dark — Marseille, Nantes, Rennes, Bordeaux — and blind in Île-de-France and Lille, which it says out loud rather than showing a blank | Bison Futé / DIR (DATEX II) + Bornage & Liaisons RRN | 🟢 |
| 🔥 **Active Fires** | Live NASA FIRMS detections, trailing 24h | NASA FIRMS | 🟡 |
| 🚀 **Space Missions** | Rolling 30-day launches with payload, stage, and recovery detail | Launch Library 2 | 🟢 (🟡 optional token raises the allowance) |
| ≋ **Vigicrues** 🇫🇷 | France's official river-flood vigilance map — 337 monitored reaches, coloured green→red by the state's own 24 h risk reading. Calm days are green; it lights up in an episode | Vigicrues (SCHAPI) | 🟢 |
| ◉ **Hub'Eau Gauges** 🇫🇷 | The live river-sensor mesh under Vigicrues — up to ~4,000 gauging stations, sized by discharge, with the raw number on the label | Hub'Eau / Eaufrance | 🟢 |
| ⚠ **Vigilance MF** 🇫🇷 | The 4-colour départemental weather warning every French forecast leads with — 9 phenomena, only the raised départements painted | Météo-France | 🟢 (🟡 optional key swaps the mirror for the contracted API) |
| 🌡 **Stations météo** 🇫🇷 | Where France actually measures the weather — **2 144 stations**, from the tide line to the **Aiguille du Midi at 3 845 m**. Colour is capability, not decoration, because a French weather station usually is not one: **1 254 of the 2 144 — 58 % — measure temperature and rain and nothing else**, only 845 can tell you which way the wind is blowing, and 234 have a barometer. Pressing **VENT** deletes 60 % of the map. A ring marks the **190 stations that publish their readings in the open** — Météo-France's own SYNOP list names 62 — and a click brings back the last hour plus the station's records *with the period they stand in*: 42,4 °C at Toulouse-Blagnac in 2023, against observations back to 1947 | Météo-France (réseau temps réel · SYNOP · fiches climatologiques) | 🟢 |
| ⚡ **Mix élec** 🇫🇷 | Where French electricity actually comes from, right now: the 12 métropolitaines painted by whether they *power* France or *draw* on it — Auvergne-Rhône-Alpes and Normandie exporting hard, Île-de-France importing almost its whole load — plus the five border flows as arcs pointing the way the power travels. Updated every 15 min | éCO2mix — RTE, via ODRÉ | 🟢 |
| ⬡ **Réseau gaz** 🇫🇷 | The French gas system as three things at once: **36,106 km** of high-pressure transmission trace clamped to the ground — NaTran (ex-GRTgaz) in violet, Teréga in orchid, never merged — plus the **850 renewable-methane injection points** feeding it and the **14 gas-fired power stations** burning out of it, into the `gaz` filière of the Mix élec layer above. Both traces are the operators' own, simplified to about 250 m, and are drawn exactly as published | NaTran / Teréga / ODRÉ | 🟢 |
| ◈ **Centrales EDF** 🇫🇷 | Where French electricity is physically made: EDF's own 79 generating sites — 18 nuclear (61 370 MW), 51 hydraulic (13 779 MW) and 10 fossil-fired (4 945 MW) — each a disc whose **area** is its installed capacity, labelled with what it actually is: `GRAVELINES · 5 460 MW · 6 × REP 900`, `GRAND-MAISON · 1 714 MW · Pompage mixte`. EDF's fleet rather than France's, and dated per file rather than pretending to one snapshot | EDF Open Data | 🟢 |
| ☢ **Groupes de prod** 🇫🇷 | France's power stations, **unit by unit**, at the output RTE last published for each one — 57 reactors, 6 pumped-storage machines, 44 thermal groups, 171 units and 93.5 GW in all. Each station is a ring sized by its nameplate, filled by what it is producing: a **crisp empty ring is a reactor in outage**, a faint one is a station RTE said nothing about, and a **magenta disc is a machine consuming the grid** to fill its upper lake. Click one and the card lists its groups with a day of hourly history each. Draws the whole fleet with no key at all — the key only adds the megawatts | RTE · ODRÉ · EDF · OpenStreetMap | 🟡 (🟢 without the key: installed capacity only) |
| ≈ **Petite hydro** 🇫🇷 | The other 2 686 hydro plants. France's national register holds **2 742 hydroelectric installations for 26,02 GW** — the two layers above could draw 56 of them, because one is EDF-only and the other stops at RTE's 100 MW publication floor. Between them sat the nine SHEM plants of the Ossau valley at Laruns, 223,9 MW in one commune, on no layer at all. This draws the register whole, down to a 40 kW mill. **A filled disc is a plant where it is** — 589 of the 998 positions are a building footprint **surveyed by IGN**, the data the Plan IGN is drawn from, median span 32 m, with IGN's own accuracy on the card. **A hollow ring is a commune, not a plant**: the register publishes no coordinates, and for the 1 744 installations nobody places, the commune centre is a median 2,5 km from the powerhouse, so they are rolled up rather than pinned somewhere false. Half the register is anonymised by the publisher, and those cards are still full: power, technology, head, connection voltage, source substation, grid operator, and the energy actually injected over twelve rolling months. No key | IGN BD TOPO · ODRÉ · OpenStreetMap · EDF | 🟢 |
| 🔌 **Bornes IRVE** 🇫🇷 | Every public EV charge point France has declared — 231,079 of them on 2026-08-27, a file rebuilt daily — answered at the scale you ask: the 96 **départements** with the whole country in view, the **maillage** of real positions once it is cropped, then **every site** over a city with its operators and connectors. The car park under La Défense that files 127 separate "stations" is one dot; the 7.5% of charge points two operators publish twice are counted once, and both figures are on the card. Installed capacity, never availability — the register does not publish it | transport.data.gouv.fr / ODRÉ | 🟢 |
| 🎓 **Établissements scolaires** 🇫🇷 | Every school France registers — 68,939 rows on 2026-09-01, rebuilt daily, of which **68,158 are open and placed** — answered at the scale you ask: the 96 **départements** with the country in view, the **maillage** of real positions once it is cropped, then **every establishment** over a city with its level, its roll, its services and **son IPS**. Coloured by level, sized by pupils joined on the UAI from the ministry's four *effectifs* files. The 8.3% with no published roll are drawn and say *effectif non publié* — a gap in the roll files is not a school with no pupils. The DEPP's *indice de position sociale* is joined the same way, from four more files read at four DIFFERENT rentrées (écoles 2024-2025, the rest 2025-2026), and it changes neither the colour nor the size: **40,529 of the 62,857 schools that could carry an index have one (64.5%)**, and the third that do not say *IPS non publié* rather than sitting in the middle of a ramp — including the 2,504 the DEPP marks `NS` because they are too small to publish. A lycée's card names the voies its establishment index blends, because on the 931 LPO that publish both, GT and pro are 18.1 points apart at the median and 47.7 at the widest. The 2,159 schools geocoded only to their commune say that too, and the 2,762 the metropolitan polygons cannot paint are counted on the national card rather than quietly missing | Annuaire de l'éducation — MENJ · IPS — DEPP | 🟢 |
| 🏛 **Enseignement supérieur** 🇫🇷 | Where France's **2.96 million students** actually are — the layer that starts where the one above stops. The Annuaire de l'éducation ends at the baccalauréat: not one of its eight establishment types is a university, an IUT, an école d'ingénieurs, an école de commerce, an IFSI or a school of architecture, and **3,492 post-bac establishments appear nowhere in it**. This draws the MESR's own enrolment register — **6,294 establishments, 6,914 sites**, coloured by seven bands folded from the ministry's 14 categories and sized by the students counted at that campus. The 96 **départements** with the country in view, shaded by STUDENTS rather than by dots (the top ten hold half of French higher education; by site count they hold a third), then **every site** below that — no thinning and no sampling, because the whole register is 0.62 MB gzipped with every name on it. 1,665 establishments carry no coordinate; 977 are placed from the ministry's Parcoursup cartography where it gives exactly one point, and say so on their card. The 688 neither file can place are counted, never invented | Effectifs d'étudiants inscrits · Cartographie Parcoursup — MESR | 🟢 |
| 🧸 **Accueil du jeune enfant** 🇫🇷 | Où l'on trouve une place, et où l'on n'en trouve pas. **Il n'existe aucun registre national ouvert des crèches** — la Cnaf publie 210 jeux de données et pas un seul établissement, FINESS n'en contient que 183 par accident, le BPE de l'INSEE s'arrête à 2021 côté API, et filtrer Sirene sur le code NAF de l'entreprise fait disparaître **tout le secteur public**. Cette couche dessine donc l'indicateur que l'État publie vraiment : les **places pour 100 enfants de moins de 3 ans**, aux trois échelles de la Cnaf, **toutes les trois en territoires** — 96 départements en aplat, puis les 1 250 intercommunalités et les 1 061 communes remplies pour de vrai, à partir des contours communaux de geo.api.gouv.fr. Une intercommunalité n'a aucun contour publié : elle est peinte comme ses communes membres, sous une seule couleur et sans liseré intérieur, et les communes que la Cnaf détaille sont découpées dedans, pour qu'aucune parcelle de sol ne porte deux chiffres. La couleur est un **rapport à la moyenne nationale** (60,9), pas un quantile, pour qu'elle veuille dire la même chose à tous les zooms. Chaque fiche donne les cinq modes qui composent le taux et lequel domine : la Vendée est à 85,7 mais par l'assistante maternelle, pas par la crèche. Les 6 territoires ultramarins que les polygones métropolitains ne peuvent pas peindre sont **tous sous la moyenne** — la Guyane à 22 % de la moyenne française — et sont comptés sur la fiche nationale plutôt que perdus | Cnaf · geo.api.gouv.fr | 🟢 |
| ✚ **Médecins** 🇫🇷 | Where doctors are, and where access runs out — **64 232 practice addresses and 117 922 named doctors**, with what each of them charges. **The register publishes not one latitude**: the CNAM's *Annuaire santé Ameli* names its address block `coordonnees_*` in the sense of *contact details*, so every dot is geocoded against the Base Adresse Nationale — 99,4 % placed, and the 716 that reach only a commune centre say so. The national view paints the DREES's **accessibilité potentielle localisée** rather than a headcount, because the median French person lives 0,7 km from a GP and a map of counts would say “France is covered” and be useless. What is scarce is capacity | Annuaire santé Ameli — CNAM · APL — DREES | 🟢 |
| ▦ **Parcelles** 🇫🇷 | The lines France taxes land along — the **Plan Cadastral Informatisé**, one polygon per parcel, with its section, its 14-character national identifier and the surface the DGFiP has registered against it. Two things nobody else draws. **How approximate each line is**: every parcel belongs to a sheet, and the sheet publishes the scale it was drawn at — **1:250 in central Strasbourg, 1:5000 over the Landes forest**, so the same word "boundary" means ±0,13 m in one place and ±2,5 m in another. That spread is the colour of every parcel and a line on every card. And **the holes are the streets**: the cadastre parcels private land, not the public domain, so a correct answer over Lyon's Presqu'île covers **45,7 %** of the view against 98,6 % of a Landes forest block — the row reports the fraction so the gaps read as the public realm. A fiscal document, never a legal one: the card ends by saying so, because in France a property limit is fixed by bornage and by nothing else | IGN Api Carto (PCI vecteur, DGFiP) | 🟢 |
| 🚦 **Comptages routiers** 🇫🇷 | The only road layer here that has actually **counted a vehicle**. Paris publishes every hourly reading its permanent loops take — **27,772,889 of them** — and this draws the last complete week of them on the arc that measured it: **2,977 arcs, 500,136 readings**, coloured by mean vehicles per hour and carrying the street's own 24-hour rhythm on its card, weekday against weekend on one shared scale. **It is not live and never says it is**: the feed is a nightly batch that lands the day before yesterday, so the unit is the last complete Monday–Sunday week, discovered from the data's own newest hour. The number that matters most is the one the city does not advertise — **891 of the 2,977 arcs measured nothing at all**, 724 of them declared *invalide*, and they are drawn as silent rather than given the quiet end of the scale, because "no measurement" and "measured, and empty" are not the same street. A further 356 report occupancy but no count, and the 31 arcs that publish no geometry are reported rather than placed somewhere false | Comptages routiers permanents — Ville de Paris | 🟢 |
| 🚓 **Délinquance enregistrée** 🇫🇷 | The SSMSI's own commune and département bases — **34,920 communes, 101 départements, 15 indicators, 2016–2025** — drawn with the publisher's caution rather than around it. **The point of this layer is what it refuses to draw.** At département scale there is no secrecy at all: 17,711 published cells, 469 zeros, **zero suppressions**. Zoom to communes and the map goes dark — the SSMSI withholds any count small enough to identify someone, and for the indicators people actually cite that is **most of France**: 69.8% of communes for escroqueries, 69.4% for cambriolages, 67.9% for dégradations. A withheld cell gets its own colour, is never binned, never averaged, never interpolated across, and never coloured as "low" — because *nobody published a number* and *the number is small* are different sentences. And this is **recorded** crime: it counts what police and gendarmerie registered, which tracks reporting habits and force presence as much as offending. Every card says so | Bases statistiques de la délinquance enregistrée — SSMSI | 🟢 |
| 📡 **Antennes mobiles (ANFR)** 🇫🇷 | Les 72 700 supports d'antennes mobiles que l'ANFR publie chaque semaine, colorés par la génération qui **émet vraiment** : 5G 50 148 · 4G 18 698 · 3G 127 · 2G 89, et 3 638 qui n'émettent rien du tout. Un projet approuvé n'est pas un mât — 66 508 des 826 418 lignes (8,05 %) sont des autorisations, dessinées en anneau creux et jamais comme une génération. Taille = nombre d'opérateurs (36 671 mâts en portent un, 11 012 en portent quatre, un seul en porte cinq). Maillage thermique de 1 100 à 2 200 points au-dessus de 0,32°, puis chaque support avec sa fiche. La carte clique vers Cartoradio : adresse, propriétaire, bandes de fréquence par émetteur et la mesure d'exposition publiée la plus proche, avec sa date — celle du support 449714 vaut 0,0 V/m et date de 2009, seize ans avant le dernier équipement installé. Aviation civile, Défense et Intérieur sont exclus par la loi. | ANFR (data.anfr.fr, Cartoradio) | 🟢 |
| 🌳 **Îlots de fraîcheur** 🇫🇷 | Where Paris says you can get out of the heat — and how much of that is true at the hour you ask. Four registers on one screen: **535 îlots de fraîcheur**, **984 espaces verts frais** as real footprints, **1 323 fontaines à boire** with a live availability flag, and the **219 432 arbres** of the city, loaded for the block you are standing in. The equipment list is not a list of parks — it is **127 ombrières pérennes, 125 lieux de culte, 87 brumisateurs, 65 musées, 39 piscines, 19 mairies, 17 bains-douches, 16 bibliothèques**: a church is on it because five metres of limestone holds last night's temperature, so the colour says the MECHANISM and not the building type. The parks are coloured by a **measured** canopy metric — the share of ground under vegetation taller than 8 m at the 2024 survey — and not by area, because area says how big a park is and this says how much of it is in shade at three in the afternoon. **The finding is the asymmetry: only 23 of the 984 stay open during a heatwave**, 9 of them round the clock, and **11 of those 23 have no measured canopy at all** (median 0,028 against 0,320 across the register) — eight are planters, five of them on the Porte Maillot roundabout. The timetables are dated too: **682 of the 984 publish hours whose own validity window had already expired**, 638 of them the same *du 01/05/26 au 31/08/26*, so every card carries the window on the same line as the answer. Open/closed is recomputed on **Europe/Paris every minute** rather than at fetch time — 757 spaces are open at 14 h and 367 at 01 h 30. And a `hauteurenm` of 0, on **19 407 trees**, means *not surveyed*: those dots are grey and never scaled | Ville de Paris & Eau de Paris (opendata.paris.fr) | 🟢 |
| 🏗 **Autorisations d'urbanisme (Sitadel)** 🇫🇷 | The only forward-looking layer here — not what was built, what has **permission** to be. The State publishes every authorisation France has granted since 2013, **3 020 749 of them across four files**, and not one carries a coordinate: 94 columns on the housing register, 33 on the demolitions, and `geoFields: ["REG","DEP"]` on both. What it does carry is up to three **cadastral references** per permit — and this globe already draws cadastral parcels. So a permit becomes the exact plot it was granted for, and the colour is where the pipeline has got to: `Autorisé` (nothing reported since), `Chantier ouvert` (a DOC filed), `Travaux achevés` (a DAACT filed), `Annulé`, and demolitions in their own red. Three real dates, not one. Dot size is **dwellings created**, capped at 200 — Nantes' biggest permit makes 553. **The join rate is on every card, because it is the whole story.** Measured over six communes: Paris 91,3 %, Nantes 75,6 %, Ustaritz 55,1 %, Beaupréau-en-Mauges 54,5 %, Marseille 20,1 %, **Toulouse 7,6 %** — 9 744 of 21 271 in all, against the 44,8 % DREAL Auvergne-Rhône-Alpes managed on the same data. Two different failures, kept apart: a parcel is **divided and renumbered precisely when somebody builds on it**, so 2013 places at 60 % in Nantes and 2026 at 97 %; and Toulouse publishes **46 section préfixes** that Sitadel has no column for, so 34 parcels answer to one reference — those are declared ambiguous, never resolved by picking the first. The plot's declared surface **audits** the join independently and ranks the communes the same way (Paris 98,4 % agreement, Toulouse 51,5 %). Nothing is ever moved to a commune centre. One commune at a time, because DiDo scans an 889 MB CSV in ~4 s per query and refuses a fourth simultaneous request | Sitadel — SDES/CGDD + cadastre Etalab (DGFiP) | 🟢 |
| ⏱ **Fréquence des transports** 🇫🇷 | **The first time-of-day dimension in this application.** `transit-fr` is live GTFS-Realtime and consumes zero IDFM data, because IDFM publishes no vehicle positions at all — 0 in Paris intra-muros against 453 in Bordeaux. `idfm-network` draws 37,956 stops as a referential: it can say WHAT serves a stop, never HOW MUCH. Four module headers here refuse to load `stop_times.txt`, and rightly — IDFM's is 747,381,712 bytes over 8,593,005 rows. So this draws the fold **IDFM already published**: 1,311,578 rows of average departures per stop, per line and per one-hour band, Licence Ouverte 2.0 against the network layer's ODbL. Scrub the clock and one number moves on every dot. Measured on an average Tuesday in a 4 km box on Châtelet — 805 stops — **115 of them run more than 32 departures an hour at 08:00 and exactly 1 still does at 22:00; at 01:00, 397 of the 805 run nothing at all**. Saint-Lazare is 37/h at 08:00 and 8.7/h at 22:00. Above the rooftops the same ladder in the same unit fills eight départements: Paris runs **13.22 departures per hour per stop at 08:00 against Seine-et-Marne's 3.00**, and at 22:00 **7.13 against 0.61** — the gap more than doubles after dark. The operating day is 04:00→03:59, so the night bands are numbered 24 to 27 and are kept: region-wide, band 25 is 15,904 courses on a Monday and **31,585 on a Friday**. What is refused: the **549 stops (1.50 %) that publish no coordinate** are counted and never placed, though they carry 2.76 % of a Tuesday's courses; the eight départements outside Île-de-France hold **235 stops between them** (the Marne has 1) and their polygons stay unpainted; and the **542 of 35,953 stops whose published code and IGN outline disagree** are reported rather than silently repartitioned | Offre hebdomadaire moyenne hors vacances — Île-de-France Mobilités | 🟢 |
| 🔊 **Bruit des aéroports** 🇫🇷 | The state's own aircraft-noise plans, read under the point the camera is looking at — and the one layer here whose whole job is to REFUSE to guess. **224 aerodromes** carry a *plan d'exposition au bruit*; probed at each one's own published point, **215 answer with geometry and 9 do not** (three of them — Toussus, Coulommiers, Pontoise — answer nothing at any scale: an arrêté exists and no polygon does). Two traps decide the whole design. **THE UNIT IS NOT ALWAYS DECIBELS**: France replaced the *indice psophique* with Lden in 2002 and the register keeps both eras in the same two columns — measured over the 298 zone rows returned, **75 are psophique (78–96) and 223 are Lden dB(A) (50–70)** — so the unit is taken from the LATER of `date_arret` and the date inside the arrêté PDF (Gap publishes 1985 on a plan reissued in 2017), and where the two disagree the unit is SUPPRESSED rather than guessed. **AND ONE PROBE IS NOT ONE ZONE**: 74 of the 215 answering probes — **34%** — return more than one polygon for one pixel, so the layer ranks them and says which clause won on the card. A zone the point is not INSIDE is dashed and can never be the answer; where two zones of one plan really do overlap (Saint-Cyr publishes A over B with no hole between them) the **strictest** wins, because that is the rule that applies; where two airports meet (Le Bourget's zone A under Roissy's zone D) both are named. **Aircraft only**: there is no strategic noise map on the Géoplateforme — all 915 layers, and the only four that mention bruit are these — so road, rail and industrial noise are absent and every card says so | DGAC via la Géoplateforme | 🟢 |
| 🏪 **Équipements du quotidien** 🇫🇷 | Les 95 406 points où l'on trouve les sept choses que la vie quotidienne touche vraiment, repliés depuis 126 859 lignes de deux registres : 30 215 médecins généralistes · 19 354 commerces alimentaires · 19 216 pharmacies · 16 832 guichets La Poste · 3 953 gendarmeries et commissariats · 3 625 bassins de natation · 2 211 hôpitaux. **Aucune école** : `schools-fr` dessine déjà les 68 158 établissements du registre du ministère et la BPE n'a même pas de colonne UAI — ses 79 743 lignes « enseignement » sont refusées, et la légende porte la ligne qui le dit. Un point que le registre avoue avoir inventé n'est pas dessiné : 1 284 lignes BPE « position aléatoire dans la commune » et 898 lignes FINESS géocodées au centroïde ADMIN-EXPRESS sont comptées et jamais placées, plus 170 sans coordonnée dont **100 sont tout l'équipement quotidien de Mayotte**. La taille du point n'est pas une quantité — aucun des deux registres ne publie de magnitude — c'est une règle de lisibilité ; ce qui se lit, c'est la précision de position (halo sable) et le nombre d'établissements à l'adresse (jusqu'à 146 médecins sur un seul point à Paris 14e). Vue nationale : la part des communes du département où l'on trouve au moins un de ces équipements — 43,7 % des 34 778 communes, de 21,6 % dans le Gers à 100 % à Paris. | Insee (BPE 2025), FINESS (ARS/ANS) | 🟢 |
| ▤ **Bâti 3D** 🇫🇷 | The buildings themselves, extruded from **IGN BD TOPO®** vector tiles for the viewport you are looking at, coloured by use and seated on their own NGF-IGN69 altitudes rather than floated on the ellipsoid. A refused tile is not an outage, and the layer says which it is | IGN BD TOPO® (Géoplateforme) | 🟢 |
| ◷ **Pouls vélo** 🇫🇷 | One typical week of cycling in **Lyon and Paris**, hour by hour, from the two cities' own archives — and the two cities cannot be drawn the same way, which is the finding. **Lyon publishes 3½ years of Vélo'v dock availability; Paris publishes no Vélib' archive at all** — not on opendata.paris.fr, not on data.gouv.fr, not through the national access point, and the community mirror everyone cites died in 2023. So Lyon is read as **stocks** (how full each of 422 docks is) and Paris as **flows** (how many cyclists pass each of 111 counters), and every card names which. Press **SEMAINE** and 168 hours run in 37 seconds: the morning peak fills, the city drains, the weekend flattens. Colour is each site's share of its own weekly maximum — the only thing that means the same in both cities | Métropole de Lyon · Ville de Paris | 🟢 |
| ▩ **Carroyage INSEE** 🇫🇷 | Who actually lives there — INSEE's **Filosofi** grid, **2 314 836 squares of 200 m** over France, Martinique and La Réunion, extruded on the globe. **Colour is the indicator you pick; height is the count it was computed on** — a stack of “27 100 € per person” has no volume, but a block whose volume is its population is a true statement, so a brilliantly coloured square one pixel tall is four households and reads as one. Eight indicators recolour the city without a single new request, on **absolute national bands** measured over 80 105 carreaux, so Neuilly and Roubaix are not the same picture. **Perforated squares are imputed** — INSEE models a cell rather than publishing it when the observation would break confidentiality, and 39 % of cells carry that flag | INSEE Filosofi (Géoplateforme) | 🟢 |
| ⚠ **Risques** 🇫🇷 | What the State has recorded as dangerous about one spot — installations classées, sites pollués, radon potential, ground-movement and flood exposure, fanned out over Géorisques' own endpoints for the address you scan | Géorisques — BRGM / MTE | 🟢 |
| € **Ventes immobilières** 🇫🇷 | What the ground around you last sold for, from the State's own **Demandes de valeurs foncières** — price, date, surface and type per transaction, parsed per commune-year server-side | geo-DVF — Etalab / DGFiP | 🟢 |
| ▤ **Performance énergétique** 🇫🇷 | The **DPE** of the buildings around a point — ADEME's observatory of existing dwellings: letter grade, consumption and emissions, queried by distance | ADEME — Observatoire DPE | 🟢 |
| ▦ **Urbanisme (PLU)** 🇫🇷 | What may be built on the ground under the cursor. **Click anywhere on the map, not on a marker**: the zoning wash, an outline, or the bare globe between them all answer for *that spot* — which zone, what the family means, which easements reach it, and under which approved document. Four different ways to have no zoning are said apart, because three of them are the layer's own limits rather than facts about the plot | Géoportail de l'urbanisme (APIcarto) | 🟢 |
| ◎ **Zone de chalandise** 🇫🇷 | The ground you can actually reach from a point — **5, 10 and 15 minutes**, cut by IGN's own Valhalla engine over the BD TOPO road and path network, not drawn as a circle. From place Bellecour the walk stops dead at the Rhône and the Saône except where a bridge crosses, which is the whole argument: **2,19 km² on foot against 32,41 km² by car** from the same doorstep. Each ring reports the radius of the circle with the same area — the honest version of the number you were going to use anyway — and the **expansion** between rings, measured against the ×4 that open ground would give, so a place that frays at its edges and one that opens up read differently. **Click the map to pin the centre**, and the catchment stops following the camera — which is also how you pull back far enough to see a whole driving catchment, 16 km across in open country. **Cycling** is measured too, on the OSM cycling network through OSRM, because IGN publishes no cycling profile at any resource: it is an **envelope over 36 directions**, drawn dashed and reported as a majorant, never as the exact polygon the other two are | IGN Géoplateforme (Valhalla / BD TOPO®) · OpenStreetMap / OSRM (FOSSGIS) | 🟢 |
| ⌖ **Fiche implantation** 🇫🇷 | The one card a geomarketing tool exists to print, and the only layer here that fetches nothing of its own: it JOINS four that are already on this globe — the reachable shape, the INSEE carroyage, the PLU and DVF — around a clicked door. **The headline is a bracket, not a number.** A 200 m square sits inside the ring, outside it, or across its edge; every commercial tool picks a convention and prints one figure, and this one prints the centroid count with the two countable bounds around it. Measured at place Bellecour, ten minutes on foot: **9 703 habitants, entre 5 643 et 15 694** — because at that resolution 24 of the 35 squares the ring touches ARE its border, and the card says so. Never areal interpolation: scaling a square by the fraction inside assumes people are spread evenly across it, which is exactly what INSEE's own imputation flag exists to deny | IGN · INSEE · GPU · DGFiP | 🟢 |
| Ⓜ **Réseau IDFM** 🇫🇷 | Paris and the Île-de-France as its operator publishes it — every stop and line of the region's network, loaded for the view | Île-de-France Mobilités (ODbL) | 🟢 |
| ⌁ **Power Grid** | The wires themselves — the high-voltage network as OpenStreetMap has mapped it, loaded for the viewport you are looking at. Routes coloured by voltage band (**400 kV** backbone down to **63 kV**), the **substations** they land in sized by the same band, and, once you are close enough for a pylon to be a thing rather than a dot, the **pylons** holding them up. Underground cable is dashed, because it has no pylons. This is the one part of the grid RTE publishes no geometry for, so it is volunteer mapping — and only what OSM has given a voltage of 50 kV or more | OpenStreetMap (Overpass) | 🟢 |
| 🎖️ **Mapped Installations** | Viewport-bounded military-site context from community mapping — incomplete by nature, and labeled that way | OpenStreetMap | 🟢 |

![A reconstructed Falcon 9 ascent climbing and curving into its projected orbit](docs/media/08-falcon9-replay.gif)

*The Space Missions layer replaying a Falcon 9 ascent — labeled `RECONSTRUCTED ESTIMATE`, scrubbable 0.25×–4×.*

**Also on the globe:** neighborhood overlays · an optional cockpit WX cloud effect. **Bundled static infrastructure:** Airports (7,464 — OurAirports, public domain), Datacenters (4,351), Barrages (6,189 — 5,529 of them in France, OSM/ODbL), Submarine Cables (712), Ports (2,951 — NGA World Port Index, US public domain), and the 96 French département polygons the Vigilance layer colours.

![Diving into the Bahamas and revealing labeled submarine cable routes beneath the globe](docs/media/09-undersea-cables.gif)

**Missing a layer you want?** Open an issue — or add it and send the PR.

---

## 🎖️ Field Missions

Once the basics click, run these:

| Mission | How |
|---|---|
| **🚁 Ask the planet** | *"Why are all these military helicopters flying in circles?"* Select a military track — it silently backfills ~24 h of real trace history — and see what it's been doing, resolved as stacked 3D loops. |
| **✈️ Final approach** | Click-track an airliner lining up for a runway, hop into the **cockpit**, and ride it down. |
| **🌃 Night watch** | Fly to your own city, switch to **NVG**, and let the detection mesh and HUD read the scene. |
| **🚢 Port call** | Vessels on over the Port of Long Beach. Click a tanker for its tactical card and wake trail — then hit **NEAREST** in the CCTV panel and look at the same water through a public camera. |
| **📻 Tokyo FM** | Orbit Shibuya with the **Radio** layer on — then drag the analog tuner needle: every position snaps to a real station and the globe flies to whoever's broadcasting. |
| **🔥 Fire line** | FIRMS over California. Click a detection — the camera dives to it — read the intensity, then hit **NEAREST** in the CCTV panel for a ground view. |
| **🚶 Ask for a walking route** *🎙️* | Tell the world where you want to go and watch a real street-following route trace itself through the 3D city — then *"fly it"*: banked turns, eased ends, a camera that leads the path like a drone shot. |
| **📏 Measure LAX to DFW** *🎙️* | *"How far is LAX from DFW?"* — an arrow spans the country, the distance lands in the caption, and the endpoints stay pinned to the real world as you orbit. |
| **🚀 Launch replay** | Open **Space Missions**, pick a launch from the last 30 days, and ride the T-minus countdown through ascent to orbit — scrub it at 0.25×–4×. Labeled `RECONSTRUCTED ESTIMATE`, because it is one. |
| **🪦 Walk the boneyard** | Fly from regional context down into dense, fully resolved rows of retired aircraft. |
| **🏗️ Orbit Three Gorges** | Sweep the dam and its terrain at a glance — then flip on the **Barrages** layer and find 6,188 more. |

*🎙️ = voice missions — they need an OpenAI key.*

![Resolving a selected aircraft's recent flight path into stacked 3D loops above the terrain](docs/media/07-helicopter-loops.gif)

*Ask the planet: a military contact's last ~24 hours of real trace history, resolved as stacked 3D loops.*

![Asking for a walking route and flying the generated path through the 3D city](docs/media/10-walking-route-flythrough.gif)

*"Draw the walking route… now fly it" — banked turns, eased ends, the camera leading the path like a drone shot.*

![Descending from regional context into dense rows of retired aircraft at the boneyard](docs/media/08-boneyard.gif)

*Walk the boneyard: rows of retired airframes, fully resolved in 3D.*

---

## 🔧 Under the Hood

Some of the engineering that makes it feel real rather than like a tech demo:

- **World-stable icons.** Aircraft and ships point along their *true real-world heading* at every camera angle — tracked or not, looking straight down or across the horizon — via per-frame screen-space course projection. No spinning, no viewport-locking.
- **Smooth motion from choppy data.** Live feeds arrive every 15–30s; the globe renders one interval behind real time and interpolates between known fixes. Dead reckoning fills the gaps.
- **Honest satellites.** SGP4 propagation with orbit rings that stay locked to their satellites via GMST realignment — no drift, no per-second flicker.
- **Sits on the real ground.** Entity heights run through a real vertical datum — geoid-aware, sampled against the *rendered* terrain mesh — so aircraft park on aprons and cameras stand on street corners instead of floating.
- **Spends your quota like it's its own.** The paid feeds run behind cached, budget-governed proxies — an OpenSky credit governor, a TomTom daily tile budget, disk-cached TLEs — so an afternoon of exploring doesn't torch an API allowance.
- **Local-first key handling.** Secret-bearing providers such as OpenAI, AISStream, OpenSky OAuth, TomTom, and FIRMS are brokered server-side. Proxy destinations are fixed or allowlisted, and the higher-risk paths add bounded requests, timeouts, response caps, and sanitized errors as appropriate. The only provider credentials intentionally exposed to the browser are Google Maps and Cesium ion; restrict both at the provider.
- **No framework.** Vanilla JavaScript, **CesiumJS**, and **Vite** — plus **Google Photorealistic 3D Tiles** for the planet and the **OpenAI Realtime API** for voice. Fast to read, fast to hack on.

```
src/
├── main.js                 # Bootstrap: Google 3D tiles, layer registration
├── ui.js                   # Runtime UI — panels, HUD, styles, control facade
├── hud.js                  # Intelligence HUD + AI scene summary
├── mapStackController.js   # Google 3D / Bing / OSM switching
├── iconOrientation.js      # Screen-projected world-space headings + horizon cull
├── voice/                  # OpenAI Realtime session + 28 voice tools
├── data/                   # One module per layer + management + context store
│   └── local_data/         # Bundled datasets (per-folder provenance)
└── scenes/                 # Cinematic scene director
```

See [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md) for the authoritative runtime reference.

---

## 🔑 API Keys

**The legend, one more time:** 🟢 **no signup** — works out of the box · 🟡 **free key** — register, paste, done · 🔴 **metered** — a billing-enabled account; costs are small but real.

Most of the globe is 🟢: the **basemap itself** (OSM worldwide, IGN Ortho and Plan IGN over France), **place search** (OpenStreetMap's Nominatim worldwide, the IGN Géoplateforme for French addresses), flights (anonymous), military traffic, satellites, earthquakes, CCTV, radio, bikeshare, French transit, French shared mobility, space missions, mapped installations, and every bundled dataset run with **zero keys**.

**`git clone && npm i && npm run dev` needs no credential at all.** What a keyless build gives up is the photorealistic 3D planet, the Bing imagery stacks, the voice mic, and the Google-only place context behind annotations and the cockpit readout — each of which says which key it wants rather than failing silently. The search box is not on that list any more: it geocodes keylessly.

### What you need for the good experience

Five keys cover the fully keyed experience. Three currently offer no-cost developer access; Google Maps and OpenAI are usage-metered. Provider prices and allowances change, so use the linked pricing pages before relying on a budget estimate:

| | Key | Why | Get it |
|---|-----|-----|--------|
| 🔴 | **Google Maps** | The photorealistic 3D planet ([Map Tiles API](https://developers.google.com/maps/documentation/tile)), the place context behind annotations and the cockpit readout, and the sharpest place search. Without it the app boots on the keyless globe stacks and searches through OpenStreetMap + IGN instead | [Google Cloud Console](https://console.cloud.google.com/) — metered; [check current pricing](https://developers.google.com/maps/billing-and-pricing/pricing) and URL-restrict it |
| 🔴 | **OpenAI** | 🎙️ The voice experience + AI HUD summary. Want another provider behind the mic? PRs welcome | [platform.openai.com](https://platform.openai.com) — metered; [check current API pricing](https://openai.com/api/pricing/) |
| 🟡 | **AISStream** | 🚢 Live global ships | [aisstream.io](https://aisstream.io) — free, seriously, it's a two-minute signup |
| 🟡 | **NASA FIRMS** | 🔥 Live active fires | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/map_key/) — free |
| 🟡 | **TomTom** | 🚦 Real traffic instead of an approximate simulation | [developer.tomtom.com](https://developer.tomtom.com) — check the current developer allowance for your account |

![Diving from city-scale live congestion straight into an intersection's public camera](docs/media/05-traffic-to-cctv.gif)

*What the TomTom key buys you: rush-hour density painted on the city — then dive from the jam straight into the camera watching it.*

### Cherry on top

| | Key | Why | Get it |
|---|-----|-----|--------|
| 🟡 | **Cesium ion** | 🗺️ Bing imagery map stacks (public `assets:read` token) | [cesium.com/ion](https://cesium.com/ion) — [check the plan that fits your use](https://cesium.com/platform/cesium-ion/pricing/) |
| 🟡 | **OpenSky** | ✈️ More flight-polling credits (🟢 anonymous works without) | [opensky-network.org](https://opensky-network.org) |
| 🟡 | **Launch Library 2** | 🚀 Higher space-missions request allowance (🟢 works without) | [thespacedevs.com](https://thespacedevs.com) |
| 🟡 | **RTE** | ☢️ What each French reactor and power station is actually producing (🟢 the fleet, its names and its 93.5 GW of installed capacity draw without it) | [data.rte-france.com](https://data.rte-france.com/create_account) — free; create an application and attach the *Actual Generation* API to it |

All of them are worth getting. None of them are required to start.

```bash
# Put keys in .env (see .env.example), or pass them as env vars:
OPENAI_API_KEY="…" AISSTREAM_API_KEY="…" npm run dev -- --host localhost --port 4173

# On macOS, store any of them in the Keychain and dev-fresh.sh pulls them in:
security add-generic-password -U -s "google-maps-api" -a "api-key" -w
security add-generic-password -U -s "openai-api"      -a "api-key" -w
security add-generic-password -U -s "aisstream-api"   -a "api-key" -w
security add-generic-password -U -s "firms-map"       -a "map-key" -w
security add-generic-password -U -s "cesium-ion"      -a "token"   -w
security add-generic-password -U -s "tomtom-api"      -a "api-key" -w
```

OpenSky can run fully anonymous (`OPENSKY_AUTH_MODE=anon`), or import OAuth credentials with `./scripts/opensky-import-client.sh /path/to/credentials.json`.

### 💸 What it actually costs

Honest numbers, roughly, as of mid-2026 — always check the provider pricing pages:

| | Cost reality |
|---|---|
| **🟢 Most layers** | **$0, no signup.** OpenSky anon, USGS, CelesTrak, adsb.lol, city CCTV, Radio Browser, GBFS, transport.data.gouv.fr, Launch Library 2, Vigicrues, Hub'Eau, Météo-France Vigilance, Bison Futé, ODRÉ éCO2mix, EDF Open Data, NOAA NDBC, bundled datasets. |
| **🟡 Optional developer access** | AISStream, FIRMS, TomTom, Cesium ion, and authenticated OpenSky may offer no-cost access, but limits and permitted uses differ. Cesium ion and OpenSky in particular have plan or use restrictions; verify the current provider terms for your deployment. |
| **🔴 Google 3D tiles** | Map Tiles usage is billed by session, with current prices and free-usage caps varying by billing region. Check Google's pricing page, restrict the key, set quotas, and configure a budget alert before sustained use. Skipping it entirely is supported: the app boots keyless onto OSM and the IGN France basemaps. |
| **🔴 OpenAI voice** | Realtime audio is usage-metered and the total depends on the selected model, conversation length, and audio volume. The app shows a live session estimate, warns at $2, and applies a **$5 in-app session cap**; provider-side usage limits remain the billing backstop. |

### 🧗 The floor is low on purpose

Everything above is the deliberately cheap baseline — enough to get a real taste of geospatial intelligence, GEOINT, and OSINT without ever talking to a sales team. You'll also notice the ceiling: terrestrial AIS goes quiet mid-ocean and satellite AIS costs real money; premium imagery, SAR, and the deeper commercial feeds live behind enterprise contracts. That's not a limit of the architecture — every layer here is a pattern you can point at your own data sources. This repo hands you the foundation; what you fuse into it is up to you.

### 🔒 Sharing an instance

By default nobody else can reach your server — it binds to localhost. To share on your LAN, opt in explicitly (`npm run dev -- --host 0.0.0.0 --port 4173`, or `HOST=0.0.0.0 ./scripts/dev-fresh.sh` on macOS/Linux) — but know that ⚠️ **a LAN-visible server brokers your configured API keys to anyone who can reach it.** Set the per-IP throttles (`GEV_RATELIMIT_OPENAI_PER_MIN`, `GEV_RATELIMIT_GOOGLE_PER_MIN` — see `.env.example`) and, before anything else, **set provider-side budget caps** (Google Cloud budgets, OpenAI usage limits): the throttles are app-level guards, not billing caps. Full threat model in [SECURITY.md](SECURITY.md).

---

## 📋 Responsible & Open

God's Eye View runs on **public data, clear sources, and local-first execution.** No secrets, no private datasets, no mystery scraping — anything involving a private key is brokered server-side. It has the visual grammar of a classified ops room, built entirely from open signals and inspectable code.

**The line.** This project models **events, assets, infrastructure, and systems** — aircraft, vessels, satellites, fires, cameras, cities. It does not build features for named-person search, face recognition, or tracking individuals, and pull requests that cross that line won't be merged. People are not a query type here.

**Come build it.** This is the canonical live 3D client from the project that kicked off the recent wave of spatial-intelligence tools — and it's a canvas: the layers here are the signals one person could find and fuse. Add a city pack, a data source, a style, a voice tool. It's the window through which you see the world; bring that window to others.

**Status:** An evolving open-source client for exploration and learning — a fast, hackable foundation, not a hardened production service. Released under the **[MIT License](LICENSE)**. Bundled and live datasets carry their own terms — see **[DATA_SOURCES.md](DATA_SOURCES.md)**. Security model: **[SECURITY.md](SECURITY.md)**. Want to contribute? **[CONTRIBUTING.md](CONTRIBUTING.md)**.

<sub>Media note: Bilawal Sidhu created and owns the 17 capture GIFs on this page. He also published the two README PNGs in the existing public project and authorized their continued inclusion here. Any appearance by Bilawal is included with his permission. These files are project documentation, not MIT-licensed standalone assets. Platform interfaces, trademarks, avatars, data, and third-party imagery visible within them remain subject to their respective owners' terms. See [media provenance](docs/media/README.md) and [source terms](DATA_SOURCES.md).</sub>

> [!IMPORTANT]
> God's Eye View is an exploratory visualization of public and third-party data.
> Data may be delayed, incomplete, modeled, inferred, or wrong. Do not use it
> for flight or maritime navigation, emergency response, medical or health
> decisions, investment decisions, or other safety-critical or operational
> purposes. Verify important information with authoritative sources.

---

## 🧭 What's Next

First — thank you. To everyone who watched the God-view demos and went off to build their own, and to everyone who kept asking for the code: I'm grateful. And when I polled whether this should go open source, you weren't subtle about it:

<img src="docs/media/open-source-survey.png" alt="Community survey on open-sourcing God's Eye View" width="460">

So here it is. Step inside the spy-thriller cockpit — except the data is real — and let's turn this into our shared sandbox for making sense of the world, and have fun doing it. This repo is the baseline, it stays open, and the whole point is for you to break things and bolt on layers we haven't thought of yet.

One heads-up from the inside: build in this space for a week and you learn that **the present is the cheap part**. The moment you try to go back in time — tiling, serving, and scrubbing *what happened* and *what changed* at any real resolution — the data gets expensive and the compute gets brutal. For that, we're building something cool. More in the future — [halfpixel.ai](https://halfpixel.ai).

---

<div align="center">

▶️ [Watch the God's Eye View series](https://youtube.com/playlist?list=PL6qSg2I-7_koPbDnSMo0QeeHX_RknA2uv&si=nBGYMoHWQw41v93Q) · 📬 [Map the World](https://maptheworld.ai/) — the newsletter behind the project

**🌐 God's Eye View. No place left behind.**

</div>
