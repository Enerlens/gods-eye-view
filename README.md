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

Twenty-four live layers. **Twenty of them need nothing at all** — no key, no account, no signup, and the newest one draws its whole subject without one too. (🟢 nothing · 🟡 free key · 🔴 metered.)

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
| 🛣 **Road Status FR** 🇫🇷 | The State's own loop detectors on the national road network — 830 segments, 918 km, coloured by the sixteen DIR traffic centres' live `freeFlow`/`heavy`/`congested` and carrying the one thing TomTom never gives you: a **measured vehicle count**, veh/h and km/h per station. Keyless, so it is the only real congestion data on a build with no TomTom key. Brightest exactly where Transit FR is dark — Marseille, Toulouse, Lyon — and blind in Île-de-France, which it says out loud rather than showing a blank | Bison Futé / DIR (DATEX II) | 🟢 |
| 🔥 **Active Fires** | Live NASA FIRMS detections, trailing 24h | NASA FIRMS | 🟡 |
| 🚀 **Space Missions** | Rolling 30-day launches with payload, stage, and recovery detail | Launch Library 2 | 🟢 (🟡 optional token raises the allowance) |
| ≋ **Vigicrues** 🇫🇷 | France's official river-flood vigilance map — 337 monitored reaches, coloured green→red by the state's own 24 h risk reading. Calm days are green; it lights up in an episode | Vigicrues (SCHAPI) | 🟢 |
| ◉ **Hub'Eau Gauges** 🇫🇷 | The live river-sensor mesh under Vigicrues — up to ~4,000 gauging stations, sized by discharge, with the raw number on the label | Hub'Eau / Eaufrance | 🟢 |
| ⚠ **Vigilance MF** 🇫🇷 | The 4-colour départemental weather warning every French forecast leads with — 9 phenomena, only the raised départements painted | Météo-France | 🟢 (🟡 optional key swaps the mirror for the contracted API) |
| ⚡ **Mix élec** 🇫🇷 | Where French electricity actually comes from, right now: the 12 métropolitaines painted by whether they *power* France or *draw* on it — Auvergne-Rhône-Alpes and Normandie exporting hard, Île-de-France importing almost its whole load — plus the five border flows as arcs pointing the way the power travels. Updated every 15 min | éCO2mix — RTE, via ODRÉ | 🟢 |
| ⬡ **Réseau gaz** 🇫🇷 | The French gas system as three things at once: **36,106 km** of high-pressure transmission trace clamped to the ground — NaTran (ex-GRTgaz) in violet, Teréga in orchid, never merged — plus the **850 renewable-methane injection points** feeding it and the **14 gas-fired power stations** burning out of it, into the `gaz` filière of the Mix élec layer above. Both traces are the operators' own, simplified to about 250 m, and are drawn exactly as published | NaTran / Teréga / ODRÉ | 🟢 |
| ◈ **Centrales EDF** 🇫🇷 | Where French electricity is physically made: EDF's own 79 generating sites — 18 nuclear (61 370 MW), 51 hydraulic (13 779 MW) and 10 fossil-fired (4 945 MW) — each a disc whose **area** is its installed capacity, labelled with what it actually is: `GRAVELINES · 5 460 MW · 6 × REP 900`, `GRAND-MAISON · 1 714 MW · Pompage mixte`. EDF's fleet rather than France's, and dated per file rather than pretending to one snapshot | EDF Open Data | 🟢 |
| ☢ **Groupes de prod** 🇫🇷 | France's power stations, **unit by unit**, at the output RTE last published for each one — 57 reactors, 6 pumped-storage machines, 44 thermal groups, 171 units and 93.5 GW in all. Each station is a ring sized by its nameplate, filled by what it is producing: a **crisp empty ring is a reactor in outage**, a faint one is a station RTE said nothing about, and a **magenta disc is a machine consuming the grid** to fill its upper lake. Click one and the card lists its groups with a day of hourly history each. Draws the whole fleet with no key at all — the key only adds the megawatts | RTE · ODRÉ · EDF · OpenStreetMap | 🟡 (🟢 without the key: installed capacity only) |
| ≈ **Petite hydro** 🇫🇷 | The other 2 686 hydro plants. France's national register holds **2 742 hydroelectric installations for 26,02 GW** — the two layers above could draw 56 of them, because one is EDF-only and the other stops at RTE's 100 MW publication floor. Between them sat the nine SHEM plants of the Ossau valley at Laruns, 223,9 MW in one commune, on no layer at all. This draws the register whole, down to a 40 kW mill. **A filled disc is a plant where it is** — 589 of the 998 positions are a building footprint **surveyed by IGN**, the data the Plan IGN is drawn from, median span 32 m, with IGN's own accuracy on the card. **A hollow ring is a commune, not a plant**: the register publishes no coordinates, and for the 1 744 installations nobody places, the commune centre is a median 2,5 km from the powerhouse, so they are rolled up rather than pinned somewhere false. Half the register is anonymised by the publisher, and those cards are still full: power, technology, head, connection voltage, source substation, grid operator, and the energy actually injected over twelve rolling months. No key | IGN BD TOPO · ODRÉ · OpenStreetMap · EDF | 🟢 |
| 🔌 **Bornes IRVE** 🇫🇷 | Every public EV charge point France has declared — 231,079 of them on 2026-08-27, a file rebuilt daily — answered at the scale you ask: the 96 **départements** with the whole country in view, the **maillage** of real positions once it is cropped, then **every site** over a city with its operators and connectors. The car park under La Défense that files 127 separate "stations" is one dot; the 7.5% of charge points two operators publish twice are counted once, and both figures are on the card. Installed capacity, never availability — the register does not publish it | transport.data.gouv.fr / ODRÉ | 🟢 |
| 🎓 **Établissements scolaires** 🇫🇷 | Every school France registers — 68,939 rows on 2026-09-01, rebuilt daily, of which **68,158 are open and placed** — answered at the scale you ask: the 96 **départements** with the country in view, the **maillage** of real positions once it is cropped, then **every establishment** over a city with its level, its roll and its services. Coloured by level, sized by pupils joined on the UAI from the ministry's four *effectifs* files. The 8.3% with no published roll are drawn and say *effectif non publié* — a gap in the roll files is not a school with no pupils. The 2,159 schools geocoded only to their commune say that too, and the 2,762 the metropolitan polygons cannot paint are counted on the national card rather than quietly missing | Annuaire de l'éducation — MENJ | 🟢 |
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
