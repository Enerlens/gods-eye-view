// What the national choropleth is allowed to shade, and what it must refuse to.
//
// Two properties are under test and both are about the quantile cut.
//
// FIRST: **only a published rate may reach a threshold or a band.** A withheld
// cell has no rate at all, a zero cell has a rate of exactly 0, and neither may
// enter the sorted list `countBins` cuts — otherwise the ramp's own boundaries
// are computed from values the publisher refused to give, and every other
// département's colour moves because of them. Suppression does not exist at
// département grain (the DEP base has no `est_diffuse` column: 17 711 positive
// cells, 469 zeros, 0 nulls, measured 2026-09-02), so the tests inject one
// anyway — the same `projectDelinquanceNational` runs over the commune census
// and must stay correct if a future edition starts withholding here too.
//
// SECOND: **`countBins` is a COUNT cutter and a rate fed to it raw fabricates
// boundaries.** Re-measured on the live 2025 edition over the 96 bundled
// polygons: for `Cambriolages de logement` the real quantiles are 3.641, 4.769,
// 5.491, 5.926 and 6.569 per 1 000 dwellings, and `countBins` on the raw rates
// returns [4, 5, 6, 7, 8] — the third rounds onto the second and the tie-break
// then invents 6, 7 and 8, moving the top boundary from 6.57 to 8.00. On
// `Homicides` it is total: the real quantiles run 0.0071 to 0.0178 and it
// returns [0, 1, 2, 3, 4], putting all 93 départements in band 0. Cutting on
// the rate × 1 000 is what makes the shared cutter usable, and this file pins
// both halves of that measurement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CELL_PUBLISHED,
  CELL_SUPPRESSED,
  CELL_ZERO,
  DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS,
  DELINQUANCE_TOTAL_SLUG,
  parseSsmsiCsv,
  projectDelinquanceDepartements,
} from './delinquanceFeed.js';
import { buildDepartementIndex, countBins } from './franceDepartements.js';
import {
  DELINQUANCE_COAST_SNAP_KM,
  DELINQUANCE_DEPARTEMENT_BINS,
  DELINQUANCE_RATE_SCALE,
  delinquanceDepartementTotalCell,
  delinquanceRateBin,
  delinquanceRateBins,
  departementsInBox,
  locateDelinquanceDepartement,
  projectDelinquanceNational,
} from './delinquanceDepartements.js';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

const PACK = projectDelinquanceDepartements({
  rows: parseSsmsiCsv(read('./fixtures/ssmsi-departements-sample.csv')),
});
const INDEX = buildDepartementIndex(JSON.parse(
  read('./local_data/france_departements/departements.geojson'),
));
const national = (indicator, extra = {}) => projectDelinquanceNational({
  departements: PACK.departements,
  years: PACK.years,
  index: INDEX,
  indicator,
  year: '2025',
  ...extra,
});

test('the bundled polygons are the 96 metropolitan ones, Corsica spelt as the register spells it', () => {
  assert.equal(INDEX.list.length, 96);
  // The reason a code join is legal HERE and nowhere else in this repo: this
  // register writes 2A/2B exactly as the IGN outlines do. Checked against both
  // files rather than assumed.
  assert.equal(INDEX.byCode.has('2A'), true);
  assert.equal(INDEX.byCode.has('2B'), true);
  assert.equal(INDEX.byCode.has('02A'), false);
  // No overseas geometry in the bundle at all.
  for (const code of ['971', '972', '973', '974', '976']) {
    assert.equal(INDEX.byCode.has(code), false, `${code} has no metropolitan outline`);
  }
});

test('the quantile cut is taken on faits per MILLION, because the shared cutter rounds', () => {
  // The measurement that settles the unit change, re-run here on the fixture's
  // eleven metropolitan départements rather than on all 96, so it is checkable
  // offline. The shape of the failure is identical.
  const rates = national('cambriolages').departements
    .filter((row) => row.state === CELL_PUBLISHED && row.rate > 0)
    .map((row) => row.rate);
  assert.equal(rates.length, 11);

  const raw = countBins(rates, DELINQUANCE_DEPARTEMENT_BINS);
  const scaled = delinquanceRateBins(rates, DELINQUANCE_DEPARTEMENT_BINS);
  assert.equal(DELINQUANCE_RATE_SCALE, 1000);
  assert.equal(raw.length, DELINQUANCE_DEPARTEMENT_BINS - 1);
  assert.equal(scaled.length, DELINQUANCE_DEPARTEMENT_BINS - 1);

  // Raw: every threshold is an integer, and the tie-breaker has manufactured a
  // strictly ascending run out of values that were not distinct.
  for (const bound of raw) assert.equal(Number.isInteger(bound), true);
  // Scaled: the thresholds land on real quantiles of the data, to a thousandth.
  assert.deepEqual(scaled, [1.809, 3.27, 3.974, 6.173, 8.199]);
  const sorted = [...rates].sort((a, b) => a - b);
  for (const bound of scaled) {
    assert.ok(bound >= sorted[0] && bound <= sorted[sorted.length - 1],
      `${bound} must be a value the data actually reaches`);
  }
  // And the two disagree, which is the whole point of the unit change.
  assert.notDeepEqual(raw, scaled);

  // Homicides is where raw binning collapses completely: every rate is under
  // 0.06 per 1 000, so integer thresholds put the whole country in one band.
  const homicides = national('homicides').departements
    .filter((row) => row.state === CELL_PUBLISHED && row.rate > 0)
    .map((row) => row.rate);
  assert.deepEqual(countBins(homicides, 6), [0, 1, 2, 3, 4]);
  const homicideBins = delinquanceRateBins(homicides, 6);
  assert.ok(homicideBins.every((bound) => bound > 0 && bound < 0.1), JSON.stringify(homicideBins));
  assert.equal(new Set(homicideBins).size, homicideBins.length, 'every band stays reachable');
});

test('a zero and a withheld rate never enter the cut', () => {
  // `countBins` drops non-positive values itself, which is exactly right: a
  // département measured at zero is drawn as the zero state, not as the bottom
  // of a scale, and a `null` from a withheld cell must not become 0 on the way.
  const measured = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const withNoise = [...measured, 0, 0, 0, null, undefined, NaN, -4];
  assert.deepEqual(delinquanceRateBins(withNoise, 6), delinquanceRateBins(measured, 6));
  assert.deepEqual(delinquanceRateBins([], 6), [0, 0, 0, 0, 0]);
  assert.deepEqual(delinquanceRateBins(null, 6), [0, 0, 0, 0, 0]);
});

test('a rate of zero, null or NaN takes no band at all', () => {
  const thresholds = [1, 2, 3, 4, 5];
  assert.equal(delinquanceRateBin(0, thresholds), -1);
  assert.equal(delinquanceRateBin(null, thresholds), -1);
  assert.equal(delinquanceRateBin(undefined, thresholds), -1);
  assert.equal(delinquanceRateBin(NaN, thresholds), -1);
  // -1 and 0 are different answers and the layer's fill depends on it: -1 is
  // "no band", 0 is "the lightest band".
  assert.equal(delinquanceRateBin(0.5, thresholds), 0);
  assert.equal(delinquanceRateBin(9, thresholds), 5);
  assert.equal(delinquanceRateBin(1, thresholds), 0);
});

test('a withheld cell is given bin -1 and is counted nowhere in the ramp', () => {
  // Suppression does not occur at this grain today, so it is injected. If the
  // register ever starts withholding a département, the choropleth must NOT
  // paint it and must NOT let it move anyone else's threshold.
  const withheld = PACK.departements.map((row) => (row.code !== '18' ? row : {
    ...row,
    cells: { ...row.cells, cambriolages: [row.cells.cambriolages[0], [CELL_SUPPRESSED]] },
  }));
  const before = national('cambriolages');
  const after = projectDelinquanceNational({
    departements: withheld, years: PACK.years, index: INDEX, indicator: 'cambriolages', year: '2025',
  });

  const cherBefore = before.departements.find((row) => row.code === '18');
  const cherAfter = after.departements.find((row) => row.code === '18');
  assert.equal(cherBefore.state, CELL_PUBLISHED);
  assert.ok(cherBefore.bin >= 0);
  assert.equal(cherAfter.state, CELL_SUPPRESSED);
  assert.equal(cherAfter.bin, -1, 'a withheld département takes no band');
  assert.equal(cherAfter.rate, undefined, 'a withheld cell carries no rate to bin');
  // It is out of `painted` and out of `facts`, so nothing sums it as if it had
  // been measured.
  assert.equal(after.painted, before.painted - 1);
  assert.equal(after.facts, before.facts - cherBefore.count);
  // And its rate is gone from the cut, so the thresholds move — proof the cut
  // was reading published values and only published values.
  assert.notDeepEqual(after.thresholds, before.thresholds);
});

test('a département with no row is absence, not the bottom of the scale', () => {
  const pack = national('cambriolages');
  // The fixture carries 11 of the 96 metropolitan départements, so 85 polygons
  // have no row at all in this edition.
  assert.equal(pack.polygons, 96);
  assert.equal(pack.painted, 11);
  assert.equal(pack.missing, 85);
  assert.equal(pack.painted + pack.zeroed + pack.missing, 96);
  for (const row of pack.departements) {
    if (row.state !== null) continue;
    assert.equal(row.bin, -1, `${row.code} has no row and must take no band`);
    assert.equal(row.count, null);
    assert.equal(row.rate, null);
  }
});

test('a published zero at département grain gets the zero state, never band 0', () => {
  // Ardèche recorded no homicide in 2025 and the register says so.
  const pack = national('homicides');
  const ardeche = pack.departements.find((row) => row.code === '07');
  assert.equal(ardeche.state, CELL_ZERO);
  assert.equal(ardeche.count, 0);
  assert.equal(ardeche.bin, -1);
  assert.equal(pack.zeroed, 1);
  // Haute-Saône published zero armed robberies; Ain published six homicides.
  const armes = national('vols-armes');
  assert.equal(armes.departements.find((row) => row.code === '70').state, CELL_ZERO);
  assert.ok(armes.departements.find((row) => row.code === '01').bin >= 0);
});

test('the five overseas départements are reported, not snapped to a metropolitan outline', () => {
  const pack = national('cambriolages');
  // The nearest metropolitan polygon to Cayenne is 7 000 km away. They come
  // back with their values intact and no geometry, so a card can say the map is
  // 96 of the register's 101 départements.
  assert.deepEqual(pack.unmatched, ['971', '973', '976']);
  assert.deepEqual(pack.offshore.map((row) => row.code), ['971', '973', '976']);
  const guyane = pack.offshore.find((row) => row.code === '973');
  assert.equal(guyane.state, CELL_PUBLISHED);
  assert.equal(guyane.rate, 9.7984592);
  // Guyane is the national leader by rate and would be the top band if it had
  // one — it is deliberately absent from `departements` instead of being drawn
  // somewhere it is not.
  assert.equal(pack.departements.some((row) => row.code === '973'), false);
});

test('the commune census travels with the département it is about', () => {
  // This is what puts the number of withheld communes on the national card
  // without a second request. 4 of the 5 fixture communes in the
  // Bouches-du-Rhône are withheld for `Vols avec armes`.
  const pack = national('vols-armes', {
    communeCensus: { 13: [1, 0, 4], 75: [2, 0, 1] },
  });
  const bdr = pack.departements.find((row) => row.code === '13');
  assert.deepEqual(bdr.communes, { published: 1, zero: 0, suppressed: 4 });
  const paris = pack.departements.find((row) => row.code === '75');
  assert.deepEqual(paris.communes, { published: 2, zero: 0, suppressed: 1 });
  // A département with no census gets null, never a fabricated zero triple.
  assert.equal(pack.departements.find((row) => row.code === '01').communes, null);
  assert.equal(national('vols-armes').departements[0].communes, null);
});

test('the indicator metadata rides on the rollup, denominator included', () => {
  const camb = national('cambriolages');
  assert.equal(camb.indicatorLabel, 'Cambriolages de logement');
  assert.equal(camb.per, 'logements');
  assert.equal(camb.unite, 'Infraction');
  assert.equal(camb.year, '2025');
  const usage = national('usage-stupefiants');
  assert.equal(usage.per, 'habitants');
  assert.equal(usage.unite, 'Mis en cause');
  // An unknown slug does not throw and does not silently draw the last one.
  const nothing = national('not-an-indicator');
  assert.equal(nothing.painted, 0);
  assert.equal(nothing.thresholds.every((bound) => bound === 0), true);
  // A year that is not in the payload paints nothing rather than the newest.
  const wrongYear = national('cambriolages', { year: '1999' });
  assert.equal(wrongYear.painted, 0);
  assert.equal(wrongYear.missing, 96);
});

test('the camera is resolved by point-in-polygon, because Corsica cannot be guessed', () => {
  // Bastia and Ajaccio sit on the same longitudes and only the polygon knows
  // which département each is in; a bbox or centroid shortcut gets both wrong.
  assert.equal(locateDelinquanceDepartement(INDEX, 42.7028, 9.4503), '2B');
  assert.equal(locateDelinquanceDepartement(INDEX, 41.9264, 8.7369), '2A');
  assert.equal(locateDelinquanceDepartement(INDEX, 48.8566, 2.3522), '75');
  assert.equal(locateDelinquanceDepartement(INDEX, 43.2965, 5.3698), '13');
  // Mid-Atlantic is nowhere, and the 2 km coastal snap must not reach it.
  assert.equal(locateDelinquanceDepartement(INDEX, 45, -20), null);
  assert.equal(DELINQUANCE_COAST_SNAP_KM, 2);
  // Cayenne resolves to nothing rather than to the nearest metropolitan
  // outline, which is 7 000 km away.
  assert.equal(locateDelinquanceDepartement(INDEX, 4.9227, -52.3269), null);
});

test('the contour packs a view asks for are capped and ranked by what is on screen', () => {
  const paris = departementsInBox(INDEX, { south: 48.80, north: 48.92, west: 2.25, east: 2.45 }, 6);
  assert.equal(paris.includes('75'), true);
  assert.ok(paris.length <= 6);
  // Ranked by overlap, so a cap keeps what the operator is looking at rather
  // than the first codes in numeric order.
  const wide = departementsInBox(INDEX, { south: 42, north: 51, west: -5, east: 8 }, 6);
  assert.equal(wide.length, 6, 'the cap is what stops a national view fetching 96 packs');
  // A box the camera could not produce asks for nothing at all.
  assert.deepEqual(departementsInBox(INDEX, null, 6), []);
  assert.deepEqual(departementsInBox(INDEX, { south: NaN, north: 1, west: 0, east: 1 }, 6), []);
  assert.equal(departementsInBox(INDEX, { south: 48.8, north: 48.9, west: 2.3, east: 2.4 }, 0).length, 1,
    'a zero cap still returns the département under the camera');
});

test('THE DÉPARTEMENT TOTAL IS EXACT, AND IT IS NOT THE SUM OF THE PUBLISHED RATES', () => {
  const row = PACK.departements.find((entry) => entry.code === '13');
  const slot = PACK.years.indexOf('2025');
  const cell = delinquanceDepartementTotalCell(row, slot);
  assert.equal(cell[0], CELL_PUBLISHED);

  // Counted by hand from the fixture, over the 16 contributors.
  let expected = 0;
  for (const slug of DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS) {
    expected += row.cells[slug][slot][1];
  }
  assert.equal(cell[1], expected);
  assert.equal(cell[3], 0, 'nothing is withheld at this grain');

  // The two decomposition children are in the fixture and are NOT in the sum:
  // adding them would count the stupéfiants family twice over.
  const parent = row.cells['usage-stupefiants'][slot][1];
  const afd = row.cells['usage-stupefiants-afd'][slot][1];
  const horsAfd = row.cells['usage-stupefiants-hors-afd'][slot][1];
  assert.equal(afd + horsAfd, parent, 'the register decomposes it exactly');
  assert.ok(afd > 0 && horsAfd > 0, 'both children carry real values here');
  let naive = 0;
  for (const slug of Object.keys(row.cells)) naive += row.cells[slug][slot]?.[1] || 0;
  assert.equal(naive - cell[1], parent, 'the naive sum overshoots by exactly the family');

  // And the rate is recomputed on the population, never assembled from the
  // published `taux_pour_mille` — which are on two different denominators.
  assert.equal(cell[2], (cell[1] / row.pop) * 1000);
  let summedRates = 0;
  for (const slug of DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS) {
    summedRates += row.cells[slug][slot][2];
  }
  assert.notEqual(Number(cell[2].toFixed(6)), Number(summedRates.toFixed(6)),
    'burglaries are per 1 000 dwellings upstream, so the two disagree');
});

test('the national projection paints the total on its own quantile ramp', () => {
  const rollup = national(DELINQUANCE_TOTAL_SLUG);
  assert.equal(rollup.indicator, DELINQUANCE_TOTAL_SLUG);
  assert.equal(rollup.per, 'habitants');
  assert.equal(rollup.thresholds.length, DELINQUANCE_DEPARTEMENT_BINS - 1);
  const painted = rollup.departements.filter((row) => row.state === CELL_PUBLISHED);
  assert.ok(painted.length > 0);
  for (const row of painted) {
    assert.ok(row.bin >= 0 && row.bin < DELINQUANCE_DEPARTEMENT_BINS);
    assert.ok(row.count > 0);
    // Every painted total is at least as large as any single indicator's count
    // in the same département — it is a sum of that one and fifteen others.
    const source = PACK.departements.find((entry) => entry.code === row.code);
    const slot = PACK.years.indexOf('2025');
    for (const slug of DELINQUANCE_TOTAL_DEPARTEMENT_SLUGS) {
      assert.ok(row.count >= (source.cells[slug][slot]?.[1] || 0));
    }
  }
  // A département with no row at all stays absent rather than becoming a zero.
  assert.equal(delinquanceDepartementTotalCell(null, 0), null);
  assert.equal(delinquanceDepartementTotalCell({ cells: {} }, 0), null);
});
