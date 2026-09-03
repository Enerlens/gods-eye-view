/**
 * @module flightRoutePlan
 * @description The scheduled leg of a tracked flight, turned into something
 * drawable and something framable — and nothing else.
 *
 * ── What this is, and what it is not ────────────────────────────────────────
 * adsbdb answers a CALLSIGN with the leg that callsign is scheduled to fly
 * today. It is a timetable entry, not a measurement: no part of it comes from
 * the transponder. The trail behind the aircraft is the flown track; this arc
 * is the plan. Everything here is named `plan` for that reason, and the caller
 * is expected to caption it {@link ROUTE_PLAN_KICKER} — the same words the
 * cockpit already prints over the same data.
 *
 * The plausibility gate lives one level up in `routePlausible.js`, which the
 * flights layer applies before a route ever reaches this module: a wrong-leg
 * answer is rejected, never drawn faintly. What is left for this module is
 * geometry and honesty of framing.
 *
 * ── Why the framing math is here, and why 15° ───────────────────────────────
 * "See its origin and its destination on one view" is a camera height, and the
 * height that satisfies it is set by the field of view, not by the horizon.
 * Everywhere below the clamp, `dMax / tan(15°)` — the height at which the
 * farther endpoint lands 15° off the boresight — is well above the height at
 * which that same endpoint clears the horizon, so one formula covers both. The
 * clamp is 12 000 km, reached at a 3 200 km leg: past there the two airports
 * are far enough around the planet that no camera height brings them into one
 * frame, `routeFitsOneView` says so, and the arc and its two pins are what
 * still tell the operator where the far end went.
 *
 * 15°, not the 30° the frustum could hold, for two measured reasons. Cesium's
 * `fov` is HORIZONTAL on a wide canvas, so the vertical half-angle is only
 * ~20° at a 16:10 aspect — an endpoint aimed at 20° lands exactly on the
 * bottom edge, which is where the first live run put Málaga (y = 996 of 1000).
 * And the globe is not the whole canvas: the legend and the CONTEXT rail take
 * roughly 350 px off each side, so 15° is what keeps both airports inside the
 * band that is actually unobstructed.
 *
 * ── Why the camera stands off the route's FLANK ─────────────────────────────
 * The standoff azimuth is the route bearing plus 90°, so the leg runs ACROSS
 * the screen. That is not a composition preference: with a fixed
 * south-of-target standoff, the two endpoints sit at different depths, the
 * near one foreshortens off the bottom of the frame, and which end that is
 * depends on the aircraft's heading. Perpendicular, both ends are at the same
 * depth and are framed symmetrically whatever direction the flight runs.
 */

import { greatCircleBearingDeg, greatCircleKm } from './routePlausible.js';

/** Caption for the arc. Same words the cockpit card uses for the same data. */
export const ROUTE_PLAN_KICKER = 'ESTIMATED FLIGHT PLAN';

/** @constant {number} Vertices per route arc — longer legs than the energy arcs. */
export const ROUTE_ARC_SAMPLES = 97;
/** @constant {number} Apex as a fraction of the chord: a schematic bow, not a profile. */
export const ROUTE_ARC_APEX_RATIO = 0.06;
/** @constant {number} Apex floor — still clear of cruise altitude on a short hop. */
export const ROUTE_ARC_APEX_MIN_M = 14_000;
/** @constant {number} Apex ceiling on a long-haul leg. */
export const ROUTE_ARC_APEX_MAX_M = 220_000;

/** @constant {number} Half-angle the farther endpoint is framed at. See the header. */
const FRAME_HALF_ANGLE_RAD = 15 * (Math.PI / 180);
/** @constant {number} Never closer than this — a 10 km leg is not a 10 km view. */
const FRAME_MIN_HEIGHT_M = 40_000;
/** @constant {number} Past this the far endpoint is behind the planet anyway. */
const FRAME_MAX_HEIGHT_M = 12_000_000;

/** An airport reads as `CDG · Paris`; either half alone still reads. */
export function routeAirportLabel(airport) {
  return [airport?.code, airport?.name].filter(Boolean).join(' · ');
}

function usableAirport(airport) {
  return Boolean(airport)
    && Number.isFinite(airport.lat)
    && Number.isFinite(airport.lon);
}

/**
 * Camera height above the aircraft that puts the farther endpoint in frame.
 * @param {number} farthestKm Greatest great-circle distance to an endpoint, km.
 * @returns {number} Metres above the aircraft.
 */
export function routeFrameHeightM(farthestKm) {
  if (!Number.isFinite(farthestKm) || farthestKm <= 0) return FRAME_MIN_HEIGHT_M;
  const needed = (farthestKm * 1000) / Math.tan(FRAME_HALF_ANGLE_RAD);
  return Math.min(FRAME_MAX_HEIGHT_M, Math.max(FRAME_MIN_HEIGHT_M, needed));
}

/**
 * Whether the framing this plan asks for can actually show both airports.
 *
 * False means the leg is longer than a globe can present in one view and the
 * height was clamped — the caller should say so rather than let the operator
 * conclude the destination pin failed to draw.
 * @param {number} farthestKm Greatest great-circle distance to an endpoint, km.
 * @returns {boolean}
 */
export function routeFitsOneView(farthestKm) {
  if (!Number.isFinite(farthestKm) || farthestKm <= 0) return true;
  return (farthestKm * 1000) / Math.tan(FRAME_HALF_ANGLE_RAD) <= FRAME_MAX_HEIGHT_M;
}

/**
 * Build the drawable/framable description of a tracked flight's scheduled leg.
 *
 * @param {object} input
 * @param {string} input.icao24 Contact identity, for the entity/entry ids.
 * @param {{origin?:object, destination?:object}|null} input.route Plausibility-gated adsbdb route.
 * @param {number} input.latitude Aircraft latitude, degrees.
 * @param {number} input.longitude Aircraft longitude, degrees.
 * @returns {{
 *   id: string, signature: string,
 *   origin: {code:string, name:string, lat:number, lon:number, label:string},
 *   destination: {code:string, name:string, lat:number, lon:number, label:string},
 *   legKm: number, farthestKm: number, frameHeightM: number, fitsOneView: boolean,
 * }|null} Null when the route is absent or carries no coordinates.
 */
export function buildFlightRoutePlan({ icao24, route, latitude, longitude } = {}) {
  const id = String(icao24 ?? '').trim();
  if (!id || !usableAirport(route?.origin) || !usableAirport(route?.destination)) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const origin = {
    code: String(route.origin.code ?? ''),
    name: String(route.origin.name ?? ''),
    lat: route.origin.lat,
    lon: route.origin.lon,
    label: routeAirportLabel(route.origin),
  };
  const destination = {
    code: String(route.destination.code ?? ''),
    name: String(route.destination.name ?? ''),
    lat: route.destination.lat,
    lon: route.destination.lon,
    label: routeAirportLabel(route.destination),
  };
  const farthestKm = Math.max(
    greatCircleKm(latitude, longitude, origin.lat, origin.lon),
    greatCircleKm(latitude, longitude, destination.lat, destination.lon),
  );
  return {
    id,
    // Identity of the DRAWING, not of the contact: the arc is rebuilt only
    // when the leg itself changes, never on the position refresh underneath it.
    signature: `${id}|${origin.code}|${origin.lat},${origin.lon}|${destination.code}|${destination.lat},${destination.lon}`,
    origin,
    destination,
    legKm: greatCircleKm(origin.lat, origin.lon, destination.lat, destination.lon),
    // Bearing of the LEG, not of the aircraft: it decides which flank the
    // camera stands off so the route runs across the screen.
    bearingDeg: greatCircleBearingDeg(origin.lat, origin.lon, destination.lat, destination.lon),
    farthestKm,
    frameHeightM: routeFrameHeightM(farthestKm),
    fitsOneView: routeFitsOneView(farthestKm),
  };
}

/**
 * Camera offset, in the aircraft's east/north/up frame, for the route view.
 *
 * Pitched 75° down rather than straight overhead — a nadir view flattens the
 * arc's bow into the line it is drawn to not be mistaken for — and standing
 * off the route's right flank, so the leg runs across the screen. See the
 * module header for why the flank matters.
 * @param {number} heightM Height above the aircraft.
 * @param {number} [bearingDeg=0] Bearing of the leg, degrees clockwise from north.
 * @returns {{east:number, north:number, up:number}}
 */
export function routeFrameOffsetEnu(heightM, bearingDeg = 0) {
  const height = Number.isFinite(heightM) && heightM > 0 ? heightM : FRAME_MIN_HEIGHT_M;
  const elevation = 75 * (Math.PI / 180);
  const range = height / Math.sin(elevation);
  const ground = range * Math.cos(elevation);
  const azimuth = ((Number.isFinite(bearingDeg) ? bearingDeg : 0) + 90) * (Math.PI / 180);
  return { east: ground * Math.sin(azimuth), north: ground * Math.cos(azimuth), up: height };
}
