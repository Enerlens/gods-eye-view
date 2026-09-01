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
 * ── What the caller must do with the result ────────────────────────────────
 * Report it. A thinned map that does not say it is thinned is a map claiming
 * France has 900 charge points. `selectIrveMesh` returns the count it kept
 * and the count it was given, and the layer prints both.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser and under `node --test`.
 */

/**
 * A mesh site is a 4-tuple, not an object: `[lat, lon, pdc, band]`.
 *
 * 39 859 of them travel to the browser in one document, and objects with
 * four keys apiece cost 2.4 MB where tuples cost 0.9 MB (measured). The
 * index constants exist so no caller has to remember the order.
 */
export const MESH_LAT = 0;
export const MESH_LON = 1;
export const MESH_PDC = 2;
export const MESH_BAND = 3;

/**
 * Grid the view is bucketed into.
 *
 * 30 × 20 = 600 cells, deliberately BELOW every budget below: when cells
 * outnumber the budget, only the highest-ranked cells win and the pick
 * silently becomes rank-based again — the exact failure this grid exists to
 * prevent. Keeping cells < budget guarantees every occupied cell is
 * represented before a single second dot is placed anywhere.
 */
export const IRVE_MESH_COLS = 30;
export const IRVE_MESH_ROWS = 20;

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
  const span = Number.isFinite(latSpanDeg) ? Math.max(0, latSpanDeg) : Infinity;
  for (const tier of IRVE_MESH_BUDGETS) {
    if (span <= tier.maxLatSpanDeg) return tier.budget;
  }
  return IRVE_MESH_BUDGETS.at(-1).budget;
}

/** Whether a mesh tuple falls inside a box (edges count). */
export function meshSiteInBox(site, box) {
  if (!box || !Array.isArray(site)) return false;
  const lat = site[MESH_LAT];
  const lon = site[MESH_LON];
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/**
 * Stable identity for a mesh site, matching the key the exact regime uses so
 * a selection can survive the handover between the two.
 */
export function meshSiteId(site) {
  return `${Number(site[MESH_LAT]).toFixed(5)},${Number(site[MESH_LON]).toFixed(5)}`;
}

/**
 * Largest first, ties broken by position.
 *
 * The tie-break is not decoration — without it, two sites with the same
 * charge-point count would swap places between frames as the array order
 * shifted, and the map would shimmer while standing still.
 */
function byPdc(a, b) {
  const delta = (b[MESH_PDC] || 0) - (a[MESH_PDC] || 0);
  if (delta) return delta;
  if (a[MESH_LAT] !== b[MESH_LAT]) return a[MESH_LAT] - b[MESH_LAT];
  return a[MESH_LON] - b[MESH_LON];
}

/** South-to-north, then west-to-east. The order the stride fill walks. */
function byPosition(a, b) {
  if (a[MESH_LAT] !== b[MESH_LAT]) return a[MESH_LAT] - b[MESH_LAT];
  return a[MESH_LON] - b[MESH_LON];
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
 * @param {Array<Array<number>>} bucket Sites in one cell, sorted by `byPdc`.
 * @returns {Array<number>}
 */
export function cellRepresentative(bucket) {
  const counts = [];
  for (const site of bucket) {
    const band = site[MESH_BAND];
    counts[band] = (counts[band] || 0) + 1;
  }
  let modal = -1;
  let best = 0;
  for (let band = 0; band < counts.length; band += 1) {
    if ((counts[band] || 0) > best) {
      best = counts[band];
      modal = band;
    }
  }
  return bucket.find((site) => site[MESH_BAND] === modal) || bucket[0];
}

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
  const rowsIn = Array.isArray(sites) ? sites : [];
  if (!box) return { picked: [], inBox: 0, budget: 0, thinned: false, cells: 0 };

  const cap = Math.max(0, Math.floor(
    Number.isFinite(budget) ? budget : irveMeshBudget(box.north - box.south),
  ));
  const nCols = Math.max(1, Math.floor(cols ?? IRVE_MESH_COLS));
  const nRows = Math.max(1, Math.floor(rows ?? IRVE_MESH_ROWS));

  // A degenerate box would divide by zero; one cell is the honest answer for
  // a view with no extent rather than a NaN column index.
  const latSpan = box.north - box.south;
  const lonSpan = box.east - box.west;

  /** @type {Map<number, Array<Array<number>>>} occupied cell → its sites */
  const cells = new Map();
  let inBox = 0;
  for (const site of rowsIn) {
    if (!meshSiteInBox(site, box)) continue;
    inBox += 1;
    const col = lonSpan > 0
      ? Math.min(nCols - 1, Math.max(0, Math.floor(((site[MESH_LON] - box.west) / lonSpan) * nCols)))
      : 0;
    const row = latSpan > 0
      ? Math.min(nRows - 1, Math.max(0, Math.floor(((site[MESH_LAT] - box.south) / latSpan) * nRows)))
      : 0;
    const key = row * nCols + col;
    const bucket = cells.get(key);
    if (bucket) bucket.push(site);
    else cells.set(key, [site]);
  }
  if (!cap || !inBox) {
    return { picked: [], inBox, budget: cap, thinned: inBox > 0, cells: cells.size };
  }

  const cellBest = [];
  const rest = [];
  for (const bucket of cells.values()) {
    bucket.sort(byPdc);
    const winner = cellRepresentative(bucket);
    cellBest.push(winner);
    for (const site of bucket) {
      if (site !== winner) rest.push(site);
    }
  }
  // Cell winners are cut largest-first if there are somehow more cells than
  // budget, so an under-budget view still shows the most substantial ones.
  cellBest.sort(byPdc);
  const picked = cellBest.slice(0, cap);

  // Spend the rest by walking position order at a fixed stride: that samples
  // whatever band mix is actually in view, where re-sorting by size would put
  // back the over-representation the cell rule just removed.
  rest.sort(byPosition);
  const need = cap - picked.length;
  if (need > 0 && rest.length) {
    const taken = new Set();
    const stride = Math.max(1, Math.floor(rest.length / need));
    for (let i = 0; i < rest.length && picked.length < cap; i += stride) {
      taken.add(i);
      picked.push(rest[i]);
    }
    // The stride can undershoot on a short remainder; top up in order so the
    // budget is actually spent rather than silently left on the table.
    for (let i = 0; i < rest.length && picked.length < cap; i += 1) {
      if (taken.has(i)) continue;
      picked.push(rest[i]);
    }
  }
  return { picked, inBox, budget: cap, thinned: picked.length < inBox, cells: cells.size };
}
