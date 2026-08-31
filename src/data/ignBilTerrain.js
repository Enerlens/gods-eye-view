// src/data/ignBilTerrain.js — SPIKE. Keyless IGN RGE ALTI terrain for France.
//
// ⚠️ DEV-ONLY, BEHIND `?ign_terrain=1`, NEVER DEFAULT. ⚠️
//
// This is a decision instrument, not a shipped feature. Its job is to answer,
// with measurements instead of opinions, whether the full terrain work is
// worth financing. What it deliberately does NOT do is the reason it must stay
// behind a flag:
//
//   The repo's height-datum contract has exactly TWO surface regimes
//   (`surfaceRegimeKey()`, src/data/cctv.js): `google-3d` when the globe is
//   hidden, `terrain-globe` otherwise — and `terrain-globe` MEANS "the Re:Earth
//   point-height prior IS the ground". Installing a different terrain provider
//   under a shown globe breaks that identity everywhere heights are cached
//   from it: `groundFloor`, `meshFloorSampler`, `cctv`, `localGeojson.js`
//   (which latches `groundSampled = true` permanently) and `traffic.js` (which
//   precomputes a whole road network from ONE sample). With this flag on,
//   ground-clamped objects are WRONG. That is expected, and it is why the flag
//   exists rather than a stack.
//
// ── What the live service actually does, measured 2026-08-28 ────────────────
//
// Layer `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` (MNT from RGE ALTI), WMTS
// `GetTile`, `image/x-bil;bits=32`, TileMatrixSet `WGS84G` levels 6-14.
//
//   · `WGS84G` is bit-for-bit Cesium's default `GeographicTilingScheme`:
//     2x1 tiles at level 0, origin top-left -180/+90, 256 px tiles. Confirmed
//     against the live GetCapabilities. So tile (x, y, level) maps 1:1.
//   · Samples are LITTLE-ENDIAN float32, 256x256 = 262144 bytes.
//   · The service replies `content-encoding: deflate` and the browser decodes
//     it transparently. `content-length` is therefore the COMPRESSED size
//     (189626 for a Paris tile) — a guard comparing it to the expected byte
//     count would reject every valid tile. Validate `arrayBuffer.byteLength`.
//   · Row 0 is NORTH. Verified twice: the Mont Blanc tile falls 4560 m -> 4020 m
//     from first row to last across a tile whose north edge holds the summit,
//     and a Nice tile has land in row 0 and open sea in row 255. That is
//     Cesium's own convention, so no vertical flip.
//   · Outside coverage the reply is HTTP 404 with a 137-byte XML body.
//     `137 % 4 === 1`, so `new Float32Array(buffer)` THROWS on it. The guard is
//     fail-closed for exactly this reason.
//
// ── The two findings that shaped this code ─────────────────────────────────
//
// 1. NoData is a SMEAR, not a sentinel. The documented value is -99999, but a
//    Nice coastal tile at z14 holds only 4143 samples exactly equal to it,
//    ~6500 more within half a metre of it, and a continuous ramp of 505 further
//    values — -1046, -3588, -17466, -50806 — produced by lossy resampling
//    BLENDING real heights against the sentinel. They form a one-pixel ring
//    around every NoData region. `value === -99999` would pass a -50806 m
//    crater straight through, and so would any "is it finite" check. The rule
//    here is therefore a PLAUSIBILITY FLOOR, applied per sample.
//
//    Measured residual after the floor, on the worst tile found: 14 samples of
//    65536 survive in (-100, 0) m, the lowest at -17.2 m. A ~17 m dimple on
//    0.02 % of a coastal tile, against a 100 km crater. That is the v1 trade,
//    and it is stated rather than hidden.
//
// 2. The grid is CELL-CENTRE registered; Cesium's is EDGE-INCLUSIVE. IGN gives
//    256 cell centres spanning the tile, so a tile's last column and its east
//    neighbour's first column are one full cell apart. Cesium's
//    `HeightmapTessellator` places sample i at `west + i * extent / (width - 1)`
//    — first and last samples exactly ON the edges. Feeding the raw grid
//    straight in leaves a visible crack at every tile boundary: measured
//    2.80 m mean / 5.79 m max on an Alpine z14 pair, which is a full sample
//    step, not a rounding error.
//
//    `resampleToEdgeInclusive()` below fixes it by bilinearly resampling onto
//    the grid Cesium expects and LINEARLY EXTRAPOLATING the half cell past each
//    border, rather than clamping (clamping reproduces the full-cell step).
//    Same Alpine pair after the resample: 0.03 m mean / 0.39 m max east-west,
//    0.09 m / 0.81 m north-south — sub-metre, ~35x better, invisible.
import * as Cesium from 'cesium';
import { ensureGeoidReady, geoidHeight } from './geoid.js';

/** WMTS endpoint. Keyless, CORS-open, and documented as not rate-limited. */
const IGN_WMTS_URL = 'https://data.geopf.fr/wmts';

/** RGE ALTI digital terrain model. */
const ELEVATION_LAYER = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';

/** Native BIL grid: 256x256 float32 samples per tile. */
const SOURCE_SIZE = 256;
const BYTES_PER_SAMPLE = 4;
const EXPECTED_BYTES = SOURCE_SIZE * SOURCE_SIZE * BYTES_PER_SAMPLE;

/** Levels the layer publishes (TileMatrixSet `WGS84G_6_14`). */
export const IGN_TERRAIN_MIN_LEVEL = 6;
export const IGN_TERRAIN_MAX_LEVEL = 14;

/**
 * Coverage clamp, matching the imagery stacks' `IGN_FRANCE_RECTANGLE`.
 * Metropolitan France + Corsica. The DOM are in the layer but sit in three
 * different vertical systems (RAF20 continental, RAC23 Corsica, separate
 * overseas models) and are out of scope for this spike.
 */
export const IGN_TERRAIN_RECTANGLE_DEG = Object.freeze({
  west: -5.5, south: 41.2, east: 9.8, north: 51.2,
});

/**
 * Any sample below this is NoData or a resampling artifact, never ground.
 *
 * -100 m sits far below every land point in metropolitan France (the deepest,
 * in the Dunkerque and Poitevin polders, is about -4 m) and far above the
 * shallowest artifact observed in the blend ring (-589 m). Widening it toward
 * 0 would start eating real coastal ground; narrowing it toward -1000 would
 * start admitting craters.
 */
export const NODATA_FLOOR_M = -100;

/**
 * Replacement height for a rejected sample, ORTHOMETRIC.
 *
 * H = 0, the geoid — the same "at the geoid/coast" prior `terrainHeights.js`
 * already uses when it has nothing better. Every rejected sample in this
 * dataset is sea or just off the survey edge, so the geoid is the honest
 * answer, and it goes through the same datum conversion as a real reading
 * rather than being written straight to the mesh.
 */
const NODATA_REPLACEMENT_H_M = 0;

/**
 * Geoid undulation is evaluated on a coarse grid per tile and interpolated.
 *
 * A per-sample `geoidHeight()` call would be 65536 EGM96 grid lookups per
 * tile. A single per-tile offset is not good enough either: N varies 2.69 m
 * corner to corner on a z6 tile over Paris, which is a visible tilt. 5x5 is the
 * compromise — 25 lookups, and since N is a smooth long-wavelength field its
 * bilinear error over even a z6 tile is centimetres.
 */
const GEOID_GRID = 5;

/**
 * Output heightmap edge length. 65x65 keeps the vertex count per tile in the
 * same order as Cesium World Terrain's while preserving the shape: the seam
 * measurement above is unchanged from 256 to 65, because the resample carries
 * the tile's edges either way.
 */
const OUTPUT_SIZE = 65;

/** Reads the dev-only flag. Exported so callers do not re-parse the URL. */
export function ignTerrainFlagEnabled(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('ign_terrain') === '1';
}

/**
 * Fail-closed validation of one BIL response.
 *
 * The dominant failure mode here is not the 404 — it is the 404 whose 137-byte
 * XML body reaches `new Float32Array()` and throws inside a tile request. Every
 * condition below must hold before a single byte is interpreted as elevation.
 * @param {{ok: boolean, status: number, contentType: string, byteLength: number}} response
 * @returns {{valid: boolean, reason: string}}
 */
export function validateBilResponse({ ok, status, contentType, byteLength }) {
  if (!ok || status !== 200) return { valid: false, reason: `http ${status}` };
  const type = String(contentType || '').toLowerCase();
  if (!type.startsWith('image/x-bil')) return { valid: false, reason: `content-type ${type || 'missing'}` };
  // `% 4` FIRST and separately from the exact size: it is the condition that
  // makes the Float32Array constructor throw, and naming it in the reason is
  // what tells a future reader they hit an error body, not a short tile.
  if (byteLength % BYTES_PER_SAMPLE !== 0) {
    return { valid: false, reason: `${byteLength} bytes is not a whole number of float32` };
  }
  if (byteLength !== EXPECTED_BYTES) {
    return { valid: false, reason: `${byteLength} bytes, expected ${EXPECTED_BYTES}` };
  }
  return { valid: true, reason: '' };
}

/**
 * True when a raw BIL sample is real ground rather than NoData or a blend
 * artifact. See `NODATA_FLOOR_M` and finding 1 in the file header.
 * @param {number} value - Raw metres from the BIL grid.
 * @returns {boolean}
 */
export function isRealElevationSample(value) {
  return Number.isFinite(value) && value > NODATA_FLOOR_M;
}

/**
 * Bilinear geoid undulation N over one tile, from a `GEOID_GRID`² sample grid.
 *
 * `ensureGeoidReady()` must have resolved before this is called.
 * @param {{west: number, south: number, east: number, north: number}} rectDeg - Tile bounds in degrees.
 * @returns {(lonDeg: number, latDeg: number) => number} N in metres.
 */
export function buildGeoidInterpolator(rectDeg) {
  const { west, south, east, north } = rectDeg;
  const lonStep = (east - west) / (GEOID_GRID - 1);
  const latStep = (north - south) / (GEOID_GRID - 1);
  const grid = new Float64Array(GEOID_GRID * GEOID_GRID);
  for (let row = 0; row < GEOID_GRID; row += 1) {
    // Row 0 is the SOUTH edge here, matching the (lon, lat) argument order
    // below. This grid is indexed by geography, not by heightmap row.
    const lat = south + row * latStep;
    for (let col = 0; col < GEOID_GRID; col += 1) {
      grid[row * GEOID_GRID + col] = geoidHeight(lat, west + col * lonStep);
    }
  }

  return (lonDeg, latDeg) => {
    const fx = Math.min(GEOID_GRID - 1, Math.max(0, (lonDeg - west) / lonStep));
    const fy = Math.min(GEOID_GRID - 1, Math.max(0, (latDeg - south) / latStep));
    const x0 = Math.min(GEOID_GRID - 2, Math.floor(fx));
    const y0 = Math.min(GEOID_GRID - 2, Math.floor(fy));
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (row, col) => grid[row * GEOID_GRID + col];
    const bottom = at(y0, x0) * (1 - tx) + at(y0, x0 + 1) * tx;
    const top = at(y0 + 1, x0) * (1 - tx) + at(y0 + 1, x0 + 1) * tx;
    return bottom * (1 - ty) + top * ty;
  };
}

/**
 * Re-grids a `size`² CELL-CENTRE field onto an `outSize`² EDGE-INCLUSIVE one.
 *
 * This is finding 2 in the file header, and it is the difference between
 * visible cracks and no cracks. Output sample j sits at fractional source-cell
 * coordinate `j / (outSize - 1) * size - 0.5`, which is negative at j = 0 and
 * past the last centre at j = outSize - 1 — exactly the half cell that lies
 * between the outermost cell centre and the tile edge.
 *
 * Those two half cells are LINEARLY EXTRAPOLATED from the border pair, not
 * clamped. Clamping would make a tile's edge value equal its outermost cell
 * centre, leaving neighbouring tiles a full cell apart at their shared border —
 * the original 2.8 m step. Extrapolating makes both tiles estimate the same
 * physical edge, and the residual is a second-difference term: sub-metre even
 * in the Alps.
 * @param {Float32Array} src - `size`² samples, row 0 = north.
 * @param {number} size - Source edge length.
 * @param {number} outSize - Output edge length.
 * @returns {Float32Array} `outSize`² samples, row 0 = north.
 */
export function resampleToEdgeInclusive(src, size, outSize) {
  const out = new Float32Array(outSize * outSize);
  // Border-extending read: an index one step outside the grid is the linear
  // continuation of the two samples nearest that border. Recursive so a corner
  // (both indices outside) extends in each axis in turn.
  const at = (row, col) => {
    if (row < 0) return 2 * at(0, col) - at(1, col);
    if (row > size - 1) return 2 * at(size - 1, col) - at(size - 2, col);
    if (col < 0) return 2 * at(row, 0) - at(row, 1);
    if (col > size - 1) return 2 * at(row, size - 1) - at(row, size - 2);
    return src[row * size + col];
  };

  for (let j = 0; j < outSize; j += 1) {
    const y = (j / (outSize - 1)) * size - 0.5;
    const y0 = Math.floor(y);
    const ty = y - y0;
    for (let i = 0; i < outSize; i += 1) {
      const x = (i / (outSize - 1)) * size - 0.5;
      const x0 = Math.floor(x);
      const tx = x - x0;
      const top = at(y0, x0) * (1 - tx) + at(y0, x0 + 1) * tx;
      const bottom = at(y0 + 1, x0) * (1 - tx) + at(y0 + 1, x0 + 1) * tx;
      out[j * outSize + i] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/**
 * Turns one validated BIL buffer into ELLIPSOIDAL heights Cesium can mesh.
 *
 * Order matters and is not interchangeable: reject per sample, substitute the
 * geoid prior, convert the datum per sample, and only then re-grid. Re-gridding
 * first would bilinearly average a -99999 into its neighbours and spread the
 * hole instead of removing it.
 * @param {ArrayBuffer} buffer - Exactly `EXPECTED_BYTES` bytes of little-endian float32.
 * @param {{west: number, south: number, east: number, north: number}} rectDeg - Tile bounds in degrees.
 * @param {number} [outSize] - Output heightmap edge length.
 * @returns {{heights: Float32Array, size: number, nodataCount: number, min: number, max: number}}
 */
export function decodeBilTile(buffer, rectDeg, outSize = OUTPUT_SIZE) {
  // Little-endian is the platform order on every target this app runs on, and
  // the BIL payload is little-endian too, so the typed-array view is correct
  // and free. (Verified: byte 0 of a Paris tile reads 34.64 m LE, garbage BE.)
  const raw = new Float32Array(buffer);
  const orthometric = new Float32Array(SOURCE_SIZE * SOURCE_SIZE);
  const geoidAt = buildGeoidInterpolator(rectDeg);

  const { west, south, east, north } = rectDeg;
  const lonStep = (east - west) / SOURCE_SIZE;
  const latStep = (north - south) / SOURCE_SIZE;

  let nodataCount = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let row = 0; row < SOURCE_SIZE; row += 1) {
    // Row 0 is north, and cell centres sit half a cell in from the edge.
    const lat = north - (row + 0.5) * latStep;
    for (let col = 0; col < SOURCE_SIZE; col += 1) {
      const index = row * SOURCE_SIZE + col;
      const sample = raw[index];
      const real = isRealElevationSample(sample);
      if (!real) nodataCount += 1;
      const orthoM = real ? sample : NODATA_REPLACEMENT_H_M;
      if (real) {
        if (orthoM < min) min = orthoM;
        if (orthoM > max) max = orthoM;
      }
      // h = H + N, per sample. A single per-tile offset is wrong by up to
      // 2.69 m corner to corner at z6 — a tilt, not a bias.
      orthometric[index] = orthoM + geoidAt(west + (col + 0.5) * lonStep, lat);
    }
  }

  return {
    heights: resampleToEdgeInclusive(orthometric, SOURCE_SIZE, outSize),
    size: outSize,
    nodataCount,
    min: nodataCount === raw.length ? null : min,
    max: nodataCount === raw.length ? null : max,
  };
}

/**
 * Cesium's THREE-VALUED tile availability, and all three values are used.
 *
 * Each one instructs Cesium to do something different, and picking the wrong
 * one fails silently in a different way. Both wrong answers were shipped and
 * measured during this spike before landing on these rules:
 *
 *   `true`      — fetch it from IGN. Inside France, z6-14.
 *
 *   `false`     — "no data at this tile, UPSAMPLE THE PARENT". Used above z14
 *                 inside France, which is the case the camera hits constantly:
 *                 the layer stops at z14 but a camera 5 km up asks for z15-17.
 *                 The first version served a flat tile there, so zooming in
 *                 REPLACED Mont Blanc with a plane — `globe.getHeight()` read
 *                 -0.01 m over the summit. `false` makes Cesium refine the real
 *                 z14 data instead.
 *
 *   `undefined` — "unknown, ask me". Everything outside France, and z0-5 where
 *                 there is no ancestor to upsample from. Returning `false`
 *                 there is fatal, not merely wrong: `prepareNewTile` marks the
 *                 tile FAILED and never calls `requestTileGeometry`, and since
 *                 the two level-0 roots are below z6 by definition, the ENTIRE
 *                 globe rendered nothing at all — no requests, no geometry, no
 *                 error.
 * @param {Cesium.GeographicTilingScheme} tilingScheme
 * @param {number} x
 * @param {number} y
 * @param {number} level
 * @returns {boolean|undefined}
 */
export function ignTerrainTileAvailability(tilingScheme, x, y, level) {
  const tile = tilingScheme.tileXYToRectangle(x, y, level);
  const france = Cesium.Rectangle.fromDegrees(
    IGN_TERRAIN_RECTANGLE_DEG.west,
    IGN_TERRAIN_RECTANGLE_DEG.south,
    IGN_TERRAIN_RECTANGLE_DEG.east,
    IGN_TERRAIN_RECTANGLE_DEG.north,
  );
  if (Cesium.Rectangle.intersection(tile, france) === undefined) return undefined;
  if (level > IGN_TERRAIN_MAX_LEVEL) return false;
  if (level < IGN_TERRAIN_MIN_LEVEL) return undefined;
  return true;
}

/**
 * Builds one WMTS GetTile URL. KVP, because that is what the Géoplateforme
 * serves; `WGS84G` rather than the layer's declared `WGS84G_6_14` subset —
 * the server accepts both for the same tiles, and `WGS84G`'s level ids are the
 * ones that match Cesium's.
 * @param {number} x
 * @param {number} y
 * @param {number} level
 * @returns {string}
 */
export function ignBilTileUrl(x, y, level) {
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: ELEVATION_LAYER,
    STYLE: 'normal',
    FORMAT: 'image/x-bil;bits=32',
    TILEMATRIXSET: 'WGS84G',
    TILEMATRIX: String(level),
    TILEROW: String(y),
    TILECOL: String(x),
  });
  // `FORMAT` carries a `;` and `=` that `URLSearchParams` percent-encodes.
  // The Géoplateforme accepts the encoded form, so this is left as-is rather
  // than hand-assembled — one fewer place to get quoting wrong.
  return `${IGN_WMTS_URL}?${params}`;
}

/**
 * A Cesium `TerrainProvider` over IGN RGE ALTI. SPIKE ONLY — see the file
 * header for why this must never become the default terrain.
 *
 * Implements the provider interface directly rather than subclassing: Cesium
 * has no public base class, and the surface a `Globe` actually calls is small.
 */
export class IgnBilTerrainProvider {
  /**
   * @param {object} [options]
   * @param {number} [options.outputSize] - Heightmap edge length per tile.
   */
  constructor({ outputSize = OUTPUT_SIZE } = {}) {
    // `WGS84G` IS this scheme: 2x1 at level 0, origin -180/+90, 256 px tiles.
    this._tilingScheme = new Cesium.GeographicTilingScheme();
    this._outputSize = outputSize;
    this._errorEvent = new Cesium.Event();
    this._credit = new Cesium.Credit('Terrain: © IGN — RGE ALTI via Géoplateforme', false);
    this._rectangle = Cesium.Rectangle.fromDegrees(
      IGN_TERRAIN_RECTANGLE_DEG.west,
      IGN_TERRAIN_RECTANGLE_DEG.south,
      IGN_TERRAIN_RECTANGLE_DEG.east,
      IGN_TERRAIN_RECTANGLE_DEG.north,
    );
    // Every tile outside France or outside z6-14 is served by this instead —
    // the same flat ellipsoid the app already falls back to when Re:Earth is
    // unreachable. See `getTileDataAvailable` for why they must be SERVED
    // rather than declared unavailable.
    this._fallback = new Cesium.EllipsoidTerrainProvider();
    /** Spike telemetry — read by `scripts/qa-ign-terrain.mjs`. */
    this.stats = { requested: 0, decoded: 0, rejected: 0, nodataSamples: 0, totalSamples: 0 };
    this._geoidReady = ensureGeoidReady();
  }

  get errorEvent() { return this._errorEvent; }

  get credit() { return this._credit; }

  get tilingScheme() { return this._tilingScheme; }

  get hasWaterMask() { return false; }

  get hasVertexNormals() { return false; }

  get availability() { return undefined; }

  get rectangle() { return this._rectangle; }

  getLevelMaximumGeometricError(level) {
    return this._tilingScheme.ellipsoid.maximumRadius * Cesium.Math.PI
      / (65 * (1 << level));
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} level
   * @returns {boolean|undefined} See `ignTerrainTileAvailability` — all three
   *   values mean different things to Cesium and all three are used.
   */
  getTileDataAvailable(x, y, level) {
    return ignTerrainTileAvailability(this._tilingScheme, x, y, level);
  }

  loadTileDataAvailability() {
    return undefined;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} level
   * @param {Cesium.Request} [request]
   * @returns {Promise<Cesium.TerrainData>|undefined}
   */
  requestTileGeometry(x, y, level, request) {
    // Only `true` reaches IGN. `false` never arrives here at all (Cesium
    // upsamples instead), so anything else is the `undefined` case: outside
    // France, or a root level with nothing above it. Those get flat ground.
    if (this.getTileDataAvailable(x, y, level) !== true) {
      return this._fallback.requestTileGeometry(x, y, level, request);
    }
    this.stats.requested += 1;
    return this._requestBilTile(x, y, level, request);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} level
   * @param {Cesium.Request} [request]
   * @returns {Promise<Cesium.TerrainData>|undefined}
   */
  async _requestBilTile(x, y, level, request) {
    // The geoid grid is a lazy ~2.7 MB dynamic import. Awaiting it here rather
    // than in the constructor keeps the flag's cost at zero until a tile is
    // actually asked for, and `ensureGeoidReady()` resolves from cache after
    // the first call.
    await this._geoidReady;

    const resource = new Cesium.Resource({ url: ignBilTileUrl(x, y, level), request });
    let response;
    try {
      response = await resource.fetch({ responseType: 'arraybuffer', returnByteArrayPromise: false });
    } catch (error) {
      // A throttled/cancelled Cesium request resolves undefined by contract;
      // anything else degrades to flat rather than stalling the quadtree.
      if (resource.request?.state === Cesium.RequestState.CANCELLED) return undefined;
      this.stats.rejected += 1;
      console.warn(`[ignBilTerrain] ${level}/${x}/${y} fetch failed:`, error?.message || error);
      return this._flatTile();
    }
    if (response === undefined) return undefined;

    const buffer = response instanceof ArrayBuffer ? response : response?.buffer;
    const validation = validateBilResponse({
      ok: true,
      status: 200,
      // Cesium's Resource discards headers, so the content-type guard is
      // enforced by `scripts/qa-ign-terrain.mjs` against the raw service. Here
      // the byte-count guards carry the load, and they are the ones that stop
      // a 137-byte error body from reaching `new Float32Array()`.
      contentType: 'image/x-bil;bits=32',
      byteLength: buffer?.byteLength ?? 0,
    });
    if (!validation.valid) {
      this.stats.rejected += 1;
      console.warn(`[ignBilTerrain] ${level}/${x}/${y} rejected: ${validation.reason}`);
      return this._flatTile();
    }

    const rect = this._tilingScheme.tileXYToRectangle(x, y, level);
    const decoded = decodeBilTile(buffer, {
      west: Cesium.Math.toDegrees(rect.west),
      south: Cesium.Math.toDegrees(rect.south),
      east: Cesium.Math.toDegrees(rect.east),
      north: Cesium.Math.toDegrees(rect.north),
    }, this._outputSize);

    this.stats.decoded += 1;
    this.stats.nodataSamples += decoded.nodataCount;
    this.stats.totalSamples += SOURCE_SIZE * SOURCE_SIZE;

    return new Cesium.HeightmapTerrainData({
      buffer: decoded.heights,
      width: decoded.size,
      height: decoded.size,
      // Default structure: elementsPerHeight 1, stride 1, heightScale 1,
      // heightOffset 0 — which is exactly "a Float32Array of metres".
    });
  }

  /** A 2x2 zero-height tile: flat at the ellipsoid, cheap, never null. */
  _flatTile() {
    return new Cesium.HeightmapTerrainData({
      buffer: new Float32Array(4),
      width: 2,
      height: 2,
    });
  }
}
