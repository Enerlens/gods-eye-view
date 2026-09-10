/**
 * @module greatCircleArc
 * @description The one great-circle sampler in the repo.
 *
 * Two very different drawings need the same curve: the national electricity
 * exchanges arching from a neighbouring market into France, and the scheduled
 * leg of a tracked flight arching from its origin airport to its destination.
 * They differ only in how high the bow rides, which is what the apex options
 * are for — the geometry underneath is identical and belongs in one place.
 *
 * Extracted from `franceEnergy.js` (which keeps re-exporting it) when the
 * flight-route arc landed; the apex clamp became a parameter at the same time,
 * because a 60 km minimum bow reads as a flow between countries and as a
 * cartoon over a 300 km domestic hop.
 */

/** @constant {number} Vertices per arc. Smooth at country scale, cheap to rebuild. */
export const ARC_SAMPLES = 48;
/** @constant {number} Arc apex as a fraction of the chord. */
export const ARC_APEX_RATIO = 0.16;
/** @constant {number} Floor on the apex, so a short hop still bows visibly. */
export const ARC_APEX_MIN_M = 60_000;
/** @constant {number} Ceiling on the apex, so a long leg does not leave the globe. */
export const ARC_APEX_MAX_M = 400_000;

/** @constant {number} Sphere used for every distance here. Cesium's own mean radius. */
const EARTH_RADIUS_M = 6_371_000;

/**
 * Central angle between two lon/lat points, in radians.
 *
 * HAVERSINE, not `acos` of the dot product, and the difference is the whole
 * reason this is a function rather than one line inlined twice. Near coincident
 * points the dot product is 1 − ε and `acos` returns the square root of the
 * float error: two identical points came back 2 × 10⁻⁸ rad apart, i.e. 13 cm,
 * which is enough to send {@link greatCircleWaypoint} through a slerp with a
 * meaningless direction. Haversine is exact at short range and returns a clean
 * zero, so the "no great circle here" guard downstream actually fires.
 *
 * @param {ReadonlyArray<number>} from `[lon, lat]` degrees.
 * @param {ReadonlyArray<number>} to `[lon, lat]` degrees.
 * @returns {number}
 */
function centralAngle(from, to) {
  const toRad = Math.PI / 180;
  const lat0 = from[1] * toRad;
  const lat1 = to[1] * toRad;
  const dLat = Math.sin((lat1 - lat0) / 2);
  const dLon = Math.sin(((to[0] - from[0]) * toRad) / 2);
  const h = dLat * dLat + Math.cos(lat0) * Math.cos(lat1) * dLon * dLon;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Great-circle distance between two lon/lat points, in metres.
 *
 * Spherical, like {@link greatCircleArc} itself: the two have to agree, because
 * a caller that measures a chord with one formula and then draws it with the
 * other gets an arrow whose head lands off its own tip.
 *
 * @param {ReadonlyArray<number>} from `[lon, lat]` degrees.
 * @param {ReadonlyArray<number>} to `[lon, lat]` degrees.
 * @returns {number} Metres, 0 for coincident or malformed points.
 */
export function greatCircleDistanceM(from, to) {
  if (!Number.isFinite(from?.[0]) || !Number.isFinite(from?.[1])) return 0;
  if (!Number.isFinite(to?.[0]) || !Number.isFinite(to?.[1])) return 0;
  return centralAngle(from, to) * EARTH_RADIUS_M;
}

/**
 * The point a given distance along the great circle from `from` toward `to`.
 *
 * Allowed to overshoot: a distance greater than the separation returns a point
 * BEYOND `to`, still on the same great circle. That is the behaviour the border
 * arrows need — a flow glyph whose length is fixed for legibility has to keep
 * pointing at its market even when the market is closer than the glyph is long.
 *
 * @param {ReadonlyArray<number>} from `[lon, lat]` degrees.
 * @param {ReadonlyArray<number>} to `[lon, lat]` degrees — the BEARING, not a limit.
 * @param {number} distanceM Metres along the great circle.
 * @returns {number[]|null} `[lon, lat]`, or null when there is no great circle.
 */
export function greatCircleWaypoint(from, to, distanceM) {
  if (!Number.isFinite(from?.[0]) || !Number.isFinite(to?.[0])) return null;
  if (!Number.isFinite(distanceM)) return null;
  const omega = centralAngle(from, to);
  // Coincident endpoints define no great circle, so there is no direction to
  // walk in and the honest answer is the point itself.
  if (omega < 1e-9) return [from[0], from[1]];
  const toRad = Math.PI / 180;
  const a = {
    x: Math.cos(from[1] * toRad) * Math.cos(from[0] * toRad),
    y: Math.cos(from[1] * toRad) * Math.sin(from[0] * toRad),
    z: Math.sin(from[1] * toRad),
  };
  const b = {
    x: Math.cos(to[1] * toRad) * Math.cos(to[0] * toRad),
    y: Math.cos(to[1] * toRad) * Math.sin(to[0] * toRad),
    z: Math.sin(to[1] * toRad),
  };
  // Slerp at t = travelled / total, which is exactly the fraction of the
  // central angle — and stays correct past t = 1, which is the point.
  const t = (distanceM / EARTH_RADIUS_M) / omega;
  const sinOmega = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / sinOmega;
  const wb = Math.sin(t * omega) / sinOmega;
  const x = a.x * wa + b.x * wb;
  const y = a.y * wa + b.y * wb;
  const z = a.z * wa + b.z * wb;
  const hyp = Math.hypot(x, y, z) || 1;
  return [
    Math.atan2(y, x) / toRad,
    Math.asin(Math.min(1, Math.max(-1, z / hyp))) / toRad,
  ];
}

/**
 * Sample a great-circle arc between two lon/lat points, raised to an apex in
 * the middle so it reads as a flow over the globe rather than a line on it.
 *
 * Spherical interpolation on unit vectors, not a lon/lat lerp: the latter
 * bends visibly wrong at these distances and breaks outright across the
 * antimeridian. The height profile is a sine bow — zero at both ends, so the
 * arc touches down on the two places it connects.
 *
 * @param {ReadonlyArray<number>} from `[lon, lat]` degrees.
 * @param {ReadonlyArray<number>} to `[lon, lat]` degrees.
 * @param {{samples?:number, apexRatio?:number, apexMinM?:number, apexMaxM?:number}} [options]
 * @returns {number[]} Flat `[lon, lat, height, …]`, ready for Cesium.
 */
export function greatCircleArc(from, to, options = {}) {
  const samples = Math.max(2, Math.floor(options.samples ?? ARC_SAMPLES));
  const apexRatio = Number.isFinite(options.apexRatio) ? options.apexRatio : ARC_APEX_RATIO;
  const apexMinM = Number.isFinite(options.apexMinM) ? options.apexMinM : ARC_APEX_MIN_M;
  const apexMaxM = Number.isFinite(options.apexMaxM) ? options.apexMaxM : ARC_APEX_MAX_M;
  const toRad = Math.PI / 180;
  const a = {
    x: Math.cos(from[1] * toRad) * Math.cos(from[0] * toRad),
    y: Math.cos(from[1] * toRad) * Math.sin(from[0] * toRad),
    z: Math.sin(from[1] * toRad),
  };
  const b = {
    x: Math.cos(to[1] * toRad) * Math.cos(to[0] * toRad),
    y: Math.cos(to[1] * toRad) * Math.sin(to[0] * toRad),
    z: Math.sin(to[1] * toRad),
  };
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const chordM = omega * 6_371_000;
  const apex = Math.min(apexMaxM, Math.max(apexMinM, chordM * apexRatio));
  const sinOmega = Math.sin(omega);

  const positions = [];
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    // Coincident endpoints have no great circle; fall back to the linear blend,
    // which for identical points is just the point itself.
    const wa = sinOmega < 1e-9 ? 1 - t : Math.sin((1 - t) * omega) / sinOmega;
    const wb = sinOmega < 1e-9 ? t : Math.sin(t * omega) / sinOmega;
    const x = a.x * wa + b.x * wb;
    const y = a.y * wa + b.y * wb;
    const z = a.z * wa + b.z * wb;
    const hyp = Math.hypot(x, y, z) || 1;
    positions.push(
      Math.atan2(y, x) / toRad,
      Math.asin(Math.min(1, Math.max(-1, z / hyp))) / toRad,
      Math.sin(t * Math.PI) * apex,
    );
  }
  return positions;
}
