// src/data/flowRibbons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFlowTile } from './flowTiles.js';
import {
  RIBBON_BUCKETS,
  ribbonStyle,
  rankRibbonSegments,
  flattenRibbonCoords,
  buildRibbonInstances,
} from './flowRibbons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'tomtom-flow-austin-12-935-1686.pbf');
const fixtureSegments = () => decodeFlowTile(fs.readFileSync(FIXTURE), 12, 935, 1686);

const seg = (over = {}) => ({
  coords: [[0, 0], [0.001, 0.001]],
  trafficLevel: 1,
  roadType: 'Major local road',
  closure: false,
  ...over,
});

// ── Classification ──────────────────────────────────────────

test('ribbonStyle: level maps to the same buckets the dots use', () => {
  assert.equal(ribbonStyle(seg({ trafficLevel: 1 })).bucket, 'free');
  assert.equal(ribbonStyle(seg({ trafficLevel: 0.7 })).bucket, 'slow');
  assert.equal(ribbonStyle(seg({ trafficLevel: 0.2 })).bucket, 'jam');
});

test('ribbonStyle: a closure outranks its level (decoded as 0, not a jam)', () => {
  const style = ribbonStyle(seg({ trafficLevel: 0, closure: true }));
  assert.equal(style.bucket, 'closure');
  assert.ok(style.rank > ribbonStyle(seg({ trafficLevel: 0 })).rank);
});

test('ribbonStyle: TomTom road class scales the width, unknown classes keep it', () => {
  const motorway = ribbonStyle(seg({ trafficLevel: 0.2, roadType: 'Motorway' }));
  const local = ribbonStyle(seg({ trafficLevel: 0.2, roadType: 'Connecting road' }));
  const unknown = ribbonStyle(seg({ trafficLevel: 0.2, roadType: 'Cart track' }));
  assert.ok(motorway.width > local.width);
  assert.equal(unknown.width, RIBBON_BUCKETS.jam.width);
});

test('ribbonStyle: free flow is drawn thinner and fainter than a jam', () => {
  assert.ok(RIBBON_BUCKETS.free.width < RIBBON_BUCKETS.jam.width);
  assert.ok(RIBBON_BUCKETS.free.alpha < RIBBON_BUCKETS.jam.alpha);
});

// ── The cap must never hide a jam ───────────────────────────

test('rankRibbonSegments: under the cap nothing is reordered away', () => {
  const { kept, dropped } = rankRibbonSegments([seg(), seg(), seg()], 10);
  assert.equal(kept.length, 3);
  assert.equal(dropped, 0);
});

test('rankRibbonSegments: overflow drops free flow before jams and closures', () => {
  const input = [
    ...Array.from({ length: 20 }, () => seg({ trafficLevel: 1 })),
    seg({ trafficLevel: 0.2 }),
    seg({ trafficLevel: 0, closure: true }),
  ];
  const { kept, dropped } = rankRibbonSegments(input, 2);
  assert.equal(dropped, 20);
  assert.deepEqual(kept.map((k) => k.style.bucket), ['closure', 'jam']);
});

test('rankRibbonSegments: degenerate polylines are dropped, not counted', () => {
  const { kept } = rankRibbonSegments([seg({ coords: [[0, 0]] }), seg(), seg({ coords: null })], 10);
  assert.equal(kept.length, 1);
});

// ── Geometry ────────────────────────────────────────────────

test('flattenRibbonCoords: flattens to [lon, lat, …] and drops repeated vertices', () => {
  assert.deepEqual(
    flattenRibbonCoords([[1, 2], [1, 2], [3, 4]]),
    [1, 2, 3, 4],
  );
});

test('flattenRibbonCoords: a polyline that collapses to one point returns null', () => {
  assert.equal(flattenRibbonCoords([[1, 2], [1, 2]]), null);
  assert.equal(flattenRibbonCoords([[1, 2], ['x', null]]), null);
});

// ── The batch ───────────────────────────────────────────────

test('buildRibbonInstances: one instance per drawable segment, tallied by bucket', () => {
  const { instances, counts, dropped } = buildRibbonInstances([
    seg({ trafficLevel: 1 }),
    seg({ trafficLevel: 0.2 }),
    seg({ trafficLevel: 0, closure: true }),
  ]);
  assert.equal(instances.length, 3);
  assert.equal(dropped, 0);
  assert.deepEqual(counts, { closure: 1, jam: 1, slow: 0, free: 1 });
});

test('buildRibbonInstances: colorFor overrides a bucket, null keeps the shipped colour', () => {
  const { instances } = buildRibbonInstances([seg({ trafficLevel: 0.2 })], {
    colorFor: (bucket) => (bucket === 'jam' ? '#ffffff' : null),
  });
  const [r, g, b] = instances[0].attributes.color.value;
  assert.equal(r, 255);
  assert.equal(g, 255);
  assert.equal(b, 255);
});

test('buildRibbonInstances: the real Austin tile batches without throwing', () => {
  const segments = fixtureSegments();
  assert.ok(segments.length > 50);
  const { instances, counts } = buildRibbonInstances(segments);
  assert.ok(instances.length > 50);
  assert.equal(
    counts.free + counts.slow + counts.jam + counts.closure,
    instances.length,
    'every drawn instance must be counted exactly once',
  );
});

test('buildRibbonInstances: empty input builds nothing rather than throwing', () => {
  assert.deepEqual(buildRibbonInstances([]).instances, []);
  assert.deepEqual(buildRibbonInstances(null).instances, []);
});
