// The camera standoff for a clicked vessel — derived from its distance to
// land, because a ship framed at 1.2 km is a ship nowhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VESSEL_STANDOFF,
  VESSEL_STANDOFF_SCAN_KM,
  vesselStandoffRangeM,
} from './vesselStandoff.js';
import { buildDepartementIndex, nearestDepartementWithin } from './franceDepartements.js';

const OUTLINES = JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
));

test('the standoff grows with the coast distance, inside its published bounds', () => {
  const { minRangeM, maxRangeM, coastFactor } = VESSEL_STANDOFF;
  // In the band where the factor rules, the answer is exactly the factor.
  assert.equal(vesselStandoffRangeM(10), 10 * 1000 * coastFactor);
  assert.ok(vesselStandoffRangeM(12) > vesselStandoffRangeM(6));
  // Alongside a quay the floor holds: still a scene, never a hull portrait.
  assert.equal(vesselStandoffRangeM(0), minRangeM);
  assert.equal(vesselStandoffRangeM(0.4), minRangeM);
  // Offshore the ceiling holds, so the chevron stays the subject of the frame.
  assert.equal(vesselStandoffRangeM(400), maxRangeM);
});

// The two "no number" cases are NOT the same, and only one of them reaches
// this function: a scan that ran and found no land answers with the ceiling;
// a scan that never ran must leave the default framing alone, which is the
// caller's job (`aisLiveVessels.vesselFocusRangeM` returns undefined).
test('a scan that found no land within reach frames at the ceiling', () => {
  for (const value of [null, undefined, NaN, 'far', -3]) {
    assert.equal(vesselStandoffRangeM(value), VESSEL_STANDOFF.maxRangeM, String(value));
  }
});

test('the scan radius is derived from the ceiling, so no scan is wasted', () => {
  // Any coast further out than this already maps to maxRangeM.
  assert.equal(
    vesselStandoffRangeM(VESSEL_STANDOFF_SCAN_KM),
    VESSEL_STANDOFF.maxRangeM,
    'scanning past the ceiling distance can only re-derive the ceiling',
  );
  assert.ok(VESSEL_STANDOFF_SCAN_KM > 0 && VESSEL_STANDOFF_SCAN_KM < 100);
});

test('the framing is a real oblique standoff and the bounds are ordered', () => {
  assert.ok(VESSEL_STANDOFF.minRangeM < VESSEL_STANDOFF.defaultRangeM);
  assert.ok(VESSEL_STANDOFF.defaultRangeM < VESSEL_STANDOFF.maxRangeM);
  assert.ok(VESSEL_STANDOFF.pitchDeg < 0 && VESSEL_STANDOFF.pitchDeg > -80);
  // The floor is what the complaint was about: 1 200 m framed water only.
  assert.ok(
    VESSEL_STANDOFF.minRangeM >= 5000,
    'the floor must still hold a coastline, not a hull',
  );
});

// The whole policy rests on one claim: the bundled département outlines answer
// "how far is the land" for a point at sea inside the AIS box. Measured here on
// the shipped geometry rather than asserted in a comment.
test('the bundled outlines measure the coast for real French sea positions', () => {
  const index = buildDepartementIndex(OUTLINES);
  const cases = [
    // [name, lat, lon, expected range band]
    ['Rade de Marseille, ~3 km off', 43.265, 5.33, 'floor'],
    ['mid-Channel off Dover strait', 50.95, 1.55, 'band'],
    ['Golfe de Gascogne, far offshore', 45.0, -5.0, 'ceiling'],
  ];
  for (const [name, lat, lon, band] of cases) {
    const coast = nearestDepartementWithin(index, lat, lon, VESSEL_STANDOFF_SCAN_KM);
    const range = vesselStandoffRangeM(coast ? coast.km : null);
    if (band === 'floor') {
      assert.equal(range, VESSEL_STANDOFF.minRangeM, `${name}: expected the floor`);
    } else if (band === 'ceiling') {
      assert.equal(range, VESSEL_STANDOFF.maxRangeM, `${name}: expected the ceiling`);
    } else {
      assert.ok(
        range > VESSEL_STANDOFF.minRangeM && range < VESSEL_STANDOFF.maxRangeM,
        `${name}: expected a measured range, got ${range}`,
      );
    }
  }
});

test('the outline sweep is cheap enough to run inside a click', () => {
  const index = buildDepartementIndex(OUTLINES);
  const started = performance.now();
  for (let i = 0; i < 50; i += 1) {
    nearestDepartementWithin(index, 43.2 + i * 0.01, 5.3, VESSEL_STANDOFF_SCAN_KM);
  }
  const perCall = (performance.now() - started) / 50;
  // Generous — the point is that it is not tens of milliseconds on the click.
  assert.ok(perCall < 8, `${perCall.toFixed(2)} ms per vessel click is too much`);
});
