// src/data/irveFeed.test.mjs
// Pins the UPSTREAM ODRÉ `bornes-irve` dataset against a real captured
// payload. This is the projection the dev-server proxy runs, so it is where a
// schema drift shows up first — and it is the only place this consolidation's
// seven documented traps are handled. Every fixture row is real: the captures
// are named in `fixtures/README.md`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IRVE_BAND_KEYS,
  IRVE_GROUP_FIELDS,
  IRVE_MAX_BOX_DEG,
  IRVE_POWER_BANDS,
  IRVE_SITE_DECIMALS,
  asciiSkeleton,
  canonicalIrveEnum,
  irveBboxWhere,
  irveCoordinateVerdict,
  irvePowerBand,
  irveSiteKey,
  irveUpdatedOn,
  parseIrveBoolean,
  projectIrveSites,
  repairIrveText,
} from './irveFeed.js';

const SAMPLE = JSON.parse(readFileSync(
  new URL('./fixtures/irve-bornes-grouped-sample.json', import.meta.url),
  'utf8',
));

const PROJECTED = projectIrveSites({
  groups: SAMPLE.results,
  totalCount: SAMPLE.total_count,
});
const siteAt = (id) => PROJECTED.sites.find((site) => site.id === id);

/** Q-Park Grande Arche, La Défense — 224 charge points on one coordinate. */
const QPARK = '48.89155,2.24202';
/** Belib' boulevard de Bercy — published twice under two TotalEnergies names. */
const BERCY = '48.84036,2.37874';
/** ENGIE Vianeo A5b Galande — published twice, second time as Greenflux. */
const REAU = '48.61063,2.63537';
/** Résidence Carouge, Brétigny-sur-Orge — mojibake, and a 6dp/7dp coord split. */
const CAROUGE = '48.61849,2.29719';
/** Ze-Watt Vernet-les-Bains — `puissance_nominale` of 7 360, i.e. watts. */
const ZEWATT = '42.55448,2.38530';

test('the captured rows still carry every column the group key names', () => {
  const row = SAMPLE.results[0];
  for (const field of IRVE_GROUP_FIELDS) assert.ok(field in row, field);
  assert.equal(typeof row.pdc, 'number');
});

test('the group key excludes id_station_itinerance and nbre_pdc', () => {
  // Trap 2. Q-Park publishes one station id per charge point, so either field
  // in the group key would undo the grouping and cost ~100 rows where the
  // capture holds 8.
  assert.ok(!IRVE_GROUP_FIELDS.includes('id_station_itinerance'));
  assert.ok(!IRVE_GROUP_FIELDS.includes('nbre_pdc'));
  const qparkRows = SAMPLE.results.filter((row) => row.consolidated_latitude === 48.891554);
  assert.equal(qparkRows.length, 8);
  assert.equal(qparkRows.reduce((sum, row) => sum + row.pdc, 0), 224);
});

// ── Trap 1: geometry ────────────────────────────────────────────────────────

test('the bbox filter is a numeric predicate, never within_bbox', () => {
  // `geo_point_borne` is null on all 231 079 rows, so Opendatasoft's geo
  // filter matches nothing at all — a silent empty map, not an error.
  const where = irveBboxWhere({ south: 48.8, west: 2.2, north: 48.9, east: 2.4 });
  assert.ok(!where.includes('within_bbox'));
  assert.ok(!where.includes('geo_point_borne'));
  assert.equal(
    where,
    'consolidated_latitude>=48.800000 AND consolidated_latitude<=48.900000'
    + ' AND consolidated_longitude>=2.200000 AND consolidated_longitude<=2.400000',
  );
});

test('the bbox filter formats through Number, so nothing string-like reaches ODSQL', () => {
  const where = irveBboxWhere({ south: '48.8" OR 1=1 --', west: 2, north: 49, east: 3 });
  assert.ok(where.startsWith('consolidated_latitude>=NaN'));
  assert.ok(!where.includes('OR 1=1'));
});

test('sites land in France, which is only true of the consolidated columns', () => {
  // Every row's `coordonneesxy` is labelled backwards — its `lon` key holds
  // the latitude. Reading it would put this capture in the Indian Ocean.
  const qpark = siteAt(QPARK);
  assert.ok(qpark.lat > 48 && qpark.lat < 49, `lat ${qpark.lat}`);
  assert.ok(qpark.lon > 2 && qpark.lon < 3, `lon ${qpark.lon}`);
});

// ── Trap 2: the site, not the station ───────────────────────────────────────

test('224 charge points at La Défense are one site, not 127 stations', () => {
  const qpark = siteAt(QPARK);
  assert.equal(qpark.pdcPublished, 224);
  assert.equal(qpark.pdcDistinct, 224);
  assert.deepEqual(qpark.operators, ['IZIVIA']);
});

test('a site is keyed on the rounded coordinate, and drawn on it', () => {
  // Trap 2 again, at metre scale: Résidence Carouge is published at six
  // decimals by one feed and seven by another. Rounding to ~1.1 m is what
  // stops it being drawn twice, a metre apart, for ever.
  assert.equal(IRVE_SITE_DECIMALS, 5);
  assert.equal(irveSiteKey(48.618492, 2.297193), CAROUGE);
  assert.equal(irveSiteKey(48.6184923, 2.2971929), CAROUGE);
  const carouge = siteAt(CAROUGE);
  assert.equal(carouge.pdcPublished, 6);
  assert.equal(carouge.lat, 48.61849);
  assert.equal(carouge.lon, 2.29719);
});

// ── Trap 3: the same charge points, published twice ─────────────────────────

test('an identical power profile under a second name collapses', () => {
  const bercy = siteAt(BERCY);
  assert.equal(bercy.pdcPublished, 14);
  assert.equal(bercy.pdcDistinct, 7);
  assert.deepEqual(bercy.operators, ['TotalEnergies Charging Services']);
  assert.deepEqual(bercy.duplicateOperators, ['TotalEnergies Marketing France']);
});

test('the collapse crosses corporate names, not just casing', () => {
  // ENGIE Vianeo and its Greenflux back end publish the same 10 charge points
  // (22 kW ×1, 50 kW ×1, 300 kW ×8) at one point.
  const reau = siteAt(REAU);
  assert.equal(reau.pdcPublished, 20);
  assert.equal(reau.pdcDistinct, 10);
  assert.deepEqual(reau.duplicateOperators, ['Greenflux']);
  assert.equal(reau.bands.hpc, 8);
});

test('both totals travel, so nothing is silently merged away', () => {
  assert.equal(PROJECTED.pdcPublished, 306);
  assert.equal(PROJECTED.pdcDistinct, 289);
  assert.equal(PROJECTED.duplicateSites, 2);
});

test('a merely OVERLAPPING profile is never collapsed', () => {
  // Résidence Carouge has Eoliberty publishing 4 × 22 kW and an unnamed
  // publisher 2 × 22 kW at the same point. Same power, different counts — so
  // they are not the same publication and both are kept.
  const carouge = siteAt(CAROUGE);
  assert.equal(carouge.pdcPublished, carouge.pdcDistinct);
  assert.deepEqual(carouge.duplicateOperators, []);
});

test('a lone operator is never mistaken for a duplicate of itself', () => {
  const qpark = siteAt(QPARK);
  assert.deepEqual(qpark.duplicateOperators, []);
  assert.equal(qpark.pdcPublished, qpark.pdcDistinct);
});

// ── Trap 4: kilowatts that are watts ────────────────────────────────────────

test('7 360 in a kilowatt column is not a 7 megawatt charger', () => {
  const zewatt = siteAt(ZEWATT);
  assert.equal(zewatt.topBand, 'inconnue');
  assert.equal(zewatt.peakKW, null);
  assert.equal(zewatt.bands.inconnue, 4);
  assert.equal(zewatt.bands.hpc, 0);
});

test('an out-of-envelope power is banded, never rescaled', () => {
  // Dividing 7 360 by a thousand is a guess that happens to be right, and the
  // same guess turns a genuine 600 kW bank into 0.6 kW.
  assert.equal(irvePowerBand(7360), 'inconnue');
  assert.equal(irvePowerBand(3680), 'inconnue');
  assert.equal(irvePowerBand(401), 'inconnue');
  assert.equal(irvePowerBand(400), 'hpc');
  assert.equal(irvePowerBand(0), 'inconnue');
  assert.equal(irvePowerBand(-1), 'inconnue');
  assert.equal(irvePowerBand(null), 'inconnue');
  assert.equal(irvePowerBand('22'), 'normale');
});

test('the band boundaries are inclusive at the top of each band', () => {
  assert.equal(irvePowerBand(7.4), 'lente');
  assert.equal(irvePowerBand(7.36), 'lente');
  assert.equal(irvePowerBand(7.41), 'normale');
  assert.equal(irvePowerBand(22), 'normale');
  assert.equal(irvePowerBand(50), 'accelere');
  assert.equal(irvePowerBand(150), 'rapide');
  assert.equal(irvePowerBand(150.1), 'hpc');
  assert.deepEqual(IRVE_BAND_KEYS, ['lente', 'normale', 'accelere', 'rapide', 'hpc', 'inconnue']);
});

test('a real 361 kW Supercharger still reads as high power', () => {
  const tesla = siteAt('41.95192,8.79281');
  assert.equal(tesla.topBand, 'hpc');
  assert.equal(tesla.peakKW, 361);
});

test('the top band ignores the unusable rows beside it', () => {
  // A site whose only readable power is 7 kW is a 7 kW site even when a row
  // next to it publishes 7 360 — `inconnue` is a tally, never a ranking.
  const projected = projectIrveSites({
    groups: [
      { consolidated_latitude: 48.8, consolidated_longitude: 2.3, nom_operateur: 'A', puissance_nominale: 7, pdc: 2, consolidated_is_lon_lat_correct: 'True', consolidated_commune: 'Paris' },
      { consolidated_latitude: 48.8, consolidated_longitude: 2.3, nom_operateur: 'A', puissance_nominale: 7360, pdc: 3, consolidated_is_lon_lat_correct: 'True', consolidated_commune: 'Paris' },
    ],
  });
  const [site] = projected.sites;
  assert.equal(site.topBand, 'lente');
  assert.equal(site.peakKW, 7);
  assert.equal(site.bands.inconnue, 3);
});

// ── Trap 5: eight spellings of a boolean ────────────────────────────────────

test('every published spelling of a boolean parses, and Boolean() would not', () => {
  for (const value of ['True', 'true', 'TRUE', '1', true]) {
    assert.equal(parseIrveBoolean(value), true, String(value));
  }
  for (const value of ['False', 'false', 'FALSE', '0', false]) {
    assert.equal(parseIrveBoolean(value), false, String(value));
    // The bug this exists to prevent: every paid site reported as free.
    assert.equal(Boolean(value), value !== false, String(value));
  }
});

test('an unstated boolean stays null, not false', () => {
  assert.equal(parseIrveBoolean(null), null);
  assert.equal(parseIrveBoolean(undefined), null);
  assert.equal(parseIrveBoolean(''), null);
  assert.equal(parseIrveBoolean('oui'), null);
});

test('the capture really does carry more than one spelling', () => {
  const spellings = new Set(SAMPLE.results.map((row) => String(row.gratuit)));
  assert.ok(spellings.size >= 3, [...spellings].join(','));
  assert.ok(spellings.has('FALSE') && spellings.has('False'));
});

test('a site is free only when every surviving publication says so', () => {
  // Bercy publishes `"FALSE"` under one name and nothing at all under the
  // other, so the honest answer is "unstated", not "paid" and not "free".
  assert.equal(siteAt(BERCY).free, null);
  assert.equal(siteAt(QPARK).free, false);
});

test('connectors are the union of the columns that parse TRUE', () => {
  assert.deepEqual(siteAt(REAU).connectors, ['type2', 'ccs', 'chademo']);
  assert.deepEqual(siteAt('41.95192,8.79281').connectors, ['ccs']);
});

// ── Trap 6: mojibake in a closed vocabulary ─────────────────────────────────

test('Mac Roman read as Latin-1 is repaired exactly', () => {
  assert.equal(repairIrveText('Acc\x8fs libre'), 'Accès libre');
  assert.equal(repairIrveText('Accessibilit\x8e inconnue'), 'Accessibilité inconnue');
  assert.equal(
    repairIrveText('Parking priv\x8e r\x8eserv\x8e \x88 la client\x8fle'),
    'Parking privé réservé à la clientèle',
  );
});

test('correctly encoded text is untouched by the repair', () => {
  assert.equal(repairIrveText('Accès libre'), 'Accès libre');
  assert.equal(repairIrveText('QPARK - LA DÉFENSE'), 'QPARK - LA DÉFENSE');
  assert.equal(repairIrveText('  Electra  '), 'Electra');
  assert.equal(repairIrveText(null), '');
});

test('the rarer manglings fold onto the schema value via their ASCII skeleton', () => {
  // `Accčs` (Latin-1 read as CP1250) and `Acc¸s` are printable characters, so
  // no byte-level repair can touch them — but all four spellings share one
  // skeleton, and the skeletons of the two legal values stay distinct.
  for (const spelling of ['Accès libre', 'Acc\x8fs libre', 'Accčs libre', 'Acc¸s libre']) {
    assert.equal(canonicalIrveEnum('condition_acces', spelling), 'Accès libre', spelling);
  }
  assert.equal(canonicalIrveEnum('condition_acces', 'Accès réservé'), 'Accès réservé');
  assert.notEqual(asciiSkeleton('Accès libre'), asciiSkeleton('Accès réservé'));
});

test('a value outside the vocabulary passes through instead of being forced', () => {
  assert.equal(canonicalIrveEnum('condition_acces', 'Sur rendez-vous'), 'Sur rendez-vous');
  assert.equal(canonicalIrveEnum('condition_acces', ''), '');
});

test('the mojibake site reports one access value, not two', () => {
  const carouge = siteAt(CAROUGE);
  assert.equal(carouge.access, 'Accès libre');
  assert.equal(carouge.pmr, 'Accessibilité inconnue');
  const raw = new Set(SAMPLE.results
    .filter((row) => Math.abs(row.consolidated_latitude - 48.618492) < 1e-5)
    .map((row) => row.condition_acces));
  assert.ok(raw.size > 1, 'the capture must still contain both spellings');
});

// ── Trap 7: "not verified" is not "wrong" ───────────────────────────────────

test('a coordinate contradicting its own VERIFIED commune is withheld', () => {
  // QOVOLTIS publishes "Route du Baganais", commune Le Porge (Gironde), at
  // −44.996 / +44.996 — south of Madagascar.
  assert.equal(PROJECTED.pdcWithheld, 4);
  assert.equal(irveCoordinateVerdict({
    consolidated_latitude: -44.9961982,
    consolidated_longitude: 44.9961982,
    consolidated_is_lon_lat_correct: 'False',
    consolidated_commune: 'Le Porge',
  }), 'contradicted');
  assert.ok(!PROJECTED.sites.some((site) => site.lat < 0));
});

test('an UNVERIFIABLE coordinate is kept, because absence is not evidence', () => {
  // The same flag is False on 80 545 rows the pipeline simply could not check.
  // Reading those as bad would discard a third of France.
  assert.equal(irveCoordinateVerdict({
    consolidated_latitude: 48.8,
    consolidated_longitude: 2.3,
    consolidated_is_lon_lat_correct: 'False',
    consolidated_commune: null,
  }), 'unverified');
  const electra = siteAt('42.52040,2.82160');
  assert.equal(electra.coordVerified, false);
  assert.equal(electra.pdcDistinct, 4);
});

test('Null Island is dropped outright and counted separately', () => {
  assert.equal(PROJECTED.pdcInvalid, 1);
  assert.equal(irveCoordinateVerdict({
    consolidated_latitude: 0,
    consolidated_longitude: 0,
    consolidated_is_lon_lat_correct: 'False',
    consolidated_commune: 'Villefranche-sur-Saône',
  }), 'invalid');
  assert.ok(!PROJECTED.sites.some((site) => site.lat === 0 && site.lon === 0));
});

test('an out-of-range or unparseable coordinate is invalid, not clamped', () => {
  for (const row of [
    { consolidated_latitude: 91, consolidated_longitude: 2 },
    { consolidated_latitude: 48, consolidated_longitude: 181 },
    { consolidated_latitude: 'n/a', consolidated_longitude: 2 },
    { consolidated_latitude: null, consolidated_longitude: null },
  ]) {
    assert.equal(irveCoordinateVerdict(row), 'invalid', JSON.stringify(row));
  }
});

test('coordVerified needs every charge point at the site to be verified', () => {
  assert.equal(siteAt(QPARK).coordVerified, true);
  const mixed = projectIrveSites({
    groups: [
      { consolidated_latitude: 48.8, consolidated_longitude: 2.3, nom_operateur: 'A', puissance_nominale: 22, pdc: 1, consolidated_is_lon_lat_correct: 'True', consolidated_commune: 'Paris' },
      { consolidated_latitude: 48.8, consolidated_longitude: 2.3, nom_operateur: 'B', puissance_nominale: 22, pdc: 3, consolidated_is_lon_lat_correct: 'False', consolidated_commune: null },
    ],
  });
  assert.equal(mixed.sites[0].coordVerified, false);
  assert.equal(mixed.sites[0].pdcDistinct, 4);
});

// ── Completeness, ordering, and the shape of the answer ─────────────────────

test('every charge point in the capture is accounted for exactly once', () => {
  assert.equal(
    PROJECTED.pdcPublished + PROJECTED.pdcWithheld + PROJECTED.pdcInvalid,
    SAMPLE.total_count,
  );
  assert.equal(PROJECTED.truncated, false);
});

test('a short grouped answer against the dataset own count is truncation', () => {
  // The one check that catches a silent aggregation cap, which no error field
  // would report: the grouped counts must add up to the box own total.
  const truncated = projectIrveSites({
    groups: SAMPLE.results,
    totalCount: SAMPLE.total_count + 1,
  });
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.pdcTotal, SAMPLE.total_count + 1);
});

test('a missing upstream count is not read as truncation', () => {
  assert.equal(projectIrveSites({ groups: SAMPLE.results }).truncated, false);
  assert.equal(projectIrveSites({ groups: SAMPLE.results }).pdcTotal, null);
});

test('sites come back biggest first, with a stable tie-break', () => {
  const sizes = PROJECTED.sites.map((site) => site.pdcDistinct);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
  assert.equal(PROJECTED.sites[0].id, QPARK);
});

test('an empty or malformed input projects to an empty answer, not a throw', () => {
  for (const input of [undefined, {}, { groups: null }, { groups: [] }, { groups: [{}, { pdc: 0 }] }]) {
    const projected = projectIrveSites(input);
    assert.deepEqual(projected.sites, []);
    assert.equal(projected.siteCount, 0);
    assert.equal(projected.pdcPublished, 0);
  }
});

test('the box ceiling is the one measured against the densest real viewport', () => {
  // 0.35° over Paris is 22 348 charge points and groups to 4 996 rows, well
  // inside the 20 000 cap — so the cap is a safety net, not a routine crop.
  assert.equal(IRVE_MAX_BOX_DEG, 0.35);
  assert.equal(IRVE_POWER_BANDS.at(-1).max, 400);
});

test('date_maj normalizes across the two endpoint shapes', () => {
  assert.equal(irveUpdatedOn('2025-10-11'), '2025-10-11');
  assert.equal(irveUpdatedOn('2025-11-15T00:00:00+00:00'), '2025-11-15');
  assert.equal(irveUpdatedOn(null), '');
  assert.equal(irveUpdatedOn('bientôt'), '');
});

test('a site reports the span of its own freshness, not the poll time', () => {
  // A tenth of this file has not been touched since 2023; the card has to be
  // able to say so per site.
  const bercy = siteAt(BERCY);
  assert.equal(bercy.updatedFrom, '2023-07-06');
  assert.equal(bercy.updatedTo, '2025-06-30');
});
