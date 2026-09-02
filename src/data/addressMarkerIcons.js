/**
 * @module addressMarkerIcons
 *
 * WHICH REGISTER a marker comes from, drawn as a silhouette.
 *
 * The five French address layers all answer a question about the SAME
 * building. Turn on Ventes immobilières and Performance énergétique together
 * and, until this module existed, you got two clouds of coloured discs over
 * the same roofs with nothing to tell them apart — the reported symptom, in
 * the operator's own words: "on ne sait pas qu'est-ce qui correspond à ce data
 * layer et qu'est-ce qui correspond à cet autre". Size and hue were already
 * spoken for. DVF spends its colour on the price against the local median and
 * DPE spends its on the official A–G scale, so neither channel was available
 * to say which register a dot belongs to. SHAPE was the only one left, and it
 * is the right one anyway: shape survives at 16 px, and it survives colour
 * blindness.
 *
 * ONE SILHOUETTE PER REGISTER, and each one is what the register is about:
 *
 *   - **€** for DVF. What a sale is. Asked for by name.
 *   - **A letter in a frame** for the ADEME DPE — the diagnostic's own label,
 *     so the marker states the grade without being clicked.
 *   - **A warning triangle** for Géorisques.
 *   - **A plan sheet** for the Géoportail de l'urbanisme: a zoning rule is a
 *     drawing about ground, not a place.
 *   - **The mode's own pictogram** for IDFM stops, borrowed from
 *     `transitVehicleIcons.js` — see {@link idfmStopGlyphKind}.
 *
 * DRAWN HERE RATHER THAN VENDORED, unlike `transitVehicleIcons.js`. That
 * module records why it took Material Symbols: a bus and a tram in plan view
 * are genuinely hard to invent recognisably, and recognition beats invention.
 * None of that applies to a euro sign or a hazard triangle — they are already
 * the universal drawing — so these carry no third-party licence obligation.
 *
 * TINT-SAFE BY CONSTRUCTION, the same discipline as its two sibling icon
 * packs. Every glyph is white line-art over a wide dark halo and carries no
 * hue of its own. Cesium multiplies `billboard.color` into the texture, so
 * white takes the layer's value colour exactly — the DVF price ramp, the
 * official DPE scale, the Géorisques severity — while black survives the
 * multiply (0 × c = 0) and keeps the glyph readable over a pale orthophoto.
 * A hue baked into the artwork would fight the tint and destroy the channel
 * each layer spends its colour on.
 */

/** Glyph coordinate space; every body is drawn to this 96×96 box. */
const VIEW = 96;

/**
 * Raster size. Cesium's billboard atlas has no mipmaps, so a texture much
 * larger than its on-screen footprint is GPU-minified into mush. These draw at
 * 15 to 24 CSS px, 29 when selected (~58 device px on Retina), so 88 covers
 * the band at ≤1.5× minification — the same reasoning `transitVehicleIcons.js`
 * records for the vehicle raster.
 */
export const ADDRESS_GLYPH_RASTER_PX = 88;

/** Halo pass: wide, dark, drawn under everything. */
const HALO_STROKE_PX = 12;
/** Glyph pass: the visible white line weight. */
const LINE_STROKE_PX = 7;
/** Frame around a DPE letter — thinner, so the letter keeps the ink. */
const FRAME_STROKE_PX = 5;

/**
 * The seven letters of the official DPE ladder, plus the case the register
 * leaves blank — as **Inter**'s own outlines, vendored glyph by glyph.
 *
 * NOT SVG `<text>`, for the reason this module has always given: text inside an
 * SVG loaded as an IMAGE resolves against whatever font the browser happens to
 * pick, which is not a thing to bet a legend on. The outlines are extracted
 * once, at build time, so the letterforms are decided here rather than by the
 * reader's machine.
 *
 * NOT DRAWN HERE EITHER, which is the change. These used to be seven stroked
 * paths authored in this file — an even line weight, arcs where a typeface has
 * curves, and no relationship between one letter and the next beyond a shared
 * bounding box. They read as traced rather than set, and the B and the G said
 * so loudest. A letter is the one thing in this pack that is NOT a picture of
 * an object: it is a character, and characters are the work of type designers.
 * Recognition beats invention here exactly as it does for a bus.
 *
 * Inter specifically, because the application already sets its entire interface
 * in it (`--font-sans`, loaded in `index.html`). A grade badge on the globe and
 * the same grade printed on the card are now the same letterforms.
 *
 * WHAT IS STORED. Each entry is the glyph's `d` exactly as the font contains
 * it, in Inter's own 2048-unit em space, plus `cx` — the horizontal centre of
 * its bounding box, which is derived from the outline rather than imposed on
 * it. Nothing is rescaled here; {@link addressMarkerGlyph} places the outline
 * with an SVG transform, so what is stored stays verifiably the font's.
 *
 * Extracted with fontkit from `ofl/inter/Inter[opsz,wght].ttf` (google/fonts)
 * at `wght 700, opsz 14` on 2026-09-02. `opsz 14` rather than 32 on purpose:
 * Inter's optical-size axis opens the counters for small sizes, and this draws
 * at 15 px.
 *
 * @see licenses/inter/NOTICE
 */
const DPE_LETTER_OUTLINES = Object.freeze({
  A: Object.freeze({ cx: 764.5, d: 'M49 0L558 1490L958 1490L1480 0L1141 0L902 719Q859 858 814.5 1023.5Q770 1189 721 1385L788 1385Q740 1188 698.5 1021.5Q657 855 616 719L386 0ZM367 346L367 585L1162 585L1162 346Z' }),
  B: Object.freeze({ cx: 705.5, d: 'M135 0L135 1490L726 1490Q890 1490 999.5 1440.5Q1109 1391 1163.5 1305Q1218 1219 1218 1107Q1218 1019 1183 953.5Q1148 888 1087.5 846.5Q1027 805 950 787L950 772Q1034 769 1108.5 724.5Q1183 680 1229.5 600.5Q1276 521 1276 411Q1276 293 1218 200Q1160 107 1046.5 53.5Q933 0 764 0ZM440 251L704 251Q838 251 900 303Q962 355 962 440Q962 503 931.5 551.5Q901 600 845 627.5Q789 655 712 655L440 655ZM440 864L681 864Q746 864 798 887.5Q850 911 879.5 954.5Q909 998 909 1058Q909 1139 851.5 1190Q794 1241 687 1241L440 1241Z' }),
  C: Object.freeze({ cx: 761, d: 'M786 -20Q588 -20 431.5 70Q275 160 184.5 331Q94 502 94 744Q94 987 185 1158.5Q276 1330 433 1420Q590 1510 786 1510Q913 1510 1022.5 1474.5Q1132 1439 1217 1371Q1302 1303 1356 1204.5Q1410 1106 1427 980L1118 980Q1108 1042 1079.5 1089.5Q1051 1137 1008.5 1170.5Q966 1204 911 1221.5Q856 1239 792 1239Q676 1239 588.5 1181Q501 1123 452.5 1012.5Q404 902 404 744Q404 583 453 473Q502 363 589 307Q676 251 791 251Q855 251 909.5 268.5Q964 286 1007.5 319.5Q1051 353 1079.5 401Q1108 449 1119 510L1428 510Q1416 406 1366.5 311Q1317 216 1235 141Q1153 66 1040 23Q927 -20 786 -20Z' }),
  D: Object.freeze({ cx: 760, d: 'M659 0L273 0L273 263L644 263Q788 263 885.5 314Q983 365 1032 472Q1081 579 1081 746Q1081 912 1031.5 1018.5Q982 1125 885.5 1176Q789 1227 646 1227L266 1227L266 1490L664 1490Q888 1490 1049.5 1400.5Q1211 1311 1298 1144.5Q1385 978 1385 746Q1385 513 1298 346Q1211 179 1048.5 89.5Q886 0 659 0ZM440 1490L440 0L135 0L135 1490Z' }),
  E: Object.freeze({ cx: 634.5, d: 'M135 0L135 1490L1132 1490L1132 1237L440 1237L440 877L1080 877L1080 628L440 628L440 253L1134 253L1134 0Z' }),
  F: Object.freeze({ cx: 625, d: 'M135 0L135 1490L1115 1490L1115 1237L440 1237L440 821L1049 821L1049 572L440 572L440 0Z' }),
  G: Object.freeze({ cx: 766, d: 'M795 -20Q586 -20 428.5 72.5Q271 165 182.5 336.5Q94 508 94 743Q94 985 186 1156.5Q278 1328 435 1419Q592 1510 788 1510Q914 1510 1022.5 1473.5Q1131 1437 1215.5 1370Q1300 1303 1353.5 1211.5Q1407 1120 1423 1009L1113 1009Q1097 1063 1068.5 1105.5Q1040 1148 999.5 1178Q959 1208 907 1223.5Q855 1239 793 1239Q678 1239 590 1181.5Q502 1124 453 1014Q404 904 404 746Q404 588 452.5 477.5Q501 367 589 309Q677 251 797 251Q905 251 982 290Q1059 329 1100.5 401.5Q1142 474 1142 571L1206 562L818 562L818 794L1438 794L1438 608Q1438 412 1355 271.5Q1272 131 1127 55.5Q982 -20 795 -20Z' }),
  unknown: Object.freeze({ cx: 564, d: 'M390 458L390 482Q390 609 412.5 682Q435 755 477.5 798.5Q520 842 582 879Q649 923 695 974Q741 1025 741 1098Q741 1150 716.5 1188Q692 1226 651 1247Q610 1268 559 1268Q511 1268 468 1247Q425 1226 397.5 1185Q370 1144 367 1083L79 1083Q81 1227 146.5 1321.5Q212 1416 321 1463Q430 1510 560 1510Q704 1510 814 1462Q924 1414 986.5 1324Q1049 1234 1049 1108Q1049 980 989 895Q929 810 826 749Q769 715 731.5 680.5Q694 646 676 600Q658 554 658 482L658 458ZM525 -19Q447 -19 397 28Q347 75 347 150Q347 226 397 273Q447 320 525 320Q604 320 653 273Q702 226 702 150Q702 75 653 28Q604 -19 525 -19Z' }),
});

/** Inter's cap height, in its own em units. The `A` box top, measured. */
const INTER_CAP_HEIGHT = 1490;

/**
 * Cap height of a badge letter, in the 96-unit box.
 *
 * Every letter is scaled by CAP HEIGHT, not by its own bounding box, and set on
 * a shared baseline. That is what makes the eight read as one family: a C is
 * round and overshoots, an E is flat and does not, and forcing both to the same
 * box would undo the compensation the type designer built in.
 */
const DPE_CAP_PX = 42;
/** Baseline, and the horizontal centre every letter is centred on. */
const DPE_BASELINE_Y = 70;
const DPE_CENTRE_X = 48;
/** Font units per box unit — the scale the outlines are placed at. */
const DPE_SCALE = DPE_CAP_PX / INTER_CAP_HEIGHT;

/**
 * Halo width for a letter, in box units.
 *
 * Deliberately narrower than {@link HALO_STROKE_PX}. The halo strokes the
 * outline, so half of it falls INSIDE the letter and eats into the counters —
 * at 12 the bowl of the A closes and the badge reads as a filled triangle. At 5
 * every counter survives, checked at 15 px, which is the size that decides it.
 */
const DPE_LETTER_HALO_PX = 5;

/**
 * Bodies, as pure geometry, all authored to the 96-unit box.
 *
 * `strokes` are line-art in both passes; `fills` are solid in the glyph pass
 * and merely fattened in the halo pass.
 */
const BODIES = Object.freeze({
  // ── DVF: the euro sign, and nothing else. A coin outline was tried first
  //    and the ring closed up into a filled blob at 16 px — the bars of the €
  //    are the read, and a circle around them is ink competing with them.
  //    The arc is the long way round (large-arc), which is what makes it a €
  //    rather than a C: the two bars need somewhere to cross.
  euro: {
    strokes: 'M71,23 A30,30 0 1 0 71,73 M20,40 L60,40 M20,56 L60,56',
    fills: '',
  },

  // ── Géorisques: the hazard triangle. Universal, and the only glyph in this
  //    pack with a pointed top, which is what carries it at small size.
  hazard: {
    strokes: 'M48,16 L84,76 L12,76 Z M48,38 L48,56',
    // The bang's dot as a fill, not a zero-length stroke: a round cap on an
    // empty segment is not drawn by every rasteriser.
    fills: '<circle cx="48" cy="67" r="4.5"/>',
  },

  // ── Urbanisme: a plan sheet with a parcel line across it. A zoning rule is
  //    a DRAWING about ground rather than a thing standing on it, so it gets
  //    the sheet rather than a pin.
  plan: {
    strokes: 'M16,20 L80,20 L80,76 L16,76 Z M16,45 L80,45 M47,45 L47,76',
    fills: '',
  },
});

/**
 * The two passes that draw one badge letter, placed from the stored outline.
 *
 * The transform is where the font's em space becomes the 96-unit box, and it
 * lives here rather than in the stored `d` so that what is vendored stays
 * verifiably Inter's: `translate` puts the baseline at {@link DPE_BASELINE_Y}
 * and centres the glyph's own bounding box on {@link DPE_CENTRE_X}, `scale`
 * takes cap height to {@link DPE_CAP_PX} and flips y, because a font measures
 * upward from its baseline and SVG measures downward from the top.
 *
 * The halo width is divided by the scale for the same reason it exists at all:
 * a stroke inside a scaled group is scaled with it, so the number written into
 * the markup is in FONT units and {@link DPE_LETTER_HALO_PX} is what lands.
 *
 * @param {string} letter A key of {@link DPE_LETTER_OUTLINES}.
 * @returns {{halo: string, fill: string}} Two `<g>` elements.
 */
function dpeLetterPasses(letter) {
  const outline = DPE_LETTER_OUTLINES[letter] || DPE_LETTER_OUTLINES.unknown;
  const tx = DPE_CENTRE_X - outline.cx * DPE_SCALE;
  const transform = `translate(${tx.toFixed(3)} ${DPE_BASELINE_Y})`
    + ` scale(${DPE_SCALE.toFixed(8)} ${(-DPE_SCALE).toFixed(8)})`;
  const path = `<path d="${outline.d}"/>`;
  const haloFontUnits = (DPE_LETTER_HALO_PX / DPE_SCALE).toFixed(1);
  return {
    // Filled AND stroked: the fill is the letter, the stroke is the halo that
    // grows out of its edge. Multiplying a tint into black leaves black, so
    // both survive `billboard.color`.
    halo: `<g transform="${transform}" fill="rgba(0,0,0,0.62)"`
      + ` stroke="rgba(0,0,0,0.62)" stroke-width="${haloFontUnits}"`
      + ` stroke-linejoin="round">${path}</g>`,
    fill: `<g transform="${transform}" fill="#ffffff" stroke="none">${path}</g>`,
  };
}

/** @type {Map<string, string>} cache key → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/** Every register this pack draws a silhouette for. */
export const ADDRESS_GLYPH_KINDS = Object.freeze([
  ...Object.keys(BODIES),
  ...Object.keys(DPE_LETTER_OUTLINES).map((letter) => `dpe:${letter}`),
]);

/**
 * Fold a published DPE grade onto a drawable letter.
 *
 * Anything outside A–G — absent, empty, or a value the register invented after
 * this shipped — draws the question mark rather than the nearest letter.
 * Guessing a grade is the one thing this layer must never do.
 *
 * @param {?string} label Published `etiquette_dpe`.
 * @returns {string} A key of {@link DPE_LETTER_OUTLINES}.
 */
export function dpeLetterKind(label) {
  const letter = String(label ?? '').toUpperCase();
  return Object.hasOwn(DPE_LETTER_OUTLINES, letter) && letter !== 'UNKNOWN'
    ? letter
    : 'unknown';
}

/**
 * The transit class an IDFM mode borrows its pictogram from.
 *
 * A stop is signed in the street with its MODE's pictogram — the bus on the
 * pole, the M on the entrance — so the stops reuse `transitVehicleIcons.js`
 * rather than inventing a second transit vocabulary for the same city. The
 * one substitution: IDFM's `cableway` is the class that module keys as
 * `aerial` — which draws Maki's `aerialway`, not a Material Symbol. Nothing
 * here needs to know that; it asks for a class and gets whatever artwork the
 * transit pack has decided reads best.
 *
 * @param {?string} mode IDFM mode from `idfmFeed.js`.
 * @returns {string} A vehicle class for `transitVehicleGlyph()`.
 */
export function idfmStopGlyphKind(mode) {
  return String(mode) === 'cableway' ? 'aerial' : String(mode ?? '');
}

/**
 * Data URI for one register's silhouette, lazily built and cached.
 *
 * @param {string} kind `euro`, `hazard`, `plan`, or `dpe:<A–G|unknown>`.
 * @param {Object} [options]
 * @param {number} [options.px] Raster size.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function addressMarkerGlyph(kind, { px = ADDRESS_GLYPH_RASTER_PX } = {}) {
  const key = String(kind);
  const cacheKey = `${key}@${px}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  let frame = '';
  let strokes = '';
  let fills = '';
  let letterHalo = '';
  let letterFill = '';
  if (key.startsWith('dpe:')) {
    // The frame is what makes a bare letter read as a LABEL rather than as a
    // stray character over a roof, and it is drawn as a THIN stroke while the
    // letter is a solid fill, so the grade still owns the glyph at 16 px.
    frame = '<rect x="13" y="13" width="70" height="70" rx="17"/>';
    ({ halo: letterHalo, fill: letterFill } = dpeLetterPasses(dpeLetterKind(key.slice(4))));
  } else {
    const body = BODIES[key] || BODIES.plan;
    strokes = body.strokes;
    fills = body.fills;
  }
  const strokePath = strokes ? `<path d="${strokes}"/>` : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${VIEW} ${VIEW}">`
    // Halo first: every part of the glyph at once, fattened and dark.
    // Multiplying a tint into black leaves black, so this survives
    // `billboard.color` and keeps white line-art off a white roof.
    + `<g fill="none" stroke="rgba(0,0,0,0.62)" stroke-width="${HALO_STROKE_PX}"`
    + ` stroke-linecap="round" stroke-linejoin="round">${frame}${strokePath}${fills}</g>`
    + letterHalo
    + (frame
      ? `<g fill="none" stroke="#ffffff" stroke-width="${FRAME_STROKE_PX}"`
        + ` stroke-linejoin="round">${frame}</g>`
      : '')
    + `<g fill="none" stroke="#ffffff" stroke-width="${LINE_STROKE_PX}"`
    + ` stroke-linecap="round" stroke-linejoin="round">${strokePath}</g>`
    + `<g fill="#ffffff" stroke="none">${fills}</g>`
    + letterFill
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/** Raw geometry, for tests that assert the silhouettes actually differ. */
export function _addressGlyphBodiesForTest() {
  return { bodies: BODIES, letters: DPE_LETTER_OUTLINES };
}
