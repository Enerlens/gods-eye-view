// src/data/cadastreFeed.js — the PCI vecteur parcel schema, and the arithmetic
// that decides what a cadastral line is allowed to claim.
//
// Everything here is pure and node-testable. The Cesium drawing lives in
// `cadastreParcels.js`; this file is where the upstream traps are held down,
// under test against a real captured Api Carto answer.
//
// ── What this data IS, before anything else ─────────────────────────────────
//
// The Plan Cadastral Informatisé is a FISCAL document. It exists so the DGFiP
// can assess property tax, and its boundaries have no legal force: in France a
// property limit is fixed by BORNAGE — a géomètre-expert's survey under article
// 646 of the Code civil — and by nothing else. A cadastral line is where the
// tax administration believes the limit runs, drawn on a plan at a published
// scale. Every card this layer renders says so, because an OSINT globe that
// draws a boundary and stays quiet about its standing is inviting the reader to
// mistake it for one.
//
// ── The six traps ───────────────────────────────────────────────────────────
//
// 1. **`_limit` is capped at 5 000, and only `totalFeatures` says so.** Ask for
//    16 000 over Marseille and Api Carto answers `numberReturned: 5000` beside
//    `totalFeatures: 15977` with HTTP 200 and no warning. Worse than the count
//    being wrong: the 5 000 are not a contiguous slab — paging by `_start`
//    walks an internal order that mixes arrondissements — so a truncated answer
//    is a cadastre with SCATTERED holes, which is exactly what a complete one
//    looks like over the public domain. That is the one failure that would turn
//    this layer's headline into a lie, so a truncated box is refused whole
//    rather than drawn short (see {@link projectCadastreParcels}).
//
// 2. **`idu` does not start with `code_insee` for 38% of urban France.** The
//    identifier's first five characters are the ARRONDISSEMENT code, not the
//    commune's: a Marais parcel is `75103000AP0045` while its `code_insee` is
//    `75056`. Measured 2026-09-01 over 27 595 parcels in eight boxes: 10 588
//    mismatches, every one of them in Paris, Lyon or Marseille. Rebuild an IDU
//    from `code_insee` and the key joins to nothing in DVF for the three
//    cities where property data matters most. The published `idu` is taken
//    verbatim and never reassembled.
//
// 3. **A sheet's scale is not identified by `(commune, section, feuille)`.**
//    Lyon publishes section `AL` feuille 1 in FIVE arrondissements — 381, 382,
//    383, 385, 386 — and the 5e's copy is drawn at 1:1000 while the others are
//    at 1:500. Join without `code_arr` and a parcel gets a coin-flipped
//    tolerance, ±0.25 m or ±0.5 m. {@link sheetKey} is five parts for this
//    reason; with `code_arr` in the key there were 0 collisions across the same
//    27 595 parcels and 450 sheets.
//
// 4. **`contenance` is absent, zero, or simply different from the polygon.**
//    Mamoudzou publishes parcels with `contenance: null` (74 in one box);
//    Ostwald publishes one at exactly `0`. And where both exist they disagree:
//    7.2% of 9 539 parcels measured differ by more than 5%, 1.0% by more than
//    20%, with a Toulouse parcel drawn at 494 m² against 153 m² declared. The
//    declared figure is the fiscal contenance and the polygon is the plan;
//    neither is a survey, so the card shows BOTH and never averages them.
//
// 5. **Interior rings are courtyards, and a parcel can be in two pieces.**
//    0.5% of parcels carry a hole (the Palais-Royal's `75101000AJ0002` among
//    them) and a handful are multi-part — one identifier, two disjoint
//    polygons. Dropping either is a silent area error on the card.
//
// 6. **`section` is not always letters and `com_abs` is not always absorption.**
//    Alsace-Moselle numbers its sections (`22` in Ostwald); Marseille prefixes
//    with a digit (`0D`). And `com_abs` — the API's name for the IDU's
//    three-digit préfixe — runs 801–842 across Toulouse, a commune with no
//    arrondissements and no absorbed communes in that range. Both fields are
//    carried as opaque strings and neither is parsed for meaning.

/** Api Carto's cadastre module. Keyless, CORS-open, Licence Ouverte 2.0. */
export const CADASTRE_API_BASE = 'https://apicarto.ign.fr/api/cadastre';

/** Human-facing provenance, echoed by the proxy's `/status` route. */
export const CADASTRE_SOURCE = 'IGN Api Carto — cadastre (PCI vecteur, DGFiP)';
export const CADASTRE_DATASET_PAGE = 'https://apicarto.ign.fr/api/doc/cadastre';
export const CADASTRE_LICENCE = 'Licence Ouverte 2.0';

/**
 * Widest viewport that gets parcels, in degrees on EITHER axis.
 *
 * 0.02° ≈ 2.2 km of latitude, and on the app's own 16:10 viewport longitude
 * runs ~2.4× wider than latitude, so the binding side is the horizontal one and
 * the real window is roughly 2.2 km × 0.9 km. That is deliberate and it is
 * sized off trap 1, not off taste: the densest boxes measured on 2026-09-01
 * answer 2 100–2 400 parcels at this span (Marseille 2 300, Paris 2 070,
 * Alsace 1 170), comfortably under Api Carto's own 5 000 ceiling, so the
 * refusal path stays the exception rather than the normal experience of the
 * layer. A parcel is also ~15 px across here; at twice this span it is a line.
 */
export const CADASTRE_MAX_BOX_DEG = 0.02;

/**
 * Camera altitude above which parcels are not drawn at all, in metres.
 *
 * The gate is ALTITUDE and not the view rectangle's span, and that distinction
 * is the whole reason this constant exists. `computeViewRectangle` on a TILTED
 * camera returns everything the lens can see down to the horizon, which is a
 * statement about the pitch far more than about how close the operator is.
 * Measured in the app at 240 m over Paris on 2026-09-01: 0.0038° of longitude
 * looking straight down, 0.0084° at 45°, and 0.0397° at 25° — the same 240 m,
 * a tenfold spread, and the last one is over any span ceiling worth setting.
 * Gating on it refused the layer at street level on exactly the oblique view
 * this globe defaults to.
 *
 * 1 500 m is where a 0.02° box stops covering a nadir view (0.0157° of
 * longitude at 1 000 m, 0.0315° at 2 000 m), so below it the drawn window is
 * most of what is on screen rather than a patch in the middle of it.
 */
export const CADASTRE_MAX_ALTITUDE_M = 1500;

/**
 * Cache grid the request box is snapped onto. 0.002° ≈ 220 m: panning a street
 * re-uses the cached answer instead of minting a fresh upstream call for every
 * camera nudge. Three decimals of {@link boxKey} resolve this exactly.
 */
export const CADASTRE_BOX_STEP_DEG = 0.002;

/**
 * The ceiling the PROXY enforces, deliberately NOT the one the client gates on.
 *
 * The two numbers do different jobs. {@link CADASTRE_MAX_BOX_DEG} bounds what
 * the client ASKS FOR. This one is an abuse bound on what the server ACCEPTS,
 * and it has to leave room for everything that happens to a box between those
 * two points — which is more than it looks.
 *
 * `snapBoxOutward` moves each of the four edges outward by up to a full grid
 * step, so a box already at the client ceiling arrives up to TWO steps wider.
 * That is not a corner case: the request box is now anchored on the focus point
 * and clipped to the view, so above a few hundred metres it is EXACTLY
 * `CADASTRE_MAX_BOX_DEG` on both axes and the snap always pushes it over. A
 * one-step margin passed every test and then 400'd the layer at 400 m and
 * 800 m over Paris — the altitudes where the box first stops being view-sized.
 *
 * Two steps for the snap and a third for floating point, which is the other
 * half of this: a snapped edge is rounded to six decimals, and comparing the
 * difference of two such values against an exact ceiling is decided by noise
 * (`43.31 - 43.29` is `0.020000000000004547`).
 */
export const CADASTRE_REQUEST_MAX_BOX_DEG = CADASTRE_MAX_BOX_DEG + 3 * CADASTRE_BOX_STEP_DEG;

/**
 * Api Carto's own per-request ceiling, measured rather than documented.
 *
 * `_limit=4999` returns 4 999; `_limit=5000`, `_limit=5001` and `_limit=10000`
 * all return exactly 5 000 (Paris, 0.034° box, 12 483 parcels in it,
 * 2026-09-01). Asking for more than this buys nothing and hides the truncation
 * behind a number the caller chose, so the request asks for exactly the
 * ceiling and compares what came back against `totalFeatures`.
 */
export const CADASTRE_UPSTREAM_LIMIT = 5000;

/**
 * Where PCI vecteur exists. Outside these boxes every request is a guaranteed
 * empty FeatureCollection, and the layer says "hors couverture" rather than
 * drawing a blank France and letting the operator wonder.
 *
 * Saint-Pierre-et-Miquelon, Saint-Martin and Saint-Barthélemy are deliberately
 * absent: they are served by their own cadastral arrangements and were not
 * measured, so they are reported as off-coverage rather than probed blind.
 */
export const CADASTRE_COVERAGE = Object.freeze([
  Object.freeze({ south: 41.2, west: -5.3, north: 51.2, east: 9.7 }), // métropole + Corse
  Object.freeze({ south: 15.7, west: -61.9, north: 16.6, east: -60.9 }), // Guadeloupe
  Object.freeze({ south: 14.3, west: -61.3, north: 15.0, east: -60.7 }), // Martinique
  Object.freeze({ south: 2.0, west: -54.7, north: 6.0, east: -51.5 }), // Guyane
  Object.freeze({ south: -21.5, west: 55.1, north: -20.8, east: 55.9 }), // La Réunion
  Object.freeze({ south: -13.1, west: 44.9, north: -12.5, east: 45.4 }), // Mayotte
]);

/**
 * The pen width assumed on a cadastral plan, in millimetres.
 *
 * A boundary on a paper sheet is a drawn line, and PCI vecteur is that sheet
 * digitised. The conventional graphic error for a cadastral plan is 0.2–0.5 mm
 * at plan scale; 0.5 mm is the conservative end, and it is the one used here
 * because a tolerance that understates itself is worse than useless on a layer
 * whose whole point is that these lines are approximate. Every tolerance this
 * module prints is this number times the sheet's scale, and the card says so
 * rather than presenting the result as a surveyed figure.
 */
export const CADASTRE_PEN_MM = 0.5;

/**
 * Scale bands, coarsest tolerance last.
 *
 * The seven `echelle` values Api Carto actually publishes — 250, 500, 1000,
 * 2000, 2500, 4000, 5000, measured over 673 sheets in nine boxes on
 * 2026-09-01 with zero nulls — folded into four bands. Four and not seven
 * because the legend is read at a glance and 1:2000 against 1:2500 is a
 * distinction without a visible difference; each band names its own échelles
 * so nothing is hidden by the folding.
 *
 * The ramp runs cool to warm with WIDENING TOLERANCE, not with quality: a
 * 1:5000 sheet over the Landes is not a worse sheet, it is a sheet of a forest,
 * and the colour is saying how much slack its lines carry.
 */
export const CADASTRE_SCALE_BANDS = Object.freeze([
  Object.freeze({
    id: 'fine',
    label: 'Plan fin',
    color: '#4fd6ff',
    echelles: Object.freeze([250, 500]),
    blurb: 'Levé au 1:250 ou 1:500 — centres urbains denses. Trait ±0,13 à 0,25 m.',
  }),
  Object.freeze({
    id: 'urban',
    label: 'Plan urbain',
    color: '#7ee787',
    echelles: Object.freeze([1000]),
    blurb: 'Levé au 1:1000 — villes et bourgs. Trait ±0,5 m.',
  }),
  Object.freeze({
    id: 'rural',
    label: 'Plan rural',
    color: '#f4c542',
    echelles: Object.freeze([2000, 2500]),
    blurb: 'Levé au 1:2000 ou 1:2500 — campagne cultivée. Trait ±1 à 1,25 m.',
  }),
  Object.freeze({
    id: 'extensive',
    label: 'Plan étendu',
    color: '#ff7043',
    echelles: Object.freeze([4000, 5000]),
    blurb: 'Levé au 1:4000 ou 1:5000 — forêt, montagne, grandes propriétés. Trait ±2 à 2,5 m.',
  }),
]);

/**
 * The band for a parcel this legend cannot colour.
 *
 * Grey and named, never folded into one of the four: "we do not know how
 * precisely this line was drawn" is a different statement from "this line was
 * drawn at 1:2000", and a layer about tolerance may not blur the two.
 *
 * TWO different parcels land here and the blurb covers both, because the
 * distinction matters on the card even though it does not on the map. A parcel
 * whose sheet did not join has NO tolerance at all. A parcel on a scale outside
 * the seven observed values — a 1:750 sheet IGN has not published yet — has one
 * that {@link graphicToleranceM} computes perfectly well; it is only its
 * COLOUR that this table cannot supply. Suppressing a real tolerance because a
 * legend row is missing would be the worse error of the two.
 */
export const CADASTRE_UNKNOWN_BAND = Object.freeze({
  id: 'unknown',
  label: 'Échelle inconnue',
  color: '#8a93a6',
  echelles: Object.freeze([]),
  blurb: 'Feuille non jointe, ou échelle hors des quatre bandes. La tolérance reste calculée dès que l\'échelle est publiée.',
});

/** Band ids in legend order, unknown last. */
export const CADASTRE_BAND_IDS = Object.freeze([
  ...CADASTRE_SCALE_BANDS.map((band) => band.id),
  CADASTRE_UNKNOWN_BAND.id,
]);

/**
 * Relative gap between the declared contenance and the drawn polygon past
 * which a parcel is counted as disagreeing.
 *
 * 5%, which the measurement puts in perspective rather than the other way
 * round: over 9 539 parcels with a usable contenance, 92.8% agree inside it.
 * The 7.2% that do not are not errors to be corrected — they are two different
 * statements about the same ground, and the card shows both.
 */
export const CADASTRE_AREA_TOLERANCE = 0.05;

const EARTH_RADIUS_M = 6378137;

/**
 * @returns {?number} `value` when it is a usable finite number, else null.
 *
 * The null/blank guard is not defensive padding: `Number(null)` is `0` and
 * `Number('')` is `0`, so the obvious one-liner turns Mamoudzou's unpublished
 * `contenance: null` into a parcel that DECLARES zero square metres — the exact
 * substitution of a measurement for its absence that trap 4 exists to prevent.
 * `false` is excluded for the same reason.
 */
export function finiteOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @returns {string} A trimmed string, or '' when there was nothing to trim. */
function text(value) {
  return String(value ?? '').trim();
}

/**
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {boolean} Whether the box touches any PCI vecteur coverage area.
 */
export function cadastreCoverageIntersects(box) {
  if (!box) return false;
  return CADASTRE_COVERAGE.some((area) => box.south <= area.north && box.north >= area.south
    && box.west <= area.east && box.east >= area.west);
}

/**
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {boolean} Whether either span exceeds {@link CADASTRE_MAX_BOX_DEG}.
 */
export function cadastreBoxTooWide(box) {
  if (!box) return true;
  return (box.north - box.south) > CADASTRE_MAX_BOX_DEG
    || (box.east - box.west) > CADASTRE_MAX_BOX_DEG;
}

/**
 * The box to actually request: what the operator is looking AT, bounded.
 *
 * Two inputs, and neither is sufficient alone. The view rectangle knows what is
 * on screen but on a tilted camera that reaches the horizon, which is far more
 * ground than Api Carto will answer for and far more than carries a legible
 * parcel. The focus point — where the middle of the screen meets the globe —
 * knows WHERE the operator is looking but nothing about how much of it fits.
 *
 * So: a `maxDeg` box centred on the focus point, clipped to the view. Under a
 * nadir camera at low altitude the view is the smaller of the two and the
 * result IS the view, so nothing is requested that is not on screen. Under a
 * strong tilt the result is the near and middle ground around the point being
 * looked at, and the far half of the screen — where a parcel is well under a
 * pixel anyway — is simply not asked for.
 *
 * @param {?{south:number, west:number, north:number, east:number}} view
 * @param {?{lat:number, lon:number}} focus Screen-centre point on the globe.
 * @param {number} [maxDeg]
 * @returns {?{south:number, west:number, north:number, east:number}}
 */
export function cadastreRequestBox(view, focus, maxDeg = CADASTRE_MAX_BOX_DEG) {
  if (!view) return null;
  const lat = finiteOrNull(focus?.lat);
  const lon = finiteOrNull(focus?.lon);
  // No focus point at all — the middle of the screen is sky. The view is then
  // the only thing known, and it is used only if it already fits.
  if (lat === null || lon === null) {
    return cadastreBoxTooWide(view) ? null : { ...view };
  }
  const half = maxDeg / 2;
  const box = {
    south: Math.max(view.south, lat - half),
    north: Math.min(view.north, lat + half),
    west: Math.max(view.west, lon - half),
    east: Math.min(view.east, lon + half),
  };
  // A focus point outside its own view rectangle is possible for a degenerate
  // camera; an inverted box is not a small request, it is a broken one.
  if (box.south >= box.north || box.west >= box.east) return null;
  return box;
}

/**
 * The band a published `echelle` falls in.
 *
 * The value arrives as a STRING (`"500"`), which is why this coerces rather
 * than switching on it. Anything outside the seven published values — a new
 * échelle, a null, a blank — lands in UNKNOWN rather than the nearest band: an
 * invented tolerance is the one output this module must never produce.
 * @param {unknown} echelle
 * @returns {typeof CADASTRE_UNKNOWN_BAND}
 */
export function cadastreScaleBand(echelle) {
  const value = finiteOrNull(echelle);
  if (value === null || value <= 0) return CADASTRE_UNKNOWN_BAND;
  for (const band of CADASTRE_SCALE_BANDS) {
    if (band.echelles.includes(value)) return band;
  }
  return CADASTRE_UNKNOWN_BAND;
}

/**
 * The graphic tolerance of a line on a sheet at this scale, in metres.
 *
 * {@link CADASTRE_PEN_MM} of drawn line, scaled up by the plan's denominator.
 * Returns null — not a default, not a zero — when the scale is unknown, so a
 * caller cannot print a tolerance it does not have.
 * @param {unknown} echelle
 * @returns {?number}
 */
export function graphicToleranceM(echelle) {
  const value = finiteOrNull(echelle);
  if (value === null || value <= 0) return null;
  return (CADASTRE_PEN_MM / 1000) * value;
}

/**
 * The five-part key that identifies one cadastral sheet.
 *
 * `code_arr` is in here because of trap 3 and is the whole reason this is a
 * function rather than a template literal at three call sites. The parts are
 * joined with `/` rather than concatenated: `com_abs` and `code_arr` are both
 * three digits and `section` is two, so a bare concatenation is unambiguous
 * today and stops being so the first time IGN widens a field.
 * @param {object|null|undefined} props A parcel's or a sheet's properties.
 * @returns {?string} null when any part is missing.
 */
export function sheetKey(props) {
  const commune = text(props?.code_insee);
  const section = text(props?.section);
  const feuille = props?.feuille;
  if (!commune || !section || feuille === null || feuille === undefined) return null;
  const arrondissement = text(props?.code_arr) || '000';
  const prefixe = text(props?.com_abs) || '000';
  return `${commune}/${arrondissement}/${prefixe}/${section}/${feuille}`;
}

/**
 * Normalize a GeoJSON geometry to `[[outerRing, ...holes], ...]`.
 *
 * Api Carto answers `MultiPolygon` for every parcel it has ever been observed
 * to return, including single-part ones — but a `Polygon` costs one branch to
 * accept and its absence is not something this layer should depend on.
 * @param {object|null|undefined} geometry
 * @returns {Array<Array<Array<number[]>>>}
 */
export function parcelPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'MultiPolygon') return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  if (geometry.type === 'Polygon') return Array.isArray(geometry.coordinates) ? [geometry.coordinates] : [];
  return [];
}

/**
 * Area of one closed ring in square metres, by shoelace on a local
 * equirectangular projection.
 *
 * `latRef` — the latitude the longitude scale is taken at — is passed in rather
 * than derived per ring so that a parcel's holes are measured on the SAME
 * projection as its outer ring; deriving it separately makes a hole's area
 * incommensurable with the ring it is subtracted from. Over a parcel (metres to
 * a few hundred metres) the projection's own distortion is far below the plan's
 * graphic tolerance, which is the accuracy this whole module is bounded by.
 * @param {Array<number[]>} ring
 * @param {number} latRef
 * @returns {number} Unsigned area, m².
 */
export function ringAreaM2(ring, latRef) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const k = Math.cos((latRef * Math.PI) / 180) * EARTH_RADIUS_M * (Math.PI / 180);
  const m = EARTH_RADIUS_M * (Math.PI / 180);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j];
    const b = ring[i];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    sum += (a[0] * k) * (b[1] * m) - (b[0] * k) * (a[1] * m);
  }
  return Math.abs(sum) / 2;
}

/** The latitude a parcel's projection is anchored at: its first vertex. */
function referenceLatitude(polygons) {
  const first = polygons?.[0]?.[0]?.[0];
  const lat = Array.isArray(first) ? finiteOrNull(first[1]) : null;
  return lat === null ? 0 : lat;
}

/**
 * Area of a whole parcel in square metres: every outer ring, minus every hole.
 *
 * Both subtractions matter and both were measured: 0.5% of parcels carry an
 * interior ring and a handful are multi-part. Ignoring holes overstates the
 * Palais-Royal by its courtyard; ignoring the second part understates a split
 * Marseille parcel by half.
 * @param {object|null|undefined} geometry
 * @returns {?number} null when there is no usable ring at all.
 */
export function parcelAreaM2(geometry) {
  const polygons = parcelPolygons(geometry);
  if (!polygons.length) return null;
  const latRef = referenceLatitude(polygons);
  let total = 0;
  let measured = false;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    const outer = ringAreaM2(polygon[0], latRef);
    if (outer <= 0) continue;
    measured = true;
    total += outer;
    for (let h = 1; h < polygon.length; h += 1) total -= ringAreaM2(polygon[h], latRef);
  }
  if (!measured) return null;
  return Math.max(0, total);
}

/**
 * Area centroid of a parcel's LARGEST ring, as `[lon, lat]`.
 *
 * The largest ring and not the first: a multi-part parcel whose first part is
 * the 6 m² sliver would otherwise anchor its card on the sliver. A vertex
 * average is not used for the same reason it is not used for départements next
 * door — it is dragged toward whichever edge carries the most vertices, which
 * on a parcel is the street front.
 * @param {object|null|undefined} geometry
 * @returns {?number[]}
 */
export function parcelAnchor(geometry) {
  const polygons = parcelPolygons(geometry);
  const latRef = referenceLatitude(polygons);
  let best = null;
  let bestArea = -Infinity;
  for (const polygon of polygons) {
    const ring = Array.isArray(polygon) ? polygon[0] : null;
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const area = ringAreaM2(ring, latRef);
    if (area > bestArea) { bestArea = area; best = ring; }
  }
  if (!best) return null;

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i, i += 1) {
    const a = best[j];
    const b = best[i];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const cross = (a[0] * b[1]) - (b[0] * a[1]);
    twiceArea += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  // A degenerate ring (zero signed area — a spike, or a ring closed on itself)
  // divides by zero here. Fall back to the vertex average rather than emitting
  // a NaN position that Cesium would silently place at the centre of the Earth.
  if (twiceArea === 0) {
    let lon = 0;
    let lat = 0;
    for (const [x, y] of best) { lon += x; lat += y; }
    const anchor = [lon / best.length, lat / best.length];
    return anchor.every(Number.isFinite) ? anchor : null;
  }
  const anchor = [cx / (3 * twiceArea), cy / (3 * twiceArea)];
  return anchor.every(Number.isFinite) ? anchor : null;
}

/**
 * Sutherland-Hodgman clip of a convex-or-concave ring against an axis-aligned
 * box. Used only for the coverage fraction below.
 * @param {Array<number[]>} ring
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {Array<number[]>}
 */
export function clipRingToBox(ring, box) {
  if (!Array.isArray(ring) || ring.length < 3 || !box) return [];
  const edges = [
    { keep: (p) => p[0] >= box.west, cut: (a, b) => cutX(a, b, box.west) },
    { keep: (p) => p[0] <= box.east, cut: (a, b) => cutX(a, b, box.east) },
    { keep: (p) => p[1] >= box.south, cut: (a, b) => cutY(a, b, box.south) },
    { keep: (p) => p[1] <= box.north, cut: (a, b) => cutY(a, b, box.north) },
  ];
  let output = ring.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  for (const edge of edges) {
    if (!output.length) return [];
    const input = output;
    output = [];
    for (let i = 0, j = input.length - 1; i < input.length; j = i, i += 1) {
      const previous = input[j];
      const current = input[i];
      const previousIn = edge.keep(previous);
      const currentIn = edge.keep(current);
      if (currentIn) {
        if (!previousIn) output.push(edge.cut(previous, current));
        output.push(current);
      } else if (previousIn) {
        output.push(edge.cut(previous, current));
      }
    }
  }
  return output;
}

function cutX(a, b, x) {
  const span = b[0] - a[0];
  const t = span === 0 ? 0 : (x - a[0]) / span;
  return [x, a[1] + t * (b[1] - a[1])];
}

function cutY(a, b, y) {
  const span = b[1] - a[1];
  const t = span === 0 ? 0 : (y - a[1]) / span;
  return [a[0] + t * (b[0] - a[0]), y];
}

/**
 * How much of a parcel falls INSIDE the request box, in square metres.
 *
 * Api Carto returns every parcel that INTERSECTS the box, so summing whole
 * parcel areas over a city block yields more than the block contains — the
 * first attempt at the coverage figure below reported 141% over La Défense for
 * exactly this reason. Clipping first is what makes the number mean something.
 * @param {object|null|undefined} geometry
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {number}
 */
export function parcelAreaInBoxM2(geometry, box) {
  const polygons = parcelPolygons(geometry);
  if (!polygons.length || !box) return 0;
  const latRef = referenceLatitude(polygons);
  let total = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    total += ringAreaM2(clipRingToBox(polygon[0], box), latRef);
    for (let h = 1; h < polygon.length; h += 1) {
      total -= ringAreaM2(clipRingToBox(polygon[h], box), latRef);
    }
  }
  return Math.max(0, total);
}

/** Area of a lat/lon box in square metres, on the same local projection. */
export function boxAreaM2(box) {
  if (!box) return 0;
  const latRef = (box.south + box.north) / 2;
  const width = (box.east - box.west) * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((latRef * Math.PI) / 180);
  const height = (box.north - box.south) * (Math.PI / 180) * EARTH_RADIUS_M;
  return Math.max(0, width * height);
}

/**
 * Index an Api Carto `feuille` FeatureCollection by {@link sheetKey}.
 *
 * The `feuille` endpoint — not `division`, which answers the same join with an
 * `edition` that is an integer version number. `feuille` publishes `edition` as
 * a DATE (`"2026-06-01"`), which is the thing a reader can act on: how old the
 * sheet under this parcel is.
 * @param {object|null|undefined} featureCollection
 * @returns {Map<string, {echelle:?number, edition:?string}>}
 */
export function indexCadastreSheets(featureCollection) {
  const sheets = new Map();
  for (const feature of featureCollection?.features || []) {
    const props = feature?.properties;
    const key = sheetKey(props);
    if (!key || sheets.has(key)) continue;
    sheets.set(key, {
      echelle: finiteOrNull(props.echelle),
      edition: text(props.edition) || null,
    });
  }
  return sheets;
}

/**
 * Turn one Api Carto answer pair into the payload the browser receives.
 *
 * @param {object} input
 * @param {object} input.parcelle Raw `/cadastre/parcelle` FeatureCollection.
 * @param {object} [input.feuille] Raw `/cadastre/feuille` FeatureCollection.
 * @param {{south:number, west:number, north:number, east:number}} input.box Snapped box.
 * @returns {object} Client payload. `truncated: true` carries NO parcels.
 */
export function projectCadastreParcels({ parcelle, feuille, box } = {}) {
  const features = Array.isArray(parcelle?.features) ? parcelle.features : [];
  const totalInBox = finiteOrNull(parcelle?.totalFeatures) ?? features.length;

  // TRAP 1, and the only early return in this function. A short answer is
  // refused whole: the missing parcels are scattered rather than cropped, so
  // drawing what arrived would show a cadastre riddled with holes that read
  // exactly like the public domain the complete answer legitimately leaves
  // blank. The count is still reported, because "there are 15 977 parcels
  // here" is a useful answer and a wrong map is not.
  if (totalInBox > features.length) {
    return {
      box: box || null,
      truncated: true,
      totalInBox,
      returned: features.length,
      upstreamLimit: CADASTRE_UPSTREAM_LIMIT,
      parcels: [],
      sheets: {},
      communes: {},
      summary: summarizeCadastreParcels([], box),
      source: CADASTRE_SOURCE,
      licence: CADASTRE_LICENCE,
      datasetPage: CADASTRE_DATASET_PAGE,
    };
  }

  const sheets = indexCadastreSheets(feuille);
  const sheetsReturned = Array.isArray(feuille?.features) ? feuille.features.length : 0;
  const sheetsTotal = finiteOrNull(feuille?.totalFeatures) ?? sheetsReturned;

  const usedSheets = {};
  const communes = {};
  const parcels = [];
  for (const feature of features) {
    const props = feature?.properties || {};
    const polygons = parcelPolygons(feature?.geometry);
    if (!polygons.length) continue;
    const anchor = parcelAnchor(feature.geometry);
    if (!anchor) continue;

    const key = sheetKey(props);
    const sheet = key ? sheets.get(key) : null;
    if (key && sheet && !usedSheets[key]) usedSheets[key] = { e: sheet.echelle, d: sheet.edition };

    const commune = text(props.code_insee);
    if (commune && !communes[commune]) communes[commune] = text(props.nom_com) || commune;

    parcels.push({
      // Verbatim, never reassembled — trap 2.
      u: text(props.idu) || null,
      n: text(props.numero) || null,
      s: text(props.section) || null,
      f: finiteOrNull(props.feuille),
      c: finiteOrNull(props.contenance),
      // Rounded to CENTIMETRES of area, not to whole square metres: the
      // register contains 0.1 m² spikes, and an integer here would publish them
      // as zero before any formatter got a chance to say otherwise.
      a: Number((parcelAreaM2(feature.geometry) ?? 0).toFixed(2)),
      m: commune || null,
      r: text(props.code_arr) || '000',
      b: text(props.com_abs) || '000',
      k: key && sheet ? key : null,
      p: [Number(anchor[0].toFixed(7)), Number(anchor[1].toFixed(7))],
      g: polygons,
    });
  }

  return {
    box: box || null,
    truncated: false,
    totalInBox,
    returned: features.length,
    upstreamLimit: CADASTRE_UPSTREAM_LIMIT,
    parcels,
    sheets: usedSheets,
    communes,
    // Reported rather than fatal: a short sheet answer costs some parcels their
    // échelle, which the UNKNOWN band already states honestly on its own.
    sheetsTruncated: sheetsTotal > sheetsReturned,
    sheetsTotal,
    summary: summarizeCadastreParcels(parcels, box, usedSheets),
    source: CADASTRE_SOURCE,
    licence: CADASTRE_LICENCE,
    datasetPage: CADASTRE_DATASET_PAGE,
  };
}

/**
 * Everything the row, the legend and the status line need, counted once.
 *
 * @param {Array<object>} parcels Projected parcels.
 * @param {?object} box Snapped request box, for the coverage fraction.
 * @param {object} [sheets] key → `{e, d}`, for the band of each parcel.
 * @returns {object}
 */
export function summarizeCadastreParcels(parcels, box = null, sheets = {}) {
  const list = Array.isArray(parcels) ? parcels : [];
  const bandCounts = new Map(CADASTRE_BAND_IDS.map((id) => [id, 0]));

  let declaredM2 = 0;
  let drawnM2 = 0;
  let inBoxM2 = 0;
  let areaChecked = 0;
  let areaDisagreeing = 0;
  let worstRatio = 0;
  let worstParcel = null;
  let noContenance = 0;
  let multipart = 0;
  let withHoles = 0;
  let arrondissementIdu = 0;
  let smallestM2 = Infinity;
  let largestM2 = 0;
  const editions = new Set();

  for (const parcel of list) {
    const sheet = parcel.k ? sheets[parcel.k] : null;
    const band = sheet ? cadastreScaleBand(sheet.e) : CADASTRE_UNKNOWN_BAND;
    bandCounts.set(band.id, (bandCounts.get(band.id) || 0) + 1);
    if (sheet?.d) editions.add(sheet.d);

    const drawn = finiteOrNull(parcel.a) ?? 0;
    drawnM2 += drawn;
    if (drawn > 0) {
      if (drawn < smallestM2) smallestM2 = drawn;
      if (drawn > largestM2) largestM2 = drawn;
    }

    const declared = finiteOrNull(parcel.c);
    // `0` is a published contenance in Ostwald and is NOT a missing one — but
    // it cannot be a denominator either, so it counts as "no usable figure"
    // for the agreement rate while staying out of the missing tally.
    if (declared === null) noContenance += 1;
    else declaredM2 += declared;
    if (declared !== null && declared > 0) {
      areaChecked += 1;
      const ratio = Math.abs(drawn / declared - 1);
      if (ratio > CADASTRE_AREA_TOLERANCE) areaDisagreeing += 1;
      if (ratio > worstRatio) { worstRatio = ratio; worstParcel = parcel.u; }
    }

    if (box) inBoxM2 += parcelAreaInBoxM2({ type: 'MultiPolygon', coordinates: parcel.g }, box);
    if (Array.isArray(parcel.g)) {
      if (parcel.g.length > 1) multipart += 1;
      if (parcel.g.some((polygon) => Array.isArray(polygon) && polygon.length > 1)) withHoles += 1;
    }
    if (parcel.u && parcel.m && parcel.u.slice(0, 5) !== parcel.m) arrondissementIdu += 1;
  }

  const boxM2 = boxAreaM2(box);
  return {
    parcels: list.length,
    communes: new Set(list.map((parcel) => parcel.m).filter(Boolean)).size,
    sheets: Object.keys(sheets || {}).length,
    bands: [...CADASTRE_SCALE_BANDS, CADASTRE_UNKNOWN_BAND].map((band) => ({
      id: band.id,
      label: band.label,
      color: band.color,
      blurb: band.blurb,
      count: bandCounts.get(band.id) || 0,
    })),
    declaredM2: Math.round(declaredM2),
    drawnM2: Math.round(drawnM2),
    // The layer's headline, and the reason `parcelAreaInBoxM2` exists. Null
    // rather than 0 when there is no box to divide by, so a caller cannot print
    // "0% cadastré" for "we did not measure".
    cadastredFraction: boxM2 > 0 ? Math.min(1, inBoxM2 / boxM2) : null,
    areaChecked,
    areaDisagreeing,
    worstAreaRatio: worstParcel ? Number(worstRatio.toFixed(4)) : null,
    worstAreaParcel: worstParcel,
    noContenance,
    multipart,
    withHoles,
    arrondissementIdu,
    // Two decimals on the smallest, whole metres on the largest: the interesting
    // end of this range is the 0.11 m² spike, and rounding it to 0 reports the
    // register's smallest parcel as having no area at all.
    smallestM2: Number.isFinite(smallestM2) ? Number(smallestM2.toFixed(2)) : null,
    largestM2: largestM2 > 0 ? Math.round(largestM2) : null,
    editions: [...editions].sort(),
  };
}

/**
 * The three communes of France that have arrondissements municipaux, and the
 * offset between `code_arr` and the ordinal a resident would say.
 *
 * `code_arr` is the last three digits of the ARRONDISSEMENT's own INSEE code,
 * so the offset is the commune's own base and differs per city: Paris 4e is
 * INSEE 75104 → 104, Marseille 3e is 13203 → 203, and Lyon 2e is 69382 → 382.
 * Taking the last two digits works for two of the three and turns Lyon's 2e
 * into an "82ᵉ arrondissement", which is how this table came to exist.
 *
 * A closed list, not a formula: no other commune in France carries a non-zero
 * `code_arr`, and an unknown one is answered with null rather than an ordinal
 * derived from a pattern that was only ever true for three cities.
 */
const ARRONDISSEMENT_BASES = Object.freeze({
  75056: 100, // Paris, 1er–20e
  13055: 200, // Marseille, 1er–16e
  69123: 380, // Lyon, 1er–9e
});

/**
 * The arrondissement ordinal a parcel sits in, or null.
 *
 * `000` means the commune has no arrondissements; it is not an ordinal of zero.
 * @param {unknown} codeArr
 * @param {unknown} codeInsee
 * @returns {?number}
 */
export function arrondissementOrdinal(codeArr, codeInsee) {
  const value = text(codeArr);
  if (!/^\d{3}$/.test(value) || value === '000') return null;
  const base = ARRONDISSEMENT_BASES[text(codeInsee)];
  if (base === undefined) return null;
  const ordinal = Number(value) - base;
  return ordinal > 0 ? ordinal : null;
}

/** French ordinal suffix: 1ᵉʳ, then 2ᵉ, 3ᵉ… */
export function frenchOrdinal(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1 ? '1ᵉʳ' : `${n}ᵉ`;
}

/**
 * `1 234 m²`, hectares once a parcel stops being a plot, and a DECIMAL once it
 * stops being a plot in the other direction.
 *
 * The decimal under 10 m² is not fussiness. Ostwald publishes a parcel whose
 * plan encloses 0.109 m² — a real 1 m × 0.2 m spike in the register — and
 * rounding it to the nearest square metre prints `0 m²`, which reads as a
 * missing measurement rather than as the sliver it is.
 */
export function formatSurfaceM2(value) {
  const m2 = finiteOrNull(value);
  if (m2 === null) return null;
  if (m2 >= 10000) return `${(m2 / 10000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ha`;
  if (m2 > 0 && m2 < 10) return `${m2.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} m²`;
  return `${Math.round(m2).toLocaleString('fr-FR')} m²`;
}

/**
 * A signed percentage, for the gap between two areas.
 *
 * The precision SCALES with the magnitude, and not for tidiness: at one decimal
 * a parcel whose plan agrees with its contenance to four significant figures
 * prints `−0,0 %`, which reads as a rounding artefact rather than as the strong
 * agreement it is. Two decimals under 1%, one under 10%, none above.
 */
export function formatSignedPercent(ratio) {
  const value = finiteOrNull(ratio);
  if (value === null) return null;
  const percent = value * 100;
  const magnitude = Math.abs(percent);
  const digits = magnitude < 1 ? 2 : (magnitude < 10 ? 1 : 0);
  const rounded = magnitude.toFixed(digits).replace('.', ',');
  return `${percent >= 0 ? '+' : '−'}${rounded} %`;
}

/**
 * `1:500`, from the published string or number.
 *
 * Ungrouped on purpose: a scale denominator reads as one token, and
 * `toLocaleString('fr-FR')` renders 1:5000 as `1:5 000` with a narrow no-break
 * space sitting in the middle of it.
 */
export function formatScale(echelle) {
  const value = finiteOrNull(echelle);
  return value === null || value <= 0 ? null : `1:${value}`;
}

/** `±0,25 m`, from a metre tolerance. */
export function formatToleranceM(metres) {
  const value = finiteOrNull(metres);
  if (value === null) return null;
  return `±${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

/**
 * The one-line title of a parcel: its section and number.
 *
 * Not the IDU — 14 characters of digits is an identifier, not a name, and it
 * gets its own line on the card where it can be read as one.
 * @param {object} parcel
 * @returns {string}
 */
export function cadastreParcelTitle(parcel) {
  const section = text(parcel?.s);
  const numero = text(parcel?.n);
  if (section && numero) return `Parcelle ${section} ${numero}`;
  if (numero) return `Parcelle ${numero}`;
  return 'Parcelle';
}

/**
 * The commune line: name, arrondissement where there is one, INSEE code.
 * @param {object} parcel
 * @param {object} communes code_insee → name.
 * @returns {string}
 */
export function cadastreCommuneLine(parcel, communes = {}) {
  const code = text(parcel?.m);
  const name = text(communes?.[code]) || code || 'Commune inconnue';
  const ordinal = frenchOrdinal(arrondissementOrdinal(parcel?.r, code));
  const head = ordinal ? `${name} ${ordinal}` : name;
  return code ? `${head} · INSEE ${code}` : head;
}

/**
 * The sheet line: which plan this parcel's boundary was drawn on, at what
 * scale, and when that plan was last edited.
 * @param {?{e:?number, d:?string}} sheet
 * @param {object} parcel
 * @returns {string}
 */
export function cadastreSheetLine(sheet, parcel) {
  const section = text(parcel?.s);
  const feuille = finiteOrNull(parcel?.f);
  const name = section && feuille !== null
    ? `Feuille ${section} ${String(feuille).padStart(2, '0')}`
    : 'Feuille';
  const scale = formatScale(sheet?.e);
  if (!scale) return `${name} · échelle non publiée`;
  const edition = text(sheet?.d);
  return edition ? `${name} au ${scale} · édition ${edition}` : `${name} au ${scale}`;
}

/**
 * The tolerance line, and the assumption behind it.
 *
 * The assumption is ON the line, not in a tooltip: a reader who sees "±0,25 m"
 * with no provenance will take it for a survey figure, which is the single
 * misreading this layer exists to prevent.
 * @param {?{e:?number}} sheet
 * @returns {string}
 */
export function cadastreToleranceLine(sheet) {
  const tolerance = graphicToleranceM(sheet?.e);
  if (tolerance === null) return 'Tolérance non calculable — échelle du plan inconnue';
  return `Trait de plan ${formatToleranceM(tolerance)} (${String(CADASTRE_PEN_MM).replace('.', ',')} mm à l'échelle)`;
}

/**
 * The two areas, and the gap between them.
 *
 * Both figures always, never one derived from the other and never an average.
 * The declared contenance is what the DGFiP has registered; the drawn area is
 * what the plan's polygon encloses. Where they differ that IS the finding.
 * @param {object} parcel
 * @returns {string[]} One or two lines.
 */
export function cadastreAreaLines(parcel) {
  const declared = finiteOrNull(parcel?.c);
  const drawn = finiteOrNull(parcel?.a);
  const lines = [];
  if (declared === null) lines.push('Contenance non publiée');
  else if (declared === 0) lines.push('Contenance déclarée 0 m² — valeur publiée telle quelle');
  else lines.push(`Contenance déclarée ${formatSurfaceM2(declared)}`);

  if (drawn === null) return lines;
  if (declared !== null && declared > 0) {
    const gap = drawn / declared - 1;
    lines.push(Math.abs(gap) > CADASTRE_AREA_TOLERANCE
      ? `Tracé ${formatSurfaceM2(drawn)} — ${formatSignedPercent(gap)} contre la contenance`
      : `Tracé ${formatSurfaceM2(drawn)} (${formatSignedPercent(gap)})`);
  } else {
    lines.push(`Tracé ${formatSurfaceM2(drawn)}`);
  }
  return lines;
}

/**
 * The status line the row shows while a box is loaded, refused or empty.
 * @param {object} state
 * @returns {?string}
 */
export function cadastreLoadingLabel({ status, totalInBox } = {}) {
  if (status === 'too-high') {
    return `Descends sous ${CADASTRE_MAX_ALTITUDE_M.toLocaleString('fr-FR')} m pour charger le parcellaire`;
  }
  if (status === 'off-coverage') return 'Hors couverture PCI vecteur (France et DROM)';
  if (status === 'too-dense') {
    const count = finiteOrNull(totalInBox);
    return count === null
      ? 'Vue trop dense pour une réponse complète — zoome'
      : `${count.toLocaleString('fr-FR')} parcelles ici — au-delà des ${CADASTRE_UPSTREAM_LIMIT.toLocaleString('fr-FR')} qu'Api Carto renvoie. Zoome.`;
  }
  if (status === 'empty') return 'Aucune parcelle ici — domaine public, ou hors de France';
  if (status === 'loading') return 'Parcelles Api Carto…';
  return null;
}
