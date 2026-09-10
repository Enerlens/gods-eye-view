/**
 * @module roadEventGlyphs
 *
 * WHAT a road event IS, drawn as a silhouette — the shape half of a read that
 * used to be entirely in hue.
 *
 * ── The defect this closes ──────────────────────────────────────────────────
 *
 * A road event has one NOMINAL variable — its category — and until now it was
 * painted with eight hues, on the same tarmac that `traffic` and
 * `road-status-fr` colour green/amber/red for congestion and that
 * `comptages-fr` colours across a seven-hue rhythm wheel. Rule B5 puts a
 * nominal variable on SHAPE, and rule A3 forbids one channel carrying two
 * informations; the measured collisions were the bill for ignoring both. In
 * CIE L*a*b*, on an 8 px swatch:
 *
 *   dE  7.3  `obstacle` violet   vs `comptages-fr` pendulaire
 *   dE  9.2  `intemperie` cyan   vs `comptages-fr` pointe du matin
 *   dE 12.6  `deviation` green   vs the congestion ladder's `Fluide`
 *   dE  0.0  `accident` #ff3b30  vs `traffic`'s `Route fermée`
 *
 * The last one was co-observed in one key at one instant. Category now takes
 * the shape channel and the events draw in ONE ink, which hands the whole hue
 * channel back to congestion — the only ordered variable the road subject has,
 * and the only one a colour scale is owed to.
 *
 * ── Severity left the mark, and that is a measurement, not a taste ──────────
 *
 * `roadEventPixelSize()` used to compose THREE variables into one diameter:
 * severity (5 steps), a safety flag (+2 px) and the planned state (x0.8). Its
 * twenty reachable combinations packed into 5.6-15.4 px, with fourteen
 * neighbouring pairs under 0.75 px apart and four of them 0.12 px apart — a
 * planned major closure and an active medium restriction landed on the same
 * diameter. Nothing in the key mentioned any of it (D1).
 *
 * Measured on the live national feed of 2026-09-10, 386 situations:
 * `medium` 312 (81 %), `high` 54, `low` 19, `highest` 1, `lowest` 0. Four
 * fifths of the marks share one value, and `medium` is ALSO the value the
 * projection falls back to when a publisher declares none — so a declared
 * middling severity and a missing one were drawn identically, which is rule
 * A1. A channel that spends five perceptual steps to separate 19 / 312 / 54 / 1
 * is not encoding, it is decoration. Severity stays on the CARD, where it is a
 * word rather than half a pixel.
 *
 * What the mark carries now: the category, as shape. What the ALPHA carries,
 * as it always did, is whether the event has started (`roadEventAlpha`).
 *
 * ── The artwork is Google's, not ours ───────────────────────────────────────
 *
 * Material Symbols Rounded, filled, weight 400. Only each `d` string is
 * vendored, verbatim, in Material's own `0 -960 960 960` box — never rescaled,
 * for the reason `licenses/material-symbols/NOTICE` already records for the
 * transit and shared-mobility sets. Fetched 2026-09-10 from
 * `https://raw.githubusercontent.com/google/material-design-icons/master/symbols/web/<name>/materialsymbolsrounded/<name>_fill1_24px.svg`.
 * `roadEventGlyphs.test.mjs` pins the strings, so artwork drift is a failing
 * test rather than a silent redraw.
 *
 * Recognition beats invention, which is the same argument
 * `transitVehicleIcons.js` made when it replaced a hand-drawn set: a visitor
 * has seen `construction` and `block` ten thousand times, and had seen our
 * traffic cone never.
 *
 * ── Tint-safe by construction ───────────────────────────────────────────────
 *
 * Every glyph draws twice: a wide dark halo under a white fill. Cesium
 * multiplies `billboard.color` into the texture, so white artwork takes the
 * tint and a black halo stays black under any multiply. The same geometry
 * feeds the legend, where the panel masks the swatch instead — so the key's
 * pastille IS the mark, at the key's size.
 */

const _b64 = (value) => (typeof btoa === 'function'
  ? btoa(value)
  : Buffer.from(value, 'utf8').toString('base64'));

/** Material's own coordinate box. Never rescaled — see the notice. */
const VIEW_BOX = '0 -960 960 960';
/** Halo stroke width, in the same 960 box. Matches the sibling icon modules. */
const HALO_STROKE = 110;
/** Raster side for the billboard texture, in device pixels. */
export const ROAD_EVENT_GLYPH_PX = 64;

/**
 * The vendored Material Symbols artwork, verbatim.
 */
export const ROAD_EVENT_SYMBOL_PATHS = Object.freeze({
  car_crash: 'M680-640q8 0 14-6t6-14v-120q0-8-6-14t-14-6q-8 0-14 6t-6 14v120q0 8 6 14t14 6Zm0 80q8 0 14-6t6-14q0-8-6-14t-14-6q-8 0-14 6t-6 14q0 8 6 14t14 6Zm-60 280q25 0 42.5-17.5T680-340q0-25-17.5-42.5T620-400q-25 0-42.5 17.5T560-340q0 25 17.5 42.5T620-280Zm-360 0q25 0 42.5-17.5T320-340q0-25-17.5-42.5T260-400q-25 0-42.5 17.5T200-340q0 25 17.5 42.5T260-280Zm420-200q-83 0-141.5-58.5T480-680q0-82 58-141t142-59q83 0 141.5 58.5T880-680q0 83-58.5 141.5T680-480ZM140-80q-25 0-42.5-17.5T80-140v-286q0-7 1-14t3-13l80-227q6-18 21.5-29t34.5-11h139q17 0 28.5 11.5T399-680q0 17-11.5 28.5T359-640H234l-42 120h239q9 0 17.5 4t14.5 12q40 49 96.5 76.5T680-400q19 0 37-2.5t36-7.5q17-5 32 5.5t15 27.5v237q0 25-17.5 42.5T740-80q-25 0-42.5-17.5T680-140v-20H200v20q0 25-17.5 42.5T140-80Z',
  traffic_jam: 'M160-160v20q0 25-17.5 42.5T100-80q-25 0-42.5-17.5T40-140v-276q0-12 2-23.5t7-22.5l76-181q7-17 22-27t33-10h360q18 0 33 10t22 27l76 181q5 11 7 22.5t2 23.5v276q0 25-17.5 42.5T620-80q-25 0-42.5-17.5T560-140v-20H160Zm-8-360h415l-33-80H186l-34 80Zm68 240q25 0 42.5-17.5T280-340q0-25-17.5-42.5T220-400q-25 0-42.5 17.5T160-340q0 25 17.5 42.5T220-280Zm280 0q25 0 42.5-17.5T560-340q0-25-17.5-42.5T500-400q-25 0-42.5 17.5T440-340q0 25 17.5 42.5T500-280Zm147-440H287q-20 0-30-12.5T247-760q0-15 10-27.5t30-12.5h373q18 0 33 10t22 27l76 181q5 11 7 22.5t2 23.5v296q0 17-11.5 28.5T760-200q-17 0-28.5-11.5T720-240v-304l-73-176Zm120-120H407q-20 0-30-12.5T367-880q0-15 10-27.5t30-12.5h373q18 0 33 10t22 27l76 181q5 11 7 22.5t2 23.5v296q0 17-11.5 28.5T880-320q-17 0-28.5-11.5T840-360v-304l-73-176Z',
  block: 'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448Z',
  warning: 'M109-120q-11 0-20-5.5T75-140q-5-9-5.5-19.5T75-180l370-640q6-10 15.5-15t19.5-5q10 0 19.5 5t15.5 15l370 640q6 10 5.5 20.5T885-140q-5 9-14 14.5t-20 5.5H109Zm371-120q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm0-120q17 0 28.5-11.5T520-400v-120q0-17-11.5-28.5T480-560q-17 0-28.5 11.5T440-520v120q0 17 11.5 28.5T480-360Z',
  rainy: 'M558-84q-15 8-30.5 2.5T504-102l-60-120q-8-15-2.5-30.5T462-276q15-8 30.5-2.5T516-258l60 120q8 15 2.5 30.5T558-84Zm240 0q-15 8-30.5 2.5T744-102l-60-120q-8-15-2.5-30.5T702-276q15-8 30.5-2.5T756-258l60 120q8 15 2.5 30.5T798-84Zm-480 0q-15 8-30.5 2.5T264-102l-60-120q-8-15-2.5-30.5T222-276q15-8 30.5-2.5T276-258l60 120q8 15 2.5 30.5T318-84Zm-18-236q-91 0-155.5-64.5T80-540q0-83 55-145t136-73q32-57 87.5-89.5T480-880q90 0 156.5 57.5T717-679q69 6 116 57t47 122q0 75-52.5 127.5T700-320H300Z',
  construction: 'M714-162 537-339l84-84 177 177q17 17 17 42t-17 42q-17 17-42 17t-42-17Zm-552 0q-17-17-17-42t17-42l234-234-68-68q-11 11-28 11t-28-11l-23-23v90q0 14-12 19t-22-5L106-576q-10-10-5-22t19-12h90l-22-22q-12-12-12-28t12-28l114-114q20-20 43-29t47-9q20 0 37.5 6t34.5 18q8 5 8.5 14t-6.5 16l-76 76 22 22q11 11 11 28t-11 28l68 68 90-90q-4-11-6.5-23t-2.5-24q0-59 40.5-99.5T701-841q8 0 15 .5t14 2.5q9 3 11.5 12.5T737-809l-65 65q-6 6-6 14t6 14l44 44q6 6 14 6t14-6l65-65q7-7 16.5-5t12.5 12q2 7 2.5 14t.5 15q0 59-40.5 99.5T701-561q-12 0-24-2t-23-7L246-162q-17 17-42 17t-42-17Z',
  merge: 'M480-344 284-148q-11 11-27.5 11.5T228-148q-11-11-11-28t11-28l165-166q23-23 35-52t12-61v-204l-36 36q-11 11-27.5 11T348-652q-11-11-11-28t11-28l104-104q12-12 28-12t28 12l104 104q11 11 11.5 27.5T612-652q-11 11-28 11t-28-11l-36-35v204q0 32 12 61t35 52l165 166q11 11 11.5 27.5T732-148q-11 11-28 11t-28-11L480-344Z',
  alt_route: 'M440-120v-160q0-56-17-83t-45-53l57-57q12 11 23 23.5t22 26.5q14-19 28.5-33.5T538-485q38-35 69-81t33-161l-35 35q-11 11-27.5 11T549-692q-12-12-12-28.5t12-28.5l103-103q6-6 13-8.5t15-2.5q8 0 15 2.5t13 8.5l104 104q11 11 11.5 27.5T812-692q-11 11-28 11t-28-11l-36-35q-2 143-44 203.5T592-425q-32 29-52 56.5T520-280v160q0 17-11.5 28.5T480-80q-17 0-28.5-11.5T440-120ZM248-633q-4-20-5.5-44t-2.5-50l-36 36q-11 11-27.5 11T148-692q-11-11-11-28t11-28l104-104q6-6 13-8.5t15-2.5q8 0 15 2.5t13 8.5l104 104q12 12 11.5 28T411-692q-12 11-28 11t-28-11l-35-34q0 21 2 39.5t4 34.5l-78 19Zm86 176q-20-21-38.5-49T263-575l77-19q10 27 23 46t28 34l-57 57Z',
  question_mark: 'M584-637q0-43-28.5-69T480-732q-29 0-52.5 12.5T387-683q-16 23-43.5 26.5T296-671q-14-13-15.5-32t9.5-36q32-48 81.5-74.5T480-840q97 0 157.5 55T698-641q0 45-19 81t-70 85q-37 35-50 54.5T542-376q-4 24-20.5 40T482-320q-23 0-39.5-15.5T426-374q0-39 17-71.5t57-68.5q51-45 67.5-69.5T584-637ZM480-80q-33 0-56.5-23.5T400-160q0-33 23.5-56.5T480-240q33 0 56.5 23.5T560-160q0 33-23.5 56.5T480-80Z',
});

/**
 * Category id -> Material symbol name.
 *
 * Chosen for what a French road operator means by the word, not for the
 * closest English synonym:
 *
 *   `travaux` -> `construction`   the canonical roadworks mark.
 *   `fermeture` -> `block`        a closed road, not a warning about one.
 *   `deviation` -> `alt_route`    a route that forks away from the main one,
 *                                 which is exactly what a diversion is.
 *   `restriction` -> `merge`      lanes converging: an alternat or a
 *                                 neutralised lane is traffic being funnelled.
 *   `obstacle` -> `warning`       the generic hazard triangle, because the
 *                                 category itself is generic — it holds fallen
 *                                 trees, shed loads and broken surfaces.
 *   `intemperie` -> `rainy`       weather ON the road.
 *   `bouchon` -> `traffic_jam`    queuing vehicles.
 *   `accident` -> `car_crash`     a collision.
 *   `inconnu` -> `question_mark`  a code this build does not know. It is NOT a
 *                                 ninth category and must never look like one.
 */
export const ROAD_EVENT_CATEGORY_SYMBOLS = Object.freeze({
  accident: 'car_crash',
  bouchon: 'traffic_jam',
  fermeture: 'block',
  obstacle: 'warning',
  intemperie: 'rainy',
  travaux: 'construction',
  restriction: 'merge',
  deviation: 'alt_route',
  inconnu: 'question_mark',
});

/** @type {Map<string,string>} `${category}@${px}` -> data URI. */
const _cache = new Map();

/** The path geometry for a category, falling back to the unknown mark. */
function bodyFor(categoryId) {
  const symbol = ROAD_EVENT_CATEGORY_SYMBOLS[String(categoryId)]
    || ROAD_EVENT_CATEGORY_SYMBOLS.inconnu;
  return `<path d="${ROAD_EVENT_SYMBOL_PATHS[symbol]}"/>`;
}

/**
 * Data URI for a category's mark — halo under white fill, ready to be tinted.
 *
 * @param {string} categoryId One of {@link ROAD_EVENT_CATEGORY_SYMBOLS}.
 * @param {number} [px=ROAD_EVENT_GLYPH_PX] Raster side.
 * @returns {string} `data:image/svg+xml;base64,...`
 */
export function roadEventGlyph(categoryId, px = ROAD_EVENT_GLYPH_PX) {
  const key = `${categoryId}@${px}`;
  const cached = _cache.get(key);
  if (cached) return cached;
  const geometry = bodyFor(categoryId);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${VIEW_BOX}">`
    // Halo first: the SAME geometry, stroked wide and dark. A tint multiplied
    // into black leaves black, so this survives `billboard.color`.
    + `<g fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="${HALO_STROKE}"`
    + ` stroke-linecap="round" stroke-linejoin="round">${geometry}</g>`
    + `<g fill="#ffffff" stroke="none">${geometry}</g>`
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(key, uri);
  return uri;
}

/**
 * The same silhouette, as a CSS mask for the legend swatch.
 *
 * No halo and no fill colour: the panel paints the row's own ink through the
 * mask, which is how the key's pastille ends up being the map's mark at the
 * key's size rather than a description of it.
 *
 * @param {string} categoryId One of {@link ROAD_EVENT_CATEGORY_SYMBOLS}.
 * @returns {string} `data:image/svg+xml;base64,...`
 */
export function roadEventMaskGlyph(categoryId) {
  const key = `${categoryId}@mask`;
  const cached = _cache.get(key);
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW_BOX}">`
    + `<g fill="#000000">${bodyFor(categoryId)}</g></svg>`;
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(key, uri);
  return uri;
}

/** Raw geometry, for the test that asserts the nine marks actually differ. */
export function _roadEventGlyphBodyForTest(categoryId) {
  return bodyFor(categoryId);
}
