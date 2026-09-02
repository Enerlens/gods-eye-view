/**
 * @module franceDepartements
 *
 * Point-in-département lookup and choropleth binning, over the bundled
 * simplified IGN outlines in `local_data/france_departements/`.
 *
 * ── Why this file exists apart from its callers ─────────────────────────────
 * `irveDepartements.js` worked all of this out for the charge-point layer and
 * carries the measurements that justify the one number in it that is a
 * judgement call (the 2 km coastal snap — read that header, it is the
 * argument). None of the code is charge-point-specific: it indexes polygons,
 * resolves a coordinate to a code, snaps a near-miss to the nearest outline,
 * and cuts a set of per-département counts into quantile bins. The schools
 * layer needs precisely that, over the same polygons.
 *
 * So it lives here once. `irveDepartements.js` re-exports this surface under
 * the names its callers and its tests already use, and those tests staying
 * green is what proves the move was faithful.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/** Mean Earth radius (km), for the polygons' own spherical area. */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Default tolerance for snapping a point that fell outside every polygon, km.
 *
 * The bundled shapes are the SIMPLIFIED IGN outlines — 14 335 vertices for all
 * of France, so the whole of Corse-du-Sud is 152 points and the Gulf of
 * Ajaccio is cut straight across. Without a tolerance, real French points fall
 * in the sea. The value was set on the charge-point distribution, where 778 of
 * 886 sea-falling points were within 2 km of a boundary and the next ones were
 * genuinely in Belgium and Germany; `irveDepartements.js` records that
 * measurement in full. Callers may pass their own.
 */
export const DEFAULT_COAST_SNAP_KM = 2;

/**
 * Signed spherical area of one closed ring, in km².
 *
 * The polygons are simplified, so this is the area of the SHAPE THAT IS DRAWN
 * rather than the département's official area — which is the right one to
 * divide by, because it is what the reader is looking at.
 *
 * @param {Array<Array<number>>} ring `[lon, lat]` pairs.
 * @returns {number} Area in km², always positive.
 */
export function ringAreaKm2(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) continue;
    total += toRadians(lon2 - lon1)
      * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return Math.abs(total * EARTH_RADIUS_KM * EARTH_RADIUS_KM / 2);
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Axis-aligned bounds of a ring, as `[west, south, east, north]`. */
function ringBbox(ring) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of ring) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}

function bboxHas(bbox, lon, lat) {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/**
 * Even-odd ray cast against one ring.
 *
 * @param {number} lon
 * @param {number} lat
 * @param {Array<Array<number>>} ring
 * @returns {boolean}
 */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Index the bundled département polygons for repeated point lookups.
 *
 * Every part of a `MultiPolygon` keeps its own bbox: ten départements carry
 * islands, and a single bbox around Finistère plus Ouessant would admit a
 * large patch of sea as a candidate on every point tested.
 *
 * @param {object} geojson The bundled `departements.geojson`.
 * @returns {{list:Array<object>, byCode:Map<string,object>}}
 */
export function buildDepartementIndex(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  const list = [];
  for (const feature of features) {
    const code = String(feature?.properties?.code ?? '').trim();
    const geometry = feature?.geometry;
    if (!code || !geometry) continue;
    const polygons = geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);
    const parts = [];
    let areaKm2 = 0;
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) continue;
      const rings = polygon.filter((ring) => Array.isArray(ring) && ring.length >= 4);
      if (!rings.length) continue;
      parts.push({ rings, bbox: ringBbox(rings[0]) });
      areaKm2 += ringAreaKm2(rings[0]);
      for (const hole of rings.slice(1)) areaKm2 -= ringAreaKm2(hole);
    }
    if (!parts.length) continue;
    const bbox = [
      Math.min(...parts.map((part) => part.bbox[0])),
      Math.min(...parts.map((part) => part.bbox[1])),
      Math.max(...parts.map((part) => part.bbox[2])),
      Math.max(...parts.map((part) => part.bbox[3])),
    ];
    list.push({
      code,
      name: String(feature?.properties?.nom ?? '').trim() || code,
      parts,
      bbox,
      areaKm2: Math.max(0, areaKm2),
    });
  }
  list.sort((a, b) => a.code.localeCompare(b.code));
  return { list, byCode: new Map(list.map((entry) => [entry.code, entry])) };
}

/**
 * Every département whose outline intersects a view box.
 *
 * Bounding-box overlap only, deliberately: this decides which per-département
 * packs to FETCH, and asking for one département too many costs a cached
 * request while missing one leaves a hole in the map. The exact answer is what
 * {@link locateDepartement} is for.
 *
 * @param {{list:Array<object>}} index From `buildDepartementIndex`.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [limit] Hard cap on how many packs one view may ask for.
 * @returns {Array<string>}
 */
export function departementsInBox(index, box, limit = 6) {
  if (!box || ![box.south, box.west, box.north, box.east].every(Number.isFinite)) return [];
  const hits = [];
  for (const entry of index?.list || []) {
    const [west, south, east, north] = entry.bbox;
    if (east < box.west || west > box.east || north < box.south || south > box.north) continue;
    // Ranked by how much of the view each covers, so a capped list keeps the
    // départements the operator is actually looking at rather than the first
    // ones in code order.
    const overlapLon = Math.min(east, box.east) - Math.max(west, box.west);
    const overlapLat = Math.min(north, box.north) - Math.max(south, box.south);
    hits.push({ code: entry.code, area: Math.max(0, overlapLon) * Math.max(0, overlapLat) });
  }
  hits.sort((a, b) => b.area - a.area || a.code.localeCompare(b.code));
  return hits.slice(0, Math.max(1, Math.floor(limit))).map((entry) => entry.code);
}

/**
 * Resolve a coordinate to a département code.
 *
 * @param {{list:Array<object>}} index From `buildDepartementIndex`.
 * @param {number} lat
 * @param {number} lon
 * @returns {?string} INSEE code, or null when the point is outside all of them.
 */
export function locateDepartement(index, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const entry of index?.list || []) {
    if (!bboxHas(entry.bbox, lon, lat)) continue;
    for (const part of entry.parts) {
      if (!bboxHas(part.bbox, lon, lat)) continue;
      if (!pointInRing(lon, lat, part.rings[0])) continue;
      let inHole = false;
      for (let i = 1; i < part.rings.length; i += 1) {
        if (pointInRing(lon, lat, part.rings[i])) { inHole = true; break; }
      }
      if (!inHole) return entry.code;
    }
  }
  return null;
}

/** Local metres-per-degree, adequate over the few km this is used across. */
function degreeScale(lat) {
  return { kx: 111.320 * Math.cos((lat * Math.PI) / 180), ky: 110.574 };
}

/** Distance in km from a point to one great-circle-ish segment. */
function segmentDistanceKm(lat, lon, a, b) {
  const { kx, ky } = degreeScale(lat);
  const px = (lon - a[0]) * kx;
  const py = (lat - a[1]) * ky;
  const vx = (b[0] - a[0]) * kx;
  const vy = (b[1] - a[1]) * ky;
  const length = vx * vx + vy * vy;
  const t = length > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / length)) : 0;
  return Math.hypot(px - vx * t, py - vy * t);
}

/**
 * Nearest département to a point that is outside all of them, within a bound.
 *
 * Only ever called for a point that already missed every polygon, so the cost
 * is paid by the few hundred coastal rows in a national sweep rather than by
 * the tens of thousands that resolve directly.
 *
 * @param {{list:Array<object>}} index
 * @param {number} lat
 * @param {number} lon
 * @param {number} [maxKm]
 * @returns {?{code:string, km:number}} Null when nothing is close enough.
 */
export function nearestDepartementWithin(index, lat, lon, maxKm = DEFAULT_COAST_SNAP_KM) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const padDeg = maxKm / 100;
  let best = null;
  let bestKm = Infinity;
  for (const entry of index?.list || []) {
    if (lon < entry.bbox[0] - padDeg || lon > entry.bbox[2] + padDeg
      || lat < entry.bbox[1] - padDeg || lat > entry.bbox[3] + padDeg) continue;
    for (const part of entry.parts) {
      const ring = part.rings[0];
      for (let i = 0; i < ring.length - 1; i += 1) {
        const km = segmentDistanceKm(lat, lon, ring[i], ring[i + 1]);
        if (km < bestKm) {
          bestKm = km;
          best = entry.code;
        }
      }
    }
  }
  return best && bestKm <= maxKm ? { code: best, km: bestKm } : null;
}

/** Linear-interpolated quantile of a pre-sorted numeric array. */
function quantile(sorted, p) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Quantile thresholds for a choropleth ramp.
 *
 * Returns `binCount - 1` ascending upper bounds: a value at or below
 * `thresholds[i]` belongs to bin `i`, and anything above the last belongs to
 * the top bin. Départements with a count of zero are excluded from the
 * distribution — they are drawn as absence, not as the bottom of a scale.
 *
 * @param {Array<number>} counts
 * @param {number} binCount
 * @returns {Array<number>}
 */
export function countBins(counts, binCount) {
  const bins = Math.max(2, Math.floor(binCount));
  const sorted = (counts || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return new Array(bins - 1).fill(0);
  const thresholds = [];
  for (let i = 1; i < bins; i += 1) {
    thresholds.push(Math.round(quantile(sorted, i / bins)));
  }
  // Ties can collapse two thresholds onto one value, which would leave an
  // empty bin in the middle of the legend. Keeping them strictly ascending
  // costs nothing and keeps every legend row reachable.
  for (let i = 1; i < thresholds.length; i += 1) {
    if (thresholds[i] <= thresholds[i - 1]) thresholds[i] = thresholds[i - 1] + 1;
  }
  return thresholds;
}

/**
 * Bin index for one count.
 *
 * @param {number} count
 * @param {Array<number>} thresholds From `countBins`.
 * @returns {number} 0-based bin, or -1 for a département with nothing in it.
 */
export function countBin(count, thresholds) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return -1;
  const bounds = Array.isArray(thresholds) ? thresholds : [];
  for (let i = 0; i < bounds.length; i += 1) {
    if (value <= bounds[i]) return i;
  }
  return bounds.length;
}
