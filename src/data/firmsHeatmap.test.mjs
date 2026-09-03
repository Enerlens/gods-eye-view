// src/data/firmsHeatmap.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine seam).
// Pure function — no viewer/DOM needed; imported directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heatNormalized, heatScore, mapAnalystRecord } from './firmsHeatmap.js';

const FULL_FIRE = {
  index: 7,
  lat: 30.51,
  lon: -98.21,
  frp: 1520.4,
  confidence: 0.9,
  satellite: 'N21',
  sensor: 'VIIRS',
  acqMs: 1_753_600_000_000,
};

test('firms analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_FIRE);
  assert.deepEqual(r, {
    id: 'FIRE-00007',
    lat: 30.51,
    lon: -98.21,
    frp: 1520.4,
    confidence: 0.9,
    satellite: 'N21',
    acqTime: 1_753_600_000_000,
  });
});

test('firms analyst record: id matches the layer pick-id convention (5-digit pad)', () => {
  assert.equal(mapAnalystRecord({ ...FULL_FIRE, index: 0 }).id, 'FIRE-00000');
  assert.equal(mapAnalystRecord({ ...FULL_FIRE, index: 12345 }).id, 'FIRE-12345');
});

test('firms analyst record: blank satellite falls back to sensor, then null', () => {
  assert.equal(mapAnalystRecord({ ...FULL_FIRE, satellite: '' }).satellite, 'VIIRS');
  assert.equal(mapAnalystRecord({ ...FULL_FIRE, satellite: '', sensor: '' }).satellite, null);
});

test('firms analyst record: unparseable acq time (0 sentinel) becomes null', () => {
  assert.equal(mapAnalystRecord({ ...FULL_FIRE, acqMs: 0 }).acqTime, null);
});

test('firms analyst record: empty record yields nulls, never NaN/undefined', () => {
  const r = mapAnalystRecord(undefined);
  assert.equal(r.id, 'FIRE-00000');
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('firms analyst record: output is JSON-safe (no Cesium types leak)', () => {
  const r = mapAnalystRecord({ ...FULL_FIRE, contextEntity: {}, position: { x: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.equal('position' in r, false);
});

// ── The fire ramp is absolute, and it counts per unit ground area ───────────

/** A cell holding `n` typical detections, centred inside its degree cell. */
function cellWith(n, latCell, { maxFrp = 20 } = {}) {
  return { latCell, lonCell: 0, count: n, intensity: n * 8, night: 0, maxFrp };
}

test('a degree cell near the pole is not painted hotter for covering less ground', () => {
  // CARTOGRAPHIE, equal-area rule. `count`/`intensity`/`night` are extensive —
  // they scale with the ground the cell covers — and a 1° cell at 60°N covers
  // half the land of one on the equator. Equal counts must NOT read equal.
  const equator = heatScore(cellWith(50, 0), 1);
  const sixty = heatScore(cellWith(50, 59.5), 1); // centre ≈ 60°N, cos = 0.5
  assert.ok(sixty > equator * 1.9 && sixty < equator * 2.1,
    `a 60°N cell of equal count must score ~2x the density, got ${sixty / equator}`);
  // Halving the count at 60°N restores parity with the equator: same fires per
  // square kilometre, same colour.
  const halved = heatScore(cellWith(25, 59.5), 1);
  assert.ok(Math.abs(halved - equator) / equator < 0.05,
    'half the count over half the ground is the same density');
});

test('the polar divisor is floored so three Arctic detections cannot paint the pole red', () => {
  // cos(latitude) approaches zero at the pole; without a floor the division
  // explodes. The floor is 0.25 (75.5°), so past it the score stops growing.
  const at80 = heatScore(cellWith(3, 79.5), 1);
  const at88 = heatScore(cellWith(3, 87.5), 1);
  assert.equal(at80, at88, 'past the floor, latitude stops multiplying the score');
  assert.ok(heatNormalized(at88, 1) < 0.42, 'three detections stay off the hot stops');
});

test('the ramp does not depend on what else is on screen, or on the window size', () => {
  // The old normaliser was `Math.max(1, ...cells.map(heatScore))` over the
  // cells CLIPPED TO THE CAMERA, and those bounds come from
  // `computeViewRectangle()`, which depends on the canvas aspect ratio. Two
  // people opening the same share link at different window sizes saw different
  // colours for the same fire. The domain is now fixed.
  const gironde = heatScore(cellWith(60, 44.5), 1);
  const alone = heatNormalized(gironde, 1);
  // An Australian megafire entering the frame changes nothing about Gironde.
  const australia = heatScore(cellWith(4000, -33.5), 1);
  assert.ok(australia > gironde * 10, 'the test fixture really is far hotter');
  assert.equal(heatNormalized(gironde, 1), alone);
  // And the ramp saturates rather than letting one cell rescale the world.
  assert.equal(heatNormalized(australia, 1), 1);
});

test('the two cell bands agree about what a colour means on the ground', () => {
  // A 2° cell covers 4x the ground of a 1° cell, so the same DENSITY must
  // land on the same ramp position in both bands — otherwise the map changes
  // its mind about a place when the camera crosses the LOD boundary.
  const fine = heatNormalized(heatScore(cellWith(50, 0), 1), 1);
  const coarse = heatNormalized(heatScore(cellWith(200, 0), 2), 2);
  assert.ok(Math.abs(fine - coarse) < 0.02,
    `same density must read the same in both bands, got ${fine} vs ${coarse}`);
});

test('the peak fire power in a cell is not inflated by latitude', () => {
  // maxFrp is INTENSIVE — a maximum in megawatts, not a count. Dividing it by
  // cos(latitude) would make the brightest single fire in a cell look brighter
  // for being near a pole.
  const equator = heatScore({ latCell: 0, lonCell: 0, count: 0, intensity: 0, night: 0, maxFrp: 100 }, 1);
  const sixty = heatScore({ latCell: 59.5, lonCell: 0, count: 0, intensity: 0, night: 0, maxFrp: 100 }, 1);
  assert.equal(equator, sixty);
});
