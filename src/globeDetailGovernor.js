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
 */
import { governorRequestRender } from './renderGovernor.js';

/**
 * Error tolerance while the camera is moving, as a multiple of the settled
 * value. 2× halves the tiles a descent asks for at each level it passes and is
 * invisible at fly-to speed; higher starts to show as a coarse frame at the
 * moment the camera stops, before the refine lands.
 */
export const MOVING_SSE_MULTIPLIER = 2;

let _viewer = null;
let _settledSse = null;
let _removeStart = null;
let _removeEnd = null;

/**
 * Install the governor on a viewer. Idempotent.
 * @param {Cesium.Viewer} viewer
 * @param {{movingMultiplier?: number}} [options]
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
  _viewer = viewer;
  // Captured, never assumed: another module (or a future quality control) may
  // own the settled value, and this governor must hand back whatever it found.
  _settledSse = globe.maximumScreenSpaceError;

  _removeStart = camera.moveStart.addEventListener(() => {
    globe.maximumScreenSpaceError = _settledSse * multiplier;
  });
  _removeEnd = camera.moveEnd.addEventListener(() => {
    globe.maximumScreenSpaceError = _settledSse;
    // In requestRenderMode the settle is the last frame; without this the
    // globe would stay at the coarse tolerance until something else painted.
    governorRequestRender('globe-detail-settled');
  });
}

/** Remove the listeners and restore the settled tolerance. Safe when absent. */
export function uninstallGlobeDetailGovernor() {
  if (_removeStart) { _removeStart(); _removeStart = null; }
  if (_removeEnd) { _removeEnd(); _removeEnd = null; }
  if (_viewer?.scene?.globe && _settledSse !== null) {
    _viewer.scene.globe.maximumScreenSpaceError = _settledSse;
  }
  _viewer = null;
  _settledSse = null;
}

/**
 * @returns {{installed: boolean, settledSse: number|null, currentSse: number|null}}
 */
export function getGlobeDetailDiagnostics() {
  return {
    installed: Boolean(_viewer),
    settledSse: _settledSse,
    currentSse: _viewer?.scene?.globe?.maximumScreenSpaceError ?? null,
  };
}
