// src/data/frHydroFeed.test.mjs
// Pins the UPSTREAM SHAPE of ODRÉ's national register against captured rows:
// the withheld names, the published zeros that mean "not declared", the 26
// hydro plants labelled photovoltaic, the register's own name decoration, and
// the commune roll-up that replaces a position nobody publishes. The layer's
// presentation is covered separately in frHydroPlants.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANONYMOUS_NAME,
  HYDRO_TECHNOLOGIES,
  HYDRO_UNKNOWN_TECH_LABEL,
  clusterUnplaced,
  finiteOrNull,
  haversineKm,
  hydroNameMatch,
  loadFactor,
  normalizeHydroName,
  parseFrenchDate,
  parseOsmOutputMw,
  plantName,
  positiveOrNull,
  projectHydroRow,
  summarizeHydro,
  techBucket,
  undecorateName,
} from './frHydroFeed.js';

const ROWS = JSON.parse(readFileSync(
  new URL('./fixtures/fr-hydro-registre-sample.json', import.meta.url),
  'utf8',
));

const raw = (predicate) => ROWS.find(predicate);
const projected = ROWS.map(projectHydroRow).filter(Boolean);
const byPower = (kw) => projected.find((plant) => plant.kw === kw);

const MIEGEBAT = byPower(74000);
const GRAND_MAISON = byPower(1_690_000);
const LICQ = byPower(3900);
const MONTEILS = byPower(40);
const RIZZANESE = byPower(55000);

// ── Trap 1: the register publishes no coordinates ───────────────────────────

test('not one register row carries anything a position could be read from', () => {
  // Every spelling the sibling French feeds have had to absorb: EDF's
  // `coordonnees_x_wgs` / `point_gps_wsg84`, GeoJSON's `geometry`, and the
  // plain pair. ODRÉ's register has none of them, which is the whole reason
  // `build-fr-hydro-registry.mjs` exists.
  const SPATIAL = [
    'latitude', 'longitude', 'lat', 'lon', 'lng', 'geometry', 'geo_point_2d',
    'geo_shape', 'coordonnees', 'coordonnees_x_wgs', 'coordonnees_y_wgs',
    'point_gps_wsg84', 'x', 'y', 'wkt', 'geopoint',
  ];
  for (const row of ROWS) {
    const keys = Object.keys(row).filter((key) => SPATIAL.includes(key.toLowerCase()));
    assert.deepEqual(keys, [], `row published a spatial column: ${keys.join(', ')}`);
  }
});

// ── Trap 2: half the register has no name ───────────────────────────────────

test('a withheld name becomes null, never the word "Confidentiel"', () => {
  const anonymous = raw((row) => row.nominstallation === ANONYMOUS_NAME);
  assert.equal(plantName(anonymous), null);
  assert.equal(LICQ.name, null);
  assert.equal(LICQ.anonymous, true);
  for (const plant of projected) {
    assert.notEqual(plant.name, ANONYMOUS_NAME);
  }
});

test('an anonymous plant keeps everything else the register publishes', () => {
  // The whole argument for drawing these at all: only the name is withheld.
  assert.equal(LICQ.commune, 'Licq-Athérey');
  assert.equal(LICQ.kw, 3900);
  assert.equal(LICQ.tech, "Fil de l'eau");
  assert.equal(LICQ.voltage, 'HTA');
  assert.equal(LICQ.poste, 'L.ATH');
  assert.equal(LICQ.operator, 'Enedis');
  assert.equal(LICQ.commissioned, '2007-11-15');
  assert.ok(LICQ.eic);
  assert.ok(Number.isFinite(LICQ.energyKwh) && LICQ.energyKwh > 0);
});

test('the smallest anonymous plant in France still yields a load factor', () => {
  // 40 kW at Monteils — the floor of the register, and still a full card.
  assert.equal(MONTEILS.kw, 40);
  const factor = loadFactor(MONTEILS.kw, MONTEILS.energyKwh);
  assert.ok(factor > 0.4 && factor < 0.6, `expected a plausible mill load factor, got ${factor}`);
});

// ── Trap 3: published zeros that mean "not published" ───────────────────────

test('a zero in a hydro-detail column reads as "not declared", not as zero', () => {
  assert.equal(positiveOrNull(0), null);
  assert.equal(positiveOrNull(0.0), null);
  assert.equal(positiveOrNull(417.6), 417.6);
  assert.equal(positiveOrNull(null), null);
  // …while a column where zero is a real fact keeps it.
  assert.equal(finiteOrNull(0), 0);
});

test('debitmaximal is never read — it is zero on every row in France', () => {
  for (const row of ROWS) assert.equal(Number(row.debitmaximal), 0);
  for (const plant of projected) {
    assert.equal(Object.hasOwn(plant, 'flowM3s'), false);
    assert.equal(Object.hasOwn(plant, 'debitmaximal'), false);
  }
});

test('a published head and group count survive; an absent one is null', () => {
  assert.equal(MIEGEBAT.headM, 417.6);
  assert.equal(MIEGEBAT.groups, 3);
  assert.equal(LICQ.headM, null);
  assert.equal(LICQ.groups, null);
});

// ── Trap 4: hydro plants published as photovoltaic ──────────────────────────

test('a Corsican hydro plant labelled Photovoltaïque keeps the row and loses the colour', () => {
  assert.equal(RIZZANESE.commune, 'Sainte-Lucie-de-Tallano');
  // The publisher's string is preserved verbatim — the anomaly stays visible.
  assert.equal(RIZZANESE.tech, 'Photovoltaïque');
  // …and it is refused as a technology this hydro layer may colour or count.
  assert.equal(RIZZANESE.techKey, null);
  assert.equal(techBucket(RIZZANESE), HYDRO_UNKNOWN_TECH_LABEL);
});

test('the register’s own "Autre" is refused the same way', () => {
  const autre = projected.find((plant) => plant.tech === 'Autre');
  assert.equal(autre.techKey, null);
  assert.equal(techBucket(autre), HYDRO_UNKNOWN_TECH_LABEL);
});

test('the five real technologies are keyed and coloured', () => {
  assert.equal(MIEGEBAT.techKey, HYDRO_TECHNOLOGIES['Eclusée'].key);
  assert.equal(GRAND_MAISON.techKey, HYDRO_TECHNOLOGIES['Pompage turbinage'].key);
  assert.equal(techBucket(GRAND_MAISON), 'Pompage-turbinage');
});

// ── Rows with no commune at all ─────────────────────────────────────────────

test('a regional aggregate row with no commune is refused, not defaulted', () => {
  const aggregate = raw((row) => !row.codeinseecommune);
  assert.ok(aggregate, 'fixture must carry one "Agrégation des installations de moins de 36KW" row');
  assert.equal(projectHydroRow(aggregate), null);
});

// ── The register's own name decoration ──────────────────────────────────────

test('the poste-source prefix and revision suffix are not part of a plant name', () => {
  assert.equal(
    undecorateName('MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3'),
    'CENTRALE HYDRAULIQUE DE MIEGEBAT',
  );
  assert.equal(
    undecorateName('HOURAH-CENTRALE HYDRAULIQUE DE HOURAT (LE)-3'),
    'CENTRALE HYDRAULIQUE DE HOURAT (LE)',
  );
  // Enedis-connected rows carry no decoration and must survive untouched.
  assert.equal(undecorateName('LES 7 MEULES'), 'LES 7 MEULES');
  assert.equal(undecorateName('CENTRALE DU LISTO'), 'CENTRALE DU LISTO');
});

test('a prefix-shaped FIRST WORD is not decoration, and is not eaten', () => {
  // The bug this pins: `GRAND` is five uppercase characters followed by a
  // hyphen, exactly like `MIEGEH`. Stripping it turned France's largest hydro
  // plant into "maison" and broke its join to EDF's own published coordinate.
  assert.equal(undecorateName('GRAND-MAISON'), 'GRAND-MAISON');
  assert.equal(normalizeHydroName('GRAND-MAISON'), 'grand maison');
  assert.equal(
    normalizeHydroName('G.MAIH-CENTRALE HYDRAULIQUE DE GRAND-MAISON-7'),
    normalizeHydroName('GRAND-MAISON'),
  );
  // Two real register names with the same shape.
  assert.equal(undecorateName('HYDR-AUZENE'), 'HYDR-AUZENE');
  assert.equal(undecorateName('COLY-LAMALETTE'), 'COLY-LAMALETTE');
  // A trailing revision with no prefix is left alone too — the decoration is
  // one unit, and half of it is not evidence of the other half.
  assert.equal(undecorateName('MOULIN 2-3'), 'MOULIN 2-3');
});

test('normalisation drops the vocabulary every French hydro plant shares', () => {
  assert.equal(normalizeHydroName('MIEGEH-CENTRALE HYDRAULIQUE DE MIEGEBAT-3'), 'miegebat');
  assert.equal(normalizeHydroName('Centrale de Miégebat'), 'miegebat');
  assert.equal(normalizeHydroName('SARL LES MOULINS'), 'moulins');
  // A name made only of shared vocabulary folds to nothing rather than to a
  // token that would match every plant in France.
  assert.equal(normalizeHydroName('CENTRALE HYDROELECTRIQUE'), '');
});

test('the join refuses a match built only on short shared tokens', () => {
  assert.equal(hydroNameMatch('miegebat', 'miegebat'), 1);
  assert.equal(hydroNameMatch('pont camps', 'pont'), 0);
  assert.equal(hydroNameMatch('artouste', 'artouste lac'), 0.5);
  assert.equal(hydroNameMatch('artouste', 'geteu lac'), 0);
  assert.equal(hydroNameMatch('', 'artouste'), 0);
  assert.equal(hydroNameMatch('geteu', 'miegebat'), 0);
});

test('a single short token is never enough for a partial match', () => {
  // `CENTRALE HYDROELECTRIQUE DU PONT` normalises to the one word `pont`, and
  // must not claim `Centrale de Pont de Camps` in the next valley.
  assert.equal(hydroNameMatch('pont', 'pont camps'), 0);
  assert.equal(hydroNameMatch('bas', 'bas rhin moulin'), 0);
  // A single LONG token still carries enough to be evidence.
  assert.equal(hydroNameMatch('artouste', 'artouste lac'), 0.5);
  // …and so do several tokens, one of which is four characters.
  assert.equal(hydroNameMatch('pont goua', 'pont goua vieux'), 0.5);
});

// ── OpenStreetMap's free-text power tag ─────────────────────────────────────

test('the OSM output tag is parsed in its three units, and refused otherwise', () => {
  assert.equal(parseOsmOutputMw('74 MW'), 74);
  assert.equal(parseOsmOutputMw('677 kW'), 0.677);
  assert.equal(parseOsmOutputMw('1.5 MW'), 1.5);
  assert.equal(parseOsmOutputMw('1,5 MW'), 1.5);
  assert.equal(parseOsmOutputMw('0.9 GW'), 900);
  // "there is a plant here, size unrecorded" must not become a size.
  assert.equal(parseOsmOutputMw('yes'), null);
  assert.equal(parseOsmOutputMw('small_installation'), null);
  assert.equal(parseOsmOutputMw(''), null);
  assert.equal(parseOsmOutputMw(null), null);
  // A bare number defaults to MW, which is the tag's own convention.
  assert.equal(parseOsmOutputMw('12 W'), 12);
});

// ── Dates and derived figures ───────────────────────────────────────────────

test('both of the register’s date formats land on one ISO shape', () => {
  assert.equal(parseFrenchDate('15/11/2007'), '2007-11-15');
  assert.equal(parseFrenchDate('2025-06-23'), '2025-06-23');
  assert.equal(parseFrenchDate(''), null);
  assert.equal(parseFrenchDate('not a date'), null);
});

test('a load factor needs both sides, and an unreported energy is not an idle plant', () => {
  // Miégebat: 74 MW nameplate against 188,4 GWh injected.
  const factor = loadFactor(MIEGEBAT.kw, MIEGEBAT.energyKwh);
  assert.ok(Math.abs(factor - 0.29) < 0.01, `expected ~29 %, got ${factor}`);
  assert.equal(loadFactor(74000, null), null);
  assert.equal(loadFactor(null, 1000), null);
  assert.equal(loadFactor(0, 1000), null);
});

test('haversine agrees with the distance Laruns actually spans', () => {
  // Commune centre of Laruns to the Miégebat powerhouse, measured 2026-08-31.
  const km = haversineKm({ lat: 42.907, lon: -0.4087 }, { lat: 42.93208, lon: -0.44684 });
  assert.ok(Math.abs(km - 4.17) < 0.05, `expected ~4,17 km, got ${km}`);
});

// ── The commune roll-up ─────────────────────────────────────────────────────

const CENTRES = new Map([
  ['64320', { lat: 42.907, lon: -0.4087, nom: 'Laruns' }],
  ['64342', { lat: 43.0559, lon: -0.8938, nom: 'Licq-Athérey' }],
]);

test('unplaced plants become one marker per commune, never one per plant', () => {
  const laruns = projected.filter((plant) => plant.insee === '64320');
  assert.equal(laruns.length, 9);
  const clusters = clusterUnplaced(laruns, CENTRES);
  assert.equal(clusters.length, 1);
  const [cluster] = clusters;
  assert.equal(cluster.id, 'INSEE:64320');
  assert.equal(cluster.plants, 9);
  assert.equal(cluster.kw, 223_900);
  // The floor test uses the LARGEST member, not the total.
  assert.equal(cluster.maxKw, 74_000);
  assert.equal(cluster.lat, 42.907);
  assert.equal(cluster.placement, 'commune-centre');
});

test('a roll-up carries the names it has and counts the ones it has not', () => {
  const mixed = [...projected.filter((p) => p.insee === '64320').slice(0, 2), LICQ];
  const clusters = clusterUnplaced(mixed, new Map([
    ...CENTRES,
    ['64342', { lat: 43.0559, lon: -0.8938, nom: 'Licq-Athérey' }],
  ]));
  const licq = clusters.find((cluster) => cluster.insee === '64342');
  assert.equal(licq.anonymous, 1);
  assert.deepEqual(licq.names, []);
  const laruns = clusters.find((cluster) => cluster.insee === '64320');
  assert.equal(laruns.anonymous, 0);
  assert.equal(laruns.names.length, 2);
});

test('a plant whose commune has no published centre is dropped, not placed at zero', () => {
  const clusters = clusterUnplaced([LICQ], new Map());
  assert.deepEqual(clusters, []);
});

// ── Fleet figures ───────────────────────────────────────────────────────────

test('placed and clustered capacity are reported apart as well as together', () => {
  const placed = [{ ...MIEGEBAT, placement: 'osm-plant' }];
  const clusters = clusterUnplaced(
    projected.filter((plant) => plant.insee === '64320' && plant.kw !== 74_000),
    CENTRES,
  );
  const summary = summarizeHydro(placed, clusters);
  assert.equal(summary.placed, 1);
  assert.equal(summary.clustered, 8);
  assert.equal(summary.plants, 9);
  assert.equal(summary.communes, 1);
  assert.equal(summary.placedKw, 74_000);
  assert.equal(summary.clusteredKw, 149_900);
  assert.equal(summary.installedKw, 223_900);
  // "26 GW of hydro" and "26 GW drawn where it is" must stay separable.
  assert.notEqual(summary.installedKw, summary.placedKw);
});

test('the legend tally never gives a hydro slice to a photovoltaic row', () => {
  const summary = summarizeHydro([RIZZANESE, MIEGEBAT], []);
  assert.equal(summary.byTech[HYDRO_UNKNOWN_TECH_LABEL].plants, 1);
  assert.equal(summary.byTech[HYDRO_UNKNOWN_TECH_LABEL].kw, 55_000);
  assert.equal(summary.byTech['Éclusée'].plants, 1);
  assert.equal(Object.hasOwn(summary.byTech, 'Photovoltaïque'), false);
});
