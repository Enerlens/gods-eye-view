/**
 * @module schoolsMesh
 *
 * The middle regime of the schools layer: the zooms between "all of France"
 * and "one city", where neither 96 département prisms nor 68 158 overlapping
 * dots is the honest answer.
 *
 * Untouched by the national regime's move from a flat fill to a prism, and
 * that is the point: the prism is a statement about 96 TERRITORIES, this is a
 * sample of real SITES, and the handover between them is the altitude gate in
 * `schoolsFrance.js` and nothing else.
 *
 * The policy and its justification live in `geoMeshThinning.js`, which the
 * charge-point layer worked out first (`irveMesh.js` carries the measurements
 * that argue for it). This file is the schools ADAPTER: it names the tuple in
 * this domain, sets the budgets, and nothing else.
 *
 * ── Why the same policy transfers ───────────────────────────────────────────
 * The failure it defends against is identical and, for schools, sharper.
 * Ranking by roll and taking the top N nationally would draw France's lycées —
 * a 1 300-pupil lycée outranks every primary school in its département — and
 * erase the 48 169 écoles that are the actual texture of the country. The
 * Massif Central argument becomes the rural-school argument: a commune with
 * one 40-pupil school is a real finding, and it must read as sparse-but-present
 * rather than as absent.
 *
 * The cell rule transfers with it. Representing a cell by its largest member
 * would make every rural cell a lycée, so the maillage would say France is a
 * country of secondary schools when 71% of its establishments are écoles. The
 * modal-category rule puts an école in a cell that is mostly écoles, which is
 * what is there.
 *
 * ── What the tuple carries, and the one thing it does not ───────────────────
 * `[lat, lon, pupils, level]`. The weight is the joined rentrée-2025 roll, and
 * **it is 0 for the 8.3% of teaching establishments with no published roll**
 * (see `schoolsFeed.js`, Trap 1). A zero weight only ever loses a tie-break for
 * "which real site represents this cell", never removes a site from the pick —
 * cell occupancy is spatial and counts every row. So an unrolled school is
 * still drawn and still holds its cell; it is merely never chosen over a
 * rolled neighbour to stand for the others, which is the correct preference
 * when the alternative is representing a cell by an unknown.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser and under `node --test`.
 */

import {
  MESH_CATEGORY,
  MESH_COLS,
  MESH_LAT,
  MESH_LON,
  MESH_ROWS,
  MESH_WEIGHT,
  meshBudgetForSpan,
  meshRowId,
  meshRowInBox,
  selectGeoMesh,
} from './geoMeshThinning.js';

/**
 * A mesh site is a 4-tuple, not an object: `[lat, lon, pupils, level]`.
 *
 * 68 158 of them travel to the browser in one document. Measured on the real
 * payload the proxy serves: **1.66 MB, 0.63 MB gzipped**. The same rows
 * carrying their names and UAIs would be 5.42 MB and 1.65 MB — two and a half
 * times the wire cost for two fields the maillage never draws. Neither is in
 * the pack; the exact regime fetches them per viewport, where they are read.
 */
export { MESH_LAT, MESH_LON };
/** The schools names for the generic weight and category slots. */
export const MESH_PUPILS = MESH_WEIGHT;
export const MESH_LEVEL = MESH_CATEGORY;

export const SCHOOLS_MESH_COLS = MESH_COLS;
export const SCHOOLS_MESH_ROWS = MESH_ROWS;

/**
 * Budget by latitude span.
 *
 * The charge-point ladder, unchanged and deliberately so: it was set by what
 * stays legible as separate dots at each scale, which is a property of the
 * screen and not of what is being drawn. The schools set is 1.7× the size of
 * the charge-point mesh (68 158 against 39 579) but that changes how much is
 * thinned away, not how much a viewport can show. Re-tuning these numbers
 * without a legibility measurement to point at would be taste dressed as a
 * threshold.
 */
export const SCHOOLS_MESH_BUDGETS = Object.freeze([
  Object.freeze({ maxLatSpanDeg: 0.8, budget: 2200 }),
  Object.freeze({ maxLatSpanDeg: 2.5, budget: 1600 }),
  Object.freeze({ maxLatSpanDeg: Infinity, budget: 1100 }),
]);

/**
 * Budget for one view.
 * @param {number} latSpanDeg The view's latitude span, in degrees.
 * @returns {number}
 */
export function schoolsMeshBudget(latSpanDeg) {
  return meshBudgetForSpan(latSpanDeg, SCHOOLS_MESH_BUDGETS);
}

/** Whether a mesh tuple falls inside a box (edges count). */
export function meshSchoolInBox(site, box) {
  return meshRowInBox(site, box);
}

/**
 * Stable identity for a mesh site.
 *
 * Coordinate-based, matching `schoolSiteKey` in `schoolsFeed.js`, so a site
 * picked in the maillage survives the handover into the exact regime. It is
 * NOT the UAI: the pack does not carry UAIs (see the tuple note above), and a
 * coordinate is the one identity both regimes can compute.
 */
export function meshSchoolId(site) {
  return meshRowId(site);
}

/**
 * Pick a bounded, spatially-spread subset of the schools inside a box.
 *
 * @param {Array<Array<number>>} sites National mesh tuples.
 * @param {object} options
 * @param {{south:number, west:number, north:number, east:number}} options.box
 * @param {number} [options.budget] Defaults to the tier for the box's span.
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @returns {{picked:Array<Array<number>>, inBox:number, budget:number,
 *   thinned:boolean, cells:number}}
 */
export function selectSchoolsMesh(sites, { box, budget, cols, rows } = {}) {
  if (!box) return { picked: [], inBox: 0, budget: 0, thinned: false, cells: 0 };
  return selectGeoMesh(sites, {
    box,
    budget: Number.isFinite(budget) ? budget : schoolsMeshBudget(box.north - box.south),
    cols,
    rows,
  });
}
