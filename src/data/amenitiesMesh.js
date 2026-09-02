/**
 * @module amenitiesMesh
 *
 * The middle regime of the everyday-amenities layer: the zooms between "all of
 * France" and "one street", where neither 96 painted départements nor 95 406
 * overlapping dots is the honest answer.
 *
 * The thinning policy itself lives in `geoMeshThinning.js` — `irveMesh.js`
 * worked it out, `schoolsMesh.js` and `anfrMesh.js` adopted it — and this file
 * is the amenities adapter. It differs from its three predecessors in exactly
 * one way, and that difference is the reason it is not a nine-line wrapper.
 *
 * ── Why this layer thins per FAMILY and its neighbours thin once ────────────
 * `schools-fr` thins 68 158 schools whose five levels are within a factor of
 * ten of each other. This set is not like that. Measured on the real pack:
 *
 *   médecin      30 215 dots        piscine       3 625
 *   courses      19 354             gendarmerie   3 953
 *   pharmacie    19 216             hôpital       2 211
 *   poste        16 832
 *
 * — a factor of **13.7** between the largest family and the smallest. A single
 * pass over the whole set spends its budget roughly in proportion to that mix,
 * which is defensible for a quantity and indefensible for this one: the whole
 * question a reader brings to this layer is *where is the nearest one*, and the
 * families they are least likely to find by accident are exactly the ones a
 * proportional sample erases.
 *
 * Measured at the national view (41.3–51.1 N, −5.2–9.6 E, 95 406 tuples, budget
 * 1 100 — the tier the national zoom actually uses):
 *
 *   one global pass    médecin 414 · courses 179 · pharmacie 139 · poste 284 ·
 *                      piscine 25 · gendarmerie 45 · hôpital 14
 *   per-family passes  médecin 331 · courses 223 · pharmacie 222 · poste 197 ·
 *                      piscine 42 · gendarmerie 46 · hôpital 39
 *
 * Fourteen hospitals for a country that has 2 211 of them is not a sample, it
 * is an absence with a decimal point. The floor rule below raises it to 39 and
 * pays for it out of the family that loses least by being sampled harder — the
 * global pass also happens to over-draw bureaux de poste (284 of 16 832)
 * against pharmacies (139 of 19 216), which is the cell-representative rule
 * reporting rural France accurately and reading as noise at this scale.
 *
 * ── The rule, stated so the distortion is legible ──────────────────────────
 * Each family gets its proportional share of the budget, but never less than
 * `budget / (4 × families present)` — 39 dots at the national tier, 78 at the
 * closest one — and never more than it actually has in view. What that buys is
 * a guarantee: **no family can be squeezed off the map by a bigger one.** What
 * it costs is that the on-screen mix is no longer the real mix, and that is a
 * distortion, so `amenitiesFrance.js` prints kept-against-in-view per family in
 * the legend. The picture is bent; the numbers next to it are not.
 *
 * ── The weight slot is the geocoding precision, and that is deliberate ──────
 * This point set has no magnitude. A pharmacy is one pharmacy; there is no roll
 * and no enrolment and no installed power, and inventing one would be the
 * layer's first lie. So the weight `geoMeshThinning.js` ranks by is the only
 * per-row quantity either register actually publishes: **how well the position
 * is known.** `cellRepresentative` therefore draws each cell with the example
 * whose coordinate the register is most confident about, which is the right dot
 * to keep when only one can be kept.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
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
import { AMENITY_FAMILIES, amenityPrecisionFromRank } from './amenitiesFeed.js';

export { MESH_LAT, MESH_LON };
/** The amenities names for the generic weight and category slots. */
export const MESH_PRECISION = MESH_WEIGHT;
export const MESH_FAMILY = MESH_CATEGORY;

export const AMENITIES_MESH_COLS = MESH_COLS;
export const AMENITIES_MESH_ROWS = MESH_ROWS;

/**
 * Budget by latitude span.
 *
 * The charge-point ladder, unchanged — the same decision `schoolsMesh.js` and
 * `anfrMesh.js` made, for the same reason: these numbers were set by what stays
 * legible as separate dots at each scale, which is a property of the screen and
 * not of what is drawn on it. Re-tuning them here without a legibility
 * measurement would be taste dressed up as a threshold.
 */
export const AMENITIES_MESH_BUDGETS = Object.freeze([
  Object.freeze({ maxLatSpanDeg: 0.8, budget: 2200 }),
  Object.freeze({ maxLatSpanDeg: 2.5, budget: 1600 }),
  Object.freeze({ maxLatSpanDeg: Infinity, budget: 1100 }),
]);

/**
 * Divisor behind the per-family floor.
 *
 * 4 — so with seven families present the floors claim at most 7/4 of nothing,
 * i.e. `7 × budget/28 = budget/4`, a quarter of the budget reserved against
 * erasure and three quarters still spent proportionally. It is a judgement, and
 * the two numbers that back it are in the header: at budget 1 100 it moves the
 * hospital family from 14 dots to 39.
 */
export const AMENITIES_FLOOR_DIVISOR = 4;

/**
 * Budget for one view.
 * @param {number} latSpanDeg The view's latitude span, in degrees.
 * @returns {number}
 */
export function amenitiesMeshBudget(latSpanDeg) {
  return meshBudgetForSpan(latSpanDeg, AMENITIES_MESH_BUDGETS);
}

/** Whether a mesh tuple falls inside a box (edges count). */
export function meshAmenityInBox(row, box) {
  return meshRowInBox(row, box);
}

/**
 * Stable identity for a mesh tuple.
 *
 * Coordinate-based and family-qualified, matching the id `foldAmenitySites`
 * builds, so a dot selected in the maillage survives the handover into the
 * exact regime. The family has to be in the key: 1 137 positions in the pack
 * carry two different families — a pharmacy inside a supermarket is two things
 * — and a bare coordinate would merge them.
 */
export function meshAmenityId(row) {
  const family = Number(row?.[MESH_FAMILY]);
  return `a:${Number.isFinite(family) ? family : -1}:${meshRowId(row).split(',').map((part) => Number(part).toFixed(5)).join(',')}`;
}

/** Family id for one mesh tuple. */
export function meshAmenityFamily(row) {
  const index = Number(row?.[MESH_FAMILY]);
  return AMENITY_FAMILIES[index] || null;
}

/** Precision band for one mesh tuple. */
export function meshAmenityPrecision(row) {
  return amenityPrecisionFromRank(Number(row?.[MESH_PRECISION]));
}

/**
 * Split a budget across the families present in a box.
 *
 * Proportional, floored, capped at what each family has, and reconciled to
 * exactly `budget` — the reconciliation matters, because a floor that pushes
 * the sum over the budget has to be paid for by somebody, and the somebody is
 * always the family that is furthest above its own floor.
 *
 * @param {Array<number>} inBox Per-family counts inside the box, indexed like
 *   {@link AMENITY_FAMILIES}.
 * @param {number} budget
 * @returns {Array<number>} Per-family allocations summing to
 *   `min(budget, total)`.
 */
export function allocateAmenityBudget(inBox, budget) {
  const counts = AMENITY_FAMILIES.map((_, i) => Math.max(0, Math.floor(Number(inBox?.[i]) || 0)));
  const total = counts.reduce((sum, value) => sum + value, 0);
  const cap = Math.max(0, Math.floor(Number(budget) || 0));
  if (!total || !cap) return counts.map(() => 0);
  if (total <= cap) return counts.slice();

  const present = counts.filter((value) => value > 0).length;
  const floor = Math.max(1, Math.min(
    Math.floor(cap / (present * AMENITIES_FLOOR_DIVISOR)),
    Math.floor(cap / present),
  ));

  const alloc = counts.map((count) => {
    if (!count) return 0;
    return Math.min(count, Math.max(Math.min(count, floor), Math.round((cap * count) / total)));
  });

  // Reconcile. Over-budget: take from whoever is furthest above its own floor,
  // which is by construction the biggest family. Under-budget: give to whoever
  // still has unmet demand, biggest first, so the spare dots go where the
  // sampling is hardest.
  let sum = alloc.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum > cap && guard < 100000) {
    guard += 1;
    let pick = -1;
    let slack = 0;
    for (let i = 0; i < alloc.length; i += 1) {
      const own = Math.min(counts[i], floor);
      const room = alloc[i] - own;
      if (room > slack) { slack = room; pick = i; }
    }
    if (pick < 0) {
      // Every family is at its floor and the floors still overflow — shave the
      // largest allocation rather than return a sum that lies.
      pick = alloc.indexOf(Math.max(...alloc));
      if (pick < 0 || alloc[pick] <= 0) break;
    }
    alloc[pick] -= 1;
    sum -= 1;
  }
  guard = 0;
  while (sum < cap && guard < 100000) {
    guard += 1;
    let pick = -1;
    let demand = 0;
    for (let i = 0; i < alloc.length; i += 1) {
      const room = counts[i] - alloc[i];
      if (room > demand) { demand = room; pick = i; }
    }
    if (pick < 0) break;
    alloc[pick] += 1;
    sum += 1;
  }
  return alloc;
}

/**
 * Pick a bounded, spatially-spread, family-balanced subset of the tuples in a
 * box.
 *
 * @param {Array<Array<number>>} rows National mesh tuples.
 * @param {object} options
 * @param {{south:number, west:number, north:number, east:number}} options.box
 * @param {number} [options.budget] Defaults to the tier for the box's span.
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @returns {{picked:Array<Array<number>>, inBox:number, budget:number,
 *   thinned:boolean, cells:number, perFamily:Array<{family:string, inBox:number,
 *   kept:number}>}}
 */
export function selectAmenitiesMesh(rows, { box, budget, cols, rows: rowCount } = {}) {
  const empty = {
    picked: [], inBox: 0, budget: 0, thinned: false, cells: 0, perFamily: [],
  };
  if (!box) return empty;
  const cap = Number.isFinite(budget) ? budget : amenitiesMeshBudget(box.north - box.south);

  const buckets = AMENITY_FAMILIES.map(() => []);
  let inBox = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!meshRowInBox(row, box)) continue;
    const family = Number(row[MESH_FAMILY]);
    if (!Number.isFinite(family) || family < 0 || family >= buckets.length) continue;
    buckets[family].push(row);
    inBox += 1;
  }
  if (!inBox) return { ...empty, budget: Math.max(0, Math.floor(cap)) };

  const allocation = allocateAmenityBudget(buckets.map((bucket) => bucket.length), cap);
  const picked = [];
  let cells = 0;
  const perFamily = [];
  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i];
    if (!bucket.length) continue;
    const result = selectGeoMesh(bucket, {
      box, budget: allocation[i], cols: cols ?? MESH_COLS, rows: rowCount ?? MESH_ROWS,
    });
    cells += result.cells;
    picked.push(...result.picked);
    perFamily.push({
      family: AMENITY_FAMILIES[i], inBox: bucket.length, kept: result.picked.length,
    });
  }
  // South-to-north so the draw order is stable between frames; the per-family
  // passes hand back seven interleaved runs otherwise, and a Cesium collection
  // rebuilt in a different order flickers while the camera stands still.
  picked.sort((a, b) => a[MESH_LAT] - b[MESH_LAT] || a[MESH_LON] - b[MESH_LON]);
  return {
    picked,
    inBox,
    budget: Math.max(0, Math.floor(cap)),
    thinned: picked.length < inBox,
    cells,
    perFamily,
  };
}
