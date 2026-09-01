// The middle regime's selection policy.
//
// The property this file exists to defend is that thinning must be SPATIAL.
// Taking the biggest N sites nationally is the obvious thinning and the one
// that destroys the thing the regime is for: France's charge-point network is
// a mesh with corridors and holes, and a rank-based pick collapses it to a
// dozen bright conurbations surrounded by a country that looks empty and is
// not. The tests below mostly encode that one claim from different angles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cellRepresentative,
  irveMeshBudget,
  meshSiteId,
  meshSiteInBox,
  selectIrveMesh,
  IRVE_MESH_BUDGETS,
  IRVE_MESH_COLS,
  IRVE_MESH_ROWS,
  MESH_BAND,
  MESH_LAT,
  MESH_LON,
  MESH_PDC,
} from './irveMesh.js';

const FRANCE = { south: 41.3, west: -5.2, north: 51.1, east: 9.6 };

/** A tuple, in the layout the proxy ships. */
const site = (lat, lon, pdc = 1, band = 1) => [lat, lon, pdc, band];

/** A dense city cluster plus a sparse rural scatter — the shape that matters. */
function franceLike() {
  const sites = [];
  // 4 000 charge points crammed into a fifth of a degree around Paris.
  for (let i = 0; i < 4000; i += 1) {
    sites.push(site(48.80 + (i % 60) * 0.003, 2.25 + Math.floor(i / 60) * 0.003, 20 + (i % 40), 1));
  }
  // 200 small sites spread thinly across the rest of the country.
  for (let i = 0; i < 200; i += 1) {
    sites.push(site(42 + (i % 20) * 0.4, -4 + Math.floor(i / 20) * 1.3, 1 + (i % 3), 0));
  }
  return sites;
}

test('the tuple layout is the one the proxy ships', () => {
  assert.deepEqual([MESH_LAT, MESH_LON, MESH_PDC, MESH_BAND], [0, 1, 2, 3]);
  const one = site(48.8566, 2.3522, 12, 4);
  assert.equal(one[MESH_PDC], 12);
  assert.equal(one[MESH_BAND], 4);
});

test('a mesh id matches the key the exact regime uses', () => {
  // The two regimes hand a selection over to each other; a different rounding
  // on either side would drop it silently at the boundary.
  assert.equal(meshSiteId(site(48.891554, 2.242018)), '48.89155,2.24202');
});

test('the box test counts the edges', () => {
  assert.equal(meshSiteInBox(site(41.3, -5.2), FRANCE), true);
  assert.equal(meshSiteInBox(site(51.1, 9.6), FRANCE), true);
  assert.equal(meshSiteInBox(site(51.2, 0), FRANCE), false);
  assert.equal(meshSiteInBox(site(45, 0), null), false);
  assert.equal(meshSiteInBox(null, FRANCE), false);
});

// ── The claim: thinning is spatial, not by rank ─────────────────────────────

/** Which grid cell a site falls in, for a box and the production grid. */
function cellOf(s, box) {
  const col = Math.min(IRVE_MESH_COLS - 1, Math.floor(((s[MESH_LON] - box.west) / (box.east - box.west)) * IRVE_MESH_COLS));
  const row = Math.min(IRVE_MESH_ROWS - 1, Math.floor(((s[MESH_LAT] - box.south) / (box.north - box.south)) * IRVE_MESH_ROWS));
  return row * IRVE_MESH_COLS + col;
}

test('every occupied cell keeps a dot — that is the contract', () => {
  // Not "every site survives": the guarantee is one per occupied cell before
  // any cell gets a second, which is what keeps the network's SHAPE.
  const sites = franceLike();
  const picked = selectIrveMesh(sites, { box: FRANCE }).picked;
  const occupied = new Set(sites.map((s) => cellOf(s, FRANCE)));
  const covered = new Set(picked.map((s) => cellOf(s, FRANCE)));
  for (const cell of occupied) assert.ok(covered.has(cell), `cell ${cell} lost its dot`);
});

test('a sparse region keeps its dots even beside a dense one', () => {
  // The whole point. Rank-based thinning would spend the entire budget inside
  // Paris and draw the other 200 sites nowhere.
  const picked = selectIrveMesh(franceLike(), { box: FRANCE }).picked;
  const rural = picked.filter((s) => s[MESH_LAT] < 47);
  assert.ok(rural.length >= 100, `${rural.length} rural sites survived of 200`);
});

test('and a rank-based pick would have kept none of them, which is the point', () => {
  const all = franceLike();
  const byRank = [...all].sort((a, b) => b[MESH_PDC] - a[MESH_PDC]).slice(0, 1100);
  assert.equal(byRank.filter((s) => s[MESH_LAT] < 47).length, 0);
});

test('a dense cell is capped at one dot before any cell gets a second', () => {
  // 400 sites in one cell, 3 elsewhere: the 3 must all survive.
  const dense = Array.from({ length: 400 }, (_, i) => site(48.8 + i * 1e-4, 2.3, 100 + i, 1));
  const sparse = [site(44, -1, 2, 0), site(46, 5, 2, 0), site(43.5, 7, 2, 0)];
  const picked = selectIrveMesh([...dense, ...sparse], { box: FRANCE, budget: 4 }).picked;
  assert.equal(picked.length, 4);
  for (const one of sparse) {
    assert.ok(picked.some((p) => p[MESH_LAT] === one[MESH_LAT]), `${one[MESH_LAT]} kept`);
  }
});

test('the grid is smaller than every budget, or the pick silently becomes rank-based', () => {
  // When cells outnumber the budget only the top-ranked cells win, which is
  // exactly the failure the grid exists to prevent.
  const cells = IRVE_MESH_COLS * IRVE_MESH_ROWS;
  for (const tier of IRVE_MESH_BUDGETS) {
    assert.ok(tier.budget > cells, `budget ${tier.budget} must exceed ${cells} cells`);
  }
});

test('a cell is represented by its most common band, not its biggest site', () => {
  // The measured failure this replaces: picking the biggest drew 46.2% of
  // France as high-power DC when 12.2% of the sites in view were.
  const bucket = [
    site(48.851, 2.351, 900, 4),  // one huge motorway HPC bank
    site(48.852, 2.352, 40, 1),
    site(48.853, 2.353, 12, 1),
    site(48.854, 2.354, 3, 1),
  ].sort((a, b) => b[MESH_PDC] - a[MESH_PDC]);
  const winner = cellRepresentative(bucket);
  assert.equal(winner[MESH_BAND], 1, 'the modal band, not the biggest site');
  assert.equal(winner[MESH_PDC], 40, 'and the largest example of it');
});

test('the representative falls back to the biggest when a cell has one site', () => {
  const one = site(45, 5, 7, 4);
  assert.equal(cellRepresentative([one]), one);
});

test('a tie between equally common bands errs toward slower charging', () => {
  // Deterministic, and the side that over-claims nothing.
  const bucket = [site(45, 5, 9, 4), site(45.1, 5.1, 8, 1)].sort((a, b) => b[MESH_PDC] - a[MESH_PDC]);
  assert.equal(cellRepresentative(bucket)[MESH_BAND], 1);
});

test('the drawn band mix tracks the real one instead of inverting it', () => {
  // 90% slow sites, 10% high-power — the shape of the real register. A pick
  // that draws high-power as the majority is the bug this guards.
  const sites = [];
  for (let i = 0; i < 900; i += 1) sites.push(site(42 + (i % 30) * 0.3, -4 + Math.floor(i / 30) * 0.45, 4, 1));
  for (let i = 0; i < 100; i += 1) sites.push(site(42 + (i % 10) * 0.9, -4 + Math.floor(i / 10) * 1.35, 400, 4));
  const picked = selectIrveMesh(sites, { box: FRANCE, budget: 300 }).picked;
  const hpc = picked.filter((s) => s[MESH_BAND] === 4).length / picked.length;
  assert.ok(hpc < 0.25, `high-power came out at ${Math.round(hpc * 100)}% of a 10% population`);
});

test('the budget is actually spent, not left on the table', () => {
  // The stride fill undershot by ~300 dots before it learned to top up.
  const result = selectIrveMesh(franceLike(), { box: FRANCE, budget: 1500 });
  assert.equal(result.picked.length, 1500);
});

test('ties break on position, so a still camera does not shimmer', () => {
  const sites = [site(48.9, 2.4, 5), site(48.7, 2.2, 5), site(48.8, 2.3, 5)];
  const first = selectIrveMesh(sites, { box: FRANCE, budget: 2 }).picked;
  const second = selectIrveMesh([...sites].reverse(), { box: FRANCE, budget: 2 }).picked;
  assert.deepEqual(first, second);
});

// ── Reporting, budgets, and the degenerate cases ────────────────────────────

test('the pick reports what it dropped', () => {
  const result = selectIrveMesh(franceLike(), { box: FRANCE });
  assert.equal(result.inBox, 4200);
  assert.ok(result.picked.length < result.inBox);
  assert.equal(result.thinned, true);
  assert.equal(result.picked.length, result.budget);
});

test('a view that fits under budget is NOT reported as thinned', () => {
  const result = selectIrveMesh([site(48.85, 2.35, 4), site(45.75, 4.85, 9)], { box: FRANCE });
  assert.equal(result.inBox, 2);
  assert.equal(result.picked.length, 2);
  assert.equal(result.thinned, false);
});

test('the budget rises as the view closes in, measured on LATITUDE', () => {
  // Latitude, because on a 16:10 viewport the longitude span is ~2.4× larger
  // and would make the budget a function of the window's shape.
  const wide = irveMeshBudget(6);      // ~1 000 km up, France already cropped
  const mid = irveMeshBudget(1.5);     // ~230 km, a région
  const close = irveMeshBudget(0.4);   // ~60 km, a conurbation
  assert.ok(close > mid && mid > wide, `${wide} ${mid} ${close}`);
  assert.equal(irveMeshBudget(Infinity), wide);
  assert.equal(irveMeshBudget(NaN), wide);
});

test('sites outside the box are never picked', () => {
  const box = { south: 45, west: 4, north: 46, east: 5 };
  const result = selectIrveMesh([
    site(45.5, 4.5, 10),
    site(48.85, 2.35, 9000),
    site(43.3, 5.4, 9000),
  ], { box });
  assert.equal(result.inBox, 1);
  assert.equal(result.picked.length, 1);
  assert.equal(result.picked[0][MESH_LAT], 45.5);
});

test('an empty, missing or zero-budget input yields an empty pick, not a throw', () => {
  for (const input of [undefined, {}, { box: null }, { box: FRANCE }]) {
    const result = selectIrveMesh(undefined, input);
    assert.deepEqual(result.picked, []);
  }
  assert.deepEqual(selectIrveMesh(franceLike(), { box: FRANCE, budget: 0 }).picked, []);
  assert.deepEqual(selectIrveMesh([site(1, 1)], { box: FRANCE }).picked, []);
});

test('a box with no extent resolves to one cell instead of dividing by zero', () => {
  const flat = { south: 48.85, west: 2.35, north: 48.85, east: 2.35 };
  const result = selectIrveMesh([site(48.85, 2.35, 7)], { box: flat });
  assert.equal(result.inBox, 1);
  assert.equal(result.cells, 1);
  assert.ok(result.picked.every((s) => Number.isFinite(s[MESH_LAT])));
});

test('the pick is stable under a small pan, so dots do not churn', () => {
  const sites = franceLike();
  const a = selectIrveMesh(sites, { box: FRANCE }).picked.map(meshSiteId);
  const nudged = { ...FRANCE, west: FRANCE.west + 0.01, east: FRANCE.east + 0.01 };
  const b = selectIrveMesh(sites, { box: nudged }).picked.map(meshSiteId);
  const kept = new Set(a).size ? a.filter((id) => b.includes(id)).length : 0;
  assert.ok(kept / a.length > 0.9, `only ${Math.round((kept / a.length) * 100)}% survived a 0.01° pan`);
});
