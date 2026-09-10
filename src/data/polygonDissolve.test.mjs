// src/data/polygonDissolve.test.mjs
// Covers the topological dissolve the éCO2mix layer stands on: the segment
// tally that cancels interior boundaries, the ring walk that stitches what is
// left, and the two shape operations the dissolved outline is then put
// through. The claim the whole thing rests on — that the bundled département
// file is a clean planar subdivision — is checked here against the real file,
// not asserted in a comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dissolveRings,
  flattenRing,
  geometryRings,
  nearestRingVertex,
  ringArea,
  ringCentroid,
  scaleRing,
} from './polygonDissolve.js';
import { REGION_DEPARTEMENTS } from './franceEnergy.js';

const BUNDLED = JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
));
const BY_CODE = new Map(BUNDLED.features.map((f) => [f.properties.code, f]));

/** Every ring of every département of one région, ungrouped. */
function regionRings(code) {
  const rings = [];
  for (const departement of REGION_DEPARTEMENTS[code]) {
    rings.push(...geometryRings(BY_CODE.get(departement).geometry));
  }
  return rings;
}

// ── The dissolve itself ─────────────────────────────────────────────────────

test('two squares sharing an edge dissolve into one ring, and the seam is gone', () => {
  const left = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const right = [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]];
  const merged = dissolveRings([left, right]);
  assert.equal(merged.length, 1);
  // The shared edge x=1 contributed two vertices to each input and none to the
  // output: a dissolve that keeps them would draw the seam this module exists
  // to remove.
  assert.equal(Math.abs(ringArea(merged[0])), 2);
  const interior = merged[0].filter(([x, y]) => x === 1 && y > 0 && y < 1);
  assert.deepEqual(interior, []);
});

test('two squares that do NOT touch stay two rings', () => {
  const a = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const b = [[5, 5], [6, 5], [6, 6], [5, 6], [5, 6], [5, 5]];
  const merged = dissolveRings([a, b]);
  assert.equal(merged.length, 2);
});

test('rings come back largest first, so [0] is the mainland', () => {
  const big = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const small = [[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]];
  const merged = dissolveRings([small, big]);
  assert.ok(Math.abs(ringArea(merged[0])) > Math.abs(ringArea(merged[1])));
  assert.equal(Math.abs(ringArea(merged[0])), 16);
});

test('a doubled coastline cancels itself rather than crossing the ring', () => {
  // The pathological input the modulo exists for: the same ring handed in
  // twice. Every segment is then used an EVEN number of times, so nothing
  // survives — which is the honest answer, and infinitely better than a walk
  // through duplicated edges.
  const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  assert.deepEqual(dissolveRings([square, square]), []);
});

test('malformed input is dropped, not thrown on', () => {
  assert.deepEqual(dissolveRings(null), []);
  assert.deepEqual(dissolveRings([[[0, 0]], [], null]), []);
  assert.deepEqual(dissolveRings([[[0, 0], [Number.NaN, 1], [1, 1], [0, 0]]]).length, 0);
});

// ── The premise, checked against the real file ──────────────────────────────

test('the bundled départements are a clean planar subdivision', () => {
  // The whole approach is only valid because every internal segment appears
  // exactly twice. If a future refresh of the file breaks that, this test says
  // so before a région comes back as a self-crossing outline.
  let overused = 0;
  for (const code of Object.keys(REGION_DEPARTEMENTS)) {
    const tally = new Map();
    for (const ring of regionRings(code)) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        const a = `${ring[i][0]},${ring[i][1]}`;
        const b = `${ring[i + 1][0]},${ring[i + 1][1]}`;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        tally.set(key, (tally.get(key) || 0) + 1);
      }
    }
    for (const count of tally.values()) if (count > 2) overused += 1;
  }
  assert.equal(overused, 0);
});

test('every région dissolves to ONE mainland body, islands aside', () => {
  // Measured on the bundled file: the largest ring of each région holds at
  // least 99 % of its area, and everything else is an island. That is the fact
  // that lets the layer draw one prism per région.
  for (const code of Object.keys(REGION_DEPARTEMENTS)) {
    const merged = dissolveRings(regionRings(code));
    assert.ok(merged.length >= 1, `région ${code} dissolved to nothing`);
    const total = merged.reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
    const share = Math.abs(ringArea(merged[0])) / total;
    assert.ok(share > 0.99, `région ${code}: mainland is only ${(share * 100).toFixed(1)}%`);
  }
});

test('the dissolve loses no perimeter — the outline stays closed', () => {
  for (const code of Object.keys(REGION_DEPARTEMENTS)) {
    for (const ring of dissolveRings(regionRings(code))) {
      assert.ok(ring.length >= 4);
      assert.deepEqual(ring[0], ring[ring.length - 1]);
    }
  }
});

test('the same input dissolves to the same rings every time', () => {
  const once = dissolveRings(regionRings('11'));
  const twice = dissolveRings(regionRings('11'));
  assert.deepEqual(once, twice);
});

// ── Centroid, scale, nearest ────────────────────────────────────────────────

test('the centroid is the centre of AREA, not the mean of the vertices', () => {
  // A square whose right edge carries ten extra collinear vertices. The vertex
  // mean is dragged right; the area centroid is not, and a prism shrunk toward
  // the wrong one slides off its own région.
  const ring = [[0, 0], [1, 0]];
  for (let i = 1; i < 10; i += 1) ring.push([1, i / 10]);
  ring.push([1, 1], [0, 1], [0, 0]);
  const centroid = ringCentroid(ring);
  assert.ok(Math.abs(centroid[0] - 0.5) < 1e-9, `lon ${centroid[0]}`);
  assert.ok(Math.abs(centroid[1] - 0.5) < 1e-9, `lat ${centroid[1]}`);
});

test('a degenerate ring still answers with a point', () => {
  assert.deepEqual(ringCentroid([[2, 3], [2, 3], [2, 3], [2, 3]]), [2, 3]);
  assert.equal(ringCentroid([[0, 0]]), null);
});

test('scaling shrinks the area by the square of the factor and keeps the shape', () => {
  const ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const shrunk = scaleRing(ring, 0.9);
  assert.ok(Math.abs(Math.abs(ringArea(shrunk)) - 4 * 0.81) < 1e-9);
  assert.deepEqual(ringCentroid(shrunk).map((v) => Math.round(v * 1e9) / 1e9), [1, 1]);
  assert.equal(shrunk.length, ring.length);
});

test('a uniform scale cannot self-intersect a concave shape', () => {
  // The reason this is a scale and not an inward buffer. An L with a 0.2-wide
  // arm: a 0.2 m buffer would collapse the arm and cross the ring; a scale
  // narrows it proportionally and stays a simple polygon.
  const ell = [[0, 0], [1, 0], [1, 0.2], [0.2, 0.2], [0.2, 1], [0, 1], [0, 0]];
  const shrunk = scaleRing(ell, 0.5);
  assert.equal(shrunk.length, ell.length);
  assert.ok(Math.abs(ringArea(shrunk) / ringArea(ell) - 0.25) < 1e-9);
});

test('scaling by 1 is a copy, and a broken ring survives it', () => {
  const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
  assert.deepEqual(scaleRing(ring, 1), ring);
  assert.notEqual(scaleRing(ring, 1), ring);
  assert.deepEqual(scaleRing([[0, 0]], 0.5), [[0, 0]]);
});

test('the nearest vertex is measured on the sphere, not on the graticule', () => {
  // At 46° north a degree of longitude is 77 km and a degree of latitude 111.
  // A candidate 1° east is therefore CLOSER than one 1° north, and a naive
  // lon/lat Pythagoras would call them equal.
  const rings = [[[1, 46], [0, 47], [1, 46]]];
  assert.deepEqual(nearestRingVertex(rings, [0, 46]), [1, 46]);
  assert.equal(nearestRingVertex(rings, [Number.NaN, 46]), null);
  assert.equal(nearestRingVertex([], [0, 0]), null);
});

test('the nearest French vertex to a neighbour lands on the right frontier', () => {
  const mainland = [];
  for (const [code, departements] of Object.entries(REGION_DEPARTEMENTS)) {
    if (code === '94') continue;
    for (const departement of departements) {
      mainland.push(...geometryRings(BY_CODE.get(departement).geometry));
    }
  }
  // Madrid → the Pyrénées, not the Channel. Rome → the Alpes-Maritimes, not
  // Corsica, which is why the Corsican départements are left out above.
  const spain = nearestRingVertex(mainland, [-3.70, 40.42]);
  assert.ok(spain[1] < 44 && spain[0] < 1, `Espagne → ${spain}`);
  const italy = nearestRingVertex(mainland, [12.50, 42.80]);
  assert.ok(italy[0] > 6.5 && italy[1] < 45, `Italie → ${italy}`);
  const england = nearestRingVertex(mainland, [-1.55, 52.60]);
  assert.ok(england[1] > 49.5, `Angleterre → ${england}`);
});

// ── Geometry plumbing ───────────────────────────────────────────────────────

test('geometryRings flattens a MultiPolygon and refuses anything else', () => {
  assert.equal(geometryRings({ type: 'Polygon', coordinates: [[1], [2]] }).length, 2);
  assert.equal(geometryRings({
    type: 'MultiPolygon',
    coordinates: [[[1], [2]], [[3]]],
  }).length, 3);
  assert.deepEqual(geometryRings({ type: 'Point', coordinates: [0, 0] }), []);
  assert.deepEqual(geometryRings(null), []);
});

test('flattenRing produces the pair list Cesium wants, and drops holes in it', () => {
  assert.deepEqual(flattenRing([[1, 2], [3, 4]]), [1, 2, 3, 4]);
  assert.deepEqual(flattenRing([[1, 2], [Number.NaN, 4], [5, 6]]), [1, 2, 5, 6]);
  assert.deepEqual(flattenRing(null), []);
});
