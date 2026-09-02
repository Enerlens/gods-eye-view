/**
 * @module mapIcons
 *
 * The CC0 **map** icon sets — Maki and Temaki — vendored path by path, and the
 * one renderer that draws them the way this project draws every other glyph.
 *
 * ── WHY A SECOND SET AT ALL, NEXT TO MATERIAL SYMBOLS ───────────────────────
 *
 * `transitVehicleIcons.js` and `sharedMobilityIcons.js` already vendor Google's
 * Material Symbols and both record the same finding: recognition beats
 * invention. Nothing here contradicts that. What it adds is a distinction those
 * two modules never had to make, because a bus and a bicycle happen to be
 * things a UI icon set draws well.
 *
 * Material Symbols is an **interface** set. It is drawn for ~24 px inside a
 * menu, where a reader is looking straight at it against a flat background.
 * Maki (Mapbox) and Temaki (the OpenStreetMap iD editor) are **cartographic**
 * sets: authored in a 15-unit box, for a label sitting on top of imagery, at
 * the size a marker actually occupies on a map. That is our size band — the
 * layers here draw at 15 to 29 CSS px over an orthophoto — and it is the band
 * where Material's interface glyphs start to fail. Two of them measurably do;
 * see the substitutions recorded at each call site.
 *
 * So this is not a migration. Material keeps everything it draws well, which is
 * most of the fleet. This module exists for the cases where a set built for
 * maps wins, and for the subjects Material simply has no glyph for.
 *
 * ── LICENCE: CC0, WHICH IS WHY THIS FILE CAN BE SHORT ───────────────────────
 *
 * Both sets are CC0 1.0 — a public-domain dedication, not a licence with
 * conditions. There is no attribution obligation, no notice to propagate, and
 * no "state your changes" clause of the kind Apache-2.0 §4 imposes on the
 * Material artwork.
 *
 * `licenses/maki/` and `licenses/temaki/` carry the upstream texts and a NOTICE
 * anyway. Recording where artwork came from is this project's own discipline —
 * the same reason `DATA_SOURCES.md` exists for the feeds — and it is what lets
 * a reader audit the claim below without cloning two repositories.
 *
 * ── WHAT WAS TAKEN, AND WHAT WAS CHANGED ────────────────────────────────────
 *
 * Only the `d` string of each path, verbatim, in each set's own 15-unit box.
 * The coordinates are NOT rescaled, for the reason the Material notice already
 * gives: rescaling is a redraw, and a redraw is no longer the artwork that was
 * evaluated.
 *
 * One mechanical normalisation, and it changes no coordinate: Maki's published
 * SVG breaks long `d` attributes with XML character escapes (`&#xA;&#x9;` —
 * newline plus tab). Those are whitespace to an SVG path parser, and they are
 * resolved to single spaces here so the string can live in JavaScript source.
 * Every number, command letter and their order are untouched.
 *
 * ── TINT-SAFE BY CONSTRUCTION, LIKE ITS TWO SIBLING PACKS ───────────────────
 *
 * One geometry, two passes: a wide dark stroke first, the white artwork second.
 * Cesium multiplies `billboard.color` into the texture, so white takes the
 * layer's colour exactly while black survives the multiply (0 × c = 0) and
 * keeps the glyph readable over pale terrain.
 *
 * This is not a style preference, and `cctv.js` is the proof. Its camera used
 * to be drawn with cyan baked into the artwork while the layer tinted the
 * billboard amber to mark the ACTIVE camera. #75e7ff × #ffd97a = **#75c57a** —
 * the one camera the operator had selected rendered green. White artwork makes
 * that multiply an identity, so the selected camera is the amber the layer asked
 * for. A baked hue is a bug, not a look.
 */

/**
 * The authoring box of both sets, padded by one unit on every side.
 *
 * Maki and Temaki both author to `0 0 15 15` and both draw right up to the
 * edges — Temaki's camera starts at x=0 and ends at x=15. The halo pass strokes
 * that same geometry OUTWARD, so at the published viewBox roughly half the halo
 * would fall outside the canvas and be clipped, leaving a glyph with a dark
 * outline on three sides and a bare white edge on the fourth.
 *
 * Padding the viewBox is not a modification of the artwork: no path coordinate
 * moves, the canvas around them simply grows. The 15-unit glyph then occupies
 * 15/17 ≈ 88% of the raster, which also happens to match how much of its own
 * 960 box a Material Symbol typically fills — so the two sets land at the same
 * optical weight when they sit on the same globe.
 */
export const MAP_ICON_VIEW_BOX = '-1 -1 17 17';

/**
 * Halo width, in the 15-unit space.
 *
 * Matched to Material's halo by RATIO rather than by eye: `transitVehicleIcons`
 * strokes 110 units in a 960 box (11.5%), and 11.5% of 15 is 1.72. Keeping the
 * proportion is what makes a Maki téléphérique and a Material bus read as one
 * renderer when they share a screen, which they do in the transit layer.
 */
export const MAP_ICON_HALO_STROKE = 1.72;

/** Halo colour, identical to the two Material packs so the sets stay one look. */
export const MAP_ICON_HALO_COLOR = 'rgba(0,0,0,0.62)';

/**
 * Maki — https://github.com/mapbox/maki (CC0 1.0).
 * Retrieved 2026-09-02 at commit 28e2a3602e4b from `icons/<name>.svg`.
 *
 * @see licenses/maki/NOTICE
 */
export const MAKI_PATHS = Object.freeze({
  // A cabin hanging from its cable, drawn as a cabin. Used by
  // `transitVehicleIcons.js` for the `aerial` class; the note there records
  // what it replaced and why.
  aerialway: 'M13,5H8V2.6c0.1854-0.1047,0.3325-0.2659,0.42-0.46L13.5,1.5C13.7761,1.5,14,1.2761,14,1s-0.2239-0.5-0.5-0.5L8.28,1.15 C8.0954,0.9037,7.8077,0.7562,7.5,0.75C7.0963,0.752,6.7334,0.9966,6.58,1.37L1.5,2C1.2239,2,1,2.2239,1,2.5S1.2239,3,1.5,3 l5.22-0.65C6.7967,2.4503,6.8917,2.5351,7,2.6V5H2C1.4477,5,1,5.4477,1,6v7c0,0.5523,0.4477,1,1,1h11c0.5523,0,1-0.4477,1-1V6 C14,5.4477,13.5523,5,13,5z M7,11H3V7h4V11z M12,11H8V7h4V11z',
});

/**
 * Temaki — https://github.com/rapideditor/temaki (CC0 1.0).
 * Retrieved 2026-09-02 at commit 6d9ac860d1d6 from `icons/<name>.svg`.
 *
 * Temaki publishes each icon as SEVERAL sibling paths rather than one, so the
 * entries here are arrays. The lens of the camera is a subpath that winds
 * against its parent, which is what makes it a hole rather than a white disc —
 * so the paths are kept whole and are never merged or reordered.
 *
 * @see licenses/temaki/NOTICE
 */
export const TEMAKI_PATHS = Object.freeze({
  // A body, a wall bracket, and a hood with the lens punched through it. Used
  // by `cctv.js`; see the tint note in this module's header for what it fixed.
  security_camera: Object.freeze([
    'M0 2C0 2 5 2 5 2C5 2 15 6.5 15 6.5C15 6.5 7.75 6.5 7.75 6.5C7.75 6.5 0 2 0 2z',
    'M0 2.5C0 2.5 7.5 7 7.5 7C7.5 7 5.5 12.5 5.5 12.5C5.5 12.5 0 6 0 6C0 6 0 2.5 0 2.5z',
    'M15 7C15 7 12.5 12.5 12.5 12.5C12.5 12.5 6 12.5 6 12.5C6 12.5 8 7 8 7L15 7zM10.13 7.5C8.95 7.5 8 8.35 8 9.4C8 10.45 8.95 11.3 10.13 11.3C11.3 11.3 12.25 10.45 12.25 9.4C12.25 8.35 11.3 7.5 10.13 7.5z',
  ]),
});

/** The two sets, by the name a caller passes. */
const SETS = Object.freeze({ maki: MAKI_PATHS, temaki: TEMAKI_PATHS });

/** @type {Map<string, string>} set/name@px → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * The `<path>` elements of one vendored icon, or null if it is not vendored.
 *
 * Null rather than a fallback shape: a layer that asks for a glyph this module
 * does not carry has a bug in it, and quietly drawing something else would hide
 * that behind a picture of the wrong object.
 *
 * @param {'maki'|'temaki'} set
 * @param {string} name Icon name, as published upstream.
 * @returns {?string} SVG markup, or null.
 */
export function mapIconGeometry(set, name) {
  const table = SETS[set];
  const d = table?.[name];
  if (!d) return null;
  const list = Array.isArray(d) ? d : [d];
  return list.map((one) => `<path d="${one}"/>`).join('');
}

/**
 * Data URI for one vendored map icon, lazily built and cached per icon+size.
 *
 * @param {'maki'|'temaki'} set Which vendored set the name belongs to.
 * @param {string} name Icon name, as published upstream.
 * @param {Object} [options]
 * @param {number} [options.px=88] Raster size. Cesium's billboard atlas has no
 *   mipmaps, so a texture far larger than its on-screen footprint is minified
 *   into mush; 88 covers the 15–29 CSS px band these layers draw at, the same
 *   reasoning `transitVehicleIcons.js` records for its own raster.
 * @returns {?string} `data:image/svg+xml;base64,…`, or null for an unknown icon.
 */
export function mapIconGlyph(set, name, { px = 88 } = {}) {
  const cacheKey = `${set}/${name}@${px}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  const geometry = mapIconGeometry(set, name);
  if (!geometry) return null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${MAP_ICON_VIEW_BOX}">`
    // Halo first: the SAME geometry, stroked wide and dark. Multiplying a tint
    // into black leaves black, so this survives `billboard.color`.
    + `<g fill="${MAP_ICON_HALO_COLOR}" stroke="${MAP_ICON_HALO_COLOR}"`
    + ` stroke-width="${MAP_ICON_HALO_STROKE}" stroke-linejoin="round"`
    + ` stroke-linecap="round">${geometry}</g>`
    + `<g fill="#ffffff" stroke="none">${geometry}</g>`
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}
