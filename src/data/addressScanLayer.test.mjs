// src/data/addressScanLayer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  SEAT_EPSILON_M,
  cardFromEntity,
  renderedGroundM,
  scanShiftNeeded,
  seatEntitiesOnGround,
} from './addressScanLayer.js';

/** Avenue de France, Paris 13e — the address the whole address stack is built on. */
const ADDRESS = { lon: 2.3760, lat: 48.8300 };

/** The height the globe actually draws there, measured in the running app. */
const PARIS_GROUND_M = 82.4;

/** A globe that answers with one height, and counts how often it was asked. */
function fakeGlobe(height, { calls = { n: 0 } } = {}) {
  return {
    calls,
    getHeight(carto) {
      calls.n += 1;
      return typeof height === 'function' ? height(carto) : height;
    },
  };
}

/** The height an entity is currently standing at, in ellipsoidal metres. */
function heightOf(entity) {
  const position = entity.position.getValue(Cesium.JulianDate.now());
  return Cesium.Cartographic.fromCartesian(position).height;
}

function marker(lon, lat, height = 0) {
  return new Cesium.Entity({ position: Cesium.Cartesian3.fromDegrees(lon, lat, height) });
}

/**
 * The bug this whole mechanism exists for: a marker left on the ellipsoid is
 * eighty metres under the street it describes, and a vertical error under an
 * oblique camera is a HORIZONTAL error on screen that changes with every
 * camera pose. That is what "the dots move when I nudge the map" is.
 */
test('a marker drawn on the ellipsoid is seated on the terrain', () => {
  const entity = marker(ADDRESS.lon, ADDRESS.lat);
  assert.ok(Math.abs(heightOf(entity)) < 0.001, 'starts on the ellipsoid');

  const result = seatEntitiesOnGround([entity], fakeGlobe(PARIS_GROUND_M));

  assert.equal(result.moved, 1);
  assert.equal(result.pending, 0);
  assert.ok(Math.abs(heightOf(entity) - PARIS_GROUND_M) < 0.001);
});

test('seating moves the marker up, not sideways', () => {
  const entity = marker(ADDRESS.lon, ADDRESS.lat);
  const before = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
  const lon = before.longitude;
  const lat = before.latitude;

  seatEntitiesOnGround([entity], fakeGlobe(PARIS_GROUND_M));

  const after = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
  // Sub-micro-radian: a metre of latitude is 1.6e-7 rad, so this is millimetres.
  assert.ok(Math.abs(after.longitude - lon) < 1e-9, 'longitude is untouched');
  assert.ok(Math.abs(after.latitude - lat) < 1e-9, 'latitude is untouched');
});

test('a marker already on the ground is left alone', () => {
  const entity = marker(ADDRESS.lon, ADDRESS.lat, PARIS_GROUND_M);
  const result = seatEntitiesOnGround([entity], fakeGlobe(PARIS_GROUND_M));
  assert.equal(result.moved, 0, 'no work, and no render request');

  // Terrain LOD refines by centimetres constantly; re-seating on every one of
  // those would rewrite a few hundred positions per frame for nothing visible.
  const jittered = seatEntitiesOnGround(
    [marker(ADDRESS.lon, ADDRESS.lat, PARIS_GROUND_M)],
    fakeGlobe(PARIS_GROUND_M + SEAT_EPSILON_M / 2),
  );
  assert.equal(jittered.moved, 0);

  // A refinement worth a pixel is taken.
  const refined = seatEntitiesOnGround(
    [marker(ADDRESS.lon, ADDRESS.lat, PARIS_GROUND_M)],
    fakeGlobe(PARIS_GROUND_M + 3),
  );
  assert.equal(refined.moved, 1);
});

/**
 * The cold case. A camera that has just arrived draws its markers before a
 * single terrain tile has answered, and zero is the one height we know to be
 * wrong. Every marker in these layers is within a few hundred metres of the
 * scan centre, so the centre's height is a far better prior — but the debt is
 * reported so the next pass comes back for a real reading.
 */
test('unloaded terrain falls back to the scan centre, and says so', () => {
  const entity = marker(ADDRESS.lon, ADDRESS.lat);
  const result = seatEntitiesOnGround([entity], fakeGlobe(undefined), PARIS_GROUND_M);

  assert.equal(result.moved, 1);
  assert.equal(result.pending, 1, 'a real reading is still owed');
  assert.ok(Math.abs(heightOf(entity) - PARIS_GROUND_M) < 0.001);
});

test('with neither terrain nor a centre, a marker is left where it was drawn', () => {
  const entity = marker(ADDRESS.lon, ADDRESS.lat);
  const result = seatEntitiesOnGround([entity], fakeGlobe(undefined), null);
  assert.equal(result.moved, 0);
  assert.equal(result.pending, 1);
  assert.ok(Math.abs(heightOf(entity)) < 0.001, 'untouched, not guessed at');
});

/**
 * The urbanism layer draws its zoning as clamped POLYLINES, which carry
 * `polyline.positions` and no `position` at all. They are already on the
 * ground; walking past them must not throw.
 */
test('a clamped polyline has nothing to seat and is skipped', () => {
  const line = new Cesium.Entity({
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray([2.37, 48.83, 2.38, 48.83]),
      clampToGround: true,
    },
  });
  const globe = fakeGlobe(PARIS_GROUND_M);
  const result = seatEntitiesOnGround([line], globe);
  assert.deepEqual(result, { moved: 0, pending: 0 });
  assert.equal(globe.calls.n, 0, 'and costs no terrain query');
});

test('a globe with no terrain answer at all is a no-op, not a crash', () => {
  const entity = marker(ADDRESS.lon, ADDRESS.lat);
  assert.deepEqual(seatEntitiesOnGround([entity], null), { moved: 0, pending: 0 });
  assert.deepEqual(seatEntitiesOnGround(null, fakeGlobe(10)), { moved: 0, pending: 0 });
  assert.ok(Math.abs(heightOf(entity)) < 0.001);
});

test('every marker is asked about its own ground, not the first one`s', () => {
  const globe = fakeGlobe((carto) => Cesium.Math.toDegrees(carto.longitude) * 10);
  const a = marker(2.0, 48.83);
  const b = marker(3.0, 48.83);
  const result = seatEntitiesOnGround([a, b], globe);
  assert.equal(result.moved, 2);
  assert.equal(globe.calls.n, 2);
  assert.ok(Math.abs(heightOf(a) - 20) < 0.001);
  assert.ok(Math.abs(heightOf(b) - 30) < 0.001);
});

test('renderedGroundM reports an absent reading as null, never as zero', () => {
  const lon = Cesium.Math.toRadians(ADDRESS.lon);
  const lat = Cesium.Math.toRadians(ADDRESS.lat);
  assert.equal(renderedGroundM(fakeGlobe(PARIS_GROUND_M), lon, lat), PARIS_GROUND_M);
  assert.equal(renderedGroundM(fakeGlobe(undefined), lon, lat), null);
  assert.equal(renderedGroundM(fakeGlobe(NaN), lon, lat), null);
  assert.equal(renderedGroundM(null, lon, lat), null);
  // A genuinely sea-level reading is a number, and must survive as one.
  assert.equal(renderedGroundM(fakeGlobe(0), lon, lat), 0);
});

/**
 * A card carries a COPY of the marker's world position, so it has to be built
 * from the SEATED marker. Read from the ellipsoid one it would hang eighty
 * metres below the dot it belongs to — the same bug wearing the card's clothes.
 */
test('a card built after seating anchors at the seated height', () => {
  const entity = new Cesium.Entity({
    id: 'dvf:2024-1218713',
    name: '15 avenue de France',
    position: Cesium.Cartesian3.fromDegrees(ADDRESS.lon, ADDRESS.lat),
    description: '2024-03-11 · Vente · 512 000 € · 41 m²',
  });
  seatEntitiesOnGround([entity], fakeGlobe(PARIS_GROUND_M));
  const card = cardFromEntity(entity);
  assert.equal(card.id, 'dvf:2024-1218713');
  assert.equal(card.details.length, 4);
  const carto = Cesium.Cartographic.fromCartesian(card.position);
  assert.ok(Math.abs(carto.height - PARIS_GROUND_M) < 0.001);
});

test('the scan threshold still gates on ground distance, not on height', () => {
  assert.equal(scanShiftNeeded(null, ADDRESS), true);
  assert.equal(scanShiftNeeded(ADDRESS, ADDRESS), false);
  assert.equal(scanShiftNeeded(ADDRESS, { lon: ADDRESS.lon, lat: ADDRESS.lat + 0.01 }), true);
});
