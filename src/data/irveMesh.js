/**
 * @module irveMesh
 *
 * Pure selection policy for the middle regime of the charge-point layer: the
 * zooms between "all of France" and "one city", where the honest answer is
 * neither 96 painted départements nor 39 859 overlapping dots.
 *
 * ── The problem this exists to solve ────────────────────────────────────────
 * The register puts 231 079 charge points on 39 859 distinct coordinates.
 * Drawn all at once over a région that is a solid smear; drawn not at all,
 * the question "where actually ARE they" cannot be asked until you are over a
 * single city. What a reader wants at that scale is the MAILLAGE — the shape
 * of the network, its corridors and its holes — which survives thinning
 * perfectly well, as long as the thinning is spatial rather than by rank.
 *
 * ── Why a grid, and not "the biggest N" ─────────────────────────────────────
 * Ranking globally and taking the top N is the obvious thinning and the wrong
 * one: the top 900 sites nationally are almost all in the same dozen
 * conurbations, so the map would show France as a handful of bright clusters
 * surrounded by an empty country that is not in fact empty. The Massif
 * Central would vanish, and its emptiness is a real finding that deserves to
 * be visible as sparse-but-present rather than as absent.
 *
 * So the pick is stratified: bucket the view into a grid and give every
 * occupied cell one dot before any cell gets a second. A cell with one
 * 2-point car park keeps its dot; a cell with four hundred does not get four
 * hundred.
 *
 * ── Which site represents its cell, and why not the largest ─────────────────
 * The obvious cell winner is the biggest site in it, and that one is a lie by
 * picture. Measured over France at 900 km: taking the largest draws **46.2%
 * of the dots as high-power DC when 12.2% of the sites in view are** — the
 * largest site in a rural cell is almost always the motorway HPC bank, so a
 * map built that way says France runs on 300 kW chargers when it runs on
 * 22 kW ones.
 *
 * The cell is therefore represented by its MODAL band — the kind of charging
 * most common in that cell — at the largest example of it. Every dot is still
 * a real site at its real position with its real published band; only the
 * choice of which real site stands for its neighbours changes, and choosing
 * the typical one over the biggest one is the less biased choice. Measured
 * again: 8.7% high-power against 12.2% true, and the same correction holds at
 * région scale (12.7% against 14.8%).
 *
 * Leftover budget is then spent by walking the remaining sites in position
 * order at a fixed stride, which samples whatever mix is actually there
 * instead of re-sorting by size and undoing the correction.
 *
 * A residual bias survives and is worth naming: `normale` comes out around
 * 46% against 36% true, because the most common band wins the most cells.
 * That errs toward the most common kind of charging rather than the rarest,
 * which is the direction a sample should err in, and the layer's legend says
 * the mix it shows is a sample rather than the national figure.
 *
 * This is `distributeCctvCards` from `cctvLod.js`, transposed from screen
 * space to geographic space — same shape, same guarantees, same deterministic
 * tie-break — because the CCTV ambient ring solves exactly this problem
 * (bounded budget, no clumping, stable under small camera moves) and had
 * already been through the field testing.
 *
 * ── Where the algorithm now lives ───────────────────────────────────────────
 * In `geoMeshThinning.js`, unchanged. The measurements above are what justify
 * it, and they are charge-point measurements, so the argument stays here; the
 * code moved out when the schools layer arrived needing the identical policy
 * over `[lat, lon, pupils, level]` instead of `[lat, lon, pdc, band]`. This
 * file is now the charge-point ADAPTER: it names the tuple, sets the budgets,
 * and re-exports the surface its tests and callers already use. Those tests
 * are unchanged, and their staying green is what proves the move was faithful.
 *
 * ── What the caller must do with the result ────────────────────────────────
 * Report it. A thinned map that does not say it is thinned is a map claiming
 * France has 900 charge points. `selectIrveMesh` returns the count it kept
 * and the count it was given, and the layer prints both.
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
  cellRepresentative,
  meshBudgetForSpan,
  meshRowId,
  meshRowInBox,
  selectGeoMesh,
} from './geoMeshThinning.js';

/**
 * A mesh site is a 4-tuple, not an object: `[lat, lon, pdc, band]`.
 *
 * 39 859 of them travel to the browser in one document, and objects with
 * four keys apiece cost 2.4 MB where tuples cost 0.9 MB (measured). The
 * index constants exist so no caller has to remember the order.
 */
export { MESH_LAT, MESH_LON };
/** The charge-point names for the generic weight and category slots. */
export const MESH_PDC = MESH_WEIGHT;
export const MESH_BAND = MESH_CATEGORY;

/**
 * Grid the view is bucketed into.
 *
 * 30 × 20 = 600 cells, deliberately BELOW every budget below: when cells
 * outnumber the budget, only the highest-ranked cells win and the pick
 * silently becomes rank-based again — the exact failure this grid exists to
 * prevent. Keeping cells < budget guarantees every occupied cell is
 * represented before a single second dot is placed anywhere.
 */
export const IRVE_MESH_COLS = MESH_COLS;
export const IRVE_MESH_ROWS = MESH_ROWS;

/**
 * Budget by how much of the world is on screen, measured in degrees of
 * LATITUDE.
 *
 * Latitude and not the larger of the two spans: on the app's 16:10 viewport
 * the longitude span runs about 2.4× the latitude one (measured — 9.53° lat
 * against 24.42° lon at 1 400 km), so the larger span is mostly a statement
 * about the window's aspect ratio. Latitude is the axis that answers "how far
 * out am I", and it is the one metropolitan France's 9.8° height is measured
 * against.
 *
 * Rising as you zoom in is the point: the mesh should densify continuously
 * into the exact per-site view rather than jump. The ceiling is set by what
 * stays legible as separate dots at that scale, not by what the client could
 * draw — it could draw all 39 579 and they would be a smear.
 */
export const IRVE_MESH_BUDGETS = Object.freeze([
  Object.freeze({ maxLatSpanDeg: 0.8, budget: 2200 }),
  Object.freeze({ maxLatSpanDeg: 2.5, budget: 1600 }),
  Object.freeze({ maxLatSpanDeg: Infinity, budget: 1100 }),
]);

/**
 * Budget for one view.
 * @param {number} latSpanDeg The view's latitude span, in degrees.
 * @returns {number}
 */
export function irveMeshBudget(latSpanDeg) {
  return meshBudgetForSpan(latSpanDeg, IRVE_MESH_BUDGETS);
}

/** Whether a mesh tuple falls inside a box (edges count). */
export function meshSiteInBox(site, box) {
  return meshRowInBox(site, box);
}

/**
 * Stable identity for a mesh site, matching the key the exact regime uses so
 * a selection can survive the handover between the two.
 */
export function meshSiteId(site) {
  return meshRowId(site);
}

/**
 * The site that represents a cell: the largest example of the cell's most
 * common band. See the header for the 46%-vs-12% measurement behind this.
 *
 * The bucket is assumed already sorted largest-first, so the first match is
 * the largest of the modal band. Ties between equally common bands go to the
 * lower band index, which is deterministic and errs toward slower charging —
 * the side that over-claims nothing.
 *
 * @param {Array<Array<number>>} bucket Sites in one cell, sorted by pdc.
 * @returns {Array<number>}
 */
export { cellRepresentative };

/**
 * Pick a bounded, spatially-spread subset of the sites inside a box.
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
export function selectIrveMesh(sites, { box, budget, cols, rows } = {}) {
  if (!box) return { picked: [], inBox: 0, budget: 0, thinned: false, cells: 0 };
  return selectGeoMesh(sites, {
    box,
    budget: Number.isFinite(budget) ? budget : irveMeshBudget(box.north - box.south),
    cols,
    rows,
  });
}
