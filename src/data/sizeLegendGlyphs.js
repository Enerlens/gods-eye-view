/*
 * SIZE-LEGEND GLYPHS — the shapes a size channel needs in a legend.
 *
 * D1 makes a legend mandatory wherever a mark carries a value, and a size with
 * no printed scale is exactly the case D1 is about. Two swatches answer it: a
 * DISC drawn at the class's real screen diameter, and the HOLLOW RING that A1
 * reserves for "this was never measured".
 *
 * They live here rather than in a pack because any second size legend is
 * rendered into the SAME panel, one under the other. Two private copies would
 * drift the day one of them changed a radius, and the reader would be told
 * that two identical situations are different. A BAR and a FOOTPRINT swatch
 * lived here too, for the airports pack's drawn runway and IGN outline; they
 * went out with those rows.
 *
 * THE DISC CURRENTLY HAS NO CALLER, and is kept on purpose. `damsPack.js` was
 * its only one and stopped printing its four metre bands: the dam card already
 * prints `1 247 m de long` beside the mark, so a bracket in the key was a
 * coarser second copy of a number the map gives exactly. The disc is the
 * general answer for a size ladder whose value ISN'T printed beside the mark,
 * which is the ordinary case — deleting it would only mean the next pack
 * writes it again, slightly differently.
 *
 * The panel MASKS these glyphs and paints the row's own colour through them,
 * so only the SHAPE survives. That is deliberate: these rows encode size, and
 * a hue that moved with them would be a second, false encoding (A3).
 */

const _b64 = (value) => (typeof btoa === 'function'
  ? btoa(value)
  : Buffer.from(value, 'utf8').toString('base64'));

/** Swatch box side, in the SVG's own user units. The panel scales it. */
export const GLYPH_BOX = 18;

/** @type {Map<string,string>} shape key → data URI, built at most once each. */
const _glyphCache = new Map();

/**
 * A filled disc of the given screen diameter, drawn 1:1 in the swatch box.
 *
 * 1:1 is the contract: the legend swatch is the same number of pixels across
 * as the mark on the globe, so a reader can hold the swatch against the map
 * instead of trusting a caption. Radii are clamped to the box, which is why no
 * class may exceed {@link GLYPH_BOX} pixels.
 *
 * @param {number} pixelSize Screen diameter of the mark this row describes.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function sizeDiscGlyph(pixelSize) {
  const key = `disc:${pixelSize}`;
  const cached = _glyphCache.get(key);
  if (cached) return cached;
  const radius = Math.max(1, Math.min(GLYPH_BOX / 2, Number(pixelSize) / 2 || 1));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}">`
    + `<circle cx="9" cy="9" r="${radius.toFixed(2)}" fill="#000"/></svg>`;
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set(key, uri);
  return uri;
}

/**
 * The hollow ring an unmeasured class draws.
 *
 * Never a small disc: a small disc is a value, and "not measured" is not a
 * small value. The ring must not be reachable by any diameter a measured class
 * can take, which is why it is drawn as an outline rather than sized.
 *
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function sizeRingGlyph() {
  const cached = _glyphCache.get('ring');
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}">`
    + '<circle cx="9" cy="9" r="3.4" fill="none" stroke="#000" stroke-width="1.6"/></svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set('ring', uri);
  return uri;
}
