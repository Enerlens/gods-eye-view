import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDatasetManifest } from './datasetManifest.js';
import {
  bboxContains,
  bboxSpanDeg,
  createDatasetLayer,
  datasetCardCopy,
  datasetCoverageLine,
  datasetLegend,
  padBbox,
  shouldRefetch,
  datasetProgressLine,
  datasetRemainingLabel,
  datasetRemainingMs,
} from './datasetLayer.js';

const ATTRIBUTION = { publisher: 'P', licence: 'Licence Ouverte 2.0' };

test('bbox helpers: span, padding, containment', () => {
  const box = { west: 2, south: 48, east: 3, north: 49 };
  assert.equal(bboxSpanDeg(box), 1);
  assert.deepEqual(padBbox(box, 0.5), { west: 1.5, south: 47.5, east: 3.5, north: 49.5 });
  assert.deepEqual(padBbox({ west: -179.9, south: 89.9, east: 179.9, north: 90 }, 0.5).north, 90);
  assert.ok(bboxContains(padBbox(box), box));
  assert.ok(!bboxContains(box, padBbox(box)));
});

test('shouldRefetch: first view, leaving the loaded box, and coming closer after a clip', () => {
  const loaded = { west: 0, south: 0, east: 4, north: 4 };
  assert.equal(shouldRefetch({ loaded: null, view: loaded, truncated: false }), true);
  assert.equal(shouldRefetch({ loaded, view: { west: 1, south: 1, east: 2, north: 2 }, truncated: false }), false);
  assert.equal(shouldRefetch({ loaded, view: { west: 3, south: 3, east: 5, north: 5 }, truncated: false }), true);
  assert.equal(shouldRefetch({ loaded, view: { west: 1, south: 1, east: 3, north: 3 }, truncated: true }), true, 'half the span after a clip → refetch');
  assert.equal(shouldRefetch({ loaded, view: { west: 0.5, south: 0.5, east: 3.5, north: 3.5 }, truncated: true }), false, 'not yet half → keep');
  assert.equal(shouldRefetch({ loaded, view: null, truncated: true }), false);
});

test('the coverage line declares the clip, the view, the unplaced rows and the relay', () => {
  assert.equal(datasetCoverageLine({ count: 5000, total: 186137, truncated: true, maxFeatures: 5000 }), '5 000 affichés sur 186 137 — plafond 5 000, premières lignes');
  assert.equal(datasetCoverageLine({ count: 42, scope: 'viewport' }), '42 dans la vue');
  assert.equal(datasetCoverageLine({ count: 185, scope: 'all' }), '185 objets, jeu entier');
  assert.equal(datasetCoverageLine({ count: 3, scope: 'all', unplaced: 2, via: 'relay' }), '3 objets, jeu entier · 2 sans position · via relais');
  assert.equal(datasetCoverageLine({ gated: true, maxSpanDeg: 3 }), "au-delà de 3° de vue, rien n'est demandé");
});

test('card copy: declared details with labels and units, or a sensible default', () => {
  const declared = normalizeDatasetManifest({
    id: 'cc', label: 'CC', attribution: ATTRIBUTION,
    source: { kind: 'csv', url: 'https://x.test/a.csv' }, geometry: { lon: 'lon', lat: 'lat' },
    feature: { title: ['nom'], details: ['adresse', { field: 'kw', label: 'Puissance', unit: 'kW' }, 'absent'] },
  });
  const write = datasetCardCopy(declared);
  assert.deepEqual(write({ name: 'Borne', adresse: '1 rue X', kw: 22 }), { title: 'Borne', details: ['1 rue X', 'Puissance : 22 kW'] });
  assert.equal(write({}).title, 'CC', 'a nameless row is titled by the layer');

  const bare = normalizeDatasetManifest({
    id: 'bare', label: 'Bare', attribution: ATTRIBUTION,
    source: { kind: 'csv', url: 'https://x.test/a.csv' }, geometry: { lon: 'lon', lat: 'lat' }, feature: { title: ['nom'] },
  });
  const copy = datasetCardCopy(bare)({
    name: 'A', nom: 'A', lon: 2, lat: 48, id_station: 'X1', url: 'https://x', commune: 'Paris', etat: 'ok', gratuit: 'false', long_text: 'x'.repeat(80), extra1: 'e1', extra2: 'e2', extra3: 'e3',
  });
  assert.deepEqual(copy.details, ['commune : Paris', 'etat : ok', 'extra1 : e1', 'extra2 : e2']);
});

test('legend: one swatch for a flat dataset, one per group with counts otherwise', () => {
  const flat = normalizeDatasetManifest({ id: 'flat', label: 'Flat', color: '#ff0000', attribution: ATTRIBUTION, source: { kind: 'geojson', url: 'https://x.test/a.geojson' } });
  assert.deepEqual(datasetLegend(flat, new Map(), 12), [{ color: '#ff0000', label: 'Flat', count: 12 }]);
  const grouped = normalizeDatasetManifest({
    id: 'grp', label: 'Grp', attribution: ATTRIBUTION, source: { kind: 'geojson', url: 'https://x.test/a.geojson' },
    feature: { group: { field: 'acc', styles: { Intérieur: { color: '#111111' }, Extérieur: { color: '#222222', label: 'Dehors' } }, other: { color: '#333333' } } },
  });
  const tally = new Map([['Intérieur', { total: 3, visible: 3 }], ['__other__', { total: 1, visible: 1 }]]);
  assert.deepEqual(datasetLegend(grouped, tally, 4), [
    { color: '#111111', label: 'Intérieur', count: 3 },
    { color: '#222222', label: 'Dehors', count: 0 },
    { color: '#333333', label: 'Autre', count: 1 },
  ]);
});

/** A viewer stub the local loader accepts, plus a fetch that answers a WFS. */
function harness({ features = [], numberMatched = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({ type: 'FeatureCollection', numberMatched: numberMatched ?? features.length, features }),
    };
  };
  const dataSources = [];
  const viewer = {
    selectedEntity: undefined,
    dataSources: {
      add(source) { dataSources.push(source); return source; },
      remove(source) { const i = dataSources.indexOf(source); if (i >= 0) dataSources.splice(i, 1); return i >= 0; },
    },
    camera: { positionWC: { x: 0, y: 0, z: 1 }, frustum: { fov: 1 }, moveEnd: { addEventListener() { return () => {}; } }, flyTo() {} },
    scene: {
      canvas: { clientWidth: 800, clientHeight: 600 },
      preRender: { addEventListener() { return () => {}; } },
      sampleHeightSupported: false,
      screenSpaceCameraController: { enableInputs: true },
      primitives: { add(p) { return p; }, remove() {} },
      pick() { return null; },
      requestRender() {},
    },
  };
  const originalWindow = globalThis.window;
  globalThis.window = originalWindow || { dispatchEvent() {} };
  return { calls, fetchImpl, viewer, dataSources, restore: () => { globalThis.window = originalWindow; } };
}

// Polygons, not points: Cesium's GeoJsonDataSource builds a pin CANVAS for a
// point feature and needs `document` for it, which node:test does not have.
// The loader treats a polygon's centroid exactly like a point for stems and
// cards, so nothing this test asserts depends on the geometry type.
const POINT = (lon, lat, name) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.001, lat], [lon + 0.001, lat + 0.001], [lon, lat]]] },
  properties: { toponyme: name },
});

test('a viewport-scoped layer is gated wide, fetches on a close view, and skips a refetch inside the loaded box', async () => {
  const manifest = normalizeDatasetManifest({
    id: 'aero', label: 'Aéro', attribution: ATTRIBUTION,
    source: { kind: 'wfs', url: 'https://wfs.test/ows', typeName: 'a:b', scope: 'viewport', maxSpanDeg: 2 },
    feature: { title: ['toponyme'] },
  });
  const h = harness({ features: [POINT(2.3, 48.8, 'Orly'), POINT(2.35, 48.85, 'Bourget')] });
  let view = { west: 0, south: 40, east: 10, north: 50 };
  const layer = createDatasetLayer(manifest, {
    fetchImpl: h.fetchImpl,
    relay: null,
    viewportOf: () => view,
    loaderOptions: {
      overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
      projectToWindow: () => ({ x: 1, y: 1 }),
      screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
    },
  });
  try {
    assert.equal(layer.id, 'ds-aero');
    assert.equal(layer.updateInterval, 2500);
    await layer.enable(h.viewer);
    assert.equal(h.calls.length, 0, 'a 10° view is above the 2° gate: nothing asked');
    const gated = layer.getStats();
    assert.equal(gated.status, 'zoom-in');
    assert.match(gated.loadingLabel, /rapprochez-vous/);
    assert.match(gated.coverage, /rien n'est demandé/);

    view = { west: 2.2, south: 48.7, east: 2.5, north: 48.95 };
    await layer.update(h.viewer);
    assert.equal(h.calls.length, 1, 'one WFS request for the close view');
    assert.ok(h.calls[0].includes('bbox='), 'the request carries the padded view box');
    const stats = layer.getStats();
    assert.equal(stats.count, 2);
    assert.equal(stats.status, undefined);
    assert.equal(stats.coverage, '2 dans la vue');
    assert.equal(stats.source, 'P · Licence Ouverte 2.0');

    view = { west: 2.25, south: 48.75, east: 2.45, north: 48.9 };
    await layer.update(h.viewer);
    assert.equal(h.calls.length, 1, 'a view inside the loaded box does not refetch');

    view = { west: 3.2, south: 48.7, east: 3.5, north: 48.95 };
    await layer.update(h.viewer);
    assert.equal(h.calls.length, 2, 'a view outside it does');
    assert.deepEqual(layer.getRowControls().legend, [{ color: manifest.color, label: 'Aéro', count: 2 }]);
    assert.equal(layer.getManifest(), manifest);
    layer.disable(h.viewer);
    layer.destroy(h.viewer);
  } finally {
    h.restore();
  }
});

test('a whole-dataset layer loads once and reports the clip', async () => {
  const manifest = normalizeDatasetManifest({
    id: 'whole', label: 'Whole', attribution: ATTRIBUTION,
    source: { kind: 'wfs', url: 'https://wfs.test/ows', typeName: 'a:b', maxFeatures: 1 },
  });
  const h = harness({ features: [POINT(2.3, 48.8, 'A')], numberMatched: 40 });
  const layer = createDatasetLayer(manifest, {
    fetchImpl: h.fetchImpl, relay: null, viewportOf: () => null,
    loaderOptions: {
      overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
      projectToWindow: () => ({ x: 1, y: 1 }),
      screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
    },
  });
  try {
    assert.equal(layer.updateInterval, 0);
    await layer.enable(h.viewer);
    await layer.update(h.viewer);
    assert.equal(h.calls.length, 1);
    const stats = layer.getStats();
    assert.equal(stats.count, 1);
    assert.equal(stats.coverage, '1 affichés sur 40 — plafond 1, premières lignes');
    layer.destroy(h.viewer);
  } finally {
    h.restore();
  }
});

test('a failed load reaches the row as an error, not a silent zero', async () => {
  const manifest = normalizeDatasetManifest({
    id: 'broken', label: 'Broken', attribution: ATTRIBUTION,
    source: { kind: 'geojson', url: 'https://x.test/missing.geojson' },
  });
  const h = harness();
  const layer = createDatasetLayer(manifest, {
    fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => '' }),
    relay: null,
    loaderOptions: {
      overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
      projectToWindow: () => ({ x: 1, y: 1 }),
      screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
    },
  });
  try {
    await layer.enable(h.viewer);
    const stats = layer.getStats();
    assert.equal(stats.count, 0);
    assert.match(String(stats.error), /HTTP 404/);
    layer.destroy(h.viewer);
  } finally {
    h.restore();
  }
});

// ── the progress line, and the right to guess a time ──────────────────────

test('the fraction is exact from the first page, and never invents a ceiling', () => {
  assert.equal(datasetProgressLine({ received: 2400, ceiling: 16474, requests: 12, startedAt: 0 }, 1000), '2 400 sur 16 474');
  assert.equal(datasetProgressLine({ received: 400, ceiling: null, requests: 2, startedAt: 0 }, 1000), '400 lignes reçues');
  assert.equal(datasetProgressLine(null), null);
});

test('two pages are not a rate — no time is offered before five', () => {
  const started = 1000;
  const early = { received: 400, ceiling: 30000, requests: 2, startedAt: started };
  assert.equal(datasetRemainingMs(early, started + 800), null);
  assert.equal(datasetProgressLine(early, started + 800), '400 sur 30 000');
});

test('nor before a fifth of the work is in', () => {
  const started = 1000;
  const tenth = { received: 3000, ceiling: 30000, requests: 15, startedAt: started };
  assert.equal(datasetRemainingMs(tenth, started + 3300), null, 'ten percent is still a fast head');
  const fifth = { received: 6000, ceiling: 30000, requests: 30, startedAt: started };
  assert.ok(datasetRemainingMs(fifth, started + 6680) > 20000);
});

test('a remainder under three seconds is not worth a countdown', () => {
  const started = 1000;
  // 25 pages of 3,3 s: at half, 1,6 s left — gone before it is read.
  const half = { received: 2500, ceiling: 5000, requests: 12, startedAt: started };
  assert.equal(datasetRemainingMs(half, started + 1650), null);
  assert.equal(datasetProgressLine(half, started + 1650), '2 500 sur 5 000');
});

test('the figure is rounded coarser than its own error', () => {
  assert.equal(datasetRemainingLabel(26720), 'environ 25 secondes');
  assert.equal(datasetRemainingLabel(33400), 'environ 35 secondes');
  assert.equal(datasetRemainingLabel(3200), 'environ 5 secondes');
  assert.equal(datasetRemainingLabel(2999), null);
  assert.equal(datasetRemainingLabel(90000), 'environ 1,5 minutes');
  assert.equal(datasetRemainingLabel(120000), 'environ 2 minutes');
  assert.equal(datasetRemainingLabel(NaN), null);
});

test('the measured 150-page load is predicted within its stated error', () => {
  // 33,4 s, 150 pages, 30 000 rows — measured 2026-09-09.
  const started = 0;
  const atFifth = { received: 6000, ceiling: 30000, requests: 30, startedAt: started };
  const predicted = 6680 + datasetRemainingMs(atFifth, 6680);
  assert.ok(Math.abs(predicted - 33400) / 33400 < 0.15, `predicted ${Math.round(predicted)} ms`);
});
