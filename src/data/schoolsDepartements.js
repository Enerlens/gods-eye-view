/**
 * @module schoolsDepartements
 *
 * The national regime: 68 158 open, geolocated establishments folded onto the
 * 96 bundled département polygons, so the layer says something true at
 * national altitude instead of drawing a smear.
 *
 * ── Why this sweep is one call, where the charge-point one is a recursion ───
 * `irveDepartements.js` has to sweep ODRÉ in latitude stripes and split any
 * stripe that comes back at the aggregation limit, because it needs a GROUPED
 * query and Opendatasoft caps those silently. This register does not: its
 * `/exports/` endpoint streams every matching row with no aggregation and no
 * cap, and the whole national set — filtered to open and geolocated, a
 * handful of columns wide — is **8.5 MB, 2.4 MB gzipped, in one request**
 * (measured). So
 * the sweep here is a single GET, the truncation recursion does not exist, and
 * the completeness proof is a straight comparison against the portal's own
 * `total_count` for the same `where`.
 *
 * ── The coordinate is the join, never the code ─────────────────────────────
 * The register publishes `code_departement` and it CANNOT be joined to the
 * bundled polygons: the register zero-pads to three characters (`028`, `045`)
 * and spells Corsica `02A` / `02B`, where the IGN outlines use `28`, `45`,
 * `2A`, `2B`. Every row would miss. Assignment is therefore point-in-polygon,
 * exactly as the charge-point rollup does it, which is also what makes the
 * result independent of a code convention either side might change.
 *
 * ── What the 96 polygons cannot hold ────────────────────────────────────────
 * They are METROPOLITAN. The bundled file has 96 features and no overseas
 * geometry at all, so **2 762 of 68 158 open, geolocated establishments fall
 * outside every polygon** — measured by running this projection over the real
 * national export. 2 753 of them are the overseas collectivités: La Réunion
 * 855, Guadeloupe 448, Martinique 403, Nouvelle-Calédonie 334, Mayotte 333,
 * Guyane 319, Saint-Martin 38, Saint-Pierre-et-Miquelon 14, Saint-Barthélemy 9.
 *
 * The other 9 are metropolitan and are a different fact: schools on Belle-Île,
 * Ouessant, Sein and Bréhat, islands the simplified outlines drop entirely, so
 * they sit further from the drawn coast than the 2 km snap reaches. Both kinds
 * are reported the same way rather than being averaged into one number.
 *
 * They are not silently dropped and they are not snapped — the nearest French
 * polygon to a school in Cayenne is 7 000 km away. They are counted, named by
 * their published `code_departement`, and returned as `offshore` so the layer
 * can state the shortfall on the national card. A choropleth that quietly
 * omits them is a choropleth claiming France has 65 396 schools.
 *
 * ── What the 2 km coastal snap is for, and what it is not ──────────────────
 * A handful of genuinely metropolitan schools land just outside the simplified
 * outlines — the IGN shapes bundled here are ~14 000 vertices for all of
 * France, so a seafront lycée in Antibes can sit in the drawn sea. Those snap
 * to the nearest polygon within 2 km and are counted in `snapped`, because
 * moving a point is a thing the map did rather than a thing the file said. The
 * measurement behind the 2 km is in `irveDepartements.js`, where it was made.
 * It cannot reach the overseas collectivities, which is the point.
 *
 * ── What this rollup is read as, and what changed ───────────────────────────
 * This header used to argue which single variable the national FILL was binned
 * on, and answered "the number of ESTABLISHMENTS, not pupils, because the
 * layer draws establishments". The premise was the defect: painting a raw
 * count as a colour fill is the fault CARTOGRAPHIE B1 names in capitals, and
 * the question "count or density?" only exists while there is one channel to
 * put them on. `schoolsFrance.js` now draws a PRISM, so both travel:
 *
 *   `schools`      the absolute count → the prism's HEIGHT.
 *   `per1000Km2`   the count per 1 000 km² of the polygon actually drawn → the
 *                  prism's COLOUR. It was already computed here and, until the
 *                  prism, was only ever printed on a card.
 *
 * Measured on the 2026-09-03 export (68 158 rows) through this very function:
 * counts run 150 (Lozère) → 2 504 (Nord), median 577, range 1 : 16.7; density
 * runs 29.0 → 14 303 per 1 000 km², median 92.4, range 1 : 493. The two ranges
 * differ by a factor of thirty, which is the arithmetic reason one channel
 * could never carry both.
 *
 * `bin` and `thresholds` — the six-quantile ladder of the old fill — are still
 * computed and still returned, and NOTHING PAINTS THEM any more. They stay
 * because the payload shape is shared with the day-long disk cache and pinned
 * by `schoolsDepartements.test.mjs`, and because they remain the cheapest read
 * of the count distribution in a served document; removing them is a follow-up
 * that has to land with that test file. Treat them as a diagnostic, never as a
 * rendering instruction: a quantile ladder recomputed from the rows in hand is
 * exactly the C1 violation the prism's frozen domain exists to remove.
 *
 * `per1000Km2` is `null`, never 0, when the drawn polygon has no area: a
 * density that could not be computed is not a density of zero (A1). A
 * département with no establishments in it keeps a real 0 — that is a
 * measurement, and the prism draws it as one.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

import {
  DEFAULT_COAST_SNAP_KM,
  countBin,
  countBins,
  locateDepartement,
  nearestDepartementWithin,
} from './franceDepartements.js';
import {
  SCHOOLS_DATASET,
  SCHOOLS_SOURCE,
  SCHOOL_LEVELS,
  SCHOOL_LEVEL_INDEX,
  schoolLevel,
} from './schoolsFeed.js';

/** Number of quantile bins on the choropleth ramp. Six, as the IRVE ramp. */
export const SCHOOLS_DEPARTEMENT_BINS = 6;

/**
 * How far outside every polygon a school may sit and still be counted in the
 * nearest département, in km. See the header, and `IRVE_COAST_SNAP_KM` for the
 * distribution the number came from.
 */
export const SCHOOLS_COAST_SNAP_KM = DEFAULT_COAST_SNAP_KM;

/**
 * Columns the national sweep pulls.
 *
 * Seven, and every one of them is read: two for the position, one for the
 * identity that carries the roll join, one for the colour ladder, and three
 * for the per-département breakdowns the card prints. The register has 71
 * columns; a full-width export is 40.7 MB against 8.5 MB for a narrow one.
 */
export const SCHOOLS_SWEEP_FIELDS = Object.freeze([
  'identifiant_de_l_etablissement',
  'type_etablissement',
  'statut_public_prive',
  'code_departement',
  'appartenance_education_prioritaire',
  'latitude',
  'longitude',
]);

/** Finite number, or null. */
function num(value) {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

/** An empty per-level tally, in ladder order. */
function emptyLevels() {
  return Object.fromEntries(SCHOOL_LEVELS.map((level) => [level, 0]));
}

/**
 * Fold the national sweep onto the départements, and build the mesh in the
 * same pass.
 *
 * One pass and not two, because the pass is a point-in-polygon test over
 * 68 158 rows against 96 multi-part polygons — the expensive part of the whole
 * rebuild — and the mesh needs exactly the rows that survive it.
 *
 * @param {object} input
 * @param {Array<object>} input.records Rows from the national export.
 * @param {{list:Array<object>, byCode:Map}} input.index From `buildDepartementIndex`.
 * @param {Map<string, number>|object} [input.rolls] UAI → pupils.
 * @param {?number} [input.totalCount] The portal's own count for the same
 *   `where`, used only to prove the sweep was complete.
 * @param {number} [input.binCount]
 * @param {number} [input.snapKm]
 * @returns {object} National rollup, with `mesh` attached.
 */
export function projectSchoolsDepartements({
  records,
  index,
  rolls = null,
  totalCount = null,
  binCount = SCHOOLS_DEPARTEMENT_BINS,
  snapKm = SCHOOLS_COAST_SNAP_KM,
} = {}) {
  const rows = Array.isArray(records) ? records : [];
  const roll = rolls instanceof Map ? rolls : new Map(Object.entries(rolls || {}));

  /** @type {Map<string, {schools:number, pupils:number, levels:object, public:number, prive:number, ep:number}>} */
  const tally = new Map();
  /** @type {Map<string, {schools:number, pupils:number}>} Outside all polygons. */
  const offshore = new Map();
  const mesh = [];

  let swept = 0;
  let assigned = 0;
  let snapped = 0;
  let unassigned = 0;
  let pupilsTotal = 0;
  let withRoll = 0;

  for (const row of rows) {
    const lat = num(row?.latitude);
    const lon = num(row?.longitude);
    if (lat === null || lon === null || (lat === 0 && lon === 0)) continue;
    swept += 1;

    const uai = String(row?.identifiant_de_l_etablissement || '').trim();
    const level = schoolLevel(row);
    const enrolled = uai && roll.has(uai) ? num(roll.get(uai)) : null;
    if (enrolled !== null) {
      withRoll += 1;
      pupilsTotal += enrolled;
    }

    // The mesh carries every swept row, assigned or not: the maillage regime
    // is a map of where schools ARE, and La Réunion's 855 are as real as the
    // Rhône's. Only the CHOROPLETH is limited by which polygons are bundled.
    mesh.push([
      Number(lat.toFixed(5)),
      Number(lon.toFixed(5)),
      enrolled === null ? 0 : enrolled,
      SCHOOL_LEVEL_INDEX[level] ?? SCHOOL_LEVELS.length - 1,
    ]);

    let code = locateDepartement(index, lat, lon);
    if (!code) {
      const near = nearestDepartementWithin(index, lat, lon, snapKm);
      if (near) {
        code = near.code;
        snapped += 1;
      }
    }
    if (!code) {
      unassigned += 1;
      const published = String(row?.code_departement || '').trim() || '—';
      const bucket = offshore.get(published) || { schools: 0, pupils: 0 };
      bucket.schools += 1;
      bucket.pupils += enrolled || 0;
      offshore.set(published, bucket);
      continue;
    }

    assigned += 1;
    const bucket = tally.get(code) || {
      schools: 0, pupils: 0, levels: emptyLevels(), public: 0, prive: 0, ep: 0,
    };
    bucket.schools += 1;
    bucket.pupils += enrolled || 0;
    bucket.levels[level] += 1;
    const sector = String(row?.statut_public_prive || '').trim();
    if (sector === 'Public') bucket.public += 1;
    else if (sector === 'Privé' || sector === 'Prive') bucket.prive += 1;
    const ep = String(row?.appartenance_education_prioritaire || '').trim();
    if (ep === 'REP' || ep === 'REP+') bucket.ep += 1;
    tally.set(code, bucket);
  }

  const thresholds = countBins([...tally.values()].map((entry) => entry.schools), binCount);

  const departements = [];
  for (const entry of index?.list || []) {
    const bucket = tally.get(entry.code);
    const schools = bucket?.schools || 0;
    const areaKm2 = entry.areaKm2 || 0;
    departements.push({
      code: entry.code,
      name: entry.name,
      schools,
      pupils: bucket?.pupils || 0,
      public: bucket?.public || 0,
      prive: bucket?.prive || 0,
      ep: bucket?.ep || 0,
      levels: bucket?.levels || emptyLevels(),
      areaKm2,
      // Per 1 000 km² of the polygon that is actually DRAWN, not of the
      // département's official area — that is the surface the reader is
      // looking at, the one the dot density has to be read against, and now
      // the one the prism's colour is. `null` and not 0 when there is no area
      // to divide by: a rate that could not be computed is not a rate of zero,
      // and the prism has two different marks for those two facts (A1).
      per1000Km2: areaKm2 > 0 ? (schools / areaKm2) * 1000 : null,
      bin: countBin(schools, thresholds),
    });
  }

  const offshoreRows = [...offshore.entries()]
    .map(([code, entry]) => ({ code, ...entry }))
    .sort((a, b) => b.schools - a.schools || a.code.localeCompare(b.code));

  return {
    departements,
    thresholds,
    binCount,
    painted: departements.filter((entry) => entry.schools > 0).length,
    schoolsSwept: swept,
    schoolsTotal: Number.isFinite(totalCount) ? totalCount : null,
    // Reaching fewer rows than the portal counted for the same `where` is the
    // one failure an export streams as HTTP 200: a short read looks exactly
    // like a smaller country.
    truncated: Number.isFinite(totalCount) ? swept < totalCount : false,
    assigned,
    snapped,
    unassigned,
    offshore: offshoreRows,
    pupils: pupilsTotal,
    withRoll,
    mesh,
    dataset: SCHOOLS_DATASET,
    source: SCHOOLS_SOURCE,
  };
}
