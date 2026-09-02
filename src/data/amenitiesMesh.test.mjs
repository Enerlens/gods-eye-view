// What the middle regime is allowed to leave out.
//
// The property under test is the one thing this adapter adds to the shared
// thinning policy: **no family may be squeezed off the map by a bigger one.**
// The families differ by a factor of 13.7 nationally (30 215 médecins against
// 2 211 hôpitaux), so a single proportional pass gives the rarest family a
// dozen dots for a whole country. Every test here is a door that erasure could
// come back through — the allocation, the floor, the reconciliation to exactly
// the budget, and the per-family report the legend prints.
//
// The second property is that the thinning is REPORTED. A maillage that does
// not hand back both numbers per family lets the layer claim the sample is the
// inventory.
import test from 'node:test';
import assert from 'node:assert/strict';

import { AMENITY_FAMILIES } from './amenitiesFeed.js';
import { selectGeoMesh } from './geoMeshThinning.js';
import {
  AMENITIES_FLOOR_DIVISOR,
  AMENITIES_MESH_BUDGETS,
  MESH_FAMILY,
  MESH_LAT,
  MESH_LON,
  MESH_PRECISION,
  allocateAmenityBudget,
  amenitiesMeshBudget,
  meshAmenityFamily,
  meshAmenityId,
  meshAmenityPrecision,
  meshAmenityInBox,
  selectAmenitiesMesh,
} from './amenitiesMesh.js';

const FRANCE = Object.freeze({ south: 41.3, west: -5.2, north: 51.1, east: 9.6 });

/**
 * A synthetic national set with the REAL family proportions, spread over the
 * real bounding box on a deterministic lattice. Synthetic on purpose: the
 * property is about the ratio between the families, and a lattice makes the
 * cell rule's contribution visible instead of hiding it in real clustering.
 */
function nationalSet(scale = 1) {
  const counts = [30215, 19354, 19216, 16832, 3625, 3953, 2211].map((n) => Math.round(n * scale));
  const rows = [];
  for (let family = 0; family < counts.length; family += 1) {
    for (let i = 0; i < counts[family]; i += 1) {
      const t = (i * 2654435761) % 100000;
      const lat = FRANCE.south + ((t % 977) / 977) * (FRANCE.north - FRANCE.south);
      const lon = FRANCE.west + ((t % 991) / 991) * (FRANCE.east - FRANCE.west);
      rows.push([lat, lon, i % 4, family]);
    }
  }
  return rows;
}

const NATIONAL = nationalSet(1);

test('the budget ladder is the shared one, resolved on latitude', () => {
  assert.deepEqual(AMENITIES_MESH_BUDGETS.map((tier) => tier.budget), [2200, 1600, 1100]);
  assert.equal(amenitiesMeshBudget(0.5), 2200);
  assert.equal(amenitiesMeshBudget(0.8), 2200);
  assert.equal(amenitiesMeshBudget(2.0), 1600);
  assert.equal(amenitiesMeshBudget(9.5), 1100);
  assert.equal(amenitiesMeshBudget(Infinity), 1100);
});

test('a single global pass starves the rarest family, and the per-family pass does not', () => {
  const global = selectGeoMesh(NATIONAL, { box: FRANCE, budget: 1100 });
  const globalPerFamily = new Array(AMENITY_FAMILIES.length).fill(0);
  for (const row of global.picked) globalPerFamily[row[MESH_FAMILY]] += 1;

  const balanced = selectAmenitiesMesh(NATIONAL, { box: FRANCE, budget: 1100 });
  const kept = new Map(balanced.perFamily.map((row) => [row.family, row.kept]));

  const hopitalIndex = AMENITY_FAMILIES.indexOf('hopital');
  assert.ok(globalPerFamily[hopitalIndex] < 30,
    `a global pass should starve hôpital, got ${globalPerFamily[hopitalIndex]}`);
  // The floor is budget / (families × divisor) = 1100 / 28 = 39.
  assert.equal(kept.get('hopital'), Math.floor(1100 / (7 * AMENITIES_FLOOR_DIVISOR)));
  assert.ok(kept.get('hopital') > globalPerFamily[hopitalIndex]);
  // And it is paid for by the biggest family, not by the middle ones.
  assert.ok(kept.get('medecin') < globalPerFamily[AMENITY_FAMILIES.indexOf('medecin')]);
});

test('the allocation always sums to exactly the budget, and never over-draws a family', () => {
  for (const budget of [1100, 1600, 2200, 37, 7, 1]) {
    const counts = [30215, 19354, 19216, 16832, 3625, 3953, 2211];
    const alloc = allocateAmenityBudget(counts, budget);
    assert.equal(alloc.reduce((a, b) => a + b, 0), budget, `budget ${budget}`);
    alloc.forEach((value, i) => {
      assert.ok(value <= counts[i], `family ${i} over-drawn at budget ${budget}`);
      assert.ok(value >= 0);
    });
  }
});

test('a budget larger than the set keeps everything, and an empty set keeps nothing', () => {
  const counts = [3, 1, 0, 0, 2, 0, 0];
  assert.deepEqual(allocateAmenityBudget(counts, 100), counts);
  assert.deepEqual(allocateAmenityBudget(counts, 0), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(allocateAmenityBudget([0, 0, 0, 0, 0, 0, 0], 100), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(allocateAmenityBudget(null, 100), [0, 0, 0, 0, 0, 0, 0]);
});

test('a family with one member in view keeps that member rather than being rounded away', () => {
  const counts = [50000, 0, 0, 0, 0, 0, 1];
  const alloc = allocateAmenityBudget(counts, 100);
  assert.equal(alloc[6], 1);
  assert.equal(alloc.reduce((a, b) => a + b, 0), 100);
});

test('the floor cannot over-subscribe the budget when many families are present', () => {
  // Seven families, budget 7: one dot each and no more.
  const alloc = allocateAmenityBudget([100, 100, 100, 100, 100, 100, 100], 7);
  assert.equal(alloc.reduce((a, b) => a + b, 0), 7);
  for (const value of alloc) assert.ok(value >= 0 && value <= 100);
});

test('the pick reports both numbers per family, which is what the legend prints', () => {
  const pick = selectAmenitiesMesh(NATIONAL, { box: FRANCE, budget: 2200 });
  assert.equal(pick.picked.length, 2200);
  assert.equal(pick.thinned, true);
  assert.equal(pick.inBox, NATIONAL.length);
  assert.equal(pick.perFamily.length, AMENITY_FAMILIES.length);
  let keptTotal = 0;
  let inBoxTotal = 0;
  for (const row of pick.perFamily) {
    assert.ok(AMENITY_FAMILIES.includes(row.family));
    assert.ok(row.kept <= row.inBox);
    keptTotal += row.kept;
    inBoxTotal += row.inBox;
  }
  assert.equal(keptTotal, pick.picked.length);
  assert.equal(inBoxTotal, pick.inBox);
});

test('the picked rows come back sorted, so a redraw does not shuffle the collection', () => {
  const pick = selectAmenitiesMesh(NATIONAL, { box: FRANCE, budget: 400 });
  for (let i = 1; i < pick.picked.length; i += 1) {
    const previous = pick.picked[i - 1];
    const current = pick.picked[i];
    assert.ok(current[MESH_LAT] > previous[MESH_LAT]
      || (current[MESH_LAT] === previous[MESH_LAT] && current[MESH_LON] >= previous[MESH_LON]));
  }
  // Deterministic: the same box and budget give the same rows, in the same order.
  const again = selectAmenitiesMesh(NATIONAL, { box: FRANCE, budget: 400 });
  assert.deepEqual(again.picked, pick.picked);
});

test('an empty box reports nothing rather than an empty inventory', () => {
  const pick = selectAmenitiesMesh(NATIONAL, {
    box: { south: 0, west: 0, north: 1, east: 1 }, budget: 1100,
  });
  assert.equal(pick.inBox, 0);
  assert.equal(pick.picked.length, 0);
  assert.equal(pick.thinned, false);
  assert.deepEqual(pick.perFamily, []);
  assert.deepEqual(selectAmenitiesMesh(NATIONAL, {}), {
    picked: [], inBox: 0, budget: 0, thinned: false, cells: 0, perFamily: [],
  });
});

test('a box that holds less than the budget is NOT reported as thinned', () => {
  const small = [
    [45.0, 3.0, 3, 0],
    [45.1, 3.1, 3, 6],
  ];
  const pick = selectAmenitiesMesh(small, { box: FRANCE, budget: 1100 });
  assert.equal(pick.picked.length, 2);
  assert.equal(pick.inBox, 2);
  assert.equal(pick.thinned, false);
});

test('the tuple reads back as a family, a precision and an id that survives the handover', () => {
  const row = [48.83801, 2.34276, 3, AMENITY_FAMILIES.indexOf('medecin')];
  assert.equal(meshAmenityFamily(row), 'medecin');
  assert.equal(meshAmenityPrecision(row), 'numero');
  assert.equal(meshAmenityId(row), 'a:0:48.83801,2.34276');
  // The family MUST be in the key: two families share 1 137 coordinates in the
  // real pack, and a bare coordinate would merge a pharmacy into a supermarket.
  const other = [48.83801, 2.34276, 3, AMENITY_FAMILIES.indexOf('pharmacie')];
  assert.notEqual(meshAmenityId(other), meshAmenityId(row));
  assert.equal(meshAmenityFamily([0, 0, 0, 99]), null);
  assert.equal(meshAmenityPrecision([0, 0, undefined, 0]), 'indeterminee');
  assert.equal(row[MESH_PRECISION], 3);
});

test('a tuple outside the box is out, edges included', () => {
  const box = { south: 45, west: 3, north: 46, east: 4 };
  assert.equal(meshAmenityInBox([45, 3, 0, 0], box), true);
  assert.equal(meshAmenityInBox([46, 4, 0, 0], box), true);
  assert.equal(meshAmenityInBox([44.9, 3.5, 0, 0], box), false);
  assert.equal(meshAmenityInBox([45.5, 4.1, 0, 0], box), false);
});

test('a tuple with an out-of-range family index is dropped, not filed under family 0', () => {
  const rows = [
    [45.0, 3.0, 3, 0],
    [45.1, 3.1, 3, 42],
    [45.2, 3.2, 3, -1],
  ];
  const pick = selectAmenitiesMesh(rows, { box: FRANCE, budget: 1100 });
  assert.equal(pick.inBox, 1);
  assert.equal(pick.picked.length, 1);
  assert.equal(meshAmenityFamily(pick.picked[0]), 'medecin');
});
