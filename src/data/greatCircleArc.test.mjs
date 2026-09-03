import test from 'node:test';
import assert from 'node:assert/strict';
import { ARC_APEX_MAX_M, ARC_APEX_MIN_M, greatCircleArc } from './greatCircleArc.js';

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
