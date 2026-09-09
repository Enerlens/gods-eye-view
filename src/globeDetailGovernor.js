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
 * THE ECHO, AND WHY THE RESOLUTION TRADE NEEDS ONE MORE GUARD THAN THE
 * TOLERANCE DOES. Cesium does not publish `moveStart` from an input handler; it
 * derives it in `View.checkForCameraUpdates`, by comparing this frame's camera
 * to last frame's — AND THAT COMPARISON INCLUDES THE FRUSTUM. Changing
 * `resolutionScale` resizes the drawing buffer, which changes
 * `frustum.aspectRatio` by a rounding error (1366/768 = 1.778646, 1092/614 =
 * 1.778502), which Cesium reads as the camera having moved.
 *
 * Implemented naively, that is a loop with no exit: `moveEnd` restores the
 * resolution, the restore changes the aspect ratio, the aspect ratio raises
 * `moveStart`, `moveStart` drops the resolution again. Measured on the shipped
 * build before this guard: a 535 ms move / 16 ms rest cycle, FOREVER, on a
 * parked camera over Paris — the globe pinned at the coarse tolerance, the
 * render governor never parking the scene, and the picture pulsing between two
 * resolutions. The exact opposite of what the light profile is for, on exactly
 * the machines it is for.
 *
 * The guard is one line of the right question: a move that did not change the
 * camera's POSITION OR DIRECTION did not move the camera. The pose is recorded
 * at each restore and compared at each `moveStart`; an identical pose is the
 * governor hearing its own echo, and it is ignored. A frustum-only change from
 * somewhere else (a field-of-view control, were one added) is ignored too,
 * which errs toward the settled tolerance — the direction that never makes a
 * still frame worse.
 *
 * The stall guard is deliberately NOT a plain timeout on `moveStart`. A timeout can
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
 * Render resolution while the camera moves, in the `lite` profile only.
 *
 * The same trade as the tolerance above, applied to pixels instead of tiles:
 * 0.8 linear is 36 % fewer pixels to shade, and on a 1366×768 panel a frame
 * that is being replaced sixty times a second does not read as softer — it
 * reads as motion. At rest the scale is 1.0, exactly as before, so a still
 * frame is never cheaper than it was.
 *
 * It rides in THIS governor rather than in a second one because there is only
 * one truth about whether the camera is moving, and two state machines
 * answering that question separately is a bug waiting for a cancelled flight:
 * the stall guard below already exists precisely because `moveEnd` does not
 * always arrive, and a resolution left at 0.8 for the rest of a session is a
 * permanently blurry app.
 */
export const MOVING_RESOLUTION_SCALE = 0.8;

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
/**
 * Resolution factor applied during motion, or null when the profile does not
 * ask for one. `full` never touches `resolutionScale`.
 */
let _movingResolutionScale = null;
/**
 * The resolution in force when THIS move started. Captured per move, not at
 * install: the operator can change the profile — and with it the scale — while
 * the app is open, and restoring an install-time value would undo that.
 */
let _settledResolutionScale = null;
/**
 * The camera pose as of the last restore, used to recognise the governor's own
 * echo. See `THE ECHO` in the header.
 */
let _settledPose = null;
/** Echoes swallowed this session, for diagnostics and the QA harness. */
let _echoesIgnored = 0;
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
  // Resolution first, and OUTSIDE the globe guard below: a viewer whose globe
  // went away mid-move must still get its pixels back, or the app finishes the
  // session rendering at 0.8 for a reason nobody can see.
  if (_settledResolutionScale !== null && _viewer) {
    _viewer.resolutionScale = _settledResolutionScale;
    _settledResolutionScale = null;
  }
  // Recorded AFTER the restore and only when a resolution trade is armed: this
  // is the pose the next `moveStart` is compared against, and without a trade
  // there is no echo to recognise. Recording it unconditionally would silently
  // swallow a real frustum-only move in `full` too.
  _settledPose = _movingResolutionScale !== null && _viewer?.camera
    ? poseKey(_viewer.camera)
    : null;
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
 * @param {{movingMultiplier?: number, stallGuardMs?: number,
 *   movingResolutionScale?: number|null}} [options] `movingResolutionScale`
 *   is the `lite` profile's pixel trade; leave it out for `full`.
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
  _settledResolutionScale = null;
  _settledPose = null;
  _echoesIgnored = 0;
  _movingResolutionScale = Number.isFinite(options.movingResolutionScale)
    && options.movingResolutionScale > 0
    && options.movingResolutionScale < 1
    ? options.movingResolutionScale
    : null;

  _removeStart = camera.moveStart.addEventListener(() => {
    // The governor's own echo: same position, same direction, only the frustum
    // moved — because WE resized the drawing buffer. Relaxing here is the first
    // half of an endless loop; see THE ECHO in the header.
    if (_settledPose !== null && poseKey(camera) === _settledPose) {
      _echoesIgnored += 1;
      return;
    }
    globe.maximumScreenSpaceError = _settledSse * multiplier;
    // Capture only on the transition INTO motion. A second `moveStart` inside
    // one gesture — a fly-to that re-triggers, a wheel event during a drag —
    // would otherwise capture the already-reduced scale as the settled one and
    // ratchet the app down 0.8× per event.
    if (_movingResolutionScale !== null && !_relaxed && _viewer) {
      _settledResolutionScale = _viewer.resolutionScale;
      _viewer.resolutionScale = _settledResolutionScale * _movingResolutionScale;
    }
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
  if (_viewer && _settledResolutionScale !== null) {
    _viewer.resolutionScale = _settledResolutionScale;
  }
  if (_viewer?.scene?.globe && _settledSse !== null) {
    _viewer.scene.globe.maximumScreenSpaceError = _settledSse;
  }
  _viewer = null;
  _settledSse = null;
  _settledResolutionScale = null;
  _movingResolutionScale = null;
  _settledPose = null;
  _relaxed = false;
}

/**
 * Change the motion resolution trade without reinstalling. This is how the
 * DISPLAY-rail switch reaches the governor: a profile change mid-session must
 * not tear down a governor that may be mid-move, because the teardown would
 * restore the settled values and the move would then run un-governed.
 * @param {number|null} scale - Factor in (0, 1), or null to stop trading pixels.
 * @returns {void}
 */
export function setMovingResolutionScale(scale) {
  const next = Number.isFinite(scale) && scale > 0 && scale < 1 ? scale : null;
  if (next === _movingResolutionScale) return;
  _movingResolutionScale = next;
  // Turning the trade OFF mid-move has to hand the pixels back now; leaving
  // them until `moveEnd` would look like the switch did nothing.
  if (next === null && _settledResolutionScale !== null && _viewer) {
    _viewer.resolutionScale = _settledResolutionScale;
    _settledResolutionScale = null;
  }
  // No trade, no echo to recognise — and a stale pose would swallow a real
  // frustum-only move for the rest of the session.
  if (next === null) _settledPose = null;
}

/**
 * @returns {{installed: boolean, settledSse: number|null, currentSse: number|null,
 *   relaxed: boolean, stallGuardArmed: boolean, stallRecoveries: number,
 *   movingResolutionScale: number|null, settledResolutionScale: number|null,
 *   currentResolutionScale: number|null, echoesIgnored: number}}
 */
export function getGlobeDetailDiagnostics() {
  return {
    installed: Boolean(_viewer),
    settledSse: _settledSse,
    currentSse: _viewer?.scene?.globe?.maximumScreenSpaceError ?? null,
    relaxed: _relaxed,
    stallGuardArmed: _stallTimer !== null,
    stallRecoveries: _stallRecoveries,
    movingResolutionScale: _movingResolutionScale,
    settledResolutionScale: _settledResolutionScale,
    currentResolutionScale: _viewer?.resolutionScale ?? null,
    echoesIgnored: _echoesIgnored,
  };
}
