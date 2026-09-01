/**
 * @module geoMeshThinning
 *
 * Bounded, spatially-stratified thinning of a national point set to what one
 * viewport can legibly draw.
 *
 * ── Why this file exists apart from its callers ─────────────────────────────
 * `irveMesh.js` worked this policy out for the charge-point layer and carries
 * the measurements that justify every rule in it — read that header first, it
 * is the argument. What is NOT charge-point-specific is the algorithm itself,
 * which only ever reads four numbers per row: a latitude, a longitude, a
 * WEIGHT to rank by, and a CATEGORY to be representative of. Schools have
 * exactly that shape (pupils, level) as charge points do (points de charge,
 * power band), so the second caller would have been a 277-line copy whose
 * divergence from the first nobody would notice until the two maps thinned
 * differently for no stated reason.
 *
 * So the policy lives here once, and `irveMesh.js` and `schoolsMesh.js` are
 * both thin adapters that name the tuple in their own domain and set their own
 * budgets. `irveMesh.js` keeps its full export surface and its own tests, which
 * is what proves this extraction changed nothing.
 *
 * ── The policy, in one paragraph ───────────────────────────────────────────
 * Bucket the view into a grid and give every occupied cell one dot before any
 * cell gets a second, so a sparse region reads as sparse-but-present rather
 * than as absent — which taking the biggest N nationally would make it. Each
 * cell is represented by the largest example of its MODAL category, not by its
 * largest member, because the largest member of a rural cell is an outlier and
 * a map built from outliers describes a country that does not exist. Leftover
 * budget is spent walking position order at a fixed stride, which samples the
 * mix that is actually there instead of re-sorting by size and undoing the
 * correction.
 *
 * ── What the caller must do with the result ────────────────────────────────
 * Report it. A thinned map that does not say it is thinned is a map claiming
 * the country holds `budget` things. `selectGeoMesh` returns both the count it
 * kept and the count it was given, and every caller prints both.
 *
 * Dependency-free and side-effect-free (no Cesium, no DOM) so it runs
 * identically in the browser, in the Vite dev-server proxy, and under
 * `node --test`.
 */

/**
 * A mesh row is a 4-tuple, not an object: `[lat, lon, weight, category]`.
 *
 * Tens of thousands of them travel to the browser in one document, and objects
 * with four keys apiece cost roughly 2.7× what tuples cost (measured on the
 * charge-point set: 2.4 MB against 0.9 MB). The index constants exist so no
 * caller has to remember the order.
 */
export const MESH_LAT = 0;
export const MESH_LON = 1;
export const MESH_WEIGHT = 2;
export const MESH_CATEGORY = 3;

/**
 * Default grid the view is bucketed into.
 *
 * 30 × 20 = 600 cells, deliberately BELOW every budget its callers use: when
 * cells outnumber the budget, only the highest-ranked cells win and the pick
 * silently becomes rank-based again — the exact failure this grid exists to
 * prevent. Keeping cells < budget guarantees every occupied cell is
 * represented before a single second dot is placed anywhere.
 */
export const MESH_COLS = 30;
export const MESH_ROWS = 20;

/**
 * Resolve a latitude span against a caller's budget ladder.
 *
 * Latitude and not the larger of the two spans: on the app's 16:10 viewport
 * the longitude span runs about 2.4× the latitude one (measured — 9.53° lat
 * against 24.42° lon at 1 400 km), so the larger span is mostly a statement
 * about the window's aspect ratio. Latitude is the axis that answers "how far
 * out am I", and it is the one metropolitan France's 9.8° height is measured
 * against.
 *
 * @param {number} latSpanDeg The view's latitude span, in degrees.
 * @param {ReadonlyArray<{maxLatSpanDeg:number, budget:number}>} tiers
 *   Ascending by `maxLatSpanDeg`; the last tier should be `Infinity`.
 * @returns {number}
 */
export function meshBudgetForSpan(latSpanDeg, tiers) {
  const ladder = Array.isArray(tiers) && tiers.length ? tiers : null;
  if (!ladder) return 0;
  const span = Number.isFinite(latSpanDeg) ? Math.max(0, latSpanDeg) : Infinity;
  for (const tier of ladder) {
    if (span <= tier.maxLatSpanDeg) return tier.budget;
  }
  return ladder.at(-1).budget;
}

/** Whether a mesh tuple falls inside a box (edges count). */
export function meshRowInBox(row, box) {
  if (!box || !Array.isArray(row)) return false;
  const lat = row[MESH_LAT];
  const lon = row[MESH_LON];
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/**
 * Stable identity for a mesh row, matching the key the exact regime uses so a
 * selection can survive the handover between the two.
 */
export function meshRowId(row) {
  return `${Number(row[MESH_LAT]).toFixed(5)},${Number(row[MESH_LON]).toFixed(5)}`;
}

/**
 * Heaviest first, ties broken by position.
 *
 * The tie-break is not decoration — without it, two rows with the same weight
 * would swap places between frames as the array order shifted, and the map
 * would shimmer while standing still.
 */
export function byWeight(a, b) {
  const delta = (b[MESH_WEIGHT] || 0) - (a[MESH_WEIGHT] || 0);
  if (delta) return delta;
  if (a[MESH_LAT] !== b[MESH_LAT]) return a[MESH_LAT] - b[MESH_LAT];
  return a[MESH_LON] - b[MESH_LON];
}

/** South-to-north, then west-to-east. The order the stride fill walks. */
export function byPosition(a, b) {
  if (a[MESH_LAT] !== b[MESH_LAT]) return a[MESH_LAT] - b[MESH_LAT];
  return a[MESH_LON] - b[MESH_LON];
}

/**
 * The row that represents a cell: the largest example of the cell's most
 * common category.
 *
 * The bucket is assumed already sorted heaviest-first, so the first match is
 * the largest of the modal category. Ties between equally common categories go
 * to the LOWER category index, which is deterministic — callers are expected to
 * order their category ladders so that the low end is the one that over-claims
 * nothing (slower charging, smaller school).
 *
 * @param {Array<Array<number>>} bucket Rows in one cell, sorted by `byWeight`.
 * @returns {Array<number>}
 */
export function cellRepresentative(bucket) {
  const counts = [];
  for (const row of bucket) {
    const category = row[MESH_CATEGORY];
    counts[category] = (counts[category] || 0) + 1;
  }
  let modal = -1;
  let best = 0;
  for (let category = 0; category < counts.length; category += 1) {
    if ((counts[category] || 0) > best) {
      best = counts[category];
      modal = category;
    }
  }
  return bucket.find((row) => row[MESH_CATEGORY] === modal) || bucket[0];
}

/**
 * Pick a bounded, spatially-spread subset of the rows inside a box.
 *
 * @param {Array<Array<number>>} rows National mesh tuples.
 * @param {object} options
 * @param {{south:number, west:number, north:number, east:number}} options.box
 * @param {number} options.budget Row cap. Callers resolve it from their own
 *   ladder via `meshBudgetForSpan` before calling.
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @returns {{picked:Array<Array<number>>, inBox:number, budget:number,
 *   thinned:boolean, cells:number}}
 */
export function selectGeoMesh(rows, { box, budget, cols, rows: rowCount } = {}) {
  const rowsIn = Array.isArray(rows) ? rows : [];
  if (!box) return { picked: [], inBox: 0, budget: 0, thinned: false, cells: 0 };

  const cap = Math.max(0, Math.floor(Number.isFinite(budget) ? budget : 0));
  const nCols = Math.max(1, Math.floor(cols ?? MESH_COLS));
  const nRows = Math.max(1, Math.floor(rowCount ?? MESH_ROWS));

  // A degenerate box would divide by zero; one cell is the honest answer for a
  // view with no extent rather than a NaN column index.
  const latSpan = box.north - box.south;
  const lonSpan = box.east - box.west;

  /** @type {Map<number, Array<Array<number>>>} occupied cell → its rows */
  const cells = new Map();
  let inBox = 0;
  for (const row of rowsIn) {
    if (!meshRowInBox(row, box)) continue;
    inBox += 1;
    const col = lonSpan > 0
      ? Math.min(nCols - 1, Math.max(0, Math.floor(((row[MESH_LON] - box.west) / lonSpan) * nCols)))
      : 0;
    const gridRow = latSpan > 0
      ? Math.min(nRows - 1, Math.max(0, Math.floor(((row[MESH_LAT] - box.south) / latSpan) * nRows)))
      : 0;
    const key = gridRow * nCols + col;
    const bucket = cells.get(key);
    if (bucket) bucket.push(row);
    else cells.set(key, [row]);
  }
  if (!cap || !inBox) {
    return { picked: [], inBox, budget: cap, thinned: inBox > 0, cells: cells.size };
  }

  const cellBest = [];
  const rest = [];
  for (const bucket of cells.values()) {
    bucket.sort(byWeight);
    const winner = cellRepresentative(bucket);
    cellBest.push(winner);
    for (const row of bucket) {
      if (row !== winner) rest.push(row);
    }
  }
  // Cell winners are cut heaviest-first if there are somehow more cells than
  // budget, so an under-budget view still shows the most substantial ones.
  cellBest.sort(byWeight);
  const picked = cellBest.slice(0, cap);

  // Spend the rest by walking position order at a fixed stride: that samples
  // whatever category mix is actually in view, where re-sorting by size would
  // put back the over-representation the cell rule just removed.
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
