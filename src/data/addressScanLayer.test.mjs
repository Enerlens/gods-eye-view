// src/data/addressScanLayer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  SEAT_EPSILON_M,
  addressScanClickIntent,
  cardFromEntity,
  createAddressScanLayer,
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

/**
 * A viewer with no canvas: `cameraScanPoint` falls back to the nadir and the
 * click handler declines to install, which is exactly the surface these two
 * tests want — the shell's redraw contract, with no DOM in it.
 */
function headlessViewer(lon, lat, altitudeM) {
  const added = [];
  return {
    added,
    viewer: {
      camera: {
        positionCartographic: new Cesium.Cartographic(
          Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat), altitudeM,
        ),
        moveEnd: { addEventListener: () => () => {} },
      },
      scene: { globe: { show: true }, requestRender() {} },
      dataSources: { add(source) { added.push(source); return source; } },
    },
  };
}

function stackEventTarget() {
  const listeners = new Set();
  return {
    size: () => listeners.size,
    fire() { for (const listener of listeners) listener(); },
    addEventListener(type, listener) { listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); },
  };
}

async function scannedLayer(overrides) {
  const renders = [];
  const { viewer } = headlessViewer(ADDRESS.lon, ADDRESS.lat, 900);
  const layer = createAddressScanLayer({
    id: 'scan-test',
    name: 'Scan test',
    icon: '▦',
    source: 'test',
    endpoint: '/api/test',
    updateInterval: 900_000,
    render({ payload, dataSource, viewer: seen }) {
      renders.push({ payload, classified: seen?.scene?.globe?.show });
      dataSource.entities.add({ id: `drawn-${renders.length}` });
      return 1;
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({ zones: ['one'] }) }),
    ...overrides,
  });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  return { layer, renders, viewer };
}

/**
 * The wash the urbanism layer draws is ground-classification geometry, and a
 * classification surface is read ONCE, when the primitive is built. Switch the
 * basemap to the photoreal tileset — which hides the globe — and a wash built
 * for terrain draws nothing at all: the layer reads as switched off.
 */
test('a map-stack change redraws the answer already in hand, without refetching', async () => {
  let fetches = 0;
  const events = stackEventTarget();
  const { renders } = await scannedLayer({
    redrawOnMapStack: true,
    mapStackEventTarget: events,
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, json: async () => ({ zones: ['one'] }) };
    },
  });
  assert.equal(renders.length, 1);
  assert.equal(fetches, 1);

  events.fire();
  assert.equal(renders.length, 2, 'the ground changed, so the draw is rebuilt');
  assert.equal(fetches, 1, 'the register did not change, so nothing is refetched');
  assert.equal(renders[1].classified, true, 'the render is handed the viewer it must classify for');
});

test('the four billboard layers do not subscribe, and unsubscribe on disable', async (t) => {
  // `disable()` detaches the layer's Escape-to-dismiss handler from `document`,
  // which only exists in the browser this runs in.
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.document = originalDocument; });
  const events = stackEventTarget();
  const { layer } = await scannedLayer({ mapStackEventTarget: events });
  assert.equal(events.size(), 0, 'a marker is a marker whatever the basemap is');

  const listening = stackEventTarget();
  const draped = await scannedLayer({ redrawOnMapStack: true, mapStackEventTarget: listening });
  assert.equal(listening.size(), 1);
  draped.layer.disable();
  assert.equal(listening.size(), 0);
  layer.disable();
});

/**
 * A layer whose question depends on the CAMERA, not only on where it points —
 * which is the urbanism layer, asking for a box close in and a point higher up.
 */
async function regimeLayer() {
  const queries = [];
  const { viewer } = headlessViewer(ADDRESS.lon, ADDRESS.lat, 900);
  let altitude = 900;
  const layer = createAddressScanLayer({
    id: 'regime-test',
    name: 'Regime test',
    icon: '▦',
    source: 'test',
    endpoint: '/api/test',
    updateInterval: 900_000,
    // Below 1 500 m it asks for a box; above it, only the point.
    params: () => (altitude <= 1500 ? { box: '1' } : {}),
    render: ({ dataSource }) => { dataSource.entities.add({ id: `d${queries.length}` }); return 1; },
    fetchImpl: async (url) => {
      queries.push(String(url));
      return { ok: true, json: async () => ({ zones: [] }) };
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  return {
    layer,
    viewer,
    queries,
    setAltitude(next) {
      altitude = next;
      viewer.camera.positionCartographic.height = next;
    },
  };
}

/**
 * The scan-shift guard watches the CENTRE and nothing else. Zoom straight down
 * through the altitude where the urbanism layer switches from a box to a point
 * and the centre has not moved a metre, while the answer on screen is now the
 * wrong KIND of answer — a block of zoning left standing at 9 km, or one
 * polygon where the neighbourhood should be.
 */
test('a params change rescans even when the scan centre has not moved', async (t) => {
  // `disable()` detaches the Escape-to-dismiss handler from `document`, which
  // only exists in the browser this runs in.
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.document = originalDocument; });
  const { layer, viewer, queries, setAltitude } = await regimeLayer();
  await layer.update(viewer);
  assert.equal(queries.length, 1);
  assert.ok(queries[0].includes('box=1'), 'close in, it asks for the block');

  // Same point, same everything, except the question.
  setAltitude(9000);
  await layer.update(viewer);
  assert.equal(queries.length, 2, 'the regime changed, so the answer is refetched');
  assert.ok(!queries[1].includes('box=1'), 'higher up, it asks about the point');
  layer.disable();
});

test('an unchanged question at an unchanged point still costs nothing', async (t) => {
  // `disable()` detaches the Escape-to-dismiss handler from `document`, which
  // only exists in the browser this runs in.
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.document = originalDocument; });
  const { layer, viewer, queries } = await regimeLayer();
  await layer.update(viewer);
  await layer.update(viewer);
  await layer.update(viewer);
  assert.equal(queries.length, 1, 'the guard still holds when nothing changed');
  layer.disable();
});

// ── Whose click is it ────────────────────────────────────────────────────────
//
// Four outcomes, and the layer that answers a ground point has to reach three
// of them without ever taking a click that belongs to a sibling. The rule is
// tested here rather than in the handler because the handler needs a canvas,
// a scene and a real Cesium event to run at all — which is how a routing bug
// ships green.

test('a marker of ours is selected, whatever else the layer can answer', () => {
  const entity = { id: 'dvf:1' };
  assert.equal(addressScanClickIntent({ picked: entity, isCard: true, isOwn: true }), 'select');
  assert.equal(
    addressScanClickIntent({
      picked: entity, isCard: true, isOwn: true, answersGround: true,
    }),
    'select',
    'the marker carries a card of its own and it wins',
  );
});

test('bare globe is a question about the ground, and used to be a dismissal', () => {
  assert.equal(addressScanClickIntent({ picked: null, answersGround: true }), 'ground');
  assert.equal(
    addressScanClickIntent({ picked: null, answersGround: true, selected: true }),
    'ground',
    'a click elsewhere moves the answer rather than closing it',
  );
  assert.equal(
    addressScanClickIntent({ picked: null, selected: true }),
    'dismiss',
    'a layer with nothing to say about bare ground still closes on it',
  );
  assert.equal(addressScanClickIntent({ picked: null }), 'ignore');
});

test('our own wash is ground, because it describes the plot rather than standing on it', () => {
  // The failure this exists to stop: the zone fill covers most of the screen
  // when the layer is on, so treating any pick as "something else is there"
  // would leave the ground unclickable exactly where the layer is working.
  const fill = { id: { id: 'gpu:zone:1:fill:0' } };
  assert.equal(
    addressScanClickIntent({ picked: fill, isOwn: true, answersGround: true }),
    'ground',
  );
});

test('another layer`s object is another layer`s click', () => {
  const foreign = { id: { id: 'schools-fr:0651234U' } };
  assert.equal(
    addressScanClickIntent({ picked: foreign, answersGround: true, selected: true }),
    'ignore',
    'that layer is about to open a card of its own; two cards for one click is the bug',
  );
  assert.equal(addressScanClickIntent({ picked: foreign, selected: true }), 'ignore');
});

/**
 * A layer that takes a runtime parameter — which, of the six address layers, is
 * the ADS one and its permit window. The values are a CLOSED SET because
 * everything reachable through `setParams` is also reachable from a share link,
 * so this is where a stranger's URL either gets rejected or gets to choose what
 * this browser asks an upstream API for.
 */
async function windowedLayer() {
  const queries = [];
  const { viewer } = headlessViewer(ADDRESS.lon, ADDRESS.lat, 900);
  const layer = createAddressScanLayer({
    id: 'window-test',
    name: 'Window test',
    icon: '▦',
    source: 'test',
    endpoint: '/api/test',
    updateInterval: 900_000,
    runtimeParams: { months: { values: ['36', '72', '156'], defaultValue: '36' } },
    params: (point, seen, runtime) => ({ months: runtime.months }),
    rowControls: (runtime, summary) => ({
      chips: [{ id: 'w', label: runtime.months, active: true, count: summary?.count ?? null }],
    }),
    summarize: (payload) => ({ count: payload.rows?.length ?? 0 }),
    render: ({ dataSource }) => { dataSource.entities.add({ id: `d${queries.length}` }); return 1; },
    fetchImpl: async (url) => {
      queries.push(String(url));
      return { ok: true, json: async () => ({ rows: [1, 2] }) };
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, queries };
}

/** The manager reads `getParams()` to decide what a `params` event carried; a
 *  layer answering null there cannot have a choice persisted or shared. */
test('a runtime parameter starts at its default and is readable', async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.document = originalDocument; });
  const { layer } = await windowedLayer();
  assert.deepEqual(layer.getParams(), { months: '36' });
  layer.disable();
});

test('a listed value is accepted and rescans without the camera moving', async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.document = originalDocument; });
  const { layer, viewer, queries } = await windowedLayer();
  await layer.update(viewer);
  assert.equal(queries.length, 1);
  assert.ok(queries[0].includes('months=36'));

  assert.equal(layer.setParams({ months: '72' }, { origin: 'user' }), true);
  assert.deepEqual(layer.getParams(), { months: '72' });
  // `setParams` fires the scan itself rather than waiting for the camera or the
  // ten-minute tick, which would leave the old window under the new label.
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(queries.length, 2, 'the window changed, so the answer is refetched');
  assert.ok(queries[1].includes('months=72'));
  layer.disable();
});

/**
 * REJECT, DO NOT CLAMP. A stale share link carrying a window this build no
 * longer offers must not be snapped to the nearest legal value: that answers a
 * question nobody asked while looking exactly like the one they did.
 */
test('an unlisted value and an unknown key are both refused outright', async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.document = originalDocument; });
  const { layer } = await windowedLayer();
  assert.equal(layer.setParams({ months: '999' }), false);
  assert.equal(layer.setParams({ months: '24' }), false);
  assert.equal(layer.setParams({ radius: '1200' }), false);
  assert.deepEqual(layer.getParams(), { months: '36' }, 'nothing moved');
  layer.disable();
});

test('setting the value it already has is accepted and costs no scan', async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.document = originalDocument; });
  const { layer, viewer, queries } = await windowedLayer();
  await layer.update(viewer);
  assert.equal(layer.setParams({ months: '36' }), true);
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(queries.length, 1);
  layer.disable();
});

test('the row chips are built from the runtime params and the SUMMARY', async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.document = originalDocument; });
  const { layer, viewer } = await windowedLayer();
  // Before any scan there is no summary to read, and the chips still build.
  assert.deepEqual(layer.getRowControls().chips[0], {
    id: 'w', label: '36', active: true, count: null,
  });
  await layer.update(viewer);
  assert.equal(layer.getRowControls().chips[0].count, 2);
  layer.disable();
});

test('a layer that declares no row controls does not pretend to have any', async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.document = originalDocument; });
  const { layer } = await regimeLayer();
  assert.equal(layer.getRowControls, undefined);
  layer.disable();
});
