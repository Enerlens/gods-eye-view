/**
 * @module bruitFeed
 *
 * France's aircraft-noise exposure plans, read one screen pixel at a time —
 * and the arithmetic that keeps a number people care about from being a lie.
 *
 * ── What this adds over `urbanismeGpu` ──────────────────────────────────────
 * The Géoportail de l'urbanisme already reaches the *plan d'exposition au
 * bruit*: it is servitude type `t5`/`t7` and `DATA_SOURCES.md` says so. But it
 * arrives there as ONE MORE EASEMENT AT AN ADDRESS — a `suptype` code, an
 * `assiette` outline, a link to a PDF. No zone letter, no threshold, no index,
 * no unit. Measured over the same ground, that layer's answer at Roissy is
 * "servitude aéronautique"; this layer's answer is "zone C, Lden 56 → 65
 * dB(A), arrêté du 03/04/2007, LFPG". The difference is the number.
 *
 * ── THE FIELD THAT MIXES TWO UNITS, AND THE FIELD THAT LIES ABOUT ITS DATE ──
 * `indldenext` / `indldenint` are the two thresholds bounding a PEB band. They
 * are NOT always decibels. France replaced the *indice psophique* with Lden in
 * 2002, and the register keeps both eras in the same two columns with nothing
 * to tell them apart. Measured over ALL 224 airports in the arrêté index on
 * 2026-09-02, one probe each at the scale {@link BRUIT_PROBE_PIXEL_DEG} pins,
 * {@link BRUIT_PROBE_FEATURE_COUNT} features max — 298 PEB zone rows returned
 * (plus 11 PGS rows, all Lden):
 *
 *   arrêté before 2002    75 rows, values 78 … 96   (indice psophique)
 *   arrêté 2002 or later 223 rows, values 50 … 70   (Lden dB(A))
 *
 * THE PROBE SCALE DECIDES THAT CENSUS, which is why it is restated with the
 * scale it was taken at. The same sweep at the pre-pinning 3e-4°/pixel returns
 * 426 rows over the same 224 airports: a coarser probe means a wider
 * GetFeatureInfo buffer, so it catches polygons the point is not in. Those extra
 * rows are all `atPoint: false` — verified on the six airports that gain an
 * answer between the two scales — so they are context, never answers.
 *
 * Printing "84–89 dB(A)" over Semur or Villacoublay is a fabricated physical
 * unit. So the unit is chosen from the DATE, never from the value.
 *
 * AND THE DATE FIELD IS NOT ENOUGH ON ITS OWN. `date_arret` is stale on at
 * least one airport: **LFNA (Gap-Tallard) publishes `date_arret`
 * 1985-07-01 with `ref_doc` `PEB_LFNA_11_04_2017.pdf` and the values 70/70** —
 * the plan was reissued in 2017 in Lden and the date column was never moved.
 * Reading `date_arret` alone labels Gap "indice psophique 70", which is an
 * obsolete unit printed on a live decibel value. So the effective year is the
 * LATER of `date_arret` and the date inside the document `ref_doc` points at
 * (see {@link arreteDocumentDate}); measured, 6 of the 298 rows carry a
 * document newer than their register date and exactly 1 of them — Gap — has the
 * two dates straddling 2002, so exactly 1 row changes unit.
 *
 * THE VERDICT IS THEN CHECKED, NOT TRUSTED. An Lden verdict must not carry a
 * value above {@link BRUIT_LDEN_MAX_OBSERVED}, and a psophique verdict must not
 * carry one below {@link BRUIT_PSOPHIQUE_MIN_OBSERVED}. Measured over the same
 * 298 rows the two scales do not overlap at all — nothing lands in 70 < x < 78
 * — and the effective-date rule disagrees with the value range on **0 rows**.
 * A future disagreement is reported as `indexDisputed` and the unit is
 * SUPPRESSED rather than guessed: no unit at all beats the wrong one.
 *
 * Nothing here converts psophique to dB. The correspondence is a regulatory
 * table, not a formula, and it is not in this data.
 *
 * ── THE SERVER STOPS ANSWERING WHEN YOU ZOOM IN, WITH HTTP 200 ──────────────
 * `dgac_peb_plan_wmsv` carries a MinScaleDenominator. Measured at Roissy on
 * 2026-09-01, same point, only the requested rendering scale changed:
 *
 *   1:119,271  → 1 feature, 3,932 B      1:39,757 → 1 feature,  7,803 B
 *   1: 26,505  → 1 feature, 9,660 B      1:24,848 → **0 features, 137 B**
 *   1: 23,387 / 1:22,718 / 1:22,087 / 1:20,925 → 0 features, 137 B each
 *
 * The cutoff sits between 1:26,505 and 1:24,848, i.e. on 1:25,000. Below it the
 * service answers HTTP 200 with an empty FeatureCollection, which reads exactly
 * like "there is no noise plan here". Its sibling `dgac_pgs_plan_wmsv` has no
 * such floor — measured down to 1:994 at Orly, still answering. So the probe
 * geometry is PINNED at {@link BRUIT_PROBE_PIXEL_DEG} per pixel (1:39,757, a
 * 59% margin over the measured floor) and never derived from the camera.
 *
 * That pinning also buys detail: the returned outline is generalised to the
 * requested scale. Same Roissy zone C, 2,106 B at 1:312,968 and 9,660 B at
 * 1:26,505 — a 4.6× difference in vertices for one polygon. Nothing drawn here
 * is a surveyed boundary and the card says so.
 *
 * ── GetFeatureInfo ANSWERS "NEAR", NOT "UNDER" ──────────────────────────────
 * GeoServer returns features within a buffer of the queried pixel, so a
 * returned zone is not necessarily a zone the point is IN. Measured at Les
 * Mureaux (LFXU) at the pinned scale: 4 features come back and only 2 of them
 * contain the probe point — the two zone-A polygons are beside it, not under
 * it. So every feature is re-tested here with `pointInPolygons` from
 * `ringGeometry.js`, holes included, and only `atPoint` zones answer the
 * question. The rest are kept and drawn as context rather than discarded,
 * because "the louder zone starts thirty metres away" is worth seeing.
 *
 * ── ONE ANSWER PER AIRPORT, AND THE INNERMOST ZONE WINS ─────────────────────
 * A probe can return several bands of one plan at once, and can return two
 * different airports' plans at one point (measured at Le Bourget: LFPB zone A,
 * arrêté 2017, AND Roissy's zone D, arrêté 2007, both containing the point).
 * Two plans are two facts, so they are reported separately, each with its own
 * arrêté and its own unit. Within ONE airport the bands are ordered by
 * severity — A over B over C over D — and the most exposed is the airport's
 * answer; the others are the bands that contain it and are listed, never
 * dropped. Identical bands published as separate polygons (measured at LFXU,
 * LFPV, LFPZ and LFGQ) are merged, and the piece count reported.
 *
 * Dependency-free apart from `ringGeometry.js`, and side-effect-free (no
 * Cesium, no DOM) so it runs identically in the browser, in the Vite
 * dev-server proxy, and under `node --test`.
 */

import { pointInPolygons, polygonsBounds, ringLabelAnchor } from './ringGeometry.js';

/** The keyless Géoplateforme vector WMS. `<Fees>none</Fees>`, CORS `*`. */
export const BRUIT_WMS_BASE = 'https://data.geopf.fr/wms-v/ows';

/** Plan d'exposition au bruit — where you may not build. */
export const BRUIT_PEB_LAYER = 'dgac_peb_plan_wmsv';
/** Plan de gêne sonore — who the insulation fund pays. */
export const BRUIT_PGS_LAYER = 'dgac_pgs_plan_wmsv';

/** Attribution carried on every payload (see DATA_SOURCES.md). */
export const BRUIT_SOURCE = 'Plans d’exposition au bruit et plans de gêne sonore — DGAC, '
  + 'via la Géoplateforme (data.geopf.fr)';

/**
 * Degrees of the BBOX spent per rendered pixel — the one number that decides
 * whether the service answers at all.
 *
 * `dgac_peb_plan_wmsv` stops rendering below 1:25,000 and then returns HTTP 200
 * with an empty FeatureCollection (see the module header for the eight measured
 * points either side of the cutoff). 1e-4° per pixel is 1:39,757 by the OGC
 * formula GeoServer uses for a geographic CRS — 59% above the floor, and still
 * 2.5× the vertices the naive 3e-4° probe returns.
 *
 * It is a CONSTANT and not a function of the camera on purpose: deriving it
 * from the view would make the layer answer at 30 km and go silently blank at
 * 800 m, which is the altitude a reader is most likely to be at.
 */
export const BRUIT_PROBE_PIXEL_DEG = 1e-4;

/**
 * Pixels per side of the rendered frame the probe asks for.
 *
 * ODD, and that is the point: with `I = J = (N - 1) / 2` the queried pixel is
 * centred exactly on the requested coordinate instead of straddling the corner
 * between four of them. 101 keeps the rendered frame small — the BBOX is
 * `N × BRUIT_PROBE_PIXEL_DEG` = 0.0101°, about 1.1 km — while the returned
 * geometry is NOT clipped to it: measured, one 0.0101° box at Roissy returns a
 * zone C spanning 0.57° of longitude, 56× the box it was asked through.
 */
export const BRUIT_PROBE_PIXELS = 101;

/**
 * Features asked for per probe.
 *
 * Measured over 224 airports at the pinned scale on 2026-09-02, the features
 * returned per probe are 0 → 9, 1 → 141, 2 → 67, 3 → 5, 4 → 2: the worst single
 * probe returns 4. Twenty-four is six times that, so truncation is not a state
 * this layer has to reason about — and asking for more costs nothing, because
 * GeoServer stops at what it finds.
 */
export const BRUIT_PROBE_FEATURE_COUNT = 24;

/**
 * The OGC scale denominator {@link BRUIT_PROBE_PIXEL_DEG} produces.
 *
 * GeoServer converts a geographic BBOX with the fixed
 * `OGC_DEGREE_TO_METERS = 111319.4907932736` and the OGC standard pixel of
 * 0.28 mm. No latitude term, which is why the measured cutoff at Roissy (49°N)
 * is the same number everywhere.
 */
export const BRUIT_PROBE_SCALE_DENOMINATOR = Math.round(
  (BRUIT_PROBE_PIXEL_DEG * 111319.4907932736) / 0.00028,
);

/**
 * The floor measured on `dgac_peb_plan_wmsv`, for the test that guards the
 * choice above. Answers at 1:26,505; silent at 1:24,848.
 */
export const BRUIT_PEB_MIN_SCALE_DENOMINATOR = 25_000;

/**
 * First year of Lden.
 *
 * Décret n° 2002-626 replaced the *indice psophique* with Lden for the PEB.
 * The register's own dates straddle the change with a three-year gap and
 * nothing in it: measured, the newest pre-2002 arrêté in the index is
 * 2001-11-09 and the oldest post-2002 one is 2004-09-07, so the boundary is
 * never a judgement call about a single document.
 */
export const BRUIT_LDEN_FROM_YEAR = 2002;

/** Highest threshold observed on a post-2002 arrêté, over 223 rows. */
export const BRUIT_LDEN_MAX_OBSERVED = 70;
/**
 * Guard floor for a psophique verdict.
 *
 * NOT the lowest value observed — measured over 75 pre-2002 rows that is 78.
 * 72 is the classic *indice psophique* threshold for the outermost zone, so it
 * sits below every value the register actually publishes while still being a
 * number from the scale itself rather than a margin someone chose. The gap
 * between 70 (the highest Lden ever seen) and 78 is what makes the check safe;
 * this constant spends part of it deliberately, so the guard fires on a value
 * that has genuinely crossed into Lden territory and not on a low psophique one.
 */
export const BRUIT_PSOPHIQUE_MIN_OBSERVED = 72;

/**
 * The two indices, in the words that keep them apart.
 *
 * `psophique` deliberately does not carry a unit. The indice psophique is a
 * dimensionless index abandoned in 2002 and it is NOT decibels; the
 * correspondence with Lden is a regulatory table, not a conversion, and it is
 * not in this data.
 */
export const BRUIT_INDEX_LABELS = Object.freeze({
  lden: 'Lden dB(A)',
  psophique: 'indice psophique',
  unknown: null,
});

/** How each index is explained on a card, once, in full. */
export const BRUIT_INDEX_SENTENCES = Object.freeze({
  lden: 'Lden — niveau moyen pondéré jour/soirée/nuit, en dB(A)',
  psophique: 'indice psophique — échelle sans unité, abandonnée en 2002 : ce n’est pas un niveau en dB',
  unknown: 'indice indéterminé — l’arrêté et les seuils publiés ne concordent pas',
});

/**
 * PEB zones, most exposed first. The order IS the severity ranking used to
 * pick an airport's answer out of the bands that contain a point.
 */
export const PEB_ZONE_ORDER = Object.freeze(['A', 'B', 'C', 'D']);

/**
 * What each PEB zone means for the ground under it.
 *
 * The letters are the whole national grammar of the document and they are the
 * one part that is identical at every airport and under both indices, which is
 * why they are spelled out and the thresholds are not. Wording follows the
 * Code de l'urbanisme's own account of articles L.112-3 to L.112-16.
 */
export const PEB_ZONE_LABELS = Object.freeze({
  A: 'gêne très forte — constructions à usage d’habitation interdites',
  B: 'gêne forte — habitat très limité, isolation acoustique imposée',
  C: 'gêne modérée — habitat limité, isolation acoustique imposée',
  D: 'information — pas de restriction de construire, isolation acoustique et information des acquéreurs obligatoires',
});

/** PGS zones, most exposed first. Published as the digits 1/2/3. */
export const PGS_ZONE_ORDER = Object.freeze(['1', '2', '3']);

/**
 * What each PGS zone entitles the ground under it to.
 *
 * The PGS is not a building rule at all — it is the map of who the *taxe sur
 * les nuisances sonores aériennes* pays to soundproof. That is why it is drawn
 * differently from the PEB and never merged with it.
 */
export const PGS_ZONE_LABELS = Object.freeze({
  1: 'zone I — aide à l’insonorisation au taux le plus élevé',
  2: 'zone II — aide à l’insonorisation',
  3: 'zone III — aide à l’insonorisation au taux le plus bas',
});

/**
 * The two plans' field names for the same four concepts.
 *
 * Not a rename — a different schema on a sibling layer of the same service.
 * PEB publishes its thresholds as STRINGS (`'56'`, and once `'56.5'`), PGS as
 * integers; PEB spells the arrêté date `date_arret` and PGS `date_arrete`; and
 * PGS's inner threshold arrives as `indice_l_1`, truncated by whatever shapefile
 * the layer was built from. Reading one schema against the other yields
 * `undefined` for every threshold and a card with no numbers on it.
 */
const FIELD_MAP = Object.freeze({
  peb: Object.freeze({
    low: 'indldenext', high: 'indldenint', date: 'date_arret', zones: PEB_ZONE_ORDER,
  }),
  pgs: Object.freeze({
    low: 'indice_lde', high: 'indice_l_1', date: 'date_arrete', zones: PGS_ZONE_ORDER,
  }),
});

/**
 * Build one GetFeatureInfo URL for a point.
 *
 * WMS 1.3.0 with `CRS=EPSG:4326` means the BBOX axis order is LATITUDE FIRST.
 * Sending lon/lat here does not fail — it answers HTTP 200 about a point in
 * another country.
 *
 * @param {'peb'|'pgs'} kind
 * @param {{lat: number, lon: number}} point
 * @returns {string}
 */
export function buildBruitProbeUrl(kind, { lat, lon } = {}) {
  const layer = kind === 'pgs' ? BRUIT_PGS_LAYER : BRUIT_PEB_LAYER;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('bruit: lat/lon must be finite numbers');
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('bruit: lat/lon out of range');
  }
  const half = (BRUIT_PROBE_PIXELS * BRUIT_PROBE_PIXEL_DEG) / 2;
  const centre = (BRUIT_PROBE_PIXELS - 1) / 2;
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetFeatureInfo',
    LAYERS: layer,
    QUERY_LAYERS: layer,
    CRS: 'EPSG:4326',
    BBOX: [lat - half, lon - half, lat + half, lon + half].map((v) => v.toFixed(6)).join(','),
    WIDTH: String(BRUIT_PROBE_PIXELS),
    HEIGHT: String(BRUIT_PROBE_PIXELS),
    I: String(centre),
    J: String(centre),
    INFO_FORMAT: 'application/json',
    FEATURE_COUNT: String(BRUIT_PROBE_FEATURE_COUNT),
  });
  return `${BRUIT_WMS_BASE}?${params}`;
}

/**
 * The date inside the document `ref_doc` points at, as `YYYY-MM-DD`.
 *
 * The arrêté PDFs are named `PEB_<OACI>_<DD>_<MM>_<YYYY>.pdf`, and that name is
 * the only place a REVISED plan's real date survives when `date_arret` was left
 * behind — see the module header and Gap-Tallard. Measured 2026-09-02: all 224
 * URLs in the arrêté index and all 298 `ref_doc` values the plan layer returned
 * parse. The literal space is real and lives in the PLAN layer, not the index —
 * Montendre's `ref_doc` is `PEB_LFDC_ 28_07_1986.pdf` while the same
 * aerodrome's `arrete_peb` in the WFS index has none. One row in 298, and it is
 * why the pattern tolerates whitespace after the underscore.
 *
 * @param {string|null|undefined} url
 * @returns {?string} `YYYY-MM-DD`, or null when the name does not carry a date.
 */
export function arreteDocumentDate(url) {
  const match = /_\s*(\d{2})_(\d{2})_(\d{4})\.pdf\s*$/i.exec(String(url || ''));
  if (!match) return null;
  const [, day, month, year] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

/**
 * The `YYYY-MM-DD` prefix of a register date, or null.
 *
 * `date_arret` arrives as `'2007-04-03Z'` — a DATE carrying a datetime's zone
 * suffix, which `new Date()` on some engines reads as invalid. Sliced rather
 * than parsed: nothing here needs a clock.
 * @param {unknown} value
 * @returns {?string}
 */
export function registerDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  return match ? match[0] : null;
}

/**
 * Which index a band's thresholds are expressed in.
 *
 * The date decides and the value checks. See the module header for why it is
 * the LATER of the two dates, and for the measurement that says the two scales
 * never overlap.
 *
 * @param {{dateArret?: ?string, refDoc?: ?string, low?: ?number, high?: ?number}} band
 * @returns {{index: 'lden'|'psophique'|'unknown', effectiveDate: ?string,
 *   arreteDate: ?string, documentDate: ?string, revised: boolean, disputed: boolean}}
 */
export function noiseIndexOf({
  dateArret = null, refDoc = null, low = null, high = null,
} = {}) {
  const arreteDate = registerDate(dateArret);
  const documentDate = arreteDocumentDate(refDoc);
  const effectiveDate = (arreteDate && documentDate)
    ? (documentDate > arreteDate ? documentDate : arreteDate)
    : (arreteDate || documentDate);
  const revised = Boolean(arreteDate && documentDate && documentDate > arreteDate);
  if (!effectiveDate) {
    return {
      index: 'unknown', effectiveDate: null, arreteDate, documentDate, revised, disputed: false,
    };
  }
  const year = Number(effectiveDate.slice(0, 4));
  const claimed = year >= BRUIT_LDEN_FROM_YEAR ? 'lden' : 'psophique';
  const values = [low, high].filter((v) => Number.isFinite(v));
  // The check that turns a stale date field into a suppressed unit rather than
  // a wrong one. Measured over 298 rows it never fires; it exists because the
  // day it does, the alternative is printing an abandoned index on a decibel.
  const disputed = values.length > 0 && (
    claimed === 'lden'
      ? Math.max(...values) > BRUIT_LDEN_MAX_OBSERVED
      : Math.min(...values) < BRUIT_PSOPHIQUE_MIN_OBSERVED
  );
  return {
    index: disputed ? 'unknown' : claimed,
    effectiveDate,
    arreteDate,
    documentDate,
    revised,
    disputed,
  };
}

/**
 * A threshold, as a number, whatever the layer chose to publish it as.
 *
 * PEB sends strings, PGS sends integers, and one PEB row sends `'56.5'` — which
 * `parseInt` silently truncates to 56, moving a boundary half a decibel without
 * saying so.
 * @param {unknown} value
 * @returns {?number}
 */
export function threshold(value) {
  // TYPE FIRST, then parse. `Number(null)`, `Number('')`, `Number(false)` and
  // `Number([])` are all 0, and 0 is a threshold this layer will happily print
  // as "0 Lden dB(A)" — a fabricated silence over real ground. The three
  // explicit equality checks that used to stand here caught null, undefined and
  // the empty string and let `false` and `[]` through as zero.
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The rings of one feature, as `[[outer, ...holes], …]`.
 *
 * NO decimation, and the measurement is why: over all 224 airports at the
 * pinned scale the heaviest single zone returned is 664 vertices (Le Bourget's
 * probe, Roissy's zone D) and the heaviest whole response 15,041 bytes; the
 * whole national sweep is 15,619 vertices over 473,193 bytes. `gpuFeed.js` decimates because one of
 * its easements is 50,669 vertices; nothing here is within two orders of
 * magnitude of that, so the outline drawn is the outline the service sent.
 *
 * The holes are carried, and they are not decoration. Measured at the pinned
 * scale: Roissy's zone C arrives as one polygon with TWO interior rings, and
 * Les Mureaux's zone B with SIX. A PEB zone is a RING — the ground between two
 * thresholds — so its holes are exactly where the LOUDER zone begins. Filled
 * without them, zone C is painted over zone B and zone A, and the map shows the
 * quiet number on the loudest ground.
 *
 * @param {object|null|undefined} geometry
 * @returns {{parts: Array<Array<Array<number[]>>>, vertices: number, holes: number}}
 */
export function projectRings(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates
      : [];
  const parts = [];
  let vertices = 0;
  let holes = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) continue;
    const rings = [];
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const clean = [];
      for (const point of ring) {
        // `typeof`, not `Number()`. GeoJSON coordinates are numbers, and a
        // vertex that arrives as `null` or `''` is a changed upstream — but
        // `Number(null)` is 0, so an unguarded parse puts that vertex at 0°N
        // 0°E and stretches the ring from the aerodrome to the Gulf of Guinea.
        const lon = point?.[0];
        const lat = point?.[1];
        if (typeof lon === 'number' && typeof lat === 'number'
          && Number.isFinite(lon) && Number.isFinite(lat)) clean.push([lon, lat]);
      }
      if (clean.length >= 3) rings.push(clean);
    }
    if (!rings.length) continue;
    vertices += rings.reduce((sum, ring) => sum + ring.length, 0);
    holes += rings.length - 1;
    parts.push(rings);
  }
  return { parts, vertices, holes };
}

/**
 * Identity of a BAND — the thing two returned polygons have to share to be the
 * same band published twice.
 *
 * Not `id_map`: measured at Les Mureaux, Villacoublay, Saint-Cyr and Semur the
 * same band of the same arrêté comes back as two features with two different
 * `id_map` values, which is the register storing one zone as several polygons.
 * The airport, the letter, the two thresholds and the arrêté are what make it
 * one band.
 * @param {object} band
 * @returns {string}
 */
function bandKey(band) {
  return [band.oaci, band.zone, band.low, band.high, band.arreteDate].join('|');
}

/**
 * Project one plan's GetFeatureInfo answer.
 *
 * `point` is the coordinate the probe was aimed at, and it is what separates
 * "the zone you are standing in" from "a zone the service found near your
 * pixel" — see the module header. Every returned feature is re-tested against
 * its own published rings, holes included.
 *
 * @param {object|null|undefined} payload GeoJSON FeatureCollection.
 * @param {{kind: 'peb'|'pgs', point: {lat: number, lon: number}}} options
 * @returns {Array<object>}
 */
export function projectBruitZones(payload, { kind = 'peb', point } = {}) {
  const fields = FIELD_MAP[kind] || FIELD_MAP.peb;
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const lon = Number(point?.lon);
  const lat = Number(point?.lat);
  const hasPoint = Number.isFinite(lon) && Number.isFinite(lat);
  const merged = new Map();
  for (const feature of features) {
    const properties = feature?.properties || {};
    const geometry = projectRings(feature?.geometry);
    if (!geometry.parts.length) continue;
    const low = threshold(properties[fields.low]);
    const high = threshold(properties[fields.high]);
    const zone = String(properties.zone ?? '').trim() || null;
    const oaci = String(properties.code_oaci ?? '').trim() || null;
    const decided = noiseIndexOf({
      dateArret: properties[fields.date],
      refDoc: properties.ref_doc,
      low,
      high,
    });
    const band = {
      kind,
      id: `${kind}:${properties.id_map ?? `${oaci}-${zone}`}`,
      oaci,
      airport: String(properties.nom ?? '').trim() || null,
      zone,
      // The register publishes these two the wrong way round on 7 of the 298
      // measured rows — LFBG, LFCG, LFCH, LFHA, LFLG, LFMD and LFMN carry
      // `indldenext` ABOVE `indldenint`, which printed in field order reads
      // "70 → 65 dB(A)", a band that runs backwards. Sorted rather than
      // trusted; `low`/`high` are the names of what they hold.
      low: (low !== null && high !== null) ? Math.min(low, high) : (low ?? high),
      high: (low !== null && high !== null) ? Math.max(low, high) : (high ?? low),
      inverted: (low !== null && high !== null && low > high),
      index: decided.index,
      indexDisputed: decided.disputed,
      arreteDate: decided.arreteDate,
      documentDate: decided.documentDate,
      effectiveDate: decided.effectiveDate,
      // The plan was reissued and `date_arret` was not moved. Said out loud
      // because it is the field a reader would check.
      revisedDocument: decided.revised,
      producer: String(properties.producteur ?? '').trim() || null,
      updatedOn: registerDate(properties.date_maj),
      documentUrl: properties.ref_doc || null,
      atPoint: hasPoint ? pointInPolygons(geometry.parts, lon, lat) : false,
      parts: geometry.parts,
      vertices: geometry.vertices,
      holes: geometry.holes,
      pieces: 1,
      bounds: polygonsBounds(geometry.parts),
      anchor: geometry.parts.map((rings) => ringLabelAnchor(rings))
        .filter(Boolean)
        .sort((a, b) => b.widthDeg - a.widthDeg)[0] || null,
    };
    const key = bandKey(band);
    const seen = merged.get(key);
    if (!seen) {
      merged.set(key, band);
      continue;
    }
    // The same band arriving as a second polygon. Both pieces are kept — a
    // zone published as two lobes really does cover two pieces of ground —
    // and the count says the answer came from more than one feature.
    seen.parts.push(...band.parts);
    seen.vertices += band.vertices;
    seen.holes += band.holes;
    seen.pieces += 1;
    seen.atPoint = seen.atPoint || band.atPoint;
    seen.bounds = polygonsBounds(seen.parts);
  }
  const bands = [...merged.values()];
  const rank = (zone) => {
    const index = fields.zones.indexOf(String(zone));
    return index === -1 ? fields.zones.length : index;
  };
  // Most exposed first, and a band the point is IN before one merely beside
  // it — so a consumer that takes `bands[0]` is right rather than lucky.
  bands.sort((a, b) => Number(b.atPoint) - Number(a.atPoint) || rank(a.zone) - rank(b.zone));
  return bands;
}

/**
 * Fold one plan's bands into one answer PER AIRPORT.
 *
 * Two airports at one point are two facts, not an ambiguity to resolve: Le
 * Bourget's own zone A and Roissy's zone D both contain the ground north of
 * Paris, under two different arrêtés. Within an airport the bands nest, so the
 * most exposed one is the answer and the rest are the bands that contain it.
 *
 * @param {Array<object>} bands Output of {@link projectBruitZones}.
 * @returns {Array<object>} One entry per airport, most exposed first.
 */
export function foldByAirport(bands) {
  const byAirport = new Map();
  for (const band of bands) {
    if (!band.atPoint) continue;
    const key = band.oaci || band.airport || band.id;
    const entry = byAirport.get(key);
    if (!entry) {
      byAirport.set(key, { ...band, alsoInside: [] });
      continue;
    }
    // `bands` arrives severity-sorted, so anything after the first is a band
    // that CONTAINS the answer rather than a competitor for it.
    entry.alsoInside.push({ zone: band.zone, low: band.low, high: band.high });
  }
  return [...byAirport.values()];
}

/**
 * The band, in the unit it is actually in.
 *
 * Returns null rather than a number when the index could not be settled: a
 * threshold with no unit beside it is read as decibels by everyone, which is
 * the failure this whole module exists to prevent.
 *
 * @param {object|null|undefined} band
 * @returns {?string}
 */
export function bandText(band) {
  const low = band?.low;
  const high = band?.high;
  if (!Number.isFinite(low) && !Number.isFinite(high)) return null;
  const unit = BRUIT_INDEX_LABELS[band?.index ?? 'unknown'];
  const span = (Number.isFinite(low) && Number.isFinite(high) && low !== high)
    ? `${low} – ${high}`
    : String(Number.isFinite(high) ? high : low);
  if (!unit) return `seuils ${span} — indice non déterminé`;
  return band.index === 'lden' ? `${span} ${unit}` : `${unit} ${span}`;
}

/**
 * Assemble the two plans, the point, and what is NOT there, into one document.
 *
 * A missing half is carried in `available` rather than being an error: the PGS
 * only exists at the ten-odd airports funding an insulation scheme, so "no PGS
 * here" is the normal answer and must not read as an outage.
 *
 * `nearest` is the honest empty state. When no plan covers the ground, the
 * layer names the nearest aerodrome that HAS one, from the arrêté index's own
 * published coordinate — never a guess, never a commune centroid.
 *
 * @param {{peb?: object|null, pgs?: object|null, point: {lat: number, lon: number},
 *   nearest?: ?object}} input
 * @returns {object}
 */
export function projectBruit({
  peb = null, pgs = null, point, nearest = null,
} = {}) {
  const pebBands = projectBruitZones(peb, { kind: 'peb', point });
  const pgsBands = projectBruitZones(pgs, { kind: 'pgs', point });
  const pebHere = foldByAirport(pebBands);
  const pgsHere = foldByAirport(pgsBands);
  const all = [...pebBands, ...pgsBands];
  const indices = [...new Set(all.filter((b) => b.atPoint).map((b) => b.index))];
  return {
    peb: pebBands,
    pgs: pgsBands,
    // The answer: one entry per airport whose plan actually covers this ground.
    airports: pebHere,
    pgsAirports: pgsHere,
    point: { lat: point.lat, lon: point.lon },
    // Bands the service returned that do NOT contain the point. They are drawn
    // as context and counted here so a card can say "the louder zone is near"
    // without claiming it is underfoot.
    nearbyCount: all.filter((band) => !band.atPoint).length,
    // Two indices at one point is a real state — an airport still on a
    // pre-2002 arrêté beside one reissued in Lden — and the card must say so
    // rather than picking a unit.
    mixedIndex: indices.length > 1,
    indices,
    disputed: all.some((band) => band.atPoint && band.indexDisputed),
    revised: all.some((band) => band.atPoint && band.revisedDocument),
    nearest: nearest ? { ...nearest } : null,
    // The scale the outlines were generalised at, carried so the card can say
    // it rather than implying a survey.
    scaleDenominator: BRUIT_PROBE_SCALE_DENOMINATOR,
    available: { peb: Boolean(peb), pgs: Boolean(pgs) },
  };
}
