// The maillage, in the schools domain.
//
// `geoMeshThinning.test.mjs` owns the algorithm's own guarantees. What is
// tested here is the claim that makes the algorithm the RIGHT one for this
// dataset: France's school network is 71% écoles, and a thinning that ranks by
// roll would draw its lycées and erase the country. Every test below is that
// one claim from a different angle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESH_LAT,
  MESH_LEVEL,
  MESH_LON,
  MESH_PUPILS,
  SCHOOLS_MESH_BUDGETS,
  SCHOOLS_MESH_COLS,
  SCHOOLS_MESH_ROWS,
  meshSchoolId,
  meshSchoolInBox,
  schoolsMeshBudget,
  selectSchoolsMesh,
} from './schoolsMesh.js';
import { SCHOOL_LEVELS, SCHOOL_LEVEL_INDEX } from './schoolsFeed.js';

const FRANCE = { south: 41.3, west: -5.2, north: 51.1, east: 9.6 };

/** A tuple, in the layout the proxy ships. */
const site = (lat, lon, pupils = 0, level = SCHOOL_LEVEL_INDEX.ecole) => [lat, lon, pupils, level];

/**
 * A country shaped like the real one: a dense conurbation of every level, and
 * a thin rural scatter that is almost entirely small écoles.
 */
function franceLike() {
  const sites = [];
  // 3 000 establishments crammed into a fifth of a degree around Paris,
  // including the big lycées that a rank-based pick would take first.
  for (let i = 0; i < 3000; i += 1) {
    const level = i % 10 === 0 ? SCHOOL_LEVEL_INDEX.lycee
      : (i % 5 === 0 ? SCHOOL_LEVEL_INDEX.college : SCHOOL_LEVEL_INDEX.ecole);
    const pupils = level === SCHOOL_LEVEL_INDEX.lycee ? 1200 + (i % 400)
      : (level === SCHOOL_LEVEL_INDEX.college ? 500 + (i % 200) : 80 + (i % 120));
    sites.push(site(48.80 + (i % 60) * 0.003, 2.25 + Math.floor(i / 60) * 0.003, pupils, level));
  }
  // 300 small rural écoles spread thinly across the rest of the country.
  for (let i = 0; i < 300; i += 1) {
    sites.push(site(42 + (i % 25) * 0.35, -4 + Math.floor(i / 25) * 1.1, 25 + (i % 40), SCHOOL_LEVEL_INDEX.ecole));
  }
  return sites;
}

test('the tuple slots are the ones the proxy writes', () => {
  assert.equal(MESH_LAT, 0);
  assert.equal(MESH_LON, 1);
  assert.equal(MESH_PUPILS, 2);
  assert.equal(MESH_LEVEL, 3);
});

test('the rural half of France survives a thinning that rank would spend on Paris', () => {
  // The property this whole regime exists for. A rank-ordered pick of 1 100
  // would be 1 100 Paris lycées and colleges; not one rural école would be
  // drawn, and the map would say the country outside the cities is empty.
  const sites = franceLike();
  const { picked } = selectSchoolsMesh(sites, { box: FRANCE });
  const rural = picked.filter((row) => row[MESH_LON] < 1.5 || row[MESH_LAT] < 46);
  assert.ok(rural.length > 100, `expected the countryside to survive, got ${rural.length}`);

  const byRank = sites.slice().sort((a, b) => b[MESH_PUPILS] - a[MESH_PUPILS]).slice(0, picked.length);
  const ruralByRank = byRank.filter((row) => row[MESH_LON] < 1.5 || row[MESH_LAT] < 46);
  assert.ok(
    rural.length > ruralByRank.length * 5,
    `spatial pick kept ${rural.length} rural, rank kept ${ruralByRank.length}`,
  );
});

test('the drawn level mix tracks the real one instead of inverting it', () => {
  // Representing a cell by its LARGEST member would make every rural cell a
  // lycée. The modal rule has to keep écoles dominant, because they are.
  const sites = franceLike();
  const { picked } = selectSchoolsMesh(sites, { box: FRANCE });
  const share = (rows, level) => rows.filter((row) => row[MESH_LEVEL] === level).length / rows.length;
  const trueEcole = share(sites, SCHOOL_LEVEL_INDEX.ecole);
  const drawnEcole = share(picked, SCHOOL_LEVEL_INDEX.ecole);
  assert.ok(drawnEcole > 0.5, `écoles collapsed to ${(drawnEcole * 100).toFixed(1)}%`);

  const byRank = sites.slice().sort((a, b) => b[MESH_PUPILS] - a[MESH_PUPILS]).slice(0, picked.length);
  assert.ok(
    Math.abs(drawnEcole - trueEcole) < Math.abs(share(byRank, SCHOOL_LEVEL_INDEX.ecole) - trueEcole),
    'the spatial pick should be closer to the true mix than a rank pick',
  );
});

test('a school with no published roll still holds its cell', () => {
  // 8.3% of teaching establishments have no roll and carry weight 0. A zero
  // weight must lose a tie-break, never remove a school from the map.
  const sites = [
    site(45.0, 3.0, 0, SCHOOL_LEVEL_INDEX.ecole),
    site(48.5, 2.5, 900, SCHOOL_LEVEL_INDEX.lycee),
  ];
  const { picked } = selectSchoolsMesh(sites, { box: FRANCE });
  assert.equal(picked.length, 2);
  assert.ok(picked.some((row) => row[MESH_PUPILS] === 0));
});

test('a cell of unrolled schools is represented, not skipped', () => {
  const sites = [];
  for (let i = 0; i < 40; i += 1) sites.push(site(44 + i * 0.01, 3 + i * 0.01, 0, SCHOOL_LEVEL_INDEX.ecole));
  const pick = selectSchoolsMesh(sites, { box: FRANCE });
  assert.ok(pick.picked.length > 0);
  assert.equal(pick.inBox, 40);
});

test('the pick reports what it dropped', () => {
  // A thinned map that does not say it is thinned claims France has 1 100
  // schools.
  const pick = selectSchoolsMesh(franceLike(), { box: FRANCE });
  assert.equal(pick.inBox, 3300);
  assert.ok(pick.thinned);
  assert.ok(pick.picked.length <= pick.budget);
  assert.ok(pick.picked.length < pick.inBox);
});

test('a view that fits under budget is NOT reported as thinned', () => {
  const pick = selectSchoolsMesh([site(48, 2, 100), site(49, 3, 200)], { box: FRANCE });
  assert.equal(pick.thinned, false);
  assert.equal(pick.picked.length, 2);
});

test('the budget rises as the view closes in, measured on LATITUDE', () => {
  assert.equal(schoolsMeshBudget(0.5), 2200);
  assert.equal(schoolsMeshBudget(2), 1600);
  assert.equal(schoolsMeshBudget(9.8), 1100);
  assert.equal(schoolsMeshBudget(Infinity), 1100);
  // Ascending tiers, last one unbounded — the contract `meshBudgetForSpan`
  // relies on.
  assert.equal(SCHOOLS_MESH_BUDGETS.at(-1).maxLatSpanDeg, Infinity);
});

test('the grid stays below every budget, or the pick silently becomes rank-based', () => {
  const cells = SCHOOLS_MESH_COLS * SCHOOLS_MESH_ROWS;
  for (const tier of SCHOOLS_MESH_BUDGETS) {
    assert.ok(cells < tier.budget, `${cells} cells is not below the ${tier.budget} budget`);
  }
});

test('schools outside the box are never picked', () => {
  const pick = selectSchoolsMesh(
    [site(48, 2, 100), site(10, 100, 5000)],
    { box: FRANCE },
  );
  assert.equal(pick.inBox, 1);
  assert.equal(pick.picked.length, 1);
  assert.equal(pick.picked[0][MESH_LAT], 48);
});

test('box membership counts the edges', () => {
  const box = { south: 40, west: 0, north: 50, east: 10 };
  assert.equal(meshSchoolInBox(site(40, 0), box), true);
  assert.equal(meshSchoolInBox(site(50, 10), box), true);
  assert.equal(meshSchoolInBox(site(39.9, 0), box), false);
  assert.equal(meshSchoolInBox(null, box), false);
  assert.equal(meshSchoolInBox(site(45, 5), null), false);
});

test('the mesh id is the coordinate key, so a selection survives the handover', () => {
  // It has to match `schoolSiteKey` in schoolsFeed.js, or a school picked in
  // the maillage is deselected the moment the exact regime takes over.
  assert.equal(meshSchoolId(site(48.123456, 2.987654)), '48.12346,2.98765');
});

test('every level index in the ladder round-trips through the tuple', () => {
  for (const level of SCHOOL_LEVELS) {
    const index = SCHOOL_LEVEL_INDEX[level];
    assert.equal(SCHOOL_LEVELS[index], level);
  }
});

test('an empty, missing or boxless input yields an empty pick, not a throw', () => {
  assert.deepEqual(selectSchoolsMesh([], { box: FRANCE }).picked, []);
  assert.deepEqual(selectSchoolsMesh(null, { box: FRANCE }).picked, []);
  assert.deepEqual(selectSchoolsMesh(franceLike(), {}).picked, []);
  assert.doesNotThrow(() => selectSchoolsMesh());
});

test('the pick is stable under a small pan, so dots do not churn', () => {
  const sites = franceLike();
  const a = selectSchoolsMesh(sites, { box: FRANCE });
  const b = selectSchoolsMesh(sites, {
    box: { ...FRANCE, west: FRANCE.west + 0.01, east: FRANCE.east + 0.01 },
  });
  const idsA = new Set(a.picked.map(meshSchoolId));
  const shared = b.picked.filter((row) => idsA.has(meshSchoolId(row))).length;
  assert.ok(shared / b.picked.length > 0.85, `only ${shared}/${b.picked.length} survived a 0.01° pan`);
});
