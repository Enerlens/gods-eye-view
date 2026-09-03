// src/data/choroplethAlpha.js
/**
 * The fill-alpha ladder shared by the French count choropleths
 * (`irve-fr`, `sup-fr`, `amenities-fr`, `schools-fr`).
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 *
 * All four ramps ran dark → light and carried an ASCENDING alpha ladder,
 * `[0.34, 0.40, 0.46, 0.53, 0.60, 0.68]`, each module explaining it as "density
 * reads as weight as well as hue". That reasoning holds over a CONSTANT
 * backdrop. These layers do not have one: they sit on live imagery whose
 * lightness ranges from near-black water to a near-white winter city.
 *
 * Over a light urban basemap the ladder inverted the reading. Composited on
 * `#c8c4bb`, `irve-fr` produced CIE L* values of
 *
 *     67.4 · 65.9 · 65.3 · 65.8 · 69.6 · 78.0
 *
 * — a U, not a ramp: class 1 read LIGHTER than classes 2, 3 and 4. The cause
 * is arithmetic, not palette. The darkest swatch was the most transparent, so
 * on a light background it was the one the ground washed out most, while the
 * lightest swatch was the most opaque and stayed light. `sup-fr` and
 * `amenities-fr` failed the same way (CARTOGRAPHIE B3: six declared classes
 * must be six PERCEIVED classes).
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 *
 * The ladder DESCENDS. Alpha is highest where the fill is darkest, because
 * that is the end an unknown background can wash out; the pale end is already
 * lighter than most imagery and needs less help to stay light.
 *
 * Alpha stops being a second encoding of the value and becomes what it has to
 * be: the control that keeps the ramp's OWN lightness ordering intact against
 * a backdrop the layer does not choose. Hue and lightness still carry the
 * datum, monotonically, which is the whole point of an ordered ramp.
 *
 * ── How these numbers were chosen ───────────────────────────────────────────
 *
 * Searched against all four palettes over eight backgrounds — light urban,
 * water, forest, mid ortho, near-white, near-black, pale blue, pale sand — for
 * the ladder maximising the SMALLEST L* gap between adjacent classes, capped at
 * 0.80 so the imagery still reads through. Result: every class is at least
 * 5.7 L* apart from its neighbours on every background tested, against a
 * previous worst case of −0.6 (an inversion). `choroplethAlpha.test.mjs`
 * recomputes the whole compositing chain and fails if any pair inverts, so a
 * future palette edit cannot silently reintroduce the U.
 */

/**
 * Fill alpha per bin, darkest class first. Descending on purpose — see the
 * module header before "fixing" it back to ascending.
 */
export const CHOROPLETH_FILL_ALPHA = Object.freeze([0.79, 0.72, 0.66, 0.60, 0.57, 0.55]);

/**
 * Alpha for a bin index, clamped to the ladder.
 * @param {number} index Zero-based bin index.
 * @returns {number} Fill alpha.
 */
export function choroplethFillAlpha(index) {
  const i = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return CHOROPLETH_FILL_ALPHA[Math.min(i, CHOROPLETH_FILL_ALPHA.length - 1)];
}
