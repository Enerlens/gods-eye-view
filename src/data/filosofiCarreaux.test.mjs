// src/data/filosofiCarreaux.test.mjs
// What the carroyage layer does with a camera that is too high, a view outside
// the country, and an operator switching indicators.
//
// The projection, the ramps and the extrusion arithmetic are proved against
// captured WFS answers in `filosofiFeed.test.mjs`. This file is about the other
// half of "the layer works": refusing honestly, recolouring without refetching,
// and never letting an imputed square look like an observed one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import filosofiCarreauxLayer, {
  FILOSOFI_MAX_BOX_DEG,
  _clearFilosofiSelectionForTest,
  _filosofiMetricForTest,
  _filosofiRowControlsForTest,
  _filosofiSelectedIdForTest,
  _filosofiSetParamsForTest,
  _filosofiStatsForTest,
  _selectFilosofiCellForTest,
  _setFilosofiStateForTest,
  cellId,
  createFilosofiSelectedOverlayEntry,
  drawnCorners,
  filosofiCoverageIntersects,
  filosofiLegend,
  filosofiViewportBox,
} from './filosofiCarreaux.js';
import { cellCorners, resolveMetric } from './filosofiFeed.js';

/** A viewer whose camera reports a box and accepts a flight to a smaller one. */
function createViewer(box, { heightM = 400_000, pitchDeg = -90 } = {}) {
  const state = { box, flights: [], primitives: [] };
  return {
    state,
    scene: {
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84, getHeight: () => 170, show: true },
      // The real viewer always has one; the layer builds a batched primitive on
      // every redraw and would otherwise fail here rather than in the browser.
      primitives: { add: (p) => state.primitives.push(p), remove: () => true },
    },
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
}

const LYON_CELL = Object.freeze({
  n: 2_531_400, e: 3_918_600, ind: 538.5, men: 274, niveau: 22_872, pauvrete: 16.8,
  social: 28.5, surface: 68.5, jeunes: 22.8, aines: 8.9, proprietaires: 29.6,
  solo: 47.4, collectif: 100, est: 0, com: '69381',
});
const IMPUTED_CELL = Object.freeze({ ...LYON_CELL, n: 2_531_600, est: 1, ind: 6, men: 3 });

function payload(cells = [LYON_CELL, IMPUTED_CELL]) {
  return {
    resolution: 200,
    cells,
    communes: { 69381: 'Lyon 1er Arrondissement' },
    matched: cells.length,
    returned: cells.length,
    truncated: false,
    summary: {
      cells: cells.length, people: 545, households: 277,
      imputedCells: cells.filter((cell) => cell.est === 1).length,
      imputedShare: 50, niveau: 22_872, pauvrete: 16.8,
    },
  };
}

function record(cell, { resolution = 200 } = {}) {
  return {
    id: cellId(cell, resolution),
    cell,
    resolution,
    color: '#4f97c4',
    heightM: cell.ind * 0.12,
    baseM: 170,
    lon: 4.83,
    lat: 45.76,
    corners: drawnCorners(cell, resolution),
    position: Cesium.Cartesian3.fromDegrees(4.83, 45.76, 400),
  };
}

// ── Refusing honestly ───────────────────────────────────────────────────────

test('a view wider than the gate is told to zoom, not told there is no data', () => {
  const viewer = createViewer({ south: 44.0, west: 3.0, north: 47.0, east: 7.0 });
  const { box, reason } = filosofiViewportBox(viewer);
  assert.equal(box, null);
  assert.equal(reason, 'too-wide');
});

test('a view outside France is told it is outside France, at any altitude', () => {
  // Coverage is checked BEFORE width, so a wide view of the Atlantic does not
  // get advice that would find nothing however far it zoomed.
  const wide = createViewer({ south: 40.0, west: -30.0, north: 45.0, east: -20.0 });
  assert.equal(filosofiViewportBox(wide).reason, 'off-coverage');
  const tight = createViewer({ south: 43.0, west: -25.0, north: 43.02, east: -24.98 });
  assert.equal(filosofiViewportBox(tight).reason, 'off-coverage');
});

test('coverage is metropolitan France, Martinique and La Réunion — and not Guyane', () => {
  assert.equal(filosofiCoverageIntersects({ south: 45.7, west: 4.8, north: 45.8, east: 4.9 }), true);
  assert.equal(filosofiCoverageIntersects({ south: 14.5, west: -61.1, north: 14.7, east: -60.9 }), true);
  assert.equal(filosofiCoverageIntersects({ south: -21.0, west: 55.4, north: -20.9, east: 55.6 }), true);
  // INSEE publishes the carroyage for three zones. Guyane is not one of them,
  // and pretending otherwise would spend a request to be told zero.
  assert.equal(filosofiCoverageIntersects({ south: 4.0, west: -53.0, north: 5.0, east: -52.0 }), false);
  assert.equal(filosofiCoverageIntersects(null), false);
});

test('a Lyon viewport passes the gate', () => {
  const viewer = createViewer({ south: 45.75, west: 4.83, north: 45.77, east: 4.86 });
  const { box, reason } = filosofiViewportBox(viewer);
  assert.equal(reason, null);
  assert.ok(box && box.north > box.south);
});

test('the view gate flies the camera in rather than leaving the operator to guess', async () => {
  const viewer = createViewer({ south: 44.0, west: 3.0, north: 47.0, east: 7.0 });
  const fitted = await filosofiCarreauxLayer.ensureViewGate(viewer);
  assert.equal(fitted, true);
  assert.ok(viewer.state.flights.length >= 1, 'the gate must move the camera');
  assert.ok((viewer.state.box.north - viewer.state.box.south) <= FILOSOFI_MAX_BOX_DEG);
});

// ── The imputed squares ─────────────────────────────────────────────────────

test('an imputed cell is drawn smaller than its own footprint', () => {
  // The SAME square twice, observed and imputed, so the only difference under
  // test is the flag.
  const full = drawnCorners(LYON_CELL, 200);
  const inset = drawnCorners({ ...LYON_CELL, est: 1 }, 200);
  assert.deepEqual(full, cellCorners({ res: 200, n: LYON_CELL.n, e: LYON_CELL.e }));
  const width = (corners) => Math.abs(corners[2][0] - corners[0][0]);
  assert.ok(width(inset) < width(full) * 0.7);
  assert.ok(width(inset) > width(full) * 0.5);
  // Concentric, because the inset is applied in EPSG:3035 metres before the
  // projection. Insetting after it would shear the square, since a LAEA cell is
  // not axis-aligned in WGS84.
  // 1e-7° is about a centimetre. The two centroids differ by 5e-9° — the
  // projection is not linear, so the mean of four projected corners is not
  // exactly the projected mean — and a sheared inset would be off by 4e-4°,
  // five orders of magnitude larger.
  const centre = (corners, axis) => corners.reduce((sum, c) => sum + c[axis], 0) / corners.length;
  assert.ok(Math.abs(centre(inset, 0) - centre(full, 0)) < 1e-7, 'concentric in longitude');
  assert.ok(Math.abs(centre(inset, 1) - centre(full, 1)) < 1e-7, 'concentric in latitude');
});

test('the imputation is on the card in words, never only in the geometry', () => {
  const entry = createFilosofiSelectedOverlayEntry(record(IMPUTED_CELL), { 69381: 'Lyon 1er' });
  assert.ok(entry.details.some((line) => /IMPUT/.test(line)), 'the modelled cell must say so');
  const observed = createFilosofiSelectedOverlayEntry(record(LYON_CELL), { 69381: 'Lyon 1er' });
  assert.ok(observed.details.some((line) => /observé/.test(line)));
  // Both cards state the encoding, because a viewer cannot read it off the
  // picture: colour is the indicator, height is the count under it.
  for (const card of [entry, observed]) {
    assert.ok(card.details.some((line) => /Hauteur = /.test(line)));
  }
});

test('the card names the commune when the grid has one and does not invent one otherwise', () => {
  const named = createFilosofiSelectedOverlayEntry(record(LYON_CELL), { 69381: 'Lyon 1er' });
  assert.equal(named.title, 'Lyon 1er');
  // A 1 km square spans communes and INSEE names none, so neither does the card.
  const coarse = createFilosofiSelectedOverlayEntry(
    record({ ...LYON_CELL, com: null }, { resolution: 1000 }), {},
  );
  assert.equal(coarse.title, 'Carreau 1 km');
  assert.ok(coarse.details.some((line) => /Carreau 1 km/.test(line)));
});

test('a cell with no income publishes that rather than a blank line', () => {
  const entry = createFilosofiSelectedOverlayEntry(record({ ...LYON_CELL, niveau: null }), {});
  assert.ok(entry.details.some((line) => /Niveau de vie non publié/.test(line)));
});

// ── Switching indicators ────────────────────────────────────────────────────

test('changing the indicator recolours what is drawn and never refetches', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => { fetches.push(args[0]); return originalFetch?.(...args); };
  try {
    _setFilosofiStateForTest({
      viewer: createViewer({ south: 45.75, west: 4.83, north: 45.77, east: 4.86 }),
      records: new Map([[cellId(LYON_CELL, 200), record(LYON_CELL)]]),
      payload: payload(),
      metric: 'niveau',
    });
    assert.equal(_filosofiMetricForTest().id, 'niveau');
    assert.equal(_filosofiSetParamsForTest({ metric: 'pauvrete' }), true);
    assert.equal(_filosofiMetricForTest().id, 'pauvrete');
    assert.equal(fetches.length, 0, 'every indicator arrived in the same answer');
    // The same value twice is not a change, and must not redraw the city.
    assert.equal(_filosofiSetParamsForTest({ metric: 'pauvrete' }), false);
    // An unknown indicator falls back to niveau de vie rather than to nothing.
    assert.equal(_filosofiSetParamsForTest({ metric: 'wealth' }), true);
    assert.equal(_filosofiMetricForTest().id, 'niveau');
    assert.equal(_filosofiSetParamsForTest({}), false);
  } finally {
    globalThis.fetch = originalFetch;
    _setFilosofiStateForTest({ metric: 'niveau', payload: null, records: new Map() });
  }
});

test('every indicator has a chip and exactly one is active', () => {
  _setFilosofiStateForTest({ payload: payload(), metric: 'social' });
  const { chips } = _filosofiRowControlsForTest();
  assert.equal(chips.length, 8);
  assert.equal(chips.filter((chip) => chip.active).length, 1);
  assert.equal(chips.find((chip) => chip.active).id, 'social');
  for (const chip of chips) {
    assert.ok(chip.title.length > 20, `${chip.id} must explain itself`);
    assert.equal(chip.params.metric, chip.id);
  }
});

// ── The legend ──────────────────────────────────────────────────────────────

test('the legend carries the break VALUES, because the ramp claims to be absolute', () => {
  const legend = filosofiLegend(resolveMetric('niveau'), [LYON_CELL, IMPUTED_CELL]);
  assert.equal(legend.length, 6, 'six bands, no unknown row when every cell has a value');
  assert.match(legend[0].label, /15\s?300/);
  assert.match(legend[5].label, /32\s?400/);
  // Both fixture cells earn 22 872 €, which is band 3 (22 700 – 27 100).
  assert.equal(legend[3].count, 2);
  assert.equal(legend.reduce((sum, band) => sum + band.count, 0), 2);
});

test('cells the indicator is not published for get their own legend row, not band zero', () => {
  const legend = filosofiLegend(resolveMetric('niveau'), [{ ...LYON_CELL, niveau: null }]);
  const unknown = legend.at(-1);
  assert.equal(unknown.label, 'Non publié');
  assert.equal(unknown.count, 1);
  assert.equal(legend[0].count, 0, 'a missing value is not a low value');
});

test('a percentage legend says percent and a euro legend does not', () => {
  assert.match(filosofiLegend(resolveMetric('pauvrete'), [])[0].label, /%/);
  assert.doesNotMatch(filosofiLegend(resolveMetric('niveau'), [])[0].label, /%/);
});

// ── Selection ───────────────────────────────────────────────────────────────

test('clicking a square opens its card and Escape closes it', () => {
  const entries = [];
  _setFilosofiStateForTest({
    viewer: createViewer({ south: 45.75, west: 4.83, north: 45.77, east: 4.86 }),
    records: new Map([[cellId(LYON_CELL, 200), record(LYON_CELL)]]),
    payload: payload(),
    overlayHost: {
      setEntries: (id, list) => entries.push(list),
      setVisible: () => {},
      clearSource: () => entries.push(null),
    },
  });
  assert.equal(_selectFilosofiCellForTest(cellId(LYON_CELL, 200)), true);
  assert.equal(_filosofiSelectedIdForTest(), cellId(LYON_CELL, 200));
  assert.equal(entries.at(-1).length, 1);
  _clearFilosofiSelectionForTest();
  assert.equal(_filosofiSelectedIdForTest(), null);
  // A square that is not drawn cannot be selected.
  assert.equal(_selectFilosofiCellForTest('filosofi:200:1:1'), false);
});

// ── What the row reports ────────────────────────────────────────────────────

test('the imputed share is reported next to the totals it qualifies', () => {
  _setFilosofiStateForTest({ payload: payload(), metric: 'niveau' });
  const stats = _filosofiStatsForTest();
  assert.equal(stats.people, 545);
  assert.equal(stats.imputedCells, 1);
  assert.equal(stats.imputedShare, 50);
  assert.equal(stats.vintage, 2019);
  assert.equal(stats.metric, 'niveau');
  assert.equal(stats.status, 'ok');
});

test('a truncated viewport says how many squares it is not drawing', () => {
  _setFilosofiStateForTest({
    payload: { ...payload(), truncated: true, matched: 9000, returned: 6000 },
  });
  const stats = _filosofiStatsForTest();
  assert.equal(stats.degraded, true);
  assert.match(stats.loadingLabel, /9\s?000/);
  assert.match(stats.loadingLabel, /6\s?000/);
});
