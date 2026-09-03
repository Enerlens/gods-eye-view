// src/data/veloPulseHud.test.mjs
// The panel under the globe: the two answers it computes rather than paints.
//
// The DOM half is proved in the browser by `scripts/qa-velo-pulse.mjs`, which
// is where a panel that mounts, scrubs and stays visible can actually be seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PULSE_SLOTS } from './veloPulseFeed.js';
import {
  PULSE_HUD_DAY_INITIALS,
  pulseLegendSentence,
  pulseSlotFromRatio,
} from './veloPulseHud.js';

test('the strip reaches both ends of the week, and never past them', () => {
  assert.equal(pulseSlotFromRatio(0), 0, 'the left edge is Monday 00:00');
  // The right edge is Sunday 23:00 and NOT slot 168, which does not exist: a
  // strip whose last hour is unreachable hides the end of the week.
  assert.equal(pulseSlotFromRatio(1), PULSE_SLOTS - 1);
  assert.equal(pulseSlotFromRatio(0.5), PULSE_SLOTS / 2);
  // A drag can leave the element in either direction.
  assert.equal(pulseSlotFromRatio(-0.4), 0);
  assert.equal(pulseSlotFromRatio(4), PULSE_SLOTS - 1);
  assert.equal(pulseSlotFromRatio(Number.NaN), 0);
  // Every hour of the week is reachable from some ratio — no hour is a pixel
  // nobody can land on.
  const reached = new Set();
  for (let step = 0; step <= 2000; step += 1) reached.add(pulseSlotFromRatio(step / 2000));
  assert.equal(reached.size, PULSE_SLOTS);
});

test('the legend names both instruments, because they are not the same quantity', () => {
  const sentence = pulseLegendSentence({
    byCity: {
      lyon: { label: 'Lyon — Vélo\'v', instrument: 'stock' },
      paris: { label: 'Paris — compteurs vélo', instrument: 'flow' },
    },
  });
  assert.match(sentence, /Lyon.*STOCK/);
  assert.match(sentence, /Paris.*FLUX/);
  // And it says what each visual channel carries, which is the sentence the
  // animated field had nowhere to put.
  assert.match(sentence, /couleur/);
  assert.match(sentence, /surface/);
  // A summary that has not landed yet still produces a usable sentence rather
  // than a half-written one.
  assert.match(pulseLegendSentence(null), /couleur/);
});

test('the strip is labelled Monday to Sunday, in that order', () => {
  assert.deepEqual([...PULSE_HUD_DAY_INITIALS], ['L', 'M', 'M', 'J', 'V', 'S', 'D']);
});
