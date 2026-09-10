import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { tilesForBounds } from './tomtomTiles.js';

/**
 * @file TomTom traffic-flow vector-tile client: fetch + MVT decode.
 *
 * Fetches flow tiles from the local `/api/tomtom/flow/{z}/{x}/{y}.pbf` proxy
 * (the TomTom key never reaches the browser) and decodes the Mapbox Vector
 * Tile layer "Traffic flow" into plain lon/lat polylines with congestion
 * attributes. Consumed by the traffic layer's live mode
 * (`src/data/traffic.js` → `src/data/flowMatch.js`).
 *
 * Segment shape: `{coords: [[lon,lat],…], trafficLevel: 0..1, roadType: string,
 * closure: boolean}` — `trafficLevel` is TomTom's current/free-flow speed
 * ratio (1 = free flow). Features with a missing/non-finite `traffic_level`
 * are skipped unless `road_closure` is true (closures decode with level 0).
 *
 * Deps: `pbf@5` (PbfReader) + `@mapbox/vector-tile@3` — both tiny and
 * tree-shakeable; decoding happens client-side so the proxy stays a dumb
 * binary cache.
 *
 * @module data/flowTiles
 */

export { tilesForBounds };

/** @const {string} MVT layer name in TomTom flow tiles (verified live 2026-07-16). */
const FLOW_LAYER_NAME = 'Traffic flow';
/** @const {number} Ms — per-tile decode cache TTL (matches the proxy's 120 s tile TTL). */
const DECODE_CACHE_TTL_MS = 120_000;
/** @const {number} Max decoded tiles kept in memory before oldest-entry eviction. */
const DECODE_CACHE_MAX_ENTRIES = 64;
/**
 * @const {number} Ms to park tile requests after a 429 that carried no
 * `Retry-After`. Ten seconds is what the edge rule in front of the hosted
 * origin blocks for, so it is the shortest wait that is actually a wait.
 */
const COOLDOWN_DEFAULT_MS = 10_000;
/** @const {number} Ms — ceiling on any cooldown, however long we were asked to wait. */
const COOLDOWN_MAX_MS = 60_000;

/**
 * Decoded-tile cache keyed by "z/x/y".
 * @type {Map<string, {at:number, segments:Array}>}
 */
const _decodeCache = new Map();
/**
 * Tiles currently on the wire, keyed "z/x/y".
 *
 * The decode cache only records a tile once it has RESOLVED, so without this
 * the two callers a single load makes — the ribbon warm-up and the road
 * matcher — both missed and both fetched. That doubled the tile count on
 * every viewport, which the edge rate limit counts and the daily budget bills.
 * @type {Map<string, Promise<Array>>}
 */
const _inflight = new Map();
/** @type {number} Session count of tile requests issued to the proxy (decode-cache misses). */
let _tilesFetched = 0;
/** @type {number} Session count of duplicate requests that joined one in flight. */
let _tilesJoined = 0;
/** @type {number} Epoch ms until which a 429 asked us to stop asking. */
let _cooldownUntil = 0;
/** @type {?string} Why we are cooling down — 'budget' (ours) or 'edge' (in front of us). */
let _cooldownReason = null;

/**
 * Decode one TomTom flow tile (MVT protobuf) into flow segments.
 *
 * @param {Uint8Array|Buffer|ArrayBuffer} data - Raw .pbf tile bytes.
 * @param {number} z - Tile zoom (for tile-local → lon/lat projection).
 * @param {number} x - Tile column.
 * @param {number} y - Tile row.
 * @returns {Array<{coords:number[][], trafficLevel:number, roadType:string, closure:boolean}>}
 *   Flow polylines in [lon, lat] degrees. Returns [] for undecodable buffers
 *   or tiles without a "Traffic flow" layer (defensive — a corrupt tile must
 *   not kill the traffic layer).
 */
export function decodeFlowTile(data, z, x, y) {
  let layer;
  try {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const tile = new VectorTile(new PbfReader(bytes));
    layer = tile.layers[FLOW_LAYER_NAME];
  } catch {
    return [];
  }
  if (!layer) return [];

  const segments = [];
  for (let i = 0; i < layer.length; i++) {
    let feature;
    let geometry;
    try {
      feature = layer.feature(i);
      geometry = feature.toGeoJSON(x, y, z).geometry;
    } catch {
      continue; // one malformed feature must not drop the tile
    }
    const props = feature.properties || {};
    const closure = props.road_closure === true || props.road_closure === 'true';
    const rawLevel = props.traffic_level;
    const hasLevel = typeof rawLevel === 'number' && Number.isFinite(rawLevel);
    // Skip features we can't color — unless closed (closures render dot-free
    // regardless of level, so they stay useful without one).
    if (!hasLevel && !closure) continue;
    const trafficLevel = hasLevel ? Math.min(1, Math.max(0, rawLevel)) : 0;
    const roadType = typeof props.road_type === 'string' ? props.road_type : '';

    const lines = geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : [];
    for (const coords of lines) {
      if (!Array.isArray(coords) || coords.length < 2) continue;
      segments.push({ coords, trafficLevel, roadType, closure });
    }
  }
  return segments;
}

/** Insert into the decode cache with oldest-entry eviction. */
function cacheSet(key, entry) {
  if (!_decodeCache.has(key) && _decodeCache.size >= DECODE_CACHE_MAX_ENTRIES) {
    const oldest = _decodeCache.keys().next().value;
    _decodeCache.delete(oldest);
  }
  _decodeCache.set(key, entry);
}

/**
 * Milliseconds to wait, from a `Retry-After` header value.
 *
 * Accepts both forms the RFC allows — delta-seconds and an HTTP date — and
 * returns null for anything else, so a malformed header falls back to the
 * caller's default rather than parking the layer until NaN.
 *
 * @param {string|null|undefined} header - Raw `Retry-After` value.
 * @param {number} [nowMs=Date.now()] - Clock, injectable for tests.
 * @returns {number|null} Delay in ms, or null when unparseable.
 */
export function retryAfterMs(header, nowMs = Date.now()) {
  if (header === null || header === undefined || header === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(String(header));
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/**
 * Build the typed rejection a failed tile carries.
 *
 * `status` and `reason` are what let `deriveTrafficFlowError` tell a TomTom
 * bill from an edge throttle. The message keeps its original shape because the
 * layer's error copy has always parsed `HTTP nnn` out of it.
 *
 * @param {string} key - Tile key `z/x/y`.
 * @param {number} status - HTTP status.
 * @param {?string} [reason=null] - 'budget' | 'edge' | 'no_key' | null.
 * @returns {Error & {status:number, reason:?string}}
 */
export function flowTileError(key, status, reason = null) {
  const err = new Error(`flow tile ${key}: HTTP ${status}`);
  err.status = status;
  err.reason = reason;
  return err;
}

/** An AbortError shaped like the one a real `fetch` rejects with. */
function abortError() {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

/**
 * Tell OUR budget 429 from an edge 429.
 *
 * The proxy stamps `x-tomtom-limit: budget` on the one 429 it raises itself;
 * anything in front of it (Cloudflare answers `error code: 1015`) cannot. So
 * the absence of that header on a 429 means the request never reached the
 * origin — which is a throttle on US, not a bill from TomTom. The body regex
 * is only a fallback for an origin deployed before the header existed.
 *
 * @param {Response} res - The 429 response (body is consumed here).
 * @returns {Promise<'budget'|'edge'>}
 */
async function classifyThrottle(res) {
  if (res.headers?.get?.('x-tomtom-limit') === 'budget') return 'budget';
  let body = '';
  try { body = await res.text(); } catch { /* unreadable body — treat as edge */ }
  return /"error"\s*:\s*"budget"/.test(body) ? 'budget' : 'edge';
}

/** Park every tile request until `Retry-After` (or the edge's own 10 s) elapses. */
function startCooldown(res, reason) {
  const asked = retryAfterMs(res.headers?.get?.('retry-after'));
  const ms = Math.min(COOLDOWN_MAX_MS, asked === null ? COOLDOWN_DEFAULT_MS : asked);
  _cooldownUntil = Date.now() + ms;
  _cooldownReason = reason;
}

/** Turn a non-OK tile response into the typed error, arming the cooldown on 429. */
async function tileFailure(key, res) {
  if (res.status === 429) {
    const reason = await classifyThrottle(res);
    startCooldown(res, reason);
    return flowTileError(key, 429, reason);
  }
  return flowTileError(key, res.status, res.status === 503 ? 'no_key' : null);
}

/**
 * Fetch + decode ONE tile, and publish it to the decode cache.
 *
 * Deliberately signal-free. Two callers race for the same tiles on every load
 * (the ribbon warm-up and the road matcher), and a camera move aborts both —
 * but the tile is ≤ 40 KB and lands ~50 ms later, so letting it finish fills
 * the cache for the load that is already on its way instead of throwing the
 * work away. Callers still honour THEIR OWN abort through `raceAbort`.
 *
 * @param {string} key - Tile key `z/x/y`.
 * @param {number} z @param {number} x @param {number} y
 * @returns {Promise<Array>} Decoded segments.
 */
async function fetchTile(key, z, x, y) {
  _tilesFetched += 1;
  const res = await fetch(`/api/tomtom/flow/${z}/${x}/${y}.pbf`);
  if (!res.ok) throw await tileFailure(key, res);
  const segments = decodeFlowTile(await res.arrayBuffer(), z, x, y);
  cacheSet(key, { at: Date.now(), segments });
  return segments;
}

/**
 * Settle with `job`, or reject as soon as `signal` aborts — whichever is first.
 * The job itself is left running; see `fetchTile` for why.
 *
 * @param {Promise} job @param {AbortSignal} [signal]
 * @returns {Promise}
 */
function raceAbort(job, signal) {
  if (!signal) return job;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    job.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/**
 * Segments for one tile: fresh cache, then in-flight join, then the network.
 *
 * @param {number} z @param {number} x @param {number} y
 * @param {AbortSignal} [signal]
 * @param {number} now - Shared clock for the whole batch.
 * @returns {Promise<Array>}
 */
function tileSegments(z, x, y, signal, now) {
  const key = `${z}/${x}/${y}`;
  const cached = _decodeCache.get(key);
  if (cached && now - cached.at < DECODE_CACHE_TTL_MS) return Promise.resolve(cached.segments);

  // Cooling down after a 429: keep serving the stale decode rather than
  // hammering something that is already refusing us. A tile we have never
  // decoded has nothing to serve and rejects with the reason we were given.
  if (now < _cooldownUntil) {
    if (cached) return Promise.resolve(cached.segments);
    return Promise.reject(flowTileError(key, 429, _cooldownReason));
  }

  let job = _inflight.get(key);
  if (job) {
    _tilesJoined += 1;
  } else {
    job = fetchTile(key, z, x, y);
    _inflight.set(key, job);
    const forget = () => { if (_inflight.get(key) === job) _inflight.delete(key); };
    job.then(forget, forget); // both arms settle: no unhandled rejection here
  }
  return raceAbort(job, signal);
}


/**
 * Fetch + decode all flow tiles covering the given bounds.
 *
 * Tiles are fetched from the local proxy in parallel; each decoded tile is
 * cached in memory for 120 s (keyed z/x/y), so repeat calls for the same
 * viewport are free, and concurrent calls for a tile already in flight JOIN it
 * instead of issuing a second request. Partial tile failures return the
 * segments that DID decode (last-good philosophy); the promise rejects only
 * when every tile failed (e.g. keyless 503, aborted signal, proxy down).
 *
 * @param {{south:number, west:number, north:number, east:number}} bounds - Degrees.
 * @param {Object} [opts]
 * @param {AbortSignal} [opts.signal] - Abort signal (camera moved / layer disabled).
 * @param {number} [opts.zoom=12] - Flow tile zoom level. Callers that know the
 *   camera band should pass its `flowZoom`: a 0.30° box needs 30 tiles at z12
 *   and 4 at z10, for arterials that are a few pixels wide either way.
 * @returns {Promise<Array<{coords:number[][], trafficLevel:number, roadType:string, closure:boolean}>>}
 *   Flat array of flow segments across all covering tiles.
 */
export async function fetchFlowForBounds(bounds, { signal, zoom = 12 } = {}) {
  const tiles = tilesForBounds(bounds, zoom);
  if (tiles.length === 0) return [];
  const now = Date.now();

  const results = await Promise.allSettled(
    tiles.map(({ z, x, y }) => tileSegments(z, x, y, signal, now)),
  );

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  if (fulfilled.length === 0) {
    // An abort outranks every other reason: it means a NEWER load owns the
    // screen, which the layer must not report as an outage.
    const aborted = results.find((r) => r.reason?.name === 'AbortError');
    if (aborted) throw aborted.reason;
    const first = results[0].reason;
    throw first instanceof Error ? first : new Error('flow fetch failed');
  }
  return fulfilled.flatMap((r) => r.value);
}

/**
 * Session diagnostics for `getStats()` surfaces.
 * @returns {{tilesFetched:number, tilesJoined:number, cooldownMs:number, cooldownReason:?string}}
 *   `tilesFetched` counts requests issued to the proxy this session (cache hits
 *   and in-flight joins excluded); `tilesJoined` counts the duplicates that
 *   never became a request; `cooldownMs` is what is left of a 429 parking.
 */
export function getFlowSessionStats() {
  const cooldownMs = Math.max(0, _cooldownUntil - Date.now());
  return {
    tilesFetched: _tilesFetched,
    tilesJoined: _tilesJoined,
    cooldownMs,
    cooldownReason: cooldownMs > 0 ? _cooldownReason : null,
  };
}

/**
 * Clear the decode cache, the in-flight table and any 429 cooldown
 * (tests + layer teardown). Session counters persist.
 */
export function resetFlowTileCache() {
  _decodeCache.clear();
  _inflight.clear();
  _cooldownUntil = 0;
  _cooldownReason = null;
}
