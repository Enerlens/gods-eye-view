/**
 * @module transitProjection
 *
 * Where a bus is NOW, from where the operator last saw it and where the same
 * operator says it will be next.
 *
 * WHY THIS EXISTS. A GTFS-Realtime position is a statement about the PAST, and
 * on most French networks a fairly old one. Measured 2026-09-10 over the
 * Atoumod aggregate (Normandy, 239 vehicles): the median fix on screen is 189 s
 * old, the p90 is 350 s, and the feed publishes no speed at all. Over the same
 * fleet at the same instant, the operator's OWN `TripUpdate` places the run a
 * median of 2 to 3 stops further along than the position feed does (p90: 5 to
 * 7). The glyph is not merely late — it is late in a way the publisher has
 * already corrected in another message we are already downloading.
 *
 * Bordeaux is the counter-example that keeps this optional: TBM republishes
 * every 20 s with speed and bearing on 100% of its fleet, and there is nothing
 * to project there. This module answers a question, it does not impose one.
 *
 * WHAT IT DOES AND DOES NOT INVENT. It never dead-reckons on a bearing: a bus
 * extrapolated along a compass heading drives through buildings and rivers, and
 * on Atoumod there is no speed to extrapolate with anyway. Instead the vehicle
 * is moved ALONG ITS RUN, on a time-to-distance curve built entirely from
 * values the operator published:
 *
 *   - the PATH is the run's own trace (the shape the map already draws) or,
 *     when no trace is at hand, the straight line through the run's remaining
 *     stops;
 *   - the SPEED is never estimated. It falls out of two predicted times and
 *     the distance between the two stops they belong to. Delay is already
 *     inside it, because these are predicted times, not timetable times;
 *   - the ANCHOR is the last real fix. The drawn position never goes BACK from
 *     it ({@link projectAlongRun} takes the max), so a slow prediction can
 *     never rewind a bus that was seen further along.
 *
 * IT DOES NOT BELIEVE THE PREDICTION ALL THE WAY. Only
 * {@link PROJECTION_COMMIT} of the planned advance is drawn, and nothing at all
 * is drawn for a fix younger than {@link PROJECTION_MIN_FIX_AGE_MS}. Both
 * numbers come from an offline replay of the real feed rather than from taste —
 * committing the whole prediction halves the median error and makes the p90
 * WORSE than doing nothing, because predictions overshoot. The table is on
 * {@link PROJECTION_COMMIT}.
 *
 * THE THREE CAPS, because a projection that runs away is worse than a stale
 * glyph: the advance is bounded in time ({@link PROJECTION_MAX_ADVANCE_MS}), in
 * distance ({@link PROJECTION_MAX_ADVANCE_M}) and in speed
 * ({@link PROJECTION_MAX_SPEED_MPS}). A vehicle that reaches a cap stops there
 * rather than being taken any further, and one whose run says nothing usable is
 * drawn at its last real fix — which is the layer's behaviour without this
 * module, and the thing every early return here falls back to.
 *
 * THE CALLER OWES THE VIEWER A LABEL. Every result carries `advanceM` and
 * `basis`, and a caller that draws a projected position without saying so is
 * making a claim this module cannot make for it.
 *
 * Dependency-free apart from the shared path helpers, and side-effect-free (no
 * Cesium, no DOM, no fetch) so it runs identically in the browser, in the
 * dev-server proxy and under `node --test`.
 */
import { haversineMeters } from './transitRouteShape.js';

/**
 * How far past its last fix a vehicle may be carried, in ms.
 *
 * Ten minutes, which is exactly how long the layer keeps a vehicle before
 * dropping it for having stopped reporting: as long as the fleet believes a
 * contact exists, this believes its operator's plan for it.
 *
 * It was five minutes first, and a live check at Pont-de-l'Arche found the
 * whole visible fleet pinned against that cap and therefore motionless — the
 * Normandy aggregate's fixes were 380 s old, past a ceiling set from its own
 * 350 s p90. Raising it costs nothing measurable: replayed over the same
 * 22 minutes, mean error 323 m at 5 minutes against 320 m at 10, and the
 * number of vehicles held at a cap falls from 500 to 298. The two caps below
 * are what actually bound the damage.
 */
export const PROJECTION_MAX_ADVANCE_MS = 10 * 60 * 1000;
/**
 * How far past its last fix a vehicle may be carried, in metres.
 *
 * Six kilometres is five minutes at 72 km/h — an interurban coach on a trunk
 * road, which is the fastest thing this layer draws outside a tram reservation.
 */
export const PROJECTION_MAX_ADVANCE_M = 6_000;
/**
 * Ceiling on the DRAWN speed, m/s (90 km/h).
 *
 * Not a plausibility filter on the feed: a cap on what this module is willing
 * to render. Two predicted times a few seconds apart on stops a kilometre away
 * — which a recomputed prediction does produce — would otherwise fire a bus
 * across a département in one frame.
 */
export const PROJECTION_MAX_SPEED_MPS = 25;
/**
 * Below this fix age nothing is projected, in ms.
 *
 * A fix half a minute old is already where the bus is; moving it adds noise to
 * a good answer. Measured over the 22-minute replay described below, gating at
 * 30 s left the error unchanged and cut the number of vehicles this module
 * touches at all by 9%.
 */
export const PROJECTION_MIN_FIX_AGE_MS = 30_000;
/**
 * How much of the operator's planned advance is actually committed, 0..1.
 *
 * Not a fudge factor — a measured one, and the single most useful number in
 * this module. Replayed offline against 22 minutes of the Atoumod aggregate
 * (6 314 evaluations where a LATER real fix existed within 45 s of the instant
 * being drawn, so the answer was never in the input), the error of the drawn
 * position against that real fix was:
 *
 *   commit  p50      p90      mean     better / worse
 *   —       292 m    807 m    397 m    (drawing the raw fix, today)
 *   1.00    171 m    842 m    344 m    3034 / 1825
 *   0.80    159 m    741 m    323 m    3420 / 1465
 *   0.70    165 m    707 m    321 m    3511 / 1374
 *   0.50    185 m    712 m    326 m    3646 / 1239
 *
 * Committing the whole prediction halves the median and makes the TAIL worse
 * than doing nothing: predictions overshoot, and an overshoot is the failure a
 * viewer actually notices — a bus drawn past a junction it has not reached.
 * 0.7 keeps almost all of the median gain, takes 100 m off the p90, and leaves
 * 72% of projected vehicles closer to the truth than the raw fix was.
 */
export const PROJECTION_COMMIT = 0.7;
/**
 * How far from its own run a fix may be and still be projected, in metres.
 *
 * Beyond this the vehicle is not on the trace we hold: a wrong shape variant, a
 * bus on diversion, or a fix that landed in a field. Projecting it would move
 * it sideways onto a line it is not driving.
 */
export const PROJECTION_MAX_OFFSET_M = 400;

/** Metres per degree of latitude — the local planar frame's vertical scale. */
const METRES_PER_DEGREE = 111_320;
/** Slack for "the bus is AT this stop" when counting stops gone by, in metres. */
const STOP_EPSILON_M = 1;

/** How many metres one degree of longitude is worth at this latitude. */
function lonScale(latitudeDeg) {
  return METRES_PER_DEGREE * Math.cos(latitudeDeg * (Math.PI / 180));
}

/** A usable `[lon, lat]` pair. */
function usablePoint(point) {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

/**
 * Cumulative ground distance at each vertex of a path, in metres.
 *
 * @param {Array<[number, number]>} path `[lon, lat]` vertices.
 * @returns {number[]} `out[i]` is the distance from the first vertex to `i`;
 *   an empty array for a path with no usable vertex.
 */
export function pathCumulativeMeters(path) {
  const points = Array.isArray(path) ? path : [];
  if (!points.length) return [];
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    out.push(out[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  return out;
}

/**
 * Where a point falls ALONG a path, and how far off it lies.
 *
 * The along-track distance is what makes a schedule projection possible: it
 * turns two positions on a winding line into two numbers that can be compared.
 *
 * @param {Array<[number, number]>} path `[lon, lat]` vertices.
 * @param {[number, number]} point `[lon, lat]`.
 * @param {number[]} [cumulative] Precomputed {@link pathCumulativeMeters}.
 * @returns {?{distanceAlongM: number, offsetM: number, segment: number}}
 *   null when the path has no segment to project onto.
 */
export function projectPointOnPath(path, point, cumulative = null) {
  const points = Array.isArray(path) ? path : [];
  if (points.length < 2 || !usablePoint(point)) return null;
  const along = cumulative && cumulative.length === points.length
    ? cumulative
    : pathCumulativeMeters(points);

  const kx = lonScale(point[1]);
  const px = point[0] * kx;
  const py = point[1] * METRES_PER_DEGREE;

  let bestSq = Infinity;
  let bestAlong = 0;
  let bestSegment = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!usablePoint(a) || !usablePoint(b)) continue;
    const ax = a[0] * kx;
    const ay = a[1] * METRES_PER_DEGREE;
    const dx = b[0] * kx - ax;
    const dy = b[1] * METRES_PER_DEGREE - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = 0;
    if (lengthSq > 0) {
      t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
    }
    const ex = ax + t * dx - px;
    const ey = ay + t * dy - py;
    const distanceSq = ex * ex + ey * ey;
    if (distanceSq < bestSq) {
      bestSq = distanceSq;
      // The segment's own length from `cumulative`, not from the planar frame:
      // the frame is a local approximation and the curve must stay consistent
      // with the distances every other caller reads off the same array.
      bestAlong = along[i - 1] + t * (along[i] - along[i - 1]);
      bestSegment = i - 1;
    }
  }
  if (!Number.isFinite(bestSq) || bestSq === Infinity) return null;
  return { distanceAlongM: bestAlong, offsetM: Math.sqrt(bestSq), segment: bestSegment };
}

/**
 * The `[lon, lat]` at a given distance along a path, plus the heading there.
 *
 * The bearing is the direction of the segment being travelled, which is the
 * one honest heading for a vehicle whose feed publishes none — 28% of the
 * Normandy aggregate — and is only ever used for the pointer, never to rotate
 * the vehicle icon.
 *
 * @param {Array<[number, number]>} path
 * @param {number} distanceAlongM Clamped to the path's own ends.
 * @param {number[]} [cumulative] Precomputed {@link pathCumulativeMeters}.
 * @param {Object} [out] Reused result object, so the render loop allocates
 *   nothing per vehicle per frame.
 * @returns {?{lon: number, lat: number, bearing: ?number}}
 */
export function pointAtDistance(path, distanceAlongM, cumulative = null, out = {}) {
  const points = Array.isArray(path) ? path : [];
  if (!points.length) return null;
  if (points.length === 1) {
    if (!usablePoint(points[0])) return null;
    out.lon = points[0][0];
    out.lat = points[0][1];
    out.bearing = null;
    return out;
  }
  const along = cumulative && cumulative.length === points.length
    ? cumulative
    : pathCumulativeMeters(points);
  const total = along[along.length - 1];
  const target = Math.min(total, Math.max(0, Number.isFinite(distanceAlongM) ? distanceAlongM : 0));

  let i = 1;
  while (i < along.length - 1 && along[i] < target) i += 1;
  const a = points[i - 1];
  const b = points[i];
  const span = along[i] - along[i - 1];
  const t = span > 0 ? (target - along[i - 1]) / span : 0;
  out.lon = a[0] + (b[0] - a[0]) * t;
  out.lat = a[1] + (b[1] - a[1]) * t;
  out.bearing = bearingBetween(a, b);
  return out;
}

/** Compass bearing from `a` to `b`, degrees clockwise from north. */
export function bearingBetween(a, b) {
  if (!usablePoint(a) || !usablePoint(b)) return null;
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  if (x === 0 && y === 0) return null;
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

/**
 * The operator's own plan, as a monotone time-to-distance curve.
 *
 * One anchor per predicted stop time, at the distance that stop sits along the
 * path. A stop that publishes both an arrival and a later departure yields TWO
 * anchors at the SAME distance — which is how a dwell is drawn: the bus reaches
 * the stop, waits there, and leaves when the operator says it leaves.
 *
 * Anchors that would move the run backwards in time or in distance are dropped
 * rather than reordered: a prediction whose stops are out of order is a
 * prediction this module has no business rewriting.
 *
 * @param {Array<[number, number]>} path
 * @param {Array<Object>} stops Ordered stops carrying `lon`/`lat` and
 *   `arrivalMs`/`departureMs`.
 * @param {Object} [options]
 * @param {number} [options.maxOffsetM] Stops further than this from the path
 *   are ignored: they belong to another variant of the line.
 * @returns {Array<{s: number, t: number}>} Strictly non-decreasing in both.
 */
export function runAnchors(path, stops, { maxOffsetM = PROJECTION_MAX_OFFSET_M } = {}) {
  const points = Array.isArray(path) ? path : [];
  const list = Array.isArray(stops) ? stops : [];
  if (points.length < 2 || !list.length) return [];
  const cumulative = pathCumulativeMeters(points);

  const anchors = [];
  let lastS = -Infinity;
  let lastT = -Infinity;
  for (const stop of list) {
    const lon = Number(stop?.lon);
    const lat = Number(stop?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const hit = projectPointOnPath(points, [lon, lat], cumulative);
    if (!hit || hit.offsetM > maxOffsetM) continue;
    const s = hit.distanceAlongM;
    if (s < lastS) continue;
    const arrival = Number(stop?.arrivalMs);
    const departure = Number(stop?.departureMs);
    // Arrival first, then departure: the pair is what makes the vehicle wait.
    for (const t of [arrival, departure]) {
      if (!Number.isFinite(t) || t < lastT) continue;
      anchors.push({ s, t });
      lastT = t;
      lastS = s;
    }
  }
  return anchors;
}

/**
 * Build a path out of a run's remaining stops, starting at the vehicle.
 *
 * The fallback for the whole fleet, where the network's trace is not in hand:
 * the stops themselves are a coarse version of the line, and a bus drawn on the
 * straight line between two stops 400 m apart is wrong by a corner, not by a
 * kilometre. The vehicle's own fix is the first vertex so the projection starts
 * exactly where it was last seen.
 *
 * No attempt is made to drop a leading stop that makes the path double back on
 * itself, though 8% of them do (measured: the turn at the first stop exceeds
 * 120° for 7.6% of vehicles standing more than 60 m from it). Dropping them was
 * tried and moved the mean error from 321 m to 318 m — those U-turns are mostly
 * real, because buses really do reverse at a terminus.
 *
 * @param {[number, number]} fix `[lon, lat]` of the last reported position.
 * @param {Array<Object>} stops Ordered stops carrying `lon`/`lat`.
 * @returns {Array<[number, number]>}
 */
export function pathFromStops(fix, stops) {
  const path = usablePoint(fix) ? [[fix[0], fix[1]]] : [];
  for (const stop of Array.isArray(stops) ? stops : []) {
    const lon = Number(stop?.lon);
    const lat = Number(stop?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const previous = path[path.length - 1];
    // A stop the bus is sitting on adds a zero-length segment and a division
    // this module would rather not do.
    if (previous && haversineMeters(previous, [lon, lat]) < 1) continue;
    path.push([lon, lat]);
  }
  return path;
}

/**
 * Read the operator's curve at an instant: how far along the run it says the
 * vehicle is at time `t`.
 *
 * Piecewise linear between anchors, clamped at both ends — before the first
 * anchor the run has not started, after the last one the plan is exhausted and
 * this module refuses to guess past it.
 *
 * @param {Array<{s: number, t: number}>} anchors From {@link runAnchors}.
 * @param {number} t Epoch ms.
 * @returns {?number} Distance along the path in metres, or null with no anchors.
 */
export function distanceAtTime(anchors, t) {
  const list = Array.isArray(anchors) ? anchors : [];
  if (!list.length || !Number.isFinite(t)) return null;
  if (t <= list[0].t) return list[0].s;
  const last = list[list.length - 1];
  if (t >= last.t) return last.s;
  for (let i = 1; i < list.length; i += 1) {
    const a = list[i - 1];
    const b = list[i];
    if (t > b.t) continue;
    const span = b.t - a.t;
    if (span <= 0) return b.s;
    return a.s + (b.s - a.s) * ((t - a.t) / span);
  }
  return last.s;
}

/**
 * Everything about one run that does not change until the next fix.
 *
 * Split out because the alternative is a per-frame allocation per vehicle: a
 * viewport can hold hundreds of buses and the render pass runs at 60 Hz, so the
 * cumulative-distance array, the anchor list and the fix's own along-track
 * position are all computed ONCE here, when a poll brings a new fix or a click
 * brings a new trace. {@link advanceAlongRun} then reads them and writes into a
 * caller-owned object, allocating nothing at all.
 *
 * @param {Object} params
 * @param {Array<[number, number]>} params.path The run's trace, or the line
 *   through its stops from {@link pathFromStops}.
 * @param {Array<Object>} [params.stops] Ordered stops; when given, the anchors
 *   are built from them here rather than being passed in.
 * @param {Array<{s: number, t: number}>} [params.anchors] Prebuilt anchors.
 * @param {[number, number]} params.fix `[lon, lat]` of the last reported position.
 * @param {number} params.fixMs Epoch ms of that fix.
 * @param {Object} [options]
 * @param {number} [options.maxOffsetM]
 * @returns {?Object} A prepared run, or null when nothing usable was given.
 */
export function prepareRun({ path, stops, anchors, fix, fixMs }, options = {}) {
  const { maxOffsetM = PROJECTION_MAX_OFFSET_M } = options;
  const points = Array.isArray(path) ? path : [];
  if (points.length < 2 || !Number.isFinite(fixMs)) return null;

  const cumulative = pathCumulativeMeters(points);
  const list = Array.isArray(anchors) && anchors.length
    ? anchors
    : runAnchors(points, stops, { maxOffsetM });
  if (!list.length) return null;

  const anchored = projectPointOnPath(points, fix, cumulative);
  // A fix that is not on its own run is not a fix this module can move along it.
  if (!anchored || anchored.offsetM > maxOffsetM) return null;

  return {
    path: points,
    cumulative,
    anchors: list,
    stops: Array.isArray(stops) ? stops : null,
    fixMs,
    fixAlongM: anchored.distanceAlongM,
    offsetM: anchored.offsetM,
  };
}

/**
 * Advance a prepared run to an instant, writing the answer into `out`.
 *
 * The rule in one line: `s(now) = max(s_fix, curve(now))`, capped. The vehicle
 * is carried forward by the operator's own prediction, and never dragged back
 * behind the last place the operator actually saw it.
 *
 * @param {Object} run From {@link prepareRun}.
 * @param {number} nowMs
 * @param {Object} [options]
 * @param {number} [options.maxAdvanceMs]
 * @param {number} [options.maxAdvanceM]
 * @param {number} [options.maxSpeedMps]
 * @param {Object} [out] Reused result object; created when omitted.
 * @returns {?Object} `out` with `lon`, `lat`, `bearing`, `advanceM`, `ageMs`,
 *   `alongM`, `basis` and `cappedBy` — or null when there is nothing to
 *   advance, in which case the caller draws the fix and the layer behaves
 *   exactly as it did before this module existed.
 */
export function advanceAlongRun(run, nowMs, options = {}, out = {}) {
  const {
    maxAdvanceMs = PROJECTION_MAX_ADVANCE_MS,
    maxAdvanceM = PROJECTION_MAX_ADVANCE_M,
    maxSpeedMps = PROJECTION_MAX_SPEED_MPS,
    minFixAgeMs = PROJECTION_MIN_FIX_AGE_MS,
    commit = PROJECTION_COMMIT,
  } = options;
  if (!run || !Number.isFinite(nowMs) || nowMs <= run.fixMs) return null;
  if (nowMs - run.fixMs < minFixAgeMs) return null;

  // The clock is capped BEFORE the curve is read: a prediction whose last
  // anchor is half an hour away must not teleport a vehicle to its terminus
  // just because its feed went quiet.
  const cappedNow = Math.min(nowMs, run.fixMs + maxAdvanceMs);
  const planned = distanceAtTime(run.anchors, cappedNow);
  if (!Number.isFinite(planned)) return null;

  const elapsedS = (cappedNow - run.fixMs) / 1000;
  let cappedBy = nowMs > cappedNow ? 'time' : null;
  let target = planned > run.fixAlongM ? planned : run.fixAlongM;

  const bySpeed = run.fixAlongM + maxSpeedMps * elapsedS;
  if (target > bySpeed) {
    target = bySpeed;
    cappedBy = 'speed';
  }
  const byDistance = run.fixAlongM + maxAdvanceM;
  if (target > byDistance) {
    target = byDistance;
    cappedBy = 'distance';
  }

  // Only part of the plan is committed, and the caps are what it is committed
  // against: shrinking after the caps can only ever move the vehicle back
  // towards the place it was actually seen.
  const advanceM = (target - run.fixAlongM) * Math.min(1, Math.max(0, commit));
  const committed = run.fixAlongM + advanceM;
  // Under a metre there is nothing to say and nothing to draw differently; the
  // caller keeps the real fix and keeps its ordinary glyph.
  if (advanceM < 1) return null;

  const point = pointAtDistance(run.path, committed, run.cumulative, out);
  if (!point) return null;
  out.advanceM = advanceM;
  out.alongM = committed;
  out.ageMs = nowMs - run.fixMs;
  out.offsetM = run.offsetM;
  out.basis = 'schedule';
  out.cappedBy = cappedBy;
  return out;
}

/**
 * Prepare and advance in one call — the readable form, for a caller that is
 * not in a render loop.
 *
 * @param {Object} params As {@link prepareRun}, plus `nowMs`.
 * @param {Object} [options]
 * @returns {?Object} As {@link advanceAlongRun}.
 */
export function projectAlongRun({ path, stops, anchors, fix, fixMs, nowMs }, options = {}) {
  const run = prepareRun({ path, stops, anchors, fix, fixMs }, options);
  return run ? advanceAlongRun(run, nowMs, options) : null;
}

/**
 * How many of a run's stops the projection has carried the vehicle past.
 *
 * The number the card prints. Counted against the STOPS rather than the path so
 * it says something a rider understands — "two stops further than the last
 * point" — instead of a distance in metres.
 *
 * @param {Array<Object>} stops Ordered stops carrying `lon`/`lat`.
 * @param {Array<[number, number]>} path
 * @param {number} fromM Distance along the path of the last real fix.
 * @param {number} toM Distance along the path of the drawn position.
 * @param {number[]} [cumulative] Precomputed {@link pathCumulativeMeters}.
 * @returns {number}
 */
export function stopsBetween(stops, path, fromM, toM, cumulative = null) {
  const points = Array.isArray(path) ? path : [];
  const list = Array.isArray(stops) ? stops : [];
  if (points.length < 2 || !list.length) return 0;
  if (!Number.isFinite(fromM) || !Number.isFinite(toM) || toM <= fromM) return 0;
  const along = cumulative && cumulative.length === points.length
    ? cumulative
    : pathCumulativeMeters(points);
  let count = 0;
  for (const stop of list) {
    const lon = Number(stop?.lon);
    const lat = Number(stop?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const hit = projectPointOnPath(points, [lon, lat], along);
    if (!hit) continue;
    // The metre of slack is the difference between "passed a stop" and
    // "stood at one": a fix reported AT a stop lands on it to within
    // rounding, and counting that as a stop gone by would print one more
    // than the rider went past.
    if (hit.distanceAlongM > fromM + STOP_EPSILON_M
      && hit.distanceAlongM <= toM + STOP_EPSILON_M) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// The two shapes a run arrives in
// ---------------------------------------------------------------------------
/**
 * Number of `[lon, lat, arrivalDeltaS, dwellS]` values per stop on the wire.
 *
 * The viewport answer carries the next few stops as one flat array of numbers
 * rather than as objects: at 4 stops on a few hundred vehicles the difference
 * between `{"lon":1.21807,…}` and `[1.21807,…]` is most of the field's cost.
 */
export const WIRE_STOP_STRIDE = 4;

/**
 * Turn the wire's flat stop array back into stops the projection can read.
 *
 * Times arrive as SECONDS from the vehicle's own fix, which is both compact and
 * self-describing: a client that has the fix has the clock the deltas are
 * against, and a stop's dwell is one more small integer rather than a second
 * epoch millisecond value.
 *
 * @param {number[]} flat `[lon, lat, arrivalDeltaS, dwellS, …]`.
 * @param {number} fixMs Epoch ms the deltas are measured from.
 * @returns {Array<Object>} Stops with `lon`, `lat`, `arrivalMs`, `departureMs`.
 */
export function decodeWireStops(flat, fixMs) {
  const values = Array.isArray(flat) ? flat : [];
  if (!Number.isFinite(fixMs)) return [];
  const stops = [];
  for (let i = 0; i + WIRE_STOP_STRIDE <= values.length; i += WIRE_STOP_STRIDE) {
    const lon = values[i];
    const lat = values[i + 1];
    const arrivalDeltaS = values[i + 2];
    const dwellS = values[i + 3];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(arrivalDeltaS)) continue;
    const arrivalMs = fixMs + arrivalDeltaS * 1000;
    stops.push({
      lon,
      lat,
      arrivalMs,
      departureMs: Number.isFinite(dwellS) && dwellS > 0 ? arrivalMs + dwellS * 1000 : arrivalMs,
    });
  }
  return stops;
}

/**
 * The run of a vehicle the viewport answer described, or null.
 *
 * The whole-fleet path: no trace, just the handful of stops the proxy attached,
 * threaded from the bus outwards. Cheap enough to rebuild for every vehicle on
 * every poll, which is what happens.
 *
 * @param {Object} vehicle Wire vehicle record.
 * @param {Object} [options] Forwarded to {@link prepareRun}.
 * @returns {?Object}
 */
export function runFromWireVehicle(vehicle, options = {}) {
  const fixMs = vehicle?.timestampMs;
  if (!Number.isFinite(fixMs) || !Number.isFinite(vehicle?.lon) || !Number.isFinite(vehicle?.lat)) {
    return null;
  }
  const stops = decodeWireStops(vehicle.nextStops, fixMs);
  if (stops.length < 2) return null;
  const fix = [vehicle.lon, vehicle.lat];
  return prepareRun({ path: pathFromStops(fix, stops), stops, fix, fixMs }, options);
}

/**
 * The run of the SELECTED vehicle, from the trace the click already fetched.
 *
 * Strictly better than {@link runFromWireVehicle} and used in its place the
 * moment `/api/transit-fr/trip` answers: the path is the operator's own shape
 * rather than a straight line between stops, so the bus follows the road it is
 * drawn on rather than cutting the corner off it. The stops are the whole run's
 * — the ones already behind the vehicle are harmless, because the anchor is the
 * fix's own along-track position and the curve is read at the current time.
 *
 * @param {Object} payload The `/trip` answer held on the record.
 * @param {Object} vehicle Wire vehicle record.
 * @param {Object} [options] Forwarded to {@link prepareRun}.
 * @returns {?Object}
 */
export function runFromRoutePayload(payload, vehicle, options = {}) {
  const fixMs = vehicle?.timestampMs;
  if (!Number.isFinite(fixMs) || !Number.isFinite(vehicle?.lon) || !Number.isFinite(vehicle?.lat)) {
    return null;
  }
  // One matched variant is a claim about THIS run; the whole line is not, and
  // projecting along a branch the bus may not be taking would move it onto a
  // road it is not on.
  const shapes = Array.isArray(payload?.shapes) ? payload.shapes : [];
  if (shapes.length !== 1 || !payload?.shapeMatch?.matched) return null;
  const stops = Array.isArray(payload.stops) ? payload.stops : [];
  if (stops.length < 2) return null;
  return prepareRun({
    path: shapes[0],
    stops,
    fix: [vehicle.lon, vehicle.lat],
    fixMs,
  }, options);
}

/**
 * The stop count for a prepared run, from its fix to a drawn distance.
 *
 * The form a render loop can afford: it reuses the run's own cumulative array
 * rather than walking a 700-vertex trace again, which is what
 * {@link stopsBetween} would do if it were called per frame.
 *
 * @param {Object} run From {@link prepareRun}.
 * @param {number} alongM Distance along the path of the drawn position.
 * @returns {number}
 */
export function stopsPassed(run, alongM) {
  if (!run?.stops) return 0;
  return stopsBetween(run.stops, run.path, run.fixAlongM, alongM, run.cumulative);
}
