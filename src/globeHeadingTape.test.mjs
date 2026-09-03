// src/globeHeadingTape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  _destroyGlobeHeadingTapeForTest,
  _paintGlobeHeadingTapeForTest,
} from './globeHeadingTape.js';

/** Minimal sinks the paint path writes into. */
function sinks() {
  return {
    element: {},
    tape: { innerHTML: '' },
    value: { textContent: '' },
  };
}

test('the tape names the camera heading, with the centre division marked', () => {
  const { element, tape, value } = sinks();
  _paintGlobeHeadingTapeForTest({
    viewer: { camera: { heading: Cesium.Math.toRadians(90) } },
    element, tape, value,
  });
  assert.equal(value.textContent, '090');
  // Seven divisions, 30° apart, centred on the camera heading: 000 through 180.
  assert.equal((tape.innerHTML.match(/<span/g) || []).length, 7);
  assert.match(tape.innerHTML, /class="active"[^>]*>E</, 'east is the centre tick');
  assert.match(tape.innerHTML, /N</, 'north is on the tape');
  assert.match(tape.innerHTML, /S</, 'south is on the tape');
  _destroyGlobeHeadingTapeForTest();
});

test('the cardinal labels agree with the cockpit tape, because they share the formatter', async () => {
  const { compassDivisions, formatCompassDivision } = await import('./cockpitMath.js');
  const { element, tape, value } = sinks();
  _paintGlobeHeadingTapeForTest({
    viewer: { camera: { heading: Cesium.Math.toRadians(225) } },
    element, tape, value,
  });
  for (const division of compassDivisions(225)) {
    assert.ok(tape.innerHTML.includes(`>${formatCompassDivision(division)}<`),
      `division ${division} must be labelled the way the cockpit labels it`);
  }
  assert.equal(value.textContent, '225');
  _destroyGlobeHeadingTapeForTest();
});

test('no camera reading is blank, never north', () => {
  // The failure mode this guards: a stale heading standing in for a heading we
  // no longer have would be an orientation claim nobody measured.
  const { element, tape, value } = sinks();
  _paintGlobeHeadingTapeForTest({
    viewer: { camera: { heading: Cesium.Math.toRadians(45) } },
    element, tape, value,
  });
  assert.equal(value.textContent, '045');
  _paintGlobeHeadingTapeForTest({ viewer: { camera: {} }, element, tape, value });
  assert.equal(value.textContent, '---');
  assert.equal(tape.innerHTML, '');
  _destroyGlobeHeadingTapeForTest();
});

test('a heading past due north wraps rather than printing 360', () => {
  const { element, tape, value } = sinks();
  _paintGlobeHeadingTapeForTest({
    viewer: { camera: { heading: Cesium.Math.toRadians(-15) } },
    element, tape, value,
  });
  assert.equal(value.textContent, '345');
  _destroyGlobeHeadingTapeForTest();
});
