/**
 * @module sharedMobilityIcons
 *
 * WHAT a shared vehicle is, drawn as a silhouette — the shape half of the
 * shared-mobility read (`mobilityOperators.js` owns the colour half).
 *
 * A GBFS feed states the physical object in `vehicle_types.json`
 * (`form_factor` + `propulsion_type`), and `gbfsFeeds.vehicleKindFromType()`
 * folds that pair to one of six kinds. Those six are genuinely different
 * objects — a docked mechanical bike and a free-floating moped are not the
 * same thing to anyone deciding what to walk to — and a dot cannot say which
 * one it is. Each kind therefore gets a DISTINCT PLANFORM, the same discipline
 * `aircraftIcons.js` applies to aircraft classes: they read apart by shape at
 * ~16 px, not by size or hue.
 *
 * TINT-SAFE BY CONSTRUCTION. Every glyph is white line-art over a dark halo,
 * and nothing carries a hue of its own. Cesium multiplies `billboard.color`
 * into the texture, so white takes the operator's colour exactly while the
 * black halo (0 × c = 0) survives multiplication and keeps the glyph readable
 * over pale terrain. A glyph with a baked-in colour would fight the tint and
 * destroy the operator channel.
 *
 * ONE GEOMETRY, TWO PASSES. Each body is pure geometry with no paint
 * attributes, rendered first as a fat dark stroke and then as the white glyph.
 * That is why the halo can never drift out of register with the shape.
 */

/** Glyph coordinate space; every body is drawn to this 96×96 box. */
const VIEW = 96;

/**
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is GPU-minified into mush. The layer
 * draws these at 16 CSS px (~32 device px on Retina, up to ~1.2× closer in),
 * so 64 covers the band at ≤1.6× minification — the same reasoning
 * `aircraftIcons.js` records for the fleet raster.
 */
const GLYPH_RASTER_PX = 64;

/** Halo pass: wide, dark, drawn under everything. */
const HALO_STROKE_PX = 13;
/** Glyph pass: the visible white line weight. */
const LINE_STROKE_PX = 6.5;

/**
 * Bodies, as pure geometry. `strokes` are drawn as line-art in both passes;
 * `fills` are solid in the glyph pass and merely fattened in the halo pass.
 *
 * All are drawn facing RIGHT, in side view, sharing one ground line (y≈64-72)
 * so a mixed street reads as one family rather than as unrelated icons.
 */
const BODIES = Object.freeze({
  // ── Mechanical bicycle: two large open wheels either side of a diamond
  //    frame. The open rings are the anti-everything-else cue — no other kind
  //    shows two big holes.
  bike: {
    strokes: `
      <circle cx="26" cy="66" r="16"/>
      <circle cx="72" cy="66" r="16"/>
      <path d="M26,66 L47,66 L38,40 L64,40 L47,66 M64,40 L72,66 M26,66 L38,40"/>
      <path d="M58,34 L72,38"/>`,
    fills: '',
  },

  // ── E-bike: the same bicycle, badged with a bolt struck ABOVE the frame.
  //    Tried inside the frame first and it failed the 16 px read — the bolt
  //    landed on the same pixels as the tubes and the two bike kinds became
  //    one glyph. Ink where no other kind has ink survives minification.
  ebike: {
    strokes: `
      <circle cx="26" cy="66" r="16"/>
      <circle cx="72" cy="66" r="16"/>
      <path d="M26,66 L47,66 L38,40 L64,40 L47,66 M64,40 L72,66 M26,66 L38,40"/>
      <path d="M58,34 L72,38"/>`,
    fills: `
      <path d="M33,8 L14,31 L24,31 L18,44 L37,22 L27,22 Z"/>`,
  },

  // ── Kick scooter (trottinette): two SMALL wheels, a bare deck and one long
  //    raked stem. Almost all of the ink is the diagonal — nothing else in the
  //    set has that.
  scooter: {
    strokes: `
      <circle cx="22" cy="72" r="11"/>
      <circle cx="74" cy="72" r="11"/>
      <path d="M22,72 L58,72 L70,26"/>
      <path d="M61,22 L81,30"/>`,
    fills: '',
  },

  // ── Moped / seated scooter: big wheels like a bike, but the frame is a
  //    SOLID mass — seat hump at the back, a tall leg shield at the front.
  //    An open frame with a saddle drawn on it read as a bicycle at 16 px;
  //    filled versus open is the distinction that actually survives.
  moped: {
    strokes: `
      <circle cx="26" cy="66" r="13"/>
      <circle cx="74" cy="66" r="13"/>
      <path d="M56,15 L82,20"/>`,
    fills: `
      <path d="M16,58 L16,40 L25,32 L53,32 L59,47 L64,47 L62,20 L76,20 L81,47 L81,58 Z"/>`,
  },

  // ── Car: a filled three-box profile far wider than it is tall, on two
  //    wheels. The only kind whose ink is mostly horizontal.
  car: {
    strokes: `
      <circle cx="30" cy="66" r="10"/>
      <circle cx="70" cy="66" r="10"/>`,
    fills: `
      <path d="M10,64 L12,48 L34,46 L44,30 L68,30 L79,46 L90,50 L90,64 Z"/>`,
  },

  // ── Unknown form factor: a plain disc. The feed did not say what this is,
  //    and inventing a silhouette would state something it never published —
  //    the same rule `transitFrance.js` follows for a vehicle with no bearing.
  other: {
    strokes: '',
    fills: '<circle cx="48" cy="48" r="18"/>',
  },

  // ── Dock / station: a rack, not a vehicle. A ground rail with three posts
  //    reads as a PLACE, which is what it is: the thing that stays put while
  //    its contents come and go.
  station: {
    strokes: `
      <path d="M14,70 L82,70"/>
      <path d="M28,70 L28,36 M48,70 L48,36 M68,70 L68,36"/>`,
    fills: '',
  },
});

/** @type {Map<string, string>} kind@px → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/** Every kind this module can draw, in legend order. */
export const SHARED_MOBILITY_GLYPH_KINDS = Object.freeze(Object.keys(BODIES));

/**
 * Fold an arbitrary kind string onto a drawable glyph.
 * An unmapped kind falls to `other` — a disc — rather than borrowing another
 * kind's silhouette and asserting something the feed never said.
 * @param {string} kind Kind from `gbfsFeeds.vehicleKindFromType()`.
 * @returns {string} A key of {@link SHARED_MOBILITY_GLYPH_KINDS}.
 */
export function sharedMobilityGlyphKind(kind) {
  return Object.hasOwn(BODIES, String(kind)) ? String(kind) : 'other';
}

/**
 * Data URI for a kind's silhouette, lazily built and cached per kind+size.
 *
 * @param {string} kind Vehicle kind, or `station`.
 * @param {number} [px=GLYPH_RASTER_PX] Raster size.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function sharedMobilityGlyph(kind, px = GLYPH_RASTER_PX) {
  const key = sharedMobilityGlyphKind(kind);
  const cacheKey = `${key}@${px}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const body = BODIES[key];
  const geometry = `${body.strokes}${body.fills}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${VIEW} ${VIEW}">`
    // Halo first: the same geometry, fattened and dark. Multiplying a tint
    // into black leaves black, so this survives `billboard.color`.
    + `<g fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="${HALO_STROKE_PX}"`
    + ` stroke-linecap="round" stroke-linejoin="round">${geometry}</g>`
    + `<g fill="none" stroke="#ffffff" stroke-width="${LINE_STROKE_PX}"`
    + ` stroke-linecap="round" stroke-linejoin="round">${body.strokes}</g>`
    + `<g fill="#ffffff" stroke="none">${body.fills}</g>`
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/** Raw geometry, for tests that assert the glyphs actually differ. */
export function _sharedMobilityGlyphBodyForTest(kind) {
  return BODIES[sharedMobilityGlyphKind(kind)];
}
