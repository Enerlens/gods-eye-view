// src/data/ringGeometry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pointInPolygons,
  pointInRing,
  polygonsBounds,
  ringLabelAnchor,
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
