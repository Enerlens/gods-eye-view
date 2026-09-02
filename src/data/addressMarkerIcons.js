/**
 * @module addressMarkerIcons
 *
 * WHICH REGISTER a marker comes from, drawn as a silhouette.
 *
 * The six French address layers all answer a question about the SAME
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
 *   - **A tower crane** for the autorisations d'urbanisme. The sheet is the
 *     rule; the crane is what turns up when someone is allowed to act on it.
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
 * leaves blank.
 *
 * Drawn as stroke geometry rather than set as SVG `<text>`: text inside an SVG
 * loaded as an IMAGE resolves against whatever font the browser happens to
 * pick, which is not a thing to bet a legend on. Every letter lives in the
 * same x∈[32,64], y∈[28,70] box so the seven read as one family — an F and an
 * E differ by one bar and nothing else, exactly as they do on the label.
 */
const DPE_LETTER_STROKES = Object.freeze({
  A: 'M33,70 L48,28 L63,70 M39,58 L57,58',
  B: 'M35,28 L35,70 M35,28 L52,28 A10,10 0 0 1 52,48 L35,48 M35,48 L54,48 A11,11 0 0 1 54,70 L35,70',
  C: 'M62,37 A21,21 0 1 0 62,61',
  D: 'M35,28 L35,70 M35,28 L48,28 A21,21 0 0 1 48,70 L35,70',
  E: 'M62,28 L35,28 L35,70 L62,70 M35,49 L56,49',
  F: 'M62,28 L35,28 L35,70 M35,49 L56,49',
  G: 'M62,37 A21,21 0 1 0 62,61 M62,61 L62,50 L51,50',
  // Not "no letter" drawn as a blank frame, which would read as a rendering
  // failure. The register genuinely publishes rows with no grade.
  unknown: 'M36,40 A12,12 0 0 1 60,41 Q60,52 48,56 L48,60 M48,69 L48,69',
});

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

  // ── ADS: a tower crane. The urbanism layer next door already owns the sheet
  //    (`plan`), and a permit is not a rule about ground — it is the thing
  //    that arrives on it.
  //
  //    STRONGLY ASYMMETRIC, and that is the whole design. The first version
  //    centred the mast under a full-width jib and added a base bar; measured
  //    in the running app at 17 px it read as a serif **T** — the base
  //    vanished into the mast, and a symmetrical cross-bar is a letter, not a
  //    machine. So the jib now overhangs the mast by 8 units on one side and
  //    60 on the other, the mast carries on ABOVE it as a cathead, and the
  //    hoist drops a third of the glyph's height. What survives at marker size
  //    is a Γ with something hanging off it, which nothing else in this pack
  //    or in the transit pack looks like.
  crane: {
    strokes: 'M26,88 L26,16 M18,24 L86,24 M68,24 L68,56',
    // The hook block as a fill: a stroked stub of this length closes up into
    // the hoist line at raster size, and the weight on the end of the cable is
    // what stops the drop reading as a stray tick.
    fills: '<rect x="61" y="56" width="15" height="10" rx="2"/>',
  },
});

/** @type {Map<string, string>} cache key → data URI. */
const _cache = new Map();

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/** Every register this pack draws a silhouette for. */
export const ADDRESS_GLYPH_KINDS = Object.freeze([
  ...Object.keys(BODIES),
  ...Object.keys(DPE_LETTER_STROKES).map((letter) => `dpe:${letter}`),
]);

/**
 * Fold a published DPE grade onto a drawable letter.
 *
 * Anything outside A–G — absent, empty, or a value the register invented after
 * this shipped — draws the question mark rather than the nearest letter.
 * Guessing a grade is the one thing this layer must never do.
 *
 * @param {?string} label Published `etiquette_dpe`.
 * @returns {string} A key of {@link DPE_LETTER_STROKES}.
 */
export function dpeLetterKind(label) {
  const letter = String(label ?? '').toUpperCase();
  return Object.hasOwn(DPE_LETTER_STROKES, letter) && letter !== 'UNKNOWN'
    ? letter
    : 'unknown';
}

/**
 * The transit class an IDFM mode borrows its pictogram from.
 *
 * A stop is signed in the street with its MODE's pictogram — the bus on the
 * pole, the M on the entrance — so the stops reuse `transitVehicleIcons.js`
 * rather than inventing a second transit vocabulary for the same city. The
 * one substitution: IDFM's `cableway` is Material's `cable_car`, which that
 * module keys as `aerial`.
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
  if (key.startsWith('dpe:')) {
    // The frame is what makes a bare letter read as a LABEL rather than as a
    // stray character over a roof, and it is drawn thinner than the letter so
    // the grade still owns the glyph at 16 px.
    frame = '<rect x="13" y="13" width="70" height="70" rx="17"/>';
    strokes = DPE_LETTER_STROKES[dpeLetterKind(key.slice(4))];
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
    + (frame
      ? `<g fill="none" stroke="#ffffff" stroke-width="${FRAME_STROKE_PX}"`
        + ` stroke-linejoin="round">${frame}</g>`
      : '')
    + `<g fill="none" stroke="#ffffff" stroke-width="${LINE_STROKE_PX}"`
    + ` stroke-linecap="round" stroke-linejoin="round">${strokePath}</g>`
    + `<g fill="#ffffff" stroke="none">${fills}</g>`
    + '</svg>';

  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _cache.set(cacheKey, uri);
  return uri;
}

/** Raw geometry, for tests that assert the silhouettes actually differ. */
export function _addressGlyphBodiesForTest() {
  return { bodies: BODIES, letters: DPE_LETTER_STROKES };
}
