/**
 * @module delinquanceDepartements
 *
 * The national regime of the recorded-delinquency layer: one indicator, one
 * year, cut into quantile bands over the 96 bundled metropolitan département
 * polygons — and the accounting for the five départements that have no polygon
 * to be drawn on.
 *
 * ── Why this fold is a JOIN and not a point-in-polygon sweep ────────────────
 * `supDepartements.js` and `schoolsDepartements.js` fold POINTS: they run
 * `locateDepartement` over tens of thousands of coordinates because their
 * registers publish coordinates and a code join would silently lose Corsica —
 * registers zero-pad and spell it `02A`/`02B` where the IGN outlines use
 * `2A`/`2B`. There are no coordinates here at all. The SSMSI département base
 * publishes one row per (département code × indicateur × année) and nothing
 * else; the only join available is on the code, so the honest thing is to make
 * that join PROVABLE rather than to pretend it is geometry.
 *
 * So it is checked in both directions, and the check is the measurement:
 * on 2026-09-01 the base's 101 codes and the bundle's 96 codes intersect
 * perfectly — **every one of the 96 polygons has a row, and the 5 codes with
 * no polygon are exactly 971, 972, 973, 974 and 976**. Corsica does not bite
 * here because this register writes `2A` and `2B` exactly as the outlines do
 * (verified against both files, not assumed). That is a property of THIS
 * edition, not a law, so `unmatched` is returned rather than swallowed: if a
 * future edition starts zero-padding, the number on the card goes from 5 to 7
 * and the layer says so instead of quietly dropping Corsica.
 *
 * Point-in-polygon is still used, and used for the one thing here that really
 * is geometry: {@link locateDelinquanceDepartement} resolves the CAMERA to a
 * département when the commune regime needs to know which contours to ask for.
 * A bounding-box or centroid shortcut there gets Corsica and the Rhône wrong
 * for exactly the reasons `franceDepartements.js` documents.
 *
 * ── What is binned, and why it cannot be the count ─────────────────────────
 * The RATE. `supDepartements.js` argues that a choropleth must shade the
 * quantity the map is about rather than the drawn unit, and this is the same
 * argument with sharper teeth: a map of `nombre` is a map of population.
 * Measured on the 2025 edition, `Cambriolages de logement`: by count the
 * leaders are Bouches-du-Rhône 8 586, Nord 8 501, Rhône 7 153 and Paris 7 072,
 * and the eight biggest hold 55 198 of 211 596 facts — 26.1%, which is very
 * close to a list of the eight biggest départements. By rate per 1 000
 * dwellings the leaders are Guyane 9.80, **Cher 9.28**, Ain 8.67 and Isère
 * 8.36, and the Nord drops from 2nd to 17th. Both are true; only the second is
 * about the place, and the Cher is the whole argument in one département.
 *
 * ── Why the quantile cut is taken on faits per MILLION ─────────────────────
 * `countBins` from `franceDepartements.js` is the shared quantile cutter and it
 * ROUNDS its thresholds to integers, because it was written for counts. Fed a
 * per-1 000 rate it does not merely lose precision, it fabricates boundaries.
 * Measured on the same 2025 cambriolages over the 96 metropolitan polygons,
 * the five real quantiles are 3.6409, 4.7695, 5.4907, 5.9262 and 6.5690;
 * `countBins` returns **[4, 5, 6, 7, 8]** — the third rounds onto the second
 * and the tie-breaker then invents 6, 7 and 8, moving the top boundary from
 * 6.57 to 8.00. On `Homicides` it is total: the 93 real quantiles run 0.0071
 * to 0.0178 and it returns **[0, 1, 2, 3, 4]**, which puts every département
 * in band 0. So the cut is taken on the rate × 1 000 — faits per MILLION, an
 * integer with room in it — and the thresholds are divided back for display.
 * Reusing the shared cutter with a unit change beats forking it, and the unit
 * change is a real one: a rate this layer draws is often a handful of facts
 * per million people.
 *
 * ── What the 96 polygons cannot hold ───────────────────────────────────────
 * They are METROPOLITAN. The five overseas départements the SSMSI publishes —
 * Guadeloupe, Martinique, Guyane, La Réunion, Mayotte — have no geometry in
 * the bundle and are returned as `offshore` with their values intact, so the
 * card can say that the choropleth is 96 of the register's 101 départements
 * rather than letting a reader believe France is what is coloured. They are
 * not snapped: the nearest metropolitan outline to Cayenne is 7 000 km away.
 * Saint-Pierre-et-Miquelon (975), Saint-Barthélemy (977) and Saint-Martin
 * (978) are absent from the register itself — measured, all three — so they
 * are neither drawn nor counted, and the card says 101, not 105.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

import {
  countBin,
  countBins,
  locateDepartement,
  nearestDepartementWithin,
  DEFAULT_COAST_SNAP_KM,
} from './franceDepartements.js';
import {
  CELL_PUBLISHED,
  CELL_SUPPRESSED,
  CELL_ZERO,
  DELINQUANCE_SOURCE,
  indicatorForSlug,
} from './delinquanceFeed.js';

/** Number of quantile bands on the ramp. Six, as every other French layer. */
export const DELINQUANCE_DEPARTEMENT_BINS = 6;

/**
 * Multiplier applied before the quantile cut — see the module header.
 * A `taux_pour_mille` × 1 000 is faits per million, which is an integer.
 */
export const DELINQUANCE_RATE_SCALE = 1000;

/** Coastal snap tolerance for the camera lookup, km. The shared 2 km. */
export const DELINQUANCE_COAST_SNAP_KM = DEFAULT_COAST_SNAP_KM;

/**
 * Cut a list of published rates into quantile thresholds.
 *
 * Returns `binCount - 1` ascending upper bounds IN RATE UNITS (per 1 000),
 * derived on the scaled integers so the shared cutter behaves. Zero rates are
 * excluded by `countBins` itself, which is exactly right here: a département
 * measured at zero is drawn as the `zero` state, not as the bottom of a scale.
 *
 * @param {Array<number>} rates Published `taux_pour_mille` values.
 * @param {number} [binCount]
 * @returns {Array<number>}
 */
export function delinquanceRateBins(rates, binCount = DELINQUANCE_DEPARTEMENT_BINS) {
  const scaled = (Array.isArray(rates) ? rates : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => value * DELINQUANCE_RATE_SCALE);
  return countBins(scaled, binCount).map((value) => value / DELINQUANCE_RATE_SCALE);
}

/**
 * Bin index for one rate against thresholds from {@link delinquanceRateBins}.
 * @param {number} rate
 * @param {Array<number>} thresholds
 * @returns {number} 0-based band, or -1 for a rate of zero or absent.
 */
export function delinquanceRateBin(rate, thresholds) {
  const scaled = Number(rate) * DELINQUANCE_RATE_SCALE;
  const bounds = (Array.isArray(thresholds) ? thresholds : [])
    .map((value) => Number(value) * DELINQUANCE_RATE_SCALE);
  return countBin(scaled, bounds);
}

/**
 * Resolve a coordinate to a département code — point-in-polygon, then the
 * shared 2 km coastal snap for a camera resting just off the coast.
 *
 * This is the one genuinely geometric question the layer asks, and it is why
 * `franceDepartements.js` is imported rather than a code prefix being parsed
 * out of something. A camera over Bastia has to answer `2B`, and it can only
 * do that by being inside the polygon.
 *
 * @param {{list:Array<object>}} index From `buildDepartementIndex`.
 * @param {number} lat
 * @param {number} lon
 * @param {number} [snapKm]
 * @returns {?string}
 */
export function locateDelinquanceDepartement(index, lat, lon, snapKm = DELINQUANCE_COAST_SNAP_KM) {
  const direct = locateDepartement(index, lat, lon);
  if (direct) return direct;
  return nearestDepartementWithin(index, lat, lon, snapKm)?.code || null;
}

/**
 * Every département whose outline intersects a view box.
 *
 * Generic over the bundled outlines, so it lives in `franceDepartements.js`
 * alongside the index it reads — the childcare layer fetches per-département
 * packs on exactly the same rule. Re-exported here under the name this
 * layer's callers and tests already use.
 */
export { departementsInBox } from './franceDepartements.js';

/**
 * Fold one indicator-year of the département base onto the bundled polygons.
 *
 * @param {object} input
 * @param {Array<object>} input.departements Rows from `projectDelinquanceDepartements`.
 * @param {Array<string>} input.years The payload's year order.
 * @param {{list:Array<object>, byCode:Map}} input.index From `buildDepartementIndex`.
 * @param {string} input.indicator Slug.
 * @param {string} input.year
 * @param {number} [input.binCount]
 * @param {Record<string, Array<number>>} [input.communeCensus] Per-département
 *   `[published, zero, suppressed]` for this indicator, from the commune fold.
 * @returns {object} National rollup.
 */
export function projectDelinquanceNational({
  departements,
  years,
  index,
  indicator,
  year,
  binCount = DELINQUANCE_DEPARTEMENT_BINS,
  communeCensus = null,
} = {}) {
  const meta = indicatorForSlug(indicator);
  const order = Array.isArray(years) ? years : [];
  const slot = order.indexOf(String(year));
  const byCode = new Map(
    (Array.isArray(departements) ? departements : []).map((row) => [row.code, row]),
  );
  const polygons = index?.list || [];

  /** Read one département's cell for the selected indicator-year. */
  const cellOf = (row) => {
    if (!row || slot < 0) return null;
    const series = row.cells?.[indicator];
    return Array.isArray(series) ? series[slot] || null : null;
  };

  const rates = [];
  for (const entry of polygons) {
    const cell = cellOf(byCode.get(entry.code));
    if (cell && cell[0] === CELL_PUBLISHED && Number.isFinite(cell[2]) && cell[2] > 0) {
      rates.push(cell[2]);
    }
  }
  const thresholds = delinquanceRateBins(rates, binCount);

  const rows = [];
  const unmatched = [];
  let painted = 0;
  let zeroed = 0;
  let missing = 0;
  let facts = 0;

  for (const entry of polygons) {
    const source = byCode.get(entry.code);
    const cell = cellOf(source);
    const state = cell ? cell[0] : null;
    const count = cell ? cell[1] : null;
    const rate = cell ? cell[2] : null;
    if (!cell) {
      // A polygon with no row is drawn as ABSENCE, never as the bottom of the
      // scale — the same rule `supDepartements.js` applies to a département
      // with no campus, and the reason `bin` is -1 rather than 0.
      missing += 1;
    } else if (state === CELL_PUBLISHED) {
      painted += 1;
      facts += Number(count) || 0;
    } else if (state === CELL_ZERO) {
      zeroed += 1;
    }
    const census = communeCensus?.[entry.code] || null;
    rows.push({
      code: entry.code,
      name: entry.name,
      areaKm2: entry.areaKm2 || 0,
      state,
      count,
      rate,
      pop: source?.pop ?? null,
      log: source?.log ?? null,
      bin: state === CELL_PUBLISHED ? delinquanceRateBin(rate, thresholds) : -1,
      // The commune-grain census travels WITH the département it is about, so
      // the national card can say how much of this département's map is blank
      // without a second request.
      communes: census
        ? {
          published: census[CELL_PUBLISHED] || 0,
          zero: census[CELL_ZERO] || 0,
          suppressed: census[CELL_SUPPRESSED] || 0,
        }
        : null,
    });
  }

  const offshore = [];
  for (const [code, row] of byCode) {
    if (index?.byCode?.has(code)) continue;
    const cell = cellOf(row);
    unmatched.push(code);
    offshore.push({
      code,
      state: cell ? cell[0] : null,
      count: cell ? cell[1] : null,
      rate: cell ? cell[2] : null,
      pop: row.pop ?? null,
    });
  }
  offshore.sort((a, b) => a.code.localeCompare(b.code));

  return {
    indicator,
    indicatorLabel: meta?.label || indicator,
    unite: meta?.unite || null,
    per: meta?.per || 'habitants',
    year: String(year),
    departements: rows,
    thresholds,
    binCount,
    painted,
    zeroed,
    missing,
    facts,
    // 5 on this edition: 971, 972, 973, 974, 976. A different number here is
    // the code join drifting, and the card is where that shows up.
    offshore,
    unmatched: unmatched.sort(),
    polygons: polygons.length,
    source: DELINQUANCE_SOURCE,
  };
}
