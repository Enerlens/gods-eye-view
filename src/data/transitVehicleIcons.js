/**
 * @module transitVehicleIcons
 *
 * WHAT a live transit vehicle is, drawn with the icon set transit maps already
 * use — Google's **Material Symbols** (Apache-2.0), vendored path by path.
 *
 * WHY NOT DRAWN HERE. An earlier version of this module drew its own plan-view
 * silhouettes: a bus as a capsule with wheel stubs, a tram as an articulated
 * body with a pantograph. They were internally consistent and nobody could
 * tell what they were. Recognition beats invention, and Material Symbols
 * happens to cover the GTFS mode list almost exactly — including `funicular`,
 * which almost no icon set carries. Almost: see the note on `aerial` below for
 * the one mode a UI icon set does not draw well enough at map size.
 *
 * WHAT THAT COSTS, AND WHAT WAS DONE ABOUT IT. These glyphs are FRONT views: a
 * bus seen head-on, a tram with its pantograph above it, a ship on water. A
 * front view cannot be rotated to a compass bearing without becoming nonsense,
 * and 84% of the national fleet publishes a bearing that the layer used to
 * show by rotating a chevron. So the vehicle icon is drawn UPRIGHT and never
 * rotated, and the heading moved to its own glyph — see
 * {@link transitHeadingPointer}, a small wedge that orbits the icon on a
 * second billboard. Nothing was dropped: the icon says what it is, the pointer
 * says where it is going, and a vehicle with no published bearing simply has
 * no pointer.
 *
 * TINT-SAFE BY CONSTRUCTION, like `sharedMobilityIcons.js`. Each path is drawn
 * twice — a wide dark stroke first, the white fill second. Cesium multiplies
 * `billboard.color` into the texture, so white takes the class colour exactly
 * while black survives multiplication (0 × c = 0) and keeps the glyph readable
 * over pale terrain. Nothing carries a hue of its own.
 *
 * ONE CLASS IS NOT GOOGLE'S. `aerial` draws Maki's `aerialway`, vendored in
 * `mapIcons.js`. Material's `cable_car` is an interface glyph — a boxed cabin
 * on stubby legs — and at the 22 CSS px this layer draws at it reads as a
 * building, not as something hanging from a wire. Maki authors for map labels
 * at exactly this size and draws the cable, which is the one feature that
 * separates a téléphérique from a tram. That module records the rest.
 *
 * ATTRIBUTION AND LICENCE. `licenses/material-symbols/` carries the Apache-2.0
 * text and a NOTICE recording exactly which glyphs are used and that only the
 * `d` path string of each is vendored, verbatim. `licenses/maki/` does the same
 * for the one Maki glyph, under CC0 — which imposes no conditions, so that
 * notice is this project's discipline rather than an obligation. The halo/fill
 * treatment is this project's; both sets' geometry is unmodified.
 */
import { mapIconGlyph } from './mapIcons.js';

/**
 * Vendored Material Symbols path data (Rounded, filled, weight 400).
 *
 * Every glyph is authored in Material's own `0 -960 960 960` box, which is why
 * that viewBox is carried through rather than normalised: rewriting the
 * coordinates would be a modification of the artwork for no benefit.
 *
 * @see licenses/material-symbols/NOTICE
 */
const MATERIAL_SYMBOL_PATHS = Object.freeze({
  directions_bus: 'M320-200v20q0 25-17.5 42.5T260-120q-25 0-42.5-17.5T200-180v-62q-18-20-29-44.5T160-340v-380q0-83 77-121.5T480-880q172 0 246 37t74 123v380q0 29-11 53.5T760-242v62q0 25-17.5 42.5T700-120q-25 0-42.5-17.5T640-180v-20H320Zm-80-360h480v-120H240v120Zm100 240q25 0 42.5-17.5T400-380q0-25-17.5-42.5T340-440q-25 0-42.5 17.5T280-380q0 25 17.5 42.5T340-320Zm280 0q25 0 42.5-17.5T680-380q0-25-17.5-42.5T620-440q-25 0-42.5 17.5T560-380q0 25 17.5 42.5T620-320Z',
  airport_shuttle: 'M240-200q-50 0-85-35t-35-85q-33 0-56.5-23.5T40-400v-280q0-33 23.5-56.5T120-760h527q16 0 30.5 6t25.5 17l194 194q11 11 17 25.5t6 30.5v87q0 33-23.5 56.5T840-320q0 50-35 85t-85 35q-50 0-85-35t-35-85H360q0 50-35 85t-85 35Zm360-360h160L640-680h-40v120Zm-240 0h160v-120H360v120Zm-240 0h160v-120H120v120Zm120 290q21 0 35.5-14.5T290-320q0-21-14.5-35.5T240-370q-21 0-35.5 14.5T190-320q0 21 14.5 35.5T240-270Zm480 0q21 0 35.5-14.5T770-320q0-21-14.5-35.5T720-370q-21 0-35.5 14.5T670-320q0 21 14.5 35.5T720-270Z',
  tram: 'M160-260v-380q0-97 85-127t195-33l30-60H310q-13 0-21.5-8.5T280-890q0-13 8.5-21.5T310-920h340q13 0 21.5 8.5T680-890q0 13-8.5 21.5T650-860H550l-30 60q119 3 199.5 32.5T800-640v380q0 59-40.5 99.5T660-120l20 20q17 17 8 38.5T655-40q-7 0-13.5-2.5T630-50l-70-70H400l-70 70q-5 5-11.5 7.5T305-40q-23 0-32.5-21.5T280-100l20-20q-59 0-99.5-40.5T160-260Zm320 20q25 0 42.5-17.5T540-300q0-25-17.5-42.5T480-360q-25 0-42.5 17.5T420-300q0 25 17.5 42.5T480-240ZM240-480h480v-120H240v120Z',
  subway: 'M80-160v-446q0-85 44-147.5T248-848q54-21 115-26.5t117-5.5q56 0 117 5.5T712-848q80 32 124 94.5T880-606v446q0 33-23.5 56.5T800-80H160q-33 0-56.5-23.5T80-160Zm220-280v-160h360v160H300Zm320 140q-17 0-28.5-11.5T580-340q0-17 11.5-28.5T620-380q17 0 28.5 11.5T660-340q0 17-11.5 28.5T620-300Zm-280 0q-17 0-28.5-11.5T300-340q0-17 11.5-28.5T340-380q17 0 28.5 11.5T380-340q0 17-11.5 28.5T340-300Zm84 80h110l51 51q5 5 10.5 7t11.5 2q20 0 27.5-19t-6.5-33l-10-10q44-6 73-39.5t29-78.5v-260q0-78-70-99t-170-21q-91 0-165.5 21T240-600v260q0 45 29 78.5t73 39.5l-11 11q-14 14-6.5 32.5T352-160q6 0 11-2t10-7l51-51Z',
  train: 'M160-340v-380q0-53 27.5-84.5t72.5-48q45-16.5 102.5-22T480-880q66 0 124.5 5.5t102 22q43.5 16.5 68.5 48t25 84.5v380q0 59-40.5 99.5T660-200l20 20q17 17 8 38.5T655-120q-7 0-13.5-2.5T630-130l-70-70H400l-70 70q-5 5-11.5 7.5T305-120q-23 0-32.5-21.5T280-180l20-20q-59 0-99.5-40.5T160-340Zm80-220h200v-120H240v120Zm280 0h200v-120H520v120ZM340-320q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Zm280 0q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Z',
  monorail: 'M280-80q-17 0-28.5-11.5T240-120q0-17 11.5-28.5T280-160h160v-80q0-17 11.5-28.5T480-280q17 0 28.5 11.5T520-240v80h160q17 0 28.5 11.5T720-120q0 17-11.5 28.5T680-80H280Zm40-800h320q66 0 113 47t47 113v380q0 58-41 99t-99 41h-60q-17 0-28.5-11.5T560-240q0-33-23.5-56.5T480-320q-33 0-56.5 23.5T400-240q0 17-11.5 28.5T360-200h-60q-58 0-99-41t-41-99v-380q0-66 47-113t113-47Zm-80 200v120h480v-120H240Z',
  directions_boat: 'M158-200 82-468q-3-12 2.5-28t23.5-22l52-18v-184q0-33 23.5-56.5T240-800h120v-80q0-17 11.5-28.5T400-920h160q17 0 28.5 11.5T600-880v80h120q33 0 56.5 23.5T800-720v184l52 18q21 8 25 23.5t1 26.5l-76 268q-40 0-74-15.5T666-255q-11-11-26-11t-26 11q-28 24-62 39.5T480-200q-10 0-19-1t-18-3q-29-6-55-21t-48-35q-8-8-20.5-8t-20.5 8q-28 27-65 43.5T158-200ZM480-40q-41 0-81.5-10T320-80q-38 20-78 30t-82 10h-40q-17 0-28.5-11.5T80-80q0-17 11.5-28.5T120-120h40q36 0 72-10t67-29q10-6 21-6t21 6q22 14 50.5 23t54.5 12q8 1 17 1.5t17 .5q36 0 72-9t67-28q10-6 21-6t21 6q31 20 67 29.5t72 9.5h40q17 0 28.5 11.5T880-80q0 17-11.5 28.5T840-40h-40q-42 0-82-10t-78-30q-38 20-78.5 30T480-40ZM240-562l215-70q12-4 25-4t25 4l215 70v-158H240v158Z',
  funicular: 'M89-53q-18 5-33.5-6.5T40-91q0-13 7.5-23T68-128l172-47v-105h-80q-17 0-28.5-11.5T120-320v-400q-17 0-28.5-11.5T80-760q0-17 11.5-28.5T120-800h80v-40q0-17 11.5-28.5T240-880h480q17 0 28.5 11.5T760-840v40h80q17 0 28.5 11.5T880-760q0 17-11.5 28.5T840-720v320q0 17-11.5 28.5T800-360h-80v55l151-42q18-5 33.5 6.5T920-309q0 13-7.5 23T892-272L89-53Zm271-154 240-66v-87h-80v40q0 17-11.5 28.5T480-280H360v73ZM200-480h240v-240H200v240Zm320-80h240v-160H520v160Z',
  local_taxi: 'M240-200v20q0 25-17.5 42.5T180-120q-25 0-42.5-17.5T120-180v-286q0-7 1-14t3-13l75-213q8-24 29-39t47-15h85v-40q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800v40h85q26 0 47 15t29 39l75 213q2 6 3 13t1 14v286q0 25-17.5 42.5T780-120q-25 0-42.5-17.5T720-180v-20H240Zm-8-360h496l-42-120H274l-42 120Zm68 240q25 0 42.5-17.5T360-380q0-25-17.5-42.5T300-440q-25 0-42.5 17.5T240-380q0 25 17.5 42.5T300-320Zm360 0q25 0 42.5-17.5T720-380q0-25-17.5-42.5T660-440q-25 0-42.5 17.5T600-380q0 25 17.5 42.5T660-320Z',
  flight: 'M480-120 377-91q-14 4-25.5-4.5T340-118q0-12 3-19.5t8-11.5l69-51v-220l-291 86q-19 5-34-6t-15-31q0-15 5-25t14-15l321-189v-220q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v220l321 189q9 5 14 15t5 25q0 20-15 31t-34 6l-291-86v220l69 51q5 4 8 11.5t3 19.5q0 14-11.5 22.5T583-91l-103-29Z',
  directions_railway: 'M208-80q-14 0-19-12t5-22l46-46h480l46 46q10 10 5 22t-19 12H208Zm72-120 40-40h-20q-58 0-99-41t-41-99v-260q0-129 92.5-204.5T480-920q135 0 227.5 75.5T800-640v260q0 58-41 99t-99 41h-20l40 40H280Zm200-160q25 0 42.5-17.5T540-420q0-25-17.5-42.5T480-480q-25 0-42.5 17.5T420-420q0 25 17.5 42.5T480-360ZM240-600h480v-40q0-23-4.5-42.5T703-720H257q-8 18-12.5 37.5T240-640v40Z',
  trolley: 'M800-280H240q-33 0-56.5-23.5T160-360v-400h-40q-17 0-28.5-11.5T80-800q0-17 11.5-28.5T120-840h40q33 0 56.5 23.5T240-760v400h560q17 0 28.5 11.5T840-320q0 17-11.5 28.5T800-280ZM240-80q-33 0-56.5-23.5T160-160q0-33 23.5-56.5T240-240q33 0 56.5 23.5T320-160q0 33-23.5 56.5T240-80Zm80-320q-17 0-28.5-11.5T280-440v-160q0-17 11.5-28.5T320-640h160q17 0 28.5 11.5T520-600v160q0 17-11.5 28.5T480-400H320Zm280 0q-17 0-28.5-11.5T560-440v-160q0-17 11.5-28.5T600-640h160q17 0 28.5 11.5T800-600v160q0 17-11.5 28.5T760-400H600ZM760-80q-33 0-56.5-23.5T680-160q0-33 23.5-56.5T760-240q33 0 56.5 23.5T840-160q0 33-23.5 56.5T760-80Z',
});

/** Material's authoring box: 960 units wide, y running -960 → 0. */
const VIEW_BOX = '0 -960 960 960';

/**
 * Vehicle class → Material Symbol.
 *
 * Two substitutions are recorded rather than hidden:
 *
 *   - `coach` uses `airport_shuttle`, a van. `directions_bus` would be more
 *     literal and would make an intercity coach and a city bus the same
 *     picture, which is the one distinction the class is for.
 *   - `trolleybus` uses `directions_bus`. Material publishes no trolleybus
 *     glyph, and `trolley` is a luggage cart. A trolleybus IS a bus; the
 *     colour channel carries the rest. No French feed publishes one today.
 *
 * And one name here is not a Material Symbol at all: `aerialway` is Maki's.
 * See {@link MAKI_SYMBOLS}.
 */
const KIND_SYMBOL = Object.freeze({
  bus: 'directions_bus',
  coach: 'airport_shuttle',
  trolleybus: 'directions_bus',
  tram: 'tram',
  metro: 'subway',
  rail: 'train',
  monorail: 'monorail',
  ferry: 'directions_boat',
  aerial: 'aerialway',
  funicular: 'funicular',
  'cable-tram': 'directions_railway',
  taxi: 'local_taxi',
  air: 'flight',
});

/**
 * The symbols this pack takes from Maki rather than from Material Symbols.
 *
 * Kept as an explicit set rather than inferred from "is it missing from the
 * Material table": a symbol that vanished from that table by accident would
 * then silently become a Maki lookup, fail, and fall through to the disc — the
 * one outcome `transitVehicleGlyph` exists to prevent.
 *
 * These are drawn by `mapIcons.mapIconGlyph()` rather than by the renderer
 * below, because they are authored in a 15-unit box and Material's glyphs are
 * authored in a 960-unit one. Rescaling either set into the other's space would
 * be a redraw of someone else's artwork for no benefit, and would falsify the
 * "verbatim, not rescaled" claim both notices make.
 */
const MAKI_SYMBOLS = Object.freeze(new Set(['aerialway']));

/**
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is GPU-minified into mush. The layer
 * draws these at 22 CSS px and 26 when selected (~44 and ~52 device px on
 * Retina), so 88 covers the band at ≤2× minification — the same reasoning
 * `sharedMobilityIcons.js` records for its 16 px draw at 64.
 */
export const TRANSIT_GLYPH_RASTER_PX = 88;

/**
 * Halo stroke, in Material's 960-unit space.
 *
 * ~2 px at the drawn size. Wide enough to separate a white glyph from pale
 * terrain, narrow enough not to swallow the gaps Material draws INSIDE its
 * glyphs — the tram's pantograph gap and the bus's window band are the whole
 * reason those two read apart.
 */
const HALO_STROKE = 110;

/** Disc for a class this pack cannot draw — never another class's vehicle. */
const FALLBACK_DISC = '<circle cx="480" cy="-480" r="230"/>';

/** @type {Map<string, string>} cache key → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/** Every class this pack draws with a real vehicle glyph. */
export const TRANSIT_GLYPH_KINDS = Object.freeze(Object.keys(KIND_SYMBOL));

/** The Material Symbol a class draws with, or null when it has none. */
export function transitSymbolName(kind) {
  return KIND_SYMBOL[String(kind)] || null;
}

/**
 * Data URI for one class's icon, lazily built and cached.
 *
 * @param {string} kind Vehicle class from `transitVehicleKind.js`.
 * @param {Object} [options]
 * @param {number} [options.px] Raster size.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function transitVehicleGlyph(kind, { px = TRANSIT_GLYPH_RASTER_PX } = {}) {
  const symbol = transitSymbolName(kind);
  // Maki artwork lives in its own coordinate box, so it is drawn by the module
  // that owns that box — which applies the same halo colour and white fill, so
  // the two sets stay one look and one tint contract. A name listed there with
  // no artwork behind it is a failing test, but at runtime it falls through to
  // the disc below rather than handing Cesium a null image.
  if (symbol && MAKI_SYMBOLS.has(symbol)) {
    const drawn = mapIconGlyph('maki', symbol, { px });
    if (drawn) return drawn;
  }

  // A class with no glyph gets a disc, not another class's vehicle: borrowing
  // one would assert something the feed never said. Keyed on whether the
  // ARTWORK exists rather than on whether the name does — a name with no path
  // behind it used to render `<path d="undefined"/>`, an empty billboard that
  // looks like a dropped vehicle rather than an unresolved class.
  const path = symbol ? MATERIAL_SYMBOL_PATHS[symbol] : null;
  const cacheKey = `${path ? symbol : 'disc'}@${px}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const geometry = path ? `<path d="${path}"/>` : FALLBACK_DISC;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${VIEW_BOX}">`
    // Halo first: the same geometry, stroked wide and dark. Multiplying a tint
    // into black leaves black, so this survives `billboard.color`.
    + `<g fill="none" stroke="rgba(0,0,0,0.62)" stroke-width="${HALO_STROKE}"`
    + ` stroke-linejoin="round" stroke-linecap="round">${geometry}</g>`
    + `<g fill="#ffffff" stroke="none">${geometry}</g>`
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/**
 * The heading pointer: a wedge parked at the TOP of an otherwise empty box.
 *
 * Drawn on its own billboard, larger than the vehicle icon, and rotated by
 * `iconOrientation.screenProjectedRotation` every time the camera pose moves.
 * Because the wedge sits at the edge of the box and the box rotates about its
 * centre, the wedge ORBITS the icon — so the vehicle stays upright and legible
 * while the direction of travel still reads at a glance. No pixel offset is
 * involved, which is what keeps it correct at any camera pitch.
 *
 * A vehicle whose feed publishes no bearing simply has no pointer. That is the
 * same statement the bare disc used to make, made by absence instead of by a
 * second shape.
 *
 * @param {number} [px] Raster size.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function transitHeadingPointer(px = TRANSIT_GLYPH_RASTER_PX) {
  const cacheKey = `pointer@${px}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  // Kept tight against the top edge: the further out the wedge sits, the more
  // clearly it reads as a separate direction mark rather than as a tail on the
  // vehicle icon it orbits.
  const wedge = '<path d="M48,4 L59,24 L48,19 L37,24 Z"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 96 96">`
    + `<g fill="rgba(0,0,0,0.62)" stroke="rgba(0,0,0,0.62)" stroke-width="7"`
    + ` stroke-linejoin="round">${wedge}</g>`
    + `<g fill="#ffffff" stroke="none">${wedge}</g>`
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/**
 * Which vendored set a symbol's artwork comes from, or null if it has none.
 * The licence a glyph ships under depends on this, so the notices are testable.
 * @param {?string} symbol
 * @returns {?('maki'|'material-symbols')}
 */
export function transitSymbolSet(symbol) {
  if (!symbol) return null;
  if (MAKI_SYMBOLS.has(symbol)) return 'maki';
  return MATERIAL_SYMBOL_PATHS[symbol] ? 'material-symbols' : null;
}

/** The vendored path table, for tests that assert the artwork is intact. */
export function _transitSymbolPathsForTest() {
  return MATERIAL_SYMBOL_PATHS;
}
