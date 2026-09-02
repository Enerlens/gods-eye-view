/**
 * @module idfmFrequencyDepartements
 *
 * The wide regime of `idfm-frequency`: a whole région folded onto eight
 * polygons, so the question the layer exists to ask — *how often does anything
 * stop here at this hour* — still has an answer above the rooftops.
 *
 * `idfmFrequencyFeed.js` measured why there is no national pack: one viewport's
 * worth of full profiles is 744 B a stop, and the whole région would be 26.7 MB
 * raw / ~4.3 MB gzipped. But the SUMS are tiny. Measured 2026-09-02 through
 * `buildRegionBandsUrl` — `group_by=code_departement,tranche_horaire` over all
 * 1 311 578 rows — the entire région comes back as **356 rows, 73 723 bytes,
 * 0.62 s**. That is the whole wide regime for the price of one request, and it
 * is the reason this file exists rather than a `geoMeshThinning` maillage: the
 * publisher will aggregate for free, so nothing has to be thinned.
 *
 * ── The divisor is ENUMERATED, never counted ────────────────────────────────
 * A département's courses per hour mean nothing until they are divided by the
 * number of stops they are spread over, and Opendatasoft's own
 * `count(distinct id_arret)` is an ESTIMATOR: it answers **3 452** for
 * département 75 where enumerating `group_by=id_arret` returns **3 506**, and
 * **37 078** region-wide against **36 502** enumerated. A 1.5 % error in the
 * divisor is a 1.5 % error in every colour on the map, for free, so this module
 * takes the enumerated lists. Measured 2026-09-02, all 17 buckets: **36 502
 * stops in 3 582 652 bytes over 3.67 s**, which is a build-time cost behind a
 * disk cache and never a browser one.
 *
 * ── Trap: the bucket that answers to no code ────────────────────────────────
 * `code_departement` has a NULL bucket and `where=code_departement="None"`
 * returns HTTP 200 with zero rows — silently losing it. `where=code_departement
 * is null` returns **549 stops, every one of them with a null
 * `latitude_arret`** (549 of 549, measured). They carry **84 768 of the
 * 3 071 759 average-Tuesday courses, 2.76 %**, against 1.50 % of the stops,
 * because 473 of them are Train. They are counted, named as a number on the
 * card, and never placed — see {@link foldFrequencyRegion}'s `unplaced`.
 *
 * ── Trap: eight of the sixteen départements are not a région ─────────────────
 * The offer dataset reaches beyond Île-de-France. Enumerated 2026-09-02:
 *
 *   75 3 506 · 77 7 126 · 78 6 269 · 91 5 150 · 92 3 419 · 93 3 489 ·
 *   94 2 971 · 95 3 788   → 35 718 stops, 99.35 % of everything placed
 *   60 87 · 28 82 · 27 36 · 89 11 · 02 9 · 45 7 · 10 2 · 51 1
 *                          → 235 stops, 0.65 %
 *
 * Painting the Aube for its **2** stops, or the Marne for its **1**, would
 * colour 6 000 km² on the strength of one bus pole. The gap between the two
 * groups is a factor of **34** (87 → 2 971), so the cut is not a tuned
 * threshold: {@link IDFM_FREQ_REGION_MIN_STOPS} sits at 1 000, anywhere in a
 * 2 884-stop-wide gap. The eight fringe buckets are kept in the payload,
 * counted on the card, and not painted.
 *
 * ── Trap: the published code and the map disagree on 542 stops ──────────────
 * Every stop was tested against the bundled IGN outlines with
 * `locateDepartement` — 96 polygons, 62 ms for all 35 953 placed stops:
 * **35 411 agree (98.49 %), 542 disagree (1.51 %), 0 fall outside all 96, and
 * 0 need a coast snap.** Every disagreement is a boundary stop — the largest
 * single flow is 49 stops published as 75 that sit inside 92 — because the
 * published code is the operator's administrative attribution and the polygon
 * is geography.
 *
 * The map is NOT repartitioned on that. The numerator (courses per band) is
 * only published per code, so re-assigning the divisor by polygon while the
 * numerator stayed on the code would divide one partition by another and
 * silently move the colour of both. The published code partitions both halves,
 * and the disagreement is reported as a number instead of being hidden by a
 * correction nobody can see.
 *
 * No Cesium and no DOM: this runs in the browser, in the Vite proxy, and under
 * `node --test`.
 */

import { buildDepartementIndex, locateDepartement } from './franceDepartements.js';
import {
  IDFM_FREQ_BAND_COUNT,
  IDFM_FREQ_BAND_MIN,
  IDFM_FREQ_DATASET,
  IDFM_FREQ_DAY_ALIASES,
  IDFM_FREQ_DAYS,
  IDFM_FREQ_EDITION_FLOOR,
  IDFM_FREQ_LICENCE,
  IDFM_FREQ_REFERENCE_YEAR,
  IDFM_FREQ_SOURCE,
  isFrequencyBand,
  roundRate,
} from './idfmFrequencyFeed.js';

/**
 * The `code_departement` buckets the dataset publishes, in the order the
 * regional query returns them, with the NULL bucket written as `null`.
 *
 * Measured 2026-09-02: exactly 17 buckets, 356 (bucket, band) rows. The fringe
 * buckets do not carry 24 bands each — département 10 publishes 3 and 51
 * publishes 3 — which is itself the signal that they are one line clipping a
 * corner rather than a served territory.
 */
export const IDFM_FREQ_BUCKETS = Object.freeze([
  null, '02', '10', '27', '28', '45', '51', '60',
  '75', '77', '78', '89', '91', '92', '93', '94', '95',
]);

/** The eight départements of Île-de-France, the only ones this layer paints. */
export const IDFM_FREQ_CORE_DEPARTEMENTS = Object.freeze([
  '75', '77', '78', '91', '92', '93', '94', '95',
]);

/**
 * Stops a bucket needs before its polygon is filled.
 *
 * 1 000, and the number is not tuned: the smallest painted bucket has 2 971
 * stops and the largest unpainted one has 87. See the module header.
 */
export const IDFM_FREQ_REGION_MIN_STOPS = 1_000;

/** Trimmed string, or null. */
function str(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

/** Finite number, or null. A non-number is never coerced. */
function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An empty 7 × 24 profile. */
function emptyProfile() {
  return IDFM_FREQ_DAYS.map(() => new Array(IDFM_FREQ_BAND_COUNT).fill(0));
}

/**
 * The bucket key one regional row belongs to.
 *
 * `null` and the string `"None"` are the SAME bucket: the portal answers the
 * `is null` predicate with a JSON null, and `"None"` is the value a reader sees
 * in the portal's own facet UI. Treating them as two buckets would split 549
 * stops in half.
 *
 * @param {object} row One `buildRegionBandsUrl` result row.
 * @returns {?string} INSEE code, or null for the no-département bucket.
 */
export function regionBucketKey(row) {
  const code = str(row?.code_departement);
  return code && code !== 'None' ? code : null;
}

/**
 * Fold the regional band rows and the enumerated stop lists into one payload.
 *
 * @param {object} input
 * @param {object} input.bands Raw `{total_count, results}` of {@link buildRegionBandsUrl}.
 * @param {Array<{code:?string, envelope:object}>} [input.stops] One enumerated
 *   stop list per bucket, from `buildRegionStopsUrl`.
 * @param {object} [input.index] A `buildDepartementIndex` result — what the
 *   dev-server proxy already holds through `loadSchoolsDepartementIndex()`,
 *   which is memoized process-wide. Preferred over `geojson`: re-reading and
 *   re-indexing the 254 KB bundle per build would be the same 96 polygons a
 *   second time.
 * @param {object} [input.geojson] The bundled `departements.geojson`, indexed
 *   here, for a caller that holds the file rather than the index. With NEITHER,
 *   the cross-check reports `null` rather than a zero that would read as
 *   "nothing disagrees".
 * @param {string} [input.edition]
 * @param {string} [input.licence]
 * @param {string} [input.source]
 * @returns {object}
 */
export function foldFrequencyRegion({
  bands,
  stops = [],
  index: providedIndex = null,
  geojson = null,
  edition = IDFM_FREQ_EDITION_FLOOR,
  licence = IDFM_FREQ_LICENCE,
  source = IDFM_FREQ_SOURCE,
} = {}) {
  /** @type {Map<?string, {profile:Array<Array<number>>, bands:Set<number>}>} */
  const draft = new Map();
  let bandRows = 0;
  let outOfRangeRows = 0;

  for (const row of Array.isArray(bands?.results) ? bands.results : []) {
    bandRows += 1;
    const band = num(row?.tranche_horaire);
    if (band === null || !isFrequencyBand(band)) {
      outOfRangeRows += 1;
      continue;
    }
    const key = regionBucketKey(row);
    let entry = draft.get(key);
    if (!entry) {
      entry = { profile: emptyProfile(), bands: new Set() };
      draft.set(key, entry);
    }
    entry.bands.add(band);
    const slot = band - IDFM_FREQ_BAND_MIN;
    for (let d = 0; d < IDFM_FREQ_DAYS.length; d += 1) {
      entry.profile[d][slot] += num(row?.[IDFM_FREQ_DAY_ALIASES[d]]) || 0;
    }
  }

  // The divisor, and the geometry cross-check, in one pass over the enumerated
  // stop lists. A bucket with no list gets `stops: null` — NOT zero, which
  // would make its rate infinite and paint it as the busiest place in France.
  const index = (Array.isArray(providedIndex?.list) ? providedIndex : null)
    || (geojson ? buildDepartementIndex(geojson) : null);
  /** @type {Map<?string, {stops:number, placed:number, inside:number, agree:number}>} */
  const census = new Map();
  let checked = 0;
  let agree = 0;
  let disagree = 0;
  let outsideAll = 0;
  const insideByPolygon = new Map();

  for (const bucket of Array.isArray(stops) ? stops : []) {
    const key = str(bucket?.code) || null;
    const rows = Array.isArray(bucket?.envelope?.results) ? bucket.envelope.results : [];
    const seen = new Set();
    let placed = 0;
    let inside = 0;
    let bucketAgree = 0;
    for (const row of rows) {
      const id = str(row?.id_arret) ?? (typeof row?.id_arret === 'number' ? String(row.id_arret) : null);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const lat = num(row?.latitude_arret);
      const lon = num(row?.longitude_arret);
      if (lat === null || lon === null) continue;
      placed += 1;
      if (!index) continue;
      checked += 1;
      const hit = locateDepartement(index, lat, lon);
      if (!hit) {
        outsideAll += 1;
        continue;
      }
      insideByPolygon.set(hit, (insideByPolygon.get(hit) || 0) + 1);
      if (key && hit === key) {
        bucketAgree += 1;
        agree += 1;
        inside += 1;
      } else {
        disagree += 1;
      }
    }
    census.set(key, { stops: seen.size, placed, inside, agree: bucketAgree });
  }

  const departements = [];
  let unplaced = null;
  let regionWeek = 0;
  let stopsTotal = 0;
  let placedTotal = 0;

  for (const [key, entry] of draft) {
    let week = 0;
    for (const row of entry.profile) for (const value of row) week += value;
    regionWeek += week;
    const counts = census.get(key) || null;
    const profile = entry.profile.map((row) => row.map(roundRate));
    const record = {
      code: key,
      stops: counts ? counts.stops : null,
      placed: counts ? counts.placed : null,
      // Stops whose coordinate falls inside the SAME département's IGN outline.
      inside: counts && index ? counts.inside : null,
      profile,
      bands: entry.bands.size,
      week: Math.round(week),
      // `paint` is decided here and not in the renderer, so the map, the legend
      // and the card can never disagree about which polygons carry a colour.
      paint: Boolean(key)
        && IDFM_FREQ_CORE_DEPARTEMENTS.includes(key)
        && Boolean(counts)
        && counts.stops >= IDFM_FREQ_REGION_MIN_STOPS,
    };
    if (key === null) {
      unplaced = record;
      continue;
    }
    // Counted here and NOT for the null bucket, so `totals.stops` adds the two
    // groups once each: 35 953 placed + 549 unplaced = the 36 502 the portal
    // enumerates. Adding the null bucket in both places was a real off-by-549.
    if (counts) {
      stopsTotal += counts.stops;
      placedTotal += counts.placed;
    }
    departements.push(record);
  }

  departements.sort((a, b) => a.code.localeCompare(b.code));
  const painted = departements.filter((row) => row.paint);
  const fringe = departements.filter((row) => !row.paint);

  return {
    departements,
    // The no-département bucket travels as its own field rather than as a row
    // with a null code, because everything downstream iterates `departements`
    // to paint and this one must never be reachable from that loop.
    unplaced,
    paintedCodes: painted.map((row) => row.code),
    fringeCodes: fringe.map((row) => row.code),
    totals: {
      buckets: draft.size,
      stops: stopsTotal + (unplaced?.stops || 0),
      placed: placedTotal,
      unplaced: unplaced?.stops || 0,
      week: Math.round(regionWeek),
      bandRows,
      outOfRangeRows,
    },
    // A cross-check that did not run reports nulls. Zeroes here would read as
    // "checked, and nothing disagreed", which is the opposite of the truth.
    crosscheck: index
      ? { checked, agree, disagree, outsideAll, polygons: index.list.length }
      : { checked: null, agree: null, disagree: null, outsideAll: null, polygons: null },
    insideByPolygon: index
      ? Object.fromEntries([...insideByPolygon].sort((a, b) => a[0].localeCompare(b[0])))
      : null,
    dataset: IDFM_FREQ_DATASET,
    edition,
    year: IDFM_FREQ_REFERENCE_YEAR,
    licence,
    source,
  };
}

/**
 * Mean departures per hour at ONE stop of a département, in one (day, band).
 *
 * The per-stop mean and not the total, because the total is a fact about the
 * département's size: Seine-et-Marne runs 21 366 courses in the 08:00 band
 * against Paris's 46 353, which sounds like half the service and is actually
 * **3.00 per stop against 13.22** — a factor of 4.4, not 2.2. Dividing is what
 * makes the choropleth answer the same question as the dots it zooms into, on
 * the same ladder, in the same unit.
 *
 * @param {object} row One `departements` record from {@link foldFrequencyRegion}.
 * @param {string} day One of `IDFM_FREQ_DAYS`.
 * @param {number} band 4..27.
 * @returns {?number} Courses per hour per stop, or null when there is no divisor.
 */
export function regionRatePerStop(row, day, band) {
  const stops = typeof row?.stops === 'number' && Number.isFinite(row.stops) ? row.stops : 0;
  if (stops <= 0) return null;
  const dayIndex = IDFM_FREQ_DAYS.indexOf(day);
  if (dayIndex < 0) return null;
  const slot = num(band);
  if (slot === null || !isFrequencyBand(slot)) return null;
  const total = Number(row?.profile?.[dayIndex]?.[slot - IDFM_FREQ_BAND_MIN]) || 0;
  return total / stops;
}

/**
 * Total courses a département runs on one day, across all 24 bands.
 * @param {object} row
 * @param {string} day
 * @returns {number}
 */
export function regionDayTotal(row, day) {
  const dayIndex = IDFM_FREQ_DAYS.indexOf(day);
  if (dayIndex < 0) return 0;
  const values = row?.profile?.[dayIndex];
  if (!Array.isArray(values)) return 0;
  let total = 0;
  for (const value of values) total += Number(value) || 0;
  return total;
}

/**
 * The painted rows, keyed by code, ready for a polygon repaint.
 * @param {object} region Payload from {@link foldFrequencyRegion}.
 * @returns {Map<string, object>}
 */
export function paintedDepartements(region) {
  const out = new Map();
  for (const row of region?.departements || []) {
    if (row?.paint && row.code) out.set(row.code, row);
  }
  return out;
}
