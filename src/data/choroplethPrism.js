// src/data/choroplethPrism.js
/**
 * The départemental PRISM — the shared grammar that replaces a flat count
 * choropleth with a two-variable volume: HEIGHT carries the absolute count,
 * HUE carries the rate.
 *
 * This module is pure arithmetic and strings. No Cesium, no DOM, no fetch, so
 * it runs identically in the browser, in the Vite proxy and under
 * `node --test`. It draws nothing: it is the SPECIFICATION four layers
 * (`irve-fr`, `schools-fr`, `sup-fr`, `franceEnergy`) implement, and the place
 * where the arbitrations below are written down once instead of four times.
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 *
 * Three layers paint an ABSOLUTE COUNT as a colour fill on the same 96
 * département polygons: charge points (`irve-fr`, 227 → 10 539), schools
 * (`schools-fr`), students (`sup-fr`, 2.96 M over ~30 cities). The corpus names
 * this exact figure twice, in capitals:
 *
 *   « Représentation d'une variable quantitative absolue en aplats de couleur
 *     — NOP !!!! »
 *   « L'une des erreurs sémiologiques les plus courantes que l'on peut
 *     rencontrer sur le géoweb. »
 *
 * Each of the three headers argues its choice, and the argument is real: the
 * density alternative covers a factor of 2 300 and leaves 95 départements
 * indistinguishable. But the alternative they compare against is always
 * "count fill vs. rate fill" — one channel, two candidates, one loser. On a
 * globe there is a second channel and it is empty.
 *
 * ── The channel that was empty ──────────────────────────────────────────────
 *
 * `extrudedHeight` appeared ONCE in the whole of `src/data` when this module was
 * written — `bdtopoBuildings.js:637`, and there it is a building's real height,
 * not a thematic variable. (Recounted 2026-09-03 after the four prism layers
 * landed: seven writes and five clears across `bdtopoBuildings`, `sitadelFrance`,
 * `localGeojson` and the four consumers of this module. The sentence above is
 * kept in the past tense because it is the argument for this file existing, not
 * a live census — `docs/REPRESENTATION.md` holds the current one.)
 * CARTOGRAPHIE B2 already prescribes the fix and nobody had read it as one:
 *
 *   « Le quantitatif doit migrer sur un canal orthogonal à la profondeur :
 *     anneau de rayon fixe en pixels, valeur/luminance, ou HAUTEUR
 *     D'EXTRUSION lue contre un guide vertical. »
 *
 * ── A3 · what each channel carried, and what it carries now ─────────────────
 *
 *   FILL HUE   before: the absolute count, in quantile bins (B1 violation).
 *              now:    the RATE — density, share, per-capita — a ratio, which
 *                      is the one thing a colour fill is allowed to say.
 *   HEIGHT     before: nothing. The axis existed and was unused.
 *              now:    the absolute count, linearly, against a common datum.
 *   FILL ALPHA before: a compositing correction. `choroplethAlpha.js` runs a
 *              DESCENDING ladder so that the ramp's own lightness ordering
 *              survives being blended over unknown imagery.
 *              now:    CONSTANT — see {@link PRISM_BODY_ALPHA}. A prism body is
 *                      composited over the sky and over other prisms, not over
 *                      the basemap, so the correction has no object here and
 *                      alpha stops encoding anything. Do NOT import the
 *                      `choroplethAlpha` ladder into a prism: it would put a
 *                      second, mismatched ordering on a channel that now
 *                      carries none.
 *
 * ── C1 · the domain is frozen, and it is not the sample ─────────────────────
 *
 * {@link createPrismScale} takes `domainMax` as a literal the layer measured
 * ONCE and published in its own header. It is never re-derived from what is on
 * screen and never from what a poll happened to return, so the same
 * département is the same height in every session and every share link. The
 * price is stated rather than hidden: a value above the frozen domain is
 * CLIPPED to the top of the scale, {@link prismRow} flags it, and
 * {@link prismLegend} publishes the count of clipped units — A5.
 *
 * Note what freezing the domain removes. `franceDepartements.countBins()`
 * recomputes quantiles from the rows in hand on every load; a poll that lost a
 * stripe silently moves every boundary. A frozen `domainMax` cannot do that.
 *
 * ── The height scale: linear, and why not sqrt by default ───────────────────
 *
 * The default mode is `'linear'`. Three reasons, in order of weight:
 *
 * 1. The mark is a LENGTH, not an area. The square-root correction belongs to
 *    proportional CIRCLES, where the mark grows in two dimensions and the eye
 *    judges area — which is why `edfPowerPlants.js` is right to write "l'aire
 *    plutôt que le rayon porte les mégawatts". A prism's base is fixed by the
 *    département; only the height moves; the height grows in one dimension.
 *    Applying the circle correction here corrects a bias that is not present,
 *    and it under-states every ratio in the data.
 * 2. Length is the visual variable the eye judges best — the top of Cleveland
 *    & McGill's ranking, above angle, area and colour — but only if the ruler
 *    is uniform. A square-root ruler puts its ticks at 100 %, 25 % and 1 % of
 *    the domain for the tops at 100 %, 50 % and 10 % of the height. Nobody
 *    reads that off a map without the legend in hand, which defeats D1's whole
 *    point (a legend one can decode WITH the map, not instead of it).
 * 3. It is the mode that survives a screenshot. Linear heights can be compared
 *    with a ruler on a printed frame; a compressed scale cannot.
 *
 * `'sqrt'` is provided and must be DECLARED, because there is one case where
 * linear stops saying anything: a domain whose dynamic range exceeds roughly
 * 1 : 30, at which point the bottom of the distribution sits under the visible
 * floor and {@link PRISM_MIN_HEIGHT_M} does all the work — which is a lie by
 * flooring, not a scale. `irve-fr` runs 227 → 10 539 (1 : 46; Lozère lands at
 * 2.6 km linear, under the 4 km floor). `sup-fr` is worse by an order of
 * magnitude. A layer that chooses `'sqrt'` gets {@link prismLegend} to say so
 * in the height blurb, in French, unprompted.
 *
 * ── The hard problem: same height, different base areas ─────────────────────
 *
 * A prism is a VOLUME, and volume = base × height. Measured on this repo's own
 * bundled geometry (`local_data/france_departements/departements.geojson`, 96
 * features, spherical area per ring): Paris is 104 km², Gironde is 10 077 km²
 * — a factor of 97. At equal count and equal height, the Gironde prism has
 * ninety-seven times the Paris prism's mass. If the eye reads mass, it reads
 * the count wrong, and it reads it wrong in a direction correlated with
 * rurality. This is a real semiological defect and it is not solved by
 * pretending the reader looks only at the top face.
 *
 * Three ways out were weighed:
 *
 * (a) NORMALISE THE HEIGHT by the base area, so volume ∝ count. Rejected, and
 *     not narrowly: h ∝ count / area IS the density. It does not fix the
 *     misreading, it silently changes which variable is drawn, and it puts a
 *     ratio back on the size channel that B1 reserves for the absolute.
 *
 * (b) NORMALISE THE BASE — one fixed-radius column per département, at its
 *     centroid. Exact (volume ∝ count), and it is the honest 3D bar chart. It
 *     is rejected as the DEFAULT because it stops being a map: the polygon,
 *     the only thing that makes this a choropleth rather than a chart on a
 *     backdrop, disappears; and eight columns collide in Île-de-France, which
 *     is precisely where the values are. It stays on the table as the escape
 *     hatch for a domain concentrated in a few points — `sup-fr`, where
 *     REPRESENTATION.md already proposes a Dorling.
 *
 * (c) KEEP THE POLYGON BASE, KEEP THE HEIGHT LINEAR, AND MAKE THE MISREADING
 *     CHECKABLE. This is what ships, and it rests on the bivariate pairing:
 *     the single question a volume misreading produces — "is this pile big
 *     because the territory is big?" — is answered by the COLOUR of the same
 *     prism, because the colour is the rate. A wide rural département with a
 *     large count reads TALL AND PALE. Paris reads TALL AND SATURATED. The two
 *     variables are not decoration for each other; the second is the audit of
 *     the first.
 *
 *     Two rendering conventions carry the rest, and the four layers owe them:
 *     the reading instrument is the TOP EDGE against a common datum, so the
 *     body is translucent ({@link PRISM_BODY_ALPHA}) and the top face and
 *     silhouette are near-opaque ({@link PRISM_TOP_ALPHA}); and every prism
 *     starts at the SAME base ({@link PRISM_BASE_HEIGHT_M}), so tops are
 *     comparable.
 *
 *     WHAT THIS COSTS, stated plainly: a reader who reads mass rather than the
 *     top edge over-reads large rural départements. The prism does not remove
 *     the areal bias of a choropleth — it moves it from the fill to the volume
 *     — but unlike the flat fill it hands the reader a second channel with
 *     which to catch it, and {@link prismLegend} writes the caveat on the map.
 *
 * ── Calibration: how tall, and how that was computed ────────────────────────
 *
 * The frustum: Cesium's default `fov` is 60° and it is the HORIZONTAL angle
 * whenever aspect > 1 — verified in the bundled build, `fovy` is derived as
 * `2·atan(tan(fov/2) / aspect)` (`Build/CesiumUnminified/index.js:197525`) and
 * the 60° default is set at `:212101`. On a 1600 × 1000 viewport that gives
 * fovy = 39.68° = 0.6928 rad, i.e. 1 443.8 px per radian vertically.
 *
 * The altitude: the three count layers enter their national regime on a view
 * latitude span ≥ 9.5° (metropolitan France is 9.8° tall). A 9.5° span is
 * 1 057 km on the ground, and 2·d·tan(fovy/2) = 1 057 km solves to
 * d ≈ 1 465 km. So "national altitude" is ~1 500 km, and that is the distance
 * everything below is calibrated at. France is then 929 px wide in a 1600 px
 * frame — the whole country, filling the view.
 *
 * At d = 1 500 km, apparent height = 1 443.8 · 2·atan(h / 2d):
 *
 *     h = 120 km  →  115.4 px   the tallest prism
 *     h =  60 km  →   57.7 px   half the domain
 *     h =   4 km  →    3.9 px   the floor
 *     Mont Blanc (4 808 m)  →  4.6 px   ← the whole relief of France
 *
 * {@link PRISM_MAX_HEIGHT_M} = 120 km. Upper bound: 115 px is 11.5 % of the
 * frame height and 1.7× the on-screen width of an average département (70 km,
 * 67 px), which is a relief the eye sorts without effort; much taller and the
 * front row starts occluding the back row, which on a north-up oblique view
 * means Occitanie hiding Auvergne. Lower bound: below ~80 km the spread between
 * the median and the top of the domain falls under 40 px and the map is a flat
 * fill again. 120 km also sits just above the Kármán line, which is a feature
 * rather than an accident — 25× the highest ground in France means no reader
 * can mistake a thematic volume for terrain.
 *
 * {@link PRISM_MIN_HEIGHT_M} = 4 km, i.e. 3.9 px at national altitude and
 * 14.4 px at a regional 400 km. This is the A1 floor: a département measured
 * at 1 must not be confusable with a département measured at nothing. It costs
 * 3.3 % of the scale — every value under 3.3 % of `domainMax` is drawn at the
 * same height — and that is the sole reason `'sqrt'` exists.
 *
 * All of it is recomputable: {@link prismApparentPx} is the function these
 * figures came out of, and the test file re-derives every number above.
 *
 * ── Rendering notes for the four layers ─────────────────────────────────────
 *
 * ① AN EXTRUDED POLYGON CANNOT CLASSIFY. Verified in the bundled Cesium:
 *   `GroundGeometryUpdater.prototype._isOnTerrain` returns false as soon as
 *   `extrudedHeight` is defined (`index.js:148334-148336`). The entity is then
 *   built as an ordinary `Primitive`, and `polygon.classificationType` —
 *   which the three layers set today (`irveFrance.js:1117`) — is read into
 *   `_classificationTypeProperty` and never used. It does not throw. It stops
 *   mattering, SILENTLY. Do not keep setting it and assume it still works.
 *
 *   Consequence: the fill no longer drapes on terrain, nor on the
 *   photorealistic 3D tiles. That is ACCEPTABLE at national altitude, and it is
 *   more than acceptable — it is the correct behaviour:
 *
 *   · Scale. The whole relief of France is 4.8 km against a 120 km prism: 4 %
 *     of the mark's own height, 4.6 px against 115 px on screen.
 *   · Comparability, which is the real argument. Clamping the base to terrain
 *     would start the Savoie prism 2 km higher than the Landes prism, so its
 *     TOP would be 2 km higher at equal count. A height scale read against a
 *     common datum cannot afford a base that moves with the relief. Leaving
 *     the base on the ellipsoid ({@link PRISM_BASE_HEIGHT_M} = 0) is what makes
 *     the tops comparable at all. Terrain will poke through the bottom of an
 *     Alpine prism; that is the correct trade and it is visible, not hidden.
 *   · `perPositionHeight` MUST stay false, for the same reason.
 *
 * ② THE BATCHED-GROUNDPRIMITIVE COLOUR BUG DOES NOT FOLLOW US. A batched
 *   `GroundPrimitive` colours each instance by its bounding RECTANGLE, not by
 *   its polygon — documented in CARTOGRAPHIE and paid for by this repo already.
 *   An extruded polygon classifies nothing, has its own geometry, and takes
 *   per-instance colour exactly. Going 3D REMOVES this constraint instead of
 *   inheriting it.
 *
 * ③ THE PRISM GETS AN OUTLINE, WHICH THE FLAT FILL COULD NEVER HAVE. Cesium
 *   force-disables `outline` with a one-time warning whenever a polygon is on
 *   terrain (`index.js:61110-61113`). Off terrain, the outline is legal — so
 *   the silhouette and the top edge that the reading depends on are drawable.
 *
 * ④ THE PRISM IS AN OBLIQUE SIGN. At nadir a vertical extrusion projects to
 *   nearly nothing but parallax, so the height is unreadable straight down. The
 *   fallback is not a failure: the colour is still exact at nadir, because hue
 *   is the one variable perspective does not distort (CARTOGRAPHIE F4). A layer
 *   that wants the height read should say so — the same way `cctv.js` earns its
 *   oblique frusta.
 *
 * ⑤ FLAT CASES ARE STILL DRAWN, WITH THEIR OWN SIGNS. See {@link prismRow}:
 *   "no count" is an empty hatched footprint, "measured zero" is a filled flat
 *   footprint with a solid outline, and they must not look alike (A1/D3).
 */

// ---------------------------------------------------------------------------
// Calibration constants
// ---------------------------------------------------------------------------

/**
 * Height of the prism at the top of a layer's frozen domain, in metres.
 * 115.4 px at national altitude — see the header for the derivation, and
 * {@link prismApparentPx} for the function that produced it.
 */
export const PRISM_MAX_HEIGHT_M = 120_000;

/**
 * Shortest prism a NON-ZERO value may be drawn at, in metres.
 *
 * 3.9 px at national altitude: thin, but present, and that is the whole job.
 * A1 — a département measured at 1 must not render as a département with no
 * measurement. Costs 3.3 % of the scale to flooring.
 */
export const PRISM_MIN_HEIGHT_M = 4_000;

/**
 * Base of every prism, in metres above the ELLIPSOID (not above terrain).
 *
 * Zero, and shared by all 96, because a height scale needs a common datum:
 * see rendering note ① in the header before clamping this to the ground.
 */
export const PRISM_BASE_HEIGHT_M = 0;

/** Body opacity. Constant: alpha carries nothing here — see A3 in the header. */
export const PRISM_BODY_ALPHA = 0.62;

/** Top face and silhouette opacity. The top edge is the reading instrument. */
export const PRISM_TOP_ALPHA = 0.95;

/** The two height scales a layer may declare. */
export const PRISM_MODES = Object.freeze(['linear', 'sqrt']);

/**
 * Graphite for the legend's height bars.
 *
 * Deliberately ONE colour for all the height ticks: in those rows the datum is
 * the bar's HEIGHT, so the swatch colour has to be constant or it would be a
 * second, false encoding (A3).
 */
export const PRISM_HEIGHT_SWATCH_COLOR = '#c3ccd8';

/**
 * Colour of a prism whose RATE is unpublished. Desaturated graphite, and it is
 * only half the answer: D3 asks for a MOTIF, not a hue, because a hue on a
 * globe has no neutral. Pair it with {@link PRISM_NO_RATIO_GLYPH} in the
 * legend and with a striped material on the prism body.
 */
export const PRISM_NO_RATIO_COLOR = '#7a8493';

// ---------------------------------------------------------------------------
// Glyphs (legend swatches, masked by the caller — see manager.js:2451)
// ---------------------------------------------------------------------------

const _b64 = (text) => (typeof btoa === 'function'
  ? btoa(text)
  : Buffer.from(text, 'utf8').toString('base64'));

/** @type {Map<string, string>} cache key → data URI. */
const _glyphCache = new Map();

const GLYPH_VIEW_BOX = 16;

/**
 * A legend swatch shaped like a bar of the given height fraction.
 *
 * The mask keeps only the shape, so the fill colour here is irrelevant and the
 * caller's `color` is what shows — which is why every tick may share
 * {@link PRISM_HEIGHT_SWATCH_COLOR} without the swatch losing its meaning.
 * @param {number} fraction Bar height as a fraction of the tallest prism, 0..1.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function prismHeightGlyph(fraction) {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const key = clamped.toFixed(3);
  const cached = _glyphCache.get(`bar:${key}`);
  if (cached) return cached;
  // 1 px of baseline is always drawn, so a very short tick is a short bar and
  // never an empty swatch that would read as "no entry".
  const height = Math.max(1, clamped * (GLYPH_VIEW_BOX - 2));
  const y = GLYPH_VIEW_BOX - 1 - height;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_VIEW_BOX} ${GLYPH_VIEW_BOX}">`
    + `<rect x="5" y="${y.toFixed(2)}" width="6" height="${height.toFixed(2)}" fill="#000"/>`
    + '</svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set(`bar:${key}`, uri);
  return uri;
}

/**
 * Diagonal hatch, for the rows where a value is not published.
 *
 * A motif rather than a tint, per D3: on a photorealistic globe there is no
 * neutral colour, and a pattern is the one encoding that survives the NVG and
 * FLIR passes intact.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function prismHatchGlyph() {
  const cached = _glyphCache.get('hatch');
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_VIEW_BOX} ${GLYPH_VIEW_BOX}">`
    + '<g stroke="#000" stroke-width="2">'
    + '<path d="M-2 6L6 -2"/><path d="M-2 14L14 -2"/><path d="M2 18L18 2"/><path d="M10 18L18 10"/>'
    + '</g></svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set('hatch', uri);
  return uri;
}

/**
 * Grid, for a COUNT that was never published.
 *
 * The legend swatch has to be the mark the map actually draws, or it promises
 * a sign the reader will never find. The four prism layers paint a missing
 * count with a `GridMaterialProperty` at 6×6 and a missing ratio with a
 * `StripeMaterialProperty` — two motifs for two independent refusals — while
 * this key showed the same diagonal hatch for both, so a reader who saw a grid
 * could not tell which of the two absences they were looking at.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function prismGridGlyph() {
  const cached = _glyphCache.get('grid');
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_VIEW_BOX} ${GLYPH_VIEW_BOX}">`
    + '<g stroke="#000" stroke-width="1.6">'
    + '<path d="M0 5.33H16M0 10.67H16M5.33 0V16M10.67 0V16"/>'
    + '</g></svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set('grid', uri);
  return uri;
}

/**
 * Stripes, for a RATE that was never published — the `StripeMaterialProperty`
 * the prism body actually carries. See {@link prismGridGlyph}.
 * @returns {string} `data:image/svg+xml;base64,…`
 */
export function prismStripeGlyph() {
  const cached = _glyphCache.get('stripe');
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH_VIEW_BOX} ${GLYPH_VIEW_BOX}">`
    + '<g fill="#000">'
    + '<rect x="0" y="0" width="16" height="2.7"/><rect x="0" y="5.3" width="16" height="2.7"/>'
    + '<rect x="0" y="10.7" width="16" height="2.7"/></g></svg>';
  const uri = `data:image/svg+xml;base64,${_b64(svg)}`;
  _glyphCache.set('stripe', uri);
  return uri;
}

/** The hatch a layer shows for "rate not published". */
export const PRISM_NO_RATIO_GLYPH = prismHatchGlyph();

/** The grid the map draws for "count not published". */
export const PRISM_NO_VALUE_GLYPH = prismGridGlyph();

/** The stripes the map draws on a prism whose rate is refused. */
export const PRISM_NO_RATIO_BODY_GLYPH = prismStripeGlyph();

// ---------------------------------------------------------------------------
// Optics
// ---------------------------------------------------------------------------

/**
 * Apparent on-screen height, in pixels, of a vertical prism seen side-on.
 *
 * The function every calibration figure in the header came out of, exported so
 * the numbers are auditable rather than asserted. `fovRad` is Cesium's `fov`,
 * which is the HORIZONTAL angle when `aspect > 1` — the derived vertical angle
 * is `2·atan(tan(fov/2) / aspect)`, exactly as the engine computes it.
 *
 * @param {object} options
 * @param {number} options.heightM Prism height in metres.
 * @param {number} options.cameraDistanceM Camera-to-prism distance in metres.
 * @param {number} [options.viewportHeightPx=1000] Canvas height in pixels.
 * @param {number} [options.aspect=1.6] Canvas width / height.
 * @param {number} [options.fovRad=Math.PI/3] Cesium's `frustum.fov`.
 * @returns {number} Apparent height in pixels, or 0 for a degenerate input.
 */
export function prismApparentPx({
  heightM,
  cameraDistanceM,
  viewportHeightPx = 1000,
  aspect = 1.6,
  fovRad = Math.PI / 3,
} = {}) {
  const h = Number(heightM);
  const d = Number(cameraDistanceM);
  if (!Number.isFinite(h) || !Number.isFinite(d) || d <= 0 || h <= 0) return 0;
  const fovy = aspect <= 1 ? fovRad : 2 * Math.atan(Math.tan(fovRad / 2) / aspect);
  const pxPerRad = viewportHeightPx / fovy;
  return 2 * Math.atan(h / (2 * d)) * pxPerRad;
}

// ---------------------------------------------------------------------------
// The frozen scale
// ---------------------------------------------------------------------------

/**
 * Build a layer's frozen prism scale.
 *
 * Every argument is a literal the layer measured once and published in its own
 * header (C1). Nothing here is derived from a poll, from the viewport, or from
 * the rows in hand — that is the entire point, and the reason this throws
 * rather than coerces: a published scale that is wrong must fail at module
 * load, where an author sees it, not at paint time where a reader does not.
 *
 * @param {object} spec
 * @param {string} spec.id Layer id, for error messages and legend keys.
 * @param {number} spec.domainMax Top of the frozen domain, in `heightUnit`.
 * @param {number} [spec.domainMin=0] Bottom of the frozen domain.
 * @param {string} spec.heightLabel French name of the absolute variable.
 * @param {string} spec.heightUnit French unit appended to a tick value.
 * @param {'linear'|'sqrt'} [spec.mode='linear'] Height scale. See the header.
 * @param {number} [spec.maxHeightM] Height at `domainMax`.
 * @param {number} [spec.minHeightM] Floor for a non-zero value.
 * @param {string} spec.ratioLabel French name of the relative variable.
 * @param {Array<number>} spec.ratioBreaks Frozen class boundaries, ascending.
 * @param {Array<string>} spec.ratioColors CSS colours, `ratioBreaks.length + 1`.
 * @param {Array<string>} [spec.ratioClassLabels] Per-class French labels.
 * @param {Array<number>} [spec.heightTicks] Explicit legend ticks, descending.
 * @returns {object} Deeply frozen scale, consumed by everything below.
 */
export function createPrismScale(spec = {}) {
  const {
    id,
    domainMax,
    domainMin = 0,
    heightLabel,
    heightUnit,
    mode = 'linear',
    maxHeightM = PRISM_MAX_HEIGHT_M,
    minHeightM = PRISM_MIN_HEIGHT_M,
    ratioLabel,
    ratioBreaks,
    ratioColors,
    ratioClassLabels,
    heightTicks,
  } = spec;

  const fail = (message) => { throw new TypeError(`createPrismScale(${id ?? '?'}): ${message}`); };

  if (typeof id !== 'string' || !id) fail('an id is required');
  if (!PRISM_MODES.includes(mode)) fail(`mode must be one of ${PRISM_MODES.join(', ')}`);
  // The height channel is a MAGNITUDE, so the domain floor cannot be negative:
  // a signed quantity (franceEnergy's import/export balance in MW) passes
  // |value| here and puts the sign on the colour, which is what a diverging
  // ramp is for. Allowing a negative floor would make `heightM === 0` mean
  // "bottom of the domain" instead of "measured zero", and prismRow's
  // A1 contract rests on that equality.
  if (!Number.isFinite(domainMin) || domainMin < 0) fail('domainMin must be finite and >= 0');
  if (!Number.isFinite(domainMax) || domainMax <= domainMin) {
    fail('domainMax must be finite and above domainMin');
  }
  if (!Number.isFinite(maxHeightM) || maxHeightM <= 0) fail('maxHeightM must be positive');
  if (!Number.isFinite(minHeightM) || minHeightM < 0) fail('minHeightM must be >= 0');
  if (minHeightM >= maxHeightM) fail('minHeightM must be below maxHeightM');
  if (typeof heightLabel !== 'string' || !heightLabel) fail('heightLabel is required');
  if (typeof heightUnit !== 'string' || !heightUnit) fail('heightUnit is required');
  if (typeof ratioLabel !== 'string' || !ratioLabel) fail('ratioLabel is required');
  if (!Array.isArray(ratioBreaks) || !ratioBreaks.length) fail('ratioBreaks is required');
  if (!ratioBreaks.every((v) => Number.isFinite(v))) fail('ratioBreaks must all be finite');
  for (let i = 1; i < ratioBreaks.length; i += 1) {
    // A tie would leave an unreachable class in the legend — a colour a reader
    // is told to look for and can never find.
    if (ratioBreaks[i] <= ratioBreaks[i - 1]) fail('ratioBreaks must be strictly ascending');
  }
  if (!Array.isArray(ratioColors) || ratioColors.length !== ratioBreaks.length + 1) {
    fail(`ratioColors must hold ${ratioBreaks.length + 1} colours for ${ratioBreaks.length} breaks`);
  }
  if (ratioClassLabels && ratioClassLabels.length !== ratioColors.length) {
    fail('ratioClassLabels must match ratioColors in length');
  }
  if (heightTicks && !heightTicks.every((v) => Number.isFinite(v) && v > domainMin)) {
    fail('heightTicks must be finite and inside the domain');
  }

  return Object.freeze({
    id,
    mode,
    domainMin,
    domainMax,
    maxHeightM,
    minHeightM,
    heightLabel,
    heightUnit,
    ratioLabel,
    ratioBreaks: Object.freeze([...ratioBreaks]),
    ratioColors: Object.freeze([...ratioColors]),
    ratioClassLabels: ratioClassLabels ? Object.freeze([...ratioClassLabels]) : null,
    heightTicks: heightTicks
      ? Object.freeze([...heightTicks].sort((a, b) => b - a))
      : Object.freeze(defaultHeightTicks(domainMin, domainMax)),
  });
}

/**
 * Three round ticks inside the domain, tallest first.
 *
 * Rounded on purpose — the corpus asks for « bornes arrondies et faciles à
 * lire », and 10 000 is a number a reader carries where 10 539 is one they
 * copy. The top tick is the largest 1/2/5 × 10^k at or under `domainMax`, then
 * half of it, then a tenth of it.
 * @param {number} domainMin
 * @param {number} domainMax
 * @returns {Array<number>} Up to three descending tick values.
 */
function defaultHeightTicks(domainMin, domainMax) {
  const span = domainMax - domainMin;
  const magnitude = 10 ** Math.floor(Math.log10(span));
  const top = [5, 2, 1].map((m) => m * magnitude).find((v) => v <= span) ?? magnitude;
  const ticks = [top, top / 2, top / 10]
    .map((v) => domainMin + v)
    .filter((v) => v > domainMin && v <= domainMax);
  return [...new Set(ticks)];
}

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------

/**
 * Extrusion height in metres for one absolute value.
 *
 * The contract, and it is the one the four layers are tested against:
 *
 *   value ABSENT (null, undefined, NaN, non-numeric, negative)  →  `null`
 *   value === 0 (a MEASURED zero)                               →  `0`
 *   value > 0                                                   →  `[minHeightM, maxHeightM]`
 *
 * `null` and `0` are different facts and must stay different marks: NEVER
 * coalesce the return with `?? 0` or `|| 0`. "We did not measure this" and "we
 * measured this and it is nothing" are the two cases A1 exists for.
 *
 * A negative value is treated as ABSENT rather than clamped, because on a
 * count domain it can only be a bad parse. A layer with a genuinely signed
 * quantity — `franceEnergy`'s import/export balance in MW — passes `|value|`
 * here and puts the SIGN on the colour channel, which is what a diverging
 * ramp is for.
 *
 * @param {number|null|undefined} value Absolute value in the scale's unit.
 * @param {object} scale From {@link createPrismScale}.
 * @returns {number|null} Metres, or null when nothing was measured.
 */
export function prismHeightM(value, scale) {
  assertScale(scale);
  // Only a number or a numeric string counts as a measurement. `Number([])`
  // is 0 and `Number(true)` is 1 — coercing those would invent a measured zero
  // out of a malformed row, which is the one thing this contract must not do.
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const v = Number(value);
  if (value === '' || !Number.isFinite(v)) return null;
  if (v < scale.domainMin) return null;
  if (v === scale.domainMin) return 0;
  const span = scale.domainMax - scale.domainMin;
  const t = Math.min(1, (v - scale.domainMin) / span);
  const shaped = scale.mode === 'sqrt' ? Math.sqrt(t) : t;
  return Math.max(scale.minHeightM, shaped * scale.maxHeightM);
}

/** True when a value sits above the frozen domain and is therefore clipped (A5). */
export function prismIsClipped(value, scale) {
  assertScale(scale);
  const v = Number(value);
  return Number.isFinite(v) && v > scale.domainMax;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Class index for one RATE, against the scale's frozen breaks.
 *
 * @param {number|null|undefined} ratio Rate, density, share — a ratio.
 * @param {object} scale From {@link createPrismScale}.
 * @returns {number} 0-based class, or -1 when the rate is not published.
 */
export function prismRatioBin(ratio, scale) {
  assertScale(scale);
  if (typeof ratio !== 'number' && typeof ratio !== 'string') return -1;
  const v = Number(ratio);
  if (ratio === '' || !Number.isFinite(v)) return -1;
  const breaks = scale.ratioBreaks;
  for (let i = 0; i < breaks.length; i += 1) {
    if (v <= breaks[i]) return i;
  }
  return breaks.length;
}

/**
 * Colour for one rate, or `null` when the rate is not published.
 *
 * `null` rather than a grey, so the caller has to make the "unpublished"
 * decision explicitly instead of inheriting a colour that would sit inside the
 * ramp's own family (D3 — the missing class needs a motif, not a tint).
 * @param {number|null|undefined} ratio
 * @param {object} scale
 * @returns {string|null} CSS colour, or null.
 */
export function prismRatioColor(ratio, scale) {
  const bin = prismRatioBin(ratio, scale);
  return bin < 0 ? null : scale.ratioColors[Math.min(bin, scale.ratioColors.length - 1)];
}

// ---------------------------------------------------------------------------
// The bivariate row
// ---------------------------------------------------------------------------

/**
 * Turn one département's `(code, value, ratio)` into everything a layer needs
 * to draw it — and refuse, separately, whichever half was not measured.
 *
 * The two absences are INDEPENDENT and must be visible independently (A1), so
 * the four states each get their own mark. The layers owe these:
 *
 *   value ✓ ratio ✓ → prism at `heightM`, body in `color`.
 *   value ✓ ratio ✗ → prism at `heightM`, body STRIPED
 *                     ({@link PRISM_NO_RATIO_COLOR} / {@link PRISM_NO_RATIO_GLYPH}).
 *                     The height is readable; the colour is explicitly refused.
 *   value ✗ ratio ✓ → NO prism. The footprint is drawn EMPTY — outline only,
 *                     hatched, `extrudedHeight` left undefined. It must not be
 *                     filled, or it becomes case four.
 *   value ✗ ratio ✗ → nothing but the hatched outline.
 *
 * And the case that is not an absence at all:
 *
 *   value === 0     → `heightM === 0`, `measuredZero === true`. A FILLED flat
 *                     footprint with a SOLID outline, in `color`. "There is a
 *                     floor here and it is zero" is a measurement; drawing it
 *                     like a missing value would be the exact A1 fault this
 *                     module exists to remove.
 *
 * @param {{code?: string, value?: number, ratio?: number}} row
 * @param {object} scale From {@link createPrismScale}.
 * @returns {{
 *   code: string|null, value: number|null, ratio: number|null,
 *   heightM: number|null, extruded: boolean, measuredZero: boolean,
 *   clipped: boolean, bin: number, color: string|null,
 *   hasValue: boolean, hasRatio: boolean
 * }}
 */
export function prismRow(row, scale) {
  assertScale(scale);
  const source = row || {};
  const heightM = prismHeightM(source.value, scale);
  const bin = prismRatioBin(source.ratio, scale);
  const hasValue = heightM !== null;
  return {
    code: source.code === undefined || source.code === null ? null : String(source.code),
    value: hasValue ? Number(source.value) : null,
    ratio: bin < 0 ? null : Number(source.ratio),
    heightM,
    extruded: hasValue && heightM > 0,
    measuredZero: heightM === 0,
    clipped: hasValue && prismIsClipped(source.value, scale),
    bin,
    color: bin < 0 ? null : scale.ratioColors[Math.min(bin, scale.ratioColors.length - 1)],
    hasValue,
    hasRatio: bin >= 0,
  };
}

/**
 * Tally a set of rows for the legend — how many in each colour class, how many
 * missing each half, how many clipped.
 * @param {Array<{code?: string, value?: number, ratio?: number}>} rows
 * @param {object} scale
 * @returns {{ratioCounts: Array<number>, noValue: number, noRatio: number, clipped: number, zero: number, drawn: number}}
 */
export function prismTally(rows, scale) {
  assertScale(scale);
  const ratioCounts = new Array(scale.ratioColors.length).fill(0);
  const tally = {
    ratioCounts, noValue: 0, noRatio: 0, clipped: 0, zero: 0, drawn: 0,
  };
  for (const source of rows || []) {
    const built = prismRow(source, scale);
    if (built.hasValue) tally.drawn += 1; else tally.noValue += 1;
    if (built.measuredZero) tally.zero += 1;
    if (built.clipped) tally.clipped += 1;
    if (built.hasRatio) ratioCounts[Math.min(built.bin, ratioCounts.length - 1)] += 1;
    else tally.noRatio += 1;
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Legend (D1)
// ---------------------------------------------------------------------------

/** French grouping, via the platform's own fr-FR rules. */
function fr(value) {
  return Number(value).toLocaleString('fr-FR');
}

/** A round metre count as kilometres, for the height blurb. */
function km(metres) {
  return `${Math.round(metres / 1000)} km`;
}

/**
 * The two-part legend a prism layer publishes through
 * `getRowControls().legend` (and, where the layer surfaces it there,
 * `getStats().legend`).
 *
 * Entry shape is the repo's, unchanged — `{ label, color, count?, blurb?,
 * glyph? }`, rendered by `manager.js` in the panel row AND in the on-map block.
 * Two conventions that block relies on are used deliberately here:
 * `color: null` renders an empty, aligned swatch (`is-unmapped`) and marks a
 * row that is not a colour key; and `glyph` is masked with `color`, so a height
 * tick can hand over a BAR whose height is the datum while its colour stays
 * constant.
 *
 * Height first, because that is now the primary variable. Both halves get a
 * title row, because a legend that shows six colours and three bars without
 * saying which is which is not a legend.
 *
 * KNOWN INTEGRATION DEFECT, not fixable from here. The PANEL-ROW renderer
 * (`manager.js:2470`) appends `_formatCount(item.count)` unconditionally, and
 * `_formatCount(undefined)` returns the string `"undefined"` — so an entry
 * without a count renders `« Hauteur — points de charge undefined »` in the
 * row, while the ON-MAP block (`manager.js:2610`) guards with
 * `Number.isFinite` and renders it correctly. Several shipped layers already
 * hit this (`dpeFrance.js:595` has count-less entries), so it is pre-existing
 * rather than new, but this legend makes it conspicuous: four of its rows are
 * titles and ruler ticks that count nothing by design. The one-line fix is in
 * `manager.js`, which no layer owns.
 *
 * @param {object} scale From {@link createPrismScale}.
 * @param {object} [tally] From {@link prismTally}.
 * @returns {Array<object>} Legend entries, in reading order.
 */
export function prismLegend(scale, tally = {}) {
  assertScale(scale);
  const entries = [];
  const ratioCounts = tally.ratioCounts || [];

  const modeNote = scale.mode === 'sqrt'
    ? `Échelle en racine carrée : le domaine est trop étalé pour une règle linéaire, `
      + `donc un prisme deux fois plus haut vaut quatre fois plus.`
    : `Échelle linéaire : deux fois plus haut vaut deux fois plus.`;

  entries.push({
    label: `Hauteur — ${scale.heightLabel}`,
    color: null,
    blurb: `${modeNote} Le plus haut prisme fait ${km(scale.maxHeightM)} pour `
      + `${fr(scale.domainMax)} ${scale.heightUnit}, borne gelée. La base est le département : `
      + `son aire n'est pas neutralisée, donc un grand département rural fait un gros volume `
      + `à effectif égal — c'est la couleur, et non le volume, qui répond à « rapporté à quoi ? ».`,
  });

  for (const tick of scale.heightTicks) {
    const height = prismHeightM(tick, scale);
    entries.push({
      label: `${fr(tick)} ${scale.heightUnit}`,
      color: PRISM_HEIGHT_SWATCH_COLOR,
      glyph: prismHeightGlyph(height === null ? 0 : height / scale.maxHeightM),
      blurb: `${km(height ?? 0)} de haut.`,
    });
  }

  if (tally.clipped) {
    // A5 — the frozen domain has a top, and a value above it stops being
    // measured by the mark. Say how many, and say what the mark still means.
    entries.push({
      label: 'au-dessus du domaine gelé',
      color: null,
      count: tally.clipped,
      blurb: `Valeur supérieure à ${fr(scale.domainMax)} ${scale.heightUnit} : le prisme est `
        + `dessiné à la hauteur maximale et ne dit plus combien. Le domaine reste gelé pour que `
        + `la même donnée fasse la même hauteur d'une session à l'autre.`,
    });
  }

  if (tally.zero) {
    entries.push({
      label: 'mesuré à zéro',
      color: null,
      count: tally.zero,
      blurb: 'Emprise dessinée à plat, remplie et cerclée. Zéro est une mesure : '
        + 'elle ne se dessine pas comme une absence de mesure.',
    });
  }

  if (tally.noValue) {
    entries.push({
      label: `${scale.heightLabel} — non publié`,
      color: null,
      // The GRID, because that is the material the map draws for this refusal.
      // The rate refusal below gets the stripes it actually wears: two motifs
      // for two independent absences, and the key names each one.
      glyph: PRISM_NO_VALUE_GLYPH,
      count: tally.noValue,
      blurb: 'Aucun prisme : seule l’emprise en grille est dessinée. Un motif et non une '
        + 'teinte, parce que sur un globe photoréaliste il n’existe aucune couleur neutre.',
    });
  }

  entries.push({
    label: `Couleur — ${scale.ratioLabel}`,
    color: null,
    blurb: 'Un rapport, donc une variation de valeur : c’est ce que la couleur a le droit '
      + 'de dire. Seuils de domaine gelés, jamais recalculés depuis ce qui est à l’écran.',
  });

  scale.ratioColors.forEach((color, index) => {
    const count = ratioCounts[index] || 0;
    if (tally.ratioCounts && !count) return;
    entries.push({
      label: prismRatioClassLabel(index, scale),
      color,
      count: tally.ratioCounts ? count : undefined,
    });
  });

  if (tally.noRatio) {
    entries.push({
      label: `${scale.ratioLabel} — non publié`,
      color: PRISM_NO_RATIO_COLOR,
      glyph: PRISM_NO_RATIO_BODY_GLYPH,
      count: tally.noRatio,
      blurb: 'Le prisme est à sa hauteur, mais son corps est rayé : la hauteur est mesurée, '
        + 'la couleur est refusée. Les deux absences sont indépendantes.',
    });
  }

  return entries;
}

/**
 * French label for one colour class, from the frozen breaks.
 *
 * A layer may override the whole ladder with `ratioClassLabels` when its unit
 * needs a phrasing this cannot guess.
 * @param {number} index 0-based class.
 * @param {object} scale
 * @returns {string} Label.
 */
export function prismRatioClassLabel(index, scale) {
  assertScale(scale);
  if (scale.ratioClassLabels) return scale.ratioClassLabels[index] ?? '';
  const breaks = scale.ratioBreaks;
  if (index <= 0) return `≤ ${fr(breaks[0])}`;
  if (index >= breaks.length) return `> ${fr(breaks[breaks.length - 1])}`;
  return `${fr(breaks[index - 1])} – ${fr(breaks[index])}`;
}

// ---------------------------------------------------------------------------

/** Fail loudly on a scale that did not come from {@link createPrismScale}. */
function assertScale(scale) {
  if (!scale || typeof scale !== 'object' || !Number.isFinite(scale.domainMax)) {
    throw new TypeError('a prism scale from createPrismScale() is required');
  }
}
