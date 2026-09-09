/*
 * SIZE-LEGEND GLYPHS — the shapes a size channel needs in a legend.
 *
 * D1 makes a legend mandatory wherever a mark carries a value, and a size with
 * no printed scale is exactly the case D1 is about. Two packs now spend the
 * size channel on a measurement — `damsPack.js` on a mapped span, and
 * `airportsPack.js` on a published runway length — and both need the same two
 * swatches: a DISC drawn at the class's real screen diameter, and the HOLLOW
 * RING that A1 reserves for "this was never measured". A mark that is drawn in
 * GROUND units rather than screen ones needs a third and a fourth — a BAR for
 * a runway, a FOOTPRINT for an aerodrome outline — and they belong here for the
 * same reason: they are rendered into the same panel, one under the other.
 *
 * They live here rather than in either pack because the two legends are
 * rendered into the SAME panel, one under the other. Two private copies would
 * drift the day one of them changed a radius, and the reader would be told
 * that two identical situations are different.
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
 * A horizontal bar of the given screen length, drawn 1:1 in the swatch box.
 *
 * The third shape, and the one the airports pack needs: its measured mark is
 * not a disc but a LINE — a runway, at its own bearing and its own length. The
 * swatch is drawn flat because the legend cannot show a bearing that is
 * different for every feature; what it shows is the length floor, which is the
 * part a reader has to be told about.
 *
 * @param {number} pixelLength Screen length of the mark this row describes.
 * @param {number} [pixelWidth] Stroke width of the mark, in the same pixels.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function sizeBarGlyph(pixelLength, pixelWidth = 2) {
  const key = `bar:${pixelLength}:${pixelWidth}`;
  const cached = _glyphCache.get(key);
  if (cached) return cached;
  const half = Math.max(1, Math.min(GLYPH_BOX / 2, (Number(pixelLength) || 2) / 2));
  const stroke = Math.max(1, Math.min(6, Number(pixelWidth) || 2));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}">`
    + `<line x1="${(9 - half).toFixed(2)}" y1="9" x2="${(9 + half).toFixed(2)}" y2="9"`
    + ` stroke="#000" stroke-width="${stroke.toFixed(2)}" stroke-linecap="butt"/></svg>`;
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set(key, uri);
  return uri;
}

/**
 * The outline of a surveyed ground footprint, drawn to scale on the globe.
 *
 * The fourth shape, and it cannot be sized 1:1 like the disc and the bar: a
 * footprint has no single screen dimension — it shrinks with the camera like
 * the ground it covers, because it IS ground. So the swatch shows the only
 * thing that is constant about it — a filled outline, the same stroke and the
 * same wash the polygon carries on the map — and the row's blurb carries the
 * scale in words.
 *
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function sizeFootprintGlyph() {
  const cached = _glyphCache.get('footprint');
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_BOX} ${GLYPH_BOX}">`
    + '<path d="M2.5 12.5 L5 4 L14.5 3 L16 10.5 L9 15.5 Z" fill="#000" fill-opacity="0.28"'
    + ' stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set('footprint', uri);
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
