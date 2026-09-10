/**
 * The arrival event, for every layer that reads the viewport.
 *
 * THE PROBLEM. A viewport-driven layer refreshes on `camera.changed`, behind a
 * debounce. `changed` fires while the camera MOVES, and Cesium stops raising it
 * as soon as the motion accumulated since the last one falls under
 * `percentageChanged` (0.05 here — see `cameraSensitivity.js`). On an eased
 * `flyTo` the deceleration passes under that threshold well BEFORE the flight
 * ends: measured on a voice navigation from Paris to Rouen, the last `changed`
 * at t=2.5 s and `camera.moveEnd` at t=3.3 s.
 *
 * So the only load a flight triggers is issued for a camera that is STILL
 * MOVING, and nothing re-reads the view the camera finally settles on. Whatever
 * that mid-flight load concluded then stands until the layer's next poll —
 * fifteen seconds for live transit, six HOURS for the register layers. Measured
 * from a 400 km view: arrival over Rouen at t=5.3 s at 23 km altitude, and the
 * row still reading "zoom in to load live transit" — telling someone already
 * zoomed in to zoom in — until t=16.2 s. Worse, a mid-flight request that
 * failed or timed out left `UNAVAILABLE` on the row with the explanation of the
 * city the operator had just LEFT, and the only cure was switching the layer
 * off and on again.
 *
 * THE FIX, AND WHY IT IS BOTH EVENTS. Listen to `moveEnd` as well, never
 * instead. Arrival and motion are two different questions and neither event
 * answers both: `moveEnd` is not guaranteed to arrive (a cancelled flight, a
 * viewer torn down mid-move, a scene that stops painting under
 * `requestRenderMode` — that last one is why `globeDetailGovernor.js` carries a
 * stall guard), and `changed` never speaks about the final pose.
 *
 * WHY THE KEY IS THE VIEW RECTANGLE. A rest that lands on the view the layer
 * has ALREADY read must cost nothing, or an ordinary pan pays for two loads
 * instead of one and the map reloads forever — the failure `cameraSensitivity.js`
 * exists to prevent. The layer marks the view each time it reads it; a rest on
 * that same view asks for nothing. The key is the camera's own view rectangle
 * rounded to 0.001° (~111 m), which is exactly the precision every layer
 * already compares its own request box at, so this can neither be coarser than
 * the question a layer would ask nor finer than the answer it would get.
 *
 * WHAT IT DOES NOT COVER. A load that FAILED marked its view like any other, so
 * a camera resting on that same view will not retry it — the remedy for a
 * failure is a backoff, which `transitFrance.js` carries and the register
 * layers do not yet.
 */

/**
 * Rounding applied to each edge of the view rectangle, in decimal places.
 * 3 places is ~111 m of latitude, the precision at which the viewport layers
 * compare their request boxes.
 */
const REST_KEY_PRECISION = 3;

/** @type {Map<string, {viewer: object, remove: ?Function, reload: Function, read: string|null}>} */
const _watched = new Map();

/**
 * Identity of the view a camera is showing.
 *
 * Deliberately NOT dependent on Cesium: the arithmetic is two radian-to-degree
 * conversions, and keeping it out of the import graph is what lets the contract
 * below be unit-tested against a plain object instead of a live globe.
 *
 * @param {object} viewer Cesium viewer, or any `{camera}` holder.
 * @returns {string} Stable key, `''` when the camera sees no rectangle at all.
 */
export function viewportRestKey(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.();
  if (!rectangle) return '';
  const edges = [rectangle.south, rectangle.west, rectangle.north, rectangle.east];
  if (!edges.every((value) => Number.isFinite(value))) return '';
  return edges.map((value) => ((value * 180) / Math.PI).toFixed(REST_KEY_PRECISION)).join(',');
}

/**
 * Record that this owner has just READ the view the camera is showing now.
 *
 * Called at the top of the layer's viewport read — before the fetch, not after
 * it — because the question the load answers is the one the camera was asking
 * when it was issued. A response that lands after the camera has moved on
 * therefore leaves the mark where it was, and the rest that follows re-reads.
 *
 * @param {object} viewer Cesium viewer.
 * @param {string} ownerId The id passed to {@link watchCameraSettle}.
 * @returns {void}
 */
export function markViewportRead(viewer, ownerId) {
  const entry = _watched.get(ownerId);
  if (!entry) return;
  entry.read = viewportRestKey(viewer || entry.viewer);
}

/**
 * Watch for the camera coming to rest, and re-read the view when it lands
 * somewhere this owner has not read.
 *
 * Idempotent per owner: watching twice replaces the first watch rather than
 * stacking a second listener, so a layer re-enabled without a matching disable
 * cannot end up reloading twice per arrival.
 *
 * @param {object} viewer Cesium viewer.
 * @param {string} ownerId Short stable id, e.g. 'irve-fr'.
 * @param {Function} reload Re-read the viewport. Runs synchronously on rest;
 *   a layer that debounces `camera.changed` should cancel that pending timer
 *   here, since this call supersedes it.
 * @returns {void}
 */
export function watchCameraSettle(viewer, ownerId, reload) {
  const camera = viewer?.camera;
  if (!camera?.moveEnd?.addEventListener || !ownerId || typeof reload !== 'function') return;
  releaseCameraSettle(viewer, ownerId);
  const entry = { viewer, remove: null, reload, read: null };
  entry.remove = camera.moveEnd.addEventListener(() => {
    // A rest on the view already read is the common case — every pan ends in
    // one — and it must not cost a request.
    const key = viewportRestKey(entry.viewer);
    if (entry.read !== null && key === entry.read) return;
    try {
      entry.reload();
    } catch (error) {
      // Thrown inside a Cesium Event, this would silence every listener queued
      // behind it on the same camera — including other layers' arrivals.
      console.warn(`[CameraSettle] ${ownerId} failed to re-read on arrival:`, error?.message || error);
    }
  });
  _watched.set(ownerId, entry);
}

/**
 * Drop this owner's arrival watch. Safe when never watched, and safe twice.
 * @param {object} viewer Cesium viewer (unused; kept for call-site symmetry
 *   with {@link watchCameraSettle} and with `cameraSensitivity.js`).
 * @param {string} ownerId The id passed to {@link watchCameraSettle}.
 * @returns {void}
 */
export function releaseCameraSettle(viewer, ownerId) {
  const entry = _watched.get(ownerId);
  if (!entry) return;
  // Deliberately NOT gated on the viewer matching: a layer torn down after a
  // viewer swap must still be able to drop a listener bound to the old camera.
  entry.remove?.();
  _watched.delete(ownerId);
}

/**
 * Diagnostics for QA harnesses and tests.
 *
 * `current` is what `read` is COMPARED AGAINST — the key of the view the
 * camera is showing at this instant. Publishing both is what lets a harness
 * tell the two kinds of rest apart instead of guessing: a rest where
 * `current === read` must cost nothing, and one where they differ must cost a
 * read. Rounding to 0.001° means even a one-metre nudge can carry an edge
 * across a boundary and legitimately change the question, so a harness that
 * assumed a small move was always a free rest would be flaky by construction.
 *
 * @returns {{owners: string[], read: Object<string, ?string>,
 *            current: Object<string, string>}}
 */
export function getCameraSettleDiagnostics() {
  const owners = [..._watched.keys()].sort();
  const read = {};
  const current = {};
  for (const owner of owners) {
    const entry = _watched.get(owner);
    read[owner] = entry.read;
    current[owner] = viewportRestKey(entry.viewer);
  }
  return { owners, read, current };
}

/** Test seam: drop every watch without touching a camera. */
export function _resetCameraSettleForTest() {
  _watched.clear();
}
