/**
 * @module roadStatusCoverage
 *
 * Where French live road status actually exists, measured — so the layer can
 * name the publisher and the reason instead of drawing an empty map.
 *
 * THE SHAPE OF THE HOLE, AND WHY IT IS THE EXACT COMPLEMENT OF THE OTHER ONE.
 * `transitCoverage.js` records that live transit is dark in Lyon, Marseille,
 * Toulouse and Lille and bright in Bordeaux, Rouen and Rennes. This layer is
 * the reciprocal: Marseille, Toulouse, Lyon and Saint-Étienne are among its
 * best-covered cities, and it is Paris that is black. The two layers together
 * cover most of urban France; neither does alone, and saying so is the point
 * of both of these modules.
 *
 * THREE DIFFERENT KINDS OF NOTHING, kept apart because they are not the same
 * statement and a viewer deserves to know which one they are looking at:
 *
 *   **No publisher.** Île-de-France. The DIRIF operates the densest urban
 *   motorway network in the country and appears in neither publication: zero
 *   counting stations in the national referential, zero agglomeration status
 *   feeds. Verified three ways on 2026-08-31 — the referential has no row
 *   inside the region's bounding box, `TRAFICOLOR-DIR` has no directory for
 *   it, and data.gouv.fr's only DIRIF dataset is a 2008–2011 count archive.
 *
 *   **State published, position withheld.** Lille, Nantes, Rennes,
 *   Saint-Brieuc, Lorient–Vannes, Nancy–Metz. These centres publish a live
 *   colour for hundreds of sites — 357 for Lille alone — under identifiers
 *   that either appear in no referential row (the four Breton feeds) or appear
 *   with every coordinate field empty (DIR Ouest's 117 stations, DIR Est's
 *   72). The traffic is measured, it is published, and nobody says where it
 *   is. Drawing nothing there is correct; implying nothing is happening there
 *   is not.
 *
 *   **Off the national network.** Everywhere else. This dataset covers the
 *   non-conceded RRN — motorways and trunk roads the State operates directly.
 *   A département road, a city street, and every kilometre of conceded
 *   motorway (Vinci, APRR, Sanef) are all outside it by definition.
 *
 * MAINTENANCE. Every figure here is a measurement with a date on it, and it
 * will age: a DIR that starts publishing coordinates moves a city from the
 * second list to the showcase list. `npm run road-status:index` re-measures,
 * and `roadStatusCoverage.test.mjs` checks this table against the built
 * `config/datex_traficolor_sites.json` so a city that has gained geometry
 * fails the build rather than staying wrongly dark.
 *
 * Dependency-free and side-effect-free.
 */
import { boxContains, boxesIntersect } from './viewportBox.js';

/** The date every figure in this module was measured. */
export const ROAD_STATUS_COVERAGE_MEASURED_AT = '2026-08-31';

/**
 * Areas where the layer draws nothing, and exactly why.
 *
 * `kind` separates the two failures: `no-publisher` means the state is not
 * measured, `no-geometry` means it is measured and published without a
 * position. `reason` is what the source says, not an interpretation.
 */
export const ROAD_STATUS_DARK_AREAS = Object.freeze([
  Object.freeze({
    id: 'idf',
    name: 'Île-de-France',
    operator: 'DIRIF',
    kind: 'no-publisher',
    reason: 'publishes neither counting stations nor a traffic-status feed',
    bbox: Object.freeze({ south: 48.55, west: 1.85, north: 49.15, east: 3.05 }),
  }),
  Object.freeze({
    id: 'lille',
    name: 'Lille',
    operator: 'DIR Nord',
    kind: 'no-geometry',
    sites: 357,
    reason: 'publishes 357 live road states under site ids that are in no national referential row',
    bbox: Object.freeze({ south: 50.45, west: 2.75, north: 50.85, east: 3.35 }),
  }),
  Object.freeze({
    id: 'nantes',
    name: 'Nantes',
    operator: 'DIR Ouest',
    kind: 'no-geometry',
    sites: 194,
    reason: 'publishes live road states, and 117 stations whose coordinate fields are all empty',
    bbox: Object.freeze({ south: 47.10, west: -1.75, north: 47.35, east: -1.35 }),
  }),
  Object.freeze({
    id: 'rennes',
    name: 'Rennes',
    operator: 'DIR Ouest',
    kind: 'no-geometry',
    sites: 177,
    reason: 'publishes live road states, and 117 stations whose coordinate fields are all empty',
    bbox: Object.freeze({ south: 48.00, west: -1.85, north: 48.20, east: -1.50 }),
  }),
  Object.freeze({
    id: 'saint-brieuc',
    name: 'Saint-Brieuc',
    operator: 'DIR Ouest',
    kind: 'no-geometry',
    sites: 91,
    reason: 'publishes live road states under site ids that are in no national referential row',
    bbox: Object.freeze({ south: 48.42, west: -2.90, north: 48.58, east: -2.65 }),
  }),
  Object.freeze({
    id: 'lorient-vannes',
    name: 'Lorient – Vannes',
    operator: 'DIR Ouest',
    kind: 'no-geometry',
    sites: 153,
    reason: 'publishes live road states under site ids that are in no national referential row',
    bbox: Object.freeze({ south: 47.60, west: -3.45, north: 47.85, east: -2.65 }),
  }),
  Object.freeze({
    id: 'nancy-metz',
    name: 'Nancy – Metz',
    operator: 'DIR Est',
    kind: 'no-geometry',
    sites: 74,
    reason: 'publishes live road states, and 72 stations whose coordinate fields are all empty',
    bbox: Object.freeze({ south: 48.60, west: 5.95, north: 49.25, east: 6.40 }),
  }),
]);

/**
 * Where the layer is at its best, with the drawable segment count measured on
 * {@link ROAD_STATUS_COVERAGE_MEASURED_AT}.
 *
 * `segments` is how many of that centre's published sites the referential can
 * actually place — not how many it publishes. Marseille leads because DIR
 * Méditerranée is the one DIR that geolocates 100% of its stations.
 */
export const ROAD_STATUS_SHOWCASES = Object.freeze([
  Object.freeze({
    id: 'marseille', name: 'Marseille', centre: 'MARIUS', lat: 43.2965, lon: 5.3698, segments: 186, cadenceS: 360,
  }),
  Object.freeze({
    id: 'bordeaux', name: 'Bordeaux', centre: 'ALIENOR', lat: 44.8378, lon: -0.5792, segments: 144, cadenceS: 60,
  }),
  Object.freeze({
    id: 'toulouse', name: 'Toulouse', centre: 'ERATO', lat: 43.6047, lon: 1.4442, segments: 127, cadenceS: 60,
  }),
  Object.freeze({
    id: 'lyon', name: 'Lyon', centre: 'Trafic Lyon', lat: 45.7640, lon: 4.8357, segments: 106, cadenceS: 60,
  }),
  Object.freeze({
    id: 'saint-etienne', name: 'Saint-Étienne', centre: 'HYRONDELLE', lat: 45.4397, lon: 4.3872, segments: 100, cadenceS: 360,
  }),
  Object.freeze({
    id: 'rouen', name: 'Rouen', centre: 'Trafic Rouen', lat: 49.4432, lon: 1.0999, segments: 62, cadenceS: 120,
  }),
  Object.freeze({
    id: 'limoges', name: 'Limoges', centre: 'Trafic Limoges', lat: 45.8336, lon: 1.2611, segments: 53, cadenceS: 60,
  }),
  Object.freeze({
    id: 'caen', name: 'Caen', centre: 'Trafic Caen', lat: 49.1829, lon: -0.3707, segments: 42, cadenceS: 120,
  }),
  Object.freeze({
    id: 'grenoble', name: 'Grenoble', centre: 'GENTIANE', lat: 45.1885, lon: 5.7245, segments: 13, cadenceS: 180,
  }),
]);

/** The dark area a viewport falls in, if any. */
export function roadStatusDarkArea(box) {
  if (!box) return null;
  for (const area of ROAD_STATUS_DARK_AREAS) {
    if (boxesIntersect(area.bbox, box)) return area;
  }
  return null;
}

/**
 * The showcase nearest a viewport centre, for "try here instead".
 *
 * Nearest rather than largest, on the same reasoning as the transit layer:
 * offering Marseille to a camera over Lille is a worse suggestion than
 * offering Rouen. Flat lat/lon metric — over France the error is irrelevant.
 */
export function nearestRoadStatusShowcase(box) {
  if (!box) return ROAD_STATUS_SHOWCASES[0];
  const lat = (box.south + box.north) / 2;
  const lon = (box.west + box.east) / 2;
  let best = ROAD_STATUS_SHOWCASES[0];
  let bestDistance = Infinity;
  for (const showcase of ROAD_STATUS_SHOWCASES) {
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
 * Only produced when the layer drew NOTHING. A viewport with segments in it is
 * not an empty state even if every one of them is free-flowing, and this
 * returns null for that case so the caller keeps its own wording.
 *
 * @param {?{south:number, west:number, north:number, east:number}} box Viewport.
 * @param {Object} [options]
 * @param {number} [options.segments] Segments the proxy returned for this box.
 * @returns {?{text: string, area: ?Object, showcase: Object}}
 */
export function roadStatusCoverageNotice(box, { segments = 0 } = {}) {
  if (segments > 0) return null;
  const showcase = nearestRoadStatusShowcase(box);
  const area = roadStatusDarkArea(box);
  if (area) {
    return {
      area,
      showcase,
      text: `${area.operator} ${area.reason} — try ${showcase.name} (${showcase.segments} segments)`,
    };
  }
  return {
    area: null,
    showcase,
    // The default case is not a failure: most of France is not a State-operated
    // motorway, and the sentence says that rather than blaming a publisher.
    text: `outside the State-operated national road network — try ${showcase.name} (${showcase.segments} segments)`,
  };
}

/** Whether a point sits inside a dark area — used by the coverage tests. */
export function roadStatusDarkAreaAt(lat, lon) {
  for (const area of ROAD_STATUS_DARK_AREAS) {
    if (boxContains(area.bbox, lat, lon)) return area;
  }
  return null;
}
