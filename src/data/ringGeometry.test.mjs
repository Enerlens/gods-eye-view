// src/data/ringGeometry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pointInPolygons,
  pointInRing,
  polygonsBounds,
  ringAreaM2,
  ringLabelAnchor,
  sanitisePolygonParts,
} from './ringGeometry.js';
import { projectZones } from './gpuFeed.js';

const ENCLAVES = JSON.parse(readFileSync(
  new URL('./fixtures/gpu-zone-urba-enclaves-sample.json', import.meta.url), 'utf8',
));

/** A square with a square hole punched out of its middle. */
const DONUT = [
  [[0, 0], [10, 0], [10, 10], [0, 10]],
  [[4, 4], [6, 4], [6, 6], [4, 6]],
];

test('a hole is not part of the shape it is punched out of', () => {
  assert.equal(pointInPolygons([DONUT], 1, 1), true);
  assert.equal(pointInPolygons([DONUT], 5, 5), false, 'the middle is the hole');
  assert.equal(pointInPolygons([DONUT], 20, 5), false, 'and outside is outside');
  assert.equal(pointInPolygons([DONUT], NaN, 5), false);
  assert.equal(pointInPolygons(null, 1, 1), false);
});

test('a ring under a triangle contains nothing', () => {
  assert.equal(pointInRing(1, 1, [[0, 0], [2, 0]]), false);
  assert.equal(pointInRing(1, 1, null), false);
});

test('bounds are taken from the outer rings, not the holes', () => {
  assert.deepEqual(polygonsBounds([DONUT]), {
    south: 0, west: 0, north: 10, east: 10,
  });
  assert.equal(polygonsBounds([]), null);
});

test('a label anchor lands inside the shape, and outside its holes', () => {
  const anchor = ringLabelAnchor(DONUT);
  assert.ok(anchor);
  assert.equal(pointInPolygons([DONUT], anchor.lon, anchor.lat), true);
});

test('the anchor is not the centroid, because the centroid can be outside', () => {
  // A `C`: the shape a PLU zone takes when it wraps a hamlet it does not
  // include. Its centroid is in the gap, which is precisely the ground the
  // rule does NOT cover — a label there would be a lie about the one thing
  // this layer must never be wrong about.
  const c = [[
    [0, 0], [10, 0], [10, 3], [3, 3], [3, 7], [10, 7], [10, 10], [0, 10],
  ]];
  const centroid = c[0].reduce((sum, [lon, lat]) => ({
    lon: sum.lon + lon / c[0].length, lat: sum.lat + lat / c[0].length,
  }), { lon: 0, lat: 0 });
  assert.equal(pointInRing(centroid.lon, centroid.lat, c[0]), false,
    'the centroid of this shape really is outside it');
  const anchor = ringLabelAnchor(c);
  assert.ok(anchor);
  assert.equal(pointInPolygons([c], anchor.lon, anchor.lat), true);
});

test('the anchor sits in the widest part it can find, where text has room', () => {
  // A dumbbell: two wide ends joined by a thin waist. A label on the waist
  // would overflow its own zone on both sides.
  const dumbbell = [[
    [0, 0], [4, 0], [4, 4.6], [6, 4.6], [6, 0], [10, 0],
    [10, 10], [6, 10], [6, 5.4], [4, 5.4], [4, 10], [0, 10],
  ]];
  const anchor = ringLabelAnchor(dumbbell);
  assert.ok(anchor.widthDeg >= 9, `the widest chord is the full span, got ${anchor.widthDeg}`);
});

test('a sliver gets no anchor rather than a guessed one', () => {
  assert.equal(ringLabelAnchor([[[0, 0], [1, 0]]]), null, 'two points are not a shape');
  assert.equal(ringLabelAnchor(null), null);
  // A ring with no latitude span has no scanline to cross.
  assert.equal(ringLabelAnchor([[[0, 5], [1, 5], [2, 5]]]), null);
});

test('the anchor is stable across calls, so a redraw does not move the label', () => {
  const a = ringLabelAnchor(DONUT);
  const b = ringLabelAnchor(DONUT.map((ring) => [...ring]));
  assert.deepEqual(a, b);
});

test('every zone of a real published answer gets a usable anchor', () => {
  for (const zone of projectZones(ENCLAVES)) {
    assert.ok(zone.anchor, `${zone.code} must be labellable`);
    assert.equal(pointInPolygons(zone.parts, zone.anchor.lon, zone.anchor.lat), true,
      `${zone.code}'s label must stand on its own colour`);
  }
});

// ── The published polygon is not a valid one ───────────────────────────────
// Bordeaux Métropole's permit file ships its emprises out of Oracle Spatial
// with the validator's verdict attached, and `sanitisePolygonParts` is what
// stands between that and a renderer. Every case below is one this repo
// measured on the real file rather than one it imagined.

const BORDEAUX = JSON.parse(readFileSync(
  new URL('./fixtures/ads-portals-sample.json', import.meta.url), 'utf8',
)).bordeaux;

/** One row's raw MultiPolygon coordinates, as the portal publishes them. */
const rawParts = (ident) => BORDEAUX.find((row) => row.ident === ident)
  ?.geo_shape?.geometry?.coordinates;

test('a ring encloses the area it should, and a degenerate one encloses none', () => {
  // 0.001° square at the equator: 111.19 m a side on the authalic sphere, so
  // 12 364 m². The equatorial radius would say 12 392, which is the 0.22% the
  // constant's comment is about.
  const square = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]];
  assert.equal(Math.round(ringAreaM2(square)), 12364);
  // Closing the ring must not double-count the last edge.
  assert.equal(Math.round(ringAreaM2([...square, [0, 0]])), 12364);
  assert.equal(ringAreaM2([[0, 0], [1, 1]]), 0, 'two points bound nothing');
  assert.equal(ringAreaM2(null), 0);
  // NOT a collinearity test, and the guard rail against reading it as one: a
  // lon/lat straight line is not a geodesic, so three points on one still
  // bound a real area on the sphere. Huge at degree scale, and two millionths
  // of a square metre at the scale a parcel is measured at.
  assert.ok(ringAreaM2([[0, 0], [1, 1], [2, 2]]) > 1e6);
  assert.ok(ringAreaM2([[0, 0], [0.001, 0.001], [0.002, 0.002]]) < 1e-5);
});

test('every published ring arrives closed and leaves open', () => {
  // All 137 916 rings in that file are closed; the renderers here close their
  // own, so a ring left closed draws its final edge twice.
  for (const row of BORDEAUX) {
    const parts = row.geo_shape?.geometry?.coordinates;
    if (!parts) continue;
    for (const rings of parts) {
      for (const ring of rings) {
        assert.deepEqual(ring[0], ring[ring.length - 1], 'fixture ring is closed');
      }
    }
    for (const rings of sanitisePolygonParts(parts)) {
      for (const ring of rings) {
        assert.notDeepEqual(ring[0], ring[ring.length - 1], 'cleaned ring is open');
      }
    }
  }
});

test('a vertex written twice in a row is one vertex', () => {
  // `ORA-13356`. 45 rings in 134 413 rows do this; this is one of them, with
  // four of its fourteen vertices repeated.
  const parts = rawParts('PC 033 119 22 Z1055');
  assert.ok(parts, 'fixture must carry the redundant-vertex row');
  const before = parts[0][0];
  const after = sanitisePolygonParts(parts)[0][0];
  assert.equal(before.length, 14);
  assert.equal(after.length, 9);
  for (let i = 1; i < after.length; i += 1) {
    assert.notDeepEqual(after[i], after[i - 1], 'no zero-length segment survives');
  }
  // The shape is unchanged, which is the whole point: this removes writing,
  // not geometry.
  assert.equal(Math.round(ringAreaM2(before)), Math.round(ringAreaM2(after)));
});

test('a small ring inside the parcel is kept, because small is not wrong', () => {
  // 11 cm² inside a 623 m² plot, flagged `ORA-13349` by the publisher. It is
  // genuinely inside, so it is drawn as published: no rule here discards a
  // shape for being small, and a size threshold that removed this one would
  // also have removed the 787, 754 and 249 m² courtyards measured in the same
  // file — none of which the publisher flagged at all.
  const parts = rawParts('DP 033 281 24 Z0785');
  assert.equal(parts[0].length, 2, 'fixture row has an inner ring');
  const clean = sanitisePolygonParts(parts);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].length, 2, 'the inner ring survives');
  assert.ok(ringAreaM2(clean[0][1]) > 0);
  assert.ok(ringAreaM2(clean[0][1]) < 1);
});

test('a part whose outer ring collapses is dropped whole, holes and all', () => {
  // A hole without the land around it is a different shape, not a smaller one.
  // The outer ring here is one point written four times, which is what a
  // collapsed emprise looks like before `distinctVertices` reduces it.
  const collapsed = [
    [
      [[3, 44], [3, 44], [3, 44], [3, 44]],
      [[3.0004, 44.0004], [3.0006, 44.0004], [3.0006, 44.0006], [3.0004, 44.0006]],
    ],
    [[[3, 44], [3, 44.001], [3.001, 44.001], [3.001, 44]]],
  ];
  const clean = sanitisePolygonParts(collapsed);
  assert.equal(clean.length, 1, 'only the part that encloses ground survives');
  assert.equal(clean[0].length, 1, 'and its hole went with it');
  assert.deepEqual(sanitisePolygonParts([]), []);
  assert.deepEqual(sanitisePolygonParts(null), []);
});
