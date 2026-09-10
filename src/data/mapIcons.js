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
 * The authoring box most of both sets use, padded by one unit on every side.
 *
 * Maki and Temaki mostly author to `0 0 15 15` and both draw right up to the
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

/** The box a set's icons are authored in unless {@link MAP_ICON_BOX} says otherwise. */
export const MAP_ICON_DEFAULT_BOX = 15;

/**
 * The icons that are NOT authored in a 15-unit box, and the box they use.
 *
 * Temaki is not uniform: most of its icons are 15 units, a minority are drawn
 * larger. `fighter_jet` is published at `0 0 48 48`. That number is DECLARED
 * here rather than rescaled into 15 units for the reason this module's header
 * gives — rescaling is a redraw, and a redraw is no longer the artwork that was
 * evaluated. Everything downstream (viewBox, halo width, the plate composition
 * in `militarySiteIcons.js`) is expressed as a RATIO of the box, so an icon in
 * a different space lands at the same optical weight without moving a
 * coordinate.
 */
export const MAP_ICON_BOX = Object.freeze({ fighter_jet: 48 });

/**
 * Halo width as a fraction of the authoring box.
 *
 * Matched to Material's halo by RATIO rather than by eye: `transitVehicleIcons`
 * strokes 110 units in a 960 box (11.5%). Keeping the proportion is what makes
 * a Maki téléphérique and a Material bus read as one renderer when they share a
 * screen, which they do in the transit layer.
 */
export const MAP_ICON_HALO_RATIO = 110 / 960;

/** Halo width in the 15-unit space, kept as the named constant callers use. */
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
  // An anchor, drawn as one solid mass with a hole in its stock. Used by
  // `militarySiteIcons.js` for `military=naval_base`, where it replaced
  // Material's `directions_boat` — a civil ferry seen head-on, which said
  // "boat" where the tag says "arsenal". The anchor is the sign every nautical
  // chart already uses, and it is compact enough to survive being punched into
  // a 16 px plate; the ferry's superstructure was not.
  harbor: 'M7.5,0C5.5,0,4,1.567,4,3.5c0.0024,1.5629,1.0397,2.902,2.5,3.3379v6.0391 c-0.9305-0.1647-1.8755-0.5496-2.6484-1.2695C2.7992,10.6273,2.002,9.0676,2.002,6.498c0.0077-0.5646-0.4531-1.0236-1.0176-1.0137 C0.4329,5.493-0.0076,5.9465,0,6.498c0,3.0029,1.0119,5.1955,2.4902,6.5723C3.9685,14.4471,5.8379,15,7.5,15 c1.6656,0,3.535-0.5596,5.0117-1.9395S14.998,9.4868,14.998,6.498c0.0648-1.3953-2.0628-1.3953-1.998,0 c0,2.553-0.7997,4.1149-1.8535,5.0996C10.3731,12.3203,9.4288,12.7084,8.5,12.875V6.8418C9.9607,6.4058,10.9986,5.0642,11,3.5 C11,1.567,9.5,0,7.5,0z M7.5,2C8.3284,2,9,2.6716,9,3.5S8.3284,5,7.5,5S6,4.3284,6,3.5S6.6716,2,7.5,2z',
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
  // A combat aircraft in plan view — delta wing, twin tailplanes, a nose. Used
  // by `militarySiteIcons.js` for `military=airfield`. It replaced Material's
  // `flight`, an airliner, which is the right glyph for a civil aerodrome and
  // the wrong one for an air base: the tag says the terrain is military, and
  // the layer has a separate civil airports pack that draws the airliner.
  //
  // Published in a 48-unit box, not 15. See MAP_ICON_BOX.
  fighter_jet: Object.freeze([
    'M46 26a2 2 0 0 0 -2 2v3l-12 -9V17.48A2.49 2.49 0 0 0 28 15.51V10.63a3 3 0 0 0 -0.21 -1.11L25.1 0.74a1.18 1.18 0 0 0 -2.19 0L20.21 9.52A3 3 0 0 0 20 10.63v4.88a2.49 2.49 0 0 0 -4 1.97v4.52l-12 9v-3a2 2 0 0 0 -4 0v14a2 2 0 0 0 4 0v-2l16 -4v5l-4.45 3.81a1.87 1.87 0 0 0 1.32 3.19l7.12 -1l7.14 1a1.87 1.87 0 0 0 1.32 -3.19L28 41v-5l16 4v2a2 2 0 1 0 4 0v-14A2 2 0 0 0 46 26Z',
  ]),
  // A hyperbolic cooling tower with the radiation trefoil punched through its
  // face — Temaki's own icon for `plant:source=nuclear`, and the only glyph in
  // any vendored set that says "nuclear power station" rather than "physics".
  // Used by `plantFiliereIcons.js`.
  //
  // ONE PATH, and the trefoil is FOUR COUNTER-WOUND SUBPATHS inside it. That is
  // what makes the symbol survive being punched into a plate: the tower becomes
  // a hole, the trefoil is a hole in that hole, so it comes back in the plate's
  // colour inside the dark tower. Splitting or merging the subpaths fills the
  // trefoil in and leaves a bare tower, which is what a coal plant looks like.
  cooling_tower_radiation: Object.freeze([
    'M12 1C10 6 14 12 14 14C13 15 2 15 1 14C1 12 5 6 3 1C3 0 12 0 12 1zM8.2 10.18C7.73 10.54 7.27 10.54 6.8 10.18L5.4 12.63C6.8 13.12 8.2 13.12 9.6 12.63L8.2 10.18zM7.5 8.46C7.15 8.46 6.8 8.82 6.8 9.19C6.8 9.56 7.15 9.93 7.5 9.93C7.85 9.93 8.2 9.56 8.2 9.19C8.2 8.82 7.85 8.46 7.5 8.46zM5.87 6C4.47 6.74 4 7.72 4 9.19L6.33 9.19C6.33 8.82 6.57 8.33 7.03 8.09L5.87 6zM9.13 6L7.97 8.09C8.43 8.33 8.67 8.82 8.67 9.19L11 9.19C11 7.72 10.53 6.74 9.13 6z',
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
 * One vendored icon AND the box it was authored in.
 *
 * The pair is what a caller needs to place this artwork inside geometry of its
 * own — `militarySiteIcons.js` punches these silhouettes into a 96-unit plate,
 * and it can only compute the transform if it knows whether it was handed a
 * 15-unit anchor or a 48-unit aeroplane. Handing out the geometry alone left
 * that number to be guessed, and a guess of 15 draws a jet three times too big.
 *
 * @param {'maki'|'temaki'} set
 * @param {string} name Icon name, as published upstream.
 * @returns {?{geometry: string, box: number}} Markup and authoring box, or null.
 */
export function mapIconArtwork(set, name) {
  const geometry = mapIconGeometry(set, name);
  if (!geometry) return null;
  return { geometry, box: MAP_ICON_BOX[name] || MAP_ICON_DEFAULT_BOX };
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

  const artwork = mapIconArtwork(set, name);
  if (!artwork) return null;
  const { geometry, box } = artwork;
  // Both the padding and the halo are RATIOS of the authoring box, so an icon
  // drawn in 48 units gets the same optical weight as one drawn in 15 without
  // its coordinates being touched.
  const pad = box / MAP_ICON_DEFAULT_BOX;
  const viewBox = box === MAP_ICON_DEFAULT_BOX
    ? MAP_ICON_VIEW_BOX
    : `${-pad} ${-pad} ${box + 2 * pad} ${box + 2 * pad}`;
  const halo = box === MAP_ICON_DEFAULT_BOX
    ? MAP_ICON_HALO_STROKE
    : Number((MAP_ICON_HALO_RATIO * box).toFixed(3));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${viewBox}">`
    // Halo first: the SAME geometry, stroked wide and dark. Multiplying a tint
    // into black leaves black, so this survives `billboard.color`.
    + `<g fill="${MAP_ICON_HALO_COLOR}" stroke="${MAP_ICON_HALO_COLOR}"`
    + ` stroke-width="${halo}" stroke-linejoin="round"`
    + ` stroke-linecap="round">${geometry}</g>`
    + `<g fill="#ffffff" stroke="none">${geometry}</g>`
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}
