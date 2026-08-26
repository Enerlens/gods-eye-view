// src/data/marineBuoys.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_SEA_STATE_CSS,
  buoyOverlayCopy,
  coverageLabel,
  createBuoyOverlayEntry,
  mapAnalystRecord,
  msToKnots,
  seaState,
  selectBuoyOverlayCohort,
} from './marineBuoys.js';

const STATION = Object.freeze({
  station: '41001',
  lat: 34.7,
  lon: -72.7,
  observedAt: Date.UTC(2026, 7, 26, 19, 50),
  waveHeightM: 2.1,
  dominantPeriodS: 8,
  waveDirDeg: 195,
  seaTempC: 27.4,
  airTempC: 26.1,
  windSpeedMs: 7.2,
  windDirDeg: 210,
  pressureHpa: 1017.1,
});

test('sea state follows the WMO ladder at its boundaries', () => {
  assert.equal(seaState(0).label, 'Calm');
  assert.equal(seaState(0.1).label, 'Calm');
  assert.equal(seaState(0.11).label, 'Smooth');
  assert.equal(seaState(1.25).label, 'Slight');
  assert.equal(seaState(2.5).label, 'Moderate');
  assert.equal(seaState(4).label, 'Rough');
  assert.equal(seaState(6).label, 'Very rough');
  assert.equal(seaState(9).label, 'High');
  assert.equal(seaState(14).label, 'Very high');
  assert.equal(seaState(30).label, 'Phenomenal');
});

// The honesty rule the module header states: no wave sensor is not a flat sea.
test('an unmeasured wave height is neutral, not calm', () => {
  for (const value of [null, undefined, NaN, -1]) {
    const state = seaState(value);
    assert.equal(state.label, null, `${value} yields no label`);
    assert.equal(state.css, NO_SEA_STATE_CSS);
  }
  // A measured flat sea is genuinely Calm and must NOT collapse into the same
  // presentation as an absent reading.
  assert.equal(seaState(0).label, 'Calm');
  assert.notEqual(seaState(0).css, NO_SEA_STATE_CSS);
});

test('card copy omits the lines a station never measured', () => {
  const full = buoyOverlayCopy(STATION);
  assert.equal(full.title, '41001');
  assert.equal(full.details.length, 3);
  assert.match(full.details[0], /^2\.1 m SSW · 8s · Moderate$/);
  assert.match(full.details[1], /^Sea 27\.4 °C$/);
  assert.match(full.details[2], /^Wind SSW 14 kt$/);

  const windOnly = buoyOverlayCopy({
    station: '62148', windSpeedMs: 7.7, windDirDeg: 90,
    waveHeightM: null, seaTempC: null,
  });
  assert.equal(windOnly.details.length, 1);
  assert.match(windOnly.details[0], /^Wind E 15 kt$/);

  // A station that reported only a position and a timestamp gets no detail
  // lines at all — rather than a row of em-dashes that reads like data.
  const bare = buoyOverlayCopy({ station: '44098' });
  assert.equal(bare.title, '44098');
  assert.deepEqual(bare.details, []);
});

test('a measured flat sea still renders its reading', () => {
  const copy = buoyOverlayCopy({ station: '22101', waveHeightM: 0, dominantPeriodS: 0 });
  assert.equal(copy.details.length, 1);
  assert.match(copy.details[0], /^0\.0 m · 0s · Calm$/);
});

test('knot conversion matches the standard factor', () => {
  assert.equal(msToKnots(null), null);
  assert.ok(Math.abs(msToKnots(1) - 1.9438444924406) < 1e-9);
  assert.ok(Math.abs(msToKnots(10) - 19.438444924406) < 1e-9);
});

test('cohort keeps the roughest seas and caps at the limit', () => {
  const entries = [];
  for (let i = 0; i < 200; i += 1) {
    entries.push(createBuoyOverlayEntry({
      id: `S${String(i).padStart(3, '0')}`,
      position: {},
      station: { station: `S${i}`, waveHeightM: i / 10 },
      accent: '#fff',
    }));
  }
  const cohort = selectBuoyOverlayCohort(entries);
  assert.equal(cohort.length, 96);
  assert.equal(cohort[0].title, 'S199', 'roughest sea wins the top slot');
  assert.ok(cohort.every((entry) => entry.priority >= cohort.at(-1).priority));
});

// Unmeasured stations must not outrank measured ones for a scarce label slot.
test('stations with no wave reading sort below every measured station', () => {
  const measured = createBuoyOverlayEntry({
    id: 'M', position: {}, station: { station: 'M', waveHeightM: 0 }, accent: '#fff',
  });
  const unmeasured = createBuoyOverlayEntry({
    id: 'U', position: {}, station: { station: 'U', waveHeightM: null }, accent: '#fff',
  });
  assert.ok(unmeasured.priority < measured.priority);
  const cohort = selectBuoyOverlayCohort([unmeasured, measured], 1);
  assert.equal(cohort[0].id, 'M');
});

// manager.js interpolates `coverage` straight into chip text and into the
// fallback-detection source string, so it must be a string — an object would
// print "[object Object]" on the control chip.
test('coverage renders as a chip-ready string, never an object', () => {
  assert.equal(coverageLabel({ stations: 892, marine: 533 }), '533 of 892 measuring sea');
  assert.equal(coverageLabel({ stations: 12 }), '12 stations');
  assert.equal(coverageLabel(null), '');
  assert.equal(coverageLabel({ stations: 0, marine: 0 }), '');
  assert.equal(typeof coverageLabel({ stations: 892, marine: 533 }), 'string');
  // The regexes manager.js runs over this string must not be tripped by it.
  assert.ok(!/\bfallback\b/i.test(coverageLabel({ stations: 892, marine: 533 })));
});

test('analyst records keep missing fields null, never NaN', () => {
  const record = mapAnalystRecord(STATION);
  assert.equal(record.id, '41001');
  assert.equal(record.waveHeightM, 2.1);
  assert.equal(record.seaState, 'Moderate');

  const sparse = mapAnalystRecord({ station: '44098', lat: 42.8, lon: -70.169 }, 3);
  assert.equal(sparse.id, '44098');
  assert.equal(sparse.waveHeightM, null);
  assert.equal(sparse.seaState, null);
  for (const [key, value] of Object.entries(sparse)) {
    assert.ok(!Number.isNaN(value), `${key} is not NaN`);
    assert.notEqual(value, undefined, `${key} is not undefined`);
  }

  // A station with no id at all still gets a stable, index-derived one.
  assert.equal(mapAnalystRecord({}, 7).id, 'BUOY-0007');
});
