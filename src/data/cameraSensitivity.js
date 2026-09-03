/**
 * Ref-counted ownership of `camera.percentageChanged`.
 *
 * THE PROBLEM. `Cesium.Camera.percentageChanged` is ONE number on the camera,
 * shared by every `camera.changed` listener in the app: it is the fraction of
 * the view that must move before `changed` fires at all. Cesium's default is
 * 0.5. Eleven viewport-driven layers used to write it directly on enable —
 *
 *     viewer.camera.percentageChanged = Math.min(viewer.camera.percentageChanged || 1, 0.05);
 *
 * — and their `disable()` removed the listener without putting the number
 * back. So enabling ONE layer (public transit, say) permanently raised the
 * refresh sensitivity of EVERY other viewport-driven layer for the rest of the
 * session: each of them re-fetched on the slightest camera nudge, which reads
 * on screen as a map that reloads forever. Turning the layer off never undid
 * it, because nothing ever restored 0.5.
 *
 * A per-layer save/restore does not fix this. `traffic.js` had one and it was
 * still wrong at two layers: the second layer to enable saves the value the
 * FIRST one already lowered, and whichever disables last writes that stale
 * 0.05 back as if it were the baseline.
 *
 * THE FIX. One owner set, exactly like the continuous-render holds in
 * `src/renderGovernor.js`. Every layer CLAIMS the sensitivity it needs and
 * RELEASES it when its listener goes; the camera carries the minimum of the
 * live claims (the strictest need wins, so no layer is ever starved), and the
 * value found before the first claim comes back when the last one is released.
 * Claims are identity-keyed, so a double-claim or a double-release cannot
 * corrupt the number.
 *
 * SCOPE. This module owns `percentageChanged` and nothing else. A layer that
 * needs finer motion granularity than any claim can express still falls back to
 * `scene.preRender` on its own (`flights.js`, `militaryFlights.js`) — that
 * choice is unaffected, and now at least the value those layers read is the
 * one the app configured rather than the residue of a layer that has been off
 * for twenty minutes.
 */

/**
 * The sensitivity every viewport-driven layer asks for: refresh once the view
 * has moved by 5%. Was written as a bare `0.05` in eleven files; naming it
 * keeps the twelve claimants in agreement.
 */
export const VIEWPORT_CAMERA_SENSITIVITY = 0.05;

/** @type {object|null} The camera the live claims apply to. */
let _camera = null;
/** @type {number|null} `percentageChanged` as found before the first claim. */
let _baseline = null;
/** @type {Map<string, number>} ownerId → requested sensitivity. */
const _claims = new Map();

/** Push the minimum of the live claims (or the baseline) onto the camera. */
function applySensitivity() {
  if (!_camera) return;
  if (_claims.size === 0) {
    if (_baseline !== null) _camera.percentageChanged = _baseline;
    return;
  }
  // The baseline joins the minimum so a claim can only ever make the camera
  // MORE sensitive, never less — the same one-way guarantee the old
  // `Math.min(current, 0.05)` gave, now with a value that comes back.
  let applied = _baseline === null ? Infinity : _baseline;
  for (const value of _claims.values()) {
    if (value < applied) applied = value;
  }
  if (Number.isFinite(applied)) _camera.percentageChanged = applied;
}

/**
 * Claim a camera sensitivity for as long as this owner's `camera.changed`
 * listener is attached. Idempotent per owner: re-claiming replaces that
 * owner's request.
 * @param {object} viewer - Cesium viewer (or any `{camera}` holder).
 * @param {string} ownerId - Short stable id, e.g. 'transit-fr'.
 * @param {number} [value] - Requested `percentageChanged`.
 * @returns {void}
 */
export function claimCameraSensitivity(viewer, ownerId, value = VIEWPORT_CAMERA_SENSITIVITY) {
  const camera = viewer?.camera;
  if (!camera || !ownerId || !Number.isFinite(value) || value <= 0) return;
  // A different viewer means a different camera: the old baseline belongs to a
  // camera nobody is looking at any more, and the claims against it are dead.
  if (_camera && _camera !== camera) {
    _claims.clear();
    _camera = null;
    _baseline = null;
  }
  if (!_camera) {
    _camera = camera;
    // Captured, never assumed to be Cesium's 0.5 default: whatever the app (or
    // a future control) configured is what must come back.
    const found = camera.percentageChanged;
    _baseline = Number.isFinite(found) && found > 0 ? found : null;
  }
  _claims.set(ownerId, value);
  applySensitivity();
}

/**
 * Release this owner's claim. Safe when never claimed, and safe to call twice.
 * The baseline is restored when the last live claim goes.
 * @param {object} viewer - Cesium viewer (or any `{camera}` holder).
 * @param {string} ownerId - The id passed to {@link claimCameraSensitivity}.
 * @returns {void}
 */
export function releaseCameraSensitivity(viewer, ownerId) {
  if (!ownerId || !_claims.has(ownerId)) return;
  // Deliberately NOT gated on `viewer.camera === _camera`. A layer torn down
  // after a viewer swap must still drop its claim, or the set leaks an owner
  // that can never release.
  _claims.delete(ownerId);
  applySensitivity();
  if (_claims.size === 0) {
    _camera = null;
    _baseline = null;
  }
}

/**
 * @returns {{owners: string[], baseline: number|null, applied: number|null}}
 *   Diagnostics for QA harnesses and tests.
 */
export function getCameraSensitivityDiagnostics() {
  return {
    owners: [..._claims.keys()].sort(),
    baseline: _baseline,
    applied: _camera ? _camera.percentageChanged ?? null : null,
  };
}

/** Test seam: drop all state without touching a camera. */
export function _resetCameraSensitivityForTest() {
  _claims.clear();
  _camera = null;
  _baseline = null;
}
