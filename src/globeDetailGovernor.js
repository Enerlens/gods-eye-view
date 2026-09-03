/**
 * Globe detail while the camera is in motion.
 *
 * THE PROBLEM. Cesium refines imagery and terrain until the on-screen error
 * falls under `Globe.maximumScreenSpaceError` — every frame, including the
 * frames of a fly-to nobody is reading. The intro flight is four seconds of
 * descent over one point (`flyToDefaultCity`), so the globe refines to full
 * detail at every altitude it passes through and discards each level a moment
 * later. Measured on a cold boot of the shipped build: 178 OSM tiles spread
 * across z1–z17 and 190 terrain tiles across z0–z14, 11.8 MB between them, for
 * a final view that needs a fraction of it. Only four of those tiles arrive
 * before the app is ready; the rest are the descent and its wake.
 *
 * THE FIX. Raise the error tolerance while the camera moves — a coarser tile is
 * good enough for a frame that is about to be replaced — and restore it the
 * moment the camera settles, so the frames someone actually reads are as sharp
 * as they ever were. The settled value is Cesium's own default, untouched: this
 * governor never makes a still image worse, it only declines to perfect the
 * ones in between.
 *
 * WHY A MOTION HOOK AND NOT A CONSTANT. Lowering detail globally would trade
 * the thing the app is for. Motion is the only window where the trade is free,
 * because the pixels are transient by construction.
 *
 * INTERACTION WITH THE RENDER GOVERNOR. `src/renderGovernor.js` can leave the
 * scene in `requestRenderMode`, where a mutation that nobody announces is a
 * mutation that never paints. Changing the error tolerance is exactly such a
 * mutation, so the restore explicitly requests the frame that re-refines.
 *
 * WHY THERE IS A STALL GUARD. The trade above assumes `moveEnd` always follows
 * `moveStart`. It does not. A flight cancelled mid-air (`camera.cancelFlight()`,
 * which the share-link restore calls), a viewer torn down mid-move, or a scene
 * that stops painting under `requestRenderMode`, all leave the start without its
 * end — and the globe stays pinned at the coarse tolerance for the REST OF THE
 * SESSION. Reported from the field as "it goes to a less sharp version and never
 * comes back".
 *
 * The guard is deliberately NOT a plain timeout on `moveStart`. A timeout can
 * only be wrong in one of two directions: short enough to catch a stall and it
 * fires in the middle of the four-second intro flight or an orbit that runs for
 * minutes; long enough to spare those and it leaves the globe blurred for as
 * long. So the guard asks the only question that actually distinguishes the two
 * cases — HAS THE CAMERA MOVED SINCE THE LAST TICK. A pose that is bit-identical
 * one full interval later is a camera that has stopped without saying so, and it
 * gets its sharpness back; a pose that is still changing re-arms and keeps the
 * saving for as long as the motion really lasts. The restore is idempotent, so a
 * real `moveEnd` arriving afterwards costs nothing.
 */
import { governorRequestRender } from './renderGovernor.js';

/**
 * Error tolerance while the camera is moving, as a multiple of the settled
 * value. 2× halves the tiles a descent asks for at each level it passes and is
 * invisible at fly-to speed; higher starts to show as a coarse frame at the
 * moment the camera stops, before the refine lands.
 */
export const MOVING_SSE_MULTIPLIER = 2;

/**
 * How long a camera pose may stay bit-identical before the governor concludes
 * the move ended without saying so. Two seconds is far longer than any gap
 * between two frames of real motion and far shorter than a reader would spend
 * wondering why the globe went soft.
 */
export const STALL_GUARD_MS = 2000;

let _viewer = null;
let _settledSse = null;
let _removeStart = null;
let _removeEnd = null;
/** True while the coarse tolerance is applied — makes the restore idempotent. */
let _relaxed = false;
let _stallTimer = null;
let _stallPose = null;
let _stallGuardMs = STALL_GUARD_MS;
/** Stall-guard trips this session, for diagnostics and the QA harness. */
let _stallRecoveries = 0;

/**
 * A camera pose as a comparable string. Raw component reads only — no matrix
 * math, no allocation beyond the string — because this runs on a timer for as
 * long as the camera is moving.
 * @param {object} camera - Cesium camera.
 * @returns {string}
 */
function poseKey(camera) {
  const p = camera?.position;
  const d = camera?.direction;
  if (!p || !d) return '';
  return `${p.x},${p.y},${p.z},${d.x},${d.y},${d.z}`;
}

function stopStallGuard() {
  if (_stallTimer !== null) { clearInterval(_stallTimer); _stallTimer = null; }
  _stallPose = null;
}

/**
 * Put the settled tolerance back. Idempotent: only the transition out of the
 * relaxed state asks for a frame.
 * @param {string} reason - Diagnostics label for the render request.
 * @returns {void}
 */
function restoreSettled(reason) {
  stopStallGuard();
  if (!_relaxed) return;
  _relaxed = false;
  const globe = _viewer?.scene?.globe;
  if (!globe || _settledSse === null) return;
  globe.maximumScreenSpaceError = _settledSse;
  // In requestRenderMode the settle is the last frame; without this the
  // globe would stay at the coarse tolerance until something else painted.
  governorRequestRender(reason);
}

/**
 * Install the governor on a viewer. Idempotent.
 * @param {Cesium.Viewer} viewer
 * @param {{movingMultiplier?: number, stallGuardMs?: number}} [options]
 * @returns {void}
 */
export function installGlobeDetailGovernor(viewer, options = {}) {
  const globe = viewer?.scene?.globe;
  const camera = viewer?.camera;
  if (!globe || !camera?.moveStart || !camera?.moveEnd) return;
  if (_viewer === viewer) return;
  uninstallGlobeDetailGovernor();

  const multiplier = Number.isFinite(options.movingMultiplier)
    ? options.movingMultiplier
    : MOVING_SSE_MULTIPLIER;
  _stallGuardMs = Number.isFinite(options.stallGuardMs) && options.stallGuardMs > 0
    ? options.stallGuardMs
    : STALL_GUARD_MS;
  _viewer = viewer;
  // Captured, never assumed: another module (or a future quality control) may
  // own the settled value, and this governor must hand back whatever it found.
  _settledSse = globe.maximumScreenSpaceError;
  _relaxed = false;
  _stallRecoveries = 0;

  _removeStart = camera.moveStart.addEventListener(() => {
    globe.maximumScreenSpaceError = _settledSse * multiplier;
    _relaxed = true;
    armStallGuard(camera);
  });
  _removeEnd = camera.moveEnd.addEventListener(() => {
    restoreSettled('globe-detail-settled');
  });
}

/**
 * (Re)start the stall poll for the current move. A second `moveStart` inside one
 * gesture must not stack timers.
 * @param {object} camera - Cesium camera.
 * @returns {void}
 */
function armStallGuard(camera) {
  stopStallGuard();
  if (!(_stallGuardMs > 0) || typeof setInterval !== 'function') return;
  const pose = poseKey(camera);
  // A camera whose pose cannot be sampled cannot be told apart from a stalled
  // one, and a guard that fires on every move would undo the whole saving. No
  // sample, no guard — exactly the pre-guard behaviour.
  if (!pose) return;
  _stallPose = pose;
  _stallTimer = setInterval(() => {
    const now = poseKey(camera);
    if (now !== _stallPose) { _stallPose = now; return; }
    // A full interval without a single component changing: the move is over and
    // its `moveEnd` is never coming.
    _stallRecoveries += 1;
    restoreSettled('globe-detail-stall-guard');
  }, _stallGuardMs);
  // Node and browsers both offer unref only on Node's Timeout; a poll that
  // outlives the page is not a thing, but a poll that holds a test process open
  // is, so drop the ref where it exists.
  _stallTimer?.unref?.();
}

/** Remove the listeners and restore the settled tolerance. Safe when absent. */
export function uninstallGlobeDetailGovernor() {
  if (_removeStart) { _removeStart(); _removeStart = null; }
  if (_removeEnd) { _removeEnd(); _removeEnd = null; }
  stopStallGuard();
  if (_viewer?.scene?.globe && _settledSse !== null) {
    _viewer.scene.globe.maximumScreenSpaceError = _settledSse;
  }
  _viewer = null;
  _settledSse = null;
  _relaxed = false;
}

/**
 * @returns {{installed: boolean, settledSse: number|null, currentSse: number|null,
 *   relaxed: boolean, stallGuardArmed: boolean, stallRecoveries: number}}
 */
export function getGlobeDetailDiagnostics() {
  return {
    installed: Boolean(_viewer),
    settledSse: _settledSse,
    currentSse: _viewer?.scene?.globe?.maximumScreenSpaceError ?? null,
    relaxed: _relaxed,
    stallGuardArmed: _stallTimer !== null,
    stallRecoveries: _stallRecoveries,
  };
}
