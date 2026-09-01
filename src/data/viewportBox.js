/**
 * @module viewportBox
 *
 * Axis-aligned lat/lon box geometry shared by the viewport-driven data
 * sources — the French transit feeds (`panFeeds.js`), the French shared-
 * mobility feeds (`gbfsFeeds.js`), the cadastre (`cadastreFeed.js`) and the
 * Géoportail de l'urbanisme (`gpuFeed.js`).
 *
 * These sources answer the same shape of question: *"which upstream feeds
 * intersect what the camera is looking at, and how much of each is on
 * screen?"* The rules for validating a request box, snapping it onto a shared
 * cache grid, and scoring overlap are identical; only the ceilings and grid
 * steps differ, so those stay with each caller as its own constants.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/**
 * Validate a request box: finite, ordered, non-dateline, and no wider than
 * `maxDeg` on either axis.
 *
 * A box that fails is returned as null rather than repaired. A caller asking
 * for half a continent wants a different answer, not a quietly cropped one.
 *
 * @param {{south:*, west:*, north:*, east:*}} box
 * @param {number} maxDeg Largest span accepted on either axis.
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function validBox(box, maxDeg) {
  const south = Number(box?.south);
  const west = Number(box?.west);
  const north = Number(box?.north);
  const east = Number(box?.east);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  if (south >= north || west >= east) return null;
  if (north - south > maxDeg || east - west > maxDeg) return null;
  return { south, west, north, east };
}

/**
 * Snap a request box OUTWARD onto a shared cache grid, so panning a few
 * streets re-uses the cached answer and a cached answer always covers at least
 * what was asked for.
 *
 * Rounding the ratio first matters: a value a hair under an exact grid line in
 * binary floating point would otherwise snap a whole cell too far.
 *
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} stepDeg Grid step.
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function snapBoxOutward(box, stepDeg) {
  const snap = (value, grow) => {
    const cells = Number((value / stepDeg).toFixed(9));
    return Number(((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * stepDeg).toFixed(6));
  };
  return {
    south: Math.max(-90, snap(box.south, -1)),
    west: Math.max(-180, snap(box.west, -1)),
    north: Math.min(90, snap(box.north, 1)),
    east: Math.min(180, snap(box.east, 1)),
  };
}

/** Stable cache key for a snapped box, at the precision the query itself uses. */
export function boxKey(box, decimals = 3) {
  return [box.south, box.west, box.north, box.east]
    .map((value) => Number(value).toFixed(decimals))
    .join(',');
}

/**
 * Whether a box is wider than a ceiling on either axis.
 * @param {?{south:number, west:number, north:number, east:number}} box
 * @param {number} maxDeg
 * @returns {boolean} True for a missing box: nothing to draw is not a fit.
 */
export function boxTooWide(box, maxDeg) {
  if (!box) return true;
  return (box.north - box.south) > maxDeg || (box.east - box.west) > maxDeg;
}

/**
 * The box to actually request: what the operator is looking AT, bounded.
 *
 * Two inputs, and neither is sufficient alone. The view rectangle knows what is
 * on screen, but on a TILTED camera it reaches the horizon — far more ground
 * than a per-viewport API will answer for, and far more than carries a legible
 * feature. The focus point — where the middle of the screen meets the globe —
 * knows WHERE the operator is looking but nothing about how much of it fits.
 *
 * So: a `maxDeg` box centred on the focus point, clipped to the view. Under a
 * nadir camera at low altitude the view is the smaller of the two and the
 * result IS the view, so nothing is requested that is not on screen. Under a
 * strong tilt the result is the near and middle ground around the point being
 * looked at, and the far half of the screen — where the feature is well under
 * a pixel anyway — is simply not asked for.
 *
 * Lifted here from `cadastreFeed.js`, which learned it from a bug report, when
 * the urbanism layer needed the same box for the same reason. The two callers
 * keep their own ceilings; only the arithmetic is shared.
 *
 * @param {?{south:number, west:number, north:number, east:number}} view
 * @param {?{lat:number, lon:number}} focus Screen-centre point on the globe.
 * @param {number} maxDeg
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function focusedViewBox(view, focus, maxDeg) {
  if (!view) return null;
  const lat = Number(focus?.lat);
  const lon = Number(focus?.lon);
  // No focus point at all — the middle of the screen is sky. The view is then
  // the only thing known, and it is used only if it already fits.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return boxTooWide(view, maxDeg) ? null : { ...view };
  }
  const half = maxDeg / 2;
  const box = {
    south: Math.max(view.south, lat - half),
    north: Math.min(view.north, lat + half),
    west: Math.max(view.west, lon - half),
    east: Math.min(view.east, lon + half),
  };
  // A focus point outside its own view rectangle is possible for a degenerate
  // camera; an inverted box is not a small request, it is a broken one.
  if (box.south >= box.north || box.west >= box.east) return null;
  return box;
}

/** Grow a box by a margin in degrees, clamped to the globe. */
export function padBox(box, marginDeg) {
  const margin = Number(marginDeg) || 0;
  return {
    south: Math.max(-90, box.south - margin),
    west: Math.max(-180, box.west - margin),
    north: Math.min(90, box.north + margin),
    east: Math.min(180, box.east + margin),
  };
}

/** Whether two axis-aligned boxes share any area (edge contact counts). */
export function boxesIntersect(a, b) {
  if (!a || !b) return false;
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

/** Whether a point falls inside a box. */
export function boxContains(box, lat, lon) {
  if (!box) return false;
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/** Degree-squared area of the intersection of two boxes (0 when disjoint). */
export function boxOverlapArea(a, b) {
  if (!boxesIntersect(a, b)) return 0;
  const lat = Math.min(a.north, b.north) - Math.max(a.south, b.south);
  const lon = Math.min(a.east, b.east) - Math.max(a.west, b.west);
  return Math.max(0, lat) * Math.max(0, lon);
}

/** Degree-squared area of a box, floored so it can safely divide. */
export function boxArea(box) {
  if (!box) return 0;
  return Math.max(0, box.north - box.south) * Math.max(0, box.east - box.west);
}

/**
 * Merge freshly observed bounds into a stored footprint.
 *
 * Bounds only ever GROW: a rush-hour probe sees more of a network than a
 * Sunday-night one, and shrinking the box on a quiet sample would make a feed
 * drop out of viewports it genuinely serves.
 *
 * @param {?{south:number, west:number, north:number, east:number}} current
 * @param {?{south:number, west:number, north:number, east:number}} observed
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function mergeBounds(current, observed) {
  if (!observed) return current || null;
  if (!current) return { ...observed };
  return {
    south: Math.min(current.south, observed.south),
    west: Math.min(current.west, observed.west),
    north: Math.max(current.north, observed.north),
    east: Math.max(current.east, observed.east),
  };
}

/** Linear-interpolated quantile of a pre-sorted numeric array. */
function quantile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Default Tukey multiplier for the far-out fence used by observed bounds. */
export const BOUNDS_FENCE_K = 3;
/**
 * Floor on the fence half-width, in degrees (~22 km). A compact city network
 * has a near-zero interquartile range, and a pure IQR fence would then reject
 * its own outer suburbs as outliers.
 */
export const BOUNDS_MIN_FENCE_DEG = 0.2;
/** Below this many points there is no distribution to reason about — keep all. */
export const BOUNDS_MIN_SAMPLES = 8;

/**
 * Axis-aligned bounds of a point set, rounded to ~10 m.
 *
 * `rejectOutliers` matters whenever the bounds become a FOOTPRINT that decides
 * which feeds a viewport pulls. Real feeds emit occasional junk fixes — a bus
 * reported in the Algerian Sahara, a Villefranche-sur-Saône scooter reported
 * over Nantes — and one such fix inflates a city-sized box into a country-sized
 * one that then matches viewports the system does not serve. The filter is a
 * Tukey far-out fence per axis with a floor, so a genuinely spread-out network
 * keeps its real extent. Off by default: measuring a footprint wants it,
 * drawing what a feed said does not.
 *
 * @param {Array<{lat:number, lon:number}>} points
 * @param {Object} [options]
 * @param {boolean} [options.rejectOutliers=false]
 * @param {number} [options.fenceK]
 * @param {number} [options.minFenceDeg]
 * @param {number} [options.minSamples]
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function boundsOfPoints(points, options = {}) {
  const {
    rejectOutliers = false,
    fenceK = BOUNDS_FENCE_K,
    minFenceDeg = BOUNDS_MIN_FENCE_DEG,
    minSamples = BOUNDS_MIN_SAMPLES,
  } = options;

  const lats = [];
  const lons = [];
  for (const point of points || []) {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    lats.push(lat);
    lons.push(lon);
  }
  if (!lats.length) return null;

  let keep = null;
  if (rejectOutliers && lats.length >= minSamples) {
    const fence = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const span = Math.max(fenceK * (q3 - q1), minFenceDeg);
      return { low: q1 - span, high: q3 + span };
    };
    const latFence = fence(lats);
    const lonFence = fence(lons);
    keep = [];
    for (let i = 0; i < lats.length; i++) {
      if (lats[i] < latFence.low || lats[i] > latFence.high) continue;
      if (lons[i] < lonFence.low || lons[i] > lonFence.high) continue;
      keep.push(i);
    }
    if (!keep.length) keep = null;
  }

  const indices = keep || lats.map((_, i) => i);
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const i of indices) {
    if (lats[i] < south) south = lats[i];
    if (lats[i] > north) north = lats[i];
    if (lons[i] < west) west = lons[i];
    if (lons[i] > east) east = lons[i];
  }
  const round = (value) => Number(value.toFixed(4));
  return { south: round(south), west: round(west), north: round(north), east: round(east) };
}
