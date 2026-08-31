import test from 'node:test';
import assert from 'node:assert/strict';

import {
  C,
  LAMBERT93_VALID_BBOX,
  N,
  XS,
  YS,
  isPlausibleFrenchPoint,
  lambert93ToWgs84,
  wgs84ToLambert93,
} from './lambert93.mjs';

// The whole point of deriving the constants instead of pasting them: these
// three numbers are what IGN publishes for Lambert-93 in NTG_71, and if the
// derivation drifts from them by so much as a millimetre the projection is a
// different projection and every station moves.
test('derived constants reproduce the IGN published values', () => {
  assert.ok(Math.abs(N - 0.7256077650) < 5e-10, `n = ${N}`);
  assert.ok(Math.abs(C - 11754255.426) < 0.001, `C = ${C}`);
  assert.ok(Math.abs(YS - 12655612.050) < 0.001, `Ys = ${YS}`);
  assert.equal(XS, 700000);
});

test('the projection origin is the false easting/northing, exactly', () => {
  const { x, y } = wgs84ToLambert93(3, 46.5);
  assert.ok(Math.abs(x - 700000) < 1e-6, `x = ${x}`);
  assert.ok(Math.abs(y - 6600000) < 1e-6, `y = ${y}`);

  const back = lambert93ToWgs84(700000, 6600000);
  assert.ok(Math.abs(back.lon - 3) < 1e-9);
  assert.ok(Math.abs(back.lat - 46.5) < 1e-9);
});

test('inverse round-trips the forward projection to under a millimetre', () => {
  // A grid spanning the CRS's area of use: Brittany to Alsace, Corsica to
  // Dunkirk. Millimetre agreement over that span is the only claim that makes
  // a station's published metre position meaningful once it is in degrees.
  let worst = 0;
  for (let lon = -4.5; lon <= 9.5; lon += 0.7) {
    for (let lat = 41.5; lat <= 51.0; lat += 0.5) {
      const { x, y } = wgs84ToLambert93(lon, lat);
      const back = lambert93ToWgs84(x, y);
      // Degrees back to metres so the tolerance is a distance, not an angle.
      const dxM = (back.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180);
      const dyM = (back.lat - lat) * 110570;
      worst = Math.max(worst, Math.hypot(dxM, dyM));
    }
  }
  assert.ok(worst < 0.001, `worst round-trip error ${worst} m`);
});

test('a known Paris point lands where Lambert-93 puts it', () => {
  // The Eiffel Tower, whose Lambert-93 coordinates are widely published as
  // roughly 648 236 / 6 862 268. Tolerance is 10 m because the quoted figures
  // differ by which part of the tower they reference, not because the maths
  // is uncertain — the round-trip test above pins that at a millimetre.
  const { x, y } = wgs84ToLambert93(2.294481, 48.858370);
  assert.ok(Math.abs(x - 648236) < 10, `x = ${x}`);
  assert.ok(Math.abs(y - 6862268) < 10, `y = ${y}`);
});

test('real counting-station coordinates unproject onto their own motorway', () => {
  // Two rows taken verbatim from `refDir.csv` (2026-08-31): a DIRNO station on
  // the A28 north of Rouen, and a DIRSO station on Toulouse's A620 ring.
  const rouen = lambert93ToWgs84(569981.6, 6938140.0);
  assert.ok(Math.abs(rouen.lon - 1.2047) < 0.001, `lon ${rouen.lon}`);
  assert.ok(Math.abs(rouen.lat - 49.5293) < 0.001, `lat ${rouen.lat}`);

  const toulouse = lambert93ToWgs84(572626.2, 6284049.5);
  assert.ok(Math.abs(toulouse.lon - 1.4217) < 0.001, `lon ${toulouse.lon}`);
  assert.ok(Math.abs(toulouse.lat - 43.6440) < 0.001, `lat ${toulouse.lat}`);
});

test('the plausibility gate rejects what is not a French point', () => {
  assert.equal(isPlausibleFrenchPoint(2.35, 48.86), true);
  assert.equal(isPlausibleFrenchPoint(9.1, 41.9), true, 'Corsica is in the area of use');
  // What a swapped or zeroed column actually produces: (0, 0) unprojects to
  // the Atlantic well south-west of the zone.
  const zeroed = lambert93ToWgs84(0, 0);
  assert.equal(isPlausibleFrenchPoint(zeroed.lon, zeroed.lat), false);
  assert.equal(isPlausibleFrenchPoint(Number.NaN, 46), false);
  assert.equal(isPlausibleFrenchPoint(2.35, null), false);
});

test('the area-of-use box is a box', () => {
  assert.ok(LAMBERT93_VALID_BBOX.west < LAMBERT93_VALID_BBOX.east);
  assert.ok(LAMBERT93_VALID_BBOX.south < LAMBERT93_VALID_BBOX.north);
});
