// src/data/choroplethPrism.test.mjs
//
// The prism grammar makes four claims that a reader cannot check by looking at
// the map, so they are checked here instead:
//
//   1. The calibration is arithmetic, not taste. Every pixel figure in the
//      module header is re-derived from `prismApparentPx` below, so a future
//      edit to PRISM_MAX_HEIGHT_M cannot leave a header full of stale numbers.
//   2. "Not measured" and "measured at zero" are different values and stay
//      different values (A1). This is the one contract the four consuming
//      layers can break silently, with a `?? 0`.
//   3. The count is on the HEIGHT and the rate is on the COLOUR, and neither
//      leaks into the other (B1 / A3).
//   4. The scale is frozen, so the same département is the same height
//      whatever else is in the payload (C1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRISM_BASE_HEIGHT_M,
  PRISM_BODY_ALPHA,
  PRISM_MAX_HEIGHT_M,
  PRISM_MIN_HEIGHT_M,
  PRISM_MODES,
  PRISM_NO_RATIO_COLOR,
  PRISM_NO_RATIO_BODY_GLYPH,
  PRISM_NO_VALUE_GLYPH,
  PRISM_TOP_ALPHA,
  createPrismScale,
  prismApparentPx,
  prismHeightGlyph,
  prismHeightM,
  prismIsClipped,
  prismLegend,
  prismRatioBin,
  prismRatioClassLabel,
  prismRatioColor,
  prismRow,
  prismTally,
} from './choroplethPrism.js';

/** The `irve-fr` domain, as measured in `irveDepartements.js`: 227 → 10 539. */
const IRVE = createPrismScale({
  id: 'irve-fr',
  domainMax: 10_539,
  heightLabel: 'points de charge',
  heightUnit: 'points de charge',
  ratioLabel: 'points de charge pour 1 000 km²',
  ratioBreaks: [50, 120, 300, 900, 3000],
  ratioColors: ['#2f1b52', '#4d2a86', '#7239b4', '#9b4fd0', '#c774e0', '#eba9ef'],
});

/** A wide-domain layer, the case `'sqrt'` exists for. */
const SUP = createPrismScale({
  id: 'sup-fr',
  domainMax: 400_000,
  mode: 'sqrt',
  heightLabel: 'étudiants',
  heightUnit: 'étudiants',
  ratioLabel: 'étudiants pour 1 000 habitants',
  ratioBreaks: [20, 40, 80],
  ratioColors: ['#241452', '#4b2fae', '#8e73f0', '#bfaefa'],
});

/** Whitespace-insensitive compare — `toLocaleString` uses U+202F, not a space. */
const flat = (text) => String(text).replace(/\s+/gu, ' ');

// ---------------------------------------------------------------------------
// 1 · Calibration
// ---------------------------------------------------------------------------

test('the frustum arithmetic is Cesium’s own', () => {
  // Cesium: `fov` is HORIZONTAL when aspect > 1, and
  // fovy = 2·atan(tan(fov/2)/aspect) — Build/CesiumUnminified/index.js:197525.
  const fovy = 2 * Math.atan(Math.tan(Math.PI / 6) / 1.6);
  assert.equal(Number((fovy * 180 / Math.PI).toFixed(2)), 39.68);

  // A 1 m mark at 1 m, straight on, subtends 2·atan(0.5) — no small-angle
  // shortcut, so the function stays right when a prism is close.
  const px = prismApparentPx({
    heightM: 1, cameraDistanceM: 1, viewportHeightPx: 1000, aspect: 1.6,
  });
  assert.equal(Number(px.toFixed(3)), Number((2 * Math.atan(0.5) * (1000 / fovy)).toFixed(3)));

  // A square viewport takes `fov` as the vertical angle directly.
  const square = prismApparentPx({
    heightM: 1000, cameraDistanceM: 1_000_000, viewportHeightPx: 1000, aspect: 1,
  });
  assert.ok(square < prismApparentPx({
    heightM: 1000, cameraDistanceM: 1_000_000, viewportHeightPx: 1000, aspect: 1.6,
  }));
});

test('national altitude is ~1 500 km, and that is derived not guessed', () => {
  // The three count layers enter their national regime at a view latitude span
  // of 9.5°, metropolitan France being 9.8° tall. 9.5° is 1 056 km on the
  // ground, and 2·d·tan(fovy/2) = 1 056 km puts the camera at 1 460 km.
  const groundSpanM = 9.5 * 111_320;
  const fovy = 2 * Math.atan(Math.tan(Math.PI / 6) / 1.6);
  const distanceM = groundSpanM / (2 * Math.tan(fovy / 2));
  assert.equal(Math.round(distanceM / 1000), 1465);
  assert.ok(distanceM > 1_400_000 && distanceM < 1_530_000,
    'the 1 500 km calibration distance must bracket the regime entry altitude');
});

test('every pixel figure in the module header is reproducible', () => {
  const at = (heightM) => Number(prismApparentPx({
    heightM, cameraDistanceM: 1_500_000, viewportHeightPx: 1000, aspect: 1.6,
  }).toFixed(1));

  assert.equal(at(PRISM_MAX_HEIGHT_M), 115.4);  // the tallest prism
  assert.equal(at(PRISM_MAX_HEIGHT_M / 2), 57.7);
  assert.equal(at(PRISM_MIN_HEIGHT_M), 3.9);    // the floor
  assert.equal(at(4808), 4.6);                  // Mont Blanc — all of France's relief
  assert.equal(at(70_000), 67.4);               // an average département, side-on

  // France, 1 000 km across, fills a 1600 px frame at that distance.
  const franceWidthPx = prismApparentPx({
    heightM: 1_000_000, cameraDistanceM: 1_500_000, viewportHeightPx: 1000, aspect: 1.6,
  });
  assert.equal(Math.round(franceWidthPx), 929);
});

test('the floor is visible, and its cost is the 3.3 % the header admits', () => {
  const at = (heightM) => prismApparentPx({
    heightM, cameraDistanceM: 1_500_000, viewportHeightPx: 1000, aspect: 1.6,
  });
  // Visible at national altitude, comfortable at a regional 400 km.
  assert.ok(at(PRISM_MIN_HEIGHT_M) >= 3, 'the floor must clear ~3 px nationally');
  assert.ok(prismApparentPx({
    heightM: PRISM_MIN_HEIGHT_M, cameraDistanceM: 400_000, viewportHeightPx: 1000, aspect: 1.6,
  }) > 12);
  const cost = PRISM_MIN_HEIGHT_M / PRISM_MAX_HEIGHT_M;
  assert.equal(Number((cost * 100).toFixed(1)), 3.3);

  // And it does bite in production: Lozère's 227 charge points are 2.6 km
  // linear on the irve-fr domain, under the floor. That is the measured reason
  // 'sqrt' is offered at all.
  assert.ok(227 / 10_539 * PRISM_MAX_HEIGHT_M < PRISM_MIN_HEIGHT_M);
  assert.equal(prismHeightM(227, IRVE), PRISM_MIN_HEIGHT_M);
});

test('prismApparentPx refuses degenerate optics instead of returning Infinity', () => {
  assert.equal(prismApparentPx({ heightM: 100, cameraDistanceM: 0 }), 0);
  assert.equal(prismApparentPx({ heightM: 0, cameraDistanceM: 1000 }), 0);
  assert.equal(prismApparentPx({ heightM: NaN, cameraDistanceM: 1000 }), 0);
  assert.equal(prismApparentPx(), 0);
});

// ---------------------------------------------------------------------------
// 2 · A1 — absent is not zero
// ---------------------------------------------------------------------------

test('an unmeasured value returns null, never 0', () => {
  for (const absent of [null, undefined, NaN, '', 'n/a', {}, [], true, false, Infinity]) {
    const height = prismHeightM(absent, IRVE);
    assert.equal(height, null, `${String(absent)} must be null`);
    assert.notEqual(height, 0, 'null and 0 are different facts');
  }
});

test('a measured zero returns 0, and is not the same thing as absent', () => {
  assert.equal(prismHeightM(0, IRVE), 0);
  assert.equal(prismHeightM('0', IRVE), 0);
  assert.equal(prismHeightM(null, IRVE), null);
  // The pair the four layers must never collapse with `?? 0`.
  assert.notEqual(prismHeightM(0, IRVE), prismHeightM(null, IRVE));

  const zero = prismRow({ code: '48', value: 0, ratio: 10 }, IRVE);
  const missing = prismRow({ code: '48', value: null, ratio: 10 }, IRVE);
  assert.deepEqual(
    [zero.hasValue, zero.measuredZero, zero.extruded],
    [true, true, false],
  );
  assert.deepEqual(
    [missing.hasValue, missing.measuredZero, missing.extruded],
    [false, false, false],
  );
});

test('a negative count is treated as absent, not clamped to the floor', () => {
  // On a count domain a negative can only be a bad parse, and a floored prism
  // would assert "there is a little bit here" about a row nobody measured.
  assert.equal(prismHeightM(-1, IRVE), null);
  assert.equal(prismHeightM(-10_000, IRVE), null);
});

test('a département measured at 1 is drawn, and taller than nothing', () => {
  const height = prismHeightM(1, IRVE);
  assert.equal(height, PRISM_MIN_HEIGHT_M);
  assert.ok(height > 0);
  assert.notEqual(height, prismHeightM(0, IRVE));
});

// ---------------------------------------------------------------------------
// 3 · The height scale
// ---------------------------------------------------------------------------

test('linear is linear — twice the count is twice the height', () => {
  const a = prismHeightM(2_000, IRVE);
  const b = prismHeightM(4_000, IRVE);
  assert.ok(a > PRISM_MIN_HEIGHT_M, 'both samples must clear the floor');
  assert.equal(Number((b / a).toFixed(6)), 2);
  assert.equal(prismHeightM(IRVE.domainMax, IRVE), PRISM_MAX_HEIGHT_M);
});

test('sqrt compresses, and says so by the numbers', () => {
  // Four times the count is twice the height — the property a reader has to be
  // told about, which is why prismLegend prints it in French for this mode.
  const a = prismHeightM(25_000, SUP);
  const b = prismHeightM(100_000, SUP);
  assert.equal(Number((b / a).toFixed(6)), 2);
  assert.equal(prismHeightM(SUP.domainMax, SUP), PRISM_MAX_HEIGHT_M);

  // And it is the only reason it exists: on a 1:800 domain the linear scale
  // puts the bottom under the floor, the sqrt one does not.
  const linearSup = createPrismScale({ ...specOf(SUP), mode: 'linear' });
  assert.equal(prismHeightM(500, linearSup), PRISM_MIN_HEIGHT_M);
  assert.ok(prismHeightM(500, SUP) > PRISM_MIN_HEIGHT_M);
});

test('height is monotone and bounded on both modes', () => {
  for (const scale of [IRVE, SUP]) {
    let previous = -1;
    for (let v = 0; v <= scale.domainMax; v += scale.domainMax / 500) {
      const height = prismHeightM(v, scale);
      assert.ok(height >= previous, `height must never decrease at ${v}`);
      assert.ok(height <= PRISM_MAX_HEIGHT_M + 1e-9, `height must stay under the cap at ${v}`);
      assert.ok(height === 0 || height >= PRISM_MIN_HEIGHT_M, `no height between 0 and the floor at ${v}`);
      previous = height;
    }
  }
});

test('a value above the frozen domain is clipped, and the clip is declared (A5)', () => {
  assert.equal(prismHeightM(IRVE.domainMax * 3, IRVE), PRISM_MAX_HEIGHT_M);
  assert.equal(prismIsClipped(IRVE.domainMax * 3, IRVE), true);
  assert.equal(prismIsClipped(IRVE.domainMax, IRVE), false);

  const row = prismRow({ code: '75', value: 99_999, ratio: 5000 }, IRVE);
  assert.equal(row.clipped, true);
  assert.equal(row.heightM, PRISM_MAX_HEIGHT_M);

  const legend = prismLegend(IRVE, prismTally([{ value: 99_999, ratio: 5000 }], IRVE));
  const clipRow = legend.find((entry) => /domaine gelé/u.test(entry.label));
  assert.ok(clipRow, 'the legend must publish the clipped count');
  assert.equal(clipRow.count, 1);
});

// ---------------------------------------------------------------------------
// 4 · C1 — the domain is frozen
// ---------------------------------------------------------------------------

test('a département’s height does not depend on the other départements', () => {
  // The test CARTOGRAPHIE C1 prescribes, run on the data instead of the camera:
  // widen the sample until it contains an extreme, and the first row must not
  // move. `franceDepartements.countBins()` — what these layers use today —
  // fails this by construction.
  const lonely = prismRow({ code: '48', value: 227, ratio: 44 }, IRVE);
  const crowded = [
    { code: '48', value: 227, ratio: 44 },
    { code: '75', value: 10_539, ratio: 101_785 },
    { code: '13', value: 6_000, ratio: 900 },
  ].map((row) => prismRow(row, IRVE));
  assert.equal(crowded[0].heightM, lonely.heightM);
  assert.equal(crowded[0].color, lonely.color);
});

test('the published scale is frozen, breaks and colours included', () => {
  assert.ok(Object.isFrozen(IRVE));
  assert.ok(Object.isFrozen(IRVE.ratioBreaks));
  assert.ok(Object.isFrozen(IRVE.ratioColors));
  assert.ok(Object.isFrozen(IRVE.heightTicks));
  assert.throws(() => { 'use strict'; IRVE.domainMax = 1; }, TypeError);
  assert.throws(() => { 'use strict'; IRVE.ratioBreaks[0] = 1; }, TypeError);
});

test('createPrismScale refuses a scale a reader could not trust', () => {
  const base = specOf(IRVE);
  assert.throws(() => createPrismScale({ ...base, mode: 'log' }), /mode must be one of/u);
  assert.throws(() => createPrismScale({ ...base, domainMax: 0 }), /domainMax/u);
  assert.throws(() => createPrismScale({ ...base, domainMin: -10 }), /domainMin/u);
  assert.throws(() => createPrismScale({ ...base, ratioBreaks: [10, 10, 20] }), /strictly ascending/u);
  assert.throws(() => createPrismScale({ ...base, ratioColors: ['#fff'] }), /ratioColors must hold/u);
  assert.throws(() => createPrismScale({ ...base, id: '' }), /an id is required/u);
  assert.throws(() => createPrismScale({ ...base, minHeightM: 200_000 }), /minHeightM must be below/u);
  assert.throws(() => createPrismScale({ ...base, ratioLabel: '' }), /ratioLabel is required/u);
  // A signed quantity must pass |value| — see the header. Not a negative floor.
  assert.throws(() => createPrismScale({ ...base, domainMin: -5000 }), /domainMin/u);
});

test('the helpers refuse a scale that did not come from createPrismScale', () => {
  const forged = { domainMax: 'lots', ratioColors: ['#fff'] };
  assert.throws(() => prismHeightM(1, forged), /prism scale/u);
  assert.throws(() => prismRatioBin(1, forged), /prism scale/u);
  assert.throws(() => prismRow({ value: 1 }, forged), /prism scale/u);
  assert.throws(() => prismLegend(forged), /prism scale/u);
  assert.throws(() => prismHeightM(1, null), /prism scale/u);
});

// ---------------------------------------------------------------------------
// 5 · B1 / A3 — two variables, two channels, no leakage
// ---------------------------------------------------------------------------

test('the count moves the height and nothing else', () => {
  const low = prismRow({ code: 'a', value: 1_000, ratio: 200 }, IRVE);
  const high = prismRow({ code: 'b', value: 8_000, ratio: 200 }, IRVE);
  assert.ok(high.heightM > low.heightM);
  assert.equal(high.color, low.color, 'the count must not touch the colour');
  assert.equal(high.bin, low.bin);
});

test('the rate moves the colour and nothing else', () => {
  const sparse = prismRow({ code: 'a', value: 5_000, ratio: 10 }, IRVE);
  const dense = prismRow({ code: 'b', value: 5_000, ratio: 5_000 }, IRVE);
  assert.notEqual(dense.color, sparse.color);
  assert.ok(dense.bin > sparse.bin);
  assert.equal(dense.heightM, sparse.heightM, 'the rate must not touch the height');
});

test('the two absences are independent and separately visible (A1)', () => {
  const both = prismRow({ code: '01', value: 500, ratio: 60 }, IRVE);
  assert.deepEqual([both.hasValue, both.hasRatio], [true, true]);
  assert.ok(both.heightM > 0 && both.color);

  const noRatio = prismRow({ code: '02', value: 500, ratio: null }, IRVE);
  assert.deepEqual([noRatio.hasValue, noRatio.hasRatio], [true, false]);
  assert.equal(noRatio.heightM, both.heightM, 'a missing rate must not shorten the prism');
  assert.equal(noRatio.color, null, 'a missing rate must not borrow a class colour');
  assert.equal(noRatio.bin, -1);

  const noValue = prismRow({ code: '03', value: undefined, ratio: 60 }, IRVE);
  assert.deepEqual([noValue.hasValue, noValue.hasRatio], [false, true]);
  assert.equal(noValue.heightM, null, 'a missing count must not become a zero-height prism');
  assert.equal(noValue.color, both.color, 'a missing count must not discard a measured rate');

  const neither = prismRow({ code: '04' }, IRVE);
  assert.deepEqual([neither.heightM, neither.color, neither.bin], [null, null, -1]);

  // All four states are distinguishable from each other.
  const signature = (row) => `${row.hasValue}/${row.hasRatio}`;
  assert.equal(new Set([both, noRatio, noValue, neither].map(signature)).size, 4);
});

test('prismRow survives a null row rather than throwing at paint time', () => {
  const row = prismRow(null, IRVE);
  assert.deepEqual([row.code, row.heightM, row.color], [null, null, null]);
});

// ---------------------------------------------------------------------------
// 6 · Colour classes
// ---------------------------------------------------------------------------

test('a break belongs to the class below it, and the top class is open', () => {
  assert.equal(prismRatioBin(0, IRVE), 0);
  assert.equal(prismRatioBin(50, IRVE), 0);       // ≤ the first break
  assert.equal(prismRatioBin(50.001, IRVE), 1);
  assert.equal(prismRatioBin(3000, IRVE), 4);
  assert.equal(prismRatioBin(101_785, IRVE), 5);  // Paris, above every break
  assert.equal(prismRatioColor(101_785, IRVE), IRVE.ratioColors.at(-1));
});

test('an unpublished rate is -1 and null, not the bottom class', () => {
  for (const absent of [null, undefined, NaN, '', 'n/a', {}, []]) {
    assert.equal(prismRatioBin(absent, IRVE), -1);
    assert.equal(prismRatioColor(absent, IRVE), null);
  }
  // A rate of zero IS a rate — it must land in the bottom class, not in -1.
  assert.equal(prismRatioBin(0, IRVE), 0);
  assert.equal(prismRatioColor(0, IRVE), IRVE.ratioColors[0]);
});

test('class labels read as a ladder in French', () => {
  assert.equal(flat(prismRatioClassLabel(0, IRVE)), '≤ 50');
  assert.equal(flat(prismRatioClassLabel(1, IRVE)), '50 – 120');
  assert.equal(flat(prismRatioClassLabel(5, IRVE)), '> 3 000');

  const custom = createPrismScale({
    ...specOf(IRVE),
    ratioClassLabels: ['a', 'b', 'c', 'd', 'e', 'f'],
  });
  assert.equal(prismRatioClassLabel(2, custom), 'c');
});

// ---------------------------------------------------------------------------
// 7 · The tally
// ---------------------------------------------------------------------------

test('prismTally counts each fact once', () => {
  const tally = prismTally([
    { code: '01', value: 5_000, ratio: 200 },
    { code: '02', value: 0, ratio: 5 },
    { code: '03', value: null, ratio: 5 },
    { code: '04', value: 900, ratio: null },
    { code: '05', value: 90_000, ratio: 9_000 },
    null,
  ], IRVE);
  assert.equal(tally.drawn, 4);
  assert.equal(tally.noValue, 2, 'the null row and the null-value row');
  assert.equal(tally.noRatio, 2, 'the null-ratio row and the null row');
  assert.equal(tally.zero, 1);
  assert.equal(tally.clipped, 1);
  assert.equal(tally.ratioCounts.reduce((a, b) => a + b, 0), 4);
});

// ---------------------------------------------------------------------------
// 8 · D1 — the legend
// ---------------------------------------------------------------------------

const SAMPLE = [
  { code: '75', value: 10_539, ratio: 101_785 },
  { code: '69', value: 6_000, ratio: 1_200 },
  { code: '33', value: 3_000, ratio: 290 },
  { code: '48', value: 227, ratio: 44 },
  { code: '2A', value: 400, ratio: null },
  { code: '2B', value: null, ratio: 60 },
  { code: '90', value: 0, ratio: 0 },
];

test('every legend entry matches the shape manager.js renders', () => {
  const legend = prismLegend(IRVE, prismTally(SAMPLE, IRVE));
  assert.ok(legend.length >= 8);
  for (const entry of legend) {
    assert.equal(typeof entry.label, 'string');
    assert.ok(entry.label.length > 0);
    assert.ok(entry.color === null || typeof entry.color === 'string',
      'color is a CSS string, or null for a row that is not a colour key');
    if ('count' in entry && entry.count !== undefined) {
      assert.ok(Number.isFinite(entry.count));
    }
    if (entry.glyph) assert.match(entry.glyph, /^data:image\/svg\+xml;base64,/u);
    if (entry.blurb) assert.equal(typeof entry.blurb, 'string');
  }
});

test('the legend leads with the height, and the height ticks carry bars not counts', () => {
  const legend = prismLegend(IRVE, prismTally(SAMPLE, IRVE));
  assert.match(legend[0].label, /^Hauteur —/u);
  const ticks = legend.slice(1, 1 + IRVE.heightTicks.length);
  assert.equal(ticks.length, 3);
  for (const tick of ticks) {
    assert.ok(tick.glyph, 'a height tick must show a bar');
    assert.equal(tick.count, undefined, 'a height tick counts nothing — it IS the ruler');
  }
  // Rounded bounds, descending, inside the domain — the corpus's own rule.
  assert.deepEqual([...IRVE.heightTicks], [10_000, 5_000, 1_000]);
  assert.ok(IRVE.heightTicks.every((v) => v <= IRVE.domainMax));
  assert.equal(flat(ticks[0].label), '10 000 points de charge');
  assert.equal(flat(ticks[0].blurb), '114 km de haut.');
});

test('the bar glyphs are ordered the way the ticks are', () => {
  const heightOf = (uri) => {
    const svg = Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
    return Number(/height="([\d.]+)"/u.exec(svg)[1]);
  };
  const bars = IRVE.heightTicks.map((tick) => heightOf(
    prismHeightGlyph(prismHeightM(tick, IRVE) / IRVE.maxHeightM),
  ));
  assert.ok(bars[0] > bars[1] && bars[1] > bars[2]);
  // A very short tick is still a bar, never an empty swatch that would read as
  // "no entry" rather than "a little".
  assert.ok(heightOf(prismHeightGlyph(0)) >= 1);
  assert.equal(heightOf(prismHeightGlyph(1)), 14);
  assert.equal(prismHeightGlyph(5), prismHeightGlyph(1), 'clamped, not extrapolated');
  assert.equal(prismHeightGlyph(NaN), prismHeightGlyph(0));
});

test('the legend names the colour half, and only classes that are drawn', () => {
  const legend = prismLegend(IRVE, prismTally(SAMPLE, IRVE));
  const titleIndex = legend.findIndex((entry) => /^Couleur —/u.test(entry.label));
  assert.ok(titleIndex > 0, 'the colour half must be titled');
  const classes = legend.slice(titleIndex + 1).filter((entry) => IRVE.ratioColors.includes(entry.color));
  assert.ok(classes.length > 0);
  assert.ok(classes.every((entry) => entry.count > 0),
    'a class nobody is in must not be offered as a key');
  assert.ok(classes.length < IRVE.ratioColors.length,
    'this sample does not fill every class, so the legend must be shorter than the ramp');
});

test('with no tally the legend is the full published ramp, uncounted', () => {
  // The state a layer is in before its first payload: the scale is frozen and
  // publishable, so the legend can be shown without any data behind it.
  const legend = prismLegend(IRVE);
  const classes = legend.filter((entry) => IRVE.ratioColors.includes(entry.color));
  assert.equal(classes.length, IRVE.ratioColors.length);
  assert.ok(classes.every((entry) => entry.count === undefined));
});

test('the legend publishes both absences, with a motif rather than a tint (D3)', () => {
  const legend = prismLegend(IRVE, prismTally(SAMPLE, IRVE));
  const noValue = legend.find((entry) => /points de charge — non publié/u.test(entry.label));
  const noRatio = legend.find((entry) => /pour 1 000 km² — non publié/u.test(flat(entry.label)));
  assert.equal(noValue.count, 1);
  assert.equal(noRatio.count, 1);
  // Two INDEPENDENT absences, so two DIFFERENT motifs — and each one is the
  // motif the map actually draws for it: a grid where no count was published,
  // stripes on the body of a prism whose rate is refused. The key used to show
  // the same diagonal hatch for both, so a reader who saw a grid on screen
  // could not tell which of the two absences they were looking at.
  assert.equal(noValue.glyph, PRISM_NO_VALUE_GLYPH);
  assert.equal(noRatio.glyph, PRISM_NO_RATIO_BODY_GLYPH);
  assert.notEqual(noValue.glyph, noRatio.glyph, 'two refusals, two signs');
  for (const entry of [noValue, noRatio]) {
    assert.match(entry.glyph, /^data:image\/svg\+xml;base64,/u, 'a motif, not a tint');
  }
  assert.equal(noRatio.color, PRISM_NO_RATIO_COLOR);
  assert.ok(!IRVE.ratioColors.includes(noRatio.color),
    'the missing class must not borrow a colour from the ramp');
  const zero = legend.find((entry) => /mesuré à zéro/u.test(entry.label));
  assert.equal(zero.count, 1);
});

test('the legend states the base-area caveat and the scale mode, in French', () => {
  const linear = prismLegend(IRVE)[0].blurb;
  assert.match(linear, /Échelle linéaire/u);
  assert.match(linear, /aire n'est pas neutralisée/u);
  assert.match(flat(linear), /10 539 points de charge/u);
  assert.match(linear, /120 km/u);

  const sqrt = prismLegend(SUP)[0].blurb;
  assert.match(sqrt, /racine carrée/u);
  assert.match(sqrt, /quatre fois plus/u);
  assert.ok(!/Échelle linéaire/u.test(sqrt),
    'a compressed ruler must not be described as a linear one');
});

// ---------------------------------------------------------------------------
// 9 · The constants the four layers inherit
// ---------------------------------------------------------------------------

test('the shared constants say what the header says', () => {
  assert.equal(PRISM_MAX_HEIGHT_M, 120_000);
  assert.equal(PRISM_MIN_HEIGHT_M, 4_000);
  assert.ok(PRISM_MIN_HEIGHT_M < PRISM_MAX_HEIGHT_M);
  // The base is the ellipsoid, shared by all 96, so the tops are comparable.
  // Clamping it to terrain would start an Alpine prism 2 km higher at equal
  // count — see rendering note ① in the module header.
  assert.equal(PRISM_BASE_HEIGHT_M, 0);
  assert.deepEqual([...PRISM_MODES], ['linear', 'sqrt']);
  assert.ok(Object.isFrozen(PRISM_MODES));
});

test('alpha is a constant here, not a ladder — it stopped encoding anything', () => {
  // choroplethAlpha.js runs a DESCENDING six-step ladder because a flat fill is
  // composited over unknown imagery. A prism body is composited over the sky
  // and over other prisms, so that correction has no object and alpha carries
  // nothing (A3). A future edit that turns either of these into an array is
  // putting a second, mismatched ordering on a channel that now has none.
  assert.equal(typeof PRISM_BODY_ALPHA, 'number');
  assert.equal(typeof PRISM_TOP_ALPHA, 'number');
  assert.ok(PRISM_TOP_ALPHA > PRISM_BODY_ALPHA,
    'the top edge is the reading instrument, so it is the more opaque of the two');
  assert.ok(PRISM_BODY_ALPHA > 0.4 && PRISM_TOP_ALPHA <= 1);
});

// ---------------------------------------------------------------------------

/** Rebuild the literal spec of a frozen scale, so variants can be derived. */
function specOf(scale) {
  return {
    id: scale.id,
    domainMax: scale.domainMax,
    domainMin: scale.domainMin,
    mode: scale.mode,
    maxHeightM: scale.maxHeightM,
    minHeightM: scale.minHeightM,
    heightLabel: scale.heightLabel,
    heightUnit: scale.heightUnit,
    ratioLabel: scale.ratioLabel,
    ratioBreaks: [...scale.ratioBreaks],
    ratioColors: [...scale.ratioColors],
  };
}
