import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approximateSurfaceDistanceM,
  installationClickOutcome,
  installationLegend,
  installationSourceLabel,
  installationResponseSaturated,
  installationSurfaceHeightM,
  installationWithinViewport,
} from './militaryInstallations.js';
import militaryInstallationsLayer, {
  installationKeyNote,
  mergeInstallationCohort,
} from './militaryInstallations.js';
import {
  _clearMeshFloorCellsForTest,
  cachedGroundFloor,
  FLOOR_RESOLVE_DEADLINE_MS,
  reportMeshFloorCell,
  setMeshFloorPreferred,
} from './groundFloor.js';
import { _resetFireAnchorsForTest } from './fireAnchors.js';
import {
  getSelectedEntityContext,
  registerEntityContext,
  selectEntityContext,
} from './contextStore.js';
import {
  _resetRenderGovernorForTest,
  getRenderGovernorDiagnostics,
  installRenderGovernor,
} from '../renderGovernor.js';
import * as Cesium from 'cesium';
import { installViteAssetStubHooks } from '../../scripts/lib/layerManifestSources.mjs';
import {
  _resetMilitaryFrancePackForTest,
  _setMilitaryFrancePackForTest,
} from './militaryFrancePack.js';

// The layer fetches its France pack through Vite's `?url`, which plain node
// refuses to resolve. The stub keeps the specifier importable; the seam below
// keeps every enable in this file from reaching for it.
installViteAssetStubHooks();
_setMilitaryFrancePackForTest([]);

test('cheap installation distance prefilter is local and antimeridian-safe', () => {
  const oneDegree = approximateSurfaceDistanceM(0, 0, 0, 1);
  assert.ok(oneDegree > 111000 && oneDegree < 111300);
  const acrossDateline = approximateSurfaceDistanceM(
    Cesium.Math.toRadians(10),
    Cesium.Math.toRadians(179.9),
    10,
    -179.9,
  );
  assert.ok(acrossDateline > 21000 && acrossDateline < 23000);
});

test('attributes a record to the source that carried it, and never guesses one', () => {
  assert.equal(installationSourceLabel({ sources: [{ name: 'OpenStreetMap' }, { name: 'OpenStreetMap' }] }), 'OpenStreetMap');
  // A record with no source named says so. Every record is an OSM element
  // today, but the label is what would expose a second source arriving without
  // one — which is exactly how the removed Places candidates got in.
  assert.equal(installationSourceLabel({ sources: [] }), 'Unknown mapped source');
  assert.equal(installationSourceLabel({}), 'Unknown mapped source');
});

test('places installation anchors on the shared cached rendered floor', () => {
  setMeshFloorPreferred(true);
  _clearMeshFloorCellsForTest();
  reportMeshFloorCell(30.2, -97.7, 182.25);
  assert.equal(installationSurfaceHeightM({ latitude: 30.2, longitude: -97.7 }), 183.75);
  _clearMeshFloorCellsForTest();
});

test('real enabled installation entities carry no native label graphics', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const canvas = {
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = { dispatchEvent() {} };
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/terrain/heights')) {
      return { ok: true, status: 200, json: async () => ({ results: [{ ellipsoid: 100 }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'fresh',
        retrievedAt: '2026-08-02T00:00:00.000Z',
        elements: [{
          type: 'node',
          id: 42,
          lat: 30.2,
          lon: -97.7,
          tags: { military: 'base', name: 'Runtime Installation' },
        }],
      }),
    };
  };
  const moveEndListeners = new Set();
  const dataSources = [];
  const viewer = {
    camera: {
      moveEnd: {
        addEventListener(listener) {
          moveEndListeners.add(listener);
          return () => moveEndListeners.delete(listener);
        },
      },
      computeViewRectangle() {
        return {
          south: Cesium.Math.toRadians(30),
          west: Cesium.Math.toRadians(-98),
          north: Cesium.Math.toRadians(31),
          east: Cesium.Math.toRadians(-97),
        };
      },
    },
    scene: {
      canvas,
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      pick() { return null; },
    },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };

  try {
    militaryInstallationsLayer.init(viewer);
    militaryInstallationsLayer.enable();
    await militaryInstallationsLayer.update();
    const entities = dataSources[0].entities.values;
    assert.ok(entities.length > 0, 'runtime guard requires rendered installation records');
    assert.ok(entities.every((entity) => entity.label === undefined));
  } finally {
    militaryInstallationsLayer.destroy(viewer);
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

const VIEWPORT = { south: 30, west: -98, north: 31, east: -97 };

test('Context focus past the render cap selects for real instead of flying blind', async () => {
  // Context navigation walks the FULL nearby cohort; only the first 700 records
  // get entities. Focusing item 701+ used to fly the camera, find no entity,
  // silently drop the selection, and report success — so the Context subject
  // stayed stale and NEXT offered the same installation forever.
  const elements = Array.from({ length: 760 }, (_, index) => ({
    type: 'node',
    id: 1000 + index,
    lat: 30.1 + (index % 40) * 0.002,
    lon: -97.9 + Math.floor(index / 40) * 0.002,
    tags: { military: 'base', name: `Installation ${index}` },
  }));
  const run = await runInstallationLoad({ elements });
  const flights = [];
  try {
    const renderedIds = new Set(run.entities().map((entity) => entity.id));
    assert.equal(renderedIds.size, 700, 'the ambient paint stays capped');

    const cohort = militaryInstallationsLayer.getNearby(
      Cesium.Cartesian3.fromDegrees(-97.8, 30.15, 0),
      Number.POSITIVE_INFINITY,
      5000,
    );
    assert.ok(cohort.length > 700, 'the cohort reaches past the render cap');
    const beyondCap = cohort.find((record) => !renderedIds.has(record.id));
    assert.ok(beyondCap, 'a cohort item exists outside the rendered window');

    const focused = militaryInstallationsLayer.focusById(beyondCap.id);
    assert.equal(focused, true, 'focus succeeds');
    // The proof: a real entity now backs the selection, so the Context subject
    // actually changes rather than the camera moving over a stale subject.
    const nowRendered = run.entities().find((entity) => entity.id === beyondCap.id);
    assert.ok(nowRendered, 'the focused record was rendered on demand');
    assert.equal(
      run.contextLabels().at(-1),
      beyondCap.name,
      'the selection reached the context store',
    );
  } finally {
    void flights;
    run.restore();
  }
});

/**
 * Drive one real `update()` of the layer against a stubbed proxy, and expose
 * what actually reached the map and the context store.
 */
async function runInstallationLoad({
  elements = [],
  saturated = false,
  exactElements = null,
  exactSaturated = false,
  legacyPayload = false,
  failWith = null,
}) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  const contextEvents = [];
  _resetRenderGovernorForTest();
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = {
    dispatchEvent(event) {
      if (event?.detail?.label) contextEvents.push(event.detail.label);
    },
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
  };
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/api/terrain/heights')) {
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }
    requests.push(href);
    if (failWith) {
      return { ok: false, status: 503, json: async () => ({ error: failWith }) };
    }
    const exact = href.includes('exact=1');
    const payload = {
      status: 'fresh',
      retrievedAt: '2026-08-18T00:00:00.000Z',
      elements: exact && exactElements ? exactElements : elements,
      elementCap: 700,
    };
    // A pre-fix cached entry carries no `saturated` field at all.
    if (!legacyPayload) payload.saturated = exact ? exactSaturated : saturated;
    return { ok: true, status: 200, json: async () => payload };
  };
  const dataSources = [];
  const cameraFlights = [];
  const viewer = {
    camera: {
      moveEnd: { addEventListener() { return () => {}; } },
      flyToBoundingSphere(sphere, options) { cameraFlights.push({ sphere, options }); },
      computeViewRectangle() {
        return {
          south: Cesium.Math.toRadians(VIEWPORT.south),
          west: Cesium.Math.toRadians(VIEWPORT.west),
          north: Cesium.Math.toRadians(VIEWPORT.north),
          east: Cesium.Math.toRadians(VIEWPORT.east),
        };
      },
    },
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {} },
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      pick() { return null; },
      // Enough surface for the real render governor to drive this viewer, so
      // one-shot render requests are observable.
      requestRenderMode: false,
      maximumRenderTimeChange: 0,
      requestRender() {},
    },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };

  militaryInstallationsLayer.init(viewer);
  installRenderGovernor(viewer);
  militaryInstallationsLayer.enable();
  await militaryInstallationsLayer.update();

  return {
    requests,
    cameraFlights,
    entities: () => dataSources[0]?.entities?.values || [],
    contextLabels: () => contextEvents,
    stats: () => militaryInstallationsLayer.getStats(),
    renderRequests: () => getRenderGovernorDiagnostics().recentRequests.map((item) => item.reason),
    restore() {
      militaryInstallationsLayer.destroy(viewer);
      _resetRenderGovernorForTest();
      globalThis.fetch = originalFetch;
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

test('viewport membership keeps intersecting footprints and drops the snap ring', () => {
  const inside = { osmType: 'node', latitude: 30.5, longitude: -97.5, footprint: null };
  const outside = { osmType: 'node', latitude: 30.5, longitude: -96.5, footprint: null };
  assert.equal(installationWithinViewport(inside, VIEWPORT), true);
  assert.equal(installationWithinViewport(outside, VIEWPORT), false);

  // A large base whose CENTRE sits just outside but whose footprint overlaps
  // was always returned by the bbox query and must keep rendering.
  const straddling = {
    osmType: 'way',
    latitude: 30.5,
    longitude: -96.95,
    footprint: [[-97.05, 30.4], [-96.9, 30.4], [-96.9, 30.6], [-97.05, 30.6]],
  };
  assert.equal(installationWithinViewport(straddling, VIEWPORT), true);

  const farWithFootprint = {
    osmType: 'way',
    latitude: 30.5,
    longitude: -96.5,
    footprint: [[-96.6, 30.4], [-96.4, 30.4], [-96.4, 30.6], [-96.6, 30.6]],
  };
  assert.equal(installationWithinViewport(farWithFootprint, VIEWPORT), false);
  assert.equal(installationWithinViewport(null, VIEWPORT), false);
  assert.equal(installationWithinViewport(inside, null), false);
});

test('extended features with unknown extent are kept, not centre-tested', () => {
  // Relations carry geometry on their members and ways over MAX_FOOTPRINT_POINTS
  // are normalized without one, so their true extent is unknown here. Overpass
  // already proved they intersect the queried bbox; centre-testing them would
  // erase exactly the biggest installations.
  const relation = { osmType: 'relation', latitude: 30.5, longitude: -96.99, footprint: null };
  const hugeWay = { osmType: 'way', latitude: 29.5, longitude: -97.5, footprint: null };
  assert.equal(installationWithinViewport(relation, VIEWPORT), true);
  assert.equal(installationWithinViewport(hugeWay, VIEWPORT), true);
  // A node IS its geometry, so excluding it on centre loses nothing.
  assert.equal(
    installationWithinViewport({ osmType: 'node', latitude: 30.5, longitude: -96.99, footprint: null }, VIEWPORT),
    false,
  );
  // Unknown provenance is treated inclusively, same as an extended feature.
  assert.equal(installationWithinViewport({ latitude: 30.5, longitude: -96.99, footprint: null }, VIEWPORT), true);
});

test('a footprint-less relation just outside the viewport still renders', async () => {
  const harness = await runInstallationLoad({
    elements: [
      // A relation whose CENTER sits outside the viewport and whose geometry
      // lives on members Overpass did not inline. It was returned because it
      // intersects the queried bbox, so it must survive the viewport filter.
      { type: 'relation', id: 91, center: { lat: 30.5, lon: -96.995 }, tags: { military: 'range', name: 'Straddling Range' } },
      // A NODE at the same off-view spot has no extent and must still be cut.
      { type: 'node', id: 92, lat: 30.5, lon: -96.995, tags: { military: 'range', name: 'Off View Node' } },
    ],
  });
  try {
    assert.deepEqual(
      harness.entities().map((entity) => entity.gevLabelModel?.title),
      ['Straddling Range'],
    );
  } finally {
    harness.restore();
  }
});

test('a legacy cached response with no saturation flag still triggers the exact retry', () => {
  const atCap = { elements: new Array(700).fill({ type: 'node' }), elementCap: 700 };
  assert.equal(installationResponseSaturated(atCap), true, 'derived from the reported cap');
  assert.equal(
    installationResponseSaturated({ elements: new Array(699).fill({ type: 'node' }), elementCap: 700 }),
    false,
  );
  // An explicit flag always wins over the derivation.
  assert.equal(installationResponseSaturated({ ...atCap, saturated: false }), false);
  assert.equal(installationResponseSaturated({ elements: [], saturated: true }), true);
  // Nothing to derive from: do not invent saturation.
  assert.equal(installationResponseSaturated({ elements: new Array(700).fill({}) }), false);
  assert.equal(installationResponseSaturated(null), false);
});

test('a legacy-shaped payload at the cap fires the exact-viewport retry end to end', async () => {
  const elements = [];
  for (let index = 0; index < 700; index += 1) {
    elements.push({ type: 'node', id: 3000 + index, lat: 30.5, lon: -96.2, tags: { military: 'range' } });
  }
  const harness = await runInstallationLoad({
    elements,
    // Pre-fix cache shape: no `saturated` field at all, but at the cap.
    legacyPayload: true,
    exactElements: [
      { type: 'node', id: 8, lat: 30.5, lon: -97.5, tags: { military: 'range', name: 'Rescued From Legacy' } },
    ],
  });
  try {
    assert.equal(harness.requests.length, 2, 'a legacy entry must not skip the retry');
    assert.equal(harness.requests[1].includes('exact=1'), true);
    assert.deepEqual(
      harness.entities().map((entity) => entity.gevLabelModel?.title),
      ['Rescued From Legacy'],
    );
  } finally {
    harness.restore();
  }
});

test('a failed load buys the frame its status change needs', async () => {
  const harness = await runInstallationLoad({ failWith: 'Installation feed HTTP 503' });
  try {
    assert.equal(harness.stats().status, 'unavailable');
    assert.ok(
      harness.renderRequests().some((reason) => reason === 'installations-status'),
      'an idle governor would otherwise leave the last healthy readout on screen',
    );
  } finally {
    harness.restore();
  }
});

test('off-viewport records from the snapped superset never render or enter context', async () => {
  const harness = await runInstallationLoad({
    // The snapped bbox reaches ~5.5 km beyond the viewport; this node sits a
    // full degree outside it.
    elements: [
      { type: 'node', id: 1, lat: 30.5, lon: -97.5, tags: { military: 'range', name: 'In View' } },
      { type: 'node', id: 2, lat: 30.5, lon: -96.2, tags: { military: 'range', name: 'Off View' } },
    ],
  });
  try {
    const titles = harness.entities().map((entity) => entity.gevLabelModel?.title);
    assert.deepEqual(titles, ['In View'], 'only the in-viewport site renders');
    assert.equal(harness.contextLabels().includes('Off View'), false, 'and none enters context');
    assert.equal(harness.stats().count, 1);
  } finally {
    harness.restore();
  }
});

test('a saturated snapped tile refetches the exact viewport before rendering', async () => {
  const elements = [];
  for (let index = 0; index < 700; index += 1) {
    // A saturated snapped response full of OFF-viewport sites: the in-view ones
    // were crowded out upstream.
    elements.push({ type: 'node', id: 1000 + index, lat: 30.5, lon: -96.2, tags: { military: 'range' } });
  }
  const harness = await runInstallationLoad({
    elements,
    saturated: true,
    exactElements: [
      { type: 'node', id: 7, lat: 30.5, lon: -97.5, tags: { military: 'range', name: 'Rescued' } },
    ],
  });
  try {
    assert.equal(harness.requests.length, 2, 'saturation triggers exactly one retry');
    assert.equal(harness.requests[0].includes('exact=1'), false, 'first ask uses the shared snapped tile');
    assert.equal(harness.requests[1].includes('exact=1'), true, 'retry opts out of the snap');
    assert.deepEqual(
      harness.entities().map((entity) => entity.gevLabelModel?.title),
      ['Rescued'],
      'the in-viewport site is no longer starved by off-view ones',
    );
  } finally {
    harness.restore();
  }
});

test('an unsaturated response never pays for a second upstream ask', async () => {
  const harness = await runInstallationLoad({
    elements: [{ type: 'node', id: 3, lat: 30.5, lon: -97.5, tags: { military: 'range' } }],
  });
  try {
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.stats().saturated, false);
  } finally {
    harness.restore();
  }
});

test('a still-saturated exact viewport is reported honestly instead of implied complete', async () => {
  const elements = [];
  for (let index = 0; index < 700; index += 1) {
    elements.push({ type: 'node', id: 2000 + index, lat: 30.5, lon: -97.5, tags: { military: 'range' } });
  }
  const harness = await runInstallationLoad({ elements, saturated: true, exactSaturated: true });
  try {
    assert.equal(harness.stats().saturated, true);
    assert.match(harness.stats().error, /Too many mapped sites/);
  } finally {
    harness.restore();
  }
});

test('a floor that lands after the render deadline lifts the dots off the ellipsoid', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  // A cell no other test in this file warms, so the assertion is about THIS
  // load, not a cache another test left behind.
  const lat = 44.123;
  const lon = -110.456;
  let terrainCalls = 0;
  setMeshFloorPreferred(false);
  _clearMeshFloorCellsForTest();
  _resetFireAnchorsForTest();
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = { dispatchEvent() {} };
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/terrain/heights')) {
      terrainCalls += 1;
      // The production failure: the bounded pre-render resolve gives up before
      // Re:Earth answers, so the first paint has no floor to stand on.
      if (terrainCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, FLOOR_RESOLVE_DEADLINE_MS + 200));
      }
      return { ok: true, status: 200, json: async () => ({ results: [{ ellipsoid: 2400 }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'fresh',
        retrievedAt: '2026-08-18T00:00:00.000Z',
        elements: [{ type: 'node', id: 77, lat, lon, tags: { military: 'range' } }],
      }),
    };
  };
  const dataSources = [];
  const viewer = {
    camera: {
      moveEnd: { addEventListener() { return () => {}; } },
      computeViewRectangle() {
        return {
          south: Cesium.Math.toRadians(44),
          west: Cesium.Math.toRadians(-111),
          north: Cesium.Math.toRadians(45),
          east: Cesium.Math.toRadians(-110),
        };
      },
    },
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {} },
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      pick() { return null; },
    },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };

  const heightOf = (entity) => Cesium.Cartographic.fromCartesian(
    entity.position.getValue(Cesium.JulianDate.now()),
  ).height;

  try {
    militaryInstallationsLayer.init(viewer);
    militaryInstallationsLayer.enable();
    await militaryInstallationsLayer.update();

    const buried = dataSources[0].entities.values[0];
    assert.ok(buried, 'the cold-floor pass still renders the record');
    assert.ok(Math.abs(heightOf(buried)) < 1, 'a cold floor anchors at the ellipsoid, as before');

    // The warm chain resolves out of band; wait for the floor to land.
    for (let attempt = 0; attempt < 50 && cachedGroundFloor(lat, lon) == null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(cachedGroundFloor(lat, lon), 2400, 'the late floor landed in the shared cache');

    const lifted = dataSources[0].entities.values[0];
    assert.ok(
      Math.abs(heightOf(lifted) - 2401.5) < 0.5,
      `re-render must lift the dot onto the resolved floor, got ${heightOf(lifted)}`,
    );
  } finally {
    militaryInstallationsLayer.destroy(viewer);
    _resetFireAnchorsForTest();
    setMeshFloorPreferred(true);
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('reports bounded installation requests as loading and clears on settlement', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let resolveInstallations;
  const installationsResponse = new Promise((resolve) => { resolveInstallations = resolve; });
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = { dispatchEvent() {} };
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/terrain/heights')) {
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }
    return installationsResponse;
  };
  const viewer = {
    camera: {
      moveEnd: { addEventListener() { return () => {}; } },
      computeViewRectangle() {
        return {
          south: Cesium.Math.toRadians(30),
          west: Cesium.Math.toRadians(-98),
          north: Cesium.Math.toRadians(31),
          east: Cesium.Math.toRadians(-97),
        };
      },
    },
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {} },
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      pick() { return null; },
    },
    dataSources: { add(value) { return value; }, remove() { return true; } },
  };

  try {
    militaryInstallationsLayer.init(viewer);
    militaryInstallationsLayer.enable();
    const update = militaryInstallationsLayer.update();
    assert.equal(militaryInstallationsLayer.getStats().loading, true);
    assert.equal(
      militaryInstallationsLayer.getStats().loadingLabel,
      'loading mapped installation context',
    );
    resolveInstallations({
      ok: true,
      status: 200,
      json: async () => ({ status: 'fresh', elements: [] }),
    });
    await update;
    assert.equal(militaryInstallationsLayer.getStats().loading, false);
  } finally {
    militaryInstallationsLayer.destroy(viewer);
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('zoom-out aborts an active installation request and returns non-loading guidance', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let globalView = false;
  let observedSignal;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = { dispatchEvent() {} };
  globalThis.fetch = async (_url, options = {}) => {
    observedSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };
  const viewer = {
    camera: {
      moveEnd: { addEventListener() { return () => {}; } },
      computeViewRectangle() {
        return globalView ? null : {
          south: Cesium.Math.toRadians(30),
          west: Cesium.Math.toRadians(-98),
          north: Cesium.Math.toRadians(31),
          east: Cesium.Math.toRadians(-97),
        };
      },
    },
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {} },
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      pick() { return null; },
    },
    dataSources: { add(value) { return value; }, remove() { return true; } },
  };

  try {
    militaryInstallationsLayer.init(viewer);
    militaryInstallationsLayer.enable();
    const pending = militaryInstallationsLayer.update();
    assert.equal(militaryInstallationsLayer.getStats().loading, true);
    globalView = true;
    await militaryInstallationsLayer.update();
    await pending;
    assert.equal(observedSignal.aborted, true);
    assert.equal(militaryInstallationsLayer.getStats().loading, false);
    assert.equal(militaryInstallationsLayer.getStats().status, 'zoom-in');
  } finally {
    militaryInstallationsLayer.destroy(viewer);
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

// The unavailable-state retry: 'temporarily unavailable' must mean temporarily.
// Fetches otherwise fire only on enable and on camera moveEnd, so a parked
// camera whose first request failed stayed unavailable forever while the proxy
// sat healthy — observed in the field as a layer stuck reporting unavailable
// while its own endpoint served hundreds of features. The backoff progression
// is a pure exported helper so it pins without booting the layer (the full
// layer needs a Cesium viewer and interaction handlers); the wiring is pinned
// by source probes against the shipped file, the same technique the HUD datum
// tests use where a full boot is impractical.
import { installationRetryDelayMs } from './militaryInstallations.js';
import fs from 'node:fs';
import { militarySiteGlyph } from './militarySiteIcons.js';
import { transitVehicleGlyph } from './transitVehicleIcons.js';
import { mapIconGeometry } from './mapIcons.js';

const installationsSource = fs.readFileSync(
  new URL('./militaryInstallations.js', import.meta.url), 'utf8');

test('the unavailable retry backs off 30s to a 240s ceiling and restarts clean', () => {
  assert.equal(installationRetryDelayMs(0), 30000, 'first failure retries in 30s');
  assert.equal(installationRetryDelayMs(undefined), 30000, 'no prior delay means the minimum');
  assert.equal(installationRetryDelayMs(30000), 60000, 'each failure doubles');
  assert.equal(installationRetryDelayMs(60000), 120000);
  assert.equal(installationRetryDelayMs(120000), 240000, 'the ceiling is four minutes');
  assert.equal(installationRetryDelayMs(240000), 240000, 'and it stays there');
  assert.equal(installationRetryDelayMs(-5), 30000, 'garbage restarts at the minimum');
});

test('the zoom prompt travels as guidance, never as an error', () => {
  // THE REPORTED BUG, as a source assertion — the same technique the retry
  // wiring next door uses, and for the same reason: this is about which
  // ARGUMENT a call passes, which no amount of stubbing a viewer would show.
  //
  // `setInstallationStatus(status, error)` writes its second argument straight
  // to `state.error`, and the Data Layers row prints a non-empty `error` in its
  // fault slot. Passing the zoom prompt there was the whole of "Sites
  // militaires shows Loaded Error": the layer was correctly zoom-gated at a
  // country-wide camera and looked broken for it.
  //
  // The call gained a condition when the France pack landed — past the gate the
  // layer draws the pack and reports READY — but the second argument is the
  // whole point of this test and it is still null.
  assert.match(installationsSource,
    /setInstallationStatus\(state\.records\.length \? 'ready' : 'zoom-in', null\)/,
    'the zoom gate must not write a prompt into state.error');
  assert.doesNotMatch(installationsSource,
    /'zoom-in',\s*['"`][^)]/,
    'no string may be passed as the error argument of the zoom gate');
  // And the prompt still has somewhere to be seen.
  assert.match(installationsSource,
    /function installationLoadingLabel\(\)[^]*?status === 'zoom-in'[^]*?return '[^']*zoom in/i,
    'the prompt lives in the guidance slot the row reads');
});

test('the retry is wired to every lifecycle edge, not just declared', () => {
  assert.match(installationsSource,
    /setInstallationStatus\('unavailable',[^]*?\);\n\s*scheduleUnavailableRetry\(\);/,
    'a failed load schedules the retry immediately after reporting unavailable');
  assert.match(installationsSource,
    /clearUnavailableRetry\(\);\n\s*setInstallationStatus\(\n?\s*state\.records\.length/,
    'a successful load clears the pending retry and resets the backoff');
  assert.match(installationsSource,
    /clearUnavailableRetry\(\);\n\s*setInstallationStatus\(state\.records\.length \? 'ready' : 'zoom-in'/,
    'zooming out of range cancels the retry — moveEnd owns re-entry there');
  assert.match(installationsSource, /disable\(\) \{[^]*?clearUnavailableRetry\(\);/,
    'disabling the layer cancels the retry');
  assert.match(installationsSource,
    /function scheduleLoad\(\) \{[^]*?clearUnavailableRetry\(\{ resetBackoff: false \}\)/,
    'a user-driven load supersedes the retry without resetting the backoff step');
  assert.match(installationsSource,
    /state\.enabled && !state\.loading\) loadInstallations\(\)/,
    'the fired retry re-checks enablement and never races an in-flight load');
});


test('a click can let GO of a site, not only take one', () => {
  // The handler only ever selected. A picked installation therefore stayed lit
  // — holding the shared Context readout — until some other layer happened to
  // claim the slot; clicking it again did nothing at all.
  assert.equal(installationClickOutcome('osm:way:1', null, true), 'select');
  assert.equal(installationClickOutcome('osm:way:2', 'osm:way:1', true), 'select');
  // Re-clicking the selected site releases it.
  assert.equal(installationClickOutcome('osm:way:1', 'osm:way:1', true), 'release');
  // Empty map, or a contact this layer does not own: both arrive as "not mine".
  assert.equal(installationClickOutcome(null, 'osm:way:1', false), 'release');
  assert.equal(installationClickOutcome('aircraft:ABC', 'osm:way:1', false), 'release');
  // Nothing selected and nothing of ours picked: the click was not ours.
  assert.equal(installationClickOutcome(null, null, false), 'ignore');
  assert.equal(installationClickOutcome('aircraft:ABC', null, false), 'ignore');
});

test('a late repaint yields to a newer selection from another layer', async () => {
  // Context navigation selects an aircraft or a vessel with no canvas click at
  // all. A debounced refetch or a ground floor landing afterwards used to
  // repaint OUR old site white and take the readout back with it.
  const run = await runInstallationLoad({ elements: [
    { type: 'node', id: 77, lat: 30.5, lon: -97.5, tags: { military: 'base', name: 'Held Site' } },
  ] });
  try {
    const site = run.entities()[0];
    assert.ok(site, 'the site rendered');
    assert.equal(militaryInstallationsLayer.focusById(site.id), true);
    assert.equal(selectedEntityCount(run), 1, 'our site is the selected one');

    // Another layer claims the shared slot, the way Context navigation does.
    const foreign = { __gevContextId: null };
    registerEntityContext(foreign, { id: 'aircraft:ABC123', layerId: 'flights', label: 'ABC123' });
    selectEntityContext(foreign);

    await militaryInstallationsLayer.update();
    assert.equal(selectedEntityCount(run), 0, 'the repaint did not take the selection back');
    assert.equal(getSelectedEntityContext()?.id, 'aircraft:ABC123', 'the newer subject still holds');

    // A real pick still wins: the yield rule must not make the layer unclickable.
    assert.equal(militaryInstallationsLayer.focusById(site.id), true);
    assert.equal(selectedEntityCount(run), 1);
  } finally {
    run.restore();
  }
});

/**
 * How many of this layer's entities are painted in the selected state.
 *
 * Two graphics to check, not one: a class with a silhouette is a billboard and
 * a `point` selector alone would report zero selected sites on an airbase while
 * the mark on screen is plainly white.
 */
function selectedEntityCount(run) {
  const value = (property) => (property?.getValue?.() ?? property);
  return run.entities().filter((entity) => value(entity.point?.pixelSize) === 13
    || value(entity.billboard?.width) === 38).length;
}

// ── The on-map key ─────────────────────────────────────────────────────────
// D1: five hues classified these marks and nothing on screen decoded them,
// because `getRowControls()` was never implemented while 49 other layers ship
// one. These hold the key honest — sourced from what is DRAWN, and closed over
// every class the normalizer can emit.

const legendRecord = (klass, { footprint = null, id = `osm:way:${Math.random()}` } = {}) => ({
  id,
  class: klass,
  latitude: 43,
  longitude: 6,
  footprint,
});

const SQUARE = [[6, 43], [6.01, 43], [6.01, 43.01], [6, 43.01]];

test('installation legend counts the drawn cohort, one row per present class', () => {
  const legend = installationLegend([
    legendRecord('military_land', { footprint: SQUARE }),
    legendRecord('military_land'),
    legendRecord('naval_base', { footprint: SQUARE }),
    legendRecord('airfield', { footprint: SQUARE }),
  ]);
  // A footprint is a FORM, and #138 settled that a form needs no row of its
  // own: three classes are drawn here and three rows come back, whether or not
  // a record carries an emprise. The glyph a row carries is its CLASS
  // silhouette, which is a different claim entirely.
  assert.equal(legend.length, 3);
  for (const entry of legend) {
    assert.match(entry.glyph, /^data:image\/svg\+xml;base64,/, entry.label);
  }
  // Reading order is LEGEND_CLASSES order, not tally order: the catch-all sits
  // last among the mapped classes however far it dominates the count.
  assert.deepEqual(
    legend.map((entry) => entry.label),
    ['Base aérienne', 'Base navale', 'Terrain militaire'],
  );
  assert.equal(legend.find((entry) => entry.label === 'Terrain militaire').count, 2);
  assert.equal(legend.find((entry) => entry.label === 'Base aérienne').count, 1);
  // A class with nothing drawn gets no row rather than a zero.
  assert.equal(legend.some((entry) => entry.label === 'Champ de tir'), false);
});

test('installation legend is empty when nothing is drawn', () => {
  assert.deepEqual(installationLegend([]), []);
  assert.deepEqual(installationLegend(null), []);
});

test('installation legend swatches are the colours the map actually paints', () => {
  const legend = installationLegend([
    legendRecord('airfield'),
    legendRecord('naval_base'),
    legendRecord('range'),
    legendRecord('military_land'),
  ]);
  assert.deepEqual(
    legend.map((entry) => entry.color),
    ['#6fb8ff', '#4fd2e0', '#e6b268', '#a8bacd'],
  );
  // The rows must READ COLOR_BY_CLASS rather than restate it, or a hue can
  // drift between the map and its own key.
  const source = fs.readFileSync(new URL('./militaryInstallations.js', import.meta.url), 'utf8');
  const rows = source.match(/const LEGEND_CLASSES = Object\.freeze\(\[([\s\S]*?)\n\]\);/);
  assert.ok(rows, 'LEGEND_CLASSES must stay a literal list');
  assert.equal(/\bcolor:/.test(rows[1]), false, 'a class row must not carry its own colour');
});

test('every row of the key now stands for an OpenStreetMap tag', () => {
  // The fifth row was a Google Places NAME match, and it needed a blurb saying
  // it was not a claim of anything. The path is gone; nothing in this key is
  // allowed to reintroduce a class the map cannot source from a tag.
  const legend = installationLegend(
    ['airfield', 'naval_base', 'range', 'military_land'].map((klass) => legendRecord(klass)),
  );
  assert.equal(legend.length, 4);
  for (const row of legend) {
    assert.doesNotMatch(row.blurb, /Google|Places|non vérifié/i, row.label);
  }
});

test('every class the normalizer can emit has a legend row', () => {
  const dataSource = fs.readFileSync(new URL('./militaryInstallationData.js', import.meta.url), 'utf8');
  const block = dataSource.match(/const CLASS_BY_MILITARY_TAG = \{([\s\S]*?)\};/);
  assert.ok(block, 'CLASS_BY_MILITARY_TAG must stay a literal map');
  const classes = new Set([...block[1].matchAll(/:\s*'([a-z_]+)'/g)].map((match) => match[1]));
  // The two branches that do not go through that map.
  classes.add('military_land');
  assert.ok(classes.size >= 4);
  for (const klass of classes) {
    const legend = installationLegend([legendRecord(klass)]);
    assert.equal(legend.length, 1, `class ${klass} draws marks with no legend row`);
    assert.ok(legend[0].blurb, `class ${klass} has a row with nothing to read`);
  }
});


test('the layer publishes the key and no chips', () => {
  const controls = militaryInstallationsLayer.getRowControls();
  assert.ok(controls && Array.isArray(controls.legend));
  assert.equal(controls.chips, undefined);
  // `surfaceFill` stays unset: these footprints hold a fixed height and drape
  // nothing, so the shared drape note must not mount under them.
  assert.equal(controls.surfaceFill, undefined);
});

test('the published key tracks the paint, not the loaded set', async () => {
  const harness = await runInstallationLoad({
    elements: [
      { type: 'node', id: 21, lat: 30.5, lon: -97.5, tags: { military: 'range', name: 'Range' } },
      {
        type: 'way',
        id: 22,
        bounds: { minlat: 30.4, minlon: -97.6, maxlat: 30.45, maxlon: -97.55 },
        geometry: [
          { lat: 30.4, lon: -97.6 },
          { lat: 30.45, lon: -97.6 },
          { lat: 30.45, lon: -97.55 },
          { lat: 30.4, lon: -97.55 },
        ],
        tags: { landuse: 'military', name: 'Camp' },
      },
      // Loaded from the snapped superset, a full degree outside the viewport,
      // so it never gets an entity — and must never get a legend row either.
      { type: 'node', id: 23, lat: 30.5, lon: -96.2, tags: { military: 'naval_base', name: 'Off View' } },
    ],
  });
  try {
    const labels = militaryInstallationsLayer.getRowControls().legend.map((entry) => entry.label);
    assert.deepEqual(labels, ['Champ de tir', 'Terrain militaire']);
    assert.equal(labels.includes('Base navale'), false, 'an unpainted record buys no row');
  } finally {
    harness.restore();
  }
});

// ── The silhouettes ────────────────────────────────────────────────────────
// Colour was the only channel: five hues on identical dots, two of them a step
// apart on the same blue. These hold the shape channel to the same discipline
// as the colour one — closed over the classes the normalizer can emit, and
// never allowed to differ between the globe and its key.

test('a site is drawn as its class, and the catch-all weighs less than the rest', async () => {
  const run = await runInstallationLoad({ elements: [
    { type: 'node', id: 41, lat: 30.5, lon: -97.5, tags: { military: 'naval_base', name: 'Arsenal' } },
    { type: 'node', id: 42, lat: 30.6, lon: -97.4, tags: { landuse: 'military', name: 'Camp' } },
  ] });
  try {
    const value = (property) => (property?.getValue?.() ?? property);
    const byName = new Map(run.entities().map((entity) => [entity.gevLabelModel?.title, entity]));
    const naval = byName.get('Arsenal');
    const land = byName.get('Camp');

    assert.match(value(naval.billboard?.image), /^data:image\/svg\+xml;base64,/);
    assert.equal(naval.point, undefined, 'a mark and a dot on one anchor read as two marks');
    assert.notEqual(value(land.billboard?.image), value(naval.billboard.image));

    // The class that names a subject is drawn larger than the one that only
    // names the family — nine marks in ten are that fourre-tout.
    assert.equal(value(naval.billboard.width), 28);
    assert.equal(value(land.billboard.width), 24);

    // F6, and the complaint that rebuilt this pack: the ramp still shrinks the
    // mark with range, but its FLOOR is a plate a reader can find, not the 10 px
    // speck the old 0.5 floor produced over the Gironde.
    const ramp = value(naval.billboard.scaleByDistance);
    assert.ok(ramp.farValue >= 0.6, `floor ${ramp.farValue} puts the mark back under 18 px`);
    assert.ok(ramp.far >= 120000, 'the floor must not be reached at city range');
    assert.ok(ramp.farValue < ramp.nearValue, 'a mark that never shrinks blankets a département');
  } finally {
    run.restore();
  }
});

test('the key swatch is the same artwork the globe paints', () => {
  for (const klass of ['airfield', 'naval_base', 'range', 'military_land']) {
    const [row] = installationLegend([legendRecord(klass)]);
    // Same builder, one raster size apart: a swatch that were built from its
    // own drawing could show a class the map does not.
    assert.equal(row.glyph, militarySiteGlyph(klass, { px: 32, key: true }));
    assert.notEqual(row.glyph, militarySiteGlyph(klass));
    // The key's variant is the map mark MINUS its ring: a CSS mask reads alpha,
    // and an opaque ring would flatten every class into the same plain dot.
    const decode = (uri) => Buffer.from(String(uri).split(',')[1], 'base64').toString('utf8');
    assert.doesNotMatch(decode(row.glyph), /rgba\(0,0,0,0\.86\)/);
    assert.match(decode(militarySiteGlyph(klass, { px: 32 })), /rgba\(0,0,0,0\.86\)/);
  }
});

test('every class the normalizer can emit carries a silhouette', () => {
  const dataSource = fs.readFileSync(new URL('./militaryInstallationData.js', import.meta.url), 'utf8');
  const block = dataSource.match(/const CLASS_BY_MILITARY_TAG = \{([\s\S]*?)\};/);
  const classes = new Set([...block[1].matchAll(/:\s*'([a-z_]+)'/g)].map((match) => match[1]));
  classes.add('military_land');
  // A fifth class arriving upstream lands here, not on the globe as an
  // unexplained dot that no key row decodes.
  assert.deepEqual([...classes].filter((klass) => militarySiteGlyph(klass) === null), []);
  assert.ok(classes.size >= 4);
});

test('the silhouettes are distinct artwork, and the borrowed ones are not a second copy', () => {
  const drawn = ['airfield', 'naval_base', 'range', 'military_land']
    .map((klass) => militarySiteGlyph(klass));
  assert.equal(new Set(drawn).size, 4, 'two classes must never share one silhouette');
  // Borrowed through the CC0 map pack's own door. A vendored path copied into
  // this layer would pass every other test here and drift from the original.
  const decode = (uri) => Buffer.from(String(uri).split(',')[1], 'base64').toString('utf8');
  assert.ok(decode(militarySiteGlyph('airfield'))
    .includes(mapIconGeometry('temaki', 'fighter_jet')), 'the air base must punch Temaki\'s jet');
  assert.ok(decode(militarySiteGlyph('naval_base'))
    .includes(mapIconGeometry('maki', 'harbor')), 'the naval base must punch Maki\'s anchor');
  // And never the transit pack's civil vehicles, which is what it punched
  // before: an airliner names a civil aerodrome, a ferry names a passenger boat.
  assert.notEqual(militarySiteGlyph('airfield'), transitVehicleGlyph('air'));
  assert.notEqual(militarySiteGlyph('naval_base'), transitVehicleGlyph('ferry'));
});


// ── The France pack, and what it lets the layer draw past the live gate ──────

test('the live answer wins the merge, and the pack fills the rest of the view', () => {
  // Same OSM id from both sources. The live record is the one with a footprint
  // and the one surveyed for THIS view, so it must be the one drawn — a pack
  // point winning would silently drop a base's outline the moment it loaded.
  const live = [{ id: 'osm:way:1', class: 'military_land', named: true, footprint: [[0, 0]] }];
  const pack = [
    { id: 'osm:way:1', class: 'military_land', named: true, pack: true },
    { id: 'osm:way:2', class: 'airfield', named: false, pack: true },
  ];
  const cohort = mergeInstallationCohort(live, pack);
  assert.equal(cohort.length, 2, 'one record per OSM id');
  assert.equal(cohort.find((one) => one.id === 'osm:way:1').pack, undefined);
  assert.ok(cohort.find((one) => one.id === 'osm:way:1').footprint);
});

test('the render cap drops the fourre-tout, never the classes that name a subject', () => {
  // A5, as an order rather than an accident: the cohort used to be cut at 700
  // in whatever order Overpass answered in, so a région-wide view kept 700
  // arbitrary marks of which nine in ten said only "military".
  const cohort = mergeInstallationCohort([], [
    { id: 'osm:way:9', class: 'military_land', named: true },
    { id: 'osm:way:8', class: 'range', named: false },
    { id: 'osm:way:7', class: 'naval_base', named: false },
    { id: 'osm:way:6', class: 'airfield', named: false },
    { id: 'osm:way:5', class: 'airfield', named: true },
  ]);
  assert.deepEqual(cohort.map((one) => one.class),
    ['airfield', 'airfield', 'naval_base', 'range', 'military_land']);
  // Named first inside a class: a name is something a reader can look up.
  assert.equal(cohort[0].id, 'osm:way:5');
  // And the order depends on the records alone — never on the camera, or a
  // mark would come and go as the globe turned (G3).
  assert.deepEqual(mergeInstallationCohort([], [...cohort].reverse()).map((one) => one.id),
    cohort.map((one) => one.id));
});

test('the key declares what the view is not showing, and stays silent otherwise', () => {
  // A5 wants two things from a layer that clips: the count and the criterion.
  const clipped = installationKeyNote({
    drawn: 700, inView: 2400, fromPack: 700, packRetrievedAt: '2026-09-10',
  });
  assert.match(clipped, /700 marques sur 2400/);
  assert.match(clipped, /nommées/, 'the criterion must be stated, not just the count');
  assert.match(clipped, /2026-09-10/, 'a mark from a file dates from the day of that file');
  assert.match(clipped, /sans emprise/, 'the pack has no footprints and must say so');

  // Nothing clipped, nothing from the pack: a permanent note would be furniture.
  assert.equal(installationKeyNote({
    drawn: 12, inView: 12, fromPack: 0, packRetrievedAt: '2026-09-10',
  }), '');
});

test('the pack is fetched on enable, once, and never on boot', () => {
  // `?url` keeps ~470 kB out of the bundle; a DYNAMIC import keeps even the URL
  // off the boot path, so a visitor who never opens this layer never pays.
  const packSource = fs.readFileSync(new URL('./militaryFrancePack.js', import.meta.url), 'utf8');
  assert.doesNotMatch(packSource, /^import .*military-fr\.jsonl/m,
    'a static asset import would put the pack in the boot graph');
  assert.match(packSource, /await import\('\.\/local_data\/military\/military-fr\.jsonl\?url'\)/);
  assert.match(installationsSource, /enable\(\) \{[^]*?ensureFrancePack\(\);/,
    'the pack is requested when the layer is switched on');
  assert.match(installationsSource,
    /function ensureFrancePack\(\) \{\n\s*if \(state\.pack\.length \|\| state\.packLoading\) return;/,
    'a second enable must not re-fetch the pack');
});
