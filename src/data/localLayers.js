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
  DAM_TIER_STYLES,
  damTier,
  damTierLegend,
  damTierVisible,
} from './damsPack.js';

// Use Vite's ?url import to properly resolve these assets in dev and build
import airportsUrl from './local_data/airports/airports.geojsonl?url';
import datacentersUrl from './local_data/datacenters/datacenters.geojsonl?url';
import damsUrl from './local_data/dams/dams.geojsonl?url';
import portsUrl from './local_data/ports/ports.geojsonl?url';

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
  groupOf: damTier,
  groupStyles: DAM_TIER_STYLES,
  groupVisible: damTierVisible,
  // Opens on TOUS, like the airports pack: someone who switches the layer on
  // asked to see the barrages, and hiding four fifths of them before being
  // asked would answer a question nobody put.
  defaultParams: { floor: DAM_DISPLAY_FLOORS[0].id },
  rowControls: (params, tally) => ({
    chips: DAM_DISPLAY_FLOORS.map((floor) => ({
      id: floor.id,
      label: floor.label,
      active: params.floor === floor.id,
      state: params.floor === floor.id ? 'active' : 'idle',
      title: floor.title,
      params: { floor: floor.id },
    })),
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
});

// OurAirports — public domain, bundled. NOT the whole 86k-row catalogue: the
// pack is every large/medium airport worldwide, everything that sells a
// scheduled seat, and the full French long tail down to the grass strips. The
// four clauses and their reasons live in ./airportsPack.js, which also writes
// the card, so the layer and the build can never disagree about a field.
const airports = createLocalGeoJsonLayer({
  id: 'local-airports',
  url: airportsUrl,
  name: 'Aéroports',
  color: '#b388ff', // Violet — clear of cyan (datacenters), blue (dams), amber (ports)
  icon: '✈',
  source: 'OurAirports',
  labels: true,
  // Tighter than ports (800/136): airports cluster into metro areas — eleven
  // fields inside Île-de-France alone — so the grid needs the extra pitch or
  // Paris renders as one illegible stack of cards.
  labelMax: 700,
  labelGridPx: 144,

  // ── Importance is the map channel, not just card text ─────────────────
  // Every marker the same size says every airfield matters the same, which is
  // the one thing this pack is NOT. `airportTier` grades each feature once and
  // that single answer drives the dot size, the colour, the label ladder, the
  // legend and the display floors — see the ladder in ./airportsPack.js.
  groupOf: airportTier,
  groupStyles: AIRPORT_TIER_STYLES,
  groupVisible: airportTierVisible,
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
