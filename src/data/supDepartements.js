/**
 * @module supDepartements
 *
 * The national regime of the higher-education layer: 6 914 sites folded onto
 * the 96 bundled département polygons.
 *
 * ── Why this one folds SITES and the schools one folds ROWS ─────────────────
 * `schoolsDepartements.js` runs its point-in-polygon over the raw register,
 * because there its raw register IS one row per drawn dot. Here it is not: the
 * Atlas publishes one row per (établissement × composante × degré d'études),
 * seven of which can describe one campus. So the projection in `supFeed.js`
 * resolves the sites first and this file folds THOSE — the same objects the
 * map draws, which is what makes the choropleth's total and the dot count
 * agree by construction rather than by coincidence.
 *
 * ── What the choropleth is binned on, and why it is not the dot count ───────
 * **Students.** This is a deliberate departure from `schoolsDepartements.js`,
 * which bins on establishments and argues, correctly for it, that a national
 * regime shading by anything other than the drawn unit is "a different map
 * wearing the same legend". Higher education is the case where that rule
 * gives the wrong map, and it is worth stating why rather than quietly
 * flipping it.
 *
 * Measured on the real rollup. Counting SITES, Paris (484) leads the Nord
 * (292) by 1.66× and the ten leading départements hold **35%** of them.
 * Counting STUDENTS, Paris (394 788) leads the Rhône (192 964) by 2.05× and
 * the top ten hold **49.8%** — half of French higher education in ten
 * départements. The site count is flatter because 2 800 of the 6 914 sites are
 * lycées running a BTS, and those follow the secondary-school network, which
 * is spread by population across the whole country. Both numbers are true;
 * only the second is about higher education. A map of where BTS sections are
 * is a map of where lycées are, and `schools-fr` already draws that.
 *
 * So the fill is students, the dot count travels on every département's card
 * next to it, and the legend row says `étudiants` out loud so the two are
 * never read as each other.
 *
 * ── What the 96 polygons cannot hold ────────────────────────────────────────
 * They are METROPOLITAN — 96 features, no overseas geometry — so **214 of the
 * 6 914 sites, holding 57 301 students, fall outside every one of them**:
 * La Réunion 79, Guadeloupe 41, Martinique 41, Guyane 21, Mayotte 15,
 * Polynésie française 12, Saint-Martin 4. They are counted, named by the
 * register's own `dep_num_nom`, and returned as `offshore` rather than snapped
 * or dropped — the nearest French polygon to a campus in Cayenne is 7 000 km
 * away. The national card states the shortfall instead of letting a
 * choropleth claim France has 2.90 million students.
 *
 * The 214th is a different fact and is reported the same way: ONE site in the
 * Bas-Rhin (21 students) sits further outside the simplified outlines than the
 * snap reaches. The 2 km coastal snap is the shared one from
 * `franceDepartements.js` — the measurement behind the number lives in
 * `irveDepartements.js`, where it was made — and it rescues 10 sites that
 * landed in the drawn sea. It cannot reach Guadeloupe, which is the point.
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
  SUP_CYCLES,
  SUP_DATASET,
  SUP_KINDS,
  SUP_SOURCE,
} from './supFeed.js';

/** Number of quantile bins on the choropleth ramp. Six, as the other two. */
export const SUP_DEPARTEMENT_BINS = 6;

/** How far outside every polygon a site may sit and still be counted, in km. */
export const SUP_COAST_SNAP_KM = DEFAULT_COAST_SNAP_KM;

/** An empty per-band tally, in ladder order. */
function emptyKinds() {
  return Object.fromEntries(SUP_KINDS.map((kind) => [kind, 0]));
}

/** An empty per-cycle tally. */
function emptyCycles() {
  return Object.fromEntries(SUP_CYCLES.map((cycle) => [cycle, 0]));
}

/**
 * Fold the national site list onto the départements.
 *
 * @param {object} input
 * @param {Array<object>} input.sites Sites from `projectSupSites`.
 * @param {{list:Array<object>, byCode:Map}} input.index From `buildDepartementIndex`.
 * @param {number} [input.binCount]
 * @param {number} [input.snapKm]
 * @returns {object} National rollup.
 */
export function projectSupDepartements({
  sites,
  index,
  binCount = SUP_DEPARTEMENT_BINS,
  snapKm = SUP_COAST_SNAP_KM,
} = {}) {
  const rows = Array.isArray(sites) ? sites : [];

  /** @type {Map<string, object>} */
  const tally = new Map();
  /** @type {Map<string, {sites:number, students:number}>} Outside all polygons. */
  const offshore = new Map();

  let swept = 0;
  let assigned = 0;
  let snapped = 0;
  let unassigned = 0;
  let studentsTotal = 0;
  let studentsAssigned = 0;

  for (const site of rows) {
    const lat = Number(site?.lat);
    const lon = Number(site?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    swept += 1;
    const students = Number(site?.students) || 0;
    studentsTotal += students;

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
      // The register's own `dep_num_nom` — `971 - Guadeloupe`, and the code
      // alone would not name it for a reader looking at a missing island.
      const published = String(site?.deptName || site?.dept || '—').trim() || '—';
      const bucket = offshore.get(published) || { sites: 0, students: 0 };
      bucket.sites += 1;
      bucket.students += students;
      offshore.set(published, bucket);
      continue;
    }

    assigned += 1;
    studentsAssigned += students;
    const bucket = tally.get(code) || {
      sites: 0,
      students: 0,
      kinds: emptyKinds(),
      cycles: emptyCycles(),
      public: 0,
      prive: 0,
      // Establishments are counted through a set and not a counter: one
      // university spans several sites in one département, and adding its
      // dots would claim more institutions than exist.
      etabs: new Set(),
    };
    bucket.sites += 1;
    bucket.students += students;
    if (bucket.kinds[site?.kind] !== undefined) bucket.kinds[site.kind] += 1;
    for (const cycle of SUP_CYCLES) {
      bucket.cycles[cycle] += Number(site?.cycles?.[cycle]) || 0;
    }
    if (site?.sector === 'public') bucket.public += 1;
    else if (site?.sector === 'prive') bucket.prive += 1;
    if (site?.uai) bucket.etabs.add(site.uai);
    tally.set(code, bucket);
  }

  // Quantiles over STUDENTS — see the header. `countBins` is a generic
  // quantile cut over a list of numbers; nothing in it is about counting.
  const thresholds = countBins([...tally.values()].map((entry) => entry.students), binCount);

  const departements = [];
  for (const entry of index?.list || []) {
    const bucket = tally.get(entry.code);
    const students = bucket?.students || 0;
    const areaKm2 = entry.areaKm2 || 0;
    departements.push({
      code: entry.code,
      name: entry.name,
      sites: bucket?.sites || 0,
      etabs: bucket?.etabs?.size || 0,
      students,
      public: bucket?.public || 0,
      prive: bucket?.prive || 0,
      kinds: bucket?.kinds || emptyKinds(),
      cycles: bucket?.cycles || emptyCycles(),
      areaKm2,
      // Students per 1 000 km² of the polygon that is actually DRAWN — the
      // surface the reader is looking at, not the official area.
      per1000Km2: areaKm2 > 0 ? (students / areaKm2) * 1000 : 0,
      bin: countBin(students, thresholds),
    });
  }

  const offshoreRows = [...offshore.entries()]
    .map(([name, entry]) => ({ name, ...entry }))
    .sort((a, b) => b.students - a.students || a.name.localeCompare(b.name));

  return {
    departements,
    thresholds,
    binCount,
    painted: departements.filter((entry) => entry.students > 0).length,
    sitesSwept: swept,
    assigned,
    snapped,
    unassigned,
    offshore: offshoreRows,
    students: studentsTotal,
    studentsAssigned,
    dataset: SUP_DATASET,
    source: SUP_SOURCE,
  };
}
