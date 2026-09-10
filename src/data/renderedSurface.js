import * as Cesium from 'cesium';
import { visibleTilesetLoaded } from './meshFloorSampler.js';
import {
  PROVISIONAL_MAX_CAMERA_M,
  PROVISIONAL_MAX_M,
  PROVISIONAL_MIN_M,
} from './provisionalFloor.js';

/**
 * The height of the surface this app is ACTUALLY DRAWING at a coordinate —
 * under either map stack, not just the one where the globe is visible.
 *
 * ── The half-fix this module completes ──────────────────────────────────────
 * `addressScanLayer.js` already records why a marker has to be seated by hand:
 * `Cartesian3.fromDegrees(lon, lat)` puts it on the ELLIPSOID, tens of metres
 * under the street it describes, and because depth testing is disabled it is
 * still painted — just in the wrong place, sliding over the city as the camera
 * moves. That header is right, and the mechanism it describes reads
 * `globe.getHeight()`.
 *
 * `globe.getHeight()` answers from the terrain tiles the GLOBE has resident.
 * `main.js:215` sets `globe.show = keylessMode`, and `mapStackController.js:727`
 * hides it whenever the photorealistic stack is active — which is the DEFAULT
 * stack for anyone with a key. A hidden globe streams no tiles, so `getHeight`
 * returns `undefined` for every point, every seating pass is a no-op, and the
 * bug the seating exists to fix is fully present on the stack most readers are
 * looking at. Nothing throws and nothing logs; `seatPending` simply stays true
 * forever.
 *
 * MEASURED in the running app, 2026-09-10, Latin Quarter, camera nadir at
 * 420 m over Cardinal Lemoine, canvas 1400 × 900:
 *
 *   - every `idfm-network` stop drawn at ellipsoidal height 0.0 m, while
 *     `scene.sampleHeight` reads the rendered Google mesh under those same
 *     coordinates at **83.5 to 91.6 m**;
 *   - median on-screen error **140 px**, worst **272 px** — a stop marker
 *     landing two blocks from the stop;
 *   - a 250 m sideways pan slides a mark **up to 269 px** across the ground it
 *     is supposed to be nailed to. That is the reported symptom, exactly.
 *
 * ── What answers on the photoreal stack, and what it costs ──────────────────
 * `scene.sampleHeight()` reads the rendered geometry — the tileset skin — and
 * is the only thing that can answer when the globe is hidden. It is NOT free:
 * it forces a synchronous offscreen pick render. Measured on the same run,
 * headless SwiftShader: **6.28 ms per call**, 15 of 15 hits. That is the same
 * cost class `meshFloorSampler.js` and `groundSnap.js` already ration, and for
 * the same reason — it must never be called per frame, and never once per
 * marker without a budget.
 *
 * ── Two tiers, because the first one is 95 % of the win for 1/60th the cost ─
 * Over that whole viewport the mesh spanned 83.5 → 91.6 m: **8.1 m** of relief
 * across the Montagne Sainte-Geneviève, one of the steepest things inside the
 * Paris boulevards. So:
 *
 *   TIER 1 — ONE probe at the scan centre, spent on every scan, and handed to
 *   every marker in the box as its fallback. It converts an 85 m error into an
 *   8 m one, i.e. 272 px into ~13 px, for a single 6 ms call.
 *
 *   TIER 2 — a per-marker probe, budgeted at {@link SURFACE_SAMPLE_BUDGET} per
 *   pass and latched one-shot per marker, spent over the settle passes that
 *   follow. It removes the residual relief.
 *
 * A marker that has had its own reading is remembered in a WeakSet rather than
 * on a flag, so a re-scan that discards its entities discards the memory with
 * them and nothing has to be invalidated by hand.
 *
 * ── Its relation to `provisionalFloor.js`, which owns the same question ─────
 * PR #145 fixed this defect for the FIRMS detections and PR #150 extracted the
 * result into `provisionalFloor.js`, the shared store the layers that draw a
 * mark on cold ground read. Nothing that module already decided is decided
 * again here: {@link SURFACE_MIN_M}, {@link SURFACE_MAX_M} and
 * {@link SURFACE_MAX_CAMERA_HEIGHT_M} are ITS constants re-exported under this
 * module's own names, and the tiles-drained test both use belongs to
 * `meshFloorSampler.js`.
 *
 * What is NOT shared is the GRAIN, and that is the whole reason this file
 * exists rather than a call into that one. The store is keyed by ~111 m cell
 * and probes each cell at its CENTRE, which is right for a fire front
 * kilometres across and wrong for a stop: inside the boulevards a cell centre
 * lands on a ROOF as readily as on the pavement, and the photoreal mesh makes
 * no distinction — a probe that hits a Haussmannian roof answers twenty metres
 * high, and the one-shot latch would make that permanent under the stop. The
 * probe here is at the mark's OWN coordinate.
 *
 * The second difference is what is returned. That module answers a HEIGHT per
 * cell; this seats Cesium entities AND `PointPrimitive`s in place, which is
 * what `idfmNetwork.js` needs — it draws a billboard and a disc on every stop —
 * and what a height call cannot express on a primitive collection.
 *
 * ── Why not `HeightReference.CLAMP_TO_3D_TILE` ──────────────────────────────
 * Cesium 1.138 has it, and for a billboard it would be the native answer. Two
 * things rule it out as THE mechanism here. `addressScanLayer.js` measured
 * `CLAMP_TO_GROUND` making markers unpickable in this app — 30 points drawn,
 * `scene.pick` returning null at their own screen coordinate — and a stop you
 * cannot click is a worse defect than a stop drawn 8 m off. And
 * `PointPrimitive` carries no `heightReference` at all, so the frequency disc
 * collection could not use it even if the billboards over it could. One
 * mechanism that serves both beats two that each serve half. The 3D-tile
 * clamp also wants `tileset.enableCollision` and re-runs a height callback per
 * tile load, which is the wrong bill for a thousand static billboards.
 *
 * @module data/renderedSurface
 */

/**
 * Per-pass ceiling on {@link Cesium.Scene#sampleHeight} calls.
 *
 * 24 × 6.28 ms is ~150 ms of forced offscreen renders in the worst measured
 * case, on the slowest surface this app runs on (headless SwiftShader). It is
 * spent on a camera-settle or tile-settle pass, never on a frame, and a
 * viewport of 60 marks therefore seats fully within three passes.
 *
 * Deliberately below `meshFloorSampler.js`'s 40: that module probes ~111 m
 * CELLS and a viewport holds few of them, where this one probes MARKS and a
 * dense box holds hundreds.
 */
export const SURFACE_SAMPLE_BUDGET = 24;

/**
 * No sampling above this camera height.
 *
 * `provisionalFloor.js`'s ceiling, re-exported rather than restated: above it
 * the streamed LOD is coarse everywhere, so a probe latches a height that
 * belongs to a tile the reader will never see refined, and at that range a
 * ground error is worth well under a pixel anyway. Both IDFM regimes are
 * dormant well below it, so it is a guard for the siblings rather than for
 * them.
 */
export const SURFACE_MAX_CAMERA_HEIGHT_M = PROVISIONAL_MAX_CAMERA_M;

/**
 * Plausibility band for one probe, in ellipsoidal metres.
 *
 * `tilesLoaded` is the main guard and it is not the only one needed. Measured
 * by PR #145 on the fire detections: a probe against a tileset that had not
 * streamed returned **-11 838 m** — a real, finite, catastrophically wrong
 * number, and one that a one-shot latch would have made permanent. Same band,
 * same source: nothing this app draws sits below the Dead Sea shore or above
 * the summit of Everest, so a reading outside it is a malfunction rather than
 * a measurement, and it is refused instead of latched.
 */
export const SURFACE_MIN_M = PROVISIONAL_MIN_M;
export const SURFACE_MAX_M = PROVISIONAL_MAX_M;

/** Marks already seated on a reading of their OWN, not on a borrowed one. */
const _measured = new WeakSet();

const _scratch = new Cesium.Cartographic();
const _readScratch = new Cesium.Cartographic();

/**
 * True when the photorealistic tileset is the surface, so the globe cannot
 * answer for it.
 *
 * The same test every zonal layer already uses to pick a `ClassificationType`
 * (`bruitFrance.js`, `urbanismeGpu.js`, `surfaceFillNotice.js`): a hidden globe
 * means the tileset is the only surface left. Only an explicit `false` counts —
 * a torn-down viewer must fall to the path that touches nothing.
 *
 * @param {{globe?: {show?: boolean}}|null|undefined} scene
 * @returns {boolean}
 */
export function photorealSurface(scene) {
  return Boolean(scene?.globe) && scene.globe.show === false;
}

/**
 * True when the visible tileset has drained its streaming queue.
 *
 * `meshFloorSampler.js`'s test, not a copy of it: probing MID-STREAM returns
 * coarse-LOD heights — real numbers, wildly wrong — and a one-shot latch makes
 * those permanent. With no tileset in the scene it is false, because on that
 * stack the globe is the surface and nothing here should sample at all.
 *
 * @param {object|null|undefined} scene
 * @returns {boolean}
 */
export function photorealTilesReady(scene) {
  if (!scene?.primitives || typeof scene.primitives.get !== 'function') return false;
  return visibleTilesetLoaded(scene);
}

/**
 * True when this scene may be asked for a sample at all.
 * @param {object|null|undefined} scene
 * @returns {boolean}
 */
export function surfaceSamplingArmed(scene) {
  if (!photorealSurface(scene)) return false;
  if (typeof scene.sampleHeight !== 'function' || scene.sampleHeightSupported === false) return false;
  const cameraM = scene.camera?.positionCartographic?.height;
  if (!Number.isFinite(cameraM) || cameraM > SURFACE_MAX_CAMERA_HEIGHT_M) return false;
  return photorealTilesReady(scene);
}

/**
 * The height of the drawn surface at one point, or null when nothing can
 * answer for it yet.
 *
 * On a globe stack this is `globe.getHeight` — free, synchronous, the resident
 * triangles at the LOD they are being rendered at. On the photoreal stack it is
 * ONE `scene.sampleHeight`, and the caller owns the decision to spend it: this
 * function does no rationing of its own, because a budget shared silently
 * between five layers would be a budget nobody could reason about.
 *
 * @param {object|null|undefined} scene Cesium scene.
 * @param {number} lonRadians
 * @param {number} latRadians
 * @param {{sample?: boolean, exclude?: Array<object>, scratch?: object}} [options]
 *   `sample` false forbids the paid path and returns null on the photoreal
 *   stack rather than buying a probe.
 * @returns {?number} Ellipsoidal metres, or null.
 */
export function renderedSurfaceM(scene, lonRadians, latRadians, options = {}) {
  const { sample = true, exclude, scratch = _scratch } = options;
  if (!Number.isFinite(lonRadians) || !Number.isFinite(latRadians)) return null;
  scratch.longitude = lonRadians;
  scratch.latitude = latRadians;
  scratch.height = 0;
  if (photorealSurface(scene)) {
    if (!sample || !surfaceSamplingArmed(scene)) return null;
    let height;
    try {
      height = scene.sampleHeight(scratch, exclude);
    } catch {
      return null; // scene mid-teardown
    }
    if (!Number.isFinite(height)) return null;
    // A finite answer is not yet a measurement. See the band's own note.
    if (height < SURFACE_MIN_M || height > SURFACE_MAX_M) return null;
    return height;
  }
  const globe = scene?.globe;
  if (typeof globe?.getHeight !== 'function') return null;
  const height = globe.getHeight(scratch);
  return Number.isFinite(height) ? height : null;
}

/**
 * Read a mark's own longitude/latitude back off the position it was drawn with.
 * @param {object} cartesian
 * @returns {?object} Cartographic scratch, or null.
 */
function cartographicOf(cartesian) {
  if (!cartesian) return null;
  return Cesium.Cartographic.fromCartesian(cartesian, Cesium.Ellipsoid.WGS84, _readScratch) || null;
}

/**
 * Seat a run of marks on the drawn surface.
 *
 * `read`/`write` are the only thing that differs between a Cesium entity and a
 * `PointPrimitive`: one carries a `Property`, the other a bare `Cartesian3`.
 * Everything else — the two tiers, the budget, the one-shot latch, the epsilon
 * — is the same argument for both, so it is written once.
 *
 * @param {Iterable<object>} marks
 * @param {object} scene
 * @param {object} accessors `{ read(mark), write(mark, cartesian) }`
 * @param {{fallbackHeightM?: ?number, liftM?: number, epsilonM?: number,
 *   sampleBudget?: number, exclude?: Array<object>}} [options]
 * @returns {{moved: number, pending: number, sampled: number}}
 */
function seatMarks(marks, scene, accessors, options = {}) {
  const {
    fallbackHeightM = null,
    liftM = 0,
    epsilonM = 0.25,
    sampleBudget = SURFACE_SAMPLE_BUDGET,
    exclude,
  } = options;
  const result = { moved: 0, pending: 0, sampled: 0 };
  if (!marks || !scene) return result;
  const photoreal = photorealSurface(scene);
  const armed = photoreal ? surfaceSamplingArmed(scene) : typeof scene.globe?.getHeight === 'function';
  if (!armed && !Number.isFinite(fallbackHeightM)) {
    // Nothing can answer and there is nothing to borrow: report the debt so the
    // caller comes back, and leave every mark where it is rather than moving it
    // onto a number nobody measured.
    const cold = Cesium.JulianDate.now();
    for (const mark of marks) {
      if (!_measured.has(mark) && accessors.read(mark, cold)) result.pending += 1;
    }
    return result;
  }
  let budget = photoreal ? Math.max(0, sampleBudget) : Infinity;
  const now = Cesium.JulianDate.now();
  for (const mark of marks) {
    // Already standing on a reading of its own: nothing to buy and nothing to
    // move. The latch is one-shot because the probe is gated on `tilesLoaded`,
    // so the reading it took came from a settled LOD rather than a mid-stream
    // one — the same trade `meshFloorSampler.js` makes for its cells.
    if (_measured.has(mark)) continue;
    const position = accessors.read(mark, now);
    // A clamped polyline carries `polyline.positions` and no `position` of its
    // own. It is already on the ground; there is nothing here to seat.
    if (!position) continue;
    const carto = cartographicOf(position);
    if (!carto) continue;
    const current = carto.height;
    let ground = null;
    if (armed && budget > 0) {
      ground = renderedSurfaceM(scene, carto.longitude, carto.latitude, { exclude });
      if (photoreal) {
        budget -= 1;
        result.sampled += 1;
      }
      if (ground !== null) _measured.add(mark);
    }
    if (ground === null) {
      result.pending += 1;
      ground = fallbackHeightM;
    }
    if (!Number.isFinite(ground)) continue;
    const target = ground + liftM;
    if (Math.abs(target - current) <= epsilonM) continue;
    accessors.write(mark, Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, target));
    result.moved += 1;
  }
  return result;
}

const _entityAccessors = Object.freeze({
  read: (entity, now) => entity?.position?.getValue?.(now) || null,
  write: (entity, cartesian) => { entity.position = cartesian; },
});

const _pointAccessors = Object.freeze({
  read: (point) => point?.position || null,
  write: (point, cartesian) => { point.position = cartesian; },
});

/**
 * Seat Cesium entities on the drawn surface.
 * @param {Iterable<object>} entities
 * @param {object} scene
 * @param {object} [options] See {@link seatMarks}.
 * @returns {{moved: number, pending: number, sampled: number}}
 */
export function seatEntitiesOnSurface(entities, scene, options = {}) {
  return seatMarks(entities, scene, _entityAccessors, options);
}

/**
 * Seat `PointPrimitive`s on the drawn surface.
 * @param {Iterable<object>} points
 * @param {object} scene
 * @param {object} [options] See {@link seatMarks}.
 * @returns {{moved: number, pending: number, sampled: number}}
 */
export function seatPointsOnSurface(points, scene, options = {}) {
  return seatMarks(points, scene, _pointAccessors, options);
}

/** Forget every own-reading latch. Test seam; also correct after a stack flip. */
export function _forgetSurfaceMeasurements(marks) {
  if (!marks) return;
  for (const mark of marks) _measured.delete(mark);
}

/** Whether one mark has been seated on a reading of its own. Test seam. */
export function _surfaceMeasuredForTest(mark) {
  return _measured.has(mark);
}
