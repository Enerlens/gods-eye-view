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
  FILOSOFI_DISC_DIAMETER,
  FILOSOFI_MAX_FILL,
  FILOSOFI_METRICS,
  FILOSOFI_MIN_FILL,
  FILOSOFI_PUBLISHED_CELLS,
  FILOSOFI_SIZE_BREAKS,
  FILOSOFI_RAMPS,
  FILOSOFI_TYPENAMES,
  buildCarreauxUrl,
  cellCentre,
  cellColor,
  cellClearanceM,
  cellCorners,
  cellDisc,
  cellSymbol,
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
      // 1e-8, which is what the module header claims. It used to be 1e-7 — ten
      // times looser than the promise — and the gap is exactly where the
      // overseas drift hid. The residual against these fixtures is 8,5e-9,
      // which is the fixtures' own rounding, not the projection's.
      for (let i = 0; i < 4; i += 1) {
        assert.ok(
          Math.abs(published[i][0] - derived[i][0]) < 1e-8,
          `${feature.properties.id_inspire} corner ${i} lon: ${published[i][0]} vs ${derived[i][0]}`,
        );
        assert.ok(
          Math.abs(published[i][1] - derived[i][1]) < 1e-8,
          `${feature.properties.id_inspire} corner ${i} lat: ${published[i][1]} vs ${derived[i][1]}`,
        );
      }
      checked += 1;
    }
  }
  assert.equal(checked, 10, 'both fixtures must still be exercised');
});

test('the inverse holds to 1e-8 overseas too, where the series used to drift', () => {
  // THE CLAIM THIS TEST EXISTS FOR. The header promises 1e-8° and the fixtures
  // above are all mainland. Snyder's truncated series is at its best near the
  // projection's origin at 52° N and worst far from it: measured round trips
  // reached 1,4e-8° at La Réunion, 1,3e-8° at Guadeloupe and Martinique and
  // 1,2e-8° at Mayotte — INSEE publishes carroyage for every one of them, so
  // three of the four overseas départements broke a documented guarantee.
  //
  // The forward projection is written out here rather than imported, because
  // the module only ships the inverse and a round trip needs both halves.
  const { a, e2, lat0, lon0, x0, y0 } = {
    a: 6378137, e2: (1 / 298.257222101) * (2 - 1 / 298.257222101),
    lat0: (52 * Math.PI) / 180, lon0: (10 * Math.PI) / 180, x0: 4321000, y0: 3210000,
  };
  const e = Math.sqrt(e2);
  const q = (phi) => {
    const s = Math.sin(phi);
    return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
  };
  const qp = q(Math.PI / 2);
  const rq = a * Math.sqrt(qp / 2);
  const beta0 = Math.asin(q(lat0) / qp);
  const m0 = Math.cos(lat0) / Math.sqrt(1 - e2 * Math.sin(lat0) ** 2);
  const d = (a * m0) / (rq * Math.cos(beta0));
  const forward = (lonDeg, latDeg) => {
    const phi = (latDeg * Math.PI) / 180;
    const lam = (lonDeg * Math.PI) / 180;
    const beta = Math.asin(q(phi) / qp);
    const b = rq * Math.sqrt(2 / (1 + Math.sin(beta0) * Math.sin(beta)
      + Math.cos(beta0) * Math.cos(beta) * Math.cos(lam - lon0)));
    return [
      b * d * Math.cos(beta) * Math.sin(lam - lon0) + x0,
      (b / d) * (Math.cos(beta0) * Math.sin(beta)
        - Math.sin(beta0) * Math.cos(beta) * Math.cos(lam - lon0)) + y0,
    ];
  };

  const probes = [
    ['Lille', 3.06, 50.63], ['Lyon', 4.835, 45.764], ['Brest', -4.49, 48.39],
    ['Ajaccio', 8.74, 41.93], ['Guadeloupe', -61.55, 16.24], ['Martinique', -61.0, 14.6],
    ['Guyane', -52.3, 4.9], ['La Réunion', 55.5, -21.1], ['Mayotte', 45.0, -13.0],
  ];
  for (const [name, lon, lat] of probes) {
    const [easting, northing] = forward(lon, lat);
    const [lon2, lat2] = laeaToWgs84(easting, northing);
    // Four orders of magnitude inside the documented bound, so this test fails
    // on a regression rather than on the last bit of a double.
    assert.ok(Math.abs(lon2 - lon) < 1e-12, `${name} lon drift ${lon2 - lon}`);
    assert.ok(Math.abs(lat2 - lat) < 1e-12, `${name} lat drift ${lat2 - lat}`);
  }
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

test('a full page with no count is truncated, because the WFS caps silently', () => {
  // THE FAILURE THIS REPLACES. The Géoplateforme cuts a page at 5 000 rows and
  // is documented to answer `numberMatched: "unknown"`. The old rule needed a
  // number to compare against, so an "unknown" or absent count made a capped
  // page report `truncated: false` — and the fiche summed it and sold the total
  // as a whole catchment.
  const page = (rows) => ({
    features: Array.from({ length: rows }, (_, i) => ({
      properties: {
        id_inspire: `CRS3035RES200mN${2_500_000 + i * 200}E3900000`, ind: 10, men: 4, i_car_est: 0,
      },
    })),
  });
  const full = page(FILOSOFI_MAX_CELLS);
  assert.equal(projectCarreaux(full, { resolution: 200 }).truncated, true, 'absent count');
  assert.equal(
    projectCarreaux({ ...full, numberMatched: 'unknown' }, { resolution: 200 }).truncated,
    true,
    'the string the service actually sends',
  );
  assert.equal(projectCarreaux(full, { resolution: 200 }).capped, true);
  const short = page(FILOSOFI_MAX_CELLS - 1);
  assert.equal(projectCarreaux(short, { resolution: 200 }).truncated, false, 'one row short is complete');
  assert.equal(projectCarreaux(short, { resolution: 200 }).capped, false);
});

test('an absent imputation flag is unknown, never "observed"', () => {
  // `Number(undefined)` is NaN and the old test `=== 1 ? 1 : 0` sent it to 0,
  // which is the assertion "INSEE observed this cell". Two cells in five are
  // imputed nationally, so the silent default was the flattering answer.
  const withoutFlag = {
    features: [{ properties: { id_inspire: 'CRS3035RES200mN2500000E3900000', ind: 10, men: 4 } }],
  };
  const projected = projectCarreaux(withoutFlag, { resolution: 200 });
  assert.equal(projected.cells[0].est, null);
  assert.equal(projected.estUnknown, 1);

  const flags = (value) => projectCarreaux({
    features: [{ properties: { id_inspire: 'CRS3035RES200mN2500000E3900000', ind: 10, [FILOSOFI_IMPUTED_FIELD[200]]: value } }],
  }, { resolution: 200 }).cells[0].est;
  assert.equal(flags(1), 1);
  assert.equal(flags('1'), 1, 'the WFS sends numbers as strings often enough');
  assert.equal(flags(0), 0);
  assert.equal(flags(null), null);
  assert.equal(flags(''), null);
  assert.equal(flags('oui'), null, 'unparseable is unknown, not observed');
});

test('a box that fits exactly is not reported as truncated', () => {
  const exact = { features: LYON_200M.features, numberMatched: 6 };
  assert.equal(projectCarreaux(exact, { resolution: 200 }).truncated, false);
});

// ── The indicators ──────────────────────────────────────────────────────────

test('every metric has a ramp, a unit and a weight the symbol can be sized on', () => {
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

test('the size is the denominator, never the indicator', () => {
  const niveau = resolveMetric('niveau');
  const pauvrete = resolveMetric('pauvrete');
  const rich = { ind: 100, men: 40, niveau: 60_000, pauvrete: 2, est: 0 };
  const poor = { ind: 100, men: 40, niveau: 11_000, pauvrete: 45, est: 0 };
  // Same population, wildly different indicator: the same disc.
  assert.equal(cellSymbol(rich, niveau).fill, cellSymbol(poor, niveau).fill);
  // A household metric is classed on households, against their own measured
  // breaks — otherwise switching from a per-person indicator to a per-household
  // one would relayout the city and read as a change in the country.
  const breaks = FILOSOFI_SIZE_BREAKS[200];
  assert.equal(cellSymbol({ ind: breaks.ind.at(-1), men: 40, est: 0 }, niveau).fill,
    FILOSOFI_MAX_FILL, 'the national p90 of people opens the top class');
  assert.equal(cellSymbol({ ind: 900, men: breaks.men.at(-1), est: 0 }, pauvrete).fill,
    FILOSOFI_MAX_FILL, 'and the p90 of households does the same on its own scale');
});

test('six size classes, evenly stepped and each visibly bigger than the last', () => {
  const metric = resolveMetric('niveau');
  const breaks = FILOSOFI_SIZE_BREAKS[200].ind;
  // One count just inside each class, from below the first break to above the
  // last one.
  const fills = [breaks[0] - 1, ...breaks].map(
    (ind) => cellSymbol({ ind, men: ind / 2.2, est: 0 }, metric).fill,
  );
  assert.equal(fills.length, 6, 'five breaks make six classes');
  assert.equal(fills[0], FILOSOFI_MIN_FILL);
  assert.equal(fills.at(-1), FILOSOFI_MAX_FILL);
  for (let index = 1; index < fills.length; index += 1) {
    const grew = (fills[index] / fills[index - 1]) ** 2;
    // Each step is at least a quarter more ink than the one below it. Below
    // about that, two discs read as noise rather than as different sizes —
    // which is the whole reason the scale is classed and not proportional.
    assert.ok(grew > 1.25, `class ${index} is only ${grew.toFixed(2)}× the ink of ${index - 1}`);
  }
});

test('the coarse grid is classed on its own measured distribution', () => {
  const metric = resolveMetric('niveau');
  const coarse = FILOSOFI_SIZE_BREAKS[1000].ind;
  // Not the fine breaks times 25: the 200 m cells inside a dense square are not
  // all dense, and the measured coarse p90 is 33 % below that arithmetic.
  assert.ok(coarse.at(-1) < FILOSOFI_SIZE_BREAKS[200].ind.at(-1) * 25 * 0.8);
  assert.equal(
    cellSymbol({ ind: coarse.at(-1), men: 9_000, est: 0 }, metric, { resolution: 1000 }).fill,
    FILOSOFI_MAX_FILL,
  );
  // A median coarse carreau — 109 people over Bordeaux — is the bottom class,
  // and the bottom class is still drawn.
  assert.equal(
    cellSymbol({ ind: 109, men: 48, est: 0 }, metric, { resolution: 1000 }).fill,
    FILOSOFI_MIN_FILL,
  );
});

test('more people is never a smaller disc', () => {
  const metric = resolveMetric('niveau');
  let previous = 0;
  for (const ind of [1, 50, 90, 200, 430, 900, 1_530, 5_000, 56_360]) {
    const { fill } = cellSymbol({ ind, men: ind / 2.2, est: 0 }, metric);
    assert.ok(fill >= previous, `${ind} people must not shrink the symbol`);
    previous = fill;
  }
});

test('a symbol never fills its own cell, however many people are in it', () => {
  const metric = resolveMetric('niveau');
  // The densest carreau measured anywhere in France, and then twenty times it.
  for (const ind of [2_818, 56_360]) {
    const { fill } = cellSymbol({ ind, men: ind / 2.2, est: 0 }, metric);
    assert.ok(fill <= FILOSOFI_MAX_FILL, `${ind} people must not fill the cell`);
  }
  // An imputed cell is grown to keep the area its hole costs it — and even
  // that, drawn as a disc, has to stay inside the square it belongs to.
  const hollow = cellSymbol({ ind: 56_360, men: 25_000, est: 1 }, metric);
  assert.ok(hollow.fill * FILOSOFI_DISC_DIAMETER < 1, 'a ring stays inside its cell');
  assert.ok(hollow.fill > FILOSOFI_MAX_FILL, 'the ring is grown, not shrunk');
});

test('the disc covers the ground its fraction promises, not π/4 of it', () => {
  // The scale is quoted in squares and drawn in circles; reading the fraction
  // as a diameter would understate every count by 21 %.
  const side = 200 * 0.5;
  const radius = (side * FILOSOFI_DISC_DIAMETER) / 2;
  assert.ok(Math.abs((Math.PI * radius * radius) / (side * side) - 1) < 1e-12);

  const cell = { res: 200, n: 2_531_400, e: 3_918_600 };
  const outline = cellDisc(cell, 0.5);
  assert.equal(outline.length, 32, 'a visibly polygonal disc is also the wrong size');
  // The drawn ring really is that wide on the ground: north–south extent, where
  // a degree is 111 132 m everywhere and needs no cosine.
  const lats = outline.map(([, lat]) => lat);
  const spanM = (Math.max(...lats) - Math.min(...lats)) * 111_132;
  // A 32-gon measured across flats is cos(π/32) of its circle — 0.5 % short.
  assert.ok(Math.abs(spanM / (side * FILOSOFI_DISC_DIAMETER) - 1) < 0.01, `${spanM} m`);
  // Concentric with the cell it belongs to, like the squares were.
  const centre = cellCentre(cell);
  const mean = (axis) => outline.reduce((sum, point) => sum + point[axis], 0) / outline.length;
  assert.ok(Math.abs(mean(0) - centre[0]) < 1e-7, 'concentric in longitude');
  assert.ok(Math.abs(mean(1) - centre[1]) < 1e-7, 'concentric in latitude');
});

test('a four-household cell is still visible, and still four households', () => {
  const metric = resolveMetric('niveau');
  assert.equal(cellSymbol({ ind: 1, men: 1, niveau: 90_000, est: 0 }, metric).fill, FILOSOFI_MIN_FILL);
  assert.equal(cellSymbol({ ind: 0, men: 0 }, metric).fill, 0, 'an empty cell has no extent');
  assert.equal(cellSymbol({ ind: null, men: null }, metric).fill, 0);
});

test('an imputed square is hollow, and the hollow costs it no area', () => {
  const metric = resolveMetric('niveau');
  const cell = { ind: 300, men: 130, niveau: 21_000 };
  const observed = cellSymbol({ ...cell, est: 0 }, metric);
  const imputed = cellSymbol({ ...cell, est: 1 }, metric);
  assert.equal(observed.hole, 0);
  assert.ok(imputed.hole > 0);
  // The frame covers exactly what the solid square covers: the hollow is a
  // claim about provenance, and must not double as a quieter claim about the
  // count.
  const framed = imputed.fill ** 2 - imputed.hole ** 2;
  assert.ok(Math.abs(framed - observed.fill ** 2) < 1e-12);
});

test('the clearance scales with the disc, and the symbol has no other height', () => {
  // Nothing stands up: the count is the area, and extruding it a second time
  // would make volume grow as count^1.5. What is left is enough clearance to
  // keep a flat disc out of the hillside it is describing, on ONE terrain
  // sample — five per cell was measured five times slower per redraw.
  assert.ok(cellClearanceM(200, FILOSOFI_MIN_FILL) > 0, 'a speck still clears the imagery');
  assert.ok(cellClearanceM(200, FILOSOFI_MAX_FILL) > cellClearanceM(200, FILOSOFI_MIN_FILL),
    'a wider disc spans more relief and has to be lifted further');
  assert.ok(cellClearanceM(1000, FILOSOFI_MAX_FILL) > cellClearanceM(200, FILOSOFI_MAX_FILL));
  // A 20 % slope is the contract: at the ceiling on the 200 m grid the disc is
  // 162 m across, and its uphill edge rises 16 m over the centre sample.
  const radius = (200 * FILOSOFI_MAX_FILL * FILOSOFI_DISC_DIAMETER) / 2;
  assert.ok(cellClearanceM(200, FILOSOFI_MAX_FILL) >= radius * 0.2 - 1e-9);
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

test('the row ceiling is the service\'s own cap, not a number we chose', () => {
  // Measured 2026-09-02 over a 1.2° × 0.9° box holding 6 283 cells at 1 km:
  // COUNT=4000 returns 4 000, and COUNT=5000/6000/10000 all return 5 000.
  // Asking for more than the service will send would make `/status` advertise a
  // ceiling that does not exist and truncate the map earlier than documented.
  assert.equal(FILOSOFI_MAX_CELLS, 5000);
  const url = new URL(buildCarreauxUrl({
    box: { south: 45.75, west: 4.83, north: 45.77, east: 4.86 },
  }));
  assert.equal(url.searchParams.get('COUNT'), '5000');
});

test('the published cell counts are pinned so a thinner relay is a failure', () => {
  assert.equal(FILOSOFI_PUBLISHED_CELLS[200], 2_314_836);
  assert.equal(FILOSOFI_PUBLISHED_CELLS[1000], 377_234);
  assert.ok(FILOSOFI_PUBLISHED_CELLS[200] > FILOSOFI_PUBLISHED_CELLS[1000] * 5);
});
