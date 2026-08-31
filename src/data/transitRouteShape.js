/**
 * @module transitRouteShape
 *
 * Pure geometry for "what line is this vehicle on, and where does it go" —
 * the indexing of a PAN GeoJSON conversion into a compact per-network
 * structure, and the arithmetic that decides WHICH of a line's published
 * traces the selected vehicle's trip is actually running.
 *
 * WHY A CONVERSION AND NOT `shapes.txt`. A line's trace lives in the static
 * GTFS, and `shapes.txt` is the largest member of a French archive by a wide
 * margin — 36 MB compressed for Normandy, measured 2026-08-31. The PAN
 * converts every archive it hosts to GeoJSON and serves the result from a CDN
 * with `shapes.txt` already joined to `routes.txt`, so one 13 MB fetch (0.6 s
 * for Bordeaux) yields every line's geometry, its public name and its own
 * colour, plus every stop point keyed by `stop_id`. That is what this module
 * indexes.
 *
 * WHICH TRACE A TRIP IS RUNNING IS MEASURED, NOT GUESSED. A French bus line
 * publishes several shape variants — Bordeaux's line 07 has six, of 1 611 to
 * 1 870 points — and the conversion does not say which trip uses which: it
 * carries `route_id` and drops `shape_id` and `trips.txt` with it. So the
 * choice is made against evidence the feed does publish: the trip's own
 * ordered stops, from its TripUpdate. The variant on which every one of those
 * stops lies is the one the vehicle is running, and how far off the worst stop
 * falls is returned with it. When no variant holds the stops within
 * {@link SHAPE_MATCH_MAX_M}, nothing is chosen and every variant is offered —
 * "this is the line" is a weaker claim than "this is the run", and drawing the
 * weaker one is better than asserting the stronger one wrongly.
 *
 * Dependency-light and side-effect-free (no Cesium, no DOM, no fs) so it runs
 * identically in the dev-server proxy, in the browser and under `node --test`.
 */

/** Metres per degree of latitude — the WGS84 mean, good to ~0.1% in France. */
const METRES_PER_DEGREE = 111_320;

/**
 * How far a trip's worst stop may sit from a shape variant for that variant to
 * count as the one the trip is running, in metres.
 *
 * 120 m is above the widest French stop-to-shape offset that is still the same
 * run — a stop point recorded on the pavement of a dual carriageway whose
 * shape follows the far lane, or a terminus recorded at the station entrance
 * rather than the bus bay — and well below the distance to a genuinely
 * different branch of the same line.
 */
export const SHAPE_MATCH_MAX_M = 120;

/**
 * Douglas–Peucker tolerance applied to every trace, in metres.
 *
 * The traces are drawn on streets, under a camera that has to be below 300 km
 * for the vehicle to exist on screen at all, so 2 m of chord error is
 * invisible. It is applied because the raw geometry is not: Bordeaux's 532
 * traces carry ~500 000 points, and the same network's index after
 * simplification is a third of that.
 */
export const SHAPE_SIMPLIFY_M = 2;

/** Coordinate precision kept in the index; 6 decimals is ~0.11 m of latitude. */
const COORD_DECIMALS = 6;

/**
 * Parse a GTFS colour into a CSS hex string.
 *
 * The PAN's converter emits `rgb(0,177,235)`; raw GTFS `route_color` is a bare
 * six-digit hex with no `#`. Both are accepted, and anything else returns null
 * rather than a default colour — a line whose operator published no colour
 * should be drawn in the layer's own tint, not in an invented one.
 *
 * @param {*} value Raw `route_color` / `route_text_color`.
 * @returns {?string} `#rrggbb`, or null.
 */
export function gtfsColorToCss(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) {
    const parts = [rgb[1], rgb[2], rgb[3]].map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return null;
    return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }
  const hex = raw.replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex.toLowerCase().split('').map((part) => part + part).join('')}`;
  }
  return null;
}

/** Great-circle distance between two `[lon, lat]` pairs, in metres. */
export function haversineMeters(a, b) {
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLat = lat2 - lat1;
  const dLon = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Local planar scale for a latitude: how many metres one degree of longitude
 * is worth there. Every distance below is computed in this frame, which is
 * exact enough over a city and turns trigonometry into arithmetic.
 */
function lonScale(latitudeDeg) {
  return METRES_PER_DEGREE * Math.cos(latitudeDeg * (Math.PI / 180));
}

/** Squared distance (m²) from point `p` to segment `a`–`b`, in a local frame. */
function segmentDistanceSqM(p, a, b, kx) {
  const px = p[0] * kx;
  const py = p[1] * METRES_PER_DEGREE;
  const ax = a[0] * kx;
  const ay = a[1] * METRES_PER_DEGREE;
  const bx = b[0] * kx;
  const by = b[1] * METRES_PER_DEGREE;
  const dx = bx - ax;
  const dy = by - ay;
  let t = 0;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
  }
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/**
 * Shortest distance from a point to a polyline, in metres.
 *
 * @param {[number, number]} point `[lon, lat]`.
 * @param {Array<[number, number]>} path `[lon, lat]` vertices.
 * @returns {number} Metres; `Infinity` for an empty path.
 */
export function distanceToPathMeters(point, path) {
  if (!Array.isArray(path) || path.length === 0) return Infinity;
  const kx = lonScale(point[1]);
  if (path.length === 1) return Math.sqrt(segmentDistanceSqM(point, path[0], path[0], kx));
  let best = Infinity;
  for (let i = 1; i < path.length; i += 1) {
    const distanceSq = segmentDistanceSqM(point, path[i - 1], path[i], kx);
    if (distanceSq < best) best = distanceSq;
  }
  return Math.sqrt(best);
}

/**
 * Douglas–Peucker simplification of a `[lon, lat]` path, with the tolerance in
 * METRES rather than degrees — a degree of longitude is 111 km at the equator
 * and 79 km in Bordeaux, and a tolerance expressed in degrees silently
 * simplifies northern France harder than the south.
 *
 * Iterative rather than recursive: a French `shapes.txt` trace runs to tens of
 * thousands of points, and the recursive form blows the stack on the worst of
 * them.
 *
 * @param {Array<[number, number]>} path
 * @param {number} [toleranceM]
 * @returns {Array<[number, number]>} A path with the same endpoints.
 */
export function simplifyPath(path, toleranceM = SHAPE_SIMPLIFY_M) {
  const points = Array.isArray(path) ? path : [];
  if (points.length <= 2 || !(toleranceM > 0)) return points.slice();
  const kx = lonScale(points[0][1]);
  const toleranceSq = toleranceM * toleranceM;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    let worst = -1;
    let worstDistanceSq = 0;
    for (let i = first + 1; i < last; i += 1) {
      const distanceSq = segmentDistanceSqM(points[i], points[first], points[last], kx);
      if (distanceSq > worstDistanceSq) {
        worstDistanceSq = distanceSq;
        worst = i;
      }
    }
    if (worst < 0 || worstDistanceSq <= toleranceSq) continue;
    keep[worst] = 1;
    stack.push([first, worst], [worst, last]);
  }

  const out = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(points[i]);
  return out;
}

/** Round a coordinate pair to the index's stored precision. */
function roundCoordinate(coordinate) {
  return [
    Number(coordinate[0].toFixed(COORD_DECIMALS)),
    Number(coordinate[1].toFixed(COORD_DECIMALS)),
  ];
}

/** Whether a raw GeoJSON coordinate pair is a usable `[lon, lat]` on Earth. */
function usableCoordinate(coordinate) {
  return Array.isArray(coordinate)
    && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1])
    && coordinate[0] >= -180 && coordinate[0] <= 180
    && coordinate[1] >= -90 && coordinate[1] <= 90
    // Null Island is where a converter puts a shape point it could not read.
    && !(coordinate[0] === 0 && coordinate[1] === 0);
}

/** Every `[lon, lat]` ring a LineString / MultiLineString geometry carries. */
function pathsOfGeometry(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
  return [];
}

/**
 * Index one PAN GeoJSON conversion into the compact structure the proxy
 * caches and serves slices of.
 *
 * Shape of the result — deliberately arrays rather than objects per record,
 * because a network like Bordeaux contributes 532 traces and 7 385 stops and
 * the difference between the two encodings is megabytes on disk:
 *
 *   routes: { [routeId]: { shortName, longName, color, textColor,
 *                          shapes: [ [[lon,lat], …], … ] } }
 *   stops:  { [stopId]:  [lon, lat, name, code|null] }
 *
 * @param {Object} document Parsed GeoJSON FeatureCollection.
 * @param {Object} [options]
 * @param {number} [options.simplifyM] Tolerance forwarded to {@link simplifyPath}.
 * @returns {{routes: Object, stops: Object, stats: Object}}
 */
export function indexGtfsGeoJson(document, { simplifyM = SHAPE_SIMPLIFY_M } = {}) {
  const routes = {};
  const stops = {};
  let rawPoints = 0;
  let keptPoints = 0;
  let shapeCount = 0;

  for (const feature of Array.isArray(document?.features) ? document.features : []) {
    const properties = feature?.properties || {};
    const geometry = feature?.geometry;

    if (geometry?.type === 'Point') {
      const id = String(properties.id ?? '').trim();
      if (!id || !usableCoordinate(geometry.coordinates)) continue;
      const [lon, lat] = roundCoordinate(geometry.coordinates);
      const name = String(properties.name ?? '').trim();
      const code = String(properties.code ?? '').trim();
      stops[id] = [lon, lat, name, code && code !== name ? code : null];
      continue;
    }

    const paths = pathsOfGeometry(geometry);
    if (!paths.length) continue;
    const routeId = String(properties.route_id ?? '').trim();
    if (!routeId) continue;

    let route = routes[routeId];
    if (!route) {
      route = {
        shortName: String(properties.route_short_name ?? '').trim() || null,
        longName: String(properties.route_long_name ?? '').trim() || null,
        color: gtfsColorToCss(properties.route_color),
        textColor: gtfsColorToCss(properties.route_text_color),
        shapes: [],
      };
      routes[routeId] = route;
    }

    for (const path of paths) {
      const cleaned = (Array.isArray(path) ? path : []).filter(usableCoordinate);
      if (cleaned.length < 2) continue;
      rawPoints += cleaned.length;
      const simplified = simplifyPath(cleaned, simplifyM).map(roundCoordinate);
      keptPoints += simplified.length;
      shapeCount += 1;
      route.shapes.push(simplified);
    }
  }

  return {
    routes,
    stops,
    stats: {
      routeCount: Object.keys(routes).length,
      stopCount: Object.keys(stops).length,
      shapeCount,
      rawPoints,
      keptPoints,
    },
  };
}

/**
 * Decide which of a line's traces the given stops are running on.
 *
 * Scored by the WORST stop, not the average: a variant that carries 33 of a
 * trip's 34 stops and misses the 34th by a kilometre is a different branch of
 * the line, and an average would hide that behind 33 good matches.
 *
 * @param {Array<Array<[number, number]>>} shapes The line's published traces.
 * @param {Array<[number, number]>} points The trip's stop coordinates, in order.
 * @param {Object} [options]
 * @param {number} [options.maxDeviationM] Ceiling for a match.
 * @returns {{index: ?number, maxDeviationM: ?number, medianDeviationM: ?number}}
 *   `index` is null when nothing holds every stop within the ceiling.
 */
export function chooseTripShape(shapes, points, { maxDeviationM = SHAPE_MATCH_MAX_M } = {}) {
  const traces = Array.isArray(shapes) ? shapes : [];
  const stops = (Array.isArray(points) ? points : []).filter(usableCoordinate);
  if (!traces.length || !stops.length) {
    return { index: null, maxDeviationM: null, medianDeviationM: null };
  }

  let best = null;
  for (let i = 0; i < traces.length; i += 1) {
    const deviations = stops.map((stop) => distanceToPathMeters(stop, traces[i]));
    const worst = Math.max(...deviations);
    if (best && worst >= best.worst) continue;
    const sorted = [...deviations].sort((a, b) => a - b);
    best = { index: i, worst, median: sorted[Math.floor(sorted.length / 2)] };
  }

  if (!best || !(best.worst <= maxDeviationM)) {
    return {
      index: null,
      maxDeviationM: best ? Math.round(best.worst) : null,
      medianDeviationM: best ? Math.round(best.median) : null,
    };
  }
  return {
    index: best.index,
    maxDeviationM: Math.round(best.worst),
    medianDeviationM: Math.round(best.median),
  };
}

/**
 * Total ground length of a path, in metres. Printed on the panel so "the line"
 * has a size a reader can hold, and used by nothing else.
 *
 * @param {Array<[number, number]>} path
 * @returns {number}
 */
export function pathLengthMeters(path) {
  const points = Array.isArray(path) ? path : [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineMeters(points[i - 1], points[i]);
  return total;
}
