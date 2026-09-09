/**
 * One-click camera transfer for layer-owned world targets.
 */
import * as Cesium from 'cesium';
import { VESSEL_STANDOFF } from './data/vesselStandoff.js';

export const WORLD_FOCUS_REQUEST_EVENT = 'gev:world-request-focus';
export const WORLD_CLICK_FOCUS_DURATION_SEC = 1.9;

/**
 * Per-kind framing. `rangeM` is the standoff used when the request carries no
 * range of its own; `minRangeM`/`maxRangeM` are the bounds a request MAY move
 * within. A kind that publishes no bounds is not negotiable — its own range is
 * the only one it can be flown at.
 */
export const WORLD_FOCUS_FRAMING = Object.freeze({
  vessel: Object.freeze({
    radiusM: 150,
    rangeM: VESSEL_STANDOFF.defaultRangeM,
    pitchDeg: VESSEL_STANDOFF.pitchDeg,
    minRangeM: VESSEL_STANDOFF.minRangeM,
    maxRangeM: VESSEL_STANDOFF.maxRangeM,
  }),
  fire: Object.freeze({ radiusM: 400, rangeM: 3000, pitchDeg: -35 }),
});

/**
 * The standoff one request is actually flown at.
 *
 * A layer that has measured its target's surroundings (`vesselStandoff.js`)
 * says so in `rangeM`; anything absent, unusable or outside the kind's
 * published bounds falls back to the kind's own framing rather than being
 * honoured blind — a request is a hint from a layer, not a camera command.
 * @param {object} target The focus request.
 * @param {object} framing The resolved {@link WORLD_FOCUS_FRAMING} entry.
 * @returns {number} Range in metres.
 */
export function resolveFocusRangeM(target, framing) {
  const requested = Number(target?.rangeM);
  if (!Number.isFinite(requested) || requested <= 0) return framing.rangeM;
  const min = Number.isFinite(framing.minRangeM) ? framing.minRangeM : framing.rangeM;
  const max = Number.isFinite(framing.maxRangeM) ? framing.maxRangeM : framing.rangeM;
  return Math.min(max, Math.max(min, requested));
}

/** Validate a layer-owned focus target before camera policy can release tracking. */
export function isValidWorldFocusTarget(detail) {
  if (!detail || !WORLD_FOCUS_FRAMING[detail.kind]) return false;
  if (!String(detail.id || '').trim()) return false;
  const { position } = detail;
  if (!position
    || !Number.isFinite(position.x)
    || !Number.isFinite(position.y)
    || !Number.isFinite(position.z)) return false;
  // Vessel and fire targets are surface-anchored Earth positions. Merely
  // finite coordinates near the ECEF origin cannot be flown to, and must be
  // rejected before the camera policy releases a current follow owner.
  const magnitude = Cesium.Cartesian3.magnitude(position);
  return Number.isFinite(magnitude)
    && magnitude >= Cesium.Ellipsoid.WGS84.minimumRadius * 0.95;
}

/** Announce a valid user-click focus request. */
export function requestWorldFocus(detail, eventTarget = globalThis.window) {
  if (!isValidWorldFocusTarget(detail)) return false;
  if (typeof eventTarget?.dispatchEvent !== 'function') return false;
  eventTarget.dispatchEvent(new CustomEvent(WORLD_FOCUS_REQUEST_EVENT, { detail }));
  return true;
}

/** Register one listener and return an idempotent disposer. */
export function registerWorldFocusRequestListener(eventTarget, listener) {
  if (!eventTarget?.addEventListener || !eventTarget?.removeEventListener
    || typeof listener !== 'function') return () => {};
  eventTarget.addEventListener(WORLD_FOCUS_REQUEST_EVENT, listener);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    eventTarget.removeEventListener(WORLD_FOCUS_REQUEST_EVENT, listener);
  };
}

/** Route a valid request through the UI-owned camera policy. */
export function routeWorldFocusRequest(event, runExplicitFocus, fly) {
  const detail = event?.detail;
  if (!isValidWorldFocusTarget(detail)) return false;
  if (typeof runExplicitFocus !== 'function' || typeof fly !== 'function') return false;
  return runExplicitFocus(detail, () => fly(detail));
}

/** Fly to a world target after ownership has been released. */
export function flyToWorldTarget(viewer, target = {}) {
  const camera = viewer?.camera;
  const framing = WORLD_FOCUS_FRAMING[target.kind];
  if (!camera || !framing || !isValidWorldFocusTarget(target)) return false;
  const heading = Number.isFinite(camera.heading) ? camera.heading : 0;
  const duration = target.durationSec > 0
    ? target.durationSec
    : WORLD_CLICK_FOCUS_DURATION_SEC;
  camera.cancelFlight?.();
  camera.flyToBoundingSphere(
    new Cesium.BoundingSphere(target.position, framing.radiusM),
    {
      offset: new Cesium.HeadingPitchRange(
        heading,
        Cesium.Math.toRadians(framing.pitchDeg),
        resolveFocusRangeM(target, framing),
      ),
      duration,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    },
  );
  return true;
}
