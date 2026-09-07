// The chronicle's clock, its fold and its retention arithmetic. Pure — no fs,
// no network, and every instant is written out in full rather than derived
// from `Date.now()`, because a profile that drifts with the test runner's
// timezone would pass everywhere and be wrong in production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHRONICLE_MIN_WEEKS,
  CHRONICLE_RARE_Z,
  CHRONICLE_SLOTS,
  CHRONICLE_UNUSUAL_Z,
  CHRONICLE_VERSION,
  chronicleDayFile,
  chronicleDayOfFile,
  chronicleReading,
  chronicleRetentionFloor,
  chronicleRoundValue,
  chronicleSeriesCoverage,
  chronicleSeriesWeight,
  chronicleSlotSpread,
  chronicleStamp,
  compactableChronicleDays,
  createChronicleSeries,
  decodeChronicleTick,
  encodeChronicleTick,
  expiredChronicleDays,
  observeChronicleSeries,
  parseChronicleProfile,
  serializeChronicleProfile,
} from './chronicle.js';

const ms = (iso) => Date.parse(iso);

// --- The clock -------------------------------------------------------------

test('Monday 00 h Paris is slot 0 and Sunday 23 h is slot 167', () => {
  // 2026-01-05 is a Monday. 23:00 UTC on the 4th is 00:00 Paris on the 5th.
  assert.equal(chronicleStamp(ms('2026-01-04T23:00:00Z')).slot, 0);
  assert.equal(chronicleStamp(ms('2026-01-04T23:00:00Z')).dayKey, '2026-01-05');
  // Sunday 2026-01-11 23:00 Paris = 22:00 UTC.
  const sunday = chronicleStamp(ms('2026-01-11T22:00:00Z'));
  assert.equal(sunday.weekday, 6);
  assert.equal(sunday.hour, 23);
  assert.equal(sunday.slot, CHRONICLE_SLOTS - 1);
});

test('the slot follows Paris local time, not UTC', () => {
  // 2026-07-01 22:30 UTC is 2026-07-02 00:30 in Paris (CEST, +2).
  const stamp = chronicleStamp(ms('2026-07-01T22:30:00Z'));
  assert.equal(stamp.dayKey, '2026-07-02');
  assert.equal(stamp.hour, 0);
  assert.equal(stamp.weekday, 3); // Thursday
});

test('the spring-forward gap skips an hour without moving the day or the week', () => {
  // Paris jumps 02:00 CET -> 03:00 CEST on 2026-03-29 (a Sunday).
  const before = chronicleStamp(ms('2026-03-29T00:59:00Z')); // 01:59 CET
  const after = chronicleStamp(ms('2026-03-29T01:01:00Z')); // 03:01 CEST
  assert.equal(before.dayKey, '2026-03-29');
  assert.equal(after.dayKey, '2026-03-29');
  assert.equal(before.hour, 1);
  assert.equal(after.hour, 3);
  assert.equal(before.week, after.week);
});

test('the autumn repeat folds both 02 h into the same slot', () => {
  // Paris repeats 02:00 CEST -> 02:00 CET on 2026-10-25.
  const first = chronicleStamp(ms('2026-10-25T00:30:00Z')); // 02:30 CEST
  const second = chronicleStamp(ms('2026-10-25T01:30:00Z')); // 02:30 CET
  assert.equal(first.slot, second.slot);
  assert.equal(first.hour, 2);
  assert.equal(second.hour, 2);
  assert.equal(first.week, second.week);
});

test('the week ordinal advances exactly on the local Monday', () => {
  const sunday = chronicleStamp(ms('2026-01-11T22:30:00Z')); // Sun 23:30 Paris
  const monday = chronicleStamp(ms('2026-01-11T23:30:00Z')); // Mon 00:30 Paris
  assert.equal(monday.week, sunday.week + 1);
  assert.equal(monday.weekday, 0);
});

test('a non-finite instant produces no stamp at all', () => {
  assert.equal(chronicleStamp(Number.NaN), null);
  assert.equal(chronicleStamp(undefined), null);
});

// --- The fold --------------------------------------------------------------

test('a gap is refused, never folded as a zero', () => {
  const series = createChronicleSeries();
  assert.equal(observeChronicleSeries(series, 10, Number.NaN, 100), false);
  assert.equal(observeChronicleSeries(series, 10, null, 100), false);
  assert.equal(observeChronicleSeries(series, 10, 0, 100), true);
  assert.equal(series.n[10], 1);
});

test('an out-of-range slot is refused', () => {
  const series = createChronicleSeries();
  assert.equal(observeChronicleSeries(series, -1, 5, 100), false);
  assert.equal(observeChronicleSeries(series, CHRONICLE_SLOTS, 5, 100), false);
});

test('twelve samples in one week count as one week', () => {
  const series = createChronicleSeries();
  for (let i = 0; i < 12; i += 1) observeChronicleSeries(series, 8, 100 + i, 2900);
  assert.equal(series.n[8], 12);
  assert.equal(series.w[8], 1);
});

test('the mean and the spread are the sample mean and sample sd', () => {
  const series = createChronicleSeries();
  for (const [value, week] of [[10, 1], [12, 2], [14, 3]]) {
    observeChronicleSeries(series, 8, value, week);
  }
  assert.equal(series.mean[8], 12);
  assert.equal(chronicleSlotSpread(series, 8), 2);
  assert.equal(chronicleSeriesWeight(series), 3);
  assert.equal(chronicleSeriesCoverage(series), 1);
});

// --- The reading -----------------------------------------------------------

test('a slot below the week floor refuses to judge anything', () => {
  const series = createChronicleSeries();
  observeChronicleSeries(series, 8, 10, 1);
  observeChronicleSeries(series, 8, 12, 2);
  assert.equal(series.w[8], CHRONICLE_MIN_WEEKS - 1);
  assert.equal(chronicleReading(series, 8, 500), null);
  observeChronicleSeries(series, 8, 14, 3);
  assert.notEqual(chronicleReading(series, 8, 500), null);
});

test('the bands sit exactly on the published thresholds', () => {
  const series = createChronicleSeries();
  for (const [value, week] of [[8, 1], [10, 2], [12, 3], [10, 4]]) {
    observeChronicleSeries(series, 8, value, week);
  }
  const spread = chronicleSlotSpread(series, 8);
  const at = (z) => chronicleReading(series, 8, series.mean[8] + z * spread).band;
  assert.equal(at(0), 'typical');
  assert.equal(at(CHRONICLE_UNUSUAL_Z - 0.01), 'typical');
  assert.equal(at(CHRONICLE_UNUSUAL_Z), 'unusual');
  assert.equal(at(-CHRONICLE_UNUSUAL_Z), 'unusual');
  assert.equal(at(CHRONICLE_RARE_Z), 'rare');
  assert.equal(chronicleReading(series, 8, series.mean[8] - spread).direction, 'below');
});

test('a series that never varies still scores a finite z', () => {
  const series = createChronicleSeries();
  for (let week = 1; week <= 6; week += 1) observeChronicleSeries(series, 8, 1000, week);
  assert.equal(chronicleSlotSpread(series, 8), 0);
  const reading = chronicleReading(series, 8, 1100);
  assert.ok(Number.isFinite(reading.z), 'a zero standard deviation must not produce an infinite score');
  // The floor is 2 % of 1 000 = 20, so a 100 unit move is five of them.
  assert.equal(reading.spread, 20);
  assert.equal(reading.z, 5);
});

// --- Serialisation ---------------------------------------------------------

test('a profile round-trips, and the fold continues where it left off', () => {
  const profiles = new Map([['fr/vessels', createChronicleSeries()]]);
  for (const [value, week] of [[10, 1], [12, 2], [14, 3]]) {
    observeChronicleSeries(profiles.get('fr/vessels'), 8, value, week);
  }
  const document = serializeChronicleProfile(profiles, { now: ms('2026-09-07T12:00:00Z') });
  assert.equal(document.version, CHRONICLE_VERSION);
  assert.equal(document.count, 1);
  const restored = parseChronicleProfile(JSON.stringify(document));
  const series = restored.get('fr/vessels');
  assert.equal(series.n[8], 3);
  assert.equal(series.w[8], 3);
  assert.equal(series.mean[8], 12);
  // The last week ordinal survives, so a fourth sample in week 3 does not
  // invent a fourth week.
  observeChronicleSeries(series, 8, 14, 3);
  assert.equal(series.w[8], 3);
});

test('an empty series is not written at all', () => {
  const document = serializeChronicleProfile(new Map([['fr/idle', createChronicleSeries()]]));
  assert.equal(document.count, 0);
  assert.deepEqual(document.series, {});
});

test('the cap keeps the heaviest series and drops the lightest', () => {
  const profiles = new Map();
  for (let i = 0; i < 5; i += 1) {
    const series = createChronicleSeries();
    for (let j = 0; j <= i; j += 1) observeChronicleSeries(series, 8, 1, j);
    profiles.set(`feed:${i}/vehicles`, series);
  }
  const document = serializeChronicleProfile(profiles, { maxSeries: 2 });
  assert.deepEqual(Object.keys(document.series).sort(), ['feed:3/vehicles', 'feed:4/vehicles']);
  assert.equal(document.count, 2);
});

test('a document from another version or another clock is ignored wholesale', () => {
  const profiles = new Map([['fr/vessels', createChronicleSeries()]]);
  observeChronicleSeries(profiles.get('fr/vessels'), 8, 10, 1);
  const document = serializeChronicleProfile(profiles);
  assert.equal(parseChronicleProfile({ ...document, version: CHRONICLE_VERSION + 1 }).size, 0);
  assert.equal(parseChronicleProfile({ ...document, timeZone: 'America/New_York' }).size, 0);
  assert.equal(parseChronicleProfile({ ...document, slots: 24 }).size, 0);
  assert.equal(parseChronicleProfile('{not json').size, 0);
  assert.equal(parseChronicleProfile(null).size, 0);
});

test('a series claiming more weeks than samples is rejected, not repaired', () => {
  const profiles = new Map([['fr/vessels', createChronicleSeries()]]);
  observeChronicleSeries(profiles.get('fr/vessels'), 8, 10, 1);
  const document = serializeChronicleProfile(profiles);
  document.series['fr/vessels'].w[8] = 9;
  assert.equal(parseChronicleProfile(document).size, 0);
});

// --- The raw ticks ---------------------------------------------------------

test('a tick writes its instant once, for all of its series', () => {
  const line = encodeChronicleTick({ at: 1_757_260_000_000, samples: { 'fr/a': 1, 'fr/b': 2.5 } });
  assert.equal(line, '{"t":1757260000000,"s":{"fr/a":1,"fr/b":2.5}}\n');
  const back = decodeChronicleTick(line);
  assert.equal(back.at, 1_757_260_000_000);
  assert.deepEqual(back.samples, { 'fr/a': 1, 'fr/b': 2.5 });
  assert.deepEqual(back.events, []);
});

test('samples and events are separate lines, and a tick with neither writes nothing', () => {
  const both = encodeChronicleTick({ at: 1, samples: { 'fr/a': 1 }, events: [['x', 'S', 'L', 2]] });
  assert.equal(both.split('\n').filter(Boolean).length, 2);
  assert.equal(encodeChronicleTick({ at: 1, samples: {}, events: [] }), '');
  assert.equal(encodeChronicleTick({ at: Number.NaN, samples: { 'fr/a': 1 } }), '');
});

test('the stored precision is the same on both sides of the fold', () => {
  // What is folded must be what is logged, or re-folding the thirty-day window
  // would not reproduce the profile it is supposed to be able to rebuild.
  const value = 100 / 3;
  const stored = chronicleRoundValue(value);
  assert.equal(stored, 33.333);
  const line = encodeChronicleTick({ at: 1, samples: { 'fr/a': stored } });
  assert.equal(decodeChronicleTick(line).samples['fr/a'], stored);
  const series = createChronicleSeries();
  observeChronicleSeries(series, 0, stored, 1);
  assert.equal(series.mean[0], stored);
  assert.ok(Number.isNaN(chronicleRoundValue(Number.NaN)));
});

test('a non-finite sample never reaches the file', () => {
  const line = encodeChronicleTick({ at: 1, samples: { 'fr/a': Number.NaN, 'fr/b': 3 } });
  assert.equal(line.includes('fr/a'), false);
  assert.equal(decodeChronicleTick('nonsense'), null);
  assert.equal(decodeChronicleTick(''), null);
  assert.equal(decodeChronicleTick('{"s":{"fr/a":1}}'), null); // no instant
});

// --- Retention -------------------------------------------------------------

test('the retention floor keeps today and the twenty-nine days before it', () => {
  const floor = chronicleRetentionFloor(ms('2026-09-07T12:00:00Z'), 30);
  assert.equal(floor, '2026-08-09');
  assert.equal(chronicleDayFile(floor), '2026-08-09.ndjson');
});

test('the sweep drops only what it wrote, and only past the floor', () => {
  const names = [
    '2026-08-08.ndjson', '2026-08-08.ndjson.gz', '2026-08-09.ndjson',
    '2026-09-07.ndjson', 'profile.json', 'README.md', '.DS_Store',
  ];
  assert.deepEqual(
    expiredChronicleDays(names, '2026-08-09'),
    ['2026-08-08.ndjson', '2026-08-08.ndjson.gz'],
  );
  assert.deepEqual(expiredChronicleDays(names, null), []);
});

test('only a finished day is compactable, and only once', () => {
  const names = ['2026-09-05.ndjson', '2026-09-06.ndjson.gz', '2026-09-07.ndjson', 'profile.json'];
  assert.deepEqual(compactableChronicleDays(names, '2026-09-07'), ['2026-09-05.ndjson']);
  assert.equal(chronicleDayOfFile('2026-09-06.ndjson.gz'), '2026-09-06');
  assert.equal(chronicleDayOfFile('profile.json'), null);
  assert.equal(chronicleDayOfFile('2026-9-6.ndjson'), null);
});
