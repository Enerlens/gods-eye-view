import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  GROUND_SAMPLE_MAX_ARMED_RETRIES,
  LOCAL_OVERLAY_COHORT_LIMIT,
  LOCAL_STEM_TIP_EPSILON_M,
  applyLocalSurfaceStyle,
  createLocalGeoJsonLayer,
  localFootprintFitsScreen,
  localFootprintGeometry,
  LOCAL_POOL_KIND,
  createLocalInfrastructureOverlayEntry,
  createLocalInfrastructureOverlayPublisher,
  localCullingVolume,
  localDatasetError,
  localInfrastructureOverlayCopy,
  localRecordOffScreen,
  localStemLiftM,
  selectLocalGlobeLodMarks,
  selectLocalInfrastructureOverlayCohort,
} from './localGeojson.js';
import { layerFeedState } from './manager.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  _resetRenderGovernorForTest,
} from '../renderGovernor.js';

// The recall stems are pooled polylines now, and a polyline carries a
// `Material`. Cesium types a material uniform by testing it against the DOM
// image classes — `uniformValue instanceof HTMLCanvasElement` and friends,
// `Material.js:1262` — and under `node --test` those identifiers do not exist,
// so a bare `Material.fromType('Color', …)` throws a ReferenceError before it
// ever reaches a GPU. Declaring the four names is a property of the harness:
// nothing here is ever an instance of them, so the `instanceof` chain falls
// through to the object branch the colour uniform actually belongs in. Same
// shim, same reason, as `anfrFrance.test.mjs`.
for (const name of ['HTMLCanvasElement', 'HTMLImageElement', 'ImageBitmap', 'OffscreenCanvas']) {
  if (!(name in globalThis)) globalThis[name] = class {};
}

class MockLayerEvent {
  constructor() {
    this.listeners = new Set();
    this.addCount = 0;
    this.removeCount = 0;
  }

  addEventListener(listener) {
    this.addCount++;
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.removeCount++;
      this.listeners.delete(listener);
    };
  }

  raise(...args) {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.sampleHeightSupported] Scene height-sampling capability.
 * @param {Function} [options.sampleHeight] Initial scene.sampleHeight behavior
 *   (default: throws like a scene whose tiles are not sampleable yet).
 */
async function createRealLocalLayerHarness({
  sampleHeightSupported = false,
  sampleHeight = () => { throw new Error('tiles not sampleable yet'); },
} = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const preRender = new MockLayerEvent();
  /** Primitives the layer seats in the scene — the stem and segment batches. */
  const primitives = [];
  const moveEnd = new MockLayerEvent();
  const dataSources = [];
  const hostCalls = [];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      type: 'Feature',
      id: 'real-dam',
      properties: { name: 'Runtime Dam', tags: { associated_river: 'Test River' } },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-97.70, 30.20],
          [-97.69, 30.20],
          [-97.69, 30.21],
          [-97.70, 30.20],
        ]],
      },
    }),
  });
  globalThis.window = { dispatchEvent() {} };
  let sampleHeightImpl = sampleHeight;
  const sampleCalls = { count: 0 };
  const overlayHost = {
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const viewer = {
    selectedEntity: undefined,
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(-97.695, 30.205, 100_000),
      frustum: { fov: Math.PI / 3 },
      moveEnd,
      flyTo() {},
    },
    scene: {
      canvas: { clientWidth: 800, clientHeight: 600 },
      // Every pack draws recall stems now, and they live in a pooled
      // `PolylineCollection` rather than on the entities — so a fake scene has
      // to own a primitive collection the way a real one always does.
      primitives: {
        add(primitive) { primitives.push(primitive); return primitive; },
        remove(primitive) {
          const at = primitives.indexOf(primitive);
          if (at >= 0) primitives.splice(at, 1);
          return at >= 0;
        },
      },
      preRender,
      sampleHeightSupported,
      sampleHeight: (...args) => {
        sampleCalls.count += 1;
        return sampleHeightImpl(...args);
      },
      screenSpaceCameraController: { enableInputs: true },
      pick() { return null; },
      requestRender() {},
    },
  };
  const layer = createLocalGeoJsonLayer({
    id: 'local-dams',
    url: '/runtime-dam.geojsonl',
    name: 'Runtime Dams',
    color: '#0088ff',
    overlayHost,
    projectToWindow: () => ({ x: 400, y: 300 }),
    screenSpaceEventHandlerFactory: () => ({
      setInputAction() {},
      destroy() {},
    }),
  });
  try {
    await layer.enable(viewer);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return {
    layer,
    viewer,
    dataSources,
    primitives,
    hostCalls,
    preRender,
    moveEnd,
    sampleCalls,
    /** Swap scene.sampleHeight mid-test (e.g. tiles finally arrive). */
    setSampleHeight(next) { sampleHeightImpl = next; },
    cleanup() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

/**
 * A three-point graded layer: one feature per group plus a second `minor`, so
 * a filter that hides a group can be told apart from one that hides a feature.
 * @param {object} [options]
 * @param {string} [options.floor] Initial display floor.
 */
async function createGradedLayerHarness({ floor = 'all' } = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const preRender = new MockLayerEvent();
  /** Primitives the layer seats in the scene — the stem and segment batches. */
  const primitives = [];
  const moveEnd = new MockLayerEvent();
  const hostCalls = [];
  const features = [
    { rank: 'major', name: 'Major One', lon: -97.70, lat: 30.20 },
    { rank: 'minor', name: 'Minor One', lon: -97.69, lat: 30.21 },
    { rank: 'minor', name: 'Minor Two', lon: -97.68, lat: 30.22 },
  ];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    // Polygons, not Points, for the same reason the dam harness uses one:
    // Cesium's GeoJSON loader builds a PIN BILLBOARD for every Point, and the
    // pin builder needs `document`. The layer treats both identically from the
    // stem down — it takes the polygon's centre and then assigns exactly the
    // same point/polyline graphics — so grading is exercised either way.
    text: async () => features.map((feature, index) => JSON.stringify({
      type: 'Feature',
      id: `graded-${index}`,
      properties: { name: feature.name, rank: feature.rank },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [feature.lon, feature.lat],
          [feature.lon + 0.005, feature.lat],
          [feature.lon + 0.005, feature.lat + 0.005],
          [feature.lon, feature.lat],
        ]],
      },
    })).join('\n'),
  });
  globalThis.window = { dispatchEvent() {} };
  const viewer = {
    selectedEntity: undefined,
    dataSources: { add(dataSource) { return dataSource; }, remove() { return true; } },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(-97.695, 30.205, 100_000),
      frustum: { fov: Math.PI / 3 },
      moveEnd,
      flyTo() {},
    },
    scene: {
      canvas: { clientWidth: 800, clientHeight: 600 },
      // Every pack draws recall stems now, and they live in a pooled
      // `PolylineCollection` rather than on the entities — so a fake scene has
      // to own a primitive collection the way a real one always does.
      primitives: {
        add(primitive) { primitives.push(primitive); return primitive; },
        remove(primitive) {
          const at = primitives.indexOf(primitive);
          if (at >= 0) primitives.splice(at, 1);
          return at >= 0;
        },
      },
      preRender,
      sampleHeightSupported: false,
      screenSpaceCameraController: { enableInputs: true },
      pick() { return null; },
      requestRender() {},
    },
  };
  const layer = createLocalGeoJsonLayer({
    id: 'local-ports',
    url: '/graded.geojsonl',
    name: 'Graded',
    color: '#0088ff',
    overlayHost: {
      setVisible: (...args) => hostCalls.push(['visible', ...args]),
      setEntries: (...args) => hostCalls.push(['entries', ...args]),
      clearSource: (...args) => hostCalls.push(['clear', ...args]),
    },
    projectToWindow: () => ({ x: 400, y: 300 }),
    screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
    groupOf: (props) => props.rank,
    groupStyles: {
      major: { color: '#ff0000', pixelSize: 14, stemWidth: 4 },
      minor: { color: '#00ff00', pixelSize: 6, stemWidth: 2 },
    },
    groupVisible: (key, params) => params.floor === 'all' || key === 'major',
    defaultParams: { floor },
    rowControls: (params, tally) => ({
      chips: [{ id: 'all', label: 'ALL', active: params.floor === 'all', params: { floor: 'all' } }],
      legend: [...tally.entries()].map(([key, bucket]) => ({
        label: key, color: '#fff', count: bucket.visible, total: bucket.total,
      })),
    }),
  });
  try {
    await layer.enable(viewer);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return {
    layer,
    viewer,
    preRender,
    hostCalls,
    cleanup() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

test('a graded local pack styles, tallies and filters by group', async () => {
  const harness = await createGradedLayerHarness();
  try {
    const { layer, preRender } = harness;
    assert.equal(layer.getStats().count, 3);

    // Every tier is drawn at its own size and colour — the whole point of
    // grading. Read off the live Cesium graphics, not off the options object.
    const controls = layer.getRowControls();
    assert.deepEqual(controls.legend, [
      { label: 'major', color: '#fff', count: 1, total: 1 },
      { label: 'minor', color: '#fff', count: 2, total: 2 },
    ], 'the tally counts loaded and drawn features per group');

    // One walk to let the pre-render visibility pass settle `show`.
    preRender.raise();
    const shows = () => layer.getRowControls().legend.map((entry) => entry.count);
    assert.deepEqual(shows(), [1, 2], 'everything is drawn under the open floor');

    // Narrow the floor: the minor group must leave the globe AND the legend,
    // while `getStats().count` keeps reporting the whole loaded pack.
    assert.equal(layer.setParams({ floor: 'majors' }), true);
    assert.deepEqual(shows(), [1, 0], 'the filtered group drops to zero drawn');
    assert.equal(layer.getStats().count, 3,
      'a display floor hides markers without losing them');

    // Re-applying the same floor is a no-op, so the panel does not repaint on
    // every refresh tick.
    assert.equal(layer.setParams({ floor: 'majors' }), false);

    // ...and it is reversible.
    assert.equal(layer.setParams({ floor: 'all' }), true);
    assert.deepEqual(shows(), [1, 2]);
  } finally {
    // destroy() reaches the context store, which reads `window` — so the layer
    // has to come down BEFORE the harness removes the global.
    await harness.layer.destroy?.(harness.viewer);
    harness.cleanup();
  }
});

test('an UNGRADED, UNMEASURED local pack exposes no row controls at all', async () => {
  // The manager decides whether to build a row's control strip by testing for
  // this method. Defining it unconditionally would give ports and airports an
  // empty strip. `local-ports` is the case: no groups, no size channel.
  const layer = createLocalGeoJsonLayer({
    id: 'local-ports',
    url: '/none.geojsonl',
    name: 'Ungraded',
    color: '#ffb14e',
  });
  assert.equal(typeof layer.getRowControls, 'undefined');
  assert.equal(typeof layer.setParams, 'undefined');
  assert.equal(typeof layer.setRowControlsListener, 'undefined');
});

test('a MEASURED pack gets a control strip for its size legend alone', () => {
  // D1: a size channel without a printed scale is unreadable, so a pack that
  // spends one qualifies for the strip even with no chips to put in it. Both
  // bundled ids resolve their renderer from PACK_RENDERERS with nothing
  // passed by the wiring file.
  for (const id of ['local-datacenters', 'local-dams']) {
    const layer = createLocalGeoJsonLayer({
      id, url: '/none.geojsonl', name: id, color: '#00ffff',
    });
    assert.equal(typeof layer.getRowControls, 'function', id);
    // Nothing loaded yet, so there is nothing to promise: an empty tally must
    // produce no rows rather than rows counting zero.
    assert.equal(layer.getRowControls(), null, id);
  }

  // A legend is not a chip row: `setParams` is the manager's whole
  // runtime-parameter surface (share links and the voice tools reach for it),
  // so a pack with a scale to print and nothing to filter must not grow one.
  const datacenters = createLocalGeoJsonLayer({
    id: 'local-datacenters', url: '/none.geojsonl', name: 'DC', color: '#00ffff',
  });
  assert.equal(typeof datacenters.setParams, 'undefined');
  assert.equal(typeof datacenters.setRowControlsListener, 'undefined');
});

test('local infrastructure card copy uses the validated source fields', () => {
  assert.deepEqual(localInfrastructureOverlayCopy({
    tags: {
      name: 'DFW-1',
      operator: 'Example Cloud',
      'capacity:it_load': '27 MW',
    },
  }, 'local-datacenters'), {
    title: 'DFW-1',
    details: ['Example Cloud · 27 MW'],
  });

  // Dams read the FLAT shipped shape written by scripts/build-osm-dams.mjs, not
  // raw OSM tags: the card lines live in src/data/damsPack.js beside the
  // projection that emits the fields, so the two cannot drift.
  assert.deepEqual(localInfrastructureOverlayCopy({
    name: 'Barrage Bin el Ouidane',
    river: 'El Abid',
    heightM: 133,
    hydro: true,
    outputMw: 135,
  }, 'local-dams'), {
    title: 'Barrage Bin el Ouidane',
    details: ['hydroélectrique · 135 MW', '133 m de haut', 'El Abid'],
  });

  assert.deepEqual(localInfrastructureOverlayCopy({
    tags: { name: 'Amazon Web Services', operator: 'Amazon Web Services' },
  }, 'local-datacenters'), {
    title: 'Amazon Web Services',
    details: [],
  });
});

test('a nameless dam card is titled by what the feature IS, not by the layer', () => {
  // 5 948 of the pack's 7 432 features carry no name, so the fallback title is
  // what 80% of these cards say. It used to be the LAYER's title, which called
  // 1 198 digues "Barrage" — including OSM w860215522, a 159 m runoff bund at
  // Octeville-sur-Mer with no water body within 250 m.
  assert.deepEqual(localInfrastructureOverlayCopy({
    osm: 'w860215522',
    kind: 'dyke',
    spanM: 159,
  }, 'local-dams'), {
    title: 'Digue',
    details: ['159 m de long'],
  });

  assert.equal(localInfrastructureOverlayCopy({ kind: 'dam' }, 'local-dams').title, 'Barrage');
  assert.equal(localInfrastructureOverlayCopy({ kind: 'dam+dyke' }, 'local-dams').title, 'Barrage-digue');
  // The world half has no kind left to read, and says only that much.
  assert.equal(localInfrastructureOverlayCopy({ spanM: 400 }, 'local-dams').title, 'Ouvrage');
  // A name in the data still wins — the fallback is a fallback.
  assert.equal(
    localInfrastructureOverlayCopy({ name: 'Digue de l’Étang', kind: 'dyke' }, 'local-dams').title,
    'Digue de l’Étang',
  );
  // Packs that are all one thing are untouched by the per-feature branch.
  assert.equal(localInfrastructureOverlayCopy({}, 'local-airports').title, 'Aérodrome');
  assert.equal(localInfrastructureOverlayCopy({}, 'local-ports').title, 'Port');
});

test('airport cards come from the pack module, clamped to the host width', () => {
  assert.deepEqual(localInfrastructureOverlayCopy({
    name: 'Nice-Côte d’Azur Airport',
    type: 'large_airport',
    icao: 'LFMN',
    iata: 'NCE',
    municipality: 'Nice',
    country: 'France',
    scheduled: true,
    runways: { count: 2, longestM: 2963, surface: 'revêtue' },
  }, 'local-airports'), {
    title: 'Nice-Côte d’Azur Airport',
    details: [
      'LFMN · NCE · vols réguliers',
      'Grand aéroport · piste 2 963 m revêtue',
      'France',
    ],
  });

  // The host, not the pack, owns the 48-character card width — a long French
  // commune name must be truncated here rather than overflow the card.
  const [, , place] = localInfrastructureOverlayCopy({
    name: 'Somewhere Airfield',
    type: 'small_airport',
    icao: 'LFXX',
    municipality: 'Saint-Remy-en-Bouzemont-Saint-Genest-et-Isson',
    country: 'France',
    runways: { count: 1, longestM: 800 },
  }, 'local-airports').details;
  assert.equal(place.length, 48);
  assert.ok(place.endsWith('...'), `expected a clamped place line, got "${place}"`);
});

test('local infrastructure entries satisfy the shared presentation contract', () => {
  const position = Cesium.Cartesian3.fromDegrees(-97.7, 30.2, 2000);
  const entry = createLocalInfrastructureOverlayEntry({
    id: 'dc-42',
    layerId: 'local-datacenters',
    position,
    properties: { tags: { name: 'AUS-1', operator: 'Example Cloud' } },
    priority: 1180,
    accent: '#00ffff',
  });

  assert.equal(entry.id, 'dc-42');
  assert.equal(entry.source, 'local-datacenters');
  assert.equal(entry.position, position, 'entry stays attached to the mutable stem-tip Cartesian');
  assert.equal(entry.variant, 'card');
  assert.equal(entry.title, 'AUS-1');
  assert.deepEqual(entry.details, ['Example Cloud']);
  assert.equal(entry.priority, 1180);
  assert.equal(entry.collisionGroup, 'ambient-card');
  assert.equal(
    entry.interactive,
    true,
    'the card carries the NAME and is the bigger target — it has to answer a click',
  );
  assert.equal(entry.maxDistance, 14_000_000);
  assert.equal(entry.distanceFadeStartRatio, 250_000 / 14_000_000);
  assert.deepEqual(entry.distanceScale, {
    near: 250_000,
    nearValue: 1,
    far: 9_000_000,
    farValue: 0.62,
  });
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(entry.horizonCull, true);
  assert.equal(entry.terrainOcclusion, false);
});

test('a short-range card fades inside its own range, never before it', () => {
  const position = Cesium.Cartesian3.fromDegrees(2.4, 48.7, 2000);
  const near = createLocalInfrastructureOverlayEntry({
    id: 'lfxx',
    layerId: 'local-airports',
    position,
    properties: { name: 'Aéroclub', type: 'small_airport' },
    priority: 100,
    accent: '#6d5a94',
    maxDistance: 200_000,
  });
  assert.equal(near.maxDistance, 200_000);
  // The shared 250 km fade start lies BEYOND this card's whole range; reusing
  // it would have made the card born already faded out. Half its range instead.
  assert.equal(near.distanceFadeStartRatio, 0.5);

  // A long-range card keeps the shared 250 km fade start, expressed as a ratio.
  const far = createLocalInfrastructureOverlayEntry({
    id: 'lfpg',
    layerId: 'local-airports',
    position,
    properties: { name: 'Roissy', type: 'large_airport' },
    priority: 310,
    accent: '#f0e6ff',
    maxDistance: 14_000_000,
  });
  assert.equal(far.distanceFadeStartRatio * far.maxDistance, 250_000);

  // A missing or nonsense range falls back to the shared ceiling rather than
  // producing a card nothing could ever see.
  for (const bad of [undefined, 0, -1, NaN, 'lots']) {
    const entry = createLocalInfrastructureOverlayEntry({
      id: 'x', layerId: 'local-ports', position, properties: {}, priority: 1, accent: '#fff',
      maxDistance: bad,
    });
    assert.equal(entry.maxDistance, 14_000_000, String(bad));
  }
});

test('shipped local cohorts keep one grid winner plus bounded surplus contenders', () => {
  const makeRecord = (id, priority, x, y = 20) => ({
    id,
    priority,
    screen: { x, y },
    entry: { id },
  });
  const sameCell = [
    makeRecord('low', 1, 20),
    makeRecord('high', 3, 21),
    makeRecord('mid', 2, 22),
    makeRecord('offscreen', 100, -500),
  ];
  const selected = selectLocalInfrastructureOverlayCohort(sameCell, {
    maxEntries: 700,
    cohortLimit: LOCAL_OVERLAY_COHORT_LIMIT,
    gridPx: 138,
    width: 1440,
    height: 900,
    project: (record) => record.screen,
  });
  assert.deepEqual(selected.map(({ id }) => id), ['high', 'mid']);

  const field = Array.from({ length: 220 }, (_, index) => makeRecord(
    `record-${index}`,
    1000 - index,
    index * 140,
  ));
  const datacenters = selectLocalInfrastructureOverlayCohort(field, {
    maxEntries: 700,
    cohortLimit: LOCAL_OVERLAY_COHORT_LIMIT,
    gridPx: 138,
    width: 150_000,
    height: 900,
    project: (record) => record.screen,
  });
  const dams = selectLocalInfrastructureOverlayCohort(field, {
    maxEntries: 900,
    cohortLimit: LOCAL_OVERLAY_COHORT_LIMIT,
    gridPx: 132,
    width: 150_000,
    height: 900,
    project: (record) => record.screen,
  });
  assert.equal(datacenters.length, LOCAL_OVERLAY_COHORT_LIMIT);
  assert.equal(dams.length, LOCAL_OVERLAY_COHORT_LIMIT);

  const pairedCells = Array.from({ length: 120 }, (_, index) => [
    makeRecord(`primary-${index}`, 1000, index * 140),
    makeRecord(`surplus-${index}`, 900, index * 140 + 1),
  ]).flat();
  const hostBound = selectLocalInfrastructureOverlayCohort(pairedCells, {
    maxEntries: 700,
    cohortLimit: LOCAL_OVERLAY_COHORT_LIMIT,
    gridPx: 138,
    width: 20_000,
    height: 900,
    project: (record) => record.screen,
  });
  assert.equal(hostBound.length, LOCAL_OVERLAY_COHORT_LIMIT);
  assert.equal(hostBound.filter(({ id }) => id.startsWith('primary-')).length, 120);
  assert.equal(hostBound.filter(({ id }) => id.startsWith('surplus-')).length, 40);
});

test('local overlay publisher owns add/remove/visibility lifecycle and becomes inert on destroy', () => {
  const calls = [];
  const publisher = createLocalInfrastructureOverlayPublisher({
    sourceId: 'local-datacenters',
    host: {
      setVisible: (...args) => calls.push(['visible', ...args]),
      setEntries: (...args) => calls.push(['entries', ...args]),
      clearSource: (...args) => calls.push(['clear', ...args]),
    },
  });

  publisher.publish([{ id: 'ignored-before-show' }]);
  publisher.show();
  publisher.show();
  publisher.publish([{ id: 'dc-1' }]);
  publisher.publish([]);
  publisher.hide();
  publisher.show();
  publisher.publish([{ id: 'dc-2' }]);
  publisher.destroy();
  const countAtDestroy = calls.length;
  publisher.show();
  publisher.publish([{ id: 'zombie' }]);

  assert.equal(calls.length, countAtDestroy, 'destroyed publishers reject late source work');
  assert.deepEqual(calls[0], ['visible', 'local-datacenters', true]);
  assert.deepEqual(calls[1].slice(0, 3), ['entries', 'local-datacenters', [{ id: 'dc-1' }]]);
  assert.deepEqual(calls[1][3], {
    cohortLimit: LOCAL_OVERLAY_COHORT_LIMIT,
    collisionCapacity: 96,
    moving: false,
  });
  assert.deepEqual(calls[2].slice(0, 3), ['entries', 'local-datacenters', []]);
  assert.deepEqual(calls[3], ['visible', 'local-datacenters', false]);
  assert.deepEqual(calls[4], ['visible', 'local-datacenters', true]);
  assert.deepEqual(calls[6], ['clear', 'local-datacenters']);
  assert.deepEqual(calls[7], ['visible', 'local-datacenters', false]);
});

test('real layer disable clears its published host entries and balances settle listeners', async () => {
  const env = await createRealLocalLayerHarness();
  env.preRender.raise();
  assert.ok(env.hostCalls.some(([type]) => type === 'entries'), 'real preRender path did not publish');

  env.layer.disable(env.viewer);
  assert.ok(
    env.hostCalls.some((call) => call[0] === 'clear' && call[1] === 'local-dams'),
    'real disable path must clear the host source',
  );
  assert.equal(env.moveEnd.listeners.size, 0);
  assert.equal(env.moveEnd.addCount, 1);
  assert.equal(env.moveEnd.removeCount, 1);

  await env.layer.enable(env.viewer);
  await env.layer.enable(env.viewer);
  assert.equal(env.moveEnd.listeners.size, 1, 'repeated enable must retain one settle listener');
  env.layer.disable(env.viewer);
  assert.equal(env.moveEnd.addCount, 2);
  assert.equal(env.moveEnd.removeCount, 2);

  await env.layer.enable(env.viewer);
  env.layer.destroy(env.viewer);
  assert.equal(env.moveEnd.listeners.size, 0);
  assert.equal(env.moveEnd.addCount, 3);
  assert.equal(env.moveEnd.removeCount, 3);
  const addCountAtDestroy = env.moveEnd.addCount;
  await env.layer.enable(env.viewer);
  assert.equal(env.moveEnd.addCount, addCountAtDestroy, 'destroyed layer must stay permanently inert');
  env.cleanup();
});

test('the PropertyBag is dropped once its values have been unwrapped', async () => {
  // 14.0 KiB per feature, measured on the airports pack (12 keys), against
  // 33.6 KiB for the whole drawn feature — 42 % of what an infra pack costs,
  // for a SECOND copy of properties this file has already unwrapped into a
  // plain object. What has to survive is the plain object: the card, the label,
  // the legend and the voice scan all read that one.
  const env = await createRealLocalLayerHarness();
  const entity = env.dataSources[0].entities.values[0];

  assert.equal(entity.properties, undefined, 'the bag is gone');
  assert.deepEqual(entity.__localProperties, {
    name: 'Runtime Dam',
    tags: { associated_river: 'Test River' },
  }, 'and the unwrapped values are on the entity, by reference');

  // The same object, not a copy: the context record is what the card and the
  // voice scan read, and a second copy would be the very duplication this
  // change removes.
  const record = globalThis.window.__gevContextStore?.entities?.get(entity.__gevContextId);
  assert.ok(record, 'the feature is in the context store');
  assert.equal(record.properties, entity.__localProperties, 'one object, two references');

  // And the card still says what the properties say — the drop happens after
  // every reader in the load loop has had them.
  assert.ok(env.hostCalls.length > 0);
  env.layer.destroy(env.viewer);
  env.cleanup();
});

test('unchanged moveEnds do not redefine the tip, and the stem is dealt from a pool', async () => {
  // TWO invariants, and they used to be one because the stem WAS the entity.
  //
  // The tip is still a `Property` — the mark rides it — so sub-epsilon camera
  // noise must not redefine it. The SHAFT is a pooled `Polyline` now, so what
  // has to hold for it is different and stronger: the pool holds exactly the
  // stems that are drawn, it is dealt only on a settle, and its polylines own
  // their positions arrays rather than sharing a scratch.
  const env = await createRealLocalLayerHarness();
  env.preRender.raise();
  const entity = env.dataSources[0].entities.values[0];
  assert.equal(entity.polyline, undefined, 'the shaft no longer costs a PolylineGraphics');

  // The pool is the primitive the layer seated in the scene.
  const stems = env.primitives.find((primitive) => primitive[LOCAL_POOL_KIND] === 'stems');
  assert.ok(stems, 'the stem batch reached the scene');
  // A layer seats TWO polyline batches and every polyline in both carries a
  // feature of the same layer as its pick id, so the tag is the only thing that
  // tells a reader — or `qa-airports` — which batch it is holding.
  assert.ok(stems instanceof Cesium.PolylineCollection);
  assert.equal(stems.length, 1, 'one drawn record, one pooled stem');
  const line = stems.get(0);
  assert.equal(line.show, true);
  assert.equal(line.id, entity, 'a click on the shaft still resolves to its feature');
  assert.equal(line.positions.length, 2);
  assert.equal(
    Math.round(Cesium.Cartographic.fromCartesian(line.positions[0]).height), 0,
    'the shaft stands on the ground anchor',
  );
  assert.ok(
    Cesium.Cartographic.fromCartesian(line.positions[1]).height > 0,
    'and reaches the tip the mark rides',
  );

  let positionSetCalls = 0;
  const originalPositionSet = entity.position.setValue.bind(entity.position);
  entity.position.setValue = (...args) => {
    positionSetCalls++;
    return originalPositionSet(...args);
  };

  env.moveEnd.raise();
  env.preRender.raise();
  env.moveEnd.raise();
  env.preRender.raise();
  assert.equal(positionSetCalls, 0);
  assert.equal(stems.length, 1, 'a settle that changes nothing grows no pool');

  const camera = env.viewer.camera.positionWC;
  env.viewer.camera.positionWC = Cesium.Cartesian3.add(
    camera,
    new Cesium.Cartesian3(LOCAL_STEM_TIP_EPSILON_M / 10, 0, 0),
    new Cesium.Cartesian3(),
  );
  env.moveEnd.raise();
  env.preRender.raise();
  assert.equal(positionSetCalls, 0, 'sub-epsilon camera noise must not redefine the tip');

  env.viewer.camera.positionWC = Cesium.Cartesian3.add(
    camera,
    new Cesium.Cartesian3(10_000, 0, 0),
    new Cesium.Cartesian3(),
  );
  env.moveEnd.raise();
  env.preRender.raise();
  assert.equal(positionSetCalls, 1);
  assert.equal(stems.length, 1, 'the pool is reused, never grown, for the same drawn record');
  assert.equal(stems.get(0), line, 'and it is the same polyline');

  // The entry owns its array and its two Cartesians: `Polyline` keeps the array
  // BY REFERENCE and reads it back during the render, so a scratch shared
  // between entries would be overwritten before it was drawn.
  const tipCartesian = line.positions[1];
  env.viewer.camera.positionWC = Cesium.Cartesian3.add(
    camera,
    new Cesium.Cartesian3(40_000, 0, 0),
    new Cesium.Cartesian3(),
  );
  env.moveEnd.raise();
  env.preRender.raise();
  assert.equal(positionSetCalls, 2);
  assert.equal(line.positions[1], tipCartesian, 'the entry writes its own Cartesian in place');

  // A record that stops being drawn releases its stem rather than keeping it in
  // the buffer: a hidden polyline still costs its vertices in the shader.
  env.layer.disable(env.viewer);
  assert.equal(stems.show, false, 'the batch goes down with the row');

  env.layer.destroy(env.viewer);
  env.cleanup();
});

test('between settles a stem follows its mark behind the globe, and comes back', async () => {
  // The horizon is the ONE gate re-tested on every pass — a camera moves for a
  // second or more before `moveEnd` fires — and the stem is a pooled primitive
  // now, so `entity.show` no longer carries it. Without the pass-by-pass write
  // a shaft would hang over the far side of the planet for the whole of a drag.
  const env = await createRealLocalLayerHarness();
  env.preRender.raise();
  const entity = env.dataSources[0].entities.values[0];
  const stems = env.primitives.find((primitive) => primitive[LOCAL_POOL_KIND] === 'stems');
  const line = stems.get(0);
  assert.equal(line.show, true);
  assert.equal(entity.show, true);

  // The walk is throttled to VISIBILITY_UPDATE_MS and a settle is what normally
  // opens it early — which is exactly what this test must NOT use. So the clock
  // moves instead of the camera settling.
  const realNow = globalThis.performance.now.bind(globalThis.performance);
  let clock = realNow();
  globalThis.performance.now = () => clock;
  try {
    // Antipodal camera, and NO moveEnd: this is mid-drag, the pool is not dealt.
    const near = env.viewer.camera.positionWC;
    env.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(82.3, -30.2, 100_000);
    clock += 1_000;
    env.preRender.raise();
    assert.equal(entity.show, false, 'the mark goes over the horizon');
    assert.equal(line.show, false, 'and so does its shaft');
    assert.equal(stems.length, 1, 'a pass between settles deals nothing');

    env.viewer.camera.positionWC = near;
    clock += 1_000;
    env.preRender.raise();
    assert.equal(entity.show, true);
    assert.equal(line.show, true, 'and it comes back with it');
    assert.equal(stems.length, 1, 'reusing the entry it already owns');

    // And a mark that was NOT drawn at the last settle, coming over the horizon
    // mid-drag, is dealt a shaft rather than left floating over nothing: the
    // record owns no entry, so `showStem` gives it one on the spot.
    env.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(82.3, -30.2, 100_000);
    clock += 1_000;
    env.preRender.raise();
    env.moveEnd.raise();
    env.preRender.raise();
    assert.equal(line.show, false, 'the settle released it while it was hidden');
    env.viewer.camera.positionWC = near;
    clock += 1_000;
    env.preRender.raise();
    assert.equal(entity.show, true);
    const drawn = [...Array(stems.length)].filter((_, i) => stems.get(i).show).length;
    assert.equal(drawn, 1, 'exactly one shaft, dealt between settles');
  } finally {
    globalThis.performance.now = realNow;
  }

  env.layer.destroy(env.viewer);
  env.cleanup();
});

test('a real enabled local layer has no native label graphics at runtime', async () => {
  const env = await createRealLocalLayerHarness();
  const entities = env.dataSources[0].entities.values;
  assert.ok(entities.length > 0, 'runtime guard requires a populated real data source');
  assert.ok(entities.every((entity) => entity.label === undefined));
  env.layer.destroy(env.viewer);
  env.cleanup();
});

test('local infrastructure creates no native labels or per-frame geometry callbacks', () => {
  const source = readFileSync(new URL('./localGeojson.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new Cesium\.LabelGraphics/);
  assert.doesNotMatch(source, /new Cesium\.CallbackProperty/);
  assert.match(source, /feature\.position = tip/);
  assert.match(source, /record\.entity\.position\.setValue\(record\.tip\)/);
  // The stem is a pooled primitive, not entity graphics: no `PolylineGraphics`
  // is built per feature, and the deal writes the pool entry's own array.
  assert.doesNotMatch(source, /feature\.polyline = new Cesium\.PolylineGraphics/);
  assert.match(source, /entry\.line\.positions = entry\.positions/);
  assert.match(source, /viewer\.camera\.moveEnd\.addEventListener/);
  assert.match(source, /if \(refreshStemGeometry\)/);
  assert.match(source, /now - _lastVisibilityUpdate < VISIBILITY_UPDATE_MS/);
});

// ─── Bundled-dataset failure surfacing (roadmap L7) ───────────
//
// These datasets ship with the build, so a failed load means a broken
// install. Before this contract the catch only logged: a dead layer and an
// empty one both reported {count: 0} and the manager painted a green ON chip.

/** Build the failing layer alone — the harness above owns the happy path. */
async function enableLayerWithFetch(fetchImpl, { dataSources, windowStub } = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = windowStub || { dispatchEvent() {} };
  const viewer = {
    dataSources: dataSources || { add() {}, remove() { return true; } },
    camera: { positionWC: Cesium.Cartesian3.fromDegrees(0, 0, 1000), moveEnd: new MockLayerEvent() },
    scene: { canvas: {}, preRender: new MockLayerEvent(), pick() { return null; } },
  };
  const layer = createLocalGeoJsonLayer({
    id: 'local-dams',
    url: '/missing.geojsonl',
    name: 'Barrages',
    color: '#0088ff',
    overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
    screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
  });
  const enable = async () => {
    globalThis.fetch = fetchImpl;
    try {
      await layer.enable(viewer);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };
  await enable();
  const cleanup = () => {
    layer.destroy(viewer);
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  };
  return { layer, viewer, cleanup, enable };
}

test('a bundled-dataset failure reduces to a short, honest reason', () => {
  assert.equal(
    localDatasetError(new SyntaxError('Unexpected token < in JSON at position 0')),
    'dataset is malformed',
  );
  assert.equal(localDatasetError(new Error('HTTP 404')), 'dataset unavailable (HTTP 404)');
  assert.equal(localDatasetError(new Error('')), 'dataset unavailable');
  assert.equal(localDatasetError(undefined), 'dataset unavailable');
});

test('a missing dataset reports UNAVAILABLE instead of a silent empty layer', async () => {
  const { layer, cleanup } = await enableLayerWithFetch(async () => ({
    ok: false,
    status: 404,
    text: async () => '<!DOCTYPE html>',
  }));
  const stats = layer.getStats();
  assert.equal(stats.count, 0);
  assert.equal(stats.lastUpdate, null);
  assert.equal(stats.error, 'dataset unavailable (HTTP 404)');
  assert.equal(layerFeedState(stats), 'unavailable');
  cleanup();
});

test('a corrupt dataset line reports malformed rather than parsing into nothing', async () => {
  const { layer, cleanup } = await enableLayerWithFetch(async () => ({
    ok: true,
    status: 200,
    text: async () => '{"type":"Feature"\n',
  }));
  const stats = layer.getStats();
  assert.equal(stats.error, 'dataset is malformed');
  assert.equal(layerFeedState(stats), 'unavailable');
  cleanup();
});

// Polygon, like the harness above: Cesium builds Point features through a
// canvas pin builder, which needs a DOM these tests do not have.
const ONE_POLYGON_FEATURE = JSON.stringify({
  type: 'Feature',
  id: 'dam-1',
  properties: { name: 'Test Dam' },
  geometry: {
    type: 'Polygon',
    coordinates: [[[-97.70, 30.20], [-97.69, 30.20], [-97.69, 30.21], [-97.70, 30.20]]],
  },
});

const serveOnePolygon = async () => ({
  ok: true,
  status: 200,
  text: async () => ONE_POLYGON_FEATURE,
});

/**
 * Scene collection with Cesium's real timing: DataSourceCollection.add()
 * returns a promise and inserts on a LATER microtask, so the source is not in
 * the collection when add() returns. A synchronous mock hides exactly the bug
 * this models.
 */
function asyncDataSources({ rejectAdd = false } = {}) {
  const added = [];
  return {
    added,
    add(dataSource) {
      if (rejectAdd) return Promise.reject(new Error('scene rejected the data source'));
      return Promise.resolve().then(() => {
        added.push(dataSource);
        return dataSource;
      });
    },
    remove(dataSource) {
      const index = added.indexOf(dataSource);
      if (index >= 0) added.splice(index, 1);
      return index >= 0;
    },
  };
}

/** A window whose context store throws once — an exception during post-processing. */
function windowThatFailsOnce() {
  let armed = true;
  let store;
  return {
    dispatchEvent() {},
    get __gevContextStore() {
      if (armed) {
        armed = false;
        throw new Error('post-processing failed');
      }
      return store;
    },
    set __gevContextStore(value) { store = value; },
  };
}

test('a post-processing failure after the scene accepts the source rolls it back, and the retry does not double-add', async () => {
  // The window between GeoJsonDataSource.load() and the end of entity
  // post-processing. Publishing early made every later enable() skip the
  // loader; rolling back before the add settled left Cesium to insert the
  // "removed" source afterwards, which the retry would then double up on.
  const scene = asyncDataSources();
  const { layer, cleanup, enable } = await enableLayerWithFetch(serveOnePolygon, {
    dataSources: scene,
    windowStub: windowThatFailsOnce(),
  });

  const failed = layer.getStats();
  assert.equal(failed.error, 'dataset unavailable (post-processing failed)');
  assert.equal(failed.count, 0);
  assert.equal(failed.lastUpdate, null);
  assert.equal(layerFeedState(failed), 'unavailable');
  assert.equal(scene.added.length, 0,
    'rollback must remove the source the scene already accepted');

  await enable();
  const retried = layer.getStats();
  assert.equal(retried.error, null, 'the retry must clear the error, not skip the loader');
  assert.equal(retried.count, 1);
  assert.ok(Number.isFinite(retried.lastUpdate));
  assert.equal(scene.added.length, 1, 'the retry must not leave two sources in the scene');
  cleanup();
});

test('a rejected scene add surfaces as an error instead of healthy stats', async () => {
  const scene = asyncDataSources({ rejectAdd: true });
  const { layer, cleanup } = await enableLayerWithFetch(serveOnePolygon, {
    dataSources: scene,
  });
  const stats = layer.getStats();
  assert.equal(stats.error, 'dataset unavailable (scene rejected the data source)');
  assert.equal(stats.count, 0);
  assert.equal(stats.lastUpdate, null);
  assert.equal(layerFeedState(stats), 'unavailable');
  assert.equal(scene.added.length, 0);
  cleanup();
});

test('a loaded dataset is distinguishable from a dead one', async () => {
  const env = await createRealLocalLayerHarness();
  const stats = env.layer.getStats();
  assert.equal(stats.error, null);
  assert.ok(stats.count > 0);
  assert.ok(Number.isFinite(stats.lastUpdate), 'a successful load must timestamp itself');
  assert.equal(layerFeedState(stats), 'nominal');
  env.layer.destroy(env.viewer);
  env.cleanup();
});

// ── Ground-sample retry vs the idle render governor ───────────────────────────
//
// These layers take NO continuous hold and have updateInterval 0, so nothing
// else ever asks for a frame. The stem grounding retry lives in preRender: if
// the first sample fails (tiles not yet sampleable) and no frame is scheduled,
// a parked camera never produces the retry frame and the stem stays at
// ellipsoid height — buried in, or floating over, the photoreal mesh until the
// user happens to move. main retried continuously; under the governor the
// retry must schedule its own frame. (perf rebase 2026-08-17)

/** Drop the camera to `altM` above the fixture dam so retries are in range. */
function setCameraAltitude(env, altM) {
  env.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(-97.695, 30.205, altM);
}

function governorReasons() {
  return getRenderGovernorDiagnostics().recentRequests.map((entry) => entry.reason);
}

test('a failed ground sample schedules the retry frame the idle governor would never produce', async (t) => {
  const env = await createRealLocalLayerHarness({ sampleHeightSupported: true });
  _resetRenderGovernorForTest();
  installRenderGovernor({ scene: { requestRender() {} } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    env.layer.destroy(env.viewer);
    env.cleanup();
    _resetRenderGovernorForTest();
  });

  // Close enough that a retry could succeed, on a scene that CAN sample but
  // whose tiles are not sampleable yet — a camera parked over a dam while the
  // photoreal mesh is still streaming in.
  setCameraAltitude(env, 20_000);
  env.preRender.raise();

  assert.ok(
    !governorReasons().some((reason) => reason.startsWith('local-ground-retry')),
    'the request must be DEFERRED by the retry window, not fired inline',
  );
  t.mock.timers.tick(2_100); // GROUND_SAMPLE_RETRY_MS (2000) + slack
  assert.ok(
    governorReasons().includes('local-ground-retry:local-dams'),
    `expected a scheduled retry render; saw ${JSON.stringify(governorReasons())}`,
  );
});

test('a far camera arms no retry render — the governor stays fully idle', async (t) => {
  const env = await createRealLocalLayerHarness({ sampleHeightSupported: true });
  _resetRenderGovernorForTest();
  installRenderGovernor({ scene: { requestRender() {} } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    env.layer.destroy(env.viewer);
    env.cleanup();
    _resetRenderGovernorForTest();
  });

  // 400 km up: way beyond GROUND_SAMPLE_MAX_DISTANCE_M, so no retry can ever
  // succeed and asking for frames would just spin the governor forever.
  setCameraAltitude(env, 400_000);
  env.preRender.raise();
  t.mock.timers.tick(5_000);

  assert.ok(
    !governorReasons().some((reason) => reason.startsWith('local-ground-retry')),
    `a far camera must not request frames; saw ${JSON.stringify(governorReasons())}`,
  );
});

test('disable cancels a pending ground-retry render', async (t) => {
  const env = await createRealLocalLayerHarness({ sampleHeightSupported: true });
  _resetRenderGovernorForTest();
  installRenderGovernor({ scene: { requestRender() {} } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    env.layer.destroy(env.viewer);
    env.cleanup();
    _resetRenderGovernorForTest();
  });

  setCameraAltitude(env, 20_000);
  env.preRender.raise();
  env.layer.disable(env.viewer);
  t.mock.timers.tick(5_000);

  assert.ok(
    !governorReasons().some((reason) => reason.startsWith('local-ground-retry')),
    `a disabled layer must not wake the scene; saw ${JSON.stringify(governorReasons())}`,
  );
});

// ── The retry must be able to STOP (second review) ───────────────────────────
//
// The retry above arms itself off its own requested frame, so anything that
// makes the sample permanently impossible turns it into a perpetual-motion
// machine: every frame it asks for schedules the next 2 s timer, and the idle
// governor never gets to sleep. Two gates close that: the scene CAPABILITY
// (a scene that cannot sample heights must never arm) and a bounded budget of
// consecutive arms (a sampleable scene with no sampleable surface).

/** Freeze performance.now so the 450 ms visibility gate is under test control. */
function installFakeClock(t, startMs = 1_000_000) {
  const original = performance.now;
  let nowMs = startMs;
  performance.now = () => nowMs;
  t.after(() => { performance.now = original; });
  return { advance(ms) { nowMs += ms; } };
}

/**
 * Run the self-armed retry chain: each preRender walk arms a timer, the timer
 * asks the governor for a frame, and that frame is the next walk.
 */
function runArmedRetryChain(env, t, clock, cycles) {
  for (let i = 0; i < cycles; i += 1) {
    env.preRender.raise();
    clock.advance(2_100); // > GROUND_SAMPLE_RETRY_MS, in lockstep with the timers
    t.mock.timers.tick(2_100);
  }
}

/** Height of the (mutated-in-place) stem base — 0 until a sample lands. */
function baseHeightM(env) {
  const entity = env.dataSources[0].entities.values[0];
  return Cesium.Cartographic.fromCartesian(entity.__localBaseCartesian).height;
}

/**
 * Count Cartesian3.distance calls. The retry path costs one per ungrounded
 * record per walk; on a scene that cannot sample, every one of them is waste
 * (O(N) every 450 ms in a keyless scene that some other layer keeps awake).
 */
function countDistanceCalls(t) {
  const original = Cesium.Cartesian3.distance;
  const calls = { count: 0 };
  Cesium.Cartesian3.distance = (...args) => {
    calls.count += 1;
    return original(...args);
  };
  t.after(() => { Cesium.Cartesian3.distance = original; });
  return calls;
}

test('a scene that cannot sample heights never arms a retry — not even once', async (t) => {
  // Keyless/no-sampleable-surface scene: sampleHeightSupported === false, so a
  // retry can NEVER succeed. Arming here re-armed forever (one 2 s timer per
  // requested frame) and quietly defeated the idle governor.
  const env = await createRealLocalLayerHarness({ sampleHeightSupported: false });
  _resetRenderGovernorForTest();
  const governorScene = { renders: 0, requestRender() { this.renders += 1; } };
  installRenderGovernor({ scene: governorScene });
  governorScene.renders = 0; // discard the governor's own install settling frame
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = installFakeClock(t);
  t.after(() => {
    env.layer.destroy(env.viewer);
    env.cleanup();
    _resetRenderGovernorForTest();
  });

  setCameraAltitude(env, 20_000); // in range: the ONLY thing missing is the capability
  // Settle the one-off geometry refresh (that walk legitimately measures the
  // camera distance to size the stem), then measure the STEADY state.
  env.preRender.raise();
  clock.advance(2_100);
  const distances = countDistanceCalls(t);
  runArmedRetryChain(env, t, clock, 5);

  assert.equal(governorScene.renders, 0, 'an unsampleable scene must ask for no frames at all');
  assert.ok(
    !governorReasons().some((reason) => reason.startsWith('local-ground-retry')),
    `no retry may be armed without the capability; saw ${JSON.stringify(governorReasons())}`,
  );
  assert.equal(env.sampleCalls.count, 0, 'and it must not even attempt the sample');
  assert.equal(
    distances.count,
    0,
    'nor spend a single per-record distance on a retry that cannot succeed',
  );
  assert.equal(baseHeightM(env), 0, 'records stay at ellipsoid height — the pre-perf behavior');
});

test('a sampleable scene still measures the retry distance it needs', async (t) => {
  // The mirror of the guard above: the capability check must gate the work, not
  // remove it — a scene that CAN sample still pays one distance per walk.
  const env = await createRealLocalLayerHarness({ sampleHeightSupported: true });
  _resetRenderGovernorForTest();
  installRenderGovernor({ scene: { requestRender() {} } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = installFakeClock(t);
  t.after(() => {
    env.layer.destroy(env.viewer);
    env.cleanup();
    _resetRenderGovernorForTest();
  });

  setCameraAltitude(env, 20_000);
  env.preRender.raise();
  clock.advance(2_100);
  const distances = countDistanceCalls(t);
  runArmedRetryChain(env, t, clock, 5);

  assert.ok(distances.count > 0, 'the retry path must still measure range when it can sample');
  assert.ok(env.sampleCalls.count > 0, 'and must still attempt the sample');
});

test('capability arriving late re-opens a spent budget without camera motion', async (t) => {
  // WebGL context restore / a tileset that only becomes sampleable later. A
  // parked camera has no moveEnd to re-open the budget, so the false→true edge
  // must do it — otherwise the layer stays permanently given-up.
  const env = await createRealLocalLayerHarness({ sampleHeightSupported: true });
  _resetRenderGovernorForTest();
  const governorScene = { renders: 0, requestRender() { this.renders += 1; } };
  installRenderGovernor({ scene: governorScene });
  governorScene.renders = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = installFakeClock(t);
  t.after(() => {
    env.layer.destroy(env.viewer);
    env.cleanup();
    _resetRenderGovernorForTest();
  });

  setCameraAltitude(env, 20_000);
  runArmedRetryChain(env, t, clock, GROUND_SAMPLE_MAX_ARMED_RETRIES + 2);
  assert.equal(governorScene.renders, GROUND_SAMPLE_MAX_ARMED_RETRIES, 'budget spent');

  // Context lost, then restored — with the camera never touched.
  env.viewer.scene.sampleHeightSupported = false;
  runArmedRetryChain(env, t, clock, 2);
  assert.equal(governorScene.renders, GROUND_SAMPLE_MAX_ARMED_RETRIES, 'no arming while unsupported');

  env.viewer.scene.sampleHeightSupported = true;
  runArmedRetryChain(env, t, clock, 3);
  assert.equal(
    governorScene.renders,
    GROUND_SAMPLE_MAX_ARMED_RETRIES + 3,
    'the false→true edge must re-open the budget on a parked camera',
  );
});

test('a sampleable scene that keeps failing gives up after a bounded run of arms', async (t) => {
  // Supported, but nothing under the feature is sampleable: every retry fails.
  const env = await createRealLocalLayerHarness({ sampleHeightSupported: true });
  _resetRenderGovernorForTest();
  const governorScene = { renders: 0, requestRender() { this.renders += 1; } };
  installRenderGovernor({ scene: governorScene });
  governorScene.renders = 0; // discard the governor's own install settling frame
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = installFakeClock(t);
  t.after(() => {
    env.layer.destroy(env.viewer);
    env.cleanup();
    _resetRenderGovernorForTest();
  });

  setCameraAltitude(env, 20_000);
  runArmedRetryChain(env, t, clock, GROUND_SAMPLE_MAX_ARMED_RETRIES);
  assert.equal(
    governorScene.renders,
    GROUND_SAMPLE_MAX_ARMED_RETRIES,
    'the chain must run its full budget before giving up',
  );

  // Budget spent: further parked frames retry the sample (free) but ask for
  // nothing more — the idle governor is allowed to sleep.
  runArmedRetryChain(env, t, clock, 10);
  assert.equal(
    governorScene.renders,
    GROUND_SAMPLE_MAX_ARMED_RETRIES,
    'past the cap the layer must stop arming instead of re-arming forever',
  );
});

test('after the cap a camera-motion frame still samples, and re-opens the budget', async (t) => {
  const env = await createRealLocalLayerHarness({ sampleHeightSupported: true });
  _resetRenderGovernorForTest();
  const governorScene = { renders: 0, requestRender() { this.renders += 1; } };
  installRenderGovernor({ scene: governorScene });
  governorScene.renders = 0; // discard the governor's own install settling frame
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = installFakeClock(t);
  t.after(() => {
    env.layer.destroy(env.viewer);
    env.cleanup();
    _resetRenderGovernorForTest();
  });

  setCameraAltitude(env, 20_000);
  runArmedRetryChain(env, t, clock, GROUND_SAMPLE_MAX_ARMED_RETRIES + 3);
  assert.equal(governorScene.renders, GROUND_SAMPLE_MAX_ARMED_RETRIES, 'budget spent');
  assert.equal(baseHeightM(env), 0, 'still ungrounded while the tiles were missing');

  // The tiles finally arrive. Camera-motion frames are free (the user is
  // already paying for them), so the walk they trigger must still sample.
  env.setSampleHeight(() => 210);
  setCameraAltitude(env, 19_000);
  env.moveEnd.raise();
  clock.advance(2_100);
  env.preRender.raise();

  assert.ok(
    Math.abs(baseHeightM(env) - 210) < 1e-6,
    `the motion frame must ground the stem; base height ${baseHeightM(env)}`,
  );

  // Grounded, so there is nothing left to arm: no new frame requests either.
  runArmedRetryChain(env, t, clock, 5);
  assert.equal(
    governorScene.renders,
    GROUND_SAMPLE_MAX_ARMED_RETRIES,
    'a grounded record asks for no further frames',
  );
});

// ── The size channel ────────────────────────────────────────────────────────
//
// A measured pack spends the size channel per FEATURE, which no `groupStyles`
// key can express. These tests cover the renderer half of that: the Cesium
// call sequence that turns a spec into a volume, a slab or a hollow ring, and
// the guarantee that the packs which spend nothing keep exactly what they had.

const now = () => Cesium.JulianDate.now();
const valueOf = (property) => (property && typeof property.getValue === 'function'
  ? property.getValue(now())
  : property);

test('a volume spec sets the four terrain properties Cesium needs, together', () => {
  const polygon = new Cesium.PolygonGraphics({});
  const color = Cesium.Color.fromCssColorString('#00ffff');
  assert.equal(applyLocalSurfaceStyle(polygon, {
    surface: 'volume', fillAlpha: 0.32, extrudedHeightM: 20,
  }, color), true);

  assert.equal(valueOf(polygon.extrudedHeight), 20);
  assert.equal(valueOf(polygon.extrudedHeightReference), Cesium.HeightReference.RELATIVE_TO_GROUND);
  // The 0 is load-bearing, not decoration: `getGeometryHeight()` warns and
  // returns undefined when a heightReference arrives with no height beside it,
  // and the volume is then silently dropped.
  assert.equal(valueOf(polygon.height), 0);
  assert.equal(valueOf(polygon.heightReference), Cesium.HeightReference.CLAMP_TO_GROUND);
  assert.equal(valueOf(polygon.fill), true);
  assert.equal(valueOf(polygon.material.color).alpha.toFixed(2), '0.32');
  // A traced outline is a shell: the top face is what a reader looks down on,
  // the bottom is buried in the terrain it is clamped to.
  assert.equal(valueOf(polygon.closeTop), true);
  assert.equal(valueOf(polygon.closeBottom), false);
});

test('a flat spec is filled and NEVER extruded, and no spec at all changes nothing', () => {
  const flat = new Cesium.PolygonGraphics({});
  assert.equal(applyLocalSurfaceStyle(flat, {
    surface: 'flat', fillAlpha: 0.32, extrudedHeightM: null,
  }, Cesium.Color.CYAN), true);
  assert.equal(valueOf(flat.fill), true);
  assert.equal(flat.extrudedHeight, undefined, 'a height nobody published');
  assert.equal(flat.heightReference, undefined, 'still a ground-clamped slab');

  // A height that arrives on a flat spec is refused rather than honoured: the
  // two halves of the decision must not be able to disagree.
  const confused = new Cesium.PolygonGraphics({});
  applyLocalSurfaceStyle(confused, { surface: 'flat', extrudedHeightM: 40 }, Cesium.Color.CYAN);
  assert.equal(confused.extrudedHeight, undefined);

  // …and a volume spec with no metres is a slab, not a zero-height volume.
  const empty = new Cesium.PolygonGraphics({});
  applyLocalSurfaceStyle(empty, { surface: 'volume', extrudedHeightM: 0 }, Cesium.Color.CYAN);
  assert.equal(empty.extrudedHeight, undefined);

  const untouched = new Cesium.PolygonGraphics({});
  assert.equal(applyLocalSurfaceStyle(untouched, { surface: null }, Cesium.Color.CYAN), false);
  assert.equal(applyLocalSurfaceStyle(untouched, null, Cesium.Color.CYAN), false);
  assert.equal(applyLocalSurfaceStyle(null, { surface: 'flat' }, Cesium.Color.CYAN), false);
  assert.equal(untouched.fill, undefined);
});

/**
 * A layer over polygon features only.
 *
 * Points are avoided on purpose: Cesium's GeoJSON loader builds a PIN BILLBOARD
 * for every Point and the pin builder needs `document`. The layer treats both
 * identically from the stem down, and the no-footprint case is exercised
 * through an injected spec below instead.
 * @param {object} options
 */
async function createMeasuredLayerHarness({
  id = 'local-datacenters',
  features,
  /** Emit POINT features — what the airports pack ships — instead of polygons. */
  points = false,
  /** Camera altitude, in metres. The footprint floor is read off this distance. */
  cameraAltitudeM = 100_000,
  ...rest
} = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const preRender = new MockLayerEvent();
  /** Primitives the layer seats in the scene — the stem and segment batches. */
  const primitives = [];
  const moveEnd = new MockLayerEvent();
  const dataSources = [];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => features.map((feature, index) => JSON.stringify({
      type: 'Feature',
      id: `measured-${index}`,
      properties: feature.properties,
      geometry: points
        ? { type: 'Point', coordinates: [feature.lon, feature.lat] }
        : {
          type: 'Polygon',
          coordinates: [[
            [feature.lon, feature.lat],
            [feature.lon + feature.size, feature.lat],
            [feature.lon + feature.size, feature.lat + feature.size],
            [feature.lon, feature.lat + feature.size],
            [feature.lon, feature.lat],
          ]],
        },
    })).join('\n'),
  });
  globalThis.window = { dispatchEvent() {} };
  const viewer = {
    selectedEntity: undefined,
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(2.35, 48.85, cameraAltitudeM),
      frustum: { fov: Math.PI / 3 },
      moveEnd,
      flyTo() {},
    },
    scene: {
      canvas: { clientWidth: 800, clientHeight: 600 },
      // Every pack draws recall stems now, and they live in a pooled
      // `PolylineCollection` rather than on the entities — so a fake scene has
      // to own a primitive collection the way a real one always does.
      primitives: {
        add(primitive) { primitives.push(primitive); return primitive; },
        remove(primitive) {
          const at = primitives.indexOf(primitive);
          if (at >= 0) primitives.splice(at, 1);
          return at >= 0;
        },
      },
      preRender,
      sampleHeightSupported: false,
      screenSpaceCameraController: { enableInputs: true },
      pick() { return null; },
      requestRender() {},
    },
  };
  const layer = createLocalGeoJsonLayer({
    id,
    url: '/measured.geojsonl',
    name: 'Measured',
    color: '#00ffff',
    overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
    projectToWindow: () => ({ x: 400, y: 300 }),
    screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
    ...rest,
  });
  try {
    await layer.enable(viewer);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return {
    layer,
    viewer,
    preRender,
    entities: dataSources[0]?.entities.values || [],
    cleanup() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

test('the datacenter pack draws three different footprints without being wired to', () => {
  // The wiring file passes nothing: the resolver is keyed by layer id, exactly
  // like the card copy and the nameless title already are, because what a
  // pack's marks CLAIM is not the wiring file's business.
  return createMeasuredLayerHarness({
    features: [
      // A hall with storeys → an extruded volume, 4 × 5 m. ~1 300 m², which
      // is inside the pack's own interquartile range for a building.
      { lon: 2.30, lat: 48.80, size: 0.0004, properties: { tags: { name: 'Hall', building: 'yes', 'building:levels': '4' } } },
      // A hall with no height at all → flat, and that is 63 % of the pack.
      { lon: 2.32, lat: 48.81, size: 0.0004, properties: { tags: { name: 'Slab', building: 'yes' } } },
      // A campus fence → flat, slate, never extruded, and ~1.8 ha: the size
      // spread that makes the hall/fence distinction matter in the first place.
      { lon: 2.34, lat: 48.82, size: 0.0015, properties: { tags: { name: 'Site', building: 'no', height: '25' } } },
    ],
  }).then(async (harness) => {
    try {
      const [volume, slab, site] = harness.entities;

      assert.equal(valueOf(volume.polygon.extrudedHeight), 20, 'four storeys at the measured 5 m');
      assert.equal(valueOf(volume.polygon.heightReference), Cesium.HeightReference.CLAMP_TO_GROUND);

      // A1 on the map, not just on the card: no default storey height.
      assert.equal(slab.polygon.extrudedHeight, undefined);
      assert.equal(site.polygon.extrudedHeight, undefined);

      // Hue carries the one distinction the area number cannot survive.
      const hue = (entity) => valueOf(entity.polygon.material.color).withAlpha(1).toCssHexString();
      assert.equal(hue(volume), hue(slab), 'a hall is a hall whether or not it was measured');
      assert.notEqual(hue(site), hue(slab), 'a fence must not read as a hall');

      // Opacity is constant across the three, so it encodes nothing (A3).
      const alpha = (entity) => valueOf(entity.polygon.material.color).alpha.toFixed(3);
      assert.equal(new Set([alpha(volume), alpha(slab), alpha(site)]).size, 1);

      // The anchor dot stops being the size channel: 6 px for all three, and
      // filled, because all three DO have a footprint.
      for (const entity of harness.entities) {
        assert.equal(valueOf(entity.point.pixelSize), 6);
        assert.equal(valueOf(entity.point.color).alpha, 1);
      }

      // …and the legend publishes both halves: what the signs are, then how
      // big they are. Without the second half a world-unit size has no scale.
      const legend = harness.layer.getRowControls().legend;
      const byLabel = new Map(legend.map((row) => [row.label, row]));
      assert.equal(byLabel.get('Volume bâti').count, 1);
      assert.equal(byLabel.get('Emprise seule').count, 1);
      assert.equal(byLabel.get('Contour de site').count, 1);
      assert.equal(byLabel.has('Sans emprise'), false, 'no row for a class with no members');
      assert.equal(byLabel.get('≥ 1 ha').count, 1, 'the fence is the only hectare here');
      assert.equal(byLabel.get('≥ 1 000 m²').count, 3);
    } finally {
      await harness.layer.destroy?.(harness.viewer);
      harness.cleanup();
    }
  });
});

test('a spec that says "not measured" draws a hollow ring, not a small dot', async () => {
  const harness = await createMeasuredLayerHarness({
    id: 'local-ports',
    features: [
      { lon: 2.30, lat: 48.80, size: 0.004, properties: { name: 'Measured', span: 400 } },
      { lon: 2.32, lat: 48.81, size: 0.004, properties: { name: 'Unmeasured' } },
    ],
    featureRender: (props) => (Number.isFinite(Number(props.span))
      ? { key: 'big', pixelSize: 14, hollow: false, surface: null }
      : { key: 'none', pixelSize: 8, hollow: true, surface: null }),
    renderLegend: (tally) => [...tally].map(([key, bucket]) => ({
      label: key, color: '#c3ccd8', count: bucket.visible,
    })),
  });
  try {
    const [measured, unmeasured] = harness.entities;
    assert.equal(valueOf(measured.point.pixelSize), 14);
    assert.equal(valueOf(measured.point.color).alpha, 1, 'a measurement is a filled disc');

    // The hollow mark: a transparent centre and a coloured rim. It must not be
    // reachable by any value of the measured ladder — that is the whole of A1
    // for a size channel.
    assert.equal(valueOf(unmeasured.point.pixelSize), 8);
    assert.equal(valueOf(unmeasured.point.color).alpha, 0);
    assert.equal(valueOf(unmeasured.point.outlineColor).alpha, 1);

    // A pack with no chips still gets a strip, because it has a scale to print.
    const controls = harness.layer.getRowControls();
    assert.equal(controls.chips, undefined);
    assert.deepEqual(controls.legend.map((row) => [row.label, row.count]), [['big', 1], ['none', 1]]);
  } finally {
    await harness.layer.destroy?.(harness.viewer);
    harness.cleanup();
  }
});

test('the packs that spend no size channel keep exactly what they had', async () => {
  // Ports and airports are not measured packs. Nothing about them may move:
  // the historical 10 px dot, and a polygon Cesium clamped and filled itself.
  const harness = await createMeasuredLayerHarness({
    id: 'local-ports',
    features: [{ lon: 2.30, lat: 48.80, size: 0.004, properties: { name: 'Harbour' } }],
  });
  try {
    const [entity] = harness.entities;
    assert.equal(valueOf(entity.point.pixelSize), 10);
    assert.equal(valueOf(entity.point.color).alpha, 1);
    assert.equal(entity.polygon.extrudedHeight, undefined);
    assert.equal(entity.polygon.heightReference, undefined);
    assert.equal(entity.polygon.fill, undefined, 'the loader s own fill, untouched');
    assert.equal(typeof harness.layer.getRowControls, 'undefined');
  } finally {
    await harness.layer.destroy?.(harness.viewer);
    harness.cleanup();
  }
});

test('a display floor empties the size legend it hides, rather than lying about it', async () => {
  const harness = await createMeasuredLayerHarness({
    id: 'local-ports',
    features: [
      { lon: 2.30, lat: 48.80, size: 0.004, properties: { name: 'Big', rank: 'major' } },
      { lon: 2.32, lat: 48.81, size: 0.004, properties: { name: 'Small', rank: 'minor' } },
    ],
    groupOf: (props) => props.rank,
    groupStyles: { major: { color: '#ff0000' }, minor: { color: '#00ff00' } },
    groupVisible: (key, params) => params.floor === 'all' || key === 'major',
    defaultParams: { floor: 'all' },
    rowControls: (params) => ({ chips: [{ id: 'all', label: 'ALL', active: params.floor === 'all' }] }),
    featureRender: (props) => ({
      key: props.rank === 'major' ? 'span1000' : 'span25',
      pixelSize: props.rank === 'major' ? 18 : 6,
      hollow: false,
      surface: null,
    }),
    renderLegend: (tally) => [...tally].map(([key, bucket]) => ({ label: key, count: bucket.visible })),
  });
  try {
    const counts = () => new Map(harness.layer.getRowControls().legend.map((r) => [r.label, r.count]));
    assert.deepEqual([...counts()], [['span1000', 1], ['span25', 1]]);

    // The chip hides the small one. The size row goes to zero — it does not
    // keep claiming a mark the reader can no longer find.
    harness.layer.setParams({ floor: 'major' });
    assert.deepEqual([...counts()], [['span1000', 1], ['span25', 0]]);

    // …and the chips keep working alongside it, untouched.
    assert.equal(harness.layer.getRowControls().chips.length, 1);
  } finally {
    await harness.layer.destroy?.(harness.viewer);
    harness.cleanup();
  }
});

/**
 * One airport, a captured LEFT_CLICK handler, and a scriptable overlay hit
 * test — everything needed to drive the three-step resolution order by hand.
 */
async function createAirportClickHarness() {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const preRender = new MockLayerEvent();
  /** Primitives the layer seats in the scene — the stem and segment batches. */
  const primitives = [];
  const moveEnd = new MockLayerEvent();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      type: 'Feature',
      id: 'LFPG',
      properties: { name: 'Paris Charles de Gaulle', tags: { iata: 'CDG' } },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [2.53, 49.00],
          [2.58, 49.00],
          [2.58, 49.02],
          [2.53, 49.00],
        ]],
      },
    }),
  });
  globalThis.window = { dispatchEvent() {} };
  let hit = null;
  let picked = null;
  const flights = [];
  let clickHandler = null;
  const viewer = {
    selectedEntity: undefined,
    dataSources: { add(dataSource) { return dataSource; }, remove() { return true; } },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(2.55, 49.01, 100_000),
      frustum: { fov: Math.PI / 3 },
      moveEnd,
      flyTo(options) { flights.push(options); },
    },
    scene: {
      canvas: { clientWidth: 800, clientHeight: 600 },
      // Every pack draws recall stems now, and they live in a pooled
      // `PolylineCollection` rather than on the entities — so a fake scene has
      // to own a primitive collection the way a real one always does.
      primitives: {
        add(primitive) { primitives.push(primitive); return primitive; },
        remove(primitive) {
          const at = primitives.indexOf(primitive);
          if (at >= 0) primitives.splice(at, 1);
          return at >= 0;
        },
      },
      preRender,
      sampleHeightSupported: false,
      screenSpaceCameraController: { enableInputs: true },
      pick() { return picked; },
      requestRender() {},
    },
  };
  const layer = createLocalGeoJsonLayer({
    id: 'local-airports',
    url: '/airports.geojsonl',
    name: 'Aéroports',
    color: '#f0e6ff',
    overlayHost: {
      setVisible() {},
      setEntries() {},
      clearSource() {},
      hitTest: (x, y, options = {}) => {
        if (!hit) return null;
        if (options.sourceId && options.sourceId !== hit.sourceId) return null;
        if (x < hit.x || x > hit.x + hit.w || y < hit.y || y > hit.y + hit.h) return null;
        return hit;
      },
    },
    projectToWindow: () => ({ x: 400, y: 300 }),
    screenSpaceEventHandlerFactory: () => ({
      setInputAction(handler) { clickHandler = handler; },
      destroy() {},
    }),
  });
  try {
    await layer.enable(viewer);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return {
    layer,
    viewer,
    flights,
    click(x, y) { clickHandler({ position: { x, y } }); },
    setHit(next) { hit = next; },
    setPicked(next) { picked = next; },
    cleanup() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

test('clicking an airport NAME selects and frames it, exactly as clicking its marker does', async () => {
  const harness = await createAirportClickHarness();
  try {
    harness.setHit({
      sourceId: 'local-airports', entryId: 'LFPG', x: 380, y: 260, w: 120, h: 40,
    });
    harness.click(440, 280);
    assert.ok(harness.viewer.selectedEntity, 'the name selects the feature');
    assert.equal(harness.viewer.selectedEntity.id, 'LFPG');
    assert.equal(harness.flights.length, 1, 'and frames it, the way the marker does');
  } finally {
    harness.cleanup();
  }
});

test('a pick that somebody owns beats the name; an unclaimed one does not', async () => {
  const harness = await createAirportClickHarness();
  const hit = { sourceId: 'local-airports', entryId: 'LFPG', x: 380, y: 260, w: 120, h: 40 };
  try {
    // A sibling local layer's own entity under the cursor is the honest answer
    // about what is being pointed at — a card must not steal its click.
    harness.setHit(hit);
    harness.setPicked({ id: { __localLayerId: 'local-ports' } });
    harness.click(440, 280);
    assert.equal(harness.viewer.selectedEntity, undefined);

    // Same for a pick another registered layer claims.
    registerPickOwner('flights', (pickedId) => pickedId === 'a1b2c3');
    try {
      harness.setPicked({ id: 'a1b2c3' });
      harness.click(440, 280);
      assert.equal(harness.viewer.selectedEntity, undefined);
    } finally {
      unregisterPickOwner('flights');
    }

    // But an UNCLAIMED pick is not an obstacle, and this is the case that
    // decides whether the feature works at all: over photoreal 3D tiles almost
    // every on-globe pixel picks a tile feature that no layer owns and nobody
    // can select. Treating that as occupied would leave every name inert.
    harness.setPicked({ primitive: {}, content: {}, tileset: {} });
    harness.click(440, 280);
    assert.equal(harness.viewer.selectedEntity?.id, 'LFPG');
  } finally {
    harness.cleanup();
  }
});

test('the airport name resolves only while its record is live, and only for its own source', async () => {
  const harness = await createAirportClickHarness();
  try {
    // A hit rectangle outlives its record by a frame, so an id the layer no
    // longer carries is a miss and never a selection.
    harness.setPicked(null);
    harness.setHit({
      sourceId: 'local-airports', entryId: 'GONE', x: 380, y: 260, w: 120, h: 40,
    });
    harness.click(440, 280);
    assert.equal(harness.viewer.selectedEntity, undefined);

    // Another source's rectangle under the same pixels is not ours either.
    harness.setHit({
      sourceId: 'local-ports', entryId: 'LFPG', x: 380, y: 260, w: 120, h: 40,
    });
    harness.click(440, 280);
    assert.equal(harness.viewer.selectedEntity, undefined);

    // Empty space stays empty: this layer never had a deselect branch.
    harness.setHit(null);
    harness.click(440, 280);
    assert.equal(harness.viewer.selectedEntity, undefined);
    assert.equal(harness.flights.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('a footprint yields a hierarchy and the ground extent its floor is read from', () => {
  // 0.02° at 48.8° N: 1 467 m east-west, 2 211 m north-south. The LARGER one
  // is what the floor reads, so a long thin field is drawn while its length is
  // readable rather than only when its width is.
  const square = localFootprintGeometry([
    [2.29, 48.79], [2.31, 48.79], [2.31, 48.81], [2.29, 48.81], [2.29, 48.79],
  ]);
  assert.ok(square);
  assert.equal(Math.round(square.spanM), 2211);
  assert.equal(square.hierarchy.positions.length, 5);

  // Everything that is not a ring gives null rather than a half-built polygon.
  assert.equal(localFootprintGeometry(null), null);
  assert.equal(localFootprintGeometry([]), null);
  assert.equal(localFootprintGeometry([[0, 0], [1, 0], [0, 0]]), null, 'three positions is not a ring');
  assert.equal(localFootprintGeometry([[0, 0], [1, null], [1, 1], [0, 0]]), null);
  // A degenerate ring — every vertex identical — has no extent to draw.
  assert.equal(localFootprintGeometry([[2, 48], [2, 48], [2, 48], [2, 48]]), null);
});

test('the footprint floor thins by SIZE, which is the honest order for a ground mark', () => {
  // 8 px is the floor. At 100 km with this app's frustum a pixel is ~193 m of
  // ground, so the threshold there is ~1.5 km of extent.
  const metresPerPixel = 193;
  assert.equal(localFootprintFitsScreen(2211, metresPerPixel), true, '2.2 km is eleven pixels');
  assert.equal(localFootprintFitsScreen(221, metresPerPixel), false, '220 m is one');
  // Exactly at the floor is drawn — a floor already met does nothing.
  assert.equal(localFootprintFitsScreen(8 * metresPerPixel, metresPerPixel), true);
  assert.equal(localFootprintFitsScreen(8 * metresPerPixel - 1, metresPerPixel), false);

  // Roissy's 10.3 km survives past 1 000 km on a 1 080 px canvas; from orbit
  // nothing does. The card and the pastille still reach 14 000 km on a 3 000 m
  // runway — the outline stops being a shape long before it stops being on
  // screen, which is the whole point of giving it a floor of its own.
  const atKm = (km) => km * 1000 * ((2 * Math.tan(Math.PI / 6)) / 1080);
  assert.equal(localFootprintFitsScreen(10334, atKm(1000)), true);
  assert.equal(localFootprintFitsScreen(10334, atKm(1500)), false);

  // Nothing to draw, and impossible ranges, are refusals rather than throws.
  assert.equal(localFootprintFitsScreen(0, metresPerPixel), false);
  assert.equal(localFootprintFitsScreen(2211, 0), false);
  assert.equal(localFootprintFitsScreen(NaN, metresPerPixel), false);
});

// ── The globe-LOD budget and the frustum gate (PLAN-PERFORMANCE.md § 3.1) ──

/** A record shaped exactly as the walk builds them, for the pure rules. */
function lodRecord(id, priority, screen, { lon = 0, lat = 0, extentRadiusM = 0 } = {}) {
  return {
    id,
    priority,
    screen,
    extentRadiusM,
    base: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    entity: { show: true },
  };
}

test('the globe budget draws one mark per occupied screen cell, and the right one', () => {
  const cell = 26;
  // Three records inside ONE 26 px cell, and a fourth two cells away. The
  // second of the three is the important one — a cell is represented by what
  // matters in it, not by whichever row the pack happened to emit first.
  const first = lodRecord('a', 10, { x: 10, y: 10 });
  const best = lodRecord('b', 900, { x: 20, y: 20 });
  const third = lodRecord('c', 50, { x: 25, y: 5 });
  const elsewhere = lodRecord('d', 1, { x: 300, y: 300 });

  const kept = selectLocalGlobeLodMarks([first, best, third, elsewhere], {
    cellPx: cell,
    width: 800,
    height: 600,
    project: (record) => record.screen,
  });
  assert.equal(kept.size, 2, 'one occupied cell is one mark, whatever it holds');
  assert.ok(kept.has(best), 'the cell is represented by its most important feature');
  assert.ok(kept.has(elsewhere), 'a sparse cell keeps its only member, however small');
  assert.equal(kept.has(first), false);
  assert.equal(kept.has(third), false);
});

test('the budget ceiling cuts cells by importance, not by arrival order', () => {
  // One record per cell — the grid drops nothing — so only the ceiling bites,
  // and what it keeps has to be the top of the ladder rather than the head of
  // the array. Emitted weakest-first so an order-preserving cut would fail.
  const records = [];
  for (let index = 0; index < 40; index += 1) {
    records.push(lodRecord(`r${index}`, index, { x: 13 + index * 26, y: 13 }));
  }
  const kept = selectLocalGlobeLodMarks(records, {
    cellPx: 26,
    width: 2000,
    height: 600,
    maxMarks: 5,
    project: (record) => record.screen,
  });
  assert.equal(kept.size, 5);
  assert.deepEqual(
    [...kept].map((record) => record.id).sort(),
    ['r35', 'r36', 'r37', 'r38', 'r39'],
    'the ceiling keeps the five that matter most',
  );
});

test('a selected feature is drawn whatever cell it lands in, and whoever else won it', () => {
  // The one moment a budget must not be clever: the visitor has a card open on
  // this feature. Without the pin, pulling back to orbit deletes the mark under
  // the card they are reading.
  const winner = lodRecord('hub', 5000, { x: 10, y: 10 });
  const selected = lodRecord('weir', 1, { x: 12, y: 12 });
  const kept = selectLocalGlobeLodMarks([winner, selected], {
    cellPx: 26,
    width: 800,
    height: 600,
    project: (record) => record.screen,
    pinned: selected,
  });
  assert.equal(kept.size, 2, 'the pin does not evict the cell winner, it joins it');
  assert.ok(kept.has(selected));
  assert.ok(kept.has(winner));

  // And it survives a ceiling of one, because a budget that could drop the
  // selection would be answering a different question from the one asked.
  const capped = selectLocalGlobeLodMarks([winner, selected], {
    cellPx: 26,
    width: 800,
    height: 600,
    maxMarks: 1,
    project: (record) => record.screen,
    pinned: selected,
  });
  assert.deepEqual([...capped].map((record) => record.id), ['weir']);
});

test('the budget refuses a projection it cannot use rather than guessing a cell', () => {
  const off = lodRecord('behind', 100, { x: -400, y: 300 });
  const nan = lodRecord('nan', 100, { x: Number.NaN, y: 10 });
  const none = lodRecord('null', 100, null);
  const good = lodRecord('good', 1, { x: 400, y: 300 });
  const kept = selectLocalGlobeLodMarks([off, nan, none, good], {
    cellPx: 26,
    width: 800,
    height: 600,
    project: (record) => record.screen,
  });
  assert.deepEqual([...kept].map((record) => record.id), ['good']);

  // Degenerate inputs are empty answers, never throws: this runs inside a
  // preRender handler where a throw would take the frame with it.
  assert.equal(selectLocalGlobeLodMarks([], { cellPx: 26, project: () => null }).size, 0);
  assert.equal(selectLocalGlobeLodMarks(null, { cellPx: 26, project: () => null }).size, 0);
  assert.equal(selectLocalGlobeLodMarks([good], { cellPx: 26 }).size, 0);
});

test('a scene that cannot describe its frustum culls nothing at all', () => {
  // The historical behaviour, and the one a test double gets. Failing OPEN is
  // load-bearing: a gate that culled when it could not answer would empty the
  // map instead of merely failing to trim it.
  assert.equal(localCullingVolume(undefined), null);
  assert.equal(localCullingVolume({ camera: { frustum: { fov: Math.PI / 3 } } }), null);
  assert.equal(localCullingVolume({
    camera: { frustum: new Cesium.PerspectiveFrustum() },
  }), null, 'a frustum with no camera vectors cannot be resolved either');
  assert.equal(localRecordOffScreen(null, lodRecord('x', 1, null), 1000), false);
});

test('the frustum gate hides what is not on screen, and only that', () => {
  // A real camera 500 km over Paris, looking straight down. `up` is derived
  // rather than borrowed from an axis: `computeCullingVolume` builds its six
  // planes from an ORTHONORMAL triple, and a non-perpendicular up quietly
  // skews every one of them.
  const eye = Cesium.Cartesian3.fromDegrees(2.35, 48.85, 500_000);
  const direction = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.negate(eye, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );
  const right = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );
  const up = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );
  const camera = {
    positionWC: eye,
    directionWC: direction,
    upWC: up,
    frustum: Object.assign(new Cesium.PerspectiveFrustum(), {
      fov: Math.PI / 3,
      aspectRatio: 800 / 600,
      near: 1,
      far: 50_000_000,
    }),
  };
  const volume = localCullingVolume({ camera });
  assert.ok(volume, 'a real camera resolves a culling volume');

  const under = lodRecord('paris', 1, null, { lon: 2.35, lat: 48.85 });
  // 20° east of the camera is roughly 1 460 km off the view axis at 500 km of
  // altitude — far outside a 60° cone by any reckoning.
  const aside = lodRecord('aside', 1, null, { lon: 22.35, lat: 48.85 });
  assert.equal(localRecordOffScreen(volume, under, 0), false, 'what is under the camera is on screen');
  assert.equal(localRecordOffScreen(volume, aside, 0), true, 'what is 1 460 km off the axis is not');

  // The gate does NOT replace the horizon occluder, and this is why: the
  // antipode sits dead ahead of a camera pointed at the planet's centre, so it
  // is inside the frustum and behind 12 700 km of rock. Both tests are needed,
  // and the walk still runs both.
  const antipode = lodRecord('antipode', 1, null, { lon: -177.65, lat: -48.85 });
  assert.equal(
    localRecordOffScreen(volume, antipode, 0),
    false,
    'a frustum knows nothing about the globe in the way — the occluder does',
  );

  // The sphere has to reach as far as the record DRAWS, not just to its
  // anchor. A feature whose anchor is outside the cone but whose recall stem
  // or surveyed outline reaches into it is on screen and must be kept.
  assert.equal(
    localRecordOffScreen(volume, aside, 2_000_000),
    false,
    'a stem long enough to enter the frustum keeps its record',
  );
  const wide = lodRecord('wide', 1, null, { lon: 22.35, lat: 48.85, extentRadiusM: 2_000_000 });
  assert.equal(
    localRecordOffScreen(volume, wide, 0),
    false,
    'so does a surveyed extent that reaches in',
  );
});

test('the gate sizes its sphere on the same stem the geometry pass places', () => {
  // The two must not drift: a gate whose idea of the stem is shorter than the
  // stem culls a mark that is on screen. `localStemLiftM` is the one
  // definition, and this pins its two clauses.
  const pixelFactor = (2 * Math.tan(Math.PI / 6)) / 1080;
  // 65 px of stem at 20 000 km is over a thousand kilometres of world space.
  assert.equal(
    Math.round(localStemLiftM(20_000_000, pixelFactor, Infinity)),
    Math.round(20_000_000 * pixelFactor * 65),
  );
  // Under 5 km the distance is floored, so a stem never collapses into its dot.
  assert.equal(
    localStemLiftM(1000, pixelFactor, Infinity),
    localStemLiftM(5000, pixelFactor, Infinity),
  );
  // A pack that declares a ceiling gets it — the airports pack's 150 m.
  assert.equal(localStemLiftM(20_000_000, pixelFactor, 150), 150);
});

test('above 2 000 km a crowded cell draws one mark; below it, everything', async () => {
  // The harness projects every record to the same point, so all three land in
  // one cell — the crowded case, without having to model a projection.
  const features = [
    { lon: 2.35, lat: 48.85, size: 0.01, properties: { name: 'Nommé' } },
    { lon: 2.36, lat: 48.86, size: 0.01, properties: {} },
    { lon: 2.37, lat: 48.87, size: 0.01, properties: {} },
  ];
  const orbit = await createMeasuredLayerHarness({ features, cameraAltitudeM: 20_000_000 });
  try {
    orbit.preRender.raise();
    const shown = orbit.entities.filter((entity) => entity.show !== false);
    assert.equal(shown.length, 1, 'one occupied cell is one drawn mark');
    assert.equal(
      shown[0].__localProperties.name,
      'Nommé',
      'and it is the cell winner, which is the named feature',
    );
  } finally {
    orbit.cleanup();
  }

  // The same three features, the same cell, 120 km up: "en dessous, tout".
  const city = await createMeasuredLayerHarness({ features, cameraAltitudeM: 120_000 });
  try {
    city.preRender.raise();
    assert.equal(
      city.entities.filter((entity) => entity.show !== false).length,
      3,
      'below the LOD height a visitor who zoomed in to separate two neighbours gets both',
    );
  } finally {
    city.cleanup();
  }
});

test('a mark dropped at orbit comes back on the way down', async () => {
  // The flag is sticky by design (it is only recomputed on a settle), so the
  // descent has to clear it. Left set, a feature dropped once would stay
  // dropped for the rest of the session.
  const features = [
    { lon: 2.35, lat: 48.85, size: 0.01, properties: { name: 'Nommé' } },
    { lon: 2.36, lat: 48.86, size: 0.01, properties: {} },
  ];
  const env = await createMeasuredLayerHarness({ features, cameraAltitudeM: 20_000_000 });
  try {
    env.preRender.raise();
    assert.equal(env.entities.filter((entity) => entity.show !== false).length, 1);

    env.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(2.35, 48.85, 120_000);
    env.viewer.camera.moveEnd.raise();
    env.preRender.raise();
    assert.equal(
      env.entities.filter((entity) => entity.show !== false).length,
      2,
      'the descent re-admits what orbit had dropped',
    );
  } finally {
    env.cleanup();
  }
});

test('the packs carry no description table Cesium built for nobody', async () => {
  // Cesium's default `describe` renders an HTML <table> of every property, as
  // a string, for every feature it parses. This app never reads
  // `entity.description` — a local card is written by
  // `localInfrastructureOverlayCopy` (or the pack's own `cardCopy`) off the
  // unwrapped properties. Measured on the ports pack alone: 1 995 276
  // characters across 2 951 features, built during the load and retained.
  //
  // Its twin — the PIN BILLBOARD Cesium builds for every POINT feature, which
  // this file also now drops — cannot be pinned here: the pin builder needs a
  // `document`, which is exactly why this harness draws polygons. It is
  // measured in the browser instead, by `scripts/perf-infra-lod.mjs`.
  const env = await createMeasuredLayerHarness({
    features: [{ lon: 2.35, lat: 48.85, size: 0.01, properties: { name: 'Nommé', country: 'France' } }],
  });
  try {
    assert.equal(env.entities.length, 1);
    assert.equal(env.entities[0].description, undefined, 'the table nobody reads is gone');
    assert.ok(env.entities[0].point, 'the app draws its own mark, as it always did');
  } finally {
    env.cleanup();
  }
});
