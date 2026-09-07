import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RNB_API_BASE,
  RNB_CLOSEST_MAX_RADIUS_M,
  indexFootprintsByRnb,
  parseRnbIds,
  primaryRnbId,
  projectRnbAddress,
  projectRnbBuilding,
  projectRnbFirst,
  projectRnbPlot,
  rnbAddressUrl,
  rnbBuildingUrl,
  rnbClosestUrl,
  rnbFootprintCoverage,
  rnbPlotUrl,
} from './rnbPivot.js';

/* ── the identifier, as BD TOPO publishes it ───────────────────────────── */

test('a BD TOPO identifiants_rnb is a LIST, and every id is kept', () => {
  assert.deepEqual(parseRnbIds('2NPB8CCYQ237'), ['2NPB8CCYQ237']);
  // 65 of 2 395 Paris polygons carry more than one. Reading only the first is
  // what the selection card used to do.
  assert.deepEqual(parseRnbIds('2NPB8CCYQ237/SEX7DQ1X5KDX'), ['2NPB8CCYQ237', 'SEX7DQ1X5KDX']);
  assert.deepEqual(parseRnbIds('A/B/C/D/E').length, 5);
});

test('the absent cases BD TOPO actually emits are empty, not [""]', () => {
  // The tile emits an empty string for an absent identifier column, and a
  // `[""]` here would mint a footprint answering to the identifier "".
  for (const absent of ['', '   ', '//', null, undefined, {}, []]) {
    assert.deepEqual(parseRnbIds(absent), [], `${JSON.stringify(absent)} carries no identifier`);
  }
});

test('primaryRnbId accepts both the raw string and an already-parsed list', () => {
  assert.equal(primaryRnbId('A/B'), 'A');
  assert.equal(primaryRnbId(['A', 'B']), 'A');
  assert.equal(primaryRnbId(''), null);
  assert.equal(primaryRnbId([]), null);
});

/* ── the URLs, and the coordinate order that inverts between them ──────── */

test('the building URL asks for plots by default and can be told not to', () => {
  assert.equal(rnbBuildingUrl('2NPB8CCYQ237'),
    `${RNB_API_BASE}/buildings/2NPB8CCYQ237/?withPlots=1`);
  assert.equal(rnbBuildingUrl('2NPB8CCYQ237', { withPlots: false }),
    `${RNB_API_BASE}/buildings/2NPB8CCYQ237/`);
});

test('closest takes lat,lon — the opposite order from every bbox on this API', () => {
  // Measured against the live API: `point=48.86478,2.28708` finds the building,
  // `point=2.28708,48.86478` returns an empty list. A silent empty answer is
  // exactly the failure mode a swapped pair produces, so it is pinned here.
  assert.match(rnbClosestUrl({ lat: 48.86478, lon: 2.28708 }), /point=48\.86478,2\.28708&/);
});

test('the closest radius is clamped to what the API will accept', () => {
  // Over 1 000 m the API answers HTTP 400, not a wider search.
  assert.match(rnbClosestUrl({ lat: 45, lon: 5, radiusM: 5000 }),
    new RegExp(`radius=${RNB_CLOSEST_MAX_RADIUS_M}$`));
  assert.match(rnbClosestUrl({ lat: 45, lon: 5, radiusM: 0 }), /radius=1$/);
  assert.equal(rnbClosestUrl({ lat: Number.NaN, lon: 5 }), null);
  assert.equal(rnbClosestUrl(), null);
});

test('the address and plot URLs refuse an empty key rather than listing France', () => {
  assert.equal(rnbAddressUrl('75116_8059_00012'),
    `${RNB_API_BASE}/buildings/?cle_interop_ban=75116_8059_00012`);
  assert.equal(rnbAddressUrl('  '), null);
  assert.equal(rnbPlotUrl('69385000AK0022'), `${RNB_API_BASE}/buildings/plot/69385000AK0022/`);
  assert.equal(rnbPlotUrl(null), null);
});

/* ── the projection, against the shapes the live API returns ───────────── */

/** The live answer for `2NPB8CCYQ237`, captured 2026-09-07, shape trimmed. */
const PARIS_16E = {
  rnb_id: '2NPB8CCYQ237',
  status: 'constructed',
  point: { type: 'Point', coordinates: [2.287079784033252, 48.86478734707562] },
  addresses: [{
    id: '75116_8059_00012',
    ban_id: null,
    source: 'bdnb',
    street_number: '12',
    street_rep: null,
    street: 'Avenue Raymond Poincaré',
    city_name: 'Paris 16e Arrondissement',
    city_zipcode: '75016',
    city_insee_code: '75116',
  }],
  ext_ids: [{ id: 'bdnb-bc-CXEE-SB1R-UGCS', source: 'bdnb', source_version: '2023_01' }],
  is_active: true,
  plots: [{ id: '75116000FR0001', bdg_cover_ratio: 0.9999999999999998 }],
};

test('one building projects to the identity, the address and the ground', () => {
  const pivot = projectRnbBuilding(PARIS_16E);
  assert.equal(pivot.rnbId, '2NPB8CCYQ237');
  assert.equal(pivot.status, 'constructed');
  assert.equal(pivot.statusLabel, 'construit');
  assert.equal(pivot.isActive, true);
  assert.equal(pivot.lon, 2.287079784033252);
  assert.equal(pivot.lat, 48.86478734707562);
  assert.equal(pivot.addresses[0].label, '12 Avenue Raymond Poincaré 75016 Paris 16e Arrondissement');
  assert.equal(pivot.addresses[0].cleInterop, '75116_8059_00012');
  assert.equal(pivot.plots[0].id, '75116000FR0001');
});

test('an unknown status is shown as published rather than swallowed', () => {
  // The label table cannot be complete forever, and a card printing nothing
  // would say "ordinary building" about a demolition project.
  const pivot = projectRnbBuilding({ ...PARIS_16E, status: 'somethingNew' });
  assert.equal(pivot.statusLabel, 'somethingNew');
});

test('the BD TOPO identifier is pulled out of ext_ids — it is what closes the loop', () => {
  const pivot = projectRnbBuilding({
    ...PARIS_16E,
    ext_ids: [
      { id: 'bdnb-bc-CXEE-SB1R-UGCS', source: 'bdnb', source_version: '2023_01' },
      { id: 'BATIMENT0000000245168515', source: 'bdtopo', source_version: 'bdtopo_2023_09' },
    ],
  });
  assert.equal(pivot.bdtopoCleabs, 'BATIMENT0000000245168515');
  assert.equal(pivot.extIds.length, 2);
});

test('a building with no address and no plot is projected, not refused', () => {
  // 10 of 160 Lyon buildings publish no address at all. That is a real record.
  const pivot = projectRnbBuilding({ rnb_id: 'CMTZ133DJ58E', status: 'constructed' });
  assert.equal(pivot.rnbId, 'CMTZ133DJ58E');
  assert.deepEqual(pivot.addresses, []);
  assert.deepEqual(pivot.plots, []);
  assert.equal(pivot.bdtopoCleabs, null);
  assert.equal(pivot.isActive, null, 'absent is not "inactive"');
});

test('a body with no identifier is nothing at all', () => {
  for (const body of [null, undefined, {}, { rnb_id: '' }, 'nope']) {
    assert.equal(projectRnbBuilding(body), null);
  }
});

test('plots come back largest share of the BUILDING first', () => {
  // `A9WW4M44SF9W` straddles two Lyon parcels at 0.990 and 0.0099. The card
  // names one, and it has to be the one the building is on.
  const pivot = projectRnbBuilding({
    ...PARIS_16E,
    plots: [
      { id: '69385000AK0023', bdg_cover_ratio: 0.009910219226402254 },
      { id: '69385000AK0022', bdg_cover_ratio: 0.990089780761593 },
    ],
  });
  assert.deepEqual(pivot.plots.map((plot) => plot.id), ['69385000AK0022', '69385000AK0023']);
});

test('a plot with no ratio keeps its id and admits the ratio is missing', () => {
  assert.deepEqual(projectRnbPlot({ id: '75116000FR0001' }), { id: '75116000FR0001', coverRatio: null });
  assert.equal(projectRnbPlot({ bdg_cover_ratio: 1 }), null, 'a ratio without an id names nothing');
});

test('an address with nothing but a key produces no line', () => {
  assert.equal(projectRnbAddress({ id: '75116_8059_00012' }), null);
  assert.equal(projectRnbAddress(null), null);
});

test('the street repetition index is part of the address, not decoration', () => {
  const address = projectRnbAddress({
    id: 'x', street_number: '12', street_rep: 'bis', street: 'Rue Vieille', city_zipcode: '69002', city_name: 'Lyon',
  });
  assert.equal(address.label, '12 bis Rue Vieille 69002 Lyon');
});

test('a list answer yields its first usable building and skips the junk', () => {
  assert.equal(projectRnbFirst({ results: [{ rnb_id: '' }, PARIS_16E] }).rnbId, '2NPB8CCYQ237');
  assert.equal(projectRnbFirst({ results: [] }), null);
  assert.equal(projectRnbFirst(null), null);
});

test('the distance the closest endpoint returns survives the projection', () => {
  // It is what tells a card whether the building it found is the one clicked.
  const pivot = projectRnbBuilding({ ...PARIS_16E, distance: 7.4 });
  assert.equal(pivot.distanceM, 7.4);
  assert.equal(projectRnbBuilding(PARIS_16E).distanceM, null);
});

/* ── the index, and the two multiplicities that are both real ──────────── */

test('a polygon merging several RNB buildings answers to all of them', () => {
  const index = indexFootprintsByRnb([{ id: 'poly', rnb: ['A', 'B', 'C'] }]);
  assert.deepEqual(index.get('A'), ['poly']);
  assert.deepEqual(index.get('C'), ['poly']);
  assert.equal(index.size, 3);
});

test('a building cut across two tiles keeps BOTH halves under one id', () => {
  // `bdtopoBuildingsFeed.js` trap 4: the halves re-join on screen, and a point
  // joined by identity has to colour both or the building is painted down the
  // middle.
  const index = indexFootprintsByRnb([
    { id: 'left', rnb: ['A'] },
    { id: 'right', rnb: ['A'] },
  ]);
  assert.deepEqual(index.get('A'), ['left', 'right']);
});

test('the index accepts the raw BD TOPO string as well as a parsed list', () => {
  const index = indexFootprintsByRnb([{ id: 'poly', rnb: 'A/B' }]);
  assert.deepEqual(index.get('B'), ['poly']);
});

test('a polygon listing the same id twice claims itself once', () => {
  const index = indexFootprintsByRnb([{ id: 'poly', rnb: ['A', 'A'] }]);
  assert.deepEqual(index.get('A'), ['poly']);
});

test('footprints with no id, and entries with no id, are simply absent', () => {
  const index = indexFootprintsByRnb([
    { id: 'a', rnb: [] },
    { id: '', rnb: ['X'] },
    null,
  ]);
  assert.equal(index.size, 0);
});

test('coverage reports both multiplicities and the share that can be spoken for', () => {
  const coverage = rnbFootprintCoverage([
    { id: 'left', rnb: ['A'] },
    { id: 'right', rnb: ['A'] },
    { id: 'merged', rnb: ['B', 'C'] },
    { id: 'mute', rnb: [] },
  ]);
  assert.equal(coverage.footprints, 4);
  assert.equal(coverage.withId, 3);
  assert.equal(coverage.coverage, 0.75);
  assert.equal(coverage.distinctIds, 3);
  assert.equal(coverage.multiId, 1, 'one polygon carries several identifiers');
  assert.equal(coverage.splitIds, 1, 'one identifier is drawn as several polygons');
});

test('coverage of nothing is zero and not NaN', () => {
  const coverage = rnbFootprintCoverage([]);
  assert.equal(coverage.coverage, 0);
  assert.equal(coverage.footprints, 0);
});
