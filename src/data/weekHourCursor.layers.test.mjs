// The three typical-week layers, on one hour.
//
// `weekHourCursor.test.mjs` proves the cursor and its dialects in isolation.
// This file proves the thing a reader can actually see: that pressing an hour
// on ONE row moves the other two, that each layer translates the hour into its
// own vocabulary rather than into a nearby one, and that the couplings which
// must NOT happen do not.
//
// The three live on three different rows since the 2026-09 fusion — *Trafic
// routier*, *Vélos et véhicules partagés*, *Transports en commun* — so two of
// them on screen showing two different hours of the archived week was the
// normal case, and it is the failure this closes.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  _resetWeekHourForTest,
  getWeekHour,
  setWeekHour,
} from './weekHourCursor.js';
import {
  _comptagesFollowWeekHourForTest,
  _comptagesSetParamsForTest,
  _comptagesSlotForTest,
} from './comptagesParis.js';
import {
  _idfmFrequencyFollowWeekHourForTest,
  _idfmFrequencySetParamsForTest,
  _idfmFrequencySlotForTest,
} from './idfmFrequency.js';
import {
  _pulseFollowWeekHourForTest,
  _pulseSeekForTest,
  _pulseSetParamsForTest,
  _pulseStateForTest,
} from './veloPulse.js';

/**
 * All three following, on a released cursor. The state every test starts in.
 *
 * The layers are module singletons and their slots persist across tests in one
 * file, so each of them is put back on its own live default BEFORE the cursor
 * is released — otherwise a layer left on 08 h would make the next test's
 * press of that same chip a no-op, and a no-op broadcasts nothing.
 */
function followAll() {
  _comptagesFollowWeekHourForTest(false);
  _idfmFrequencyFollowWeekHourForTest(false);
  _pulseFollowWeekHourForTest(false);
  _comptagesSetParamsForTest({ slot: 'mean' });
  _idfmFrequencySetParamsForTest({ band: 'now' });
  _pulseSetParamsForTest({ mode: 'now' });
  _resetWeekHourForTest();
  _comptagesFollowWeekHourForTest(true);
  _idfmFrequencyFollowWeekHourForTest(true);
  _pulseFollowWeekHourForTest(true);
}

test.beforeEach(followAll);
test.afterEach(() => {
  _comptagesFollowWeekHourForTest(false);
  _idfmFrequencyFollowWeekHourForTest(false);
  _pulseFollowWeekHourForTest(false);
  _resetWeekHourForTest();
});

test('an hour pressed on the traffic row reaches the métro and the bicycles', () => {
  _comptagesSetParamsForTest({ slot: 'w08' });
  // The day-type chip says "a typical weekday at 08 h" and nothing about which
  // day, so the cursor takes the representative one.
  assert.deepEqual(getWeekHour(), { day: 1, hour: 8 });
  const idfm = _idfmFrequencySlotForTest();
  assert.equal(idfm.day, 'mardi');
  assert.equal(idfm.band, 8);
  const pulse = _pulseStateForTest();
  assert.equal(pulse.mode, 'week');
  assert.equal(pulse.playing, false);
  assert.equal(pulse.slot, 1 * 24 + 8);
});

test('the weekend chip lands the other two on a weekend day', () => {
  _comptagesSetParamsForTest({ slot: 'e18' });
  assert.deepEqual(getWeekHour(), { day: 5, hour: 18 });
  assert.equal(_idfmFrequencySlotForTest().day, 'samedi');
  assert.equal(_pulseStateForTest().slot, 5 * 24 + 18);
});

test('a scrub of the bicycle week moves the traffic and the métro', () => {
  _pulseSeekForTest(3 * 24 + 17); // Thursday 17 h
  assert.deepEqual(getWeekHour(), { day: 3, hour: 17 });
  assert.equal(_comptagesSlotForTest().token, 'w17');
  const idfm = _idfmFrequencySlotForTest();
  assert.equal(idfm.day, 'jeudi');
  assert.equal(idfm.band, 17);
});

test('an IDFM band travels as the hour the layer is drawing', () => {
  _idfmFrequencySetParamsForTest({ band: 22 });
  const cursor = getWeekHour();
  assert.equal(cursor.hour, 22);
  // The day is today's — the chip names a band and never a day — and the other
  // two layers land on that same day.
  assert.equal(_pulseStateForTest().slot, cursor.day * 24 + 22);
  assert.equal(_comptagesSlotForTest().hour, 22);
});

test('the 01 h band is filed on the previous operating day and still means 01 h', () => {
  // `b01` carries band 25, which IDFM files on the PREVIOUS day. The cursor
  // must carry 01 h on the day the reader means, not 25 h on the day before.
  _idfmFrequencySetParamsForTest({ band: 25 });
  const cursor = getWeekHour();
  assert.equal(cursor.hour, 1);
  assert.equal(_pulseStateForTest().slot % 24, 1);
  assert.equal(_comptagesSlotForTest().hour, 1);
  // And the layer itself is still drawing band 25, on the operating day.
  assert.equal(_idfmFrequencySlotForTest().band, 25);
});

test('a comptages hour chip keeps the day another row already chose', () => {
  _pulseSeekForTest(2 * 24 + 6); // Wednesday 06 h
  _comptagesSetParamsForTest({ slot: 'w18' });
  // Wednesday is a weekday, so nothing has to be invented: the hour moves and
  // the day stays where the reader put it.
  assert.deepEqual(getWeekHour(), { day: 2, hour: 18 });
  assert.equal(_idfmFrequencySlotForTest().day, 'mercredi');
});

test('«À cette heure» and «Maintenant» release the cursor rather than pinning one', () => {
  _comptagesSetParamsForTest({ slot: 'w08' });
  assert.notEqual(getWeekHour(), null);
  _comptagesSetParamsForTest({ slot: 'clock' });
  assert.equal(getWeekHour(), null, 'following the clock is a behaviour, not a position');

  _idfmFrequencySetParamsForTest({ band: 12 });
  assert.notEqual(getWeekHour(), null);
  _idfmFrequencySetParamsForTest({ band: 'now' });
  assert.equal(getWeekHour(), null);
});

test('the weekday mean releases the cursor — it is not an hour of the week', () => {
  _comptagesSetParamsForTest({ slot: 'w08' });
  _comptagesSetParamsForTest({ slot: 'mean' });
  assert.equal(getWeekHour(), null);
});

test('a released cursor leaves every layer where the reader last put it', () => {
  _comptagesSetParamsForTest({ slot: 'w08' });
  const pulseBefore = _pulseStateForTest().slot;
  _comptagesSetParamsForTest({ slot: 'mean' });
  // Releasing means "nobody is pinning an hour", NOT "go back to now": the
  // bicycles keep drawing the hour they were on.
  assert.equal(_pulseStateForTest().slot, pulseBefore);
  assert.equal(_idfmFrequencySlotForTest().band, 8);
});

test('a running week drives nobody — 168 hours at one every 520 ms is not a broadcast', () => {
  _comptagesSetParamsForTest({ slot: 'w08' });
  _pulseSetParamsForTest({ mode: 'week' });
  assert.equal(getWeekHour(), null, 'an animating week has no hour to share');
  assert.equal(_comptagesSlotForTest().token, 'w08', 'and it does not drag the traffic with it');
});

test('a layer that comes on later adopts the hour already on screen', () => {
  _idfmFrequencyFollowWeekHourForTest(false);
  _comptagesSetParamsForTest({ slot: 'e04' });
  assert.equal(_idfmFrequencySlotForTest().band !== 4 || _idfmFrequencySlotForTest().day !== 'samedi', true);
  _idfmFrequencyFollowWeekHourForTest(true);
  const idfm = _idfmFrequencySlotForTest();
  assert.equal(idfm.day, 'samedi');
  assert.equal(idfm.band, 4);
});

test('a layer switched off stops following and leaves the cursor alone', () => {
  _comptagesSetParamsForTest({ slot: 'w08' });
  _comptagesFollowWeekHourForTest(false);
  setWeekHour('test', { day: 4, hour: 20 });
  assert.equal(_comptagesSlotForTest().token, 'w08', 'an off layer hears nothing');
  assert.deepEqual(getWeekHour(), { day: 4, hour: 20 }, 'and turning it off pins nothing');
  assert.equal(_pulseStateForTest().slot, 4 * 24 + 20, 'the rows still on still follow');
});

test('nobody echoes: one set, one round, no re-entry', () => {
  // Each layer writes back the hour it adopts through the same `setParams`
  // path a chip uses, so a cursor that notified its own source would round
  // forever. The proof is that a second identical set changes nothing.
  _comptagesSetParamsForTest({ slot: 'w08' });
  const first = getWeekHour();
  assert.deepEqual(first, { day: 1, hour: 8 });
  assert.equal(setWeekHour('test', { day: first.day, hour: first.hour }), false);
  assert.deepEqual(getWeekHour(), first);
});
