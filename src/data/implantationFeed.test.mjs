// src/data/implantationFeed.test.mjs
// The spatial join at the heart of the fiche: which 200 m squares are inside a
// reachable shape, and how wrong a single number for that would be.
//
// Built on SYNTHETIC rings rather than a captured isochrone, on purpose. The
// claim under test is arithmetic — a square is inside, outside, or across the
// edge — and a real ring makes every case an accident of geography rather than
// something a reader of the test can verify by looking at the numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL_POSITIONS,
  aggregateInRing,
  asRings,
  bracketWidthPercent,
  buildEdgeIndex,
  classifyCell,
  composeFiche,
  pointInPolygon,
  pointInRing,
  projectAddress,
  projectMarket,
  projectZoning,
  ringBounds,
  segmentsIntersect,
} from './implantationFeed.js';
import { cellCentre, cellCorners } from './filosofiFeed.js';

/** A square ring in degrees, centred on a point. */
function box(lon, lat, halfDeg) {
  return [
    [lon - halfDeg, lat - halfDeg],
    [lon + halfDeg, lat - halfDeg],
    [lon + halfDeg, lat + halfDeg],
    [lon - halfDeg, lat + halfDeg],
  ];
}

/**
 * A run of 200 m cells along one row of the EPSG:3035 grid, starting at a real
 * Lyon cell so the projection has something plausible to chew on.
 */
function cellRow(startE, n, howMany, per = {}) {
  return Array.from({ length: howMany }, (_, index) => ({
    n,
    e: startE + index * 200,
    ind: per.ind ?? 100,
    men: per.men ?? 40,
    niveau: per.niveau ?? 24_000,
    pauvrete: per.pauvrete ?? 12,
    jeunes: per.jeunes ?? 20,
    aines: per.aines ?? 15,
    social: per.social ?? 10,
    solo: per.solo ?? 45,
    proprietaires: per.proprietaires ?? 35,
    est: per.est ?? 0,
  }));
}

// ── Ray casting ─────────────────────────────────────────────────────────────

test('a point inside a square is inside, and one outside is not', () => {
  const ring = box(4.83, 45.76, 0.01);
  assert.equal(pointInRing(ring, 4.83, 45.76), true);
  assert.equal(pointInRing(ring, 4.85, 45.76), false);
  assert.equal(pointInRing(ring, 4.83, 45.80), false);
});

test('a point level with a vertex is counted once, not twice', () => {
  // The classic failure of a naive ray cast: a horizontal ray through a vertex
  // crosses two edges and the point flips back to "outside". The half-open
  // vertical test is what prevents it, and the symptom would be a plausible
  // wrong answer rather than a crash.
  const ring = [[0, 0], [2, 0], [2, 2], [1, 3], [0, 2]];
  assert.equal(pointInRing(ring, 1, 3 - 1e-9), true, 'just under the apex');
  assert.equal(pointInRing(ring, 1, 1), true, 'well inside');
  assert.equal(pointInRing(ring, 3, 3), false, 'clear of the shape');
  // A concave shape: the ray leaves and re-enters.
  const concave = [[0, 0], [4, 0], [4, 4], [2, 1], [0, 4]];
  assert.equal(pointInRing(concave, 2, 3), false, 'in the notch, so outside');
  assert.equal(pointInRing(concave, 0.5, 0.5), true);
});

test('a degenerate or malformed ring contains nothing rather than throwing', () => {
  assert.equal(pointInRing([], 1, 1), false);
  assert.equal(pointInRing([[0, 0], [1, 1]], 0.5, 0.5), false, 'two points are not a polygon');
  assert.equal(pointInRing(null, 1, 1), false);
  assert.equal(pointInRing(box(0, 0, 1), NaN, 0), false);
  // A vertex that is not a pair is skipped, and the rest of the ring still works.
  assert.equal(pointInRing([[0, 0], null, [2, 0], [2, 2], [0, 2]], 1, 1), true);
});

test('the bounding box is the ring, not its first vertex', () => {
  // Compared with a tolerance: 45.76 + 0.01 is 45.769999999999996 in binary
  // floating point, and pinning that literal would pin the arithmetic of the
  // test's own helper rather than the behaviour under test.
  const bounds = ringBounds(box(4.83, 45.76, 0.01));
  for (const [key, expected] of [['south', 45.75], ['west', 4.82], ['north', 45.77], ['east', 4.84]]) {
    assert.ok(Math.abs(bounds[key] - expected) < 1e-9, `${key} ${bounds[key]}`);
  }
  assert.equal(ringBounds([]), null);
  assert.equal(ringBounds(null), null);
  assert.equal(ringBounds([[NaN, NaN]]), null);
});

// ── Classifying a cell ──────────────────────────────────────────────────────

test('a cell wholly inside, wholly outside, and across the edge are three answers', () => {
  const cell = { n: 2_531_400, e: 3_918_600 };
  const [lon, lat] = cellCentre({ res: 200, n: cell.n, e: cell.e });
  // A ring far larger than the cell, centred on it.
  const big = classifyCell(cell, box(lon, lat, 0.02), 200);
  assert.equal(big.position, CELL_POSITIONS.inside);
  assert.equal(big.cornersInside, 4);
  // A ring nowhere near it.
  const away = classifyCell(cell, box(lon + 0.5, lat, 0.02), 200);
  assert.equal(away.position, CELL_POSITIONS.outside);
  assert.equal(away.cornersInside, 0);
  // A ring whose edge cuts the cell: shifted by half a cell (~0.0013° of lon).
  const edge = classifyCell(cell, box(lon + 0.0013, lat, 0.0013), 200);
  assert.equal(edge.position, CELL_POSITIONS.straddling);
  assert.ok(edge.cornersInside > 0 && edge.cornersInside < 4);
});

test('a ring narrower than a cell still counts as a straddle', () => {
  // Four corners outside does NOT mean the cell is outside: a ring smaller than
  // a square sits entirely within it, touching no corner and crossing no edge.
  // It is caught by the swallowed-ring test, not by any sampled point.
  const cell = { n: 2_531_400, e: 3_918_600 };
  const [lon, lat] = cellCentre({ res: 200, n: cell.n, e: cell.e });
  const tiny = classifyCell(cell, box(lon, lat, 0.0002), 200);
  assert.equal(tiny.cornersInside, 0, 'the ring is smaller than the cell');
  assert.equal(tiny.crossed, false, 'and it crosses no edge of it');
  assert.equal(tiny.centroidInside, true);
  assert.equal(tiny.position, CELL_POSITIONS.straddling);
});

// ── The case the five-point test could not see ───────────────────────────────

test('a corridor crossing a cell away from its centroid is a straddle, not an outsider', () => {
  // THE REGRESSION THIS FILE EXISTED WITHOUT. The old classifier sampled four
  // corners and the centroid; a band 28 m tall crossing the low third of a cell
  // covers none of the five, so the cell was declared OUTSIDE and the "upper
  // bound" lost it. The band below is exactly that: it spans the cell in
  // longitude and misses every sample point in latitude.
  const cell = { n: 2_500_000, e: 3_900_000 };
  const corners = cellCorners({ res: 200, n: cell.n, e: cell.e });
  const south = Math.min(...corners.map(([, lat]) => lat));
  const west = Math.min(...corners.map(([lon]) => lon)) - 0.01;
  const east = Math.max(...corners.map(([lon]) => lon)) + 0.01;
  const band = [
    [west, south + 0.0002], [east, south + 0.0002],
    [east, south + 0.00045], [west, south + 0.00045],
  ];

  const verdict = classifyCell(cell, band, 200);
  assert.equal(verdict.cornersInside, 0, 'no corner is inside the band');
  assert.equal(verdict.centroidInside, false, 'nor is the centroid');
  assert.equal(verdict.position, CELL_POSITIONS.straddling, 'and yet the band crosses the cell');

  const aggregate = aggregateInRing([{ ...cell, ind: 500, men: 200, est: 0 }], band, 200);
  assert.equal(aggregate.people.high, 500, 'an upper bound that can be zero is not a bound');
  assert.equal(aggregate.people.low, 0, 'and the lower bound stays honest');
  assert.equal(aggregate.people.count, 0, 'the centroid convention is unchanged');
});

test('two segments that meet are told apart from two that only look like they do', () => {
  assert.equal(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0]), true, 'a plain X');
  assert.equal(segmentsIntersect([0, 0], [1, 1], [2, 2], [3, 3]), false, 'collinear, disjoint');
  assert.equal(segmentsIntersect([0, 0], [2, 2], [1, 1], [3, 3]), true, 'collinear, overlapping');
  assert.equal(segmentsIntersect([0, 0], [2, 0], [1, 0], [1, 5]), true, 'a T touching counts');
  assert.equal(segmentsIntersect([0, 0], [2, 0], [3, -1], [3, 1]), false, 'crossing the LINE, not the segment');
});

test('the edge index answers the same question as brute force, only faster', () => {
  // A ring with enough vertices that banding actually partitions it, and a row
  // of cells walked across it. The index is an optimisation; if it ever
  // disagrees with the unindexed path the bracket silently changes.
  const [lon, lat] = cellCentre({ res: 200, n: 2_531_400, e: 3_918_600 + 5 * 200 });
  const ring = Array.from({ length: 64 }, (_, i) => {
    const angle = (i / 64) * Math.PI * 2;
    return [lon + Math.cos(angle) * 0.004, lat + Math.sin(angle) * 0.003];
  });
  const index = buildEdgeIndex(ring, 200 / 111_320);
  assert.ok(index.count > 1, 'the ring spans several bands');
  for (const cell of cellRow(3_918_600, 2_531_400, 12)) {
    assert.equal(
      classifyCell(cell, ring, 200, index).position,
      classifyCell(cell, ring, 200).position,
      `cell e=${cell.e}`,
    );
  }
});

test('a hole is ground the ring does not reach, and no cell over it is fully inside', () => {
  const cell = { n: 2_531_400, e: 3_918_600 };
  const [lon, lat] = cellCentre({ res: 200, n: cell.n, e: cell.e });
  const solid = box(lon, lat, 0.01);
  assert.equal(classifyCell(cell, solid, 200).position, CELL_POSITIONS.inside);

  // The same ring with a courtyard punched out of the middle of the cell.
  const withHole = [solid, box(lon, lat, 0.0003)];
  assert.equal(asRings(withHole).length, 2);
  assert.equal(pointInPolygon(withHole, lon, lat), false, 'the centre is in the hole');
  assert.equal(
    classifyCell(cell, withHole, 200).position,
    CELL_POSITIONS.straddling,
    'a square with a hole in it is not a square fully inside',
  );

  const aggregate = aggregateInRing([{ ...cell, ind: 300, men: 120, est: 0 }], withHole, 200);
  assert.equal(aggregate.people.low, 0, 'so it cannot count towards the floor');
  assert.equal(aggregate.people.high, 300, 'but it is still touched');
  assert.equal(aggregate.people.count, 0, 'and its centroid is over the hole');
});

// ── The bracket ─────────────────────────────────────────────────────────────

test('the aggregate reports three countable figures, not one', () => {
  const row = cellRow(3_918_600, 2_531_400, 9, { ind: 100, men: 40 });
  const [lon, lat] = cellCentre({ res: 200, n: 2_531_400, e: 3_918_600 + 4 * 200 });
  // A ring covering roughly the middle five cells of the row.
  const ring = box(lon, lat, 0.0035);
  const result = aggregateInRing(row, ring, 200);
  assert.ok(result, 'a populated row inside a ring must aggregate');
  assert.ok(result.people.low <= result.people.count, 'the low bound is a lower bound');
  assert.ok(result.people.count <= result.people.high, 'the high bound is an upper bound');
  assert.ok(result.people.high > result.people.low, 'a real ring has an edge');
  assert.equal(result.people.count % 100, 0, 'cells are counted whole, never scaled');
  assert.equal(result.cells.counted * 100, result.people.count);
  assert.ok(result.cells.straddling > 0);
});

test('a ring that swallows every cell has no bracket at all', () => {
  const row = cellRow(3_918_600, 2_531_400, 5);
  const [lon, lat] = cellCentre({ res: 200, n: 2_531_400, e: 3_918_600 + 2 * 200 });
  const result = aggregateInRing(row, box(lon, lat, 0.05), 200);
  assert.equal(result.cells.straddling, 0);
  assert.equal(result.people.low, result.people.count);
  assert.equal(result.people.count, result.people.high);
  assert.equal(result.people.count, 500);
  assert.equal(bracketWidthPercent(result.people), 0, 'no edge means no uncertainty');
});

test('a ring nowhere near the cells aggregates to nothing rather than to null', () => {
  const row = cellRow(3_918_600, 2_531_400, 5);
  const result = aggregateInRing(row, box(0, 0, 0.01), 200);
  assert.equal(result.people.count, 0);
  assert.equal(result.cells.counted, 0);
  assert.equal(result.niveau, null);
  assert.equal(result.imputedShare, null);
});

test('nothing to join answers null, which is a different thing from zero', () => {
  assert.equal(aggregateInRing([], box(0, 0, 1), 200), null);
  assert.equal(aggregateInRing(null, box(0, 0, 1), 200), null);
  assert.equal(aggregateInRing(cellRow(3_918_600, 2_531_400, 3), [], 200), null);
});

test('the bracket width is a share of the headline, and refuses an empty headline', () => {
  assert.equal(bracketWidthPercent({ low: 900, count: 1000, high: 1200 }), 30);
  assert.equal(bracketWidthPercent({ low: 0, count: 0, high: 0 }), null);
  assert.equal(bracketWidthPercent(null), null);
});

test('the indicators are population-weighted over the counted set', () => {
  const rich = cellRow(3_918_600, 2_531_400, 1, { ind: 10, niveau: 60_000, men: 4 });
  const poor = cellRow(3_918_800, 2_531_400, 1, { ind: 1000, niveau: 15_000, men: 400 });
  const [lon, lat] = cellCentre({ res: 200, n: 2_531_400, e: 3_918_700 });
  const result = aggregateInRing([...rich, ...poor], box(lon, lat, 0.05), 200);
  // The unweighted mean would be 37 500 €. Nobody lives in a square.
  assert.ok(result.niveau < 16_000, `weighted mean should be near the poor cell, got ${result.niveau}`);
  assert.ok(result.niveau > 15_000);
});

test('an imputed cell is counted and reported, never quietly dropped', () => {
  const observed = cellRow(3_918_600, 2_531_400, 3, { ind: 100 });
  const imputed = cellRow(3_919_200, 2_531_400, 1, { ind: 100, est: 1 });
  const [lon, lat] = cellCentre({ res: 200, n: 2_531_400, e: 3_918_900 });
  const result = aggregateInRing([...observed, ...imputed], box(lon, lat, 0.05), 200);
  assert.equal(result.people.count, 400, 'an imputed cell still has people in it');
  assert.equal(result.imputedCells, 1);
  assert.equal(result.imputedShare, 25);
});

test('a cell is never scaled by the fraction of it inside the ring', () => {
  // Areal interpolation would give a tidier number by assuming people are
  // spread evenly inside a square. INSEE's own imputation flag exists because
  // they are not, so every total here is a sum of whole cells.
  const row = cellRow(3_918_600, 2_531_400, 6, { ind: 137 });
  const [lon, lat] = cellCentre({ res: 200, n: 2_531_400, e: 3_918_600 + 3 * 200 });
  const result = aggregateInRing(row, box(lon, lat, 0.003), 200);
  for (const total of [result.people.low, result.people.count, result.people.high]) {
    assert.equal(total % 137, 0, `${total} is not a whole number of cells`);
  }
});

// ── The other halves ────────────────────────────────────────────────────────

test('the address is folded to one line, and an absent one is not invented', () => {
  const projected = projectAddress({
    properties: {
      label: '20 Place Bellecour 69002 Lyon', city: 'Lyon', citycode: '69382',
      postcode: '69002', distance: 12.4,
    },
  });
  assert.equal(projected.label, '20 Place Bellecour 69002 Lyon');
  assert.equal(projected.insee, '69382');
  assert.equal(projected.distanceM, 12);
  const empty = projectAddress(null);
  assert.equal(empty.label, null);
  assert.equal(empty.distanceM, null);
});

test('the zoning line names only the zone the point is actually in', () => {
  const gpu = {
    zones: [
      { code: 'UB', label: 'zone urbaine', atPoint: false },
      { code: 'UA', label: 'centre-ville', kind: 'u', approvedOn: '2019-03-12', atPoint: true },
    ],
    servitudes: [{ label: 'AC1 monument historique' }, { label: 'AC1 monument historique' }],
  };
  const zoning = projectZoning(gpu);
  // The nearest zone is not the answer; a reader has no way to tell the
  // difference between "your plot" and "the plot next door".
  assert.equal(zoning.code, 'UA');
  assert.equal(zoning.overlapping, 1);
  assert.equal(zoning.servitudes, 2);
  assert.deepEqual(zoning.servitudeLabels, ['AC1 monument historique'], 'labels are de-duplicated');
  assert.equal(projectZoning(null), null);
});

test('two overlapping zonings are reported as two, not resolved by picking one', () => {
  const zoning = projectZoning({
    zones: [
      { code: 'UA', atPoint: true }, { code: 'AU', atPoint: true },
    ],
    servitudes: [],
  });
  assert.equal(zoning.overlapping, 2);
});

test('the market line keeps the comparable count beside the median', () => {
  const market = projectMarket({
    summary: { count: 47, comparableCount: 31, medianPrixM2: 4200, p25PrixM2: 3600, p75PrixM2: 5100 },
    years: '2020-2024',
    commune: { name: 'Lyon 2e' },
  });
  // The gap between 47 and 31 is what makes the median honest: a €/m² is only
  // a comparable when the sale bought exactly one dwelling.
  assert.equal(market.sales, 47);
  assert.equal(market.comparable, 31);
  assert.equal(market.medianPrixM2, 4200);
  assert.equal(projectMarket(null), null);
});

test('a fiche with missing halves still composes, and names what is missing', () => {
  const fiche = composeFiche({
    point: { lat: 45.76, lon: 4.83 },
    isochrone: null,
    demand: null,
    missing: ['isochrone', 'carroyage'],
  });
  assert.deepEqual(fiche.missing, ['isochrone', 'carroyage']);
  assert.equal(fiche.zoning, null);
  assert.equal(fiche.address.label, null, 'an absent address is an empty shape, not undefined');
});
