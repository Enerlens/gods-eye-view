// src/data/avisValeurFeed.test.mjs
//
// What is pinned here is the honesty of an ESTIMATE, which is a different job
// from pinning a projection: nothing upstream can be compared against, because
// there is no upstream — the number is ours. So the tests fall in three groups.
//
// 1. THE ARITHMETIC IS THE ONE IT CLAIMS. The interval on the median is the
//    classical distribution-free one; the rank table is checked against the
//    binomial by hand, the floor of five is shown to be derived rather than
//    chosen, and the interval is RESAMPLED from the fixture's own prices to
//    show its empirical coverage matches its nominal coverage. An interval
//    that is merely asserted is a decoration.
//
// 2. EVERY REFUSAL IS REACHABLE, AND SAYS WHICH ONE IT IS. Both clauses of the
//    gate on the centre, the floor, the empty commune, and the départements the
//    register does not cover — five different silences, five different
//    sentences (A1).
//
// 3. EVERY EXCLUSION IS PROVEN ON A REAL ROW THAT WOULD OTHERWISE HAVE BEEN
//    TAKEN. The VEFA 180 m away and inside the surface band, the 88 m² flat
//    declared at one euro, the 69 m² flat with no coordinate: each is in the
//    fixture because the ladder would have retained it, and each has to come
//    out counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupMutations, parseDvfCsv, percentile } from './dvfFeed.js';
import {
  AVIS_DEFAULT_SURFACE,
  AVIS_DRIFT_MIN_PER_YEAR,
  AVIS_MAX_CI_DEVIATION,
  AVIS_MAX_SERVED,
  AVIS_MIN_COMPARABLES,
  AVIS_RUNGS,
  AVIS_SUBJECT_SURFACES,
  centreVerdict,
  ciDeviationPct,
  communeDrift,
  comparablePool,
  medianCi,
  medianCiRank,
  parseAvisSubject,
  projectAvisValeur,
  roundValeur,
  walkLadder,
} from './avisValeurFeed.js';

const PARIS_FIXTURE = new URL('./fixtures/dvf-75113-avis-250m-sample.csv', import.meta.url);
const LOZERE_FIXTURE = new URL('./fixtures/dvf-48012-avis-sample.csv', import.meta.url);

/** The point the Paris fixture was cut around — avenue de France, Paris 13e. */
const PARIS_POINT = Object.freeze({ lon: 2.3735, lat: 48.83 });
const PARIS = Object.freeze({ code: '75113', name: 'Paris 13e Arrondissement' });
const MONTS_VERTS = Object.freeze({ code: '48012', name: 'Les Monts-Verts' });

const parisMutations = groupMutations(parseDvfCsv(readFileSync(PARIS_FIXTURE, 'utf8')));
const lozereMutations = groupMutations(parseDvfCsv(readFileSync(LOZERE_FIXTURE, 'utf8')));

/** Centre of the Lozère fixture's own sales — the commune has no obvious door. */
const LOZERE_POINT = (() => {
  const placed = lozereMutations.filter((mutation) => mutation.lon !== null);
  return {
    lon: placed.reduce((sum, m) => sum + m.lon, 0) / placed.length,
    lat: placed.reduce((sum, m) => sum + m.lat, 0) / placed.length,
  };
})();

function paris(subject) {
  return projectAvisValeur({
    mutations: parisMutations,
    subject: { ...PARIS_POINT, ...subject },
    commune: PARIS,
    years: [2025, 2024],
  });
}

/* ── 1. the arithmetic ────────────────────────────────────────────────────── */

test('the floor of five is derived: at four sales no 90 % interval exists at all', () => {
  assert.equal(medianCiRank(4), null);
  assert.equal(medianCiRank(3), null);
  const five = medianCiRank(5);
  assert.equal(five.k, 1);
  // [x0, x4] is the whole sample; 1 - 2·P(Bin(5,½) = 0) = 1 - 2/32.
  assert.equal(Math.round(five.coverage * 10000) / 10000, 0.9375);
  assert.equal(AVIS_MIN_COMPARABLES, 5);
});

test('the rank table matches the binomial, term by term', () => {
  // Hand-computed from P(Bin(n, ½) ≤ k-1) ≤ 0.05, with the coverage it buys.
  const expected = [
    [6, 1, 0.96875], [8, 2, 0.9296875], [10, 2, 0.9785156],
    [12, 3, 0.9614258], [20, 6, 0.9586105], [30, 11, 0.9012629],
    [50, 19, 0.9350914],
  ];
  for (const [n, k, coverage] of expected) {
    const rank = medianCiRank(n);
    assert.equal(rank.k, k, `k for n=${n}`);
    assert.equal(Math.round(rank.coverage * 1e7) / 1e7, coverage, `coverage for n=${n}`);
  }
});

test('a Paris commune rung does not overflow the binomial tail', () => {
  // 2 ** 1024 is Infinity. A naive tail returns either the whole sample or a
  // two-element interval; both are wrong and neither throws.
  const rank = medianCiRank(1802);
  assert.equal(rank.k, 866);
  assert.ok(rank.coverage > 0.9 && rank.coverage < 0.92, `coverage ${rank.coverage}`);
  const sorted = Array.from({ length: 1802 }, (_, i) => i + 1);
  const interval = medianCi(sorted);
  assert.equal(interval.lo, 866);
  assert.equal(interval.hi, 937);
});

test('the interval covers the median as often as it promises, on real prices', () => {
  // Resampled from the fixture's own flat prices. A deterministic LCG, so a
  // failure here is a change in the arithmetic and never a change in the seed.
  const pool = comparablePool(parisMutations, { type: 'Appartement' }).pool
    .map((mutation) => mutation.prixM2);
  const truth = percentile([...pool].sort((a, b) => a - b), 0.5);
  let seed = 20260908;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const n of [5, 8, 12, 30]) {
    const rank = medianCiRank(n);
    let covered = 0;
    const trials = 1500;
    for (let t = 0; t < trials; t += 1) {
      // WITH replacement, because the interval's promise is about independent
      // draws. Sampling 30 of the fixture's 131 prices without replacement
      // takes a quarter of the population each time and lands the sample median
      // on the truth far more often than i.i.d. sampling would — measured, 95.0 %
      // where the binomial says 90.1 %. That is a finite-population effect, not
      // a calibrated interval, and testing against it would flatter the code.
      const draw = [];
      for (let i = 0; i < n; i += 1) draw.push(pool[Math.floor(next() * pool.length)]);
      draw.sort((a, b) => a - b);
      if (truth >= draw[rank.k - 1] && truth <= draw[n - rank.k]) covered += 1;
    }
    const empirical = covered / trials;
    // Within four points of nominal, which is three standard errors of a
    // 1 500-trial estimate plus the slack a 131-price bag deserves. On the live
    // 4 192-sale Paris 13e population the gap measures under one point.
    assert.ok(Math.abs(empirical - rank.coverage) < 0.04,
      `n=${n}: nominal ${rank.coverage.toFixed(3)}, empirical ${empirical.toFixed(3)}`);
  }
});

test('a value is never printed to more precision than its interval carries', () => {
  assert.equal(roundValeur(520_920), 521_000);
  assert.equal(roundValeur(1_234_567), 1_230_000);
  assert.equal(roundValeur(0), null);
  assert.equal(roundValeur(Number.NaN), null);
  assert.equal(roundValeur(-1), null);
});

test('a positive total never rounds away to nothing', () => {
  // A flat 1 000 € step turned every positive amount under 500 € into « 0 € »:
  // twenty retained sales at 1 €/m² over a 60 m² subject published a median,
  // two quartiles and both interval bounds all reading zero. Those prices are
  // deliberately kept (see the header on the low tail), so the ROUNDING had to
  // give way, not the data.
  for (const value of [1, 7, 30, 60, 499, 4_950]) {
    assert.ok(roundValeur(value) > 0, `${value} rounds to ${roundValeur(value)}`);
  }
  assert.equal(roundValeur(60), 60);
  assert.equal(roundValeur(4_950), 4_950);
  // And the precision still tops out at three figures where it matters.
  assert.equal(String(roundValeur(8_765_432)).replace(/0+$/, '').length <= 3, true);
});

/* ── 2. the gate, and the five silences ───────────────────────────────────── */

test('the gate names the clause that withheld the centre', () => {
  // Clause 1: the interval on the median is not narrower than the market's own
  // spread.
  assert.deepEqual(
    centreVerdict({ median: 4000, p25: 3800, p75: 4200, ci90: { lo: 3000, hi: 5000 } }),
    { publish: false, reason: 'centre-softer-than-market' },
  );
  // Clause 2: the market is wide enough to pass clause 1 and the interval is
  // still a third of the answer.
  assert.deepEqual(
    centreVerdict({ median: 1000, p25: 200, p75: 2000, ci90: { lo: 700, hi: 1400 } }),
    { publish: false, reason: 'interval-too-wide' },
  );
  assert.deepEqual(
    centreVerdict({ median: 8107, p25: 7703, p75: 8512, ci90: { lo: 7969, hi: 8359 } }),
    { publish: true, reason: null },
  );
  // No sample at all is its own reason, never one of the two clauses.
  assert.equal(centreVerdict({ median: null, p25: null, p75: null, ci90: null }).reason,
    'sample-too-small');
});

test('a sample with no spread at all is a certainty, and is refused as one', () => {
  // Twelve identical prices: interquartile range 0, interval width 0. A strict
  // `width > iqr` published « 1 000 €/m², ±0 % » with 96 % confidence attached.
  assert.deepEqual(
    centreVerdict({ median: 1000, p25: 1000, p75: 1000, ci90: { lo: 1000, hi: 1000 } }),
    { publish: false, reason: 'centre-softer-than-market' },
  );
  // Its near neighbour: eleven at one price and one somewhere else.
  assert.equal(
    centreVerdict({ median: 1000, p25: 1000, p75: 1000, ci90: { lo: 1000, hi: 1200 } }).reason,
    'centre-softer-than-market',
  );
});

test('clause 2 measures the FURTHER endpoint, not half the width', () => {
  // 600 × 6, 1 000 × 10, 1 400 × 4: median 1 000, interval [600, 1 000]. Half
  // the width is 20 % of the median and the lower bound is 40 % below it.
  const asymmetric = { median: 1000, p25: 600, p75: 1400, ci90: { lo: 600, hi: 1000 } };
  assert.equal(centreVerdict(asymmetric).reason, 'interval-too-wide');
  assert.deepEqual(ciDeviationPct(1000, { lo: 600, hi: 1000 }), { low: 40, high: 0, max: 40 });

  const median = 1000;
  const edge = AVIS_MAX_CI_DEVIATION * median;
  assert.equal(centreVerdict({
    median, p25: 0, p75: 1e6, ci90: { lo: median - edge, hi: median + edge },
  }).publish, true);
  assert.equal(centreVerdict({
    median, p25: 0, p75: 1e6, ci90: { lo: median - edge - 1, hi: median + edge },
  }).reason, 'interval-too-wide');
  assert.equal(ciDeviationPct(null, { lo: 1, hi: 2 }), null);
});

test('an answer, a band without a centre, and nothing at all are three sentences', () => {
  const answer = paris({ type: 'Appartement', surfaceM2: 60 });
  assert.equal(answer.estimate.basis, 'comparables');
  assert.ok(answer.estimate.prixM2.median > 0);
  assert.equal(answer.estimate.prixM2.withheldMedian, null);

  // 150 m² flats are rare enough here that the ladder runs out of rungs.
  const band = paris({ type: 'Appartement', surfaceM2: 150 });
  assert.equal(band.estimate.basis, 'range');
  assert.equal(band.estimate.prixM2.median, null, 'no centre is published');
  assert.ok(band.estimate.prixM2.withheldMedian > 0, 'and the withheld one is named');
  assert.ok(band.estimate.prixM2.p25 > 0 && band.estimate.prixM2.p75 > 0, 'the band survives');
  assert.equal(band.estimate.valeur.median, null);
  assert.ok(band.estimate.valeur.p75 > band.estimate.valeur.p25);

  // There is no house on this block, in this commune, in these editions.
  const nothing = paris({ type: 'Maison', surfaceM2: 100 });
  assert.equal(nothing.estimate.basis, 'none');
  assert.equal(nothing.estimate.reason, 'no-comparable');
  assert.equal(nothing.estimate.prixM2, null);
  assert.equal(nothing.estimate.valeur, null);
});

test('"the register does not reach here" is not "no sale was found"', () => {
  const alsace = projectAvisValeur({
    mutations: [],
    subject: { lon: 7.75, lat: 48.58, type: 'Appartement', surfaceM2: 60 },
    commune: { code: '67482', name: 'Strasbourg' },
    years: [2025],
  });
  assert.equal(alsace.coverage.basis, 'livre-foncier');
  assert.equal(alsace.estimate.basis, 'none');
  assert.equal(alsace.estimate.reason, 'register-does-not-cover');

  const empty = projectAvisValeur({
    mutations: [],
    subject: { lon: 2.35, lat: 48.85, type: 'Appartement', surfaceM2: 60 },
    commune: PARIS,
    years: [2025],
  });
  assert.equal(empty.coverage.basis, 'dvf');
  assert.equal(empty.estimate.reason, 'no-comparable');
});

test('a subject outside its closed set is refused, never snapped to a neighbour', () => {
  assert.throws(() => parseAvisSubject({ type: 'Local commercial', surface: 60 }), /type/);
  assert.throws(() => parseAvisSubject({ type: 'Appartement', surface: 47 }), /surface/);
  assert.throws(() => parseAvisSubject({ type: 'Appartement', surface: '60; DROP' }), /surface/);
  assert.deepEqual(parseAvisSubject({ type: undefined, surface: undefined }),
    { type: 'Appartement', surfaceM2: AVIS_DEFAULT_SURFACE });
  assert.deepEqual(parseAvisSubject({ type: 'Maison', surface: '100' }),
    { type: 'Maison', surfaceM2: 100 });
  assert.ok(AVIS_SUBJECT_SURFACES.includes(AVIS_DEFAULT_SURFACE));
});

/* ── 3. the ladder, and the exclusions ────────────────────────────────────── */

test('the ladder stops at the first rung it may publish, and reports the ones it tried', () => {
  const answer = paris({ type: 'Appartement', surfaceM2: 60 });
  assert.equal(answer.estimate.rung.id, 'block');
  assert.equal(answer.estimate.rung.radiusM, 300);
  // Stopping means not walking on: the report holds exactly the rungs tried.
  assert.equal(answer.estimate.tried.length, 1);
  assert.equal(answer.estimate.tried[0].reason, null);

  const wide = paris({ type: 'Appartement', surfaceM2: 150 });
  assert.equal(wide.estimate.tried.length, AVIS_RUNGS.length, 'every rung is named');
  assert.deepEqual(wide.estimate.tried.map((rung) => rung.id), AVIS_RUNGS.map((rung) => rung.id));
  for (const rung of wide.estimate.tried) assert.ok(rung.reason, `${rung.id} says why it failed`);
  assert.ok(wide.estimate.tried.some((rung) => rung.reason === 'below-floor'));
});

test('a rung is rejected on the gate, not only on the count', () => {
  const wide = paris({ type: 'Appartement', surfaceM2: 150 });
  const last = wide.estimate.tried.at(-1);
  assert.ok(last.count >= AVIS_MIN_COMPARABLES, 'the floor was cleared');
  assert.equal(last.reason, 'centre-softer-than-market', 'and the gate still refused');
});

test('a VEFA the block rung would have taken is excluded, and counted', () => {
  // 2021-1718868 — 57 m² at 7 632 €/m², 180 m from the point: inside the first
  // rung's radius and inside its ±20 % band around 60 m². It is BELOW the local
  // median, so excluding it is not a way of making the answer look richer.
  const vefa = parisMutations.find((mutation) => mutation.id === '2021-1718868');
  assert.equal(vefa.nature, "Vente en l'état futur d'achèvement");
  assert.equal(vefa.dwellingSurface, 57);
  assert.equal(vefa.prixM2, 7632);

  const answer = paris({ type: 'Appartement', surfaceM2: 60 });
  assert.ok(answer.estimate.prixM2.median > vefa.prixM2, 'it would have pulled the answer down');
  assert.equal(answer.excluded.vefa, 2);
  assert.ok(!answer.comparables.some((sale) => sale.id === vefa.id));

  const { pool } = comparablePool(parisMutations, { type: 'Appartement' });
  assert.ok(!pool.some((mutation) => mutation.nature !== 'Vente'));
});

test('the flat declared at one euro never becomes a free comparable', () => {
  // 2024-1222991 — 88 m², `valeur_fonciere` 1. round(1/88) is 0, and 0 is a
  // number: every guard upstream passes it through.
  const euro = parisMutations.find((mutation) => mutation.id === '2024-1222991');
  assert.equal(euro.valeur, 1);
  assert.equal(euro.prixM2, 0, 'the register hands us a zero, not a null');

  const answer = paris({ type: 'Appartement', surfaceM2: 100 });
  assert.equal(answer.excluded.zeroPrice, 1);
  assert.ok(!answer.comparables.some((sale) => sale.id === euro.id));
  assert.ok(answer.estimate.prixM2.p25 > 1000, 'and no quartile fell through the floor');
});

test('a priced sale with no coordinate is counted, not placed at nowhere', () => {
  // 2024-1213795 — 69 m² at 10 464 €/m², no longitude and no latitude. Inside
  // the ±20 % band around 60 m²; it can never be tested against a radius.
  const unplaced = parisMutations.find((mutation) => mutation.id === '2024-1213795');
  assert.equal(unplaced.lon, null);
  assert.equal(unplaced.prixM2, 10464);

  const answer = paris({ type: 'Appartement', surfaceM2: 60 });
  assert.equal(answer.excluded.unplaced, 1);
  assert.ok(!answer.comparables.some((sale) => sale.id === unplaced.id));
});

test('every mutation of the editions lands in exactly one bucket', () => {
  const subject = { ...PARIS_POINT, type: 'Appartement', surfaceM2: 60 };
  const { pool, excluded } = comparablePool(parisMutations, subject);
  const total = pool.length + Object.values(excluded).reduce((sum, n) => sum + n, 0);
  assert.equal(total, parisMutations.length);
});

test('the widest rung that reached the floor is the one a range is published from', () => {
  const answer = projectAvisValeur({
    mutations: lozereMutations,
    subject: { ...LOZERE_POINT, type: 'Maison', surfaceM2: 100 },
    commune: MONTS_VERTS,
    years: [2025, 2024, 2023],
  });
  assert.equal(answer.estimate.basis, 'range');
  assert.equal(answer.estimate.rung.id, 'commune-wide-band');
  const floorClearing = answer.estimate.tried.filter((rung) => rung.count >= AVIS_MIN_COMPARABLES);
  assert.equal(floorClearing.at(-1).id, answer.estimate.rung.id);
  // A house carries its plot, and nothing here normalises it — so the plot is
  // reported rather than silently folded into the €/m².
  assert.ok(answer.estimate.terrainMedian > 0);
});

test('the plot median is a house question and is not invented for a flat', () => {
  assert.equal(paris({ type: 'Appartement', surfaceM2: 60 }).estimate.terrainMedian, null);
});

/* ── the drift: measured, printed, never applied ──────────────────────────── */

test('the drift is read off the commune and refuses a thin edition', () => {
  const drift = communeDrift(parisMutations, 'Appartement');
  assert.equal(drift.basis, 'commune-year');
  for (const year of drift.perYear) {
    if (year.comparableCount < AVIS_DRIFT_MIN_PER_YEAR) {
      assert.equal(year.medianPrixM2, null, `${year.year} is too thin to quote`);
    } else {
      assert.ok(year.medianPrixM2 > 0);
    }
  }
  const thin = communeDrift(lozereMutations, 'Maison');
  assert.equal(thin.basis, 'none');
  assert.equal(thin.pct, null);
  assert.ok(thin.perYear.length > 0, 'the counts are still published');
});

test('the drift never touches the estimate — it is reported beside it', () => {
  const withDrift = paris({ type: 'Appartement', surfaceM2: 60 });
  // Same sales, dates moved into one edition: the drift block changes, the
  // price does not, because nothing here is restated in another year's money.
  const flattened = parisMutations.map((mutation) => ({
    ...mutation,
    date: mutation.date ? `2025${mutation.date.slice(4)}` : mutation.date,
  }));
  const flat = projectAvisValeur({
    mutations: flattened,
    subject: { ...PARIS_POINT, type: 'Appartement', surfaceM2: 60 },
    commune: PARIS,
    years: [2025, 2024],
  });
  assert.notDeepEqual(withDrift.drift.perYear, flat.drift.perYear);
  assert.equal(flat.estimate.prixM2.median, withDrift.estimate.prixM2.median);
  assert.deepEqual(flat.estimate.prixM2.ci90, withDrift.estimate.prixM2.ci90);
});

/* ── what travels ─────────────────────────────────────────────────────────── */

test('the served comparables are capped nearest-first, and the gap is declared', () => {
  // The fixture is a 250 m disc and never reaches the cap, so the cap is driven
  // with sales cloned off a real one: what is under test is the arithmetic of
  // the ceiling, not the shape of the register.
  const seed = comparablePool(parisMutations, { type: 'Appartement' }).pool[0];
  const many = Array.from({ length: AVIS_MAX_SERVED + 40 }, (_, i) => ({
    ...seed,
    id: `clone-${i}`,
    // Spread along a meridian so the distance order is the clone order.
    lat: PARIS_POINT.lat + i * 1e-5,
    lon: PARIS_POINT.lon,
    dwellingSurface: 60,
    prixM2: 8000 + i,
  }));
  const answer = projectAvisValeur({
    mutations: many,
    subject: { ...PARIS_POINT, type: 'Appartement', surfaceM2: 60 },
    commune: PARIS,
    years: [2025],
  });
  assert.equal(answer.served, AVIS_MAX_SERVED);
  assert.equal(answer.truncated, true);
  // The statistics are computed over ALL of them, not over what travelled.
  assert.equal(answer.estimate.count, many.length);
  assert.equal(answer.comparables[0].id, 'clone-0', 'nearest first');
});

test('a comparable travels with everything a reader needs to check it', () => {
  const [sale] = paris({ type: 'Appartement', surfaceM2: 60 }).comparables;
  for (const key of ['id', 'lon', 'lat', 'date', 'prixM2', 'surface', 'distanceM']) {
    assert.ok(sale[key] !== undefined && sale[key] !== null, `comparable carries ${key}`);
  }
});

test('the ladder never leaks a mutation from outside its own reach', () => {
  const { pool } = comparablePool(parisMutations, { type: 'Appartement' });
  const answer = walkLadder(pool, { ...PARIS_POINT, type: 'Appartement', surfaceM2: 60 });
  for (const sale of answer.kept) {
    assert.ok(sale.distanceM <= answer.rung.radiusM);
    assert.ok(sale.dwellingSurface >= 60 * (1 - answer.rung.band));
    assert.ok(sale.dwellingSurface <= 60 * (1 + answer.rung.band));
  }
});

test('one mutation is one comparable, however many times it is handed in', () => {
  // `years=2025,2025,2025,2025,2025` used to reach the projection as five
  // copies of every sale: measured on this fixture, 28 comparables became 140
  // and the interval on the median narrowed from [7 969, 8 359] to
  // [8 052, 8 220]. The route deduplicates the years; this is the guard that
  // holds whatever the route hands over, because sample size is the one input
  // the arithmetic cannot sanity-check from the inside.
  const once = paris({ type: 'Appartement', surfaceM2: 60 });
  const fivefold = projectAvisValeur({
    mutations: [...parisMutations, ...parisMutations, ...parisMutations,
      ...parisMutations, ...parisMutations],
    subject: { ...PARIS_POINT, type: 'Appartement', surfaceM2: 60 },
    commune: PARIS,
    years: [2025, 2024],
  });
  assert.equal(fivefold.estimate.count, once.estimate.count);
  assert.deepEqual(fivefold.estimate.prixM2.ci90, once.estimate.prixM2.ci90);
  assert.equal(fivefold.excluded.duplicate, parisMutations.length * 4);
  // And no comparable travels twice, which is what threw at `entities.add`.
  const ids = fivefold.comparables.map((sale) => sale.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('choosing the rung on the same prices costs coverage, and the cost is measured', () => {
  // The rung is selected with the very prices that then set the interval's
  // width, which can only LOWER the real coverage. Resampling the fixture's own
  // price law onto the fixture's own geography and running the whole ladder —
  // not a fixed sample — is the only way to see how much.
  const { pool } = comparablePool(parisMutations, { type: 'Appartement' });
  const prices = pool.map((mutation) => mutation.prixM2).sort((a, b) => a - b);
  const truth = percentile(prices, 0.5);
  let seed = 20260908;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let published = 0;
  let covered = 0;
  const trials = 600;
  for (let t = 0; t < trials; t += 1) {
    const resampled = pool.map((mutation) => ({
      ...mutation, prixM2: prices[Math.floor(next() * prices.length)],
    }));
    const anchor = pool[Math.floor(next() * pool.length)];
    const answer = walkLadder(resampled, {
      lon: anchor.lon, lat: anchor.lat, type: 'Appartement', surfaceM2: 60,
    });
    if (answer.basis !== 'comparables') continue;
    published += 1;
    if (answer.stats.ci90.lo <= truth && truth <= answer.stats.ci90.hi) covered += 1;
  }
  const empirical = covered / published;
  // Measured on the live commune-year files with 4 000 draws: 92.5 % (Paris
  // 13e), 91.9 % and 92.0 % (Rodez), 92.8 % (Biarritz) against nominals of
  // 90.1 to 96.9 %. The band here is wide enough for 600 draws on a fixture and
  // narrow enough to fail if selection ever starts costing more than a few
  // points — which is the number the header publishes.
  assert.ok(published > trials * 0.9, `${published} of ${trials} published a centre`);
  assert.ok(empirical > 0.86 && empirical < 0.99,
    `post-selection coverage ${(empirical * 100).toFixed(1)} %`);
});
