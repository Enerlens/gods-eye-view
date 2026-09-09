import { createLocalGeoJsonLayer } from './localGeojson.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import submarineCablesLayer from './telegeographySubmarineCables.js';
import {
  AIRPORT_DISPLAY_FLOORS,
  AIRPORT_TIER_STYLES,
  airportTier,
  airportTierLegend,
  airportTierVisible,
} from './airportsPack.js';
import {
  DAM_DISPLAY_FLOORS,
  DAM_STRUCTURE_CHIPS,
  DAM_TIER_STYLES,
  damGroupKey,
  damTierLegend,
  damTierVisible,
} from './damsPack.js';
import { publishJoin } from './layerJoins.js';
import { nearestDam } from './damsPack.js';
import { buildPortIndex } from './portDirectory.js';

// Use Vite's ?url import to properly resolve these assets in dev and build
import airportsUrl from './local_data/airports/airports.geojsonl?url';
import datacentersUrl from './local_data/datacenters/datacenters.geojsonl?url';
import damsUrl from './local_data/dams/dams.geojsonl?url';
import portsUrl from './local_data/ports/ports.geojsonl?url';
import portGazetteerUrl from './local_data/ports/gazetteer.json?url';

/**
 * Registry of local GeoJSON datasets.
 * These are lazily loaded natively into Cesium when enabled.
 */
const datacenters = createLocalGeoJsonLayer({
  id: 'local-datacenters',
  url: datacentersUrl,
  name: 'Datacenters',
  color: '#00ffff', // Cyan
  icon: '▣',
  source: 'Local',
  labels: true,
  labelMax: 700,
  labelGridPx: 138,
});

// OpenStreetMap dams — ODbL, bundled. France (métropole + outre-mer) is a full
// extraction of the dam STRUCTURES, 5 529 of them; the rest of the world is the
// older Open Infrastructure Map snapshot the pack shipped before, kept so the
// layer is not empty outside France. `source` said "USACE" for a year and never
// was: nothing here has ever come from the US Army Corps of Engineers.
const dams = createLocalGeoJsonLayer({
  id: 'local-dams',
  url: damsUrl,
  name: 'Barrages',
  color: '#0088ff', // Blue — the polygon footprints; points are graded below.
  icon: '▰',
  source: 'OpenStreetMap',
  labels: true,
  // Tighter than the old 900/132: the French half clusters hard along the
  // Alpine and Massif Central valleys, where a dozen ouvrages share one
  // watershed and the grid would hand every cell to a nameless seuil.
  labelMax: 700,
  labelGridPx: 140,

  // ── Importance is the map channel, not just card text ─────────────────
  // 4 579 of the 6 189 features carry no name, no height and no operator —
  // pond outlets and river weirs. Drawn identically to Serre-Ponçon they are a
  // wall. `damTier` grades each feature once and that single answer drives the
  // dot size, the colour, the label ladder, the display floors and the legend
  // — see the ladder in ./damsPack.js.
  // TWO axes, one key: colour says WHAT the structure is (a digue is not a
  // barrage — the distinction this layer used to lose), size says how much it
  // matters. They have to travel together because the renderer resolves one
  // group key per feature at load and bakes its style into the primitives.
  groupOf: damGroupKey,
  groupStyles: DAM_TIER_STYLES,
  groupVisible: damTierVisible,
  // Opens on TOUS/TOUS, like the airports pack: someone who switches the layer
  // on asked to see the barrages, and hiding four fifths of them before being
  // asked would answer a question nobody put.
  defaultParams: { floor: DAM_DISPLAY_FLOORS[0].id, kinds: DAM_STRUCTURE_CHIPS[0].id },

  // ── The neighbourhood, offered to the small-hydro register ──────────────
  // A hydro plant's card names its head and its power and never the structure
  // holding the water back, because ODRÉ publishes no link to one. This pack
  // holds 5 529 French dam structures. What it can offer is a NEIGHBOUR at a
  // measured distance — never an identity, which nothing in either register
  // supports — and the card that reads it says exactly that.
  onFeatures: (features) => {
    const rows = [];
    for (const feature of Array.isArray(features) ? features : []) {
      const coordinates = feature?.geometry?.type === 'Point'
        ? feature.geometry.coordinates
        : null;
      // Points only: 1 610 of the pack's features are outlines, and a polygon
      // has no single position to measure a distance from. A dam drawn as a
      // wall is still in the pack, it is simply not what this offer answers
      // with, and the card never claims completeness.
      if (!Array.isArray(coordinates)) continue;
      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      rows.push({ props: feature.properties || {}, lat, lon });
    }
    return publishJoin('dams/nearest', (lat, lon, maxM) => nearestDam(rows, lat, lon, maxM));
  },
  rowControls: (params, tally) => ({
    // Two rows in the one array the panel renders. Runtime params MERGE, so
    // the two axes stay independent and neither touches the share-link
    // grammar — `local-dams` keeps its single token.
    chips: [
      ...DAM_STRUCTURE_CHIPS.map((chip) => ({
        id: `kinds:${chip.id}`,
        label: chip.label,
        active: (params.kinds || DAM_STRUCTURE_CHIPS[0].id) === chip.id,
        state: (params.kinds || DAM_STRUCTURE_CHIPS[0].id) === chip.id ? 'active' : 'idle',
        title: chip.title,
        params: { kinds: chip.id },
      })),
      ...DAM_DISPLAY_FLOORS.map((floor) => ({
        id: floor.id,
        label: floor.label,
        active: params.floor === floor.id,
        state: params.floor === floor.id ? 'active' : 'idle',
        title: floor.title,
        params: { floor: floor.id },
      })),
    ],
    legend: damTierLegend(tally),
  }),
});

// NGA World Port Index (Pub. 150) — US public domain, bundled. Depth values
// in the pack are WPI range bins, not soundings; the card copy labels them
// approximate for that reason (see scripts/build-nga-ports.mjs).
const ports = createLocalGeoJsonLayer({
  id: 'local-ports',
  url: portsUrl,
  name: 'Ports',
  color: '#ffb14e', // Amber
  icon: '⚓',
  source: 'NGA WPI',
  labels: true,
  labelMax: 800,
  labelGridPx: 136,

  // ── The pack, offered to whoever needs a harbour ────────────────────────
  // AIS message 5 carries a destination the master typed by hand, and this
  // layer holds the 2 951 harbours that field is trying to name. The two were
  // drawn one row apart and never joined; since the fusion they are the SAME
  // row (`layerFusions.js`), which is what makes the join reachable without
  // asking a reader to switch on a second layer.
  //
  // Published through `layerJoins.js` rather than imported by the vessels
  // layer: the offer exists exactly while the pack is loaded, and the card
  // that reads it says less when it is not.
  onFeatures: (features) => {
    // Published SYNCHRONOUSLY on the World Port Index alone, then republished
    // when the gazetteer lands. The order is the point: a card asking one
    // second in gets the 2 951 harbours rather than nothing, and the extra
    // 11 545 places arrive without anyone waiting on them. A gazetteer that
    // never arrives — offline, 404, a build that skipped the script — leaves
    // the join exactly as it was before it existed, which is the same
    // "absence is ordinary" contract every consumer of `layerJoins` already
    // works to.
    let index = buildPortIndex(features);
    let alive = true;
    const stop = publishJoin('ports/directory', () => index);
    fetch(portGazetteerUrl)
      .then((response) => (response.ok ? response.json() : null))
      .then((gazetteer) => {
        if (!alive || !gazetteer) return;
        index = buildPortIndex(features, gazetteer);
        console.log(`[Data:Ports] gazetteer: +${index.gazetteerPorts} lieux, `
          + `+${index.aliases} graphies`);
      })
      .catch(() => { /* the WPI index stands on its own */ });
    return () => { alive = false; stop(); };
  },
});

// OurAirports — public domain, bundled. NOT the whole 86k-row catalogue: the
// pack is every large/medium airport worldwide, everything that sells a
// scheduled seat, and the full French long tail down to the grass strips. The
// four clauses and their reasons live in ./airportsPack.js, which also writes
// the card, so the layer and the build can never disagree about a field.
//
// TWO PUBLISHERS, and the row says both. 418 French fields also carry the
// ground they sit on — the IGN's surveyed aerodrome boundary, BD TOPO®, under
// Licence Ouverte 2.0, joined at build time on the ICAO code. OurAirports asks
// for no attribution and the IGN requires one, so the credit is not optional
// here: it is on the row, on the card line that prints the outline, and in the
// attribution popover.
const airports = createLocalGeoJsonLayer({
  id: 'local-airports',
  url: airportsUrl,
  name: 'Aéroports',
  color: '#b388ff', // Violet — clear of cyan (datacenters), blue (dams), amber (ports)
  icon: '✈',
  source: 'OurAirports · IGN',
  labels: true,
  // Tighter than ports (800/136): airports cluster into metro areas — eleven
  // fields inside Île-de-France alone — so the grid needs the extra pitch or
  // Paris renders as one illegible stack of cards.
  labelMax: 700,
  labelGridPx: 144,

  // ── Importance is the map channel, not just card text ─────────────────
  // Every marker the same size says every airfield matters the same, which is
  // the one thing this pack is NOT. `airportTier` grades each feature once and
  // that single answer drives the colour, the label ladder, the legend, the
  // display floors and — new — the distance at which the MARK itself is drawn.
  // It no longer drives the dot SIZE: that is the published runway length now,
  // through the pack's render spec. See both ladders in ./airportsPack.js.
  groupOf: airportTier,
  groupStyles: AIRPORT_TIER_STYLES,
  groupVisible: airportTierVisible,

  // The recall stem is capped in metres here and nowhere else in the app,
  // because this is the one layer whose marks stand over ground that live
  // aircraft are flown above. Uncapped it puts the pastille at FL114 at 50 km
  // and FL228 at 100 km, in the middle of the traffic the flights layers draw
  // at their real altitudes — two vertical lengths, two registers, one column
  // of pixels (F7). 150 m is under the 300 m traffic-pattern altitude.
  stemMaxHeightM: 150,
  // Opens on TOUS: a visitor who turns the layer on asked to see the airports,
  // and a layer that hides 1 126 of them before being asked would be answering
  // a question nobody put. The chip is there the moment they want it.
  defaultParams: { floor: AIRPORT_DISPLAY_FLOORS[0].id },
  rowControls: (params, tally) => ({
    chips: AIRPORT_DISPLAY_FLOORS.map((floor) => ({
      id: floor.id,
      label: floor.label,
      active: params.floor === floor.id,
      state: params.floor === floor.id ? 'active' : 'idle',
      title: floor.title,
      params: { floor: floor.id },
    })),
    legend: airportTierLegend(tally),
  }),
});

// Live NASA FIRMS fires (VIIRS ×3 NRT via the /api/firms proxy). The id keeps
// the historical `local-` prefix for persistence + voice-tool-enum compat,
// but the data is NOT bundled anymore — it needs FIRMS_MAP_KEY server-side.
const fires = createFirmsHeatmapLayer({
  id: 'local-firms',
  name: 'FIRMS Active Fires',
  icon: '▲',
  source: 'NASA FIRMS · LIVE',
});

export default [
  airports,
  datacenters,
  dams,
  ports,
  submarineCablesLayer,
  fires,
];
