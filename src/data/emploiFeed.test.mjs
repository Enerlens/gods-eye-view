// src/data/emploiFeed.test.mjs
// Pins the census employment dataset against three real Melodi answers: an
// arrondissement with figures, a village where the weighted estimate is under
// four people, and a commune the dataset does not cover at all — which it
// signals with HTTP 200 and an empty list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMPLOI_DATASET,
  EMPLOI_RATE_FLOOR,
  EMPLOI_STATUS,
  buildEmploiUrl,
  indexEmploiObservations,
  projectEmploi,
  projectEmploiYear,
} from './emploiFeed.js';

const load = (code) => JSON.parse(readFileSync(
  new URL(`./fixtures/melodi-rp-emploi-${code}-sample.json`, import.meta.url),
  'utf8',
));
const PARIS13 = load('75113');
const VILLAGE = load('05066');
const MAYOTTE = load('97611');

test('the captured answer still carries the dimensions the index reads', () => {
  const observation = PARIS13.observations[0];
  for (const key of ['GEO', 'EMPSTA_ENQ', 'TIME_PERIOD', 'AGE', 'SEX']) {
    assert.ok(Object.hasOwn(observation.dimensions, key), `${key} must still be published`);
  }
  assert.ok(Number.isFinite(observation.measures.OBS_VALUE_NIVEAU.value));
  assert.equal(PARIS13.observations.length, 30);
});

test('an arrondissement is asked for at ARM level, a commune at COM', () => {
  // Melodi answers an empty list, not an error, for the wrong level.
  assert.match(buildEmploiUrl('75113'), /GEO=2026-ARM-75113/);
  assert.match(buildEmploiUrl('29232'), /GEO=2026-COM-29232/);
  assert.match(buildEmploiUrl('2A004'), /GEO=2026-COM-2A004/);
  assert.match(buildEmploiUrl('75113'), new RegExp(EMPLOI_DATASET));
  assert.equal(buildEmploiUrl('75'), null);
});

test('the two arithmetic identities hold on every census year', () => {
  const byYear = indexEmploiObservations(PARIS13);
  assert.deepEqual([...byYear.keys()].sort(), ['2012', '2017', '2023']);
  for (const [year, values] of byYear) {
    const projected = projectEmploiYear(year, values);
    assert.equal(projected.consistent, true, `${year} must reconcile`);
    assert.equal(
      projected.employed + projected.unemployed,
      projected.active,
      `${year}: employed + unemployed must equal active`,
    );
  }
});

test('a renumbered modality breaks the identity instead of a rate', () => {
  const broken = new Map([
    [EMPLOI_STATUS.employed, 800],
    [EMPLOI_STATUS.unemployed, 100],
    // Not 900: as if `1T2` had come to mean something else.
    [EMPLOI_STATUS.active, 1200],
    [EMPLOI_STATUS.total, 1500],
  ]);
  const projected = projectEmploiYear('2023', broken);
  assert.equal(projected.consistent, false);
  assert.equal(projected.unemploymentRate, null);
  assert.match(projected.ratesWithheld, /identités/);
  // The counts are still reported: they are what the file said.
  assert.equal(projected.active, 1200);
});

test('a rate on a village of four people is refused, and the counts are not', () => {
  const fiche = projectEmploi({ payload: VILLAGE, code: '05066' });
  const current = fiche.current;
  assert.equal(current.year, '2023');
  assert.equal(current.population, 4);
  assert.equal(current.unemploymentRate, null);
  assert.match(current.ratesWithheld, new RegExp(`${EMPLOI_RATE_FLOOR} actifs`));
  // The counts stand. 2 active residents is a fact; 100 % is not.
  assert.equal(current.active, 2);
  assert.equal(current.employed, 0);
});

test('an arrondissement above the floor gets all three rates and a trend', () => {
  const fiche = projectEmploi({ payload: PARIS13, code: '75113' });
  assert.equal(fiche.commune.level, 'ARM');
  assert.equal(fiche.current.year, '2023');
  assert.ok(fiche.current.unemploymentRate > 10 && fiche.current.unemploymentRate < 14);
  assert.ok(fiche.current.activityRate > 70);
  assert.ok(fiche.current.employmentRate > 60);
  assert.equal(fiche.series.length, 3);
  assert.deepEqual(fiche.series.map((year) => year.year), ['2012', '2017', '2023']);
  // 2017 was 12,9 %, 2023 is 11,9 % — the direction, which one number cannot say.
  assert.ok(fiche.trend < 0);
});

test('out of scope and no data are different answers', () => {
  // Mamoudzou: HTTP 200, zero observations. The dataset is France hors Mayotte.
  const outside = projectEmploi({ payload: MAYOTTE, code: '97611', inScope: false });
  assert.equal(outside.empty, true);
  assert.equal(outside.outOfScope, true);
  assert.equal(outside.current, null);
  const silent = projectEmploi({ payload: { observations: [] }, code: '29232' });
  assert.equal(silent.empty, true);
  assert.equal(silent.outOfScope, false);
});

test('weighted census estimates are rounded to whole people for display', () => {
  // The raw values carry decimals — 1,75 residents — because the census is a
  // rolling survey with weights, not a headcount.
  const raw = VILLAGE.observations
    .filter((o) => o.dimensions.TIME_PERIOD === '2023')
    .map((o) => o.measures.OBS_VALUE_NIVEAU.value);
  assert.ok(raw.some((value) => !Number.isInteger(value)));
  const fiche = projectEmploi({ payload: VILLAGE, code: '05066' });
  for (const year of fiche.series) {
    assert.ok(Number.isInteger(year.active));
    assert.ok(Number.isInteger(year.population));
  }
});
