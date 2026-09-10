// The cursor the Gironde reconstruction is read along.
//
// This file exists because the awkward half of a timeline is all edges — the
// two ends, the rewind, the chip that lands exactly on a frame, the tab that
// was backgrounded for a minute — and none of them is reachable from a test
// that has to build a Cesium viewer first. Everything here is arithmetic.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MEGAFIRE_EMBER_FLOOR,
  MEGAFIRE_FADE_HOURS,
  MEGAFIRE_PLAY_SECONDS,
  advanceMegafireClock,
  createMegafireClock,
  megafireClockState,
  megafireCursorLabel,
  megafireEmberStrength,
  seekMegafireClock,
  setMegafirePlaying,
} from './megafireClock.js';
import { MEGAFIRE_STEPS, MEGAFIRE_WINDOW_END, MEGAFIRE_WINDOW_START } from './megafirePack.js';

const START = Date.parse(MEGAFIRE_WINDOW_START);
const END = Date.parse(MEGAFIRE_WINDOW_END);
const HOUR = 3600_000;
const fresh = () => createMegafireClock({ startMs: START, endMs: END });

test('a clock opens on the closing frame, paused', () => {
  const clock = fresh();
  assert.equal(clock.cursorMs, END, 'the state still true today is the one a reader lands on');
  assert.equal(clock.playing, false);
  assert.equal(megafireClockState(clock).progress, 1);
  assert.equal(megafireClockState(clock).atEnd, true);
  assert.equal(megafireClockState(clock).stepIndex, MEGAFIRE_STEPS.length - 1);
});

test('a window that is not a window is refused rather than drawn empty', () => {
  assert.throws(() => createMegafireClock({ startMs: END, endMs: START }), RangeError);
  assert.throws(() => createMegafireClock({ startMs: START, endMs: START }), RangeError);
  assert.throws(() => createMegafireClock({ startMs: NaN, endMs: END }), RangeError);
});

test('a paused clock does not move, however hard it is ticked', () => {
  const clock = fresh();
  seekMegafireClock(clock, START);
  assert.equal(advanceMegafireClock(clock, 10), false);
  assert.equal(clock.cursorMs, START);
});

test('one playthrough crosses the window in the advertised time', () => {
  const clock = fresh();
  setMegafirePlaying(clock, true);
  assert.equal(clock.cursorMs, START, 'pressing play at the end rewinds');
  // Ticked in 0.1 s steps, which is inside the 0.25 s clamp.
  let ticks = 0;
  while (clock.playing && ticks < 10000) {
    advanceMegafireClock(clock, 0.1);
    ticks += 1;
  }
  assert.equal(clock.playing, false, 'playback stops at the end, it does not loop');
  assert.equal(clock.cursorMs, END);
  const seconds = ticks * 0.1;
  assert.ok(Math.abs(seconds - MEGAFIRE_PLAY_SECONDS) < 0.5,
    `crossed in ${seconds.toFixed(1)} s, advertised ${MEGAFIRE_PLAY_SECONDS} s`);
});

test('a backgrounded tab cannot jump the fire in one frame', () => {
  const clock = fresh();
  seekMegafireClock(clock, START);
  setMegafirePlaying(clock, true);
  advanceMegafireClock(clock, 600);
  const span = END - START;
  // 0.25 s of the 24 s playthrough, and not the 600 s that were asked for.
  assert.ok(clock.cursorMs - START < span * 0.02,
    'a 10-minute delta was not clamped — the whole event would pass in one frame');
  assert.equal(clock.playing, true);
});

test('a negative or absent delta is a no-op, not a rewind', () => {
  const clock = fresh();
  seekMegafireClock(clock, START + HOUR);
  setMegafirePlaying(clock, true);
  const before = clock.cursorMs;
  assert.equal(advanceMegafireClock(clock, -5), false);
  assert.equal(advanceMegafireClock(clock, NaN), false);
  assert.equal(advanceMegafireClock(clock, undefined), false);
  assert.equal(clock.cursorMs, before);
});

test('seeking always pauses, and clamps to the window', () => {
  const clock = fresh();
  setMegafirePlaying(clock, true);
  seekMegafireClock(clock, Date.parse(MEGAFIRE_STEPS[1].acq));
  assert.equal(clock.playing, false, 'a chip the cursor drifts off is a chip that does not work');
  assert.equal(megafireClockState(clock).stepIndex, 1);
  assert.equal(seekMegafireClock(clock, START - 10 * HOUR), START);
  assert.equal(seekMegafireClock(clock, END + 10 * HOUR), END);
  assert.equal(seekMegafireClock(clock, NaN), END, 'nonsense leaves the cursor alone');
});

test('play toggles, and rewinds only from the end', () => {
  const clock = fresh();
  assert.equal(setMegafirePlaying(clock), true);
  assert.equal(clock.cursorMs, START, 'play at the end rewinds');
  const mid = START + (END - START) / 2;
  seekMegafireClock(clock, mid);
  assert.equal(setMegafirePlaying(clock), true);
  assert.equal(clock.cursorMs, mid, 'play from the middle resumes where it was');
  assert.equal(setMegafirePlaying(clock), false);
  assert.equal(clock.cursorMs, mid, 'pause does not move the cursor');
});

test('a step becomes true at its acquisition instant and stays true until the next', () => {
  const clock = fresh();
  const first = Date.parse(MEGAFIRE_STEPS[0].acq);
  const second = Date.parse(MEGAFIRE_STEPS[1].acq);
  seekMegafireClock(clock, first - 1);
  assert.equal(megafireClockState(clock).stepIndex, null);
  seekMegafireClock(clock, first);
  assert.equal(megafireClockState(clock).stepIndex, 0);
  seekMegafireClock(clock, second - 1);
  assert.equal(megafireClockState(clock).stepIndex, 0, 'the gap is held, never tweened');
  seekMegafireClock(clock, second);
  assert.equal(megafireClockState(clock).stepIndex, 1);
});

test('an ember is absent before its detection and never fades to nothing after', () => {
  const at = Date.parse('2026-07-24T12:00:00Z');
  assert.equal(megafireEmberStrength(at, at - 1), 0, 'the future is absent, not dim');
  assert.equal(megafireEmberStrength(at, at), 1, 'a fresh detection burns at full strength');
  const half = megafireEmberStrength(at, at + (MEGAFIRE_FADE_HOURS / 2) * HOUR);
  assert.ok(half > MEGAFIRE_EMBER_FLOOR && half < 1);
  assert.equal(megafireEmberStrength(at, at + MEGAFIRE_FADE_HOURS * HOUR), MEGAFIRE_EMBER_FLOOR);
  assert.equal(megafireEmberStrength(at, at + 400 * HOUR), MEGAFIRE_EMBER_FLOOR,
    'a week later the ground is still burnt — the record must not disappear');
  assert.equal(megafireEmberStrength(NaN, at), 0);
});

test('the ember fade is monotonic across the horizon', () => {
  const at = Date.parse('2026-07-24T12:00:00Z');
  let previous = Infinity;
  for (let hours = 0; hours <= MEGAFIRE_FADE_HOURS; hours += 0.5) {
    const strength = megafireEmberStrength(at, at + hours * HOUR);
    assert.ok(strength <= previous, `strength climbed at ${hours} h`);
    previous = strength;
  }
});

test('the cursor label is UTC, French, and matches the pack', () => {
  assert.equal(megafireCursorLabel(Date.parse('2026-07-24T09:05:00Z')), '24 juil. 09:05 UTC');
  assert.equal(megafireCursorLabel(Date.parse('2026-08-01T11:38:00Z')), '1ᵉʳ août 11:38 UTC');
  assert.equal(megafireCursorLabel(Date.parse('2026-07-22T11:55:00Z')), '22 juil. 11:55 UTC');
  assert.equal(megafireCursorLabel(NaN), '—');
  // The five chip labels in the pack are this function's own output, minus the
  // zone — if one drifts, a chip and the card disagree about the same instant.
  for (const step of MEGAFIRE_STEPS) {
    assert.equal(megafireCursorLabel(Date.parse(step.acq)), `${step.label} UTC`);
  }
});
