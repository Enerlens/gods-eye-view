/**
 * @module transitVehicleKind
 *
 * What the moving thing actually IS — bus, tram, métro, ferry — resolved from
 * the static GTFS `route_type` its network publishes.
 *
 * THE GAP THIS CLOSES. GTFS-Realtime `VehiclePosition` carries no vehicle
 * class. It carries a `trip.route_id`, and the meaning of that id lives in the
 * network's separate static GTFS `routes.txt`. Without the join, every contact
 * in `transitFrance.js` could only be coloured by its NETWORK's declared
 * service class (`urban`, `intercity`, `school`) — so Bordeaux's 87 trams, its
 * 3 river shuttles and its 372 buses were one undifferentiated amber swarm.
 *
 * WHERE THE JOIN HAPPENS. Not here, and not in the browser: a French network's
 * static GTFS is tens of megabytes (Bordeaux TBM is 250 MB expanded, of which
 * `routes.txt` is 8.7 KB), so `scripts/build-pan-route-types.mjs` reads the one
 * member it needs out of each remote archive and commits
 * `config/pan_route_types.json`. This module is the pure lookup both that
 * script and the dev-server proxy run against.
 *
 * WHAT IS TRUE AND WHAT IS A FALLBACK — every resolution says which it is:
 *
 *   - `route_type`  the vehicle's own trip resolved to a class in the
 *                   network's `routes.txt`. This is the operator's answer.
 *   - `uniform`     the vehicle's route id did not resolve, but every route
 *                   the network publishes is the same class, so the class is
 *                   known without the join. TADAO publishes 333 routes and all
 *                   333 are buses; a vehicle with an unmatched route id there
 *                   is still a bus.
 *   - `network`     neither held. The layer falls back to the network's
 *                   declared SERVICE class, which is not a vehicle type, and
 *                   the card says so rather than guessing.
 *
 * Measured 2026-08-31 across the eleven largest French feeds, the direct join
 * resolves 99–100% of vehicles on eight of them and 0% on three: Rennes STAR
 * (its GTFS resource 404s), the Normandy aggregate (its archive carries no
 * readable `routes.txt`) and Tours Fil Bleu (its feed publishes no `route_id`
 * at all). Those three are why the fallbacks are named instead of silent.
 *
 * Dependency-free and side-effect-free, so `node --test` and the proxy share
 * one definition.
 */

/**
 * GTFS `route_type` → vehicle kind, for the basic values in the reference.
 * @see https://gtfs.org/documentation/schedule/reference/#routestxt
 */
export const GTFS_ROUTE_TYPE_KINDS = Object.freeze({
  0: 'tram',
  1: 'metro',
  2: 'rail',
  3: 'bus',
  4: 'ferry',
  5: 'cable-tram',
  6: 'aerial',
  7: 'funicular',
  11: 'trolleybus',
  12: 'monorail',
});

/**
 * Extended `route_type` ranges (the Hierarchical Vehicle Type list, 100–1799).
 *
 * French publishers that convert from NeTEx emit these — `Trains régionaux`
 * datasets use the 100 range — and reading them as "unknown" would throw away
 * exactly the modes this layer most wants to distinguish. Each entry is
 * `[inclusiveLow, inclusiveHigh, kind]`, checked in order.
 */
const EXTENDED_RANGES = Object.freeze([
  [100, 199, 'rail'],
  [200, 299, 'coach'],
  [400, 499, 'metro'],
  [500, 599, 'metro'],
  [600, 699, 'metro'],
  [700, 799, 'bus'],
  [800, 899, 'trolleybus'],
  [900, 999, 'tram'],
  [1000, 1099, 'ferry'],
  [1100, 1199, 'air'],
  [1200, 1299, 'ferry'],
  [1300, 1399, 'aerial'],
  [1400, 1499, 'funicular'],
  [1500, 1599, 'taxi'],
  [1700, 1799, 'other'],
]);

/**
 * Display labels.
 *
 * English, matching every other rendered surface in `transitFrance.js`
 * (`PAN_MODE_LABELS`, the stop-status and occupancy labels). The app is
 * mid-migration to French — `layerTaxonomy.js` already records the French
 * layer names — but that switch is a deliberate separate change, and a card
 * reading "Navette fluviale · at stop" would be neither language.
 */
export const VEHICLE_KIND_LABELS = Object.freeze({
  bus: 'Bus',
  coach: 'Coach',
  tram: 'Tram',
  metro: 'Metro',
  rail: 'Train',
  ferry: 'Ferry',
  'cable-tram': 'Cable tram',
  aerial: 'Cable car',
  funicular: 'Funicular',
  trolleybus: 'Trolleybus',
  monorail: 'Monorail',
  taxi: 'Taxi',
  air: 'Air',
  other: 'Other',
});

/**
 * Per-kind tint.
 *
 * Rail-guided modes run cool (tram, métro, funiculaire), road modes warm (bus,
 * car, trolleybus), water its own teal. The point is that a Bordeaux viewport
 * separates its 87 trams from its 372 buses at a glance without reading a
 * single card — which is the entire reason the join exists.
 */
export const VEHICLE_KIND_COLORS = Object.freeze({
  bus: '#ffc93c',
  coach: '#ff8f3f',
  trolleybus: '#ffd98a',
  tram: '#7ee0ff',
  metro: '#8ab4f8',
  rail: '#c792ea',
  monorail: '#b39ddb',
  ferry: '#5ee0c0',
  'cable-tram': '#a5d8ff',
  aerial: '#a5d8ff',
  funicular: '#a5d8ff',
  taxi: '#ffe066',
  air: '#ffffff',
  other: '#c9d1d9',
});

/**
 * Resolve one GTFS `route_type` to a vehicle kind.
 *
 * @param {*} routeType Raw value from `routes.txt` (string or number).
 * @returns {?string} Kind, or null when the value is absent or unlisted.
 */
export function kindFromRouteType(routeType) {
  // `Number(null)`, `Number('')` and `Number(false)` are all 0, and 0 is
  // `tram`. Anything that is not already a number has to LOOK like one before
  // it is read as one, or an empty CSV cell becomes a tramway.
  if (typeof routeType !== 'number' && !/^\s*-?\d+\s*$/.test(String(routeType ?? ''))) return null;
  const value = Number(routeType);
  if (!Number.isInteger(value) || value < 0) return null;
  const basic = GTFS_ROUTE_TYPE_KINDS[value];
  if (basic) return basic;
  for (const [low, high, kind] of EXTENDED_RANGES) {
    if (value >= low && value <= high) return kind;
  }
  return null;
}

/** Display label for a kind, falling back to the raw token. */
export function vehicleKindLabel(kind) {
  return VEHICLE_KIND_LABELS[kind] || (kind ? String(kind) : 'Vehicle');
}

/** Tint for a kind, falling back to the neutral grey. */
export function vehicleKindColor(kind) {
  return VEHICLE_KIND_COLORS[kind] || VEHICLE_KIND_COLORS.other;
}

/**
 * Reduce a network's `route_id → route_type` map to its single kind, if it has
 * one.
 *
 * A network whose every published route is the same class tells you the class
 * of any vehicle it reports, join or no join. This is what rescues feeds that
 * publish an opaque or absent `route_id` — as long as the network really is
 * uniform, which is measured here rather than assumed.
 *
 * @param {Object<string, number>} routes `route_id` → `route_type`.
 * @returns {?string} The single kind, or null when the network mixes classes
 *   (or publishes nothing).
 */
export function uniformKindOf(routes) {
  let only = null;
  for (const routeType of Object.values(routes || {})) {
    const kind = kindFromRouteType(routeType);
    if (!kind) return null;
    if (only === null) only = kind;
    else if (only !== kind) return null;
  }
  return only;
}

/**
 * Resolve the kind of one live vehicle.
 *
 * @param {?string} routeId Raw `trip.route_id` from the realtime feed.
 * @param {?{routes?: Object<string, number>, uniformKind?: ?string}} entry
 *   This feed's record from `config/pan_route_types.json`.
 * @returns {{kind: ?string, source: 'route_type'|'uniform'|'network'}}
 */
export function resolveVehicleKind(routeId, entry) {
  const id = String(routeId ?? '').trim();
  if (id && entry?.routes) {
    const kind = kindFromRouteType(entry.routes[id]);
    if (kind) return { kind, source: 'route_type' };
  }
  if (entry?.uniformKind) return { kind: entry.uniformKind, source: 'uniform' };
  return { kind: null, source: 'network' };
}

/**
 * Parse the `route_id` and `route_type` columns out of a GTFS `routes.txt`.
 *
 * A hand-rolled reader rather than a CSV dependency: this runs in a build
 * script over one small, well-specified file, and the only subtleties are the
 * ones GTFS actually exercises — a UTF-8 BOM, CRLF endings, quoted fields
 * containing commas, and doubled quotes inside them.
 *
 * @param {string} text Contents of `routes.txt`.
 * @returns {Object<string, number>} `route_id` → `route_type`, skipping rows
 *   with no usable pair.
 */
export function parseRouteTypes(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const header = splitCsvLine(lines[0] || '');
  const idColumn = header.indexOf('route_id');
  const typeColumn = header.indexOf('route_type');
  if (idColumn < 0 || typeColumn < 0) return {};

  const routes = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = splitCsvLine(lines[i]);
    const id = (cells[idColumn] ?? '').trim();
    const rawType = (cells[typeColumn] ?? '').trim();
    // `Number('')` is 0, and 0 is `tram`. An empty cell must stay unknown
    // rather than turn every route of a sloppy publisher into a tramway.
    if (!id || !rawType) continue;
    const type = Number(rawType);
    if (!Number.isInteger(type)) continue;
    routes[id] = type;
  }
  return routes;
}

/**
 * Split one CSV record, honouring RFC 4180 quoting.
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char !== '"') { cell += char; continue; }
      if (line[i + 1] === '"') { cell += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { cells.push(cell); cell = ''; continue; }
    cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}
