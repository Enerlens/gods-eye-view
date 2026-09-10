// src/data/provisionalFloor.js — provisional rendered-surface ground floors
// (field finding 2026-09-10, generalised from `fireAnchors.js` 2026-09-10).
//
// WHY THE DEM ALONE IS NOT ENOUGH. `groundFloor.js` resolves a point's floor
// over the NETWORK, and until it answers a sprite anchored on it sits at
// ellipsoid 0 — hundreds of metres under its own ground. Every layer that
// draws with `disableDepthTestDistance` still PAINTS such a sprite (that flag
// exists so a marker is not swallowed by the kerb it stands on), and a sprite
// that is not on the ground has a screen position that is a function of the
// CAMERA POSE. Drag the map and the marks slide across the landscape, then
// jump into place when the DEM lands. It recurs on every patch of ground a
// session has not visited yet — which is exactly the ground someone panning
// around is looking at.
//
// Measured over the Chiapas fires: every sprite in view spent its first
// ~0.5-1 s at height 0 and then jumped to 293.2 m.
//
// The fix is to place a point on the surface being DRAWN under it from its
// first frame. `scene.sampleHeight` reads that surface directly (the photoreal
// mesh in the google-3d regime), synchronously, with no network of our own —
// and the DEM refines each anchor to its own cell when it lands (measured
// agreement between the two: mesh - DEM = +1.2 m mean over nine points of
// Landes pine forest, -1.3 m at Bordeaux).
//
// WHY THIS DOES NOT GO THROUGH `meshFloorSampler.js`. That module feeds the
// SHARED floor cache, and it refuses to latch a sample without a real DEM
// prior to check it against — a rule bought with a measurement (a coarse-LOD
// probe read 20.6 m for ground that is really ~122 m, and the one-shot latch
// made it permanent). The cold case here is precisely "no prior yet", so
// nothing this store holds is allowed anywhere near that cache: it is
// provisional, it is always overridden by the DEM, and every entry records
// what it could see when it was taken so a later pass can improve on it.
//
// ONE STORE, KEYED BY CELL, SHARED BY EVERY CALLER. A ~111 m cell of ground is
// the same ground whichever layer asked about it, so a probe paid for by the
// fires is read for free by the shared vehicles parked on the same street.
// Callers differ only in the three knobs `sampleProvisionalFloors` takes.
import * as Cesium from 'cesium';
import { cachedGroundFloor, coarseFloorCoord } from './groundFloor.js';
import { visibleTilesetLoaded } from './meshFloorSampler.js';

/** @constant {number} Rendered-surface probes allowed per pass. Small on
 *  purpose: `scene.sampleHeight` is a CPU ray-cast against loaded tile
 *  geometry, and callers run this on the render path, not on a poll. */
export const PROVISIONAL_MAX_PROBES = 40;
/** @constant {number} No provisional sampling above this camera height: the
 *  streamed LOD under a high camera is coarse everywhere, and at that range a
 *  ground-height error is worth well under a pixel anyway. */
export const PROVISIONAL_MAX_CAMERA_M = 25_000;
/** @constant {number} Plausible ellipsoidal band for a rendered-surface
 *  sample. This is the junk guard, and it is not theoretical: probing a
 *  tileset that had not streamed returned -11 838 m in this app's own
 *  headless run. Bounds are the Dead Sea shore and above Everest, both with
 *  room for the geoid. */
export const PROVISIONAL_MIN_M = -500;
export const PROVISIONAL_MAX_M = 9_500;
/** @constant {number} Default distance, in km, a cell the probe budget did not
 *  reach may borrow a sampled floor from. Detections in one fire complex stand
 *  on one hillside; beyond this they do not, and 0 is the honest answer again.
 *  A street-scale caller passes something tighter. */
export const PROVISIONAL_FILL_KM = 25;
/** @constant {number} Cap on stored cells. Entries are dropped as their DEM
 *  lands, but a long session flying over ground it never renders again would
 *  otherwise accumulate; the whole store is provisional, so clearing it costs
 *  at most one re-probe. */
export const PROVISIONAL_MAX_CELLS = 4_000;

/** @constant {number} First deferred retry delay (ms). */
export const PROVISIONAL_RETRY_MS = 1200;
/** @constant {number} Deferred retries a caller may spend on one situation. */
export const PROVISIONAL_MAX_RETRIES = 5;

/**
 * Delay before the nth deferred retry, or null once the budget is spent.
 *
 * Doubling rather than fixed: the thing being waited for is a tile stream,
 * which either lands in the first second or takes ten, and a parked camera
 * must be woken a bounded number of times whatever happens. Five doubling
 * tries are five single frames spread over ~37 s — long enough for a cold
 * stream (measured 8.7 s and 11.7 s headless, where a first cut that stopped
 * at 8.4 s lost the race), short enough that nothing is waiting on it. Ground
 * with no photoreal coverage must not keep waking a parked camera, so the
 * budget refills only when the situation is NEW (the camera moved, a fresh
 * payload arrived) — never on its own. The DEM warm runs underneath.
 * @param {number} attempt - Retries already spent for this situation.
 * @returns {?number} Milliseconds to wait, or null for "stop asking".
 */
export function provisionalFloorRetryDelayMs(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= PROVISIONAL_MAX_RETRIES) return null;
  return PROVISIONAL_RETRY_MS * (2 ** attempt);
}

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
export function provisionalFloor(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const c = coarseFloorCoord(lat, lon);
  return _provisional.get(`${c.lat},${c.lon}`)?.height ?? null;
}

/**
 * Fill the provisional store for a rendered point set.
 *
 * Synchronous, allocation-light and budget-capped — call it ONCE per render
 * pass, before the anchors are read. Cells whose DEM floor is already warm
 * are skipped (and their provisional entry dropped: the DEM owns them now).
 * The remaining cells are probed nearest-camera-first until the budget runs
 * out; whatever the budget did not reach borrows the nearest probed floor
 * within `fillKm`, because points in one complex — one hillside, one city
 * basin — share a relief measured in metres where the ellipsoid is wrong by
 * hundreds.
 *
 * Every entry remembers the camera height it was taken at and whether the
 * visible tileset had drained, so a later pass re-probes exactly the entries
 * it can now do better than: borrowed ones, ones read mid-stream, and ones
 * read from more than twice the current camera height.
 *
 * @param {Cesium.Scene|undefined} scene - The scene (skipped when absent).
 * @param {Array<{lat: number, lon: number}>} points - Rendered points.
 * @param {{maxProbes?: number, maxCameraM?: number, fillKm?: number}} [options]
 * @returns {{probes: number, pending: number}} Probes actually spent, and how
 *   many cells a LATER pass could still do better on — the caller's cue that
 *   coming back once the tiles land is worth a re-render. See
 *   {@link countPending}: grounded is not the same as grounded WELL.
 */
export function sampleProvisionalFloors(scene, points, options = {}) {
  const maxProbes = Number.isFinite(options.maxProbes)
    ? Math.max(0, Math.floor(options.maxProbes)) : PROVISIONAL_MAX_PROBES;
  const maxCameraM = Number.isFinite(options.maxCameraM)
    ? options.maxCameraM : PROVISIONAL_MAX_CAMERA_M;
  const fillKm = Number.isFinite(options.fillKm) ? options.fillKm : PROVISIONAL_FILL_KM;

  if (!scene || typeof scene.sampleHeight !== 'function') return noSampling(points);
  if (!Array.isArray(points) || !points.length) return { probes: 0, pending: 0 };
  const camCarto = scene.camera?.positionCartographic;
  const camHeightM = camCarto?.height;
  if (!Number.isFinite(camHeightM) || camHeightM > maxCameraM) {
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
    if (probes >= maxProbes) continue;
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
      || height < PROVISIONAL_MIN_M || height > PROVISIONAL_MAX_M) {
      setProvisional(key, { height: null, camHeightM, drained, borrowed: false });
      continue;
    }
    setProvisional(key, { height, camHeightM, drained, borrowed: false });
    probed.push({ lat: cell.lat, lon: cell.lon, height });
  }

  if (probed.length) fillFromNearest(cells, probed, camHeightM, drained, fillKm);
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
function fillFromNearest(cells, probed, camHeightM, drained, fillKm) {
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
    if (!best || bestKm > fillKm) continue;
    if (entry && entry.height === best.height) continue;
    setProvisional(key, { height: best.height, camHeightM, drained, borrowed: true });
  }
}

/** Writes one entry, evicting oldest-first at the cap. */
function setProvisional(key, entry) {
  _provisional.delete(key);
  _provisional.set(key, entry);
  while (_provisional.size > PROVISIONAL_MAX_CELLS) {
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

/** Test hook: drops the provisional store (the DEM caches live in
 *  groundFloor/terrainHeights and are not this module's to clear). */
export function _resetProvisionalFloorsForTest() {
  _provisional.clear();
}
