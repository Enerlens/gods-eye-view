// src/data/loyersFeed.test.mjs
// Pins the published carte des loyers against real captured bytes — the same
// six communes in all four segment files, kept in the CP1252 the ministry
// actually serves. The fragile parts are the encoding, the comma decimals and
// the `TYPPRED` flag: get any of the three wrong and the layer still renders,
// it just says something false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOYERS_COLUMNS,
  LOYERS_MILLESIME,
  LOYERS_SEGMENTS,
  decodeLoyersCsv,
  intervalPercent,
  loyersResourceUrl,
  monthlyRent,
  parseLoyersCsv,
  projectLoyers,
} from './loyersFeed.js';

/** The four captured files, read as BYTES so the decode is under test. */
const FIXTURES = Object.fromEntries(LOYERS_SEGMENTS.map((segment) => [
  segment.key,
  readFileSync(new URL(`./fixtures/carte-loyers-2025-${segment.key}-sample.csv`, import.meta.url)),
]));

const PARSED = Object.fromEntries(Object.entries(FIXTURES).map(([key, bytes]) => [
  key,
  parseLoyersCsv(decodeLoyersCsv(bytes)),
]));

function rowsFor(code) {
  return Object.fromEntries(Object.entries(PARSED).map(([key, parsed]) => [
    key,
    parsed.rows.get(code) ?? null,
  ]));
}

test('the captured files still publish every column the projection reads', () => {
  for (const [key, parsed] of Object.entries(PARSED)) {
    for (const column of LOYERS_COLUMNS) {
      assert.ok(parsed.header.includes(column), `${key} must still publish ${column}`);
    }
    assert.equal(parsed.dropped, 0, `${key} had unparseable rows`);
    assert.equal(parsed.rows.size, 6);
  }
});

test('the bytes are CP1252 — decoding them as UTF-8 mangles a commune name', () => {
  const decoded = decodeLoyersCsv(FIXTURES.app);
  assert.match(decoded, /La Bâtie-des-Fonds/);
  // The failure this decode exists to prevent, spelled out: the same bytes
  // read as UTF-8 lose the â entirely.
  const asUtf8 = new TextDecoder('utf-8').decode(FIXTURES.app);
  assert.ok(!asUtf8.includes('La Bâtie-des-Fonds'));
  assert.match(asUtf8, /�/);
});

test('a comma decimal is a number, not a string that starts with a digit', () => {
  const paris = PARSED.app.rows.get('75113');
  assert.equal(paris.name, 'Paris 13e Arrondissement');
  assert.ok(Math.abs(paris.eurM2 - 30.3587318706011) < 1e-9);
  assert.ok(Math.abs(paris.low - 24.3972987737681) < 1e-9);
  assert.ok(Math.abs(paris.high - 37.7768296948517) < 1e-9);
  assert.equal(paris.observationsCommune, 14211);
});

test('arrondissements are published in their own right and must not be folded', () => {
  // The register keys Paris per arrondissement. `communeCode.js` documents the
  // three registers that key the parent commune instead; this is not one.
  assert.ok(PARSED.app.rows.has('75113'));
  assert.ok(!PARSED.app.rows.has('75056'));
});

test('two communes 120 km apart share one maille price, to the microcent', () => {
  // The measurement that decides how this layer is worded: six communes in
  // seven get a figure computed for a mesh, not for them.
  const haute = PARSED.app.rows.get('05066');
  const batie = PARSED.app.rows.get('26030');
  assert.equal(haute.basis, 'maille');
  assert.equal(batie.basis, 'maille');
  assert.equal(haute.eurM2, batie.eurM2);
  assert.notEqual(haute.departement, batie.departement);
  assert.notEqual(haute.region, batie.region);
});

test('observation count is not the sample the figure came from', () => {
  // Trap 1. Chattancourt saw nine apartment ads and five T3-plus ads, and the
  // model used neither: the flag says maille, then EPCI.
  const app = PARSED.app.rows.get('55106');
  const app3 = PARSED.app3.rows.get('55106');
  assert.equal(app.observationsCommune, 9);
  assert.equal(app.basis, 'maille');
  assert.equal(app3.observationsCommune, 5);
  assert.equal(app3.basis, 'epci');
});

test('the segment is the unit of trust, not the commune', () => {
  // Trap 3. Paris 13e is commune-based for all three apartment segments and
  // borrowed for houses, on an interval 125 % as wide as the value.
  const fiche = projectLoyers({ code: '75113', rows: rowsFor('75113') });
  const bySegment = Object.fromEntries(fiche.segments.map((s) => [s.key, s]));
  assert.equal(bySegment.app.borrowed, false);
  assert.equal(bySegment.app12.borrowed, false);
  assert.equal(bySegment.app3.borrowed, false);
  assert.equal(bySegment.maison.borrowed, true);
  assert.equal(fiche.borrowedSegments, 1);
  assert.ok(bySegment.maison.intervalPercent >= 69);
});

test('the interval reports its WIDER side, never an average of the two', () => {
  // 22.56 with 13.29 below and 38.32 above: the honest half-width is 70 %,
  // not the 55 % a midpoint would have produced.
  const row = { eurM2: 22.5646356776788, low: 13.2870223610944, high: 38.3203075474041 };
  assert.equal(intervalPercent(row), 70);
  assert.equal(intervalPercent({ eurM2: 0, low: 0, high: 0 }), null);
  assert.equal(intervalPercent({ eurM2: 10, low: null, high: null }), null);
});

test('the monthly figure is stated at the segment’s own reference surface', () => {
  // The €/m² is defined at one surface per segment and nowhere else.
  assert.equal(monthlyRent(30.3587318706011, 52), 1579);
  assert.equal(monthlyRent(22.5646356776788, 92), 2076);
  assert.equal(monthlyRent(null, 52), null);
  const fiche = projectLoyers({ code: '29232', rows: rowsFor('29232') });
  const app = fiche.segments.find((s) => s.key === 'app');
  assert.equal(app.surfaceM2, 52);
  assert.equal(app.monthlyEur, monthlyRent(app.eurM2, 52));
  assert.ok(app.monthlyLowEur < app.monthlyEur);
  assert.ok(app.monthlyHighEur > app.monthlyEur);
});

test('a silent file is named, not quietly dropped', () => {
  const rows = rowsFor('97101');
  delete rows.maison;
  const fiche = projectLoyers({ code: '97101', rows, missing: [] });
  assert.equal(fiche.segments.length, 3);
  assert.deepEqual(fiche.missing, ['maison']);
  assert.equal(fiche.commune.departement, '971');
});

test('an unknown TYPPRED counts as borrowed rather than as local', () => {
  const parsed = parseLoyersCsv([
    '"id_zone";"INSEE_C";"LIBGEO";"EPCI";"DEP";"REG";"loypredm2";"lwr.IPm2";"upr.IPm2";"TYPPRED";"nbobs_com";"nbobs_mail";"R2_adj"',
    '"9";"01001";"Essai";"200000000";"01";"84";10,5;9,0;12,0;"canton";3;900;0,5',
  ].join('\r\n'));
  const fiche = projectLoyers({ code: '01001', rows: { app: parsed.rows.get('01001') } });
  assert.equal(fiche.segments[0].basis, 'canton');
  assert.equal(fiche.segments[0].borrowed, true);
  assert.match(fiche.segments[0].basisLabel, /non documentée/);
});

test('every payload carries the two facts a listing comparison needs', () => {
  const fiche = projectLoyers({ code: '75113', rows: rowsFor('75113') });
  assert.equal(fiche.charges, 'comprises');
  assert.equal(fiche.furnished, false);
  assert.equal(fiche.millesime, LOYERS_MILLESIME);
  assert.match(fiche.observationSource, /leboncoin/);
});

test('resources are addressed by stable id, not by a dated upload path', () => {
  for (const segment of LOYERS_SEGMENTS) {
    const url = loyersResourceUrl(segment.resource);
    assert.match(url, /^https:\/\/www\.data\.gouv\.fr\/api\/1\/datasets\/r\/[0-9a-f-]{36}$/);
    assert.ok(segment.surfaceM2 > 0);
  }
  assert.equal(new Set(LOYERS_SEGMENTS.map((s) => s.resource)).size, LOYERS_SEGMENTS.length);
});
