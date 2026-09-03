// src/data/filosofiTerritoiresFeed.test.mjs
// Pins the national regime against a captured Melodi answer — four départements
// chosen to be awkward: Gironde (ordinary), Paris (the top of every scale), the
// Cantal (the bottom of the population one) and La Réunion (in the figures, and
// the only one with no bundled outline).
//
// The fixture is kept in the API's OWN shape, including the geographic vintage
// it silently normalises to — `2026-DEP-33` was asked for and `2025-DEP-33`
// comes back on one of the three datasets. That normalisation is exactly what
// the parser has to survive, so faking it away would test the wrong thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEPARTEMENT_CODES,
  MELODI_DATASETS,
  REGION_CODES,
  TERRITORY_DISC_PX,
  TERRITORY_LEVELS,
  TERRITORY_METRICS,
  TERRITORY_RAMPS,
  TERRITORY_SIZE_BREAKS,
  TERRITORY_VINTAGE,
  buildTerritoryUrls,
  codesForLevel,
  foldTerritoryObservations,
  levelForBox,
  resolveTerritoryMetric,
  summarizeTerritories,
  territoryBand,
  territoryCode,
  territoryColor,
  territoryDiscPx,
} from './filosofiTerritoiresFeed.js';

const SAMPLE = JSON.parse(
  readFileSync(new URL('./fixtures/filosofi-territoires-sample.json', import.meta.url), 'utf8'),
);
const folded = () => foldTerritoryObservations(SAMPLE);

// ── Reading INSEE's answer ──────────────────────────────────────────────────

test('the territory code is read off the answer, not off what was asked for', () => {
  // Melodi normalises the geographic vintage: ask for 2026, get 2025 on one of
  // the three datasets. Assuming the echo would silently drop a third of the
  // columns for every territory.
  assert.equal(territoryCode('2026-DEP-33'), '33');
  assert.equal(territoryCode('2025-DEP-33'), '33');
  assert.equal(territoryCode('2026-REG-11'), '11');
  assert.equal(territoryCode('2026-DEP-2A'), '2A', 'Corsica is not a number');
  assert.equal(territoryCode(''), null);
  assert.equal(territoryCode(null), null);

  // And the fixture really does carry two different vintages, or the test above
  // is proving nothing.
  const vintages = new Set([
    ...SAMPLE.filosofi.observations.map((o) => String(o.dimensions.GEO).split('-')[0]),
    ...SAMPLE.population.observations.map((o) => String(o.dimensions.GEO).split('-')[0]),
  ]);
  assert.ok(vintages.size > 1, 'the fixture must contain the normalisation it exists to prove');
});

test('three datasets fold into one row per territory', () => {
  const rows = folded();
  assert.deepEqual([...rows.keys()].sort(), ['15', '33', '75', '974']);
  const gironde = rows.get('33');
  assert.equal(gironde.niveau, 26_820, 'MED_SL is the median standard of living');
  assert.equal(gironde.pauvrete, 14.2);
  assert.equal(gironde.gini, 0.282);
  assert.equal(gironde.interdecile, 3.4);
  assert.equal(gironde.population, 1_690_493);
  // Every value carries the year it belongs to, because the three publishers do
  // not agree about the year and a card that dropped it would invite a
  // comparison that does not hold.
  assert.equal(gironde.filosofiYear, TERRITORY_VINTAGE.filosofi);
  assert.equal(gironde.populationYear, TERRITORY_VINTAGE.population);
});

test('the wage series carries several years and the newest one wins', () => {
  // The fixture holds 2023 AND 2024 for every territory. Taking the first row
  // would have shipped whichever order INSEE happened to serialise.
  const years = new Set(SAMPLE.wages.observations.map((o) => o.dimensions.TIME_PERIOD));
  assert.ok(years.has('2023') && years.has('2024'), 'the fixture must contain both');
  const gironde = folded().get('33');
  assert.equal(gironde.salaireYear, 2024);
  assert.equal(gironde.salaire, 2_584);
});

test('PTOT and PCAP are ignored: only the population municipale is the population', () => {
  // The census answers three counts per territory. PTOT adds people counted
  // apart and PCAP is only that supplement; a parser that summed them would
  // publish a France of 70 million.
  const measures = new Set(SAMPLE.population.observations.map((o) => o.dimensions.POPREF_MEASURE));
  assert.ok(measures.has('PTOT') && measures.has('PCAP'), 'the fixture must contain the decoys');
  const paris = folded().get('75');
  assert.equal(paris.population, 2_103_778, 'PMUN, not PTOT (2 119 412)');
});

test('a dataset that failed leaves a row without its column, never a wrong one', () => {
  // The proxy returns what it got: one of the three can time out and the
  // national view is still a national view. What must not happen is a zero
  // standing in for a figure nobody published.
  const rows = foldTerritoryObservations({ filosofi: SAMPLE.filosofi, population: null, wages: null });
  const gironde = rows.get('33');
  assert.equal(gironde.niveau, 26_820);
  assert.equal(gironde.population, undefined, 'absent, not 0');
  assert.equal(gironde.salaire, undefined);
  assert.deepEqual(foldTerritoryObservations({}), new Map());
  assert.deepEqual(foldTerritoryObservations(), new Map());
});

// ── Which level a viewport gets ─────────────────────────────────────────────

test('the widest views get régions, the country gets départements', () => {
  // Measured against the layer's own boxes in a browser on 2026-09-03: a camera
  // at 900 km over France reports 6.03° × 14.86° and one at 1 150 km reports
  // 7.76° × 19.50°.
  assert.equal(levelForBox({ south: 43.6, north: 49.6, west: 2.4 - 7.4, east: 2.4 + 7.4 }), 'DEP');
  assert.equal(levelForBox({ south: 42.7, north: 50.5, west: 2.4 - 9.8, east: 2.4 + 9.8 }), 'REG');
  // No view at all is the widest thing there is.
  assert.equal(levelForBox(null), 'REG');
  assert.equal(TERRITORY_LEVELS.REG.maxBoxDeg, Infinity, 'something must always answer');
});

// ── The request ─────────────────────────────────────────────────────────────

test('every territory is named in the URL, because Melodi has no "all of them"', () => {
  // `GEO_TYPE=DEP` is an HTTP 400 — "La DSD ne possède pas le composant
  // GEO_TYPE", measured 2026-09-03 — so the codes have to be listed.
  const urls = buildTerritoryUrls('DEP');
  assert.equal(codesForLevel('DEP').length, 97);
  assert.equal(codesForLevel('REG').length, 14);
  assert.ok(DEPARTEMENT_CODES.includes('2A') && DEPARTEMENT_CODES.includes('2B'));
  assert.ok(DEPARTEMENT_CODES.includes('974'), 'La Réunion is in scope');
  for (const dom of ['971', '972', '973', '976']) {
    assert.ok(!DEPARTEMENT_CODES.includes(dom), `${dom} has no Filosofi CC figures`);
  }
  assert.ok(!REGION_CODES.includes('01'), 'Guadeloupe as a région is out of scope too');
  for (const code of DEPARTEMENT_CODES) {
    assert.ok(urls.filosofi.includes(`GEO=2026-DEP-${code}`), `${code} must be asked for`);
  }
  assert.ok(urls.filosofi.includes(MELODI_DATASETS.filosofi));
  assert.ok(urls.population.includes(MELODI_DATASETS.population));
  // The wage dataset answers 36 rows per territory without these two: every
  // sex crossed with every age band. `_T` is the total.
  assert.ok(urls.wages.includes('SEX=_T') && urls.wages.includes('AGE=_T'));
});

// ── The two scales ──────────────────────────────────────────────────────────

test('the colour bands are the territory ones, not the carroyage ones', () => {
  // The whole reason they exist: every département in France sits inside a
  // 10 000 € window, and the carroyage's ramp is twice as wide. Borrowing it
  // would paint the country in two bands.
  const breaks = TERRITORY_RAMPS.niveau;
  assert.equal(breaks.length, 5, 'five breaks make six bands');
  assert.ok(breaks[0] > 20_000 && breaks.at(-1) < 30_000, 'a département ramp is a narrow one');
  for (let i = 1; i < breaks.length; i += 1) assert.ok(breaks[i] > breaks[i - 1]);

  const niveau = resolveTerritoryMetric('niveau');
  const rows = folded();
  // Paris (33 650 €) is above the top break; the Cantal (24 820 €) is not.
  assert.equal(territoryBand(rows.get('75').niveau, niveau), 5);
  assert.ok(territoryBand(rows.get('15').niveau, niveau) < 5);
  assert.equal(territoryBand(null, niveau), -1, 'nothing to band is not band zero');
  assert.equal(territoryColor({ niveau: null }, niveau), null);
  assert.equal(typeof territoryColor(rows.get('33'), niveau), 'string');
});

test('a région and its départements are coloured on ONE scale', () => {
  // Crossing the zoom threshold changes the resolution, not the subject. Two
  // ramps would have recoloured the country on a camera move.
  const niveau = resolveTerritoryMetric('niveau');
  const value = 26_000;
  assert.equal(territoryBand(value, niveau, 'DEP'), territoryBand(value, niveau, 'REG'));
});

test('the size scale is per level, because the two populations are an order apart', () => {
  // A median département holds about a million people and a median région six.
  // One scale would have drawn every département at the floor.
  assert.ok(TERRITORY_SIZE_BREAKS.REG[0] > TERRITORY_SIZE_BREAKS.DEP.at(-1));
  const cantal = { population: 144_196 };
  const paris = { population: 2_103_778 };
  assert.equal(territoryDiscPx(cantal, 'DEP'), TERRITORY_DISC_PX.min);
  assert.equal(territoryDiscPx(paris, 'DEP'), TERRITORY_DISC_PX.max);
  // The same département inside the région scale is a speck, which is why the
  // level has to travel with the row.
  assert.equal(territoryDiscPx(paris, 'REG'), TERRITORY_DISC_PX.min);
  assert.equal(territoryDiscPx({ population: null }, 'DEP'), 0, 'no count, no symbol');
  assert.equal(territoryDiscPx({}, 'DEP'), 0);
});

test('size is the population whatever is being coloured', () => {
  // The carroyage's rule, one level up: the disc is the count every one of
  // these indicators was computed on, and it is the only one that adds up.
  const rows = folded();
  const gironde = rows.get('33');
  const forNiveau = territoryDiscPx(gironde, 'DEP');
  assert.equal(territoryDiscPx({ ...gironde, gini: 0.9 }, 'DEP'), forNiveau);
  assert.equal(territoryDiscPx({ ...gironde, pauvrete: 40 }, 'DEP'), forNiveau);
});

// ── The indicators ──────────────────────────────────────────────────────────

test('a carroyage chip resolves to its territorial counterpart, and the rest fall back', () => {
  // Crossing the threshold keeps the operator's choice where the two regimes
  // have one, rather than lighting a chip that draws something else.
  assert.equal(resolveTerritoryMetric('niveau').id, 'niveau');
  assert.equal(resolveTerritoryMetric('pauvrete').id, 'pauvrete');
  assert.equal(resolveTerritoryMetric('population').id, 'population');
  // These four exist only at the carreau. There is no national logement social
  // in this dataset, so the layer says median standard of living rather than
  // drawing something else under the chip that is lit.
  for (const orphan of ['social', 'jeunes', 'aines', 'proprietaires', 'solo']) {
    assert.equal(resolveTerritoryMetric(orphan).id, 'niveau');
  }
  assert.equal(resolveTerritoryMetric(null).id, 'niveau');
  assert.equal(resolveTerritoryMetric('gini').id, 'gini', 'and two exist only here');
  assert.equal(resolveTerritoryMetric('interdecile').id, 'interdecile');
});

test('every indicator states its unit AND its year', () => {
  // Three publishers, three millésimes. A number without its year invites
  // arithmetic that does not hold.
  const years = new Set();
  for (const metric of TERRITORY_METRICS) {
    assert.ok(metric.unit && metric.unit.length > 2, `${metric.id} must state its unit`);
    assert.ok(Number.isFinite(metric.year), `${metric.id} must state its year`);
    assert.ok(metric.blurb.length > 20, `${metric.id} must explain itself`);
    years.add(metric.year);
  }
  assert.ok(years.size > 1, 'the years really do differ — that is the point');
  const salaire = TERRITORY_METRICS.find((m) => m.id === 'salaire');
  // The one indicator most likely to be misread as a standard of living says
  // so itself, in the tooltip an operator actually sees.
  assert.match(salaire.blurb, /pas un niveau de vie/i);
  assert.match(salaire.blurb, /priv/i);
  const niveau = TERRITORY_METRICS.find((m) => m.id === 'niveau');
  assert.match(niveau.blurb, /MOYENNE/, 'and the median says how it differs from the grid');
});

// ── The summary ─────────────────────────────────────────────────────────────

test('the national summary is population-weighted, not territory-weighted', () => {
  const rows = [...folded().values()];
  const summary = summarizeTerritories(rows);
  assert.equal(summary.territories, 4);
  assert.equal(summary.people, rows.reduce((sum, r) => sum + r.population, 0));
  // Weighted: Paris and Gironde carry the mean, not the Cantal. The unweighted
  // mean of these four is 27 320 €.
  const unweighted = Math.round(rows.reduce((s, r) => s + r.niveau, 0) / rows.length);
  assert.notEqual(summary.niveau, unweighted);
  assert.ok(summary.niveau > 26_000 && summary.niveau < 31_000);
  assert.equal(summary.withoutFigures, 0);
  assert.equal(summarizeTerritories([]).niveau, null, 'the summary of nothing is not zero');
  assert.equal(summarizeTerritories(undefined).territories, 0);
});
