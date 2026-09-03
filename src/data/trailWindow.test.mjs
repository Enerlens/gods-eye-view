// src/data/trailWindow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  TRAIL_GROUND_LENGTH_M,
  TRAIL_MAX_POINTS,
  TRAIL_MIN_POINTS,
  trailGroundLengthM,
  trimTrailToGroundLength,
} from './trailWindow.js';

/**
 * `count` fixes spaced `stepM` apart along a meridian at the given altitude —
 * one poll's worth of travel per step.
 */
function track(count, stepM, altitudeM = 0) {
  const metresPerDegreeLat = 111_320;
  return Array.from({ length: count }, (_, i) => Cesium.Cartesian3.fromDegrees(
    0, i * (stepM / metresPerDegreeLat), altitudeM,
  ));
}

test('a fast contact and a slow one show the same length of ground', () => {
  // The defect, stated as a test. At a ~15 s poll an airliner covers ~3.75 km
  // between fixes and a vessel ~75 m — a fifty-fold difference that the old
  // shared `TRAIL_MAX_POINTS = 400` turned into a fifty-fold difference in
  // trail length on screen. Both tracks below are 400 fixes: the same age.
  const airliner = trimTrailToGroundLength(track(400, 3_750, 10_000));
  const vessel = trimTrailToGroundLength(track(400, 75));

  const airlinerLength = trailGroundLengthM(airliner);
  const vesselLength = trailGroundLengthM(vessel);
  // The vessel never accumulates the budget, so it keeps its whole history.
  assert.equal(vessel.length, 400);
  // The airliner is trimmed to the budget rather than to a fix count.
  assert.ok(airlinerLength <= TRAIL_GROUND_LENGTH_M * 1.01,
    `airliner trail ${Math.round(airlinerLength / 1000)} km exceeds the window`);
  assert.ok(airlinerLength > TRAIL_GROUND_LENGTH_M * 0.9,
    'and it fills the window rather than under-drawing it');
  // Before the fix the airliner drew ~1 500 km against the vessel's 30 km.
  assert.ok(airlinerLength < 400 * 3_750 * 0.5,
    'the untrimmed 400-fix trail would be several times the window');
  assert.ok(vesselLength < airlinerLength, 'a slow contact still shows less ground');
});

test('the window is a distance, so the fix count follows the speed', () => {
  // Same budget, three speeds: the faster the contact, the fewer fixes survive.
  const slow = trimTrailToGroundLength(track(400, 1_000));
  const fast = trimTrailToGroundLength(track(400, 20_000));
  assert.ok(slow.length > fast.length);
  const slowLength = trailGroundLengthM(slow);
  const fastLength = trailGroundLengthM(fast);
  // Both land inside one segment of the same budget.
  assert.ok(Math.abs(slowLength - fastLength) <= 20_000,
    `${Math.round(slowLength / 1000)} km vs ${Math.round(fastLength / 1000)} km`);
});

test('a moored vessel keeps its history instead of collapsing to a dot', () => {
  // A stationary trail has zero ground length, so it costs nothing against the
  // budget and survives whole — which is the honest reading of "it has not
  // moved", not an absence.
  const moored = Array.from({ length: 50 }, () => Cesium.Cartesian3.fromDegrees(0, 0, 0));
  assert.equal(trimTrailToGroundLength(moored).length, 50);
});

test('the floor guarantees a visible history even under an impossible budget', () => {
  // A contact fast enough that ONE segment blows the whole budget would trim to
  // a two-point stub. The floor is what keeps a readable past on screen.
  const veryFast = track(400, 5_000_000);
  const kept = trimTrailToGroundLength(veryFast);
  assert.equal(kept.length, TRAIL_MIN_POINTS);
  assert.ok(trailGroundLengthM(kept) > TRAIL_GROUND_LENGTH_M,
    'the floor deliberately overruns the budget rather than showing nothing');
});

test('the vertex ceiling wins over the floor and over the budget', () => {
  // The ceiling is a rendering bound — the primitive is rebuilt every poll —
  // so it is the one constraint that may not be traded away.
  const dense = track(5_000, 10);
  const kept = trimTrailToGroundLength(dense);
  assert.equal(kept.length, TRAIL_MAX_POINTS);
  // Even with an absurd floor.
  assert.equal(
    trimTrailToGroundLength(dense, { minPoints: 9_999 }).length,
    TRAIL_MAX_POINTS,
  );
});

test('the newest fixes are the ones kept', () => {
  const positions = track(400, 20_000);
  const kept = trimTrailToGroundLength(positions);
  assert.deepEqual(kept.at(-1), positions.at(-1), 'the head is the latest fix');
  assert.deepEqual(kept, positions.slice(positions.length - kept.length));
});

test('degenerate inputs are inert, never throwing into a poll loop', () => {
  assert.deepEqual(trimTrailToGroundLength([]), []);
  assert.deepEqual(trimTrailToGroundLength(null), []);
  assert.equal(trimTrailToGroundLength(track(1, 100)).length, 1);
  assert.equal(trailGroundLengthM([]), 0);
  assert.equal(trailGroundLengthM(null), 0);
});
