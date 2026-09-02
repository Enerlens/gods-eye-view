// src/data/filosofiFeed.test.mjs
// Pins the INSEE carroyage against two captured WFS answers — six 200 m cells
// over Lyon, four 1 km cells over Paris. The fixtures still carry their
// `geometry`, which the layer never asks for: that is exactly what makes them
// the right fixture, because the claim under test is that the cell IDENTIFIER
// reproduces the polygon the service would have sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FILOSOFI_FIELDS,
  FILOSOFI_IMPUTED_FIELD,
  FILOSOFI_MAX_CELLS,
  FILOSOFI_METRICS,
  FILOSOFI_METRES_PER_HOUSEHOLD,
  FILOSOFI_METRES_PER_PERSON,
  FILOSOFI_MIN_EXTRUSION_M,
  FILOSOFI_PUBLISHED_CELLS,
  FILOSOFI_RAMPS,
  FILOSOFI_TYPENAMES,
  buildCarreauxUrl,
  cellCentre,
  cellColor,
  cellCorners,
  cellHeightM,
  laeaToWgs84,
  metricBand,
  parseCellId,
  projectCarreaux,
  resolutionForBox,
  resolveMetric,
  studentBand,
  summarizeCells,
  weightedMean,
} from './filosofiFeed.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const LYON_200M = read('filosofi-carreaux-200m-sample.json');
const PARIS_1KM = read('filosofi-carreaux-1km-sample.json');

// ── The identifier is the polygon ───────────────────────────────────────────

test('the inverse projection reproduces the geometry the service published', () => {
  let checked = 0;
  for (const sample of [LYON_200M, PARIS_1KM]) {
    for (const feature of sample.features) {
      const parsed = parseCellId(feature.properties.id_inspire);
      assert.ok(parsed, `${feature.properties.id_inspire} must parse`);
      const published = feature.geometry.coordinates[0][0];
      const derived = cellCorners(parsed);
      // The service closes its ring by repeating the first corner; the derived
      // form does not, so compare the first four only.
      assert.equal(published.length, 5, 'a closed square has five listed corners');
      for (let i = 0; i < 4; i += 1) {
        assert.ok(
          Math.abs(published[i][0] - derived[i][0]) < 1e-7,
          `${feature.properties.id_inspire} corner ${i} lon: ${published[i][0]} vs ${derived[i][0]}`,
        );
        assert.ok(
          Math.abs(published[i][1] - derived[i][1]) < 1e-7,
          `${feature.properties.id_inspire} corner ${i} lat: ${published[i][1]} vs ${derived[i][1]}`,
        );
      }
      checked += 1;
    }
  }
  assert.equal(checked, 10, 'both fixtures must still be exercised');
});

test('a LAEA square is not axis-aligned in WGS84, and the corners say so', () => {
  // If it were, the two north corners would share a latitude with the two
  // south ones and the layer could draw a rectangle from the centre. Over
  // Paris the west edge is tilted by roughly 0.0003° — small, and 20 m on the
  // ground, which is a tenth of a cell.
  const paris = parseCellId('CRS3035RES200mN2893400E3763200');
  const [sw, nw, ne, se] = cellCorners(paris);
  assert.notEqual(sw[0], nw[0], 'the west edge is not a meridian');
  assert.notEqual(sw[1], se[1], 'the south edge is not a parallel');
  assert.ok(Math.abs(sw[0] - nw[0]) > 1e-5, 'the tilt is large enough to see');
  assert.ok(ne[1] > se[1] && nw[1] > sw[1], 'north corners are still north');
});

test('the projection origin round-trips to 52°N 10°E', () => {
  const [lon, lat] = laeaToWgs84(4_321_000, 3_210_000);
  assert.ok(Math.abs(lon - 10) < 1e-9);
  assert.ok(Math.abs(lat - 52) < 1e-9);
});

test('the centre sits inside its own corners', () => {
  const cell = parseCellId('CRS3035RES200mN2529400E3919200');
  const [lon, lat] = cellCentre(cell);
  const corners = cellCorners(cell);
  const lons = corners.map((corner) => corner[0]);
  const lats = corners.map((corner) => corner[1]);
  assert.ok(lon > Math.min(...lons) && lon < Math.max(...lons));
  assert.ok(lat > Math.min(...lats) && lat < Math.max(...lats));
});

test('an identifier from another grid or another CRS is refused, not guessed', () => {
  assert.equal(parseCellId('CRS3035RES200mN2529400E3919200').res, 200);
  assert.equal(parseCellId('CRS3035RES1000mN2888000E3758000').res, 1000);
  assert.equal(parseCellId('CRS3857RES200mN2529400E3919200'), null);
  assert.equal(parseCellId('N2529400E3919200'), null);
  assert.equal(parseCellId(''), null);
  assert.equal(parseCellId(null), null);
});

// ── The request ─────────────────────────────────────────────────────────────

test('the bbox is written in GIS order with the plain EPSG suffix', () => {
  // The URN spelling reads lat-first and the plain one reads lon-first; both
  // answer HTTP 200, so the wrong one is a silently displaced map rather than
  // an error. Measured 2026-09-02.
  const url = new URL(buildCarreauxUrl({
    box: { south: 45.75, west: 4.83, north: 45.77, east: 4.86 },
  }));
  assert.equal(url.searchParams.get('BBOX'), '4.83000,45.75000,4.86000,45.77000,EPSG:4326');
  assert.equal(url.searchParams.get('TYPENAMES'), FILOSOFI_TYPENAMES[200]);
  assert.equal(url.searchParams.get('OUTPUTFORMAT'), 'application/json');
  assert.equal(url.searchParams.get('COUNT'), String(FILOSOFI_MAX_CELLS));
});

test('the request never asks for geometry', () => {
  const fields = new URL(buildCarreauxUrl({
    box: { south: 45.75, west: 4.83, north: 45.77, east: 4.86 },
  })).searchParams.get('PROPERTYNAME').split(',');
  assert.ok(!fields.includes('geom'), 'geometry is rebuilt, never transported');
  assert.deepEqual(fields, [...FILOSOFI_FIELDS[200]]);
});

test('an unsupported resolution throws rather than falling back to a grid', () => {
  const box = { south: 45.75, west: 4.83, north: 45.77, east: 4.86 };
  assert.throws(() => buildCarreauxUrl({ box, resolution: 500 }), /unsupported resolution/);
  assert.throws(() => buildCarreauxUrl({ box: { south: NaN, west: 0, north: 1, east: 1 } }), /finite/);
});

test('the grid coarsens with the view', () => {
  assert.equal(resolutionForBox({ south: 45.75, north: 45.77, west: 4.83, east: 4.86 }), 200);
  assert.equal(resolutionForBox({ south: 45.5, north: 46.0, west: 4.5, east: 5.2 }), 1000);
  assert.equal(resolutionForBox(null), 1000);
  // Width counts, at the 0.66 factor that makes a wide letterboxed view behave
  // like the tall one it covers the same ground as.
  assert.equal(resolutionForBox({ south: 45.75, north: 45.77, west: 4.0, east: 5.0 }), 1000);
});

// ── The projection ──────────────────────────────────────────────────────────

test('the captured answers still carry every field the projection reads', () => {
  for (const [resolution, sample] of [[200, LYON_200M], [1000, PARIS_1KM]]) {
    const props = sample.features[0].properties;
    for (const field of FILOSOFI_FIELDS[resolution]) {
      assert.ok(Object.hasOwn(props, field), `${field} must still be published at ${resolution} m`);
    }
  }
});

test('the two grids disagree about their column names, and the request knows it', () => {
  // Asking a grid for the other one's column is an HTTP 400, so this is the
  // difference between a working layer and a dead one at half the altitudes.
  const fine = LYON_200M.features[0].properties;
  const coarse = PARIS_1KM.features[0].properties;
  assert.ok(Object.hasOwn(fine, 'i_car_est') && !Object.hasOwn(fine, 'i_est_1km'));
  assert.ok(Object.hasOwn(coarse, 'i_est_1km') && !Object.hasOwn(coarse, 'i_car_est'));
  assert.equal(FILOSOFI_IMPUTED_FIELD[200], 'i_car_est');
  assert.equal(FILOSOFI_IMPUTED_FIELD[1000], 'i_est_1km');
  // A 1 km square spans communes, so the coarse grid names none.
  assert.ok(Object.hasOwn(fine, 'depcom'));
  assert.ok(!Object.hasOwn(coarse, 'depcom'));
  assert.ok(!FILOSOFI_FIELDS[1000].includes('depcom'));
});

test('the imputation flag is read from the right column for each grid', () => {
  const fine = projectCarreaux(LYON_200M, { resolution: 200 });
  const coarse = projectCarreaux(PARIS_1KM, { resolution: 1000 });
  assert.ok(fine.cells.every((cell) => cell.est === 0 || cell.est === 1));
  assert.ok(coarse.cells.every((cell) => cell.est === 0 || cell.est === 1));
  // Reading `i_car_est` off a 1 km cell would report every one of them as
  // observed, which is the failure this asserts against.
  const imputedCoarse = { features: [{ properties: { ...PARIS_1KM.features[0].properties, i_est_1km: 1 } }] };
  assert.equal(projectCarreaux(imputedCoarse, { resolution: 1000 }).cells[0].est, 1);
});

test('a 1 km cell has no commune, and the dictionary stays empty rather than guessing', () => {
  const coarse = projectCarreaux(PARIS_1KM, { resolution: 1000 });
  assert.deepEqual(coarse.communes, {});
  assert.equal(coarse.cells[0].com, null);
});

test('a Lyon viewport projects to drawable cells with a commune dictionary', () => {
  const projected = projectCarreaux(LYON_200M, { resolution: 200 });
  assert.equal(projected.returned, 6);
  assert.equal(projected.matched, 27);
  assert.equal(projected.truncated, true, '27 matched against 6 returned is a truncated box');
  const first = projected.cells[0];
  assert.equal(first.n, 2_529_400);
  assert.equal(first.e, 3_919_200);
  assert.equal(first.ind, 1123.5, 'the half is INSEE arithmetic and is kept');
  assert.equal(first.niveau, 24_542);
  assert.equal(first.pauvrete, 22);
  assert.equal(first.com, '69387');
  assert.equal(projected.communes['69387'], 'Lyon 7e Arrondissement');
  // The name appears once in the dictionary and never on a cell.
  assert.equal(Object.hasOwn(first, 'nom_com'), false);
});

test('cells from the wrong grid are dropped rather than drawn at the wrong size', () => {
  const mixed = { features: [...LYON_200M.features, ...PARIS_1KM.features], numberMatched: 10 };
  assert.equal(projectCarreaux(mixed, { resolution: 200 }).returned, 6);
  assert.equal(projectCarreaux(mixed, { resolution: 1000 }).returned, 4);
});

test('an empty or malformed answer projects to nothing rather than throwing', () => {
  for (const payload of [null, undefined, {}, { features: null }, { features: [{}] }]) {
    const projected = projectCarreaux(payload);
    assert.equal(projected.returned, 0);
    assert.equal(projected.truncated, false);
  }
});

test('a box that fits exactly is not reported as truncated', () => {
  const exact = { features: LYON_200M.features, numberMatched: 6 };
  assert.equal(projectCarreaux(exact, { resolution: 200 }).truncated, false);
});

// ── The indicators ──────────────────────────────────────────────────────────

test('every metric has a ramp, a unit and a weight the extrusion can read', () => {
  for (const metric of FILOSOFI_METRICS) {
    const key = metric.id === 'population' ? 'population' : metric.id;
    assert.ok(FILOSOFI_RAMPS[key], `${metric.id} needs measured breaks`);
    assert.equal(FILOSOFI_RAMPS[key].length, 5, 'five breaks make six bands');
    assert.equal(metric.ramp.length, 6, 'six colours for six bands');
    assert.ok(metric.unit && metric.unit.length > 2, `${metric.id} must state its unit`);
    assert.ok(['ind', 'men'].includes(metric.weight));
    assert.ok(metric.blurb.length > 10);
  }
});

test('the bands are the national quantiles, so a colour means the same everywhere', () => {
  const niveau = resolveMetric('niveau');
  assert.equal(metricBand(10_000, niveau), 0, 'below p10');
  assert.equal(metricBand(15_300, niveau), 1, 'the break itself lands in the band above');
  assert.equal(metricBand(22_700, niveau), 3);
  assert.equal(metricBand(90_000, niveau), 5, 'above p90');
  assert.equal(metricBand(null, niveau), -1);
  assert.equal(metricBand(NaN, niveau), -1);
});

test('an unknown metric id resolves to niveau de vie rather than to nothing', () => {
  assert.equal(resolveMetric('nope').id, 'niveau');
  assert.equal(resolveMetric(null).id, 'niveau');
  assert.equal(resolveMetric('pauvrete').id, 'pauvrete');
});

test('a cell with no value for the metric gets no colour at all', () => {
  const metric = resolveMetric('niveau');
  assert.equal(cellColor({ niveau: null, ind: 40 }, metric), null);
  assert.equal(typeof cellColor({ niveau: 24_000, ind: 40 }, metric), 'string');
});

test('the extrusion is the denominator, never the indicator', () => {
  const niveau = resolveMetric('niveau');
  const pauvrete = resolveMetric('pauvrete');
  const rich = { ind: 100, men: 40, niveau: 60_000, pauvrete: 2 };
  const poor = { ind: 100, men: 40, niveau: 11_000, pauvrete: 45 };
  // Same population, wildly different indicator: the same height.
  assert.equal(cellHeightM(rich, niveau), cellHeightM(poor, niveau));
  assert.equal(cellHeightM(rich, niveau), 100 * FILOSOFI_METRES_PER_PERSON);
  // A household metric stands on households.
  assert.equal(cellHeightM(rich, pauvrete), 40 * FILOSOFI_METRES_PER_HOUSEHOLD);
});

test('a four-household cell is still visible, and still four households', () => {
  const metric = resolveMetric('niveau');
  assert.equal(cellHeightM({ ind: 1, men: 1, niveau: 90_000 }, metric), FILOSOFI_MIN_EXTRUSION_M);
  assert.equal(cellHeightM({ ind: 0, men: 0 }, metric), 0, 'an empty cell has no volume');
  assert.equal(cellHeightM({ ind: null, men: null }, metric), 0);
});

test('the coarse grid does not tower over the fine one', () => {
  const metric = resolveMetric('niveau');
  // Same density: 25 times the people over 25 times the area.
  const fine = cellHeightM({ ind: 400, men: 160 }, metric, { resolution: 200 });
  const coarse = cellHeightM({ ind: 10_000, men: 4_000 }, metric, { resolution: 1000 });
  assert.equal(fine, coarse);
});

// ── The summary ─────────────────────────────────────────────────────────────

test('the viewport summary is population-weighted, not square-weighted', () => {
  const cells = [
    { ind: 2000, men: 900, niveau: 20_000, pauvrete: 30, est: 0 },
    { ind: 10, men: 4, niveau: 60_000, pauvrete: 0, est: 1 },
  ];
  const summary = summarizeCells(cells);
  assert.equal(summary.people, 2010);
  assert.equal(summary.households, 904);
  assert.equal(summary.imputedCells, 1);
  assert.equal(summary.imputedShare, 50);
  // The unweighted mean would be 40 000 €. Nobody lives in a square.
  assert.equal(summary.niveau, 20_199);
  assert.ok(summary.pauvrete > 29 && summary.pauvrete < 30);
});

test('a weighted mean ignores cells with no value or no weight', () => {
  assert.equal(weightedMean([{ v: 10, w: 0 }], 'v', 'w'), null);
  assert.equal(weightedMean([{ v: null, w: 5 }], 'v', 'w'), null);
  assert.equal(weightedMean([], 'v', 'w'), null);
  assert.equal(weightedMean([{ v: 10, w: 1 }, { v: 20, w: 3 }], 'v', 'w'), 17.5);
});

test('the summary of nothing is zero rather than a null total', () => {
  const summary = summarizeCells([]);
  assert.equal(summary.cells, 0);
  assert.equal(summary.people, 0);
  assert.equal(summary.imputedShare, null);
  assert.equal(summary.niveau, null);
});

// ── The band the relay drops ────────────────────────────────────────────────

test('the missing 18-24 band is recovered as a residual, and only when it can be', () => {
  // The Lyon 7e fixture: 1 123.5 people, nine published bands summing to 994.5.
  const props = {
    ind: 1123.5,
    ind_0_3: 47, ind_4_5: 16, ind_6_10: 35.5, ind_11_17: 53, ind_25_39: 409,
    ind_40_54: 193, ind_55_64: 115, ind_65_79: 94, ind_80p: 32,
  };
  assert.equal(studentBand(props), 129);
  // The layer's own request omits the bands, so the residual must decline
  // rather than report the whole population as 18-24 year olds.
  assert.equal(studentBand({ ind: 1123.5 }), null);
  assert.equal(studentBand(null), null);
});

// ── The pinned figures ──────────────────────────────────────────────────────

test('the published cell counts are pinned so a thinner relay is a failure', () => {
  assert.equal(FILOSOFI_PUBLISHED_CELLS[200], 2_314_836);
  assert.equal(FILOSOFI_PUBLISHED_CELLS[1000], 377_234);
  assert.ok(FILOSOFI_PUBLISHED_CELLS[200] > FILOSOFI_PUBLISHED_CELLS[1000] * 5);
});
