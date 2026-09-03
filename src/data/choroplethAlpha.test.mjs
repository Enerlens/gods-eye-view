// src/data/choroplethAlpha.test.mjs
//
// The four French count choropleths declare six ordered classes. This test
// asks the only question that matters about that claim: after the fill is
// composited over the basemap, are they still six ORDERED classes?
//
// It recomputes the whole chain — sRGB → linear light, source-over blend,
// relative luminance, CIE L* — over eight representative backgrounds, and
// fails on any inversion. The ascending ladder these layers used to share
// produced 67.4 · 65.9 · 65.3 · 65.8 · 69.6 · 78.0 on a light urban basemap:
// a U in which class 1 read lighter than classes 2, 3 and 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHOROPLETH_FILL_ALPHA, choroplethFillAlpha } from './choroplethAlpha.js';

/** sRGB byte → linear-light component. */
function toLinear(byte) {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** '#rrggbb' → linear-light triple. */
function linearFromHex(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => toLinear(Number.parseInt(h.slice(i, i + 2), 16)));
}

/** Source-over blend, done in LINEAR light (the compositor's own space). */
function over(foreground, background, alpha) {
  return foreground.map((c, i) => alpha * c + (1 - alpha) * background[i]);
}

/** Linear-light triple → CIE L*. */
function lightness(rgb) {
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return y > 0.008856 ? 116 * y ** (1 / 3) - 16 : 903.3 * y;
}

/** The four ramps that share the ladder, in their shipped order. */
const RAMPS = {
  'irve-fr': ['#2f1b52', '#4d2a86', '#7239b4', '#9b4fd0', '#c774e0', '#eba9ef'],
  'sup-fr': ['#241452', '#35207d', '#4b2fae', '#6544dd', '#8e73f0', '#bfaefa'],
  'amenities-fr': ['#5c3510', '#8a4a12', '#b26a26', '#d18f45', '#e3b778', '#f0d9b5'],
  'schools-fr': ['#0b3d2e', '#125c44', '#1a7f5a', '#27a373', '#4ec99b', '#8fe8c4'],
};

/** Backgrounds these layers actually land on, light to dark. */
const BACKGROUNDS = {
  'near-white winter city': '#e8e6e0',
  'light urban ortho': '#c8c4bb',
  'pale sand': '#d8d4cc',
  'pale coastal water': '#b8cfe0',
  'mid ortho': '#7a7568',
  forest: '#2a3a24',
  'deep water': '#12161c',
  'night ocean': '#0a0d12',
};

/** Composited L* for one ramp on one background, class 0 first. */
function compositedLightness(ramp, backgroundHex) {
  const background = linearFromHex(backgroundHex);
  return ramp.map((hex, index) => lightness(
    over(linearFromHex(hex), background, choroplethFillAlpha(index)),
  ));
}

test('every class stays lighter than the one below it, on every basemap', () => {
  for (const [rampId, ramp] of Object.entries(RAMPS)) {
    for (const [backgroundName, backgroundHex] of Object.entries(BACKGROUNDS)) {
      const values = compositedLightness(ramp, backgroundHex);
      for (let i = 0; i < values.length - 1; i += 1) {
        assert.ok(
          values[i + 1] > values[i],
          `${rampId} on ${backgroundName}: class ${i + 1} (L* ${values[i + 1].toFixed(1)}) `
          + `is not lighter than class ${i} (L* ${values[i].toFixed(1)}) — `
          + `[${values.map((v) => v.toFixed(1)).join(', ')}]`,
        );
      }
    }
  }
});

test('adjacent classes are separated by more than a just-noticeable difference', () => {
  // Monotone is not enough: two classes 0.4 L* apart are ordered and
  // indistinguishable. Large flat areas resolve ~2-3 L*; the ladder was chosen
  // to clear that with margin on every background tested.
  const MIN_GAP = 5;
  let worst = { gap: Infinity, where: '' };
  for (const [rampId, ramp] of Object.entries(RAMPS)) {
    for (const [backgroundName, backgroundHex] of Object.entries(BACKGROUNDS)) {
      const values = compositedLightness(ramp, backgroundHex);
      for (let i = 0; i < values.length - 1; i += 1) {
        const gap = values[i + 1] - values[i];
        if (gap < worst.gap) worst = { gap, where: `${rampId} on ${backgroundName}, class ${i}→${i + 1}` };
      }
    }
  }
  assert.ok(worst.gap >= MIN_GAP,
    `smallest separation is ${worst.gap.toFixed(2)} L* at ${worst.where}`);
});

test('the ladder descends, and that is the point', () => {
  // The darkest swatch is the one a light basemap washes out, so it carries the
  // most opacity. Reverting this to "alpha climbs with the value" reintroduces
  // the inversion the first test catches — this assertion just names the cause.
  for (let i = 0; i < CHOROPLETH_FILL_ALPHA.length - 1; i += 1) {
    assert.ok(CHOROPLETH_FILL_ALPHA[i] > CHOROPLETH_FILL_ALPHA[i + 1],
      `alpha must descend: ${CHOROPLETH_FILL_ALPHA.join(', ')}`);
  }
  // And the fill stays a fill: no class is opaque enough to erase the imagery.
  assert.ok(Math.max(...CHOROPLETH_FILL_ALPHA) <= 0.8);
});

test('the old ascending ladder would fail the first test — the guard is real', () => {
  // Guard against a green test that proves nothing. This is the exact ladder
  // the four layers shipped before, and it must inverse on a light city.
  const OLD = [0.34, 0.40, 0.46, 0.53, 0.60, 0.68];
  const background = linearFromHex('#c8c4bb');
  const values = RAMPS['irve-fr'].map((hex, i) => lightness(
    over(linearFromHex(hex), background, OLD[i]),
  ));
  assert.ok(values[1] < values[0], 'the old ladder inverted class 0 → 1');
  assert.ok(values[2] < values[0], 'and class 0 → 2');
  // The published figures, reproduced to one decimal.
  assert.deepEqual(values.map((v) => Number(v.toFixed(1))), [67.4, 65.9, 65.3, 65.8, 69.6, 78.0]);
});

test('choroplethFillAlpha clamps rather than returning undefined', () => {
  assert.equal(choroplethFillAlpha(0), CHOROPLETH_FILL_ALPHA[0]);
  assert.equal(choroplethFillAlpha(99), CHOROPLETH_FILL_ALPHA.at(-1));
  assert.equal(choroplethFillAlpha(-3), CHOROPLETH_FILL_ALPHA[0]);
  assert.equal(choroplethFillAlpha(null), CHOROPLETH_FILL_ALPHA[0]);
});
