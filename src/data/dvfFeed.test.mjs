// src/data/dvfFeed.test.mjs
// Pins the UPSTREAM DVF shape against a real captured commune-year edition.
// This is the projection the dev-server proxy runs, and the arithmetic it
// guards is the kind that fails silently: every trap below produces a
// plausible NUMBER when handled wrongly, never an exception.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DVF_DEFAULT_RADIUS_M,
  DVF_MAX_RADIUS_M,
  buildDvfUrl,
  clampDvfRadius,
  departementOf,
  groupMutations,
  parseDvfCsv,
  percentile,
  selectNearbySales,
} from './dvfFeed.js';

const CSV = readFileSync(new URL('./fixtures/dvf-75113-2024-sample.csv', import.meta.url), 'utf8');
const ROWS = parseDvfCsv(CSV);
const MUTATIONS = groupMutations(ROWS);
/** The point the fixture was selected around — avenue de France, Paris 13e. */
const ORIGIN = { lon: 2.3760, lat: 48.8300 };

test('the captured edition still carries every column the projection reads', () => {
  assert.equal(ROWS.length, 194);
  for (const key of [
    'id_mutation', 'date_mutation', 'nature_mutation', 'valeur_fonciere',
    'type_local', 'surface_reelle_bati', 'nombre_pieces_principales',
    'id_parcelle', 'longitude', 'latitude',
  ]) {
    assert.ok(Object.hasOwn(ROWS[0], key), `${key} must still be published`);
  }
});

test('the file is keyed per arrondissement, not per commune', () => {
  // 75113, not 75056. This URL is the whole reason the BAN reverse geocoder is
  // the only accepted source of the commune code — see the module header.
  assert.equal(
    buildDvfUrl({ year: 2024, communeCode: '75113' }),
    'https://files.data.gouv.fr/geo-dvf/latest/csv/2024/communes/75/75113.csv',
  );
  assert.equal(departementOf('97213'), '972', 'overseas codes are three digits');
  assert.equal(departementOf('2A004'), '2A', 'Corsican codes carry a letter');
  assert.throws(() => departementOf('75'), /invalid commune code/);
  assert.throws(() => buildDvfUrl({ year: 1999, communeCode: '75113' }), /before the first published edition/);
});

test('a price belongs to the mutation, not to the row', () => {
  const block = MUTATIONS.find((entry) => entry.id === '2024-1225294');
  // One building. 179 rows. €32,000,000 restated on every one of them.
  assert.equal(block.rowCount, 179);
  assert.equal(block.valeur, 32_000_000);

  const perRow = ROWS.reduce((sum, row) => sum + (Number(row.valeur_fonciere) || 0), 0);
  const perMutation = MUTATIONS.reduce((sum, entry) => sum + (entry.valeur || 0), 0);
  // The naive column sum inflates this fixture by more than nine times, and
  // the full 2024 edition of the 13e from €0.89 bn to €15.33 bn. Neither
  // number throws; both look like money.
  assert.ok(perRow > perMutation * 9, `${perRow} vs ${perMutation}`);
});

test('a 179-lot block sale yields no price per square metre', () => {
  const block = MUTATIONS.find((entry) => entry.id === '2024-1225294');
  assert.equal(block.dwellingCount, 95);
  assert.equal(block.prixM2, null, 'the register does not say how €32 M was split');
});

test('a flat sold with its cellar is a comparable; sold with a shop it is not', () => {
  const withCellar = MUTATIONS.find((entry) => entry.id === '2024-1222246');
  assert.deepEqual(withCellar.types, ['Appartement', 'Dépendance']);
  assert.equal(withCellar.prixM2, 7182);

  const withShop = MUTATIONS.find((entry) => entry.id === '2024-1210710');
  assert.ok(withShop.types.some((type) => type.startsWith('Local')));
  assert.equal(withShop.prixM2, null);
});

test('a swap is not a sale, and its nominal value never reaches a median', () => {
  const swap = MUTATIONS.find((entry) => entry.nature === 'Echange');
  // €2,295 declared for a Paris flat: 66 €/m² if trusted, which would drag any
  // median in a thin radius through the floor.
  assert.equal(swap.valeur, 2295);
  assert.equal(swap.prixM2, null);
  // It is still RETURNED — it happened — it simply carries no ratio.
  assert.ok(MUTATIONS.includes(swap));
});

test('a mutation with no value and one with no position both survive as facts', () => {
  const noValue = MUTATIONS.find((entry) => entry.id === '2024-1217380');
  assert.equal(noValue.valeur, null);
  assert.equal(noValue.prixM2, null);

  const noPosition = MUTATIONS.find((entry) => entry.id === '2024-1213795');
  assert.equal(noPosition.lon, null);
  assert.equal(noPosition.lat, null);
  // It has a price, so it is not a broken row — it just cannot be drawn.
  assert.equal(noPosition.prixM2, 10464);
});

test('an unplaceable mutation is excluded from a radius, not counted in it', () => {
  const { sales, summary } = selectNearbySales(MUTATIONS, ORIGIN, 300);
  assert.equal(summary.count, 3);
  assert.equal(sales.every((sale) => sale.lon !== null), true);
  for (let i = 1; i < sales.length; i += 1) {
    assert.ok(sales[i].distanceM >= sales[i - 1].distanceM, 'sorted by distance');
  }
  assert.equal(summary.comparableCount, 3);
  assert.equal(summary.medianPrixM2, 8857);
});

test('the summary separates what was found from what was comparable', () => {
  const { summary } = selectNearbySales(MUTATIONS, ORIGIN, 1000);
  // A reader must be able to see the gap rather than read a median computed
  // from a subset as if it came from the whole.
  assert.ok(summary.count >= summary.comparableCount);
  assert.equal(typeof summary.perYear['2024'].count, 'number');
  assert.equal(typeof summary.perYear['2024'].comparableCount, 'number');
});

test('the radius is clamped rather than trusted', () => {
  assert.equal(clampDvfRadius(99_999), DVF_MAX_RADIUS_M);
  assert.equal(clampDvfRadius(1), 50);
  assert.equal(clampDvfRadius(undefined), 300);
});

test('percentiles interpolate, and refuse an empty set', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([7], 0.5), 7);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
});

test('the parser honours quotes it has never yet seen', () => {
  // The captured file contains no quote at all. A street name with a comma
  // would not fail loudly — it would shift every later column by one and
  // publish a longitude as a surface.
  assert.equal(CSV.includes('"'), false);
  const parsed = parseDvfCsv('a,b\n"x,y",2\n');
  assert.deepEqual(parsed, [{ a: 'x,y', b: '2' }]);
  assert.deepEqual(parseDvfCsv(''), []);
});

test('an absent parameter takes the default, not the minimum', () => {
  // FOUND LIVE. `URLSearchParams.get()` returns `null` when a parameter is
  // absent, `Number(null)` is `0`, and `Number.isFinite(0)` is true — so the
  // clamp read "the caller said nothing" as "the caller said zero" and returned
  // its MINIMUM. `GET /api/dpe` with no radius scanned 50 m instead of 200 m and
  // reported `total: 0` for an address with 2,805 diagnostics around it.
  const absent = new URL('http://x/?other=1').searchParams.get('radius');
  assert.equal(absent, null);
  assert.equal(clampDvfRadius(absent), DVF_DEFAULT_RADIUS_M);
  assert.equal(clampDvfRadius(''), DVF_DEFAULT_RADIUS_M);
  assert.equal(clampDvfRadius(undefined), DVF_DEFAULT_RADIUS_M);
  // An EXPLICIT zero is still a request, and is still clamped to the floor.
  assert.equal(clampDvfRadius('0'), 50);
});
