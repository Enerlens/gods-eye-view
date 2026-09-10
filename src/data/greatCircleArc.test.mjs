import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARC_APEX_MAX_M,
  ARC_APEX_MIN_M,
  greatCircleArc,
  greatCircleDistanceM,
  greatCircleWaypoint,
} from './greatCircleArc.js';

test('the great-circle arc touches down exactly on both endpoints', () => {
  const from = [2.60, 46.60];
  const to = [-3.70, 40.42];
  const arc = greatCircleArc(from, to, { samples: 9 });
  assert.equal(arc.length, 27);
  assert.ok(Math.abs(arc[0] - from[0]) < 1e-6 && Math.abs(arc[1] - from[1]) < 1e-6);
  assert.equal(arc[2], 0, 'the arc starts on the ground');
  assert.ok(Math.abs(arc.at(-3) - to[0]) < 1e-6 && Math.abs(arc.at(-2) - to[1]) < 1e-6);
  assert.equal(Math.round(arc.at(-1)), 0, 'the arc lands on the ground');
  // Apex in the middle, and higher than every other sample.
  const heights = [];
  for (let i = 2; i < arc.length; i += 3) heights.push(arc[i]);
  assert.equal(heights.indexOf(Math.max(...heights)), (heights.length - 1) / 2);
});

test('the arc is a great circle, not a lon/lat lerp', () => {
  const arc = greatCircleArc([2.60, 46.60], [-3.70, 40.42], { samples: 3 });
  // The midpoint of a lon/lat lerp would be exactly (-0.55, 43.51); a real
  // great circle bows away from it.
  assert.ok(Math.abs(arc[3] - -0.55) > 0.05 || Math.abs(arc[4] - 43.51) > 0.05);
});

test('coincident endpoints degrade to a point instead of dividing by zero', () => {
  const arc = greatCircleArc([2.6, 46.6], [2.6, 46.6], { samples: 5 });
  for (let i = 0; i < arc.length; i += 3) {
    assert.ok(Number.isFinite(arc[i]) && Number.isFinite(arc[i + 1]) && Number.isFinite(arc[i + 2]));
    assert.ok(Math.abs(arc[i] - 2.6) < 1e-6);
  }
});

test('the apex clamp is a parameter, so a domestic hop does not bow like a border flow', () => {
  const paris = [2.55, 49.01];
  const lyon = [5.08, 45.73];
  const apexOf = (arc) => {
    let peak = 0;
    for (let i = 2; i < arc.length; i += 3) peak = Math.max(peak, arc[i]);
    return peak;
  };
  // Defaults on a ~400 km leg: a 66 km bow — right for a country-scale flow,
  // six times the cruise altitude of the aircraft actually flying it.
  assert.ok(apexOf(greatCircleArc(paris, lyon)) > 60_000);
  const flight = greatCircleArc(paris, lyon, { apexRatio: 0.06, apexMinM: 12_000, apexMaxM: 220_000 });
  assert.ok(apexOf(flight) > 20_000 && apexOf(flight) < 30_000);
  // Both clamps still hold at the extremes.
  // `samples: 49` puts a vertex exactly on the apex; the even default straddles it.
  assert.equal(Math.round(apexOf(greatCircleArc([2.55, 49.01], [2.36, 48.73], { samples: 49 }))), ARC_APEX_MIN_M);
  assert.equal(Math.round(apexOf(greatCircleArc([2.55, 49.01], [-118.41, 33.94], { samples: 49 }))), ARC_APEX_MAX_M);
});

// ── Distance and waypoint ───────────────────────────────────────────────────

test('the distance agrees with the arc that will be drawn from it', () => {
  // The two must share a formula: a caller that measures a chord one way and
  // draws it another gets an arrow whose head lands off its own tip.
  const from = [7.42, 47.45];
  const to = [8.23, 46.80];
  const metres = greatCircleDistanceM(from, to);
  assert.ok(Math.abs(metres - 94_000) < 2_000, `${Math.round(metres)} m`);
  assert.equal(greatCircleDistanceM(from, from), 0);
  assert.equal(greatCircleDistanceM(null, to), 0);
  assert.equal(greatCircleDistanceM(from, [Number.NaN, 3]), 0);
});

test('a waypoint lands at the measured distance, on the same great circle', () => {
  const from = [2.60, 46.60];
  const to = [-3.70, 40.42];
  const total = greatCircleDistanceM(from, to);
  const half = greatCircleWaypoint(from, to, total / 2);
  assert.ok(Math.abs(greatCircleDistanceM(from, half) - total / 2) < 1);
  assert.ok(Math.abs(greatCircleDistanceM(half, to) - total / 2) < 1);
  // And it IS the arc's own midpoint, not a lon/lat average.
  const arc = greatCircleArc(from, to, { samples: 3 });
  assert.ok(Math.abs(arc[3] - half[0]) < 1e-9 && Math.abs(arc[4] - half[1]) < 1e-9);
});

test('a waypoint is allowed to overshoot, because a fixed-length glyph must', () => {
  // Switzerland is 94 km from the French border and a border-flow arrow is
  // 170 km long. It has to keep pointing at Bern, not stop short of it.
  const from = [7.42, 47.45];
  const to = [8.23, 46.80];
  const beyond = greatCircleWaypoint(from, to, 170_000);
  assert.ok(greatCircleDistanceM(from, beyond) > greatCircleDistanceM(from, to));
  // Still on the same great circle: the three points stay collinear on the
  // sphere, so from → to → beyond adds up.
  const detour = greatCircleDistanceM(from, to) + greatCircleDistanceM(to, beyond);
  assert.ok(Math.abs(detour - greatCircleDistanceM(from, beyond)) < 1, `${detour}`);
});

test('a waypoint with no great circle to walk answers the point itself', () => {
  assert.deepEqual(greatCircleWaypoint([3, 47], [3, 47], 50_000), [3, 47]);
  assert.equal(greatCircleWaypoint(null, [3, 47], 1), null);
  assert.equal(greatCircleWaypoint([3, 47], [4, 48], Number.NaN), null);
});
