import * as Cesium from 'cesium';
import { governorRequestRender } from './renderGovernor.js';
import { IgnBilTerrainProvider } from './data/ignBilTerrain.js';
import { createGoogleMapTilesProvider } from './data/googleMapTiles.js';
import {
  WORLD_IMAGERY_FAILURE_BUDGET,
  createEsriWorldImageryProvider,
  createS2CloudlessProvider,
  watchTileFailures,
} from './data/worldImagery.js';

export const MAP_STACKS = [
  {
    id: 'photoreal',
    label: 'Google 3D',
    shortLabel: '3D',
    kind: 'photoreal',
    requiresIon: false,
  },
  // ── Google 2D Map Tiles (same key as the 3D globe, no ion token) ──────────
  // These two exist because the EEA withdrawal is narrower than its error
  // message: Google refuses `satellite` and 3D tiles to an EEA billing
  // address but serves `roadmap` and `terrain` on the very same key. So a
  // build whose "Google 3D" chip is permanently dead can still show Google's
  // cartography. See src/data/googleMapTiles.js for the measured evidence.
  {
    id: 'google-roadmap',
    label: 'Plan Google',
    shortLabel: 'Plan G',
    kind: 'google-2d',
    requiresIon: false,
    google2d: { mapType: 'roadmap', scale: 'scaleFactor2x' },
  },
  {
    id: 'google-terrain',
    label: 'Relief Google',
    shortLabel: 'Relief G',
    kind: 'google-2d',
    requiresIon: false,
    google2d: { mapType: 'terrain', scale: 'scaleFactor2x' },
  },
  {
    id: 'bing-aerial',
    label: 'Bing Aerial',
    shortLabel: 'Aerial',
    kind: 'ion',
    style: Cesium.IonWorldImageryStyle.AERIAL,
    requiresIon: true,
  },
  {
    id: 'bing-labels',
    label: 'Bing Labels',
    shortLabel: 'Labels',
    kind: 'ion',
    style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
    requiresIon: true,
  },
  {
    id: 'osm',
    label: 'OSM',
    shortLabel: 'OSM',
    kind: 'osm',
    requiresIon: false,
  },
  // ── IGN Géoplateforme (keyless, France only) ───────────────────────────────
  // The two stacks that make a keyless build worth looking at. `data.geopf.fr`
  // serves WMTS with `access-control-allow-origin: *` and no key of any kind,
  // and the WMTS/TMS endpoints are not rate-limited (unlike the vector-tile
  // ones). Coverage is France + DOM; this pass ships metropolitan France only
  // (`IGN_FRANCE_RECTANGLE`), because the DOM sit in three different vertical
  // systems and belong with the terrain work, not here.
  {
    // The ID stays `ign-ortho` even though the label no longer says IGN: it is
    // the share token in `?map=`, so renaming it would break every link ever
    // copied out of this app. Only what the operator READS changed.
    id: 'ign-ortho',
    // Named for its CONTENT, not its provider — the only chip in the tray that
    // has to be, because it is the only one serving more than one. It draws
    // IGN's 20 cm orthophoto over keyless world satellite
    // (see `_getStackProviders`), so "IGN Ortho" described a France-shaped
    // island this stack stopped being.
    label: 'Satellite',
    shortLabel: 'Sat',
    kind: 'ign-wmts',
    requiresIon: false,
    // The France clamp bounds the SHARP layer, not the whole stack.
    coverageNote: 'IGN 20 cm over France, world satellite beyond',
    wmts: {
      layer: 'ORTHOIMAGERY.ORTHOPHOTOS',
      format: 'image/jpeg',
      maximumLevel: 19,
    },
  },
  {
    id: 'ign-plan',
    label: 'Plan IGN',
    shortLabel: 'Plan',
    kind: 'ign-wmts',
    requiresIon: false,
    coverageNote: 'metropolitan France only',
    wmts: {
      layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
      format: 'image/png',
      maximumLevel: 19,
    },
  },
];

const DEFAULT_OSM_CREDIT = '© OpenStreetMap contributors';

/** Longest provider sentence that still belongs in a chip tooltip. */
const PROVIDER_ERROR_MAX_CHARS = 200;

/**
 * One readable line out of whatever a tile provider threw.
 *
 * Cesium rejects a failed tile request with a `RequestErrorEvent` — a plain
 * object with `statusCode`, `response` and `responseHeaders` and NO `message` —
 * so the generic "serialize it" fallback produces nine hundred characters of
 * gzip headers. The useful part is two fields deep, inside a JSON string:
 * Google's actual sentence about why (quota, region, a key restricted to
 * another referrer) lives at `response.error.message`. A tooltip nobody can
 * read is the same as no tooltip, which is the failure this whole path exists
 * to end.
 * @param {*} raw - Anything a provider or `describeError` produced.
 * @returns {string} `HTTP 403 — <provider sentence>`, the sentence alone, or ''.
 */
export function summarizeProviderError(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  let status = null;
  let message = text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      if (Number.isFinite(parsed.statusCode)) status = parsed.statusCode;
      let body = parsed.response;
      // The body is a JSON STRING inside the serialized event, so it needs its
      // own parse; a plain-text body is kept as-is.
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { /* plain text body */ }
      }
      const inner = body && typeof body === 'object'
        ? (body.error?.message || body.message)
        : body;
      message = String(inner || parsed.message || '').trim();
      if (!message && status === null) message = text;
    }
  } catch { /* not JSON — it is already a sentence */ }
  message = message.replace(/\s+/g, ' ').trim();
  if (message.length > PROVIDER_ERROR_MAX_CHARS) {
    message = `${message.slice(0, PROVIDER_ERROR_MAX_CHARS - 1)}…`;
  }
  if (status === null) return message;
  return message ? `HTTP ${status} — ${message}` : `HTTP ${status}`;
}

/** Keyless IGN Géoplateforme WMTS endpoint (no key, no token, CORS-open). */
const IGN_WMTS_URL = 'https://data.geopf.fr/wmts';

/**
 * Metropolitan France + Corsica, in degrees. Two jobs, both load-bearing:
 *
 * 1. It bounds the IGN layer, so Cesium never requests a tile the
 *    Géoplateforme has nothing for. Without it the provider issues 404s for
 *    the whole planet on every zoom — the declared layer bbox is useless as a
 *    coverage mask, since it is the bounding box of France UNION the DOM and
 *    therefore spans most of the globe.
 * 2. It is why the IGN stacks need TWO imagery layers (see
 *    `_activateGlobeStack`): a rectangle-limited layer sitting at index 0 is
 *    Cesium's BASE layer, and Cesium smears a base layer's edge pixels across
 *    every tile outside its bounds rather than leaving them blank. France's
 *    coastline would paint the Atlantic and then the rest of Earth.
 *
 * DOM-TOM are deliberately outside this pass.
 */
export const IGN_FRANCE_RECTANGLE = Object.freeze({
  west: -5.5, south: 41.2, east: 9.8, north: 51.2,
});

/**
 * Boxes where IGN's orthophoto is known to cover EVERY pixel, so the world
 * satellite base underneath can be switched off entirely.
 *
 * WHY THIS IS A LIST AND NOT `IGN_FRANCE_RECTANGLE`. A layer's rectangle is
 * its bounding box, not its coverage. The France clamp above also contains
 * Belgium, Luxembourg, northern Spain and northern Italy, where the
 * Géoplateforme answers either `<ExceptionReport>No data found` (Brussels,
 * z13) or a ~1.6 kB blank JPEG. Sleeping the base over that box would punch
 * white holes in the globe outside France.
 *
 * WHERE THESE SEVENTEEN COME FROM — `npm run qa:ign-opaque-boxes`, run
 * 2026-09-09. They are no longer hand-drawn. The script sweeps 15 554 points
 * on a 0.1° grid over the clamp (42% come back covered), erodes to points
 * whose eight neighbours are covered too, grows overlapping maximal rectangles
 * from a lattice of seeds in both axis orders, and then re-probes every
 * candidate at HALF the sweep spacing, offset by a quarter step so the probe
 * lands on midpoints the sweep itself never saw. Seven of twenty-four
 * candidates were dropped outright. The seventeen below answered real
 * orthophoto at every one of their 224-1 530 verification points — ~17 100 in
 * all, zero misses.
 *
 * TWO THINGS THAT WOULD HAVE MADE THIS WRONG, both found by re-running it:
 * thinning an over-large verification grid by halving walks the samples back
 * ONTO the sweep grid, so the biggest boxes were being "verified" against the
 * data that proposed them; and the Géoplateforme intermittently 404s tiles it
 * does serve, which had the same box scoring 1024/1024 and then 1022/1024 on
 * an identical lattice. Requiring a refusal to be repeated took the yield from
 * 8 boxes to 17 without relaxing anything.
 *
 * TWO OF THE PREVIOUS FIVE WERE NOT SAFE. Re-probed at this standard,
 * `0.5,44 -> 5,49` (the largest, and the one carrying every wide view) and
 * `4.2,43.7 -> 6,45` each contain a confirmed hole: the app has been sleeping
 * the base over views where the globe had nothing to draw. They passed their
 * original check because a 9x9 grid over a 4.5° box samples every 0.56°.
 *
 * WHAT THIS BUYS, measured with `npm run qa:world-imagery-cost`: the invisible
 * base costs 37 tiles / 813 kB per nadir Paris view against the visible IGN
 * layer's own 755 kB — the layer nobody can see costs MORE than the one they
 * came for. `cutoutRectangle` measures 37 tiles / 813 kB too, byte for byte
 * identical: it cuts the draw, not the fetch. Only `show = false` takes it to
 * zero. Coast and border are deliberately absent: there the base is genuinely
 * visible and must keep loading.
 */
export const IGN_OPAQUE_BOXES = Object.freeze([
  Object.freeze({ west: 0.3, south: 44.8, east: 5.9, north: 46.8 }),
  Object.freeze({ west: -1.4, south: 47.6, east: 5.6, north: 49.1 }),
  Object.freeze({ west: 1.4, south: 42.9, east: 2.9, north: 49.9 }),
  Object.freeze({ west: 2.0, south: 43.4, east: 3.3, north: 50.4 }),
  Object.freeze({ west: 1.2, south: 43.5, east: 3.6, north: 47.2 }),
  Object.freeze({ west: -0.5, south: 44.8, east: 6.5, north: 46.0 }),
  Object.freeze({ west: -1.1, south: 43.7, east: 5.1, north: 44.9 }),
  Object.freeze({ west: 2.0, south: 42.6, east: 2.9, north: 50.6 }),
  Object.freeze({ west: -0.6, south: 43.0, east: 2.9, north: 44.9 }),
  Object.freeze({ west: 2.0, south: 47.6, east: 4.0, north: 50.2 }),
  Object.freeze({ west: -1.7, south: 46.6, east: 0.8, north: 48.5 }),
  Object.freeze({ west: -1.9, south: 46.9, east: 0.8, north: 48.5 }),
  Object.freeze({ west: -1.1, south: 46.3, east: -0.1, north: 49.1 }),
  Object.freeze({ west: -1.3, south: 43.2, east: 3.0, north: 43.8 }),
  Object.freeze({ west: 5.5, south: 43.9, east: 6.5, north: 46.0 }),
  Object.freeze({ west: 5.5, south: 43.9, east: 6.7, north: 44.8 }),
  Object.freeze({ west: -3.7, south: 47.9, east: -3.1, north: 48.6 }),
]);

/**
 * Bounding box of the union, so a view nowhere near France costs four
 * comparisons instead of a coverage computation — which is almost every call,
 * since the camera spends most of its life outside the boxes.
 */
const IGN_OPAQUE_HULL = Object.freeze({
  west: Math.min(...IGN_OPAQUE_BOXES.map((box) => box.west)),
  south: Math.min(...IGN_OPAQUE_BOXES.map((box) => box.south)),
  east: Math.max(...IGN_OPAQUE_BOXES.map((box) => box.east)),
  north: Math.max(...IGN_OPAQUE_BOXES.map((box) => box.north)),
});

/**
 * Every distinct cut along one axis: the span's own bounds, plus each box edge
 * that falls strictly inside them.
 * @returns {number[]} ascending, deduplicated.
 */
function axisCuts(low, high, boxes, lowKey, highKey) {
  const cuts = new Set([low, high]);
  for (const box of boxes) {
    for (const key of [lowKey, highKey]) {
      if (box[key] > low && box[key] < high) cuts.add(box[key]);
    }
  }
  return [...cuts].sort((a, b) => a - b);
}

/**
 * Whether the UNION of a set of boxes covers every point of a rectangle.
 *
 * EXACT, not a heuristic. It cuts the rectangle at every box edge crossing it
 * and tests one interior point per resulting cell: an axis-aligned rectangle
 * is covered by a set of axis-aligned rectangles if and only if every cell of
 * that arrangement is covered, because no box edge passes through a cell's
 * interior. So two adjacent boxes cover a rectangle that neither contains,
 * while a genuine gap between them still leaves an uncovered cell.
 *
 * Split out from {@link isViewFullyCoveredByIgn} so the geometry can be tested
 * against shapes the French coastline does not happen to make — an L, a ring
 * with a hole, two boxes meeting exactly on an edge.
 * @param {{west: number, south: number, east: number, north: number}} rect
 * @param {ReadonlyArray<{west: number, south: number, east: number, north: number}>} boxes
 * @returns {boolean}
 */
export function isRectangleCoveredByBoxes(rect, boxes) {
  if (!rect || !boxes?.length) return false;
  // An antimeridian-crossing rectangle is never in France, and comparing its
  // bounds numerically would silently say otherwise.
  if (rect.east < rect.west || rect.north < rect.south) return false;

  const inside = (lon, lat) => boxes.some((box) => lon >= box.west
    && lon <= box.east && lat >= box.south && lat <= box.north);

  const cutsX = axisCuts(rect.west, rect.east, boxes, 'west', 'east');
  const cutsY = axisCuts(rect.south, rect.north, boxes, 'south', 'north');
  // A rectangle with zero width or height has no cells, and the loop below
  // would vacuously call it covered. Test the degenerate point itself.
  if (cutsX.length < 2 || cutsY.length < 2) return inside(rect.west, rect.south);

  for (let i = 0; i < cutsX.length - 1; i += 1) {
    const lon = (cutsX[i] + cutsX[i + 1]) / 2;
    for (let j = 0; j < cutsY.length - 1; j += 1) {
      if (!inside(lon, (cutsY[j] + cutsY[j + 1]) / 2)) return false;
    }
  }
  return true;
}

/**
 * Whether the opaque boxes cover every point of a view, so the world satellite
 * base underneath can sleep.
 *
 * Degrees in, so the caller converts once and this stays readable next to the
 * table above.
 *
 * WHY A UNION AND NOT "INSIDE ONE BOX", which is what this used to test. The
 * old test cost a real optimisation and bought no safety with it: at the
 * cockpit's own default tilt of -30° (`src/camera.js`, `src/orbit.js`) a view
 * over Paris at 9 400 m spans 1.88-2.70 E / 48.93-49.34 N, which crosses the
 * northern edge of one box and the western edge of its neighbour, so it
 * belonged to neither — while being, tile for tile, 81/81 covered. Measured
 * cost of that single miss: 69 requests / 1 362 kB of Esri fetched under an
 * opaque orthophoto, against the 41 requests / 923 kB of IGN actually on
 * screen. The layer nobody could see cost 1.5x the one they came for.
 * @param {{west: number, south: number, east: number, north: number}|null} view
 * @returns {boolean}
 */
export function isViewFullyCoveredByIgn(view) {
  if (!view) return false;
  // Nothing outside the hull can be covered, and that is almost every call:
  // the camera spends most of its life nowhere near France.
  if (view.west < IGN_OPAQUE_HULL.west || view.east > IGN_OPAQUE_HULL.east
    || view.south < IGN_OPAQUE_HULL.south || view.north > IGN_OPAQUE_HULL.north) return false;
  return isRectangleCoveredByBoxes(view, IGN_OPAQUE_BOXES);
}

// Keyless global ellipsoidal terrain (Re:Earth Terrain / Mapterhorn, CC BY 4.0,
// EGM2008 geoid via NGA) — quantized-mesh 1.0, `ellipsoid` data-type. Fixes
// regime C (keyless globe stacks previously rendered a flat
// EllipsoidTerrainProvider — see the height-datum contract in docs/CURRENT-STATE.md
// §1a). Constructed via `.fromUrl()`, never a hand-built `{z}/{x}/{y}.terrain`
// URL (spec correction, spec §1a).
const REEARTH_TERRAIN_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';

/**
 * Builds the keyless IGN Geoplateforme WMTS imagery provider for one stack.
 *
 * Four details are load-bearing and each was checked against a live
 * `data.geopf.fr` GetCapabilities on 2026-08-28:
 *
 * - `style: 'normal'` is REQUIRED. Cesium's `WebMapTileServiceImageryProvider`
 *   throws synchronously without it, and IGN publishes exactly one style named
 *   `normal` for both layers — so omitting it fails the switch, it does not
 *   quietly pick a default.
 * - `tileMatrixSetID: 'PM'` is IGN's Web Mercator set, and it is bit-for-bit
 *   Cesium's default `WebMercatorTilingScheme`: 256 px tiles, top-left
 *   -20037508.34/+20037508.34, a single tile at level 0. The layers declare the
 *   `PM_0_19` subset, but the server accepts plain `PM` for the same tiles, and
 *   `PM` is the set whose level ids match Cesium's own.
 * - `tileMatrixLabels` must be the STRING level ids `'0'..'19'`; Cesium passes
 *   the label through verbatim as `TILEMATRIX`.
 * - `rectangle` is the France clamp. See `IGN_FRANCE_RECTANGLE`.
 * @param {object} stack - An `ign-wmts` descriptor from `MAP_STACKS`.
 * @returns {Cesium.WebMapTileServiceImageryProvider}
 */
export function createIgnWmtsProvider(stack) {
  const { layer, format, maximumLevel } = stack.wmts;
  return new Cesium.WebMapTileServiceImageryProvider({
    url: IGN_WMTS_URL,
    layer,
    style: 'normal',
    format,
    tileMatrixSetID: 'PM',
    tileMatrixLabels: Array.from({ length: maximumLevel + 1 }, (_, level) => String(level)),
    maximumLevel,
    rectangle: Cesium.Rectangle.fromDegrees(
      IGN_FRANCE_RECTANGLE.west,
      IGN_FRANCE_RECTANGLE.south,
      IGN_FRANCE_RECTANGLE.east,
      IGN_FRANCE_RECTANGLE.north,
    ),
    // The on-globe line. Etalab 2.0 wants the source named where the data is
    // shown; the fuller notice, with the product edition, is the static entry
    // `registerDataCredits()` puts in the "Data attribution" popover.
    credit: new Cesium.Credit('© IGN — Géoplateforme', true),
  });
}

/**
 * Controls the active globe/map stack. Google Photorealistic 3D Tiles remain
 * the cinematic default, while Cesium ion world imagery, OSM, and the keyless
 * IGN Geoplateforme stacks run as globe imagery stacks.
 */
export class MapStackController {
  constructor(viewer, {
    googleTileset = null,
    cesiumToken = '',
    googleKeyConfigured = null,
    googleTilesetError = '',
    ignTerrainSpike = false,
    initialStack = 'photoreal',
    onChange = null,
    onError = null,
  } = {}) {
    this.viewer = viewer;
    this.googleTileset = googleTileset;
    this.cesiumToken = String(cesiumToken || '').trim();
    // Why `photoreal` is unavailable, when it is: a build with NO Google key
    // (the keyless build) and a keyed build whose tileset failed to load are
    // the same `googleTileset === null` here but need opposite advice. Default
    // `null` means "caller didn't say" and keeps the old generic wording, so a
    // controller built by a test or a tool doesn't start claiming a cause it
    // has no evidence for.
    this.googleKeyConfigured = googleKeyConfigured;
    // WHY the photoreal tileset is missing, in the provider's own words —
    // quota, network, a key restricted to another referrer. Boot used to
    // swallow this: `main.js` caught the error, showed the Cesium globe, and
    // the app opened on OSM with nothing on screen saying the source had
    // changed. The map source a reader is looking at is not a detail they can
    // be left to infer, so the controller carries the cause and the tray says
    // it. Empty means photoreal was never attempted (keyless build, or a
    // caller that did not say).
    this.googleTilesetError = summarizeProviderError(googleTilesetError);
    // DEV-ONLY SPIKE (`?ign_terrain=1`). Replaces the keyless terrain provider
    // with IGN RGE ALTI over France, and FORCES the keyless branch even when an
    // ion token is present — the point of the spike is to look at IGN terrain,
    // and Cesium World Terrain would silently win on a keyed machine. Read once
    // at construction: a flag that could flip mid-session would leave meshed
    // tiles from two different datums on the globe at the same time.
    // See src/data/ignBilTerrain.js for why this must never be the default.
    this.ignTerrainSpike = ignTerrainSpike === true;
    this._onChange = onChange;
    this._onError = onError;
    // `initialStack` is honoured whenever it can actually be shown; the guard
    // at the end of this constructor is what handles the case where it cannot.
    // It used to be overridden with 'osm' outright whenever the 3D tileset was
    // missing, which made a caller's choice of startup stack unreachable on
    // exactly the builds that have one to make.
    this._activeId = initialStack;
    // A stack owns an ORDERED LIST of imagery layers, not one layer: the IGN
    // stacks are a world base (index 0) + IGN France (index 1). Bottom-first.
    this._imageryLayers = [];
    this._imageryProviders = new Map();
    // The world satellite base under `ign-ortho`, cached by provider name so a
    // degraded session doesn't rebuild Esri behind its own fallback. Keyed
    // separately from `_imageryProviders` because these are not stacks: they
    // have no chip, no id and no share token, and are never selectable alone.
    this._worldImageryProviders = new Map();
    // Latched, never un-latched within a session. Esri coming back up mid-
    // session is not worth a second rebuild of every imagery layer under the
    // camera; the fallback is honest imagery, not an error state.
    this._worldImageryDegraded = false;
    // One `moveEnd` subscription for the whole session, not one per switch.
    this._worldBaseWatchAttached = false;
    this._isSwitching = false;
    this._lastError = null;
    // Tracks which terrain PROVIDER is actually installed on the scene, not
    // just an ion-available boolean: 'world' (Cesium World Terrain, ion
    // token), 'keyless' (Re:Earth or its Ellipsoid fallback), or null (never
    // set yet — Cesium's own startup default). Using a tri-state here (rather
    // than the `enabled` boolean `_setWorldTerrainEnabled` receives) matters
    // because both the "never set" and "keyless" states pass `enabled=false`;
    // collapsing them to a boolean would make the first real keyless switch
    // a no-op against the initial `false` default and leave Cesium's built-in
    // provider in place instead of installing Re:Earth terrain.
    this._terrainMode = null;
    // Cache of the constructed keyless Re:Earth CesiumTerrainProvider, so
    // repeat switches into a keyless globe stack don't refetch `layer.json`.
    // Lives independently of `_switchGen` — construction is async and racy
    // switches are guarded where it's awaited (`_setWorldTerrainEnabled`).
    this._reearthTerrainProvider = null;
    // Monotonic switch counter. setStack() awaits network-bound provider
    // creation; a rapid A→B switch where A (e.g. slow Bing) resolves AFTER B
    // (fast OSM) would otherwise revert the user's last choice (M7). Each call
    // captures a generation and aborts its own commit once superseded.
    this._switchGen = 0;
    // Whether a switch has actually built the scene yet. `_activeId` is seeded
    // in this constructor, BEFORE anything is on the globe, so the re-entry
    // short-circuit in `setStack()` cannot key on the id alone — it would swallow
    // the one boot call that builds the imagery in the first place.
    this._activated = false;
    // Cleared by the first DELIBERATE switch: once someone picks a source, the
    // globe is the one they asked for and the boot fallback is no longer news.
    this._bootNoticeDismissed = false;
    // Imagery layers CONSTRUCTED this page load — the reload bug's own number.
    // A share link that opens on its own basemap must cost exactly what a plain
    // load of that basemap costs, and nothing but a counter proves it.
    this._imageryBuilds = 0;

    if (!this.getStack(this._activeId) || !this.isStackAvailable(this._activeId)) {
      // The startup ladder, mirroring the one main.js applies: the 3D globe,
      // else Google's 2D cartography when the key is KNOWN to exist (the EEA
      // case — 3D and satellite are withheld, roadmap and terrain are not),
      // else OSM. A `null` key flag — the caller never said — deliberately
      // stays on OSM rather than landing on a stack whose session call would
      // answer 503 for want of a key.
      if (googleTileset) this._activeId = 'photoreal';
      else if (this.googleKeyConfigured === true) this._activeId = 'google-roadmap';
      else this._activeId = 'osm';
    }
  }

  getStacks() {
    return MAP_STACKS.map((stack) => {
      const available = this.isStackAvailable(stack.id);
      return {
        ...stack,
        available,
        // Why this stack can't be picked, from the ONE place that decides it.
        // A stack can be unavailable for reasons other than a missing ion
        // token (photoreal is unavailable when the Google tileset failed to
        // load), so callers must not infer the reason from `available` alone.
        unavailableReason: available ? null : this._unavailableReason(stack),
      };
    });
  }

  /**
   * Human-readable reason a stack can't be activated. Shared by `getStacks()`
   * and `setStack()` so the tooltip and the toast never drift apart.
   * @param {object} stack - Stack descriptor.
   * @returns {string}
   */
  _unavailableReason(stack) {
    if (stack?.requiresIon) return 'Cesium ion token required for Bing stacks';
    // Two credentials open the photoreal globe, not one: the Google key, and
    // an ion token (ion serves the same tileset as asset 2275207, under
    // Cesium's US-billed Google project — the only route left on an EEA key).
    // So "no key" is only the right advice when there is no ion token either;
    // a keyless build WITH a token that still has no tileset failed for some
    // other reason, and saying "API key required" would send the reader to buy
    // the one thing that would not have helped.
    if (stack?.kind === 'photoreal' && this.googleKeyConfigured === false && !this.cesiumToken) {
      return 'Google Maps API key or Cesium ion token required for Google 3D';
    }
    if (stack?.kind === 'photoreal' && this.googleKeyConfigured !== null) {
      return this.googleTilesetError
        ? `Google 3D Tiles failed to load: ${this.googleTilesetError}`
        : 'Google 3D Tiles failed to load';
    }
    if (stack?.kind === 'google-2d') {
      return `Google Maps API key required for ${stack.label}`;
    }
    return `${stack?.label || 'This map stack'} is unavailable`;
  }

  getStack(id) {
    return MAP_STACKS.find((stack) => stack.id === id) || null;
  }

  getActiveId() {
    return this._activeId;
  }

  /**
   * Monotonic id of the most recently STARTED switch.
   *
   * A switch is only superseded by another `setStack()` — nothing else moves
   * this number — so a caller that must know whether the globe it is looking
   * at is still the one IT asked for can compare this across its own await.
   * Unchanged (or advanced by exactly its own call) means no newer switch has
   * claimed the globe.
   * @returns {number}
   */
  getSwitchGeneration() {
    return this._switchGen;
  }

  getActiveStack() {
    return this.getStack(this._activeId);
  }

  isStackAvailable(id) {
    const stack = this.getStack(id);
    if (!stack) return false;
    if (stack.kind === 'photoreal') return !!this.googleTileset;
    // `google-2d` needs the Google key but NOT a loaded 3D tileset: these are
    // exactly the stacks that work when photoreal does not. Only an explicit
    // `false` (the keyless build said so) makes them unavailable — `null`
    // means the caller never said, and guessing "missing" would hide a
    // working basemap from every controller built by a test or a tool.
    if (stack.kind === 'google-2d') return this.googleKeyConfigured !== false;
    if (stack.requiresIon) return !!this.cesiumToken;
    return true;
  }

  /**
   * Where an UNRECOGNIZED stack id lands.
   *
   * `photoreal` when it can actually be shown, else the first stack that can.
   * The distinction matters because an unknown id is not a request for a
   * particular source — it is a retired or corrupted `map=` share param — so
   * resolving it to a source this build cannot show would raise a credential
   * error about a stack nobody asked for. A DELIBERATE request for an
   * unavailable stack still errors; that one is a real answer to a real ask.
   * @returns {object} An available stack descriptor, or OSM as the last resort.
   */
  _fallbackStack() {
    if (this.isStackAvailable('photoreal')) return this.getStack('photoreal');
    return MAP_STACKS.find((stack) => this.isStackAvailable(stack.id)) || this.getStack('osm');
  }

  /**
   * Activate a map stack.
   *
   * RE-ENTRY IS A NO-OP, and that is load-bearing rather than an optimization.
   * `_activateGlobeStack()` DESTROYS and REBUILDS every imagery layer, so the
   * new `Cesium.ImageryLayer` instances start from an empty tile cache and
   * re-refine coarse→sharp in full view of the reader. Replaying the stack that
   * is already on the globe therefore costs a visible reload of a map that did
   * not change — which is exactly what a share link used to buy: boot activated
   * a stack, the hash restore replayed the same id a moment later, and the globe
   * blurred and re-sharpened for nothing.
   * @param {string} id - Stack id; an unrecognized one resolves to {@link _fallbackStack}.
   * @param {{silent?: boolean}} [options] - `silent` suppresses the change events.
   * @returns {Promise<object|null>} Controller state, or null for an empty registry.
   */
  async setStack(id, { silent = false } = {}) {
    const stack = this.getStack(id) || this._fallbackStack();
    if (!stack) return null;

    if (this._activated && stack.id === this._activeId && !this._isSwitching) {
      return this.getState();
    }

    if (!this.isStackAvailable(stack.id)) {
      const message = this._unavailableReason(stack);
      this._lastError = message;
      this._onError?.(message, stack);
      return this.getState();
    }

    const gen = ++this._switchGen;
    this._isSwitching = true;
    this._lastError = null;
    if (!silent) {
      // Boot activates silently; anything else is somebody choosing, and once
      // somebody has chosen, the boot fallback is no longer news.
      this._bootNoticeDismissed = true;
      this._emitChange('switching');
    }

    try {
      if (stack.kind === 'photoreal') {
        await this._activatePhotoreal(gen);
      } else {
        await this._activateGlobeStack(stack, gen);
      }
      // A newer switch started while we were awaiting the provider — that call
      // owns the final state now, so don't commit ours or emit a stale 'ready'.
      if (gen !== this._switchGen) return this.getState();
      this._activeId = stack.id;
      this._activated = true;
      // Show/hide of tilesets + imagery swaps need a frame in idle mode;
      // subsequent tile loads self-request via Cesium. (perf wave 2)
      governorRequestRender('map-stack');
      if (!silent) this._emitChange('ready');
    } catch (error) {
      if (gen !== this._switchGen) return this.getState();
      const message = error?.message || String(error);
      this._lastError = message;
      this._onError?.(message, stack);
      if (this.googleTileset) {
        await this._activatePhotoreal(gen);
        if (gen !== this._switchGen) return this.getState();
        this._activeId = 'photoreal';
        this._activated = true;
      }
      if (!silent) this._emitChange('error');
    } finally {
      // Only the latest switch clears the switching flag; a superseded call
      // must not stomp a newer switch that is still in progress.
      if (gen === this._switchGen) this._isSwitching = false;
    }

    return this.getState();
  }

  /**
   * The startup fallback, said out loud.
   *
   * Distinct from `lastError`, which belongs to a switch somebody ASKED for and
   * which the tray turns into a toast. This is the quieter failure: the app
   * opened on a source nobody chose because the one it wanted could not load.
   * It rides on the status chip until the first deliberate pick.
   * @returns {string|null}
   */
  _bootNotice() {
    if (this._bootNoticeDismissed) return null;
    // No recorded failure, or photoreal is on the globe after all: nothing to say.
    if (!this.googleTilesetError || this._activeId === 'photoreal') return null;
    const label = this.getActiveStack()?.label || this._activeId;
    return `Google 3D Tiles failed to load: ${this.googleTilesetError} — showing ${label}`;
  }

  /**
   * Imagery layers built since the page loaded. Diagnostics only — the QA
   * harness compares it against the number of stacks actually asked for.
   * @returns {number}
   */
  getImageryBuildCount() {
    return this._imageryBuilds;
  }

  getState(status = this._isSwitching ? 'switching' : 'ready') {
    return {
      activeId: this._activeId,
      activeStack: this.getActiveStack(),
      stacks: this.getStacks(),
      status,
      lastError: this._lastError,
      // Never folded into `lastError`: that field means "the switch you asked
      // for did not happen", and a caller that toasts it must not start
      // toasting a boot fallback nobody requested.
      notice: this._bootNotice(),
      hasCesiumIonToken: !!this.cesiumToken,
    };
  }

  async _activatePhotoreal(gen) {
    this._removeImageryLayers();
    if (this.googleTileset) this.googleTileset.show = true;
    this.viewer.scene.globe.show = false;
    // Terrain is left UNTOUCHED here. The photoreal globe is hidden
    // (`globe.show = false`), so the terrain provider is inert — it renders and
    // streams nothing. Routing this through `_setWorldTerrainEnabled(false)`
    // would make the DEFAULT startup stack await a keyless Re:Earth `layer.json`
    // fetch it can't use, delaying photoreal boot on a slow/blocked network and
    // (on failure) caching the flat `EllipsoidTerrainProvider` fallback for
    // later OSM switches. The Re:Earth fetch is therefore lazy: it happens on
    // the first switch to an actual globe stack (`_activateGlobeStack`).
    // `_terrainMode` is intentionally not changed — every globe-stack transition
    // re-derives the correct provider from it (null/'world'/'keyless'), so
    // leaving it as-is keeps the next switch correct without a photoreal fetch.
    void gen;
  }

  async _activateGlobeStack(stack, gen) {
    const providers = await this._getStackProviders(stack);
    // A newer switch started while the provider was resolving — don't touch the
    // scene's imagery layers, the winning switch already owns them (M7).
    if (gen != null && gen !== this._switchGen) return;
    this._removeImageryLayers();

    // Added bottom-first at ascending indices, so `providers[0]` is Cesium's
    // BASE layer and later entries composite over it.
    providers.forEach((provider, index) => {
      const layer = new Cesium.ImageryLayer(provider);
      this.viewer.imageryLayers.add(layer, index);
      this._imageryLayers.push(layer);
      this._imageryBuilds += 1;
    });

    if (this.googleTileset) this.googleTileset.show = false;
    this.viewer.scene.globe.show = true;
    this._watchCameraForWorldBase();
    // Evaluate immediately as well as on the next camera rest: switching to
    // the ortho while already parked over Paris must not fetch a base layer
    // that will be hidden a moment later.
    this._syncWorldBaseVisibility();
    await this._setWorldTerrainEnabled(!!this.cesiumToken && !this.ignTerrainSpike, gen);
  }

  /**
   * Subscribes once to camera rest, so the world base can sleep over France.
   *
   * `moveEnd` and not `changed`: the latter fires throughout a flight, and
   * every flip of `show` re-triggers tile requests. Waiting for the camera to
   * settle means one decision per movement instead of dozens.
   */
  _watchCameraForWorldBase() {
    if (this._worldBaseWatchAttached) return;
    const moveEnd = this.viewer?.camera?.moveEnd;
    if (!moveEnd?.addEventListener) return;
    moveEnd.addEventListener(() => this._syncWorldBaseVisibility());
    this._worldBaseWatchAttached = true;
  }

  /**
   * Imagery providers for one stack, BOTTOM-FIRST.
   *
   * Every stack but the IGN pair is a single world-covering layer. The IGN
   * stacks return two: IGN covers metropolitan France only, and a France-shaped
   * layer at index 0 would be Cesium's base layer, whose edge pixels Cesium
   * stretches over the rest of the planet. A world layer underneath keeps the
   * world honest and the French tiles land on top of it.
   *
   * WHICH world layer depends on what is above it, and the two IGN stacks want
   * opposite things. `ign-plan` is cartography, so OSM's line work continues it
   * naturally past the border. `ign-ortho` is a photograph, and OSM under a
   * photograph reads as a rendering fault — so it gets satellite instead, which
   * is also the only worldwide photography a keyless build has at all. IGN
   * still wins wherever it has tiles: it sits at index 1, above the base, and
   * its rectangle is what hands the globe back to satellite at the coastline.
   * @param {object} stack - Stack descriptor from `MAP_STACKS`.
   * @returns {Promise<Array<Cesium.ImageryProvider>>}
   */
  async _getStackProviders(stack) {
    if (stack.kind !== 'ign-wmts') return [await this._getImageryProvider(stack)];
    const base = stack.id === 'ign-ortho'
      ? this._getWorldImageryProvider()
      : await this._getImageryProvider(this.getStack('osm'));
    return [base, await this._getImageryProvider(stack)];
  }

  /**
   * The worldwide satellite base: Esri, or Sentinel-2 cloudless once Esri has
   * proved it cannot serve this session.
   *
   * Synchronous on purpose. Both providers are plain URL templates with nothing
   * to fetch at construction, so this never joins the awaited path that
   * `_switchGen` guards — there is no window in which a newer switch could be
   * clobbered by an older one resolving late.
   * @returns {Cesium.ImageryProvider}
   */
  _getWorldImageryProvider() {
    const key = this._worldImageryDegraded ? 's2cloudless' : 'esri';
    const cached = this._worldImageryProviders.get(key);
    if (cached) return cached;

    const provider = this._worldImageryDegraded
      ? createS2CloudlessProvider()
      : createEsriWorldImageryProvider();
    this._worldImageryProviders.set(key, provider);
    if (!this._worldImageryDegraded) {
      watchTileFailures(
        provider,
        WORLD_IMAGERY_FAILURE_BUDGET,
        () => this._degradeWorldImagery(),
      );
    }
    return provider;
  }

  /**
   * Switches the world satellite base OFF while IGN is covering every pixel.
   *
   * This is the one that keeps the two-layer stack from costing twice. Cesium
   * downloads a lower layer in full even when an opaque layer completely hides
   * it, so over Paris the base was fetching 813 kB (Esri) or 268 kB (the OSM
   * base this replaced) per view to draw nothing. `show = false` is the only
   * lever that stops the FETCH — `cutoutRectangle` measures the SAME 813 kB,
   * byte for byte, because it only stops the draw.
   *
   * Called on camera rest rather than per frame: `show` flipping back on makes
   * Cesium re-request the base, so doing this mid-flight would thrash tiles
   * across the whole pan. Cheap enough to be unconditional — one rectangle
   * computation and at most five comparisons.
   */
  _syncWorldBaseVisibility() {
    // Both IGN stacks, not just the ortho: Plan IGN is opaque over France too,
    // and its OSM base was already fetching 37 tiles / 268 kB per Paris view to
    // draw nothing long before satellite entered the picture.
    if (this.getActiveStack()?.kind !== 'ign-wmts') return;
    const base = this._imageryLayers[0];
    if (!base) return;
    const view = this.viewer?.camera?.computeViewRectangle?.();
    // No rectangle means the globe does not fill the view (the camera is far
    // enough out to see space), which is exactly when the base is needed.
    const covered = view ? isViewFullyCoveredByIgn({
      west: Cesium.Math.toDegrees(view.west),
      south: Cesium.Math.toDegrees(view.south),
      east: Cesium.Math.toDegrees(view.east),
      north: Cesium.Math.toDegrees(view.north),
    }) : false;
    if (base.show === !covered) return;
    base.show = !covered;
    governorRequestRender('world-base-visibility');
  }

  /**
   * Swaps the dead Esri base for Sentinel-2 cloudless, in place.
   *
   * Only the base layer is rebuilt, and only when it is actually on screen: the
   * IGN layer above it is untouched, so France keeps its 20 cm orthophoto and
   * its tile cache across the swap. A stack that is not currently showing the
   * world base just picks the fallback up the next time it is built.
   */
  _degradeWorldImagery() {
    if (this._worldImageryDegraded) return;
    this._worldImageryDegraded = true;
    if (this.getActiveId() !== 'ign-ortho' || this._imageryLayers.length === 0) return;

    const stale = this._imageryLayers[0];
    const layer = new Cesium.ImageryLayer(this._getWorldImageryProvider());
    this.viewer.imageryLayers.add(layer, 0);
    this.viewer.imageryLayers.remove(stale, false);
    this._imageryLayers[0] = layer;
    this._imageryBuilds += 1;
    governorRequestRender('world-imagery-fallback');
  }

  async _getImageryProvider(stack) {
    if (this._imageryProviders.has(stack.id)) {
      return this._imageryProviders.get(stack.id);
    }

    let provider;
    if (stack.kind === 'ion') {
      provider = await Cesium.createWorldImageryAsync({ style: stack.style });
    } else if (stack.kind === 'osm') {
      provider = new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
        credit: DEFAULT_OSM_CREDIT,
      });
    } else if (stack.kind === 'ign-wmts') {
      provider = createIgnWmtsProvider(stack);
    } else if (stack.kind === 'google-2d') {
      // Async unlike the others: a 2D tile URL is invalid without a session
      // token, and only the server can mint one. A throw here (no key, dead
      // billing, or the regional withdrawal) propagates to setStack's error
      // path with Google's own wording, and nothing is cached — so a switch
      // retried after the key is fixed opens a fresh session instead of
      // replaying the failure.
      provider = await createGoogleMapTilesProvider(stack);
    } else {
      throw new Error(`Unsupported map stack: ${stack.id}`);
    }

    this._imageryProviders.set(stack.id, provider);
    return provider;
  }

  _removeImageryLayers() {
    for (const layer of this._imageryLayers) {
      this.viewer.imageryLayers.remove(layer, false);
    }
    this._imageryLayers.length = 0;
  }

  /**
   * Sets the scene's terrain provider for the current globe stack.
   *
   * `enabled` selects Cesium World Terrain (ion token present — regime B,
   * unchanged). Disabled/keyless (regime C: OSM or any globe stack without an
   * ion token) now tries the keyless Re:Earth ellipsoidal terrain instead of
   * the flat `EllipsoidTerrainProvider`, falling back to the flat provider
   * (today's behavior) if construction fails — no worse than before this fix.
   *
   * `CesiumTerrainProvider.fromUrl()` is async (fetches `layer.json`), so this
   * method is async-safe: `gen` is the caller's switch generation (from
   * `setStack`'s `_switchGen`, threaded through `_activatePhotoreal` /
   * `_activateGlobeStack`, mirroring the M7 pattern in `_activateGlobeStack`
   * for imagery providers). If a newer switch starts while the Re:Earth
   * fetch is in flight, this call's result is discarded instead of
   * clobbering the newer switch's terrain.
   * @param {boolean} enabled
   * @param {number} [gen] — switch generation this call belongs to
   */
  async _setWorldTerrainEnabled(enabled, gen) {
    const targetMode = enabled ? 'world' : 'keyless';
    if (targetMode === this._terrainMode) return;
    if (enabled) {
      this.viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain({
        requestVertexNormals: true,
      }));
    } else {
      const provider = await this._getKeylessTerrainProvider();
      // A newer switch started while the Re:Earth layer.json fetch was in
      // flight — that call owns terrain now; don't stomp it (M7 pattern).
      if (gen != null && gen !== this._switchGen) return;
      this.viewer.terrainProvider = provider;
    }
    this._terrainMode = targetMode;
  }

  /**
   * Resolves (and caches) the keyless terrain provider for globe stacks
   * without an ion token: Re:Earth ellipsoidal quantized-mesh terrain, or
   * `EllipsoidTerrainProvider` (flat — current/prior behavior) if the
   * Re:Earth endpoint can't be constructed. Never throws.
   * @returns {Promise<Cesium.TerrainProvider>}
   */
  async _getKeylessTerrainProvider() {
    if (this._reearthTerrainProvider) return this._reearthTerrainProvider;
    if (this.ignTerrainSpike) {
      // Cached in the same slot as Re:Earth on purpose: the spike and the
      // shipped keyless provider are mutually exclusive for the whole session,
      // so one cache entry is the whole truth about what terrain is installed.
      this._reearthTerrainProvider = new IgnBilTerrainProvider();
      return this._reearthTerrainProvider;
    }
    try {
      this._reearthTerrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(REEARTH_TERRAIN_URL);
    } catch (error) {
      console.warn('[mapStackController] Re:Earth terrain unavailable, falling back to flat ellipsoid terrain:', error);
      this._reearthTerrainProvider = new Cesium.EllipsoidTerrainProvider();
    }
    return this._reearthTerrainProvider;
  }

  _emitChange(status) {
    this._onChange?.(this.getState(status));
  }
}
