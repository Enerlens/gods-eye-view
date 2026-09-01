// src/data/sparkline.test.mjs
// The one decision this module makes: a gap is not a zero.
//
// It was extracted from rteGenerationFeed.js so the generation layer and the
// hydrometry layer could not drift apart on that point — a reader who learns
// "· means nobody reported" on one card and sees a bottom bar on the other has
// been told two different things by the same console.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketSeries, textSparkline } from './sparkline.js';
import { generationSparkline } from './rteGenerationFeed.js';

test('an unmeasured sample is a dot, never the lowest bar', () => {
  // `▁` means "measured, and low". A feed that skipped a quarter of an hour has
  // measured nothing, and drawing that at the bottom of the scale invents a
  // reading — which for a river gauge is the normal case, not the exception:
  // about 40% of nominally-active French gauges are silent at any moment.
  assert.equal(textSparkline([10, null, 10], 10), '█·█');
  assert.equal(textSparkline([10, undefined, 10], 10), '█·█');
  assert.equal(textSparkline([10, NaN, 10], 10), '█·█');
  assert.equal(textSparkline(['nope', 10], 10), '·█');
  // …and a series of nothing but gaps is all gaps, not a flat floor.
  assert.equal(textSparkline([null, null], 10), '··');
});

test('the scale is zero-based, so a flat series reads flat', () => {
  // A river holding 615–620 m³/s for a day IS flat. A min-to-max scale would
  // turn 5 m³/s of noise into a dramatic hydrograph, which is why the caller
  // prints the window's real range beside the glyphs instead.
  const flat = textSparkline([615, 617, 616, 620, 618]);
  assert.equal(new Set(flat).size, 1, `expected one glyph, got ${flat}`);
  // A genuine doubling must still be visible.
  const doubling = textSparkline([100, 200]);
  assert.ok(doubling[0] !== doubling[1], doubling);
});

test('a reference caps the scale so two series are comparable bar for bar', () => {
  // 0.5 × 7 steps rounds UP to the 5th of eight glyphs — the ladder is rounded,
  // not floored, so a value just over half never reads as under half.
  assert.equal(textSparkline([50], 100), '▅');
  assert.equal(textSparkline([100], 100), '█');
  // Above the reference the bar saturates rather than overflowing the glyph set.
  assert.equal(textSparkline([400], 100), '█');
  // A zero or negative reference falls back to the window max.
  assert.equal(textSparkline([7], 0), '█');
  assert.equal(textSparkline([7], -3), '█');
});

test('zero draws, negative draws differently, and neither is a gap', () => {
  // Discharge goes negative on a tidal reach and a pumped-storage group
  // consuming power is negative by design. Clamping either to zero erases the
  // fact worth seeing.
  assert.equal(textSparkline([0, 10], 10), '▁█');
  assert.equal(textSparkline([-5, 10], 10), '▽█');
  // An all-zero series is a floor, not a divide-by-zero.
  assert.equal(textSparkline([0, 0, 0]), '▁▁▁');
});

test('an empty series draws nothing at all', () => {
  for (const bad of [[], null, undefined, 'series', 42]) {
    assert.equal(textSparkline(bad), '', JSON.stringify(bad));
  }
});

test('bucketing averages rather than decimating, so a peak survives', () => {
  // A flood peak that falls in the discarded 95% of a decimated series is
  // exactly the sample a reader opened the card for.
  const flat = new Array(100).fill(10);
  flat[57] = 1000;
  const decimated = bucketSeries(flat, 10);
  assert.equal(decimated.length, 10);
  assert.ok(Math.max(...decimated) > 10, 'the spike must move its bucket');
  // Everything else stays where it was.
  assert.equal(decimated.filter((v) => v === 10).length, 9);
});

test('a bucket holding only gaps stays a gap', () => {
  // Averaging over nothing must not become a number.
  const series = [1, 1, null, null, 1, 1];
  const bucketed = bucketSeries(series, 3);
  assert.deepEqual(bucketed, [1, null, 1]);
});

test('a series shorter than the target is passed through, gaps normalised', () => {
  assert.deepEqual(bucketSeries([1, 2, 3], 10), [1, 2, 3]);
  assert.deepEqual(bucketSeries([1, undefined, 3], 10), [1, null, 3]);
  assert.deepEqual(bucketSeries([], 10), []);
  assert.deepEqual(bucketSeries(null, 10), []);
  // A nonsense width still yields something drawable rather than throwing.
  assert.equal(bucketSeries([1, 2, 3, 4], 0).length, 1);
});

test('the generation wrapper still draws what it always drew', () => {
  // `generationSparkline` kept its name because "reference" there means the
  // group's nameplate specifically. It must remain a pure delegation.
  assert.equal(generationSparkline([450, 900], 900), textSparkline([450, 900], 900));
  assert.equal(generationSparkline([10, null], null), '█·');
  assert.equal(generationSparkline([], 900), '');
});
