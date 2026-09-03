/**
 * @module anfrMesh
 *
 * The middle regime of the ANFR layer: the zooms between "all of France" and
 * "one street", where neither 96 painted départements nor 68 852 overlapping
 * masts is the honest answer.
 *
 * The policy and its justification live in `geoMeshThinning.js`, which the
 * charge-point layer worked out first (`irveMesh.js` carries the measurements
 * that argue for it) and the schools layer adopted second. This file is the
 * ANTENNA adapter: it names the tuple in this domain, sets the budgets, and
 * nothing else.
 *
 * ── Why this layer needs the middle regime at all ───────────────────────────
 * `sup-fr` deliberately has no maillage, and its argument is a byte count: its
 * whole register is 0.62 MB gzipped, so the browser is handed it once. That
 * argument does not survive here, and both halves of it fail.
 *
 * The pack is too big. Measured on the real payload: the 72 700 supports with
 * their three generation masks, their operator and system masks, their nature
 * and their height are 3 553 551 bytes and **1 046 345 gzipped** — 1.7× the
 * `sup-fr` register and 1.7× the schools maillage. The mesh tuple below is
 * **392 035 bytes gzipped**, a third of that.
 *
 * And even if it were free, it would be unreadable. Measured against the real
 * coordinates on a 16:10 viewport: a view one notch under the national
 * threshold (9.4° of latitude) centred on Lyon contains **66 769 supports** —
 * 92% of the country in one screen. Drawing them is not a map of the network,
 * it is a silhouette of France in dots.
 *
 * ── What the tuple carries ──────────────────────────────────────────────────
 * `[lat, lon, operators, band]`.
 *
 * The WEIGHT is the number of distinct operators on the mast, which is what
 * "biggest" means for a support: measured over the 72 700, **36 671 carry one
 * operator, 16 786 two, 8 230 three, 11 012 four, and exactly one carries
 * five** (Saint-Barthélemy, SUP_ID 506104 — Orange, Digicel, Dauphin Telecom,
 * Free Caraïbes and UTS Caraïbes on one 30 m pylon). A four-operator macro site
 * genuinely is the structure a cell should be represented by, and unlike a
 * roll or a charging power it is never missing: every row in the register names
 * its operator, so the weight is 0 for nothing.
 *
 * The CATEGORY is `ANFR_BAND_INDEX` — the newest generation that actually
 * radiates. Its ordering is what makes `cellRepresentative` safe: a tie between
 * two equally common bands in a cell resolves to the LOWER index, so a cell
 * that is half approved-project and half 5G is drawn as the project. The
 * modal-category rule matters more here than it did for schools, because the
 * distribution is so lopsided — 50 148 of 72 700 supports are `5g` — that
 * representing a cell by its largest member would paint rural France 5G on the
 * strength of one upgraded mast per cell.
 *
 * ── Why the tuple does NOT carry the support height ─────────────────────────
 * The drawing extrudes each support to its real height in the closest regime,
 * and the obvious next thought is to put the height in the tuple so the
 * maillage could do it too. It is refused, and on two measurements rather than
 * on taste.
 *
 * The first is the wire. `sup_nm_haut` is one decimal place over a 0.6–343.3 m
 * range, so it is three to five characters a row across 72 700 rows in a
 * document that gzips to 392 035 bytes precisely BECAUSE its four columns sort
 * together and share leading digits. A fifth column with no spatial
 * autocorrelation to exploit is the one that does not compress.
 *
 * The second is that nobody could see it. The shafts are drawn under 0.06° of
 * view span — about 6.7 km across — because at the top of the exact regime a
 * median 30 m mast is already about one screen pixel. The maillage answers
 * from 0.32° upward, where the same mast is a fifth of a pixel. A height in
 * this tuple would be a field that is paid for on every load and drawn at no
 * zoom this file serves.
 *
 * And a cell REPRESENTATIVE's height would be a lie of a third kind: the
 * thinning already speaks for a cell through one member, which is defensible
 * for a modal band and for an operator count, and is not defensible for a
 * length that the eye would read as a measurement of the ground it stands on.
 *
 * ── What the maillage cannot say, and what it can ───────────────────────────
 * `schools-fr`'s maillage carries no names, so a mesh dot's card says
 * "Établissement" until a click fetches the real one. This one has no such
 * hole: a support has no name to lose. Both channels the map uses — the band
 * and the operator count — are IN the tuple, so a mesh dot already says
 * "4 opérateurs · 5G en service" truthfully. What the click adds is the exact
 * operators, the frequency bands, the mast's nature and height, and the nearest
 * published exposure measurement.
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
import {
  ANFR_BANDS,
  ANFR_BAND_INDEX,
  ANFR_LIVE,
  ANFR_LAT as PACK_LAT,
  ANFR_LON as PACK_LON,
  ANFR_OPS,
  anfrBand,
  anfrPopCount,
} from './anfrFeed.js';

export { MESH_LAT, MESH_LON };
/** The ANFR names for the generic weight and category slots. */
export const MESH_OPERATORS = MESH_WEIGHT;
export const MESH_BAND = MESH_CATEGORY;

export const ANFR_MESH_COLS = MESH_COLS;
export const ANFR_MESH_ROWS = MESH_ROWS;

/**
 * Budget by latitude span.
 *
 * The charge-point ladder, unchanged, and deliberately so — the same decision
 * `schoolsMesh.js` made and for the same reason. These numbers were set by what
 * stays legible as separate dots at each scale, which is a property of the
 * screen rather than of what is being drawn. The ANFR set is 1.07× the schools
 * set (72 700 against 68 158), which changes how much is thinned away and not
 * how much a viewport can show. Re-tuning them without a legibility measurement
 * to point at would be taste dressed as a threshold.
 */
export const ANFR_MESH_BUDGETS = Object.freeze([
  Object.freeze({ maxLatSpanDeg: 0.8, budget: 2200 }),
  Object.freeze({ maxLatSpanDeg: 2.5, budget: 1600 }),
  Object.freeze({ maxLatSpanDeg: Infinity, budget: 1100 }),
]);

/**
 * Budget for one view.
 * @param {number} latSpanDeg The view's latitude span, in degrees.
 * @returns {number}
 */
export function anfrMeshBudget(latSpanDeg) {
  return meshBudgetForSpan(latSpanDeg, ANFR_MESH_BUDGETS);
}

/** Whether a mesh tuple falls inside a box (edges count). */
export function meshSupportInBox(site, box) {
  return meshRowInBox(site, box);
}

/**
 * Stable identity for a mesh support.
 *
 * Coordinate-based, matching what `anfrSupportId` builds from a pack tuple, so
 * a mast selected in the maillage survives the handover into the exact regime.
 * It is NOT the `SUP_ID`: the mesh tuple does not carry it (see the tuple note
 * above), and the coordinate is the one identity both regimes can compute.
 * Safe here in a way it is not everywhere — this module verified that no
 * support in the register has more than one distinct coordinate, and that no
 * two supports share one to five decimals.
 */
export function meshSupportId(site) {
  return meshRowId(site);
}

/**
 * Build the national mesh from the pack.
 *
 * Sorted south-to-north, then west-to-east, and the sort is not cosmetic:
 * measured on the real 72 700 tuples, the sorted document gzips to 392 035
 * bytes against 486 034 unsorted. Neighbouring masts share leading digits, so
 * ordering them costs one sort and returns 19% of the wire.
 *
 * @param {Array<Array<number>>} supports Pack tuples from `projectAnfrSupports`.
 * @returns {Array<Array<number>>}
 */
export function buildAnfrMesh(supports) {
  const rows = Array.isArray(supports) ? supports : [];
  const mesh = [];
  for (const support of rows) {
    const lat = Number(support?.[PACK_LAT]);
    const lon = Number(support?.[PACK_LON]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    mesh.push([
      lat,
      lon,
      anfrPopCount(support[ANFR_OPS]),
      ANFR_BAND_INDEX[anfrBand(support[ANFR_LIVE])],
    ]);
  }
  mesh.sort((a, b) => a[MESH_LAT] - b[MESH_LAT] || a[MESH_LON] - b[MESH_LON]);
  return mesh;
}

/** Band id for one mesh tuple. */
export function meshSupportBand(site) {
  const index = Number(site?.[MESH_BAND]);
  return ANFR_BANDS[index] || ANFR_BANDS[0];
}

/**
 * Pick a bounded, spatially-spread subset of the supports inside a box.
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
export function selectAnfrMesh(sites, { box, budget, cols, rows } = {}) {
  if (!box) return { picked: [], inBox: 0, budget: 0, thinned: false, cells: 0 };
  return selectGeoMesh(sites, {
    box,
    budget: Number.isFinite(budget) ? budget : anfrMeshBudget(box.north - box.south),
    cols,
    rows,
  });
}
