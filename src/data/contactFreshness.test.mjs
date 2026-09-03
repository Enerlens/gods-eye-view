// src/data/contactFreshness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { coastingContactColor, coastingSwatchCss, contactTint } from './contactFreshness.js';

const WHITE = Cesium.Color.WHITE;
const AMBER = Cesium.Color.fromCssColorString('#FFB800');

test('a coasting contact stays fully opaque — alpha is depth, not freshness', () => {
  // The defect: `baseAlpha: missingPolls ? 0.45 : 1` was multiplied into the
  // same alpha as the limb recession (floor 0.35) and the focus de-emphasis
  // (floor 0.25). Three facts, one variable, none recoverable. Whatever else
  // changes, freshness must no longer touch alpha.
  assert.equal(coastingContactColor(WHITE).alpha, 1);
  assert.equal(coastingContactColor(AMBER).alpha, 1);
  assert.equal(coastingContactColor(WHITE.withAlpha(0.5)).alpha, 0.5,
    'and it carries whatever alpha the caller set, unchanged');
});

test('the wash is visible on BOTH tints, including the already-unsaturated one', () => {
  // "Desaturate" is the textbook answer and it is a no-op on the civil fleet,
  // which is pure white. A mix toward a neutral works on both.
  const washedWhite = coastingContactColor(WHITE);
  const washedAmber = coastingContactColor(AMBER);
  // White loses value.
  assert.ok(washedWhite.red < 0.95 && washedWhite.green < 0.95 && washedWhite.blue < 0.95);
  // Amber loses its warmth: the red-to-blue spread narrows sharply.
  const liveSpread = AMBER.red - AMBER.blue;
  const washedSpread = washedAmber.red - washedAmber.blue;
  assert.ok(washedSpread < liveSpread * 0.6,
    `amber must lose most of its chroma: ${washedSpread} vs ${liveSpread}`);
  // Both remain distinguishable from each other, so the military/civil
  // distinction survives the wash.
  assert.notEqual(coastingSwatchCss('#ffffff'), coastingSwatchCss('#ffb800'));
});

test('a reporting contact is untouched', () => {
  assert.equal(contactTint(WHITE, false), WHITE);
  assert.equal(contactTint(AMBER, false), AMBER);
  assert.notEqual(contactTint(AMBER, true).toCssColorString(), AMBER.toCssColorString());
});

test('the legend swatch is the colour the sprite actually wears', () => {
  assert.equal(coastingSwatchCss('#ffffff'), coastingContactColor(WHITE).toCssColorString());
  assert.equal(coastingSwatchCss('#ffb800'), coastingContactColor(AMBER).toCssColorString());
});

test('the same tint asked twice returns the same object — no per-frame allocation', () => {
  // This runs inside a ~12 Hz fleet pass over every billboard on screen.
  assert.equal(coastingContactColor(WHITE), coastingContactColor(Cesium.Color.WHITE));
});
