// src/data/ndbcObservations.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NDBC_BOUNDS,
  NDBC_FIELD_COUNT,
  filterFreshObservations,
  parseNdbcLatestObservations,
  parseNdbcRow,
  summarizeObservations,
} from './ndbcObservations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'ndbc-latest-obs-sample.txt'),
  'utf8',
);

const HEADER = [
  '#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE',
  '#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft',
].join('\n');

/** Build a syntactically valid row from 22 field values. */
function row(fields) {
  assert.equal(fields.length, NDBC_FIELD_COUNT, 'test row must carry 22 fields');
  return fields.join(' ');
}

const FULL_ROW = [
  '41001', '34.700', '-72.700', '2026', '08', '26', '19', '50',
  '210', '7.2', '9.3', '1.5', '8', '5.9', '195', '1017.1', '-1.8',
  '26.1', '27.4', '22.0', 'MM', 'MM',
];

test('fixture parses to 12 stations with unique ids and valid coordinates', () => {
  const observations = parseNdbcLatestObservations(FIXTURE);
  assert.ok(Array.isArray(observations));
  assert.equal(observations.length, 12);
  const ids = new Set(observations.map((o) => o.station));
  assert.equal(ids.size, 12);
  for (const o of observations) {
    assert.ok(o.lat >= -90 && o.lat <= 90, `lat in range: ${o.lat}`);
    assert.ok(o.lon >= -180 && o.lon <= 180, `lon in range: ${o.lon}`);
    assert.ok(Number.isFinite(o.observedAt));
  }
});

test('a fully populated row maps every column to the right field', () => {
  const o = parseNdbcRow(row(FULL_ROW));
  assert.equal(o.station, '41001');
  assert.equal(o.lat, 34.7);
  assert.equal(o.lon, -72.7);
  // 2026-08-26T19:50Z — UTC, not local.
  assert.equal(o.observedAt, Date.UTC(2026, 7, 26, 19, 50));
  assert.equal(o.windDirDeg, 210);
  assert.equal(o.windSpeedMs, 7.2);
  assert.equal(o.gustMs, 9.3);
  assert.equal(o.waveHeightM, 1.5);
  assert.equal(o.dominantPeriodS, 8);
  assert.equal(o.averagePeriodS, 5.9);
  assert.equal(o.waveDirDeg, 195);
  assert.equal(o.pressureHpa, 1017.1);
  assert.equal(o.pressureTendencyHpa, -1.8);
  assert.equal(o.airTempC, 26.1);
  assert.equal(o.seaTempC, 27.4);
  assert.equal(o.dewPointC, 22.0);
  assert.equal(o.visibilityNmi, null);
  assert.equal(o.tideFt, null);
});

// The format's headline trap: 'MM' names the month column AND marks a missing
// measurement. A parser that resolved columns by name would cross the two.
test("month column stays a month even though 'MM' is the missing sentinel", () => {
  const fields = FULL_ROW.slice();
  fields[4] = '12'; // month
  fields[11] = 'MM'; // wave height genuinely missing
  const o = parseNdbcRow(row(fields));
  assert.equal(o.observedAt, Date.UTC(2026, 11, 26, 19, 50), 'month parsed as December');
  assert.equal(o.waveHeightM, null, 'missing wave height is null');
});

// 'MM' (month) and 'mm' (minutes) differ only by case.
test('minutes and month are not confused by case', () => {
  const fields = FULL_ROW.slice();
  fields[4] = '03'; // month = March
  fields[7] = '45'; // minutes
  const o = parseNdbcRow(row(fields));
  assert.equal(o.observedAt, Date.UTC(2026, 2, 26, 19, 45));
});

test('missing measurements become null, never zero', () => {
  const fields = FULL_ROW.slice();
  for (let i = 8; i < NDBC_FIELD_COUNT; i += 1) fields[i] = 'MM';
  const o = parseNdbcRow(row(fields));
  for (const key of [
    'windDirDeg', 'windSpeedMs', 'gustMs', 'waveHeightM', 'dominantPeriodS',
    'averagePeriodS', 'waveDirDeg', 'pressureHpa', 'pressureTendencyHpa',
    'airTempC', 'seaTempC', 'dewPointC', 'visibilityNmi', 'tideFt',
  ]) {
    assert.equal(o[key], null, `${key} is null when missing`);
  }
});

test('a real zero is preserved and not mistaken for missing', () => {
  const fields = FULL_ROW.slice();
  fields[11] = '0.0'; // flat sea is data, not absence
  const o = parseNdbcRow(row(fields));
  assert.equal(o.waveHeightM, 0);
});

test('implausible values are rejected instead of rendered', () => {
  const fields = FULL_ROW.slice();
  fields[11] = '900';   // 900 m wave
  fields[18] = '412';   // 412 °C sea
  fields[15] = '3';     // 3 hPa
  const o = parseNdbcRow(row(fields));
  assert.equal(o.waveHeightM, null);
  assert.equal(o.seaTempC, null);
  assert.equal(o.pressureHpa, null);
  // Neighbouring good values survive the rejection.
  assert.equal(o.windSpeedMs, 7.2);
});

test('signed pressure tendency parses in both directions', () => {
  const rise = FULL_ROW.slice(); rise[16] = '+2.4';
  const fall = FULL_ROW.slice(); fall[16] = '-3.0';
  assert.equal(parseNdbcRow(row(rise)).pressureTendencyHpa, 2.4);
  assert.equal(parseNdbcRow(row(fall)).pressureTendencyHpa, -3);
});

test('malformed rows are dropped, not coerced', () => {
  assert.equal(parseNdbcRow(''), null);
  assert.equal(parseNdbcRow('41001 34.7 -72.7'), null, 'short row');
  const badCoords = FULL_ROW.slice(); badCoords[1] = '95.0';
  assert.equal(parseNdbcRow(row(badCoords)), null, 'latitude out of range');
  const badStation = FULL_ROW.slice(); badStation[0] = '!!';
  assert.equal(parseNdbcRow(row(badStation)), null, 'non-alphanumeric station');
  const badStamp = FULL_ROW.slice(); badStamp[4] = '13';
  assert.equal(parseNdbcRow(row(badStamp)), null, 'month 13');
});

// The distinction the cache depends on: junk body vs legitimately empty ocean.
test('a non-report body returns null, an empty station list returns []', () => {
  assert.equal(parseNdbcLatestObservations('<html><body>503</body></html>'), null);
  assert.equal(parseNdbcLatestObservations(''), null);
  assert.equal(parseNdbcLatestObservations('   '), null);
  assert.equal(parseNdbcLatestObservations('no header here\n41001 34.7'), null);
  assert.deepEqual(parseNdbcLatestObservations(HEADER), []);
});

test('duplicate station ids keep the first row only', () => {
  const second = FULL_ROW.slice(); second[1] = '10.000';
  const text = [HEADER, row(FULL_ROW), row(second)].join('\n');
  const observations = parseNdbcLatestObservations(text);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].lat, 34.7, 'first row wins');
});

test('freshness filter drops stale and future observations', () => {
  const now = Date.UTC(2026, 7, 26, 20, 0);
  const make = (offsetMs) => ({ station: 'X', observedAt: now + offsetMs });
  const kept = filterFreshObservations([
    make(-30 * 60_000),        // 30 min old — keep
    make(-11 * 3600_000),      // 11 h old — keep
    make(-13 * 3600_000),      // 13 h old — drop
    make(30 * 60_000),         // 30 min ahead — clock skew, keep
    make(48 * 3600_000),       // 2 days ahead — drop
  ], now);
  assert.equal(kept.length, 3);
});

test('summary counts measured fields, not stations', () => {
  const summary = summarizeObservations([
    { waveHeightM: 1.5, seaTempC: 20, windSpeedMs: 5 },
    { waveHeightM: null, seaTempC: 18, windSpeedMs: null },
    { waveHeightM: null, seaTempC: null, windSpeedMs: 3 },
  ]);
  assert.deepEqual(summary, {
    stations: 3, waveHeight: 1, seaTemp: 2, wind: 2, marine: 2,
  });
});

// Guards the honesty claim in the layer's status line: most stations in the
// real report carry no wave sensor, and the fixture must keep reflecting that.
test('fixture reproduces the sparse real-world coverage', () => {
  const summary = summarizeObservations(parseNdbcLatestObservations(FIXTURE));
  assert.equal(summary.stations, 12);
  assert.ok(summary.marine < summary.stations, 'some stations report no marine value');
  assert.ok(summary.waveHeight > 0, 'some stations do report wave height');
});


// The bounds are part of the published contract now: a downstream length or
// colour scale has to be able to read the widest value it can ever be handed,
// instead of assuming a narrower ceiling than the parser enforces.
test('the plausibility bounds are exported, frozen and ordered', () => {
  assert.equal(Object.isFrozen(NDBC_BOUNDS), true);
  for (const [field, range] of Object.entries(NDBC_BOUNDS)) {
    assert.equal(range.length, 2, `${field} is a [min, max] pair`);
    assert.ok(Number.isFinite(range[0]) && Number.isFinite(range[1]), field);
    assert.ok(range[0] < range[1], `${field} is ordered`);
  }
  // The number `marineBuoys.js` freezes its stem domain against.
  assert.deepEqual(NDBC_BOUNDS.waveHeightM, [0, 40]);
});

// A bound that stopped rejecting would silently hand a 900 m sea to a scale
// that maps metres onto kilometres of geometry.
test('a wave height beyond the exported ceiling is dropped, not clamped', () => {
  const [, ceiling] = NDBC_BOUNDS.waveHeightM;
  const row = (wvht) => `41001   34.700  -72.700 2026 08 26 19 50  210  7.2   9.3  ${wvht}`
    + '   8   5.9 195 1017.1  -1.8  26.1  27.4  22.0   MM     MM';
  assert.equal(parseNdbcRow(row(String(ceiling))).waveHeightM, ceiling);
  assert.equal(parseNdbcRow(row(String(ceiling + 0.1))).waveHeightM, null);
  // Zero is inside the bound and is a reading of a flat sea, not a rejection.
  assert.equal(parseNdbcRow(row('0.0')).waveHeightM, 0);
});
