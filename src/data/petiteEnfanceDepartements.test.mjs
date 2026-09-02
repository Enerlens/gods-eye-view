// The national fold.
//
// Run against the REAL bundled département polygons, because the one fact this
// module exists to establish — that the CNAF's codes and the IGN outlines
// agree character for character, so the join is a lookup and not a
// point-in-polygon — is a property of those two actual files. A synthetic
// index would prove nothing about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildDepartementIndex } from './franceDepartements.js';
import { projectPeDepartements } from './petiteEnfanceDepartements.js';
import { PE_BANDS, PE_MODES, projectPeAreas } from './petiteEnfanceFeed.js';

const INDEX = buildDepartementIndex(JSON.parse(readFileSync(
  new URL('./local_data/france_departements/departements.geojson', import.meta.url),
  'utf8',
)));
const DEP = JSON.parse(readFileSync(
  new URL('./fixtures/cnaf-petite-enfance-dep-sample.json', import.meta.url),
  'utf8',
));
const NATIONAL = 60.9;

const areas = projectPeAreas({
  scale: 'dep', taux: DEP.txcouv, places: DEP.nbpla, national: NATIONAL, year: 2023,
}).areas;

const fold = (over = {}) => projectPeDepartements({
  areas, index: INDEX, national: NATIONAL, year: 2023, ...over,
});

test('the CNAF codes and the bundled outlines agree exactly — the premise', () => {
  // The neighbouring layer had the opposite result: the Annuaire de
  // l'éducation zero-pads to three characters and would miss EVERY row on a
  // code join, which is why `schoolsDepartements.js` runs point-in-polygon.
  // Two French public files, two conventions, and the difference decides the
  // whole algorithm — so it is asserted rather than assumed.
  const published = new Set(DEP.txcouv.map((r) => r.numdep));
  assert.ok(published.has('2A'), 'Corsica must be in the fixture');
  for (const code of ['85', '93', '75', '48', '2A']) {
    assert.ok(INDEX.byCode.has(code), `${code} missing from the outlines`);
    assert.ok(published.has(code), `${code} missing from the CNAF sample`);
  }
  // No zero-padding on either side.
  assert.equal(INDEX.byCode.has('085'), false);
  assert.equal(published.has('085'), false);
});

test('the bundled polygons are metropolitan-only', () => {
  assert.equal(INDEX.list.length, 96);
  for (const code of ['971', '972', '973', '974', '976', '977', '978']) {
    assert.equal(INDEX.byCode.has(code), false, `${code} should not be bundled`);
  }
});

test('an overseas row keeps its rate and is reported, never dropped', () => {
  const out = fold();
  const codes = out.unpainted.map((row) => row.code);
  assert.ok(codes.includes('973'));
  const guyane = out.unpainted.find((row) => row.code === '973');
  assert.equal(guyane.rate, 13.4);
  assert.equal(guyane.band, 'tres-bas');
  // 22% of the national rate. This is the layer's headline, and a fold that
  // silently stopped at the coastline would delete it.
  assert.ok(guyane.ratio < 0.25, `${guyane.ratio}`);
  assert.equal(out.painted + out.unpainted.length, out.published);
});

test('the unpainted list is sorted worst-first, because that is the finding', () => {
  const out = fold();
  for (let i = 1; i < out.unpainted.length; i += 1) {
    assert.ok((out.unpainted[i - 1].rate ?? 0) <= (out.unpainted[i].rate ?? 0));
  }
  assert.equal(out.unpainted[0].code, '973');
});

test('every bundled polygon gets a row, painted or not', () => {
  const out = fold();
  assert.equal(out.departements.length, 96);
  const painted = out.departements.filter((row) => row.band);
  assert.equal(painted.length, out.painted);
  // A département the CNAF does not cover carries nulls, never a band — both
  // ends of a diverging ramp are strong claims and neither is a safe default.
  for (const row of out.departements) {
    if (row.band) continue;
    assert.equal(row.rate, null);
    assert.equal(row.ratio, null);
    assert.equal(row.totalPlaces, null);
    // The polygon's own name survives, so the map is still labelled.
    assert.ok(row.name);
  }
});

test('the painted rows carry the whole card, not just the rate', () => {
  const out = fold();
  const vendee = out.departements.find((row) => row.code === '85');
  assert.equal(vendee.rate, 85.7);
  assert.equal(vendee.band, 'tres-haut');
  assert.equal(vendee.dominant, 'am');
  assert.ok(vendee.totalPlaces > 0);
  assert.ok(vendee.areaKm2 > 0);
  for (const mode of PE_MODES) assert.equal(typeof vendee.modes[mode], 'number');
});

test('the spread covers every published row, not just the painted ones', () => {
  // A range that stopped at the coastline would understate the country it is
  // describing by a factor of three.
  const out = fold();
  assert.equal(out.spread.min, 13.4);
  assert.equal(out.spread.max, 85.7);
  const paintedRates = out.departements.filter((r) => r.band).map((r) => r.rate);
  assert.ok(out.spread.min < Math.min(...paintedRates));
});

test('the band tally counts painted départements exactly once', () => {
  const out = fold();
  assert.equal(PE_BANDS.reduce((t, b) => t + out.bands[b], 0), out.painted);
});

test('the dominant tally counts every published row', () => {
  const out = fold();
  const total = PE_MODES.reduce((t, mode) => t + out.dominantTally[mode], 0);
  assert.equal(total, out.published);
});

test('an empty or malformed input is an empty fold, not a throw', () => {
  for (const input of [[], null, undefined, 'nope', [null]]) {
    const out = projectPeDepartements({ areas: input, index: INDEX, national: NATIONAL });
    assert.equal(out.painted, 0);
    assert.equal(out.departements.length, 96);
    assert.deepEqual(out.unpainted, []);
  }
  // No index at all is an empty list, not a crash on `index.list`.
  assert.deepEqual(projectPeDepartements({ areas }).departements, []);
});
