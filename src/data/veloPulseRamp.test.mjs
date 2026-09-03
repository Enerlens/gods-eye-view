// src/data/veloPulseRamp.test.mjs
// The lock on the heat field's colours.
//
// This layer paints over imagery nobody chose: the same band lands on a white
// roof, on a forest, on water and on a night city, and what a reader perceives
// is the COMPOSITE, not the swatch. The ramp shipped once with an inversion at
// the top — the busiest band drawn darker than the one below it — and no
// opacity setting could have hidden it, because the defect was in the ramp.
//
// So this file recomputes the whole chain the eye actually receives (sRGB →
// linear → CIE L*, composited at the layer's own alpha over eight backdrops)
// and fails if any pair of neighbouring bands inverts or gets too close. It is
// the same method `choroplethAlpha.test.mjs` uses on the French choropleths.
//
// CARTOGRAPHIE B3 ("six paliers déclarés ne font pas six paliers perçus") and
// B4 ("convertir la rampe en niveaux de gris — l'ordre survit-il ?").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PULSE_RAMP, PULSE_UNSAMPLED_COLOR, pulseRampColor } from './veloPulseFeed.js';

/**
 * The alpha the layer really draws with, READ OUT OF THE LAYER.
 *
 * It was a literal here — `const BLOB_ALPHA = 0.45` with a comment promising it
 * matched `veloPulse.js` — and that promise was worth nothing: setting the
 * layer's own constant to 0.92 left all five tests green, including the one
 * asserting "the map keeps at least half of itself", which was comparing the
 * copy to itself. Correction A3 (opacity stops encoding the value) had no
 * coverage at all.
 *
 * `veloPulse.js` cannot be imported here — it pulls in Cesium — so the value is
 * parsed out of its source, the same way `cameraHandoff.test.mjs` reads the
 * modules it cannot load.
 */
const BLOB_ALPHA = (() => {
  const source = readFileSync(fileURLToPath(new URL('./veloPulse.js', import.meta.url)), 'utf8');
  const match = source.match(/^const BLOB_ALPHA = ([\d.]+);$/m);
  assert.ok(match, 'veloPulse.js no longer declares `const BLOB_ALPHA = <number>;`');
  return Number(match[1]);
})();

/**
 * Eight backdrops the field really lands on, sampled from the basemaps in use:
 * a light winter city, forest, water, near-white, a dark roof, dry grass, sand,
 * and a night view.
 */
const BACKDROPS = Object.freeze({
  'ville claire': '#c8c4bb',
  forêt: '#4a5c3a',
  eau: '#2a4a6b',
  'quasi-blanc': '#ecebe7',
  'toit sombre': '#3a3a3c',
  'herbe sèche': '#8a8f7a',
  sable: '#d9cdb8',
  nuit: '#1e2430',
});

const channels = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** CIE L* — perceived lightness, which is what "ordered ramp" has to mean. */
function lightness(rgb) {
  const [r, g, b] = rgb.map((value) => toLinear(value / 255));
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

const composite = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

test('the ramp is monotone in lightness, so its order survives a greyscale', () => {
  // DARKENS with the share: pale where a station is doing nothing, deep carmine
  // at its weekly maximum. What the test holds is the MONOTONICITY, not the
  // direction — the direction is a design decision documented in the feed.
  const ls = PULSE_RAMP.map((band) => lightness(channels(band.color)));
  for (let index = 1; index < ls.length; index += 1) {
    assert.ok(ls[index] < ls[index - 1],
      `band ${index} (${PULSE_RAMP[index].label}, L* ${ls[index].toFixed(1)}) must be darker `
      + `than band ${index - 1} (L* ${ls[index - 1].toFixed(1)})`);
  }
  // The span has to be wide enough to be worth five bands at all.
  assert.ok(ls[0] - ls.at(-1) > 55, `only ${(ls[0] - ls.at(-1)).toFixed(0)} L* between the ends`);
});

test('composited on eight backdrops, no two bands invert or collide', () => {
  const failures = [];
  for (const [name, hex] of Object.entries(BACKDROPS)) {
    const bg = channels(hex);
    const ls = PULSE_RAMP.map((band) => lightness(composite(channels(band.color), BLOB_ALPHA, bg)));
    for (let index = 1; index < ls.length; index += 1) {
      const gap = Math.abs(ls[index] - ls[index - 1]);
      // 5 L* is roughly where two greys stop being confusable side by side; the
      // choropleth fix landed at 5.7 and this ramp measures 6.6 at its worst.
      const ordered = ls[index] < ls[index - 1];
      if (!ordered) failures.push(`${name}: INVERSION at ${PULSE_RAMP[index].label}`);
      else if (gap < 5) failures.push(`${name}: ${PULSE_RAMP[index - 1].label} → ${PULSE_RAMP[index].label} = ${gap.toFixed(1)} L*`);
    }
  }
  assert.deepEqual(failures, [], failures.join(' | '));
});

test('the busiest band is visible on the map, and the calmest is discreet', () => {
  // THE TEST THE FIRST REPAIR DID NOT HAVE. A ramp can be perfectly ordered and
  // still invisible: ending on a pale mint gave five separable bands whose
  // busiest one sat at ΔE 11 from a light city — a blob nobody could see. Band
  // separation and figure/ground contrast are two different requirements.
  const lab = (rgb) => {
    const [r, g, b] = rgb.map((value) => toLinear(value / 255));
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const distance = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
  for (const [name, hex] of Object.entries(BACKDROPS)) {
    const bg = channels(hex);
    const busiest = composite(channels(PULSE_RAMP.at(-1).color), BLOB_ALPHA, bg);
    assert.ok(distance(busiest, bg) >= 18,
      `the busiest band is only ΔE ${distance(busiest, bg).toFixed(0)} from ${name}`);
  }
});

test('the map keeps at least half of itself under every blob', () => {
  // The complaint this whole change answers: at the top of the old variable
  // alpha ladder (0.90) barely a tenth of the basemap survived, and a reader
  // could no longer tell which street a dock was on.
  assert.ok(BLOB_ALPHA <= 0.5, `alpha ${BLOB_ALPHA} leaves only ${Math.round((1 - BLOB_ALPHA) * 100)} % of the map`);
});

test('an unsampled hour is neither end of the ramp, and never mistakable for a band', () => {
  const grey = lightness(channels(PULSE_UNSAMPLED_COLOR));
  const ends = PULSE_RAMP.map((band) => lightness(channels(band.color)));
  assert.ok(grey < Math.max(...ends) && grey > Math.min(...ends),
    'the grey must not read as the smallest or the largest value');
  for (const band of PULSE_RAMP) {
    assert.notEqual(band.color.toLowerCase(), PULSE_UNSAMPLED_COLOR.toLowerCase());
  }
  assert.notEqual(pulseRampColor(0).toLowerCase(), PULSE_UNSAMPLED_COLOR.toLowerCase());
  // COMPOSITED, and at its OWN alpha, which is the only comparison a reader
  // ever makes. A hole and a measured near-zero are two different claims and
  // they have to look like two different marks: at the old 0.22 the grey came
  // within ΔE 12 of the palest band over a light city.
  const unsampledAlpha = (() => {
    const source = readFileSync(fileURLToPath(new URL('./veloPulse.js', import.meta.url)), 'utf8');
    const match = source.match(/^const BLOB_ALPHA_UNSAMPLED = ([\d.]+);$/m);
    assert.ok(match, 'veloPulse.js no longer declares `const BLOB_ALPHA_UNSAMPLED = <number>;`');
    return Number(match[1]);
  })();
  assert.ok(unsampledAlpha < BLOB_ALPHA, 'a hole must be fainter than any measurement');
  const lab = (rgb) => {
    const [r, g, b] = rgb.map((value) => toLinear(value / 255));
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const distance = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
  for (const [name, hex] of Object.entries(BACKDROPS)) {
    const bg = channels(hex);
    const hole = composite(channels(PULSE_UNSAMPLED_COLOR), unsampledAlpha, bg);
    for (const band of PULSE_RAMP) {
      const measured = composite(channels(band.color), BLOB_ALPHA, bg);
      assert.ok(distance(hole, measured) >= 14,
        `on ${name}, an unsampled hour is only ΔE ${distance(hole, measured).toFixed(0)} from ${band.label}`);
    }
  }
});

test('the ramp stays clear of the two magnitude ramps drawn over the same cities', () => {
  // `idfm-frequency` paints a desaturated cold → cream ladder over Paris and
  // `comptages-fr` an indigo → magenta → rose one over the same streets. Two
  // layers on one coordinate may not share a colour, and the check is a plain
  // distance in Lab rather than a promise in a comment.
  const IDFM = ['#43587a', '#63809f', '#94a8b8', '#cbc6b4', '#e8d5a0', '#fff0c4'];
  const COMPTAGES = ['#3b2c6b', '#6b3b9e', '#a03fa0', '#d1478a', '#f06a7a'];
  const lab = (hex) => {
    const [r, g, b] = channels(hex).map((value) => toLinear(value / 255));
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const distance = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
  for (const other of [...IDFM, ...COMPTAGES]) {
    for (const band of PULSE_RAMP) {
      assert.ok(distance(band.color, other) > 10,
        `${band.color} is only ΔE ${distance(band.color, other).toFixed(0)} from ${other}`);
    }
  }
});
