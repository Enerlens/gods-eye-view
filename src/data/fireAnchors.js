// src/data/fireAnchors.js — DEM ground anchors for rendered FIRMS detections
// (field finding 2026-07-21: at close/oblique zoom over high country,
// fire dots anchored at ellipsoid height 0 read as buried inside the terrain
// ~1-2 km below the visible surface).
//
// The fix rides the height-datum ship's machinery end to end: anchors read
// the SAME shared ground floor every other ground-adjacent consumer uses
// (groundFloor.cachedGroundFloor — rendered-mesh cell ?? real Re:Earth DEM
// cell), and cold cells warm through the same batched, chunked, cached
// resolver. Fires are static and floor cells latch warm for the session, so
// each rendered detection costs at most one DEM lookup EVER — and detections
// sharing a ~111 m coarse cell share that lookup.
//
// A second finding (2026-09-10) added the PROVISIONAL store below: the DEM
// answers over the network, and a detection painted before it answers sat at
// ellipsoid 0 — hundreds of metres under its own ground — where it slid over
// the landscape with every camera move. Cold cells now get one budgeted
// `scene.sampleHeight` read of the surface actually being drawn, so a sprite
// is on the ground from its first frame; the DEM still refines it. Sampling
// is bounded (≤40 probes per render pass, only under a low camera, one entry
// per coarse cell) and never touches the shared floor cache.
import * as Cesium from 'cesium';
import { cachedGroundFloor, coarseFloorCoord, resolveGroundFloorCells } from './groundFloor.js';
import { visibleTilesetLoaded } from './meshFloorSampler.js';

/** @constant {number} Metres above the resolved floor for a fire anchor.
 *  The DEM is bare earth while the fire glow represents a 375 m VIIRS pixel;
 *  a few metres of lift biases "slightly above the visible surface" (owner
 *  principle) without a visible hover on the screen-sized sprite. */
export const FIRE_ANCHOR_LIFT_M = 5;

/**
 * Synchronous anchor height for one detection: shared ground floor + lift
 * when the floor is warm, the PROVISIONAL rendered-surface floor when it is
 * not (see below), else 0. Warm-cache read only; never triggers network or
 * sampling — {@link sampleFireAnchorFloors} is what fills the provisional
 * store, once per render pass, under the caller's control.
 * @param {number} lat
 * @param {number} lon
 * @returns {number} Ellipsoidal anchor height in metres.
 */
export function fireAnchorHeight(lat, lon) {
  const floor = cachedGroundFloor(lat, lon);
  if (floor != null) return floor + FIRE_ANCHOR_LIFT_M;
  const provisional = provisionalFireFloor(lat, lon);
  return provisional != null ? provisional + FIRE_ANCHOR_LIFT_M : 0;
}

// --- Provisional rendered-surface floors (field finding 2026-09-10) --------
//
// WHY THE DEM ALONE IS NOT ENOUGH. `warmFireAnchorFloors` below resolves a
// detection's floor over the network, and until it answers `fireAnchorHeight`
// returns 0 — the WGS84 ellipsoid. Measured in the running app over the
// Chiapas fires: every sprite in the view was painted at height 0 for the
// first ~0.5-1 s and then jumped to 293.2 m. A sprite 293 m under the ground
// it belongs to is not attached to that ground: depth testing is disabled, so
// it is still painted, and its screen position is then a function of the
// CAMERA POSE. Drag the map and the dots slide across the landscape and
// resettle — the reported "the fires move with the map instead of staying
// fixed on it". It recurs on every patch of ground a session has not visited
// yet, which is exactly the ground someone panning around is looking at.
//
// The fix is to place a detection on the surface being DRAWN under it from
// its first frame. `scene.sampleHeight` reads that surface directly (the
// photoreal mesh in the google-3d regime), synchronously, with no network of
// our own — and the DEM refines each anchor to its own cell when it lands
// (measured agreement between the two: mesh - DEM = +1.2 m mean over nine
// points of Landes pine forest, -1.3 m at Bordeaux).
//
// WHY THIS DOES NOT GO THROUGH `meshFloorSampler.js`. That module feeds the
// SHARED floor cache, and it refuses to latch a sample without a real DEM
// prior to check it against — a rule bought with a measurement (a coarse-LOD
// probe read 20.6 m for ground that is really ~122 m, and the one-shot latch
// made it permanent). The cold case here is precisely "no prior yet", so
// nothing this store holds is allowed anywhere near that cache: it is layer-
// local, it is always overridden by the DEM, and every entry records what it
// could see when it was taken so a later pass can improve on it.

/** @constant {number} Rendered-surface probes allowed per render pass. Small
 *  on purpose: `scene.sampleHeight` is a CPU ray-cast against loaded tile
 *  geometry, and this runs on the render path, not on a poll. */
export const FIRE_PROVISIONAL_MAX_PROBES = 40;
/** @constant {number} No provisional sampling above this camera height: the
 *  streamed LOD under a high camera is coarse everywhere, and at that range a
 *  ground-height error is worth well under a pixel anyway. */
export const FIRE_PROVISIONAL_MAX_CAMERA_M = 25_000;
/** @constant {number} Plausible ellipsoidal band for a rendered-surface
 *  sample. This is the junk guard, and it is not theoretical: probing a
 *  tileset that had not streamed returned -11 838 m in this app's own
 *  headless run. Bounds are the Dead Sea shore and above Everest, both with
 *  room for the geoid. */
export const FIRE_PROVISIONAL_MIN_M = -500;
export const FIRE_PROVISIONAL_MAX_M = 9_500;
/** @constant {number} How far, in km, a cell the probe budget did not reach
 *  may borrow a sampled floor from. Detections in one complex stand on one
 *  hillside; beyond this they do not, and 0 is the honest answer again. */
export const FIRE_PROVISIONAL_FILL_KM = 25;
/** @constant {number} Cap on stored cells. Entries are dropped as their DEM
 *  lands, but a long session flying over fires it never renders again would
 *  otherwise accumulate; the whole store is provisional, so clearing it costs
 *  at most one re-probe. */
export const FIRE_PROVISIONAL_MAX_CELLS = 4_000;

/**
 * Provisional floors, one per coarse cell. `height: null` is a recorded MISS —
 * a probe that found nothing streamed under the cell — kept so the same 40
 * cells are not paid for again on every rebuild.
 * @type {Map<string, {height: ?number, camHeightM: number, drained: boolean, borrowed: boolean}>}
 */
const _provisional = new Map();
const _scratchProbe = new Cesium.Cartographic();

/** @returns {?number} Provisional ellipsoidal floor for a cell, or null —
 *  which is also the answer for a cell that was probed and found nothing. */
export function provisionalFireFloor(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const c = coarseFloorCoord(lat, lon);
  return _provisional.get(`${c.lat},${c.lon}`)?.height ?? null;
}

/**
 * Fill the provisional store for a rendered detection set.
 *
 * Synchronous, allocation-light and budget-capped — call it ONCE per render
 * pass, before the anchors are read. Cells whose DEM floor is already warm
 * are skipped (and their provisional entry dropped: the DEM owns them now).
 * The remaining cells are probed nearest-camera-first until the budget runs
 * out; whatever the budget did not reach borrows the nearest probed floor
 * within FIRE_PROVISIONAL_FILL_KM, because one fire complex stands on one
 * hillside and its relief is metres where the ellipsoid is hundreds.
 *
 * Every entry remembers the camera height it was taken at and whether the
 * visible tileset had drained, so a later pass re-probes exactly the entries
 * it can now do better than: borrowed ones, ones read mid-stream, and ones
 * read from more than twice the current camera height.
 *
 * @param {Cesium.Scene|undefined} scene - The scene (skipped when absent).
 * @param {Array<{lat: number, lon: number}>} points - Rendered detections.
 * @returns {{probes: number, pending: number}} Probes actually spent, and how
 *   many cells a LATER pass could still do better on — the caller's cue that
 *   coming back once the tiles land is worth a re-render. See
 *   {@link countPending}: grounded is not the same as grounded WELL.
 */
export function sampleFireAnchorFloors(scene, points) {
  if (!scene || typeof scene.sampleHeight !== 'function') return noSampling(points);
  if (!Array.isArray(points) || !points.length) return { probes: 0, pending: 0 };
  const camCarto = scene.camera?.positionCartographic;
  const camHeightM = camCarto?.height;
  if (!Number.isFinite(camHeightM) || camHeightM > FIRE_PROVISIONAL_MAX_CAMERA_M) {
    // Above the ceiling a ground-height error is worth well under a pixel, so
    // there is nothing pending in any sense the caller should act on.
    return { probes: 0, pending: 0 };
  }
  // NOT a hard gate (unlike meshFloorSampler's): a mid-stream probe that
  // survives the plausibility band still beats the ellipsoid by two orders of
  // magnitude, and it is re-probed the moment the tiles drain.
  const drained = visibleTilesetLoaded(scene);

  const cells = collectProvisionalCells(points);
  if (!cells.length) return { probes: 0, pending: 0 };
  orderByCameraDistance(cells, camCarto);

  const probed = [];
  let probes = 0;
  for (const cell of cells) {
    const key = `${cell.lat},${cell.lon}`;
    const entry = _provisional.get(key);
    if (!shouldReprobe(entry, camHeightM, drained)) {
      if (entry.height != null) probed.push({ lat: cell.lat, lon: cell.lon, height: entry.height });
      continue;
    }
    if (probes >= FIRE_PROVISIONAL_MAX_PROBES) continue;
    probes += 1;
    let height = null;
    try {
      height = scene.sampleHeight(
        Cesium.Cartographic.fromDegrees(cell.lon, cell.lat, 0, _scratchProbe),
      );
    } catch {
      continue; // scene mid-teardown — nothing recorded, the next pass retries
    }
    // A miss is RECORDED, not forgotten: nothing is streamed under this cell
    // yet, and a forgotten miss would spend the same 40 probes on the same 40
    // cells on every rebuild while the ones behind them never got a turn.
    // `shouldReprobe` retries it as soon as the conditions can beat it.
    if (!Number.isFinite(height)
      || height < FIRE_PROVISIONAL_MIN_M || height > FIRE_PROVISIONAL_MAX_M) {
      setProvisional(key, { height: null, camHeightM, drained, borrowed: false });
      continue;
    }
    setProvisional(key, { height, camHeightM, drained, borrowed: false });
    probed.push({ lat: cell.lat, lon: cell.lon, height });
  }

  if (probed.length) fillFromNearest(cells, probed, camHeightM, drained);
  return { probes, pending: countPending(cells) };
}

/** Nothing could be sampled at all — report what is still owed anyway. */
function noSampling(points) {
  if (!Array.isArray(points) || !points.length) return { probes: 0, pending: 0 };
  return { probes: 0, pending: countPending(collectProvisionalCells(points)) };
}

/**
 * Cells a LATER pass could still do better on: no floor of any kind, a
 * borrowed one, or a read taken while the tiles were mid-stream.
 *
 * GROUNDED IS NOT GROUNDED WELL, and this is the number that says so. Probing
 * a tileset that has not drained returns the coarse tile that IS loaded —
 * measured 76 m over ground the drained mesh reads at 293 m. That is four
 * times better than the ellipsoid and still 217 m wrong, and unlike a cell
 * left at height 0 it leaves no trace the caller could notice. Counting it as
 * owed is what brings the layer back when the tiles land.
 * @param {Array<{lat: number, lon: number}>} cells - Coarse cells.
 * @returns {number}
 */
function countPending(cells) {
  let pending = 0;
  for (const cell of cells) {
    if (cachedGroundFloor(cell.lat, cell.lon) != null) continue; // the DEM settled it
    const entry = _provisional.get(`${cell.lat},${cell.lon}`);
    if (!entry || entry.borrowed || entry.height == null || !entry.drained) pending += 1;
  }
  return pending;
}

/** Coarse cells behind `points` that the DEM has not answered, deduped. */
function collectProvisionalCells(points) {
  const cells = new Map();
  for (const p of points) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
    const c = coarseFloorCoord(p.lat, p.lon);
    const key = `${c.lat},${c.lon}`;
    if (cells.has(key)) continue;
    if (cachedGroundFloor(p.lat, p.lon) != null) {
      _provisional.delete(key); // the DEM landed — this entry is dead weight
      continue;
    }
    cells.set(key, c);
  }
  return [...cells.values()];
}

/** Sorts cells nearest-camera-first, in place. No-ops without a subpoint. */
function orderByCameraDistance(cells, camCarto) {
  if (!Number.isFinite(camCarto?.latitude) || !Number.isFinite(camCarto?.longitude)) return;
  const lat = Cesium.Math.toDegrees(camCarto.latitude);
  const lon = Cesium.Math.toDegrees(camCarto.longitude);
  cells.sort((a, b) => approxKm(lat, lon, a.lat, a.lon) - approxKm(lat, lon, b.lat, b.lon));
}

/**
 * Whether a stored entry can be improved on under the current conditions.
 * A borrowed floor is a stand-in for a read that never happened, so it is
 * always worth one; a real read (or a recorded miss) is only worth repeating
 * when this pass can see better than the one that took it.
 */
function shouldReprobe(entry, camHeightM, drained) {
  if (!entry) return true;
  if (entry.borrowed) return true;            // a real read beats a borrowed one
  if (drained && !entry.drained) return true; // taken mid-stream, tiles are in now
  return camHeightM * 2 <= entry.camHeightM;  // twice as close: finer tiles
}

/** Gives every unprobed cell the nearest probed floor within the fill radius. */
function fillFromNearest(cells, probed, camHeightM, drained) {
  for (const cell of cells) {
    const key = `${cell.lat},${cell.lon}`;
    const entry = _provisional.get(key);
    if (entry && !entry.borrowed && entry.height != null) continue;
    let best = null;
    let bestKm = Infinity;
    for (const p of probed) {
      const km = approxKm(cell.lat, cell.lon, p.lat, p.lon);
      if (km < bestKm) { bestKm = km; best = p; }
    }
    if (!best || bestKm > FIRE_PROVISIONAL_FILL_KM) continue;
    if (entry && entry.height === best.height) continue;
    setProvisional(key, { height: best.height, camHeightM, drained, borrowed: true });
  }
}

/** Writes one entry, evicting oldest-first at the cap. */
function setProvisional(key, entry) {
  _provisional.delete(key);
  _provisional.set(key, entry);
  while (_provisional.size > FIRE_PROVISIONAL_MAX_CELLS) {
    const oldest = _provisional.keys().next();
    if (oldest.done) break;
    _provisional.delete(oldest.value);
  }
}

/** Equirectangular distance in km — the approximation every floor consumer uses. */
function approxKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLon);
}

/** @type {?Promise<boolean>} Tail of the batch chain — batches run strictly
 *  sequentially so overlapping renders can't stack concurrent requests on
 *  the single dev-server proxy (same courtesy as terrainHeights' sequential
 *  chunking). Each queued batch re-filters against the warm cache when it
 *  actually runs, so cells resolved by an earlier batch are never refetched. */
let _chain = null;

/**
 * Batched warm of the ground-floor cells behind a rendered detection set.
 * Fire-and-forget safe (never rejects). Resolves `true` only when at least
 * one requested point actually gained a warm floor — a failed resolve (proxy
 * down caches only geoid fallbacks, which do NOT count as a floor) resolves
 * `false`, so a render → warm → re-render chain terminates instead of
 * looping; the next natural rebuild retries and the cache self-heals.
 * @param {Array<{lat: number, lon: number}>} points - Rendered detections.
 * @returns {Promise<boolean>} Whether any requested point warmed.
 */
export function warmFireAnchorFloors(points) {
  const cold = collectCold(points);
  if (!cold.length) return Promise.resolve(false);
  const prev = _chain;
  const run = prev ? prev.then(() => resolveBatch(cold)) : resolveBatch(cold);
  _chain = run.then(() => true, () => false);
  return run;
}

/** @returns {Array<{lat: number, lon: number}>} Points with no warm floor. */
function collectCold(points) {
  if (!Array.isArray(points)) return [];
  const cold = [];
  for (const p of points) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
    if (cachedGroundFloor(p.lat, p.lon) != null) continue;
    cold.push({ lat: p.lat, lon: p.lon });
  }
  return cold;
}

/** Resolves one batch (re-filtered at run time) and reports whether it warmed anything. */
async function resolveBatch(points) {
  const cold = points.filter((p) => cachedGroundFloor(p.lat, p.lon) == null);
  if (!cold.length) return false;
  try {
    await resolveGroundFloorCells(cold);
  } catch { /* resolver is best-effort and never throws; belt and braces */ }
  return cold.some((p) => cachedGroundFloor(p.lat, p.lon) != null);
}

/** Test hook: drops the batch chain and the provisional store (the DEM
 *  caches live in groundFloor/terrainHeights). */
export function _resetFireAnchorsForTest() {
  _chain = null;
  _provisional.clear();
}
