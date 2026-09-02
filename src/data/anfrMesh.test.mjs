// What the MAILLAGE is allowed to claim about a country it is only sampling.
//
// The mesh exists because 72 700 masts cannot be drawn at once and the pack
// that describes them (1 046 KB gzipped, measured on the real payload) is 2.7×
// what the tuple costs (392 KB). Everything it drops has to drop honestly, and
// two rules carry that:
//
//   1. **A cell is represented by its MODAL band, ties going to the lower
//      index.** The distribution is lopsided — 50 148 of 72 700 supports are
//      `5g` — so representing a cell by its largest member would paint rural
//      France 5G on the strength of one upgraded mast per cell, and a tie
//      going the other way would draw an approved project as a live 5G mast.
//   2. **The pick reports what it dropped.** `inBox` and `thinned` are the
//      only reason a reader can tell 1 100 dots from 1 100 masts.
//
// The third property here is a correction. `anfrMesh.js`'s own docstring says
// no two supports share a coordinate to five decimals. Measured over the real
// register on 2026-09-02 that is FALSE — 952 supports share a position with at
// least one other, 895 positions are occupied twice or more, the worst by six
// masts — which is why `anfrFrance.js` keys its exact records by SUP_ID and
// treats a mesh id as a position rather than an identity. The last test pins
// that, so the claim cannot quietly become load-bearing later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ANFR_MESH_BUDGETS,
  ANFR_MESH_COLS,
  ANFR_MESH_ROWS,
  MESH_BAND,
  MESH_LAT,
  MESH_LON,
  MESH_OPERATORS,
  anfrMeshBudget,
  buildAnfrMesh,
  meshSupportBand,
  meshSupportId,
  meshSupportInBox,
  selectAnfrMesh,
} from './anfrMesh.js';
import {
  ANFR_BANDS,
  ANFR_BAND_INDEX,
  ANFR_ID,
  ANFR_LAT as PACK_LAT,
  ANFR_LIVE,
  ANFR_LON as PACK_LON,
  ANFR_OPS,
  anfrBand,
  anfrCsvColumns,
  anfrPopCount,
  projectAnfrSupports,
  readAnfrCsvRow,
} from './anfrFeed.js';
import { MESH_CATEGORY, MESH_WEIGHT, cellRepresentative } from './geoMeshThinning.js';

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const OBSERVATOIRE = read('anfr-observatoire-sample.json');
const LINES = OBSERVATOIRE.csv.split('\n');
const COLUMNS = anfrCsvColumns(LINES[0]);
const ROWS = LINES.slice(1).filter(Boolean).map((line) => readAnfrCsvRow(line, COLUMNS));
const PACK = projectAnfrSupports({ rows: ROWS, edition: OBSERVATOIRE.edition });
const MESH = buildAnfrMesh(PACK.supports);

test('the tuple names the two channels the map actually draws', () => {
  // [lat, lon, operators, band] — and the ANFR aliases must BE the generic
  // slots, or `selectGeoMesh` would rank by the wrong column.
  assert.equal(MESH_OPERATORS, MESH_WEIGHT);
  assert.equal(MESH_BAND, MESH_CATEGORY);
  assert.equal(MESH_LAT, 0);
  assert.equal(MESH_LON, 1);
  assert.equal(MESH_OPERATORS, 2);
  assert.equal(MESH_BAND, 3);
  assert.equal(MESH.length, PACK.count);
  for (const tuple of MESH) assert.equal(tuple.length, 4);
});

test('the weight is the operator count and it is never missing', () => {
  // Unlike a roll or a charging power, this weight is 0 for nothing: every row
  // in the register names its operator.
  const byPosition = new Map(MESH.map((t) => [`${t[MESH_LAT]},${t[MESH_LON]}`, t]));
  for (const support of PACK.supports) {
    const tuple = byPosition.get(`${support[PACK_LAT]},${support[PACK_LON]}`);
    assert.ok(tuple, `no mesh row for support ${support[ANFR_ID]}`);
    assert.equal(tuple[MESH_OPERATORS], anfrPopCount(support[ANFR_OPS]));
    assert.ok(tuple[MESH_OPERATORS] >= 1);
  }
  // The one support in France carrying five operators keeps its five here.
  assert.ok(MESH.some((tuple) => tuple[MESH_OPERATORS] === 5));
});

test('the category is the band that RADIATES, so a project cannot be drawn as 5G', () => {
  const byPosition = new Map(MESH.map((t) => [`${t[MESH_LAT]},${t[MESH_LON]}`, t]));
  for (const support of PACK.supports) {
    const tuple = byPosition.get(`${support[PACK_LAT]},${support[PACK_LON]}`);
    assert.equal(tuple[MESH_BAND], ANFR_BAND_INDEX[anfrBand(support[ANFR_LIVE])]);
    assert.equal(meshSupportBand(tuple), anfrBand(support[ANFR_LIVE]));
  }
  // Support 278838 has three approved generations and radiates nothing.
  const planned = PACK.supports.find((s) => s[ANFR_ID] === 278838);
  const tuple = byPosition.get(`${planned[PACK_LAT]},${planned[PACK_LON]}`);
  assert.equal(meshSupportBand(tuple), 'projet');
  assert.equal(tuple[MESH_BAND], 0);
  // An out-of-range index falls back to the lowest claim, never to 5G.
  assert.equal(meshSupportBand([0, 0, 1, 99]), ANFR_BANDS[0]);
  assert.equal(meshSupportBand(null), 'projet');
});

test('the mesh is sorted south-to-north then west-to-east', () => {
  // Not cosmetic: measured on the real 72 700 tuples, the sorted document
  // gzips to 392 012 bytes against 486 401 unsorted — one sort buys 19 % of
  // the wire, because neighbouring masts share leading digits.
  for (let i = 1; i < MESH.length; i += 1) {
    const a = MESH[i - 1];
    const b = MESH[i];
    assert.ok(a[MESH_LAT] < b[MESH_LAT] || (a[MESH_LAT] === b[MESH_LAT] && a[MESH_LON] <= b[MESH_LON]));
  }
  assert.equal(MESH[0][MESH_LAT], -22.27, 'Nouvelle-Calédonie is the southernmost');
});

test('an unreadable position is skipped, and a null one would not be', () => {
  const unreadable = [...PACK.supports, [999, 'x', 'y', 0, 8, 0, 1, 0, 0, null]];
  assert.equal(buildAnfrMesh(unreadable).length, PACK.count);
  assert.deepEqual(buildAnfrMesh(null), []);
  assert.deepEqual(buildAnfrMesh([[1, 'x', 'y']]), []);

  // The sharp edge, pinned rather than papered over: the guard is
  // `Number.isFinite(Number(value))`, and `Number(null)` is 0, so a null
  // coordinate would be drawn in the Gulf of Guinea rather than dropped. It is
  // unreachable today — `projectAnfrSupports` counts and drops every row whose
  // `coordonnees` will not parse, so a pack tuple always carries two real
  // numbers — and this test exists so that stays true.
  assert.equal(buildAnfrMesh([[999, null, null, 0, 8, 0, 1, 0, 0, null]]).length, 1);
  for (const support of PACK.supports) {
    assert.equal(typeof support[PACK_LAT], 'number');
    assert.equal(typeof support[PACK_LON], 'number');
  }
});

test('the budget ladder is the charge-point one, by latitude span', () => {
  assert.equal(anfrMeshBudget(0.1), 2200);
  assert.equal(anfrMeshBudget(0.8), 2200);
  assert.equal(anfrMeshBudget(0.81), 1600);
  assert.equal(anfrMeshBudget(2.5), 1600);
  assert.equal(anfrMeshBudget(2.51), 1100);
  // Metropolitan France is 9.8° tall; the whole country is the last tier.
  assert.equal(anfrMeshBudget(10.4), 1100);
  assert.equal(anfrMeshBudget(180), 1100);
  assert.equal(ANFR_MESH_BUDGETS.length, 3);
  assert.equal(ANFR_MESH_COLS * ANFR_MESH_ROWS, 600);
});

test('the pick reports what it dropped, which is the only honest way to thin', () => {
  const world = { south: -90, west: -180, north: 90, east: 180 };
  const whole = selectAnfrMesh(MESH, { box: world });
  assert.equal(whole.inBox, MESH.length);
  assert.equal(whole.picked.length, MESH.length);
  assert.equal(whole.thinned, false, '15 rows are under every budget');

  const squeezed = selectAnfrMesh(MESH, { box: world, budget: 4 });
  assert.equal(squeezed.inBox, MESH.length);
  assert.equal(squeezed.picked.length, 4);
  assert.equal(squeezed.thinned, true);
  assert.ok(squeezed.cells > 0);

  // A budget of zero is still an honest answer about a non-empty box.
  const none = selectAnfrMesh(MESH, { box: world, budget: 0 });
  assert.deepEqual(none.picked, []);
  assert.equal(none.inBox, MESH.length);
  assert.equal(none.thinned, true);

  // No box is no answer, not an empty country.
  assert.deepEqual(selectAnfrMesh(MESH, {}), {
    picked: [], inBox: 0, budget: 0, thinned: false, cells: 0,
  });
});

test('the pick is bounded by the box, edges included', () => {
  const metropolitan = { south: 41, west: -5.5, north: 51.5, east: 9.9 };
  const pick = selectAnfrMesh(MESH, { box: metropolitan });
  const overseas = MESH.filter((tuple) => !meshSupportInBox(tuple, metropolitan));
  assert.equal(pick.inBox + overseas.length, MESH.length);
  // The fixture carries Saint-Barthélemy, Nouvelle-Calédonie, La Réunion and
  // Wallis-et-Futuna precisely so this is not zero.
  assert.ok(overseas.length >= 4, `${overseas.length} overseas`);
  for (const tuple of pick.picked) assert.ok(meshSupportInBox(tuple, metropolitan));

  const exact = MESH[0];
  const edge = {
    south: exact[MESH_LAT], north: exact[MESH_LAT] + 1,
    west: exact[MESH_LON], east: exact[MESH_LON] + 1,
  };
  assert.equal(meshSupportInBox(exact, edge), true);
  assert.equal(meshSupportInBox(exact, null), false);
});

test('a cell that is half approved-project and half 5G is drawn as the project', () => {
  // The tie rule, stated as the thing it protects. `cellRepresentative` takes
  // the LOWER category index on a tie, and `ANFR_BANDS` puts `projet` at 0
  // exactly so that this resolves downwards.
  const bucket = [
    [45, 5, 4, ANFR_BAND_INDEX['5g']],
    [45, 5, 3, ANFR_BAND_INDEX['5g']],
    [45, 5, 2, ANFR_BAND_INDEX.projet],
    [45, 5, 1, ANFR_BAND_INDEX.projet],
  ];
  assert.equal(meshSupportBand(cellRepresentative(bucket)), 'projet');
  // And when 5G is genuinely the modal band it wins, taking the heaviest
  // example of it rather than the heaviest member of the cell.
  const mostly5g = [
    [45, 5, 9, ANFR_BAND_INDEX.projet],
    [45, 5, 4, ANFR_BAND_INDEX['5g']],
    [45, 5, 2, ANFR_BAND_INDEX['5g']],
  ];
  const winner = cellRepresentative(mostly5g);
  assert.equal(meshSupportBand(winner), '5g');
  assert.equal(winner[MESH_OPERATORS], 4);
});

test('a mesh id is a POSITION, not an identity — the register co-sites masts', () => {
  assert.equal(meshSupportId([48.85528, 2.33167, 4, 4]), '48.85528,2.33167');
  // Five decimals, always, so the same mast produces the same key whether it
  // arrived from the pack or from a lookup.
  assert.equal(meshSupportId([48.9, 2.3, 1, 4]), '48.90000,2.30000');
  // But the key is NOT unique across supports. ANFR derives positions from
  // integer arc-seconds, so co-sited masts land on exactly the same lattice
  // point: measured over the real register on 2026-09-02, 71 748 distinct
  // positions hold 72 700 supports, 895 positions are occupied twice or more,
  // and one holds six. Two synthetic supports at one position collapse to one
  // key here, which is why the render layer keys its exact records by SUP_ID.
  const coSited = buildAnfrMesh([
    [111, 48.85528, 2.33167, 0, 0b1000, 0, 0b1, 0, 23, 30],
    [222, 48.85528, 2.33167, 0, 0b0100, 0, 0b10, 0, 23, 30],
  ]);
  assert.equal(coSited.length, 2, 'both supports are kept as rows');
  assert.equal(meshSupportId(coSited[0]), meshSupportId(coSited[1]));
});
