import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEEK_HOUR_DAYS,
  WEEK_HOUR_REPRESENTATIVE_DAYS,
  WEEK_HOUR_SLOTS,
  _resetWeekHourForTest,
  decodeWeekHourParam,
  encodeWeekHourParam,
  getWeekHour,
  setWeekHour,
  subscribeWeekHour,
  weekHourFromDayType,
  weekHourFromOperatingSlot,
  weekHourFromPulseSlot,
  weekHourLabel,
  weekHourToDayType,
  weekHourToOperatingSlot,
  weekHourToPulseSlot,
} from './weekHourCursor.js';
import { IDFM_FREQ_BAND_MAX, IDFM_FREQ_BAND_MIN, IDFM_FREQ_DAYS, operatingSlot } from './idfmFrequencyFeed.js';
import { COMPTAGES_DAY_TYPES, comptagesParseSlot, comptagesSlotToken } from './comptagesRhythm.js';
import { slotForDate } from './veloPulseFeed.js';

test.beforeEach(() => { _resetWeekHourForTest(); });

test('nothing is pinned until somebody pins it', () => {
  assert.equal(getWeekHour(), null);
  assert.equal(encodeWeekHourParam(), null);
  assert.equal(weekHourLabel(), null);
});

test('a pin reaches every subscriber except the one that moved it', () => {
  const heard = [];
  subscribeWeekHour('a', (cursor, source) => heard.push(['a', cursor, source]));
  subscribeWeekHour('b', (cursor, source) => heard.push(['b', cursor, source]));
  assert.equal(setWeekHour('a', { day: 1, hour: 8 }), true);
  assert.equal(heard.length, 1);
  assert.deepEqual(heard[0], ['b', { day: 1, hour: 8 }, 'a']);
});

test('an unchanged pin notifies nobody — three layers writing back would loop', () => {
  let calls = 0;
  subscribeWeekHour('a', () => { calls += 1; });
  setWeekHour('b', { day: 1, hour: 8 });
  assert.equal(calls, 1);
  assert.equal(setWeekHour('b', { day: 1, hour: 8 }), false);
  assert.equal(setWeekHour('c', { day: 1, hour: 8 }), false);
  assert.equal(calls, 1);
});

test('an unplaceable cursor is refused, not clamped', () => {
  setWeekHour('a', { day: 1, hour: 8 });
  for (const bad of [{ day: 7, hour: 0 }, { day: 0, hour: 24 }, { day: 1.5, hour: 3 }, 'w08', 32]) {
    assert.equal(setWeekHour('a', bad), false, `${JSON.stringify(bad)} should be refused`);
  }
  assert.deepEqual(getWeekHour(), { day: 1, hour: 8 });
});

test('null releases the pin, and releasing twice is a no-op', () => {
  setWeekHour('a', { day: 3, hour: 18 });
  assert.equal(setWeekHour('a', null), true);
  assert.equal(getWeekHour(), null);
  assert.equal(setWeekHour('a', null), false);
});

test('a subscriber that throws is warned once and cannot stop the others', () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    subscribeWeekHour('bad', () => { throw new Error('nope'); });
    let good = 0;
    subscribeWeekHour('good', () => { good += 1; });
    setWeekHour('src', { day: 0, hour: 4 });
    setWeekHour('src', { day: 0, hour: 5 });
    assert.equal(good, 2);
    assert.equal(warnings.filter((line) => line.includes('bad')).length, 1);
  } finally {
    console.warn = realWarn;
  }
});

test('unsubscribing stops the handler and only that handler', () => {
  let a = 0;
  let b = 0;
  const stop = subscribeWeekHour('a', () => { a += 1; });
  subscribeWeekHour('b', () => { b += 1; });
  stop();
  setWeekHour('src', { day: 2, hour: 12 });
  assert.equal(a, 0);
  assert.equal(b, 1);
});

// --- The dialects -----------------------------------------------------------

test('the pulse slot round-trips exactly, for all 168 hours', () => {
  for (let slot = 0; slot < WEEK_HOUR_SLOTS; slot += 1) {
    const cursor = weekHourFromPulseSlot(slot);
    assert.equal(weekHourToPulseSlot(cursor), slot);
  }
});

test('the pulse slot origin is the one veloPulseFeed already uses', () => {
  // Tuesday 2026-06-02 at 08:00 Paris. `slotForDate` reads the Paris clock,
  // so the date carries its offset — the same trap the CI found in
  // `slotForMode`'s own test.
  const slot = slotForDate(new Date('2026-06-02T08:00:00+02:00'));
  assert.deepEqual(weekHourFromPulseSlot(slot), { day: 1, hour: 8 });
  assert.equal(WEEK_HOUR_DAYS[1], 'mardi');
});

test('a fractional pulse position lands on the hour it is inside', () => {
  assert.deepEqual(weekHourFromPulseSlot(32.9), { day: 1, hour: 8 });
  // The week is a loop, and the animation hands over positions that ran off
  // either end.
  assert.deepEqual(weekHourFromPulseSlot(168), { day: 0, hour: 0 });
  assert.deepEqual(weekHourFromPulseSlot(-1), { day: 6, hour: 23 });
});

test('the day-type split is Monday–Friday against Saturday–Sunday', () => {
  const types = WEEK_HOUR_DAYS.map((_, day) => weekHourToDayType({ day, hour: 12 }));
  assert.deepEqual(types, ['weekday', 'weekday', 'weekday', 'weekday', 'weekday', 'weekend', 'weekend']);
  for (const type of types) assert.ok(COMPTAGES_DAY_TYPES.includes(type));
});

test('a day-type chip keeps the day the cursor is already on when it fits', () => {
  const wednesday = { day: 2, hour: 4 };
  assert.deepEqual(weekHourFromDayType('weekday', 18, wednesday), { day: 2, hour: 18 });
  // Crossing the split has no day to keep, so it takes the representative one.
  assert.deepEqual(
    weekHourFromDayType('weekend', 18, wednesday),
    { day: WEEK_HOUR_REPRESENTATIVE_DAYS.weekend, hour: 18 },
  );
  assert.deepEqual(
    weekHourFromDayType('weekday', 8, null),
    { day: WEEK_HOUR_REPRESENTATIVE_DAYS.weekday, hour: 8 },
  );
});

test('every comptages token the layer offers translates, and back', () => {
  for (const day of COMPTAGES_DAY_TYPES) {
    for (let hour = 0; hour < 24; hour += 1) {
      const token = comptagesSlotToken(day, hour);
      const parsed = comptagesParseSlot(token);
      const cursor = weekHourFromDayType(parsed.day, parsed.hour, null);
      assert.equal(weekHourToDayType(cursor), day);
      assert.equal(cursor.hour, hour);
    }
  }
});

test('the operating slot round-trips over every hour of the week', () => {
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const slot = weekHourToOperatingSlot({ day, hour });
      assert.ok(slot.band >= IDFM_FREQ_BAND_MIN && slot.band <= IDFM_FREQ_BAND_MAX,
        `band ${slot.band} out of the published 4..27 range`);
      assert.ok(IDFM_FREQ_DAYS.includes(slot.day));
      assert.deepEqual(weekHourFromOperatingSlot(slot.day, slot.band), { day, hour });
    }
  }
});

test('the night belongs to the previous operating day, exactly as IDFM files it', () => {
  // 01 h on a Wednesday is Tuesday's band 25 — the `b01` chip's own band.
  assert.deepEqual(weekHourToOperatingSlot({ day: 2, hour: 1 }), { dayIndex: 1, day: 'mardi', band: 25 });
  // And that is the same fold `idfmFrequencyFeed.operatingSlot` applies to a
  // wall clock: Wednesday is weekday 3 in the JS Sunday-first convention.
  assert.deepEqual(operatingSlot({ hour: 1, weekday: 3 }), { day: 'mardi', band: 25 });
});

test('the day names are the same list, in the same order, as IDFM publishes', () => {
  assert.deepEqual([...WEEK_HOUR_DAYS], [...IDFM_FREQ_DAYS]);
});

// --- The share key ----------------------------------------------------------

test('the share key carries the slot, and only when something is pinned', () => {
  assert.equal(encodeWeekHourParam(), null);
  setWeekHour('a', { day: 1, hour: 8 });
  assert.equal(encodeWeekHourParam(), '32');
  assert.deepEqual(decodeWeekHourParam('32'), { day: 1, hour: 8 });
});

test('a share key out of range is refused rather than wrapped', () => {
  for (const bad of ['999', '-1', '1.5', 'abc', '', null, undefined]) {
    assert.equal(decodeWeekHourParam(bad), null, `${bad} should not decode`);
  }
});

test('every slot survives the round trip through a link', () => {
  for (let slot = 0; slot < WEEK_HOUR_SLOTS; slot += 1) {
    const cursor = weekHourFromPulseSlot(slot);
    assert.deepEqual(decodeWeekHourParam(encodeWeekHourParam(cursor)), cursor);
  }
});

test('the label names a real day and a padded hour', () => {
  assert.equal(weekHourLabel({ day: 1, hour: 8 }), 'mardi 08 h');
  assert.equal(weekHourLabel({ day: 6, hour: 23 }), 'dimanche 23 h');
  assert.equal(weekHourLabel(null), null);
});
