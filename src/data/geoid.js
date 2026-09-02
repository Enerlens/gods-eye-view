// src/data/geoid.js — bundled EGM96 geoid-undulation lookup.
//
// h = H + N: the globe (Cesium ellipsoid) needs ELLIPSOIDAL height (h);
// most real-world elevation sources (barometric altitude, MSL survey data,
// Caltrans/TfL camera priors) give ORTHOMETRIC height (H, "height above mean
// sea level"). N is the local geoid undulation — the gap between the WGS84
// ellipsoid and the geoid (~mean sea level) surface, ranging roughly
// -106..+85 m worldwide. See docs/CURRENT-STATE.md.
//
// The implementation uses `egm96-universal` (npm, MIT, embeds the NGA
// EGM96 15' grid) as a lazy dynamic import so its ~2.7 MB grid data-chunk
// never lands in the eager Vite bundle. Only fall back to vendoring the NGA
// grid ourselves if the package fails tests, isn't browser-safe, or bloats
// the eager bundle. It passed the browser-safety, accuracy, and bundle checks,
// so this file is a thin wrapper around it — no vendored fallback is needed.
//
// egm96-universal's `meanSeaLevel(lat, lon)` already returns exactly N in
// metres (relative to WGS84 ellipsoid) with internal longitude
// normalization (wraps to [-180, 180) before the grid lookup), so no extra
// wrap/interpolation logic is needed here.

let egm96Module = null;
let readyPromise = null;

/**
 * Lazily loads the EGM96 grid (dynamic import — code-split by Vite so the
 * ~2.7 MB grid data stays out of the eager main bundle). Safe to call many
 * times; the underlying import only happens once and subsequent calls
 * resolve immediately from the cached promise.
 * @returns {Promise<void>}
 */
export async function ensureGeoidReady() {
  if (!readyPromise) {
    readyPromise = import('egm96-universal').then((mod) => {
      egm96Module = mod;
    });
  }
  return readyPromise;
}

/**
 * Geoid undulation N at a given point, in metres, relative to the WGS84
 * ellipsoid (positive = geoid above ellipsoid). Throws if
 * `ensureGeoidReady()` has not resolved yet.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {number}
 */
export function geoidHeight(latDeg, lonDeg) {
  if (!egm96Module) {
    throw new Error(
      'geoid.js: geoidHeight() called before ensureGeoidReady() resolved — ' +
        'await ensureGeoidReady() first.'
    );
  }
  return egm96Module.meanSeaLevel(latDeg, lonDeg);
}

/**
 * Converts an orthometric (mean-sea-level) height to an ellipsoidal
 * (WGS84 globe-relative) height: h = H + N.
 * @param {number} hMslM - orthometric height in metres (height above MSL)
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {number} ellipsoidal height in metres
 */
export function orthometricToEllipsoidal(hMslM, latDeg, lonDeg) {
  return hMslM + geoidHeight(latDeg, lonDeg);
}

/**
 * READOUT-ONLY inverse of {@link orthometricToEllipsoidal}: H = h - N.
 *
 * Cesium reports camera and entity heights against the WGS84 ELLIPSOID, but a
 * viewer reads "ALT" as height above mean sea level — so over San Francisco
 * (N ≈ -32 m) a camera sitting 17 m above the SFO deck reports a startling
 * -15 m until the undulation is taken back out.
 *
 * Takes N as an argument instead of calling {@link geoidHeight} itself, so it
 * stays a pure function a display surface can call every tick against a cached
 * cell, and so it degrades safely: a non-finite N (grid still loading, or the
 * lazy import failed) returns the UNCORRECTED height rather than NaN — a
 * readout that is ~30 m off for a beat beats a readout that blanks.
 *
 * This converts the DATUM of a height that is ALREADY ellipsoidal. It must
 * never be applied to a barometric/aviation altitude: those are MSL-referenced
 * already, and subtracting N there would introduce the very error it removes
 * here, sign-flipped.
 *
 * @param {number} hEllipsoidalM - height above the WGS84 ellipsoid, in metres
 * @param {number|null|undefined} geoidUndulationM - N at that point, in metres
 * @returns {number} height above MSL in metres, or the input when N is unknown
 */
export function ellipsoidalToMslDisplayM(hEllipsoidalM, geoidUndulationM) {
  if (!Number.isFinite(hEllipsoidalM)) return hEllipsoidalM;
  if (!Number.isFinite(geoidUndulationM)) return hEllipsoidalM;
  return hEllipsoidalM - geoidUndulationM;
}

// ── One value at a time, without the grid ───────────────────────────────────
//
// The grid above is 2.77 MB (1.77 MB over the wire) and six layer modules
// genuinely need it in-process — flights, militaryFlights, aisLiveVessels,
// bdtopoBuildings, terrainHeights and ignBilTerrain. The heaviest of them,
// ignBilTerrain, does thousands of SYNCHRONOUS lookups per terrain tile, which
// no network can serve. What they have in common is that none of them exists
// until its layer is switched on — which is exactly when paying for the grid
// is honest.
//
// The other consumer is a readout. The HUD's ALT line wants ONE undulation,
// memoized per coarse cell, refreshed as the camera drifts — and asking for it
// used to drag the whole grid into every visitor's cold boot, because the HUD
// is visible by default. `/api/geoid` answers that question from the same
// package, server-side, so the number is bit-for-bit the one the browser would
// have computed and the visitor pays ~50 bytes for it instead of 1.77 MB.
//
// The failure mode is deliberately the one this module already had: an
// unreachable endpoint resolves to `null`, `ellipsoidalToMslDisplayM` passes
// the raw ellipsoidal height through, and the readout is uncorrected rather
// than wrong or blank.

/**
 * Cell size (degrees) the remote lookup quantizes to. Matches the HUD's own
 * memo granularity: N moves by well under a metre across 0.01° (~1.1 km), and
 * quantizing keeps the URL space small enough for a cache to hold — the
 * response is `immutable`, so a cell asked for once need never be asked again.
 */
export const GEOID_CELL_DEG = 0.01;

/** Bound on the per-session cell cache; a session crosses far fewer. */
const REMOTE_CACHE_MAX = 512;
/** @type {Map<string, number>} cell key -> N in metres. */
const remoteCache = new Map();
/** @type {Map<string, Promise<number|null>>} single-flight per cell. */
const remoteInflight = new Map();

/**
 * The cell a point falls in, as the canonical key AND the representative
 * coordinates the endpoint is asked about. Two points in the same cell produce
 * the same key, so they share one request and one cached answer.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {{key: string, lat: number, lon: number}}
 */
export function geoidCell(latDeg, lonDeg) {
  const lat = Math.round(latDeg / GEOID_CELL_DEG) * GEOID_CELL_DEG;
  const lon = Math.round(lonDeg / GEOID_CELL_DEG) * GEOID_CELL_DEG;
  // Fixed precision, so 0.30000000000000004 and 0.3 are never two cells.
  const key = `${lat.toFixed(2)}:${lon.toFixed(2)}`;
  return { key, lat: Number(lat.toFixed(2)), lon: Number(lon.toFixed(2)) };
}

/**
 * N at a point's cell, if it is already known to this session. Synchronous and
 * side-effect free, so a readout can call it every tick.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {number|null} N in metres, or null when the cell is not cached yet.
 */
export function cachedGeoidHeight(latDeg, lonDeg) {
  const { key } = geoidCell(latDeg, lonDeg);
  return remoteCache.has(key) ? remoteCache.get(key) : null;
}

/**
 * Fetch N for a point's cell, once. Concurrent callers for the same cell share
 * one request, and a resolved cell is never requested again.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @param {(input: string) => Promise<Response>} [fetchImpl] Test seam.
 * @returns {Promise<number|null>} N in metres, or null if it could not be had.
 */
export function fetchGeoidHeight(latDeg, lonDeg, fetchImpl) {
  const { key, lat, lon } = geoidCell(latDeg, lonDeg);
  if (remoteCache.has(key)) return Promise.resolve(remoteCache.get(key));
  const pending = remoteInflight.get(key);
  if (pending) return pending;

  const doFetch = fetchImpl || ((input) => fetch(input));
  const request = doFetch(`/api/geoid?lat=${lat}&lon=${lon}`)
    .then((response) => (response?.ok ? response.json() : null))
    .then((body) => {
      const n = Number(body?.n);
      if (!Number.isFinite(n)) return null;
      if (remoteCache.size >= REMOTE_CACHE_MAX) {
        remoteCache.delete(remoteCache.keys().next().value);
      }
      remoteCache.set(key, n);
      return n;
    })
    .catch(() => null)
    .finally(() => {
      if (remoteInflight.get(key) === request) remoteInflight.delete(key);
    });
  remoteInflight.set(key, request);
  return request;
}

/** Test seam: drop every cached and in-flight cell. */
export function _resetRemoteGeoidForTest() {
  remoteCache.clear();
  remoteInflight.clear();
}
