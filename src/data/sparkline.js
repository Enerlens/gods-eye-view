/**
 * @module sparkline
 *
 * A time series, drawn in text, for a card that has one line to spare.
 *
 * Extracted from `rteGenerationFeed.js`, which wrote it for production groups,
 * when the Hub'Eau layer needed the same picture for a river. Extracted rather
 * than copied: the two layers must agree on what a gap looks like, because a
 * reader who learns "·  means nobody reported" on one card and sees a zero bar
 * on the other has been told two different things by the same console.
 *
 * THE ONE DECISION IN HERE: a missing sample is `·`, never `▁`.
 *
 * `▁` is the lowest bar and it means "measured, and low". A feed that skipped a
 * quarter of an hour has not measured a low value — it has measured nothing —
 * and rendering that as the bottom of the scale invents a reading. This matters
 * more for hydrometry than for generation: about 40 % of nominally-active
 * French gauges are silent at any given moment, so gaps are the normal case
 * rather than the exception.
 *
 * A NEGATIVE value renders `▽`. Discharge can genuinely go negative on a tidal
 * reach, and a pumped-storage group consuming power is negative by design;
 * clamping either to zero would erase the fact worth seeing.
 */

/** The eight bar glyphs, lowest first. */
const BARS = '▁▂▃▄▅▆▇█';

/**
 * Draw a series as bar glyphs.
 *
 * The scale runs from ZERO to `reference` (or to the largest absolute value in
 * the window when no reference is given). Zero-based on purpose: a river
 * holding 615–620 m³/s for a day should render as a flat line, because it IS
 * flat, and a min-to-max scale would turn 5 m³/s of noise into a dramatic
 * hydrograph. The caller is expected to print the window's actual range beside
 * the glyphs, so the amplitude the flat line hides is still stated.
 *
 * @param {Array<number|null|undefined>} history Ordered oldest → newest.
 * @param {number|null} [reference] Top of the scale; omit to use the window max.
 * @returns {string} One glyph per sample, or '' when there is nothing to draw.
 */
export function textSparkline(history, reference = null) {
  if (!Array.isArray(history) || !history.length) return '';
  const top = Number.isFinite(reference) && reference > 0
    ? reference
    : Math.max(...history.map((value) => (Number.isFinite(value) ? Math.abs(value) : 0)), 0);
  // Everything is zero (or unmeasured): a flat floor is the honest picture, and
  // dividing by the max would be dividing by zero.
  if (!top) return history.map((value) => (Number.isFinite(value) ? '▁' : '·')).join('');
  let out = '';
  for (const value of history) {
    if (!Number.isFinite(value)) { out += '·'; continue; }
    if (value < 0) { out += '▽'; continue; }
    if (value === 0) { out += '▁'; continue; }
    const ratio = Math.min(1, value / top);
    out += BARS[Math.min(BARS.length - 1, Math.max(1, Math.round(ratio * (BARS.length - 1))))];
  }
  return out;
}

/**
 * Reduce a series to at most `width` samples by averaging each bucket.
 *
 * A 24-hour Hub'Eau window is 144 samples at the 10-minute cadence and 288 at
 * the 5-minute one, and no card is 288 characters wide. Averaging rather than
 * decimating, so a spike between two kept samples is not silently dropped — a
 * flood peak that falls in the discarded 95 % of a decimated series is exactly
 * the sample a reader opened the card for.
 *
 * A bucket holding ONLY gaps stays a gap: averaging over nothing must not
 * become a number.
 *
 * @param {Array<number|null|undefined>} history Ordered oldest → newest.
 * @param {number} width Target sample count.
 * @returns {Array<number|null>}
 */
export function bucketSeries(history, width) {
  const source = Array.isArray(history) ? history : [];
  const cap = Math.max(1, Math.floor(Number(width) || 0));
  if (source.length <= cap) return source.map((v) => (Number.isFinite(v) ? v : null));
  const out = [];
  for (let i = 0; i < cap; i += 1) {
    const from = Math.floor((i * source.length) / cap);
    const to = Math.max(from + 1, Math.floor(((i + 1) * source.length) / cap));
    let sum = 0;
    let seen = 0;
    for (let j = from; j < to && j < source.length; j += 1) {
      const value = source[j];
      if (Number.isFinite(value)) { sum += value; seen += 1; }
    }
    out.push(seen ? sum / seen : null);
  }
  return out;
}
