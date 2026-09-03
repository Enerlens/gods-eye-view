// src/data/contactFreshness.js
/**
 * How a moving contact says it is coasting on dead reckoning rather than
 * reporting — and why that is not an alpha.
 *
 * ── The channel conflict ────────────────────────────────────────────────────
 *
 * The aircraft layers composed THREE independent facts into a single alpha:
 *
 *   • freshness — `baseAlpha: _missingPolls.get(icao24) ? 0.45 : 1`
 *   • distance to the limb — `aircraftRecession`'s `alphaFloor` (0.35)
 *   • focus de-emphasis — the tracked-contact `dimFloor` (0.25)
 *
 * Multiplied together, they are not recoverable. A faint sprite could be a
 * contact whose position is minutes old, or one near the horizon, or one the
 * camera is not following — three different statements sharing one variable
 * (CARTOGRAPHIE A3: one visual variable, one fact).
 *
 * Alpha keeps DEPTH, which is what a reader already reads it as on a globe.
 * Freshness moves to the sprite's own colour.
 *
 * ── Why a desaturating mix, not a fade ──────────────────────────────────────
 *
 * "Desaturate toward grey" is the textbook answer and it does nothing to the
 * civil fleet, which is already pure white — zero saturation. The operation
 * that works for BOTH tints is a mix toward a neutral mid-grey: it removes the
 * amber from a military contact AND takes the white fleet down off maximum
 * value, in one step, without touching alpha.
 *
 * The result stays fully opaque, so a coasting contact is exactly as VISIBLE
 * as a reporting one — it has not gone anywhere, and hiding it would be its own
 * false statement. It is only less vivid.
 */
import * as Cesium from 'cesium';

/**
 * The neutral both tints are pulled toward. Cool rather than warm so a washed
 * military amber cannot be mistaken for a dimmer amber.
 */
const COASTING_NEUTRAL = Cesium.Color.fromCssColorString('#6d7680');

/**
 * How far toward the neutral a coasting contact is pulled. 0.55 was chosen to
 * clear a just-noticeable difference against both base tints while leaving the
 * silhouette legible at fleet size.
 */
const COASTING_MIX = 0.55;

/** Cache: base colour CSS → coasting colour. Both tints are module constants. */
const _cache = new Map();

/**
 * The colour a contact wears while its position is dead-reckoned.
 *
 * Pure function of the base tint, so the two flight layers and any future
 * moving layer produce the same washed colour from the same input.
 * @param {Cesium.Color} baseColor The contact's live tint.
 * @returns {Cesium.Color} The coasting tint, at the base colour's own alpha.
 */
export function coastingContactColor(baseColor) {
  if (!baseColor) return COASTING_NEUTRAL;
  const key = baseColor.toCssColorString();
  let color = _cache.get(key);
  if (!color) {
    color = Cesium.Color.lerp(baseColor, COASTING_NEUTRAL, COASTING_MIX, new Cesium.Color());
    color.alpha = baseColor.alpha;
    _cache.set(key, color);
  }
  return color;
}

/**
 * Pick the tint for a contact, given whether it is reporting.
 * @param {Cesium.Color} baseColor Live tint.
 * @param {boolean} coasting True when the position is dead-reckoned.
 * @returns {Cesium.Color} Tint to draw with.
 */
export function contactTint(baseColor, coasting) {
  return coasting ? coastingContactColor(baseColor) : baseColor;
}

/** The coasting tint as CSS, for a legend swatch. */
export function coastingSwatchCss(baseCss) {
  return coastingContactColor(Cesium.Color.fromCssColorString(baseCss)).toCssColorString();
}
