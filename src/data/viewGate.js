import * as Cesium from 'cesium';
import { boxContains, boxOverlapArea } from './viewportBox.js';
import { interruptCameraMotion, prefersReducedMotion } from '../cameraVerbs.js';

/**
 * @module viewGate
 *
 * "Zoom in to load" — carried out instead of announced.
 *
 * Several layers only answer for a bounded camera: BD TOPO refuses a box wider
 * than 0.08°, the mapped grid refuses one wider than 0.8°. The ceiling is real
 * — it is what keeps one click from asking a public service for half a country
 * — but the operator turning the layer on from a continental view was left
 * holding an instruction instead of a layer, and (because a load that fetched
 * nothing reported itself as a failed load) a toggle that flipped straight back
 * to OFF with "could not start cleanly". That reads as a broken layer. It is
 * not: it is a camera that has not been asked to move yet.
 *
 * So this module moves it. Given the ceiling a layer loads behind, it computes
 * the view that fits under it, flies there, and then RE-ASKS the layer's own
 * gate — the same predicate that will decide the load a moment later, not a
 * second opinion about it. If the answer is still no, it tightens and tries
 * again, twice, and gives up honestly rather than looping.
 *
 * ── What it is careful about ────────────────────────────────────────────────
 *
 * • **The ceiling is in degrees, and a degree of longitude is not a degree of
 *   latitude.** At Lyon a degree of longitude is 700 m shorter than a degree of
 *   latitude, so the metre span that fits under a 0.08° ceiling is the one the
 *   LONGITUDE axis allows. Sizing off latitude alone overshoots the gate by
 *   45% in France and lands the flight right back on "zoom in".
 *
 * • **Altitude alone cannot satisfy a box ceiling.** A camera at 600 m looking
 *   at the horizon sees to the horizon: the view rectangle stays kilometres
 *   wide no matter how low it goes. The pitch is therefore steepened to at
 *   least `VIEW_GATE_MIN_PITCH_DEG` before any height is solved — and left
 *   alone when it is already steeper, because the operator's angle is theirs.
 *
 * • **It zooms in, never out.** The solved height is capped by the height the
 *   camera already has. A shallow view from 600 m needs the pitch, not 1.9 km
 *   of extra altitude, and pulling the camera back to "fix" it would be a
 *   worse answer than the guidance it replaces.
 *
 * • **It aims at what the operator is looking at.** The focus is the centre of
 *   the current view, pulled onto the layer's coverage when that centre falls
 *   outside it and the coverage is a real part of the shot — a camera framing
 *   France with its centre in the Bay of Biscay should land on France, not on
 *   water. A sliver at the edge of a camera aimed somewhere else is not, and
 *   the gate declines to fly at all rather than teleport away from the subject
 *   (see `viewGateFocus`).
 */

/** Degrees ↔ radians, kept local so the geometry stays Cesium-free and testable. */
const RAD = Math.PI / 180;
const toRad = (deg) => deg * RAD;
const toDeg = (rad) => rad / RAD;

/** Metres per degree of latitude (WGS84 mean). */
export const M_PER_DEG_LAT = 111_320;

/**
 * Fraction of the ceiling the solved view aims for.
 *
 * Aiming AT the ceiling is aiming at the edge of the cliff: the ground-span
 * model below is a flat-Earth approximation of a rectangle Cesium computes on
 * an ellipsoid, and the two disagree by a few percent. 0.6 buys enough room
 * that the disagreement never decides the outcome, at the cost of a view
 * slightly tighter than the layer would strictly allow.
 */
export const VIEW_GATE_MARGIN = 0.6;
/** Each retry halves the margin, so three attempts span an 8× range of heights. */
export const VIEW_GATE_SHRINK = 0.5;
/** Attempts before the gate gives up and leaves the guidance state standing. */
export const VIEW_GATE_STEPS = 3;
/**
 * Shallowest pitch a solved view is allowed to keep, in degrees below the
 * horizon. At -55° with a landscape frustum the top ray still meets the ground
 * about 36° down, which is what makes the visible rectangle finite at all.
 */
export const VIEW_GATE_MIN_PITCH_DEG = -55;
/** Never solve a camera closer to the ground than this. */
export const VIEW_GATE_MIN_HEIGHT_M = 250;
/** Cesium's default frustum angle, used when a viewer offers no readable one. */
export const VIEW_GATE_DEFAULT_FOV_DEG = 60;
/** Seconds. Long enough to read as a move, short enough to precede a load. */
export const VIEW_GATE_FLIGHT_S = 1.6;
/** Seconds. A correction after a flight that already happened. */
export const VIEW_GATE_CORRECTION_S = 0.6;

/**
 * The camera's view rectangle in degrees, or null when there is none.
 *
 * Deliberately looser than any layer's own box rule: this is the rectangle the
 * gate has to shrink, so it must survive the very cameras a layer refuses. A
 * view straddling the antimeridian reports `east < west`; it is unwrapped
 * rather than rejected, and the focus is normalised back into [-180, 180].
 *
 * @param {?Cesium.Viewer} viewer
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function cameraViewBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.(viewer?.scene?.globe?.ellipsoid);
  if (!rectangle) return null;
  const south = toDeg(rectangle.south);
  const north = toDeg(rectangle.north);
  const west = toDeg(rectangle.west);
  let east = toDeg(rectangle.east);
  if (!Number.isFinite(south + north + west + east)) return null;
  if (east <= west) east += 360;
  if (south >= north) return null;
  return { south, west, north, east };
}

/** Longitude folded back into [-180, 180). */
export function normalizeLon(lon) {
  return ((lon + 540) % 360) - 180;
}

/**
 * Share of the view a layer's coverage must fill before the focus is pulled
 * off the centre and onto it.
 */
export const VIEW_GATE_COVERAGE_SHARE = 0.05;
/**
 * Above this span the camera is not looking AT anything — it is holding a
 * continent or the whole globe — and a layer that lives somewhere specific may
 * take it there. Below it, the operator framed that region on purpose.
 */
export const VIEW_GATE_AIMLESS_SPAN_DEG = 30;

/**
 * Where the solved view should point, or null when there is nothing to point at.
 *
 * The centre of what is already framed, unless a coverage table says the layer
 * has nothing there. Then it depends on what the camera is doing:
 *
 * • coverage fills a real share of the view (France on half the screen, the
 *   Bay of Biscay on the other half) → the centre of the coverage in shot;
 * • the camera is holding a continent or the globe and is therefore aimed at
 *   nothing in particular → the same, because a French layer turned on from
 *   orbit means "take me to France";
 * • otherwise → null. A camera at 400 km over Berlin that happens to clip
 *   0.1° of Alsace is looking at Berlin, and answering that with a flight to
 *   Strasbourg is worse than the guidance state it replaces.
 *
 * A layer with no coverage table (the mapped grid is wherever the camera is)
 * passes none and always gets the view centre.
 *
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {?ReadonlyArray<{south:number, west:number, north:number, east:number}>} [coverage]
 * @returns {?{lat:number, lon:number}}
 */
export function viewGateFocus(box, coverage = null) {
  const lat = (box.south + box.north) / 2;
  const lon = (box.west + box.east) / 2;
  const centre = { lat, lon: normalizeLon(lon) };
  if (!Array.isArray(coverage) || !coverage.length) return centre;
  if (coverage.some((area) => boxContains(area, centre.lat, centre.lon))) return centre;
  let best = null;
  let bestArea = 0;
  for (const area of coverage) {
    const overlap = boxOverlapArea(box, area);
    if (overlap > bestArea) {
      bestArea = overlap;
      best = area;
    }
  }
  if (!best) return null;
  const span = Math.max(box.north - box.south, box.east - box.west);
  const share = bestArea / Math.max(1e-9, (box.north - box.south) * (box.east - box.west));
  if (share < VIEW_GATE_COVERAGE_SHARE && span < VIEW_GATE_AIMLESS_SPAN_DEG) return null;
  return {
    lat: (Math.max(box.south, best.south) + Math.min(box.north, best.north)) / 2,
    lon: normalizeLon((Math.max(box.west, best.west) + Math.min(box.east, best.east)) / 2),
  };
}

/**
 * Steepen a shallow pitch, keep a steep one, and never look up.
 * @param {number} pitchDeg Current pitch, degrees (negative looks down).
 * @param {number} [minPitchDeg] Shallowest pitch allowed out.
 * @returns {number}
 */
export function viewGatePitchDeg(pitchDeg, minPitchDeg = VIEW_GATE_MIN_PITCH_DEG) {
  const pitch = Number.isFinite(pitchDeg) ? pitchDeg : minPitchDeg;
  return Math.max(-89, Math.min(minPitchDeg, pitch));
}

/**
 * Cesium's frustum angle resolved onto both screen axes.
 *
 * `frustum.fov` is the HORIZONTAL angle on a landscape canvas and the vertical
 * one on a portrait canvas — Cesium's own rule, reproduced here because the
 * solved height depends on both and reading the wrong one off a 16:9 canvas is
 * a 40% error.
 *
 * @param {?{fov:number, aspectRatio:number}} frustum
 * @returns {{fovxDeg:number, fovyDeg:number}}
 */
export function viewGateFieldOfView(frustum) {
  const fovDeg = Number.isFinite(frustum?.fov) && frustum.fov > 0
    ? toDeg(frustum.fov)
    : VIEW_GATE_DEFAULT_FOV_DEG;
  const aspect = Number.isFinite(frustum?.aspectRatio) && frustum.aspectRatio > 0
    ? frustum.aspectRatio
    : 1;
  const half = Math.tan(toRad(Math.min(fovDeg, 175)) / 2);
  return {
    fovxDeg: aspect > 1 ? fovDeg : 2 * toDeg(Math.atan(half * aspect)),
    fovyDeg: aspect > 1 ? 2 * toDeg(Math.atan(half / aspect)) : fovDeg,
  };
}

/**
 * Metres of ground the camera sees per metre of altitude.
 *
 * Flat-ground trigonometry, taking the larger of the two spans: along-track,
 * from where the bottom ray lands to where the top ray does; and across-track,
 * the width at that far edge. The top ray is never allowed within 1° of the
 * horizon, where the span goes to infinity and the arithmetic stops meaning
 * anything.
 *
 * @param {number} pitchDeg Degrees below the horizon (negative).
 * @param {number} fovxDeg Horizontal field of view.
 * @param {number} fovyDeg Vertical field of view.
 * @returns {number} Span-to-height ratio, always positive.
 */
export function viewGateSpanPerHeight(pitchDeg, fovxDeg, fovyDeg) {
  const down = Math.abs(pitchDeg);
  const top = toRad(Math.max(down - fovyDeg / 2, 1));
  const bottom = toRad(Math.min(down + fovyDeg / 2, 90));
  const along = 1 / Math.tan(top) - 1 / Math.tan(bottom);
  const across = (2 * Math.tan(toRad(fovxDeg / 2))) / Math.sin(top);
  return Math.max(along, across, 0.1);
}

/**
 * Height above the ground that keeps the visible rectangle under a ceiling.
 *
 * The ceiling is a span in degrees on either axis, and longitude is the tighter
 * of the two everywhere off the equator — so the metre budget is sized off
 * longitude and the latitude axis gets the slack for free.
 *
 * @param {object} options
 * @param {number} options.maxDeg Ceiling the layer loads behind.
 * @param {number} options.latDeg Latitude the view is centred on.
 * @param {number} options.pitchDeg Pitch of the solved view (already steepened).
 * @param {number} options.fovxDeg
 * @param {number} options.fovyDeg
 * @param {number} [options.margin] Fraction of the ceiling to aim for.
 * @returns {number} Metres above ground.
 */
export function viewGateHeightM({
  maxDeg, latDeg, pitchDeg, fovxDeg, fovyDeg, margin = VIEW_GATE_MARGIN,
}) {
  const cosLat = Math.max(0.15, Math.cos(toRad(latDeg)));
  const spanM = maxDeg * M_PER_DEG_LAT * cosLat * margin;
  const perHeight = viewGateSpanPerHeight(pitchDeg, fovxDeg, fovyDeg);
  return Math.max(VIEW_GATE_MIN_HEIGHT_M, spanM / perHeight);
}

/**
 * The eye that frames `focus` at the centre of the screen.
 *
 * The camera stands back along its own heading by exactly the ground distance
 * its centre ray travels, so the point it was already looking at stays the
 * point it looks at — only closer.
 *
 * @param {{lat:number, lon:number}} focus
 * @param {{aglM:number, pitchDeg:number, headingDeg:number}} view
 * @returns {{lat:number, lon:number}}
 */
export function viewGateEye(focus, { aglM, pitchDeg, headingDeg }) {
  const back = aglM / Math.tan(toRad(Math.abs(pitchDeg)));
  const heading = toRad(headingDeg || 0);
  const northM = -back * Math.cos(heading);
  const eastM = -back * Math.sin(heading);
  const cosLat = Math.max(0.15, Math.cos(toRad(focus.lat)));
  return {
    lat: Math.max(-89, Math.min(89, focus.lat + northM / M_PER_DEG_LAT)),
    lon: normalizeLon(focus.lon + eastM / (M_PER_DEG_LAT * cosLat)),
  };
}

/**
 * The whole camera a gated layer needs, solved from the one it has.
 *
 * @param {object} options
 * @param {{lat:number, lon:number}} options.focus Where the view should point.
 * @param {number} options.maxDeg Ceiling the layer loads behind.
 * @param {number} options.headingDeg Heading to keep.
 * @param {number} options.pitchDeg Current pitch, steepened if it has to be.
 * @param {number} options.fovxDeg
 * @param {number} options.fovyDeg
 * @param {number} [options.groundM] Terrain height under the focus.
 * @param {number} [options.cameraHeightM] Current eye height; the solve never exceeds it.
 * @param {number} [options.margin]
 * @param {number} [options.minPitchDeg]
 * @returns {?{lon:number, lat:number, heightM:number, aglM:number, headingDeg:number, pitchDeg:number}}
 */
export function viewGatePlan({
  focus,
  maxDeg,
  headingDeg = 0,
  pitchDeg = VIEW_GATE_MIN_PITCH_DEG,
  fovxDeg = VIEW_GATE_DEFAULT_FOV_DEG,
  fovyDeg = VIEW_GATE_DEFAULT_FOV_DEG,
  groundM = 0,
  cameraHeightM = Number.POSITIVE_INFINITY,
  margin = VIEW_GATE_MARGIN,
  minPitchDeg = VIEW_GATE_MIN_PITCH_DEG,
}) {
  if (!focus || !Number.isFinite(focus.lat) || !Number.isFinite(focus.lon)) return null;
  if (!Number.isFinite(maxDeg) || maxDeg <= 0) return null;
  const pitch = viewGatePitchDeg(pitchDeg, minPitchDeg);
  const solved = viewGateHeightM({
    maxDeg, latDeg: focus.lat, pitchDeg: pitch, fovxDeg, fovyDeg, margin,
  });
  // Zoom in, never out: a camera that is already lower than the solve keeps its
  // altitude and gets the pitch instead.
  const currentAglM = Number.isFinite(cameraHeightM)
    ? cameraHeightM - groundM
    : Number.POSITIVE_INFINITY;
  const aglM = Math.max(VIEW_GATE_MIN_HEIGHT_M, Math.min(solved, currentAglM));
  const eye = viewGateEye(focus, { aglM, pitchDeg: pitch, headingDeg });
  return {
    lon: eye.lon,
    lat: eye.lat,
    heightM: groundM + aglM,
    aglM,
    headingDeg: Number.isFinite(headingDeg) ? headingDeg : 0,
    pitchDeg: pitch,
  };
}

/** Terrain height under a point, from resident tiles only. 0 when unknown. */
function groundHeightM(viewer, focus) {
  try {
    const height = viewer?.scene?.globe?.getHeight?.(
      Cesium.Cartographic.fromDegrees(focus.lon, focus.lat),
    );
    return Number.isFinite(height) ? height : 0;
  } catch {
    return 0;
  }
}

/** Fly one solved plan, resolving false if anything else takes the camera. */
function flyPlan(camera, plan, duration) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(plan.lon, plan.lat, plan.heightM),
        orientation: {
          heading: Cesium.Math.toRadians(plan.headingDeg),
          pitch: Cesium.Math.toRadians(plan.pitchDeg),
          roll: 0,
        },
        duration,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: () => finish(true),
        cancel: () => finish(false),
      });
    } catch (error) {
      console.warn('[ViewGate] flight refused:', error);
      finish(false);
    }
  });
}

/**
 * Bring the camera inside the gate a layer loads behind.
 *
 * Returns whether the layer's own gate answers yes at the end — which is not
 * the same as "a flight happened": a camera already inside the gate flies
 * nowhere and reports true, and a flight someone else cancels reports whatever
 * the gate says about wherever the camera ended up.
 *
 * @param {Cesium.Viewer} viewer
 * @param {object} options
 * @param {() => boolean} options.fits The layer's own gate. Re-asked after each flight.
 * @param {number} options.maxDeg Ceiling the layer loads behind, in degrees.
 * @param {?ReadonlyArray<object>} [options.coverage] Where the layer has data at all.
 * @param {number} [options.minPitchDeg]
 * @param {number} [options.steps]
 * @param {number} [options.duration] Flight seconds; 0 teleports.
 * @param {?AbortSignal} [options.signal]
 * @param {string} [options.reason] Diagnostic label for the camera hand-over.
 * @returns {Promise<boolean>} Whether the camera ended inside the gate.
 */
export async function applyViewGate(viewer, {
  fits,
  maxDeg,
  coverage = null,
  minPitchDeg = VIEW_GATE_MIN_PITCH_DEG,
  steps = VIEW_GATE_STEPS,
  duration = null,
  signal = null,
  reason = 'view-gate',
} = {}) {
  const camera = viewer?.camera;
  if (!camera || typeof fits !== 'function') return false;
  if (fits()) return true;
  if (signal?.aborted) return false;

  const flightS = Number.isFinite(duration)
    ? duration
    : (prefersReducedMotion() ? 0 : VIEW_GATE_FLIGHT_S);
  let took = false;
  let margin = VIEW_GATE_MARGIN;
  for (let attempt = 0; attempt < steps; attempt += 1) {
    const box = cameraViewBox(viewer);
    if (!box) return false;
    const focus = viewGateFocus(box, coverage);
    // Nothing this layer covers is worth flying to from here. The camera stays
    // where the operator put it and the layer keeps saying what it needs.
    if (!focus) return false;
    const plan = viewGatePlan({
      focus,
      maxDeg,
      headingDeg: toDeg(camera.heading || 0),
      pitchDeg: toDeg(camera.pitch ?? toRad(minPitchDeg)),
      groundM: groundHeightM(viewer, focus),
      cameraHeightM: cameraViewHeightM(viewer),
      margin,
      minPitchDeg,
      ...viewGateFieldOfView(camera.frustum),
    });
    if (!plan) return false;
    if (!took) {
      // Whatever the camera was doing, it is not doing it any more — an orbit
      // re-asserts its lookAt every frame and would drag the flight back out.
      // Taken here rather than on entry, so a gate that decides not to fly has
      // not already stopped a motion on the operator.
      interruptCameraMotion(reason);
      took = true;
    }
    const landed = await flyPlan(
      camera,
      plan,
      attempt === 0 ? flightS : Math.min(flightS, VIEW_GATE_CORRECTION_S),
    );
    if (!landed || signal?.aborted) return fits();
    if (fits()) return true;
    margin *= VIEW_GATE_SHRINK;
  }
  return fits();
}

/** Eye height above the ellipsoid, or Infinity when the camera cannot say. */
export function cameraViewHeightM(viewer) {
  try {
    const positionCartographic = viewer?.camera?.positionCartographic;
    const height = positionCartographic?.height;
    return Number.isFinite(height) ? height : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
