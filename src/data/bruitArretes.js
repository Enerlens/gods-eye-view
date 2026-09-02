/**
 * @module bruitArretes
 *
 * The national register of French airport noise-exposure plans — 224
 * aerodromes, one point each, and the only place in this family where a
 * coverage claim can honestly be made.
 *
 * ── Why a second module for 66 KB of points ─────────────────────────────────
 * `bruitFeed.js` asks the map service what is under one pixel. That answer can
 * never say what is NOT there: an empty FeatureCollection means "no plan
 * covers this ground", "you are too zoomed in for the service to draw it", and
 * "this aerodrome has an arrêté but no polygon" all at once. The arrêté layer
 * is the register that separates them, and it is a completely different
 * service — WFS, not WMS-GetFeatureInfo.
 *
 * Measured on 2026-09-01 against `dgac_peb_arrete_wfs`:
 * **HTTP 200, 66,355 bytes, `numberMatched` 224, `numberReturned` 224**, three
 * fields per feature (`nom`, `oaci`, `arrete_peb`) and a Point geometry. All
 * 224 OACI codes are distinct, all 224 carry a coordinate, and the extent runs
 * lon −61.53 → 55.52, lat −21.32 → 50.69 — Guadeloupe to La Réunion, not
 * metropolitan France.
 *
 * ── The date is in the FILENAME, and nowhere else in this file ──────────────
 * The WFS index publishes no date at all. But `arrete_peb` points at
 * `PEB_<OACI>_<DD>_<MM>_<YYYY>.pdf`, and that name parses on **224 of 224**
 * rows — measured 2026-09-02, every one matching the strict
 * `PEB_<OACI>_DD_MM_YYYY.pdf` shape with no whitespace. (The one URL in this
 * family that carries a literal space, `PEB_LFDC_ 28_07_1986.pdf`, is in the
 * PLAN layer's `ref_doc`, not here; `arreteDocumentDate` tolerates both.)
 * From it: **70 aerodromes are still governed by a pre-2002 arrêté and 154 by a
 * 2002-or-later one**, oldest 1974, newest 2022. That is the national shape of
 * the unit problem `bruitFeed.js` solves per band — a third of the register is
 * on an index that was abandoned before the euro was in circulation.
 *
 * ── 9 of the 224 answer nothing at their own point; 3 answer nothing at all ──
 * Probed at their own published coordinate at the pinned scale on 2026-09-02,
 * **215 of 224** aerodromes return at least one zone from `dgac_peb_plan_wmsv`.
 * The nine that return an empty FeatureCollection are LFPN, LFPZ, LFCW, LFIB,
 * LFME, LFPK, LFPT, LFDY and LFMX — all nine on a pre-2002 arrêté, and the
 * emptiness is stable over three repeats each.
 *
 * They are not the same case, and the difference matters. Re-probed at the
 * pre-pinning 3e-4°/pixel, six of them (LFPZ, LFCW, LFIB, LFME, LFDY, LFMX) DO
 * return 1 to 4 features — and every one of those features is `atPoint: false`.
 * Their aerodrome reference point is simply not inside their own noise zones,
 * so the pinned probe loses context and no answers. The other three — LFPN
 * (Toussus-le-Noble, arrêté 1985), LFPK (Coulommiers, 1984) and LFPT (Pontoise,
 * 1980) — return nothing at 1e-4, 3e-4 or 1e-3: they have an arrêté and no
 * polygon in the plan layer at all.
 *
 * So "224 aerodromes" is the register's number and an upper bound on what this
 * globe can draw; the layer states both.
 *
 * ── What this index is FOR, at runtime ──────────────────────────────────────
 * One thing: turning an empty probe into a sentence. "No noise plan covers this
 * ground; the nearest aerodrome that has one is LFPG — P. CH. DE GAULLE,
 * 12.4 km away, arrêté of 03/04/2007." The coordinate in that sentence is the
 * register's own published point, never a commune centroid and never a guess.
 *
 * Dependency-free apart from the shared great-circle helper, and
 * side-effect-free (no Cesium, no DOM).
 */

import { greatCircleKm } from './trafficBounds.js';
import {
  BRUIT_LDEN_FROM_YEAR,
  arreteDocumentDate,
} from './bruitFeed.js';

/** The keyless Géoplateforme WFS. Same service family, different protocol. */
export const BRUIT_WFS_BASE = 'https://data.geopf.fr/wfs/ows';

/**
 * The arrêté layer's type name.
 *
 * The PLAN layers are not here and asking for them is not a 404 — measured,
 * `dgac_peb_plan_wfs` answers HTTP 400 with an `ows:ExceptionReport` reading
 * "Unknown namespace". The polygons exist only behind GetFeatureInfo.
 */
export const BRUIT_ARRETE_TYPENAME = 'dgac_peb_arrete_wfs:dgac_peb_arrete_wfs';

/**
 * Rows asked for.
 *
 * `numberMatched` is 224 and has been since the register was measured; 500 is
 * headroom for a register that gains an aerodrome, and small enough that a
 * service answering with something absurd cannot be mistaken for a national
 * index. {@link projectPebArretes} reports `total` from the response's own
 * `numberMatched`, so a truncation is visible rather than assumed away.
 */
export const BRUIT_ARRETE_COUNT = 500;

/**
 * The count this module was measured against.
 *
 * Not a ceiling and not an assertion — a floor for the sanity check in
 * {@link projectPebArretes}. An index that suddenly answers with a handful of
 * rows is a broken upstream, and drawing "the nearest aerodrome with a noise
 * plan" out of six of them would be worse than saying nothing.
 */
export const BRUIT_ARRETE_FLOOR = 224;

/**
 * How far the "nearest aerodrome with a plan" sentence is allowed to reach.
 *
 * 150 km. Beyond it the sentence stops being useful — from central France the
 * nearest PEB is always SOME airport, and naming one 300 km away says nothing
 * about the ground under the camera. Past this the layer says only that no plan
 * covers the point.
 */
export const BRUIT_NEAREST_MAX_KM = 150;

/**
 * Build the WFS URL for the whole index.
 *
 * `SRSNAME=EPSG:4326` is not optional decoration: without it the service
 * answers in its own default axis order and the coordinates arrive transposed,
 * which puts every French aerodrome in the Indian Ocean.
 * @returns {string}
 */
export function buildPebArreteIndexUrl() {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: BRUIT_ARRETE_TYPENAME,
    COUNT: String(BRUIT_ARRETE_COUNT),
    OUTPUTFORMAT: 'application/json',
    SRSNAME: 'EPSG:4326',
  });
  return `${BRUIT_WFS_BASE}?${params}`;
}

/**
 * Split `"LFSB - BALE"` into its code and its name.
 *
 * `nom` repeats the OACI code before a dash on all 224 rows, so printing it
 * whole reads "LFSB — LFSB - BALE". The `oaci` field is the authority; this
 * only trims the echo off the front of the name.
 * @param {string|null|undefined} nom
 * @param {string|null|undefined} oaci
 * @returns {?string}
 */
export function arreteName(nom, oaci) {
  const raw = String(nom ?? '').trim();
  if (!raw) return null;
  const code = String(oaci ?? '').trim().toUpperCase();
  const stripped = code && raw.toUpperCase().startsWith(`${code} -`)
    ? raw.slice(code.length + 1).replace(/^\s*-\s*/, '').trim()
    : raw;
  return stripped || raw;
}

/**
 * Project the national arrêté index.
 *
 * A row with no coordinate is COUNTED and dropped, never placed: an aerodrome
 * without a published point cannot be the answer to "which one is nearest".
 * Measured, that case does not occur — all 224 rows carry a Point — and the
 * counter exists so the day it does, the card says so instead of the map
 * quietly shifting.
 *
 * @param {object|null|undefined} payload GeoJSON FeatureCollection.
 * @returns {{airports: Array<object>, total: ?number, count: number,
 *   unplaced: number, psophique: number, lden: number, undated: number,
 *   oldest: ?string, newest: ?string, truncated: boolean, short: boolean}}
 */
export function projectPebArretes(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const rawTotal = Number(payload?.numberMatched);
  const total = Number.isFinite(rawTotal) ? rawTotal : null;
  const airports = [];
  let unplaced = 0;
  let psophique = 0;
  let lden = 0;
  let undated = 0;
  let oldest = null;
  let newest = null;
  for (const feature of features) {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    // `typeof`, not `Number()`. A GeoJSON coordinate is a number; a row that
    // arrives as `[null, null]` is a changed upstream — but `Number(null)` is 0
    // and `Number.isFinite(0)` is true, so an unguarded parse PLACES that
    // aerodrome at 0°N 0°E and makes it "the nearest aerodrome with a noise
    // plan" for the whole Gulf of Guinea. That is precisely the row the
    // docstring above promises to count and drop.
    const rawLon = coordinates?.[0];
    const rawLat = coordinates?.[1];
    const lon = typeof rawLon === 'number' ? rawLon : Number.NaN;
    const lat = typeof rawLat === 'number' ? rawLat : Number.NaN;
    const oaci = String(properties.oaci ?? '').trim().toUpperCase() || null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) {
      unplaced += 1;
      continue;
    }
    const documentUrl = properties.arrete_peb || null;
    const arreteDate = arreteDocumentDate(documentUrl);
    if (!arreteDate) undated += 1;
    else {
      if (Number(arreteDate.slice(0, 4)) >= BRUIT_LDEN_FROM_YEAR) lden += 1;
      else psophique += 1;
      if (!oldest || arreteDate < oldest) oldest = arreteDate;
      if (!newest || arreteDate > newest) newest = arreteDate;
    }
    airports.push({
      oaci,
      name: arreteName(properties.nom, oaci),
      lat,
      lon,
      // The date the DOCUMENT carries. The WFS index publishes none of its
      // own, so this is the register's only statement about when the plan was
      // made — and the field `bruitFeed.js` uses to catch a stale `date_arret`.
      arreteDate,
      // Which index the plan is expressed in, from its date alone. There are
      // no thresholds in this file to cross-check it against, so it is a
      // claim about the DOCUMENT and never printed beside a number.
      index: arreteDate
        ? (Number(arreteDate.slice(0, 4)) >= BRUIT_LDEN_FROM_YEAR ? 'lden' : 'psophique')
        : 'unknown',
      documentUrl,
    });
  }
  return {
    airports,
    total,
    count: airports.length,
    unplaced,
    psophique,
    lden,
    undated,
    oldest,
    newest,
    truncated: total !== null && features.length < total,
    // An index that came back materially shorter than the one this was written
    // against. Reported rather than silently used.
    short: airports.length < BRUIT_ARRETE_FLOOR,
  };
}

/**
 * The nearest aerodrome that HAS a noise plan, within
 * {@link BRUIT_NEAREST_MAX_KM}.
 *
 * Linear over 224 points, which is 224 great-circle evaluations per empty
 * probe — cheaper than any index that would have to be built and invalidated,
 * and it runs once per scan, server-side.
 *
 * @param {Array<object>} airports Projected index.
 * @param {number} lat @param {number} lon
 * @param {number} [maxKm]
 * @returns {?{oaci: ?string, name: ?string, lat: number, lon: number,
 *   arreteDate: ?string, index: string, documentUrl: ?string, distanceKm: number}}
 */
export function nearestArrete(airports, lat, lon, maxKm = BRUIT_NEAREST_MAX_KM) {
  if (!Array.isArray(airports) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  for (const airport of airports) {
    if (!Number.isFinite(airport?.lat) || !Number.isFinite(airport?.lon)) continue;
    const distanceKm = greatCircleKm(lat, lon, airport.lat, airport.lon);
    if (!Number.isFinite(distanceKm)) continue;
    if (!best || distanceKm < best.distanceKm) best = { ...airport, distanceKm };
  }
  if (!best || best.distanceKm > maxKm) return null;
  // One decimal: this is a "how far away is it" number, and the register's own
  // point is an aerodrome reference point, not the end of a runway.
  return { ...best, distanceKm: Math.round(best.distanceKm * 10) / 10 };
}
