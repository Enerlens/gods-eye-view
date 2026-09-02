// src/data/groundPick.test.mjs
//
// Extracted from `cadastreParcels.js`, where it was the answer to "clicking one
// parcel lit up a shape somewhere else": ground-classification geometry is
// picked by whichever shadow volume the ray enters first, so a layer that
// already holds its polygons has to resolve the coordinate itself. Now two
// layers depend on the order these sources are tried, and the order is the
// whole of the correctness — each fallback is a WORSE answer than the one
// before it, and each is silently plausible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { sceneGroundPoint } from './groundPick.js';

/** Avenue de France, Paris 13e, at the height the globe draws it. */
const ADDRESS = { lon: 2.3760, lat: 48.8300 };
const TERRAIN = Cesium.Cartesian3.fromDegrees(ADDRESS.lon, ADDRESS.lat, 82.4);
/** 300 m east — a different answer, so a test can say which source spoke. */
const DEPTH = Cesium.Cartesian3.fromDegrees(ADDRESS.lon + 0.004, ADDRESS.lat, 30);
/** 300 m south, on the bare ellipsoid, which is where relief is ignored. */
const ELLIPSOID = Cesium.Cartesian3.fromDegrees(ADDRESS.lon, ADDRESS.lat - 0.004, 0);

function viewer({
  globeShow = true, terrain = TERRAIN, depth = DEPTH, ellipsoid = ELLIPSOID,
  pickPositionSupported = true,
} = {}) {
  const asked = [];
  return {
    asked,
    scene: {
      pickPositionSupported,
      globe: globeShow === null ? null : {
        show: globeShow,
        ellipsoid: Cesium.Ellipsoid.WGS84,
        pick() { asked.push('terrain'); return terrain; },
      },
      pickPosition() { asked.push('depth'); return depth; },
      camera: {
        getPickRay: () => ({}),
        pickEllipsoid() { asked.push('ellipsoid'); return ellipsoid; },
      },
    },
  };
}

const near = (point, expected, metres = 5) => {
  assert.ok(point, 'a point was resolved at all');
  const dLon = Math.abs(point.lon - expected.lon) * 111_320 * Math.cos(expected.lat * Math.PI / 180);
  const dLat = Math.abs(point.lat - expected.lat) * 110_540;
  assert.ok(Math.hypot(dLon, dLat) < metres,
    `${point.lon},${point.lat} is not ${expected.lon},${expected.lat}`);
};

test('the rendered terrain answers first, because it is the surface shapes are draped on', () => {
  const target = viewer();
  near(sceneGroundPoint(target, { x: 10, y: 10 }), ADDRESS);
  assert.deepEqual(target.asked, ['terrain'], 'nothing else was even asked');
});

test('a hidden globe leaves the depth buffer, which is the photoreal stack', () => {
  const target = viewer({ globeShow: false });
  near(sceneGroundPoint(target, { x: 10, y: 10 }), { lon: ADDRESS.lon + 0.004, lat: ADDRESS.lat });
  assert.deepEqual(target.asked, ['depth']);
});

test('no terrain resident under the pixel falls through, it does not fail', () => {
  const target = viewer({ terrain: null });
  near(sceneGroundPoint(target, { x: 10, y: 10 }), { lon: ADDRESS.lon + 0.004, lat: ADDRESS.lat });
  assert.deepEqual(target.asked, ['terrain', 'depth']);
});

test('the bare ellipsoid is the floor, and it is reached last', () => {
  const target = viewer({ terrain: null, depth: null });
  near(sceneGroundPoint(target, { x: 10, y: 10 }), { lon: ADDRESS.lon, lat: ADDRESS.lat - 0.004 });
  assert.deepEqual(target.asked, ['terrain', 'depth', 'ellipsoid']);
});

test('a depth read over empty sky is a MISS, not a place', () => {
  // `pickPosition` reads the depth buffer, and where the ray meets nothing
  // renderable it hands back a finite Cartesian that converts WITHOUT
  // complaint into somewhere underground — reverse-geocoding as 0°, 0°.
  const target = viewer({ terrain: null, depth: new Cesium.Cartesian3(500, 0, 0) });
  near(sceneGroundPoint(target, { x: 10, y: 10 }), { lon: ADDRESS.lon, lat: ADDRESS.lat - 0.004 });
  assert.deepEqual(target.asked, ['terrain', 'depth', 'ellipsoid'],
    'the degenerate read was rejected and the ellipsoid answered instead');
});

test('a throwing source is a source that did not answer', () => {
  const target = viewer();
  target.scene.globe.pick = () => { throw new Error('no tile'); };
  target.scene.pickPosition = () => { throw new Error('no depth texture'); };
  near(sceneGroundPoint(target, { x: 10, y: 10 }), { lon: ADDRESS.lon, lat: ADDRESS.lat - 0.004 });
});

test('a click with no scene under it resolves to nothing at all', () => {
  assert.equal(sceneGroundPoint(null, { x: 1, y: 1 }), null);
  assert.equal(sceneGroundPoint(viewer(), null), null);
  const blind = viewer({ terrain: null, depth: null, ellipsoid: null });
  assert.equal(sceneGroundPoint(blind, { x: 1, y: 1 }), null);
});
