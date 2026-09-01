/**
 * @module transitCoverage
 *
 * Where French live transit actually exists, measured — so the layer can say
 * "nobody publishes here" instead of drawing an empty map and letting a viewer
 * conclude the feature is broken.
 *
 * THE FACT THIS ENCODES. France's national access point obliges operators to
 * publish schedules; it does not oblige them to publish VEHICLE POSITIONS, and
 * the largest networks do not. Measured 2026-08-31 at 17:50 CEST on a Monday
 * — a weekday peak, not a quiet Sunday — across all 148 queryable feeds:
 *
 *     Bordeaux      453      Paris intra-muros    0
 *     Rouen         379      Grand Lyon           0
 *     Le Havre      339      Marseille            0
 *     Rennes        228      Lille                0
 *     Nice          201      Strasbourg           0
 *     Montpellier   191      Toulouse            20  (regional coaches only)
 *
 * The zeroes are structural, not seasonal. Île-de-France Mobilités publishes
 * no GTFS-Realtime resource at all; Aix-Marseille publishes `service_alerts`
 * only; Tisséo publishes `service_alerts` and `trip_updates` but no
 * `vehicle_positions`; neither TCL Lyon nor Ilévia Lille appears in the
 * vehicle-position catalog. No amount of waiting makes a bus appear in Paris.
 *
 * THE ONE EXCEPTION, AND WHY IT DOES NOT CHANGE THE CLAIM. Exactly one feed
 * has an observed footprint inside the Paris petite couronne: Titus, the
 * three-vehicle municipal shuttle of Rosny-sous-Bois, published through
 * Zenbus. Three buses in one suburb, against a network carrying millions of
 * daily riders that publishes nothing. So the dark-area claim is about
 * CITY-SCALE publication, and the maintenance test below encodes exactly that
 * threshold rather than pretending the map is empty to the last vehicle.
 *
 * WHY IT MATTERS HERE SPECIFICALLY. The globe opens on Paris. Without this,
 * the flagship ground-transit layer's first impression is a blank city and a
 * label reading "no PAN feed covers this view" — technically true, and
 * indistinguishable from a bug.
 *
 * MAINTENANCE. Every figure below is a measurement with a date on it, and the
 * dark list is a claim about publishers that will age. `npm run transit:index`
 * re-measures the feeds; this table is checked against the built index by
 * `transitCoverage.test.mjs`, which fails if a "dark" area has acquired a feed.
 *
 * Dependency-free and side-effect-free.
 */
import { boxesIntersect, boxContains } from './viewportBox.js';

/** The date every figure in this module was measured. */
export const TRANSIT_COVERAGE_MEASURED_AT = '2026-08-31';

/**
 * Urban areas where no operator publishes live vehicle positions.
 *
 * `reason` is what the PAN catalog says, not an interpretation: each is the
 * set of GTFS-Realtime features that publisher actually declares.
 */
export const TRANSIT_DARK_AREAS = Object.freeze([
  Object.freeze({
    id: 'idf',
    name: 'Île-de-France',
    operator: 'Île-de-France Mobilités',
    reason: 'publishes no GTFS-Realtime resource at all',
    bbox: Object.freeze({ south: 48.60, west: 1.90, north: 49.10, east: 2.85 }),
  }),
  Object.freeze({
    id: 'lyon',
    name: 'Lyon',
    operator: 'TCL',
    reason: 'has no vehicle-position feed in the national catalog',
    bbox: Object.freeze({ south: 45.60, west: 4.70, north: 45.90, east: 5.00 }),
  }),
  Object.freeze({
    id: 'marseille',
    name: 'Marseille',
    operator: 'RTM · Aix-Marseille-Provence',
    reason: 'publishes service alerts only',
    bbox: Object.freeze({ south: 43.15, west: 5.20, north: 43.45, east: 5.60 }),
  }),
  Object.freeze({
    id: 'lille',
    name: 'Lille',
    operator: 'Ilévia',
    reason: 'has no vehicle-position feed in the national catalog',
    bbox: Object.freeze({ south: 50.55, west: 2.90, north: 50.75, east: 3.25 }),
  }),
  Object.freeze({
    id: 'strasbourg',
    name: 'Strasbourg',
    operator: 'CTS',
    reason: 'has no vehicle-position feed in the national catalog',
    bbox: Object.freeze({ south: 48.45, west: 7.55, north: 48.70, east: 7.90 }),
  }),
  Object.freeze({
    id: 'toulouse',
    name: 'Toulouse',
    operator: 'Tisséo',
    reason: 'publishes trip updates and alerts, but no vehicle positions',
    bbox: Object.freeze({ south: 43.50, west: 1.30, north: 43.70, east: 1.55 }),
  }),
]);

/**
 * Where the layer is at its best, with the live fleet measured on
 * {@link TRANSIT_COVERAGE_MEASURED_AT}.
 *
 * Ordered by fleet size, which is also the order they are offered as an
 * alternative when the camera is somewhere dark.
 */
export const TRANSIT_SHOWCASES = Object.freeze([
  Object.freeze({
    id: 'bordeaux',
    name: 'Bordeaux',
    network: 'TBM',
    lat: 44.8378,
    lon: -0.5792,
    vehicles: 453,
    kinds: Object.freeze(['bus', 'tram', 'ferry']),
  }),
  Object.freeze({
    id: 'rouen',
    name: 'Rouen',
    network: 'Astuce',
    lat: 49.4432,
    lon: 1.0999,
    vehicles: 379,
    kinds: Object.freeze(['bus', 'metro', 'ferry']),
  }),
  Object.freeze({
    id: 'le-havre',
    name: 'Le Havre',
    network: 'LiA',
    lat: 49.4938,
    lon: 0.1077,
    vehicles: 339,
    kinds: Object.freeze(['bus', 'tram']),
  }),
  Object.freeze({
    id: 'rennes',
    name: 'Rennes',
    network: 'STAR',
    lat: 48.1173,
    lon: -1.6778,
    vehicles: 228,
    kinds: Object.freeze(['bus']),
  }),
  Object.freeze({
    id: 'nice',
    name: 'Nice',
    network: "Lignes d'Azur",
    lat: 43.7031,
    lon: 7.2661,
    vehicles: 201,
    kinds: Object.freeze(['bus', 'tram']),
  }),
  Object.freeze({
    id: 'montpellier',
    name: 'Montpellier',
    network: 'TaM',
    lat: 43.6108,
    lon: 3.8767,
    vehicles: 191,
    kinds: Object.freeze(['bus', 'tram']),
  }),
  Object.freeze({
    id: 'toulon',
    name: 'Toulon',
    network: 'Réseau Mistral',
    lat: 43.1242,
    lon: 5.9280,
    vehicles: 146,
    kinds: Object.freeze(['bus', 'ferry', 'aerial']),
  }),
]);

/** The dark area a viewport falls in, if any. */
export function darkAreaForBox(box) {
  if (!box) return null;
  for (const area of TRANSIT_DARK_AREAS) {
    if (boxesIntersect(area.bbox, box)) return area;
  }
  return null;
}

/**
 * The showcase nearest a viewport centre, for "try here instead".
 *
 * Nearest rather than largest: offering Bordeaux to a camera over Lille is a
 * worse suggestion than offering Rouen, even though Bordeaux has more buses.
 * Distance is a flat lat/lon metric — over France the error is irrelevant and
 * the alternative is dragging a geodesic into a pure lookup table.
 */
export function nearestShowcase(box) {
  if (!box) return TRANSIT_SHOWCASES[0];
  const lat = (box.south + box.north) / 2;
  const lon = (box.west + box.east) / 2;
  let best = TRANSIT_SHOWCASES[0];
  let bestDistance = Infinity;
  for (const showcase of TRANSIT_SHOWCASES) {
    const dLat = showcase.lat - lat;
    const dLon = (showcase.lon - lon) * Math.cos((lat * Math.PI) / 180);
    const distance = dLat * dLat + dLon * dLon;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = showcase;
    }
  }
  return best;
}

/**
 * The honest one-line explanation for an empty viewport.
 *
 * Only produced when the layer found NO feed covering the view. A viewport
 * that matched feeds which happen to be quiet is a different sentence — the
 * buses exist, they are parked — and this function returns null for it so the
 * caller keeps its own wording.
 *
 * @param {?{south:number, west:number, north:number, east:number}} box Viewport.
 * @param {Object} [options]
 * @param {number} [options.feedsMatched] Feeds the proxy found for this box.
 * @returns {?{text: string, area: ?Object, showcase: Object}}
 */
export function transitCoverageNotice(box, { feedsMatched = 0 } = {}) {
  if (feedsMatched > 0) return null;
  const showcase = nearestShowcase(box);
  const area = darkAreaForBox(box);
  if (area) {
    return {
      area,
      showcase,
      text: `${area.operator} ${area.reason} — try ${showcase.name} (${showcase.vehicles} live)`,
    };
  }
  return {
    area: null,
    showcase,
    text: `no operator publishes live positions here — try ${showcase.name} (${showcase.vehicles} live)`,
  };
}

/** Whether a point sits inside a dark area — used by the coverage tests. */
export function darkAreaAt(lat, lon) {
  for (const area of TRANSIT_DARK_AREAS) {
    if (boxContains(area.bbox, lat, lon)) return area;
  }
  return null;
}
