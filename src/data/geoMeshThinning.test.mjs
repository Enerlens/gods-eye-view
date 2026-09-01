// The shared thinning policy, and the contract that lets two layers share it.
//
// `irveMesh.test.mjs` already exercises this algorithm hard, through the
// charge-point adapter, with the measurements that argue for every rule. This
// file tests the two things that file cannot: that the generic surface behaves
// on its own terms, and that the two adapters are genuinely the SAME code
// rather than two copies that have started to drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESH_CATEGORY,
  MESH_COLS,
  MESH_LAT,
  MESH_LON,
  MESH_ROWS,
  MESH_WEIGHT,
  byPosition,
  byWeight,
  cellRepresentative,
  meshBudgetForSpan,
  meshRowId,
  meshRowInBox,
  selectGeoMesh,
} from './geoMeshThinning.js';
import { irveMeshBudget, selectIrveMesh, IRVE_MESH_BUDGETS } from './irveMesh.js';
import { schoolsMeshBudget, selectSchoolsMesh, SCHOOLS_MESH_BUDGETS } from './schoolsMesh.js';

const BOX = { south: 40, west: 0, north: 50, east: 10 };
const row = (lat, lon, weight = 1, category = 0) => [lat, lon, weight, category];

/** A dense corner plus a sparse scatter — the shape both layers care about. */
function lumpy() {
  const rows = [];
  for (let i = 0; i < 2000; i += 1) {
    rows.push(row(40.1 + (i % 40) * 0.004, 0.1 + Math.floor(i / 40) * 0.004, 10 + (i % 30), i % 3));
  }
  for (let i = 0; i < 150; i += 1) {
    rows.push(row(41 + (i % 15) * 0.55, 2 + Math.floor(i / 15) * 0.7, 1 + (i % 4), (i + 1) % 3));
  }
  return rows;
}

// --- The extraction contract ------------------------------------------------

test('both adapters delegate to this module, and agree row for row', () => {
  // The point of the extraction. If either adapter ever grows its own copy of
  // the algorithm, these three picks stop matching and this test says so.
  const rows = lumpy();
  const budget = 300;
  const generic = selectGeoMesh(rows, { box: BOX, budget });
  const irve = selectIrveMesh(rows, { box: BOX, budget });
  const schools = selectSchoolsMesh(rows, { box: BOX, budget });

  assert.deepEqual(irve.picked, generic.picked);
  assert.deepEqual(schools.picked, generic.picked);
  assert.equal(irve.inBox, generic.inBox);
  assert.equal(schools.cells, generic.cells);
});

test('each adapter resolves its own budget from its own ladder', () => {
  // Sharing the algorithm must not mean sharing the tuning. Today the two
  // ladders happen to hold the same numbers; this asserts each adapter reads
  // ITS OWN, so a future re-tune of one cannot silently move the other.
  assert.equal(irveMeshBudget(0.5), IRVE_MESH_BUDGETS[0].budget);
  assert.equal(schoolsMeshBudget(0.5), SCHOOLS_MESH_BUDGETS[0].budget);
  assert.equal(meshBudgetForSpan(0.5, IRVE_MESH_BUDGETS), irveMeshBudget(0.5));
  assert.equal(meshBudgetForSpan(0.5, SCHOOLS_MESH_BUDGETS), schoolsMeshBudget(0.5));
  // And a caller with a different ladder gets a different answer.
  assert.equal(meshBudgetForSpan(0.5, [{ maxLatSpanDeg: Infinity, budget: 7 }]), 7);
});

test('an adapter that omits the budget still gets one from its ladder', () => {
  const rows = lumpy();
  const wide = { south: 40, west: 0, north: 50, east: 10 };
  assert.equal(selectIrveMesh(rows, { box: wide }).budget, irveMeshBudget(10));
  assert.equal(selectSchoolsMesh(rows, { box: wide }).budget, schoolsMeshBudget(10));
});

// --- The generic surface ----------------------------------------------------

test('the tuple slots are fixed, because the wire format depends on them', () => {
  assert.equal(MESH_LAT, 0);
  assert.equal(MESH_LON, 1);
  assert.equal(MESH_WEIGHT, 2);
  assert.equal(MESH_CATEGORY, 3);
});

test('every occupied cell is represented before any cell gets a second dot', () => {
  // The whole reason the pick is stratified rather than ranked.
  const rows = lumpy();
  const pick = selectGeoMesh(rows, { box: BOX, budget: 5000 });
  assert.equal(pick.picked.length, pick.inBox);
  const small = selectGeoMesh(rows, { box: BOX, budget: pick.cells });
  const cellOf = (r) => {
    const col = Math.min(MESH_COLS - 1, Math.floor(((r[MESH_LON] - BOX.west) / 10) * MESH_COLS));
    const gridRow = Math.min(MESH_ROWS - 1, Math.floor(((r[MESH_LAT] - BOX.south) / 10) * MESH_ROWS));
    return gridRow * MESH_COLS + col;
  };
  assert.equal(new Set(small.picked.map(cellOf)).size, small.picked.length);
});

test('the representative is the largest example of the modal category', () => {
  const bucket = [
    row(41, 1, 900, 2), // biggest, but its category is rare here
    row(42, 2, 40, 0),
    row(43, 3, 30, 0),
    row(44, 4, 20, 0),
  ].sort(byWeight);
  const winner = cellRepresentative(bucket);
  assert.equal(winner[MESH_CATEGORY], 0);
  assert.equal(winner[MESH_WEIGHT], 40);
});

test('a tie between equally common categories errs to the lower index', () => {
  // Callers order their ladders so the low end over-claims nothing — slower
  // charging, younger school. The tie-break has to honour that.
  const bucket = [row(41, 1, 10, 1), row(42, 2, 10, 0)].sort(byWeight);
  assert.equal(cellRepresentative(bucket)[MESH_CATEGORY], 0);
});

test('a single-row cell is represented by that row', () => {
  const only = row(41, 1, 5, 3);
  assert.equal(cellRepresentative([only]), only);
});

test('the budget is spent, not left on the table', () => {
  const pick = selectGeoMesh(lumpy(), { box: BOX, budget: 400 });
  assert.equal(pick.picked.length, 400);
});

test('ties break on position, so a still camera does not shimmer', () => {
  const a = row(41, 1, 10, 0);
  const b = row(42, 2, 10, 0);
  assert.ok(byWeight(a, b) < 0);
  assert.ok(byPosition(a, b) < 0);
  const rows = [b, a];
  assert.deepEqual(rows.slice().sort(byWeight), [a, b]);
});

test('a box with no extent resolves to one cell instead of dividing by zero', () => {
  const flat = { south: 45, west: 3, north: 45, east: 3 };
  const pick = selectGeoMesh([row(45, 3, 1, 0), row(45, 3, 2, 0)], { box: flat, budget: 5 });
  assert.equal(pick.cells, 1);
  assert.equal(pick.picked.length, 2);
});

test('a zero or missing budget yields an empty pick that still reports the box', () => {
  const pick = selectGeoMesh(lumpy(), { box: BOX, budget: 0 });
  assert.deepEqual(pick.picked, []);
  assert.ok(pick.inBox > 0);
  assert.equal(pick.thinned, true);
  // No budget at all is the same thing, not an unbounded pick.
  assert.deepEqual(selectGeoMesh(lumpy(), { box: BOX }).picked, []);
});

test('no box means no pick, and no throw', () => {
  const pick = selectGeoMesh(lumpy(), {});
  assert.deepEqual(pick.picked, []);
  assert.equal(pick.inBox, 0);
  assert.doesNotThrow(() => selectGeoMesh());
});

test('a budget ladder that is empty or missing resolves to zero, not NaN', () => {
  assert.equal(meshBudgetForSpan(1, []), 0);
  assert.equal(meshBudgetForSpan(1, null), 0);
  assert.equal(meshBudgetForSpan(NaN, [{ maxLatSpanDeg: Infinity, budget: 5 }]), 5);
});

test('row identity is the coordinate, to 5 decimals', () => {
  assert.equal(meshRowId(row(48.1234567, 2.9876543)), '48.12346,2.98765');
});

test('box membership counts the edges and survives junk', () => {
  assert.equal(meshRowInBox(row(40, 0), BOX), true);
  assert.equal(meshRowInBox(row(50, 10), BOX), true);
  assert.equal(meshRowInBox(row(50.001, 10), BOX), false);
  assert.equal(meshRowInBox('nope', BOX), false);
  assert.equal(meshRowInBox(row(45, 5), undefined), false);
});
