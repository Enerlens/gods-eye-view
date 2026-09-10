// Carrying a bus forward from a stale fix, along its own run.
//
// The claim this module has to earn is that it never invents anything. Every
// test below is written against that: the drawn position is bounded BELOW by
// the last real fix (a slow prediction cannot rewind a bus), bounded ABOVE by
// three explicit caps, and absent entirely when the operator's prediction says
// nothing usable — in which case the layer draws the fix, exactly as it did
// before this module existed.
//
// The geometry fixtures are deliberately straight west→east lines at Rouen's
// latitude: a projection whose along-track arithmetic is wrong shows up as a
// metre count, not as a shape that looks vaguely right.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingBetween,
  distanceAtTime,
  pathCumulativeMeters,
  pathFromStops,
  pointAtDistance,
  advanceAlongRun,
  decodeWireStops,
  prepareRun,
  projectAlongRun,
  projectPointOnPath,
  runAnchors,
  runFromRoutePayload,
  runFromWireVehicle,
  stopsBetween,
  stopsPassed,
  PROJECTION_MAX_ADVANCE_M,
  PROJECTION_MAX_ADVANCE_MS,
  PROJECTION_MAX_OFFSET_M,
  PROJECTION_MAX_SPEED_MPS,
} from './transitProjection.js';
import { haversineMeters } from './transitRouteShape.js';

/** Latitude of Pont-de-l'Arche, where the fleet in the screenshot runs. */
const LAT = 49.3;
// Both scales are read off the SAME haversine the module measures with, not
// off a metres-per-degree constant: the two differ by ~0.13%, which is a metre
// over 800 m and would make every assertion below argue with its own fixture.
/** One degree of longitude there, in metres — ~72.6 km. */
const LON_M = haversineMeters([0, LAT], [1, LAT]);
/** One degree of latitude, in metres. */
const LAT_M = haversineMeters([1.15, LAT], [1.15, LAT + 1]);

/** A straight west→east path of `steps` vertices, `stepM` metres apart. */
function eastwardPath(steps, stepM = 100, lon0 = 1.15) {
  return Array.from({ length: steps }, (_unused, i) => [lon0 + (i * stepM) / LON_M, LAT]);
}

/** A stop on that path at `atM` metres from its start. */
function stopAt(atM, times = {}, lon0 = 1.15) {
  return { lon: lon0 + atM / LON_M, lat: LAT, ...times };
}

const T0 = Date.UTC(2026, 8, 10, 10, 34, 0);

/**
 * Commit the WHOLE prediction and skip the age gate.
 *
 * Most tests below are about the geometry and the caps, and the shipped
 * defaults — 70% of the plan, nothing under 30 s — would otherwise multiply
 * every expected metre by 0.7 and hide what is being asserted. The defaults
 * get their own test.
 */
const FULL = Object.freeze({ commit: 1, minFixAgeMs: 0 });

test('cumulative distance follows the path and starts at zero', () => {
  const cumulative = pathCumulativeMeters(eastwardPath(5, 100));
  assert.equal(cumulative.length, 5);
  assert.equal(cumulative[0], 0);
  // Haversine over a degree fraction: within a metre over 400 m is the honest
  // tolerance for a planar step converted back through a sphere.
  assert.ok(Math.abs(cumulative[4] - 400) < 1, `expected ~400 m, got ${cumulative[4]}`);
  assert.deepEqual(pathCumulativeMeters([]), []);
  assert.deepEqual(pathCumulativeMeters(null), []);
});

test('a point projects to its along-track distance, and reports how far off it lies', () => {
  const path = eastwardPath(11, 100);
  const on = projectPointOnPath(path, [1.15 + 250 / LON_M, LAT]);
  assert.ok(Math.abs(on.distanceAlongM - 250) < 1);
  assert.ok(on.offsetM < 1);

  // 30 m north of the line, halfway along it: same along-track distance, and
  // the offset is what tells a caller the fix is beside its own run.
  const beside = projectPointOnPath(path, [1.15 + 250 / LON_M, LAT + 30 / LAT_M]);
  assert.ok(Math.abs(beside.distanceAlongM - 250) < 1);
  assert.ok(Math.abs(beside.offsetM - 30) < 2, `expected ~30 m off, got ${beside.offsetM}`);

  // Past the end: clamped to the path, never extrapolated off it.
  const past = projectPointOnPath(path, [1.15 + 5000 / LON_M, LAT]);
  assert.ok(Math.abs(past.distanceAlongM - 1000) < 1);

  assert.equal(projectPointOnPath([[1.15, LAT]], [1.15, LAT]), null);
  assert.equal(projectPointOnPath(eastwardPath(4), [NaN, LAT]), null);
});

test('a distance along the path becomes a position and a heading', () => {
  const path = eastwardPath(11, 100);
  const point = pointAtDistance(path, 450);
  assert.ok(Math.abs((point.lon - 1.15) * LON_M - 450) < 1);
  assert.equal(point.lat, LAT);
  // Due east.
  assert.ok(Math.abs(point.bearing - 90) < 0.5, `expected ~90°, got ${point.bearing}`);

  // Both ends clamp rather than run off the line.
  assert.ok(Math.abs((pointAtDistance(path, -500).lon - 1.15) * LON_M) < 1);
  assert.ok(Math.abs((pointAtDistance(path, 99_999).lon - 1.15) * LON_M - 1000) < 1);
  assert.equal(pointAtDistance([], 10), null);
});

test('a bearing is null when there is no direction to report', () => {
  assert.ok(Math.abs(bearingBetween([1.15, LAT], [1.16, LAT]) - 90) < 0.5);
  assert.ok(Math.abs(bearingBetween([1.15, LAT], [1.15, LAT + 0.01])) < 0.5);
  assert.equal(bearingBetween([1.15, LAT], [1.15, LAT]), null);
  assert.equal(bearingBetween(null, [1.15, LAT]), null);
});

test('predicted stop times become a monotone time-to-distance curve', () => {
  const path = eastwardPath(21, 100);
  const stops = [
    stopAt(0, { arrivalMs: T0, departureMs: T0 }),
    stopAt(500, { arrivalMs: T0 + 60_000, departureMs: T0 + 90_000 }),
    stopAt(1000, { arrivalMs: T0 + 150_000 }),
  ];
  const anchors = runAnchors(path, stops);
  // Two anchors for the middle stop: the arrival and the later departure, at
  // the SAME distance. That pair is what makes the bus wait at the kerb.
  assert.deepEqual(anchors.map((a) => Math.round(a.s)), [0, 0, 500, 500, 1000]);
  assert.deepEqual(anchors.map((a) => a.t - T0), [0, 0, 60_000, 90_000, 150_000]);

  // The dwell reads as a dwell: still at the stop 20 s after arriving.
  assert.ok(Math.abs(distanceAtTime(anchors, T0 + 80_000) - 500) < 1);
  // And moving again once the operator says it left.
  assert.ok(Math.abs(distanceAtTime(anchors, T0 + 120_000) - 750) < 1);
  // Clamped at both ends of the plan.
  assert.equal(distanceAtTime(anchors, T0 - 60_000), 0);
  assert.ok(Math.abs(distanceAtTime(anchors, T0 + 600_000) - 1000) < 1);
  assert.equal(distanceAtTime([], T0), null);
});

test('a stop that belongs to another variant of the line is left out of the curve', () => {
  const path = eastwardPath(21, 100);
  const stops = [
    stopAt(200, { arrivalMs: T0 }),
    // 900 m north of the trace: a branch this run is not on.
    { lon: 1.15 + 400 / LON_M, lat: LAT + 900 / LAT_M, arrivalMs: T0 + 60_000 },
    stopAt(800, { arrivalMs: T0 + 120_000 }),
  ];
  const anchors = runAnchors(path, stops, { maxOffsetM: PROJECTION_MAX_OFFSET_M });
  assert.deepEqual(anchors.map((a) => Math.round(a.s)), [200, 800]);
});

test('stops out of order in space or in time are dropped, never reordered', () => {
  const path = eastwardPath(21, 100);
  const anchors = runAnchors(path, [
    stopAt(200, { arrivalMs: T0 }),
    // Backwards along the line.
    stopAt(100, { arrivalMs: T0 + 30_000 }),
    // Backwards in time.
    stopAt(600, { arrivalMs: T0 - 30_000 }),
    stopAt(800, { arrivalMs: T0 + 120_000 }),
  ]);
  assert.deepEqual(anchors.map((a) => Math.round(a.s)), [200, 800]);
  assert.ok(anchors.every((a, i) => i === 0 || a.t >= anchors[i - 1].t));
});

test('the fleet fallback threads the remaining stops onto a path that starts at the bus', () => {
  const path = pathFromStops([1.15, LAT], [
    stopAt(300, {}),
    stopAt(600, {}),
    // A stop the bus is already sitting on: no zero-length segment.
    { lon: 1.15 + 600 / LON_M, lat: LAT },
    { lon: NaN, lat: LAT },
  ]);
  assert.equal(path.length, 3);
  assert.deepEqual(path[0], [1.15, LAT]);
  const cumulative = pathCumulativeMeters(path);
  assert.ok(Math.abs(cumulative[2] - 600) < 1);
  assert.deepEqual(pathFromStops(null, null), []);
});

test('a stale fix is carried forward to where the operator says the bus now is', () => {
  const path = eastwardPath(41, 100);
  // The measured Normandy case: the fix is 189 s old, and the run's own
  // prediction has it four stops further along.
  const stops = [
    stopAt(0, { arrivalMs: T0, departureMs: T0 }),
    stopAt(300, { arrivalMs: T0 + 60_000, departureMs: T0 + 60_000 }),
    stopAt(600, { arrivalMs: T0 + 120_000, departureMs: T0 + 120_000 }),
    stopAt(900, { arrivalMs: T0 + 180_000, departureMs: T0 + 180_000 }),
    stopAt(1200, { arrivalMs: T0 + 240_000 }),
  ];
  const anchors = runAnchors(path, stops);
  const out = projectAlongRun({
    path,
    anchors,
    fix: [1.15, LAT],
    fixMs: T0,
    nowMs: T0 + 189_000,
  }, FULL);
  assert.equal(out.basis, 'schedule');
  assert.equal(out.cappedBy, null);
  // 189 s into a 5 m/s plan: 945 m along the line, three stops past the fix.
  assert.ok(Math.abs(out.advanceM - 945) < 5, `expected ~945 m, got ${out.advanceM}`);
  assert.ok(Math.abs((out.lon - 1.15) * LON_M - 945) < 5);
  assert.equal(out.ageMs, 189_000);
  assert.ok(Math.abs(out.bearing - 90) < 0.5);
  assert.equal(stopsBetween(stops, path, 0, 945), 3);
});

test('a prediction that lags the fix never drags the bus backwards', () => {
  const path = eastwardPath(41, 100);
  // The operator's plan places the run at 200 m — behind the 800 m where it
  // was actually last seen. The fix wins.
  const stops = [
    stopAt(0, { arrivalMs: T0 - 120_000 }),
    stopAt(200, { arrivalMs: T0 + 30_000 }),
    stopAt(400, { arrivalMs: T0 + 300_000 }),
  ];
  const anchors = runAnchors(path, stops);
  const out = projectAlongRun({
    path,
    anchors,
    fix: [1.15 + 800 / LON_M, LAT],
    fixMs: T0,
    nowMs: T0 + 60_000,
  });
  // Nothing to advance, so nothing is drawn differently: the caller keeps the
  // real fix and the ordinary glyph.
  assert.equal(out, null);
});

test('the advance is capped in time, in distance and in speed', () => {
  const path = eastwardPath(401, 100);
  // A plan that would run 40 km in ten minutes — 240 km/h, which is what two
  // recomputed predictions a few seconds apart can look like.
  const anchors = [{ s: 0, t: T0 }, { s: 40_000, t: T0 + 600_000 }];
  const base = { path, anchors, fix: [1.15, LAT], fixMs: T0 };

  // Speed cap bites first at 60 s: 25 m/s × 60 s = 1 500 m.
  const fast = projectAlongRun({ ...base, nowMs: T0 + 60_000 }, FULL);
  assert.equal(fast.cappedBy, 'speed');
  assert.ok(Math.abs(fast.advanceM - PROJECTION_MAX_SPEED_MPS * 60) < 1);

  // Distance cap bites once the speed cap would exceed 6 km.
  const far = projectAlongRun({ ...base, nowMs: T0 + 290_000 }, FULL);
  assert.equal(far.cappedBy, 'distance');
  assert.ok(Math.abs(far.advanceM - PROJECTION_MAX_ADVANCE_M) < 1);

  // Past the time cap the clock stops advancing: an hour of silence draws the
  // same position as five minutes of it, and the caller still sees the true age.
  const late = projectAlongRun({ ...base, nowMs: T0 + 3_600_000 }, FULL);
  assert.ok(late.advanceM <= PROJECTION_MAX_ADVANCE_M + 1);
  assert.equal(late.ageMs, 3_600_000);
  const atCap = projectAlongRun({ ...base, nowMs: T0 + PROJECTION_MAX_ADVANCE_MS }, FULL);
  assert.ok(Math.abs(late.advanceM - atCap.advanceM) < 1);
});

test('a plan that is exhausted stops the bus at its last predicted stop', () => {
  const path = eastwardPath(41, 100);
  const anchors = [{ s: 0, t: T0 }, { s: 500, t: T0 + 100_000 }];
  const out = projectAlongRun({
    path, anchors, fix: [1.15, LAT], fixMs: T0, nowMs: T0 + 280_000,
  }, FULL);
  // 280 s of silence, but the operator only ever predicted as far as 500 m.
  assert.ok(Math.abs(out.advanceM - 500) < 1);
  assert.equal(out.cappedBy, null);
});

test('a fix that is not on its own run is not moved along it', () => {
  const path = eastwardPath(41, 100);
  const anchors = [{ s: 0, t: T0 }, { s: 1000, t: T0 + 200_000 }];
  const out = projectAlongRun({
    path,
    anchors,
    // A kilometre north of the trace: a diversion, or the wrong shape variant.
    fix: [1.15, LAT + 1000 / LAT_M],
    fixMs: T0,
    nowMs: T0 + 60_000,
  });
  assert.equal(out, null);
});

test('nothing to say returns nothing, and the layer keeps its old behaviour', () => {
  const path = eastwardPath(41, 100);
  const anchors = [{ s: 0, t: T0 }, { s: 1000, t: T0 + 200_000 }];
  const base = { path, anchors, fix: [1.15, LAT], fixMs: T0, nowMs: T0 + 60_000 };
  assert.equal(projectAlongRun({ ...base, anchors: [] }), null);
  assert.equal(projectAlongRun({ ...base, path: [[1.15, LAT]] }), null);
  assert.equal(projectAlongRun({ ...base, fixMs: NaN }), null);
  // A clock that went backwards, and the instant of the fix itself.
  assert.equal(projectAlongRun({ ...base, nowMs: T0 - 1 }), null);
  assert.equal(projectAlongRun({ ...base, nowMs: T0 }), null);
});

test('the stop count is what the card prints, and it never counts the fix\'s own stop', () => {
  const path = eastwardPath(41, 100);
  const stops = [stopAt(0), stopAt(300), stopAt(600), stopAt(900)];
  assert.equal(stopsBetween(stops, path, 0, 950), 3);
  assert.equal(stopsBetween(stops, path, 300, 950), 2);
  // Exactly on a stop counts it: the bus reached it.
  assert.equal(stopsBetween(stops, path, 0, 300), 1);
  assert.equal(stopsBetween(stops, path, 900, 950), 0);
  assert.equal(stopsBetween(stops, path, 500, 400), 0);
  assert.equal(stopsBetween([], path, 0, 900), 0);
});

test('a run is prepared once and advanced per frame, allocating nothing', () => {
  const path = eastwardPath(41, 100);
  const stops = [
    stopAt(0, { arrivalMs: T0, departureMs: T0 }),
    stopAt(600, { arrivalMs: T0 + 120_000, departureMs: T0 + 120_000 }),
    stopAt(1200, { arrivalMs: T0 + 240_000 }),
  ];
  const run = prepareRun({ path, stops, fix: [1.15, LAT], fixMs: T0 });
  assert.ok(Math.abs(run.fixAlongM) < 1);
  assert.equal(run.anchors.length, 5);

  // The same object comes back every frame: the render pass owns it, and a
  // fleet of 300 buses at 60 Hz allocates nothing to move.
  const scratch = {};
  const first = advanceAlongRun(run, T0 + 60_000, FULL, scratch);
  assert.equal(first, scratch);
  const second = advanceAlongRun(run, T0 + 120_000, FULL, scratch);
  assert.equal(second, scratch);
  assert.ok(Math.abs(scratch.advanceM - 600) < 5, `expected ~600 m, got ${scratch.advanceM}`);
  assert.ok(Math.abs(scratch.alongM - 600) < 5);

  // And it agrees with the one-call form to the metre.
  const oneShot = projectAlongRun({ path, stops, fix: [1.15, LAT], fixMs: T0, nowMs: T0 + 120_000 }, FULL);
  assert.ok(Math.abs(oneShot.advanceM - scratch.advanceM) < 0.001);
});

test('a run with nothing to stand on prepares to nothing', () => {
  const path = eastwardPath(41, 100);
  const stops = [stopAt(0, { arrivalMs: T0 }), stopAt(600, { arrivalMs: T0 + 120_000 })];
  assert.equal(prepareRun({ path: [[1.15, LAT]], stops, fix: [1.15, LAT], fixMs: T0 }), null);
  assert.equal(prepareRun({ path, stops: [], fix: [1.15, LAT], fixMs: T0 }), null);
  assert.equal(prepareRun({ path, stops, fix: [1.15, LAT], fixMs: NaN }), null);
  // A fix a kilometre off its own trace.
  assert.equal(prepareRun({ path, stops, fix: [1.15, LAT + 1000 / LAT_M], fixMs: T0 }), null);
  assert.equal(advanceAlongRun(null, T0 + 1000), null);
});

test('the shipped defaults commit 70% of the plan, and leave a fresh fix alone', () => {
  const path = eastwardPath(41, 100);
  const anchors = [{ s: 0, t: T0 }, { s: 1000, t: T0 + 200_000 }];
  const base = { path, anchors, fix: [1.15, LAT], fixMs: T0 };

  // 100 s into a 5 m/s plan is 500 m planned; 350 m is what gets drawn.
  const shipped = projectAlongRun({ ...base, nowMs: T0 + 100_000 });
  assert.ok(Math.abs(shipped.advanceM - 350) < 1, `expected ~350 m, got ${shipped.advanceM}`);
  assert.ok(Math.abs(projectAlongRun({ ...base, nowMs: T0 + 100_000 }, FULL).advanceM - 500) < 1);

  // Under the age gate nothing is drawn differently at all: a 29-second-old fix
  // is already where the bus is.
  assert.equal(projectAlongRun({ ...base, nowMs: T0 + 29_000 }), null);
  assert.ok(projectAlongRun({ ...base, nowMs: T0 + 31_000 }));
  // And the gate is a floor on AGE, not on the advance: the caps still apply
  // to what a committed advance is allowed to be.
  assert.equal(projectAlongRun({ ...base, nowMs: T0 + 29_000 }, { minFixAgeMs: 0 }) === null, false);
});

// --- The two shapes a run arrives in ----------------------------------------

test('the wire\'s flat stop array decodes against the vehicle\'s own fix', () => {
  const fixMs = T0;
  const stops = decodeWireStops([
    1.16, LAT, 60, 0,
    1.17, LAT, 180, 25,
    // A row missing its arrival time is dropped rather than defaulted.
    1.18, LAT, NaN, 0,
  ], fixMs);
  assert.equal(stops.length, 2);
  assert.equal(stops[0].arrivalMs, fixMs + 60_000);
  // No dwell published: the departure is the arrival, so the curve does not
  // invent a wait at the kerb.
  assert.equal(stops[0].departureMs, stops[0].arrivalMs);
  assert.equal(stops[1].departureMs, fixMs + 180_000 + 25_000);

  // A trailing partial row is ignored, and a fix with no clock decodes nothing.
  assert.equal(decodeWireStops([1.16, LAT, 60, 0, 1.17, LAT], fixMs).length, 1);
  assert.deepEqual(decodeWireStops([1.16, LAT, 60, 0], NaN), []);
  assert.deepEqual(decodeWireStops(null, fixMs), []);
});

test('a viewport vehicle carries everything its own projection needs', () => {
  const vehicle = {
    lon: 1.15,
    lat: LAT,
    timestampMs: T0,
    nextStops: [
      1.15 + 300 / LON_M, LAT, 60, 0,
      1.15 + 600 / LON_M, LAT, 120, 0,
      1.15 + 900 / LON_M, LAT, 180, 0,
    ],
  };
  const run = runFromWireVehicle(vehicle);
  assert.ok(Math.abs(run.fixAlongM) < 1);
  const out = advanceAlongRun(run, T0 + 120_000, FULL);
  assert.ok(Math.abs(out.advanceM - 600) < 5, `expected ~600 m, got ${out.advanceM}`);

  // Everything a vehicle can be missing leaves it drawn at its fix.
  assert.equal(runFromWireVehicle({ ...vehicle, timestampMs: null }), null);
  assert.equal(runFromWireVehicle({ ...vehicle, nextStops: [1.16, LAT, 60, 0] }), null);
  assert.equal(runFromWireVehicle({ ...vehicle, nextStops: undefined }), null);
  assert.equal(runFromWireVehicle(null), null);
});

test('the selected vehicle projects on its real trace, and only on a matched one', () => {
  const shape = eastwardPath(41, 100);
  const vehicle = { lon: 1.15, lat: LAT, timestampMs: T0 };
  const payload = {
    shapes: [shape],
    shapeMatch: { matched: true, variants: 3 },
    stops: [
      stopAt(0, { arrivalMs: T0 }),
      stopAt(600, { arrivalMs: T0 + 120_000 }),
      stopAt(1200, { arrivalMs: T0 + 240_000 }),
    ],
  };
  const run = runFromRoutePayload(payload, vehicle);
  assert.equal(run.path, shape);
  assert.ok(Math.abs(advanceAlongRun(run, T0 + 120_000, FULL).advanceM - 600) < 5);

  // The whole line is not this run. A viewer told "we could not tell which
  // branch" must not then watch the bus driven down one of them.
  assert.equal(runFromRoutePayload({ ...payload, shapeMatch: { matched: false } }, vehicle), null);
  assert.equal(runFromRoutePayload({ ...payload, shapes: [shape, shape] }, vehicle), null);
  assert.equal(runFromRoutePayload({ ...payload, stops: [] }, vehicle), null);
  assert.equal(runFromRoutePayload(null, vehicle), null);
});

test('a prepared run counts its own passed stops without walking the trace again', () => {
  const path = eastwardPath(41, 100);
  const stops = [
    stopAt(0, { arrivalMs: T0, departureMs: T0 }),
    stopAt(300, { arrivalMs: T0 + 60_000, departureMs: T0 + 60_000 }),
    stopAt(600, { arrivalMs: T0 + 120_000, departureMs: T0 + 120_000 }),
    stopAt(900, { arrivalMs: T0 + 180_000 }),
  ];
  const run = prepareRun({ path, stops, fix: [1.15, LAT], fixMs: T0 });
  const out = advanceAlongRun(run, T0 + 130_000, FULL);
  assert.ok(Math.abs(out.alongM - 650) < 5);
  assert.equal(stopsPassed(run, out.alongM), 2);
  // Same answer as the long form, which is what the tests above pin.
  assert.equal(stopsPassed(run, out.alongM), stopsBetween(stops, path, run.fixAlongM, out.alongM));
  assert.equal(stopsPassed(null, 100), 0);
});
