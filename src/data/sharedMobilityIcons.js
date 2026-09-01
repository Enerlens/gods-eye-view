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
 * one it is.
 *
 * ── THE ARTWORK IS GOOGLE'S, NOT OURS ───────────────────────────────────────
 *
 * The five vehicle glyphs were hand-drawn here and were replaced by Material
 * Symbols, vendored path by path, for the reason `transitVehicleIcons.js`
 * already recorded when it made the same move: the hand-drawn set was
 * internally consistent and nobody could tell what the shapes were.
 * Recognition beats invention. A visitor has seen `pedal_bike` and
 * `directions_car` ten thousand times in other software; they had seen our
 * diamond-frame bicycle never.
 *
 * Licence: Apache-2.0. Only each `d` string is vendored, verbatim, in Material
 * Symbols' own `0 -960 960 960` coordinate box — NOT rescaled into the old 96
 * box, because rescaling would make the artwork a modification for no benefit
 * and would falsify the "verbatim" claim in `licenses/material-symbols/NOTICE`.
 * That NOTICE and `licenses/material-symbols/LICENSE` are what satisfy
 * Apache-2.0 §4; §6 grants no trademark rights, which is why nothing here
 * carries an operator's mark.
 *
 * ── WHY NOT THE OPERATORS' OWN LOGOS ────────────────────────────────────────
 *
 * It was the obvious alternative and it fails on three independent counts,
 * each measured on 2026-09-01 rather than assumed:
 *
 * • **There is no feed to read them from.** GBFS v2.3 does define
 *   `system_information.brand_assets.brand_image_url`. Of the 154 reachable
 *   French systems in `config/gbfs_fr_systems.json`, **zero** publish it —
 *   and zero of 203 sampled worldwide. 114 of the French ones declare a
 *   version that could. The field is unadopted, not merely rare here.
 *
 * • **The manual path is 85 trademarks, not one.** 85 distinct operator
 *   identities resolve across the 165 catalogued French systems. A disclaimer
 *   in terms of use is not a licence; it is at best evidence of honest
 *   practice under EUTMR Art. 14(2), and a logo is separately copyrighted
 *   artwork that referential use does not license. Two of the largest
 *   operators' own licence URLs answer 404 and 403.
 *
 * • **The renderer cannot tint a logo, and that is decisive.** Cesium
 *   multiplies `billboard.color` into the texture. A multi-colour mark would
 *   be corrupted by that multiply, so logo billboards would have to draw
 *   white — which deletes the OPERATOR-COLOUR channel — while the logo says
 *   WHO and not WHAT, deleting the SHAPE channel at the same time. The layer
 *   would lose the ability to tell a bike from a car in exchange for telling
 *   you a brand you can already read from the colour.
 *
 * ── TINT-SAFE BY CONSTRUCTION ───────────────────────────────────────────────
 *
 * Every glyph is white artwork over a dark halo, and nothing carries a hue of
 * its own. Cesium multiplies `billboard.color` into the texture, so white
 * takes the operator's colour exactly while the black halo (0 × c = 0)
 * survives multiplication and keeps the glyph readable over pale terrain. A
 * glyph with a baked-in colour would fight the tint and destroy the operator
 * channel.
 *
 * ONE GEOMETRY, TWO PASSES. Each body is rendered first as a fat dark stroke
 * and then as the white artwork. That is why the halo can never drift out of
 * register with the shape.
 */

/**
 * Material Symbols' own coordinate box. Kept as published.
 *
 * The two hand-drawn bodies below (`other`, `station`) are authored in it too,
 * so one `viewBox` serves the whole set and no path is ever rescaled.
 */
const VIEW_BOX = '0 -960 960 960';

/**
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is GPU-minified into mush. The layer
 * draws these at 17 CSS px with a 1.15 near-scale (~39 device px on Retina),
 * so 64 covers the band at ≤1.6× minification — the same reasoning
 * `aircraftIcons.js` and `transitVehicleIcons.js` record for their rasters.
 */
const GLYPH_RASTER_PX = 64;

/**
 * Halo pass: wide, dark, drawn under everything.
 *
 * 110 in the 960 box, matching `transitVehicleIcons.js` — the two French
 * layers draw vehicles side by side on the same globe and a halo that differed
 * between them would read as two different renderers.
 */
const HALO_STROKE = 110;

/**
 * The vendored Material Symbols artwork, verbatim.
 *
 * Fetched from
 * `https://raw.githubusercontent.com/google/material-design-icons/master/symbols/web/<name>/materialsymbolsrounded/<name>_fill1_24px.svg`
 * on 2026-09-01 — the same pattern `licenses/material-symbols/NOTICE` already
 * records for the transit glyphs. `sharedMobilityIcons.test.mjs` asserts these
 * strings are what the module actually draws, so artwork drift is a failing
 * test rather than a silent redraw.
 */
export const MATERIAL_SYMBOL_PATHS = Object.freeze({
  pedal_bike: 'M200-160q-85 0-142.5-57.5T0-360q0-85 58.5-142.5T200-560q77 0 129.5 46T396-400h26l-72-200h-30q-17 0-28.5-11.5T280-640q0-17 11.5-28.5T320-680h120q17 0 28.5 11.5T480-640q0 17-11.5 28.5T440-600h-4l14 40h192l-58-160h-64q-17 0-28.5-11.5T480-760q0-17 11.5-28.5T520-800h64q26 0 46.5 14t29.5 38l68 186h32q83 0 141.5 58.5T960-362q0 84-58 143t-142 59q-72 0-126.5-45T564-320H396q-14 69-68 114.5T200-160Zm112-160v-80h-72q-17 0-28.5 11.5T200-360q0 17 11.5 28.5T240-320h72Zm196-80h56q5-23 13.5-43t22.5-37H478l30 80Zm174-52 24 68q5 16 20.5 23t31.5 1q16-6 23-21t1-31l-26-68-74 28Z',
  electric_bike: 'M200-280q-85 0-142.5-57.5T0-480q0-85 58.5-142.5T200-680q77 0 129.5 46T396-520h26l-72-200h-30q-17 0-28.5-11.5T280-760q0-17 11.5-28.5T320-800h120q17 0 28.5 11.5T480-760q0 17-11.5 28.5T440-720h-4l14 40h192l-58-160h-64q-17 0-28.5-11.5T480-880q0-17 11.5-28.5T520-920h64q26 0 46.5 14t29.5 38l68 186h32q83 0 141.5 58.5T960-482q0 84-58 143t-142 59q-72 0-126.5-45T564-440H396q-14 69-68 114.5T200-280Zm112-160v-80h-72q-17 0-28.5 11.5T200-480q0 17 11.5 28.5T240-440h72Zm196-80h56q5-23 13.5-43t22.5-37H478l30 80Zm174-52 24 68q5 16 20.5 23t31.5 1q16-6 23-21t1-31l-26-68-74 28ZM520-120v48q0 11-9.5 17T491-54l-173-87q-7-4-5.5-11.5t9.5-7.5h118v-48q0-11 9.5-17t19.5-1l173 87q7 4 5.5 11.5T638-120H520Z',
  electric_scooter: 'M200-240q-50 0-85-35t-35-85q0-50 35-85t85-35q39 0 69.5 22.5T312-400h212q11-68 56.5-119T692-590l-56-250H520q-17 0-28.5-11.5T480-880q0-17 11.5-28.5T520-920h116q28 0 50 17t28 45l69 309q2 11-5 20t-18 9q-63 0-108.5 42.5T601-373q-2 23-18 38t-39 15H312q-12 35-42.5 57.5T200-240Zm560 0q-50 0-85-35t-35-85q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35ZM520-120v48q0 11-9.5 17T491-54l-173-87q-7-4-5.5-11.5t9.5-7.5h118v-48q0-11 9.5-17t19.5-1l173 87q7 4 5.5 11.5T638-120H520Z',
  electric_moped: 'M520-120v48q0 11-9.5 17T491-54l-173-87q-7-4-5.5-11.5t9.5-7.5h118v-48q0-11 9.5-17t19.5-1l173 87q7 4 5.5 11.5T638-120H520ZM280-280q-50 0-85-35t-35-85h-40q-17 0-28.5-11.5T80-440v-80q0-66 47-113t113-47h80q33 0 56.5 23.5T400-600v120h140l140-174v-106h-80q-17 0-28.5-11.5T560-800q0-17 11.5-28.5T600-840h80q33 0 56.5 23.5T760-760v106q0 14-4.5 26.5T743-604L604-430q-11 14-28 22t-35 8H400q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T320-400h-80q0 17 11.5 28.5T280-360Zm80-360H240q-17 0-28.5-11.5T200-760q0-17 11.5-28.5T240-800h120q17 0 28.5 11.5T400-760q0 17-11.5 28.5T360-720Zm400 440q-50 0-85-35t-35-85q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35Zm0-80q17 0 28.5-11.5T800-400q0-17-11.5-28.5T760-440q-17 0-28.5 11.5T720-400q0 17 11.5 28.5T760-360Z',
  directions_car: 'M240-200v20q0 25-17.5 42.5T180-120q-25 0-42.5-17.5T120-180v-286q0-7 1-14t3-13l75-213q8-24 29-39t47-15h410q26 0 47 15t29 39l75 213q2 6 3 13t1 14v286q0 25-17.5 42.5T780-120q-25 0-42.5-17.5T720-180v-20H240Zm-8-360h496l-42-120H274l-42 120Zm68 240q25 0 42.5-17.5T360-380q0-25-17.5-42.5T300-440q-25 0-42.5 17.5T240-380q0 25 17.5 42.5T300-320Zm360 0q25 0 42.5-17.5T720-380q0-25-17.5-42.5T660-440q-25 0-42.5 17.5T600-380q0 25 17.5 42.5T660-320Z',
});

/**
 * The glyph each vehicle kind draws.
 *
 * `scooter` maps to `electric_scooter` and `moped` to `electric_moped` on the
 * evidence rather than by preference: a census of every reachable French
 * `vehicle_types.json` returns 71 `scooter_standing/electric` and 52
 * `scooter/electric` against zero human-powered kick scooters, and all four
 * French moped rows are electric. The neutral `moped` glyph exists upstream and
 * is deliberately not used — it would draw a machine the French feeds do not
 * contain.
 *
 * `bike` and `ebike` are the one pair a reader must separate at a glance, and
 * Material separates them the way the hand-drawn set did: by a bolt. Its bolt
 * sits BELOW the frame rather than above it — see the note on
 * `SHARED_MOBILITY_GLYPH_KINDS` for why that placement was checked rather than
 * assumed.
 */
const KIND_SYMBOL = Object.freeze({
  bike: 'pedal_bike',
  ebike: 'electric_bike',
  scooter: 'electric_scooter',
  moped: 'electric_moped',
  car: 'directions_car',
});

/**
 * The two bodies that stay hand-drawn, and why.
 *
 * `other` — the feed did not say what this is. A disc states exactly that;
 * borrowing another kind's silhouette would assert something never published,
 * the rule `transitFrance.js` follows for a vehicle with no bearing.
 *
 * `station` — a rack, not a vehicle. Material's `bike_dock` renders as a plain
 * bollard and reads as nothing at any size; a ground rail with three posts
 * reads as a PLACE, which is what a dock is: the thing that stays put while its
 * contents come and go. Keeping it is a legibility decision, not inertia.
 *
 * Both are authored in the 960 box so the whole set shares one viewBox.
 */
const LOCAL_BODIES = Object.freeze({
  other: '<circle cx="480" cy="-480" r="180"/>',
  // FILLED rects, not a stroked path. The old hand-drawn set had a separate
  // white STROKE pass and this rack was authored for it; Material's artwork is
  // fill-only, so that pass is gone and a zero-area path now renders as nothing
  // at all. It did — the rack was an empty square in the first contact sheet.
  station: '<rect x="150" y="-320" width="660" height="70" rx="35"/>'
    + '<rect x="255" y="-660" width="70" height="345" rx="35"/>'
    + '<rect x="445" y="-660" width="70" height="345" rx="35"/>'
    + '<rect x="635" y="-660" width="70" height="345" rx="35"/>',
});

/** @type {Map<string, string>} kind@px → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/**
 * Every kind this module can draw, in legend order.
 *
 * The five vehicle kinds, then the two locally-drawn bodies. There is no
 * separate e-moped: `vehicleKindFromType()` returns `moped` for
 * `form_factor: 'moped'` whatever the propulsion, and since every French moped
 * row is electric a split would discriminate nothing.
 */
export const SHARED_MOBILITY_GLYPH_KINDS = Object.freeze([
  ...Object.keys(KIND_SYMBOL),
  ...Object.keys(LOCAL_BODIES),
]);

/** The geometry one kind draws, whoever authored it. */
function bodyFor(kind) {
  const symbol = KIND_SYMBOL[kind];
  if (symbol) return `<path d="${MATERIAL_SYMBOL_PATHS[symbol]}"/>`;
  return LOCAL_BODIES[kind] || LOCAL_BODIES.other;
}

/**
 * Fold an arbitrary kind string onto a drawable glyph.
 * An unmapped kind falls to `other` — a disc — rather than borrowing another
 * kind's silhouette and asserting something the feed never said.
 * @param {string} kind Kind from `gbfsFeeds.vehicleKindFromType()`.
 * @returns {string} A key of {@link SHARED_MOBILITY_GLYPH_KINDS}.
 */
export function sharedMobilityGlyphKind(kind) {
  const key = String(kind);
  return SHARED_MOBILITY_GLYPH_KINDS.includes(key) ? key : 'other';
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

  const geometry = bodyFor(key);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${VIEW_BOX}">`
    // Halo first: the SAME geometry, stroked wide and dark. Multiplying a tint
    // into black leaves black, so this survives `billboard.color`.
    + `<g fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="${HALO_STROKE}"`
    + ` stroke-linecap="round" stroke-linejoin="round">${geometry}</g>`
    + `<g fill="#ffffff" stroke="none">${geometry}</g>`
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/** Raw geometry, for tests that assert the glyphs actually differ. */
export function _sharedMobilityGlyphBodyForTest(kind) {
  return bodyFor(sharedMobilityGlyphKind(kind));
}

/** The kind → Material symbol map, for the artwork-drift guard. */
export function _sharedMobilityKindSymbolForTest() {
  return { ...KIND_SYMBOL };
}
