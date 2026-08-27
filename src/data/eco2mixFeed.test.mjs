// src/data/eco2mixFeed.test.mjs
// Pins the UPSTREAM ODRÉ éCO2mix datasets against real captured payloads. This
// is the projection the dev-server proxy runs, so it is where a schema drift
// shows up first — and it is the only place this product's genuinely
// inconsistent typing and its two-sign-conventions problem are handled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BORDER_EXCHANGES,
  NATIONAL_FILIERES,
  REGIONAL_FILIERES,
  isMeasuredRow,
  megawatts,
  projectEco2mix,
  projectNational,
  projectRegional,
  summarizeMix,
} from './eco2mixFeed.js';

const NATIONAL = JSON.parse(readFileSync(
  new URL('./fixtures/eco2mix-national-tr-sample.json', import.meta.url),
  'utf8',
));
const REGIONAL = JSON.parse(readFileSync(
  new URL('./fixtures/eco2mix-regional-tr-sample.json', import.meta.url),
  'utf8',
));

test('the captured rows still carry the fields the projection reads', () => {
  const row = NATIONAL.results[0];
  assert.equal(typeof row.date_heure, 'string');
  for (const filiere of NATIONAL_FILIERES) assert.ok(filiere.field in row, filiere.field);
  for (const border of BORDER_EXCHANGES) assert.ok(border.field in row, border.field);
  assert.ok('taux_co2' in row && 'ech_physiques' in row && 'pompage' in row);

  const regional = REGIONAL.results[0];
  assert.equal(typeof regional.code_insee_region, 'string');
  for (const filiere of REGIONAL_FILIERES) assert.ok(filiere.field in regional, filiere.field);
  assert.ok('ech_physiques' in regional && 'libelle_region' in regional);
});

test('pompage is an int nationally and a STRING regionally', () => {
  // Trap 2. Not a curiosity: `Number('0')` is fine but a strict `typeof`
  // check, or any arithmetic on the raw value, silently concatenates.
  assert.equal(typeof NATIONAL.results[0].pompage, 'number');
  assert.equal(typeof REGIONAL.results[0].pompage, 'string');
  assert.equal(typeof REGIONAL.results[0].stockage_batterie, 'string');
  assert.equal(megawatts(REGIONAL.results[0].pompage), 0);
  assert.equal(megawatts(NATIONAL.results[0].pompage), -66);
});

test('megawatts separates "not published" from "zero megawatts"', () => {
  assert.equal(megawatts(null), null);
  assert.equal(megawatts(undefined), null);
  assert.equal(megawatts(''), null);
  assert.equal(megawatts('   '), null);
  assert.equal(megawatts('abc'), null);
  // `Number('')` is 0, which is exactly the fold this guards against.
  assert.equal(megawatts(0), 0);
  assert.equal(megawatts('0'), 0);
  assert.equal(megawatts(-2052), -2052);
});

test('the regional split has no gaz/fioul/charbon, only thermique', () => {
  // Trap 3: reconciling the two splits would mean inventing a regional gas
  // figure RTE does not publish.
  const regionalKeys = new Set(REGIONAL_FILIERES.map((f) => f.key));
  assert.ok(regionalKeys.has('thermique'));
  for (const key of ['gaz', 'fioul', 'charbon']) assert.ok(!regionalKeys.has(key), key);
  const nationalKeys = new Set(NATIONAL_FILIERES.map((f) => f.key));
  assert.ok(!nationalKeys.has('thermique'));
  for (const key of ['gaz', 'fioul', 'charbon']) assert.ok(nationalKeys.has(key), key);
});

test('pompage is not stacked as a generation filière', () => {
  // It is consumption by pumped storage running backwards, published negative;
  // stacking it would double-count against hydraulique.
  for (const table of [NATIONAL_FILIERES, REGIONAL_FILIERES]) {
    assert.ok(!table.some((filiere) => filiere.field === 'pompage'));
  }
});

test('summarizeMix totals null for a row with no filière at all', () => {
  const empty = summarizeMix({}, NATIONAL_FILIERES);
  assert.equal(empty.total, null);
  assert.equal(empty.lowCarbon, null);
  assert.deepEqual(empty.mix, []);
  // A published zero is a fact and must survive as 0, not vanish to null.
  const zeroed = summarizeMix({ charbon: 0 }, NATIONAL_FILIERES);
  assert.equal(zeroed.total, 0);
  assert.equal(zeroed.mix.length, 1);
});

test('summarizeMix orders the mix largest first', () => {
  const { mix } = summarizeMix(NATIONAL.results[0], NATIONAL_FILIERES);
  const values = mix.map((entry) => entry.mw);
  assert.deepEqual(values, values.slice().sort((a, b) => b - a));
  assert.equal(mix[0].key, 'nucleaire');
});

test('forecast padding at the head of the window is rejected', () => {
  // Trap 1: `order_by=date_heure desc` alone returns tomorrow's rows carrying
  // prevision_j1 and nothing else. The newest MEASURED row must win.
  const padded = [
    { date_heure: '2999-01-01T00:00:00+00:00', prevision_j1: 42271, consommation: null },
    ...NATIONAL.results,
  ];
  assert.equal(isMeasuredRow(padded[0]), false);
  assert.equal(projectNational(padded).at, NATIONAL.results[0].date_heure);
  assert.equal(projectNational([padded[0]]), null);
  assert.equal(projectNational([]), null);
  assert.equal(projectNational(null), null);
});

test('ech_physiques is negative for a net exporter, and the arithmetic closes', () => {
  const national = projectNational(NATIONAL.results);
  // generation + pompage - load === -ech_physiques, exactly, on the real row.
  const balance = (national.generation + national.pumping) - national.load;
  assert.equal(balance, -national.netPhysical);
  assert.ok(national.netPhysical < 0, 'France was exporting on the captured row');
});

test('the commercial balances do NOT sum to the physical one', () => {
  // Both are published, both are correct, and presenting one as the other is
  // the single easiest way to misreport this dataset.
  const national = projectNational(NATIONAL.results);
  assert.notEqual(national.netCommercial, national.netPhysical);
  assert.equal(national.exchanges.length, BORDER_EXCHANGES.length);
  assert.equal(
    national.netCommercial,
    national.exchanges.reduce((sum, entry) => sum + entry.mw, 0),
  );
});

test('Allemagne and Belgique stay ONE entry', () => {
  const national = projectNational(NATIONAL.results);
  const combined = national.exchanges.filter((entry) => entry.key === 'allemagne_belgique');
  assert.equal(combined.length, 1);
  assert.match(combined[0].label, /Allemagne/);
  assert.match(combined[0].label, /Belgique/);
});

test('exchanges are ordered by absolute flow, not by sign', () => {
  const national = projectNational(NATIONAL.results);
  const magnitudes = national.exchanges.map((entry) => Math.abs(entry.mw));
  assert.deepEqual(magnitudes, magnitudes.slice().sort((a, b) => b - a));
});

test('the 12 metropolitan regions project, and Corse is absent upstream', () => {
  const regions = projectRegional(REGIONAL.results);
  assert.equal(regions.length, 12);
  const codes = regions.map((region) => region.code).sort();
  assert.deepEqual(codes, ['11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93']);
  // Corse (code 94) runs on its own system and is not in éCO2mix régional —
  // the layer must therefore leave it unpainted rather than infer a value.
  assert.ok(!codes.includes('94'));
});

test('one lagging region keeps its own last row instead of blanking', () => {
  const rows = REGIONAL.results.map((row) => ({ ...row }));
  const stale = rows.find((row) => row.code_insee_region === '11');
  const fresher = rows.filter((row) => row.code_insee_region !== '11');
  for (const row of fresher) row.date_heure = '2026-08-27T08:00:00+00:00';
  const regions = projectRegional([...fresher, stale]);
  assert.equal(regions.length, 12);
  const idf = regions.find((region) => region.code === '11');
  assert.equal(idf.at, stale.date_heure);
  assert.notEqual(idf.at, '2026-08-27T08:00:00+00:00');
});

test('Île-de-France imports and Auvergne-Rhône-Alpes exports', () => {
  // The structural fact this layer exists to show, pinned against real data.
  const byCode = new Map(projectRegional(REGIONAL.results).map((r) => [r.code, r]));
  assert.ok(byCode.get('11').netPhysical > 0, 'IDF is a net importer');
  assert.ok(byCode.get('84').netPhysical < 0, 'AURA is a net exporter');
  // …and the biggest absolute balance sorts first.
  assert.equal(projectRegional(REGIONAL.results)[0].code, '84');
});

test('projectEco2mix survives either half being absent', () => {
  const full = projectEco2mix({ national: NATIONAL, regional: REGIONAL }, 'test');
  assert.equal(full.source, 'test');
  assert.equal(full.regionCount, 12);
  assert.ok(full.national);

  const nationalOnly = projectEco2mix({ national: NATIONAL, regional: null }, 'test');
  assert.ok(nationalOnly.national);
  assert.deepEqual(nationalOnly.regions, []);
  assert.equal(nationalOnly.regionCount, 0);

  const regionalOnly = projectEco2mix({ national: null, regional: REGIONAL }, 'test');
  assert.equal(regionalOnly.national, null);
  assert.equal(regionalOnly.regionCount, 12);

  const nothing = projectEco2mix({}, 'test');
  assert.equal(nothing.national, null);
  assert.equal(nothing.regionCount, 0);
});
