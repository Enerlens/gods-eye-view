// src/data/fireAnchors.test.mjs — DEM ground anchors for rendered FIRMS
// detections (field finding 2026-07-21: close-zoom fire dots read as
// buried under high terrain because anchors sat at ellipsoid height 0).
//
// Locks the module's two jobs:
//   fireAnchorHeight(lat, lon)      — synchronous warm-cache read: shared
//     ground floor + lift, or 0 when the floor isn't warm (the pre-fix anchor).
//   warmFireAnchorFloors(points)    — batched, sequential (never concurrent)
//     resolve of the cold floor cells behind a rendered detection set.
//     Resolves true only when at least one requested point actually gained a
//     warm floor — a failed resolve reports false so render → warm → re-render
//     chains terminate instead of looping against a down proxy.
//
// `fetch` is injected via `globalThis.fetch` (no real network), same pattern
// as terrainHeights.test.mjs. The terrainHeights/groundFloor module caches
// persist across tests in this file, so each test uses distinct coordinates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  FIRE_ANCHOR_LIFT_M,
  FIRE_PROVISIONAL_FILL_KM,
  FIRE_PROVISIONAL_MAX_CAMERA_M,
  FIRE_PROVISIONAL_MAX_PROBES,
  fireAnchorHeight,
  provisionalFireFloor,
  sampleFireAnchorFloors,
  warmFireAnchorFloors,
  _resetFireAnchorsForTest,
} from './fireAnchors.js';
import { reportMeshFloorCell, setMeshFloorPreferred } from './groundFloor.js';

/** Installs a fake fetch for the duration of `fn`, restoring the original after. */
async function withFakeFetch(fakeFetch, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** Parses the `points=lon,lat;…` query of a /api/terrain/heights request URL. */
function parsePoints(url) {
  const raw = decodeURIComponent(String(url).split('points=')[1] || '');
  return raw.split(';').filter(Boolean).map((pair) => {
    const [lon, lat] = pair.split(',').map(Number);
    return { lon, lat };
  });
}

/** Fake proxy answering ellipsoid = lon + lat per requested point. */
function echoFetch(log) {
  return async (url) => {
    const points = parsePoints(url);
    log.push(points);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: points.map(({ lon, lat }) => ({ lon, lat, elevation: 0, geoid: 0, ellipsoid: lon + lat })),
      }),
    };
  };
}

test('fireAnchorHeight: unknown floor anchors at 0 (pre-fix behavior preserved)', () => {
  _resetFireAnchorsForTest();
  assert.equal(fireAnchorHeight(10.001, 10.001), 0);
});

test('fireAnchorHeight: warm shared ground floor anchors at floor + lift', () => {
  _resetFireAnchorsForTest();
  setMeshFloorPreferred(true);
  // Seed via the mesh-cell path — proves fires read the SAME choke point
  // (cachedGroundFloor) every other ground-adjacent consumer uses.
  reportMeshFloorCell(51.301, -122.401, 1400);
  assert.equal(fireAnchorHeight(51.3012, -122.4008), 1400 + FIRE_ANCHOR_LIFT_M);
});

test('warmFireAnchorFloors: one batched request, deduped to coarse cells', async () => {
  _resetFireAnchorsForTest();
  const log = [];
  await withFakeFetch(echoFetch(log), async () => {
    const warmed = await warmFireAnchorFloors([
      { lat: 20.0001, lon: 30.0001 }, // same ~111 m cell as the next point
      { lat: 20.0004, lon: 30.0004 },
      { lat: 20.101, lon: 30.101 },   // distinct cell
    ]);
    assert.equal(warmed, true);
    assert.equal(log.length, 1, 'one network request for the whole batch');
    assert.equal(log[0].length, 2, 'two unique coarse cells, not three points');
  });
  // The warm floor is immediately readable at full precision…
  assert.equal(fireAnchorHeight(20.0001, 30.0001), 50 + FIRE_ANCHOR_LIFT_M);
  // …and for every other detection sharing the cell.
  assert.equal(fireAnchorHeight(20.0004, 30.0004), 50 + FIRE_ANCHOR_LIFT_M);
});

test('warmFireAnchorFloors: warm cells never refetch (one lookup per fire ever)', async () => {
  _resetFireAnchorsForTest();
  const log = [];
  await withFakeFetch(echoFetch(log), async () => {
    await warmFireAnchorFloors([{ lat: 21.001, lon: 31.001 }]);
    assert.equal(log.length, 1);
    const warmedAgain = await warmFireAnchorFloors([
      { lat: 21.001, lon: 31.001 },
      { lat: 21.0012, lon: 31.0011 }, // same cell, different detection
    ]);
    assert.equal(warmedAgain, false, 'nothing was cold, so nothing warmed');
    assert.equal(log.length, 1, 'no second network request');
  });
});

test('warmFireAnchorFloors: overlapping calls run sequentially, never concurrently', async () => {
  _resetFireAnchorsForTest();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let concurrent = 0;
  let maxConcurrent = 0;
  const log = [];
  await withFakeFetch(async (url) => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    const points = parsePoints(url);
    log.push(points);
    await gate;
    concurrent -= 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: points.map(({ lon, lat }) => ({ lon, lat, elevation: 0, geoid: 0, ellipsoid: lon + lat })),
      }),
    };
  }, async () => {
    const first = warmFireAnchorFloors([{ lat: 40.001, lon: 50.001 }]);
    // Second call arrives while the first is in flight: overlaps the first
    // cell and adds one new one.
    const second = warmFireAnchorFloors([
      { lat: 40.001, lon: 50.001 },
      { lat: 41.201, lon: 51.201 },
    ]);
    release();
    const [warmedFirst, warmedSecond] = await Promise.all([first, second]);
    assert.equal(warmedFirst, true);
    assert.equal(warmedSecond, true, 'the new cell warmed in the follow-up batch');
    assert.equal(maxConcurrent, 1, 'batches never overlap on the wire');
    assert.equal(log.length, 2);
    assert.equal(log[1].length, 1, 'follow-up batch re-filters: only the still-cold cell goes out');
  });
});

test('warmFireAnchorFloors: proxy failure reports false (re-render chain terminates)', async () => {
  _resetFireAnchorsForTest();
  let calls = 0;
  await withFakeFetch(async () => {
    calls += 1;
    throw new Error('proxy down');
  }, async () => {
    const warmed = await warmFireAnchorFloors([{ lat: 22.501, lon: 32.501 }]);
    assert.equal(warmed, false, 'geoid fallback is NOT a warm floor for anchoring');
    assert.ok(calls >= 1);
  });
  assert.equal(fireAnchorHeight(22.501, 32.501), 0, 'anchor stays at 0 until a real floor lands');
});

// --- Provisional rendered-surface floors -----------------------------------
//
// The defect these lock: a detection painted before its DEM cell answers sat
// at ellipsoid 0 — measured 293 m under the ground it belongs to over the
// Chiapas fires — where, depth test disabled, it slid across the landscape
// with every camera move instead of staying on the map.

/** A scene the sampler accepts: low camera over `at`, one visible tileset,
 *  and a `sampleHeight` under the test's control. Mirrors the double in
 *  meshFloorSampler.test.mjs — same gates, same shape. */
function fakeScene(sampleHeight, {
  at = { lat: 0, lon: 0 }, cameraHeightM = 3000, tilesLoaded = true, show = true,
} = {}) {
  const tileset = Object.create(Cesium.Cesium3DTileset.prototype);
  Object.defineProperty(tileset, 'tilesLoaded', { value: tilesLoaded, configurable: true });
  Object.defineProperty(tileset, 'show', { value: show, configurable: true });
  return {
    sampleHeight,
    camera: {
      positionCartographic: {
        height: cameraHeightM,
        latitude: Cesium.Math.toRadians(at.lat),
        longitude: Cesium.Math.toRadians(at.lon),
      },
    },
    primitives: { length: 1, get: () => tileset },
  };
}

test('provisional: a cold cell is grounded on the RENDERED surface, not the ellipsoid', () => {
  _resetFireAnchorsForTest();
  const fire = { lat: 17.401, lon: -91.71 };
  assert.equal(fireAnchorHeight(fire.lat, fire.lon), 0, 'nothing sampled yet');
  const { probes, pending } = sampleFireAnchorFloors(fakeScene(() => 293.2, { at: fire }), [fire]);
  assert.equal(probes, 1);
  assert.equal(pending, 0, 'the caller has nothing left to come back for');
  assert.equal(fireAnchorHeight(fire.lat, fire.lon), 293.2 + FIRE_ANCHOR_LIFT_M);
});

test('provisional: an implausible sample is refused (the -11 838 m headless read)', () => {
  _resetFireAnchorsForTest();
  const fire = { lat: 18.401, lon: -91.71 };
  sampleFireAnchorFloors(fakeScene(() => -11838.9, { at: fire }), [fire]);
  assert.equal(provisionalFireFloor(fire.lat, fire.lon), null);
  assert.equal(fireAnchorHeight(fire.lat, fire.lon), 0, 'junk never becomes an anchor');
});

test('provisional: nothing loaded under the probe leaves the anchor alone', () => {
  _resetFireAnchorsForTest();
  const fire = { lat: 19.401, lon: -91.71 };
  sampleFireAnchorFloors(fakeScene(() => undefined, { at: fire }), [fire]);
  assert.equal(fireAnchorHeight(fire.lat, fire.lon), 0);
});

test('provisional: no probes at all above the camera ceiling', () => {
  _resetFireAnchorsForTest();
  const fire = { lat: 20.401, lon: -91.71 };
  let probed = 0;
  const scene = fakeScene(() => { probed += 1; return 300; }, {
    at: fire, cameraHeightM: FIRE_PROVISIONAL_MAX_CAMERA_M + 1,
  });
  assert.deepEqual(sampleFireAnchorFloors(scene, [fire]), { probes: 0, pending: 0 });
  assert.equal(probed, 0, 'a high camera sees coarse tiles everywhere — do not read them');
  assert.equal(fireAnchorHeight(fire.lat, fire.lon), 0);
});

test('provisional: the probe budget is capped, and the rest borrow the nearest read', () => {
  _resetFireAnchorsForTest();
  const origin = { lat: 21.401, lon: -91.71 };
  // 60 distinct ~111 m cells in one complex — more cells than probes.
  const fires = [];
  for (let i = 0; i < 60; i += 1) fires.push({ lat: origin.lat + i * 0.001, lon: origin.lon });
  let probed = 0;
  const scene = fakeScene(() => { probed += 1; return 700; }, { at: origin });
  const spent = sampleFireAnchorFloors(scene, fires).probes;
  assert.equal(spent, FIRE_PROVISIONAL_MAX_PROBES, 'the budget is spent, not exceeded');
  assert.equal(probed, FIRE_PROVISIONAL_MAX_PROBES);
  for (const fire of fires) {
    assert.equal(fireAnchorHeight(fire.lat, fire.lon), 700 + FIRE_ANCHOR_LIFT_M,
      'every detection in the complex is on the ground, budget or no budget');
  }
});

test('provisional: a cell too far from any read stays at 0 rather than borrowing', () => {
  _resetFireAnchorsForTest();
  const near = { lat: 22.401, lon: -91.71 };
  const far = { lat: near.lat + (FIRE_PROVISIONAL_FILL_KM + 10) / 111.32, lon: near.lon };
  // Only the near cell answers; the far one is out of every probe's reach.
  const scene = fakeScene((carto) => (
    Math.abs(Cesium.Math.toDegrees(carto.latitude) - near.lat) < 0.0005 ? 700 : undefined
  ), { at: near });
  sampleFireAnchorFloors(scene, [near, far]);
  assert.equal(fireAnchorHeight(near.lat, near.lon), 700 + FIRE_ANCHOR_LIFT_M);
  assert.equal(fireAnchorHeight(far.lat, far.lon), 0, 'a hillside 35 km away is not this one');
});

test('provisional: the DEM outranks it and evicts it when it lands', () => {
  _resetFireAnchorsForTest();
  setMeshFloorPreferred(true);
  const fire = { lat: 23.401, lon: -91.71 };
  const scene = fakeScene(() => 700, { at: fire });
  sampleFireAnchorFloors(scene, [fire]);
  assert.equal(fireAnchorHeight(fire.lat, fire.lon), 700 + FIRE_ANCHOR_LIFT_M);
  reportMeshFloorCell(23.401, -91.71, 688);
  assert.equal(fireAnchorHeight(fire.lat, fire.lon), 688 + FIRE_ANCHOR_LIFT_M,
    'the shared floor is the authority the moment it exists');
  sampleFireAnchorFloors(scene, [fire]);
  assert.equal(provisionalFireFloor(fire.lat, fire.lon), null, 'and the stand-in is dropped');
});

test('provisional: a mid-stream read is re-probed once the tiles drain, then left alone', () => {
  _resetFireAnchorsForTest();
  const fire = { lat: 24.401, lon: -91.71 };
  let probed = 0;
  const midStream = fakeScene(() => { probed += 1; return 120; }, { at: fire, tilesLoaded: false });
  const first = sampleFireAnchorFloors(midStream, [fire]);
  assert.equal(fireAnchorHeight(fire.lat, fire.lon), 120 + FIRE_ANCHOR_LIFT_M,
    'a coarse read still beats the ellipsoid by two orders of magnitude');
  assert.equal(first.pending, 1, 'and a real read is still owed — grounded is not grounded well');
  const drained = fakeScene(() => { probed += 1; return 700; }, { at: fire, tilesLoaded: true });
  assert.equal(sampleFireAnchorFloors(drained, [fire]).pending, 0, 'and then nothing is owed');
  assert.equal(probed, 2, 'the better conditions are taken');
  assert.equal(fireAnchorHeight(fire.lat, fire.lon), 700 + FIRE_ANCHOR_LIFT_M);
  sampleFireAnchorFloors(drained, [fire]);
  assert.equal(probed, 2, 'and nothing is re-read for nothing');
});

test('provisional: a probe that finds nothing is reported, and not repeated for nothing', () => {
  _resetFireAnchorsForTest();
  const fire = { lat: 25.401, lon: -91.71 };
  let probed = 0;
  const scene = fakeScene(() => { probed += 1; return undefined; }, { at: fire });
  const first = sampleFireAnchorFloors(scene, [fire]);
  assert.deepEqual(first, { probes: 1, pending: 1 },
    'the caller is told to come back once the tiles land');
  const second = sampleFireAnchorFloors(scene, [fire]);
  assert.deepEqual(second, { probes: 0, pending: 1 },
    'the same miss under the same conditions is not paid for twice');
  assert.equal(probed, 1);
});

test('provisional: a scene that cannot be sampled still reports what it owes', () => {
  _resetFireAnchorsForTest();
  const fire = { lat: 26.401, lon: -91.71 };
  assert.deepEqual(sampleFireAnchorFloors(undefined, [fire]), { probes: 0, pending: 1 });
  assert.deepEqual(sampleFireAnchorFloors({}, [fire]), { probes: 0, pending: 1 });
});
