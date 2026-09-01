// src/data/bdtopoBuildings.test.mjs
// What the Bâti 3D layer does with a camera that is not yet close enough, and
// with a Géoplateforme that only half answers.
//
// The projection, the seating and the altitude arithmetic are proved against
// captured tiles in `bdtopoBuildingsFeed.test.mjs`. This file is about the
// other half of "the layer works": being turned on from a view the layer
// cannot load and coming back with a city instead of an instruction, and
// surviving a tile service that refuses part of what was asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import bdtopoBuildingsLayer, {
  _bdtopoStatsForTest,
  _fetchBdtopoTilesForTest,
  _setBdtopoPayloadForTest,
  _setBdtopoStateForTest,
  bdtopoViewportBox,
} from './bdtopoBuildings.js';

/** A viewer whose camera reports a box and accepts a flight to a smaller one. */
function createViewer(box, { heightM = 4_000_000, pitchDeg = -90 } = {}) {
  const state = { box, flights: [] };
  const viewer = {
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84, getHeight: () => 0, show: true } },
    camera: {
      frustum: { fov: Math.PI / 3, aspectRatio: 1.7 },
      heading: 0,
      pitch: (pitchDeg * Math.PI) / 180,
      positionCartographic: { height: heightM },
      computeViewRectangle: () => Cesium.Rectangle.fromDegrees(
        state.box.west, state.box.south, state.box.east, state.box.north,
      ),
      flyTo(options) {
        const carto = Cesium.Cartographic.fromCartesian(options.destination);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        state.flights.push({ lat, lon, heightM: carto.height });
        state.box = {
          south: lat - 0.01, west: lon - 0.01, north: lat + 0.01, east: lon + 0.01,
        };
        options.complete?.();
      },
    },
  };
  return { viewer, state };
}

const FRANCE_WIDE = { south: 41.5, west: -4.5, north: 51, east: 8.5 };
const LYON = { south: 45.75, west: 4.81, north: 45.77, east: 4.84 };
const BERLIN_WIDE = { south: 51.5, west: 12, north: 53.5, east: 14.5 };

test('a continental view of France is too wide, and says which of the three it is', () => {
  const { viewer } = createViewer(FRANCE_WIDE);
  assert.deepEqual(bdtopoViewportBox(viewer).box, null);
  assert.equal(bdtopoViewportBox(viewer).reason, 'too-wide');
});

test('a load that only wanted a zoom is not a failed refresh', async () => {
  // The bug: `load()` answers "did this tick fetch anything", and returning that
  // straight to the manager made a guidance state read as the layer rejecting
  // its own lifecycle — the toggle flipped back to OFF under "could not start
  // cleanly" while the feed was perfectly healthy.
  const { viewer } = createViewer(FRANCE_WIDE);
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no tile may be requested for this camera'); };
  try {
    _setBdtopoStateForTest({ viewer });
    assert.equal(await bdtopoBuildingsLayer.update(), true);
    const stats = bdtopoBuildingsLayer.getStats();
    assert.equal(stats.status, 'ok', 'guidance is not a fault state');
    assert.equal(stats.error, undefined, 'and it is not an error');
    assert.match(stats.loadingLabel, /^Zoome sous/);
  } finally {
    globalThis.fetch = fetchBefore;
    _setBdtopoStateForTest({ viewer: null, enabled: false });
  }
});

test('turning the layer on from orbit flies to the buildings instead of asking', async () => {
  const { viewer, state } = createViewer(FRANCE_WIDE);
  _setBdtopoStateForTest({ viewer });
  try {
    assert.equal(await bdtopoBuildingsLayer.ensureViewGate(viewer), true);
    assert.equal(state.flights.length, 1);
    assert.ok(state.flights[0].heightM < 4000, 'a district-scale camera, not an orbital one');
    assert.ok(bdtopoViewportBox(viewer).box, 'the box the layer refused is now one it will load');
  } finally {
    _setBdtopoStateForTest({ viewer: null, enabled: false });
  }
});

test('a camera already close enough is left exactly where the operator put it', async () => {
  const { viewer, state } = createViewer(LYON, { heightM: 900, pitchDeg: -60 });
  _setBdtopoStateForTest({ viewer });
  try {
    assert.equal(await bdtopoBuildingsLayer.ensureViewGate(viewer), true,
      'already inside the gate, which is what the gate is asked about');
    assert.equal(state.flights.length, 0);
  } finally {
    _setBdtopoStateForTest({ viewer: null, enabled: false });
  }
});

test('a sliver of France at the edge of a German view is not a destination', async () => {
  // 400 km over Berlin, clipping the Alsace border. The layer calls this
  // "too-wide" — coverage IS in shot — but the operator is looking at Berlin,
  // and a flight to Strasbourg is not what they asked for.
  const { viewer, state } = createViewer({ south: 51.2, west: 9.6, north: 53.8, east: 17.2 });
  _setBdtopoStateForTest({ viewer });
  try {
    assert.equal(bdtopoViewportBox(viewer).reason, 'too-wide');
    assert.equal(await bdtopoBuildingsLayer.ensureViewGate(viewer), false);
    assert.equal(state.flights.length, 0);
  } finally {
    _setBdtopoStateForTest({ viewer: null, enabled: false });
  }
});

test('no altitude makes Berlin French, so the camera stays over Berlin', async () => {
  // Off coverage is a different answer from too wide, and flying to France
  // would be answering a question nobody asked.
  const { viewer, state } = createViewer(BERLIN_WIDE);
  _setBdtopoStateForTest({ viewer });
  try {
    assert.equal(bdtopoViewportBox(viewer).reason, 'off-coverage');
    assert.equal(await bdtopoBuildingsLayer.ensureViewGate(viewer), false);
    assert.equal(state.flights.length, 0);
  } finally {
    _setBdtopoStateForTest({ viewer: null, enabled: false });
  }
});

// --- A Géoplateforme that refuses SOME of the viewport ----------------------
//
// A city-sized box is 24–60 separate tile requests against a free public
// service that rate-limits at 400 req/min and answers 5xx under load. The
// layer used to gather them with `Promise.all`, so one refusal out of sixty
// rejected the whole load and reported the layer UNAVAILABLE with 59 good
// tiles in hand — which is what a hosted deployment meets and a laptop on a
// quiet morning does not.
//
// The rule under test: a partial answer is DRAWN and declared incomplete; only
// a total refusal is a failure.

const TILE = (x) => ({ z: 15, x, y: 11_269 });

/** Install a fetch that answers per-tile from a map of x → status. */
function stubFetch(statusByX) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const x = Number(String(url).match(/\/15\/(\d+)\//)?.[1]);
    const status = statusByX[x] ?? 200;
    if (status === 'network') throw new Error('network down');
    return {
      ok: status >= 200 && status < 300,
      status,
      // An empty body is the "no buildings on this square" answer, which keeps
      // the decoder out of these tests entirely.
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
  return () => { globalThis.fetch = original; };
}

test('a refused tile costs its own square and nothing else', async () => {
  const restore = stubFetch({ 3: 503, 5: 429 });
  try {
    const result = await _fetchBdtopoTilesForTest([1, 2, 3, 4, 5].map(TILE), new AbortController().signal);
    assert.equal(result.failed, 2);
    assert.ok(result.firstError instanceof Error);
    assert.match(result.firstError.message, /HTTP (503|429)/);
  } finally { restore(); }
});

test('a 404 is coverage, not a failure — BD TOPO has empty squares', async () => {
  const restore = stubFetch({ 2: 404 });
  try {
    const result = await _fetchBdtopoTilesForTest([1, 2, 3].map(TILE), new AbortController().signal);
    assert.equal(result.failed, 0);
    assert.equal(result.firstError, null);
  } finally { restore(); }
});

test('a network error is counted like an HTTP refusal, not thrown', async () => {
  const restore = stubFetch({ 2: 'network' });
  try {
    const result = await _fetchBdtopoTilesForTest([1, 2, 3].map(TILE), new AbortController().signal);
    assert.equal(result.failed, 1);
  } finally { restore(); }
});

test('an abort is this layer superseding itself, and is rethrown whole', async () => {
  // Not a tile fault: swallowing it would let a cancelled viewport draw over
  // the one that replaced it.
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  try {
    await assert.rejects(
      () => _fetchBdtopoTilesForTest([1, 2].map(TILE), new AbortController().signal),
      (error) => error.name === 'AbortError',
    );
  } finally { globalThis.fetch = original; }
});

test('an incomplete viewport says so on the row, and says how incomplete', async () => {
  _setBdtopoStateForTest({ records: new Map(), payload: null });
  _setBdtopoPayloadForTest({ count: 9_000, missingTiles: 3, requestedTiles: 48 });
  const stats = _bdtopoStatsForTest();
  assert.equal(stats.missingTiles, 3);
  assert.equal(stats.degraded, true);
  assert.match(stats.loadingLabel, /3 tuiles/);
  assert.match(stats.loadingLabel, /48/);
  // Buildings ARE drawn — this is not an error state, and must not read as one.
  assert.equal(stats.status, 'ok');
  assert.equal(stats.error, undefined);
});

test('a complete viewport claims nothing about missing tiles', () => {
  _setBdtopoStateForTest({ records: new Map(), payload: null });
  _setBdtopoPayloadForTest({ count: 9_000, missingTiles: 0, requestedTiles: 48 });
  const stats = _bdtopoStatsForTest();
  assert.equal(stats.degraded, undefined);
  assert.equal(stats.loadingLabel, undefined);
});

test('on the photoreal stack the shortfall is not reported, because nothing is drawn', () => {
  _setBdtopoStateForTest({ records: new Map(), payload: null, photoreal: true });
  _setBdtopoPayloadForTest({ count: 9_000, missingTiles: 3, requestedTiles: 48 });
  const stats = _bdtopoStatsForTest();
  assert.equal(stats.degraded, undefined);
  assert.match(stats.loadingLabel, /Google 3D/);
});
