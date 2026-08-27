// src/data/gasFranceFeed.test.mjs
// Pins the four UPSTREAM ODRÉ gas datasets against real captured rows. This is
// the projection the dev-server proxy runs, so it is where a schema drift shows
// up first — and it is where the published file's seven-editions-in-one-table,
// its string booleans, and Teréga's meaningless third ordinate are absorbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GAS_NETWORK_OPERATORS,
  chainGasSegments,
  gasShapeParts,
  odsRows,
  parseEditionYear,
  parseOdsBoolean,
  parseOdsNumber,
  polylineLengthKm,
  projectBiomethaneSites,
  projectGasNetwork,
  projectGasPlants,
  projectGasSites,
  projectGasTrace,
} from './gasFranceFeed.js';

const NETWORK = JSON.parse(readFileSync(
  new URL('./fixtures/gas-fr-network-sample.json', import.meta.url),
  'utf8',
));
const SITES = JSON.parse(readFileSync(
  new URL('./fixtures/gas-fr-sites-sample.json', import.meta.url),
  'utf8',
));

test('the captured rows still carry the fields the projection reads', () => {
  const natran = NETWORK.natran[0];
  assert.equal(natran.geo_shape.type, 'Feature');
  assert.ok('departement' in natran && 'nom_region' in natran);

  const terega = NETWORK.terega.find((row) => row.geo_shape);
  assert.ok('nom_du_departement' in terega && 'region' in terega);

  // The two traces name the same concept with two different columns, so a
  // shared reader keyed on one of them would silently lose the other's
  // départements. That is why the operator table carries the field names.
  assert.equal(GAS_NETWORK_OPERATORS.natran.depField, 'departement');
  assert.equal(GAS_NETWORK_OPERATORS.terega.depField, 'nom_du_departement');

  const plant = SITES.plants[0];
  for (const field of ['site', 'statut', 'puissance_installee_mw', 'point_geo', 'annee_de_reference']) {
    assert.ok(field in plant, field);
  }
  const injection = SITES.injections[0];
  for (const field of ['nom_du_projet', 'coordonnees', 'site_ouvert', 'type_de_reseau',
    'capacite_de_production_gwh_an', 'date_de_fermeture_du_site']) {
    assert.ok(field in injection, field);
  }
});

test('odsRows reads both Opendatasoft envelopes and refuses to invent rows', () => {
  assert.equal(odsRows([{ a: 1 }]).length, 1);
  assert.equal(odsRows({ total_count: 2, results: [{ a: 1 }, { a: 2 }] }).length, 2);
  for (const junk of [null, undefined, {}, 42, 'results']) {
    assert.deepEqual(odsRows(junk), []);
  }
});

// ── Trap 3: Teréga's third ordinate ─────────────────────────────────────────

test('Teréga publishes a third ordinate that is NOT a height, and it is dropped', () => {
  const deep = NETWORK.terega.find((row) => row?.geo_shape?.geometry?.type === 'LineString'
    && row.geo_shape.geometry.coordinates.some((vertex) => vertex.length > 2 && vertex[2] < -100));
  assert.ok(deep, 'the captured payload must still hold the sub-sea-level row');
  const zs = deep.geo_shape.geometry.coordinates.map((vertex) => vertex[2]);
  // Measured across the live file: −705.5 m to +1 809.4 m, over a footprint
  // whose real ground is roughly 0–1 500 m. Drawn at that ordinate this pipe
  // would be 700 m under the Béarn.
  assert.ok(Math.min(...zs) < -700);

  const { parts, hadHeights } = gasShapeParts(deep.geo_shape);
  assert.equal(hadHeights, true, 'the drop must be reported, not silent');
  for (const part of parts) {
    for (const vertex of part) assert.equal(vertex.length, 2);
  }
});

test('NaTran publishes 2-tuples and Teréga 3-tuples, and arity is read per VERTEX', () => {
  // The failure this guards is not a crash. A flat lon/lat reader fed
  // [lon, lat, z] reads z as the next longitude and mis-plots the whole
  // network while still producing a plausible-looking line.
  const mixed = gasShapeParts({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [[0.5, 43.5, 120.4], [0.6, 43.6], [0.7, 43.7, -705.5]],
    },
  });
  assert.deepEqual(mixed.parts, [[[0.5, 43.5], [0.6, 43.6], [0.7, 43.7]]]);
  assert.equal(mixed.hadHeights, true);
});

// ── Trap 4: shapes that are not the shape you saw first ─────────────────────

test('a null geo_shape and a MultiLineString are both real, captured Teréga rows', () => {
  const nulls = NETWORK.terega.filter((row) => !row.geo_shape);
  const multi = NETWORK.terega.filter((row) => row?.geo_shape?.geometry?.type === 'MultiLineString');
  assert.equal(nulls.length, 1);
  assert.equal(multi.length, 1);

  // The null row still carries a geo_point_2d, which is exactly what makes it
  // dangerous: a reader that checks "has a position" finds one.
  assert.ok(nulls[0].geo_point_2d);
  assert.deepEqual(gasShapeParts(null).parts, []);
  assert.deepEqual(gasShapeParts(undefined).parts, []);
  assert.deepEqual(gasShapeParts({ geometry: { type: 'Point', coordinates: [1, 2] } }).parts, []);

  const projected = projectGasTrace(NETWORK.terega, GAS_NETWORK_OPERATORS.terega);
  assert.equal(projected.summary.rowsWithoutGeometry, 1);
  assert.equal(projected.summary.multiPartRows, 1);
  // 4 rows, one of them holding three parts, one of them holding none.
  assert.equal(projected.summary.publishedParts, 4);
});

test('a bare geometry and a wrapping Feature both project the same way', () => {
  const coordinates = [[1, 43], [1.1, 43.1]];
  const asFeature = gasShapeParts({ type: 'Feature', geometry: { type: 'LineString', coordinates } });
  const asGeometry = gasShapeParts({ type: 'LineString', coordinates });
  assert.deepEqual(asFeature.parts, asGeometry.parts);
});

// ── Trap 5: fifteen decimals on a ±250 m product ────────────────────────────

test('coordinates are rounded to ~1 m, which is what makes a sub-metre "line" visible', () => {
  const degenerate = gasShapeParts({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      // A real captured NaTran row: 3.5 mm long, published to 15 decimals.
      coordinates: [[2.291834052488874, 49.938168455360085], [2.291830551680732, 49.93817198343346]],
    },
  });
  assert.deepEqual(degenerate.parts, []);
  assert.equal(degenerate.dropped, 1);

  const kept = gasShapeParts({
    type: 'LineString',
    coordinates: [[2.023742485452698, 45.402068570924165], [2.025095831854677, 45.404065913493454]],
  });
  assert.deepEqual(kept.parts, [[[2.02374, 45.40207], [2.0251, 45.40407]]]);
  // 5 decimals is ~1.1 m — still 200× finer than the trace's own stated ±250 m.
  for (const vertex of kept.parts[0]) {
    for (const ordinate of vertex) {
      assert.equal(Math.round(ordinate * 1e5) / 1e5, ordinate);
    }
  }
});

test('a coordinate outside the planet is refused, not clamped', () => {
  const { parts } = gasShapeParts({
    type: 'LineString',
    coordinates: [[1, 43], [999, 43], [1.1, 43.1]],
  });
  assert.deepEqual(parts, [[[1, 43], [1.1, 43.1]]]);
});

// ── Chaining ────────────────────────────────────────────────────────────────

test('published segments that share an endpoint chain into one stroke, moving no vertex', () => {
  const chained = chainGasSegments([
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
    [[2, 0], [3, 0]],
  ]);
  assert.equal(chained.length, 1);
  assert.deepEqual(chained[0], [[0, 0], [1, 0], [2, 0], [3, 0]]);
});

test('a segment published backwards still chains', () => {
  const chained = chainGasSegments([
    [[0, 0], [1, 0]],
    [[2, 0], [1, 0]],
  ]);
  assert.equal(chained.length, 1);
  assert.deepEqual(chained[0], [[0, 0], [1, 0], [2, 0]]);
});

test('a junction of three pipes always ENDS a stroke — a T is not a line', () => {
  const chained = chainGasSegments([
    [[0, 0], [1, 0]],
    [[1, 0], [2, 0]],
    [[1, 0], [1, 1]],
  ]);
  assert.equal(chained.length, 3);
  for (const chain of chained) assert.equal(chain.length, 2);
});

test('a closed ring terminates instead of looping forever', () => {
  const chained = chainGasSegments([
    [[0, 0], [1, 0]],
    [[1, 0], [1, 1]],
    [[1, 1], [0, 0]],
  ]);
  assert.equal(chained.length, 1);
  assert.deepEqual(chained[0][0], chained[0][chained[0].length - 1]);
});

test('chaining is scoped to a département, so the surviving attribute stays true', () => {
  const projected = projectGasTrace(NETWORK.natran, GAS_NETWORK_OPERATORS.natran);
  // The captured pair is two 2-vertex Moselle rows sharing one endpoint.
  const moselle = projected.groups.findIndex((group) => group.d === 'Moselle');
  const strokes = projected.strokes.filter((stroke) => stroke.g === moselle);
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].c.length / 2, 3);
  // Every stroke resolves to exactly one département, and the group carries it.
  for (const stroke of projected.strokes) assert.ok(projected.groups[stroke.g]);
});

test('a row with no département is grouped as unknown, never folded into a neighbour', () => {
  const projected = projectGasTrace(NETWORK.natran, GAS_NETWORK_OPERATORS.natran);
  assert.equal(projected.summary.rowsWithoutDepartement, 1);
  const unknown = projected.groups.filter((group) => group.d === null);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].r, null);
});

test('stroke length is great-circle, and a degenerate stroke is zero rather than NaN', () => {
  // Paris → Marseille, ~660 km.
  const km = polylineLengthKm([[2.3522, 48.8566], [5.3698, 43.2965]]);
  assert.ok(km > 655 && km < 665, `${km}`);
  assert.equal(polylineLengthKm([[1, 1]]), 0);
  assert.equal(polylineLengthKm(null), 0);
});

test('the two networks are projected side by side and never merged', () => {
  const projected = projectGasNetwork(NETWORK);
  assert.deepEqual(projected.operators.map((operator) => operator.id), ['natran', 'terega']);
  // Group indices are re-based per operator; every stroke must still resolve,
  // and to a group belonging to its own operator.
  const owners = new Set();
  for (const stroke of projected.strokes) {
    const group = projected.groups[stroke.g];
    assert.ok(group, `unresolved group ${stroke.g}`);
    owners.add(group.o);
  }
  assert.deepEqual([...owners].sort(), ['natran', 'terega']);
  assert.equal(
    projected.stats.strokes,
    projected.operators.reduce((sum, operator) => sum + operator.strokes, 0),
  );
});

test('a missing upstream half projects to zero strokes rather than throwing', () => {
  const projected = projectGasNetwork({ natran: NETWORK.natran, terega: null });
  assert.ok(projected.operators[0].strokes > 0);
  assert.equal(projected.operators[1].strokes, 0);
  assert.equal(projected.operators[1].rows, 0);
});

// ── Trap 1 + 2: seven editions of fourteen power stations ───────────────────

test('the power-station file is annual editions stacked, and only the newest is drawn', () => {
  // The captured slice is 2 sites × 7 editions.
  assert.equal(SITES.plants.length, 14);
  const { plants, stats } = projectGasPlants(SITES.plants);
  assert.equal(stats.rows, 14);
  assert.equal(stats.sites, 2);
  assert.equal(stats.supersededRows, 12);
  assert.equal(plants.length, 2);
  for (const plant of plants) assert.equal(plant.edition, 2025);

  // The trap in one number: summing the column counts every station 7 times.
  const naive = SITES.plants.reduce((sum, row) => sum + row.puissance_installee_mw, 0);
  assert.equal(naive, 9464);
  assert.equal(stats.fleetMw, 1352);
});

test('editions disagree, and "the first row per site" is a coin flip', () => {
  const landivisiau = SITES.plants.filter((row) => row.site === 'Landivisiau');
  assert.equal(landivisiau.length, 7);
  // Two of the seven editions say this station is a project that never opened,
  // and there is no stable order to protect a reader from landing on one:
  // the export endpoint answers 2025 first, the records endpoint answered
  // 2023, 2022, 2025, 2021, 2024, 2019, 2020 for this same station.
  const asProject = landivisiau.filter((row) => row.statut === 'En projet');
  assert.equal(asProject.length, 2);
  for (const row of asProject) assert.equal(row.date_de_mise_en_service, null);
  // And an edition can say "En service" while still publishing no date.
  const dateless = landivisiau.find((row) => row.statut === 'En service'
    && row.date_de_mise_en_service === null);
  assert.equal(dateless.annee_de_reference, '2021');

  const { plants } = projectGasPlants(SITES.plants);
  const drawn = plants.find((plant) => plant.name === 'Landivisiau');
  assert.equal(drawn.status, 'En service');
  assert.equal(drawn.commissioned, '2022');
  assert.equal(drawn.inService, true);
  // And the disagreement travels to the card rather than being smoothed away.
  assert.deepEqual(drawn.supersededBy, ['En projet']);
  assert.deepEqual(drawn.editions, [2019, 2020, 2021, 2022, 2023, 2024, 2025]);
});

test('a station that never changed reports no superseded status', () => {
  const { plants } = projectGasPlants(SITES.plants);
  const martigues = plants.find((plant) => plant.name === 'Martigues');
  assert.deepEqual(martigues.supersededBy, []);
  assert.equal(martigues.mw, 930);
});

test('the edition year is read as a YEAR, not parsed as a date', () => {
  assert.equal(parseEditionYear('2025'), 2025);
  assert.equal(parseEditionYear('2019-01-01'), 2019);
  assert.equal(parseEditionYear(''), null);
  assert.equal(parseEditionYear(null), null);
  assert.equal(parseEditionYear('yesterday'), null);
  // Out of any plausible edition range: refused rather than sorted first.
  assert.equal(parseEditionYear('0007'), null);
});

test('a station at (0, 0) or with no position is counted, never drawn', () => {
  const { plants, stats } = projectGasPlants([
    { site: 'Nowhere', annee_de_reference: '2025', point_geo: { lon: 0, lat: 0 }, puissance_installee_mw: 100 },
    { site: 'Unpositioned', annee_de_reference: '2025', puissance_installee_mw: 100 },
  ]);
  assert.equal(plants.length, 0);
  assert.equal(stats.rowsWithoutGeometry, 2);
});

test('a station with no published power still draws, and is not counted as zero MW', () => {
  const { plants, stats } = projectGasPlants([
    { site: 'Quiet', annee_de_reference: '2025', statut: 'En service', point_geo: { lon: 2, lat: 48 }, puissance_installee_mw: null },
  ]);
  assert.equal(plants.length, 1);
  assert.equal(plants[0].mw, null);
  assert.equal(stats.fleetMw, 0);
});

// ── Trap 6 + 7: the injection register ──────────────────────────────────────

test('site_ouvert is the STRING "False", which JavaScript coerces to true', () => {
  // The bug this is here to stop, spelled out.
  assert.equal(Boolean('False'), true);
  assert.equal(parseOdsBoolean('False'), false);
  for (const value of ['True', 'true', 'TRUE', '1', true]) assert.equal(parseOdsBoolean(value), true);
  for (const value of ['False', 'false', 'FALSE', '0', false]) assert.equal(parseOdsBoolean(value), false);
  // "Not published" is not "false".
  for (const value of [null, undefined, '', 'peut-être']) assert.equal(parseOdsBoolean(value), null);
});

test('closed sites are excluded from a file whose title says "en service", and counted', () => {
  const closed = SITES.injections.filter((row) => row.date_de_fermeture_du_site);
  assert.equal(closed.length, 3);
  for (const row of closed) {
    assert.equal(row.site_ouvert, 'False');
    // Their capacity is zeroed on closure, so a naive read draws a 0 GWh dot.
    assert.equal(row.capacite_de_production_gwh_an, 0);
  }
  const { injections, stats } = projectBiomethaneSites(SITES.injections);
  assert.equal(stats.closed, 3);
  for (const site of injections) assert.ok(!/Saint Pourçain|Basse Ariège|SUD AVEYRON/i.test(site.name));
});

test('a site with no coordinates is counted, never drawn', () => {
  const orphan = SITES.injections.find((row) => !row.coordonnees);
  assert.ok(orphan, 'the captured payload must still hold the positionless site');
  const { stats } = projectBiomethaneSites(SITES.injections);
  assert.equal(stats.rowsWithoutGeometry, 1);
});

test('the network tier is kept, because most injection points feed a network not drawn here', () => {
  const { injections, stats } = projectBiomethaneSites(SITES.injections);
  assert.equal(stats.transport + stats.distribution, injections.length);
  assert.ok(stats.transport > 0 && stats.distribution > 0);
  for (const site of injections) assert.ok(site.tier === 'transport' || site.tier === 'distribution');
  // An unrecognised tier degrades to distribution — the conservative read,
  // since claiming a transmission connection is the stronger claim.
  const odd = projectBiomethaneSites([{
    nom_du_projet: 'Odd', site_ouvert: 'True', coordonnees: { lon: 1, lat: 44 },
    type_de_reseau: 'Autre', capacite_de_production_gwh_an: 10,
  }]);
  assert.equal(odd.injections[0].tier, 'distribution');
});

test('the planned-increase flag is read on its first word, not as a boolean', () => {
  const { injections } = projectBiomethaneSites(SITES.injections);
  const expanding = injections.filter((site) => site.expanding);
  const settled = injections.filter((site) => !site.expanding);
  assert.ok(expanding.length > 0 && settled.length > 0);
  // The two published values differ only by the word in front of them, so a
  // substring test for "augmentation" would call every site expanding.
  const values = new Set(SITES.injections.map((row) => row.augmentation_prevue));
  assert.ok([...values].some((value) => /^Aucune augmentation/.test(value)));
  assert.ok([...values].some((value) => /^Augmentation/.test(value)));
});

test('capacity is summed only over drawn, open sites', () => {
  const { injections, stats } = projectBiomethaneSites(SITES.injections);
  const drawnSum = injections.reduce((sum, site) => sum + (site.gwh || 0), 0);
  assert.equal(stats.capacityGwh, Math.round(drawnSum));
  assert.equal(stats.drawn, injections.length);
});

test('numbers keep the difference between "zero" and "not published"', () => {
  assert.equal(parseOdsNumber(0), 0);
  assert.equal(parseOdsNumber('0'), 0);
  assert.equal(parseOdsNumber(''), null);
  assert.equal(parseOdsNumber(null), null);
  assert.equal(parseOdsNumber('n/a'), null);
});

// ── The whole document ──────────────────────────────────────────────────────

test('projectGasSites carries both registers and both stat blocks', () => {
  const document = projectGasSites({ plants: SITES.plants, injections: SITES.injections }, 'TEST');
  assert.equal(document.source, 'TEST');
  assert.equal(document.plants.length, 2);
  assert.ok(document.injections.length > 0);
  assert.ok(document.stats.plants.editions.includes(2025));
  assert.ok(Number.isInteger(document.stats.injections.drawn));
  // Ordering is by size, so the map's biggest object is the payload's first.
  for (let i = 1; i < document.injections.length; i += 1) {
    assert.ok(document.injections[i - 1].gwh >= document.injections[i].gwh);
  }
});

test('every projected record is JSON-safe — no NaN, no undefined', () => {
  const document = projectGasSites({ plants: SITES.plants, injections: SITES.injections });
  const network = projectGasNetwork(NETWORK);
  for (const value of [...document.plants, ...document.injections, ...network.strokes, ...network.groups]) {
    const round = JSON.parse(JSON.stringify(value));
    assert.deepEqual(round, value);
    for (const entry of Object.values(value)) {
      assert.ok(!Number.isNaN(entry), JSON.stringify(value));
      assert.notEqual(entry, undefined);
    }
  }
});
