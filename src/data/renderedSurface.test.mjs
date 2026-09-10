// src/data/renderedSurface.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  SURFACE_MAX_CAMERA_HEIGHT_M,
  SURFACE_SAMPLE_BUDGET,
  _forgetSurfaceMeasurements,
  photorealSurface,
  renderedSurfaceM,
  seatEntitiesOnSurface,
  seatPointsOnSurface,
  surfaceSamplingArmed,
} from './renderedSurface.js';

/** Cardinal Lemoine. */
const STOP = { lon: 2.35192, lat: 48.84688 };
/** What `scene.sampleHeight` reads on the Google mesh there. Measured. */
const MESH_M = 90.5;
/** What the globe's own terrain reads there. */
const TERRAIN_M = 82.4;

/**
 * The globe stack: a visible globe with resident terrain.
 *
 * `height` carries NO default — `globeScene(undefined)` has to mean "the globe
 * has no tile here", which is the case half these assertions are about, and a
 * default would silently turn it into the opposite.
 */
function globeScene(height, calls = { n: 0 }) {
  return {
    calls,
    globe: { show: true, getHeight() { calls.n += 1; return height; } },
  };
}

/**
 * The photoreal stack, as the app actually presents it: the globe is HIDDEN and
 * therefore answers `undefined` for every point, and the tileset is the surface.
 */
function photorealScene({
  height = MESH_M, tilesLoaded = true, cameraM = 420, calls = { n: 0 },
} = {}) {
  // `Cesium3DTileset.tilesLoaded` is a getter on the prototype, so the fake
  // has to define its own property rather than assign over it — and it has to
  // BE a Cesium3DTileset, because the readiness probe uses `instanceof` to tell
  // the photoreal tileset from the other primitives in the scene.
  const tileset = Object.create(Cesium.Cesium3DTileset.prototype, {
    show: { value: true },
    tilesLoaded: { value: tilesLoaded },
  });
  return {
    calls,
    sampleHeightSupported: true,
    globe: { show: false, getHeight() { return undefined; } },
    camera: { positionCartographic: { height: cameraM } },
    primitives: { length: 1, get: () => tileset },
    sampleHeight() {
      calls.n += 1;
      return typeof height === 'function' ? height() : height;
    },
  };
}

function marker(lon, lat, height = 0) {
  return new Cesium.Entity({ position: Cesium.Cartesian3.fromDegrees(lon, lat, height) });
}

function point(lon, lat, height = 0) {
  return { position: Cesium.Cartesian3.fromDegrees(lon, lat, height) };
}

function heightOf(target) {
  const position = target.position?.getValue
    ? target.position.getValue(Cesium.JulianDate.now())
    : target.position;
  return Cesium.Cartographic.fromCartesian(position).height;
}

const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// The defect this module exists for
// ---------------------------------------------------------------------------

/**
 * The whole bug, in one assertion. `globe.getHeight` is the right call on a
 * globe stack and answers NOTHING on the photoreal one, because a hidden globe
 * streams no tiles — so every seating pass in this repo was a silent no-op on
 * the stack most readers look at, and every marker stood ~88 m under its street.
 */
test('the hidden globe answers nothing, and the tileset answers instead', () => {
  const scene = photorealScene();
  assert.equal(scene.globe.getHeight(), undefined, 'the premise: a hidden globe is mute');
  assert.equal(renderedSurfaceM(scene, STOP.lon * RAD, STOP.lat * RAD), MESH_M);
  assert.equal(scene.calls.n, 1, 'exactly one probe, never a loop');
});

test('a visible globe is read for free and never sampled', () => {
  const scene = globeScene(TERRAIN_M);
  assert.equal(photorealSurface(scene), false);
  assert.equal(surfaceSamplingArmed(scene), false, 'no probe is armed on a globe stack');
  assert.equal(renderedSurfaceM(scene, STOP.lon * RAD, STOP.lat * RAD), TERRAIN_M);
});

test('a torn-down viewer falls to the path that touches nothing', () => {
  assert.equal(renderedSurfaceM(null, STOP.lon * RAD, STOP.lat * RAD), null);
  assert.equal(renderedSurfaceM({}, STOP.lon * RAD, STOP.lat * RAD), null);
  assert.equal(photorealSurface(undefined), false);
});

test('an absent reading is null, never zero — zero is a coordinate at sea', () => {
  assert.equal(renderedSurfaceM(globeScene(undefined), STOP.lon * RAD, STOP.lat * RAD), null);
  assert.equal(renderedSurfaceM(globeScene(NaN), STOP.lon * RAD, STOP.lat * RAD), null);
  assert.equal(renderedSurfaceM(globeScene(0), STOP.lon * RAD, STOP.lat * RAD), 0);
});

// ---------------------------------------------------------------------------
// What may be sampled, and when
// ---------------------------------------------------------------------------

/**
 * `meshFloorSampler.js` learnt this the expensive way: a probe taken MID-STREAM
 * returns a coarse-LOD height — a real number, wildly wrong — and a one-shot
 * latch makes it permanent.
 */
test('nothing is sampled while the tileset is still streaming', () => {
  const scene = photorealScene({ tilesLoaded: false });
  assert.equal(surfaceSamplingArmed(scene), false);
  assert.equal(renderedSurfaceM(scene, STOP.lon * RAD, STOP.lat * RAD), null);
  assert.equal(scene.calls.n, 0, 'a refused probe costs nothing');
});

test('nothing is sampled from a camera too high for a fine LOD', () => {
  const scene = photorealScene({ cameraM: SURFACE_MAX_CAMERA_HEIGHT_M + 1 });
  assert.equal(surfaceSamplingArmed(scene), false);
  assert.equal(scene.calls.n, 0);
});

test('`sample: false` forbids the paid path outright', () => {
  const scene = photorealScene();
  assert.equal(
    renderedSurfaceM(scene, STOP.lon * RAD, STOP.lat * RAD, { sample: false }),
    null,
  );
  assert.equal(scene.calls.n, 0);
});

// ---------------------------------------------------------------------------
// Seating
// ---------------------------------------------------------------------------

test('a marker on the ellipsoid is seated on the photoreal mesh', () => {
  const entity = marker(STOP.lon, STOP.lat);
  _forgetSurfaceMeasurements([entity]);
  assert.ok(Math.abs(heightOf(entity)) < 0.001, 'starts on the ellipsoid');

  const result = seatEntitiesOnSurface([entity], photorealScene());

  assert.equal(result.moved, 1);
  assert.equal(result.pending, 0);
  assert.ok(Math.abs(heightOf(entity) - MESH_M) < 0.001);
});

test('a point primitive is seated the same way, with its lift kept', () => {
  const disc = point(STOP.lon, STOP.lat);
  _forgetSurfaceMeasurements([disc]);

  const result = seatPointsOnSurface([disc], photorealScene(), { liftM: 2 });

  assert.equal(result.moved, 1);
  assert.ok(Math.abs(heightOf(disc) - (MESH_M + 2)) < 0.001, 'lift is above the SURFACE');
});

/**
 * TIER 1. The measured spread over a whole viewport was 8.1 m against an 88 m
 * error, so the box centre's single reading is most of the fix — and it has to
 * apply to marks the budget has not reached yet, not just to a cold start.
 */
test('marks past the budget borrow the centre reading instead of hovering', () => {
  const marks = Array.from({ length: SURFACE_SAMPLE_BUDGET + 6 }, (_, i) => marker(
    STOP.lon + i * 0.0001, STOP.lat,
  ));
  _forgetSurfaceMeasurements(marks);
  const scene = photorealScene();

  const result = seatEntitiesOnSurface(marks, scene, { fallbackHeightM: 88 });

  assert.equal(scene.calls.n, SURFACE_SAMPLE_BUDGET, 'the budget is a hard ceiling');
  assert.equal(result.sampled, SURFACE_SAMPLE_BUDGET);
  assert.equal(result.pending, 6, 'and the debt is reported so the next pass returns');
  assert.equal(result.moved, marks.length, 'every mark left the ellipsoid all the same');
  assert.ok(Math.abs(heightOf(marks[SURFACE_SAMPLE_BUDGET]) - 88) < 0.001);
});

test('a second pass costs nothing for marks already seated on their own reading', () => {
  const marks = [marker(STOP.lon, STOP.lat), marker(STOP.lon + 0.001, STOP.lat)];
  _forgetSurfaceMeasurements(marks);
  const scene = photorealScene();

  seatEntitiesOnSurface(marks, scene);
  assert.equal(scene.calls.n, 2);

  const second = seatEntitiesOnSurface(marks, scene);
  assert.equal(scene.calls.n, 2, 'the latch is one-shot per mark');
  assert.equal(second.moved, 0);
  assert.equal(second.pending, 0);
});

test('with nothing able to answer and nothing to borrow, no mark is moved', () => {
  const entity = marker(STOP.lon, STOP.lat);
  _forgetSurfaceMeasurements([entity]);

  const result = seatEntitiesOnSurface([entity], photorealScene({ tilesLoaded: false }));

  assert.equal(result.moved, 0, 'better on the ellipsoid than on an invented height');
  assert.equal(result.pending, 1, 'and the debt is on the record');
  assert.ok(Math.abs(heightOf(entity)) < 0.001);
});

test('a clamped polyline carries no position of its own and is skipped', () => {
  const line = new Cesium.Entity({
    polyline: { positions: Cesium.Cartesian3.fromDegreesArray([2.35, 48.84, 2.36, 48.85]) },
  });
  const result = seatEntitiesOnSurface([line], photorealScene());
  assert.deepEqual(result, { moved: 0, pending: 0, sampled: 0 });
});

test('a move under the epsilon is not worth a rebuilt Cartesian', () => {
  const entity = marker(STOP.lon, STOP.lat, MESH_M - 0.1);
  _forgetSurfaceMeasurements([entity]);
  const result = seatEntitiesOnSurface([entity], photorealScene(), { epsilonM: 0.25 });
  assert.equal(result.moved, 0);
  assert.equal(result.pending, 0, 'it was measured — it simply did not need to move');
});

test('seating never moves a marker sideways', () => {
  const entity = marker(STOP.lon, STOP.lat);
  _forgetSurfaceMeasurements([entity]);
  seatEntitiesOnSurface([entity], photorealScene());
  const carto = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.longitude) - STOP.lon) < 1e-9);
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.latitude) - STOP.lat) < 1e-9);
});

/**
 * `tilesLoaded` is the main guard and not the only one needed. PR #145
 * measured a probe against an unstreamed tileset returning −11 838 m: finite,
 * catastrophically wrong, and permanent once latched.
 */
test('a finite but impossible reading is refused rather than latched', () => {
  const scene = photorealScene({ height: -11_838 });
  assert.equal(renderedSurfaceM(scene, STOP.lon * RAD, STOP.lat * RAD), null);

  const entity = marker(STOP.lon, STOP.lat);
  _forgetSurfaceMeasurements([entity]);
  const result = seatEntitiesOnSurface([entity], scene, { fallbackHeightM: 88 });
  assert.equal(result.pending, 1, 'the probe is spent and the debt stands');
  assert.ok(Math.abs(heightOf(entity) - 88) < 0.001, 'the borrowed prior wins over nonsense');
});

test('the band refuses the top end too', () => {
  const scene = photorealScene({ height: 12_000 });
  assert.equal(renderedSurfaceM(scene, STOP.lon * RAD, STOP.lat * RAD), null);
});
